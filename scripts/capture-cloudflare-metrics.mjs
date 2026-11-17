import { spawnSync } from 'node:child_process';
import { cloudflareMetrics } from '../supabase/functions/admin-providers/core.ts';
// Operator-only snapshot. OAuth stays in this process; only aggregate metrics
// are printed. Never transfer a desktop OAuth token into Edge Function secrets.
try {
  let token = process.env.CLOUDFLARE_ANALYTICS_TOKEN;
  if (!token && process.argv.includes('--local-wrangler-auth')) {
    const result =
      process.platform === 'win32'
        ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npx --yes wrangler@4.162.0 auth token --json'], {
            encoding: 'utf8',
            windowsHide: true,
          })
        : spawnSync('npx', ['--yes', 'wrangler@4.162.0', 'auth', 'token', '--json'], {
            encoding: 'utf8',
          });
    if (result.status !== 0) throw new Error();
    const output = JSON.parse(result.stdout);
    token = output.token;
  }
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) throw new Error();
  const metrics = await cloudflareMetrics(
    token,
    account,
    process.env.CLOUDFLARE_PAGES_PROJECT ?? 'noted-ph',
    process.env.CLOUDFLARE_WORKER_SCRIPT,
  );
  console.log(JSON.stringify(metrics, null, 2));
} catch {
  console.error(
    'Could not collect authorized Cloudflare metrics. Check local authentication or scoped read credentials. No credential values were printed.',
  );
  process.exitCode = 1;
}
