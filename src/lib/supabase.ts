import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const key = (
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
)?.trim();

/**
 * Refuse to run with a privileged key in the browser. Only the publishable
 * (anon) key is acceptable client-side; RLS is what protects the data.
 */
function isPrivilegedKey(k: string): boolean {
  if (k.startsWith('sb_secret_')) return true;
  const parts = k.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload?.role === 'service_role';
    } catch {
      return false;
    }
  }
  return false;
}

function configured(): boolean {
  if (!url || !key) return false;
  if (url.includes('your-project-ref') || key.includes('xxxxxxxx')) return false;
  if (isPrivilegedKey(key)) {
    console.error(
      '[Noted] A Supabase secret/service-role key was provided to the browser build. ' +
        'Cloud features are disabled. Use the publishable (anon) key only.',
    );
    return false;
  }
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return false;
  } catch {
    return false;
  }
  return true;
}

export const supabase: SupabaseClient | null = configured()
  ? createClient(url!, key!, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'noted-auth',
      },
    })
  : null;
export const isCloudConfigured = !!supabase;

export function siteUrl(): string {
  const configuredUrl = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim();
  const origin =
    /^https?:$/.test(window.location.protocol) &&
    !/tauri\.localhost$/.test(window.location.hostname)
      ? window.location.origin
      : 'https://noted-ph.pages.dev';
  // Email links (verification / password reset) must open the public website,
  // never the desktop app's internal origin.
  return (configuredUrl || origin).replace(/\/$/, '');
}
