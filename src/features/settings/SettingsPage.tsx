import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  ChevronDown,
  Cloud,
  CloudUpload,
  Download,
  FileUp,
  HardDrive,
  Info,
  Monitor,
  Moon,
  NotebookPen,
  Palette,
  RefreshCw,
  ShieldCheck,
  Sun,
  UserRound,
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
import { BrandMark } from '@/components/BrandLogo';
import { AccountMenu } from '@/features/auth/AccountMenu';
import { useAuth } from '@/features/auth/AuthProvider';
import { useRepo } from '@/app/RepositoryProvider';
import { useOnline, usePreferences } from '@/features/notes/hooks';
import {
  NOTE_LAYOUT_OPTIONS,
  useNotesLayout,
  useSidebarPreference,
  type NotesLayout,
} from '@/features/notes/workspacePreferences';
import { CloudSaveDialog } from '@/features/notes/CloudSaveDialog';
import { exportAllNotes } from '@/features/io/exportAll';
import { useDocumentImport } from '@/features/io/useDocumentImport';
import { requestPersistentStorage } from '@/data/local/idb';
import { errorMessage, formatDateTime, plural } from '@/lib/format';
import { LIMITS } from '@/domain/types';
import { isDesktopApp } from '@/lib/platform';
import { releasesRepo } from '@/features/download/releases';
import { telemetryEnabled, setTelemetryEnabled } from '@/features/admin/telemetry';
import './settings.css';

const CATEGORIES = [
  { id: 'account', title: 'Account', icon: UserRound },
  { id: 'appearance', title: 'Appearance', icon: Palette },
  { id: 'editor', title: 'Notes & Editor', icon: NotebookPen },
  { id: 'storage', title: 'Sync & Storage', icon: Cloud },
  { id: 'notifications', title: 'Notifications', icon: Bell },
  { id: 'privacy', title: 'Privacy & Security', icon: ShieldCheck },
  { id: 'about', title: 'About Noted', icon: Info },
] as const;

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="noted-settings-group">
      <header>
        <h3>{title}</h3>
      </header>
      <div className="noted-settings-rows">{children}</div>
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
    <div className="noted-settings-row">
      <div className="noted-settings-copy">
        {htmlFor ? <Label htmlFor={htmlFor}>{label}</Label> : <p>{label}</p>}
        {hint && <p className="noted-settings-hint">{hint}</p>}
      </div>
      <div className="noted-settings-control">{children}</div>
    </div>
  );
}

function Status({ children }: { children: ReactNode }) {
  return <span className="noted-settings-status">{children}</span>;
}

export function SettingsPage() {
  const { user } = useAuth();
  const preferences = usePreferences();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [cloudOpen, setCloudOpen] = useState(false);
  const documents = useDocumentImport();
  const requested = params.get('section') ?? location.hash.slice(1);
  const category = CATEGORIES.find(({ id }) => id === requested) ?? CATEGORIES[1];
  const CategoryIcon = category.icon;

  return (
    <div className="noted-settings">
      <header className="noted-settings-header">
        <div className="noted-settings-bar">
          <Button variant="ghost" size="icon" aria-label="Back to notes" asChild>
            <Link to="/notes">
              <ArrowLeft aria-hidden="true" />
            </Link>
          </Button>
          <div className="noted-settings-title">
            <BrandMark size={24} />
            <h1>Settings</h1>
          </div>
          <AccountMenu onImport={documents.open} onCloudSave={() => setCloudOpen(true)} />
        </div>
      </header>

      <main className="noted-settings-shell">
        <nav aria-label="Settings categories" className="noted-settings-nav">
          {CATEGORIES.map(({ id, title, icon: Icon }) => (
            <Link
              key={id}
              to={id === 'appearance' ? '/settings' : '/settings?section=' + id}
              aria-current={category.id === id ? 'page' : undefined}
            >
              <Icon aria-hidden="true" />
              <span>{title}</span>
            </Link>
          ))}
        </nav>
        <div className="noted-settings-mobile-nav">
          <Label htmlFor="settings-category" className="sr-only">
            Settings category
          </Label>
          <select
            id="settings-category"
            value={category.id}
            onChange={(event) => setParams({ section: event.target.value })}
          >
            {CATEGORIES.map(({ id, title }) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" />
        </div>

        <section className="noted-settings-panel" aria-labelledby="settings-category-heading">
          <div className="noted-settings-heading">
            <CategoryIcon aria-hidden="true" />
            <h2 id="settings-category-heading">{category.title}</h2>
            <span role="status" className="noted-settings-feedback">
              {preferences.saving ? 'Saving…' : null}
            </span>
          </div>
          {category.id === 'account' &&
            (user ? (
              <AccountPanel />
            ) : (
              <Group title="Guest Mode">
                <Row
                  label="Local account"
                  hint="Your notes stay in this browser on this device. Use the profile menu to sign in or create an account."
                >
                  <Status>Guest</Status>
                </Row>
              </Group>
            ))}
          {category.id === 'appearance' && <AppearancePanel {...preferences} />}
          {category.id === 'editor' && <EditorPanel {...preferences} />}
          {category.id === 'storage' && (
            <StoragePanel
              importing={documents.busy}
              onImport={documents.open}
              onCloud={() => setCloudOpen(true)}
            />
          )}
          {category.id === 'notifications' && <NotificationsPanel />}
          {category.id === 'privacy' && <PrivacyPanel />}
          {category.id === 'about' && <AboutPanel />}
        </section>
      </main>
      {documents.input}
      {cloudOpen && <CloudSaveDialog open={cloudOpen} onOpenChange={setCloudOpen} />}
    </div>
  );
}

type PreferenceControls = Pick<
  ReturnType<typeof usePreferences>,
  'prefs' | 'update' | 'loading' | 'saving'
>;

function AppearancePanel({ prefs, update, loading }: PreferenceControls) {
  const { layout, setLayout } = useNotesLayout();
  const { collapsed, setCollapsed } = useSidebarPreference();
  return (
    <>
      <Group title="Theme">
        <fieldset className="noted-settings-themes">
          <legend className="sr-only">Theme</legend>
          {THEMES.map(({ value, label, icon: Icon }) => (
            <label key={value}>
              <input
                type="radio"
                name="noted-theme"
                value={value}
                checked={prefs.theme === value}
                disabled={loading}
                onChange={() => update({ theme: value })}
              />
              <span>
                <Icon aria-hidden="true" />
                {label}
              </span>
            </label>
          ))}
        </fieldset>
      </Group>
      <Group title="Notes workspace">
        <Row
          label="Default notes layout"
          hint="Saved for your current account or Guest Mode on this device."
          htmlFor="notes-layout"
        >
          <Select value={layout} onValueChange={(value) => setLayout(value as NotesLayout)}>
            <SelectTrigger id="notes-layout" className="noted-settings-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOTE_LAYOUT_OPTIONS.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row
          label="Compact desktop sidebar"
          hint="Show navigation as icons on wide screens."
          htmlFor="compact-sidebar"
        >
          <Switch id="compact-sidebar" checked={collapsed} onCheckedChange={setCollapsed} />
        </Row>
      </Group>
    </>
  );
}

function EditorPanel({ prefs, update, loading, saving }: PreferenceControls) {
  return (
    <Group title="Writing">
      <Row label="Font size" hint="Size of the note text while writing." htmlFor="font-size">
        <Select
          value={String(prefs.fontSize)}
          onValueChange={(value) => update({ fontSize: Number(value) })}
          disabled={loading || saving}
        >
          <SelectTrigger id="font-size" className="noted-settings-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[13, 14, 15, 16, 18, 20, 22, 24].map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}px{size === 16 ? ' (default)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row
        label="Autosave"
        hint="Save shortly after you stop typing. Ctrl/⌘+S saves manually, and Done finishes pending saves."
        htmlFor="autosave"
      >
        <Switch
          id="autosave"
          checked={prefs.autosaveEnabled}
          disabled={loading || saving}
          onCheckedChange={(autosaveEnabled) => update({ autosaveEnabled })}
        />
      </Row>
    </Group>
  );
}

function AccountPanel() {
  const { user, client } = useAuth();
  const profile = useQuery({
    queryKey: ['profile', user?.id],
    enabled: Boolean(client && user),
    queryFn: async () => {
      const { data, error } = await client!
        .from('profiles')
        .select('display_name, created_at')
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as { display_name: string | null; created_at: string } | null;
    },
  });
  const metadataName = user?.user_metadata?.display_name;
  const fallbackName = typeof metadataName === 'string' ? metadataName : '';
  const name = profile.data ? (profile.data.display_name ?? '') : fallbackName;
  const memberSince = profile.data?.created_at ?? user?.created_at;
  return (
    <>
      <Group title="My Profile">
        {profile.isError && <Alert tone="error">Could not load your profile.</Alert>}
        <DisplayNameForm key={name} initial={name} loading={profile.isLoading} />
        <Row label="Email" hint={user?.email}>
          <Status>{user?.email_confirmed_at ? 'Verified' : 'Unverified'}</Status>
        </Row>
        <Row label="Member since">
          <Status>{memberSince ? formatDateTime(memberSince) : 'Unavailable'}</Status>
        </Row>
      </Group>
      <Group title="Password and security">
        <Row label="Password" hint="Choose a new password for your signed-in account.">
          <Button variant="outline" asChild>
            <Link to="/reset-password">Change password</Link>
          </Button>
        </Row>
      </Group>
    </>
  );
}

function DisplayNameForm({ initial, loading }: { initial: string; loading: boolean }) {
  const { user, client } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const value = name.trim().slice(0, LIMITS.displayNameMax);

  const save = async () => {
    if (!user || !client || saving) return;
    setSaving(true);
    try {
      const { error } = await client
        .from('profiles')
        .update({ display_name: value || null })
        .eq('id', user.id);
      if (error) throw error;
      const { error: metadataError } = await client.auth.updateUser({
        data: { display_name: value },
      });
      await qc.invalidateQueries({ queryKey: ['profile', user.id] });
      if (metadataError) {
        toast.info('Profile saved. Your avatar label could not refresh.');
      } else {
        toast.success('Profile updated.');
      }
    } catch (error) {
      toast.error(errorMessage(error, 'Could not update your profile.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="noted-settings-row"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="noted-settings-copy">
        <Label htmlFor="display-name">Display name</Label>
        <p className="noted-settings-hint">Used to identify your profile in Noted.</p>
      </div>
      <div className="noted-settings-name">
        <Input
          id="display-name"
          value={name}
          maxLength={LIMITS.displayNameMax}
          disabled={loading || saving}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" disabled={loading || saving || value === initial}>
          {saving && <Spinner />} Save
        </Button>
      </div>
    </form>
  );
}

function StoragePanel({
  importing,
  onImport,
  onCloud,
}: {
  importing: boolean;
  onImport: () => void;
  onCloud: () => void;
}) {
  const { repo } = useRepo();
  const online = useOnline();
  const cloud = repo.kind === 'cloud';
  const [exporting, setExporting] = useState(false);
  const [protecting, setProtecting] = useState(false);
  const storage = useQuery({
    queryKey: ['storage-estimate'],
    enabled: !cloud,
    queryFn: async () => (await navigator.storage?.persisted?.()) ?? false,
  });

  const exportAll = async () => {
    setExporting(true);
    try {
      const count = await exportAllNotes(repo);
      if (count) toast.success('Exported ' + plural(count, 'note'));
      else toast.info('You have no notes to export yet.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Group title={cloud ? 'Cloud account' : 'Local storage'}>
        <Row
          label={cloud ? 'Cloud synchronization' : 'Guest notes'}
          hint={
            cloud
              ? 'The editor shows save status for each note. Pending edits sync when the connection returns.'
              : 'Guest notes and edits are saved in this browser on this device.'
          }
        >
          <Status>{cloud ? (online ? 'Online' : 'Offline') : 'On this device'}</Status>
        </Row>
        {cloud ? (
          <Row
            label="Guest notes on this device"
            hint="Transfer local guest notes to this account."
          >
            <Button variant="outline" asChild>
              <Link to="/import">
                <CloudUpload /> Import guest notes
              </Link>
            </Button>
          </Row>
        ) : (
          <>
            <Row
              label="Protect local storage"
              hint="Ask your browser to keep notes when storage space runs low."
            >
              <Button
                variant="outline"
                disabled={Boolean(storage.data) || protecting}
                onClick={async () => {
                  setProtecting(true);
                  try {
                    const protectedStorage = await requestPersistentStorage();
                    await storage.refetch();
                    if (protectedStorage) toast.success('Local storage protected');
                    else toast.info('The browser declined your request.');
                  } finally {
                    setProtecting(false);
                  }
                }}
              >
                {protecting ? <Spinner /> : <HardDrive />}
                {storage.data ? 'Protected' : 'Protect'}
              </Button>
            </Row>
            <Row label="Sync across devices" hint="Move guest notes into your cloud account.">
              <Button variant="outline" onClick={onCloud}>
                <CloudUpload /> Save my notes to cloud
              </Button>
            </Row>
          </>
        )}
      </Group>
      <Group title="Import and export">
        <Row label="Import note files" hint="Add notes from TXT, Markdown, DOCX or readable PDF.">
          <Button variant="outline" onClick={onImport} disabled={importing}>
            {importing ? <Spinner /> : <FileUp />} Import files
          </Button>
        </Row>
        <Row
          label="Export all notes"
          hint="Download a ZIP of note text, including archived notes. Trash and attachments are excluded."
        >
          <Button variant="outline" onClick={() => void exportAll()} disabled={exporting}>
            {exporting ? <Spinner /> : <Download />} Export ZIP
          </Button>
        </Row>
      </Group>
    </>
  );
}

const notificationPermission = () =>
  typeof Notification === 'undefined' ? 'unavailable' : Notification.permission;

function NotificationsPanel() {
  const [permission, setPermission] = useState(notificationPermission);
  const [requesting, setRequesting] = useState(false);
  useEffect(() => {
    const refresh = () => setPermission(notificationPermission());
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const request = async () => {
    setRequesting(true);
    try {
      setPermission(await Notification.requestPermission());
    } catch (error) {
      toast.error(errorMessage(error, 'Could not request notification access.'));
    } finally {
      setRequesting(false);
    }
  };
  return (
    <Group title="Reminders">
      <Row label="In-app reminders" hint="See due reminders and alerts while Noted is open.">
        <Button variant="outline" asChild>
          <Link to="/notes?view=reminders">View reminders</Link>
        </Button>
      </Row>
      <Row
        label="Browser notifications"
        hint={
          permission === 'denied'
            ? 'Allow notifications in this site’s browser settings to receive alerts.'
            : 'Show reminders as system notifications while Noted is open.'
        }
      >
        {permission === 'default' ? (
          <Button variant="outline" disabled={requesting} onClick={() => void request()}>
            {requesting ? <Spinner /> : <Bell />} Enable browser notifications
          </Button>
        ) : (
          <Status>
            {permission === 'granted'
              ? 'Allowed'
              : permission === 'denied'
                ? 'Blocked'
                : 'Unavailable'}
          </Status>
        )}
      </Row>
    </Group>
  );
}

function DevicePermission({ name }: { name: 'camera' | 'microphone' }) {
  const [status, setStatus] = useState<PermissionState | null>(null);
  useEffect(() => {
    if (!navigator.permissions) return;
    let active = true;
    let permission: PermissionStatus | undefined;
    const update = () => {
      if (permission) setStatus(permission.state);
    };
    void navigator.permissions
      .query({ name } as PermissionDescriptor)
      .then((result) => {
        if (!active) return;
        permission = result;
        update();
        permission.addEventListener('change', update);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      permission?.removeEventListener('change', update);
    };
  }, [name]);
  return (
    <Status>
      {status === 'granted'
        ? 'Allowed'
        : status === 'denied'
          ? 'Blocked'
          : status === 'prompt'
            ? 'Ask on use'
            : 'Managed by your browser'}
    </Status>
  );
}

function PrivacyPanel() {
  const [metricsEnabled, setMetricsEnabled] = useState(telemetryEnabled);
  return (
    <>
      <Group title="Optional reporting">
        <Row
          label="Share operational statistics"
          htmlFor="operational-metrics"
          hint="Shares usage counts and failure categories. Your notes, audio, transcripts and passwords stay private."
        >
          <Switch
            id="operational-metrics"
            checked={metricsEnabled}
            onCheckedChange={(enabled) => {
              setTelemetryEnabled(enabled);
              setMetricsEnabled(enabled);
            }}
          />
        </Row>
      </Group>
      <Group title="Device and service permissions">
        <Row label="Camera" hint="Used when you choose to scan or capture an image.">
          <DevicePermission name="camera" />
        </Row>
        <Row label="Microphone" hint="Used when you record audio or start live dictation.">
          <DevicePermission name="microphone" />
        </Row>
        <Row
          label="Recorded-audio transcription"
          hint="Noted asks for consent before sending audio to the configured transcription service."
        >
          <Status>Consent required</Status>
        </Row>
      </Group>
    </>
  );
}

function AboutPanel() {
  const desktop = isDesktopApp();
  const repository = releasesRepo();
  const [checking, setChecking] = useState(false);
  const version = useQuery({
    queryKey: ['app-version', desktop],
    queryFn: async () => {
      if (desktop) {
        const { getVersion } = await import('@tauri-apps/api/app');
        return { version: await getVersion(), builtAt: undefined };
      }
      const response = await fetch('/release.json');
      if (!response.ok) throw new Error('Build information is unavailable.');
      const info = (await response.json()) as { version: string; builtAt?: string };
      return { version: info.version, builtAt: info.builtAt };
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  return (
    <Group title="Noted Smart Notepad">
      <Row
        label={desktop ? 'Installed version' : 'Web version'}
        hint={version.data?.builtAt ? 'Built ' + formatDateTime(version.data.builtAt) : undefined}
      >
        <Status>
          {version.data?.version ?? (version.isLoading ? 'Checking…' : 'Unavailable')}
        </Status>
      </Row>
      {repository && (
        <Row label="Release history" hint="Browse published versions and release notes.">
          <Button variant="outline" asChild>
            <a
              href={'https://github.com/' + repository + '/releases'}
              target="_blank"
              rel="noreferrer"
            >
              View releases <ArrowUpRight aria-hidden="true" />
            </a>
          </Button>
        </Row>
      )}
      {desktop && (
        <Row label="App updates" hint="Updates are verified with Noted’s signing key.">
          <Button
            variant="outline"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              try {
                const { checkForUpdates } = await import('@/desktop/desktop');
                await checkForUpdates({ silent: false });
              } catch (error) {
                toast.error(errorMessage(error, 'Could not check for updates.'));
              } finally {
                setChecking(false);
              }
            }}
          >
            {checking ? <Spinner /> : <RefreshCw />} Check for updates
          </Button>
        </Row>
      )}
    </Group>
  );
}
