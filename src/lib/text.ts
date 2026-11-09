import { plainText } from './richText';
import { LIMITS, ValidationError } from '@/domain/types';

export function countWords(text: string): number {
  text = plainText(text);
  const trimmed = text.trim();
  if (!trimmed) return 0;
  // Unicode-aware: letters/numbers sequences, plus CJK characters counted individually.
  const cjk =
    trimmed.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)
      ?.length ?? 0;
  const words =
    trimmed
      .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ')
      .match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu)?.length ?? 0;
  return words + cjk;
}

/** Counts user-perceived characters (grapheme clusters), so emoji count as 1. */
export function countCharacters(text: string): number {
  text = plainText(text);
  if (!text) return 0;
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    let n = 0;
    for (const _ of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) n++;
    return n;
  }
  return Array.from(text).length;
}

export function makePreview(content: string, max = 240): string {
  return plainText(content).slice(0, max);
}

export function displayTitle(title: string, content?: string): string {
  const t = title.trim();
  if (t) return t;
  const firstLine = (content === undefined ? undefined : plainText(content))
    ?.split('\n')
    .find((l) => l.trim())
    ?.trim();
  return firstLine ? firstLine.slice(0, 80) : 'Untitled note';
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function nameKey(name: string): string {
  return normalizeName(name).toLocaleLowerCase();
}

export function validateFolderName(name: string): string {
  const n = normalizeName(name);
  if (!n) throw new ValidationError('Folder name cannot be empty.');
  if (n.length > LIMITS.folderNameMax)
    throw new ValidationError(`Folder names can be at most ${LIMITS.folderNameMax} characters.`);
  return n;
}

export function validateTagName(name: string): string {
  const n = normalizeName(name).replace(/^#+/, '');
  if (!n) throw new ValidationError('Tag name cannot be empty.');
  if (n.length > LIMITS.tagNameMax)
    throw new ValidationError(`Tag names can be at most ${LIMITS.tagNameMax} characters.`);
  return n;
}

export function validateNoteFields(patch: {
  title?: string;
  content?: string;
  color?: string;
  reminderAt?: string | null;
}) {
  if (
    patch.color !== undefined &&
    !['default', 'rose', 'amber', 'sage', 'sky', 'violet'].includes(patch.color)
  )
    throw new ValidationError('Choose a supported note color.');
  if (patch.reminderAt && !Number.isFinite(Date.parse(patch.reminderAt)))
    throw new ValidationError('Choose a valid reminder date.');
  if (patch.title !== undefined && patch.title.length > LIMITS.titleMax)
    throw new ValidationError(`Titles can be at most ${LIMITS.titleMax} characters.`);
  if (patch.content !== undefined && patch.content.length > LIMITS.contentMax)
    throw new ValidationError('This note is too large (maximum 1,000,000 characters).');
}

/** Filesystem-safe filename (Windows/macOS/Linux) preserving Unicode letters. */
export function safeFilename(name: string, fallback = 'note'): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80);
  if (!cleaned || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)) return fallback;
  return cleaned;
}
