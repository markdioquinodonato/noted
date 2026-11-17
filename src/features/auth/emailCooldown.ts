import { useEffect, useState } from 'react';

const key = 'noted-auth-email-retry-after';
const changed = 'noted-auth-email-cooldown';
function deadline() {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/** Convenience throttle only; Supabase remains the authoritative rate limiter.
 * Share a timestamp (no email/identity) across email-request pages and tabs.
 */
export function useEmailCooldown() {
  const [until, setUntil] = useState(deadline);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => {
      setUntil(deadline());
      setNow(Date.now());
    };
    window.addEventListener(changed, update);
    window.addEventListener('storage', update);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener(changed, update);
      window.removeEventListener('storage', update);
      window.clearInterval(timer);
    };
  }, []);
  return {
    seconds: Math.max(0, Math.ceil((until - now) / 1000)),
    start() {
      const next = Date.now() + 60000;
      setUntil(next);
      setNow(Date.now());
      try {
        localStorage.setItem(key, String(next));
      } catch {
        // Local storage failure must not block account recovery.
      }
      window.dispatchEvent(new Event(changed));
    },
  };
}
