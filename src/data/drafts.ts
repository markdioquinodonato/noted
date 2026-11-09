import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * Crash-safety net: every unsaved edit is mirrored here (debounced) before it
 * is persisted to the real store. Survives refreshes, crashes and offline
 * periods. Removed once the corresponding save succeeds.
 */
export interface DraftRecord {
  key: string; // `${scope}:${noteId}`
  scope: string;
  noteId: string;
  title: string;
  content: string;
  /** updatedAt of the stored note this draft was based on. */
  baseUpdatedAt: string;
  savedAt: number;
}

interface DraftSchema extends DBSchema {
  drafts: { key: string; value: DraftRecord; indexes: { byScope: string } };
}

let p: Promise<IDBPDatabase<DraftSchema>> | null = null;
function db() {
  if (!p) {
    p = openDB<DraftSchema>('noted-drafts', 1, {
      upgrade(d) {
        const s = d.createObjectStore('drafts', { keyPath: 'key' });
        s.createIndex('byScope', 'scope');
      },
    }).catch((e) => {
      p = null;
      throw e;
    });
  }
  return p;
}

export const draftKey = (scope: string, noteId: string) => `${scope}:${noteId}`;

export const drafts = {
  async get(scope: string, noteId: string): Promise<DraftRecord | undefined> {
    try {
      return await (await db()).get('drafts', draftKey(scope, noteId));
    } catch {
      return undefined;
    }
  },
  async put(rec: Omit<DraftRecord, 'key' | 'savedAt'>): Promise<void> {
    try {
      await (
        await db()
      ).put('drafts', { ...rec, key: draftKey(rec.scope, rec.noteId), savedAt: Date.now() });
    } catch {
      throw new Error('Local draft storage is unavailable.');
    }
  },
  /** Delete only if the stored draft is not newer than `ifContent` (avoid racing a newer edit). */
  async clear(
    scope: string,
    noteId: string,
    ifMatches?: { title: string; content: string },
  ): Promise<void> {
    try {
      const d = await db();
      const tx = d.transaction('drafts', 'readwrite');
      const cur = await tx.store.get(draftKey(scope, noteId));
      if (
        cur &&
        (!ifMatches || (cur.title === ifMatches.title && cur.content === ifMatches.content))
      ) {
        await tx.store.delete(cur.key);
      }
      await tx.done;
    } catch {
      /* ignore */
    }
  },
  async listForScope(scope: string): Promise<DraftRecord[]> {
    try {
      return await (await db()).getAllFromIndex('drafts', 'byScope', scope);
    } catch {
      return [];
    }
  },
};

/** Test helper: drop the cached connection. */
export async function closeDraftsDb() {
  if (p) (await p.catch(() => null))?.close();
  p = null;
}
