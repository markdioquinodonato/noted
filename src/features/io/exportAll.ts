import type { NotesRepository } from '@/domain/repository';
import { activeSavers } from '@/features/notes/noteSaver';
import { exportNotesAsZip } from './txt';

export async function exportAllNotes(repo: NotesRepository): Promise<number> {
  const ids: string[] = [];
  for (const view of ['all', 'archive'] as const) {
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await repo.listNotes({ view, sort: 'updated', limit: 200, offset });
      ids.push(...page.items.map((n) => n.id));
      offset = page.nextOffset;
    }
  }
  const notes = await repo.getNotes(ids);
  for (const note of notes) {
    const saver = activeSavers.get(note.id);
    if (saver?.scope === repo.scope) Object.assign(note, saver.current);
  }
  if (notes.length)
    exportNotesAsZip(notes, `noted-export-${new Date().toISOString().slice(0, 10)}`);
  return notes.length;
}
