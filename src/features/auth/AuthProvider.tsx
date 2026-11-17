import { activeSavers, flushAllSavers } from '@/features/notes/noteSaver';
import { leaveAccount } from './sessionCleanup';
import { offlineCache } from '@/data/offlineCache';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import type { AuthError, Session, User, SupabaseClient } from '@supabase/supabase-js';
import { requestPasswordRecovery, siteUrl, supabase } from '@/lib/supabase';
import { allowTranscripts } from '@/features/transcription/storage';

export interface AuthContextValue {
  client: SupabaseClient | null;
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  /** True after a password-recovery link was opened in this tab. */
  recovery: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(
    email: string,
    password: string,
    displayName: string,
    next?: string,
  ): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  resendConfirmation(email: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** User-safe auth error text (never echoes tokens or internals). */
export function authErrorMessage(err: unknown): string {
  const e = err as Partial<AuthError> & { message?: string };
  const msg = e?.message ?? '';
  const code = (e as { code?: string })?.code ?? '';
  if (/failed to fetch|network/i.test(msg))
    return 'Cannot reach the server. Check your connection and try again.';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg))
    return 'Incorrect email or password.';
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg))
    return 'Please confirm your email address first. Check your inbox for the verification link.';
  if (code === 'user_already_exists' || /already registered/i.test(msg))
    return 'An account with this email already exists. Try logging in.';
  if (code === 'weak_password' || /password should/i.test(msg))
    return 'Please choose a stronger password (at least 8 characters).';
  if (code === 'over_email_send_rate_limit' || /email.*rate limit/i.test(msg))
    return 'Email delivery is temporarily limited. Please try again later; waiting one minute may not be enough.';
  if (code === 'over_request_rate_limit' || /rate limit/i.test(msg))
    return 'Too many requests. Wait a few minutes before trying again.';
  if (code === 'same_password') return 'Your new password must be different from the old one.';
  // The database rejects non-Gmail sign-ups; Supabase Auth surfaces that as a generic DB error.
  if (/gmail|database error (saving new|updating) user/i.test(msg))
    return 'Only Gmail addresses (@gmail.com) can be used for Noted accounts.';
  if (/session/i.test(msg)) return 'Your reset link has expired. Please request a new one.';
  return 'Something went wrong. Please try again.';
}

export function AuthProvider({
  children,
  client = supabase,
}: {
  children: ReactNode;
  client?: SupabaseClient | null;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!client);
  const [recovery, setRecovery] = useState(false);

  const sessionRef = useRef<Session | null>(null);
  const authRevision = useRef(0);
  useEffect(() => {
    if (!client) return;
    let active = true,
      events = 0;
    const accept = (next: Session | null) => {
      authRevision.current++;
      const previous = sessionRef.current;
      sessionRef.current = next;
      if (previous?.user.id && previous.user.id !== next?.user.id)
        void leaveAccount(previous.user.id).catch(() => undefined);
      if (next?.user.id) {
        offlineCache.allow(next.user.id);
        allowTranscripts(next.user.id);
      }
      setSession(next);
      setLoading(false);
    };
    const generation = events;
    client.auth
      .getSession()
      .then(({ data, error }) => {
        if (active && generation === events) accept(error ? null : data.session);
      })
      .catch(() => {
        if (active && generation === events) accept(null);
      });
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      events++;
      accept(next);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      else if (!next) setRecovery(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  const value = useMemo<AuthContextValue>(() => {
    const need = () => {
      if (!client) throw new Error('Cloud accounts are not configured for this deployment.');
      return client;
    };
    return {
      client,
      configured: !!client,
      loading,
      session,
      user: session?.user ?? null,
      recovery,
      async signIn(email, password) {
        const { error } = await need().auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      },
      async signUp(email, password, displayName, next) {
        const redirect = `${siteUrl()}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`;
        const { data, error } = await need().auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: redirect,
            data: { display_name: displayName.trim().slice(0, 80) },
          },
        });
        if (error) throw error;
        // With email confirmation enabled, no session is returned until verified.
        // Supabase returns a user with no identities for already-registered emails.
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          throw Object.assign(new Error('User already registered'), {
            code: 'user_already_exists',
          });
        }
        return { needsConfirmation: !data.session };
      },
      async signOut() {
        if (!client) return;
        await flushAllSavers();
        if (
          [...activeSavers.values()].some(
            (s) =>
              s.scope === session?.user.id &&
              s.hasUnsavedChanges() &&
              s.getState().localDraftSaved === false,
          )
        )
          throw new Error(
            'Local backup is unavailable. Save or download your pending edits before signing out.',
          );
        const old = sessionRef.current?.user.id ?? session?.user.id;
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) throw new Error('Could not sign out. Check your connection and try again.');
        const revision = authRevision.current;
        // SIGNED_OUT normally triggers accept() and cleanup. Avoid a duplicate
        // cleanup that could block a newer session while the first purge runs.
        if (old && sessionRef.current?.user.id === old)
          await leaveAccount(old).catch(() => undefined);
        if (
          authRevision.current === revision &&
          (!sessionRef.current || sessionRef.current.user.id === old)
        ) {
          sessionRef.current = null;
          setSession(null);
          setRecovery(false);
        }
      },
      async sendPasswordReset(email) {
        need();
        await requestPasswordRecovery(
          email.trim(),
          `${siteUrl()}/auth/callback?next=${encodeURIComponent('/reset-password')}`,
        );
      },
      async updatePassword(password) {
        const { error } = await need().auth.updateUser({ password });
        if (error) throw error;
        setRecovery(false);
      },
      async resendConfirmation(email) {
        const { error } = await need().auth.resend({
          type: 'signup',
          email: email.trim(),
          options: { emailRedirectTo: `${siteUrl()}/auth/callback` },
        });
        if (error) throw error;
      },
    };
  }, [loading, session, recovery, client]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
