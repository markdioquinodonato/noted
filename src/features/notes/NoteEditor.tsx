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
  ArrowLeft,
  Check,
  FileQuestion,
  CloudOff,
  Download,
  History,
  MoreHorizontal,
  Pin,
  PinOff,
  RotateCcw,
  Save,
  Trash2,
  X,
  Star,
  Copy,
  Maximize,
  Minimize,
  ScanText,
  Type,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
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
import {
  qk,
  useFolders,
  useNote,
  useMediaQuery,
  usePreferences,
  useRefreshLists,
  useTagMutations,
  useTags,
} from './hooks';
import { FolderPicker, TagPicker } from './pickers';
import { ConfirmDialog } from './dialogs';
import { VersionHistoryDialog } from './VersionHistoryDialog';

interface ContainerProps {
  noteId: string;
  onBack: () => void;
  onClosed: () => void;
  showBack: boolean;
}

/** Loads the note (+ any recovered local draft) and mounts a fresh editor per note. */
export function NoteEditorContainer({ noteId, onBack, onClosed, showBack }: ContainerProps) {
  const { repo } = useRepo();
  const note = useNote(noteId);
  const draft = useQuery({
    queryKey: ['draft', repo.scope, noteId],
    queryFn: async () => (await drafts.get(repo.scope, noteId)) ?? null,
    staleTime: 0,
    gcTime: 0,
  });
  const [epoch, setEpoch] = useState(0);

  if (note.isLoading || draft.isLoading) return <EditorSkeleton />;
  if (note.isError)
    return (
      <div className="p-6">
        <Alert tone="error">
          {errorMessage(note.error, 'Could not load this note.')}{' '}
          <button className="font-medium underline" onClick={() => void note.refetch()}>
            Retry
          </button>
        </Alert>
      </div>
    );
  if (!note.data)
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
      note={note.data}
      draft={draft.data ?? null}
      showBack={showBack}
      onBack={onBack}
      onClosed={onClosed}
      onReload={() => setEpoch((e) => e + 1)}
    />
  );
}

function EditorSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-6 sm:p-10" aria-busy="true">
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  );
}

function SaveIndicator({
  state,
  local,
  onRetry,
}: {
  state: SaverState;
  local: boolean;
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
            <span className="size-2 rounded-full bg-warning" aria-hidden="true" /> Unsaved changes
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
        return (
          <>
            <Check className="size-3.5 text-success" aria-hidden="true" /> Saved {where}
          </>
        );
    }
  })();
  return (
    <span
      className="inline-flex items-center gap-1.5"
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
  draft: DraftRecord | null;
  showBack: boolean;
  onBack: () => void;
  onClosed: () => void;
  onReload: () => void;
}

function NoteEditor({ note: initial, draft, showBack, onBack, onClosed, onReload }: EditorProps) {
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
  const [scannerOpen, setScannerOpen] = useState(false);

  // One saver per mounted note. Created once; re-activated on StrictMode remount.
  const [saver] = useState(
    () =>
      new NoteSaver(initial.id, initial, {
        repo,
        drafts,
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
    const onFocus = async () => {
      if (saver.hasUnsavedChanges() || document.visibilityState !== 'visible') return;
      try {
        const latest = await repo.getNote(initial.id);
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
    void document.fonts?.ready.then(fit);
    return () => document.fonts?.removeEventListener?.('loadingdone', fit);
  }, [title, font]);

  // Focus body for brand-new empty notes.
  useEffect(() => {
    if (!initial.title && !initial.content) titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deferred = useDeferredValue(content);
  const words = useMemo(() => countWords(deferred), [deferred]);
  const chars = useMemo(() => countCharacters(deferred), [deferred]);

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
    if (s === 'saved') {
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
    setMeta((m) => ({ ...m, tagIds }));
    try {
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

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col bg-editor text-foreground transition-colors duration-300',
        fullscreen && 'fixed inset-0 z-40',
      )}
      data-note-color={meta.color && meta.color !== 'default' ? meta.color : undefined}
    >
      {/* Toolbar */}
      <div className="flex h-14 shrink-0 items-center gap-1 border-b bg-background/60 px-2 backdrop-blur sm:px-4">
        {showBack && (
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to notes list">
            <ArrowLeft />
          </Button>
        )}
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
        <div className="flex-1" />
        <span className="mr-1 hidden rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground md:inline-flex">
          <SaveIndicator
            state={state}
            local={repo.kind === 'local'}
            onRetry={() => void saver.flush()}
          />
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="hidden sm:inline-flex"
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen writing'}
          onClick={() => setFullscreen((v) => !v)}
        >
          {fullscreen ? <Minimize /> : <Maximize />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={meta.isFavorite ? 'Remove favorite' : 'Favorite note'}
          aria-pressed={!!meta.isFavorite}
          disabled={metaReadOnly}
          onClick={() => runMeta({ isFavorite: !meta.isFavorite })}
        >
          <Star className={meta.isFavorite ? 'fill-amber-400 text-amber-500' : ''} />
        </Button>
        {!trashed && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-pressed={meta.isPinned}
                  aria-label={meta.isPinned ? 'Unpin note' : 'Pin note'}
                  disabled={metaReadOnly}
                  onClick={() => runMeta({ isPinned: !meta.isPinned })}
                  className={cn(meta.isPinned && 'text-primary')}
                >
                  {meta.isPinned ? <PinOff /> : <Pin />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{meta.isPinned ? 'Unpin' : 'Pin to top'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Save now (${modKey}+S)`}
                  disabled={readOnly}
                  onClick={() => void saveNow()}
                >
                  <Save />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save &amp; checkpoint ({modKey}+S)</TooltipContent>
            </Tooltip>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More note actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {!trashed && (
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
            {!trashed && !meta.permission && (
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
            <DropdownMenuSeparator />
            {trashed ? (
              <>
                <DropdownMenuItem onSelect={() => void restoreFromTrash()}>
                  <RotateCcw /> Restore
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                  <Trash2 /> Delete forever
                </DropdownMenuItem>
              </>
            ) : (
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
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row-reverse">
        {!trashed && (
          <div
            className="tool-dock flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-1.5 scrollbar-none sm:px-4 lg:w-[4.75rem] lg:flex-col lg:gap-1 lg:overflow-x-visible lg:overflow-y-auto lg:border-b-0 lg:border-l lg:bg-muted/30 lg:px-0 lg:py-3 [&_[data-slot=button]]:shrink-0"
            aria-label="Note tools"
            role="group"
          >
            <AiAssistant
              bodyRef={bodyRef}
              disabled={readOnly}
              onTitle={(value) => {
                setTitle(value);
                saver.edit({ title: value });
              }}
            />
            <span aria-hidden="true" className="hidden h-px w-8 shrink-0 bg-border lg:block" />
            <ProductivityTools note={meta} disabled={readOnly} bodyRef={bodyRef} update={runMeta} />
            <span className="min-w-3 flex-1" />
            <FontPicker value={font ?? DEFAULT_FONT} disabled={readOnly} onChange={changeFont} />
            <span className="hidden text-[0.6rem] font-semibold tracking-wider text-muted-foreground uppercase lg:block">
              Theme
            </span>
            <NoteColorPicker
              value={meta.color ?? 'default'}
              disabled={metaReadOnly}
              onChange={(color) => void runMeta({ color })}
            />
          </div>
        )}
        {/* Writing area */}
        <div
          className="relative min-h-0 flex-1 overflow-y-auto scrollbar-thin"
          onClick={(e) => e.target === e.currentTarget && bodyRef.current?.focus()}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-primary/[0.07] via-primary/[0.025] to-transparent"
          />
          <div className="relative mx-auto flex min-h-full w-full max-w-[50rem] flex-col px-5 pt-6 pb-24 sm:px-10 sm:pt-12 2xl:px-14">
            {meta.tagIds.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {meta.tagIds.map((id) => {
                  const t = tags.data?.find((x) => x.id === id);
                  if (!t) return null;
                  return (
                    <Badge key={id} variant="secondary" className="gap-1 font-normal">
                      #{t.name}
                      {!readOnly && (
                        <button
                          type="button"
                          aria-label={`Remove tag ${t.name}`}
                          onClick={() => void setTags(meta.tagIds.filter((x) => x !== id))}
                          className="-mr-1 rounded-sm opacity-60 hover:opacity-100"
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </Badge>
                  );
                })}
              </div>
            )}
            <textarea
              ref={titleRef}
              value={title}
              rows={1}
              maxLength={LIMITS.titleMax}
              readOnly={readOnly}
              placeholder="Untitled"
              aria-label="Note title"
              onChange={(e) => {
                const v = e.target.value.replace(/\n/g, ' ');
                setTitle(v);
                saver.edit({ title: v });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  bodyRef.current?.focus();
                }
              }}
              style={{ fontFamily: writing.family, ['--font-scale' as string]: writing.scale }}
              className="w-full resize-none overflow-hidden border-0 bg-transparent p-0 pb-1 text-[calc(1.875rem*var(--font-scale,1))] leading-[1.3] font-bold tracking-tight outline-none placeholder:text-muted-foreground/40 sm:text-[calc(2.5rem*var(--font-scale,1))]"
            />
            <p className="mt-3 mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <time dateTime={edited} title={formatDateTime(edited)}>
                Edited {formatRelative(edited)}
              </time>
              <span aria-hidden="true">·</span>
              <span>{Math.max(1, Math.round(words / 200))} min read</span>
              {meta.isPinned && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                  <Pin className="size-3" aria-hidden="true" /> Pinned
                </span>
              )}
            </p>
            <RichEditor
              ref={bodyRef}
              initialContent={content}
              readOnly={readOnly}
              fontSize={fontSize}
              font={font}
              onChange={(value) => {
                setContent(value);
                saver.edit({ content: value });
              }}
              onBlur={() => {
                if (saver.hasUnsavedChanges() && prefs.autosaveEnabled) void saver.flush();
              }}
              trailing={
                !readOnly && (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-lg px-2.5 shadow-sm"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setScannerOpen(true)}
                    aria-label="Scan text with camera"
                    title="Scan text with camera"
                  >
                    <ScanText />
                    <span className="hidden sm:inline">Scan text</span>
                  </Button>
                )
              }
            />
            <ScannerDialog
              open={scannerOpen}
              onOpenChange={setScannerOpen}
              onInsert={(text) => {
                const editor = bodyRef.current?.getEditor();
                if (!editor || editor.isDestroyed) throw new Error('The note is not ready yet.');
                editor
                  .chain()
                  .focus()
                  .insertContent(textDocument(text).content ?? [])
                  .run();
                toast.success('Scanned text added to your note');
              }}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex h-9 shrink-0 items-center gap-3 border-t px-4 text-xs text-muted-foreground">
        <span className="md:hidden">
          <SaveIndicator
            state={state}
            local={repo.kind === 'local'}
            onRetry={() => void saver.flush()}
          />
        </span>
        <span className="hidden truncate md:inline">{displayTitle(title, content)}</span>
        <span className="flex-1" />
        <span data-testid="word-count">
          {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
        </span>
        <span aria-hidden="true">·</span>
        <span data-testid="char-count">
          {chars.toLocaleString()} {chars === 1 ? 'character' : 'characters'}
        </span>
        {!prefs.autosaveEnabled && (
          <span className="hidden sm:inline">· Autosave off — {modKey}+S to save</span>
        )}
      </div>

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
    <div
      role="radiogroup"
      aria-label="Note color"
      className="flex shrink-0 items-center gap-1 rounded-full border bg-background/70 p-1 lg:flex-col lg:gap-1.5 lg:p-1.5"
    >
      {NOTE_COLORS.map((c) => {
        const selected = value === c;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={COLOR_LABELS[c]}
            title={`${COLOR_LABELS[c]} theme`}
            disabled={disabled}
            onClick={() => !selected && onChange(c)}
            className={cn(
              'grid size-6 place-items-center rounded-full border transition-transform outline-none hover:scale-110 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
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
          </button>
        );
      })}
    </div>
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
  const docked = useMediaQuery('(min-width: 1024px)');
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
        side={docked ? 'left' : 'bottom'}
        align={docked ? 'end' : 'start'}
        sideOffset={10}
        className="w-80 p-2"
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
