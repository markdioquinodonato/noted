import { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CalendarDays,
  Archive,
  Star,
  Bell,
  ArchiveRestore,
  Download,
  Menu,
  MoreHorizontal,
  Check,
  SlidersHorizontal,
  Copy,
  NotebookText,
  Pin,
  RotateCcw,
  Search,
  SearchX,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, EmptyState, modKey, Spinner } from '@/components/common';
import { useRepo } from '@/app/RepositoryProvider';
import type { NoteSort, NoteSummary, NoteView } from '@/domain/types';
import { errorMessage, formatDateTime, formatRelative, plural } from '@/lib/format';
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { NotificationInbox } from './NotificationInbox';
import { ConfirmDialog } from './dialogs';
import { CaptureBar } from './CaptureBar';
import { NOTE_LAYOUT_OPTIONS, useNotesLayout, type NotesLayout } from './workspacePreferences';
import { BrandMark } from '@/components/BrandLogo';

const VIEW_TITLES: Record<NoteView, string> = {
  all: 'Notes',
  favorites: 'Favorites',
  reminders: 'Reminders',
  shared: 'Shared',
  recent: 'Recent',
  pinned: 'Pinned',
  archive: 'Archive',
  trash: 'Trash',
};

const libraryViews = ['all', 'pinned', 'favorites', 'recent'] as const;
const dateFields = [
  ['createdAfter', 'Created since'],
  ['updatedAfter', 'Edited since'],
] as const;

interface Props {
  filters: ListFilters;
  search: string;
  onSearch: (s: string) => void;
  onSort: (s: NoteSort) => void;
  onDates: (patch: Partial<ListFilters>) => void;
  onClearFilter: () => void;
  onOpen: (id: string) => void;
  onCompose: () => void;
  onView: (view: NoteView) => void;
  profile: ReactNode;
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
    onOpen,
    onCompose,
    onView,
    profile,
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
  const { layout, setLayout } = useNotesLayout();
  const [dateOpen, setDateOpen] = useState(false);
  const viewOptionsRef = useRef<HTMLButtonElement>(null);
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

  const filterKey = JSON.stringify(filters);
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
    refresh();
    setSelected(new Set());
    setSelectMode(false);
    toast.success(`Permanently deleted ${plural(ids.length, 'note')}`);
  };

  const emptyTrash = async () => {
    const n = await repo.emptyTrash();
    refresh();
    toast.success(n ? `Permanently deleted ${plural(n, 'note')}` : 'Trash is already empty');
  };

  const updateRow = async (note: NoteSummary, patch: Parameters<typeof repo.updateNote>[1]) => {
    try {
      const saver = activeSavers.get(note.id);
      if (saver) await saver.updateMeta(patch);
      else await repo.updateNote(note.id, patch, { expectedUpdatedAt: note.updatedAt });
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
      refresh();
    }
  };
  const isTrash = filters.view === 'trash';
  const isArchive = filters.view === 'archive';
  const filterChip = filters.folderId || filters.tagId || filters.uncategorized;
  const hasDateFilter = Boolean(filters.createdAfter || filters.updatedAfter);

  return (
    <section className="noted-list flex h-full min-h-0 flex-col" aria-label="Notes list">
      <div className="noted-list-header">
        <div className="noted-list-heading">
          {onMenu && (
            <Button
              className="noted-list-nav-trigger"
              variant="ghost"
              size="icon"
              onClick={onMenu}
              aria-label="Open navigation"
            >
              <Menu />
            </Button>
          )}
          {onMenu && <BrandMark size={26} />}
          <div className="min-w-0 flex-1 px-1">
            <h1 className="noted-list-title truncate" data-testid="list-heading">
              {heading}
            </h1>
            <p className="noted-list-count" aria-live="polite">
              {list.isLoading ? 'Loading…' : plural(total, 'note')}
            </p>
          </div>
        </div>

        <div className="noted-search relative">
          <Search className="noted-search-icon pointer-events-none" aria-hidden="true" />
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
            className="noted-search-input"
          />
          {!search && (
            <kbd className="noted-search-key" aria-hidden="true">
              {modKey}+F
            </kbd>
          )}
          {list.isFetching && !list.isFetchingNextPage && search && (
            <Spinner
              className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              label="Searching"
            />
          )}
        </div>

        <div className="noted-list-account">
          <NotificationInbox showWhenEmpty={filters.view === 'reminders'} />
          {profile}
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

      <div
        className="noted-list-scroll min-h-0 flex-1 overflow-y-auto scrollbar-thin"
        data-testid="note-list"
      >
        <div className="noted-list-command-bar">
          {!isTrash && !isArchive && filters.view !== 'shared' && !selectMode && (
            <CaptureBar onCompose={onCompose} />
          )}
          <div className="noted-list-controls">
            {filterChip && (
              <Button size="sm" variant="ghost" onClick={onClearFilter}>
                Clear collection filter
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={viewOptionsRef}
                  variant="ghost"
                  size="sm"
                  className="noted-view-trigger"
                  aria-label="View options"
                  title="View options"
                >
                  <SlidersHorizontal aria-hidden="true" />
                  View options
                  {hasDateFilter && (
                    <span
                      className="size-1.5 rounded-full bg-primary"
                      title="Date filters active"
                    />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-50">
                <DropdownMenuLabel>Layout</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={layout} aria-label="Layout">
                  {NOTE_LAYOUT_OPTIONS.map(({ value, label, icon: Icon }) => (
                    <DropdownMenuRadioItem
                      key={value}
                      value={value}
                      onSelect={() => setLayout(value)}
                    >
                      <Icon aria-hidden="true" />
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Show</DropdownMenuLabel>
                {libraryViews.map((view) => (
                  <DropdownMenuItem key={view} onSelect={() => onView(view)}>
                    {VIEW_TITLES[view]}
                    {filters.view === view && !filterChip && (
                      <Check className="ml-auto" aria-label="Current view" />
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Sort notes</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={filters.sort}
                      onValueChange={(value) => onSort(value as NoteSort)}
                    >
                      <DropdownMenuRadioItem value="updated">Last edited</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="created">Date created</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="title">Title (A–Z)</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem onSelect={() => setDateOpen(true)}>
                  <CalendarDays /> Date filters
                </DropdownMenuItem>
                {items.length > 0 && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setSelectMode((value) => !value);
                      setSelected(new Set());
                    }}
                  >
                    {selectMode ? 'Exit selection' : 'Select notes'}
                  </DropdownMenuItem>
                )}
                {isTrash && (counts.data?.trash ?? 0) > 0 && !selectMode && (
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirm('empty')}>
                    <Trash2 /> Empty Trash
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

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
          <ListSkeleton layout={layout} />
        ) : items.length === 0 ? (
          <ListEmpty
            view={filters.view}
            searching={!!filters.search.trim()}
            filtered={!!filterChip}
            hasDateFilter={hasDateFilter}
          />
        ) : (
          <ul className="noted-index" data-layout={layout} role="list">
            {items.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                showReminderDate={filters.view === 'reminders'}
                selectMode={selectMode}
                checked={selected.has(n.id)}
                onToggle={() => toggle(n.id)}
                onOpen={() => onOpen(n.id)}
                search={filters.search}
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="noted-index-actions"
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

      <Dialog open={dateOpen} onOpenChange={setDateOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            viewOptionsRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Date filters</DialogTitle>
            <DialogDescription>Show notes created or edited on or after a date.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {dateFields.map(([key, label]) => (
              <label
                key={key}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                {label}
                <Input
                  type="date"
                  className="w-auto"
                  value={filters[key]?.slice(0, 10) ?? ''}
                  onChange={(event) =>
                    onDates({
                      [key]: event.target.value ? `${event.target.value}T00:00:00.000Z` : undefined,
                    })
                  }
                />
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => onDates({ createdAfter: undefined, updatedAfter: undefined })}
            >
              Clear dates
            </Button>
            <Button onClick={() => setDateOpen(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

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
  showReminderDate,
  selectMode,
  checked,
  onToggle,
  onOpen,
  search,
  actions,
}: {
  note: NoteSummary;
  showReminderDate: boolean;
  selectMode: boolean;
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
  search: string;
  actions: React.ReactNode;
}) {
  const now = useNow();
  const colored = !!note.color && note.color !== 'default';
  const changedAt = note.deletedAt ?? note.updatedAt;
  const reminderAt = note.reminderCompletedAt ? null : note.reminderAt;
  const overdue = !!reminderAt && Date.parse(reminderAt) < now;
  const title = displayTitle(note.title, note.preview);
  const body = snippet(
    note.title.trim() ? note.preview : note.preview.trimStart().split('\n').slice(1).join('\n'),
    search,
  );
  return (
    <li
      data-note-color={colored ? note.color : undefined}
      data-selected={selectMode && checked}
      className={cn('noted-index-card group/row', colored && 'noted-index-colored')}
    >
      <div className="noted-index-inner">
        {selectMode && (
          <Checkbox
            checked={checked}
            onCheckedChange={onToggle}
            aria-label={`Select ${title}`}
            className="noted-index-checkbox"
          />
        )}
        <button
          type="button"
          onClick={selectMode ? onToggle : onOpen}
          className="noted-index-entry"
          data-testid="note-row"
        >
          <span
            className={cn(
              'noted-index-title line-clamp-2',
              !note.title.trim() && !note.preview.trim() && 'text-muted-foreground',
            )}
          >
            <Highlight text={title} query={search} />
          </span>
          {body && (
            <span className="noted-index-preview line-clamp-2">
              <Highlight text={body} query={search} />
            </span>
          )}
          {showReminderDate && reminderAt && (
            <span className={cn('noted-index-due', overdue && 'text-destructive')}>
              <Bell size={14} aria-hidden="true" />
              <time dateTime={reminderAt}>
                {overdue ? 'Overdue · ' : ''}
                {formatDateTime(reminderAt)}
              </time>
            </span>
          )}
          <span className="noted-index-meta">
            <time dateTime={changedAt} title={new Date(changedAt).toLocaleString()}>
              {formatRelative(changedAt)}
            </time>
            {colored && (
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ background: `var(--note-${note.color})` }}
              />
            )}
            {note.isPinned && (
              <Pin
                className="size-3.5 fill-primary/20 text-primary"
                role="img"
                aria-label="Pinned"
              />
            )}
            {note.isFavorite && (
              <Star className="size-3.5 text-primary" role="img" aria-label="Favorite" />
            )}
            {reminderAt && !showReminderDate && (
              <span
                className={cn('inline-flex items-center', overdue && 'text-destructive')}
                title={`${overdue ? 'Overdue reminder' : 'Reminder'} · ${new Date(reminderAt).toLocaleString()}`}
              >
                <Bell size={14} role="img" aria-label={overdue ? 'Overdue reminder' : 'Reminder'} />
              </span>
            )}
          </span>
        </button>
        {actions}
      </div>
    </li>
  );
}

function ListSkeleton({ layout }: { layout: NotesLayout }) {
  return (
    <div className="noted-index" data-layout={layout} aria-busy="true" aria-label="Loading notes">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="noted-index-skeleton space-y-2">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="mt-4 h-3 w-1/5" />
        </div>
      ))}
    </div>
  );
}

function ListEmpty({
  view,
  searching,
  filtered,
  hasDateFilter,
}: {
  view: string;
  searching: boolean;
  filtered: boolean;
  hasDateFilter: boolean;
}) {
  const className = 'noted-list-empty';
  if (searching)
    return (
      <EmptyState className={className} icon={<SearchX />} title="No matching notes">
        Try a different word, or check Archive and Trash.
      </EmptyState>
    );
  if (hasDateFilter)
    return (
      <EmptyState className={className} icon={<CalendarDays />} title="No notes in this date range">
        Adjust your date filters in View options.
      </EmptyState>
    );
  if (view === 'trash')
    return (
      <EmptyState className={className} icon={<Trash2 />} title="Trash is empty">
        Deleted notes appear here so you can restore them.
      </EmptyState>
    );
  if (view === 'archive')
    return (
      <EmptyState className={className} icon={<Archive />} title="No archived notes">
        Archive notes you want to keep but don’t need every day.
      </EmptyState>
    );
  if (view === 'shared')
    return (
      <EmptyState className={className} icon={<NotebookText />} title="No shared notes">
        Notes shared with you appear here.
      </EmptyState>
    );
  if (view === 'reminders')
    return (
      <EmptyState className={className} icon={<Bell />} title="No reminders">
        Use Note tools to add a reminder to a note.
      </EmptyState>
    );
  if (view === 'favorites')
    return (
      <EmptyState className={className} icon={<Star />} title="No favorites">
        Mark a note as a favorite for quick access.
      </EmptyState>
    );
  if (view === 'pinned')
    return (
      <EmptyState className={className} icon={<Pin />} title="Nothing pinned">
        Pin important notes to keep them at the top.
      </EmptyState>
    );
  return (
    <EmptyState
      className={className}
      icon={<NotebookText />}
      title={
        filtered
          ? 'No notes here yet'
          : view === 'recent'
            ? 'No recent notes'
            : 'Write your first note'
      }
    >
      {filtered && 'Create a note here, or move existing notes in from the editor.'}
    </EmptyState>
  );
}
