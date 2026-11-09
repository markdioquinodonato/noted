import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from './queryClient';
import { createContext, useContext, useMemo, useEffect, useState, type ReactNode } from 'react';
import type { NotesRepository } from '@/domain/repository';
import { LocalNotesRepository } from '@/data/local/localRepository';
import { CloudNotesRepository } from '@/data/cloud/cloudRepository';
import { FullPageSpinner } from '@/components/common';
import { useAuth } from '@/features/auth/AuthProvider';

interface RepoContextValue {
  repo: NotesRepository;
  local: LocalNotesRepository;
  cloud: CloudNotesRepository | null;
}

const RepoContext = createContext<RepoContextValue | null>(null);
const localSingleton = new LocalNotesRepository();

/** Chooses guest (IndexedDB) or account (Supabase) storage from the auth state. */
export function RepositoryProvider({
  children,
  local = localSingleton,
}: {
  children: ReactNode;
  local?: LocalNotesRepository;
}) {
  const { user, loading, client: authClient } = useAuth();
  const userId = user?.id;
  const value = useMemo<RepoContextValue>(() => {
    const cloud = userId && authClient ? new CloudNotesRepository(authClient, userId) : null;
    return { repo: cloud ?? local, local, cloud };
  }, [userId, local, authClient]);
  if (loading) return <FullPageSpinner />;
  return (
    <RepoContext.Provider value={value}>
      <ScopedQueries key={value.repo.scope} kind={value.repo.kind}>
        {children}
      </ScopedQueries>
    </RepoContext.Provider>
  );
}

export function useRepo(): RepoContextValue {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error('useRepo must be used inside <RepositoryProvider>');
  return ctx;
}

function ScopedQueries({ children, kind }: { children: ReactNode; kind: 'local' | 'cloud' }) {
  const [client] = useState(() => createQueryClient(kind));
  useEffect(
    () => () => {
      void client.cancelQueries();
      client.clear();
    },
    [client],
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
