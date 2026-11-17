import {
  LayoutDashboard,
  Users,
  ChartNoAxesCombined,
  Monitor,
  Database,
  Cloud,
  HeartPulse,
  HardDrive,
  AudioLines,
  Receipt,
  Megaphone,
  ShieldCheck,
  Package,
  Settings,
  Bell,
} from 'lucide-react';

export const adminGroups = [
  {
    label: 'Overview',
    items: [
      { path: '', label: 'Dashboard', icon: LayoutDashboard },
      { path: 'users', label: 'User Management', icon: Users },
      { path: 'user-analytics', label: 'User Analytics', icon: ChartNoAxesCombined },
      { path: 'platform-analytics', label: 'Platform Analytics', icon: Monitor },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { path: 'supabase', label: 'Supabase Monitoring', icon: Database },
      { path: 'cloudflare', label: 'Cloudflare Monitoring', icon: Cloud },
      { path: 'health', label: 'System Health', icon: HeartPulse },
      { path: 'storage', label: 'Storage & Database', icon: HardDrive },
    ],
  },
  {
    label: 'AI services',
    items: [
      { path: 'transcription', label: 'Audio Transcription', icon: AudioLines },
      { path: 'ai-usage', label: 'AI Usage & Costs', icon: Receipt },
    ],
  },
  {
    label: 'Management',
    items: [
      { path: 'announcements', label: 'Announcements', icon: Megaphone },
      { path: 'security', label: 'Security & Audit Logs', icon: ShieldCheck },
      { path: 'releases', label: 'Application Releases', icon: Package },
      { path: 'settings', label: 'Admin Settings', icon: Settings },
    ],
  },
];
export const adminItems = adminGroups.flatMap((group) => group.items);
export const notificationsItem = { path: 'notifications', label: 'Notifications', icon: Bell };
export function adminUrl(path: string) {
  return path ? `/admin/${path}` : '/admin';
}
