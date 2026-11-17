import type { AnalyticsDay } from './types';

export const dayMs = 86_400_000;
export const count = (value: number | null | undefined) =>
  value == null ? 'Unavailable' : Number(value).toLocaleString();
export function bytes(value: number | null | undefined) {
  if (value == null) return 'Unavailable';
  if (value === 0) return '0 B';
  const i = Math.min(4, Math.floor(Math.log(Math.max(1, value)) / Math.log(1024)));
  return `${(value / 1024 ** i).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][i]}`;
}
export const stamp = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : 'Unavailable';
export const shortDay = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
export const since = (days: number) =>
  new Date(Date.now() - (days - 1) * dayMs).toISOString().slice(0, 10);
export const humanize = (raw: string) =>
  raw.replaceAll('_', ' ').replace(/^./, (s) => s.toUpperCase());
export const platformName = (key: string) =>
  ({ web: 'Web', windows: 'Windows', macos: 'macOS', android: 'Android', other: 'Other' })[key] ??
  key;
export const sum = <T>(rows: T[], value: (row: T) => number) =>
  rows.reduce((total, row) => total + Number(value(row)), 0);
export function seriesTotal<K extends keyof Omit<AnalyticsDay, 'day'>>(
  rows: AnalyticsDay[],
  key: K,
) {
  if (!rows.length || rows.some((r) => r[key] == null)) return null;
  return sum(rows, (r) => r[key]!);
}
export function compare(value: number | null, previous: number | null, unit = '') {
  if (value == null || previous == null) return undefined;
  const change = value - previous;
  return `${change > 0 ? '+' : change < 0 ? '−' : ''}${count(Math.abs(change))}${unit} vs prior period`;
}
export function monthRegistrations(rows: AnalyticsDay[]) {
  const months = new Map<string, number>();
  for (const row of rows) {
    const month = row.day.slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + Number(row.registrations));
  }
  return [...months].map(([day, registrations]) => ({ day, registrations }));
}
