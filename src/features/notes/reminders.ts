import { useEffect } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router';
import { useRepo } from '@/app/RepositoryProvider';
import { openGuestDb } from '@/data/local/idb';
import { supabase } from '@/lib/supabase';
import { displayTitle } from '@/lib/text';

/** Atomic deduplication in the active storage, not a fake notification timer. */
export function useReminderDelivery() {
  const { repo } = useRepo();
  const navigate = useNavigate();
  useEffect(() => {
    let stopped = false,
      checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        let offset: number | null = 0;
        while (offset !== null && !stopped) {
          const page = await repo.listNotes({
            view: 'reminders',
            sort: 'updated',
            limit: 200,
            offset,
          });
          offset = page.nextOffset;
          for (const note of page.items) {
            if (stopped || !note.reminderAt || Date.parse(note.reminderAt) > Date.now()) continue;
            let fresh = false;
            if (repo.kind === 'local') {
              const db = await openGuestDb(),
                tx = db.transaction('meta', 'readwrite'),
                key = `notification:${note.id}:${note.reminderAt}`;
              if (!(await tx.store.get(key))) {
                await tx.store.put(
                  {
                    noteId: note.id,
                    title: displayTitle(note.title, note.preview),
                    scheduledAt: note.reminderAt,
                  },
                  key,
                );
                fresh = true;
              }
              await tx.done;
            } else {
              const { data, error } = await supabase!
                .from('notifications')
                .upsert(
                  { note_id: note.id, scheduled_at: note.reminderAt },
                  { onConflict: 'owner_id,note_id,scheduled_at', ignoreDuplicates: true },
                )
                .select('id');
              fresh = !error && !!data?.length;
            }
            if (fresh && !stopped) {
              toast.info(`Reminder: ${displayTitle(note.title, note.preview)}`, {
                duration: 15000,
                action: { label: 'Open note', onClick: () => navigate(`/notes/${note.id}`) },
              });
              if ('Notification' in window && Notification.permission === 'granted') {
                try {
                  const notification = new Notification('Noted reminder', {
                    body: displayTitle(note.title, note.preview),
                    tag: `noted-${note.id}`,
                  });
                  notification.onclick = () => {
                    window.focus();
                    navigate(`/notes/${note.id}`);
                    notification.close();
                  };
                } catch {
                  /* in-app delivery remains available */
                }
              }
            }
          }
          if (page.items.some((n) => n.reminderAt && Date.parse(n.reminderAt) > Date.now())) break;
        }
      } catch {
        /* Offline reminders resume on the next interval. */
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 30000);
    window.addEventListener('online', check);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('online', check);
    };
  }, [repo, navigate]);
}
