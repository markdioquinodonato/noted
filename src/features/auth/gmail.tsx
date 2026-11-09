import { useId, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Noted accounts are restricted to Gmail addresses (also enforced in the database). */
export const GMAIL_DOMAIN = 'gmail.com';

const LOCAL_ALLOWED = /^[a-z0-9.+]*$/i;
const GMAIL_RE = /^(?!.*\.\.)[a-z0-9](?:[a-z0-9.+]{0,62}[a-z0-9])?@gmail\.com$/i;

export const GMAIL_ONLY_MESSAGE = 'Only Gmail addresses are allowed (example: juan@gmail.com).';

/** Normalised form used for submission. */
export function normalizeGmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidGmail(value: string): boolean {
  return GMAIL_RE.test(value.trim());
}

/**
 * Validation message for an email field, or null when there is nothing to report.
 *
 * `final: false` is used while the person is typing: it flags a problem the
 * moment the text can no longer become a Gmail address (wrong domain after "@",
 * spaces, disallowed characters), but stays quiet for an address that is still
 * being typed, like "juan" or "juan@gm".
 * `final: true` (on blur / submit) requires a complete, valid Gmail address.
 */
export function gmailError(raw: string, { final }: { final: boolean }): string | null {
  const value = raw.trim();
  if (!value) return final ? 'Enter your Gmail address.' : null;
  if (/\s/.test(value)) return 'Email addresses cannot contain spaces.';

  const at = value.indexOf('@');
  if (at !== value.lastIndexOf('@')) return 'An email address can only contain one "@".';

  const local = at === -1 ? value : value.slice(0, at);
  if (!LOCAL_ALLOWED.test(local))
    return 'Gmail addresses can only use letters, numbers, periods (.) and plus (+).';
  if (local.startsWith('.')) return 'A Gmail address cannot start with a period.';
  if (local.includes('..')) return 'A Gmail address cannot contain two periods in a row.';

  if (at === -1) return final ? GMAIL_ONLY_MESSAGE : null;
  if (!local) return 'Enter the part before "@gmail.com".';
  if (local.endsWith('.')) return 'The part before "@" cannot end with a period.';

  const domain = value.slice(at + 1).toLowerCase();
  // Any domain that can no longer turn into "gmail.com" is rejected immediately.
  if (!GMAIL_DOMAIN.startsWith(domain)) return GMAIL_ONLY_MESSAGE;
  if (domain !== GMAIL_DOMAIN) return final ? GMAIL_ONLY_MESSAGE : null;

  return GMAIL_RE.test(value) ? null : 'Enter a valid Gmail address.';
}

/** Hook: live + on-blur Gmail validation for a single field. */
export function useGmailField(initial = '') {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const error = gmailError(value, { final: touched });
  return {
    value,
    setValue,
    error,
    /** Marks the field as final and returns the error to show (if any). */
    validate: () => {
      setTouched(true);
      return gmailError(value, { final: true });
    },
    reset: () => {
      setValue('');
      setTouched(false);
    },
    bind: {
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value),
      onBlur: () => {
        if (value.trim()) setTouched(true);
      },
    },
  };
}

/** Labelled email input that turns red with an inline message as soon as the address is not Gmail. */
export function GmailField({
  field,
  label = 'Email',
  autoFocus,
  id,
  placeholder = 'yourname@gmail.com',
}: {
  field: ReturnType<typeof useGmailField>;
  label?: string;
  autoFocus?: boolean;
  id?: string;
  placeholder?: string;
}) {
  const autoId = useId();
  const inputId = id ?? `email-${autoId}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        id={inputId}
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={placeholder}
        required
        autoFocus={autoFocus}
        aria-invalid={field.error ? true : undefined}
        className="aria-invalid:bg-destructive/5 aria-invalid:text-destructive"
        aria-describedby={field.error ? errorId : hintId}
        {...field.bind}
      />
      {field.error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-xs font-medium text-destructive"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {field.error}
        </p>
      ) : (
        <p id={hintId} className="text-xs text-muted-foreground">
          Gmail addresses only (@gmail.com).
        </p>
      )}
    </div>
  );
}
