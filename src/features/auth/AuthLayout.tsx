import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { BrandLockup } from '@/components/BrandLogo';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col bg-muted/40">
      <header className="mx-auto flex h-[4.75rem] w-full max-w-[78rem] items-center justify-between border-b px-5 sm:px-8">
        <Link
          to="/welcome"
          className="rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label="Noted home"
        >
          <BrandLockup size={30} />
        </Link>
        <Link
          to="/notes"
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to notes
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:pt-14">
        <div className="w-full max-w-[420px]">
          <div className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
            <span aria-hidden="true" className="mb-4 block h-[3px] w-9 rounded bg-primary" />
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="mt-5 text-center text-sm text-muted-foreground">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
