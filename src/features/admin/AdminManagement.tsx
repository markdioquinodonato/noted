import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Apple, Bell, Globe, Laptop, Search, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/AuthProvider';
import { useDebouncedValue } from '@/features/notes/hooks';
import { fetchReleaseHistory, releasesRepo, type InstallerKey } from '@/features/download/releases';
import { useAdminRpc, useAlerts, useSnapshot } from './adminData';
import { count, humanize, shortDay, since, stamp } from './adminFormat';
import { Empty, ExternalLink, PageHeading, Panel, QueryNotice, Table } from './AdminUI';
import type { AdminContext } from './AdminLayout';

type Directory = {
  total: number;
  rows: {
    id: string;
    email: string;
    created_at: string;
    verified: boolean;
    role: string;
    status: string;
    last_activity: string | null;
  }[];
};

export function UserManagement() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(0);
  const searchText = useDebouncedValue(search.trim(), 250);
  const result = useAdminRpc<Directory>('admin_user_directory', {
    p_search: searchText,
    p_status: status,
    p_oldest: sort === 'oldest',
    p_offset: page * 25,
  });
  const data = result.error ? undefined : result.data;
  return (
    <>
      <PageHeading
        title="User management"
        description="Find registered accounts and review verification, roles and observed activity."
      />
      <Panel
        title="Account directory"
        description={data ? `${count(data.total)} matching accounts` : undefined}
      >
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <label className="grid min-w-0 grow gap-1 text-xs font-medium">
            Search by email
            <span className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input
                type="search"
                className="pl-8"
                maxLength={120}
                value={search}
                placeholder="Search accounts"
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </span>
          </label>
          <label className="grid gap-1 text-xs font-medium">
            Status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              {['all', 'active', 'unverified', 'suspended', 'admin'].map((value) => (
                <option key={value} value={value}>
                  {humanize(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium">
            Registration
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(0);
              }}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
        </div>
        <QueryNotice
          error={result.error}
          loading={result.isLoading}
          retry={() => void result.refetch()}
        />
        {data &&
          (data.rows.length ? (
            <Table
              label="Registered accounts"
              headers={['Email', 'Status', 'Verified', 'Role', 'Registered', 'Last activity (UTC)']}
              rows={data.rows.map((u) => [
                u.email ?? 'Unavailable',
                <span className={u.status === 'suspended' ? 'text-destructive' : ''}>
                  {humanize(u.status)}
                </span>,
                u.verified ? 'Verified' : 'Pending',
                u.role,
                stamp(u.created_at),
                u.last_activity ? shortDay(u.last_activity) : 'No report',
              ])}
            />
          ) : (
            <Empty compact title="No accounts on this page">
              Try changing the search or filters.
            </Empty>
          ))}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
          <span aria-live="polite">Page {page + 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!page || result.isFetching}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!data || result.isFetching || (page + 1) * 25 >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </Panel>
    </>
  );
}

export function AuditLogs() {
  const { days } = useOutletContext<AdminContext>();
  const s = useSnapshot();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const logs = s.error
    ? []
    : (s.data?.audit.filter(
        (x) =>
          x.created_at.slice(0, 10) >= since(days) &&
          (filter === 'all' || x.outcome === filter) &&
          `${humanize(x.action)} ${x.target ?? ''}`.toLowerCase().includes(needle),
      ) ?? []);
  const auth = s.error ? [] : (s.data?.auth_audit.filter((x) => x.day >= since(days)) ?? []);
  return (
    <>
      <PageHeading
        title="Security & audit logs"
        description="Review administrator actions and aggregate Supabase Auth events."
      />
      <QueryNotice error={s.error} loading={s.isLoading} retry={() => void s.refetch()} />
      <div className="space-y-4">
        <Panel
          title="Administrator audit"
          description="Latest 100 events. Filter by outcome or search by action and target."
        >
          <div className="mb-3 flex flex-wrap gap-2">
            <Input
              className="w-full sm:w-64"
              aria-label="Search admin audit"
              placeholder="Search action or target"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label="Audit outcome"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {['all', 'success', 'denied', 'failed'].map((value) => (
                <option key={value} value={value}>
                  {humanize(value)}
                </option>
              ))}
            </select>
          </div>
          {logs.length ? (
            <Table
              label="Administrator audit entries"
              headers={['Time', 'Action', 'Outcome', 'Target']}
              rows={logs.map((x) => [
                stamp(x.created_at),
                humanize(x.action),
                humanize(x.outcome),
                x.target ?? '—',
              ])}
            />
          ) : (
            <Empty compact title="No matching audit events" />
          )}
        </Panel>
        <Panel
          title="Authentication activity"
          description="Recent event counts from Supabase Auth."
        >
          {auth.length ? (
            <Table
              label="Supabase Auth event counts"
              headers={['UTC day', 'Action', 'Events']}
              rows={auth.map((x) => [
                x.day,
                x.action ? humanize(x.action) : 'Other',
                count(x.count),
              ])}
            />
          ) : (
            <Empty compact title="No authentication activity in this range" />
          )}
        </Panel>
      </div>
    </>
  );
}

export function Notifications() {
  const { client } = useAuth();
  const alerts = useAlerts();
  const [filter, setFilter] = useState('inbox');
  const [busy, setBusy] = useState(false);
  const data = alerts.error ? undefined : alerts.data;
  const items =
    data?.items.filter((x) =>
      filter === 'dismissed'
        ? x.dismissed_at
        : filter === 'unread'
          ? !x.read_at && !x.dismissed_at
          : !x.dismissed_at,
    ) ?? [];
  async function update(id: number, action: 'read' | 'acknowledge' | 'dismiss') {
    setBusy(true);
    try {
      const { error } = await client!.rpc('admin_update_alert', { p_id: id, p_action: action });
      if (error) throw error;
      await alerts.refetch();
      toast.success(
        { read: 'Marked as read', acknowledge: 'Alert acknowledged', dismiss: 'Alert dismissed' }[
          action
        ],
      );
    } catch {
      toast.error('The alert could not be updated. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title="Notifications"
        description="Review capacity, telemetry, provider and security alerts."
      />
      <QueryNotice
        error={alerts.error}
        loading={alerts.isLoading}
        retry={() => void alerts.refetch()}
      />
      <Panel
        title="Alert inbox"
        description={
          data?.last_checked
            ? `Last database monitoring run ${stamp(data.last_checked)}.`
            : 'No scheduled sample has been recorded.'
        }
        action={
          <select
            aria-label="Alert filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="inbox">Inbox</option>
            <option value="unread">Unread</option>
            <option value="dismissed">Dismissed</option>
          </select>
        }
      >
        {!items.length ? (
          <Empty compact title="No matching alerts" />
        ) : (
          <ul className="divide-y">
            {items.map((x) => (
              <li key={x.id} className="flex flex-wrap items-start gap-3 py-4">
                <Bell
                  className={`mt-0.5 size-4 shrink-0 ${x.read_at ? 'text-muted-foreground' : 'text-primary'}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {x.title}{' '}
                    <span className="ml-1 rounded border px-1.5 text-xs font-medium">
                      {humanize(x.priority)}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{x.detail}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {stamp(x.created_at)} · {x.resolved_at ? 'Resolved' : 'Open'} ·{' '}
                    {x.acknowledged_at ? 'Acknowledged' : x.read_at ? 'Read' : 'Unread'}
                  </p>
                  <Link
                    to={x.section}
                    className="mt-1 inline-block text-xs font-medium text-accent-foreground underline"
                  >
                    Open related section
                  </Link>
                </div>
                {!x.dismissed_at && (
                  <div className="ml-7 flex flex-wrap items-center gap-1 sm:ml-0">
                    {!x.read_at && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void update(x.id, 'read')}
                      >
                        Mark read
                      </Button>
                    )}
                    {!x.acknowledged_at && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void update(x.id, 'acknowledge')}
                      >
                        Acknowledge
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void update(x.id, 'dismiss')}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

const platforms = [
  {
    label: 'Windows',
    icon: Laptop,
    assets: [
      ['windows-exe', 'EXE'],
      ['windows-msi', 'MSI'],
    ],
  },
  {
    label: 'macOS',
    icon: Apple,
    assets: [
      ['mac-arm', 'Apple silicon'],
      ['mac-intel', 'Intel'],
    ],
  },
  { label: 'Android', icon: Smartphone, assets: [['android-apk', 'APK']] },
] satisfies { label: string; icon: typeof Laptop; assets: [InstallerKey, string][] }[];
type WebRelease = { version?: string; builtAt?: string; commit?: string };

export function Releases() {
  const repo = releasesRepo();
  const s = useSnapshot();
  const { user } = useAuth();
  const history = useQuery({
    queryKey: ['admin', user?.id, 'github-releases', repo],
    queryFn: ({ signal }) => fetchReleaseHistory(repo!, signal),
    enabled: !!repo,
    staleTime: 300_000,
    retry: false,
  });
  const web = useQuery<WebRelease>({
    queryKey: ['admin', user?.id, 'web-release'],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        new URL(
          '/release.json',
          location.protocol.startsWith('http') && !location.hostname.endsWith('tauri.localhost')
            ? location.origin
            : 'https://noted-ph.pages.dev',
        ),
        { signal, cache: 'no-store' },
      );
      if (!response.ok || !response.headers.get('content-type')?.includes('json'))
        throw new Error('Web release metadata is unavailable.');
      return response.json();
    },
    staleTime: 300_000,
    retry: false,
  });
  const webStatus = s.error
    ? undefined
    : s.data?.provider_metrics.find(
        (x) => x.metric === 'cloudflare_production' && x.status === 'available',
      );
  const webPublished =
    webStatus?.period_end &&
    web.data?.builtAt &&
    Date.parse(webStatus.period_end) >= Date.parse(web.data.builtAt)
      ? webStatus.period_end
      : undefined;
  return (
    <>
      <PageHeading
        title="Application releases"
        description="Verify production web build metadata and inspect published, downloadable native releases."
      />
      <QueryNotice
        error={history.error ?? web.error ?? s.error}
        loading={history.isLoading || web.isLoading}
        retry={() => {
          void history.refetch();
          void web.refetch();
          void s.refetch();
        }}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <Panel
          title="Web"
          action={<Globe className="size-4 text-muted-foreground" />}
          description="Cloudflare Pages production"
        >
          <p className="text-xl font-semibold">
            {web.error ? 'Unavailable' : (web.data?.version ?? 'Unavailable')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {webPublished
              ? `Deployed ${stamp(webPublished)}`
              : web.data?.builtAt
                ? `Built ${stamp(web.data.builtAt)}`
                : 'Deployment date unavailable'}
          </p>
          <div className="mt-3">
            <ExternalLink url="https://noted-ph.pages.dev">Open Noted Web</ExternalLink>
          </div>
        </Panel>
        {platforms.map(({ label, icon: Icon, assets }) => {
          const release = history.error
            ? undefined
            : history.data?.find((r) => assets.some(([key]) => r.installers[key]));
          return (
            <Panel
              key={label}
              title={label}
              action={<Icon className="size-4 text-muted-foreground" />}
              description="Published GitHub release"
            >
              <p className="text-xl font-semibold">{release?.version ?? 'Unavailable'}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {release?.publishedAt
                  ? `Published ${stamp(release.publishedAt)}`
                  : 'No installer found in the fetched releases.'}
              </p>
              {release && (
                <>
                  <ul className="my-3 space-y-1 pl-0">
                    {assets.map(([key, name]) => {
                      const installer = release.installers[key];
                      return (
                        <li key={key} className="text-xs">
                          {installer ? (
                            <ExternalLink url={installer.url}>Download {name}</ExternalLink>
                          ) : (
                            <span className="text-muted-foreground">{name} unavailable</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-accent-foreground">
                      Release notes
                    </summary>
                    <p className="my-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">
                      {release.notes || 'No release notes published.'}
                    </p>
                    <ExternalLink url={release.pageUrl}>View on GitHub</ExternalLink>
                  </details>
                </>
              )}
            </Panel>
          );
        })}
      </div>
    </>
  );
}
