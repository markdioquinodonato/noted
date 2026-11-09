import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  confirmError,
  passwordError,
  PasswordPairFields,
  usePasswordPair,
} from '@/features/auth/passwordFields';
import { latestEntry } from '@/app/useUpdateCheck';

describe('password rules', () => {
  it('reports short passwords only once final', () => {
    expect(passwordError('abc', { final: false })).toBeNull();
    expect(passwordError('abc', { final: true })).toMatch(/at least 8/);
    expect(passwordError('', { final: true })).toMatch(/Enter a password/);
    expect(passwordError('abcdefgh', { final: true })).toBeNull();
  });

  it('reports a mismatch on the first wrong character, not while correctly typing', () => {
    expect(confirmError('secret123', 'sec', { final: false })).toBeNull();
    expect(confirmError('secret123', 'sex', { final: false })).toMatch(/do not match/);
    expect(confirmError('secret123', 'secret1234', { final: false })).toMatch(/do not match/);
    expect(confirmError('secret123', 'secret123', { final: false })).toBeNull();
    expect(confirmError('secret123', 'secret', { final: true })).toMatch(/do not match/);
    expect(confirmError('secret123', '', { final: true })).toMatch(/Re-enter/);
  });
});

function Harness() {
  const pair = usePasswordPair();
  return (
    <form>
      <PasswordPairFields pair={pair} />
      <input aria-label="elsewhere" />
    </form>
  );
}

describe('PasswordPairFields', () => {
  it('turns the confirm field red immediately on mismatch and green when matching', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const pw = screen.getByLabelText('Password');
    const confirm = screen.getByLabelText('Confirm password');
    await user.type(pw, 'secret123');
    await user.type(confirm, 'secr');
    expect(confirm).not.toHaveAttribute('aria-invalid');
    await user.type(confirm, 'X');
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.');

    await user.clear(confirm);
    await user.type(confirm, 'secret123');
    expect(confirm).not.toHaveAttribute('aria-invalid');
    expect(screen.getByText('Passwords match.')).toBeInTheDocument();

    // Editing the password afterwards re-flags the mismatch right away.
    await user.type(pw, '!');
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
  });

  it('counts down the characters still needed, and flags a short password on leaving the field', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const pw = screen.getByLabelText('Password');
    await user.type(pw, 'abc');
    expect(screen.getByText(/5 more characters needed/)).toBeInTheDocument();
    expect(pw).not.toHaveAttribute('aria-invalid');
    await user.click(screen.getByLabelText('elsewhere'));
    expect(pw).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('update check', () => {
  it('extracts the deployed entry script from index.html', async () => {
    const html = '<script type="module" crossorigin src="/assets/index-AbC123_x.js"></script>';
    const fake = (async () => new Response(html, { status: 200 })) as unknown as typeof fetch;
    expect(await latestEntry(fake)).toBe('/assets/index-AbC123_x.js');
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await latestEntry(failing)).toBeNull();
  });
});
