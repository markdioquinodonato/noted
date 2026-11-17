import { activeSavers } from '@/features/notes/noteSaver';
import { offlineCache } from '@/data/offlineCache';
import { clearTranscripts } from '@/features/transcription/storage';

/** Old requests can finish, but cannot repopulate a signed-out account's snapshot cache. */
export async function leaveAccount(scope: string) {
  // Block transcript writes immediately, before any asynchronous cleanup.
  const transcripts = clearTranscripts(scope);
  offlineCache.block(scope);
  await Promise.all([
    transcripts,
    (async () => {
      await Promise.all(
        [...activeSavers.values()].filter((s) => s.scope === scope).map((s) => s.suspend()),
      );
      await offlineCache.clear(scope);
    })(),
  ]);
}
