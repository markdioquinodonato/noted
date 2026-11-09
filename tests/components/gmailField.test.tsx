import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GmailField, gmailError, isValidGmail, useGmailField } from '@/features/auth/gmail';

describe('gmailError', () => {
  it('accepts valid Gmail addresses', () => {
    for (const v of [
      'juan@gmail.com',
      'Juan.Dela.Cruz@Gmail.com',
      ' maria+notes@gmail.com ',
      'x@gmail.com',
    ]) {
      expect(gmailError(v, { final: true }), v).toBeNull();
      expect(isValidGmail(v), v).toBe(true);
    }
  });

  it('flags a non-Gmail domain immediately while typing', () => {
    expect(gmailError('juan@y', { final: false })).toMatch(/Only Gmail/);
    expect(gmailError('juan@yahoo.com', { final: false })).toMatch(/Only Gmail/);
    expect(gmailError('juan@gmail.co', { final: true })).toMatch(/Only Gmail/);
    expect(gmailError('juan@gmail.com.ph', { final: false })).toMatch(/Only Gmail/);
    expect(gmailError('juan@googlemail.com', { final: false })).toMatch(/Only Gmail/);
  });

  it('stays quiet while a Gmail address is still being typed, but not after leaving the field', () => {
    for (const v of ['j', 'juan', 'juan@', 'juan@gm', 'juan@gmail.']) {
      expect(gmailError(v, { final: false }), v).toBeNull();
    }
    expect(gmailError('juan', { final: true })).toMatch(/Only Gmail/);
    expect(gmailError('juan@gm', { final: true })).toMatch(/Only Gmail/);
    expect(gmailError('', { final: true })).toMatch(/Enter your Gmail/);
  });

  it('flags malformed input immediately', () => {
    expect(gmailError('ju an', { final: false })).toMatch(/spaces/);
    expect(gmailError('ju#an', { final: false })).toMatch(/letters, numbers/);
    expect(gmailError('.juan', { final: false })).toMatch(/start with a period/);
    expect(gmailError('ju..an', { final: false })).toMatch(/two periods/);
    expect(gmailError('a@b@gmail.com', { final: false })).toMatch(/one "@"/);
    expect(gmailError('juan.@gmail.com', { final: false })).toMatch(/end with a period/);
    expect(gmailError('@gmail.com', { final: false })).toMatch(/before "@gmail.com"/);
  });
});

function Harness() {
  const field = useGmailField();
  return (
    <form>
      <GmailField field={field} />
      <input aria-label="next field" />
    </form>
  );
}

describe('GmailField', () => {
  it('turns red with a message as soon as a non-Gmail domain is typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Email');
    await user.type(input, 'juan@gm');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();

    await user.clear(input);
    await user.type(input, 'juan@y');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(/Only Gmail addresses/);
    expect(input).toHaveAccessibleDescription(/Only Gmail addresses/);
  });

  it('clears the error once corrected to a Gmail address', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Email');
    await user.type(input, 'juan@yahoo.com');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await user.clear(input);
    await user.type(input, 'juan@gmail.com');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.getByText(/Gmail addresses only/)).toBeInTheDocument();
  });

  it('flags an incomplete address when the person leaves the field', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Email');
    await user.type(input, 'juan');
    expect(input).not.toHaveAttribute('aria-invalid');
    await user.click(screen.getByLabelText('next field'));
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
