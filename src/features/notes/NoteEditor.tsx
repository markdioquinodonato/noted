import { useBlocker, useLocation, useNavigate } from 'react-router';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Check,
  FileQuestion,
  CloudOff,
  Download,
  History,
  MoreHorizontal,
  Palette,
  Pin,
  PinOff,
  RotateCcw,
  Save,
  Trash2,
  Star,
  Copy,
  Maximize,
  Minimize,
  ScanText,
  Type,
  SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import { RadioGroup } from 'radix-ui';
import { BrandMark } from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, EmptyState, modKey, Spinner } from '@/components/common';
import { useRepo } from '@/app/RepositoryProvider';
import { drafts, type DraftRecord } from '@/data/drafts';
import { LIMITS, type Note, type NoteDraft } from '@/domain/types';
import { errorMessage, formatDateTime, formatRelative } from '@/lib/format';
import { countCharacters, countWords, displayTitle } from '@/lib/text';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { exportNoteAsTxt } from '@/features/io/txt';
import { AiAssistant } from './AiAssistant';
import { ProductivityTools } from './ProductivityTools';
import { exportMarkdown, exportDocx, printNote } from '@/features/io/documents';
import { RichEditor, type RichEditorHandle } from './RichEditor';
import { NOTE_COLORS, noteFont, textDocument, withFont } from '@/lib/richText';
import { DEFAULT_FONT, getNoteFont, NOTE_FONTS } from '@/lib/fonts';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScannerDialog } from '@/features/scanner/ScannerDialog';
import { NoteSaver, type SaverState } from './noteSaver';
import { emptyCompositionNote, type NoteComposition } from './noteComposition';
import {
  qk,
  useFolders,
  useNote,
  usePreferences,
  useRefreshLists,
  useTagMutations,
  useTags,
} from './hooks';
import { FolderPicker, TagPicker } from './pickers';
import { ConfirmDialog } from './dialogs';
import { VersionHistoryDialog } from './VersionHistoryDialog';
import type { CaptureMode } from './CaptureBar';
import './focusEditor.css';

interface ContainerProps {
  noteId: string;
  onBack: () => void;
  onClosed: () => void;
  composition?: NoteComposition;
}

/** Loads the note (+ any recovered local draft) and mounts a fresh editor per note. */
export function NoteEditorContainer({ noteId, onBack, onClosed, composition }: ContainerProps) {
  const { repo } = useRepo();
  const note = useNote(noteId, !!composition);
  const draft = useQuery({
    queryKey: ['draft', repo.scope, noteId],
    queryFn: async () => (await drafts.get(repo.scope, noteId)) ?? null,
    networkMode: 'always',
    staleTime: 0,
    gcTime: 0,
  });
  const [epoch, setEpoch] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  const historyState = location.state as {
    capture?: CaptureMode;
    composition?: NoteComposition;
  } | null;
  const capture = historyState?.capture;
  const compositionInfo = composition ?? draft.data?.creation;
  const creation = note.data ? undefined : compositionInfo;
  const initial = note.data ?? (creation ? emptyCompositionNote(creation) : null);

  useEffect(() => {
    if (capture && note.data && !draft.isLoading) {
      void navigate(location.pathname + location.search, {
        replace: true,
        state: { ...historyState, capture: undefined },
        preventScrollReset: true,
      });
    }
  }, [
    capture,
    historyState,
    note.data,
    draft.isLoading,
    location.pathname,
    location.search,
    navigate,
  ]);

  if (note.isLoading || draft.isLoading)
    return (
      <EditorPlaceholder onBack={onBack}>
        <EditorSkeleton />
      </EditorPlaceholder>
    );
  if (note.isError && !initial)
    return (
      <EditorPlaceholder onBack={onBack}>
        <Alert tone="error">
          {errorMessage(note.error, 'Could not load this note.')}{' '}
          <button className="font-medium underline" onClick={() => void note.refetch()}>
            Retry
          </button>
        </Alert>
      </EditorPlaceholder>
    );
  if (!initial)
    return (
      <EmptyState
        icon={<FileQuestion />}
        title="Note not found"
        action={
          <Button variant="outline" onClick={onClosed}>
            Back to notes
          </Button>
        }
      >
        It may have been permanently deleted.
      </EmptyState>
    );

  return (
    <NoteEditor
      key={`${noteId}:${epoch}`}
      note={initial}
      creation={creation}
      draft={draft.data ?? null}
      initialCapture={capture}
      onBack={onBack}
      onClosed={onClosed}
      onReload={() => setEpoch((e) => e + 1)}
    />
  );
}

function EditorSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading note">
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  );
}

function EditorPlaceholder({
  children,
  onBack,
}: {
  children: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <div className="noted-focus">
      <div className="noted-focus-header">
        <div className="noted-focus-toolbar">
          <div className="noted-focus-brand">
            <BrandMark size={27} />
            <span>Noted</span>
          </div>
          <Button variant="outline" className="noted-focus-done" onClick={onBack}>
            Done
          </Button>
        </div>
      </div>
      <div className="noted-focus-scroll scrollbar-thin">
        <div className="noted-focus-sheet">{children}</div>
      </div>
    </div>
  );
}

function SaveIndicator({
  state,
  local,
  isNew,
  onRetry,
}: {
  state: SaverState;
  local: boolean;
  isNew: boolean;
  onRetry: () => void;
}) {
  const where = local ? 'on this device' : 'to cloud';
  const content = (() => {
    switch (state.status) {
      case 'saving':
        return (
          <>
            <Spinner className="size-3.5" label="Saving" /> Saving…
          </>
        );
      case 'unsaved':
        return (
          <>
            <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />{' '}
            Unsaved changes
          </>
        );
      case 'offline':
        if (state.localDraftSaved === false)
          return (
            <span className="text-destructive">
              Offline — local backup failed. Download your edits.
            </span>
          );
        return (
          <>
            <CloudOff className="size-3.5 text-warning" aria-hidden="true" /> Offline — kept on this
            device
          </>
        );
      case 'error':
        return (
          <>
            <AlertTriangle className="size-3.5 text-destructive" aria-hidden="true" />
            <span className="text-destructive">Not saved</span>
            <button
              type="button"
              onClick={onRetry}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Retry
            </button>
          </>
        );
      case 'conflict':
        return (
          <>
            <AlertTriangle className="size-3.5 text-warning" aria-hidden="true" /> Needs attention
          </>
        );
      default:
        return isNew ? (
          <>
            <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" /> New
            note
          </>
        ) : (
          <>
            <Check className="size-3.5 text-primary" aria-hidden="true" /> Saved {where}
          </>
        );
    }
  })();
  return (
    <span
      className="noted-focus-save"
      role="status"
      aria-live="polite"
      data-testid="save-status"
      data-status={state.status}
    >
      {content}
    </span>
  );
}

interface EditorProps {
  note: Note;
  creation?: NoteComposition;
  draft: DraftRecord | null;
  onBack: () => void;
  onClosed: () => void;
  onReload: () => void;
  initialCapture?: CaptureMode;
}

function NoteEditor({
  note: initial,
  creation,
  draft,
  onBack,
  onClosed,
  onReload,
  initialCapture,
}: EditorProps) {
  const { repo } = useRepo();
  const qc = useQueryClient();
  const refreshLists = useRefreshLists();
  const { prefs } = usePreferences();
  const folders = useFolders();
  const tags = useTags();
  const tagMutations = useTagMutations();

  const recovered =
    draft && (draft.title !== initial.title || draft.content !== initial.content) ? draft : null;
  const [title, setTitle] = useState(recovered?.title ?? initial.title);
  const [content, setContent] = useState(recovered?.content ?? initial.content);
  const [font, setFont] = useState(() => noteFont(recovered?.content ?? initial.content));
  const writing = getNoteFont(font);
  const changeFont = (next: string) => {
    const value = withFont(content, next);
    setFont(next === DEFAULT_FONT ? undefined : next);
    setContent(value);
    saver.edit({ content: value });
  };
  const [meta, setMeta] = useState<Note>(initial);
  const [conflict, setConflict] = useState<Note | null | undefined>(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<RichEditorHandle>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(initialCapture === 'scan');
  const [colorOpen, setColorOpen] = useState(initialCapture === 'color');
  const [formattingOpen, setFormattingOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const scanInserted = useRef(false);
  const scanToggle = useRef<HTMLButtonElement>(null);
  const colorToggle = useRef<HTMLButtonElement>(null);
  const toolsToggle = useRef<HTMLButtonElement>(null);
  const moreToggle = useRef<HTMLButtonElement>(null);
  const enteringFocus = useRef(false);
  const editorRoot = useRef<HTMLDivElement>(null);
  const [initialAction] = useState(initialCapture);

  // One saver per mounted note. Created once; re-activated on StrictMode remount.
  const [saver] = useState(
    () =>
      new NoteSaver(initial.id, initial, {
        repo,
        drafts,
        creation,
        autosave: prefs.autosaveEnabled,
        // Guest notes live in IndexedDB: saving never depends on the network.
        isOnline: repo.kind === 'local' ? () => true : undefined,
        initialDirty: recovered
          ? { title: recovered.title, content: recovered.content }
          : undefined,
        initialBase: recovered?.baseUpdatedAt,
        onSaved: (n) => {
          setMeta(n);
          qc.setQueryData(qk.note(repo.scope, n.id), n);
          refreshLists();
        },
        onConflict: (latest) => setConflict(latest),
      }),
  );
  const state = useSyncExternalStore(saver.subscribe, () => saver.getState());
  const ensureCreated = useCallback(() => saver.ensureCreated(), [saver]);

  useEffect(() => {
    saver.activate();
    return () => {
      void saver.dispose().then(() => {
        void qc.invalidateQueries({ queryKey: ['note', repo.scope, initial.id] });
        refreshLists();
      });
    };
  }, [saver, qc, repo.scope, initial.id, refreshLists]);

  useEffect(() => saver.setAutosave(prefs.autosaveEnabled), [saver, prefs.autosaveEnabled]);

  useEffect(() => {
    if (recovered)
      toast.info('Recovered unsaved changes from this device.', { id: `recovered-${initial.id}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-device: when the window regains focus and we have no local edits, pick up remote changes.
  useEffect(() => {
    let active = true;
    const onFocus = async () => {
      if (saver.isNew || saver.hasUnsavedChanges() || document.visibilityState !== 'visible')
        return;
      try {
        const latest = await repo.getNote(initial.id);
        if (!active) return;
        if (latest && latest.updatedAt !== saver.baseUpdatedAt && !saver.hasUnsavedChanges()) {
          qc.setQueryData(qk.note(repo.scope, latest.id), latest);
          onReload();
        } else if (latest) {
          setMeta((m) => ({ ...m, tagIds: latest.tagIds, permission: latest.permission }));
        } else if (!saver.hasUnsavedChanges()) onClosed();
      } catch {
        /* offline — ignore */
      }
    };
    const channel =
      repo.kind === 'cloud' && supabase
        ? supabase
            .channel(`note:${repo.scope}:${initial.id}`)
            .on(
              'postgres_changes',
              { event: 'UPDATE', schema: 'public', table: 'notes', filter: `id=eq.${initial.id}` },
              () => {
                void onFocus();
              },
            )
            .subscribe()
        : null;
    window.addEventListener('focus', onFocus);
    const timer = setInterval(() => void onFocus(), repo.kind === 'cloud' ? 15000 : 5000);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
      if (channel) void supabase!.removeChannel(channel);
    };
  }, [saver, repo, initial.id, qc, onReload, onClosed]);

  // Auto-grow title. Re-measure when the font changes and once web fonts finish
  // loading, since a newly loaded typeface can be taller than the fallback.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    document.fonts?.addEventListener?.('loadingdone', fit);
    window.addEventListener('resize', fit);
    void document.fonts?.ready.then(fit);
    return () => {
      document.fonts?.removeEventListener?.('loadingdone', fit);
      window.removeEventListener('resize', fit);
    };
  }, [title, font]);

  // Capture dialogs handle their own focus. Open editable notes with the cursor ready.
  useEffect(() => {
    if (initialAction) return;
    if (!initial.deletedAt && initial.permission !== 'read') bodyRef.current?.focus();
    else editorRoot.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deferred = useDeferredValue(content);
  const words = useMemo(() => (detailsOpen ? countWords(deferred) : 0), [deferred, detailsOpen]);
  const chars = useMemo(
    () => (detailsOpen ? countCharacters(deferred) : 0),
    [deferred, detailsOpen],
  );

  const trashed = !!meta.deletedAt;
  const readOnly = trashed || conflict !== undefined || meta.permission === 'read';
  const metaReadOnly = readOnly || !!meta.permission;

  const runMeta = async (patch: NoteDraft, success?: string) => {
    try {
      await saver.updateMeta(patch);
      if (success) toast.success(success);
      return true;
    } catch (e) {
      if ((e as Error).name === 'ConflictError') {
        setConflict((e as { latest: Note | null }).latest);
      } else toast.error(errorMessage(e));
      return false;
    }
  };

  const saveNow = useCallback(async () => {
    await saver.flush();
    const s = saver.getState().status;
    if (s === 'saved' && !saver.isNew) {
      try {
        const v = await repo.createCheckpoint(initial.id);
        if (v) {
          void qc.invalidateQueries({ queryKey: qk.versions(repo.scope, initial.id) });
          toast.success('Saved · version checkpoint created', { id: 'saved' });
        } else toast.success('Saved', { id: 'saved' });
      } catch (e) {
        toast.error(errorMessage(e));
      }
    } else if (s === 'offline') {
      toast.warning(
        'You’re offline. Changes are kept on this device and will save when you reconnect.',
        { id: 'saved' },
      );
    }
  }, [saver, repo, initial.id, qc]);

  // Ctrl/Cmd+S → save + checkpoint
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow]);

  const setTags = async (tagIds: string[]) => {
    const prev = meta.tagIds;
    try {
      await ensureCreated();
      setMeta((m) => ({ ...m, tagIds }));
      await repo.setNoteTags(initial.id, tagIds);
      qc.setQueryData(qk.note(repo.scope, initial.id), (n: Note | null | undefined) =>
        n ? { ...n, tagIds } : n,
      );
      refreshLists();
    } catch (e) {
      setMeta((m) => ({ ...m, tagIds: prev }));
      toast.error(errorMessage(e));
    }
  };

  const saveBeforeLeaving = useCallback(async () => {
    try {
      await saver.flush();
      const current = saver.getState();
      if (saver.hasUnsavedChanges()) {
        if (current.status === 'conflict') {
          toast.error('Resolve the conflicting edits before closing this note.');
          return false;
        }
        if (!current.localDraftSaved) {
          toast.error('Keep this note open and retry, or download a copy of your edits.');
          return false;
        }
        toast.info('Your pending edits are saved on this device.');
      }
      return true;
    } catch (error) {
      toast.error(errorMessage(error, 'Could not finish saving this note.'));
      return false;
    }
  }, [saver]);

  const routeBlocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        currentLocation.pathname !== nextLocation.pathname &&
        saver.hasUnsavedChanges() &&
        (!saver.getState().localDraftSaved || saver.getState().status === 'conflict'),
      [saver],
    ),
  );
  const leaving = closing || routeBlocker.state === 'blocked';

  useEffect(() => {
    if (routeBlocker.state !== 'blocked') return;
    let active = true;
    void saveBeforeLeaving().then((safe) => {
      if (!active) return;
      if (safe) routeBlocker.proceed();
      else routeBlocker.reset();
    });
    return () => {
      active = false;
    };
  }, [routeBlocker, saveBeforeLeaving]);

  const finishWriting = async () => {
    if (closingRef.current || routeBlocker.state === 'blocked') return;
    closingRef.current = true;
    setClosing(true);
    try {
      if (await saveBeforeLeaving()) onBack();
    } finally {
      closingRef.current = false;
      setClosing(false);
    }
  };

  const restoreFromTrash = () => runMeta({ deletedAt: null }, 'Note restored');
  const moveToTrash = async () => {
    if (!(await runMeta({ deletedAt: new Date().toISOString(), isPinned: false }, undefined)))
      return;
    toast.success('Moved to Trash', {
      action: {
        label: 'Undo',
        onClick: () => void repo.updateNote(initial.id, { deletedAt: null }).then(refreshLists),
      },
    });
    onClosed();
  };
  const deleteForever = async () => {
    await repo.deleteNotePermanently(initial.id);
    qc.removeQueries({ queryKey: qk.note(repo.scope, initial.id) });
    refreshLists();
    toast.success('Note permanently deleted');
    onClosed();
  };

  const fontSize = prefs.fontSize;
  const edited = state.lastSavedAt ?? meta.updatedAt;
  const leaveImmersion = () => {
    setFullscreen(false);
    requestAnimationFrame(() => moreToggle.current?.focus());
  };

  return (
    <div
      ref={editorRoot}
      tabIndex={-1}
      className="noted-focus"
      data-immersive={fullscreen}
      onKeyDownCapture={(event) => {
        if (
          fullscreen &&
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          editorRoot.current?.contains(event.target as Node)
        ) {
          event.preventDefault();
          event.stopPropagation();
          leaveImmersion();
        }
      }}
      data-note-color={meta.color && meta.color !== 'default' ? meta.color : undefined}
    >
      <div className="noted-focus-header">
        <div className="noted-focus-toolbar">
          <div className="noted-focus-brand">
            <BrandMark size={27} />
            <span>Noted</span>
          </div>
          <div className="noted-focus-actions" aria-label="Writing controls" role="group">
            {fullscreen && (
              <Button
                variant="ghost"
                size="sm"
                onClick={leaveImmersion}
                aria-label="Exit focus writing"
              >
                <Minimize />
                <span>Exit focus writing</span>
              </Button>
            )}
            {!fullscreen && !readOnly && (
              <Button
                variant={formattingOpen ? 'secondary' : 'ghost'}
                size="sm"
                aria-expanded={formattingOpen}
                aria-controls="noted-text-formatting"
                aria-label="Format text"
                title="Format text"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setFormattingOpen((open) => !open)}
              >
                <Type />
                <span>Format</span>
              </Button>
            )}
            {!fullscreen && !trashed && (
              <Button
                ref={toolsToggle}
                variant={toolsOpen ? 'secondary' : 'ghost'}
                size="sm"
                aria-expanded={toolsOpen}
                aria-controls="noted-note-tools"
                aria-label="Note tools"
                title="Note tools"
                onClick={() => setToolsOpen((open) => !open)}
              >
                <SlidersHorizontal />
                <span>Tools</span>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={moreToggle}
                  variant="ghost"
                  size="icon"
                  className={fullscreen ? 'hidden' : undefined}
                  aria-label="More note actions"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56"
                onCloseAutoFocus={(event) => {
                  if (!enteringFocus.current) return;
                  event.preventDefault();
                  enteringFocus.current = false;
                  bodyRef.current?.focus();
                }}
              >
                <DropdownMenuItem
                  onSelect={() => {
                    enteringFocus.current = true;
                    setFullscreen(true);
                  }}
                >
                  <Maximize /> Focus writing
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDetailsOpen((open) => !open)}>
                  {detailsOpen ? 'Hide note details' : 'Show note details'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {!trashed && !readOnly && !saver.isNew && (
                  <DropdownMenuItem onSelect={() => void saveNow()}>
                    <Save /> Save checkpoint <DropdownMenuShortcut>{modKey}+S</DropdownMenuShortcut>
                  </DropdownMenuItem>
                )}
                {!trashed && !saver.isNew && (
                  <DropdownMenuItem
                    disabled={readOnly}
                    onSelect={async () => {
                      try {
                        const n = await repo.createNote({
                          title: `${title || 'Untitled'} (copy)`.slice(0, LIMITS.titleMax),
                          content,
                          folderId: meta.permission ? null : meta.folderId,
                          tagIds: meta.permission ? [] : meta.tagIds,
                          color: meta.color,
                          isFavorite: meta.isFavorite,
                        });
                        refreshLists();
                        toast.success(`Duplicated as ${n.title}`);
                      } catch (e) {
                        toast.error(errorMessage(e));
                      }
                    }}
                  >
                    <Copy /> Duplicate note
                  </DropdownMenuItem>
                )}
                {!trashed && !meta.permission && !saver.isNew && (
                  <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
                    <History /> Version history
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => exportNoteAsTxt({ title, content })}>
                  <Download /> Export as .txt
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportMarkdown({ title, content })}>
                  <Download /> Export as Markdown
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void exportDocx({ title, content }).catch((e) => toast.error(errorMessage(e)));
                  }}
                >
                  <Download /> Export as DOCX
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void printNote({ title, content }).catch((e) => toast.error(errorMessage(e)));
                  }}
                >
                  <Download /> Print / Save as PDF
                </DropdownMenuItem>
                {!saver.isNew && <DropdownMenuSeparator />}
                {trashed && (
                  <>
                    <DropdownMenuItem onSelect={() => void restoreFromTrash()}>
                      <RotateCcw /> Restore
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                      <Trash2 /> Delete forever
                    </DropdownMenuItem>
                  </>
                )}
                {!trashed && !saver.isNew && (
                  <>
                    <DropdownMenuItem
                      disabled={metaReadOnly}
                      onSelect={() =>
                        runMeta(
                          { isArchived: !meta.isArchived },
                          meta.isArchived ? 'Note unarchived' : 'Note archived',
                        )
                      }
                    >
                      {meta.isArchived ? <ArchiveRestore /> : <Archive />}
                      {meta.isArchived ? 'Unarchive' : 'Archive'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={metaReadOnly}
                      onSelect={() => void moveToTrash()}
                    >
                      <Trash2 /> Move to Trash
                      <DropdownMenuShortcut />
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              className="noted-focus-done"
              disabled={leaving}
              aria-busy={leaving}
              onClick={() => void finishWriting()}
            >
              <Check aria-hidden="true" /> Done
            </Button>
          </div>
        </div>
      </div>

      {/* Banners */}
      {conflict !== undefined && (
        <div className="border-b bg-warning/10 px-4 py-3 text-sm" role="alert">
          <p className="font-medium">This note was changed in another tab or device.</p>
          <p className="mt-0.5 text-muted-foreground">
            Choose which version to keep. Your edits are safely stored on this device until you
            decide.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!conflict}
              onClick={() => {
                saver.keepMine(conflict);
                setConflict(undefined);
              }}
            >
              Keep my version
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const copy = await repo.createNote({
                    title: `${title || 'Untitled'} (conflict copy)`.slice(0, LIMITS.titleMax),
                    content,
                  });
                  toast.success(`Saved your edits as ${copy.title}`);
                  const latest = await repo.getNote(initial.id);
                  if (latest) {
                    await saver.discardMine(latest);
                    qc.setQueryData(qk.note(repo.scope, latest.id), latest);
                    onReload();
                  } else onClosed();
                  refreshLists();
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              Keep both as separate notes
            </Button>
            <Button size="sm" variant="ghost" onClick={() => exportNoteAsTxt({ title, content })}>
              Download my edits
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const latest = conflict ?? (await repo.getNote(initial.id));
                if (!latest) {
                  onClosed();
                  return;
                }
                await saver.discardMine(latest);
                qc.setQueryData(qk.note(repo.scope, latest.id), latest);
                onReload();
              }}
            >
              Use the other version
            </Button>
          </div>
        </div>
      )}
      {trashed && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-destructive/8 px-4 py-2.5 text-sm">
          <Trash2 className="size-4 text-destructive" aria-hidden="true" />
          <span className="flex-1">This note is in Trash.</span>
          <Button size="sm" variant="outline" onClick={() => void restoreFromTrash()}>
            <RotateCcw /> Restore
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            Delete forever
          </Button>
        </div>
      )}
      {!trashed && meta.isArchived && (
        <div className="flex items-center gap-2 border-b bg-muted px-4 py-2 text-sm">
          <Archive className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="flex-1 text-muted-foreground">
            Archived — hidden from your main notes.
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => runMeta({ isArchived: false }, 'Note unarchived')}
          >
            Unarchive
          </Button>
        </div>
      )}

      {meta.permission && (
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">
          Shared note ·{' '}
          {meta.permission === 'read'
            ? 'Read only'
            : 'You can edit text. Concurrent changes are checked on save.'}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        {!trashed && (
          <div
            id="noted-note-tools"
            hidden={!toolsOpen || fullscreen}
            className="noted-focus-tools"
            aria-label="Note tools"
            role="group"
          >
            {!readOnly && (
              <Button
                ref={scanToggle}
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  scanInserted.current = false;
                  setScannerOpen(true);
                }}
                aria-label="Scan text with camera"
                aria-haspopup="dialog"
              >
                <ScanText />
                <span>Scan text</span>
              </Button>
            )}
            <ProductivityTools
              note={meta}
              disabled={readOnly}
              bodyRef={bodyRef}
              update={runMeta}
              ensureCreated={ensureCreated}
              initialTool={
                initialAction === 'voice' ||
                initialAction === 'attachments' ||
                initialAction === 'reminder'
                  ? initialAction
                  : null
              }
              returnFocus={() => {
                if (toolsOpen) toolsToggle.current?.focus();
                else titleRef.current?.focus();
              }}
            />
            <AiAssistant
              bodyRef={bodyRef}
              disabled={readOnly}
              onTitle={(value) => {
                setTitle(value);
                saver.edit({ title: value });
              }}
            />
            <FontPicker value={font ?? DEFAULT_FONT} disabled={readOnly} onChange={changeFont} />
            {!meta.permission && (
              <div
                className="flex w-full flex-wrap items-center gap-1 border-t pt-1"
                role="group"
                aria-label="Organize note"
              >
                <FolderPicker
                  folders={folders.data ?? []}
                  value={meta.folderId}
                  disabled={metaReadOnly}
                  onChange={(folderId) =>
                    runMeta({ folderId }, folderId ? 'Moved to folder' : 'Removed from folder')
                  }
                />
                <TagPicker
                  tags={tags.data ?? []}
                  value={meta.tagIds}
                  disabled={metaReadOnly}
                  onChange={setTags}
                  onCreate={(name) => tagMutations.create.mutateAsync(name)}
                />
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={meta.isFavorite ? 'Remove favorite' : 'Favorite note'}
                  aria-pressed={!!meta.isFavorite}
                  disabled={metaReadOnly}
                  onClick={() => runMeta({ isFavorite: !meta.isFavorite })}
                >
                  <Star className={meta.isFavorite ? 'fill-current text-primary' : ''} />
                  Favorite
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-pressed={meta.isPinned}
                  aria-label={meta.isPinned ? 'Unpin note' : 'Pin note'}
                  disabled={metaReadOnly}
                  onClick={() => runMeta({ isPinned: !meta.isPinned })}
                  className={cn(meta.isPinned && 'text-primary')}
                >
                  {meta.isPinned ? <PinOff /> : <Pin />}
                  {meta.isPinned ? 'Unpin' : 'Pin'}
                </Button>
                <Button
                  ref={colorToggle}
                  variant="ghost"
                  size="xs"
                  aria-label="Note color"
                  aria-haspopup="dialog"
                  disabled={metaReadOnly}
                  onClick={() => setColorOpen(true)}
                >
                  <Palette />
                  Color
                </Button>
              </div>
            )}
          </div>
        )}
        {/* Writing area */}
        <div
          className="noted-focus-scroll scrollbar-thin"
          onClick={(e) => e.target === e.currentTarget && bodyRef.current?.focus()}
        >
          <div className="noted-focus-sheet">
            <textarea
              ref={titleRef}
              value={title}
              rows={1}
              maxLength={LIMITS.titleMax}
              readOnly={readOnly || leaving}
              placeholder={readOnly ? 'Untitled note' : 'Title (optional)'}
              aria-label="Note title"
              onChange={(e) => {
                const v = e.target.value.replace(/\n/g, ' ');
                setTitle(v);
                saver.edit({ title: v });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  bodyRef.current?.focus();
                }
              }}
              style={{ fontFamily: writing.family, ['--font-scale' as string]: writing.scale }}
              className="noted-focus-title"
            />
            <RichEditor
              ref={bodyRef}
              initialContent={content}
              readOnly={readOnly || leaving}
              showFormatting={formattingOpen && !fullscreen && !readOnly}
              fontSize={fontSize}
              font={font}
              autoFocus={!readOnly && (initialAction === 'checklist' || !initialAction)}
              onChange={(value) => {
                setContent(value);
                saver.edit({ content: value });
              }}
              onBlur={() => {
                if (saver.hasUnsavedChanges() && prefs.autosaveEnabled) void saver.flush();
              }}
            />
            <ScannerDialog
              open={scannerOpen}
              onOpenChange={setScannerOpen}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (scanInserted.current) bodyRef.current?.focus();
                else if (toolsOpen) scanToggle.current?.focus();
                else titleRef.current?.focus();
              }}
              onInsert={(text) => {
                const editor = bodyRef.current?.getEditor();
                if (!editor || editor.isDestroyed) throw new Error('The note is not ready yet.');
                editor
                  .chain()
                  .focus()
                  .insertContent(textDocument(text).content ?? [])
                  .run();
                scanInserted.current = true;
                toast.success('Scanned text added to your note');
              }}
            />
          </div>
        </div>
      </div>

      <div className="noted-focus-footer">
        <div className="noted-focus-footer-inner">
          <SaveIndicator
            state={state}
            local={repo.kind === 'local'}
            isNew={saver.isNew}
            onRetry={() => void saver.flush()}
          />
          {!prefs.autosaveEnabled && <span>Autosave off · {modKey}+S to save</span>}
          {detailsOpen && !fullscreen && (
            <div className="noted-focus-details" aria-label="Note details" role="group">
              {!saver.isNew && (
                <time dateTime={edited} title={formatDateTime(edited)}>
                  Edited {formatRelative(edited)}
                </time>
              )}
              <span data-testid="word-count">
                {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
              </span>
              <span data-testid="char-count">
                {chars.toLocaleString()} {chars === 1 ? 'character' : 'characters'}
              </span>
            </div>
          )}
        </div>
      </div>

      <Dialog open={colorOpen && !metaReadOnly} onOpenChange={setColorOpen}>
        <DialogContent
          className="sm:max-w-xs"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (toolsOpen && !metaReadOnly) colorToggle.current?.focus();
            else if (toolsOpen) toolsToggle.current?.focus();
            else titleRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Note color</DialogTitle>
            <DialogDescription>Choose a color for this note.</DialogDescription>
          </DialogHeader>
          <NoteColorPicker
            value={meta.color ?? 'default'}
            disabled={metaReadOnly}
            onChange={(color) => void runMeta({ color })}
          />
        </DialogContent>
      </Dialog>
      <VersionHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        noteId={initial.id}
        current={{ title, content }}
        beforeRestore={async () => {
          await saver.flush();
          if (saver.hasUnsavedChanges())
            throw new Error('Save or resolve your pending edits before restoring a version.');
        }}
        onRestored={(n) => {
          qc.setQueryData(qk.note(repo.scope, n.id), n);
          void saver.discardMine(n).then(onReload);
          refreshLists();
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this note forever?"
        description={
          <>
            “{displayTitle(title, content)}” and its version history will be permanently deleted.{' '}
            <strong>This can’t be undone.</strong>
          </>
        }
        confirmLabel="Delete forever"
        destructive
        onConfirm={deleteForever}
      />
    </div>
  );
}

const COLOR_LABELS: Record<string, string> = {
  default: 'Default',
  rose: 'Rose',
  amber: 'Amber',
  sage: 'Sage',
  sky: 'Sky',
  violet: 'Violet',
};

/** Swatches that re-theme the whole note (paper, ink and accents). */
function NoteColorPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange(color: string): void;
}) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={onChange}
      aria-label="Note color"
      disabled={disabled}
      className="mx-auto grid w-fit grid-cols-3 gap-2 rounded-2xl border bg-muted/30 p-2 min-[360px]:grid-cols-6 sm:mx-0"
    >
      {NOTE_COLORS.map((c) => {
        const selected = value === c;
        return (
          <RadioGroup.Item
            key={c}
            value={c}
            aria-label={COLOR_LABELS[c]}
            title={`${COLOR_LABELS[c]} theme`}
            className={cn(
              'grid size-8 place-items-center rounded-full border transition-transform outline-none hover:scale-110 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
              selected && 'ring-2 ring-foreground/70 ring-offset-1 ring-offset-background',
            )}
            style={{
              background:
                c === 'default'
                  ? 'linear-gradient(135deg, #ffffff 50%, #0d1520 50%)'
                  : `var(--note-${c})`,
              borderColor: c === 'default' ? 'var(--input)' : 'transparent',
            }}
          >
            {selected && (
              <Check
                className={cn('size-3.5', c === 'default' ? 'text-primary' : 'text-white')}
                strokeWidth={3}
                aria-hidden="true"
              />
            )}
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}

/** Writing-font chooser: each option is previewed in its own typeface. */
function FontPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange(font: string): void;
}) {
  const [open, setOpen] = useState(false);
  const current = getNoteFont(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled}
          aria-label="Font"
          title={`Font: ${current.label}`}
        >
          <Type />
          <span>Font</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={10}
        className="max-h-[min(70dvh,var(--radix-popover-content-available-height))] w-72 overflow-auto p-2"
      >
        <p className="px-2 pt-1 pb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Writing font
        </p>
        <div role="radiogroup" aria-label="Writing font" className="space-y-0.5">
          {NOTE_FONTS.map((f) => {
            const selected = f.id === value;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={f.label}
                onClick={() => {
                  if (!selected) onChange(f.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  selected && 'bg-primary/10 hover:bg-primary/15',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-10 shrink-0 place-items-center rounded-lg border bg-card text-xl',
                    selected && 'border-primary/40 text-primary',
                  )}
                  style={{ fontFamily: f.family, fontSize: `${1.25 * f.scale}rem` }}
                >
                  Aa
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-foreground"
                    style={{ fontFamily: f.family, fontSize: `${0.95 * f.scale}rem` }}
                  >
                    {f.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">{f.hint}</span>
                </span>
                {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
