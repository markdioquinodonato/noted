import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Clock,
  FolderOpen,
  Menu,
  NotebookPen,
  NotebookText,
  Pin,
  ScanText,
  Search,
  Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useRepo } from '@/app/RepositoryProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { displayTitle } from '@/lib/text';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { formatRelative } from '@/lib/format';
import { useCounts, useFolders } from './hooks';

export function Dashboard({
  onNewNote,
  onOpen,
  onFolder,
  onMenu,
  search,
  onSearch,
  onShowNotes,
}: {
  onNewNote(): void;
  onOpen(id: string): void;
  onFolder(id: string): void;
  onMenu?: () => void;
  search: string;
  onSearch(value: string): void;
  onShowNotes(): void;
}) {
  const { repo } = useRepo();
  const qc = useQueryClient();
  const { user } = useAuth();
  const counts = useCounts();
  const folders = useFolders();
  const notes = useQuery({
    queryKey: ['dashboard', repo.scope],
    refetchInterval: 30000,
    queryFn: async () => {
      const [recent, pinned, favorites, reminders] = await Promise.all(
        (['recent', 'pinned', 'favorites', 'reminders'] as const).map((view) =>
          repo.listNotes({ view, sort: 'updated', offset: 0, limit: 4 }),
        ),
      );
      return { recent, pinned, favorites, reminders };
    },
  });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = user?.user_metadata.display_name as string | undefined;
  const stats = [
    {
      label: 'Notes',
      count: counts.data?.all,
      icon: NotebookText,
      tone: 'bg-primary/12 text-primary',
    },
    {
      label: 'Pinned',
      count: counts.data?.pinned,
      icon: Pin,
      tone: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
    },
    {
      label: 'Favorites',
      count: counts.data?.favorites ?? 0,
      icon: Star,
      tone: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
    },
  ];
  return (
    <div className="h-full overflow-y-auto bg-muted/30 scrollbar-thin">
      <div className="mx-auto max-w-5xl space-y-8 p-5 sm:p-8">
        <header className="space-y-6">
          <div className="flex items-center gap-2">
            {onMenu && (
              <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={onMenu}>
                <Menu />
              </Button>
            )}
            <form
              className="relative flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                onShowNotes();
              }}
            >
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                aria-label="Search your notes"
                placeholder="Search your notes, folders and tags…"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                className="h-11 rounded-xl bg-card pr-24 pl-10 shadow-sm"
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                aria-label="Search"
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-lg"
              >
                Search
              </Button>
            </form>
          </div>

          <div className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/12 via-card to-violet-500/10 p-6 sm:p-8">
            <div
              aria-hidden="true"
              className="absolute -top-16 -right-16 size-56 rounded-full bg-primary/15 blur-3xl"
            />
            <p className="relative text-xs font-semibold tracking-widest text-primary uppercase">
              Your writing space
            </p>
            <h2 className="relative mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              {name ? `${greeting}, ${name}` : 'Welcome to Noted'}
            </h2>
            <p className="relative mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
              Make room for your ideas. Capture a thought, organize a project, or pick up where you
              left off.
            </p>
            <div className="relative mt-6 flex flex-wrap gap-2">
              <Button
                className="h-10 rounded-xl shadow-md shadow-primary/25"
                onClick={onNewNote}
                aria-label="New note"
              >
                <NotebookPen />
                Create a note
              </Button>
              <p className="flex items-center gap-2 rounded-xl border bg-card/70 px-3 py-2 text-xs text-muted-foreground">
                <ScanText className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  Tip: use <strong className="font-semibold text-foreground">Scan text</strong>{' '}
                  inside a note to capture text with your camera
                </span>
              </p>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-3 gap-3">
          {stats.map(({ label, count, icon: Icon, tone }) => (
            <div className="rounded-2xl border bg-card p-4 sm:p-5" key={label}>
              <div className="flex items-start justify-between">
                <p className="text-2xl font-bold tabular-nums sm:text-3xl">{count ?? '—'}</p>
                <span className={cn('hidden size-9 place-items-center rounded-xl sm:grid', tone)}>
                  <Icon className="size-4.5" aria-hidden="true" />
                </span>
              </div>
              <p className="mt-1 text-xs font-medium text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
        {notes.isError && (
          <p role="alert" className="text-sm text-destructive">
            Could not load your dashboard.{' '}
            <button onClick={() => void notes.refetch()}>Retry</button>
          </p>
        )}
        {(
          [
            ['recent', 'Recent notes', Clock],
            ['pinned', 'Pinned notes', Pin],
            ['favorites', 'Favorites', Star],
            ['reminders', 'Upcoming & due reminders', Bell],
          ] as const
        ).map(([key, label, Icon]) => (
          <section key={key}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <span className="grid size-6 place-items-center rounded-lg bg-primary/10">
                <Icon className="size-3.5 text-primary" aria-hidden="true" />
              </span>
              {label}
            </h3>
            {notes.data?.[key].items.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {notes.data[key].items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => onOpen(n.id)}
                    data-note-color={n.color && n.color !== 'default' ? n.color : undefined}
                    className="group flex min-h-32 min-w-0 flex-col rounded-2xl border bg-card p-4 text-left text-foreground transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                  >
                    <p className="truncate text-sm font-semibold">
                      {displayTitle(n.title, n.preview)}
                    </p>
                    <p className="mt-1.5 line-clamp-3 flex-1 text-xs leading-relaxed text-muted-foreground">
                      {n.preview || 'Empty note'}
                    </p>
                    <p className="mt-3 text-[0.7rem] font-medium text-muted-foreground">
                      {key === 'reminders' && n.reminderAt
                        ? new Date(n.reminderAt).toLocaleString()
                        : `Edited ${formatRelative(n.updatedAt)}`}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
                {notes.isLoading ? 'Loading…' : `No ${label.toLowerCase()} yet.`}
              </p>
            )}
          </section>
        ))}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <span className="grid size-6 place-items-center rounded-lg bg-primary/10">
              <FolderOpen className="size-3.5 text-primary" aria-hidden="true" />
            </span>
            Folders
          </h3>
          <div className="flex flex-wrap gap-2">
            {folders.data?.map((f) => (
              <Button
                key={f.id}
                variant="outline"
                className="h-10 rounded-xl bg-card"
                onClick={() => onFolder(f.id)}
              >
                <FolderOpen
                  style={{
                    color: f.color && f.color !== 'default' ? `var(--note-${f.color})` : undefined,
                  }}
                />
                {f.name}
                <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                  {counts.data?.folders[f.id] ?? 0}
                </span>
              </Button>
            ))}
            {!folders.data?.length && (
              <p className="text-sm text-muted-foreground">
                Create a folder from the sidebar, or add Personal, School and Work.
              </p>
            )}
            {!folders.data?.length && (
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={async () => {
                  try {
                    for (const name of ['Personal', 'School', 'Work']) {
                      try {
                        await repo.createFolder(name);
                      } catch (e) {
                        if ((e as Error).name !== 'DuplicateNameError') throw e;
                      }
                    }
                    await qc.invalidateQueries({ queryKey: ['folders', repo.scope] });
                    toast.success('Default folders added');
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                Add default folders
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
