import { supabase } from '@/lib/supabase';
import { detectOS, isDesktopApp } from '@/lib/platform';
import { readBrowserValue, writeBrowserValue } from '@/lib/browserStorage';
export type OperationalCode =
  | 'activity'
  | 'uncaught_error'
  | 'unhandled_rejection'
  | 'route_error'
  | 'sync_failed'
  | 'sync_offline'
  | 'sync_conflict';
const recent = new Map<string, number>();
export function telemetryEnabled() {
  return readBrowserValue('noted:operational-metrics') === 'true';
}
export function setTelemetryEnabled(enabled: boolean) {
  writeBrowserValue('noted:operational-metrics', String(enabled));
  window.dispatchEvent(new Event('noted:telemetry-preference'));
}
export async function reportOperationalEvent(code: OperationalCode) {
  try {
    if (!telemetryEnabled() || !supabase || !navigator.onLine) return;
    const now = Date.now();
    if (now - (recent.get(code) ?? 0) < 60000) return;
    recent.set(code, now);
    const day = new Date().toISOString().slice(0, 10),
      stored = readBrowserValue('noted:guest-metrics-session');
    let visitor: { day: string; id: string } | null = null;
    try {
      visitor = stored ? JSON.parse(stored) : null;
    } catch {
      /* optional storage */
    }
    if (visitor?.day !== day || !visitor.id) {
      visitor = { day, id: crypto.randomUUID() };
      writeBrowserValue('noted:guest-metrics-session', JSON.stringify(visitor));
    }
    const { data } = await supabase.auth.getSession();
    await supabase.functions.invoke('app-events', {
      body: {
        code,
        platform: isDesktopApp() ? detectOS() : 'web',
        visitor: visitor.id,
        authenticated: !!data.session?.user && !data.session.user.is_anonymous,
      },
    });
  } catch {
    /* Operational reporting must never interfere with notes, auth or offline use. */
  }
}
