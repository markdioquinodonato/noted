import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthCallbackPage } from '@/features/auth/pages';

const mock = vi.hoisted(() => ({
  verifyOtp: vi.fn(async () => ({
    data: { session: { user: { id: 'owner-test' } } },
    error: null,
  })),
  user: null as null | { email: string },
}));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { verifyOtp: mock.verifyOtp } } }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: mock.user }),
  authErrorMessage: () => 'Authentication failed.',
}));
afterEach(() => {
  window.history.replaceState(null, '', '/');
  mock.user = null;
  vi.clearAllMocks();
});

it('does not consume an email on mount or StrictMode replay, then confirms and keeps the destination', async () => {
  window.history.replaceState(
    null,
    '',
    '/auth/callback?next=%2Fadmin#token_hash=test-only&type=email',
  );
  render(
    <StrictMode>
      <MemoryRouter initialEntries={['/auth/callback?next=%2Fadmin']}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/admin" element={<p>Protected destination</p>} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
  expect(screen.getByRole('button', { name: 'Confirm sign-in' })).toBeEnabled();
  expect(mock.verifyOtp).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('');
  await userEvent.click(screen.getByRole('button', { name: 'Confirm sign-in' }));
  expect(await screen.findByText('Protected destination')).toBeInTheDocument();
  expect(mock.verifyOtp).toHaveBeenCalledExactlyOnceWith({
    token_hash: 'test-only',
    type: 'email',
  });
});

it('offers the existing account when an old link fails without treating that link as valid', async () => {
  mock.user = { email: 'owner-test@gmail.com' };
  window.history.replaceState(null, '', '/auth/callback?error=access_denied&next=%2Fadmin');
  render(
    <MemoryRouter initialEntries={['/auth/callback?error=access_denied&next=%2Fadmin']}>
      <AuthCallbackPage />
    </MemoryRouter>,
  );
  expect(await screen.findByText(/This link is invalid/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Continue with this account' })).toHaveAttribute(
    'href',
    '/admin',
  );
  expect(mock.verifyOtp).not.toHaveBeenCalled();
});
