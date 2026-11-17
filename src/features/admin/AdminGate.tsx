import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AdminGate() {
  const [setupError, setSetupError] = useState(''),
    [settingUp, setSettingUp] = useState(false);
  const { client, user, session } = useAuth();
  const location = useLocation();
  const scope =
    location.pathname.replace(/\/+$/, '').toLowerCase() === '/admin/transcription'
      ? 'transcription'
      : 'central';
  const access = useQuery({
    queryKey: ['admin-access', user?.id, scope, session?.expires_at, session?.user.last_sign_in_at],
    retry: false,
    gcTime: 0,
    queryFn: async () => {
      const { data, error } = await client!.rpc('admin_access', { p_scope: scope });
      if (error) throw new Error('Administrator access could not be verified.');
      return data as {
        member: boolean;
        authorized: boolean;
        mfa_required: boolean;
        owner_setup_available?: boolean;
        central_authorized?: boolean;
      };
    },
  });
  if (access.isLoading)
    return (
      <p role="status" className="p-6">
        Checking administrator access…
      </p>
    );
  if (access.error || !access.data?.member)
    return (
      <main className="mx-auto max-w-xl space-y-4 p-6">
        <h1 className="text-xl font-semibold">Administrator access required</h1>
        <p role="alert">
          {access.error?.message ??
            'This account has not been provisioned as an administrator. Only an operator-confirmed owner nomination can activate administrator setup.'}
        </p>
        <p className="text-sm">
          Your signed-in account: {user?.email ?? user?.id}. An operator must verify your explicit
          identity confirmation before provisioning.
        </p>
        {access.data?.owner_setup_available && (
          <Button
            disabled={settingUp}
            onClick={async () => {
              setSettingUp(true);
              setSetupError('');
              try {
                const { error } = await client!.rpc('complete_owner_setup');
                if (error) throw new Error('Could not activate the verified owner nomination.');
                await access.refetch();
              } catch (e) {
                setSetupError((e as Error).message);
              } finally {
                setSettingUp(false);
              }
            }}
          >
            Activate my verified owner setup
          </Button>
        )}
        {setupError && <p role="alert">{setupError}</p>}
        <Button asChild variant="outline">
          <Link to="/notes">Back to notes</Link>
        </Button>
      </main>
    );
  if (!access.data.authorized) return <AdminMfa onVerified={() => void access.refetch()} />;
  return (
    <Outlet context={{ central: scope === 'central' || access.data.central_authorized === true }} />
  );
}
function AdminMfa({ onVerified }: { onVerified: () => void }) {
  const { client, user } = useAuth();
  const [factor, setFactor] = useState(''),
    [qr, setQr] = useState(''),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const factors = useQuery({
    queryKey: ['admin-factors', user?.id],
    retry: false,
    gcTime: 0,
    queryFn: async () => {
      const { data, error } = await client!.auth.mfa.listFactors();
      if (error) throw new Error('Could not load your MFA factors.');
      return data.totp.filter((f) => f.status === 'verified');
    },
  });
  const verified = factors.data ?? [];
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <Button asChild variant="outline">
        <Link to="/notes">Back to notes</Link>
      </Button>
      <h1 className="text-2xl font-semibold">Secure administrator sign-in</h1>
      <p>
        Administrator access requires a verified authenticator code. Notes and Guest Mode continue
        to work normally.
      </p>
      {factors.isLoading && <p role="status">Loading MFA…</p>}
      {(error || factors.error) && (
        <p role="alert" className="text-destructive">
          {error || factors.error?.message}
        </p>
      )}
      {!factors.isLoading && !factors.error && verified.length === 0 && !factor && (
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const { data, error } = await client!.auth.mfa.enroll({
                factorType: 'totp',
                friendlyName: `Noted administrator ${Date.now()}`,
                issuer: 'Noted',
              });
              if (error) throw error;
              setFactor(data.id);
              const image = data.totp.qr_code;
              setQr(
                image.startsWith('data:image/svg+xml')
                  ? image
                  : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image)}`,
              );
            } catch {
              setError(
                'Could not enroll MFA. Check that TOTP enrollment is enabled in Supabase Auth.',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Set up authenticator
        </Button>
      )}
      {qr && (
        <>
          <p className="text-sm">
            Scan this private QR code in your authenticator app. It is shown only in this session;
            do not share it.
          </p>
          <img
            src={qr}
            alt="Private MFA enrollment QR code"
            className="mx-auto size-52 rounded bg-white p-2"
          />
        </>
      )}
      {verified.length > 1 && (
        <label className="block text-sm">
          Authenticator
          <select
            aria-label="Authenticator"
            className="w-full rounded border bg-background p-2"
            value={factor || verified[0].id}
            onChange={(e) => setFactor(e.target.value)}
          >
            {verified.map((f) => (
              <option key={f.id} value={f.id}>
                {f.friendly_name ?? 'Authenticator'}
              </option>
            ))}
          </select>
        </label>
      )}
      {(factor || verified.length > 0) && (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const { error } = await client!.auth.mfa.challengeAndVerify({
                factorId: factor || verified[0].id,
                code,
              });
              if (error) throw error;
              setCode('');
              setQr('');
              onVerified();
            } catch {
              setError(
                'MFA verification failed. Enter a fresh six-digit code from your authenticator.',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="block text-sm">
            Six-digit authenticator code
            <Input
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
            />
          </label>
          <Button disabled={busy || code.length !== 6}>Verify and open dashboard</Button>
        </form>
      )}
    </main>
  );
}
