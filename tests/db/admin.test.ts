// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
const OWNER = '80000000-0000-4000-8000-000000000001',
  USER = '80000000-0000-4000-8000-000000000002',
  LEGACY = '80000000-0000-4000-8000-000000000003';
let t: TestDb;
const aal = async (value: string) =>
  t.admin("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ aal: value })]);
beforeAll(async () => {
  t = await createTestDb();
  await t.createUser(OWNER, 'owneradmin@gmail.com');
  await t.createUser(USER, 'normaluser@gmail.com');
  await t.createUser(LEGACY, 'legacyadmin@gmail.com');
}, 60000);
afterAll(async () => {
  await t?.db.close();
});
describe('central administrator database security', () => {
  it('denies anonymous access, user self-promotion and provider/telemetry forgery', async () => {
    await expect(t.as(null, 'select central_admin_snapshot()')).rejects.toThrow();
    await expect(t.as(USER, 'select provision_owner_admin($1)', [USER])).rejects.toThrow();
    await expect(
      t.as(USER, 'select record_app_event($1,$2,$3,$4,$5)', [
        USER,
        'a'.repeat(64),
        'b'.repeat(64),
        'web',
        'activity',
      ]),
    ).rejects.toThrow();
    await expect(t.as(USER, 'select * from private.admin_members')).rejects.toThrow();
    await expect(
      t.as(
        USER,
        "select record_provider_metric('supabase_mau',5,'forged','available','forged',null,null)",
      ),
    ).rejects.toThrow();
  });
  it('provisions an explicitly selected verified account idempotently and rejects a second owner', async () => {
    await expect(
      t.as(USER, "select nominate_owner_email('normaluser@gmail.com')"),
    ).rejects.toThrow();
    await expect(t.as(USER, 'select complete_owner_setup()')).rejects.toThrow();
    await t.admin("select nominate_owner_email('owneradmin@gmail.com')");
    await expect(t.as(USER, 'select complete_owner_setup()')).rejects.toThrow();
    await t.admin('update auth.users set email_confirmed_at=null where id=$1', [OWNER]);
    await expect(t.admin('select provision_owner_admin($1)', [OWNER])).rejects.toThrow();
    await t.admin('update auth.users set email_confirmed_at=now() where id=$1', [OWNER]);
    await t.as(OWNER, 'select complete_owner_setup()');
    await t.admin('select provision_owner_admin($1)', [OWNER]);
    expect(await t.admin('select count(*)::int as count from private.admin_members')).toEqual([
      { count: 1 },
    ]);
    await expect(t.admin('select provision_owner_admin($1)', [USER])).rejects.toThrow();
  });
  it('requires real membership, aal2 and a live verified factor on every privileged RPC', async () => {
    await aal('aal1');
    await expect(t.as(OWNER, 'select central_admin_snapshot()')).rejects.toThrow();
    await aal('aal2');
    await expect(t.as(OWNER, 'select central_admin_snapshot()')).rejects.toThrow();
    await t.admin(
      "insert into auth.mfa_factors(user_id,status) values($1,'verified'),($2,'verified')",
      [OWNER, USER],
    );
    await t.admin(
      'update auth.users set raw_user_meta_data=\'{"role":"super_admin"}\' where id=$1',
      [USER],
    );
    expect(await t.as(USER, 'select admin_access() as access')).toEqual([
      {
        access: {
          member: false,
          authorized: false,
          mfa_required: true,
          owner_setup_available: false,
        },
      },
    ]);
    await expect(t.as(USER, 'select central_admin_snapshot()')).rejects.toThrow();
    await expect(
      t.as(USER, "select set_capacity_warning('database_bytes',100,80)"),
    ).rejects.toThrow();
    const access = await t.as<{ access: { authorized: boolean } }>(
      OWNER,
      'select admin_access() as access',
    );
    expect(access[0].access.authorized).toBe(true);
  });
  it('preserves scoped legacy transcription administrators without granting central privileges', async () => {
    await t.admin('insert into private.transcription_admins values($1)', [LEGACY]);
    await t.admin("insert into auth.mfa_factors(user_id,status) values($1,'verified')", [LEGACY]);
    const access = await t.as<{ access: { member: boolean; authorized: boolean } }>(
      LEGACY,
      'select admin_access() as access',
    );
    expect(access[0].access.member).toBe(false);
    expect(
      (
        await t.as<{ access: { authorized: boolean } }>(
          LEGACY,
          "select admin_access('transcription') as access",
        )
      )[0].access.authorized,
    ).toBe(true);
    await expect(t.as(LEGACY, 'select central_admin_snapshot()')).rejects.toThrow();
  });
  it('returns real aggregates with no private content, addresses, credentials or audit payload', async () => {
    await t.as(
      USER,
      "insert into notes(title,content) values('private title','VERY PRIVATE NOTE')",
    );
    await t.admin(
      'insert into auth.audit_log_entries(payload) values(\'{"action":"login","actor_username":"private@example.com","secret":"DO NOT EXPOSE"}\')',
    );
    await t.admin("select record_app_event($1,$2,$3,'windows','activity')", [
      USER,
      'a'.repeat(64),
      'b'.repeat(64),
    ]);
    await t.admin("select record_app_event(null,$1,$2,'web','activity')", [
      'c'.repeat(64),
      'b'.repeat(64),
    ]);
    await t.admin("select record_app_event($1,$2,$3,'android','sync_failed')", [
      USER,
      'a'.repeat(64),
      'b'.repeat(64),
    ]);
    const [{ snapshot }] = await t.as<{ snapshot: Record<string, unknown> }>(
      OWNER,
      'select central_admin_snapshot() as snapshot',
    );
    expect(snapshot).toMatchObject({
      registered_users: 3,
      confirmed_users: 3,
      dau: 1,
      wau: 1,
      mau: 1,
      guest_sessions_today: 1,
    });
    const text = JSON.stringify(snapshot);
    for (const privateValue of [
      'VERY PRIVATE NOTE',
      'private title',
      'private@example.com',
      'DO NOT EXPOSE',
      USER,
    ])
      expect(text).not.toContain(privateValue);
  });
  it('validates limits, logs changes, bounds refresh and revokes access immediately', async () => {
    await expect(
      t.as(OWNER, "select set_capacity_warning('database_bytes','NaN',80)"),
    ).rejects.toThrow();
    await t.as(OWNER, "select set_capacity_warning('database_bytes',10000000,80)");
    expect(await t.as(OWNER, 'select authorize_admin_refresh() as allowed')).toEqual([
      { allowed: true },
    ]);
    expect(await t.as(OWNER, 'select authorize_admin_refresh() as allowed')).toEqual([
      { allowed: false },
    ]);
    await t.admin('update private.admin_members set disabled_at=now() where user_id=$1', [OWNER]);
    await expect(t.as(OWNER, 'select central_admin_snapshot()')).rejects.toThrow();
    await expect(t.as(OWNER, 'select transcription_admin_stats()')).rejects.toThrow();
  });
});
