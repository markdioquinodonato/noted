import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalNotesRepository } from '@/data/local/localRepository';
import { closeGuestDb } from '@/data/local/idb';
import {
  ConflictError,
  DuplicateNameError,
  VERSION_INTERVAL_MS,
  type NoteListQuery,
} from '@/domain/types';

const q = (over: Partial<NoteListQuery> = {}): NoteListQuery => ({
  view: 'all',
  sort: 'updated',
  limit: 50,
  offset: 0,
  ...over,
});

let repo: LocalNotesRepository;
beforeEach(() => {
  repo = new LocalNotesRepository();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('LocalNotesRepository — notes CRUD', () => {
  it('creates, reads, updates and lists notes', async () => {
    const n = await repo.createNote({ title: 'Hello', content: 'World' });
    expect(await repo.getNote(n.id)).toMatchObject({
      title: 'Hello',
      content: 'World',
      deletedAt: null,
    });
    const u = await repo.updateNote(n.id, { content: 'World!' });
    expect(u.content).toBe('World!');
    expect(u.updatedAt > n.updatedAt).toBe(true);
    const page = await repo.listNotes(q());
    expect(page.items.map((i) => i.id)).toEqual([n.id]);
    expect(page.items[0].preview).toBe('World!');
  });

  it('persists across a new connection (simulated reload)', async () => {
    const n = await repo.createNote({ title: 'Persist me', content: 'Ünïcödé ✓ 日本語\nline 2' });
    await closeGuestDb();
    const fresh = new LocalNotesRepository();
    expect(await fresh.getNote(n.id)).toMatchObject({
      title: 'Persist me',
      content: 'Ünïcödé ✓ 日本語\nline 2',
    });
  });

  it('detects concurrent modification via expectedUpdatedAt', async () => {
    const n = await repo.createNote({ content: 'v1' });
    await repo.updateNote(n.id, { content: 'other tab' });
    await expect(
      repo.updateNote(n.id, { content: 'mine' }, { expectedUpdatedAt: n.updatedAt }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.getNote(n.id))!.content).toBe('other tab');
  });

  it('rejects oversize titles', async () => {
    await expect(repo.createNote({ title: 'x'.repeat(201) })).rejects.toThrow(/at most 200/);
  });
});

describe('search, filters and sorting', () => {
  it('searches title and content case-insensitively; sorts; filters; paginates', async () => {
    const a = await repo.createNote({ title: 'banana', content: 'yellow FRUIT' });
    await new Promise((r) => setTimeout(r, 2));
    const b = await repo.createNote({ title: 'Apple', content: 'red' });
    await new Promise((r) => setTimeout(r, 2));
    const c = await repo.createNote({ title: 'cherry', content: 'small fruit', isPinned: true });

    expect((await repo.listNotes(q({ search: 'fruit' }))).items.map((i) => i.id)).toEqual([
      c.id,
      a.id,
    ]);
    expect((await repo.listNotes(q({ search: 'APPLE' }))).items.map((i) => i.id)).toEqual([b.id]);
    expect((await repo.listNotes(q({ sort: 'title' }))).items.map((i) => i.title)).toEqual([
      'Apple',
      'banana',
      'cherry',
    ]);
    // pinned first, then most recently updated
    expect((await repo.listNotes(q())).items.map((i) => i.id)).toEqual([c.id, b.id, a.id]);
    expect((await repo.listNotes(q({ sort: 'created' }))).items.map((i) => i.id)).toEqual([
      c.id,
      b.id,
      a.id,
    ]);
    expect((await repo.listNotes(q({ view: 'pinned' }))).items.map((i) => i.id)).toEqual([c.id]);

    const p1 = await repo.listNotes(q({ limit: 2 }));
    expect(p1.items).toHaveLength(2);
    expect(p1.total).toBe(3);
    expect(p1.nextOffset).toBe(2);
    const p2 = await repo.listNotes(q({ limit: 2, offset: 2 }));
    expect(p2.items).toHaveLength(1);
    expect(p2.nextOffset).toBeNull();
  });
});

describe('archive, trash and recovery', () => {
  it('archive hides from All; trash soft-deletes; restore; permanent delete; empty trash', async () => {
    const n1 = await repo.createNote({ title: 'one' });
    const n2 = await repo.createNote({ title: 'two' });
    await repo.updateNote(n1.id, { isArchived: true });
    expect((await repo.listNotes(q())).items.map((i) => i.id)).toEqual([n2.id]);
    expect((await repo.listNotes(q({ view: 'archive' }))).items.map((i) => i.id)).toEqual([n1.id]);

    await repo.updateNote(n2.id, { deletedAt: new Date().toISOString() });
    expect((await repo.listNotes(q())).items).toHaveLength(0);
    expect((await repo.listNotes(q({ view: 'trash' }))).items.map((i) => i.id)).toEqual([n2.id]);
    // content is not destroyed by a regular delete
    expect((await repo.getNote(n2.id))!.title).toBe('two');

    await repo.updateNote(n2.id, { deletedAt: null });
    expect((await repo.listNotes(q())).items.map((i) => i.id)).toEqual([n2.id]);

    await repo.updateNote(n2.id, { deletedAt: new Date().toISOString() });
    expect(await repo.emptyTrash()).toBe(1);
    expect(await repo.getNote(n2.id)).toBeNull();

    const counts = await repo.getCounts();
    expect(counts).toMatchObject({ all: 0, archive: 1, trash: 0 });
  });
});

describe('folders and tags', () => {
  it('prevents duplicate names (case/whitespace-insensitive)', async () => {
    await repo.createFolder('Work');
    await expect(repo.createFolder('  work ')).rejects.toBeInstanceOf(DuplicateNameError);
    await repo.createTag('ideas');
    await expect(repo.createTag('#IDEAS')).rejects.toBeInstanceOf(DuplicateNameError);
  });

  it('renames folders and tags', async () => {
    const f = await repo.createFolder('Wrk');
    expect((await repo.renameFolder(f.id, 'Work')).name).toBe('Work');
    const t = await repo.createTag('tdo');
    expect((await repo.renameTag(t.id, 'todo')).name).toBe('todo');
  });

  it('deleting a folder moves its notes to uncategorized (never deletes them)', async () => {
    const f = await repo.createFolder('Temp');
    const n = await repo.createNote({ title: 'inside', folderId: f.id });
    expect((await repo.getCounts()).folders[f.id]).toBe(1);
    await repo.deleteFolder(f.id);
    const after = await repo.getNote(n.id);
    expect(after).toMatchObject({ title: 'inside', folderId: null });
    expect((await repo.listNotes(q({ uncategorized: true }))).items.map((i) => i.id)).toEqual([
      n.id,
    ]);
  });

  it('assigns multiple tags, filters by tag, and removes tag from notes on delete', async () => {
    const t1 = await repo.createTag('a');
    const t2 = await repo.createTag('b');
    const n = await repo.createNote({ title: 'tagged' });
    await repo.setNoteTags(n.id, [t1.id, t2.id, t1.id]);
    expect((await repo.getNote(n.id))!.tagIds.sort()).toEqual([t1.id, t2.id].sort());
    expect((await repo.listNotes(q({ tagId: t2.id }))).items).toHaveLength(1);
    await repo.deleteTag(t2.id);
    expect((await repo.getNote(n.id))!.tagIds).toEqual([t1.id]);
  });

  it('cannot link a note to a non-existent folder or tag', async () => {
    const n = await repo.createNote({});
    await expect(repo.updateNote(n.id, { folderId: crypto.randomUUID() })).rejects.toThrow(
      /not found/i,
    );
    await expect(repo.setNoteTags(n.id, [crypto.randomUUID()])).rejects.toThrow(/not found/i);
  });
});

describe('version history', () => {
  it('creates checkpoints, dedupes identical ones, auto-snapshots after the interval, restores safely', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
    const n = await repo.createNote({ title: 'T', content: 'first' });

    // Rapid edits within the interval: no history rows.
    await repo.updateNote(n.id, { content: 'second' });
    await repo.updateNote(n.id, { content: 'third' });
    expect(await repo.listVersions(n.id)).toHaveLength(0);

    // After the interval, the previous content is snapshotted once.
    vi.setSystemTime(new Date(Date.now() + VERSION_INTERVAL_MS + 1000));
    await repo.updateNote(n.id, { content: 'fourth' });
    let versions = await repo.listVersions(n.id);
    expect(versions.map((v) => [v.versionNo, v.content])).toEqual([[1, 'third']]);

    // Manual checkpoint; identical second checkpoint is deduplicated.
    const cp = await repo.createCheckpoint(n.id);
    expect(cp).toMatchObject({ versionNo: 2, content: 'fourth' });
    expect((await repo.createCheckpoint(n.id))!.versionNo).toBe(2);

    // Restore v1: current content preserved first, ordering intact.
    await repo.updateNote(n.id, { content: 'fifth' });
    const restored = await repo.restoreVersion(versions[0].id);
    expect(restored.content).toBe('third');
    versions = await repo.listVersions(n.id);
    expect(versions.map((v) => [v.versionNo, v.content])).toEqual([
      [3, 'fifth'],
      [2, 'fourth'],
      [1, 'third'],
    ]);
  });

  it('permanently deleting a note removes its versions', async () => {
    const n = await repo.createNote({ content: 'x' });
    await repo.createCheckpoint(n.id);
    await repo.updateNote(n.id, { deletedAt: new Date().toISOString() });
    await repo.deleteNotePermanently(n.id);
    expect(await repo.listVersions(n.id)).toEqual([]);
  });
});

describe('preferences', () => {
  it('defaults and persists guest preferences locally', async () => {
    expect(await repo.getPreferences()).toEqual({
      theme: 'system',
      fontSize: 16,
      autosaveEnabled: true,
    });
    await repo.savePreferences({ theme: 'dark', fontSize: 18, autosaveEnabled: false });
    await closeGuestDb();
    expect(await new LocalNotesRepository().getPreferences()).toEqual({
      theme: 'dark',
      fontSize: 18,
      autosaveEnabled: false,
    });
  });
});

it('keeps local copies changed after import verification, including tag-only changes', async () => {
  const repo = new LocalNotesRepository(),
    note = await repo.createNote({ title: 'Imported copy', content: 'original' }),
    tag = await repo.createTag('changed');
  await repo.setNoteTags(note.id, [tag.id]);
  expect(await repo.removeNotes([note.id], { [note.id]: note })).toEqual([]);
  expect(await repo.getNote(note.id)).not.toBeNull();
  const current = (await repo.getNote(note.id))!;
  expect(await repo.removeNotes([note.id], { [note.id]: current })).toEqual([note.id]);
});
