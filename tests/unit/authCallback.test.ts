import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient, Session } from '@supabase/supabase-js';
import {
  completeAuthCallback,
  confirmEmailSignIn,
  emailConfirmationFromUrl,
} from '@/features/auth/authCallback';
const session = { user: { id: 'test-owner' }, access_token: 'test-only' } as Session;
describe('email callback compatibility without relaxing normal PKCE', () => {
  it('reads a one-time email hash without needing the requesting browser PKCE storage', async () => {
    const verifyOtp = vi.fn(async () => ({ data: { session }, error: null }));
    const client = { auth: { verifyOtp } } as unknown as SupabaseClient;
    const hash = emailConfirmationFromUrl(
      new URL('https://noted.test/auth/callback?next=/admin#token_hash=test-hash&type=email'),
    );
    expect(hash).toBe('test-hash');
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(await confirmEmailSignIn(client, hash!)).toBe(session);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'test-hash', type: 'email' });
  });
  it('does not accept arbitrary OTP actions and never accepts failed verification', async () => {
    expect(
      emailConfirmationFromUrl(
        new URL('https://noted.test/auth/callback#token_hash=test&type=recovery'),
      ),
    ).toBeNull();
    const client = {
      auth: {
        verifyOtp: vi.fn(async () => ({
          data: { session: null },
          error: { code: 'otp_expired' },
        })),
      },
    } as unknown as SupabaseClient;
    await expect(confirmEmailSignIn(client, 'used-hash')).rejects.toThrow(
      'expired or was already used',
    );
  });
  it('validates fragment sessions through Supabase and removes credentials from the address', async () => {
    const clear = vi.fn(),
      setSession = vi.fn(async () => ({ data: { session }, error: null }));
    const client = { auth: { setSession } } as unknown as SupabaseClient;
    const url = new URL(
      'https://noted.test/auth/callback?next=/admin#access_token=test-access&refresh_token=test-refresh&type=invite',
    );
    expect(await completeAuthCallback(client, url, clear)).toBe(session);
    expect(setSession).toHaveBeenCalledWith({
      access_token: 'test-access',
      refresh_token: 'test-refresh',
    });
    expect(clear).toHaveBeenCalledOnce();
  });
  it('does not accept an invalid fragment token as an authenticated session', async () => {
    const client = {
      auth: {
        setSession: vi.fn(async () => ({ data: { session: null }, error: new Error('invalid') })),
      },
    } as unknown as SupabaseClient;
    await expect(
      completeAuthCallback(
        client,
        new URL('https://noted.test/auth/callback#access_token=invalid&refresh_token=invalid'),
        vi.fn(),
      ),
    ).rejects.toThrow('could not be verified');
  });
  it('shares a single exchange across duplicate callback effects', async () => {
    const setSession = vi.fn(async () => ({ data: { session }, error: null })),
      client = { auth: { setSession } } as unknown as SupabaseClient;
    const url = new URL('https://noted.test/auth/callback#access_token=test&refresh_token=test');
    const first = completeAuthCallback(client, url, vi.fn()),
      second = completeAuthCallback(client, url, vi.fn());
    expect(first).toBe(second);
    await first;
    expect(setSession).toHaveBeenCalledOnce();
  });
  it('retains the existing PKCE code exchange path', async () => {
    const exchange = vi.fn(async () => ({ data: { session }, error: null }));
    const client = {
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null } })),
        exchangeCodeForSession: exchange,
      },
    } as unknown as SupabaseClient;
    expect(
      await completeAuthCallback(
        client,
        new URL('https://noted.test/auth/callback?code=test-pkce'),
        vi.fn(),
      ),
    ).toBe(session);
    expect(exchange).toHaveBeenCalledWith('test-pkce');
  });
});
