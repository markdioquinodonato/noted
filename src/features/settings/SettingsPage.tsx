import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CloudUpload,
  Download,
  HardDrive,
  LogOut,
  Monitor,
  Moon,
  Sun,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, Spinner } from '@/components/common';
import { BrandLockup } from '@/components/BrandLogo';
import { useAuth } from '@/features/auth/AuthProvider';
import { useRepo } from '@/app/RepositoryProvider';
import { usePreferences } from '@/features/notes/hooks';
import { CloudSaveDialog } from '@/features/notes/CloudSaveDialog';
import { exportAllNotes } from '@/features/io/exportAll';
import { requestPersistentStorage } from '@/data/local/idb';
import { supabase } from '@/lib/supabase';
import { errorMessage, formatDateTime, plural } from '@/lib/format';
import { LIMITS, type Preferences } from '@/domain/types';
import { cn } from '@/lib/utils';
import { guestMode } from '@/lib/mode';
import { openDownloadDialog } from '@/features/download/DownloadDialog';
import { isDesktopApp } from '@/lib/platform';
import { MonitorDown, RefreshCw } from 'lucide-react';

function Section({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-6 rounded-xl border bg-card p-5 sm:p-6"
      aria-labelledby={`${id ?? title}-h`}
    >
      <h2 id={`${id ?? title}-h`} className="text-base font-semibold">
        {title}
      </h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div>
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const THEMES: { value: Preferences['theme']; label: string; icon: ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun /> },
  { value: 'dark', label: 'Dark', icon: <Moon /> },
  { value: 'system', label: 'System', icon: <Monitor /> },
];

export function SettingsPage() {
  const { user, signOut } = useAuth();
  const { repo } = useRepo();
  const { prefs, update } = usePreferences();
  const navigate = useNavigate();
  const location = useLocation();
  const [cloudOpen, setCloudOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [location.hash]);

  const exportAll = async () => {
    setExporting(true);
    try {
      const count = await exportAllNotes(repo);
      if (!count) toast.info('You have no notes to export yet.');
      else toast.success(`Exported ${plural(count, 'note')}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-full bg-muted/40">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/notes')}
          aria-label="Back to notes"
        >
          <ArrowLeft />
        </Button>
        <h1 className="text-base font-semibold">Settings</h1>
        <div className="flex-1" />
        <BrandLockup size={24} className="hidden sm:inline-flex" />
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:py-10">
        <Section title="Appearance">
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={prefs.theme === t.value}
                onClick={() => update({ theme: t.value })}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border p-3 text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-5',
                  prefs.theme === t.value
                    ? 'border-primary bg-accent text-accent-foreground'
                    : 'hover:bg-muted',
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Editor">
          <Row label="Font size" hint="Size of the note text while writing." htmlFor="font-size">
            <Select
              value={String(prefs.fontSize)}
              onValueChange={(v) => update({ fontSize: Number(v) })}
            >
              <SelectTrigger id="font-size" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[13, 14, 15, 16, 18, 20, 22, 24].map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}px{s === 16 ? ' (default)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row
            label="Autosave"
            hint="Save automatically shortly after you stop typing. When off, press Ctrl/⌘+S. Local draft backups are attempted even when autosave is off. Storage failures are shown in the editor."
            htmlFor="autosave"
          >
            <Switch
              id="autosave"
              checked={prefs.autosaveEnabled}
              onCheckedChange={(v) => update({ autosaveEnabled: v })}
            />
          </Row>
        </Section>

        {user ? <AccountSection /> : <GuestSection onCloud={() => setCloudOpen(true)} />}

        <DesktopSection />

        <Section title="Your data">
          <Row
            label="Export all notes"
            hint="Download every note (except Trash) as .txt files in a ZIP archive."
          >
            <Button variant="outline" onClick={() => void exportAll()} disabled={exporting}>
              {exporting ? <Spinner /> : <Download />} Export ZIP
            </Button>
          </Row>
          {user && (
            <Row
              label="Guest notes on this device"
              hint="Bring notes you wrote as a guest into this account."
            >
              <Button variant="outline" asChild>
                <Link to="/import">
                  <CloudUpload /> Import
                </Link>
              </Button>
            </Row>
          )}
        </Section>

        {user && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={async () => {
                try {
                  await signOut();
                  guestMode.clear();
                  navigate('/welcome', { replace: true });
                  toast.success('Logged out');
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              <LogOut /> Log out
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await signOut();
                  guestMode.choose();
                  navigate('/notes?dashboard=1', { replace: true });
                  toast.success('Signed out. Continuing in Guest Mode.');
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              Sign out &amp; continue as guest
            </Button>
          </div>
        )}
        <p className="pb-6 text-center text-xs text-muted-foreground">
          Noted · Smart Notepad · {user ? 'Cloud account' : 'Guest mode'} · storage:{' '}
          {repo.kind === 'cloud' ? 'Supabase' : 'IndexedDB'}
        </p>
      </main>
      <CloudSaveDialog open={cloudOpen} onOpenChange={setCloudOpen} />
    </div>
  );
}

function GuestSection({ onCloud }: { onCloud: () => void }) {
  const storage = useQuery({
    queryKey: ['storage-estimate'],
    queryFn: async () => {
      const persisted = (await navigator.storage?.persisted?.()) ?? false;
      return { persisted };
    },
  });
  return (
    <Section id="account" title="Guest mode" description="You’re using Noted without an account.">
      <Alert>
        <strong className="font-medium">
          Your notes are stored only in this browser on this device.
        </strong>{' '}
        They can be lost if you clear your browsing data, use private/incognito mode, or switch
        devices. Create a free account to keep them safe in the cloud.
      </Alert>
      <Row
        label="Protect local storage"
        hint={
          storage.data?.persisted
            ? 'The browser has agreed to keep your notes.'
            : 'Ask the browser not to evict your notes when space is low.'
        }
      >
        <Button
          variant="outline"
          disabled={storage.data?.persisted}
          onClick={async () => {
            const ok = await requestPersistentStorage();
            void storage.refetch();
            if (ok) toast.success('Local storage protected');
            else
              toast.info('Your browser declined. Consider creating an account to keep notes safe.');
          }}
        >
          <HardDrive /> {storage.data?.persisted ? 'Protected' : 'Protect'}
        </Button>
      </Row>
      <Button onClick={onCloud}>
        <CloudUpload /> Save my notes to cloud
      </Button>
    </Section>
  );
}

function AccountSection() {
  const { user } = useAuth();
  const profile = useQuery({
    queryKey: ['profile', user?.id],
    enabled: !!user && !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('profiles')
        .select('display_name, created_at')
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as { display_name: string | null; created_at: string } | null;
    },
  });
  return (
    <Section
      id="account"
      title="Account"
      description="Your notes are saved privately to the cloud and sync across your devices."
    >
      <DisplayNameForm
        key={profile.data?.display_name ?? ''}
        initial={profile.data?.display_name ?? ''}
        loading={profile.isLoading}
      />
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="font-medium break-all">{user?.email}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Member since</dt>
          <dd className="font-medium">
            {profile.data?.created_at ? formatDateTime(profile.data.created_at) : '—'}
          </dd>
        </div>
      </dl>
      <Row label="Password" hint="We’ll email you a secure link to set a new password.">
        <Button variant="outline" asChild>
          <Link to="/forgot-password">Change password</Link>
        </Button>
      </Row>
    </Section>
  );
}

function DisplayNameForm({ initial, loading }: { initial: string; loading: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);

  const saveName = async () => {
    setSaving(true);
    try {
      const value = name.trim().slice(0, LIMITS.displayNameMax) || null;
      const { error } = await supabase!
        .from('profiles')
        .update({ display_name: value })
        .eq('id', user!.id);
      if (error) throw error;
      await supabase!.auth.updateUser({ data: { display_name: value ?? '' } });
      void qc.invalidateQueries({ queryKey: ['profile', user?.id] });
      toast.success('Profile updated');
    } catch (e) {
      toast.error(errorMessage(e, 'Could not update your profile.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="display-name">Display name</Label>
      <div className="flex gap-2">
        <Input
          id="display-name"
          value={name}
          maxLength={LIMITS.displayNameMax}
          onChange={(e) => setName(e.target.value)}
          disabled={loading}
        />
        <Button onClick={() => void saveName()} disabled={saving || loading || name === initial}>
          {saving && <Spinner />} Save
        </Button>
      </div>
    </div>
  );
}

function DesktopSection() {
  const desktop = isDesktopApp();
  const version = useQuery({
    queryKey: ['app-version'],
    enabled: desktop,
    queryFn: async () => (await import('@tauri-apps/api/app')).getVersion(),
  });
  const [checking, setChecking] = useState(false);
  if (!desktop)
    return (
      <Section title="Desktop app" description="Use Noted as an app on your Windows PC or Mac.">
        <Row label="Noted for Windows & macOS" hint="Works offline and opens in its own window.">
          <Button variant="outline" onClick={openDownloadDialog}>
            <MonitorDown /> Download Noted
          </Button>
        </Row>
      </Section>
    );
  return (
    <Section
      title="App updates"
      description="Updates are verified with Noted’s signing key before installing."
    >
      <Row label="Installed version" hint={version.data ? `Noted ${version.data}` : 'Checking…'}>
        <Button
          variant="outline"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            try {
              const m = await import('@/desktop/desktop');
              await m.checkForUpdates({ silent: false });
            } finally {
              setChecking(false);
            }
          }}
        >
          {checking ? <Spinner /> : <RefreshCw />} Check for updates
        </Button>
      </Row>
    </Section>
  );
}
