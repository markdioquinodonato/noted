import type { Page, Worker } from 'tesseract.js';

/** Local model and worker: no image or recognized text goes to an external service. */
export async function createScannerWorker(
  onProgress: (status: string, progress: number) => void,
): Promise<Worker> {
  const { createWorker, OEM } = await import('tesseract.js');
  const path = new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.origin).href;
  return createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: `${path}worker.min.js`,
    corePath: `${path}tesseract-core-lstm.wasm.js`,
    langPath: path,
    gzip: true,
    logger: (message) => onProgress(message.status, Math.round(message.progress * 100)),
  });
}

export async function prepareScanImage(file: File): Promise<Blob> {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    !file.size ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error('Choose a PNG, JPEG or WebP image up to 10 MB.');
  const image = await createImageBitmap(file);
  try {
    if (image.width * image.height > 25_000_000)
      throw new Error('Image is too large. Use an image under 25 megapixels.');
    const ratio = Math.min(1, 2400 / Math.max(image.width, image.height)),
      canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable.');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas);
  } finally {
    image.close();
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the image.'))),
      'image/png',
    ),
  );
}

/**
 * Draws the current video frame into a canvas no wider/taller than `maxSide`.
 * `enhance` applies grayscale + contrast, which noticeably helps OCR on phone
 * camera frames (browsers without canvas filters simply skip it).
 */
export function grabFrame(
  video: HTMLVideoElement,
  maxSide: number,
  enhance = true,
): HTMLCanvasElement | null {
  const w = video.videoWidth,
    h = video.videoHeight;
  if (!w || !h) return null;
  const ratio = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (enhance) ctx.filter = 'grayscale(1) contrast(1.35)';
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export interface DetectedWord {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Flattens Tesseract's block tree into words that look like real text. */
export function readableWords(page: Page, minConfidence = 55): DetectedWord[] {
  const words: DetectedWord[] = [];
  for (const block of page.blocks ?? [])
    for (const paragraph of block.paragraphs)
      for (const line of paragraph.lines)
        for (const word of line.words) {
          const text = word.text.trim();
          if (word.confidence < minConfidence || !/[A-Za-z0-9]{2,}/.test(text)) continue;
          words.push({ text, confidence: word.confidence, ...word.bbox });
        }
  return words;
}

/** Word-overlap similarity between two detections (0–1), used to wait for a steady shot. */
export function similarity(a: DetectedWord[], b: DetectedWord[]): number {
  if (!a.length || !b.length) return 0;
  const norm = (w: DetectedWord) => w.text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const sa = new Set(a.map(norm)),
    sb = new Set(b.map(norm));
  let shared = 0;
  sa.forEach((w) => sb.has(w) && shared++);
  return shared / Math.max(sa.size, sb.size);
}
