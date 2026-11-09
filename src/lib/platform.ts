/**
 * Runtime platform helpers. The same React app runs on the web (Vercel) and
 * inside the Tauri desktop shell; desktop-only modules are imported lazily so
 * the web bundle never depends on Tauri APIs being present.
 */

/** True when running inside the Noted desktop app (Tauri webview). */
export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export type DesktopOS = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'other';

/** Best-effort OS detection for the visitor's browser (never used for CPU architecture). */
export function detectOS(
  nav: Pick<Navigator, 'userAgent' | 'platform'> & {
    userAgentData?: { platform?: string };
  } = navigator,
): DesktopOS {
  const hint =
    `${nav.userAgentData?.platform ?? ''} ${nav.platform ?? ''} ${nav.userAgent ?? ''}`.toLowerCase();
  if (/android/.test(hint)) return 'android';
  if (/iphone|ipad|ipod/.test(hint)) return 'ios';
  if (/win/.test(hint)) return 'windows';
  if (/mac/.test(hint)) return 'macos';
  if (/linux|x11|cros/.test(hint)) return 'linux';
  return 'other';
}

/**
 * Apple Silicon vs Intel, only when the browser actually reports it
 * (Chromium's User-Agent Client Hints). Safari/Firefox return 'unknown'.
 */
export async function detectMacArchitecture(): Promise<'arm' | 'x86' | 'unknown'> {
  try {
    const data = (
      navigator as Navigator & {
        userAgentData?: {
          getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string }>;
        };
      }
    ).userAgentData;
    const values = await data?.getHighEntropyValues?.(['architecture']);
    if (values?.architecture === 'arm') return 'arm';
    if (values?.architecture === 'x86') return 'x86';
  } catch {
    /* not available */
  }
  return 'unknown';
}
