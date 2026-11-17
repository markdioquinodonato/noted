import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';

export function useCentralAdminMembership(enabled = true) {
  const { client, session, user } = useAuth();
  const access = useQuery({
    queryKey: ['workspace-admin-membership', user?.id, session?.expires_at, user?.last_sign_in_at],
    enabled: enabled && Boolean(client && session && user),
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      if (!client) return false;
      const { data, error } = await client
        .rpc('admin_access', { p_scope: 'central' })
        .abortSignal(signal);
      if (error) throw error;
      // Membership only controls the link. AdminGate independently verifies MFA
      // and authorization before rendering any administrative data or actions.
      return data?.member === true;
    },
  });

  return Boolean(user && access.isSuccess && access.data === true);
}
