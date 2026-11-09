import { openDB } from 'idb';
import type { Folder, Note, Tag } from '@/domain/types';

const db = () =>
  openDB('noted-offline', 1, {
    upgrade(d) {
      d.createObjectStore('snapshots');
    },
  });
const blocked = new Set<string>();
export const offlineCache = {
  block(scope: string) {
    blocked.add(scope);
  },
  allow(scope: string) {
    blocked.delete(scope);
  },
  async read<T>(scope: string, key: string): Promise<T | undefined> {
    if (blocked.has(scope)) return undefined;
    return (await db()).get('snapshots', `${scope}:${key}`);
  },
  async write(scope: string, key: string, value: unknown) {
    if (blocked.has(scope)) return;
    const d = await db();
    if (blocked.has(scope)) return;
    await d.put('snapshots', value, `${scope}:${key}`);
  },
  async note(scope: string, note: Note) {
    if (note.ownerId === scope) await this.write(scope, `note:${note.id}`, note);
  },
  async notes(scope: string): Promise<Note[]> {
    if (blocked.has(scope)) return [];
    const d = await db(),
      keys = await d.getAllKeys('snapshots');
    const notes: Note[] = [];
    for (const key of keys)
      if (String(key).startsWith(`${scope}:note:`)) {
        const note = (await d.get('snapshots', key)) as Note;
        if (note?.ownerId === scope) notes.push(note);
      }
    return notes;
  },
  async clear(scope: string) {
    const d = await db();
    for (const key of await d.getAllKeys('snapshots'))
      if (String(key).startsWith(`${scope}:`)) await d.delete('snapshots', key);
  },
};
export interface OfflineOrganization {
  folders: Folder[];
  tags: Tag[];
}
