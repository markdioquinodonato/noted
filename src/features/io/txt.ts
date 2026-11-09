import { isDesktopApp } from '@/lib/platform';
import { toast } from 'sonner';
import { zipSync, strToU8 } from 'fflate';
import type { Note } from '@/domain/types';
import { LIMITS, ValidationError } from '@/domain/types';
import { plainText } from '@/lib/richText';
import { displayTitle, safeFilename } from '@/lib/text';

export interface ImportedText {
  title: string;
  content: string;
}

const TEXT_MIME = new Set(['text/plain', '']);

/**
 * Validate and decode a user-selected .txt file. Content is treated strictly
 * as text (rendered via textarea/text nodes only — never as HTML).
 */
export async function readTxtFile(file: File): Promise<ImportedText> {
  if (!/\.txt$/i.test(file.name)) throw new ValidationError(`“${file.name}” is not a .txt file.`);
  if (!TEXT_MIME.has(file.type) && !file.type.startsWith('text/'))
    throw new ValidationError(`“${file.name}” does not look like a plain-text file.`);
  if (file.size > LIMITS.importFileMaxBytes)
    throw new ValidationError(`“${file.name}” is larger than 1 MB.`);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.includes(0)) throw new ValidationError(`“${file.name}” contains binary data.`);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ValidationError(`“${file.name}” is not valid UTF-8 text.`);
  }
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (text.length > LIMITS.contentMax) throw new ValidationError(`“${file.name}” is too long.`);
  const title = file.name
    .replace(/\.txt$/i, '')
    .trim()
    .slice(0, LIMITS.titleMax);
  return { title, content: text };
}

export async function readTxtFiles(
  files: File[],
): Promise<{ ok: ImportedText[]; errors: string[] }> {
  if (files.length > LIMITS.importMaxFiles)
    throw new ValidationError(`You can import up to ${LIMITS.importMaxFiles} files at a time.`);
  const ok: ImportedText[] = [];
  const errors: string[] = [];
  for (const f of files) {
    try {
      ok.push(await readTxtFile(f));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { ok, errors };
}

/** Text body for export. Uses CRLF-free UTF-8 with BOM-less output. */
export function noteToTxt(note: Pick<Note, 'title' | 'content'>): string {
  return plainText(note.content);
}

export function noteFilename(note: Pick<Note, 'title' | 'content'>): string {
  return `${safeFilename(displayTitle(note.title, note.content))}.txt`;
}

export function downloadBlob(blob: Blob, filename: string) {
  if (isDesktopApp()) {
    // The desktop webview has no download manager: use the native Save dialog.
    void import('@/desktop/desktop')
      .then((m) => m.saveFileNative(blob, filename))
      .then((saved) => saved && toast.success(`Saved ${filename}`))
      .catch(() => toast.error(`Could not save ${filename}.`));
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportNoteAsTxt(note: Pick<Note, 'title' | 'content'>) {
  downloadBlob(
    new Blob([noteToTxt(note)], { type: 'text/plain;charset=utf-8' }),
    noteFilename(note),
  );
}

/** Build a ZIP of notes as individual .txt files with unique names. */
export function buildNotesZip(notes: Pick<Note, 'title' | 'content'>[]): Uint8Array {
  const used = new Map<string, number>();
  const files: Record<string, Uint8Array> = {};
  for (const n of notes) {
    const base = noteFilename(n).replace(/\.txt$/, '');
    const key = base.toLocaleLowerCase();
    const count = used.get(key) ?? 0;
    used.set(key, count + 1);
    files[count ? `${base} (${count + 1}).txt` : `${base}.txt`] = strToU8(noteToTxt(n));
  }
  return zipSync(files, { level: 6 });
}

export function exportNotesAsZip(notes: Pick<Note, 'title' | 'content'>[], name = 'noted-export') {
  const data = buildNotesZip(notes);
  downloadBlob(
    new Blob([data as BlobPart], { type: 'application/zip' }),
    `${safeFilename(name)}.zip`,
  );
}
