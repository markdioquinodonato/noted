import type { ReactNode } from 'react';
import { ArrowUpRight, ChartNoAxesColumn, Info, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[clamp(24px,3vw,33px)] font-bold tracking-[-.038em]">{title}</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </header>
  );
}
export function Panel({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`admin-card p-4 sm:p-[18px] ${className}`}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-.012em]">{title}</h2>
          {description && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
export function Empty({
  title = 'No data yet',
  children,
  compact,
}: {
  title?: string;
  children?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`grid place-items-center rounded-lg border border-dashed bg-muted/35 px-3 text-center ${compact ? 'min-h-24 py-3' : 'min-h-44 py-7'}`}
    >
      <div className="max-w-xs">
        <ChartNoAxesColumn
          className="mx-auto mb-1.5 size-5 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-sm font-medium">{title}</p>
        {children && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{children}</p>
        )}
      </div>
    </div>
  );
}
export function MetricCard({
  icon: Icon,
  title,
  value,
  hint,
  change,
  loading,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  hint: string;
  change?: string;
  loading?: boolean;
}) {
  return (
    <section className="admin-card p-3.5 sm:p-4" aria-busy={loading}>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-[16px]" aria-hidden="true" />
        </span>
        <h2 className="text-xs font-semibold leading-snug sm:text-[13px]">{title}</h2>
      </div>
      {loading ? (
        <div
          className="my-2 h-7 w-20 animate-pulse rounded bg-muted motion-reduce:animate-none"
          aria-label="Loading"
        />
      ) : (
        <p
          className={`break-words font-bold tracking-[-.036em] tabular-nums ${value === 'Unavailable' ? 'text-lg text-muted-foreground' : 'text-[clamp(22px,2.5vw,30px)]'}`}
        >
          {value}
        </p>
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      {change && <p className="mt-1 text-[11px] font-semibold text-accent-foreground">{change}</p>}
    </section>
  );
}
export function QueryNotice({
  error,
  loading,
  retry,
}: {
  error?: Error | null;
  loading?: boolean;
  retry?: () => void;
}) {
  if (error)
    return (
      <div className="admin-card my-3 flex flex-wrap items-center gap-3 p-4 text-sm" role="alert">
        <Info className="size-4 text-destructive" />
        {error.message}
        {retry && (
          <Button size="sm" variant="outline" onClick={retry}>
            Retry
          </Button>
        )}
      </div>
    );
  if (loading)
    return (
      <div className="admin-card my-3 space-y-3 p-5" role="status" aria-label="Loading">
        <div className="h-4 w-2/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="h-4 w-3/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      </div>
    );
  return null;
}
export function ExternalLink({ url, children }: { url: string; children: ReactNode }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-semibold text-accent-foreground hover:underline"
    >
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden="true" />
    </a>
  );
}
export function Table({
  headers,
  rows,
  label,
}: {
  headers: string[];
  rows: ReactNode[][];
  label: string;
}) {
  return (
    <div className="overflow-auto rounded-lg border">
      <table className="admin-table admin-responsive-table">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {headers.map((header) => (
              <th scope="col" key={header}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, col) => (
                <td key={headers[col]} data-label={headers[col]}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
