import { supabase } from '@/lib/supabase';
import { wavChunk } from './audio';
import { buildSegments, qualityFlags } from './quality';
import { saveJob, assertTranscriptSession, transcriptGeneration } from './storage';
import type { AudioChunk, Recognition, TranscriptJob } from './types';

export class TranscriptionError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
export async function invokeTranscription(
  body: FormData | { operation: 'status' },
  signal?: AbortSignal,
) {
  if (!supabase) throw new Error('Sign in to a configured cloud account to transcribe.');
  const { data, error } = await supabase.functions.invoke('transcribe', { body, signal });
  if (error) {
    let message = 'Could not reach transcription. Check your session and server configuration.',
      retryable = false;
    try {
      const response = await error.context?.json();
      message = response?.error ?? message;
      retryable = response?.retryable === true;
    } catch {
      /* Network failure: reuse the idempotency key when resuming. */
    }
    throw new TranscriptionError(message, retryable);
  }
  return data;
}
async function recognize(
  job: TranscriptJob,
  chunk: AudioChunk,
  samples: Float32Array,
  pass: 'primary' | 'review',
  signal: AbortSignal,
): Promise<Recognition> {
  const body = new FormData();
  body.set(
    'audio',
    wavChunk(samples, chunk.start, chunk.end, pass === 'review' && job.normalize),
    'chunk.wav',
  );
  body.set(
    'options',
    JSON.stringify({ language: job.language, mode: job.mode, vocabulary: job.vocabulary, pass }),
  );
  body.set('noteId', job.noteId);
  body.set('requestId', pass === 'primary' ? chunk.primaryId : chunk.reviewId);
  body.set('consent', 'true');
  return (await invokeTranscription(body, signal)) as Recognition;
}

/** Sequential checkpoints give truthful progress and make a closed tab resumable.
 * At most two failed-primary attempts and three suspect-chunk reviews per job. */
export async function processJob(
  initial: TranscriptJob,
  samples: Float32Array,
  signal: AbortSignal,
  onUpdate: (job: TranscriptJob) => void,
) {
  const job: TranscriptJob = structuredClone(initial);
  const generation = transcriptGeneration(job.scope);
  const checkpoint = async () => {
    assertTranscriptSession(job.scope, generation);
    job.updatedAt = new Date().toISOString();
    job.segments = buildSegments(job).map((segment) => {
      const previous = initial.segments.find((s) => s.id === segment.id);
      return previous?.machine === segment.machine
        ? { ...segment, text: previous.text, reviewed: previous.reviewed }
        : segment;
    });
    await saveJob(job);
    onUpdate(structuredClone(job));
  };
  job.status = 'processing';
  await checkpoint();
  let reviews = job.chunks.filter((c) => c.reviewAttempted).length;
  for (const chunk of job.chunks) {
    if (signal.aborted) break;
    if (!chunk.result) {
      if (chunk.attempts >= 2) {
        chunk.error = 'Retry budget exhausted. Review audio manually.';
        continue;
      }
      delete chunk.error;
      try {
        chunk.result = await recognize(job, chunk, samples, 'primary', signal);
      } catch (error) {
        chunk.error = error instanceof Error ? error.message : 'Chunk failed.';
        if (error instanceof TranscriptionError && error.retryable) {
          chunk.attempts++;
          // Only known failures receive a fresh ID. Network errors retain the ID.
          chunk.primaryId = crypto.randomUUID();
        }
        await checkpoint();
        // Stop on failure: avoid repeatedly sending audio when auth/quota/service is unavailable.
        break;
      }
      await checkpoint();
    }
    if (signal.aborted) break;
    if (chunk.result && qualityFlags(chunk).length && !chunk.reviewAttempted && reviews < 3) {
      chunk.reviewAttempted = true;
      reviews++;
      await checkpoint(); // Persist before the charged operation; no retry storm after interruption.
      try {
        chunk.review = await recognize(job, chunk, samples, 'review', signal);
      } catch (error) {
        chunk.error = `Review unavailable: ${error instanceof Error ? error.message : 'request failed'}`;
      }
      await checkpoint();
    }
  }
  job.status = job.chunks.every((c) => !!c.result) ? 'complete' : 'partial';
  await checkpoint();
  return job;
}
