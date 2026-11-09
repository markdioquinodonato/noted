/**
 * Writing fonts for notes. Font files are bundled (latin subset only) so they
 * work offline and never contact an external font service. Browsers only
 * download a face the first time a note actually uses it.
 */
import nunito from '@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2?url';
import nunitoItalic from '@fontsource-variable/nunito/files/nunito-latin-wght-italic.woff2?url';
import lora from '@fontsource-variable/lora/files/lora-latin-wght-normal.woff2?url';
import loraItalic from '@fontsource-variable/lora/files/lora-latin-wght-italic.woff2?url';
import garamond from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-normal.woff2?url';
import garamondItalic from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-italic.woff2?url';
import caveat from '@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2?url';
import mono from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url';
import monoItalic from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-italic.woff2?url';
import patrick from '@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff2?url';
import courier from '@fontsource/courier-prime/files/courier-prime-latin-400-normal.woff2?url';
import courierItalic from '@fontsource/courier-prime/files/courier-prime-latin-400-italic.woff2?url';
import courierBold from '@fontsource/courier-prime/files/courier-prime-latin-700-normal.woff2?url';
import courierBoldItalic from '@fontsource/courier-prime/files/courier-prime-latin-700-italic.woff2?url';

export interface NoteFont {
  id: string;
  label: string;
  hint: string;
  family: string;
  /** Visual size correction so every font reads at a similar size. */
  scale: number;
}

export const DEFAULT_FONT = 'sans';

export const NOTE_FONTS: NoteFont[] = [
  {
    id: 'sans',
    label: 'Inter',
    hint: 'Clean & modern',
    family: "'Inter Variable', ui-sans-serif, system-ui, sans-serif",
    scale: 1,
  },
  {
    id: 'rounded',
    label: 'Nunito',
    hint: 'Soft & friendly',
    family: "'Nunito Variable', ui-rounded, ui-sans-serif, sans-serif",
    scale: 1.03,
  },
  {
    id: 'serif',
    label: 'Lora',
    hint: 'Elegant serif',
    family: "'Lora Variable', Georgia, serif",
    scale: 1.02,
  },
  {
    id: 'book',
    label: 'Garamond',
    hint: 'Classic book',
    family: "'EB Garamond Variable', Garamond, Georgia, serif",
    scale: 1.14,
  },
  {
    id: 'notebook',
    label: 'Patrick Hand',
    hint: 'Neat handwriting',
    family: "'Patrick Hand', 'Segoe Print', cursive",
    scale: 1.14,
  },
  {
    id: 'handwritten',
    label: 'Caveat',
    hint: 'Casual handwritten',
    family: "'Caveat Variable', 'Segoe Script', cursive",
    scale: 1.34,
  },
  {
    id: 'typewriter',
    label: 'Courier Prime',
    hint: 'Typewriter',
    family: "'Courier Prime', 'Courier New', monospace",
    scale: 1,
  },
  {
    id: 'mono',
    label: 'JetBrains Mono',
    hint: 'Code & technical',
    family: "'JetBrains Mono Variable', ui-monospace, monospace",
    scale: 0.94,
  },
];

export function getNoteFont(id: string | undefined): NoteFont {
  return NOTE_FONTS.find((f) => f.id === id) ?? NOTE_FONTS[0];
}

const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

const FACES: [family: string, url: string, weight: string, style: 'normal' | 'italic'][] = [
  ['Nunito Variable', nunito, '200 1000', 'normal'],
  ['Nunito Variable', nunitoItalic, '200 1000', 'italic'],
  ['Lora Variable', lora, '400 700', 'normal'],
  ['Lora Variable', loraItalic, '400 700', 'italic'],
  ['EB Garamond Variable', garamond, '400 800', 'normal'],
  ['EB Garamond Variable', garamondItalic, '400 800', 'italic'],
  ['Caveat Variable', caveat, '400 700', 'normal'],
  ['JetBrains Mono Variable', mono, '100 800', 'normal'],
  ['JetBrains Mono Variable', monoItalic, '100 800', 'italic'],
  ['Patrick Hand', patrick, '400', 'normal'],
  ['Courier Prime', courier, '400', 'normal'],
  ['Courier Prime', courierItalic, '400', 'italic'],
  ['Courier Prime', courierBold, '700', 'normal'],
  ['Courier Prime', courierBoldItalic, '700', 'italic'],
];

if (typeof document !== 'undefined' && !document.getElementById('noted-fonts')) {
  const style = document.createElement('style');
  style.id = 'noted-fonts';
  style.textContent = FACES.map(
    ([family, url, weight, fontStyle]) =>
      `@font-face{font-family:'${family}';font-style:${fontStyle};font-display:swap;font-weight:${weight};src:url(${JSON.stringify(url)}) format('woff2');unicode-range:${LATIN};}`,
  ).join('\n');
  document.head.appendChild(style);
}
