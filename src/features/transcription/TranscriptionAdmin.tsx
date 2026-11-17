import { useQuery } from '@tanstack/react-query';
import { useOutletContext } from 'react-router';
import { AudioLines, CircleCheck, CircleX, Clock, Database, Receipt, Timer } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useSnapshot, useTranscription } from '@/features/admin/adminData';
import { TrendChart } from '@/features/admin/AdminCharts';
import { count, since, sum } from '@/features/admin/adminFormat';
import {
  Empty,
  MetricCard,
  PageHeading,
  Panel,
  QueryNotice,
  Table,
} from '@/features/admin/AdminUI';
import type { AdminContext } from '@/features/admin/AdminLayout';
import type { TranscriptionAggregate } from '@/features/admin/types';

const money = (value: number) => `$${value.toFixed(4)}`;
function language(code: string) {
  const codes = code.toLowerCase().split('+');
  const english = codes.some((c) => c === 'en' || c.startsWith('en-'));
  const tagalog = codes.some((c) => /^(tl|fil)(-|$)/.test(c));
  if (english && tagalog) return 'Taglish';
  if (tagalog && codes.length === 1) return 'Tagalog';
  if (english && codes.length === 1) return 'English';
  return 'Other / undetected';
}
function aggregate(rows: TranscriptionAggregate[]) {
  const success = sum(rows, (r) => r.successes);
  const failed = sum(rows, (r) => r.failures);
  const total = success + failed;
  const priced =
    success > 0 &&
    rows.every(
      (r) =>
        !r.successes ||
        Number(r.priced_successes ?? (r.estimated_cost_usd == null ? 0 : r.successes)) ===
          Number(r.successes),
    );
  const cost = priced ? sum(rows, (r) => r.estimated_cost_usd ?? 0) : null;
  const avg = total
    ? sum(rows, (r) => r.average_processing_ms * (Number(r.successes) + Number(r.failures))) / total
    : null;
  return { success, failed, total, cost, avg, minutes: sum(rows, (r) => r.audio_seconds) / 60 };
}

export function TranscriptionAdmin({ costs = false }: { costs?: boolean }) {
  const { days } = useOutletContext<AdminContext>();
  const { user, client } = useAuth();
  const stats = useTranscription();
  const workspace = useSnapshot(costs);
  const status = useQuery<{
    provider: string;
    model: string;
    diarizer: string;
    available: boolean;
    ratePerMinute: number | null;
  }>({
    queryKey: ['admin', user?.id, 'transcription-status'],
    enabled: !!client && !!user,
    queryFn: async () => {
      const { data, error } = await client!.functions.invoke('transcribe', {
        body: { operation: 'status' },
      });
      if (error) throw new Error('Current transcription configuration is unavailable.');
      return data;
    },
    staleTime: 60_000,
    retry: false,
  });
  const start = since(days);
  const rows = stats.error ? [] : (stats.data?.filter((r) => r.day >= start) ?? []);
  const metrics = aggregate(rows);
  const trend = [...new Set(rows.map((r) => r.day))].sort().map((day) => {
    const data = aggregate(rows.filter((r) => r.day === day));
    return { day, success: data.success, failed: data.failed, cost: data.cost };
  });
  const models = [...new Set(rows.map((r) => `${r.model} / ${r.model_version}`))];
  const format = (value: number) => (stats.data && !stats.error ? count(value) : 'Unavailable');
  return (
    <>
      <PageHeading
        title={costs ? 'AI usage & costs' : 'Audio transcription analytics'}
        description={`Deepgram activity for the last ${days} days. Requests represent provider chunk attempts, including reviews.`}
      />
      <QueryNotice
        error={stats.error ?? status.error ?? (costs ? workspace.error : null)}
        retry={() => {
          void stats.refetch();
          void status.refetch();
          if (costs) void workspace.refetch();
        }}
      />
      <div className="admin-kpis mb-4">
        <MetricCard
          icon={AudioLines}
          title="Transcription requests"
          value={format(metrics.total)}
          hint="Provider chunk attempts"
          loading={stats.isLoading}
        />
        <MetricCard
          icon={CircleCheck}
          title="Successful requests"
          value={format(metrics.success)}
          hint="Completed provider calls"
          loading={stats.isLoading}
        />
        <MetricCard
          icon={CircleX}
          title="Failed requests"
          value={format(metrics.failed)}
          hint={
            metrics.total
              ? `${((100 * metrics.failed) / metrics.total).toFixed(1)}% of attempts`
              : 'Provider errors and timeouts'
          }
          loading={stats.isLoading}
        />
        <MetricCard
          icon={Timer}
          title="Average processing time"
          value={metrics.avg == null ? 'Unavailable' : `${(metrics.avg / 1000).toFixed(2)} s`}
          hint="Weighted across recorded requests"
          loading={stats.isLoading}
        />
        <MetricCard
          icon={Clock}
          title="Submitted audio"
          value={stats.data && !stats.error ? `${metrics.minutes.toFixed(1)} min` : 'Unavailable'}
          hint="Audio duration across chunk attempts"
          loading={stats.isLoading}
        />
        <MetricCard
          icon={Receipt}
          title="Estimated transcription cost"
          value={metrics.cost == null ? 'Unavailable' : money(metrics.cost)}
          hint="Priced successful calls · failed calls may also incur charges"
          loading={stats.isLoading}
        />
        {costs && (
          <MetricCard
            icon={Database}
            title="AI writing requests"
            value={count(
              workspace.error
                ? null
                : workspace.data?.ai_writing
                    ?.filter((r) => r.day >= start)
                    .reduce((n, r) => n + Number(r.requests), 0),
            )}
            hint="Recorded quota reservations · cost unavailable"
            loading={workspace.isLoading}
          />
        )}
      </div>
      <div className="space-y-4">
        <div className="admin-charts">
          <TrendChart
            title="Provider requests and errors"
            description="Recorded calls grouped by UTC day."
            rows={trend}
            series={[
              { key: 'success', name: 'Successful' },
              { key: 'failed', name: 'Failed', dashed: true },
            ]}
          />
          <Panel
            title="Detected language"
            description="Taglish groups calls where both Tagalog and English were detected."
          >
            {metrics.success ? (
              <Table
                label="Language distribution"
                headers={['Language', 'Successful requests']}
                rows={['Tagalog', 'English', 'Taglish', 'Other / undetected'].map((code) => [
                  code,
                  format(
                    sum(
                      rows.filter((r) => language(r.language) === code),
                      (r) => r.successes,
                    ),
                  ),
                ])}
              />
            ) : (
              <Empty title="No language measurements">
                Language activity appears after successful provider calls.
              </Empty>
            )}
          </Panel>
        </div>
        {costs && (
          <TrendChart
            title="Estimated daily cost"
            description="Requires a verified rate configuration for successful calls on that day."
            rows={trend}
            series={[{ key: 'cost', name: 'Estimated USD' }]}
            format={(value) => (value == null ? 'Unavailable' : money(value))}
          />
        )}
        <Panel
          title="Model configuration"
          description="The configuration check reports the current service settings. Provider reachability is shown in System Health."
        >
          <Table
            label="Transcription model configuration"
            headers={['Provider', 'Current model', 'Diarization', 'Configured rate']}
            rows={[
              [
                status.data?.provider ?? 'Unavailable',
                status.data?.model ?? 'Unavailable',
                status.data?.diarizer ?? 'Unavailable',
                status.data?.ratePerMinute == null
                  ? 'Unavailable'
                  : `${money(status.data.ratePerMinute)} per minute`,
              ],
            ]}
          />
        </Panel>
        <Panel
          title="Recorded model usage"
          description="Model versions reported by Deepgram and aggregated by day."
        >
          {models.length ? (
            <Table
              label="Recorded model usage"
              headers={['Model / version', 'Successful', 'Failed', 'Average time']}
              rows={models.map((model) => {
                const m = aggregate(
                  rows.filter((r) => `${r.model} / ${r.model_version}` === model),
                );
                return [
                  model,
                  format(m.success),
                  format(m.failed),
                  m.avg == null ? 'Unavailable' : `${(m.avg / 1000).toFixed(2)} s`,
                ];
              })}
            />
          ) : (
            <Empty compact title="No model activity in this range" />
          )}
        </Panel>
      </div>
    </>
  );
}
