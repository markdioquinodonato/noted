import { unzipSync } from 'fflate';
import { Editor, type JSONContent } from '@tiptap/core';
import { richExtensions } from '@/features/notes/RichEditor';
import { serializeRich, textDocument } from '@/lib/richText';
import { LIMITS, ValidationError } from '@/domain/types';
import { markdownText, plainText, readRich } from '@/lib/richText';
import { displayTitle, safeFilename } from '@/lib/text';
import { downloadBlob, readTxtFile, type ImportedText } from './txt';

export async function readDocument(file: File): Promise<ImportedText> {
  if (/\.txt$/i.test(file.name)) return readTxtFile(file);
  const ext = file.name.split('.').at(-1)?.toLowerCase();
  if (!['md', 'markdown', 'pdf', 'docx'].includes(ext ?? ''))
    throw new ValidationError(
      `“${file.name}” is not a .txt file or supported Markdown, PDF or DOCX document.`,
    );
  if (file.size > LIMITS.importFileMaxBytes)
    throw new ValidationError(`“${file.name}” is larger than 1 MB.`);
  const title = file.name.replace(/\.[^.]+$/, '').slice(0, LIMITS.titleMax);
  let content: string;
  if (ext === 'md' || ext === 'markdown') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.includes(0)) throw new ValidationError('Markdown contains binary data.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const editor = new Editor({
      extensions: richExtensions,
      content: text,
      contentType: 'markdown',
    });
    try {
      content = serializeRich(
        editor.getJSON(),
        editor.getText({ blockSeparator: '\n' }),
        editor.getMarkdown(),
      );
    } finally {
      editor.destroy();
    }
  } else if (ext === 'docx') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
      throw new ValidationError('DOCX must be a valid Office ZIP document.');
    let total = 0,
      entries = 0,
      valid = false;
    unzipSync(bytes, {
      filter: (entry) => {
        total += entry.originalSize;
        entries++;
        if (entry.name === 'word/document.xml') valid = true;
        if (total > 20 * 1024 * 1024 || entries > 500)
          throw new ValidationError('DOCX expands beyond the safe import limit.');
        return false;
      },
    });
    if (!valid) throw new ValidationError('This file is not a Word document.');
    const mammoth = await import('mammoth');
    const { default: purify } = await import('dompurify');
    const html = (await mammoth.convertToHtml({ arrayBuffer: bytes.buffer })).value;
    const sanitized = purify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: [
        'img',
        'style',
        'script',
        'iframe',
        'object',
        'embed',
        'form',
        'input',
        'video',
        'audio',
        'svg',
        'math',
      ],
    });
    const editor = new Editor({ extensions: richExtensions, content: sanitized });
    try {
      content = serializeRich(
        editor.getJSON(),
        editor.getText({ blockSeparator: '\n' }),
        editor.getMarkdown(),
      );
    } finally {
      editor.destroy();
    }
  } else {
    const pdf = await import('pdfjs-dist');
    pdf.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).href;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
      throw new ValidationError('Invalid PDF file.');
    const loading = pdf.getDocument({ data: bytes, enableXfa: false });
    try {
      const doc = await loading.promise;
      if (doc.numPages > 100) throw new ValidationError('PDF import is limited to 100 pages.');
      const pages: string[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n),
          text = await page.getTextContent();
        pages.push(
          text.items
            .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
            .join(''),
        );
        if (pages.join('').length > LIMITS.contentMax)
          throw new ValidationError('PDF text is too long.');
      }
      content = pages.join('\n\n');
      if (!content.trim())
        throw new ValidationError('No readable text found. Scanned PDFs need OCR before import.');
    } finally {
      await loading.destroy();
    }
  }
  if (content.length > LIMITS.contentMax)
    throw new ValidationError('Imported content is too large.');
  return { title, content };
}

export async function readDocuments(files: File[]) {
  if (files.length > LIMITS.importMaxFiles)
    throw new ValidationError(`Import at most ${LIMITS.importMaxFiles} documents at a time.`);
  const ok: ImportedText[] = [],
    errors: string[] = [];
  for (const file of files) {
    try {
      ok.push(await readDocument(file));
    } catch (e) {
      errors.push(`${file.name}: ${(e as Error).message}`);
    }
  }
  return { ok, errors };
}

export function exportMarkdown(note: { title: string; content: string }) {
  downloadBlob(
    new Blob([markdownText(note.content)], { type: 'text/markdown;charset=utf-8' }),
    `${safeFilename(displayTitle(note.title, note.content))}.md`,
  );
}
export async function exportDocx(note: { title: string; content: string }) {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    ExternalHyperlink,
    Table,
    TableRow,
    TableCell,
    WidthType,
  } = await import('docx');
  const inlines = (
    nodes: JSONContent[],
  ): (InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>)[] =>
    nodes.flatMap((node) => {
      if (node.type === 'hardBreak') return [new TextRun({ break: 1 })];
      if (node.type !== 'text') return inlines(node.content ?? []);
      const marks = node.marks ?? [],
        has = (type: string) => marks.some((m) => m.type === type);
      const run = new TextRun({
        text: node.text ?? '',
        bold: has('bold'),
        italics: has('italic'),
        underline: has('underline') ? {} : undefined,
        strike: has('strike'),
        highlight: has('highlight') ? 'yellow' : undefined,
        font: has('code') ? 'Courier New' : undefined,
      });
      const href = marks.find((m) => m.type === 'link')?.attrs?.href;
      return typeof href === 'string' && /^(https?:\/\/|mailto:|\/notes\/)/i.test(href)
        ? [
            new ExternalHyperlink({
              link: new URL(href, window.location.origin).href,
              children: [run],
            }),
          ]
        : [run];
    });
  const blocks = (
    nodes: JSONContent[],
    depth = 0,
  ): (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] =>
    nodes.flatMap((node) => {
      if (node.type === 'table')
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: (node.content ?? []).map(
              (row) =>
                new TableRow({
                  children: (row.content ?? []).map(
                    (cell) => new TableCell({ children: blocks(cell.content ?? [], depth) }),
                  ),
                }),
            ),
          }),
        ];
      if (['bulletList', 'orderedList', 'taskList'].includes(node.type ?? ''))
        return (node.content ?? []).flatMap((item, index) => {
          const prefix =
            node.type === 'orderedList'
              ? `${Number(node.attrs?.start ?? 1) + index}. `
              : node.type === 'taskList'
                ? item.attrs?.checked
                  ? '[x] '
                  : '[ ] '
                : '• ';
          return (item.content ?? []).flatMap((child, i) =>
            child.type === 'paragraph'
              ? [
                  new Paragraph({
                    children: [new TextRun(i === 0 ? prefix : ''), ...inlines(child.content ?? [])],
                    indent: { left: 360 * (depth + 1) },
                  }),
                ]
              : blocks([child], depth + 1),
          );
        });
      if (node.type === 'blockquote') return blocks(node.content ?? [], depth + 1);
      if (node.type === 'horizontalRule')
        return [new Paragraph({ text: '────────────────────────' })];
      if (node.type === 'codeBlock')
        return [
          new Paragraph({
            children: [
              new TextRun({
                text: (node.content ?? []).map((n) => n.text ?? '').join(''),
                font: 'Courier New',
              }),
            ],
          }),
        ];
      if (node.type === 'paragraph' || node.type === 'heading')
        return [
          new Paragraph({
            children: inlines(node.content ?? []),
            heading:
              node.type === 'heading'
                ? ([HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][
                    Number(node.attrs?.level ?? 1) - 1
                  ] ?? HeadingLevel.HEADING_3)
                : undefined,
            indent: depth ? { left: 360 * depth } : undefined,
          }),
        ];
      return blocks(node.content ?? [], depth);
    });
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: displayTitle(note.title, note.content),
            heading: HeadingLevel.TITLE,
          }),
          ...blocks(
            (readRich(note.content)?.doc ?? textDocument(plainText(note.content))).content ?? [],
          ),
        ],
      },
    ],
  });
  downloadBlob(
    await Packer.toBlob(document),
    `${safeFilename(displayTitle(note.title, note.content))}.docx`,
  );
}

export async function printNote(note: { title: string; content: string }) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  const title = doc.createElement('h1');
  title.textContent = displayTitle(note.title, note.content);
  doc.title = displayTitle(note.title, note.content);
  const style = doc.createElement('style');
  style.textContent =
    'body{font:12pt/1.65 system-ui,sans-serif;max-width:760px;margin:32px auto;padding:16px;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px}pre{white-space:pre-wrap;background:#eee;padding:12px}blockquote{border-left:3px solid #999;padding-left:16px}@page{margin:20mm}';
  doc.head.append(style);
  doc.body.append(title);
  const rich = readRich(note.content);
  if (rich) {
    const mount = doc.createElement('div');
    doc.body.append(mount);
    const editor = new Editor({
      element: mount,
      extensions: richExtensions,
      content: rich.doc,
      editable: false,
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => {
      editor.destroy();
      frame.remove();
    }, 60000);
  } else {
    const body = doc.createElement('div');
    body.style.whiteSpace = 'pre-wrap';
    body.textContent = note.content;
    doc.body.append(body);
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 60000);
  }
}
