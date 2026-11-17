import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useRepo } from '@/app/RepositoryProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { textDocument } from '@/lib/richText';
import { errorMessage } from '@/lib/format';
import { useRefreshLists } from '@/features/notes/hooks';
import type { RichEditorHandle } from '@/features/notes/RichEditor';
import { decodeAudio, MAX_FILE_BYTES, planChunks, SAMPLE_RATE } from './audio';
import { invokeTranscription, processJob } from './client';
import {
  buildSegments,
  defaultSpeaker,
  evaluationExport,
  processingCoverage,
  timestamp,
  transcriptText,
  vtt,
} from './quality';
import { deleteJob, loadJob, saveJob } from './storage';
import type { TranscriptJob, TranscriptMode } from './types';

function download(name: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TranscriptPanel({
  noteId,
  recording,
  bodyRef,
  ensureCreated,
}: {
  noteId: string;
  recording: Blob | null;
  bodyRef: RefObject<RichEditorHandle | null>;
  ensureCreated(): Promise<void>;
}) {
  const { repo } = useRepo();
  const navigate = useNavigate(),
    refresh = useRefreshLists();
  const [job, setJob] = useState<TranscriptJob | null>(null);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [consent, setConsent] = useState(false);
  const [mode, setMode] = useState<TranscriptMode>('strict');
  const [language, setLanguage] = useState<TranscriptJob['language']>('multi');
  const [vocabulary, setVocabulary] = useState(''),
    [normalize, setNormalize] = useState(false);
  const [position, setPosition] = useState(0);
  const [onlyReview, setOnlyReview] = useState(false),
    [saved, setSaved] = useState('');
  const player = useRef<HTMLAudioElement>(null),
    controller = useRef<AbortController | null>(null);
  const decoded = useRef<Float32Array | null>(null),
    mounted = useRef(true);
  const stopAt = useRef<number | null>(null);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    void loadJob(repo.scope, noteId)
      .then((value) => {
        if (active) {
          setJob(value ?? null);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setError('Could not restore the saved transcript. Device storage may be unavailable.');
          setLoaded(true);
        }
      });
    return () => {
      active = false;
      mounted.current = false;
      controller.current?.abort();
    };
  }, [noteId, repo.scope]);
  const audio = job?.audio;
  useEffect(() => {
    if (!audio) return;
    const url = URL.createObjectURL(audio);
    const element = player.current;
    if (element) element.src = url;
    return () => URL.revokeObjectURL(url);
  }, [audio]);
  const availability = useQuery({
    queryKey: ['transcription-available', repo.scope],
    enabled: repo.kind === 'cloud',
    retry: false,
    queryFn: () => invokeTranscription({ operation: 'status' }),
  });
  const available = repo.kind === 'cloud' && availability.data?.available === true;

  const persist = (next: TranscriptJob) => {
    setJob(next);
    setSaved('Saving…');
    void saveJob(next)
      .then(() => {
        if (mounted.current) setSaved('Saved on this device');
      })
      .catch(() => {
        if (mounted.current) {
          setSaved('Save failed');
          setError('Could not save edits. Export your transcript before closing.');
        }
      });
  };
  const prepare = async (blob: Blob, name: string) => {
    setBusy(true);
    setError('');
    try {
      if (blob.size > MAX_FILE_BYTES) throw new Error('Choose audio up to 150 MB.');
      const samples = await decodeAudio(blob);
      if (!mounted.current) return;
      decoded.current = samples;
      const next: TranscriptJob = {
        id: crypto.randomUUID(),
        scope: repo.scope,
        noteId,
        name,
        audio: blob,
        duration: samples.length / SAMPLE_RATE,
        mode,
        language,
        vocabulary: vocabulary
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        normalize,
        chunks: planChunks(samples),
        segments: [],
        speakers: {},
        status: 'ready',
        updatedAt: new Date().toISOString(),
      };
      if (next.vocabulary.length > 30 || next.vocabulary.some((v) => v.length > 80))
        throw new Error('Use up to 30 vocabulary hints, 80 characters each.');
      next.segments = buildSegments(next);
      await ensureCreated();
      await saveJob(next);
      if (mounted.current) {
        setJob(next);
        setSaved('Saved on this device');
      }
    } catch (e) {
      if (mounted.current)
        setError(errorMessage(e, 'Audio could not be decoded. Try WAV, MP3, M4A, OGG or WebM.'));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const run = async () => {
    if (!job || !consent || !available || busy) return;
    setBusy(true);
    setError('');
    const abort = new AbortController();
    controller.current = abort;
    try {
      const samples = decoded.current ?? (await decodeAudio(job.audio));
      decoded.current = samples;
      if (abort.signal.aborted) return;
      const next = await processJob(job, samples, abort.signal, (value) => {
        if (mounted.current) setJob(value);
      });
      if (mounted.current)
        setSaved(
          next.status === 'complete'
            ? 'Saved on this device'
            : 'Partial results saved; resume to retry',
        );
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const fullText = job ? transcriptText(job) : '';
  const speakers = job ? [...new Set(job.segments.map((s) => s.speaker).filter(Boolean))] : [];
  const reviewCount = job?.segments.filter((s) => s.flags.length && !s.reviewed).length ?? 0;
  const estimatedCost = job?.chunks
    .flatMap((c) => [c.result, c.review])
    .filter((r) => !!r)
    .reduce<number | null>(
      (sum, r) => (sum === null || r!.estimatedCost === null ? null : sum + r!.estimatedCost),
      0,
    );
  if (!loaded) return <p role="status">Loading saved transcription…</p>;
  return (
    <section className="space-y-3 border-t pt-3" aria-label="Recording transcription">
      <h3 className="font-semibold">Transcribe recorded audio</h3>
      <p className="text-xs text-muted-foreground">
        Tagalog, English and Taglish. No guaranteed accuracy. Listen to the original when reviewing.
        Filipino filler retention, speaker assignments and overlapping speech are not yet verified
        on a local benchmark.
      </p>
      {!available && (
        <p role="status" className="text-sm">
          {availability.isLoading
            ? 'Checking transcription service…'
            : 'AI transcription needs a signed-in cloud account and a configured transcribe function. Recording and live dictation remain available.'}
        </p>
      )}
      {!job && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm">
              Transcription mode
              <select
                className="mt-1 w-full rounded border bg-background p-2"
                value={mode}
                onChange={(e) => setMode(e.target.value as TranscriptMode)}
                disabled={busy}
              >
                <option value="strict">Strict Verbatim (default)</option>
                <option value="clean">Clean Transcript</option>
              </select>
            </label>
            <label className="text-sm">
              Spoken languages
              <select
                className="mt-1 w-full rounded border bg-background p-2"
                value={language}
                onChange={(e) => setLanguage(e.target.value as TranscriptJob['language'])}
                disabled={busy}
              >
                <option value="multi">Taglish / automatic multilingual</option>
                <option value="tl">Filipino / Tagalog</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Strict mode preserves recognized repetitions and words. Clean mode uses provider
            punctuation; it does not rewrite, translate or remove fillers. English filler detection
            is documented; Filipino fillers may still be missed.
          </p>
          <label className="block text-sm">
            Optional vocabulary hints (comma-separated, up to 30)
            <Input
              value={vocabulary}
              onChange={(e) => setVocabulary(e.target.value)}
              disabled={busy}
              maxLength={2400}
              placeholder="Names, school terms, technical terms"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Hints suggest possible words; they are never inserted into the transcript by the app.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={normalize}
              onChange={(e) => setNormalize(e.target.checked)}
              disabled={busy}
            />
            Compare gentle normalization during suspect-chunk review (maximum +6 dB). Original
            remains unchanged.
          </label>
          <label className="block text-sm">
            Choose audio (up to 150 MB / 120 minutes)
            <Input
              type="file"
              accept="audio/*,.mp3,.m4a,.mp4,.wav,.ogg,.flac,.webm"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void prepare(file, file.name);
                e.target.value = '';
              }}
            />
          </label>
          {recording && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void prepare(recording, 'Voice recording')}
            >
              Use microphone recording
            </Button>
          )}
        </>
      )}
      {job && (
        <>
          <p className="text-sm">
            {job.name} · {timestamp(job.duration).slice(0, 8)} ·{' '}
            {job.mode === 'strict' ? 'Strict Verbatim' : 'Clean Transcript'}
          </p>
          <audio
            ref={player}
            controls
            className="w-full"
            onTimeUpdate={(e) => {
              setPosition(e.currentTarget.currentTime);
              if (stopAt.current !== null && e.currentTarget.currentTime >= stopAt.current) {
                e.currentTarget.pause();
                stopAt.current = null;
              }
            }}
            onSeeking={() => {
              stopAt.current = null;
            }}
          />
          <label className="flex items-center gap-2 text-sm">
            Playback speed
            <select
              aria-label="Playback speed"
              defaultValue="1"
              className="rounded border bg-background p-1"
              onChange={(e) => {
                if (player.current) player.current.playbackRate = Number(e.target.value);
              }}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I agree to send audio chunks and optional vocabulary to Deepgram for AI processing.
            Audio and editable drafts are saved on this device; machine results are cached privately
            on the server for resume. Provider retention terms also apply.
          </label>
          <p className="text-xs text-muted-foreground">
            At most 3 suspect chunks get a second pass. Failed primary chunks allow 2 known-failure
            attempts. Hourly limit: 240 calls / 150 processed minutes, including overlap and
            retries.{' '}
            {availability.data?.ratePerMinute != null
              ? `Configured estimate: $${(availability.data.ratePerMinute * 60).toFixed(2)} / audio hour before overlap and reviews.`
              : 'Cost estimate unavailable until the administrator sets the contracted per-minute rate.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!available || !consent || busy || job.status === 'complete'}
              onClick={() => void run()}
            >
              {busy
                ? 'Processing…'
                : job.status === 'ready'
                  ? 'Transcribe audio'
                  : 'Resume / retry missing chunks'}
            </Button>
            {busy && (
              <Button variant="outline" onClick={() => controller.current?.abort()}>
                Pause processing
              </Button>
            )}
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  if (supabase && repo.kind === 'cloud') {
                    // Clear this note's server cache, including failed IDs rotated during retry.
                    const { error } = await supabase
                      .from('transcription_chunks')
                      .delete()
                      .eq('note_id', noteId)
                      .eq('user_id', repo.scope);
                    if (error)
                      throw new Error(
                        'Could not delete the server cache. Check your connection and retry.',
                      );
                  }
                  await deleteJob(job.id);
                  decoded.current = null;
                  setJob(null);
                  setSaved('');
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete recording & transcript
            </Button>
          </div>
          <div role="status" className="space-y-1 text-sm" aria-live="polite">
            <progress
              className="w-full"
              value={job.chunks.filter((c) => c.result).length}
              max={job.chunks.length}
              aria-label="Completed audio chunks"
            />
            <p>
              {job.chunks.filter((c) => c.result).length} / {job.chunks.length} primary chunks
              processed · {(processingCoverage(job) * 100).toFixed(1)}% audio submitted successfully
            </p>
            <p>
              {job.status === 'complete'
                ? 'All audio chunks processed. Word completeness still requires listening review.'
                : 'INCOMPLETE — the transcript does not yet represent the full recording.'}
            </p>
            <p>
              {reviewCount} segments need review · {saved}
              {estimatedCost != null
                ? ` · estimated successful API calls $${estimatedCost.toFixed(4)}`
                : ''}
            </p>
          </div>
          {job.chunks
            .filter((c) => c.error)
            .map((c) => (
              <p role="alert" key={c.index} className="text-sm text-destructive">
                Chunk {c.index + 1}: {c.error}
              </p>
            ))}
          {speakers.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm">
                Edit speaker labels (assignments uncertain across chunks)
              </summary>
              <div className="grid gap-2 pt-2 sm:grid-cols-2">
                {speakers.map((key) => (
                  <label key={key} className="text-xs">
                    {defaultSpeaker(key)}
                    <Input
                      aria-label={`Label for ${defaultSpeaker(key)}`}
                      maxLength={80}
                      disabled={busy}
                      value={job.speakers[key] ?? defaultSpeaker(key)}
                      onChange={(e) =>
                        persist({ ...job, speakers: { ...job.speakers, [key]: e.target.value } })
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyReview}
              onChange={(e) => setOnlyReview(e.target.checked)}
            />
            Show only unreviewed uncertain segments
          </label>
          <div className="max-h-96 space-y-3 overflow-y-auto" aria-label="Transcript segments">
            {job.segments
              .filter((s) => !onlyReview || (s.flags.length && !s.reviewed))
              .map((segment) => (
                <div
                  key={segment.id}
                  className={`space-y-1 rounded border p-2 ${position >= segment.start && position < segment.end ? 'border-primary bg-primary/5' : ''}`}
                >
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      const audio = player.current;
                      if (!audio) return;
                      audio.currentTime = segment.start;
                      // seeking fires asynchronously; set the stop boundary after seeking completes.
                      audio.onseeked = () => {
                        stopAt.current = segment.end;
                        audio.onseeked = null;
                      };
                      void audio
                        .play()
                        .catch(() => setError('Playback could not start. Use the audio controls.'));
                    }}
                  >
                    Play {timestamp(segment.start).slice(0, 8)}–{timestamp(segment.end).slice(0, 8)}{' '}
                    {segment.speaker
                      ? (job.speakers[segment.speaker] ?? defaultSpeaker(segment.speaker))
                      : 'Unassigned speaker'}
                  </Button>
                  <textarea
                    aria-label={`Transcript at ${timestamp(segment.start)}`}
                    className="min-h-16 w-full rounded border bg-background p-2 text-sm"
                    value={segment.text}
                    disabled={busy}
                    onChange={(e) =>
                      persist({
                        ...job,
                        segments: job.segments.map((s) =>
                          s.id === segment.id ? { ...s, text: e.target.value, reviewed: false } : s,
                        ),
                      })
                    }
                  />
                  {segment.flags.length > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      {segment.flags.join(' · ')}
                    </p>
                  )}
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={!!segment.reviewed}
                      onChange={(e) =>
                        persist({
                          ...job,
                          segments: job.segments.map((s) =>
                            s.id === segment.id ? { ...s, reviewed: e.target.checked } : s,
                          ),
                        })
                      }
                    />
                    Reviewed against original audio
                  </label>
                  <details>
                    <summary className="cursor-pointer text-xs">
                      Original machine text / comparison
                    </summary>
                    <p className="whitespace-pre-wrap text-sm">{segment.machine}</p>
                    {segment.alternative && (
                      <p className="mt-2 whitespace-pre-wrap text-sm">
                        Alternative whole-chunk pass (not automatically applied):{' '}
                        {segment.alternative}
                      </p>
                    )}
                  </details>
                </div>
              ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  .writeText(fullText)
                  .then(() => toast.success('Transcript copied'))
                  .catch(() => setError('Clipboard unavailable. Export TXT instead.'));
              }}
            >
              Copy transcript
            </Button>
            <Button
              variant="outline"
              onClick={() => download('transcript.txt', fullText, 'text/plain;charset=utf-8')}
            >
              Export TXT
            </Button>
            <Button
              variant="outline"
              onClick={() => download('transcript.vtt', vtt(job), 'text/vtt;charset=utf-8')}
            >
              Export VTT
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                download(
                  'transcript.json',
                  JSON.stringify(evaluationExport(job), null, 2),
                  'application/json',
                )
              }
            >
              Export JSON
            </Button>
            <Button
              disabled={busy || !job.segments.length}
              onClick={() => {
                bodyRef.current
                  ?.getEditor()
                  ?.chain()
                  .focus()
                  .insertContent(textDocument(fullText).content ?? [])
                  .run();
                toast.success('Transcript inserted');
              }}
            >
              Insert into note
            </Button>
            <Button
              disabled={busy || !job.segments.length}
              onClick={async () => {
                try {
                  const note = await repo.createNote({
                    title: `Transcript — ${job.name}`.slice(0, 200),
                    content: fullText,
                  });
                  await refresh();
                  navigate(`/notes/${note.id}`);
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              Create note from transcript
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const url = URL.createObjectURL(job.audio),
                  a = document.createElement('a');
                a.href = url;
                a.download = job.name.includes('.')
                  ? job.name
                  : `recording.${job.audio.type.includes('mp4') ? 'm4a' : 'webm'}`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Download original audio
            </Button>
          </div>
          <details>
            <summary className="cursor-pointer text-xs">Recognition details</summary>
            <p className="text-xs">
              Deepgram Nova-3; diarizer v2 requested. Resampling: mono 16 kHz. Timestamps are
              provider output. Energy activity checks may flag noise or miss quiet speech. Word
              confidence is a provider score, not a calibrated accuracy percentage. Strict mode does
              not correct grammar. No real identities are inferred.
            </p>
            <pre className="overflow-auto text-xs">
              {[...new Set(job.chunks.map((c) => c.result?.version).filter(Boolean))].join('\n')}
            </pre>
          </details>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
