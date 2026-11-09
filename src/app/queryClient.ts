import { QueryClient } from '@tanstack/react-query';
export function createQueryClient(kind: 'local' | 'cloud' = 'cloud') {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: kind === 'local' ? 'always' : 'offlineFirst',
        retry: (count, err) => count < 2 && (err as Error)?.name !== 'NotFoundError',
        refetchOnWindowFocus: true,
        staleTime: 15000,
      },
      mutations: { retry: 0, networkMode: kind === 'local' ? 'always' : 'online' },
    },
  });
}
