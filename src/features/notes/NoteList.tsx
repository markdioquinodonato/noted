import { readBrowserValue, writeBrowserValue } from '@/lib/browserStorage';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Archive,
  Star,
  Bell,
  LayoutGrid,
  List,
  ArchiveRestore,
  CheckSquare,
  Download,
  Folder as FolderIcon,
  Hash,
  Menu,
  MoreHorizontal,
  Copy,
  NotebookText,
  Pin,
  Plus,
  RotateCcw,
  Search,
  SearchX,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Alert, EmptyState, modKey, Spinner } from '@/components/common';
import { useRepo } from '@/app/RepositoryProvider';
import type { NoteSort, NoteSummary } from '@/domain/types';
import { errorMessage, formatRelative, plural } from '@/lib/format';
import { displayTitle } from '@/lib/text';
import { cn } from '@/lib/utils';
import { exportNotesAsZip } from '@/features/io/txt';
import { activeSavers } from './noteSaver';
import {
  useCounts,
  useNow,
  useFolders,
  useNoteList,
  useRefreshLists,
  useTags,
  type ListFilters,
} from './hooks';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { NotificationInbox } from './NotificationInbox';
import { ConfirmDialog } from './dialogs';

const VIEW_TITLES: Record<string, string> = {
  all: 'All Notes',
  favorites: 'Favorites',
  reminders: 'Reminders',
  shared: 'Shared Notes',
  recent: 'Recent',
  pinned: 'Pinned',
  archive: 'Archive',
  trash: 'Trash',
};

interface Props {
  filters: ListFilters;
  search: string;
  onSearch: (s: string) => void;
  onSort: (s: NoteSort) => void;
  onDates: (patch: Partial<ListFilters>) => void;
  onClearFilter: () => void;
  selectedId?: string;
  onOpen: (id: string) => void;
  onCloseOpenNote: () => void;
  onNewNote: () => void;
  onMenu?: () => void;
}

export const NoteList = forwardRef<HTMLInputElement, Props>(function NoteList(
  {
    filters,
    search,
    onSearch,
    onSort,
    onDates,
    onClearFilter,
    selectedId,
    onOpen,
    onCloseOpenNote,
    onNewNote,
    onMenu,
  },
  searchRef,
) {
  const { repo } = useRepo();
  const list = useNoteList(filters);
  const folders = useFolders();
  const tags = useTags();
  const counts = useCounts();
  const refresh = useRefreshLists();
  const [layout, setLayout] = useState(() => readBrowserValue('noted:layout') ?? 'list');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | 'delete' | 'empty'>(null);
  const [busy, setBusy] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const folderById = useMemo(
    () => new Map((folders.data ?? []).map((f) => [f.id, f])),
    [folders.data],
  );
  const tagById = useMemo(() => new Map((tags.data ?? []).map((t) => [t.id, t])), [tags.data]);

  const filterKey = `${filters.view}|${filters.folderId}|${filters.tagId}|${filters.uncategorized}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setSelectMode(false);
    setSelected(new Set());
  }

  // Incremental loading when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !list.hasNextPage || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !list.isFetchingNextPage) void list.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [list, list.hasNextPage, list.isFetchingNextPage]);

  const heading = filters.folderId
    ? (folderById.get(filters.folderId)?.name ?? 'Folder')
    : filters.tagId
      ? `#${tagById.get(filters.tagId)?.name ?? 'tag'}`
      : filters.uncategorized
        ? 'Uncategorized'
        : VIEW_TITLES[filters.view];

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /** Bulk update through the open editor's saver when relevant (keeps concurrency tokens fresh). */
  const bulkUpdate = async (patch: Parameters<typeof repo.updateNote>[1], label: string) => {
    setBusy(true);
    const ids = [...selected];
    let failed = 0;
    for (const id of ids) {
      try {
        const saver = activeSavers.get(id);
        if (saver) await saver.updateMeta(patch);
        else await repo.updateNote(id, patch);
      } catch {
        failed++;
      }
    }
    if (
      selectedId &&
      ids.includes(selectedId) &&
      (patch.deletedAt !== undefined || patch.isArchived !== undefined)
    )
      onCloseOpenNote();
    refresh();
    setBusy(false);
    setSelected(new Set());
    setSelectMode(false);
    if (failed) toast.error(`${failed} of ${ids.length} notes could not be updated.`);
    else toast.success(`${label} ${plural(ids.length, 'note')}`);
  };

  const exportSelected = async () => {
    setBusy(true);
    try {
      for (const s of activeSavers.values()) if (selected.has(s.noteId)) await s.flush();
      const notes = await repo.getNotes([...selected]);
      exportNotesAsZip(notes, `noted-${new Date().toISOString().slice(0, 10)}`);
      toast.success(`Exported ${plural(notes.length, 'note')}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteSelectedForever = async () => {
    const ids = [...selected];
    for (const id of ids) await repo.deleteNotePermanently(id);
    if (selectedId && ids.includes(selectedId)) onCloseOpenNote();
    refresh();
    setSelected(new Set());
    setSelectMode(false);
    toast.success(`Permanently deleted ${plural(ids.length, 'note')}`);
  };

  const emptyTrash = async () => {
    const n = await repo.emptyTrash();
    if (selectedId) onCloseOpenNote();
    refresh();
    toast.success(n ? `Permanently deleted ${plural(n, 'note')}` : 'Trash is already empty');
  };

  const updateRow = async (note: NoteSummary, patch: Parameters<typeof repo.updateNote>[1]) => {
    try {
      const saver = activeSavers.get(note.id);
      if (saver) await saver.updateMeta(patch);
      else await repo.updateNote(note.id, patch, { expectedUpdatedAt: note.updatedAt });
      if (note.id === selectedId && patch.deletedAt) onCloseOpenNote();
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
      refresh();
    }
  };
  const isTrash = filters.view === 'trash';
  const isArchive = filters.view === 'archive';
  const filterChip = filters.folderId || filters.tagId || filters.uncategorized;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Notes list">
      <div className="shrink-0 space-y-3 border-b px-3 pt-3 pb-3">
        <div className="flex items-center gap-1">
          {onMenu && (
            <Button variant="ghost" size="icon" onClick={onMenu} aria-label="Open navigation">
              <Menu />
            </Button>
          )}
          <div className="min-w-0 flex-1 px-1">
            <h1 className="truncate text-base font-semibold" data-testid="list-heading">
              {heading}
            </h1>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {list.isLoading ? 'Loading…' : plural(total, 'note')}
            </p>
          </div>
          <NotificationInbox />
          {items.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={selectMode ? 'secondary' : 'ghost'}
                  size="icon"
                  aria-pressed={selectMode}
                  aria-label="Select notes"
                  onClick={() => {
                    setSelectMode((m) => !m);
                    setSelected(new Set());
                  }}
                >
                  <CheckSquare />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Select notes</TooltipContent>
            </Tooltip>
          )}
          {isTrash && (counts.data?.trash ?? 0) > 0 && !selectMode && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setConfirm('empty')}
            >
              Empty
            </Button>
          )}
          {onMenu && !isTrash && (
            <Button size="icon" onClick={onNewNote} aria-label="New note">
              <Plus />
            </Button>
          )}
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && search) {
                e.stopPropagation();
                onSearch('');
              }
            }}
            placeholder="Search notes"
            title={`Search notes (${modKey}+F)`}
            aria-label="Search notes by title, content, folder or tag"
            className="h-9 pr-8 pl-8"
          />
          {list.isFetching && !list.isFetchingNextPage && search && (
            <Spinner
              className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              label="Searching"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <details className="group text-xs text-muted-foreground open:order-last open:w-full">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium transition-colors hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              Date filters{filters.createdAfter || filters.updatedAfter ? ' · active' : ''}
            </summary>
            <div className="mt-2 grid gap-2">
              <label className="flex items-center justify-between gap-2">
                Created since
                <input
                  type="date"
                  aria-label="Created since"
                  className="min-w-0 rounded border bg-background px-2 py-1"
                  value={filters.createdAfter?.slice(0, 10) ?? ''}
                  onChange={(e) =>
                    onDates({
                      createdAfter: e.target.value ? `${e.target.value}T00:00:00.000Z` : undefined,
                    })
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                Edited since
                <input
                  type="date"
                  aria-label="Edited since"
                  className="min-w-0 rounded border bg-background px-2 py-1"
                  value={filters.updatedAfter?.slice(0, 10) ?? ''}
                  onChange={(e) =>
                    onDates({
                      updatedAfter: e.target.value ? `${e.target.value}T00:00:00.000Z` : undefined,
                    })
                  }
                />
              </label>
            </div>
          </details>
          {filterChip ? (
            <span className="inline-flex max-w-[60%] items-center gap-1 rounded-full bg-accent py-0.5 pr-1 pl-2 text-xs text-accent-foreground">
              {filters.tagId ? <Hash className="size-3" /> : <FolderIcon className="size-3" />}
              <span className="truncate">{heading}</span>
              <button
                type="button"
                onClick={onClearFilter}
                aria-label="Clear filter"
                className="rounded-full p-0.5 hover:bg-primary/10"
              >
                <X className="size-3" />
              </button>
            </span>
          ) : null}
          <div className="flex-1" />
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={layout === 'grid' ? 'List view' : 'Grid view'}
            onClick={() => {
              const next = layout === 'grid' ? 'list' : 'grid';
              setLayout(next);
              writeBrowserValue('noted:layout', next);
            }}
          >
            {layout === 'grid' ? <List /> : <LayoutGrid />}
          </Button>
          <Select value={filters.sort} onValueChange={(v) => onSort(v as NoteSort)}>
            <SelectTrigger
              size="sm"
              className="h-8 w-auto gap-1 border-0 bg-transparent px-2 text-xs shadow-none"
              aria-label="Sort notes"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="updated">Last edited</SelectItem>
              <SelectItem value="created">Date created</SelectItem>
              <SelectItem value="title">Title (A–Z)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectMode && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-muted/60 px-3 py-2 text-sm">
          <Checkbox
            aria-label="Select all loaded notes"
            checked={
              selected.size > 0 && selected.size === items.length
                ? true
                : selected.size > 0
                  ? 'indeterminate'
                  : false
            }
            onCheckedChange={(c) => setSelected(c ? new Set(items.map((i) => i.id)) : new Set())}
          />
          <span className="mr-auto ml-1.5 text-xs text-muted-foreground">
            {selected.size} selected
          </span>
          <Button
            size="xs"
            variant="ghost"
            disabled={!selected.size || busy}
            onClick={() => void exportSelected()}
          >
            <Download /> Export
          </Button>
          {isTrash ? (
            <>
              <Button
                size="xs"
                variant="ghost"
                disabled={!selected.size || busy}
                onClick={() => void bulkUpdate({ deletedAt: null }, 'Restored')}
              >
                <RotateCcw /> Restore
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="text-destructive"
                disabled={!selected.size || busy}
                onClick={() => setConfirm('delete')}
              >
                <Trash2 /> Delete
              </Button>
            </>
          ) : (
            <>
              <Button
                size="xs"
                variant="ghost"
                disabled={!selected.size || busy}
                onClick={() =>
                  void bulkUpdate({ isArchived: !isArchive }, isArchive ? 'Unarchived' : 'Archived')
                }
              >
                {isArchive ? <ArchiveRestore /> : <Archive />} {isArchive ? 'Unarchive' : 'Archive'}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="text-destructive"
                disabled={!selected.size || busy}
                onClick={() =>
                  void bulkUpdate(
                    { deletedAt: new Date().toISOString(), isPinned: false },
                    'Moved to Trash:',
                  )
                }
              >
                <Trash2 /> Trash
              </Button>
            </>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin" data-testid="note-list">
        {list.isError ? (
          <div className="p-4">
            <Alert tone="error">
              {errorMessage(list.error, 'Could not load notes.')}{' '}
              <button
                type="button"
                className="font-medium underline"
                onClick={() => void list.refetch()}
              >
                Try again
              </button>
            </Alert>
          </div>
        ) : list.isLoading ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          <ListEmpty
            view={filters.view}
            searching={!!filters.search.trim()}
            filtered={!!filterChip}
            onNewNote={onNewNote}
          />
        ) : (
          <ul
            className={layout === 'grid' ? 'grid grid-cols-2 gap-2 p-2' : 'space-y-1 p-2'}
            role="list"
          >
            {items.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                active={n.id === selectedId}
                selectMode={selectMode}
                checked={selected.has(n.id)}
                onToggle={() => toggle(n.id)}
                onOpen={() => onOpen(n.id)}
                folderName={
                  n.folderId && !filters.folderId ? folderById.get(n.folderId)?.name : undefined
                }
                tagNames={n.tagIds.map((t) => tagById.get(t)?.name).filter((x): x is string => !!x)}
                search={filters.search}
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Actions for ${displayTitle(n.title, n.preview)}`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onOpen(n.id)}>Open note</DropdownMenuItem>
                      {filters.view !== 'shared' && (
                        <>
                          {!isTrash && (
                            <>
                              <DropdownMenuItem
                                onSelect={() => void updateRow(n, { isFavorite: !n.isFavorite })}
                              >
                                <Star />
                                {n.isFavorite ? 'Remove favorite' : 'Favorite'}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => void updateRow(n, { isPinned: !n.isPinned })}
                              >
                                <Pin />
                                {n.isPinned ? 'Unpin' : 'Pin'}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => void updateRow(n, { isArchived: !n.isArchived })}
                              >
                                <Archive />
                                {n.isArchived ? 'Unarchive' : 'Archive'}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={async () => {
                                  try {
                                    const saver = activeSavers.get(n.id);
                                    if (saver) await saver.flush();
                                    const full = await repo.getNote(n.id);
                                    if (!full) return;
                                    await repo.createNote({
                                      title: `${full.title || 'Untitled'} (copy)`.slice(0, 200),
                                      content: full.content,
                                      folderId: full.folderId,
                                      tagIds: full.tagIds,
                                      color: full.color,
                                      isFavorite: full.isFavorite,
                                    });
                                    refresh();
                                  } catch (e) {
                                    toast.error(errorMessage(e));
                                  }
                                }}
                              >
                                <Copy />
                                Duplicate
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuItem
                            onSelect={() =>
                              void updateRow(n, {
                                deletedAt: isTrash ? null : new Date().toISOString(),
                              })
                            }
                          >
                            {isTrash ? <RotateCcw /> : <Trash2 />}
                            {isTrash ? 'Restore' : 'Move to Trash'}
                          </DropdownMenuItem>
                          {isTrash && (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => {
                                setSelected(new Set([n.id]));
                                setConfirm('delete');
                              }}
                            >
                              Delete forever
                            </DropdownMenuItem>
                          )}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <div ref={sentinel} className="flex justify-center p-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
            >
              {list.isFetchingNextPage ? <Spinner /> : null} Load more
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Permanently delete ${plural(selected.size, 'note')}?`}
        description={
          <>
            These notes and their version history will be erased.{' '}
            <strong>This can’t be undone.</strong>
          </>
        }
        confirmLabel="Delete forever"
        destructive
        onConfirm={deleteSelectedForever}
      />
      <ConfirmDialog
        open={confirm === 'empty'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Empty Trash?"
        description={
          <>
            All {plural(counts.data?.trash ?? 0, 'note')} in Trash will be permanently deleted.{' '}
            <strong>This can’t be undone.</strong>
          </>
        }
        confirmLabel="Empty Trash"
        destructive
        onConfirm={emptyTrash}
      />
    </section>
  );
});

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const i = text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-primary/15 text-inherit">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function snippet(preview: string, query: string): string {
  const flat = preview.replace(/\s+/g, ' ').trim();
  const q = query.trim().toLocaleLowerCase();
  if (!q) return flat;
  const i = flat.toLocaleLowerCase().indexOf(q);
  return i > 40 ? `…${flat.slice(i - 30)}` : flat;
}

function NoteRow({
  note,
  active,
  selectMode,
  checked,
  onToggle,
  onOpen,
  folderName,
  tagNames,
  search,
  actions,
}: {
  note: NoteSummary;
  active: boolean;
  selectMode: boolean;
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
  folderName?: string;
  tagNames: string[];
  search: string;
  actions: React.ReactNode;
}) {
  const now = useNow();
  const colored = !!note.color && note.color !== 'default';
  const title = displayTitle(note.title, note.preview);
  const body = snippet(
    note.title.trim() ? note.preview : note.preview.split('\n').slice(1).join('\n'),
    search,
  );
  return (
    <li
      data-note-color={colored ? note.color : undefined}
      className={cn(
        'group/row relative rounded-xl border border-transparent transition-all',
        colored ? 'bg-background' : 'hover:bg-muted/70',
        colored && !active && 'hover:border-border',
        active && 'border-primary/30 bg-accent/60 shadow-sm ring-1 ring-primary/15',
      )}
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        {selectMode && (
          <Checkbox
            checked={checked}
            onCheckedChange={onToggle}
            aria-label={`Select ${title}`}
            className="mt-0.5"
          />
        )}
        <button
          type="button"
          onClick={selectMode ? onToggle : onOpen}
          aria-current={active ? 'true' : undefined}
          className="min-w-0 flex-1 rounded-sm text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          data-testid="note-row"
        >
          <span className="flex items-center gap-1.5">
            {colored && (
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ background: `var(--note-${note.color})` }}
              />
            )}
            {note.isFavorite && (
              <Star
                className="size-3.5 shrink-0 fill-amber-400 text-amber-500"
                aria-label="Favorite"
              />
            )}
            {note.isPinned && (
              <Pin className="size-3.5 shrink-0 fill-primary/20 text-primary" aria-label="Pinned" />
            )}
            <span
              className={cn(
                'truncate text-sm font-medium',
                !note.title.trim() && !note.preview.trim() && 'text-muted-foreground',
              )}
            >
              <Highlight text={title} query={search} />
            </span>
          </span>
          {note.reminderAt && !note.reminderCompletedAt && (
            <span
              className={cn(
                'flex items-center gap-1 text-xs',
                Date.parse(note.reminderAt) < now ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              <Bell className="size-3" />
              {Date.parse(note.reminderAt) < now ? 'Overdue · ' : ''}
              {new Date(note.reminderAt).toLocaleString()}
            </span>
          )}
          {body && (
            <span className="mt-0.5 line-clamp-2 text-[0.8125rem] leading-snug text-muted-foreground">
              <Highlight text={body} query={search} />
            </span>
          )}
          <span className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground/80">
            <time dateTime={note.updatedAt}>
              {formatRelative(note.deletedAt ?? note.updatedAt)}
            </time>
            {folderName && (
              <span className="inline-flex min-w-0 items-center gap-0.5 truncate">
                <FolderIcon className="size-3 shrink-0" aria-hidden="true" />
                {folderName}
              </span>
            )}
            {tagNames.slice(0, 2).map((t) => (
              <span key={t} className="truncate">
                #{t}
              </span>
            ))}
            {tagNames.length > 2 && <span>+{tagNames.length - 2}</span>}
          </span>
        </button>
        {actions}
      </div>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-4 p-4" aria-busy="true" aria-label="Loading notes">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      ))}
    </div>
  );
}

function ListEmpty({
  view,
  searching,
  filtered,
  onNewNote,
}: {
  view: string;
  searching: boolean;
  filtered: boolean;
  onNewNote: () => void;
}) {
  if (searching)
    return (
      <EmptyState icon={<SearchX />} title="No matching notes">
        Try a different word, or check Archive and Trash.
      </EmptyState>
    );
  if (view === 'trash')
    return (
      <EmptyState icon={<Trash2 />} title="Trash is empty">
        Deleted notes appear here so you can restore them.
      </EmptyState>
    );
  if (view === 'archive')
    return (
      <EmptyState icon={<Archive />} title="No archived notes">
        Archive notes you want to keep but don’t need every day.
      </EmptyState>
    );
  if (view === 'pinned')
    return (
      <EmptyState icon={<Pin />} title="Nothing pinned">
        Pin important notes to keep them at the top.
      </EmptyState>
    );
  return (
    <EmptyState
      icon={<NotebookText />}
      title={
        filtered
          ? 'No notes here yet'
          : view === 'recent'
            ? 'No recent notes'
            : 'Write your first note'
      }
      action={
        <Button onClick={onNewNote}>
          <Plus /> New note
        </Button>
      }
    >
      {filtered
        ? 'Create a note here, or move existing notes in from the editor.'
        : 'Your notes are saved automatically as you type.'}
    </EmptyState>
  );
}
