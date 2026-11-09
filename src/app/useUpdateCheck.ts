import { useEffect } from 'react';
import { toast } from 'sonner';
import { flushAllSavers } from '@/features/notes/noteSaver';
import { isDesktopApp } from '@/lib/platform';

const ENTRY_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;
const CHECK_EVERY_MS = 5 * 60 * 1000;

/** The hashed entry script of the build currently running in this tab. */
function currentEntry(): string | null {
  const script = document.querySelector<HTMLScriptElement>(
    'script[type="module"][src*="/assets/index-"]',
  );
  return script?.getAttribute('src')?.match(ENTRY_RE)?.[0] ?? null;
}

/** Fetches index.html (bypassing caches) and returns its entry script, or null on failure. */
export async function latestEntry(fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetcher(`/?v=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'text/html' },
    });
    if (!res.ok) return null;
    return (await res.text()).match(ENTRY_RE)?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Tabs left open across a deploy keep running the old code. Periodically (and
 * whenever the tab regains focus) compare the deployed entry script with the
 * running one, and offer a reload. Unsaved edits are flushed first; they are
 * also mirrored to local drafts, so nothing is lost either way.
 */
export function useUpdateCheck() {
  useEffect(() => {
    if (!import.meta.env.PROD || isDesktopApp()) return;
    const running = currentEntry();
    if (!running) return;
    let notified = false;
    let inFlight = false;

    const check = async () => {
      if (notified || inFlight || document.visibilityState !== 'visible' || !navigator.onLine)
        return;
      inFlight = true;
      const deployed = await latestEntry();
      inFlight = false;
      if (!deployed || deployed === running) return;
      notified = true;
      toast('A new version of Noted is available.', {
        id: 'app-update',
        duration: Infinity,
        description: 'Reload to get the latest fixes. Your notes are saved.',
        action: {
          label: 'Reload',
          onClick: () => {
            void flushAllSavers().finally(() => window.location.reload());
          },
        },
      });
    };

    const timer = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => void check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    void check();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);
}
