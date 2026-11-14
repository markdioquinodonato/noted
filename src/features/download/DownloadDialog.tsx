import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Globe, Laptop, Monitor, RefreshCw, ShieldAlert, Smartphone } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert } from '@/components/common';
import { detectMacArchitecture, detectOS, isDesktopApp, type DesktopOS } from '@/lib/platform';
import { cn } from '@/lib/utils';
import {
  fetchLatestRelease,
  formatSize,
  releasesRepo,
  type Installer,
  type ReleaseInfo,
} from './releases';

const OPEN_EVENT = 'noted:open-download';

/** Opens the Download Noted dialog from anywhere (sidebar, settings, welcome page). */
export function openDownloadDialog() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Mounted once in the app shell. Not rendered inside the desktop app itself. */
export function DownloadDialogHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  if (isDesktopApp()) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        {open && <DownloadContent onClose={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function useLatestRelease() {
  const repo = releasesRepo();
  return useQuery({
    queryKey: ['latest-release', repo],
    queryFn: () => (repo ? fetchLatestRelease(repo) : Promise.resolve(null)),
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

function DownloadContent({ onClose }: { onClose: () => void }) {
  const release = useLatestRelease();
  const [os] = useState<DesktopOS>(() => detectOS());
  const [macArch, setMacArch] = useState<'arm' | 'x86' | 'unknown'>('unknown');
  useEffect(() => {
    if (os === 'macos') void detectMacArchitecture().then(setMacArch);
  }, [os]);

  const info: ReleaseInfo | null | undefined = release.data;
  const desktopAvailable =
    !!info && Object.keys(info.installers).some((key) => key !== 'android-apk');

  const androidCard = (
    <PlatformCard
      key="android"
      title="Android"
      subtitle="Android 7.0 or later"
      icon={<Smartphone />}
      recommended={os === 'android'}
      loading={release.isLoading}
      version={info?.version}
    >
      <InstallerButton
        installer={info?.installers['android-apk']}
        label="Download for Android"
        format=".apk app"
        loading={release.isLoading}
        primary
      />
      <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
        After downloading, open the file and tap Install. If asked, allow your browser to install
        apps (“Install unknown apps”).
      </p>
    </PlatformCard>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-xl">Download Noted</DialogTitle>
        <DialogDescription>
          Take your notes anywhere. Get Noted for Android, Windows or macOS — it works offline and
          syncs with your free account.
        </DialogDescription>
      </DialogHeader>

      {release.isError && (
        <Alert tone="error">
          We couldn’t check for the latest installers. Check your connection and try again.{' '}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => void release.refetch()}
          >
            Retry
          </button>
        </Alert>
      )}
      {os === 'ios' && (
        <Alert>
          Noted isn’t available on the App Store yet. On iPhone and iPad, keep using Noted in your
          browser — tip: Share → Add to Home Screen.
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2" data-testid="download-options">
        {os === 'android' && androidCard}
        <PlatformCard
          title="Windows"
          subtitle="Windows 10 and 11 (64-bit)"
          icon={<Monitor />}
          recommended={os === 'windows'}
          loading={release.isLoading}
          version={info?.version}
        >
          <InstallerButton
            installer={info?.installers['windows-exe']}
            label="Download for Windows"
            format=".exe installer"
            loading={release.isLoading}
            primary
          />
          {info?.installers['windows-msi'] && (
            <a
              href={info.installers['windows-msi'].url}
              className="block text-center text-xs font-medium text-primary hover:underline"
            >
              Prefer an MSI package? Download .msi (
              {formatSize(info.installers['windows-msi'].size)})
            </a>
          )}
        </PlatformCard>

        <PlatformCard
          title="macOS"
          subtitle="macOS 10.15 or later"
          icon={<Laptop />}
          recommended={os === 'macos'}
          loading={release.isLoading}
          version={info?.version}
        >
          <InstallerButton
            installer={info?.installers['mac-arm']}
            label="Download for Apple Silicon"
            format=".dmg · M1, M2, M3, M4 and later"
            loading={release.isLoading}
            primary={os !== 'macos' || macArch !== 'x86'}
          />
          <InstallerButton
            installer={info?.installers['mac-intel']}
            label="Download for Intel Mac"
            format=".dmg · Intel processors"
            loading={release.isLoading}
            primary={os === 'macos' && macArch === 'x86'}
          />
          <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
            Not sure? Open the Apple menu → About This Mac. “Chip: Apple M…” means Apple Silicon;
            “Processor: Intel” means Intel.
          </p>
        </PlatformCard>
        {os !== 'android' && androidCard}
      </div>

      {desktopAvailable && (
        <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          These installers are not code-signed yet. Windows may show a SmartScreen notice (choose
          “More info → Run anyway”), and on macOS right-click Noted in Applications and choose Open
          the first time.
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center">
        {info && (
          <a
            href={info.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline sm:mr-auto"
          >
            Version {info.version} · release notes
          </a>
        )}
        {!info && !release.isLoading && !release.isError && (
          <span className="text-xs text-muted-foreground sm:mr-auto">
            Installers haven’t been published yet.
          </span>
        )}
        {release.isFetching && !release.isLoading && (
          <RefreshCw
            className="size-3.5 animate-spin text-muted-foreground sm:mr-auto"
            aria-label="Checking"
          />
        )}
        <Button variant="outline" onClick={onClose}>
          <Globe /> Continue in Browser
        </Button>
      </div>
    </>
  );
}

function PlatformCard({
  title,
  subtitle,
  icon,
  recommended,
  loading,
  version,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  recommended: boolean;
  loading: boolean;
  version?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={`${title} download`}
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-card p-4',
        recommended && 'border-primary/60 ring-2 ring-primary/20',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-primary [&_svg]:size-5">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 font-semibold">
            {title}
            {recommended && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] font-medium text-primary">
                Recommended for this device
              </span>
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            {subtitle}
            {loading ? '' : version ? ` · v${version}` : ''}
          </p>
        </div>
      </div>
      <div className="mt-auto space-y-2">{children}</div>
    </section>
  );
}

function InstallerButton({
  installer,
  label,
  format,
  loading,
  primary,
}: {
  installer?: Installer;
  label: string;
  format: string;
  loading: boolean;
  primary?: boolean;
}) {
  if (loading) return <Skeleton className="h-12 w-full rounded-lg" />;
  if (!installer)
    return (
      <div>
        <Button
          variant="outline"
          className="h-auto w-full flex-col gap-0 py-2"
          disabled
          aria-disabled="true"
        >
          <span>{label}</span>
          <span className="text-[0.7rem] font-normal">
            Coming Soon — Installer Not Available Yet
          </span>
        </Button>
      </div>
    );
  return (
    <Button
      asChild
      variant={primary ? 'default' : 'outline'}
      className="h-auto w-full flex-col gap-0 py-2"
    >
      <a href={installer.url} download={installer.name} data-installer={installer.key}>
        <span className="flex items-center gap-1.5">
          <Download className="size-4" aria-hidden="true" /> {label}
        </span>
        <span className="text-[0.7rem] font-normal opacity-80">
          {format} · {formatSize(installer.size)}
        </span>
      </a>
    </Button>
  );
}
