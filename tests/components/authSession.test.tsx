import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { Session, SupabaseClient, AuthChangeEvent } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { RepositoryProvider, useRepo } from '@/app/RepositoryProvider';
import { offlineCache } from '@/data/offlineCache';

const A = '11111111-1111-4111-8111-111111111111',
  B = '22222222-2222-4222-8222-222222222222';
const session = (id: string) =>
  ({
    user: { id, email: `${id}@example.test` },
    access_token: 'test-only-token',
    refresh_token: 'test-only-refresh',
    expires_in: 3600,
    token_type: 'bearer',
  }) as Session;
/** Only a test double; application authentication always uses the real Supabase client. */
function testAuth(initial: Session | null) {
  let current = initial,
    callback: ((event: AuthChangeEvent, s: Session | null) => void) | undefined;
  const emit = (event: AuthChangeEvent, s: Session | null) => {
    current = s;
    callback?.(event, s);
  };
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: current }, error: null })),
    onAuthStateChange: vi.fn((cb: typeof callback) => {
      callback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signOut: vi.fn(async (_opts?: unknown) => {
      emit('SIGNED_OUT', null);
      return { error: null as Error | null };
    }),
    signInWithPassword: vi.fn(async () => {
      emit('SIGNED_IN', session(A));
      return { error: null };
    }),
  };
  return { client: { auth } as unknown as SupabaseClient, auth, emit };
}
function Probe() {
  const auth = useAuth(),
    { repo } = useRepo(),
    cache = useQueryClient(),
    [error, setError] = useState(''),
    [, tick] = useState(0);
  return (
    <>
      <p>
        Storage: {repo.kind}; identity: {auth.user?.id ?? 'guest'}
      </p>
      <p>Cached value: {cache.getQueryData<string>(['sentinel']) ?? 'empty'}</p>
      <button
        onClick={() => {
          cache.setQueryData(['sentinel'], `private-${auth.user?.id}`);
          tick((n) => n + 1);
        }}
      >
        Cache account content
      </button>
      <button
        onClick={() => {
          void auth.signOut().catch((e) => setError(e.message));
        }}
      >
        Sign out
      </button>
      <button
        onClick={() => {
          void auth.signIn(' alice@example.test ', 'password123').catch((e) => setError(e.message));
        }}
      >
        Sign in
      </button>
      <p role="status">{error}</p>
    </>
  );
}
function mount(client: SupabaseClient) {
  return render(
    <AuthProvider client={client}>
      <RepositoryProvider>
        <Probe />
      </RepositoryProvider>
    </AuthProvider>,
  );
}
describe('account and guest isolation', () => {
  it('replaces query caches on sign out and on user changes', async () => {
    const client = testAuth(session(A));
    mount(client.client);
    await screen.findByText(`Storage: cloud; identity: ${A}`);
    await userEvent.click(screen.getByText('Cache account content'));
    expect(screen.getByText(`Cached value: private-${A}`)).toBeInTheDocument();
    await act(async () => client.emit('SIGNED_IN', session(B)));
    expect(await screen.findByText(`Storage: cloud; identity: ${B}`)).toBeInTheDocument();
    expect(screen.getByText('Cached value: empty')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Cache account content'));
    await userEvent.click(screen.getByText('Sign out'));
    expect(await screen.findByText('Storage: local; identity: guest')).toBeInTheDocument();
    expect(screen.getByText('Cached value: empty')).toBeInTheDocument();
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('does not switch to guest or report success if the sign-out request fails', async () => {
    const client = testAuth(session(A));
    client.auth.signOut.mockImplementation(async () => ({ error: new Error('network failed') }));
    mount(client.client);
    await screen.findByText(`Storage: cloud; identity: ${A}`);
    await userEvent.click(screen.getByText('Sign out'));
    expect(
      await screen.findByText('Could not sign out. Check your connection and try again.'),
    ).toBeInTheDocument();
    expect(screen.getByText(`Storage: cloud; identity: ${A}`)).toBeInTheDocument();
  });
  it('handles a failed session restore and still permits real local notes', async () => {
    const client = testAuth(null);
    client.auth.getSession.mockRejectedValue(new Error('offline'));
    mount(client.client);
    expect(await screen.findByText('Storage: local; identity: guest')).toBeInTheDocument();
  });
  it('ignores a stale startup session when an auth event has already selected another account', async () => {
    const client = testAuth(null);
    let resolve!: (v: { data: { session: Session | null }; error: null }) => void;
    client.auth.getSession.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    mount(client.client);
    await act(async () => client.emit('SIGNED_IN', session(B)));
    await screen.findByText(`Storage: cloud; identity: ${B}`);
    await act(async () => resolve({ data: { session: session(A) }, error: null }));
    expect(screen.getByText(`Storage: cloud; identity: ${B}`)).toBeInTheDocument();
  });
  it('blocks late account cache writes after sign out, and re-enables them only on reauthentication', async () => {
    const client = testAuth(session(A));
    mount(client.client);
    await screen.findByText(`Storage: cloud; identity: ${A}`);
    await offlineCache.write(A, 'secret', 'private');
    await userEvent.click(screen.getByText('Sign out'));
    await screen.findByText('Storage: local; identity: guest');
    await offlineCache.write(A, 'secret', 'late response');
    expect(await offlineCache.read(A, 'secret')).toBeUndefined();
    await userEvent.click(screen.getByText('Sign in'));
    await screen.findByText(`Storage: cloud; identity: ${A}`);
    await offlineCache.write(A, 'secret', 'new session');
    expect(await offlineCache.read(A, 'secret')).toBe('new session');
    await waitFor(() =>
      expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'alice@example.test',
        password: 'password123',
      }),
    );
  });
});
