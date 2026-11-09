import type { NotesRepository } from '@/domain/repository';
import { ConflictError, isNetworkError, type Note, type NoteDraft } from '@/domain/types';
import { errorMessage } from '@/lib/format';

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'offline' | 'error' | 'conflict';

export interface SaverState {
  status: SaveStatus;
  error?: string;
  lastSavedAt?: string;
  localDraftSaved?: boolean;
}

export interface DraftSink {
  put(rec: {
    scope: string;
    noteId: string;
    title: string;
    content: string;
    baseUpdatedAt: string;
  }): Promise<void>;
  clear(
    scope: string,
    noteId: string,
    ifMatches?: { title: string; content: string },
  ): Promise<void>;
}

export interface NoteSaverOptions {
  repo: Pick<NotesRepository, 'updateNote' | 'scope'>;
  drafts?: DraftSink;
  delayMs?: number;
  draftDelayMs?: number;
  autosave?: boolean;
  onState?: (s: SaverState) => void;
  onSaved?: (note: Note) => void;
  onConflict?: (latest: Note | null) => void;
  isOnline?: () => boolean;
  /** Initial edit state (e.g. a recovered draft) different from the stored note. */
  initialDirty?: { title: string; content: string };
  /** Concurrency base for `initialDirty` (the draft's baseUpdatedAt). */
  initialBase?: string;
}

/** Savers for currently open editors (for bulk actions and unload protection). */
export const activeSavers = new Map<string, NoteSaver>();

export function anyUnsavedChanges(): boolean {
  for (const s of activeSavers.values()) if (s.hasUnsavedChanges()) return true;
  return false;
}

export async function flushAllSavers(): Promise<void> {
  await Promise.all([...activeSavers.values()].map((s) => s.flush().catch(() => undefined)));
}

type Text = { title: string; content: string };

/**
 * Per-note save coordinator.
 *  - Debounces edits (no request per keystroke).
 *  - Serialises requests: at most one in flight; newer edits are saved after.
 *  - Never applies server responses to the editor, so a slow/stale response
 *    can't overwrite newer typing.
 *  - Optimistic concurrency via updatedAt → conflict state instead of silent overwrite.
 *  - Offline → waits for `online`; other failures → exponential backoff retry.
 *  - Mirrors unsaved text to a local draft store so refresh/crash can't lose it.
 */
export class NoteSaver {
  private value: Text;
  private base: string;
  private rev = 0;
  private savedRev = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private again = false;
  private retryDelay = 0;
  private conflicted = false;
  private disposed = false;
  private onlineHandler: (() => void) | null = null;
  private state: SaverState = { status: 'saved' };
  private readonly opts: Required<Pick<NoteSaverOptions, 'delayMs' | 'draftDelayMs'>> &
    NoteSaverOptions;
  private autosave: boolean;

  constructor(
    readonly noteId: string,
    initial: Note,
    opts: NoteSaverOptions,
  ) {
    this.opts = { delayMs: 800, draftDelayMs: 300, ...opts };
    this.autosave = opts.autosave ?? true;
    this.value = { title: initial.title, content: initial.content };
    this.base = initial.updatedAt;
    this.state.lastSavedAt = initial.updatedAt;
    if (
      opts.initialDirty &&
      (opts.initialDirty.title !== initial.title || opts.initialDirty.content !== initial.content)
    ) {
      this.value = { ...opts.initialDirty };
      if (opts.initialBase) this.base = opts.initialBase;
      this.rev = 1;
      this.setState({ status: 'unsaved' });
      if (this.autosave) this.schedule(this.opts.delayMs);
    }
  }

  get scope() {
    return this.opts.repo.scope;
  }

  /** Account transitions keep a private draft but must not issue any more remote writes. */
  suspend(): Promise<void> {
    this.disposed = true;
    this.clearTimers();
    this.detachOnline();
    if (activeSavers.get(this.noteId) === this) activeSavers.delete(this.noteId);
    return this.writeDraftNow();
  }

  get current(): Text {
    return { ...this.value };
  }

  get baseUpdatedAt() {
    return this.base;
  }

  hasUnsavedChanges(): boolean {
    return this.rev !== this.savedRev;
  }

  getState(): SaverState {
    return this.state;
  }

  setAutosave(enabled: boolean) {
    this.autosave = enabled;
    if (enabled && this.hasUnsavedChanges()) this.schedule(this.opts.delayMs);
    if (!enabled && this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  edit(patch: Partial<Text>) {
    if (this.disposed) return;
    const next = { ...this.value, ...patch };
    if (next.title === this.value.title && next.content === this.value.content) return;
    this.value = next;
    this.rev++;
    if (!this.conflicted) this.setState({ status: 'unsaved', error: undefined });
    this.scheduleDraft();
    if (this.autosave && !this.conflicted) this.schedule(this.opts.delayMs);
  }

  /** Save immediately (Ctrl/Cmd+S, blur, note switch). Resolves when settled. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.writeDraftNow();
    await this.save();
    if (this.inflight) await this.inflight;
  }

  /**
   * Apply metadata changes (pin, folder, archive, trash …) serialised with text
   * saves so the concurrency token never goes stale. Unsaved text is included.
   */
  async updateMeta(meta: NoteDraft): Promise<Note> {
    while (this.inflight) await this.inflight;
    let result: Note | undefined;
    this.inflight = (async () => {
      await this.writeDraftNow();
      const rev = this.rev;
      const text = this.hasUnsavedChanges() ? { ...this.value } : {};
      const payload = { ...this.value };
      const note = await this.opts.repo.updateNote(
        this.noteId,
        { ...meta, ...text },
        { expectedUpdatedAt: this.base },
      );
      result = note;
      this.base = note.updatedAt;
      if (rev > this.savedRev) this.savedRev = rev;
      this.opts.onSaved?.(note);
      if (!this.hasUnsavedChanges()) {
        await this.opts.drafts?.clear(this.opts.repo.scope, this.noteId, payload);
        this.setState({ status: 'saved', error: undefined, lastSavedAt: note.updatedAt });
      }
    })()
      .catch(async (error) => {
        if (error instanceof ConflictError) {
          this.conflicted = true;
          this.setState({ status: 'conflict', error: error.message });
          this.opts.onConflict?.(error.latest);
        }
        throw error;
      })
      .finally(() => {
        this.inflight = null;
      });
    try {
      await this.inflight;
    } finally {
      if (this.autosave && this.hasUnsavedChanges() && !this.conflicted)
        this.schedule(this.opts.delayMs);
    }
    return result!;
  }

  /** Conflict resolution: keep local text and overwrite the remote version. */
  keepMine(latest: Note | null) {
    if (latest) this.base = latest.updatedAt;
    this.conflicted = false;
    this.setState({ status: 'unsaved' });
    void this.save();
  }

  /** Conflict resolution: discard local edits and adopt the stored version. */
  async discardMine(latest: Note) {
    this.conflicted = false;
    this.value = { title: latest.title, content: latest.content };
    this.base = latest.updatedAt;
    this.savedRev = this.rev;
    await this.opts.drafts?.clear(this.opts.repo.scope, this.noteId);
    this.setState({ status: 'saved', error: undefined, lastSavedAt: latest.updatedAt });
  }

  /** (Re)attach to the UI. Safe to call after dispose (React StrictMode remounts). */
  activate() {
    this.disposed = false;
    activeSavers.set(this.noteId, this);
    if (this.autosave && this.hasUnsavedChanges() && !this.conflicted)
      this.schedule(this.opts.delayMs);
  }

  /** Stop timers; flush pending work in the background. */
  dispose(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (activeSavers.get(this.noteId) === this) activeSavers.delete(this.noteId);
    const done = this.hasUnsavedChanges() && !this.conflicted ? this.flush() : this.writeDraftNow();
    this.disposed = true;
    this.clearTimers();
    return done.catch(() => undefined).finally(() => this.detachOnline());
  }

  // ---------------------------------------------------------------------------

  private listeners = new Set<() => void>();

  /** For useSyncExternalStore. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private setState(patch: Partial<SaverState>) {
    this.state = { ...this.state, ...patch };
    this.opts.onState?.(this.state);
    this.listeners.forEach((l) => l());
  }

  private schedule(ms: number) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, ms);
  }

  private scheduleDraft() {
    if (!this.opts.drafts) return;
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      this.draftTimer = null;
      void this.writeDraftNow();
    }, this.opts.draftDelayMs);
  }

  private async writeDraftNow() {
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }
    if (!this.opts.drafts || !this.hasUnsavedChanges()) return;
    try {
      await this.opts.drafts.put({
        scope: this.opts.repo.scope,
        noteId: this.noteId,
        title: this.value.title,
        content: this.value.content,
        baseUpdatedAt: this.base,
      });
      if (!this.state.localDraftSaved) this.setState({ localDraftSaved: true });
    } catch {
      this.setState({
        localDraftSaved: false,
        error: 'Local backup failed. Keep this tab open and download your edits.',
      });
    }
  }

  private clearTimers() {
    for (const t of [this.saveTimer, this.draftTimer, this.retryTimer]) if (t) clearTimeout(t);
    this.saveTimer = this.draftTimer = this.retryTimer = null;
  }

  private isOnline() {
    return this.opts.isOnline
      ? this.opts.isOnline()
      : typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  private waitForOnline() {
    this.setState({ status: 'offline', error: undefined });
    if (this.onlineHandler || typeof window === 'undefined') return;
    this.onlineHandler = () => {
      this.detachOnline();
      void this.save();
    };
    window.addEventListener('online', this.onlineHandler);
  }

  private detachOnline() {
    if (this.onlineHandler && typeof window !== 'undefined')
      window.removeEventListener('online', this.onlineHandler);
    this.onlineHandler = null;
  }

  private save(): Promise<void> {
    if (this.inflight) {
      this.again = true;
      return this.inflight.catch(() => undefined);
    }
    if (this.conflicted || !this.hasUnsavedChanges()) return Promise.resolve();
    if (!this.isOnline()) {
      this.waitForOnline();
      return Promise.resolve();
    }

    this.inflight = (async () => {
      try {
        do {
          this.again = false;
          if (this.conflicted || !this.hasUnsavedChanges()) break;
          const rev = this.rev;
          const payload = { ...this.value };
          this.setState({ status: 'saving' });
          try {
            const note = await this.opts.repo.updateNote(this.noteId, payload, {
              expectedUpdatedAt: this.base,
            });
            this.base = note.updatedAt;
            if (rev > this.savedRev) this.savedRev = rev;
            this.retryDelay = 0;
            this.opts.onSaved?.(note);
            if (!this.hasUnsavedChanges()) {
              await this.opts.drafts?.clear(this.opts.repo.scope, this.noteId, payload);
              this.setState({ status: 'saved', error: undefined, lastSavedAt: note.updatedAt });
            } else {
              await this.writeDraftNow();
              this.setState({ status: 'unsaved', lastSavedAt: note.updatedAt });
            }
          } catch (err) {
            if (err instanceof ConflictError) {
              this.conflicted = true;
              await this.writeDraftNow();
              this.setState({ status: 'conflict', error: err.message });
              this.opts.onConflict?.(err.latest);
              break;
            }
            await this.writeDraftNow();
            if (isNetworkError(err) || !this.isOnline()) {
              this.waitForOnline();
              break;
            }
            this.retryDelay = Math.min(this.retryDelay ? this.retryDelay * 2 : 2000, 30000);
            this.setState({
              status: 'error',
              error: errorMessage(err, 'Could not save. Retrying…'),
            });
            if (!this.disposed) {
              if (this.retryTimer) clearTimeout(this.retryTimer);
              this.retryTimer = setTimeout(() => {
                this.retryTimer = null;
                void this.save();
              }, this.retryDelay);
            }
            break;
          }
        } while (this.again && !this.disposed);
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}
