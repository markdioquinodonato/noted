import type { Session, SupabaseClient } from '@supabase/supabase-js';

export function emailConfirmationFromUrl(url: URL): string | null {
  const fragment = new URLSearchParams(url.hash.slice(1));
  // New email templates keep the one-time hash out of HTTP request logs.
  // Accept the documented query form too, without accepting arbitrary OTP types.
  const token = fragment.get('token_hash') ?? url.searchParams.get('token_hash');
  const type = fragment.get('type') ?? url.searchParams.get('type');
  return token && token.length <= 512 && type === 'email' ? token : null;
}

export async function confirmEmailSignIn(client: SupabaseClient, tokenHash: string) {
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
  if (error || !data.session)
    throw new Error('This sign-in link has expired or was already used. Request a new email.');
  return data.session;
}

// Share the same exchange across StrictMode effects. Credentials are never keys,
// logs or persisted here; Supabase owns normal session storage/validation.
const exchanges = new WeakMap<SupabaseClient, Promise<Session | null>>();
export function completeAuthCallback(
  client: SupabaseClient,
  url: URL,
  clearFragment: () => void,
): Promise<Session | null> {
  const pending = exchanges.get(client);
  if (pending) return pending;
  const task = (async () => {
    const hash = new URLSearchParams(url.hash.slice(1));
    if (url.searchParams.has('error') || hash.has('error'))
      throw new Error('This link is invalid or expired.');
    const accessToken = hash.get('access_token'),
      refreshToken = hash.get('refresh_token');
    if (accessToken && refreshToken) {
      // Admin invitations and server-sent email links use a fragment session;
      // keep PKCE for ordinary signup/reset flows. setSession validates this
      // session with Supabase rather than trusting decoded browser claims.
      clearFragment();
      const { data, error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error)
        throw new Error('The email session could not be verified. Request a new sign-in link.');
      return data.session;
    }
    const { data } = await client.auth.getSession();
    if (data.session) return data.session;
    const code = url.searchParams.get('code');
    if (code) {
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw new Error('This link is invalid or expired.');
      return data.session;
    }
    return null;
  })();
  exchanges.set(client, task);
  void task.finally(() => exchanges.delete(client)).catch(() => undefined);
  return task;
}
