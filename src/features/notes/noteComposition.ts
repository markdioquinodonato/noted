import type { NotesRepository } from '@/domain/repository';
import { ConflictError, type CreateNoteInput, type Note, type NoteDraft } from '@/domain/types';
import { markdownText } from '@/lib/richText';

export interface NoteComposition {
  scope: string;
  noteId: string;
  folderId: string | null;
  tagIds: string[];
  createdAt: string;
}

type CompositionRepository = Pick<NotesRepository, 'createNote' | 'getNote' | 'setNoteTags'>;

export function emptyCompositionNote(composition: NoteComposition): Note {
  return {
    id: composition.noteId,
    folderId: composition.folderId,
    tagIds: composition.tagIds,
    title: '',
    content: '',
    isPinned: false,
    isArchived: false,
    deletedAt: null,
    createdAt: composition.createdAt,
    updatedAt: composition.createdAt,
  };
}

export function hasCompositionText({ title, content }: { title: string; content: string }) {
  return Boolean(title.trim() || markdownText(content).trim());
}

function sameDate(a?: string | null, b?: string | null) {
  return (a ? Date.parse(a) : null) === (b ? Date.parse(b) : null);
}

/** Use the reserved ID on every attempt so a lost response never creates duplicates. */
export async function createCompositionNote(
  repo: CompositionRepository,
  composition: NoteComposition,
  patch: NoteDraft,
): Promise<Note> {
  const input: CreateNoteInput = {
    ...patch,
    id: composition.noteId,
    folderId: patch.folderId === undefined ? composition.folderId : patch.folderId,
    tagIds: composition.tagIds,
  };
  try {
    return await repo.createNote(input);
  } catch (error) {
    // An insert can succeed before a network interruption or cloud tag assignment failure.
    const stored = await repo.getNote(composition.noteId).catch(() => null);
    if (!stored) throw error;
    if (stored.permission || stored.deletedAt || stored.isArchived) throw new ConflictError(stored);
    const matchingText =
      stored.title === (input.title ?? '') && stored.content === (input.content ?? '');
    if (!matchingText) throw new ConflictError(stored);
    const matchingMetadata =
      stored.folderId === input.folderId &&
      (input.color === undefined || stored.color === input.color) &&
      (input.isPinned === undefined || stored.isPinned === input.isPinned) &&
      (input.isFavorite === undefined || Boolean(stored.isFavorite) === input.isFavorite) &&
      (input.reminderAt === undefined || sameDate(stored.reminderAt, input.reminderAt)) &&
      (input.reminderCompletedAt === undefined ||
        sameDate(stored.reminderCompletedAt, input.reminderCompletedAt));
    if (!matchingMetadata) throw new ConflictError(stored);
    const tagIds = [...new Set([...stored.tagIds, ...composition.tagIds])].sort();
    if (tagIds.length > stored.tagIds.length) {
      await repo.setNoteTags(stored.id, tagIds);
      return { ...stored, tagIds };
    }
    return stored;
  }
}
