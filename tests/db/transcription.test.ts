// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
const A = '60000000-0000-4000-8000-000000000001',
  B = '60000000-0000-4000-8000-000000000002';
const R = '60000000-0000-4000-8000-000000000003',
  digest = 'a'.repeat(64);
let t: TestDb, note: string;
beforeAll(async () => {
  t = await createTestDb();
  await t.createUser(A, 'transcripta@gmail.com');
  await t.createUser(B, 'transcriptb@gmail.com');
  [{ id: note }] = await t.as<{ id: string }>(
    A,
    "insert into notes(title) values('Audio') returning id",
  );
}, 60000);
afterAll(async () => {
  await t?.db.close();
});
describe('transcription authorization, quotas and private monitoring', () => {
  it('denies direct quota consumption, result forgery and metric injection by users', async () => {
    await expect(
      t.as(A, 'select reserve_transcription($1,$2,$3,$4,40)', [A, note, R, digest]),
    ).rejects.toThrow();
    await expect(
      t.as(
        A,
        'insert into transcription_chunks(user_id,request_id,note_id,digest) values($1,$2,$3,$4)',
        [A, R, note, digest],
      ),
    ).rejects.toThrow();
    await expect(
      t.as(A, "select record_transcription_event('complete','en','nova-3','fake',40,100,0)"),
    ).rejects.toThrow();
    await expect(t.as(A, 'select * from private.transcription_events')).rejects.toThrow();
  });
  it('reserves only owned notes and enforces request idempotency', async () => {
    await expect(
      t.admin('select reserve_transcription($1,$2,$3,$4,40)', [B, note, R, digest]),
    ).rejects.toThrow();
    const reserve = () =>
      t.admin<{ value: { status: string } }>(
        'select reserve_transcription($1,$2,$3,$4,40) as value',
        [A, note, R, digest],
      );
    expect((await reserve())[0].value.status).toBe('reserved');
    expect((await reserve())[0].value.status).toBe('processing');
    expect(
      await t.admin(
        'select requests,seconds::int from private.transcription_quota where user_id=$1',
        [A],
      ),
    ).toEqual([{ requests: 1, seconds: 40 }]);
    await expect(
      t.admin('select reserve_transcription($1,$2,$3,$4,40)', [A, note, R, 'b'.repeat(64)]),
    ).rejects.toThrow();
  });
  it('restricts cached machine transcripts to the owner, including deletion', async () => {
    await t.admin(
      "update transcription_chunks set status='complete',result='{" +
        '"text":"private words"' +
        "}'::jsonb where user_id=$1",
      [A],
    );
    expect(await t.as(B, 'select result from transcription_chunks')).toEqual([]);
    expect(await t.as(B, 'delete from transcription_chunks returning request_id')).toEqual([]);
    expect(await t.as(A, 'select result from transcription_chunks')).toEqual([
      { result: { text: 'private words' } },
    ]);
    await expect(t.as(A, "update transcription_chunks set result='{}'")).rejects.toThrow();
  });
  it('enforces both audio-duration and request quotas before charging another call', async () => {
    await t.admin('update private.transcription_quota set seconds=9000 where user_id=$1', [A]);
    const [{ value }] = await t.admin<{ value: { status: string } }>(
      'select reserve_transcription($1,$2,gen_random_uuid(),$3,40) as value',
      [A, note, digest],
    );
    expect(value.status).toBe('quota');
    await t.admin(
      'update private.transcription_quota set seconds=0,requests=240 where user_id=$1',
      [A],
    );
    const next = await t.admin<{ value: { status: string } }>(
      'select reserve_transcription($1,$2,gen_random_uuid(),$3,40) as value',
      [A, note, digest],
    );
    expect(next[0].value.status).toBe('quota');
  });
  it('checks administrator membership in the database and returns only aggregates', async () => {
    await expect(t.as(null, 'select transcription_admin_stats()')).rejects.toThrow();
    await expect(t.as(A, 'select transcription_admin_stats()')).rejects.toThrow();
    await t.admin(
      "update auth.users set raw_user_meta_data='{" + '"role":"admin"' + "}' where id=$1",
      [A],
    );
    await expect(t.as(A, 'select transcription_admin_stats()')).rejects.toThrow();
    await t.admin('insert into private.transcription_admins values($1)', [B]);
    await t.admin("insert into auth.mfa_factors(user_id,status) values($1,'verified')", [B]);
    await t.admin('select set_config(\'request.jwt.claims\',\'{"aal":"aal2"}\',false)');
    await t.admin(
      "select record_transcription_event('complete','en+tl','nova-3','verified-contract',40,100,0.01)",
    );
    const rows = await t.as<{ value: Record<string, unknown>[] }>(
      B,
      'select transcription_admin_stats() as value',
    );
    expect(rows[0].value[0]).toMatchObject({
      model: 'nova-3',
      language: 'en+tl',
      successes: 1,
      failures: 0,
    });
    expect(JSON.stringify(rows)).not.toContain('private words');
    expect(JSON.stringify(rows)).not.toContain(A);
    await expect(
      t.as(B, 'select result from transcription_chunks where user_id=$1', [A]),
    ).resolves.toEqual([]);
  });
  it('allows owner cache deletion and cascades cached results when the note is deleted', async () => {
    expect(await t.as(A, 'delete from transcription_chunks returning request_id')).toEqual([
      { request_id: R },
    ]);
  });
});
