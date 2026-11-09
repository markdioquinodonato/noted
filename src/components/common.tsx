import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Alert({
  tone = 'info',
  children,
  className,
}: {
  tone?: 'info' | 'error' | 'success';
  children: ReactNode;
  className?: string;
}) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'success' ? CheckCircle2 : Info;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
        tone === 'error' && 'border-destructive/30 bg-destructive/8 text-destructive',
        tone === 'success' && 'border-success/30 bg-success/8 text-success',
        tone === 'info' && 'border-primary/20 bg-accent text-accent-foreground',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 leading-relaxed">{children}</div>
    </div>
  );
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden="true" />
    </span>
  );
}

export function FullPageSpinner() {
  return (
    <div className="grid h-full place-items-center">
      <Spinner className="size-6 text-muted-foreground" />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}
    >
      <div className="mb-3 grid size-12 place-items-center rounded-xl bg-accent text-primary [&_svg]:size-6">
        {icon}
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-xs text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-[0.7rem] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

export const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';
