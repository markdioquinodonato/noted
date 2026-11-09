import { describe, expect, it } from 'vitest';
import { LocalNotesRepository } from '@/data/local/localRepository';
import { offlineCache } from '@/data/offlineCache';
import { serializeRich, textDocument, plainText } from '@/lib/richText';
import { uploadAttachment, listAttachments, validateAttachment } from '@/data/attachments';
import { queryNotes } from '@/domain/query';

describe('persistent productivity features', () => {
  it('keeps favorites, colors, reminders and folder appearance across repository instances', async () => {
    const repo = new LocalNotesRepository();
    const folder = await repo.createFolder('Personal');
    await repo.setFolderAppearance(folder.id, 'sage', 'home');
    const note = await repo.createNote({ title: 'Plans', folderId: folder.id });
    await repo.updateNote(note.id, {
      isFavorite: true,
      color: 'sky',
      reminderAt: '2026-01-01T10:00:00Z',
    });
    const reloaded = new LocalNotesRepository();
    expect(await reloaded.getNote(note.id)).toMatchObject({
      isFavorite: true,
      color: 'sky',
      reminderAt: '2026-01-01T10:00:00Z',
    });
    expect((await reloaded.listFolders())[0]).toMatchObject({ color: 'sage', icon: 'home' });
    expect(
      (await reloaded.listNotes({ view: 'favorites', sort: 'updated', offset: 0, limit: 40 }))
        .total,
    ).toBe(1);
    expect(
      (await reloaded.listNotes({ view: 'reminders', sort: 'updated', offset: 0, limit: 40 }))
        .total,
    ).toBe(1);
    await repo.updateNote(note.id, { reminderCompletedAt: new Date().toISOString() });
    expect(
      (await reloaded.listNotes({ view: 'reminders', sort: 'updated', offset: 0, limit: 40 }))
        .total,
    ).toBe(0);
  });
  it('searches rich content, folder and tag names and excludes future date filters', async () => {
    const repo = new LocalNotesRepository(),
      folder = await repo.createFolder('School'),
      tag = await repo.createTag('science');
    const content = serializeRich(textDocument('Solar system'), 'Solar system', 'Solar system');
    const note = await repo.createNote({
      title: 'Class',
      content,
      folderId: folder.id,
      tagIds: [tag.id],
    });
    for (const search of ['Solar', 'School', 'science'])
      expect(
        (
          await repo.listNotes({ view: 'all', search, sort: 'title', limit: 10, offset: 0 })
        ).items.map((n) => n.id),
      ).toEqual([note.id]);
    expect(
      (
        await repo.listNotes({
          view: 'all',
          createdAfter: '2099-01-01',
          sort: 'title',
          limit: 10,
          offset: 0,
        })
      ).items,
    ).toEqual([]);
    expect(plainText((await repo.getNote(note.id))!.content)).toBe('Solar system');
    expect(
      queryNotes([note], { view: 'shared', sort: 'updated', limit: 10, offset: 0 }).total,
    ).toBe(0);
  });
  it('validates attachment types, scopes files, and removes them with a trashed note', async () => {
    const repo = new LocalNotesRepository(),
      note = await repo.createNote({ title: 'Files' });
    const file = new File(['private content'], 'memo.txt', { type: 'text/plain' });
    await uploadAttachment(repo, note.id, file);
    const [stored] = await listAttachments(new LocalNotesRepository(), note.id);
    expect(stored.name).toBe('memo.txt');
    expect(() =>
      validateAttachment(new File(['<script>'], 'evil.html', { type: 'text/html' })),
    ).toThrow('Unsupported');
    expect(() =>
      validateAttachment(new File(['x'], 'spoof.png', { type: 'application/pdf' })),
    ).toThrow('Unsupported');
    await expect(repo.deleteNotePermanently(note.id)).rejects.toThrow('Trash');
    await repo.updateNote(note.id, { deletedAt: new Date().toISOString() });
    await repo.deleteNotePermanently(note.id);
    expect(await listAttachments(repo, note.id)).toEqual([]);
  });
  it('scopes offline snapshots by authenticated account and never caches shared notes', async () => {
    const note = await new LocalNotesRepository().createNote({ title: 'Private' });
    await offlineCache.note('alice', { ...note, ownerId: 'alice' });
    await offlineCache.note('bob', { ...note, ownerId: 'alice', permission: 'read' });
    expect((await offlineCache.notes('alice')).length).toBe(1);
    expect(await offlineCache.notes('bob')).toEqual([]);
    await offlineCache.clear('alice');
    expect(await offlineCache.notes('alice')).toEqual([]);
  });
});
