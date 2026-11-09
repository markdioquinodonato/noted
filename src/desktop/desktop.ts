/**
 * Desktop (Tauri) integration. Only imported when running inside the desktop
 * app, so none of this code — or the Tauri plugin packages — is executed on
 * the website.
 */
import { toast } from 'sonner';

/** Open http(s)/mailto links in the user's default browser, never inside the app window. */
function interceptExternalLinks() {
  document.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = (event.target as Element | null)?.closest?.(
        'a[href]',
      ) as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute('download')) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      const external =
        (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') &&
        url.origin !== window.location.origin;
      if (!external) return;
      event.preventDefault();
      void openExternal(url.href);
    },
    true,
  );
}

export async function openExternal(href: string) {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(href);
  } catch {
    toast.error('Could not open the link in your browser.');
  }
}

/** Native "Save as" dialog + write. Returns false if the user cancelled. */
export async function saveFileNative(blob: Blob, filename: string): Promise<boolean> {
  const [{ save }, { writeFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ]);
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  const path = await save({
    defaultPath: filename,
    filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
  });
  if (!path) return false;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return true;
}

export type UpdateCheckResult = 'none' | 'available' | 'error';

let checking = false;

/**
 * Checks the signed GitHub Releases feed. Updates are only installed after the
 * user confirms, and their signature is verified by the updater against the
 * public key compiled into the app.
 */
export async function checkForUpdates({ silent }: { silent: boolean }): Promise<UpdateCheckResult> {
  if (checking) return 'none';
  checking = true;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      if (!silent) toast.success('You have the latest version of Noted.');
      return 'none';
    }
    toast(`Noted ${update.version} is available.`, {
      id: 'desktop-update',
      duration: Infinity,
      description:
        update.body?.slice(0, 160) || 'Install now? Noted will restart. Your notes are saved.',
      action: {
        label: 'Install & restart',
        onClick: () => void installUpdate(update),
      },
    });
    return 'available';
  } catch {
    if (!silent) toast.error('Could not check for updates. Check your connection and try again.');
    return 'error';
  } finally {
    checking = false;
  }
}

async function installUpdate(
  update: Awaited<ReturnType<typeof import('@tauri-apps/plugin-updater').check>>,
) {
  if (!update) return;
  const id = toast.loading('Downloading update…');
  try {
    const { flushAllSavers } = await import('@/features/notes/noteSaver');
    await flushAllSavers();
    let total = 0;
    let done = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') total = event.data.contentLength ?? 0;
      if (event.event === 'Progress') {
        done += event.data.chunkLength;
        if (total)
          toast.loading(`Downloading update… ${Math.round((done / total) * 100)}%`, { id });
      }
    });
    toast.success('Update installed. Restarting…', { id });
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch {
    toast.error('The update could not be installed. Please try again later.', { id });
  }
}

export function initDesktop() {
  document.documentElement.dataset.desktop = 'true';
  interceptExternalLinks();
  // Quiet background check shortly after launch (no message when offline or up to date).
  window.setTimeout(() => {
    if (navigator.onLine) void checkForUpdates({ silent: true });
  }, 8000);
}
