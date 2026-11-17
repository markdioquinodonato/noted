import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('sends a real SDK email request without a browser-bound PKCE challenge or account creation', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test-auth.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-public-key');
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetcher);
  vi.resetModules();
  const { requestEmailSignIn } = await import('@/lib/supabase');
  await requestEmailSignIn('test@gmail.com', 'https://noted.test/auth/callback?next=/admin');
  const call = fetcher.mock.calls.find((args) => String(args[0]).includes('/otp'));
  expect(call).toBeDefined();
  const [address, options] = call! as unknown as [string, RequestInit];
  expect(address).toContain('redirect_to=');
  const body = JSON.parse(options.body as string);
  expect(body.email).toBe('test@gmail.com');
  expect(body.create_user).toBe(false);
  expect(body.code_challenge).toBeNull();
  expect(localStorage.getItem('noted-email-request-code-verifier')).toBeNull();
});

it('requests recovery without browser-bound PKCE and propagates provider email limits', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test-auth.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-public-key');
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          code: 'over_email_send_rate_limit',
          msg: 'Email rate limit exceeded',
        }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' },
        },
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  vi.resetModules();
  const { requestPasswordRecovery } = await import('@/lib/supabase');
  await expect(
    requestPasswordRecovery(
      'test@gmail.com',
      'https://noted.test/auth/callback?next=%2Freset-password',
    ),
  ).rejects.toMatchObject({
    status: 429,
    code: 'over_email_send_rate_limit',
  });
  const [address, options] = fetcher.mock.calls.find((args) =>
    String(args[0]).includes('/recover'),
  )!;
  expect(String(address)).toContain('redirect_to=');
  const body = JSON.parse(options!.body as string);
  expect(body.email).toBe('test@gmail.com');
  expect(body.code_challenge).toBeNull();
});
