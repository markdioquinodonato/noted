import type { Folder, Note, Tag } from '@/domain/types';
import { LIMITS } from '@/domain/types';
import type { NoteRow } from '@/data/cloud/cloudRepository';
import { uuidV5 } from '@/lib/ids';
import { nameKey } from '@/lib/text';

/** Minimal cloud surface the importer needs (CloudNotesRepository satisfies it). */
export interface MigrationTarget {
  listFolders(): Promise<Folder[]>;
  listTags(): Promise<Tag[]>;
  getNotes(ids: string[]): Promise<Note[]>;
  insertFoldersIgnoringDuplicates(
    rows: { id: string; name: string; color?: string; icon?: string }[],
  ): Promise<void>;
  insertTagsIgnoringDuplicates(rows: { id: string; name: string }[]): Promise<void>;
  insertNotesIgnoringDuplicates(rows: Array<Omit<NoteRow, 'note_tags'>>): Promise<void>;
  insertNoteTagsIgnoringDuplicates(rows: { note_id: string; tag_id: string }[]): Promise<void>;
}

export interface GuestData {
  notes: Note[];
  folders: Folder[];
  tags: Tag[];
}

export type MigrationPhase =
  'preparing' | 'folders' | 'tags' | 'notes' | 'links' | 'verifying' | 'done';

export interface MigrationProgress {
  phase: MigrationPhase;
  done: number;
  total: number;
}

export interface MigrationResult {
  selected: number;
  imported: number;
  alreadyInAccount: number;
  verified: number;
  failedVerification: string[];
  foldersCreated: number;
  foldersMerged: number;
  tagsCreated: number;
  tagsMerged: number;
  /** guest note id → cloud note id, only for verified notes. */
  verifiedMap: Record<string, string>;
  verifiedSnapshots: Record<string, { local: Note; cloud: Note }>;
}

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly phase: MigrationPhase,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

const BATCH = 25;

export const cloudIdFor = (kind: 'note' | 'folder' | 'tag', guestId: string, userId: string) =>
  uuidV5(`noted:${kind}:${guestId}`, userId);

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastErr;
}

/**
 * Copies selected guest notes (with their folders and tags) into the signed-in
 * account. Guarantees:
 *   - Idempotent / restartable: cloud ids are derived deterministically from
 *     (userId, guestId), and every insert is ON CONFLICT DO NOTHING. Running it
 *     again after an interruption completes the remainder and never duplicates.
 *   - Never overwrites existing cloud notes. Folders/tags with the same name
 *     as existing cloud ones are merged (reused) instead of duplicated.
 *   - Verifies every note by reading it back and comparing title, content and
 *     tags. Local copies must only be removed for verified notes.
 *   - Never deletes anything itself.
 */
export async function migrateGuestData(params: {
  userId: string;
  guest: GuestData;
  selectedNoteIds: string[];
  target: MigrationTarget;
  onProgress?: (p: MigrationProgress) => void;
  retryBaseMs?: number;
}): Promise<MigrationResult> {
  const { userId, guest, target, onProgress } = params;
  const retry = <T>(fn: () => Promise<T>) => withRetry(fn, 3, params.retryBaseMs ?? 500);
  const selectedSet = new Set(params.selectedNoteIds);
  const notes = guest.notes.filter((n) => selectedSet.has(n.id));
  const progress = (phase: MigrationPhase, done = 0, total = 0) =>
    onProgress?.({ phase, done, total });

  progress('preparing');
  const folderIdsUsed = new Set(notes.map((n) => n.folderId).filter((x): x is string => !!x));
  const tagIdsUsed = new Set(notes.flatMap((n) => n.tagIds));
  const guestFolders = guest.folders.filter((f) => folderIdsUsed.has(f.id));
  const guestTags = guest.tags.filter((t) => tagIdsUsed.has(t.id));

  let cloudFolders: Folder[];
  let cloudTags: Tag[];
  try {
    [cloudFolders, cloudTags] = await Promise.all([
      retry(() => target.listFolders()),
      retry(() => target.listTags()),
    ]);
  } catch (e) {
    throw new MigrationError(
      'Could not reach your account. Check your connection and try again.',
      'preparing',
      e,
    );
  }

  // ---- folders: merge by name, else deterministic new id ----------------------
  const folderMap = new Map<string, string>();
  const newFolders: { id: string; name: string; color?: string; icon?: string }[] = [];
  let foldersMerged = 0;
  const cloudFolderByName = new Map(cloudFolders.map((f) => [nameKey(f.name), f.id]));
  for (const f of guestFolders) {
    const existing = cloudFolderByName.get(nameKey(f.name));
    const deterministic = await cloudIdFor('folder', f.id, userId);
    if (existing) {
      folderMap.set(f.id, existing);
      if (existing !== deterministic) foldersMerged++;
    } else {
      folderMap.set(f.id, deterministic);
      newFolders.push({
        id: deterministic,
        name: f.name.slice(0, LIMITS.folderNameMax),
        color: f.color ?? 'default',
        icon: f.icon ?? 'folder',
      });
      cloudFolderByName.set(nameKey(f.name), deterministic);
    }
  }
  progress('folders', 0, newFolders.length);
  try {
    await retry(() => target.insertFoldersIgnoringDuplicates(newFolders));
  } catch (e) {
    throw new MigrationError('Could not create folders in your account.', 'folders', e);
  }
  progress('folders', newFolders.length, newFolders.length);

  // ---- tags ------------------------------------------------------------------------
  const tagMap = new Map<string, string>();
  const newTags: { id: string; name: string }[] = [];
  let tagsMerged = 0;
  const cloudTagByName = new Map(cloudTags.map((t) => [nameKey(t.name), t.id]));
  for (const t of guestTags) {
    const existing = cloudTagByName.get(nameKey(t.name));
    const deterministic = await cloudIdFor('tag', t.id, userId);
    if (existing) {
      tagMap.set(t.id, existing);
      if (existing !== deterministic) tagsMerged++;
    } else {
      tagMap.set(t.id, deterministic);
      newTags.push({ id: deterministic, name: t.name.slice(0, LIMITS.tagNameMax) });
      cloudTagByName.set(nameKey(t.name), deterministic);
    }
  }
  progress('tags', 0, newTags.length);
  try {
    await retry(() => target.insertTagsIgnoringDuplicates(newTags));
  } catch (e) {
    throw new MigrationError('Could not create tags in your account.', 'tags', e);
  }
  progress('tags', newTags.length, newTags.length);

  // ---- notes -----------------------------------------------------------------------
  const noteMap = new Map<string, string>();
  for (const n of notes) noteMap.set(n.id, await cloudIdFor('note', n.id, userId));

  const remapContent = (content: string) =>
    content.replace(/\/notes\/([0-9a-f-]{36})/gi, (match, id: string) =>
      noteMap.has(id) ? `/notes/${noteMap.get(id)}` : match,
    );
  const cloudIds = [...noteMap.values()];
  let existingIds: Set<string>;
  let existingNotes: Map<string, Note>;
  try {
    existingNotes = new Map((await retry(() => target.getNotes(cloudIds))).map((n) => [n.id, n]));
    existingIds = new Set(existingNotes.keys());
  } catch (e) {
    throw new MigrationError('Could not check your account for existing notes.', 'notes', e);
  }

  const toInsert = notes.filter((n) => !existingIds.has(noteMap.get(n.id)!));
  progress('notes', 0, toInsert.length);
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH).map((n) => ({
      id: noteMap.get(n.id)!,
      folder_id: n.folderId ? (folderMap.get(n.folderId) ?? null) : null,
      title: n.title.slice(0, LIMITS.titleMax),
      content: remapContent(n.content).slice(0, LIMITS.contentMax),
      is_favorite: n.isFavorite ?? false,
      color: n.color ?? 'default',
      reminder_at: n.reminderAt ?? null,
      reminder_completed_at: n.reminderCompletedAt ?? null,
      is_pinned: n.isPinned,
      is_archived: n.isArchived,
      deleted_at: n.deletedAt,
      created_at: n.createdAt,
      updated_at: n.updatedAt,
    }));
    try {
      await retry(() => target.insertNotesIgnoringDuplicates(batch));
    } catch (e) {
      throw new MigrationError(
        `Upload interrupted after ${i} of ${toInsert.length} notes. Nothing was lost — run the import again to continue.`,
        'notes',
        e,
      );
    }
    progress('notes', Math.min(i + BATCH, toInsert.length), toInsert.length);
  }

  // ---- note ↔ tag links (for all selected notes; idempotent) --------------------------
  const links = notes
    .filter((n) => {
      const existing = existingNotes.get(noteMap.get(n.id)!);
      return (
        !existing || (existing.title === n.title && existing.content === remapContent(n.content))
      );
    })
    .flatMap((n) =>
      n.tagIds
        .filter((t) => tagMap.has(t))
        .map((t) => ({ note_id: noteMap.get(n.id)!, tag_id: tagMap.get(t)! })),
    );
  progress('links', 0, links.length);
  try {
    for (let i = 0; i < links.length; i += 200) {
      const chunk = links.slice(i, i + 200);
      await retry(() => target.insertNoteTagsIgnoringDuplicates(chunk));
    }
  } catch (e) {
    throw new MigrationError(
      'Notes were uploaded but some tags could not be attached. Run the import again.',
      'links',
      e,
    );
  }
  progress('links', links.length, links.length);

  // ---- verification ------------------------------------------------------------------
  progress('verifying', 0, notes.length);
  let stored: Note[];
  try {
    stored = await retry(() => target.getNotes(cloudIds));
  } catch (e) {
    throw new MigrationError(
      'Upload finished but could not be verified. Run the import again to verify.',
      'verifying',
      e,
    );
  }
  const byId = new Map(stored.map((n) => [n.id, n]));
  const verifiedMap: Record<string, string> = {};
  const failedVerification: string[] = [];
  const verifiedSnapshots: MigrationResult['verifiedSnapshots'] = {};
  for (const n of notes) {
    const cloudId = noteMap.get(n.id)!;
    const s = byId.get(cloudId);
    const expectedTags = n.tagIds.filter((t) => tagMap.has(t)).map((t) => tagMap.get(t)!);
    const ok =
      !!s &&
      s.title === n.title &&
      s.content === remapContent(n.content) &&
      s.folderId === (n.folderId ? (folderMap.get(n.folderId) ?? null) : null) &&
      s.isPinned === n.isPinned &&
      s.isArchived === n.isArchived &&
      sameDate(s.deletedAt, n.deletedAt) &&
      (s.isFavorite ?? false) === (n.isFavorite ?? false) &&
      (s.color ?? 'default') === (n.color ?? 'default') &&
      sameDate(s.reminderAt ?? null, n.reminderAt ?? null) &&
      sameDate(s.reminderCompletedAt ?? null, n.reminderCompletedAt ?? null) &&
      expectedTags.length === s.tagIds.length &&
      expectedTags.every((t) => s.tagIds.includes(t));
    if (ok) {
      verifiedMap[n.id] = cloudId;
      verifiedSnapshots[n.id] = { local: n, cloud: s };
    } else failedVerification.push(n.id);
  }
  progress('done', notes.length, notes.length);

  return {
    selected: notes.length,
    imported: toInsert.length,
    alreadyInAccount: notes.length - toInsert.length,
    verified: Object.keys(verifiedMap).length,
    failedVerification,
    foldersCreated: newFolders.length,
    foldersMerged,
    tagsCreated: newTags.length,
    tagsMerged,
    verifiedMap,
    verifiedSnapshots,
  };
}

export const importLedgerKey = (userId: string) => `import-ledger:${userId}`;
export type ImportLedger = Record<string, string>; // guestId -> cloudId (verified)

/** Compare the receipt again immediately before removing any local copy. */
export function noteSnapshot(note: Note): string {
  return JSON.stringify([
    note.id,
    note.title,
    note.content,
    note.folderId,
    note.isPinned,
    note.isFavorite ?? false,
    note.isArchived,
    note.deletedAt,
    note.color ?? 'default',
    note.reminderAt ?? null,
    note.reminderCompletedAt ?? null,
    note.updatedAt,
    [...note.tagIds].sort(),
  ]);
}

export const importRevisionsKey = (userId: string) => `import-revisions:${userId}`;
const sameDate = (a: string | null, b: string | null) =>
  a === b || (a !== null && b !== null && Date.parse(a) === Date.parse(b));
