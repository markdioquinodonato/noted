import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fetchLatestRelease, pickInstallers } from '@/features/download/releases';
import { DownloadDialogHost, openDownloadDialog } from '@/features/download/DownloadDialog';
import { detectOS } from '@/lib/platform';
import { act } from 'react';

const REPO = 'noted-ph/noted';
const asset = (
  name: string,
  extra: Partial<{ size: number; state: string; url: string }> = {},
) => ({
  name,
  size: extra.size ?? 5_000_000,
  state: extra.state ?? 'uploaded',
  browser_download_url: extra.url ?? `https://github.com/${REPO}/releases/download/v1.0.0/${name}`,
});

const tauriAssets = [
  asset('Noted_1.0.0_x64-setup.exe'),
  asset('Noted_1.0.0_x64-setup.exe.sig'),
  asset('Noted_1.0.0_x64_en-US.msi'),
  asset('Noted_1.0.0_aarch64.dmg'),
  asset('Noted_1.0.0_x64.dmg'),
  asset('Noted_aarch64.app.tar.gz'),
  asset('latest.json'),
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('release asset selection', () => {
  it('maps Tauri bundle names to each platform', () => {
    const picked = pickInstallers(REPO, tauriAssets);
    expect(picked['windows-exe']?.name).toBe('Noted_1.0.0_x64-setup.exe');
    expect(picked['windows-msi']?.name).toBe('Noted_1.0.0_x64_en-US.msi');
    expect(picked['mac-arm']?.name).toBe('Noted_1.0.0_aarch64.dmg');
    expect(picked['mac-intel']?.name).toBe('Noted_1.0.0_x64.dmg');
  });

  it('never offers incomplete, empty or off-repository files', () => {
    const picked = pickInstallers(REPO, [
      asset('Noted_1.0.0_x64-setup.exe', { state: 'starter' }),
      asset('Noted_1.0.0_aarch64.dmg', { size: 0 }),
      asset('Noted_1.0.0_x64.dmg', { url: 'https://evil.example/Noted_1.0.0_x64.dmg' }),
    ]);
    expect(picked).toEqual({});
  });

  it('treats "no release" (404) and drafts as unavailable', async () => {
    const notFound = vi.fn(async () => new Response('{}', { status: 404 }));
    expect(await fetchLatestRelease(REPO, notFound as unknown as typeof fetch)).toBeNull();
    const draft = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v1.0.0',
            draft: true,
            prerelease: false,
            html_url: '',
            published_at: null,
            assets: tauriAssets,
          }),
          {
            status: 200,
          },
        ),
    );
    expect(await fetchLatestRelease(REPO, draft as unknown as typeof fetch)).toBeNull();
    const broken = vi.fn(async () => new Response('rate limited', { status: 403 }));
    await expect(fetchLatestRelease(REPO, broken as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe('OS detection', () => {
  it('recognises common platforms', () => {
    expect(
      detectOS({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32' }),
    ).toBe('windows');
    expect(
      detectOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)', platform: 'MacIntel' }),
    ).toBe('macos');
    expect(
      detectOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', platform: 'iPhone' }),
    ).toBe('ios');
    expect(
      detectOS({ userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux armv8l' }),
    ).toBe('android');
  });
});

function renderHost() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DownloadDialogHost />
    </QueryClientProvider>,
  );
}

describe('Download Noted dialog', () => {
  it('shows "Coming Soon" and disabled buttons when no release is published', async () => {
    vi.stubEnv('VITE_RELEASES_REPO', REPO);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 })),
    );
    renderHost();
    act(() => openDownloadDialog());
    const dialog = await screen.findByRole('dialog', { name: 'Get Noted for Desktop' });
    await waitFor(() =>
      expect(within(dialog).getAllByText(/Coming Soon — Installer Not Available Yet/)).toHaveLength(
        3,
      ),
    );
    for (const b of within(dialog).getAllByRole('button', { name: /Coming Soon/ }))
      expect(b).toBeDisabled();
    expect(within(dialog).queryAllByRole('link', { name: /Download for/ })).toHaveLength(0);
  });

  it('links each platform to its real release asset', async () => {
    vi.stubEnv('VITE_RELEASES_REPO', REPO);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              tag_name: 'v1.2.3',
              draft: false,
              prerelease: false,
              html_url: `https://github.com/${REPO}/releases/tag/v1.2.3`,
              published_at: '2026-11-09T00:00:00Z',
              assets: tauriAssets,
            }),
            { status: 200 },
          ),
      ),
    );
    renderHost();
    act(() => openDownloadDialog());
    const dialog = await screen.findByRole('dialog');
    const win = await within(dialog).findByRole('link', { name: /Download for Windows/ });
    expect(win).toHaveAttribute(
      'href',
      `https://github.com/${REPO}/releases/download/v1.0.0/Noted_1.0.0_x64-setup.exe`,
    );
    expect(within(dialog).getByRole('link', { name: /Apple Silicon/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/_aarch64\.dmg$/),
    );
    expect(within(dialog).getByRole('link', { name: /Intel Mac/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/_x64\.dmg$/),
    );
    expect(within(dialog).getByText(/Version 1\.2\.3/)).toBeInTheDocument();
  });

  it('shows an error with retry when GitHub cannot be reached, and closes via Continue in Browser', async () => {
    vi.stubEnv('VITE_RELEASES_REPO', REPO);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const user = userEvent.setup();
    renderHost();
    act(() => openDownloadDialog());
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(
        /couldn’t check for the latest installers/i,
        {},
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Continue in Browser/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('is unavailable (Coming Soon) when no releases repository is configured', async () => {
    vi.stubEnv('VITE_RELEASES_REPO', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderHost();
    act(() => openDownloadDialog());
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getAllByText(/Coming Soon/)).toHaveLength(3));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
