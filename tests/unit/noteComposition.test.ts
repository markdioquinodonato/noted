import { describe, expect, it } from 'vitest';
import { LocalNotesRepository } from '@/data/local/localRepository';
import { ConflictError } from '@/domain/types';
import { drafts } from '@/data/drafts';
import { NoteSaver } from '@/features/notes/noteSaver';
import {
  createCompositionNote,
  emptyCompositionNote,
  type NoteComposition,
} from '@/features/notes/noteComposition';

function composition(repo: LocalNotesRepository, tagIds: string[] = []): NoteComposition {
  return {
    scope: repo.scope,
    noteId: crypto.randomUUID(),
    folderId: null,
    tagIds,
    createdAt: new Date().toISOString(),
  };
}

describe('materializing a note composition', () => {
  it('recovers the reserved note and completes tag assignment after an interrupted create', async () => {
    const repo = new LocalNotesRepository();
    const category = await repo.createTag('Fieldwork');
    const other = await repo.createTag('Existing');
    const draft = composition(repo, [category.id]);
    const readOnlyError = new Error('Tag assignment interrupted');
    const interrupted: Pick<LocalNotesRepository, 'createNote' | 'getNote' | 'setNoteTags'> = {
      async createNote(input) {
        await repo.createNote({ ...input, tagIds: [other.id] });
        throw readOnlyError;
      },
      getNote: repo.getNote.bind(repo),
      setNoteTags: repo.setNoteTags.bind(repo),
    };
    const patch = { title: 'Field journal', content: 'Map the tide pools.' };

    const first = await createCompositionNote(interrupted, draft, patch);
    const retry = await createCompositionNote(repo, draft, patch);
    expect(first.id).toBe(draft.noteId);
    expect(retry.tagIds.slice().sort()).toEqual([category.id, other.id].sort());
    expect((await repo.exportAll()).notes).toHaveLength(1);
  });

  it('preserves different text in the stored note when retrying a composition ID', async () => {
    const repo = new LocalNotesRepository();
    const draft = composition(repo);
    await repo.createNote({ id: draft.noteId, content: 'Another saved version' });

    await expect(
      createCompositionNote(repo, draft, { content: 'My new draft' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.getNote(draft.noteId))?.content).toBe('Another saved version');
  });
});

describe('saving a new composition', () => {
  it('keeps untouched and emptied compositions out of the library and saves the first real entry', async () => {
    const repo = new LocalNotesRepository();
    const creation = composition(repo);
    const saver = new NoteSaver(creation.noteId, emptyCompositionNote(creation), {
      repo,
      creation,
      drafts,
      autosave: false,
    });
    await saver.flush();
    expect(await repo.getNote(creation.noteId)).toBeNull();

    saver.edit({ title: 'temporary' });
    saver.edit({ title: '', content: '   ' });
    await saver.flush();
    expect(await repo.getNote(creation.noteId)).toBeNull();
    expect(await drafts.get(repo.scope, creation.noteId)).toBeUndefined();

    saver.edit({ content: 'Walk through the old market.' });
    await saver.flush();
    expect(await repo.getNote(creation.noteId)).toMatchObject({
      title: '',
      content: 'Walk through the old market.',
    });
    expect(saver.isNew).toBe(false);
    saver.edit({ title: 'Market notes' });
    await saver.flush();
    expect((await repo.exportAll()).notes).toMatchObject([
      { id: creation.noteId, title: 'Market notes' },
    ]);
    await saver.dispose();
  });

  it('recovers a locally backed up offline composition and saves it once online', async () => {
    const repo = new LocalNotesRepository();
    const folder = await repo.createFolder('Journal');
    const creation = { ...composition(repo), folderId: folder.id };
    const initial = emptyCompositionNote(creation);
    const offlineSaver = new NoteSaver(initial.id, initial, {
      repo,
      creation,
      drafts,
      autosave: false,
      isOnline: () => false,
    });

    offlineSaver.edit({ content: 'This note was written offline.' });
    await offlineSaver.flush();
    expect(offlineSaver.getState()).toMatchObject({ status: 'offline', localDraftSaved: true });
    expect(await repo.getNote(initial.id)).toBeNull();
    const backup = await drafts.get(repo.scope, initial.id);
    expect(backup).toMatchObject({ content: 'This note was written offline.', creation });
    await offlineSaver.suspend();

    const recoveredSaver = new NoteSaver(initial.id, initial, {
      repo,
      creation: backup!.creation,
      drafts,
      initialDirty: backup,
      autosave: false,
      isOnline: () => true,
    });
    await recoveredSaver.flush();
    expect(recoveredSaver.getState().status).toBe('saved');
    expect((await repo.exportAll()).notes).toMatchObject([
      { id: initial.id, content: 'This note was written offline.', folderId: folder.id },
    ]);
    expect(await drafts.get(repo.scope, initial.id)).toBeUndefined();
    await recoveredSaver.dispose();
  });
});
