import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ForgotPasswordPage, LoginPage } from '@/features/auth/pages';

const mock = vi.hoisted(() => ({
  reset: vi.fn(),
  user: null as null | { email: string },
}));
vi.mock('@/features/auth/AuthProvider', async (original) => ({
  ...(await original<typeof import('@/features/auth/AuthProvider')>()),
  useAuth: () => ({ configured: true, sendPasswordReset: mock.reset, user: mock.user }),
}));
beforeEach(() => {
  mock.reset.mockReset();
  mock.user = null;
});
afterEach(() => vi.useRealTimers());

it('reports the real email limit without claiming a reset email was sent or a one-minute fix', async () => {
  mock.reset.mockRejectedValue({
    code: 'over_email_send_rate_limit',
    message: 'Email rate limit exceeded',
  });
  const view = render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
  await userEvent.type(screen.getByLabelText('Email'), 'test@gmail.com');
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'waiting one minute may not be enough',
  );
  const button = screen.getByRole('button', { name: /Request another email in/ });
  expect(button).toBeDisabled();
  fireEvent.submit(button.closest('form')!);
  expect(mock.reset).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/a reset link is on its way/)).not.toBeInTheDocument();
  view.unmount();
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole('button', { name: /Request another email in/ })).toBeDisabled();
});

it('allows another manual attempt after the convenience cooldown without auto-sending emails', async () => {
  vi.useFakeTimers();
  localStorage.setItem('noted-auth-email-retry-after', String(Date.now() + 60000));
  render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole('button', { name: /Request another email in/ })).toBeDisabled();
  await act(async () => vi.advanceTimersByTime(60000));
  expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled();
  expect(mock.reset).not.toHaveBeenCalled();
});

it('lets an already signed-in account choose a password without another email request', () => {
  mock.user = { email: 'test@gmail.com' };
  render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'Choose a new password' })).toHaveAttribute(
    'href',
    '/reset-password',
  );
  expect(screen.queryByRole('button', { name: 'Send reset link' })).not.toBeInTheDocument();
  expect(mock.reset).not.toHaveBeenCalled();
});
