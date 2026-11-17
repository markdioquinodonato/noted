import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { ArrowRight, Cloud, HardDrive, MailCheck, Moon, PenLine, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, FullPageSpinner, Spinner } from '@/components/common';
import { BrandLockup, BrandMark } from '@/components/BrandLogo';
import { usePreferences } from '@/features/notes/hooks';
import { useThemeState } from '@/lib/theme';
import { guestMode, postAuthNext, sanitizeNext } from '@/lib/mode';
import { supabase, siteUrl, requestEmailSignIn } from '@/lib/supabase';
import { AuthLayout } from './AuthLayout';
import { GmailField, normalizeGmail, useGmailField } from './gmail';
import { PasswordPairFields, usePasswordPair } from './passwordFields';
import { authErrorMessage, useAuth } from './AuthProvider';
import { useEmailCooldown } from './emailCooldown';
import { completeAuthCallback, confirmEmailSignIn, emailConfirmationFromUrl } from './authCallback';
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

export function WelcomePage() {
  const { user, configured } = useAuth();
  const navigate = useNavigate();
  if (user) return <Navigate to="/notes" replace />;

  function continueAsGuest() {
    guestMode.choose();
    navigate('/notes?dashboard=1');
  }

  return (
    <div className="noted-welcome min-h-full bg-background">
      <header className="mx-auto flex h-[4.75rem] max-w-[78rem] items-center justify-between border-b px-5 sm:px-8">
        <BrandLockup size={32} />
        <div className="flex items-center gap-2">
          {!isDesktopApp() && (
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
              onClick={openDownloadDialog}
            >
              <MonitorDown /> Download Noted
            </Button>
          )}
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-[78rem] px-5 sm:px-8">
        <section className="noted-welcome-hero grid items-center gap-8 py-10 sm:py-16 lg:grid-cols-[1fr_.84fr] lg:gap-16 lg:py-24">
          <div className="min-w-0">
            <h1 className="max-w-[12ch] text-[clamp(2.55rem,5.6vw,5rem)] leading-[1.01] font-[730] tracking-[-.065em] text-balance">
              A place for what you want to keep.
            </h1>
            <p className="mt-5 max-w-md text-[clamp(.98rem,2vw,1.12rem)] leading-relaxed text-muted-foreground">
              Write a note, make a checklist, or capture something from your camera or microphone.
              Noted saves as you go.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-2.5">
              <Button size="lg" className="h-11 rounded-lg px-4" onClick={continueAsGuest}>
                <PenLine aria-hidden="true" /> Continue as Guest <ArrowRight aria-hidden="true" />
              </Button>
              <Button size="lg" variant="outline" className="h-11 rounded-lg" asChild>
                <Link to="/login">Log In</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Want to sync across devices?{' '}
              <Link
                to="/register"
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                Create an Account
              </Link>
            </p>
            {!configured && (
              <div className="mt-4 max-w-md text-sm">
                <NotConfigured />
              </div>
            )}
          </div>

          <div className="noted-welcome-mark hidden lg:grid" aria-hidden="true">
            <div className="noted-welcome-paper">
              <BrandMark size={124} />
            </div>
          </div>
        </section>

        <section
          aria-label="Using Noted"
          className="grid gap-5 border-t py-7 text-sm sm:grid-cols-2 lg:grid-cols-3"
        >
          <div className="flex items-start gap-3">
            <HardDrive className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <h2 className="font-semibold">Guest mode</h2>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                Works offline. Notes stay on this device. Clearing site data removes guest notes
                from this browser.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Cloud className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <h2 className="font-semibold">Cloud account</h2>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                Sign in to sync your notes across your computer and phone.
              </p>
            </div>
          </div>
          {!isDesktopApp() && (
            <div className="flex items-start gap-3">
              <MonitorDown className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <button
                  type="button"
                  className="font-semibold hover:underline"
                  onClick={openDownloadDialog}
                >
                  Download Noted for Android, Windows &amp; macOS
                </button>
                <p className="mt-1 leading-relaxed text-muted-foreground">
                  Open the download options for your device.
                </p>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
export function LoginPage() {
  const emailCooldown = useEmailCooldown();
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
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy || emailCooldown.seconds > 0}
            onClick={async () => {
              if (busy || emailCooldown.seconds > 0) return;
              setError(null);
              setNotice(null);
              if (emailField.validate()) return;
              setBusy(true);
              emailCooldown.start();
              try {
                postAuthNext.set(next);
                await requestEmailSignIn(
                  email,
                  `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
                );
                setNotice(
                  'A fresh sign-in email was requested for this existing account. Open only the newest link. It can be used once; no password is required.',
                );
              } catch (error) {
                setError(authErrorMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            {emailCooldown.seconds > 0
              ? `Request another email in ${emailCooldown.seconds}s`
              : 'Email me a sign-in link'}
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
  const { sendPasswordReset, configured, user } = useAuth();
  const emailCooldown = useEmailCooldown();
  const emailField = useGmailField();
  const email = normalizeGmail(emailField.value);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || emailCooldown.seconds > 0) return;
    setError(null);
    if (emailField.validate()) return;
    setBusy(true);
    emailCooldown.start();
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
      subtitle={
        user
          ? 'Use your signed-in account to choose a new password.'
          : 'We’ll email you a secure link to choose a new password.'
      }
      footer={
        <Link className="font-medium text-primary hover:underline" to="/login">
          Back to log in
        </Link>
      }
    >
      {!configured ? (
        <NotConfigured />
      ) : user ? (
        <div className="space-y-4">
          <p className="text-sm">Signed in as {user.email}. No new email is needed.</p>
          <Button className="w-full" asChild>
            <Link to="/reset-password">Choose a new password</Link>
          </Button>
        </div>
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
          <Button type="submit" className="w-full" disabled={busy || emailCooldown.seconds > 0}>
            {busy && <Spinner />}
            {emailCooldown.seconds > 0
              ? `Request another email in ${emailCooldown.seconds}s`
              : 'Send reset link'}
          </Button>
          {emailCooldown.seconds > 0 && (
            <p role="status" className="text-sm text-muted-foreground">
              Please wait before requesting another email. The email delivery limit may last longer
              than this countdown.
            </p>
          )}
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
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [confirmation] = useState(() => emailConfirmationFromUrl(new URL(window.location.href)));
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (confirmation) {
      // Do not consume a one-time token during a GET, preview, or effect replay.
      // Keep it only in component memory until the person explicitly confirms.
      const clean = new URL(window.location.href);
      clean.hash = '';
      clean.searchParams.delete('token_hash');
      clean.searchParams.delete('type');
      window.history.replaceState(window.history.state, '', clean.pathname + clean.search);
      return;
    }
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
      let session;
      try {
        session = await completeAuthCallback(supabase, new URL(window.location.href), () => {
          window.history.replaceState(
            window.history.state,
            '',
            window.location.pathname + window.location.search,
          );
        });
      } catch {
        if (!cancelled)
          setError('This link is invalid or has expired. Please request a fresh sign-in email.');
        return;
      }
      if (cancelled) return;
      if (!session) {
        setError('We could not sign you in from this link. Please log in.');
        return;
      }
      const next = sanitizeNext(params.get('next') ?? postAuthNext.take());
      navigate(next, { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [params, navigate, confirmation]);

  if (error) {
    return (
      <AuthLayout title="Couldn’t complete sign-in">
        <Alert tone="error">{error}</Alert>
        {user && (
          <>
            <p className="mt-4 text-sm">Already signed in as {user.email}.</p>
            <Button className="mt-4 w-full" asChild>
              <Link to={sanitizeNext(params.get('next'))}>Continue with this account</Link>
            </Button>
          </>
        )}
        <Button className="mt-4 w-full" asChild>
          <Link to={`/login?next=${encodeURIComponent(sanitizeNext(params.get('next')))}`}>
            Go to log in
          </Link>
        </Button>
      </AuthLayout>
    );
  }
  if (confirmation) {
    return (
      <AuthLayout title="Confirm your sign-in">
        <p className="text-sm text-muted-foreground">
          Continue only if you requested this sign-in email for your Noted account.
        </p>
        <Button
          className="mt-4 w-full"
          disabled={confirming}
          onClick={async () => {
            if (!supabase || confirming) return;
            setConfirming(true);
            try {
              await confirmEmailSignIn(supabase, confirmation);
              navigate(sanitizeNext(params.get('next') ?? postAuthNext.take()), { replace: true });
            } catch {
              setError('This sign-in link has expired or was already used. Request a fresh email.');
            } finally {
              setConfirming(false);
            }
          }}
        >
          {confirming && <Spinner />} Confirm sign-in
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
