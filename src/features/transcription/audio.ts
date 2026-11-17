import type { AudioChunk } from './types';

export const SAMPLE_RATE = 16000;
export const CORE_SECONDS = 40;
export const OVERLAP_SECONDS = 2;
export const MAX_SECONDS = 7200;
export const MAX_FILE_BYTES = 150 * 1024 * 1024;

/** Decode into a separate buffer. The source Blob is never changed. */
export async function decodeAudio(blob: Blob): Promise<Float32Array> {
  if (!blob.size || blob.size > MAX_FILE_BYTES) throw new Error('Choose audio up to 150 MB.');
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (!decoded.duration || decoded.duration > MAX_SECONDS)
      throw new Error('Recordings must be between 0 and 120 minutes.');
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * SAMPLE_RATE),
      SAMPLE_RATE,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    await context.close();
  }
}

/** Conservative energy activity candidates, NOT a validated speech detector.
 * Nothing is discarded: quiet speech and pauses still reach the recognizer. */
export function activityWindows(
  samples: Float32Array,
  start: number,
  end: number,
): [number, number][] {
  const intervals: [number, number][] = [];
  for (let t = start; t < end; t += 0.5) {
    let energy = 0;
    const a = Math.floor(t * SAMPLE_RATE),
      b = Math.min(samples.length, Math.floor((t + 0.5) * SAMPLE_RATE));
    for (let i = a; i < b; i++) energy += samples[i] * samples[i];
    if (Math.sqrt(energy / Math.max(1, b - a)) > 0.008) intervals.push([t, Math.min(t + 0.5, end)]);
  }
  return intervals;
}

export function planChunks(samples: Float32Array): AudioChunk[] {
  const duration = samples.length / SAMPLE_RATE;
  if (!duration || duration > MAX_SECONDS) throw new Error('Unsupported recording duration.');
  return Array.from({ length: Math.ceil(duration / CORE_SECONDS) }, (_, index) => {
    const coreStart = index * CORE_SECONDS,
      coreEnd = Math.min(duration, coreStart + CORE_SECONDS);
    const start = Math.max(0, coreStart - OVERLAP_SECONDS),
      end = Math.min(duration, coreEnd + OVERLAP_SECONDS);
    return {
      index,
      start,
      end,
      coreStart,
      coreEnd,
      activity: activityWindows(samples, coreStart, coreEnd),
      primaryId: crypto.randomUUID(),
      reviewId: crypto.randomUUID(),
      attempts: 0,
    };
  });
}

export function wavChunk(
  samples: Float32Array,
  start: number,
  end: number,
  normalize = false,
): Blob {
  const pcm = samples.subarray(Math.round(start * SAMPLE_RATE), Math.round(end * SAMPLE_RATE));
  const buffer = new ArrayBuffer(44 + pcm.length * 2),
    view = new DataView(buffer);
  const str = (at: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  let peak = 0;
  if (normalize) for (const value of pcm) peak = Math.max(peak, Math.abs(value));
  // At most +6 dB, with headroom. No gates or noise filters that could erase speech.
  const gain = normalize && peak > 0 ? Math.min(2, 0.9 / peak) : 1;
  pcm.forEach((value, i) => {
    const v = Math.max(-1, Math.min(1, value * gain));
    view.setInt16(44 + i * 2, Math.round(v * (v < 0 ? 32768 : 32767)), true);
  });
  return new Blob([buffer], { type: 'audio/wav' });
}
