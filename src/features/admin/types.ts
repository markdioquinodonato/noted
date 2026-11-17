export const METRICS = {
  database_bytes: 'Database bytes',
  storage_bytes: 'Stored object bytes',
  supabase_mau: 'Supabase billed MAU',
  supabase_bandwidth_bytes: 'Supabase bandwidth bytes',
  cloudflare_requests: 'Cloudflare Worker requests / 24h',
  transcription_cost_usd: 'Estimated transcription USD / 30 days',
  app_errors: 'Reported application errors / 30 days',
  sync_failures: 'Reported synchronization failures / 30 days',
} as const;
export interface ProviderMetric {
  metric: string;
  value: number | null;
  source: string;
  status: 'available' | 'unavailable' | 'error';
  detail: string;
  measured_at: string;
  period_start: string | null;
  period_end: string | null;
}
export interface Threshold {
  metric: keyof typeof METRICS;
  limit_value: number;
  warning_percent: number;
  updated_at: string;
}
export interface AdminSnapshot {
  generated_at: string;
  collection_started_at: string | null;
  registered_users: number;
  confirmed_users: number;
  dau: number;
  wau: number;
  mau: number;
  guest_sessions_today: number;
  database_bytes: number;
  cloud_notes: number;
  database_connections: number;
  event_totals: { app_errors: number; sync_failures: number };
  ai_writing: { day: string; requests: number }[];
  storage_history: {
    day: string;
    database_bytes: number;
    storage_bytes: number;
    measured_at: string;
  }[];
  storage_bytes: number;
  platforms: { platform: string; active_device_days: number; registered_users: number }[];
  activity: { day: string; users: number; guests: number }[];
  errors: { day: string; code: string; platform: string; count: number }[];
  audit: { created_at: string; action: string; outcome: string; target: string }[];
  auth_audit: { day: string; action: string; count: number }[];
  thresholds: Threshold[];
  provider_metrics: ProviderMetric[];
  transcription: TranscriptionAggregate[];
}
export function capacityState(value: number | null, threshold: Threshold, stale = false) {
  if (value === null || stale) return 'unknown';
  if (value >= Number(threshold.limit_value)) return 'critical';
  return value >= (Number(threshold.limit_value) * threshold.warning_percent) / 100
    ? 'warning'
    : 'within limit';
}
export interface TranscriptionAggregate {
  day: string;
  successes: number;
  failures: number;
  estimated_cost_usd: number | null;
  priced_successes?: number;
  model: string;
  model_version: string;
  language: string;
  audio_seconds: number;
  average_processing_ms: number;
}
export interface AnalyticsDay {
  day: string;
  registrations: number;
  dau: number | null;
  wau: number | null;
  mau: number | null;
  guests: number | null;
  errors: number | null;
  sync_failed: number | null;
  sync_offline: number | null;
  notes_created: number | null;
  notes_updated: number | null;
}
export interface Analytics {
  days: AnalyticsDay[];
  platforms: AdminSnapshot['platforms'];
}
export interface Announcement {
  id: string;
  title: string;
  body: string;
  priority: 'normal' | 'important' | 'urgent';
  platform: 'all' | 'web' | 'windows' | 'macos' | 'android';
  min_version: string | null;
  max_version: string | null;
  published: boolean;
  starts_at: string;
  ends_at: string | null;
  updated_at: string;
}
export interface AlertInbox {
  last_checked: string | null;
  items: {
    id: number;
    title: string;
    detail: string;
    priority: 'notice' | 'warning' | 'critical';
    section: string;
    created_at: string;
    resolved_at: string | null;
    read_at: string | null;
    acknowledged_at: string | null;
    dismissed_at: string | null;
  }[];
}
