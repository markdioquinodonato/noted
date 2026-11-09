import { openDB } from 'idb';
import type { NotesRepository } from '@/domain/repository';
import { supabase } from '@/lib/supabase';
import { newId } from '@/lib/ids';

export const FILE_LIMIT = 10 * 1024 * 1024;
export const FILE_TYPES: Record<string, string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'application/pdf': ['pdf'],
  'text/plain': ['txt'],
  'text/markdown': ['md', 'markdown'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'audio/webm': ['webm'],
  'audio/ogg': ['ogg'],
  'audio/mp4': ['m4a', 'mp4'],
  'audio/wav': ['wav'],
};
export interface Attachment {
  id: string;
  note_id: string;
  name: string;
  mime_type: string;
  size: number;
  path: string;
  created_at: string;
}
interface LocalAttachment extends Attachment {
  scope: string;
  blob: Blob;
}
const assetDb = () =>
  openDB('noted-attachments', 1, {
    upgrade(db) {
      db.createObjectStore('files', { keyPath: 'id' });
    },
  });

export function validateAttachment(file: File): string {
  const mime = file.type.split(';')[0];
  const ext = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  if (!file.size || file.size > FILE_LIMIT)
    throw new Error('Files must be between 1 byte and 10 MB.');
  if (!FILE_TYPES[mime]?.includes(ext))
    throw new Error(
      'Unsupported file type or file extension. Executable files and HTML are not allowed.',
    );
  return mime;
}
export async function listAttachments(
  repo: NotesRepository,
  noteId: string,
): Promise<Attachment[]> {
  if (repo.kind === 'local')
    return ((await (await assetDb()).getAll('files')) as LocalAttachment[]).filter(
      (f) => f.scope === repo.scope && f.note_id === noteId,
    );
  const { data, error } = await supabase!
    .from('attachments')
    .select('*')
    .eq('note_id', noteId)
    .order('created_at');
  if (error)
    throw new Error('Could not load attachments. Check that the storage migrations are applied.');
  return data;
}
export async function uploadAttachment(
  repo: NotesRepository,
  noteId: string,
  file: File,
): Promise<void> {
  const mime = validateAttachment(file);
  const note = await repo.getNote(noteId);
  if (!note || note.deletedAt || note.permission)
    throw new Error('Only the owner can attach files to an active note.');
  const id = newId();
  const attachment: Attachment = {
    id,
    note_id: noteId,
    name: file.name.slice(0, 255),
    mime_type: mime,
    size: file.size,
    path: `${repo.scope}/${noteId}/${id}`,
    created_at: new Date().toISOString(),
  };
  if (repo.kind === 'local') {
    await (await assetDb()).put('files', { ...attachment, scope: repo.scope, blob: file });
    return;
  }
  const { error: recordError } = await supabase!.from('attachments').insert({
    id,
    note_id: noteId,
    name: attachment.name,
    mime_type: mime,
    size: file.size,
    path: attachment.path,
  });
  if (recordError) throw new Error('Could not register attachment.');
  const { error } = await supabase!.storage
    .from('note-attachments')
    .upload(attachment.path, file, { contentType: mime, upsert: false });
  if (error) {
    await supabase!.from('attachments').delete().eq('id', id);
    throw new Error('Upload failed. Check your connection and private storage configuration.');
  }
}
export async function attachmentBlob(repo: NotesRepository, file: Attachment): Promise<Blob> {
  if (repo.kind === 'local') {
    const record = (await (await assetDb()).get('files', file.id)) as LocalAttachment | undefined;
    if (!record || record.scope !== repo.scope) throw new Error('File not found.');
    return record.blob;
  }
  const { data, error } = await supabase!.storage.from('note-attachments').download(file.path);
  if (error || !data) throw new Error('Could not download the private attachment.');
  return data;
}
export async function deleteAttachment(repo: NotesRepository, file: Attachment): Promise<void> {
  if (repo.kind === 'local') {
    await (await assetDb()).delete('files', file.id);
    return;
  }
  const { error } = await supabase!.storage.from('note-attachments').remove([file.path]);
  if (error) throw new Error('Could not delete the file.');
  const { error: recordError } = await supabase!.from('attachments').delete().eq('id', file.id);
  if (recordError) throw new Error('File removed, but its record could not be removed. Retry.');
}
export async function removeLocalAttachments(noteId: string) {
  const db = await assetDb();
  const all = (await db.getAll('files')) as LocalAttachment[];
  for (const f of all)
    if (f.scope === 'guest' && f.note_id === noteId) await db.delete('files', f.id);
}
