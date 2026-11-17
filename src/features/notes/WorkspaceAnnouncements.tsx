import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { detectOS, isDesktopApp } from '@/lib/platform';
import { readBrowserValue, writeBrowserValue } from '@/lib/browserStorage';
import { version } from '../../../package.json';

type Notice = {
  id: string;
  title: string;
  body: string;
  priority: 'normal' | 'important' | 'urgent';
};

export function WorkspaceAnnouncements() {
  const [dismissed, setDismissed] = useState<Set<string>>(
    () => new Set((readBrowserValue('noted:announcements-dismissed') ?? '').split(',')),
  );
  const os = isDesktopApp() ? detectOS() : 'web';
  const platform = ['web', 'windows', 'macos', 'android'].includes(os) ? os : 'other';
  const query = useQuery<Notice[]>({
    queryKey: ['published-announcements', platform, version],
    enabled: !!supabase,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase!
        .rpc('noted_announcements', { p_platform: platform, p_version: version })
        .abortSignal(signal);
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
    retry: false,
  });
  const notice = query.error ? undefined : query.data?.find((item) => !dismissed.has(item.id));
  if (!notice) return null;
  return (
    <section
      aria-label="Noted announcement"
      className={`flex shrink-0 items-start gap-3 border-b px-3 py-2 sm:px-4 ${notice.priority === 'urgent' ? 'bg-destructive/10' : 'bg-accent'}`}
    >
      <Megaphone className="mt-1 size-4 shrink-0 text-accent-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-semibold">{notice.title}</p>
        <p className="max-h-28 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {notice.body}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Dismiss announcement"
        onClick={() => {
          const ids = [...dismissed, notice.id].filter(Boolean).slice(-100);
          writeBrowserValue('noted:announcements-dismissed', ids.join(','));
          setDismissed(new Set(ids));
        }}
      >
        <X />
      </Button>
    </section>
  );
}
