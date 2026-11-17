import { readBrowserValue, writeBrowserValue } from '@/lib/browserStorage';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudOff, CloudUpload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useRepo } from '@/app/RepositoryProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { drafts } from '@/data/drafts';
import { requestPersistentStorage } from '@/data/local/idb';
import { ConflictError, NotFoundError, type NoteSort, type NoteView } from '@/domain/types';
import { supabase } from '@/lib/supabase';
import { plural } from '@/lib/format';
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
import { WorkspaceAnnouncements } from './WorkspaceAnnouncements';
import { GuestStorageNotice } from './GuestStorageNotice';
import { createCompositionNote, hasCompositionText, type NoteComposition } from './noteComposition';
import { newId } from '@/lib/ids';
import { AccountMenu } from '@/features/auth/AccountMenu';
import './workspace.css';
import { useReminderDelivery } from './reminders';
import { Sidebar, useSidebarHost } from './Sidebar';
import { NoteList } from './NoteList';
import { NoteEditorContainer } from './NoteEditor';
import { useSidebarPreference } from './workspacePreferences';

interface WorkspaceLocationState {
  toast?: string;
  returnToLibrary?: boolean;
  composition?: NoteComposition;
}

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
function useBackgroundDraftSync(openNoteId?: string) {
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
        // The open editor owns its draft, even while its initial queries are pending.
        if (cancelled || d.noteId === openNoteId || activeSavers.has(d.noteId)) continue;
        try {
          const text = { title: d.title, content: d.content };
          if (d.creation) {
            if (!hasCompositionText(text)) {
              await drafts.clear(repo.scope, d.noteId, d);
              continue;
            }
            const note = await createCompositionNote(repo, d.creation, text);
            qc.setQueryData(qk.note(repo.scope, d.noteId), note);
          } else {
            await repo.updateNote(d.noteId, text, { expectedUpdatedAt: d.baseUpdatedAt });
          }
          await drafts.clear(repo.scope, d.noteId, d);
          void qc.invalidateQueries({ queryKey: qk.note(repo.scope, d.noteId) });
          saved++;
        } catch (e) {
          if (!d.creation && e instanceof NotFoundError) await drafts.clear(repo.scope, d.noteId);
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
  }, [repo, online, refresh, qc, openNoteId]);
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

  const [navOpen, setNavOpen] = useState(false);
  const { collapsed, setCollapsed } = useSidebarPreference();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const searchRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLDivElement>(null);
  const libraryFocus = useRef<HTMLElement | null>(null);
  const libraryScrollTop = useRef(0);
  const returningFromEditor = useRef(false);
  const routeState = location.state as WorkspaceLocationState | null;
  const composition = routeState?.composition;
  const currentComposition =
    composition?.scope === repo.scope && composition.noteId === noteId ? composition : undefined;

  useLayoutEffect(() => {
    if (noteId) {
      returningFromEditor.current = true;
      return;
    }
    if (returningFromEditor.current) {
      returningFromEditor.current = false;
      const list = libraryRef.current?.querySelector<HTMLElement>('.noted-list-scroll');
      if (list) list.scrollTop = libraryScrollTop.current;
    }
    if (libraryFocus.current) {
      const target = libraryFocus.current;
      libraryFocus.current = null;
      if (libraryRef.current?.contains(target)) target.focus({ preventScroll: true });
      else libraryRef.current?.querySelector<HTMLElement>('button.noted-capture')?.focus();
    }
  }, [noteId]);

  const base = useMemo(() => parseFilters(sp), [sp]);
  const filters: ListFilters = { ...base, search: debouncedSearch };

  useBackgroundDraftSync(noteId);
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
    if (!user) void requestPersistentStorage();
  }, [user]);

  useEffect(() => {
    const msg = (location.state as { toast?: string } | null)?.toast;
    if (msg) toast.success(msg);
  }, [location.state]);

  // Warn before leaving with unsaved edits. Flush editor changes when the tab is hidden.
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

  const librarySearch = location.search;
  const openEditor = useCallback(
    (id: string, draft?: NoteComposition) => {
      if (!noteId && document.activeElement instanceof HTMLElement) {
        libraryFocus.current = document.activeElement;
      }
      if (!noteId) {
        const list = libraryRef.current?.querySelector<HTMLElement>('.noted-list-scroll');
        if (list) libraryScrollTop.current = list.scrollTop;
      }
      setNavOpen(false);
      void navigate(
        { pathname: `/notes/${id}`, search: librarySearch },
        {
          state: { returnToLibrary: !noteId, composition: draft } satisfies WorkspaceLocationState,
        },
      );
    },
    [navigate, librarySearch, noteId],
  );
  const closeNote = useCallback(() => {
    if (routeState?.returnToLibrary) void navigate(-1);
    else void navigate({ pathname: '/notes', search: librarySearch }, { replace: true });
  }, [navigate, librarySearch, routeState?.returnToLibrary]);

  const setFilters = (patch: Partial<ListFilters>) => {
    const next = { ...base, ...patch };
    setSp(toParams(next));
  };

  const openNewNote = useCallback(() => {
    if (noteId) return;
    const id = newId();
    const draft: NoteComposition = {
      noteId: id,
      scope: repo.scope,
      createdAt: new Date().toISOString(),
      folderId: base.folderId,
      tagIds: base.tagId ? [base.tagId] : [],
    };
    // This ID was generated here. Open the editor immediately without inserting a row.
    qc.setQueryData(qk.note(repo.scope, id), null);
    openEditor(id, draft);
  }, [noteId, repo.scope, base.folderId, base.tagId, qc, openEditor]);

  // Keyboard shortcuts. Ctrl/Cmd+N is reserved by most browsers, so Alt+N is the reliable alternative.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (noteId || e.defaultPrevented || e.repeat) return;
      if (document.activeElement?.closest('[role="menu"], [role="dialog"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (
        (mod && !e.shiftKey && key === 'n') ||
        (e.altKey && !mod && (key === 'n' || e.code === 'KeyN'))
      ) {
        e.preventDefault();
        openNewNote();
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
  }, [noteId, openNewNote]);

  const sidebarHost = useSidebarHost({
    filters,
    select: (f) =>
      setFilters({ folderId: null, tagId: null, uncategorized: false, view: 'all', ...f }),
  });

  const sidebar = (
    <Sidebar
      filters={filters}
      actions={sidebarHost.actions}
      onSelect={setFilters}
      onNavigate={() => setNavOpen(false)}
      collapsed={isDesktop && collapsed}
      onToggle={isDesktop ? () => setCollapsed(!collapsed) : undefined}
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
      onCompose={openNewNote}
      onView={(view) => setFilters({ view, folderId: null, tagId: null, uncategorized: false })}
      profile={
        <AccountMenu
          onImport={sidebarHost.actions.importTxt}
          onCloudSave={() => sidebarHost.actions.open({ kind: 'cloud-save' })}
        />
      }
      onOpen={openEditor}
      onMenu={isDesktop ? undefined : () => setNavOpen(true)}
    />
  );

  return (
    <div className="noted-workspace flex h-dvh flex-col overflow-hidden">
      <div
        ref={libraryRef}
        hidden={!!noteId}
        className={cn('min-h-0 flex-1 flex-col', noteId ? 'hidden' : 'flex')}
        onScrollCapture={(event) => {
          if (
            !noteId &&
            event.target instanceof HTMLElement &&
            event.target.matches('.noted-list-scroll')
          )
            libraryScrollTop.current = event.target.scrollTop;
        }}
      >
        {!online && (
          <div
            className="flex items-center justify-center gap-2 bg-warning/15 px-4 py-1.5 text-xs font-medium text-foreground"
            role="status"
          >
            <CloudOff className="size-3.5" aria-hidden="true" />
            {repo.kind === 'cloud'
              ? 'You’re offline. New notes and edits are kept on this device and sync after reconnecting.'
              : 'You’re offline. Guest notes keep working on this device.'}
          </div>
        )}
        <GuestStorageNotice />
        {online && <WorkspaceAnnouncements />}
        <GuestImportBanner />
        {sidebarHost.elements}
        <div className="noted-workspace-body flex min-h-0 flex-1">
          {isDesktop ? (
            <aside
              className={cn(
                'noted-sidebar-shell relative shrink-0',
                collapsed ? 'w-[4.375rem]' : 'w-[14.5rem]',
              )}
            >
              {sidebar}
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
                <SheetDescription className="sr-only">Views, folders and tags</SheetDescription>
                {sidebar}
              </SheetContent>
            </Sheet>
          )}

          <main className="noted-library min-h-0 min-w-0 flex-1 overflow-hidden">{listEl}</main>
        </div>
      </div>
      {noteId && (
        <main
          className="noted-editor-pane min-h-0 min-w-0 flex-1 overflow-hidden"
          aria-label="Note editor"
        >
          <NoteEditorContainer
            noteId={noteId}
            composition={currentComposition}
            onBack={closeNote}
            onClosed={closeNote}
          />
        </main>
      )}
    </div>
  );
}
