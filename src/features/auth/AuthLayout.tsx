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
    <div className="relative flex min-h-full flex-col overflow-hidden bg-background">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-48 left-1/2 h-[480px] w-[760px] -translate-x-1/2 rounded-full bg-primary/15 blur-[110px]" />
        <div className="absolute -right-32 bottom-0 h-80 w-80 rounded-full bg-violet-500/10 blur-[100px]" />
      </div>
      <header className="relative z-10 mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link
          to="/welcome"
          className="rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label="Noted home"
        >
          <BrandLockup size={30} />
        </Link>
        <Link
          to="/notes"
          className="inline-flex items-center gap-1.5 rounded-full border bg-card/70 px-3 py-1.5 text-sm text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to notes
        </Link>
      </header>
      <main className="relative z-10 flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:pt-14">
        <div className="w-full max-w-[420px]">
          <div className="rounded-3xl border bg-card/90 p-6 shadow-xl shadow-slate-900/5 backdrop-blur-xl sm:p-8 dark:shadow-black/30">
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
