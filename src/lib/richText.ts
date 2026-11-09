import type { JSONContent } from '@tiptap/core';

export const RICH_PREFIX = 'NOTED_RICH_V1\n';
export interface RichDocument {
  doc: JSONContent;
  text: string;
  markdown: string;
  /** Writing font id (see lib/fonts). Omitted for the default font. */
  font?: string;
}

/** A versioned envelope in the existing content column keeps legacy notes intact. */
export function readRich(content: string): RichDocument | null {
  if (!content.startsWith(RICH_PREFIX)) return null;
  try {
    const value = JSON.parse(content.slice(RICH_PREFIX.length));
    if (
      value.doc?.type === 'doc' &&
      Array.isArray(value.doc.content) &&
      typeof value.text === 'string' &&
      typeof value.markdown === 'string'
    )
      return value;
  } catch {
    /* Invalid envelopes are displayed as literal text, never HTML. */
  }
  return null;
}

export function plainText(content: string): string {
  return readRich(content)?.text ?? content;
}
export function markdownText(content: string): string {
  return readRich(content)?.markdown ?? content;
}
export function serializeRich(
  doc: JSONContent,
  text: string,
  markdown: string,
  font?: string,
): string {
  return (
    RICH_PREFIX +
    JSON.stringify(
      font && font !== 'sans' ? { doc, text, markdown, font } : { doc, text, markdown },
    )
  );
}

/** The note's writing font id, or undefined for the default font. */
export function noteFont(content: string): string | undefined {
  const font = readRich(content)?.font;
  return typeof font === 'string' ? font : undefined;
}

/** Returns the same content with a different writing font. */
export function withFont(content: string, font: string): string {
  const rich = readRich(content);
  if (rich) return serializeRich(rich.doc, rich.text, rich.markdown, font);
  return serializeRich(textDocument(content), content, content, font);
}
export function textDocument(text: string): JSONContent {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  };
}

export const NOTE_COLORS = ['default', 'rose', 'amber', 'sage', 'sky', 'violet'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const colorStyle = (color?: string) =>
  color && color !== 'default'
    ? { borderInlineStart: `3px solid var(--note-${color})` }
    : undefined;
