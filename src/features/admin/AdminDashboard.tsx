import {
  Activity,
  AlertTriangle,
  Database,
  Files,
  HardDrive,
  RefreshCcw,
  UserRound,
  Users,
} from 'lucide-react';
import { Link, useOutletContext } from 'react-router';
import { useAnalytics, useSnapshot } from './adminData';
import type { AdminContext } from './AdminLayout';
import { ActiveChart, ActivityCharts, PlatformChart, RegistrationChart } from './AdminCharts';
import { MetricCard, PageHeading, Panel, QueryNotice } from './AdminUI';
import { bytes, compare, count, seriesTotal, stamp } from './adminFormat';

export function AdminDashboard() {
  const { days } = useOutletContext<AdminContext>();
  const snapshot = useSnapshot();
  const analytics = useAnalytics(days);
  const s = snapshot.error ? undefined : snapshot.data;
  const a = analytics.error ? undefined : analytics.data;
  const current = a?.days.slice(-days) ?? [];
  const previous = a?.days.slice(0, days) ?? [];
  const guest = seriesTotal(current, 'guests');
  const errors = seriesTotal(current, 'errors');
  const sync = seriesTotal(current, 'sync_failed');
  const active = current.at(-1)?.dau ?? null;
  return (
    <>
      <PageHeading
        title="Operations overview"
        description="Monitor accounts, application activity and infrastructure across Noted."
      >
        {s && (
          <span className="rounded-md border bg-card px-2.5 py-1.5 text-xs text-muted-foreground">
            Snapshot {stamp(s.generated_at)}
          </span>
        )}
      </PageHeading>
      <QueryNotice
        error={snapshot.error ?? analytics.error}
        retry={() => {
          void snapshot.refetch();
          void analytics.refetch();
        }}
      />
      <div className="admin-kpis mb-4">
        <MetricCard
          icon={Users}
          title="Registered users"
          value={count(s?.registered_users)}
          hint={
            s
              ? `${count(s.confirmed_users)} email-verified · Supabase Auth`
              : 'Supabase Auth accounts'
          }
          change={compare(
            seriesTotal(current, 'registrations'),
            seriesTotal(previous, 'registrations'),
            ' registrations',
          )}
          loading={snapshot.isLoading}
        />
        <MetricCard
          icon={Activity}
          title="Observed active users"
          value={count(active)}
          hint="Daily active accounts · opt-in reports"
          change={compare(active, previous.at(-1)?.dau ?? null)}
          loading={analytics.isLoading}
        />
        <MetricCard
          icon={UserRound}
          title="Guest activity"
          value={count(guest)}
          hint={`Estimated device-days · ${days} days`}
          change={compare(guest, seriesTotal(previous, 'guests'))}
          loading={analytics.isLoading}
        />
        <MetricCard
          icon={Files}
          title="Cloud notes"
          value={count(s?.cloud_notes)}
          hint="Current notes outside Trash"
          loading={snapshot.isLoading}
        />
        <MetricCard
          icon={Database}
          title="Database storage"
          value={bytes(s?.database_bytes)}
          hint="PostgreSQL footprint and indexes"
          loading={snapshot.isLoading}
        />
        <MetricCard
          icon={HardDrive}
          title="Uploaded file storage"
          value={bytes(s?.storage_bytes)}
          hint="Supabase Storage objects"
          loading={snapshot.isLoading}
        />
        <MetricCard
          icon={AlertTriangle}
          title="Reported app errors"
          value={count(errors)}
          hint={`Opt-in client reports · ${days} days`}
          change={compare(errors, seriesTotal(previous, 'errors'))}
          loading={analytics.isLoading}
        />
        <MetricCard
          icon={RefreshCcw}
          title="Synchronization failures"
          value={count(sync)}
          hint={`Failures and conflicts · ${days} days`}
          change={compare(sync, seriesTotal(previous, 'sync_failed'))}
          loading={analytics.isLoading}
        />
      </div>
      <div className="space-y-4">
        <div className="admin-charts">
          <ActiveChart data={a} days={days} />
          <PlatformChart data={a} />
        </div>
        <ActivityCharts rows={current} />
        <div className="admin-charts">
          <RegistrationChart rows={current} />
          <Panel
            title="Operations shortcuts"
            description="Go directly to monitoring or administration."
          >
            <div className="grid gap-2">
              {[
                ['supabase', 'Supabase usage and limits'],
                ['health', 'Health and incidents'],
                ['transcription', 'Transcription performance'],
                ['security', 'Security and audit logs'],
              ].map(([path, label]) => (
                <Link
                  className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
                  key={path}
                  to={`/admin/${path}`}
                >
                  {label}
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

export function UserAnalytics() {
  const { days } = useOutletContext<AdminContext>();
  const analytics = useAnalytics(days);
  const data = analytics.error ? undefined : analytics.data;
  return (
    <>
      <PageHeading
        title="User analytics"
        description="Compare observed app activity and Supabase Auth signup trends."
      />
      <QueryNotice
        error={analytics.error}
        loading={analytics.isLoading}
        retry={() => void analytics.refetch()}
      />
      <div className="admin-charts">
        <ActiveChart data={data} days={days} />
        <RegistrationChart rows={data?.days.slice(-days) ?? []} />
      </div>
    </>
  );
}
export function PlatformAnalytics() {
  const { days } = useOutletContext<AdminContext>();
  const analytics = useAnalytics(days);
  const data = analytics.error ? undefined : analytics.data;
  return (
    <>
      <PageHeading
        title="Platform analytics"
        description="Review observed platform usage and content-free operation counts."
      />
      <QueryNotice
        error={analytics.error}
        loading={analytics.isLoading}
        retry={() => void analytics.refetch()}
      />
      <div className="space-y-4">
        <PlatformChart data={data} />
        <ActivityCharts rows={data?.days.slice(-days) ?? []} />
      </div>
    </>
  );
}
