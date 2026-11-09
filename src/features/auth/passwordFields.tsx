import { useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const MIN_PASSWORD_LENGTH = 8;

/** Error for the new-password field. Length is only enforced once the field is "final". */
export function passwordError(password: string, { final }: { final: boolean }): string | null {
  if (!password) return final ? 'Enter a password.' : null;
  if (password.length < MIN_PASSWORD_LENGTH)
    return final ? `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.` : null;
  return null;
}

/**
 * Error for the confirm field. A mismatch is reported the moment a typed
 * character differs from the password (or the password is edited afterwards);
 * a correct-but-unfinished confirmation is only reported once the field is "final".
 */
export function confirmError(
  password: string,
  confirm: string,
  { final }: { final: boolean },
): string | null {
  if (!confirm) return final ? 'Re-enter your password to confirm it.' : null;
  if (!password.startsWith(confirm) || confirm.length > password.length)
    return 'Passwords do not match.';
  if (confirm !== password) return final ? 'Passwords do not match.' : null;
  return null;
}

export function usePasswordPair() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwTouched, setPwTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const pwError = passwordError(password, { final: pwTouched });
  const cfError = confirmError(password, confirm, { final: confirmTouched });
  return {
    password,
    confirm,
    pwError,
    cfError,
    matches: !!confirm && confirm === password && password.length >= MIN_PASSWORD_LENGTH,
    setPassword,
    setConfirm,
    touchPassword: () => password && setPwTouched(true),
    touchConfirm: () => confirm && setConfirmTouched(true),
    /** Marks both fields final; returns true when there is an error. */
    validate: () => {
      setPwTouched(true);
      setConfirmTouched(true);
      return !!(
        passwordError(password, { final: true }) || confirmError(password, confirm, { final: true })
      );
    },
  };
}

function FieldMessage({
  id,
  error,
  children,
}: {
  id: string;
  error: string | null;
  children?: React.ReactNode;
}) {
  if (error)
    return (
      <p
        id={id}
        role="alert"
        className="flex items-start gap-1.5 text-xs font-medium text-destructive"
      >
        <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        {error}
      </p>
    );
  return children ? (
    <p id={id} className="text-xs text-muted-foreground">
      {children}
    </p>
  ) : null;
}

const invalidTint = 'aria-invalid:bg-destructive/5';

export function PasswordPairFields({
  pair,
  passwordLabel = 'Password',
  confirmLabel = 'Confirm password',
  autoFocus,
}: {
  pair: ReturnType<typeof usePasswordPair>;
  passwordLabel?: string;
  confirmLabel?: string;
  autoFocus?: boolean;
}) {
  const remaining = MIN_PASSWORD_LENGTH - pair.password.length;
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="password">{passwordLabel}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={pair.password}
          onChange={(e) => pair.setPassword(e.target.value)}
          onBlur={pair.touchPassword}
          aria-invalid={pair.pwError ? true : undefined}
          aria-describedby="password-msg"
          className={invalidTint}
          autoFocus={autoFocus}
          required
        />
        <FieldMessage id="password-msg" error={pair.pwError}>
          {pair.password && remaining > 0
            ? `${remaining} more character${remaining === 1 ? '' : 's'} needed (at least ${MIN_PASSWORD_LENGTH}).`
            : `At least ${MIN_PASSWORD_LENGTH} characters.`}
        </FieldMessage>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">{confirmLabel}</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          value={pair.confirm}
          onChange={(e) => pair.setConfirm(e.target.value)}
          onBlur={pair.touchConfirm}
          aria-invalid={pair.cfError ? true : undefined}
          aria-describedby="confirm-msg"
          className={invalidTint}
          required
        />
        {pair.cfError ? (
          <FieldMessage id="confirm-msg" error={pair.cfError} />
        ) : pair.matches ? (
          <p
            id="confirm-msg"
            className="flex items-center gap-1.5 text-xs font-medium text-success"
          >
            <CheckCircle2 className="size-3.5" aria-hidden="true" /> Passwords match.
          </p>
        ) : null}
      </div>
    </>
  );
}
