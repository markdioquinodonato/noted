import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteSaver, type DraftSink, type SaverState } from '@/features/notes/noteSaver';
import { ConflictError, NetworkError, type Note, type NoteDraft } from '@/domain/types';

function makeNote(over: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    folderId: null,
    title: 'T',
    content: 'c0',
    isPinned: false,
    isArchived: false,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tagIds: [],
    ...over,
  };
}

/** Controllable fake repository: each update returns a deferred promise. */
function fakeRepo() {
  let stored = makeNote();
  let rev = 0;
  const calls: {
    patch: NoteDraft;
    expected?: string;
    resolve: () => void;
    reject: (e: unknown) => void;
  }[] = [];
  let mode: 'manual' | 'auto' = 'auto';
  let failWith: unknown = null;
  const repo = {
    scope: 'test',
    updateNote: vi.fn((id: string, patch: NoteDraft, opts?: { expectedUpdatedAt?: string }) => {
      return new Promise<Note>((resolve, reject) => {
        const apply = () => {
          if (failWith) {
            const e = failWith;
            reject(e);
            return;
          }
          if (opts?.expectedUpdatedAt && opts.expectedUpdatedAt !== stored.updatedAt) {
            reject(new ConflictError(stored));
            return;
          }
          rev++;
          stored = {
            ...stored,
            ...(patch as Partial<Note>),
            id,
            updatedAt: `2026-01-01T00:00:${String(rev).padStart(2, '0')}.000Z`,
          };
          resolve(stored);
        };
        calls.push({ patch, expected: opts?.expectedUpdatedAt, resolve: apply, reject });
        if (mode === 'auto') apply();
      });
    }),
  };
  return {
    repo,
    calls,
    get stored() {
      return stored;
    },
    set stored(v: Note) {
      stored = v;
    },
    manual() {
      mode = 'manual';
    },
    fail(e: unknown) {
      failWith = e;
    },
    heal() {
      failWith = null;
    },
  };
}

function memDrafts(): DraftSink & { map: Map<string, { title: string; content: string }> } {
  const map = new Map<string, { title: string; content: string }>();
  return {
    map,
    put: vi.fn(async (r) => {
      map.set(r.noteId, { title: r.title, content: r.content });
    }),
    clear: vi.fn(async (_s, id, ifMatches) => {
      const cur = map.get(id);
      if (
        cur &&
        (!ifMatches || (cur.title === ifMatches.title && cur.content === ifMatches.content))
      )
        map.delete(id);
    }),
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

let online = true;
beforeEach(() => {
  vi.useFakeTimers();
  online = true;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('NoteSaver', () => {
  it('debounces rapid typing into a single request', async () => {
    const f = fakeRepo();
    const s = new NoteSaver('n1', makeNote(), {
      repo: f.repo,
      delayMs: 800,
      isOnline: () => online,
    });
    s.activate();
    for (const ch of 'hello world') s.edit({ content: `c0${ch}` });
    expect(f.repo.updateNote).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(799);
    expect(f.repo.updateNote).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.repo.updateNote).toHaveBeenCalledTimes(1);
    expect(s.getState().status).toBe('saved');
  });

  it('serialises saves and a slow stale response never overwrites newer edits', async () => {
    const f = fakeRepo();
    f.manual();
    const states: SaverState['status'][] = [];
    const s = new NoteSaver('n1', makeNote(), {
      repo: f.repo,
      delayMs: 100,
      isOnline: () => online,
      onState: (x) => states.push(x.status),
    });
    s.activate();
    s.edit({ content: 'A' });
    await vi.advanceTimersByTimeAsync(100); // request #1 in flight (A)
    expect(f.calls).toHaveLength(1);
    s.edit({ content: 'AB' });
    await vi.advanceTimersByTimeAsync(100); // timer fires while #1 in flight: no parallel request
    expect(f.calls).toHaveLength(1);
    f.calls[0].resolve(); // #1 completes late
    await flush();
    expect(f.calls).toHaveLength(2); // follow-up save with newest content
    expect(f.calls[1].patch.content).toBe('AB');
    expect(f.calls[1].expected).toBe('2026-01-01T00:00:01.000Z'); // chained concurrency token
    expect(s.current.content).toBe('AB'); // editor value untouched by stale response
    f.calls[1].resolve();
    await flush();
    expect(f.stored.content).toBe('AB');
    expect(s.hasUnsavedChanges()).toBe(false);
    expect(states.at(-1)).toBe('saved');
  });

  it('mirrors unsaved text to the draft store and clears it after a successful save', async () => {
    const f = fakeRepo();
    const d = memDrafts();
    const s = new NoteSaver('n1', makeNote(), {
      repo: f.repo,
      drafts: d,
      delayMs: 1000,
      draftDelayMs: 200,
      isOnline: () => online,
    });
    s.activate();
    s.edit({ content: 'draft text' });
    await vi.advanceTimersByTimeAsync(200);
    expect(d.map.get('n1')?.content).toBe('draft text');
    await vi.advanceTimersByTimeAsync(800);
    expect(d.map.has('n1')).toBe(false);
  });

  it('goes offline without losing text and saves when the connection returns', async () => {
    const f = fakeRepo();
    const d = memDrafts();
    online = false;
    const s = new NoteSaver('n1', makeNote(), {
      repo: f.repo,
      drafts: d,
      delayMs: 100,
      isOnline: () => online,
    });
    s.activate();
    s.edit({ content: 'written offline' });
    await vi.advanceTimersByTimeAsync(400);
    expect(f.repo.updateNote).not.toHaveBeenCalled();
    expect(s.getState().status).toBe('offline');
    await s.flush();
    expect(d.map.get('n1')?.content).toBe('written offline');
    online = true;
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(f.stored.content).toBe('written offline');
    expect(s.getState().status).toBe('saved');
  });

  it('treats a network failure mid-request as offline, keeps a draft, then recovers', async () => {
    const f = fakeRepo();
    const d = memDrafts();
    f.fail(new NetworkError());
    const s = new NoteSaver('n1', makeNote(), {
      repo: f.repo,
      drafts: d,
      delayMs: 100,
      isOnline: () => online,
    });
    s.activate();
    s.edit({ content: 'x' });
    await vi.advanceTimersByTimeAsync(100);
    expect(s.getState().status).toBe('offline');
    expect(d.map.get('n1')?.content).toBe('x');
    f.heal();
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(s.getState().status).toBe('saved');
  });

  it('shows an error and retries with backoff on server failure', async () => {
    const f = fakeRepo();
    f.fail(new Error('boom'));
    const s = new NoteSaver('n1', makeNote(), {
      repo: f.repo,
      delayMs: 100,
      isOnline: () => online,
    });
    s.activate();
    s.edit({ content: 'y' });
    await vi.advanceTimersByTimeAsync(100);
    expect(s.getState().status).toBe('error');
    expect(f.repo.updateNote).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.repo.updateNote).toHaveBeenCalledTimes(2); // retry #1 after 2s
    f.heal();
    await vi.advanceTimersByTimeAsync(4000); // retry #2 after 4s
    expect(s.getState().status).toBe('saved');
    expect(f.stored.content).toBe('y');
  });

  it('enters conflict state instead of overwriting remote changes; resolution works both ways', async () => {
    const f = fakeRepo();
    const onConflict = vi.fn();
    const s = new NoteSaver('n1', makeNote(), {
      repo: f.repo,
      delayMs: 50,
      isOnline: () => online,
      onConflict,
    });
    s.activate();
    f.stored = { ...f.stored, content: 'remote', updatedAt: '2026-01-01T00:59:00.000Z' };
    s.edit({ content: 'local' });
    await vi.advanceTimersByTimeAsync(50);
    expect(s.getState().status).toBe('conflict');
    expect(onConflict).toHaveBeenCalledWith(expect.objectContaining({ content: 'remote' }));
    expect(f.stored.content).toBe('remote');
    // Further typing does not auto-save while in conflict
    s.edit({ content: 'local 2' });
    await vi.advanceTimersByTimeAsync(500);
    expect(f.stored.content).toBe('remote');
    // Keep mine → overwrites with the latest token
    s.keepMine(f.stored);
    await flush();
    expect(f.stored.content).toBe('local 2');
    expect(s.getState().status).toBe('saved');
  });

  it('flush() on dispose saves pending edits (rapid note switching)', async () => {
    const f = fakeRepo();
    const s = new NoteSaver('n1', makeNote(), {
      repo: f.repo,
      delayMs: 5000,
      isOnline: () => online,
    });
    s.activate();
    s.edit({ title: 'New title' });
    await s.dispose();
    expect(f.stored.title).toBe('New title');
  });

  it('repeated identical edits and repeated flushes do not create duplicate requests', async () => {
    const f = fakeRepo();
    const s = new NoteSaver('n1', makeNote(), {
      repo: f.repo,
      delayMs: 100,
      isOnline: () => online,
    });
    s.activate();
    s.edit({ content: 'c0' }); // same as stored → no-op
    await s.flush();
    await s.flush();
    expect(f.repo.updateNote).not.toHaveBeenCalled();
    s.edit({ content: 'z' });
    await Promise.all([s.flush(), s.flush(), s.flush()]);
    expect(f.repo.updateNote).toHaveBeenCalledTimes(1);
  });

  it('updateMeta serialises with text saves and keeps the token fresh', async () => {
    const f = fakeRepo();
    const s = new NoteSaver('n1', makeNote(), {
      repo: f.repo,
      delayMs: 100,
      isOnline: () => online,
    });
    s.activate();
    s.edit({ content: 'typed' });
    await s.updateMeta({ isPinned: true });
    expect(f.stored).toMatchObject({ isPinned: true, content: 'typed' });
    s.edit({ content: 'typed more' });
    await vi.advanceTimersByTimeAsync(100);
    expect(s.getState().status).toBe('saved'); // no false conflict
  });

  it('serialises simultaneous metadata writes and typing behind the same revision lock', async () => {
    const f = fakeRepo();
    f.manual();
    const s = new NoteSaver('n1', makeNote(), { repo: f.repo, delayMs: 100, isOnline: () => true });
    s.activate();
    const pin = s.updateMeta({ isPinned: true });
    await vi.advanceTimersByTimeAsync(0);
    const favorite = s.updateMeta({ isFavorite: true });
    s.edit({ content: 'Typed during metadata save' });
    await vi.advanceTimersByTimeAsync(100);
    expect(f.calls).toHaveLength(1);
    f.calls[0].resolve();
    await pin;
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1].expected).toBe(f.stored.updatedAt);
    f.calls[1].resolve();
    await favorite;
    await s.flush();
    expect(f.stored).toMatchObject({
      isPinned: true,
      isFavorite: true,
      content: 'Typed during metadata save',
    });
    expect(s.getState().status).toBe('saved');
  });

  it('reports failed local backups without preventing a later cloud save', async () => {
    const f = fakeRepo();
    let connected = false;
    const sink = memDrafts();
    sink.put = vi.fn(async () => {
      throw new Error('Quota exceeded');
    });
    const s = new NoteSaver('n1', makeNote(), {
      repo: f.repo,
      drafts: sink,
      delayMs: 100,
      isOnline: () => connected,
    });
    s.activate();
    s.edit({ content: 'Keep this text' });
    await s.flush();
    expect(s.getState()).toMatchObject({ status: 'offline', localDraftSaved: false });
    connected = true;
    await s.flush();
    expect(f.stored.content).toBe('Keep this text');
    expect(s.getState().status).toBe('saved');
  });

  it('recovers a draft on construction and saves it against the draft base', async () => {
    const f = fakeRepo();
    const s = new NoteSaver('n1', makeNote(), {
      repo: f.repo,
      delayMs: 100,
      isOnline: () => online,
      initialDirty: { title: 'T', content: 'recovered' },
      initialBase: '2026-01-01T00:00:00.000Z',
    });
    expect(s.getState().status).toBe('unsaved');
    s.activate();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.stored.content).toBe('recovered');
  });

  it('respects autosave=false until flushed manually', async () => {
    const f = fakeRepo();
    const s = new NoteSaver('n1', makeNote(), {
      repo: f.repo,
      delayMs: 100,
      autosave: false,
      isOnline: () => online,
    });
    s.activate();
    s.edit({ content: 'manual' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.repo.updateNote).not.toHaveBeenCalled();
    expect(s.getState().status).toBe('unsaved');
    await s.flush();
    expect(f.stored.content).toBe('manual');
  });
});
