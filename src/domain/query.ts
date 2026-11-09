import type { Note, NoteListQuery, NotePage, NoteSummary, SidebarCounts } from './types';
import { plainText } from '@/lib/richText';
import { makePreview } from '@/lib/text';

export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function toSummary(n: Note): NoteSummary {
  return {
    id: n.id,
    folderId: n.folderId,
    title: n.title,
    preview: makePreview(n.content),
    isFavorite: n.isFavorite,
    color: n.color,
    reminderAt: n.reminderAt,
    reminderCompletedAt: n.reminderCompletedAt,
    isPinned: n.isPinned,
    isArchived: n.isArchived,
    deletedAt: n.deletedAt,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    tagIds: n.tagIds,
  };
}

function inView(n: Note, q: NoteListQuery, now: number): boolean {
  switch (q.view) {
    case 'trash':
      return n.deletedAt !== null;
    case 'archive':
      return n.deletedAt === null && n.isArchived;
    case 'shared':
      return false;
    case 'favorites':
      return !n.deletedAt && !n.isArchived && !!n.isFavorite;
    case 'reminders':
      return !n.deletedAt && !!n.reminderAt && !n.reminderCompletedAt;
    case 'pinned':
      return n.deletedAt === null && !n.isArchived && n.isPinned;
    case 'recent':
      return (
        n.deletedAt === null &&
        !n.isArchived &&
        now - new Date(n.updatedAt).getTime() <= RECENT_WINDOW_MS
      );
    default:
      return n.deletedAt === null && !n.isArchived;
  }
}

/** In-memory equivalent of the `list_notes` SQL function (used for guest storage). */
export function queryNotes(
  notes: Note[],
  q: NoteListQuery,
  now = Date.now(),
  folders: { id: string; name: string }[] = [],
  tags: { id: string; name: string }[] = [],
): NotePage {
  const needle = q.search?.trim().toLocaleLowerCase() || '';
  const filtered = notes.filter(
    (n) =>
      inView(n, q, now) &&
      (!q.createdAfter || n.createdAt >= q.createdAfter) &&
      (!q.updatedAfter || n.updatedAt >= q.updatedAfter) &&
      (!q.folderId || n.folderId === q.folderId) &&
      (!q.uncategorized || n.folderId === null) &&
      (!q.tagId || n.tagIds.includes(q.tagId)) &&
      (!needle ||
        n.title.toLocaleLowerCase().includes(needle) ||
        plainText(n.content).toLocaleLowerCase().includes(needle) ||
        folders.some((f) => f.id === n.folderId && f.name.toLocaleLowerCase().includes(needle)) ||
        tags.some((t) => n.tagIds.includes(t.id) && t.name.toLocaleLowerCase().includes(needle))),
  );

  const pinFirst = (q.view === 'all' || q.view === 'recent') && q.sort !== 'title';
  filtered.sort((a, b) => {
    if (q.view === 'reminders') return (a.reminderAt ?? '').localeCompare(b.reminderAt ?? '');
    if (pinFirst && a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    if (q.sort === 'title') {
      const c = a.title.toLocaleLowerCase().localeCompare(b.title.toLocaleLowerCase());
      if (c) return c;
    } else if (q.sort === 'created') {
      const c = b.createdAt.localeCompare(a.createdAt);
      if (c) return c;
    }
    if (q.view === 'trash' && a.deletedAt && b.deletedAt) {
      const c = b.deletedAt.localeCompare(a.deletedAt);
      if (c) return c;
    }
    return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  });

  const limit = Math.min(Math.max(q.limit, 1), 200);
  const offset = Math.max(q.offset, 0);
  const items = filtered.slice(offset, offset + limit).map(toSummary);
  const next = offset + items.length;
  return { items, total: filtered.length, nextOffset: next < filtered.length ? next : null };
}

export function computeCounts(
  notes: Note[],
  folderIds: string[],
  tagIds: string[],
  now = Date.now(),
): SidebarCounts {
  const counts: SidebarCounts = {
    all: 0,
    favorites: 0,
    reminders: 0,
    shared: 0,
    recent: 0,
    pinned: 0,
    archive: 0,
    trash: 0,
    uncategorized: 0,
    folders: Object.fromEntries(folderIds.map((id) => [id, 0])),
    tags: Object.fromEntries(tagIds.map((id) => [id, 0])),
  };
  for (const n of notes) {
    if (n.deletedAt) {
      counts.trash++;
      continue;
    }
    if (n.reminderAt && !n.reminderCompletedAt) counts.reminders!++;
    if (n.isArchived) {
      counts.archive++;
      continue;
    }
    counts.all++;
    if (n.isFavorite) counts.favorites!++;
    if (n.isPinned) counts.pinned++;
    if (now - new Date(n.updatedAt).getTime() <= RECENT_WINDOW_MS) counts.recent++;
    if (n.folderId === null) counts.uncategorized++;
    else if (n.folderId in counts.folders) counts.folders[n.folderId]++;
    for (const t of n.tagIds) if (t in counts.tags) counts.tags[t]++;
  }
  return counts;
}
