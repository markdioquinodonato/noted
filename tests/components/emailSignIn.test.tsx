import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { LoginPage } from '@/features/auth/pages';
const mock = vi.hoisted(() => ({
  signInWithOtp: vi.fn(async () => ({ error: null })),
  signIn: vi.fn(),
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    configured: true,
    user: null,
    signIn: mock.signIn,
    resendConfirmation: vi.fn(),
    client: { auth: { signInWithOtp: mock.signInWithOtp } },
  }),
  authErrorMessage: () => 'Could not send email.',
}));
vi.mock('@/lib/supabase', () => ({
  requestEmailSignIn: mock.signInWithOtp,
  siteUrl: () => 'https://noted.test',
  supabase: null,
}));
it('requests an existing-account email sign-in without a password', async () => {
  render(
    <MemoryRouter initialEntries={['/login?next=%2Fadmin']}>
      <LoginPage />
    </MemoryRouter>,
  );
  await userEvent.type(screen.getByLabelText('Email'), 'testowner@gmail.com');
  await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
  expect(mock.signInWithOtp).toHaveBeenCalledWith(
    'testowner@gmail.com',
    'https://noted.test/auth/callback?next=%2Fadmin',
  );
  expect(await screen.findByText(/A fresh sign-in email was requested/)).toBeInTheDocument();
  expect(mock.signIn).not.toHaveBeenCalled();
});
