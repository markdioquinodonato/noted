/** Shared domain model — identical for guest (IndexedDB) and cloud (Supabase) storage. */

export interface Note {
  ownerId?: string;
  permission?: 'read' | 'edit';
  id: string;
  folderId: string | null;
  title: string;
  content: string;
  isFavorite?: boolean;
  color?: string;
  reminderAt?: string | null;
  reminderCompletedAt?: string | null;
  isPinned: boolean;
  isArchived: boolean;
  /** ISO timestamp when moved to Trash, otherwise null. */
  deletedAt: string | null;
  createdAt: string;
  /** Opaque server/local revision timestamp. Kept as a string to preserve DB precision. */
  updatedAt: string;
  tagIds: string[];
}

export interface NoteSummary {
  id: string;
  folderId: string | null;
  title: string;
  preview: string;
  isFavorite?: boolean;
  color?: string;
  reminderAt?: string | null;
  reminderCompletedAt?: string | null;
  isPinned: boolean;
  isArchived: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tagIds: string[];
}

export interface Folder {
  color?: string;
  icon?: string;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
}

export interface NoteVersion {
  id: string;
  noteId: string;
  versionNo: number;
  title: string;
  content: string;
  createdAt: string;
}

export type NoteView =
  'all' | 'recent' | 'pinned' | 'favorites' | 'reminders' | 'shared' | 'archive' | 'trash';
export type NoteSort = 'updated' | 'created' | 'title';

export interface NoteListQuery {
  view: NoteView;
  search?: string;
  createdAfter?: string;
  updatedAfter?: string;
  folderId?: string | null;
  uncategorized?: boolean;
  tagId?: string | null;
  sort: NoteSort;
  limit: number;
  offset: number;
}

export interface NotePage {
  items: NoteSummary[];
  total: number;
  nextOffset: number | null;
}

export interface SidebarCounts {
  all: number;
  favorites?: number;
  reminders?: number;
  shared?: number;
  recent: number;
  pinned: number;
  archive: number;
  trash: number;
  uncategorized: number;
  folders: Record<string, number>;
  tags: Record<string, number>;
}

export interface NoteDraft {
  title?: string;
  content?: string;
  folderId?: string | null;
  isFavorite?: boolean;
  color?: string;
  reminderAt?: string | null;
  reminderCompletedAt?: string | null;
  isPinned?: boolean;
  isArchived?: boolean;
  deletedAt?: string | null;
}

export interface CreateNoteInput {
  id?: string;
  title?: string;
  content?: string;
  folderId?: string | null;
  tagIds?: string[];
  isFavorite?: boolean;
  color?: string;
  reminderAt?: string | null;
  reminderCompletedAt?: string | null;
  isPinned?: boolean;
}

export interface Preferences {
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  autosaveEnabled: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  fontSize: 16,
  autosaveEnabled: true,
};

export const LIMITS = {
  titleMax: 200,
  contentMax: 1_000_000,
  folderNameMax: 60,
  tagNameMax: 40,
  displayNameMax: 80,
  importFileMaxBytes: 1_048_576,
  importMaxFiles: 50,
} as const;

/** Minimum time between automatic version checkpoints (matches the DB trigger). */
export const VERSION_INTERVAL_MS = 10 * 60 * 1000;

export class ConflictError extends Error {
  constructor(public readonly latest: Note | null) {
    super('This note was changed in another tab or device.');
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends Error {
  constructor(what = 'Item') {
    super(`${what} not found.`);
    this.name = 'NotFoundError';
  }
}

export class NetworkError extends Error {
  constructor(message = 'You appear to be offline.') {
    super(message);
    this.name = 'NetworkError';
  }
}

export function isNetworkError(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  return err instanceof TypeError && /fetch|network|load failed/i.test(err.message);
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class DuplicateNameError extends ValidationError {
  constructor(kind: 'folder' | 'tag', name: string) {
    super(`A ${kind} named “${name}” already exists.`);
    this.name = 'DuplicateNameError';
  }
}
