import { describe, expect, it } from 'vitest';
import {
  cloudIdFor,
  migrateGuestData,
  MigrationError,
  type GuestData,
  type MigrationTarget,
} from '@/features/migration/guestMigration';
import type { Folder, Note, Tag } from '@/domain/types';
import type { NoteRow } from '@/data/cloud/cloudRepository';
import { nameKey } from '@/lib/text';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';

/** In-memory stand-in for the cloud: ON CONFLICT DO NOTHING + unique names, like Postgres. */
class FakeCloud implements MigrationTarget {
  notes = new Map<string, Omit<NoteRow, 'note_tags'>>();
  folders = new Map<string, Folder>();
  tags = new Map<string, Tag>();
  links = new Set<string>();
  insertCalls = 0;
  failNoteBatchAfter: number | null = null;
  failAlways = false;

  async listFolders() {
    return [...this.folders.values()];
  }
  async listTags() {
    return [...this.tags.values()];
  }
  async getNotes(ids: string[]): Promise<Note[]> {
    return ids
      .filter((id) => this.notes.has(id))
      .map((id) => {
        const r = this.notes.get(id)!;
        return {
          id: r.id,
          folderId: r.folder_id,
          title: r.title,
          content: r.content,
          isPinned: r.is_pinned,
          isFavorite: r.is_favorite,
          color: r.color,
          reminderAt: r.reminder_at,
          reminderCompletedAt: r.reminder_completed_at,
          isArchived: r.is_archived,
          deletedAt: r.deleted_at,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          tagIds: [...this.links].filter((l) => l.startsWith(`${id}|`)).map((l) => l.split('|')[1]),
        };
      });
  }
  async insertFoldersIgnoringDuplicates(rows: { id: string; name: string }[]) {
    for (const r of rows) {
      if (this.folders.has(r.id)) continue;
      if ([...this.folders.values()].some((f) => nameKey(f.name) === nameKey(r.name)))
        throw new Error('23505');
      this.folders.set(r.id, { id: r.id, name: r.name, createdAt: '', updatedAt: '' });
    }
  }
  async insertTagsIgnoringDuplicates(rows: { id: string; name: string }[]) {
    for (const r of rows) {
      if (this.tags.has(r.id)) continue;
      if ([...this.tags.values()].some((t) => nameKey(t.name) === nameKey(r.name)))
        throw new Error('23505');
      this.tags.set(r.id, { id: r.id, name: r.name });
    }
  }
  async insertNotesIgnoringDuplicates(rows: Array<Omit<NoteRow, 'note_tags'>>) {
    if (this.failAlways) throw new TypeError('Failed to fetch');
    if (this.failNoteBatchAfter !== null && this.insertCalls >= this.failNoteBatchAfter) {
      throw new TypeError('Failed to fetch');
    }
    this.insertCalls++;
    for (const r of rows) {
      if (r.folder_id && !this.folders.has(r.folder_id)) throw new Error('23503 folder fk');
      if (!this.notes.has(r.id)) this.notes.set(r.id, r);
    }
  }
  async insertNoteTagsIgnoringDuplicates(rows: { note_id: string; tag_id: string }[]) {
    for (const r of rows) {
      if (!this.notes.has(r.note_id) || !this.tags.has(r.tag_id)) throw new Error('23503');
      this.links.add(`${r.note_id}|${r.tag_id}`);
    }
  }
}

function guestData(n = 15): GuestData {
  const folders: Folder[] = [
    { id: 'gf-work', name: 'Work', createdAt: '', updatedAt: '' },
    { id: 'gf-home', name: 'Home', createdAt: '', updatedAt: '' },
  ];
  const tags: Tag[] = [
    { id: 'gt-urgent', name: 'urgent' },
    { id: 'gt-idea', name: 'idea' },
  ];
  const notes: Note[] = Array.from({ length: n }, (_, i) => ({
    id: `gn-${i}`,
    folderId: i % 3 === 0 ? 'gf-work' : i % 3 === 1 ? 'gf-home' : null,
    title: `Note ${i} ✓`,
    content: `Content ${i}\nline two — ünïcode 日本`,
    isPinned: i === 0,
    isArchived: i === 1,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    tagIds: i % 2 === 0 ? ['gt-urgent', 'gt-idea'] : ['gt-idea'],
  }));
  return { notes, folders, tags };
}

const all = (g: GuestData) => g.notes.map((n) => n.id);

describe('guest → account migration', () => {
  it('imports 15 notes preserving folders, tags and flags, and verifies them', async () => {
    const cloud = new FakeCloud();
    const g = guestData(15);
    const res = await migrateGuestData({
      userId: USER,
      guest: g,
      selectedNoteIds: all(g),
      target: cloud,
      retryBaseMs: 1,
    });
    expect(res).toMatchObject({
      selected: 15,
      imported: 15,
      alreadyInAccount: 0,
      verified: 15,
      foldersCreated: 2,
      tagsCreated: 2,
    });
    expect(res.failedVerification).toEqual([]);
    expect(cloud.notes.size).toBe(15);

    const workCloudId = await cloudIdFor('folder', 'gf-work', USER);
    const n0 = cloud.notes.get(res.verifiedMap['gn-0'])!;
    expect(n0).toMatchObject({ folder_id: workCloudId, is_pinned: true, title: 'Note 0 ✓' });
    expect(cloud.notes.get(res.verifiedMap['gn-1'])!.is_archived).toBe(true);
    const urgent = await cloudIdFor('tag', 'gt-urgent', USER);
    expect(cloud.links.has(`${res.verifiedMap['gn-0']}|${urgent}`)).toBe(true);
    expect(cloud.links.size).toBe(8 * 2 + 7); // even notes have 2 tags, odd notes 1
  });

  it('is idempotent: running again never duplicates notes, folders, tags or links', async () => {
    const cloud = new FakeCloud();
    const g = guestData(15);
    await migrateGuestData({
      userId: USER,
      guest: g,
      selectedNoteIds: all(g),
      target: cloud,
      retryBaseMs: 1,
    });
    const again = await migrateGuestData({
      userId: USER,
      guest: g,
      selectedNoteIds: all(g),
      target: cloud,
      retryBaseMs: 1,
    });
    expect(again).toMatchObject({
      imported: 0,
      alreadyInAccount: 15,
      verified: 15,
      foldersCreated: 0,
      tagsCreated: 0,
    });
    expect(cloud.notes.size).toBe(15);
    expect(cloud.folders.size).toBe(2);
    expect(cloud.tags.size).toBe(2);
  });

  it('survives an interruption mid-upload and resumes without duplicates', async () => {
    const cloud = new FakeCloud();
    const g = guestData(60); // 3 batches of 25
    cloud.failNoteBatchAfter = 1; // first batch succeeds, then the network drops
    await expect(
      migrateGuestData({
        userId: USER,
        guest: g,
        selectedNoteIds: all(g),
        target: cloud,
        retryBaseMs: 1,
      }),
    ).rejects.toBeInstanceOf(MigrationError);
    expect(cloud.notes.size).toBe(25); // partial upload

    cloud.failNoteBatchAfter = null; // connection restored → restart
    const res = await migrateGuestData({
      userId: USER,
      guest: g,
      selectedNoteIds: all(g),
      target: cloud,
      retryBaseMs: 1,
    });
    expect(res).toMatchObject({ imported: 35, alreadyInAccount: 25, verified: 60 });
    expect(cloud.notes.size).toBe(60);
  });

  it('reports a clear, resumable error when the connection is down', async () => {
    const cloud = new FakeCloud();
    cloud.failAlways = true;
    const g = guestData(3);
    const err = await migrateGuestData({
      userId: USER,
      guest: g,
      selectedNoteIds: all(g),
      target: cloud,
      retryBaseMs: 1,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(MigrationError);
    expect(err.message).toMatch(/Nothing was lost/);
  });

  it('merges with existing cloud folders/tags by name and never overwrites existing notes', async () => {
    const cloud = new FakeCloud();
    cloud.folders.set('cloud-work', {
      id: 'cloud-work',
      name: 'work',
      createdAt: '',
      updatedAt: '',
    });
    cloud.tags.set('cloud-idea', { id: 'cloud-idea', name: 'IDEA' });
    const existingId = await cloudIdFor('note', 'gn-2', USER);
    cloud.notes.set(existingId, {
      id: existingId,
      folder_id: null,
      title: 'Edited in cloud',
      content: 'newer cloud content',
      is_pinned: false,
      is_archived: false,
      deleted_at: null,
      created_at: '',
      updated_at: '',
    });
    const g = guestData(5);
    const res = await migrateGuestData({
      userId: USER,
      guest: g,
      selectedNoteIds: all(g),
      target: cloud,
      retryBaseMs: 1,
    });
    expect(res).toMatchObject({
      foldersMerged: 1,
      foldersCreated: 1,
      tagsMerged: 1,
      tagsCreated: 1,
      imported: 4,
      alreadyInAccount: 1,
    });
    expect(cloud.folders.size).toBe(2);
    expect(cloud.notes.get(existingId)!.content).toBe('newer cloud content');
    expect(res.failedVerification).toContain('gn-2');
    expect(res.verifiedMap['gn-2']).toBeUndefined();
    expect([...cloud.links].filter((l) => l.startsWith(existingId + '|'))).toEqual([]);
    expect(cloud.notes.get(res.verifiedMap['gn-0'])!.folder_id).toBe('cloud-work');
  });

  it('imports only the selected notes and only their folders/tags', async () => {
    const cloud = new FakeCloud();
    const g = guestData(6);
    const res = await migrateGuestData({
      userId: USER,
      guest: g,
      selectedNoteIds: ['gn-1'],
      target: cloud,
      retryBaseMs: 1,
    });
    expect(res.selected).toBe(1);
    expect(cloud.notes.size).toBe(1);
    expect([...cloud.folders.values()].map((f) => f.name)).toEqual(['Home']);
    expect([...cloud.tags.values()].map((t) => t.name)).toEqual(['idea']);
  });

  it('flags notes whose stored copy does not match (verification)', async () => {
    const cloud = new FakeCloud();
    const origInsert = cloud.insertNotesIgnoringDuplicates.bind(cloud);
    cloud.insertNotesIgnoringDuplicates = async (rows) => {
      await origInsert(rows.map((r, i) => (i === 0 ? { ...r, content: 'corrupted' } : r)));
    };
    const g = guestData(3);
    const res = await migrateGuestData({
      userId: USER,
      guest: g,
      selectedNoteIds: all(g),
      target: cloud,
      retryBaseMs: 1,
    });
    expect(res.failedVerification).toEqual(['gn-0']);
    expect(res.verifiedMap['gn-0']).toBeUndefined();
    expect(res.verified).toBe(2);
  });

  it('derives different cloud ids per account, so two accounts never collide', async () => {
    expect(await cloudIdFor('note', 'gn-1', USER)).not.toBe(
      await cloudIdFor('note', 'gn-1', OTHER_USER),
    );
    expect(await cloudIdFor('note', 'gn-1', USER)).toBe(await cloudIdFor('note', 'gn-1', USER));
  });
});

it('verifies semantically identical Postgres timestamp strings and preserves appearance/reminders', async () => {
  const cloud = new FakeCloud(),
    guest = guestData(1),
    note = guest.notes[0];
  note.isFavorite = true;
  note.color = 'sage';
  note.reminderAt = '2026-11-08T10:15:00.000Z';
  note.deletedAt = '2026-11-07T10:15:00.000Z';
  const read = cloud.getNotes.bind(cloud);
  cloud.getNotes = async (ids) =>
    (await read(ids)).map((n) => ({
      ...n,
      reminderAt: n.reminderAt?.replace('.000Z', '+00:00'),
      deletedAt: n.deletedAt?.replace('.000Z', '+00:00') ?? null,
    }));
  const result = await migrateGuestData({
    userId: USER,
    guest,
    selectedNoteIds: [note.id],
    target: cloud,
    retryBaseMs: 1,
  });
  expect(result.verified).toBe(1);
  expect(result.verifiedSnapshots[note.id].local).toMatchObject({
    isFavorite: true,
    color: 'sage',
  });
});

it('does not authorize deleting a local note whose cloud counterpart was edited after a previous transfer', async () => {
  const cloud = new FakeCloud(),
    guest = guestData(1);
  const first = await migrateGuestData({
    userId: USER,
    guest,
    selectedNoteIds: all(guest),
    target: cloud,
    retryBaseMs: 1,
  });
  cloud.notes.get(first.verifiedMap[guest.notes[0].id])!.content = 'Changed on another device';
  const again = await migrateGuestData({
    userId: USER,
    guest,
    selectedNoteIds: all(guest),
    target: cloud,
    retryBaseMs: 1,
  });
  expect(again.imported).toBe(0);
  expect(again.verified).toBe(0);
  expect(again.verifiedMap).toEqual({});
  expect(cloud.notes.size).toBe(1);
});
