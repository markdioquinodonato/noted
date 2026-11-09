import type { NotesRepository, UpdateOptions } from '@/domain/repository';
import {
  ConflictError,
  DEFAULT_PREFERENCES,
  DuplicateNameError,
  NotFoundError,
  VERSION_INTERVAL_MS,
  type CreateNoteInput,
  type Folder,
  type Note,
  type NoteDraft,
  type NoteListQuery,
  type NotePage,
  type NoteVersion,
  type Preferences,
  type SidebarCounts,
  type Tag,
} from '@/domain/types';
import { computeCounts, queryNotes } from '@/domain/query';
import { newId } from '@/lib/ids';
import { nameKey, validateFolderName, validateNoteFields, validateTagName } from '@/lib/text';
import { removeLocalAttachments } from '@/data/attachments';
import { noteSnapshot } from '@/features/migration/guestMigration';
import { openGuestDb } from './idb';

const PREFS_KEY = 'preferences';

/** Strictly increasing ISO timestamp relative to a previous one. */
function nextTimestamp(prev?: string): string {
  let now = Date.now();
  if (prev) {
    const p = new Date(prev).getTime();
    if (now <= p) now = p + 1;
  }
  return new Date(now).toISOString();
}

/**
 * Guest storage in IndexedDB. Data never leaves the browser.
 * Mirrors the database rules: soft delete, folder delete → uncategorized,
 * unique folder/tag names, checkpointed version history.
 */
export class LocalNotesRepository implements NotesRepository {
  readonly kind = 'local' as const;
  readonly scope = 'guest';

  private db = openGuestDb;

  async listNotes(query: NoteListQuery): Promise<NotePage> {
    const db = await this.db();
    return queryNotes(
      await db.getAll('notes'),
      query,
      Date.now(),
      await db.getAll('folders'),
      await db.getAll('tags'),
    );
  }

  async getNote(id: string): Promise<Note | null> {
    return (await (await this.db()).get('notes', id)) ?? null;
  }

  async getNotes(ids: string[]): Promise<Note[]> {
    const db = await this.db();
    const out: Note[] = [];
    for (const id of ids) {
      const n = await db.get('notes', id);
      if (n) out.push(n);
    }
    return out;
  }

  /** All guest data, used by the guest→account import. */
  async exportAll(): Promise<{ notes: Note[]; folders: Folder[]; tags: Tag[] }> {
    const db = await this.db();
    const [notes, folders, tags] = await Promise.all([
      db.getAll('notes'),
      db.getAll('folders'),
      db.getAll('tags'),
    ]);
    return { notes, folders, tags };
  }

  async createNote(input: CreateNoteInput): Promise<Note> {
    validateNoteFields(input);
    const db = await this.db();
    const tx = db.transaction(['notes', 'folders', 'tags'], 'readwrite');
    if (input.folderId && !(await tx.objectStore('folders').get(input.folderId))) {
      throw new NotFoundError('Folder');
    }
    for (const tag of input.tagIds ?? [])
      if (!(await tx.objectStore('tags').get(tag))) throw new NotFoundError('Tag');
    const now = new Date().toISOString();
    const note: Note = {
      id: input.id ?? newId(),
      folderId: input.folderId ?? null,
      title: input.title ?? '',
      content: input.content ?? '',
      isFavorite: input.isFavorite ?? false,
      color: input.color ?? 'default',
      reminderAt: input.reminderAt ?? null,
      reminderCompletedAt: input.reminderCompletedAt ?? null,
      isPinned: input.isPinned ?? false,
      isArchived: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      tagIds: [...new Set(input.tagIds ?? [])],
    };
    await tx.objectStore('notes').add(note);
    await tx.done;
    return note;
  }

  async updateNote(id: string, patch: NoteDraft, options: UpdateOptions = {}): Promise<Note> {
    validateNoteFields(patch);
    const db = await this.db();
    const tx = db.transaction(['notes', 'folders', 'versions'], 'readwrite');
    const notes = tx.objectStore('notes');
    const current = await notes.get(id);
    if (!current) throw new NotFoundError('Note');
    if (options.expectedUpdatedAt && current.updatedAt !== options.expectedUpdatedAt) {
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new ConflictError(current);
    }
    if (patch.folderId && !(await tx.objectStore('folders').get(patch.folderId))) {
      throw new NotFoundError('Folder');
    }

    const next: Note = {
      ...current,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
      updatedAt: nextTimestamp(current.updatedAt),
    };

    const textChanged = next.title !== current.title || next.content !== current.content;
    if (textChanged && (current.title || current.content)) {
      const versions = await tx.objectStore('versions').index('byNote').getAll(id);
      const lastAt = versions.reduce((m, v) => (v.createdAt > m ? v.createdAt : m), '');
      const since = Date.now() - new Date(lastAt || current.createdAt).getTime();
      if (since >= VERSION_INTERVAL_MS) {
        await this.insertVersion(tx.objectStore('versions'), versions, current);
      }
    }
    await notes.put(next);
    await tx.done;
    return next;
  }

  private async insertVersion(
    store: { put(v: NoteVersion): Promise<unknown> },
    existing: NoteVersion[],
    note: Pick<Note, 'id' | 'title' | 'content'>,
  ): Promise<NoteVersion> {
    const last = existing.reduce<NoteVersion | null>(
      (m, v) => (!m || v.versionNo > m.versionNo ? v : m),
      null,
    );
    if (last && last.title === note.title && last.content === note.content) return last;
    const v: NoteVersion = {
      id: newId(),
      noteId: note.id,
      versionNo: (last?.versionNo ?? 0) + 1,
      title: note.title,
      content: note.content,
      createdAt: new Date().toISOString(),
    };
    await store.put(v);
    return v;
  }

  async deleteNotePermanently(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['notes', 'versions'], 'readwrite');
    const note = await tx.objectStore('notes').get(id);
    if (note && !note.deletedAt)
      throw new Error('Move the note to Trash before permanent deletion.');
    await tx.objectStore('notes').delete(id);
    const vs = await tx.objectStore('versions').index('byNote').getAllKeys(id);
    for (const k of vs) await tx.objectStore('versions').delete(k);
    await tx.done;
    await removeLocalAttachments(id);
  }

  async emptyTrash(): Promise<number> {
    const db = await this.db();
    const trashed = (await db.getAll('notes')).filter((n) => n.deletedAt);
    for (const n of trashed) await this.deleteNotePermanently(n.id);
    return trashed.length;
  }

  async setNoteTags(noteId: string, tagIds: string[]): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['notes', 'tags'], 'readwrite');
    const note = await tx.objectStore('notes').get(noteId);
    if (!note) throw new NotFoundError('Note');
    const unique = [...new Set(tagIds)];
    for (const t of unique)
      if (!(await tx.objectStore('tags').get(t))) throw new NotFoundError('Tag');
    // Tag changes do not bump updatedAt, so they never conflict with text autosave.
    await tx.objectStore('notes').put({ ...note, tagIds: unique });
    await tx.done;
  }

  async getCounts(): Promise<SidebarCounts> {
    const db = await this.db();
    const [notes, folders, tags] = await Promise.all([
      db.getAll('notes'),
      db.getAllKeys('folders'),
      db.getAllKeys('tags'),
    ]);
    return computeCounts(notes, folders, tags);
  }

  async listFolders(): Promise<Folder[]> {
    const folders = await (await this.db()).getAll('folders');
    return folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  async createFolder(name: string, id?: string): Promise<Folder> {
    const n = validateFolderName(name);
    const db = await this.db();
    const tx = db.transaction('folders', 'readwrite');
    const all = await tx.store.getAll();
    if (all.some((f) => nameKey(f.name) === nameKey(n))) throw new DuplicateNameError('folder', n);
    const now = new Date().toISOString();
    const folder: Folder = { id: id ?? newId(), name: n, createdAt: now, updatedAt: now };
    await tx.store.add(folder);
    await tx.done;
    return folder;
  }

  async renameFolder(id: string, name: string): Promise<Folder> {
    const n = validateFolderName(name);
    const db = await this.db();
    const tx = db.transaction('folders', 'readwrite');
    const all = await tx.store.getAll();
    const f = all.find((x) => x.id === id);
    if (!f) throw new NotFoundError('Folder');
    if (all.some((x) => x.id !== id && nameKey(x.name) === nameKey(n)))
      throw new DuplicateNameError('folder', n);
    const next = { ...f, name: n, updatedAt: new Date().toISOString() };
    await tx.store.put(next);
    await tx.done;
    return next;
  }

  async setFolderAppearance(id: string, color: string, icon: string): Promise<void> {
    if (
      !['default', 'rose', 'amber', 'sage', 'sky', 'violet'].includes(color) ||
      !['folder', 'home', 'school', 'briefcase', 'book', 'heart'].includes(icon)
    )
      throw new Error('Choose a supported folder color and icon.');
    const db = await this.db(),
      tx = db.transaction('folders', 'readwrite'),
      folder = await tx.store.get(id);
    if (!folder) throw new NotFoundError('Folder');
    await tx.store.put({ ...folder, color, icon, updatedAt: nextTimestamp(folder.updatedAt) });
    await tx.done;
  }

  async deleteFolder(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['folders', 'notes'], 'readwrite');
    await tx.objectStore('folders').delete(id);
    let cursor = await tx.objectStore('notes').openCursor();
    while (cursor) {
      if (cursor.value.folderId === id) await cursor.update({ ...cursor.value, folderId: null });
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  async listTags(): Promise<Tag[]> {
    const tags = await (await this.db()).getAll('tags');
    return tags.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  async createTag(name: string, id?: string): Promise<Tag> {
    const n = validateTagName(name);
    const db = await this.db();
    const tx = db.transaction('tags', 'readwrite');
    const all = await tx.store.getAll();
    if (all.some((t) => nameKey(t.name) === nameKey(n))) throw new DuplicateNameError('tag', n);
    const tag: Tag = { id: id ?? newId(), name: n };
    await tx.store.add(tag);
    await tx.done;
    return tag;
  }

  async renameTag(id: string, name: string): Promise<Tag> {
    const n = validateTagName(name);
    const db = await this.db();
    const tx = db.transaction('tags', 'readwrite');
    const all = await tx.store.getAll();
    const t = all.find((x) => x.id === id);
    if (!t) throw new NotFoundError('Tag');
    if (all.some((x) => x.id !== id && nameKey(x.name) === nameKey(n)))
      throw new DuplicateNameError('tag', n);
    const next = { ...t, name: n };
    await tx.store.put(next);
    await tx.done;
    return next;
  }

  async deleteTag(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['tags', 'notes'], 'readwrite');
    await tx.objectStore('tags').delete(id);
    let cursor = await tx.objectStore('notes').openCursor();
    while (cursor) {
      if (cursor.value.tagIds.includes(id))
        await cursor.update({
          ...cursor.value,
          tagIds: cursor.value.tagIds.filter((t) => t !== id),
        });
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  async listVersions(noteId: string): Promise<NoteVersion[]> {
    const vs = await (await this.db()).getAllFromIndex('versions', 'byNote', noteId);
    return vs.sort((a, b) => b.versionNo - a.versionNo);
  }

  async createCheckpoint(noteId: string): Promise<NoteVersion | null> {
    const db = await this.db();
    const tx = db.transaction(['notes', 'versions'], 'readwrite');
    const note = await tx.objectStore('notes').get(noteId);
    if (!note) throw new NotFoundError('Note');
    if (!note.title && !note.content) {
      await tx.done;
      return null;
    }
    const existing = await tx.objectStore('versions').index('byNote').getAll(noteId);
    const v = await this.insertVersion(tx.objectStore('versions'), existing, note);
    await tx.done;
    return v;
  }

  async restoreVersion(versionId: string): Promise<Note> {
    const db = await this.db();
    const tx = db.transaction(['notes', 'versions'], 'readwrite');
    const version = await tx.objectStore('versions').get(versionId);
    if (!version) throw new NotFoundError('Version');
    const note = await tx.objectStore('notes').get(version.noteId);
    if (!note) throw new NotFoundError('Note');
    if (note.title || note.content) {
      const existing = await tx.objectStore('versions').index('byNote').getAll(note.id);
      await this.insertVersion(tx.objectStore('versions'), existing, note);
    }
    const next: Note = {
      ...note,
      title: version.title,
      content: version.content,
      updatedAt: nextTimestamp(note.updatedAt),
    };
    await tx.objectStore('notes').put(next);
    await tx.done;
    return next;
  }

  async getPreferences(): Promise<Preferences> {
    const stored = (await (await this.db()).get('meta', PREFS_KEY)) as
      Partial<Preferences> | undefined;
    return { ...DEFAULT_PREFERENCES, ...(stored ?? {}) };
  }

  async savePreferences(prefs: Preferences): Promise<Preferences> {
    await (await this.db()).put('meta', prefs, PREFS_KEY);
    return prefs;
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await (await this.db()).get('meta', key)) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await (await this.db()).put('meta', value, key);
  }

  /** Remove specific guest notes (and their versions) — used after verified import. */
  async removeNotes(ids: string[], expected: Record<string, Note> = {}): Promise<string[]> {
    const removed: string[] = [];
    for (const id of ids) {
      const db = await this.db(),
        tx = db.transaction(['notes', 'versions'], 'readwrite'),
        note = await tx.objectStore('notes').get(id);
      if (!note || (expected[id] && noteSnapshot(note) !== noteSnapshot(expected[id]))) {
        await tx.done;
        continue;
      }
      await tx.objectStore('notes').delete(id);
      for (const key of await tx.objectStore('versions').index('byNote').getAllKeys(id))
        await tx.objectStore('versions').delete(key);
      await tx.done;
      removed.push(id);
    }
    return removed;
  }

  /** Remove folders/tags no longer referenced by any remaining guest note. */
  async pruneUnusedFoldersAndTags(): Promise<void> {
    const db = await this.db();
    const notes = await db.getAll('notes');
    const usedFolders = new Set(notes.map((n) => n.folderId).filter(Boolean));
    const usedTags = new Set(notes.flatMap((n) => n.tagIds));
    for (const f of await db.getAll('folders'))
      if (!usedFolders.has(f.id)) await db.delete('folders', f.id);
    for (const t of await db.getAll('tags')) if (!usedTags.has(t.id)) await db.delete('tags', t.id);
  }
}
