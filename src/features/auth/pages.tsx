import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  ArrowRight,
  BellRing,
  Check,
  Cloud,
  FolderTree,
  HardDrive,
  Info,
  LockKeyhole,
  MailCheck,
  Moon,
  NotebookPen,
  Palette,
  PenLine,
  ScanText,
  ShieldCheck,
  Sparkles,
  Sun,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, FullPageSpinner, Spinner } from '@/components/common';
import { BrandLockup, BrandMark } from '@/components/BrandLogo';
import { usePreferences } from '@/features/notes/hooks';
import { useThemeState } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { guestMode, postAuthNext, sanitizeNext } from '@/lib/mode';
import { supabase } from '@/lib/supabase';
import { AuthLayout } from './AuthLayout';
import { GmailField, normalizeGmail, useGmailField } from './gmail';
import { PasswordPairFields, usePasswordPair } from './passwordFields';
import { authErrorMessage, useAuth } from './AuthProvider';
import { openDownloadDialog } from '@/features/download/DownloadDialog';
import { isDesktopApp } from '@/lib/platform';
import { MonitorDown } from 'lucide-react';

function NotConfigured() {
  return (
    <Alert tone="info">
      Cloud accounts aren’t configured for this deployment yet. You can keep using Noted as a guest
      — your notes are saved on this device.
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------
const FEATURES = [
  {
    icon: ScanText,
    title: 'Scan text with your camera',
    body: 'Point at a page and Noted reads it automatically — right inside the note you’re writing.',
    tone: 'from-sky-500/15 text-sky-600 dark:text-sky-400',
  },
  {
    icon: PenLine,
    title: 'A writing space that gets out of the way',
    body: 'Headings, checklists, tables, highlights and links with a clean, focused editor.',
    tone: 'from-violet-500/15 text-violet-600 dark:text-violet-400',
  },
  {
    icon: Palette,
    title: 'Color-coded notes',
    body: 'Give each note its own color theme so ideas, school and work are easy to tell apart.',
    tone: 'from-rose-500/15 text-rose-600 dark:text-rose-400',
  },
  {
    icon: FolderTree,
    title: 'Folders, tags & search',
    body: 'Organize everything your way and find any note in a keystroke.',
    tone: 'from-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  {
    icon: BellRing,
    title: 'Reminders & voice',
    body: 'Set reminders on notes, record voice memos and dictate when typing is slow.',
    tone: 'from-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  {
    icon: ShieldCheck,
    title: 'Private and offline-ready',
    body: 'Guest notes never leave your device. Sync to the cloud only if you choose to.',
    tone: 'from-blue-500/15 text-blue-600 dark:text-blue-400',
  },
] as const;

function ThemeToggle() {
  const { resolved } = useThemeState();
  const { update } = usePreferences();
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full"
      aria-label={`Switch to ${next} theme`}
      onClick={() => update({ theme: next })}
    >
      {resolved === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}

/** Decorative product preview built from real UI primitives (no screenshots). */
function AppPreview() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[560px] select-none">
      <div className="absolute -inset-6 rounded-[2.5rem] bg-gradient-to-tr from-primary/25 via-violet-500/15 to-sky-400/20 blur-3xl" />
      <div className="relative overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-slate-900/15 dark:shadow-black/40">
        <div className="flex h-9 items-center gap-1.5 border-b bg-muted/60 px-3">
          <span className="size-2.5 rounded-full bg-rose-400/80" />
          <span className="size-2.5 rounded-full bg-amber-400/80" />
          <span className="size-2.5 rounded-full bg-emerald-400/80" />
          <span className="ml-3 h-4 w-40 rounded-md bg-background/80" />
        </div>
        <div className="grid grid-cols-[120px_1fr] sm:grid-cols-[150px_1fr]">
          <div className="space-y-1.5 border-r bg-sidebar p-3">
            <div className="mb-3 flex items-center gap-1.5">
              <BrandMark size={18} />
              <span className="text-xs font-bold">Noted</span>
            </div>
            <div className="mb-2 flex h-6 items-center gap-1 rounded-md bg-primary px-2 text-[0.6rem] font-semibold text-primary-foreground">
              + New note
            </div>
            {['All Notes', 'Favorites', 'Reminders', 'Recent'].map((l, i) => (
              <div
                key={l}
                className={cn(
                  'rounded-md px-2 py-1 text-[0.65rem]',
                  i === 0 ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground',
                )}
              >
                {l}
              </div>
            ))}
            <p className="px-2 pt-2 text-[0.55rem] font-semibold tracking-wider text-muted-foreground uppercase">
              Folders
            </p>
            {[
              ['School', 'var(--note-sky)'],
              ['Work', 'var(--note-violet)'],
              ['Personal', 'var(--note-rose)'],
            ].map(([l, c]) => (
              <div key={l} className="flex items-center gap-1.5 px-2 py-0.5 text-[0.65rem]">
                <span className="size-2 rounded-sm" style={{ background: c }} />
                {l}
              </div>
            ))}
          </div>
          <div data-note-color="sage" className="bg-background p-4 text-foreground sm:p-5">
            <div className="mb-3 flex gap-1">
              {['B', 'I', 'U', 'H1', '☑'].map((t) => (
                <span
                  key={t}
                  className="grid h-5 min-w-5 place-items-center rounded border bg-card px-1 text-[0.55rem] font-semibold text-muted-foreground"
                >
                  {t}
                </span>
              ))}
              <span className="ml-auto inline-flex h-5 items-center gap-1 rounded bg-primary px-1.5 text-[0.55rem] font-semibold text-primary-foreground">
                <ScanText className="size-2.5" /> Scan
              </span>
            </div>
            <p className="text-sm font-bold sm:text-base">Biology review ✏️</p>
            <p className="mt-1 text-[0.6rem] text-muted-foreground">Edited just now</p>
            <p className="mt-3 text-[0.7rem] leading-relaxed">
              Photosynthesis turns light energy into chemical energy stored in glucose.
            </p>
            <div className="mt-3 space-y-1.5 text-[0.7rem]">
              {[
                ['Read chapter 4', true],
                ['Summarize the diagrams', true],
                ['Quiz on Friday', false],
              ].map(([t, done]) => (
                <div key={t as string} className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'grid size-3 place-items-center rounded-[3px] border',
                      done && 'border-primary bg-primary text-primary-foreground',
                    )}
                  >
                    {done && <Check className="size-2" strokeWidth={4} />}
                  </span>
                  <span className={cn(done && 'text-muted-foreground line-through')}>{t}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-md border-l-2 border-primary bg-primary/5 px-2 py-1.5 text-[0.65rem] text-muted-foreground">
              “Chlorophyll absorbs mostly blue and red light.”
            </div>
          </div>
        </div>
      </div>

      {/* Floating chips */}
      <div className="float-slow absolute -bottom-8 -left-3 flex items-center gap-2.5 rounded-xl border bg-card/95 p-2.5 pr-4 shadow-xl backdrop-blur sm:-left-8">
        <span className="grid size-8 place-items-center rounded-lg bg-emerald-500 text-white">
          <ScanText className="size-4" />
        </span>
        <span>
          <span className="block text-xs font-semibold">Text detected</span>
          <span className="block text-[0.65rem] text-muted-foreground">Added to your note</span>
        </span>
      </div>
      <div
        className="float-slow absolute -top-4 -right-2 flex items-center gap-2 rounded-xl border bg-card/95 p-2 pr-3 shadow-xl backdrop-blur sm:-right-6"
        style={{ animationDelay: '-3s' }}
      >
        <span className="grid size-7 place-items-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <BellRing className="size-3.5" />
        </span>
        <span className="text-[0.7rem] font-medium">Quiz · Fri 8:00 AM</span>
      </div>
    </div>
  );
}

export function WelcomePage() {
  const { user, configured } = useAuth();
  const navigate = useNavigate();
  if (user) return <Navigate to="/notes" replace />;

  const continueAsGuest = () => {
    guestMode.choose();
    navigate('/notes?dashboard=1');
  };

  return (
    <div className="relative min-h-full overflow-x-hidden bg-background">
      {/* Background */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-primary/15 blur-[120px] dark:bg-primary/20" />
        <div className="absolute top-[30%] -right-40 h-[420px] w-[420px] rounded-full bg-violet-500/10 blur-[110px]" />
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.25]"
          style={{
            backgroundImage:
              'linear-gradient(to right, color-mix(in oklab, var(--border) 70%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--border) 70%, transparent) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage: 'radial-gradient(ellipse 70% 55% at 50% 0%, #000 40%, transparent 100%)',
            WebkitMaskImage:
              'radial-gradient(ellipse 70% 55% at 50% 0%, #000 40%, transparent 100%)',
          }}
        />
      </div>

      <header className="relative z-10 mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <BrandLockup size={30} />
        <ThemeToggle />
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 pt-8 pb-20 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
          <div className="text-center lg:text-left">
            <span className="inline-flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Free · Private · Works offline
            </span>
            <h1 className="mt-6 text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              {isDesktopApp() ? (
                <>
                  Welcome to{' '}
                  <span className="bg-gradient-to-r from-primary via-blue-500 to-violet-500 bg-clip-text text-transparent">
                    Noted
                  </span>
                </>
              ) : (
                <>
                  Your thoughts,{' '}
                  <span className="bg-gradient-to-r from-primary via-blue-500 to-violet-500 bg-clip-text text-transparent">
                    instantly noted.
                  </span>
                </>
              )}
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg lg:mx-0">
              A fast, beautiful notepad. Start writing right away — scan text with your camera,
              color-code your notes, and create a free account only if you want them on every
              device.
            </p>

            <div className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:flex-row lg:mx-0">
              <Button
                size="lg"
                onClick={continueAsGuest}
                className="group h-12 rounded-xl sm:flex-1 text-[0.95rem] shadow-lg shadow-primary/30"
              >
                <NotebookPen aria-hidden="true" /> Continue as Guest
                <ArrowRight
                  className="transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 rounded-xl sm:flex-1 bg-card/70 text-[0.95rem] backdrop-blur"
                asChild
              >
                <Link to="/register">Create an Account</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link to="/login" className="font-semibold text-primary hover:underline">
                Log In
              </Link>
            </p>
            {!isDesktopApp() && (
              <button
                type="button"
                onClick={openDownloadDialog}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                <MonitorDown className="size-4" aria-hidden="true" /> Get Noted for Windows or macOS
              </button>
            )}

            <div className="mx-auto mt-8 grid max-w-md gap-2.5 text-left text-sm sm:grid-cols-2 lg:mx-0">
              <div className="flex gap-3 rounded-xl border bg-card/60 p-3 backdrop-blur">
                <HardDrive className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  <strong className="font-semibold">Guest mode</strong>
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    Notes stay in this browser. Clearing site data removes them.
                  </span>
                </span>
              </div>
              <div className="flex gap-3 rounded-xl border bg-card/60 p-3 backdrop-blur">
                <Cloud className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  <strong className="font-semibold">Free account</strong>
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    Private cloud sync across your computer and phone.
                  </span>
                </span>
              </div>
            </div>
            {!configured && (
              <p className="mx-auto mt-4 flex max-w-md items-start gap-2 text-left text-xs leading-relaxed text-muted-foreground lg:mx-0">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                Cloud accounts aren’t configured for this deployment yet. You can keep using Noted
                as a guest — your notes are saved on this device.
              </p>
            )}
          </div>

          <AppPreview />
        </section>

        {/* Features */}
        <section className="border-t bg-muted/30" aria-labelledby="features-h">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-semibold tracking-widest text-primary uppercase">
                Everything you need
              </p>
              <h2
                id="features-h"
                className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl"
              >
                Capture anything. Find it in seconds.
              </h2>
              <p className="mt-4 text-muted-foreground">
                Noted keeps the essentials simple and puts powerful tools one tap away.
              </p>
            </div>
            <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body, tone }) => (
                <li
                  key={title}
                  className="group rounded-2xl border bg-card p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/5"
                >
                  <span
                    className={cn(
                      'grid size-11 place-items-center rounded-xl bg-gradient-to-br to-transparent',
                      tone,
                    )}
                  >
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-blue-600 to-violet-600 px-6 py-14 text-center text-white shadow-2xl shadow-primary/25 sm:px-12">
            <div
              aria-hidden="true"
              className="absolute -top-24 -right-24 size-72 rounded-full bg-white/10 blur-2xl"
            />
            <BrandMark size={56} className="mx-auto drop-shadow-lg" />
            <h2 className="mt-5 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              Start writing in one click.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-white/80">
              No sign-up needed. Your first note is a tap away.
            </p>
            <Button
              size="lg"
              onClick={continueAsGuest}
              className="mt-8 h-12 rounded-xl bg-white px-6 text-[0.95rem] text-blue-700 shadow-lg hover:bg-white/90"
            >
              <Sparkles aria-hidden="true" /> Start writing now
            </Button>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-6 text-xs text-muted-foreground sm:flex-row sm:px-8">
          <BrandLockup size={20} />
          <span className="inline-flex items-center gap-1.5">
            <LockKeyhole className="size-3.5" aria-hidden="true" />
            Your notes are private to you.
          </span>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
export function LoginPage() {
  const { signIn, user, configured, resendConfirmation } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = sanitizeNext(params.get('next'));
  const emailField = useGmailField();
  const email = normalizeGmail(emailField.value);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);

  if (user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (emailField.validate()) return;
    if (!password) return setError('Enter your password.');
    setBusy(true);
    try {
      await signIn(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      const msg = authErrorMessage(err);
      setUnconfirmed(/confirm your email/i.test(msg));
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await resendConfirmation(email);
      setNotice('Verification email sent. Check your inbox.');
      setError(null);
    } catch (err) {
      setError(authErrorMessage(err));
    }
  };

  return (
    <AuthLayout
      title="Log in to Noted"
      subtitle="Access your cloud-saved notes on any device."
      footer={
        <>
          New here?{' '}
          <Link
            className="font-medium text-primary hover:underline"
            to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}
          >
            Create a free account
          </Link>
        </>
      }
    >
      {!configured ? (
        <NotConfigured />
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && (
            <Alert tone="error">
              {error}
              {unconfirmed && (
                <button type="button" onClick={resend} className="ml-1 font-medium underline">
                  Resend email
                </button>
              )}
            </Alert>
          )}
          {notice && <Alert tone="success">{notice}</Alert>}
          <GmailField field={emailField} autoFocus />
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                to="/forgot-password"
                className="text-xs font-medium text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Spinner />} Log in
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------
export function RegisterPage() {
  const { signUp, user, configured } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = sanitizeNext(params.get('next'));
  const [name, setName] = useState('');
  const emailField = useGmailField();
  const email = normalizeGmail(emailField.value);
  const pair = usePasswordPair();
  const password = pair.password;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (user && !sentTo) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const emailBad = !!emailField.validate();
    const passwordBad = pair.validate();
    if (emailBad || passwordBad) return;
    setBusy(true);
    try {
      postAuthNext.set(next);
      const { needsConfirmation } = await signUp(email, password, name, next);
      if (needsConfirmation) setSentTo(email);
      else navigate(next, { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={
          <>
            We sent a verification link to <strong className="text-foreground">{sentTo}</strong>.
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="flex items-center gap-3 rounded-lg bg-accent p-3 text-accent-foreground">
            <MailCheck className="size-5 shrink-0" aria-hidden="true" />
            Open the link to verify your account. You’ll be signed in automatically.
          </div>
          <p className="text-muted-foreground">
            Your guest notes stay safe on this device in the meantime.
          </p>
          <Button variant="outline" className="w-full" asChild>
            <Link to="/notes">Back to my notes</Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your free account"
      subtitle="Save notes to the cloud and open them on any device."
      footer={
        <>
          Already have an account?{' '}
          <Link
            className="font-medium text-primary hover:underline"
            to={`/login${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}
          >
            Log in
          </Link>
        </>
      }
    >
      {!configured ? (
        <NotConfigured />
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="space-y-1.5">
            <Label htmlFor="name">
              Display name <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="name"
              autoComplete="name"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <GmailField field={emailField} />
          <PasswordPairFields pair={pair} />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Spinner />} Create account
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------
export function ForgotPasswordPage() {
  const { sendPasswordReset, configured } = useAuth();
  const emailField = useGmailField();
  const email = normalizeGmail(emailField.value);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (emailField.validate()) return;
    setBusy(true);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We’ll email you a secure link to choose a new password."
      footer={
        <Link className="font-medium text-primary hover:underline" to="/login">
          Back to log in
        </Link>
      }
    >
      {!configured ? (
        <NotConfigured />
      ) : sent ? (
        // Same message whether or not the account exists (prevents account enumeration).
        <Alert tone="success">
          If an account exists for {email}, a reset link is on its way. Check your inbox and spam
          folder.
        </Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <GmailField field={emailField} autoFocus />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Spinner />} Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------
// Reset password (after following the email link)
// ---------------------------------------------------------------------------
export function ResetPasswordPage() {
  const { updatePassword, session, loading } = useAuth();
  const navigate = useNavigate();
  const pair = usePasswordPair();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <FullPageSpinner />;

  if (!session) {
    return (
      <AuthLayout
        title="Link expired"
        subtitle="This password reset link is invalid or has expired."
      >
        <Button className="w-full" asChild>
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </AuthLayout>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pair.validate()) return;
    setBusy(true);
    try {
      await updatePassword(pair.password);
      navigate('/notes', { replace: true, state: { toast: 'Password updated.' } });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Choose a new password" subtitle={session.user.email}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <PasswordPairFields
          pair={pair}
          passwordLabel="New password"
          confirmLabel="Confirm new password"
          autoFocus
        />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Spinner />} Update password
        </Button>
      </form>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------
// Auth callback (email verification, password recovery; PKCE code exchange)
// ---------------------------------------------------------------------------
export function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const urlError = params.get('error_description') || params.get('error');
      if (urlError) {
        setError('This link is invalid or has expired. Please try again.');
        return;
      }
      if (!supabase) {
        setError('Cloud accounts are not configured.');
        return;
      }
      const code = params.get('code');
      // detectSessionInUrl usually exchanges the code already; do it explicitly if not.
      let { data } = await supabase.auth.getSession();
      if (!data.session && code) {
        const res = await supabase.auth.exchangeCodeForSession(code);
        if (res.error) {
          if (!cancelled) setError('This link is invalid or has expired. Please try again.');
          return;
        }
        data = { session: res.data.session };
      }
      if (cancelled) return;
      if (!data.session) {
        setError('We could not sign you in from this link. Please log in.');
        return;
      }
      const next = sanitizeNext(params.get('next') ?? postAuthNext.take());
      navigate(next, { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [params, navigate]);

  if (error) {
    return (
      <AuthLayout title="Couldn’t complete sign-in">
        <Alert tone="error">{error}</Alert>
        <Button className="mt-4 w-full" asChild>
          <Link to="/login">Go to log in</Link>
        </Button>
      </AuthLayout>
    );
  }
  return <FullPageSpinner />;
}

// ---------------------------------------------------------------------------
// Route guard
// ---------------------------------------------------------------------------
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user)
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  return <>{children}</>;
}

export function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (user || guestMode.isChosen()) return <Navigate to="/notes" replace />;
  return <Navigate to="/welcome" replace />;
}
