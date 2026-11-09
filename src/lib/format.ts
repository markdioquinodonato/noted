const rtf =
  typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;

export function formatRelative(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Math.round((t - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (!rtf) return new Date(iso).toLocaleString();
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(iso);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** Map any thrown value to a user-safe message (never leaks tokens or SQL). */
export function errorMessage(
  err: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (!err) return fallback;
  if (err instanceof Error) {
    if (
      err.name === 'ValidationError' ||
      err.name === 'DuplicateNameError' ||
      err.name === 'ConflictError' ||
      err.name === 'NotFoundError'
    )
      return err.message;
    if (/failed to fetch|network|load failed/i.test(err.message))
      return 'You appear to be offline. Check your connection and try again.';
    if (/jwt|session|token/i.test(err.message))
      return 'Your session has expired. Please sign in again.';
  }
  return fallback;
}
