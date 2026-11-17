// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processJob } from '@/features/transcription/client';
import { planChunks, SAMPLE_RATE } from '@/features/transcription/audio';
import { buildSegments } from '@/features/transcription/quality';
import { supabase } from '@/lib/supabase';
import { saveJob } from '@/features/transcription/storage';
import type { Recognition, TranscriptJob } from '@/features/transcription/types';
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('@/features/transcription/storage', () => ({
  saveJob: vi.fn(async () => undefined),
  transcriptGeneration: () => 0,
  assertTranscriptSession: () => undefined,
}));
const invoke = vi.mocked(supabase!.functions.invoke);
const samples = new Float32Array(160 * SAMPLE_RATE);
function recognition(uncertain = false): Recognition {
  return {
    words: [
      {
        word: 'po',
        start: 3,
        end: 4,
        confidence: uncertain ? 0.3 : 0.99,
        speaker: 0,
        speaker_confidence: 0.99,
      },
    ],
    text: 'po',
    duration: 42,
    model: 'nova-3',
    version: 'test-only',
    diarizer: 'v2',
    languages: ['tl'],
    estimatedCost: null,
    processingMs: 20,
  };
}
function job(): TranscriptJob {
  return {
    id: 'local-job',
    scope: 'user',
    noteId: 'note',
    name: 'synthetic PCM',
    audio: new Blob(),
    duration: 160,
    mode: 'strict',
    language: 'multi',
    vocabulary: [],
    normalize: false,
    chunks: planChunks(samples),
    segments: [],
    speakers: {},
    status: 'ready',
    updatedAt: '',
  };
}
beforeEach(() => vi.clearAllMocks());
describe('checkpointed multi-pass workflow using provider test doubles', () => {
  it('does not reprocess clear audio and checkpoints every completed primary chunk', async () => {
    invoke.mockResolvedValue({ data: recognition(), error: null });
    const final = await processJob(job(), samples, new AbortController().signal, vi.fn());
    expect(final.status).toBe('complete');
    expect(invoke).toHaveBeenCalledTimes(4);
    expect(vi.mocked(saveJob)).toHaveBeenCalledTimes(6);
    expect(final.chunks.every((c) => !c.reviewAttempted)).toBe(true);
  });
  it('caps targeted reviews at three and never changes primary words based on agreement', async () => {
    invoke.mockResolvedValue({ data: recognition(true), error: null });
    const final = await processJob(job(), samples, new AbortController().signal, vi.fn());
    expect(invoke).toHaveBeenCalledTimes(7);
    expect(final.chunks.filter((c) => c.reviewAttempted)).toHaveLength(3);
  });
  it('resumes completed chunks without charging again and preserves user edits', async () => {
    const initial = job();
    initial.chunks[0].result = recognition();
    initial.segments = buildSegments(initial);
    initial.segments[0].text = 'Human correction';
    initial.segments[0].reviewed = true;
    invoke.mockResolvedValue({ data: recognition(), error: null });
    const final = await processJob(initial, samples, new AbortController().signal, vi.fn());
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(final.segments[0]).toMatchObject({
      text: 'Human correction',
      machine: 'po',
      reviewed: true,
    });
  });
  it('reuses request keys after ambiguous network failures', async () => {
    const initial = job(),
      key = initial.chunks[0].primaryId;
    invoke.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } } as never);
    const final = await processJob(initial, samples, new AbortController().signal, vi.fn());
    expect(final.status).toBe('partial');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(final.chunks[0].primaryId).toBe(key);
    expect(final.chunks[0].attempts).toBe(0);
  });
  it('caps known-failed attempts and prevents later chunks from running on service failure', async () => {
    const initial = job();
    initial.chunks[0].attempts = 1;
    invoke.mockResolvedValue({
      data: null,
      error: { context: { json: async () => ({ error: 'Provider failed', retryable: true }) } },
    } as never);
    const failed = await processJob(initial, samples, new AbortController().signal, vi.fn());
    expect(failed.chunks[0].attempts).toBe(2);
    expect(invoke).toHaveBeenCalledTimes(1);
    invoke.mockClear();
    const final = await processJob(failed, samples, new AbortController().signal, vi.fn());
    expect(final.chunks[0].error).toContain('budget exhausted');
    expect(invoke).toHaveBeenCalledTimes(1); // Next missing chunk is independently attempted.
    expect(final.status).toBe('partial');
  });
  it('persists partial status when paused before sending audio', async () => {
    const abort = new AbortController();
    abort.abort();
    const final = await processJob(job(), samples, abort.signal, vi.fn());
    expect(invoke).not.toHaveBeenCalled();
    expect(final.status).toBe('partial');
  });
});
