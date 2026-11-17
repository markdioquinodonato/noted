// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { planChunks, SAMPLE_RATE, wavChunk } from '@/features/transcription/audio';
import {
  buildSegments,
  processingCoverage,
  qualityFlags,
  transcriptText,
} from '@/features/transcription/quality';
import { UNCLEAR, type TranscriptJob, type Recognition } from '@/features/transcription/types';
import {
  parseProvider,
  providerUrl,
  validateOptions,
  validateWav,
} from '../../supabase/functions/transcribe/core';

function result(words = ['po', 'po', 'we', 'need', 'documentation']): Recognition {
  return {
    text: words.join(' '),
    words: words.map((word, i) => ({
      word,
      start: 1 + i,
      end: 1.5 + i,
      speaker: 0,
      speaker_confidence: 0.9,
      confidence: 0.99,
    })),
    duration: 42,
    model: 'nova-3',
    version: 'test',
    diarizer: 'v2',
    languages: ['tl', 'en'],
    estimatedCost: null,
    processingMs: 100,
  };
}
function fixture(seconds = 81): TranscriptJob {
  return {
    id: 'job',
    scope: 'user',
    noteId: 'note',
    name: 'fixture',
    audio: new Blob(),
    duration: seconds,
    mode: 'strict',
    language: 'multi',
    vocabulary: [],
    normalize: false,
    chunks: planChunks(new Float32Array(seconds * SAMPLE_RATE)),
    segments: [],
    speakers: {},
    status: 'partial',
    updatedAt: '',
  };
}
describe('audio integrity and bounded provider requests', () => {
  it('covers the beginning, middle and end with contextual overlap', () => {
    const chunks = fixture().chunks;
    expect(chunks.map((c) => [c.start, c.end, c.coreStart, c.coreEnd])).toEqual([
      [0, 42, 0, 40],
      [38, 81, 40, 80],
      [78, 81, 80, 81],
    ]);
    expect(chunks.every((c) => c.end - c.start <= 44)).toBe(true);
  });
  it('creates validated WAV bytes and leaves source samples unchanged', async () => {
    const samples = new Float32Array(SAMPLE_RATE).fill(0.1),
      before = samples.slice();
    const blob = wavChunk(samples, 0, 1, true);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(validateWav(bytes)).toBe(1);
    expect(samples).toEqual(before);
    bytes[24] = 0;
    expect(() => validateWav(bytes)).toThrow();
    expect(() => validateWav(new Uint8Array(2))).toThrow();
  });
  it('rejects oversized vocabulary and unsupported options', () => {
    expect(() =>
      validateOptions({ language: 'translate', mode: 'strict', vocabulary: [], pass: 'primary' }),
    ).toThrow();
    expect(() =>
      validateOptions({ language: 'multi', mode: 'strict', vocabulary: ['x\ny'], pass: 'primary' }),
    ).toThrow();
  });
  it('uses supported diarization and code-switch hints; unbiased review omits hints', () => {
    const primary = providerUrl({
      language: 'multi',
      mode: 'strict',
      vocabulary: ['Noted'],
      pass: 'primary',
    });
    expect(primary.searchParams.get('diarize_model')).toBe('v2');
    expect(primary.searchParams.has('diarize')).toBe(false);
    expect(primary.searchParams.getAll('language_hint')).toEqual(['tl', 'en']);
    expect(primary.searchParams.get('filler_words')).toBe('true');
    expect(primary.searchParams.get('smart_format')).toBe('false');
    const review = providerUrl({
      language: 'multi',
      mode: 'strict',
      vocabulary: ['Noted'],
      pass: 'review',
    });
    expect(review.searchParams.has('keyterm')).toBe(false);
    expect(review.searchParams.has('language_hint')).toBe(false);
  });
  it('rejects missing timestamps, impossible confidence and incomplete provider coverage', () => {
    expect(() =>
      parseProvider(
        {
          metadata: { duration: 5 },
          results: { channels: [{ alternatives: [{ transcript: 'hello' }] }] },
        },
        5,
      ),
    ).toThrow();
    expect(() =>
      parseProvider(
        {
          metadata: { duration: 3 },
          results: { channels: [{ alternatives: [{ transcript: '', words: [] }] }] },
        },
        5,
      ),
    ).toThrow();
    const response = {
      metadata: { duration: 5 },
      results: {
        channels: [
          {
            alternatives: [
              { transcript: 'po', words: [{ word: 'po', start: 0, end: 1, confidence: 95 }] },
            ],
          },
        ],
      },
    };
    expect(() => parseProvider(response, 5)).toThrow();
  });
});
describe('fidelity, uncertainty and coverage', () => {
  it('preserves repeated particles and English terms exactly', () => {
    const job = fixture(20);
    job.chunks[0].result = result();
    job.segments = buildSegments(job);
    expect(job.segments[0].machine).toBe('po po we need documentation');
    expect(job.segments[0].text).toBe(job.segments[0].machine);
  });
  it('counts processed audio, not inferred speech accuracy; exposes missing chunks', () => {
    const job = fixture();
    job.chunks[0].result = result();
    job.segments = buildSegments(job);
    expect(processingCoverage(job)).toBeCloseTo(40 / 81);
    expect(job.segments.filter((s) => s.machine === UNCLEAR)).toHaveLength(2);
    expect(transcriptText(job)).toContain('INCOMPLETE');
  });
  it('flags disagreements without replacing primary words or manufacturing confidence', () => {
    const job = fixture(20);
    job.chunks[0].result = result();
    job.chunks[0].review = result(['translated', 'sentence']);
    job.chunks[0].result.words[0].confidence = undefined;
    const segments = buildSegments(job);
    expect(segments[0].text).toBe('po po we need documentation');
    expect(segments[0].flags).toContain('Transcription passes disagree; compare with audio');
    expect(segments[0].alternative).toBe('translated sentence');
  });
  it('keeps one copy of each timed overlap word and marks cross-chunk speakers uncertain', () => {
    const job = fixture(80);
    job.chunks[0].result = result(['a', 'po', 'po']);
    job.chunks[0].result.words = [
      { word: 'a', start: 38, end: 39 },
      { word: 'po', start: 39, end: 40 },
      { word: 'po', start: 40, end: 41 },
    ];
    job.chunks[1].result = result(['a', 'po', 'po']);
    job.chunks[1].result.words = [
      { word: 'a', start: 0, end: 1 },
      { word: 'po', start: 1, end: 2 },
      { word: 'po', start: 2, end: 3 },
    ];
    const segments = buildSegments(job);
    expect(segments.map((s) => s.text).join(' ')).toBe('a po po');
    expect(segments[1].flags).toContain('Speaker labels are local to this chunk');
  });
  it('marks energetic regions with no recognized words for manual audio review', () => {
    const job = fixture(20);
    job.chunks[0].result = result();
    job.chunks[0].activity = [
      [10, 10.5],
      [10.5, 11],
    ];
    expect(qualityFlags(job.chunks[0])).toContain('Possible missing speech or background sound');
    expect(buildSegments(job).find((s) => s.machine === UNCLEAR)).toMatchObject({
      start: 10,
      end: 11,
    });
  });
});
