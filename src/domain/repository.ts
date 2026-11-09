import type {
  CreateNoteInput,
  Folder,
  Note,
  NoteDraft,
  NoteListQuery,
  NotePage,
  NoteVersion,
  Preferences,
  SidebarCounts,
  Tag,
} from './types';

export interface UpdateOptions {
  /**
   * Optimistic concurrency: only apply when the stored note still has this
   * updatedAt. Throws ConflictError otherwise. Omit to force-overwrite.
   */
  expectedUpdatedAt?: string;
}

/**
 * Storage abstraction. The UI talks only to this interface; the guest
 * implementation uses IndexedDB, the account implementation uses Supabase.
 */
export interface NotesRepository {
  readonly kind: 'local' | 'cloud';
  /** Stable cache scope, e.g. "guest" or the user id. */
  readonly scope: string;

  listNotes(query: NoteListQuery): Promise<NotePage>;
  getNote(id: string): Promise<Note | null>;
  createNote(input: CreateNoteInput): Promise<Note>;
  updateNote(id: string, patch: NoteDraft, options?: UpdateOptions): Promise<Note>;
  deleteNotePermanently(id: string): Promise<void>;
  emptyTrash(): Promise<number>;
  setNoteTags(noteId: string, tagIds: string[]): Promise<void>;
  /** Full notes for export (bounded by ids). */
  getNotes(ids: string[]): Promise<Note[]>;

  getCounts(): Promise<SidebarCounts>;

  listFolders(): Promise<Folder[]>;
  createFolder(name: string, id?: string): Promise<Folder>;
  renameFolder(id: string, name: string): Promise<Folder>;
  setFolderAppearance(id: string, color: string, icon: string): Promise<void>;
  /** Deletes the folder; its notes become uncategorized (never deleted). */
  deleteFolder(id: string): Promise<void>;

  listTags(): Promise<Tag[]>;
  createTag(name: string, id?: string): Promise<Tag>;
  renameTag(id: string, name: string): Promise<Tag>;
  deleteTag(id: string): Promise<void>;

  listVersions(noteId: string): Promise<NoteVersion[]>;
  createCheckpoint(noteId: string): Promise<NoteVersion | null>;
  /** Restores a version; current content is checkpointed first. */
  restoreVersion(versionId: string): Promise<Note>;

  getPreferences(): Promise<Preferences>;
  savePreferences(prefs: Preferences): Promise<Preferences>;
}
