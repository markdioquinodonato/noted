import { UNCLEAR, type AudioChunk, type Segment, type TranscriptJob, type Word } from './types';

export function lexical(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’-]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
export function wordFlags(word: Word): string[] {
  const flags: string[] = [];
  if (word.confidence !== undefined && word.confidence < 0.75)
    flags.push('Low provider word confidence');
  if (
    word.speaker === undefined ||
    word.speaker_confidence === undefined ||
    word.speaker_confidence < 0.6
  )
    flags.push('Speaker assignment uncertain');
  return flags;
}
export function qualityFlags(chunk: AudioChunk): string[] {
  if (!chunk.result) return ['Missing or failed chunk'];
  const words = chunk.result.words;
  const flags = words.flatMap(wordFlags).filter((f) => !f.startsWith('Speaker'));
  if (!words.length) flags.push('No recognized words; verify silence or unclear audio');
  if (!chunk.result.diarizer) flags.push('Provider did not return diarization metadata');
  for (const [a, b] of chunk.activity) {
    if (!words.some((w) => chunk.start + w.end >= a && chunk.start + w.start <= b)) {
      flags.push('Possible missing speech or background sound');
      break;
    }
  }
  const tokens = words.map((w) => lexical(w.word));
  for (let i = 0; i + 8 < tokens.length; i++) {
    const phrase = tokens.slice(i, i + 3).join(' ');
    if (
      phrase &&
      phrase === tokens.slice(i + 3, i + 6).join(' ') &&
      phrase === tokens.slice(i + 6, i + 9).join(' ')
    ) {
      flags.push('Repeated phrase anomaly; repetitions preserved for review');
      break;
    }
  }
  return [...new Set(flags)];
}

/** Assign overlapping word intervals to one core by midpoint. Never delete repeated
 * words just because their text matches. Boundary disagreement is visible. */
export function buildSegments(job: TranscriptJob): Segment[] {
  const segments: Segment[] = [];
  for (const chunk of job.chunks) {
    if (!chunk.result) {
      segments.push({
        id: `${chunk.index}-missing`,
        start: chunk.coreStart,
        end: chunk.coreEnd,
        text: UNCLEAR,
        machine: UNCLEAR,
        speaker: '',
        flags: ['Missing or failed chunk'],
      });
      continue;
    }
    const selected = chunk.result.words.filter((w) => {
      const midpoint = chunk.start + (w.start + w.end) / 2;
      return midpoint >= chunk.coreStart && midpoint < chunk.coreEnd;
    });
    const flags = qualityFlags(chunk);
    const disagreement = chunk.review && lexical(chunk.result.text) !== lexical(chunk.review.text);
    let current: Segment | undefined;
    let localSegment = 0;
    for (const word of selected) {
      const start = chunk.start + word.start,
        end = chunk.start + word.end;
      // Speakers are local to each request; never pretend voice IDs are stable across chunks.
      const speaker = word.speaker === undefined ? '' : `${chunk.index}:${word.speaker}`;
      if (
        !current ||
        current.speaker !== speaker ||
        start - current.end > 1 ||
        end - current.start > 12
      ) {
        current = {
          id: `${chunk.index}-speech-${localSegment++}`,
          start,
          end,
          machine: '',
          text: '',
          speaker,
          flags: [
            ...flags,
            ...(job.chunks.length > 1 ? ['Speaker labels are local to this chunk'] : []),
            ...(disagreement ? ['Transcription passes disagree; compare with audio'] : []),
          ],
          alternative: disagreement ? chunk.review?.text : undefined,
        };
        segments.push(current);
      }
      current.end = Math.max(current.end, end);
      current.flags = [...new Set([...current.flags, ...wordFlags(word)])];
      const token = job.mode === 'clean' ? (word.punctuated_word ?? word.word) : word.word;
      current.machine += `${current.machine ? ' ' : ''}${token}`;
      current.text = current.machine;
    }
    // Expose uncovered activity candidates as explicit review intervals, not invented words.
    const gaps: [number, number][] = [];
    for (const [a, b] of chunk.activity) {
      if (
        selected.some((w) => chunk.start + w.end + 0.25 >= a && chunk.start + w.start - 0.25 <= b)
      )
        continue;
      const last = gaps.at(-1);
      if (last && a <= last[1] + 0.01) last[1] = b;
      else gaps.push([a, b]);
    }
    if (!selected.length && !gaps.length) gaps.push([chunk.coreStart, chunk.coreEnd]);
    gaps.forEach(([start, end], i) =>
      segments.push({
        id: `${chunk.index}-gap-${i}`,
        start,
        end,
        text: UNCLEAR,
        machine: UNCLEAR,
        speaker: '',
        flags: ['No recognized words; verify silence, noise or missing speech'],
      }),
    );
  }
  // Near a seam, mismatched outputs can duplicate or omit words. Keep them and flag both sides.
  for (let i = 1; i < job.chunks.length; i++) {
    const right = job.chunks[i],
      left = job.chunks[i - 1],
      seam = right.coreStart;
    if (!left.result || !right.result) continue;
    const nearby = (c: AudioChunk) =>
      c
        .result!.words.filter((w) => Math.abs(c.start + (w.start + w.end) / 2 - seam) < 1.5)
        .map((w) => w.word)
        .join(' ');
    if (lexical(nearby(left)) !== lexical(nearby(right))) {
      segments
        .filter((s) => s.start < seam + 2 && s.end > seam - 2)
        .forEach((s) => s.flags.push('Chunk boundary disagreement; review continuity'));
    }
  }
  return segments.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function processingCoverage(job: TranscriptJob): number {
  return (
    job.chunks.reduce((sum, c) => sum + (c.result ? c.coreEnd - c.coreStart : 0), 0) / job.duration
  );
}
export function transcriptText(job: TranscriptJob): string {
  const prefix =
    job.status === 'complete' ? '' : '[INCOMPLETE TRANSCRIPT — missing or unprocessed audio]\n\n';
  return (
    prefix +
    job.segments
      .map(
        (s) =>
          `${s.speaker ? `${job.speakers[s.speaker] ?? defaultSpeaker(s.speaker)}: ` : ''}${s.text}`,
      )
      .join('\n')
  );
}
export function defaultSpeaker(key: string): string {
  const [chunk, speaker] = key.split(':').map(Number);
  return `Speaker ${speaker + 1} (chunk ${chunk + 1})`;
}
export function timestamp(seconds: number): string {
  return new Date(Math.max(0, seconds) * 1000).toISOString().slice(11, 23);
}
export function vtt(job: TranscriptJob): string {
  return (
    'WEBVTT\n\n' +
    (job.status === 'complete' ? '' : 'NOTE INCOMPLETE TRANSCRIPT\n\n') +
    job.segments
      .map(
        (s, i) =>
          `${i + 1}\n${timestamp(s.start)} --> ${timestamp(s.end)}\n${s.speaker ? `${job.speakers[s.speaker] ?? defaultSpeaker(s.speaker)}: ` : ''}${s.text.replace(/-->/g, '→').replace(/\n\n/g, '\n')}\n`,
      )
      .join('\n')
  );
}

/** Machine text stays separate from edits to prevent measuring corrected output as ASR accuracy. */
export function evaluationExport(job: TranscriptJob) {
  const results = job.chunks.flatMap((c) => [c.result, c.review]).filter((r) => !!r);
  return {
    ...job,
    audio: undefined,
    text: job.segments.map((s) => s.machine).join(' '),
    editedText: transcriptText(job),
    model: 'nova-3',
    modelVersion: [...new Set(results.map((r) => r!.version))].join(','),
    processedIntervals: job.chunks.filter((c) => c.result).map((c) => [c.coreStart, c.coreEnd]),
    processingMs: results.reduce((sum, r) => sum + r!.processingMs, 0),
    apiCostUsd:
      results.length && results.every((r) => r!.estimatedCost !== null)
        ? results.reduce((sum, r) => sum + r!.estimatedCost!, 0)
        : null,
    speakers: undefined,
    speakerLabels: job.speakers,
    speakerSegments: job.segments
      .filter((s) => s.speaker)
      .map((s) => ({ start: s.start, end: s.end, speaker: s.speaker })),
  };
}
