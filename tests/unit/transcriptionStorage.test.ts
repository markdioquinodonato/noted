// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  allowTranscripts,
  assertTranscriptSession,
  clearTranscripts,
  deleteNoteTranscript,
  loadJob,
  saveJob,
  transcriptGeneration,
} from '@/features/transcription/storage';
import type { TranscriptJob } from '@/features/transcription/types';
function job(scope: string, id = scope): TranscriptJob {
  return {
    id,
    scope,
    noteId: 'note',
    name: 'private audio',
    audio: new Blob(['original']),
    duration: 1,
    mode: 'strict',
    language: 'multi',
    vocabulary: [],
    normalize: false,
    chunks: [],
    segments: [],
    speakers: {},
    status: 'ready',
    updatedAt: '',
  };
}
describe('device transcript ownership and cleanup', () => {
  it('isolates note drafts across accounts and permanently deletes their recordings', async () => {
    await saveJob(job('a'));
    await saveJob(job('b'));
    expect((await loadJob('a', 'note'))?.scope).toBe('a');
    expect(await loadJob('stranger', 'note')).toBeUndefined();
    await deleteNoteTranscript('a', 'note');
    expect(await loadJob('a', 'note')).toBeUndefined();
    expect((await loadJob('b', 'note'))?.scope).toBe('b');
  });
  it('blocks late writes and old workflow generations after sign-out and reauthentication', async () => {
    const scope = 'session-test';
    allowTranscripts(scope);
    const generation = transcriptGeneration(scope);
    await saveJob(job(scope));
    await clearTranscripts(scope);
    await expect(saveJob(job(scope))).rejects.toThrow();
    expect(await loadJob(scope, 'note')).toBeUndefined();
    allowTranscripts(scope);
    expect(() => assertTranscriptSession(scope, generation)).toThrow();
    await saveJob(job(scope));
    expect((await loadJob(scope, 'note'))?.scope).toBe(scope);
  });
  it('serializes rapid autosaves and purge before a new session write', async () => {
    const scope = 'queue-test';
    allowTranscripts(scope);
    await saveJob(job(scope));
    const purge = clearTranscripts(scope);
    allowTranscripts(scope);
    const fresh = { ...job(scope), name: 'fresh session' };
    const save = saveJob(fresh);
    await Promise.all([purge, save]);
    expect((await loadJob(scope, 'note'))?.name).toBe('fresh session');
  });
});
