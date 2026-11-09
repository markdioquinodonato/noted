/** Remembers that the visitor chose to continue as a guest, and post-auth redirects. */
const MODE_KEY = 'noted:mode';
const NEXT_KEY = 'noted:post-auth-next';

function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

export const guestMode = {
  isChosen: () => safeGet(MODE_KEY) === 'guest',
  choose: () => safeSet(MODE_KEY, 'guest'),
  clear: () => safeSet(MODE_KEY, null),
};

/** Only allow same-origin, path-only redirects (prevents open redirects). */
export function sanitizeNext(next: string | null | undefined, fallback = '/notes'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\'))
    return fallback;
  return next;
}

export const postAuthNext = {
  set: (next: string) => safeSet(NEXT_KEY, sanitizeNext(next)),
  take: (): string | null => {
    const v = safeGet(NEXT_KEY);
    safeSet(NEXT_KEY, null);
    return v ? sanitizeNext(v) : null;
  },
};
