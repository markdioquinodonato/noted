import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useRepo } from '@/app/RepositoryProvider';
import { openGuestDb } from '@/data/local/idb';
import { supabase } from '@/lib/supabase';
interface Item {
  id: string;
  noteId: string;
  title: string;
  scheduledAt: string;
}
export function NotificationInbox() {
  const { repo } = useRepo();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const items = useQuery({
    queryKey: ['notifications', repo.scope],
    refetchInterval: 30000,
    queryFn: async () => {
      const result: Item[] = [];
      if (repo.kind === 'local') {
        const db = await openGuestDb();
        for (const key of await db.getAllKeys('meta'))
          if (String(key).startsWith('notification:')) {
            const item = (await db.get('meta', key)) as {
              noteId: string;
              title: string;
              scheduledAt: string;
              dismissed?: boolean;
            };
            const note = await repo.getNote(item.noteId);
            if (
              !item.dismissed &&
              note &&
              !note.deletedAt &&
              !note.reminderCompletedAt &&
              note.reminderAt === item.scheduledAt
            )
              result.push({ ...item, id: String(key) });
          }
      } else {
        const { data, error } = await supabase!
          .from('notifications')
          .select(
            'id,note_id,scheduled_at,notes(title,reminder_at,reminder_completed_at,deleted_at)',
          )
          .eq('dismissed', false)
          .order('scheduled_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        for (const row of data ?? []) {
          const note = (Array.isArray(row.notes) ? row.notes[0] : row.notes) as {
            title: string;
            reminder_at: string;
            reminder_completed_at: string | null;
            deleted_at: string | null;
          } | null;
          if (
            note &&
            !note.deleted_at &&
            !note.reminder_completed_at &&
            note.reminder_at === row.scheduled_at
          )
            result.push({
              id: row.id,
              noteId: row.note_id,
              title: note.title || 'Untitled note',
              scheduledAt: row.scheduled_at,
            });
        }
      }
      return result.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
    },
  });
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Notifications${items.data?.length ? ` (${items.data.length})` : ''}`}
        onClick={() => {
          setOpen(true);
          void items.refetch();
        }}
      >
        <Bell />
        {items.data?.length ? <span className="text-xs">{items.data.length}</span> : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notifications</DialogTitle>
            <DialogDescription>
              Stored reminder notifications. Noted checks due reminders while the app is open.
            </DialogDescription>
          </DialogHeader>
          {items.isError && (
            <p role="alert">
              Could not load notifications.{' '}
              <button onClick={() => void items.refetch()}>Retry</button>
            </p>
          )}
          {!items.data?.length && !items.isError && (
            <p className="text-sm text-muted-foreground">No pending notifications.</p>
          )}
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {items.data?.map((item) => (
              <li key={item.id} className="rounded border p-3">
                <button
                  className="block text-left text-sm font-medium"
                  onClick={() => {
                    setOpen(false);
                    navigate(`/notes/${item.noteId}`);
                  }}
                >
                  {item.title}
                </button>
                <p className="text-xs text-muted-foreground">
                  {new Date(item.scheduledAt).toLocaleString()}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      if (repo.kind === 'local') {
                        const db = await openGuestDb();
                        const value = (await db.get('meta', item.id)) as object;
                        await db.put('meta', { ...value, dismissed: true }, item.id);
                      } else {
                        const { error } = await supabase!
                          .from('notifications')
                          .update({ dismissed: true })
                          .eq('id', item.id);
                        if (error) throw error;
                      }
                      await items.refetch();
                    } catch {
                      toast.error('Could not dismiss notification.');
                    }
                  }}
                >
                  Dismiss
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
