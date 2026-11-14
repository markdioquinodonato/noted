/**
 * Desktop installers come from the latest *published* GitHub Release of the
 * repository configured in VITE_RELEASES_REPO ("owner/name"). GitHub's
 * /releases/latest endpoint never returns drafts or pre-releases, so a build
 * that failed (and therefore was never published) is never offered.
 */

export type InstallerKey = 'windows-exe' | 'windows-msi' | 'mac-arm' | 'mac-intel' | 'android-apk';

export interface Installer {
  key: InstallerKey;
  name: string;
  url: string;
  size: number;
}

export interface ReleaseInfo {
  version: string;
  publishedAt: string | null;
  pageUrl: string;
  installers: Partial<Record<InstallerKey, Installer>>;
}

interface GitHubAsset {
  name: string;
  size: number;
  state: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  published_at: string | null;
  assets: GitHubAsset[];
}

export function releasesRepo(): string | null {
  const repo = (import.meta.env.VITE_RELEASES_REPO as string | undefined)?.trim();
  return repo && /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : null;
}

/** Tauri's default bundle names, plus the friendlier names used for workflow artifacts. */
const PATTERNS: Record<InstallerKey, RegExp[]> = {
  'windows-exe': [/_x64-setup\.exe$/i, /^Noted-Setup-Windows-x64\.exe$/i],
  'windows-msi': [/_x64_[a-z-]+\.msi$/i, /^Noted-Windows-x64\.msi$/i],
  'mac-arm': [/_aarch64\.dmg$/i, /^Noted-macOS-AppleSilicon\.dmg$/i],
  'mac-intel': [/_x64\.dmg$/i, /^Noted-macOS-Intel\.dmg$/i],
  'android-apk': [/^Noted-Android\.apk$/i, /\.apk$/i],
};

/** True when release version `latest` (e.g. "1.2.0") is newer than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split(/[.+-]/).slice(0, 3).map(Number);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function pickInstallers(repo: string, assets: GitHubAsset[]): ReleaseInfo['installers'] {
  const prefix = `https://github.com/${repo}/releases/download/`;
  const usable = assets.filter(
    (a) =>
      a.state === 'uploaded' &&
      a.size > 0 &&
      !a.name.endsWith('.sig') &&
      a.browser_download_url.startsWith(prefix),
  );
  const out: ReleaseInfo['installers'] = {};
  for (const key of Object.keys(PATTERNS) as InstallerKey[]) {
    const asset = usable.find((a) => PATTERNS[key].some((re) => re.test(a.name)));
    if (asset)
      out[key] = { key, name: asset.name, url: asset.browser_download_url, size: asset.size };
  }
  return out;
}

/** Returns null when there is no published release yet. Throws on network/API errors. */
export async function fetchLatestRelease(
  repo: string,
  fetcher: typeof fetch = fetch,
): Promise<ReleaseInfo | null> {
  const res = await fetcher(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub responded with ${res.status}`);
  const release = (await res.json()) as GitHubRelease;
  if (release.draft || release.prerelease) return null;
  return {
    version: release.tag_name.replace(/^v/, ''),
    publishedAt: release.published_at,
    pageUrl: release.html_url,
    installers: pickInstallers(repo, release.assets ?? []),
  };
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
