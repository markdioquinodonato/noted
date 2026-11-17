import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

// Trusted local operator utility. Credentials stay in memory, never stdout,
// command arguments, a frontend bundle, temporary files, or an exported report.
const project = 'bvvyiijyvtjjuqkfjzpo';
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
try {
  const email = arg('--email')?.trim().toLowerCase(),
    confirmation = arg('--confirm-email')?.trim().toLowerCase();
  if (
    !process.argv.includes('--email') ||
    !process.argv.includes('--confirm-email') ||
    !email ||
    email !== confirmation ||
    !/^[a-z0-9][a-z0-9.+]*@gmail\.com$/.test(email)
  )
    throw new Error(
      'Provide --email and matching --confirm-email for the explicitly authorized owner.',
    );
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    const command = `npx --yes supabase@2.90.0 projects api-keys --project-ref ${project} --output json`;
    const result =
      process.platform === 'win32'
        ? spawnSync('cmd.exe', ['/d', '/s', '/c', command], { encoding: 'utf8', windowsHide: true })
        : spawnSync(
            'npx',
            [
              '--yes',
              'supabase@2.90.0',
              'projects',
              'api-keys',
              '--project-ref',
              project,
              '--output',
              'json',
            ],
            { encoding: 'utf8' },
          );
    if (result.status !== 0)
      throw new Error('Trusted Supabase operator authentication is unavailable.');
    key = JSON.parse(result.stdout).find((k) => k.name === 'service_role')?.api_key;
  }
  if (!key) throw new Error('No server credential is available.');
  const sb = createClient(`https://${project}.supabase.co`, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let found;
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('Could not verify existing Auth accounts.');
    found = data.users.find((u) => u.email?.trim().toLowerCase() === email);
    if (found || data.users.length < 1000) break;
    if (page === 100)
      throw new Error('Account verification was truncated; no account was modified.');
  }
  const { error: nominationError } = await sb.rpc('nominate_owner_email', { p_email: email });
  if (nominationError) throw new Error('Could not save the trusted owner nomination.');
  if (found) {
    if (
      !found.email_confirmed_at ||
      found.is_anonymous ||
      (found.banned_until && Date.parse(found.banned_until) > Date.now())
    ) {
      console.log(
        JSON.stringify({
          existingAccount: true,
          ownerProvisioned: false,
          emailVerificationRequired: true,
        }),
      );
    } else {
      const { error } = await sb.rpc('provision_owner_admin', { p_user: found.id });
      if (error) throw new Error('Owner role assignment was rejected.');
      if (process.argv.includes('--send-sign-in')) {
        const { error: signInError } = await sb.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: false,
            emailRedirectTo: 'https://noted-ph.pages.dev/auth/callback?next=/admin',
          },
        });
        if (signInError)
          throw new Error(
            'Owner access is provisioned, but the sign-in email could not be sent. Try again after the Auth email cooldown.',
          );
      }
      console.log(
        JSON.stringify({
          existingAccount: true,
          ownerProvisioned: true,
          signInEmailSent: process.argv.includes('--send-sign-in'),
          mfaRequired: true,
          passwordChanged: false,
        }),
      );
    }
  } else if (process.argv.includes('--invite')) {
    const { error } = await sb.auth.admin.inviteUserByEmail(email, {
      redirectTo: 'https://noted-ph.pages.dev/auth/callback?next=/admin',
    });
    if (error)
      throw new Error(
        'The Auth invitation could not be sent. The owner nomination is saved; register and verify this exact email on the live website, then finish owner setup.',
      );
    console.log(
      JSON.stringify({
        existingAccount: false,
        invitationSent: true,
        ownerProvisioned: false,
        emailVerificationRequired: true,
        mfaRequired: true,
        passwordChanged: false,
      }),
    );
  } else
    console.log(
      JSON.stringify({
        existingAccount: false,
        ownerNominationSaved: true,
        invitationSent: false,
        ownerProvisioned: false,
      }),
    );
} catch (error) {
  console.error(
    error instanceof SyntaxError
      ? 'Could not parse trusted operator credentials. No values were printed.'
      : error.message,
  );
  process.exitCode = 1;
}
