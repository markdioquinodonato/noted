// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

let t: TestDb;
let noteA: string;
let noteB: string;
let folderA: string;
let folderB: string;
let tagA: string;
let tagB: string;

async function expectError(p: Promise<unknown>, match?: RegExp) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, 'expected the statement to be rejected').toBeTruthy();
  if (match) expect(String((err as Error).message)).toMatch(match);
}

beforeAll(async () => {
  t = await createTestDb();
  await t.createUser(A, 'a@gmail.com', 'Alice');
  await t.createUser(B, 'b@gmail.com', 'Bob');

  [{ id: folderA }] = await t.as<{ id: string }>(
    A,
    `insert into folders (name) values ('Work') returning id`,
  );
  [{ id: folderB }] = await t.as<{ id: string }>(
    B,
    `insert into folders (name) values ('Work') returning id`,
  );
  [{ id: tagA }] = await t.as<{ id: string }>(
    A,
    `insert into tags (name) values ('ideas') returning id`,
  );
  [{ id: tagB }] = await t.as<{ id: string }>(
    B,
    `insert into tags (name) values ('secret') returning id`,
  );
  [{ id: noteA }] = await t.as<{ id: string }>(
    A,
    `insert into notes (title, content, folder_id) values ('A note', 'alpha content', $1) returning id`,
    [folderA],
  );
  [{ id: noteB }] = await t.as<{ id: string }>(
    B,
    `insert into notes (title, content) values ('B private', 'bravo secret content') returning id`,
  );
}, 60_000);

describe('bootstrap', () => {
  it('creates profile and preferences for new users', async () => {
    const p = await t.as(A, `select display_name from profiles`);
    expect(p).toEqual([{ display_name: 'Alice' }]);
    const prefs = await t.as(A, `select theme, font_size, autosave_enabled from user_preferences`);
    expect(prefs).toEqual([{ theme: 'system', font_size: 16, autosave_enabled: true }]);
  });

  it('sets owner_id from auth.uid() by default', async () => {
    const rows = await t.admin<{ owner_id: string }>(`select owner_id from notes where id = $1`, [
      noteA,
    ]);
    expect(rows[0].owner_id).toBe(A);
  });

  it('has RLS enabled on every application table', async () => {
    const rows = await t.admin<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    );
    expect(rows.map((r) => r.relname).sort()).toEqual(
      [
        'profiles',
        'user_preferences',
        'folders',
        'notes',
        'tags',
        'note_tags',
        'note_versions',
        'note_shares',
        'attachments',
        'notifications',
      ].sort(),
    );
    for (const r of rows) expect(r.relrowsecurity, r.relname).toBe(true);
  });
});

describe('anonymous (guest) role', () => {
  it('cannot read any table', async () => {
    for (const table of [
      'notes',
      'folders',
      'tags',
      'note_tags',
      'note_versions',
      'profiles',
      'user_preferences',
    ]) {
      await expectError(t.as(null, `select * from ${table}`), /permission denied/);
    }
  });

  it('cannot write notes', async () => {
    await expectError(t.as(null, `insert into notes (title) values ('x')`), /permission denied/);
  });

  it('cannot call RPCs', async () => {
    await expectError(t.as(null, `select * from list_notes()`), /permission denied/);
    await expectError(t.as(null, `select sidebar_counts()`), /permission denied/);
  });
});

describe('notes isolation', () => {
  it('User A cannot read User B notes', async () => {
    const rows = await t.as(A, `select id from notes where id = $1`, [noteB]);
    expect(rows).toEqual([]);
    const all = await t.as<{ id: string }>(A, `select id from notes`);
    expect(all.map((r) => r.id)).toEqual([noteA]);
  });

  it('User A cannot find User B notes through search RPC', async () => {
    const rows = await t.as(A, `select id from list_notes(p_search => 'bravo')`);
    expect(rows).toEqual([]);
  });

  it('User A cannot edit User B notes (0 rows affected, content intact)', async () => {
    const rows = await t.as(A, `update notes set content = 'hacked' where id = $1 returning id`, [
      noteB,
    ]);
    expect(rows).toEqual([]);
    const [b] = await t.admin<{ content: string }>(`select content from notes where id = $1`, [
      noteB,
    ]);
    expect(b.content).toBe('bravo secret content');
  });

  it('User A cannot delete User B notes', async () => {
    const rows = await t.as(A, `delete from notes where id = $1 returning id`, [noteB]);
    expect(rows).toEqual([]);
    const still = await t.admin(`select id from notes where id = $1`, [noteB]);
    expect(still.length).toBe(1);
  });

  it('User A cannot insert a note owned by User B', async () => {
    await expectError(
      t.as(A, `insert into notes (owner_id, title) values ($1, 'forged')`, [B]),
      /permission denied/,
    );
  });

  it('User A cannot transfer ownership of their own note', async () => {
    await expectError(
      t.as(A, `update notes set owner_id = $1 where id = $2`, [B, noteA]),
      /permission denied/,
    );
  });

  it('User A cannot steal a note id that belongs to User B (PK collision is not an overwrite)', async () => {
    await expectError(t.as(A, `insert into notes (id, title) values ($1, 'steal')`, [noteB]));
    const [b] = await t.admin<{ title: string; owner_id: string }>(
      `select title, owner_id from notes where id = $1`,
      [noteB],
    );
    expect(b).toEqual({ title: 'B private', owner_id: B });
  });
});

describe('folders', () => {
  it('User A cannot see User B folders', async () => {
    const rows = await t.as<{ id: string }>(A, `select id from folders`);
    expect(rows.map((r) => r.id)).toEqual([folderA]);
  });

  it('User A cannot rename or delete User B folders', async () => {
    expect(
      await t.as(A, `update folders set name = 'pwned' where id = $1 returning id`, [folderB]),
    ).toEqual([]);
    expect(await t.as(A, `delete from folders where id = $1 returning id`, [folderB])).toEqual([]);
  });

  it('User A cannot move a note into User B folder', async () => {
    await expectError(
      t.as(A, `update notes set folder_id = $1 where id = $2`, [folderB, noteA]),
      /foreign key/,
    );
    await expectError(
      t.as(A, `insert into notes (title, folder_id) values ('x', $1)`, [folderB]),
      /foreign key/,
    );
  });

  it('rejects duplicate folder names per user (case-insensitive) but allows same name across users', async () => {
    await expectError(t.as(A, `insert into folders (name) values ('  work ')`), /duplicate key/);
  });

  it('deleting a folder keeps its notes and makes them uncategorized', async () => {
    const [{ id: f }] = await t.as<{ id: string }>(
      A,
      `insert into folders (name) values ('Temp') returning id`,
    );
    const [{ id: n }] = await t.as<{ id: string }>(
      A,
      `insert into notes (title, folder_id) values ('in temp', $1) returning id`,
      [f],
    );
    await t.as(A, `delete from folders where id = $1`, [f]);
    const rows = await t.as<{ folder_id: string | null; title: string }>(
      A,
      `select folder_id, title from notes where id = $1`,
      [n],
    );
    expect(rows).toEqual([{ folder_id: null, title: 'in temp' }]);
  });
});

describe('tags', () => {
  it('User A cannot attach User B tag to own note', async () => {
    await expectError(
      t.as(A, `insert into note_tags (note_id, tag_id) values ($1, $2)`, [noteA, tagB]),
    );
  });

  it('User A cannot attach own tag to User B note', async () => {
    await expectError(
      t.as(A, `insert into note_tags (note_id, tag_id) values ($1, $2)`, [noteB, tagA]),
    );
  });

  it('integrity trigger blocks cross-owner links even for privileged writers', async () => {
    await expectError(
      t.admin(`insert into note_tags (note_id, tag_id) values ($1, $2)`, [noteA, tagB]),
      /same user/,
    );
  });

  it('User A can tag own note and cannot see B tag links', async () => {
    await t.as(A, `insert into note_tags (note_id, tag_id) values ($1, $2)`, [noteA, tagA]);
    await t.as(B, `insert into note_tags (note_id, tag_id) values ($1, $2)`, [noteB, tagB]);
    const rows = await t.as<{ tag_id: string }>(A, `select tag_id from note_tags`);
    expect(rows.map((r) => r.tag_id)).toEqual([tagA]);
  });

  it('User A cannot detach B tag links', async () => {
    const rows = await t.as(A, `delete from note_tags where note_id = $1 returning note_id`, [
      noteB,
    ]);
    expect(rows).toEqual([]);
  });

  it('rejects duplicate tag names per user', async () => {
    await expectError(t.as(A, `insert into tags (name) values ('IDEAS')`), /duplicate key/);
  });
});

describe('version history', () => {
  it('clients cannot insert, update or delete versions directly', async () => {
    await expectError(
      t.as(
        A,
        `insert into note_versions (note_id, version_no, title, content) values ($1, 1, 'f', 'f')`,
        [noteA],
      ),
      /permission denied/,
    );
    await expectError(
      t.as(
        A,
        `insert into note_versions (note_id, version_no, title, content) values ($1, 99, 'forged', 'forged')`,
        [noteB],
      ),
      /permission denied/,
    );
    await expectError(t.as(A, `update note_versions set content = 'x'`), /permission denied/);
    await expectError(t.as(A, `delete from note_versions`), /permission denied/);
  });

  it('creates a manual checkpoint for own note', async () => {
    const rows = await t.as<{ version_no: number; content: string }>(
      A,
      `select version_no, content from create_note_checkpoint($1)`,
      [noteA],
    );
    expect(rows[0]).toMatchObject({ version_no: 1, content: 'alpha content' });
  });

  it('does not duplicate identical checkpoints', async () => {
    const rows = await t.as<{ version_no: number }>(
      A,
      `select version_no from create_note_checkpoint($1)`,
      [noteA],
    );
    expect(rows[0].version_no).toBe(1);
  });

  it('User A cannot checkpoint User B note', async () => {
    await expectError(t.as(A, `select create_note_checkpoint($1)`, [noteB]), /not found/);
    const v = await t.admin(`select * from note_versions where note_id = $1`, [noteB]);
    expect(v).toEqual([]);
  });

  it('auto-snapshots previous content after the checkpoint interval only', async () => {
    const [{ id: n }] = await t.as<{ id: string }>(
      A,
      `insert into notes (title, content) values ('v', 'one') returning id`,
    );
    // Fresh note: edits within 10 minutes do not create history rows.
    await t.as(A, `update notes set content = 'two' where id = $1`, [n]);
    expect(await t.as(A, `select * from note_versions where note_id = $1`, [n])).toEqual([]);
    // Simulate time passing.
    await t.admin(`update notes set created_at = now() - interval '11 minutes' where id = $1`, [n]);
    await t.as(A, `update notes set content = 'three' where id = $1`, [n]);
    const v = await t.as<{ version_no: number; content: string }>(
      A,
      `select version_no, content from note_versions where note_id = $1 order by version_no`,
      [n],
    );
    expect(v).toEqual([{ version_no: 1, content: 'two' }]);
    // Immediately after, no extra snapshot.
    await t.as(A, `update notes set content = 'four' where id = $1`, [n]);
    expect((await t.as(A, `select 1 from note_versions where note_id = $1`, [n])).length).toBe(1);
  });

  it('restore preserves current content first and is correctly ordered', async () => {
    const [{ id: n }] = await t.as<{ id: string }>(
      A,
      `insert into notes (title, content) values ('r', 'first') returning id`,
    );
    const [{ id: v1 }] = await t.as<{ id: string }>(
      A,
      `select id from create_note_checkpoint($1)`,
      [n],
    );
    await t.as(A, `update notes set content = 'second' where id = $1`, [n]);
    const restored = await t.as<{ content: string }>(
      A,
      `select content from restore_note_version($1)`,
      [v1],
    );
    expect(restored[0].content).toBe('first');
    const v = await t.as<{ version_no: number; content: string }>(
      A,
      `select version_no, content from note_versions where note_id = $1 order by version_no`,
      [n],
    );
    expect(v).toEqual([
      { version_no: 1, content: 'first' },
      { version_no: 2, content: 'second' },
    ]);
  });

  it('User B cannot read or restore User A versions', async () => {
    const [{ id: vA }] = await t.as<{ id: string }>(
      A,
      `select id from note_versions where note_id = $1 limit 1`,
      [noteA],
    );
    expect(await t.as(B, `select * from note_versions where id = $1`, [vA])).toEqual([]);
    await expectError(t.as(B, `select restore_note_version($1)`, [vA]), /not found/);
  });
});

describe('profiles & preferences', () => {
  it('User A cannot read or modify User B profile', async () => {
    expect(await t.as(A, `select * from profiles where id = $1`, [B])).toEqual([]);
    expect(
      await t.as(A, `update profiles set display_name = 'x' where id = $1 returning id`, [B]),
    ).toEqual([]);
    const [b] = await t.admin<{ display_name: string }>(
      `select display_name from profiles where id = $1`,
      [B],
    );
    expect(b.display_name).toBe('Bob');
  });

  it('User A cannot change profile id or forge B preferences', async () => {
    await expectError(t.as(A, `update profiles set id = $1`, [B]), /permission denied/);
    await expectError(t.as(A, `insert into user_preferences (user_id) values ($1)`, [B]));
    expect(
      await t.as(
        A,
        `update user_preferences set theme = 'dark' where user_id = $1 returning user_id`,
        [B],
      ),
    ).toEqual([]);
  });

  it('validates preference values', async () => {
    await expectError(t.as(A, `update user_preferences set font_size = 99`), /check constraint/);
    await expectError(t.as(A, `update user_preferences set theme = 'neon'`), /check constraint/);
  });
});

describe('list_notes / sidebar_counts', () => {
  it('lists, searches, filters and escapes LIKE wildcards', async () => {
    const U = '00000000-0000-4000-8000-0000000000cc';
    await t.createUser(U, 'c@gmail.com');
    const [{ id: f }] = await t.as<{ id: string }>(
      U,
      `insert into folders (name) values ('F') returning id`,
    );
    const [{ id: tg }] = await t.as<{ id: string }>(
      U,
      `insert into tags (name) values ('t') returning id`,
    );
    await t.as(
      U,
      `insert into notes (title, content, is_pinned) values ('Zebra', 'striped 100%', true)`,
    );
    const [{ id: n2 }] = await t.as<{ id: string }>(
      U,
      `insert into notes (title, content, folder_id) values ('apple', 'red fruit', $1) returning id`,
      [f],
    );
    await t.as(U, `insert into note_tags values ($1, $2)`, [n2, tg]);
    await t.as(U, `insert into notes (title, is_archived) values ('old', true)`);
    await t.as(U, `insert into notes (title, deleted_at) values ('gone', now())`);

    const all = await t.as<{ title: string; total_count: string }>(
      U,
      `select title, total_count from list_notes()`,
    );
    expect(all.map((r) => r.title)).toEqual(['Zebra', 'apple']); // pinned first
    expect(Number(all[0].total_count)).toBe(2);

    const alpha = await t.as<{ title: string }>(
      U,
      `select title from list_notes(p_sort => 'title')`,
    );
    expect(alpha.map((r) => r.title)).toEqual(['apple', 'Zebra']);

    expect(
      (await t.as<{ title: string }>(U, `select title from list_notes(p_search => 'FRUIT')`)).map(
        (r) => r.title,
      ),
    ).toEqual(['apple']);
    expect(
      (await t.as<{ title: string }>(U, `select title from list_notes(p_search => '%')`)).map(
        (r) => r.title,
      ),
    ).toEqual(['Zebra']);
    expect((await t.as(U, `select title from list_notes(p_search => '_')`)).length).toBe(0);
    expect(
      (
        await t.as<{ title: string }>(U, `select title from list_notes(p_folder_id => $1)`, [f])
      ).map((r) => r.title),
    ).toEqual(['apple']);
    expect(
      (
        await t.as<{ title: string }>(U, `select title from list_notes(p_uncategorized => true)`)
      ).map((r) => r.title),
    ).toEqual(['Zebra']);
    expect(
      (await t.as<{ title: string }>(U, `select title from list_notes(p_tag_id => $1)`, [tg])).map(
        (r) => r.title,
      ),
    ).toEqual(['apple']);
    expect(
      (await t.as<{ title: string }>(U, `select title from list_notes('archive')`)).map(
        (r) => r.title,
      ),
    ).toEqual(['old']);
    expect(
      (await t.as<{ title: string }>(U, `select title from list_notes('trash')`)).map(
        (r) => r.title,
      ),
    ).toEqual(['gone']);
    expect(
      (await t.as<{ title: string }>(U, `select title from list_notes('pinned')`)).map(
        (r) => r.title,
      ),
    ).toEqual(['Zebra']);
    const page = await t.as(U, `select title from list_notes(p_limit => 1, p_offset => 1)`);
    expect(page.length).toBe(1);

    const [{ sidebar_counts: c }] = await t.as<{ sidebar_counts: Record<string, unknown> }>(
      U,
      `select sidebar_counts()`,
    );
    expect(c).toMatchObject({ all: 2, pinned: 1, archive: 1, trash: 1, uncategorized: 1 });
    expect((c.folders as Record<string, number>)[f]).toBe(1);
    expect((c.tags as Record<string, number>)[tg]).toBe(1);
  });
});

describe('cascade on account deletion', () => {
  it('removes all of the user data', async () => {
    const D = '00000000-0000-4000-8000-0000000000dd';
    await t.createUser(D, 'd@gmail.com');
    const [{ id: f }] = await t.as<{ id: string }>(
      D,
      `insert into folders (name) values ('x') returning id`,
    );
    const [{ id: n }] = await t.as<{ id: string }>(
      D,
      `insert into notes (title, content, folder_id) values ('x', 'y', $1) returning id`,
      [f],
    );
    await t.as(D, `select create_note_checkpoint($1)`, [n]);
    await t.admin(`delete from auth.users where id = $1`, [D]);
    for (const q of [
      `select 1 from notes where owner_id = '${D}'`,
      `select 1 from folders where owner_id = '${D}'`,
      `select 1 from note_versions where note_id = '${n}'`,
      `select 1 from profiles where id = '${D}'`,
    ]) {
      expect(await t.admin(q)).toEqual([]);
    }
  });
});
