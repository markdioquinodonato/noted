import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRepo } from '@/app/RepositoryProvider';
import type { NoteListQuery, NoteSort, NoteView, Preferences } from '@/domain/types';
import { DEFAULT_PREFERENCES } from '@/domain/types';
import { errorMessage } from '@/lib/format';
import { setThemePreference } from '@/lib/theme';

export const PAGE_SIZE = 40;

export const qk = {
  notes: (scope: string) => ['notes', scope] as const,
  noteList: (scope: string, q: Omit<NoteListQuery, 'offset' | 'limit'>) =>
    ['notes', scope, 'list', q] as const,
  note: (scope: string, id: string) => ['note', scope, id] as const,
  counts: (scope: string) => ['counts', scope] as const,
  folders: (scope: string) => ['folders', scope] as const,
  tags: (scope: string) => ['tags', scope] as const,
  versions: (scope: string, id: string) => ['versions', scope, id] as const,
  prefs: (scope: string) => ['prefs', scope] as const,
};

export interface ListFilters {
  view: NoteView;
  search: string;
  folderId: string | null;
  uncategorized: boolean;
  tagId: string | null;
  sort: NoteSort;
  createdAfter?: string;
  updatedAfter?: string;
}

export function useNoteList(f: ListFilters) {
  const { repo } = useRepo();
  const q = {
    view: f.view,
    search: f.search.trim() || undefined,
    folderId: f.folderId,
    uncategorized: f.uncategorized,
    tagId: f.tagId,
    sort: f.sort,
    createdAfter: f.createdAfter,
    updatedAfter: f.updatedAfter,
  };
  return useInfiniteQuery({
    queryKey: qk.noteList(repo.scope, q),
    queryFn: ({ pageParam }) => repo.listNotes({ ...q, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    placeholderData: (prev) => prev,
    refetchInterval: repo.kind === 'cloud' ? 60_000 : false,
  });
}

export function useNote(id: string | undefined) {
  const { repo } = useRepo();
  return useQuery({
    queryKey: qk.note(repo.scope, id ?? ''),
    queryFn: () => repo.getNote(id!),
    enabled: !!id,
    // The editor owns the live text; avoid background refetches clobbering it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useCounts() {
  const { repo } = useRepo();
  return useQuery({ queryKey: qk.counts(repo.scope), queryFn: () => repo.getCounts() });
}

export function useFolders() {
  const { repo } = useRepo();
  return useQuery({ queryKey: qk.folders(repo.scope), queryFn: () => repo.listFolders() });
}

export function useTags() {
  const { repo } = useRepo();
  return useQuery({ queryKey: qk.tags(repo.scope), queryFn: () => repo.listTags() });
}

/** Refresh lists + counters after any change. */
export function useRefreshLists() {
  const { repo } = useRepo();
  const qc = useQueryClient();
  return useCallback(async () => {
    const keys = [qk.notes(repo.scope), qk.counts(repo.scope), ['dashboard', repo.scope]];
    // Cancel even the initial empty fetch; otherwise it can resolve after a mutation and cache stale results.
    await Promise.all(keys.map((queryKey) => qc.cancelQueries({ queryKey })));
    await Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
  }, [qc, repo.scope]);
}

export function useFolderMutations() {
  const { repo } = useRepo();
  const qc = useQueryClient();
  const refresh = useRefreshLists();
  const after = () => {
    void qc.invalidateQueries({ queryKey: qk.folders(repo.scope) });
    refresh();
  };
  const onError = (e: unknown) => toast.error(errorMessage(e));
  return {
    create: useMutation({
      mutationFn: (name: string) => repo.createFolder(name),
      onSuccess: after,
    }),
    rename: useMutation({
      mutationFn: (v: { id: string; name: string }) => repo.renameFolder(v.id, v.name),
      onSuccess: after,
    }),
    remove: useMutation({
      mutationFn: (id: string) => repo.deleteFolder(id),
      onSuccess: () => {
        after();
        void qc.invalidateQueries({ queryKey: ['note', repo.scope] });
      },
      onError,
    }),
  };
}

export function useTagMutations() {
  const { repo } = useRepo();
  const qc = useQueryClient();
  const refresh = useRefreshLists();
  const after = () => {
    void qc.invalidateQueries({ queryKey: qk.tags(repo.scope) });
    refresh();
  };
  return {
    create: useMutation({ mutationFn: (name: string) => repo.createTag(name), onSuccess: after }),
    rename: useMutation({
      mutationFn: (v: { id: string; name: string }) => repo.renameTag(v.id, v.name),
      onSuccess: after,
    }),
    remove: useMutation({
      mutationFn: (id: string) => repo.deleteTag(id),
      onSuccess: () => {
        after();
        void qc.invalidateQueries({ queryKey: ['note', repo.scope] });
      },
      onError: (e) => toast.error(errorMessage(e)),
    }),
  };
}

export function usePreferences() {
  const { repo } = useRepo();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.prefs(repo.scope),
    queryFn: () => repo.getPreferences(),
    staleTime: 5 * 60_000,
  });
  const prefs = query.data ?? DEFAULT_PREFERENCES;

  useEffect(() => {
    if (query.data) setThemePreference(query.data.theme);
  }, [query.data]);

  const save = useMutation({
    mutationFn: (next: Preferences) => repo.savePreferences(next),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: qk.prefs(repo.scope) });
      const prev = qc.getQueryData<Preferences>(qk.prefs(repo.scope));
      qc.setQueryData(qk.prefs(repo.scope), next);
      setThemePreference(next.theme);
      return { prev };
    },
    onError: (e, _n, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(qk.prefs(repo.scope), ctx.prev);
        setThemePreference(ctx.prev.theme);
      }
      toast.error(errorMessage(e, 'Could not save your settings.'));
    },
  });
  return {
    prefs,
    loading: query.isLoading,
    update: (patch: Partial<Preferences>) => save.mutate({ ...prefs, ...patch }),
  };
}

export function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const subscribeOnline = (notify: () => void) => {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
};
const onlineSnapshot = () => typeof navigator === 'undefined' || navigator.onLine;
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, onlineSnapshot, () => true);
}

export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;
  const [match, setMatch] = useState(get);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
