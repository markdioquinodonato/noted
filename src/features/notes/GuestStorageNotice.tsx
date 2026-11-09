import { useQuery } from '@tanstack/react-query';
import { openGuestDb } from '@/data/local/idb';
import { useRepo } from '@/app/RepositoryProvider';

export function GuestStorageNotice() {
  const { repo } = useRepo();
  const health = useQuery({
    queryKey: ['guest-storage-health'],
    enabled: repo.kind === 'local',
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const db = await openGuestDb(),
        key = `storage-check:${crypto.randomUUID()}`,
        tx = db.transaction('meta', 'readwrite');
      await tx.store.put(true, key);
      if ((await tx.store.get(key)) !== true) throw new Error('Storage check failed.');
      await tx.store.delete(key);
      await tx.done;
      return true;
    },
  });
  if (repo.kind !== 'local' || !health.isError) return null;
  return (
    <div role="alert" className="border-b bg-destructive/10 px-4 py-3 text-sm text-destructive">
      Local browser storage is unavailable or full. New changes may not survive closing this tab.
      Keep open notes open and export them using their note actions.{' '}
      <button className="underline" onClick={() => void health.refetch()}>
        Retry storage check
      </button>
    </div>
  );
}
