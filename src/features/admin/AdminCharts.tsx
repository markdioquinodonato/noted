import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Empty, Panel, Table } from './AdminUI';
import { count, monthRegistrations, platformName, shortDay, sum } from './adminFormat';
import type { Analytics, AnalyticsDay } from './types';

const palette = ['var(--admin-blue)', 'var(--admin-mid)', 'var(--admin-low)'];

export function TrendChart<T extends { day: string }>({
  title,
  description,
  rows,
  series,
  action,
  empty,
  format = count,
}: {
  title: string;
  description: string;
  rows: T[];
  series: { key: keyof T & string; name: string; dashed?: boolean }[];
  action?: React.ReactNode;
  empty?: string;
  format?: (value: number | null) => string;
}) {
  const hasData = rows.some((row) => series.some((item) => row[item.key] != null));
  const label = (day: string) =>
    day.length === 7
      ? new Intl.DateTimeFormat(undefined, {
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(day + '-01'))
      : shortDay(day);
  return (
    <Panel title={title} description={description} action={action}>
      {!hasData ? (
        <Empty title="No measurements in this range">
          {empty ?? 'Measurements appear here once data is recorded.'}
        </Empty>
      ) : (
        <>
          <div className="h-[200px] min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart
                data={rows}
                margin={{ top: 12, right: 12, bottom: 4, left: 0 }}
                accessibilityLayer
              >
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
                <XAxis
                  dataKey="day"
                  tickFormatter={label}
                  minTickGap={28}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
                />
                <YAxis
                  width={48}
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={format}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
                />
                <Tooltip
                  labelFormatter={(value) => label(String(value))}
                  formatter={(value) => format(Number(value))}
                  contentStyle={{
                    borderRadius: 8,
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    color: 'var(--foreground)',
                    fontSize: 12,
                  }}
                  itemStyle={{ color: 'var(--foreground)' }}
                />
                {series.map(({ key, name, dashed }, i) => (
                  <Area
                    key={key}
                    name={name}
                    type="linear"
                    dataKey={(row: T) => row[key]}
                    dot={rows.length === 1}
                    stroke={palette[i % palette.length]}
                    strokeWidth={2}
                    strokeDasharray={dashed ? '5 4' : undefined}
                    fill={palette[i % palette.length]}
                    fillOpacity={dashed ? 0 : 0.11}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div
            className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
            aria-label="Chart legend"
          >
            {series.map(({ name, dashed }, i) => (
              <span className="flex items-center gap-1.5" key={name}>
                <span
                  style={{
                    borderColor: palette[i % palette.length],
                    borderStyle: dashed ? 'dashed' : 'solid',
                  }}
                  className="w-4 border-t-2"
                  aria-hidden="true"
                />
                {name}
              </span>
            ))}
          </div>
          <details className="mt-3 text-xs">
            <summary className="w-fit cursor-pointer font-medium text-accent-foreground">
              View chart data
            </summary>
            <div className="mt-2 max-h-56 overflow-auto">
              <Table
                headers={['UTC date', ...series.map((s) => s.name)]}
                rows={rows.map((r) => [
                  r.day,
                  ...series.map((s) => format(r[s.key] == null ? null : Number(r[s.key]))),
                ])}
                label={title}
              />
            </div>
          </details>
        </>
      )}
    </Panel>
  );
}

export function ActiveChart({ data, days }: { data?: Analytics; days: number }) {
  const [mode, setMode] = useState<'dau' | 'wau' | 'mau'>('dau');
  const rows =
    data?.days.slice(-days).map((row, index) => ({
      day: row.day,
      current: row[mode],
      previous: data.days[index]?.[mode] ?? null,
    })) ?? [];
  return (
    <TrendChart
      title="Active users trend"
      description="Distinct signed-in accounts. Weekly and monthly views use rolling 7- and 30-day windows."
      rows={rows}
      series={[
        { key: 'current', name: 'Current period' },
        { key: 'previous', name: 'Previous period', dashed: true },
      ]}
      action={
        <select
          aria-label="Active-user window"
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option value="dau">Daily</option>
          <option value="wau">Weekly</option>
          <option value="mau">Monthly</option>
        </select>
      }
      empty="The chart needs enough opt-in activity history for the selected window."
    />
  );
}

export function RegistrationChart({ rows }: { rows: AnalyticsDay[] }) {
  const [monthly, setMonthly] = useState(false);
  return (
    <TrendChart
      title="New registrations"
      description="Current registered accounts grouped by their Supabase Auth signup date."
      rows={monthly ? monthRegistrations(rows) : rows}
      series={[{ key: 'registrations', name: 'New accounts' }]}
      action={
        <select
          aria-label="Registration grouping"
          value={monthly ? 'monthly' : 'daily'}
          onChange={(e) => setMonthly(e.target.value === 'monthly')}
        >
          <option value="daily">Daily</option>
          <option value="monthly">Monthly</option>
        </select>
      }
    />
  );
}

export function PlatformChart({ data }: { data?: Analytics }) {
  const platforms = data?.platforms ?? [];
  const total = sum(platforms, (p) => p.active_device_days);
  return (
    <Panel title="Platform distribution" description="Share of reported device-days by runtime.">
      {!total ? (
        <Empty>
          Opt-in reports for Web, Windows, macOS, Android and other runtimes will appear here.
        </Empty>
      ) : (
        <ul className="space-y-3 py-2">
          {['web', 'windows', 'macos', 'android', 'other'].map((key) => {
            const value = platforms.find((p) => p.platform === key)?.active_device_days ?? 0;
            const percent = (100 * value) / total;
            return (
              <li key={key} className="text-xs">
                <div className="mb-1 flex justify-between gap-2">
                  <span className="font-medium">{platformName(key)}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {count(value)} · {percent.toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted">
                  <div
                    aria-hidden="true"
                    className="h-full rounded-full bg-[var(--admin-blue)]"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function ActivityCharts({ rows }: { rows: AnalyticsDay[] }) {
  return (
    <div className="admin-charts">
      <TrendChart
        title="Application activity"
        description="Confirmed cloud note writes and observed guest device-days, by UTC date."
        rows={rows}
        series={[
          { key: 'notes_created', name: 'Notes created' },
          { key: 'notes_updated', name: 'Notes updated' },
          { key: 'guests', name: 'Guest sessions' },
        ]}
      />
      <TrendChart
        title="Service performance"
        description="Opt-in failure reports. Request latency appears in transcription analytics."
        rows={rows}
        series={[
          { key: 'errors', name: 'App errors' },
          { key: 'sync_failed', name: 'Sync failures' },
          { key: 'sync_offline', name: 'Sync offline' },
        ]}
      />
    </div>
  );
}
