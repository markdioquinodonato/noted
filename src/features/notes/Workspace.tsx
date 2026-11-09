import { readBrowserValue, writeBrowserValue } from '@/lib/browserStorage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudOff, CloudUpload, X, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BrandMark } from '@/components/BrandLogo';
import { cn } from '@/lib/utils';
import { useRepo } from '@/app/RepositoryProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { drafts } from '@/data/drafts';
import { requestPersistentStorage } from '@/data/local/idb';
import { ConflictError, NotFoundError, type NoteSort, type NoteView } from '@/domain/types';
import { supabase } from '@/lib/supabase';
import { guestMode } from '@/lib/mode';
import { errorMessage, plural } from '@/lib/format';
import {
  importLedgerKey,
  importRevisionsKey,
  noteSnapshot,
  type ImportLedger,
} from '@/features/migration/guestMigration';
import { activeSavers, anyUnsavedChanges, flushAllSavers } from './noteSaver';
import {
  qk,
  useDebouncedValue,
  useMediaQuery,
  useOnline,
  useRefreshLists,
  type ListFilters,
} from './hooks';
import { GuestStorageNotice } from './GuestStorageNotice';
import { Dashboard } from './Dashboard';
import { useReminderDelivery } from './reminders';
import { Sidebar, useSidebarHost } from './Sidebar';
import { NoteList } from './NoteList';
import { NoteEditorContainer } from './NoteEditor';

const VIEWS: NoteView[] = [
  'all',
  'recent',
  'pinned',
  'favorites',
  'reminders',
  'shared',
  'archive',
  'trash',
];
const SORTS: NoteSort[] = ['updated', 'created', 'title'];

function parseFilters(sp: URLSearchParams): Omit<ListFilters, 'search'> {
  const view = sp.get('view') as NoteView;
  const sort = sp.get('sort') as NoteSort;
  return {
    view: VIEWS.includes(view) ? view : 'all',
    sort: SORTS.includes(sort) ? sort : 'updated',
    folderId: sp.get('folder'),
    tagId: sp.get('tag'),
    uncategorized: sp.get('uncategorized') === '1',
    createdAfter: sp.get('createdAfter') || undefined,
    updatedAfter: sp.get('updatedAfter') || undefined,
  };
}

function toParams(f: Omit<ListFilters, 'search'>): URLSearchParams {
  const p = new URLSearchParams();
  if (f.view !== 'all') p.set('view', f.view);
  if (f.sort !== 'updated') p.set('sort', f.sort);
  if (f.folderId) p.set('folder', f.folderId);
  if (f.tagId) p.set('tag', f.tagId);
  if (f.createdAfter) p.set('createdAfter', f.createdAfter);
  if (f.updatedAfter) p.set('updatedAfter', f.updatedAfter);
  if (f.uncategorized) p.set('uncategorized', '1');
  return p;
}

/** Saves drafts left behind by closed editors (e.g. edited offline, then switched notes). */
function useBackgroundDraftSync() {
  const { repo } = useRepo();
  const refresh = useRefreshLists();
  const qc = useQueryClient();
  const online = useOnline();
  useEffect(() => {
    if (!online && repo.kind === 'cloud') return;
    let cancelled = false;
    (async () => {
      const pending = await drafts.listForScope(repo.scope);
      let saved = 0;
      for (const d of pending) {
        if (cancelled || activeSavers.has(d.noteId)) continue;
        try {
          await repo.updateNote(
            d.noteId,
            { title: d.title, content: d.content },
            { expectedUpdatedAt: d.baseUpdatedAt },
          );
          await drafts.clear(repo.scope, d.noteId, d);
          void qc.invalidateQueries({ queryKey: qk.note(repo.scope, d.noteId) });
          saved++;
        } catch (e) {
          if (e instanceof NotFoundError) await drafts.clear(repo.scope, d.noteId);
          else if (
            e instanceof ConflictError &&
            e.latest &&
            e.latest.title === d.title &&
            e.latest.content === d.content
          )
            await drafts.clear(repo.scope, d.noteId);
          // Other conflicts are kept and surfaced when the note is opened.
        }
      }
      if (saved && !cancelled) {
        refresh();
        toast.success(`Saved ${plural(saved, 'pending change')} from this device.`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, online, refresh, qc]);
}

function GuestImportBanner() {
  const { cloud, local } = useRepo();
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(
    () => readBrowserValue(`noted:import-banner:${user?.id}`, 'sessionStorage') === '1',
  );
  const pending = useQuery({
    queryKey: ['guest-pending', user?.id],
    enabled: !!cloud && !!user && !dismissed,
    queryFn: async () => {
      const { notes } = await local.exportAll();
      const ledger = (await local.getMeta<ImportLedger>(importLedgerKey(user!.id))) ?? {};
      const revisions =
        (await local.getMeta<Record<string, string>>(importRevisionsKey(user!.id))) ?? {};
      return notes.filter(
        (n) => (!ledger[n.id] || revisions[n.id] !== noteSnapshot(n)) && (n.title || n.content),
      ).length;
    },
  });
  if (!cloud || dismissed || !pending.data) return null;
  return (
    <div className="flex items-center gap-3 border-b bg-accent px-4 py-2 text-sm text-accent-foreground">
      <CloudUpload className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">
        Would you like to save your guest notes to your account? Review{' '}
        {plural(pending.data, 'local note')} before transferring.
      </span>
      <Button size="sm" asChild>
        <Link to="/import">Review &amp; import</Link>
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Dismiss"
        onClick={() => {
          writeBrowserValue(`noted:import-banner:${user?.id}`, '1', 'sessionStorage');
          setDismissed(true);
        }}
      >
        <X />
      </Button>
    </div>
  );
}

export function Workspace() {
  const { repo } = useRepo();
  const { user } = useAuth();
  const { noteId } = useParams();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const refresh = useRefreshLists();
  const online = useOnline();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const isTablet = useMediaQuery('(min-width: 768px)');
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => readBrowserValue('noted:sidebar-collapsed') === '1',
  );
  const toggleSidebar = () =>
    setCollapsed((value) => {
      writeBrowserValue('noted:sidebar-collapsed', value ? '0' : '1');
      return !value;
    });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const searchRef = useRef<HTMLInputElement>(null);
  const creating = useRef(false);

  const base = parseFilters(sp);
  const filters: ListFilters = { ...base, search: debouncedSearch };

  useBackgroundDraftSync();
  useReminderDelivery();
  useEffect(() => {
    if (repo.kind !== 'cloud' || !supabase) return;
    const channel = supabase
      .channel(`notes-list:${repo.scope}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes' }, () =>
        refresh(),
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes' }, () =>
        refresh(),
      )
      .subscribe();
    return () => {
      void supabase!.removeChannel(channel);
    };
  }, [repo, refresh]);

  useEffect(() => {
    if (!user) {
      guestMode.choose();
      void requestPersistentStorage();
    }
  }, [user]);

  useEffect(() => {
    const msg = (location.state as { toast?: string } | null)?.toast;
    if (msg) toast.success(msg);
  }, [location.state]);

  // Warn before leaving with unsaved edits; flush when the tab is hidden.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (anyUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') void flushAllSavers();
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', hidden);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', hidden);
    };
  }, []);

  const search_ = sp.toString() ? `?${sp.toString()}` : '';
  const openNote = useCallback(
    (id: string) => navigate({ pathname: `/notes/${id}`, search: search_ }),
    [navigate, search_],
  );
  const closeNote = useCallback(
    () => navigate({ pathname: '/notes', search: search_ }),
    [navigate, search_],
  );

  const setFilters = (patch: Partial<ListFilters>) => {
    const next = { ...base, ...patch };
    setSp(toParams(next));
  };

  const newNote = useCallback(async () => {
    if (creating.current) return;
    creating.current = true;
    try {
      const inSpecialView =
        base.view === 'archive' || base.view === 'trash' || base.view === 'pinned';
      const note = await repo.createNote({
        folderId: base.folderId,
        tagIds: base.tagId ? [base.tagId] : [],
      });
      qc.setQueryData(qk.note(repo.scope, note.id), note);
      refresh();
      const params = new URLSearchParams(inSpecialView ? toParams({ ...base, view: 'all' }) : sp);
      params.delete('dashboard');
      setSearch('');
      navigate({
        pathname: `/notes/${note.id}`,
        search: params.toString() ? `?${params.toString()}` : '',
      });
    } catch (e) {
      toast.error(errorMessage(e, 'Could not create a note.'));
    } finally {
      creating.current = false;
    }
  }, [repo, base, qc, refresh, navigate, sp]);

  // Keyboard shortcuts. Ctrl/Cmd+N is reserved by most browsers, so Alt+N is the reliable alternative.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (
        (mod && !e.shiftKey && key === 'n') ||
        (e.altKey && !mod && (key === 'n' || e.code === 'KeyN'))
      ) {
        e.preventDefault();
        void newNote();
        return;
      }
      if (mod && key === 'f') {
        const active = document.activeElement as HTMLElement | null;
        // Inside the note body, leave the browser's own find-in-page alone.
        if (active?.getAttribute('aria-label') === 'Note content') return;
        if (searchRef.current) {
          e.preventDefault();
          searchRef.current.focus();
          searchRef.current.select();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newNote]);

  const selectFilter = (f: Partial<ListFilters>) => {
    setFilters(f);
    if (!isTablet && noteId) closeNote();
  };
  const sidebarHost = useSidebarHost({
    filters,
    select: (f) =>
      selectFilter({ folderId: null, tagId: null, uncategorized: false, view: 'all', ...f }),
  });

  const sidebar = (
    <Sidebar
      filters={filters}
      actions={sidebarHost.actions}
      onSelect={selectFilter}
      onNewNote={() => {
        setNavOpen(false);
        void newNote();
      }}
      onNavigate={() => setNavOpen(false)}
    />
  );

  const listEl = (
    <NoteList
      ref={searchRef}
      filters={filters}
      search={search}
      onSearch={setSearch}
      onSort={(sort) => setFilters({ sort })}
      onDates={setFilters}
      onClearFilter={() => setFilters({ folderId: null, tagId: null, uncategorized: false })}
      selectedId={noteId}
      onOpen={openNote}
      onCloseOpenNote={closeNote}
      onNewNote={() => void newNote()}
      onMenu={isDesktop ? undefined : () => setNavOpen(true)}
    />
  );

  const editorEl = noteId ? (
    <NoteEditorContainer
      noteId={noteId}
      showBack={!isTablet}
      onBack={closeNote}
      onClosed={closeNote}
    />
  ) : (
    <Dashboard
      onNewNote={() => void newNote()}
      onOpen={openNote}
      onFolder={(id) => setFilters({ folderId: id, view: 'all' })}
      onMenu={isTablet ? undefined : () => setNavOpen(true)}
      search={search}
      onSearch={setSearch}
      onShowNotes={() =>
        setFilters({ view: 'all', folderId: null, tagId: null, uncategorized: false })
      }
    />
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {!online && (
        <div
          className="flex items-center justify-center gap-2 bg-warning/15 px-4 py-1.5 text-xs font-medium text-foreground"
          role="status"
        >
          <CloudOff className="size-3.5" aria-hidden="true" />
          {repo.kind === 'cloud'
            ? 'You’re offline. Previously opened notes can be edited here. Text edits stay on this device and sync after reconnecting.'
            : 'You’re offline. Guest notes keep working on this device.'}
        </div>
      )}
      <GuestStorageNotice />
      <GuestImportBanner />
      {sidebarHost.elements}
      <div className={cn('flex min-h-0 flex-1', isDesktop && 'bg-desk')}>
        {isDesktop ? (
          <aside className={collapsed ? 'w-16 shrink-0' : 'relative w-60 shrink-0 2xl:w-64'}>
            {collapsed ? (
              <div className="flex flex-col items-center gap-2">
                <Link
                  to="/welcome"
                  aria-label="Noted home"
                  title="Noted"
                  className="grid h-16 place-items-center rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <BrandMark size={32} />
                </Link>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      className="size-10 rounded-xl shadow-md shadow-primary/25"
                      aria-label="New note"
                      onClick={() => void newNote()}
                    >
                      <Plus />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">New note</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 rounded-xl text-muted-foreground"
                      aria-label="Expand sidebar"
                      onClick={toggleSidebar}
                    >
                      <PanelLeftOpen />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Expand sidebar</TooltipContent>
                </Tooltip>
              </div>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-4 right-2 z-10"
                  aria-label="Collapse sidebar"
                  onClick={toggleSidebar}
                >
                  <PanelLeftClose />
                </Button>
                {sidebar}
              </>
            )}
          </aside>
        ) : (
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetContent
              side="left"
              className="w-[18rem] max-w-[85vw] gap-0 p-0 [&>button]:hidden"
              // Focus the drawer itself (not its first button) so no tooltip pops open.
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).focus();
              }}
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">
                Views, folders, tags and settings
              </SheetDescription>
              {sidebar}
            </SheetContent>
          </Sheet>
        )}

        {isDesktop ? (
          <div className="flex min-w-0 flex-1 gap-2 py-2 pr-2">
            <div className="w-[19.5rem] shrink-0 overflow-hidden rounded-2xl border bg-background shadow-sm shadow-slate-900/[0.04] 2xl:w-[22rem]">
              {listEl}
            </div>
            <main className="min-w-0 flex-1 overflow-hidden rounded-2xl border bg-background shadow-sm shadow-slate-900/[0.04]">
              {editorEl}
            </main>
          </div>
        ) : isTablet ? (
          <>
            <div className="w-[20rem] shrink-0 border-r">{listEl}</div>
            <main className="min-w-0 flex-1">{editorEl}</main>
          </>
        ) : noteId || sp.get('dashboard') === '1' ? (
          <main className="min-w-0 flex-1">{editorEl}</main>
        ) : (
          <div className="min-w-0 flex-1">{listEl}</div>
        )}
      </div>
    </div>
  );
}
