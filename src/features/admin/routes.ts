import type { RouteObject } from 'react-router';

export const adminRoutes: RouteObject[] = [
  {
    lazy: async () => ({ Component: (await import('./AdminRoute')).AdminRoute }),
    children: [
      {
        index: true,
        lazy: async () => ({ Component: (await import('./AdminDashboard')).AdminDashboard }),
      },
      {
        path: 'user-analytics',
        lazy: async () => ({ Component: (await import('./AdminDashboard')).UserAnalytics }),
      },
      {
        path: 'platform-analytics',
        lazy: async () => ({ Component: (await import('./AdminDashboard')).PlatformAnalytics }),
      },
      {
        path: 'users',
        lazy: async () => ({ Component: (await import('./AdminManagement')).UserManagement }),
      },
      {
        path: 'security',
        lazy: async () => ({ Component: (await import('./AdminManagement')).AuditLogs }),
      },
      {
        path: 'releases',
        lazy: async () => ({ Component: (await import('./AdminManagement')).Releases }),
      },
      {
        path: 'notifications',
        lazy: async () => ({ Component: (await import('./AdminManagement')).Notifications }),
      },
      {
        path: 'announcements',
        lazy: async () => ({ Component: (await import('./AdminAnnouncements')).Announcements }),
      },
      {
        path: 'supabase',
        lazy: async () => ({
          Component: (await import('./AdminInfrastructure')).SupabaseMonitoring,
        }),
      },
      {
        path: 'storage',
        lazy: async () => ({ Component: (await import('./AdminRoute')).StorageRoute }),
      },
      {
        path: 'cloudflare',
        lazy: async () => ({
          Component: (await import('./AdminInfrastructure')).CloudflareMonitoring,
        }),
      },
      {
        path: 'health',
        lazy: async () => ({ Component: (await import('./AdminInfrastructure')).SystemHealth }),
      },
      {
        path: 'settings',
        lazy: async () => ({ Component: (await import('./AdminInfrastructure')).AdminSettings }),
      },
      {
        path: 'transcription',
        lazy: async () => ({
          Component: (await import('@/features/transcription/TranscriptionAdmin'))
            .TranscriptionAdmin,
        }),
      },
      {
        path: 'ai-usage',
        lazy: async () => ({ Component: (await import('./AdminRoute')).CostsRoute }),
      },
    ],
  },
];
