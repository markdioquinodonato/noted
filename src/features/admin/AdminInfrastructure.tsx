import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { Activity, Database, HardDrive, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAlerts, useAnalytics, useSnapshot } from './adminData';
import { bytes, count, humanize, since, stamp, sum } from './adminFormat';
import { Empty, ExternalLink, MetricCard, PageHeading, Panel, QueryNotice, Table } from './AdminUI';
import { ActivityCharts, TrendChart } from './AdminCharts';
import type { AdminContext } from './AdminLayout';
import { METRICS, type AdminSnapshot, type ProviderMetric, type Threshold } from './types';
import { CloudflareTraffic } from './CloudflareTraffic';

const projectUrl = 'https://supabase.com/dashboard/project/bvvyiijyvtjjuqkfjzpo';
const usageUrl = 'https://supabase.com/dashboard/org/nnxwxhbdteufcappzbmi/usage';
const cloudflareUrl =
  'https://dash.cloudflare.com/26bc1b213cec6f5003ebcf410baf746b/pages/view/noted-ph';
const stale = (p: ProviderMetric) => Date.now() - Date.parse(p.measured_at) > 6 * 3_600_000;

function ProviderRefresh({ after }: { after: () => Promise<unknown> }) {
  const { client } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={busy}
      variant="outline"
      onClick={async () => {
        setBusy(true);
        try {
          const { error } = await client!.functions.invoke('admin-providers', { body: {} });
          if (error) {
            const response = (error as { context?: Response }).context;
            const message = await response?.json().catch(() => null);
            throw new Error(
              message?.error ?? 'Provider refresh failed. Check your connection and MFA session.',
            );
          }
          await after();
          toast.success('Provider checks updated');
        } catch (error) {
          toast.error((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <RefreshCw className={busy ? 'motion-safe:animate-spin' : undefined} />
      {busy ? 'Checking…' : 'Refresh provider feeds'}
    </Button>
  );
}

function ProviderList({
  items,
  metrics,
}: {
  items: [key: string, label: string][];
  metrics?: ProviderMetric[];
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([key, label]) => {
        const p = metrics?.find((metric) => metric.metric === key);
        const isStale =
          p && !key.startsWith('cloudflare_deploy') && key !== 'cloudflare_production' && stale(p);
        return (
          <div className="rounded-lg border p-3" key={key}>
            <h3 className="text-xs font-semibold">{label}</h3>
            <p className="mt-1 text-base font-semibold">
              {p?.status === 'available' && !isStale
                ? key === 'cloudflare_production'
                  ? p.detail
                  : key.endsWith('_bytes')
                    ? bytes(p.value)
                    : count(p.value)
                : 'Unavailable'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {isStale ? 'Last sample is stale. ' : ''}
              {p?.detail ?? 'No authorized measurement is configured.'}
            </p>
            {p && (
              <p className="mt-1 text-xs text-muted-foreground">
                {p.source} · {stamp(p.measured_at)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function thresholdValue(s: AdminSnapshot, metric: Threshold['metric']) {
  if (metric === 'storage_bytes' || metric === 'database_bytes') return s[metric];
  if (metric === 'app_errors' || metric === 'sync_failures') {
    return s.event_totals?.[metric] ?? null;
  }
  if (metric === 'transcription_cost_usd') {
    const rows = s.transcription.filter((r) => r.day >= since(30));
    return rows.length && rows.every((r) => r.estimated_cost_usd != null)
      ? sum(rows, (r) => r.estimated_cost_usd!)
      : null;
  }
  const p = s.provider_metrics.find((p) => p.metric === metric);
  return p?.status === 'available' && !stale(p) ? p.value : null;
}

function Capacity({ s, storageOnly = false }: { s: AdminSnapshot; storageOnly?: boolean }) {
  const metrics = storageOnly
    ? (['database_bytes', 'storage_bytes'] as const)
    : (Object.keys(METRICS) as Threshold['metric'][]);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {metrics.map((metric) => {
        const quotaKey =
          metric === 'database_bytes'
            ? 'supabase_database_quota_bytes'
            : metric === 'storage_bytes'
              ? 'supabase_storage_quota_bytes'
              : '';
        const quota = s.provider_metrics.find(
          (p) => p.metric === quotaKey && p.status === 'available' && p.value != null,
        );
        const configured = s.thresholds.find((x) => x.metric === metric);
        const t =
          configured ?? (quota ? { limit_value: quota.value!, warning_percent: 85 } : undefined);
        const value = thresholdValue(s, metric);
        const percent = t && value != null ? (100 * value) / Number(t.limit_value) : null;
        const state =
          percent == null || !t
            ? 'Unavailable'
            : percent >= Math.max(95, t.warning_percent)
              ? 'Critical'
              : percent >= t.warning_percent
                ? 'Warning'
                : (metric === 'database_bytes' || metric === 'storage_bytes') && percent >= 70
                  ? 'Notice'
                  : 'Within limit';
        const format = metric.endsWith('_bytes') ? bytes : count;
        return (
          <div key={metric} className="rounded-lg border p-3">
            <div className="flex flex-wrap justify-between gap-2 text-xs">
              <span className="font-semibold">{METRICS[metric]}</span>
              <span
                className={
                  state === 'Critical'
                    ? 'text-destructive'
                    : state === 'Warning'
                      ? 'text-amber-800 dark:text-amber-300'
                      : 'text-muted-foreground'
                }
              >
                {state}
              </span>
            </div>
            <p className="my-2 text-xs text-muted-foreground">
              {format(value)}
              {t
                ? ` / ${format(Number(t.limit_value))} · warning at ${t.warning_percent}%`
                : ' · Limit unconfigured'}
            </p>
            {!configured && quota && (
              <p className="mb-2 text-xs text-muted-foreground">{quota.detail}</p>
            )}
            {percent != null && (
              <div
                role="meter"
                aria-label={METRICS[metric]}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, percent)}
                aria-valuetext={`${percent.toFixed(1)}% of configured limit`}
                className="h-1.5 rounded-full bg-muted"
              >
                <div
                  className={`h-full rounded-full ${state === 'Critical' ? 'bg-destructive' : state === 'Warning' || state === 'Notice' ? 'bg-warning' : 'bg-primary'}`}
                  style={{ width: `${Math.min(100, percent)}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SupabaseMonitoring({ storageOnly = false }: { storageOnly?: boolean }) {
  const s = useSnapshot();
  const { days } = useOutletContext<AdminContext>();
  const data = s.error ? undefined : s.data;
  return (
    <>
      <PageHeading
        title={storageOnly ? 'Storage & database' : 'Supabase monitoring'}
        description="Database footprint, stored files, configured capacity limits and available provider usage."
      >
        <div className="flex flex-wrap gap-3">
          <ExternalLink url={projectUrl}>Open Supabase</ExternalLink>
          <ExternalLink url={usageUrl}>Open billing usage</ExternalLink>
        </div>
      </PageHeading>
      <QueryNotice error={s.error} retry={() => void s.refetch()} />
      <div className="admin-kpis mb-4">
        <MetricCard
          icon={Database}
          title="Database footprint"
          value={bytes(data?.database_bytes)}
          hint="Includes table data and indexes"
          loading={s.isLoading}
        />
        <MetricCard
          icon={HardDrive}
          title="File storage"
          value={bytes(data?.storage_bytes)}
          hint="Sum of stored object sizes"
          loading={s.isLoading}
        />
        <MetricCard
          icon={Users}
          title="Registered accounts"
          value={count(data?.registered_users)}
          hint="Supabase Auth"
          loading={s.isLoading}
        />
        <MetricCard
          icon={Activity}
          title="Database connections"
          value={count(data?.database_connections)}
          hint="PostgreSQL backends at snapshot time"
          loading={s.isLoading}
        />
      </div>
      <div className="space-y-4">
        <Panel
          title="Storage capacity"
          description="Uses verified plan allowances or administrator-configured monitoring limits. File storage quota is shared at organization level."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/settings">Configure limits</Link>
            </Button>
          }
        >
          {data ? (
            <Capacity s={data} storageOnly />
          ) : (
            <Empty compact title="Capacity unavailable" />
          )}
        </Panel>
        <TrendChart
          title="Storage growth"
          description="Latest database and object-storage measurements on each UTC day."
          rows={(data?.storage_history ?? []).filter((r) => !storageOnly || r.day >= since(days))}
          series={[
            { key: 'database_bytes', name: 'Database' },
            { key: 'storage_bytes', name: 'Uploaded files' },
          ]}
          format={bytes}
        />
        {!storageOnly && (
          <Panel
            title="Provider usage"
            description="Billing and Realtime measurements require their own authorized provider feeds."
            action={<ProviderRefresh after={s.refetch} />}
          >
            <ProviderList
              metrics={data?.provider_metrics}
              items={[
                ['supabase_mau', 'Supabase billing MAU'],
                ['supabase_bandwidth_bytes', 'Bandwidth'],
                ['supabase_realtime', 'Realtime connections'],
                ['supabase_api_requests', 'API requests'],
              ]}
            />
          </Panel>
        )}
      </div>
    </>
  );
}

export function CloudflareMonitoring() {
  const s = useSnapshot();
  const p = s.error ? undefined : s.data?.provider_metrics;
  const requests = p?.find((m) => m.metric === 'cloudflare_requests');
  const errors = p?.find((m) => m.metric === 'cloudflare_errors');
  const rate =
    requests?.status === 'available' &&
    errors?.status === 'available' &&
    !stale(requests) &&
    !stale(errors) &&
    requests.value &&
    errors.value != null
      ? (100 * errors.value) / requests.value
      : null;
  return (
    <>
      <PageHeading
        title="Cloudflare monitoring"
        description="Production deployment, Pages requests and configured Worker analytics."
      >
        <ProviderRefresh after={s.refetch} />
      </PageHeading>
      <QueryNotice error={s.error} loading={s.isLoading} retry={() => void s.refetch()} />
      <div className="space-y-4">
        <Panel
          title="Cloudflare Pages and Workers"
          description={`Worker error rate over the latest measured 24-hour window · ${rate == null ? 'Unavailable' : rate.toFixed(2) + '%'}`}
          action={<ExternalLink url={cloudflareUrl}>Open Cloudflare Pages</ExternalLink>}
        >
          <ProviderList
            metrics={p}
            items={[
              ['cloudflare_production', 'Production deployment'],
              ['cloudflare_deployments', 'Pages deployment count'],
              ['cloudflare_page_requests', 'Page requests · 24h'],
              ['cloudflare_page_errors', 'Page 5xx errors · 24h'],
              ['cloudflare_bandwidth_bytes', 'Page bandwidth · 24h'],
              ['cloudflare_requests', 'Worker requests · 24h'],
              ['cloudflare_errors', 'Worker errors · 24h'],
            ]}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Static Pages traffic needs an authorized zone and hostname. Workers analytics requires
            an instrumented script. Check the provider dashboard for plan and retention limits.
          </p>
        </Panel>
        <CloudflareTraffic />
      </div>
    </>
  );
}

export function SystemHealth() {
  const s = useSnapshot();
  const alerts = useAlerts();
  const { days } = useOutletContext<AdminContext>();
  const a = useAnalytics(days);
  const data = s.error ? undefined : s.data;
  const rows = a.error ? [] : (a.data?.days.slice(-days) ?? []);
  const incidents =
    alerts.data?.items.filter(
      (item) => item.section === '/admin/health' && item.created_at.slice(0, 10) >= since(days),
    ) ?? [];
  return (
    <>
      <PageHeading
        title="System health"
        description="Latest verified service checks and incident history."
      >
        <ProviderRefresh after={() => Promise.all([s.refetch(), a.refetch(), alerts.refetch()])} />
      </PageHeading>
      <QueryNotice
        error={s.error ?? a.error ?? alerts.error}
        retry={() => {
          void s.refetch();
          void a.refetch();
          void alerts.refetch();
        }}
      />
      <div className="space-y-4">
        <Panel
          title="Service status"
          description="The production scheduler checks providers every 15 minutes. You can also refresh on demand. Missing or stale signals are marked Unknown."
        >
          <Table
            headers={['Service', 'Status', 'Observation', 'Checked']}
            label="Service health"
            rows={[
              [
                'Supabase database',
                data ? 'Healthy' : s.error ? 'Unavailable' : 'Unknown',
                data ? 'Protected aggregate query succeeded.' : 'No successful database signal.',
                stamp(data?.generated_at),
              ],
              ...[
                ['frontend_health', 'Web frontend'],
                ['edge_health', 'Supabase Edge Functions'],
                ['deepgram_health', 'Deepgram'],
              ].map(([key, label]) => {
                const p = data?.provider_metrics.find((x) => x.metric === key);
                const status =
                  !p || stale(p) || p.status === 'unavailable'
                    ? 'Unknown'
                    : p.status === 'available'
                      ? 'Healthy'
                      : p.value === 1
                        ? 'Degraded'
                        : 'Unavailable';
                return [
                  label,
                  <span
                    className={
                      status === 'Healthy'
                        ? 'text-green-800 dark:text-green-300'
                        : status === 'Unavailable'
                          ? 'text-destructive'
                          : ''
                    }
                  >
                    {status}
                  </span>,
                  p?.detail ?? 'No check recorded.',
                  stamp(p?.measured_at),
                ];
              }),
            ]}
          />
        </Panel>
        <ActivityCharts rows={rows} />
        <Panel
          title="Recent application reports"
          description="Latest 200 reported groups by UTC date, event category and runtime."
        >
          {data?.errors.some((row) => row.day >= since(days)) ? (
            <Table
              headers={['UTC day', 'Event', 'Runtime', 'Reports']}
              label="Recent application reports"
              rows={data.errors
                .filter((row) => row.day >= since(days))
                .map((row) => [row.day, humanize(row.code), row.platform, count(row.count)])}
            />
          ) : (
            <Empty compact title="No reports in this range" />
          )}
        </Panel>
        <Panel
          title="Recent incidents"
          description={`Health and telemetry alerts from the last ${days} days.`}
        >
          {incidents.length ? (
            <Table
              headers={['Incident', 'Priority', 'Opened', 'Resolved']}
              label="Recent incidents"
              rows={incidents.map((x) => [
                x.title,
                humanize(x.priority),
                stamp(x.created_at),
                x.resolved_at ? stamp(x.resolved_at) : 'Open',
              ])}
            />
          ) : (
            <Empty compact title="No incidents recorded in this range" />
          )}
        </Panel>
      </div>
    </>
  );
}

export function AdminSettings() {
  const s = useSnapshot();
  const { client } = useAuth();
  const [metric, setMetric] = useState<Threshold['metric']>('database_bytes');
  const [limit, setLimit] = useState('');
  const [warning, setWarning] = useState('85');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageHeading
        title="Admin settings"
        description="Manage capacity limits and operational alert thresholds."
      />
      <QueryNotice error={s.error} loading={s.isLoading} retry={() => void s.refetch()} />
      <div className="space-y-4">
        <Panel
          title="Configure a threshold"
          description="Use verified provider quotas or an operational target. Byte-based limits are entered in bytes."
        >
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const { error } = await client!.rpc('set_capacity_warning', {
                  p_metric: metric,
                  p_limit: Number(limit),
                  p_percent: Number(warning),
                });
                if (error) throw error;
                await s.refetch();
                toast.success('Threshold saved');
              } catch {
                toast.error(
                  'The threshold could not be saved. Check its value and your MFA session.',
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="grid min-w-0 gap-1 text-xs">
              Metric
              <select
                value={metric}
                onChange={(e) => {
                  const key = e.target.value as Threshold['metric'];
                  const existing = s.data?.thresholds.find((t) => t.metric === key);
                  setMetric(key);
                  setLimit(existing ? String(existing.limit_value) : '');
                  setWarning(String(existing?.warning_percent ?? 85));
                }}
              >
                {Object.entries(METRICS).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs">
              Limit
              <Input
                required
                type="number"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                min=".0001"
                step="any"
              />
            </label>
            <label className="grid gap-1 text-xs">
              Warning at (%)
              <Input
                required
                type="number"
                value={warning}
                onChange={(e) => setWarning(e.target.value)}
                min="1"
                max="100"
              />
            </label>
            <Button disabled={busy}>Save threshold</Button>
          </form>
        </Panel>
        {s.data && !s.error && (
          <Panel title="Current thresholds">
            <Capacity s={s.data} />
          </Panel>
        )}
      </div>
    </>
  );
}
