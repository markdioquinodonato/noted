import { activeSavers } from '@/features/notes/noteSaver';
import { offlineCache } from '@/data/offlineCache';

/** Old requests can finish, but cannot repopulate a signed-out account's snapshot cache. */
export async function leaveAccount(scope: string) {
  offlineCache.block(scope);
  await Promise.all(
    [...activeSavers.values()].filter((s) => s.scope === scope).map((s) => s.suspend()),
  );
  await offlineCache.clear(scope);
}
