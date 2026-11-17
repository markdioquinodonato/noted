import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import { AdminGate } from '@/features/admin/AdminGate';
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  listFactors: vi.fn(),
  challengeAndVerify: vi.fn(),
  enroll: vi.fn(),
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'test-admin', email: 'confirmed@example.test' },
    client: { rpc: mock.rpc, auth: { mfa: mock } },
  }),
}));
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<AdminGate />}>
            <Route index element={<h1>Protected metrics</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it('does not mount protected administrator UI for a normal account', async () => {
  mock.rpc.mockResolvedValue({ data: { member: false, authorized: false }, error: null });
  mount();
  expect(await screen.findByText('Administrator access required')).toBeInTheDocument();
  expect(screen.queryByText('Protected metrics')).not.toBeInTheDocument();
});
it('requires a successful server authorization recheck after MFA verification', async () => {
  let verified = false;
  mock.rpc.mockImplementation(async () => ({
    data: { member: true, authorized: verified },
    error: null,
  }));
  mock.listFactors.mockResolvedValue({
    data: { totp: [{ id: 'factor', status: 'verified' }] },
    error: null,
  });
  mock.challengeAndVerify.mockImplementation(async () => {
    verified = true;
    return { data: {}, error: null };
  });
  mount();
  const code = await screen.findByLabelText('Six-digit authenticator code');
  expect(screen.queryByText('Protected metrics')).not.toBeInTheDocument();
  await userEvent.type(code, '123456');
  await userEvent.click(screen.getByRole('button', { name: 'Verify and open dashboard' }));
  expect(await screen.findByText('Protected metrics')).toBeInTheDocument();
  expect(mock.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor', code: '123456' });
});
