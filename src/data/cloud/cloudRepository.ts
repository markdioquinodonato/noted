import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { offlineCache } from '@/data/offlineCache';
import { computeCounts, queryNotes } from '@/domain/query';
import { isNetworkError } from '@/domain/types';
import type { NotesRepository, UpdateOptions } from '@/domain/repository';
import {
  ConflictError,
  DEFAULT_PREFERENCES,
  DuplicateNameError,
  NetworkError,
  NotFoundError,
  ValidationError,
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
import { validateFolderName, validateNoteFields, validateTagName } from '@/lib/text';

// ---- Row shapes (snake_case, as stored in Postgres) ---------------------------
export interface NoteRow {
  id: string;
  owner_id?: string;
  folder_id: string | null;
  title: string;
  content: string;
  is_favorite?: boolean;
  color?: string;
  reminder_at?: string | null;
  reminder_completed_at?: string | null;
  is_pinned: boolean;
  is_archived: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  note_tags?: { tag_id: string }[];
}
interface ListRow extends Omit<NoteRow, 'content' | 'note_tags'> {
  preview: string;
  tag_ids: string[] | null;
  total_count: number;
}
interface FolderRow {
  color?: string;
  icon?: string;
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}
interface VersionRow {
  id: string | null;
  note_id: string;
  version_no: number;
  title: string;
  content: string;
  created_at: string;
}

const NOTE_SELECT =
  'id, owner_id, folder_id, title, content, is_favorite, color, reminder_at, reminder_completed_at, is_pinned, is_archived, deleted_at, created_at, updated_at, note_tags(tag_id)';

export function rowToNote(r: NoteRow): Note {
  return {
    id: r.id,
    ownerId: r.owner_id,
    folderId: r.folder_id,
    title: r.title,
    content: r.content,
    isFavorite: r.is_favorite,
    color: r.color,
    reminderAt: r.reminder_at,
    reminderCompletedAt: r.reminder_completed_at,
    isPinned: r.is_pinned,
    isArchived: r.is_archived,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tagIds: (r.note_tags ?? []).map((t) => t.tag_id).sort(),
  };
}

function draftToRow(patch: NoteDraft): Partial<NoteRow> {
  const row: Partial<NoteRow> = {};
  if (patch.isFavorite !== undefined) row.is_favorite = patch.isFavorite;
  if (patch.color !== undefined) row.color = patch.color;
  if (patch.reminderAt !== undefined) row.reminder_at = patch.reminderAt;
  if (patch.reminderCompletedAt !== undefined)
    row.reminder_completed_at = patch.reminderCompletedAt;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.content !== undefined) row.content = patch.content;
  if (patch.folderId !== undefined) row.folder_id = patch.folderId;
  if (patch.isPinned !== undefined) row.is_pinned = patch.isPinned;
  if (patch.isArchived !== undefined) row.is_archived = patch.isArchived;
  if (patch.deletedAt !== undefined) row.deleted_at = patch.deletedAt;
  return row;
}

function versionFromRow(r: VersionRow): NoteVersion {
  return {
    id: r.id!,
    noteId: r.note_id,
    versionNo: r.version_no,
    title: r.title,
    content: r.content,
    createdAt: r.created_at,
  };
}

/** Translate PostgREST errors into domain errors without leaking internals. */
export function mapError(
  error: PostgrestError | Error,
  kind?: 'folder' | 'tag',
  name?: string,
): Error {
  const e = error as PostgrestError;
  const msg = e.message ?? '';
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(msg)) return new NetworkError();
  if (e.code === '23505' && kind && name) return new DuplicateNameError(kind, name);
  if (e.code === '23503') return new ValidationError('That folder or tag no longer exists.');
  if (e.code === '23514') return new ValidationError('That value is not allowed.');
  if (e.code === 'P0002' || e.code === 'PGRST116') return new NotFoundError();
  if (e.code === '42501') return new ValidationError('You do not have permission to do that.');
  const err = new Error('The server could not complete the request.');
  (err as Error & { code?: string }).code = e.code;
  return err;
}

/** Supabase-backed storage for signed-in users. RLS scopes every query. */
export class CloudNotesRepository implements NotesRepository {
  readonly kind = 'cloud' as const;
  readonly scope: string;

  constructor(
    private readonly sb: SupabaseClient,
    private readonly userId: string,
  ) {
    this.scope = userId;
  }

  private async run<T = unknown>(
    p: PromiseLike<{ data: unknown; error: PostgrestError | null }>,
    kind?: 'folder' | 'tag',
    name?: string,
  ): Promise<T> {
    const { data: auth, error: authError } = await this.sb.auth.getSession();
    if (authError) throw mapError(authError);
    if (auth.session?.user.id !== this.userId)
      throw new ValidationError(
        'This account session has ended. Sign in again before accessing its notes.',
      );
    let res: { data: unknown; error: PostgrestError | null };
    try {
      res = await p;
    } catch (err) {
      throw mapError(err as Error);
    }
    if (res.error) throw mapError(res.error, kind, name);
    return res.data as T;
  }

  async listNotes(q: NoteListQuery): Promise<NotePage> {
    try {
      const rows = await this.run<ListRow[]>(
        this.sb.rpc('list_notes_v2', {
          p_view: q.view,
          p_search: q.search?.trim() || null,
          p_folder_id: q.folderId ?? null,
          p_uncategorized: q.uncategorized ?? false,
          p_tag_id: q.tagId ?? null,
          p_sort: q.sort,
          p_limit: q.limit,
          p_offset: q.offset,
          p_created_after: q.createdAfter ?? null,
          p_updated_after: q.updatedAfter ?? null,
        }),
      );
      const total = rows.length ? Number(rows[0].total_count) : 0;
      const next = q.offset + rows.length;
      return {
        items: rows.map((r) => ({
          id: r.id,
          folderId: r.folder_id,
          title: r.title,
          preview: r.preview,
          isFavorite: r.is_favorite,
          color: r.color,
          reminderAt: r.reminder_at,
          reminderCompletedAt: r.reminder_completed_at,
          isPinned: r.is_pinned,
          isArchived: r.is_archived,
          deletedAt: r.deleted_at,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          tagIds: r.tag_ids ?? [],
        })),
        total,
        nextOffset: next < total ? next : null,
      };
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      const [notes, folders, tags] = await Promise.all([
        offlineCache.notes(this.scope),
        offlineCache.read<Folder[]>(this.scope, 'folders'),
        offlineCache.read<Tag[]>(this.scope, 'tags'),
      ]);
      return queryNotes(notes, q, Date.now(), folders ?? [], tags ?? []);
    }
  }

  async getNote(id: string): Promise<Note | null> {
    try {
      const row = await this.run<NoteRow | null>(
        this.sb.from('notes').select(NOTE_SELECT).eq('id', id).maybeSingle(),
      );
      if (!row) {
        await offlineCache.write(this.scope, `note:${id}`, null).catch(() => undefined);
        return null;
      }
      const note = rowToNote(row);
      if (row.owner_id !== this.userId) {
        const share = await this.run<{ permission: 'read' | 'edit' } | null>(
          this.sb
            .from('note_shares')
            .select('permission')
            .eq('note_id', id)
            .eq('user_id', this.userId)
            .maybeSingle(),
        );
        note.permission = share?.permission ?? 'read';
      }
      await offlineCache.note(this.scope, note).catch(() => undefined);
      return note;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      const cached = await offlineCache.read<Note>(this.scope, `note:${id}`);
      if (cached?.ownerId === this.scope) return cached;
      throw error;
    }
  }

  async getNotes(ids: string[]): Promise<Note[]> {
    const out: Note[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const rows = await this.run<NoteRow[]>(
        this.sb
          .from('notes')
          .select(NOTE_SELECT)
          .in('id', ids.slice(i, i + 100)),
      );
      out.push(...rows.map(rowToNote));
    }
    return out;
  }

  async createNote(input: CreateNoteInput): Promise<Note> {
    validateNoteFields(input);
    const row = await this.run<NoteRow>(
      this.sb
        .from('notes')
        .insert({
          ...(input.id ? { id: input.id } : {}),
          title: input.title ?? '',
          content: input.content ?? '',
          folder_id: input.folderId ?? null,
          is_pinned: input.isPinned ?? false,
          is_favorite: input.isFavorite ?? false,
          color: input.color ?? 'default',
          reminder_at: input.reminderAt ?? null,
          reminder_completed_at: input.reminderCompletedAt ?? null,
        })
        .select(NOTE_SELECT)
        .single(),
    );
    const note = rowToNote(row);
    if (input.tagIds?.length) {
      await this.setNoteTags(note.id, input.tagIds);
      note.tagIds = [...new Set(input.tagIds)].sort();
    }
    return note;
  }

  async updateNote(id: string, patch: NoteDraft, options: UpdateOptions = {}): Promise<Note> {
    validateNoteFields(patch);
    const current = await this.getNote(id);
    if (!current) throw new NotFoundError('Note');
    if (current.ownerId !== this.userId) {
      if (Object.keys(patch).some((k) => k !== 'title' && k !== 'content'))
        throw new ValidationError('Only the owner can change note organization.');
      if (!options.expectedUpdatedAt)
        throw new ValidationError('Reload the shared note before editing.');
      const rows = await this.run<NoteRow[]>(
        this.sb.rpc('update_shared_note', {
          p_note_id: id,
          p_title: patch.title ?? current.title,
          p_content: patch.content ?? current.content,
          p_expected: options.expectedUpdatedAt,
        }),
      );
      if (!rows.length) throw new ConflictError(await this.getNote(id));
      return { ...rowToNote(rows[0]), permission: current.permission };
    }
    let query = this.sb.from('notes').update(draftToRow(patch)).eq('id', id);
    if (options.expectedUpdatedAt) query = query.eq('updated_at', options.expectedUpdatedAt);
    const rows = await this.run<NoteRow[]>(query.select(NOTE_SELECT));
    if (rows.length === 1) {
      const note = rowToNote(rows[0]);
      await offlineCache.note(this.scope, note).catch(() => undefined);
      return note;
    }
    const latest = await this.getNote(id);
    if (!latest) throw new NotFoundError('Note');
    throw new ConflictError(latest);
  }

  async deleteNotePermanently(id: string): Promise<void> {
    const note = await this.getNote(id);
    if (!note?.deletedAt || note.ownerId !== this.userId)
      throw new ValidationError('Only your trashed notes can be permanently deleted.');
    const files = await this.run<{ path: string }[]>(
      this.sb.from('attachments').select('path').eq('note_id', id),
    );
    if (files.length) {
      const { error } = await this.sb.storage
        .from('note-attachments')
        .remove(files.map((f) => f.path));
      if (error) throw new Error('Could not remove attached files. Retry deletion.');
    }
    await this.run(this.sb.from('notes').delete().eq('id', id).not('deleted_at', 'is', null));
    await offlineCache.write(this.scope, `note:${id}`, null).catch(() => undefined);
  }

  async emptyTrash(): Promise<number> {
    const rows = await this.run<{ id: string }[]>(
      this.sb.from('notes').select('id').eq('owner_id', this.userId).not('deleted_at', 'is', null),
    );
    for (const row of rows) await this.deleteNotePermanently(row.id);
    return rows.length;
  }

  async setNoteTags(noteId: string, tagIds: string[]): Promise<void> {
    const wanted = new Set(tagIds);
    const existing = await this.run<{ tag_id: string }[]>(
      this.sb.from('note_tags').select('tag_id').eq('note_id', noteId),
    );
    const have = new Set(existing.map((r) => r.tag_id));
    const toRemove = [...have].filter((t) => !wanted.has(t));
    const toAdd = [...wanted].filter((t) => !have.has(t));
    if (toRemove.length)
      await this.run(
        this.sb.from('note_tags').delete().eq('note_id', noteId).in('tag_id', toRemove),
      );
    if (toAdd.length)
      await this.run(
        this.sb.from('note_tags').upsert(
          toAdd.map((tag_id) => ({ note_id: noteId, tag_id })),
          { onConflict: 'note_id,tag_id', ignoreDuplicates: true },
        ),
      );
  }

  async getCounts(): Promise<SidebarCounts> {
    try {
      return await this.run<SidebarCounts>(this.sb.rpc('sidebar_counts'));
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      return computeCounts(
        await offlineCache.notes(this.scope),
        (await this.listFolders()).map((f) => f.id),
        (await this.listTags()).map((t) => t.id),
      );
    }
  }

  async listFolders(): Promise<Folder[]> {
    let rows: FolderRow[];
    try {
      rows = await this.run<FolderRow[]>(
        this.sb
          .from('folders')
          .select('id, name, color, icon, created_at, updated_at')
          .order('name'),
      );
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      return (await offlineCache.read<Folder[]>(this.scope, 'folders')) ?? [];
    }
    await offlineCache
      .write(
        this.scope,
        'folders',
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          color: r.color,
          icon: r.icon,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      )
      .catch(() => undefined);
    return rows
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        icon: r.icon,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  async createFolder(name: string, id?: string): Promise<Folder> {
    const n = validateFolderName(name);
    const r = await this.run<FolderRow>(
      this.sb
        .from('folders')
        .insert({ ...(id ? { id } : {}), name: n })
        .select('id, name, created_at, updated_at')
        .single(),
      'folder',
      n,
    );
    return { id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at };
  }

  async renameFolder(id: string, name: string): Promise<Folder> {
    const n = validateFolderName(name);
    const r = await this.run<FolderRow>(
      this.sb
        .from('folders')
        .update({ name: n })
        .eq('id', id)
        .select('id, name, created_at, updated_at')
        .single(),
      'folder',
      n,
    );
    return { id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at };
  }

  async setFolderAppearance(id: string, color: string, icon: string): Promise<void> {
    await this.run(this.sb.from('folders').update({ color, icon }).eq('id', id));
  }

  async deleteFolder(id: string): Promise<void> {
    await this.run(this.sb.from('folders').delete().eq('id', id));
  }

  async listTags(): Promise<Tag[]> {
    let rows: Tag[];
    try {
      rows = await this.run<Tag[]>(this.sb.from('tags').select('id, name'));
      await offlineCache.write(this.scope, 'tags', rows).catch(() => undefined);
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      return (await offlineCache.read<Tag[]>(this.scope, 'tags')) ?? [];
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  async createTag(name: string, id?: string): Promise<Tag> {
    const n = validateTagName(name);
    return this.run<Tag>(
      this.sb
        .from('tags')
        .insert({ ...(id ? { id } : {}), name: n })
        .select('id, name')
        .single(),
      'tag',
      n,
    );
  }

  async renameTag(id: string, name: string): Promise<Tag> {
    const n = validateTagName(name);
    return this.run<Tag>(
      this.sb.from('tags').update({ name: n }).eq('id', id).select('id, name').single(),
      'tag',
      n,
    );
  }

  async deleteTag(id: string): Promise<void> {
    await this.run(this.sb.from('tags').delete().eq('id', id));
  }

  async listVersions(noteId: string): Promise<NoteVersion[]> {
    const rows = await this.run<VersionRow[]>(
      this.sb
        .from('note_versions')
        .select('id, note_id, version_no, title, content, created_at')
        .eq('note_id', noteId)
        .order('version_no', { ascending: false })
        .limit(100),
    );
    return rows.map(versionFromRow);
  }

  async createCheckpoint(noteId: string): Promise<NoteVersion | null> {
    const row = await this.run<VersionRow | null>(
      this.sb.rpc('create_note_checkpoint', { p_note_id: noteId }),
    );
    return row && row.id ? versionFromRow(row) : null;
  }

  async restoreVersion(versionId: string): Promise<Note> {
    const row = await this.run<NoteRow>(
      this.sb.rpc('restore_note_version', { p_version_id: versionId }),
    );
    return (await this.getNote(row.id)) ?? rowToNote(row);
  }

  async getPreferences(): Promise<Preferences> {
    const row = await this.run<{
      theme: Preferences['theme'];
      font_size: number;
      autosave_enabled: boolean;
    } | null>(
      this.sb
        .from('user_preferences')
        .select('theme, font_size, autosave_enabled')
        .eq('user_id', this.userId)
        .maybeSingle(),
    );
    if (!row) return DEFAULT_PREFERENCES;
    return { theme: row.theme, fontSize: row.font_size, autosaveEnabled: row.autosave_enabled };
  }

  async savePreferences(prefs: Preferences): Promise<Preferences> {
    const values = {
      theme: prefs.theme,
      font_size: prefs.fontSize,
      autosave_enabled: prefs.autosaveEnabled,
    };
    const updated = await this.run<{ user_id: string }[]>(
      this.sb.from('user_preferences').update(values).eq('user_id', this.userId).select('user_id'),
    );
    if (!updated.length) {
      await this.run(this.sb.from('user_preferences').insert({ user_id: this.userId, ...values }));
    }
    return prefs;
  }

  // ---- Bulk helpers used by guest→account import (idempotent) -----------------
  async insertNotesIgnoringDuplicates(rows: Array<Omit<NoteRow, 'note_tags'>>): Promise<void> {
    await this.run(
      this.sb.from('notes').upsert(rows, { onConflict: 'id', ignoreDuplicates: true }),
    );
  }

  async insertNoteTagsIgnoringDuplicates(
    rows: { note_id: string; tag_id: string }[],
  ): Promise<void> {
    if (!rows.length) return;
    await this.run(
      this.sb
        .from('note_tags')
        .upsert(rows, { onConflict: 'note_id,tag_id', ignoreDuplicates: true }),
    );
  }

  async insertFoldersIgnoringDuplicates(rows: { id: string; name: string }[]): Promise<void> {
    if (!rows.length) return;
    await this.run(
      this.sb.from('folders').upsert(rows, { onConflict: 'id', ignoreDuplicates: true }),
    );
  }

  async insertTagsIgnoringDuplicates(rows: { id: string; name: string }[]): Promise<void> {
    if (!rows.length) return;
    await this.run(this.sb.from('tags').upsert(rows, { onConflict: 'id', ignoreDuplicates: true }));
  }
}
