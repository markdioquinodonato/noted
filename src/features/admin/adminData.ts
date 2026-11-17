import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import type {
  AdminSnapshot,
  Announcement,
  AlertInbox,
  Analytics,
  TranscriptionAggregate,
} from './types';

export function useAdminRpc<T>(name: string, args?: Record<string, unknown>, enabled = true) {
  const { client, user } = useAuth();
  return useQuery<T>({
    queryKey: ['admin', user?.id, name, args],
    enabled: enabled && !!client && !!user,
    staleTime: 60_000,
    gcTime: 120_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await client!.rpc(name, args).abortSignal(signal);
      if (error)
        throw new Error(
          error.code === '42501'
            ? 'Administrator access and a current MFA session are required.'
            : 'This data could not be loaded. Refresh to try again.',
        );
      return data as T;
    },
  });
}
export const useSnapshot = (enabled = true) =>
  useAdminRpc<AdminSnapshot>('admin_workspace_snapshot', undefined, enabled);
export const useAnalytics = (days: number) =>
  useAdminRpc<Analytics>('admin_analytics', { p_days: days });
export const useAlerts = (enabled = true) =>
  useAdminRpc<AlertInbox>('admin_alert_inbox', undefined, enabled);
export const useTranscription = () =>
  useAdminRpc<TranscriptionAggregate[]>('transcription_admin_stats');
export const useAnnouncements = () =>
  useAdminRpc<{
    items: Announcement[];
    history: { created_at: string; action: string; target: string }[];
  }>('admin_announcements');
