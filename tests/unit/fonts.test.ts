import { describe, expect, it } from 'vitest';
import {
  noteFont,
  plainText,
  readRich,
  serializeRich,
  textDocument,
  withFont,
} from '@/lib/richText';
import { getNoteFont, NOTE_FONTS } from '@/lib/fonts';

describe('note writing fonts', () => {
  it('stores the font inside the note content and keeps the text intact', () => {
    const base = serializeRich(textDocument('Quiz on Friday'), 'Quiz on Friday', 'Quiz on Friday');
    expect(noteFont(base)).toBeUndefined();
    const styled = withFont(base, 'handwritten');
    expect(noteFont(styled)).toBe('handwritten');
    expect(plainText(styled)).toBe('Quiz on Friday');
    expect(readRich(styled)?.doc).toEqual(readRich(base)?.doc);
  });

  it('omits the default font so existing notes serialize exactly as before', () => {
    const styled = withFont(serializeRich(textDocument('a'), 'a', 'a'), 'serif');
    expect(withFont(styled, 'sans')).toBe(serializeRich(textDocument('a'), 'a', 'a'));
  });

  it('upgrades legacy plain-text notes when a font is chosen', () => {
    const styled = withFont('Line one\nLine two', 'typewriter');
    expect(noteFont(styled)).toBe('typewriter');
    expect(plainText(styled)).toBe('Line one\nLine two');
  });

  it('falls back to the default font for unknown ids', () => {
    expect(getNoteFont('nope')).toBe(NOTE_FONTS[0]);
    expect(new Set(NOTE_FONTS.map((f) => f.id)).size).toBe(NOTE_FONTS.length);
  });
});
