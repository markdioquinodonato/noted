import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Folder, Note, NoteVersion, Tag } from '@/domain/types';

export interface GuestDbSchema extends DBSchema {
  notes: { key: string; value: Note };
  folders: { key: string; value: Folder };
  tags: { key: string; value: Tag };
  versions: { key: string; value: NoteVersion; indexes: { byNote: string } };
  meta: { key: string; value: unknown };
}

export const GUEST_DB_NAME = 'noted-guest';
const VERSION = 1;

let dbPromise: Promise<IDBPDatabase<GuestDbSchema>> | null = null;

export function openGuestDb(): Promise<IDBPDatabase<GuestDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<GuestDbSchema>(GUEST_DB_NAME, VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('notes'))
          db.createObjectStore('notes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('folders'))
          db.createObjectStore('folders', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('tags')) db.createObjectStore('tags', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('versions')) {
          const s = db.createObjectStore('versions', { keyPath: 'id' });
          s.createIndex('byNote', 'noteId');
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      },
      blocking() {
        // Another tab wants to upgrade: close so it can proceed.
        void dbPromise?.then((d) => d.close());
        dbPromise = null;
      },
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/** Test helper: drop the cached connection. */
export async function closeGuestDb() {
  if (dbPromise) {
    const d = await dbPromise.catch(() => null);
    d?.close();
  }
  dbPromise = null;
}

/** Ask the browser to keep guest data (reduces eviction risk). Best effort. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
