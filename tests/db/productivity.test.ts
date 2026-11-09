// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
const A = '00000000-0000-4000-8000-00000000000a',
  B = '00000000-0000-4000-8000-00000000000b',
  C = '00000000-0000-4000-8000-00000000000c';
let t: TestDb, note: string, version: string;
beforeAll(async () => {
  t = await createTestDb();
  await t.createUser(A, 'owner@gmail.com');
  await t.createUser(B, 'reader@gmail.com');
  await t.createUser(C, 'stranger@gmail.com');
  [{ id: note }] = await t.as<{ id: string }>(
    A,
    "insert into notes(title,content) values('Shared idea','Original') returning id",
  );
}, 60000);
afterAll(async () => {
  await t?.db.close();
});
describe('sharing authorization and concurrent editing', () => {
  it('denies sharing another owner’s note', async () => {
    await expect(
      t.as(B, "select share_note($1,'stranger@gmail.com','edit')", [note]),
    ).rejects.toThrow();
  });
  it('grants read access only to the recipient', async () => {
    await t.as(A, "select share_note($1,'reader@gmail.com','read')", [note]);
    expect(await t.as(B, 'select title from notes where id=$1', [note])).toEqual([
      { title: 'Shared idea' },
    ]);
    expect(await t.as(C, 'select title from notes where id=$1', [note])).toEqual([]);
    await expect(
      t.as(B, "select * from update_shared_note($1,'Hacked','oops',now())", [note]),
    ).rejects.toThrow();
    expect(
      await t.as(B, "update notes set title='Hacked' where id=$1 returning id", [note]),
    ).toEqual([]);
  });
  it('permits text edits with a matching revision and rejects stale writes', async () => {
    await t.as(A, "select share_note($1,'reader@gmail.com','edit')", [note]);
    [{ updated_at: version }] = await t.as<{ updated_at: string }>(
      B,
      'select updated_at::text from notes where id=$1',
      [note],
    );
    const changed = await t.as(
      B,
      "select title from update_shared_note($1,'Edited','New content',$2)",
      [note, version],
    );
    expect(changed).toEqual([{ title: 'Edited' }]);
    expect(
      await t.as(B, "select * from update_shared_note($1,'Stale','Old content',$2)", [
        note,
        version,
      ]),
    ).toEqual([]);
    expect(await t.as(A, 'select title from notes where id=$1', [note])).toEqual([
      { title: 'Edited' },
    ]);
  });
  it('lists shared notes separately and hides trashed notes from recipients', async () => {
    const shared = await t.as<{ id: string }>(B, "select id from list_notes_v2(p_view=>'shared')");
    expect(shared.map((n) => n.id)).toEqual([note]);
    await t.as(A, 'update notes set deleted_at=now() where id=$1', [note]);
    expect(await t.as(B, 'select id from notes where id=$1', [note])).toEqual([]);
    await t.as(A, 'update notes set deleted_at=null where id=$1', [note]);
  });
  it('revokes access immediately at the database boundary', async () => {
    expect(
      await t.as(B, 'delete from note_shares where note_id=$1 returning user_id', [note]),
    ).toEqual([]);
    await t.as(A, 'delete from note_shares where note_id=$1', [note]);
    expect(await t.as(B, 'select id from notes where id=$1', [note])).toEqual([]);
    await expect(
      t.as(B, "select * from update_shared_note($1,'No','No',now())", [note]),
    ).rejects.toThrow();
  });
});
describe('private attachments and storage policies', () => {
  const id = '10000000-0000-4000-8000-000000000001';
  let path: string;
  it('requires note ownership and matching storage paths', async () => {
    path = `${A}/${note}/${id}`;
    await expect(
      t.as(
        B,
        "insert into attachments(id,note_id,name,mime_type,size,path) values($1,$2,'x.txt','text/plain',12,$3)",
        [id, note, `${B}/${note}/${id}`],
      ),
    ).rejects.toThrow();
    await expect(
      t.as(
        A,
        "insert into attachments(id,note_id,name,mime_type,size,path) values($1,$2,'x.txt','text/plain',12,'bad')",
        [id, note],
      ),
    ).rejects.toThrow();
    await t.as(
      A,
      "insert into attachments(id,note_id,name,mime_type,size,path) values($1,$2,'x.txt','text/plain',12,$3)",
      [id, note, path],
    );
    await expect(
      t.as(B, "insert into storage.objects(bucket_id,name) values('note-attachments',$1)", [path]),
    ).rejects.toThrow();
    await t.as(A, "insert into storage.objects(bucket_id,name) values('note-attachments',$1)", [
      path,
    ]);
  });
  it('keeps metadata and file objects private', async () => {
    expect(await t.as(B, 'select id from attachments')).toEqual([]);
    expect(await t.as(B, 'select name from storage.objects')).toEqual([]);
    expect(await t.as(A, 'select name from storage.objects')).toEqual([{ name: path }]);
    expect(await t.as(B, 'delete from storage.objects returning name')).toEqual([]);
    await expect(t.as(null, 'select * from attachments')).rejects.toThrow();
    const buckets = await t.admin<{ public: boolean }>('select public from storage.buckets');
    expect(buckets).toEqual([{ public: false }]);
  });
  it('rejects active content, oversize files, and forged ownership', async () => {
    await expect(
      t.as(
        A,
        "insert into attachments(note_id,name,mime_type,size,path) values($1,'x.html','text/html',1,'x')",
        [note],
      ),
    ).rejects.toThrow();
    await expect(
      t.as(
        A,
        "insert into attachments(note_id,name,mime_type,size,path) values($1,'x.txt','text/plain',10485761,'x')",
        [note],
      ),
    ).rejects.toThrow();
    await expect(t.as(A, 'update attachments set owner_id=$1', [B])).rejects.toThrow();
  });
});
describe('search, reminders and quota', () => {
  it('searches readable rich text, folder names, tags and dates', async () => {
    const [{ id: folder }] = await t.as<{ id: string }>(
      A,
      "insert into folders(name) values('Research') returning id",
    );
    const [{ id: tag }] = await t.as<{ id: string }>(
      A,
      "insert into tags(name) values('astronomy') returning id",
    );
    const rich =
      'NOTED_RICH_V1\n' +
      JSON.stringify({
        doc: { type: 'doc', content: [] },
        text: 'A hidden galaxy',
        markdown: 'A hidden galaxy',
      });
    const [{ id }] = await t.as<{ id: string }>(
      A,
      "insert into notes(title,content,folder_id,is_favorite,reminder_at) values('Stars',$1,$2,true,now()) returning id",
      [rich, folder],
    );
    await t.as(A, 'insert into note_tags(note_id,tag_id) values($1,$2)', [id, tag]);
    for (const word of ['galaxy', 'Research', 'astronomy'])
      expect(
        (await t.as<{ id: string }>(A, 'select id from list_notes_v2(p_search=>$1)', [word])).map(
          (n) => n.id,
        ),
      ).toContain(id);
    expect(await t.as(A, "select preview from list_notes_v2(p_search=>'galaxy')")).toEqual([
      { preview: 'A hidden galaxy' },
    ]);
    expect(await t.as(B, "select id from list_notes_v2(p_search=>'galaxy')")).toEqual([]);
    expect(await t.as(A, "select id from list_notes_v2(p_created_after=>'2099-01-01')")).toEqual(
      [],
    );
    expect(
      (await t.as<{ id: string }>(A, "select id from list_notes_v2(p_view=>'favorites')")).map(
        (n) => n.id,
      ),
    ).toContain(id);
    expect(
      (await t.as<{ id: string }>(A, "select id from list_notes_v2(p_view=>'reminders')")).map(
        (n) => n.id,
      ),
    ).toContain(id);
  });
  it('persists real notifications once and enforces ownership', async () => {
    const [{ id, reminder_at }] = await t.as<{ id: string; reminder_at: string }>(
      A,
      'select id,reminder_at::text from notes where reminder_at is not null limit 1',
    );
    await t.as(A, 'insert into notifications(note_id,scheduled_at) values($1,$2)', [
      id,
      reminder_at,
    ]);
    await expect(
      t.as(A, 'insert into notifications(note_id,scheduled_at) values($1,$2)', [id, reminder_at]),
    ).rejects.toThrow();
    await expect(
      t.as(B, 'insert into notifications(note_id,scheduled_at) values($1,$2)', [id, reminder_at]),
    ).rejects.toThrow();
    expect(await t.as(B, 'select id from notifications')).toEqual([]);
  });
  it('atomically limits AI usage per authenticated account', async () => {
    for (let i = 0; i < 20; i++)
      expect(await t.as(A, 'select consume_ai_quota() as ok')).toEqual([{ ok: true }]);
    expect(await t.as(A, 'select consume_ai_quota() as ok')).toEqual([{ ok: false }]);
    expect(await t.as(B, 'select consume_ai_quota() as ok')).toEqual([{ ok: true }]);
    await expect(t.as(null, 'select consume_ai_quota()')).rejects.toThrow();
    await expect(t.as(A, 'select * from private.ai_usage')).rejects.toThrow();
  });
});
