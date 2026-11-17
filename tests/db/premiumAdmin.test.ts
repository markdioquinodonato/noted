// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';

const owner = '81100000-0000-4000-8000-000000000001';
const member = '81100000-0000-4000-8000-000000000002';
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  await db.createUser(owner, 'premiumowner@gmail.com');
  await db.createUser(member, 'premiummember@gmail.com');
  await db.admin('select provision_owner_admin($1)', [owner]);
  await db.admin(
    "insert into auth.mfa_factors(user_id,status) values ($1,'verified'),($2,'verified')",
    [owner, member],
  );
});
afterAll(async () => db?.db.close());
const setAal = (aal: string) =>
  db.admin("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ aal })]);
const query = async (user: string | null, sql: string, args: unknown[] = []) =>
  (await db.as<{ result: unknown }>(user, sql, args))[0]?.result;
const announcement = {
  title: 'Maintenance',
  body: 'Optional maintenance window',
  priority: 'important',
  platform: 'android',
  min_version: '1.9.0',
  max_version: '1.12.0',
  published: false,
  starts_at: null,
  ends_at: null,
};

describe('premium administrator reporting and workflows', () => {
  it('requires administrator membership and MFA across all new privileged reads and writes', async () => {
    for (const [user, aal] of [
      [member, 'aal2'],
      [owner, 'aal1'],
      [null, 'aal2'],
    ] as const) {
      await setAal(aal);
      for (const endpoint of [
        'admin_workspace_snapshot()',
        'admin_analytics(7)',
        'admin_user_directory()',
        'admin_announcements()',
        'admin_alert_inbox()',
        'admin_cloudflare_history()',
        "admin_update_alert(1,'dismiss')",
        "admin_save_announcement(null,null,'{}')",
        "admin_ingest_provider_checks('[]','[]')",
      ]) {
        await expect(db.as(user, 'select ' + endpoint)).rejects.toThrow();
      }
    }
    await expect(db.as(owner, 'select * from private.announcements')).rejects.toThrow();
    await setAal('aal2');
    expect(
      await query(owner, 'select admin_user_directory($1,$2,false,0) as result', [
        'OWNER',
        'admin',
      ]),
    ).toMatchObject({
      total: 1,
      rows: [{ email: 'premiumowner@gmail.com', role: 'Owner', status: 'active', verified: true }],
    });
  });

  it('counts distinct rolling accounts, legitimate note writes and sync events without exposing content', async () => {
    await setAal('aal2');
    await db.as(
      member,
      "insert into notes(title,content) values ('private phrase','private text')",
    );
    await db.as(member, "update notes set title='updated private phrase'");
    await db.as(member, 'update notes set title=title');
    await db.admin(
      `insert into private.app_activity(day,actor_hash,user_id,platform) values
      (current_date,$2,$1,'web'),(current_date,$2,$1,'android'),(current_date-2,$2,$1,'web'),(current_date-30,$2,$1,'web')`,
      [member, 'a'.repeat(64)],
    );
    await db.admin(
      "insert into private.app_events(day,code,platform,count) values(current_date,'sync_conflict','web',2)",
    );
    const result = (await query(owner, 'select admin_analytics(7) as result')) as {
      days: unknown[];
    };
    expect(result.days).toHaveLength(14);
    expect(result.days.at(-1)).toMatchObject({
      dau: 1,
      wau: 1,
      mau: 1,
      errors: 0,
      sync_failed: 2,
      notes_created: 1,
      notes_updated: 1,
    });
    expect(result.days[0]).toMatchObject({ notes_created: null, mau: null });
    expect(
      JSON.stringify(await query(owner, 'select admin_workspace_snapshot() as result')),
    ).not.toContain('private phrase');
  });

  it('keeps drafts and scheduled announcements private and gates published items by platform and numeric version', async () => {
    const feed = (platform = 'android', version = '1.10.0') =>
      query(null, 'select noted_announcements($1,$2) as result', [platform, version]);
    const save = (id: unknown, expected: string | null, item: object) =>
      query(owner, 'select admin_save_announcement($1,$2,$3) as result', [
        id,
        expected,
        JSON.stringify(item),
      ]);
    const get = async () =>
      (await query(owner, 'select admin_announcements() as result')) as {
        items: { updated_at: string }[];
        history: { action: string }[];
      };
    await setAal('aal2');
    const id = await save(null, null, announcement);
    expect(await feed()).toEqual([]);
    const draft = (await get()).items[0];
    await save(id, draft.updated_at, { ...announcement, published: true, starts_at: '2100-01-01' });
    expect(await feed()).toEqual([]);
    await expect(save(id, draft.updated_at, { ...announcement, published: true })).rejects.toThrow(
      'changed',
    );
    await save(id, (await get()).items[0].updated_at, { ...announcement, published: true });
    expect(await feed()).toEqual([expect.objectContaining({ title: 'Maintenance' })]);
    for (const [platform, version] of [
      ['web', '1.10.0'],
      ['android', '1.8.99'],
      ['android', '1.13.0'],
      ['android', '1.10.0-beta'],
    ])
      expect(await feed(platform, version)).toEqual([]);
    await save(id, (await get()).items[0].updated_at, announcement);
    expect(await feed()).toEqual([]);
    expect((await get()).history.map((x) => x.action)).toContain('announcement_unpublished');
  });

  it('opens a threshold incident, persists acknowledgement, and retains resolved history', async () => {
    await setAal('aal2');
    await db.as(owner, "select set_capacity_warning('sync_failures',2,85)");
    await db.admin('select private.sample_admin_monitoring()');
    const inbox = async () =>
      (
        (await query(owner, 'select admin_alert_inbox() as result')) as {
          items: {
            id: number;
            priority: string;
            acknowledged_at: string | null;
            resolved_at: string | null;
          }[];
        }
      ).items;
    const [alert] = await inbox();
    expect(alert.priority).toBe('critical');
    await db.as(owner, "select admin_update_alert($1,'acknowledge')", [alert.id]);
    expect((await inbox())[0].acknowledged_at).not.toBeNull();
    await db.as(owner, "select set_capacity_warning('sync_failures',100,85)");
    await db.admin('select private.sample_admin_monitoring()');
    expect((await inbox())[0].resolved_at).not.toBeNull();
  });
});
