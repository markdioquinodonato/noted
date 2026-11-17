import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useNow } from '@/features/notes/hooks';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAnnouncements } from './adminData';
import { humanize, platformName, stamp } from './adminFormat';
import { Empty, PageHeading, Panel, QueryNotice, Table } from './AdminUI';
import type { Announcement } from './types';

function localInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function iso(raw: FormDataEntryValue | null) {
  return raw ? new Date(String(raw)).toISOString() : null;
}
type Draft = Omit<Announcement, 'id' | 'updated_at' | 'starts_at'> & { starts_at: string | null };

export function Announcements() {
  const { client } = useAuth();
  const now = useNow();
  const query = useAnnouncements();
  const [edit, setEdit] = useState<Announcement | 'new' | null>(null);
  const [confirm, setConfirm] = useState<{ prior: Announcement | null; item: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = edit === 'new' ? null : edit;
  const items = query.error ? [] : (query.data?.items ?? []);
  async function save(prior: Announcement | null, item: Draft) {
    setBusy(true);
    try {
      const { error } = await client!.rpc('admin_save_announcement', {
        p_id: prior?.id ?? null,
        p_expected: prior?.updated_at ?? null,
        p_item: item,
      });
      if (error) throw error;
      await query.refetch();
      setEdit(null);
      setConfirm(null);
      toast.success(
        item.published ? 'Announcement saved for publication' : 'Announcement draft saved',
      );
    } catch (error) {
      toast.error(
        (error as { code?: string }).code === '40001'
          ? 'This announcement changed. Reopen it to review the latest version.'
          : 'Could not save the announcement. Check the date and version range, then try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const item: Draft = {
      title: String(data.get('title')),
      body: String(data.get('body')),
      platform: String(data.get('platform')) as Draft['platform'],
      priority: String(data.get('priority')) as Draft['priority'],
      min_version: String(data.get('min_version')) || null,
      max_version: String(data.get('max_version')) || null,
      starts_at:
        data.get('starts_at') === localInput(selected?.starts_at ?? null)
          ? (selected?.starts_at ?? null)
          : iso(data.get('starts_at')),
      ends_at:
        data.get('ends_at') === localInput(selected?.ends_at ?? null)
          ? (selected?.ends_at ?? null)
          : iso(data.get('ends_at')),
      published: selected?.published ?? false,
    };
    if (
      item.ends_at &&
      Date.parse(item.ends_at) <= Date.parse(item.starts_at ?? new Date().toISOString())
    ) {
      toast.error('The end time must be after the start time.');
      return;
    }
    if (item.published) setConfirm({ prior: selected, item });
    else void save(selected, item);
  }
  return (
    <>
      <PageHeading
        title="Announcements"
        description="Draft, schedule, and publish messages for specific Noted versions and platforms."
      >
        <Button onClick={() => setEdit('new')}>
          <Plus /> New announcement
        </Button>
      </PageHeading>
      <QueryNotice
        error={query.error}
        loading={query.isLoading}
        retry={() => void query.refetch()}
      />
      <div className="space-y-4">
        <Panel title="Announcements">
          {items.length ? (
            <Table
              label="Announcements"
              headers={['Title', 'Audience', 'Status', 'Starts', 'Actions']}
              rows={items.map((item) => {
                const status = !item.published
                  ? 'Draft'
                  : Date.parse(item.starts_at) > now
                    ? 'Scheduled'
                    : item.ends_at && Date.parse(item.ends_at) <= now
                      ? 'Expired'
                      : 'Published';
                return [
                  <span className="font-semibold">{item.title}</span>,
                  `${item.platform === 'all' ? 'All platforms' : platformName(item.platform)} · ${humanize(item.priority)}`,
                  status,
                  stamp(item.starts_at),
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEdit(item)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setConfirm({ prior: item, item: { ...item, published: !item.published } })
                      }
                    >
                      {item.published ? 'Unpublish' : 'Publish'}
                    </Button>
                  </div>,
                ];
              })}
            />
          ) : (
            <Empty compact title="No announcements yet">
              Create a draft to prepare your first announcement.
            </Empty>
          )}
        </Panel>
        <Panel title="Announcement history" description="Latest 100 publication and edit events.">
          {query.data?.history.length && !query.error ? (
            <Table
              label="Announcement history"
              headers={['Time', 'Action', 'Announcement']}
              rows={query.data.history.map((event) => [
                stamp(event.created_at),
                humanize(event.action),
                items.find((x) => 'announcement:' + x.id === event.target)?.title ?? event.target,
              ])}
            />
          ) : (
            <Empty compact title="No announcement history yet" />
          )}
        </Panel>
      </div>
      <Dialog
        open={edit !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEdit(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{selected ? 'Edit announcement' : 'New announcement'}</DialogTitle>
            <DialogDescription>
              Users see active, published messages that match their app version and platform.
            </DialogDescription>
          </DialogHeader>
          <form key={selected?.id ?? 'new'} onSubmit={submit} className="grid gap-3 text-sm">
            <label className="grid gap-1">
              Title
              <Input name="title" required maxLength={100} defaultValue={selected?.title} />
            </label>
            <label className="grid gap-1">
              Message
              <Textarea
                name="body"
                required
                maxLength={2000}
                rows={4}
                defaultValue={selected?.body}
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1">
                Priority
                <select
                  className="rounded border bg-background p-2"
                  name="priority"
                  defaultValue={selected?.priority ?? 'normal'}
                >
                  {['normal', 'important', 'urgent'].map((x) => (
                    <option key={x} value={x}>
                      {humanize(x)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                Platform
                <select
                  className="rounded border bg-background p-2"
                  name="platform"
                  defaultValue={selected?.platform ?? 'all'}
                >
                  {['all', 'web', 'windows', 'macos', 'android'].map((x) => (
                    <option key={x} value={x}>
                      {x === 'all' ? 'All platforms' : platformName(x)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                Minimum version
                <Input
                  name="min_version"
                  pattern="[0-9]{1,6}[.][0-9]{1,6}[.][0-9]{1,6}"
                  defaultValue={selected?.min_version ?? ''}
                  placeholder="Any"
                />
              </label>
              <label className="grid gap-1">
                Maximum version
                <Input
                  name="max_version"
                  pattern="[0-9]{1,6}[.][0-9]{1,6}[.][0-9]{1,6}"
                  defaultValue={selected?.max_version ?? ''}
                  placeholder="Any"
                />
              </label>
              <label className="grid min-w-0 gap-1">
                Start (local time)
                <Input
                  name="starts_at"
                  type="datetime-local"
                  defaultValue={localInput(selected?.starts_at ?? null)}
                />
              </label>
              <label className="grid min-w-0 gap-1">
                End (optional)
                <Input
                  name="ends_at"
                  type="datetime-local"
                  defaultValue={localInput(selected?.ends_at ?? null)}
                />
              </label>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {selected ? 'Save changes' : 'Save draft'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.item.published ? 'Publish announcement?' : 'Unpublish announcement?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.item.published
                ? 'The message will be visible to matching app versions during its scheduled window.'
                : 'The message will be removed from the announcement feed.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (confirm) void save(confirm.prior, confirm.item);
              }}
            >
              {confirm?.item.published ? 'Publish' : 'Unpublish'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
