import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  countCharacters,
  countWords,
  displayTitle,
  safeFilename,
  validateFolderName,
  validateTagName,
} from '@/lib/text';
import { uuidV5, isUuid } from '@/lib/ids';
import { sanitizeNext } from '@/lib/mode';
import { buildNotesZip, noteFilename, readTxtFile, readTxtFiles } from '@/features/io/txt';
import { mapError } from '@/data/cloud/cloudRepository';
import { errorMessage } from '@/lib/format';

const file = (parts: BlobPart[], name: string, type = 'text/plain') =>
  new File(parts, name, { type });

describe('text helpers', () => {
  it('counts words (Unicode, CJK) and grapheme characters', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  hello   world \n again ')).toBe(3);
    expect(countWords("don't stop-now café")).toBe(3);
    expect(countWords('日本語')).toBe(3);
    expect(countCharacters('👍🏽 ok')).toBe(4);
    expect(countCharacters('é')).toBe(1);
  });

  it('derives a display title from the first non-empty line', () => {
    expect(displayTitle('  ', '\n\n  First line \nsecond')).toBe('First line');
    expect(displayTitle('', '')).toBe('Untitled note');
    expect(displayTitle('Given', 'x')).toBe('Given');
  });

  it('validates folder and tag names', () => {
    expect(validateFolderName('  My   Folder ')).toBe('My Folder');
    expect(() => validateFolderName('   ')).toThrow();
    expect(() => validateFolderName('x'.repeat(61))).toThrow();
    expect(validateTagName('#todo')).toBe('todo');
  });

  it('makes safe filenames', () => {
    expect(safeFilename('a/b:c*?"<>|')).toBe('a b c');
    expect(safeFilename('CON')).toBe('note');
    expect(safeFilename('Résumé 日本 ')).toBe('Résumé 日本');
    expect(noteFilename({ title: '', content: 'First line\nbody' })).toBe('First line.txt');
  });
});

describe('ids', () => {
  it('produces RFC 4122 v5 UUIDs (known test vector)', async () => {
    // uuid v5 for name "www.example.com" in the DNS namespace.
    expect(await uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
    expect(isUuid(crypto.randomUUID())).toBe(true);
  });
});

describe('redirect sanitising (open-redirect protection)', () => {
  it('only allows same-origin paths', () => {
    expect(sanitizeNext('/import')).toBe('/import');
    expect(sanitizeNext('https://evil.example')).toBe('/notes');
    expect(sanitizeNext('//evil.example')).toBe('/notes');
    expect(sanitizeNext('/\\evil')).toBe('/notes');
    expect(sanitizeNext(null)).toBe('/notes');
  });
});

describe('TXT import', () => {
  it('reads UTF-8 text, strips BOM and normalises line endings', async () => {
    const r = await readTxtFile(file(['﻿Héllo\r\nwörld ✓\r\n'], 'My note.txt'));
    expect(r).toEqual({ title: 'My note', content: 'Héllo\nwörld ✓\n' });
  });

  it('keeps HTML/JS as inert text', async () => {
    const r = await readTxtFile(file(['<script>alert(1)</script>'], 'x.txt'));
    expect(r.content).toBe('<script>alert(1)</script>');
  });

  it('rejects wrong extension, binary, invalid UTF-8 and oversize files', async () => {
    await expect(readTxtFile(file(['x'], 'x.html', 'text/html'))).rejects.toThrow(/not a \.txt/);
    await expect(readTxtFile(file([new Uint8Array([104, 0, 105])], 'b.txt'))).rejects.toThrow(
      /binary/,
    );
    await expect(readTxtFile(file([new Uint8Array([0xff, 0xfe, 0xfd])], 'c.txt'))).rejects.toThrow(
      /UTF-8/,
    );
    await expect(readTxtFile(file(['x'.repeat(1_048_577)], 'big.txt'))).rejects.toThrow(/1 MB/);
    await expect(readTxtFile(file(['x'], 'p.txt', 'application/pdf'))).rejects.toThrow(
      /plain-text/,
    );
  });

  it('collects per-file errors without failing the batch', async () => {
    const { ok, errors } = await readTxtFiles([
      file(['a'], 'a.txt'),
      file(['b'], 'b.exe', 'application/octet-stream'),
    ]);
    expect(ok).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });
});

describe('ZIP export', () => {
  it('writes one .txt per note with unique names and exact Unicode content', () => {
    const zip = buildNotesZip([
      { title: 'Same', content: 'one ✓' },
      { title: 'same', content: 'two\nlines' },
      { title: '', content: '日本語 first line' },
    ]);
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(
      ['Same.txt', 'same (2).txt', '日本語 first line.txt'].sort(),
    );
    expect(strFromU8(files['Same.txt'])).toBe('one ✓');
    expect(strFromU8(files['same (2).txt'])).toBe('two\nlines');
  });
});

describe('error mapping never leaks internals', () => {
  it('maps PostgREST errors to safe domain errors', () => {
    expect(
      mapError(
        {
          code: '23505',
          message: 'duplicate key value violates unique constraint "folders_owner_name_key"',
        } as never,
        'folder',
        'Work',
      ).message,
    ).toBe('A folder named “Work” already exists.');
    expect(
      mapError({
        code: '42501',
        message: 'new row violates row-level security policy for table "notes"',
      } as never).message,
    ).not.toMatch(/notes|policy/);
    expect(mapError({ message: 'TypeError: Failed to fetch' } as never).name).toBe('NetworkError');
    expect(errorMessage(new Error('relation "public.notes" does not exist'))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
