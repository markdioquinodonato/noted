import { openDB, type DBSchema } from 'idb';
import type { TranscriptJob } from './types';

interface TranscriptDb extends DBSchema {
  jobs: {
    key: string;
    value: TranscriptJob;
    indexes: { scope: string; scopeNote: [string, string] };
  };
}
const database = () =>
  openDB<TranscriptDb>('noted-transcripts', 1, {
    upgrade(db) {
      const jobs = db.createObjectStore('jobs', { keyPath: 'id' });
      jobs.createIndex('scope', 'scope');
      jobs.createIndex('scopeNote', ['scope', 'noteId'], { unique: true });
    },
  });
const blockedScopes = new Set<string>();
const generations = new Map<string, number>();
let writes: Promise<unknown> = Promise.resolve();
export function transcriptGeneration(scope: string) {
  return generations.get(scope) ?? 0;
}
export function assertTranscriptSession(scope: string, generation: number) {
  if (blockedScopes.has(scope) || transcriptGeneration(scope) !== generation)
    throw new Error('Account session changed.');
}
export function allowTranscripts(scope: string) {
  blockedScopes.delete(scope);
}
export async function loadJob(scope: string, noteId: string) {
  const db = await database();
  try {
    return await db.getFromIndex('jobs', 'scopeNote', [scope, noteId]);
  } finally {
    db.close();
  }
}
export async function saveJob(job: TranscriptJob) {
  const snapshot = structuredClone(job);
  const generation = transcriptGeneration(job.scope);
  const write = writes
    .catch(() => undefined)
    .then(async () => {
      assertTranscriptSession(snapshot.scope, generation);
      const db = await database();
      try {
        await db.put('jobs', snapshot);
      } finally {
        db.close();
      }
    });
  writes = write;
  return write;
}
export async function deleteJob(id: string) {
  await writes.catch(() => undefined);
  const db = await database();
  try {
    await db.delete('jobs', id);
  } finally {
    db.close();
  }
}
export async function deleteNoteTranscript(scope: string, noteId: string) {
  const job = await loadJob(scope, noteId);
  if (job) await deleteJob(job.id);
}
export async function clearTranscripts(scope: string) {
  blockedScopes.add(scope);
  generations.set(scope, transcriptGeneration(scope) + 1);
  const purge = writes
    .catch(() => undefined)
    .then(async () => {
      const db = await database();
      try {
        const tx = db.transaction('jobs', 'readwrite');
        for (const key of await tx.store.index('scope').getAllKeys(scope))
          await tx.store.delete(key);
        await tx.done;
      } finally {
        db.close();
      }
    });
  writes = purge;
  return purge;
}
