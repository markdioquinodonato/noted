import { useCallback, useEffect, useRef, useState } from 'react';
import type { Worker } from 'tesseract.js';
import {
  Camera,
  CameraOff,
  Check,
  Copy,
  ImageUp,
  Loader2,
  RotateCcw,
  ScanText,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { readBrowserValue, writeBrowserValue } from '@/lib/browserStorage';
import { cn } from '@/lib/utils';
import {
  canvasToBlob,
  createScannerWorker,
  grabFrame,
  prepareScanImage,
  readableWords,
  similarity,
  type DetectedWord,
} from './ocr';

/**
 * Camera text scanner that lives inside the note editor.
 *
 * While the camera is open, frames are read continuously by the on-device OCR
 * model. Detected words are outlined live; once the same text is read steadily
 * across consecutive frames, the scanner captures automatically (or the user
 * taps the shutter). The recognized text is reviewed, then inserted at the
 * cursor in the current note. Nothing is uploaded.
 */
export function ScannerDialog({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onInsert(text: string): Promise<void> | void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[min(860px,92dvh)] sm:max-w-2xl sm:rounded-2xl sm:border"
      >
        <DialogTitle className="sr-only">Scan text with camera</DialogTitle>
        <DialogDescription className="sr-only">
          Point your camera at printed text. Text is detected automatically on this device and
          inserted into your note after you review it.
        </DialogDescription>
        {open && <ScannerBody onInsert={onInsert} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

type Phase = 'live' | 'review';
const AUTO_KEY = 'noted:scanner-auto';
const LIVE_SIDE = 960;

function ScannerBody({
  onInsert,
  onClose,
}: {
  onInsert(text: string): Promise<void> | void;
  onClose(): void;
}) {
  const [phase, setPhase] = useState<Phase>('live');
  const [cameraState, setCameraState] = useState<'starting' | 'on' | 'off'>('starting');
  const [workerReady, setWorkerReady] = useState(false);
  const [detected, setDetected] = useState<DetectedWord[]>([]);
  const [steady, setSteady] = useState(0);
  const [auto, setAuto] = useState(() => readBrowserValue(AUTO_KEY) !== '0');
  const [preview, setPreview] = useState('');
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const worker = useRef<Worker | null>(null);
  const workerPromise = useRef<Promise<Worker> | null>(null);
  const alive = useRef(true);
  const phaseRef = useRef<Phase>('live');
  const autoRef = useRef(auto);
  const job = useRef(0);
  const reviewing = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
    autoRef.current = auto;
  }, [phase, auto]);

  // ---- worker -------------------------------------------------------------
  const getWorker = useCallback(() => {
    if (!workerPromise.current) {
      workerPromise.current = createScannerWorker((status, value) => {
        if (alive.current && reviewing.current && status === 'recognizing text') setProgress(value);
      }).then((w) => {
        if (!alive.current) {
          void w.terminate();
          throw new Error('closed');
        }
        worker.current = w;
        setWorkerReady(true);
        return w;
      });
      workerPromise.current.catch(() => {
        workerPromise.current = null;
      });
    }
    return workerPromise.current;
  }, []);

  // ---- camera -------------------------------------------------------------
  const stopCamera = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  /** Requests the camera; only touches state after the permission prompt resolves. */
  const openCamera = useCallback(async () => {
    try {
      // Camera access needs HTTPS and a supported browser; a missing API rejects below.
      const media = await Promise.resolve().then(() =>
        navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        }),
      );
      if (!alive.current || phaseRef.current !== 'live') {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      // Ask for continuous autofocus where the device supports it.
      const track = media.getVideoTracks()[0];
      void track
        ?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
        .catch(() => undefined);
      setCameraState('on');
    } catch {
      if (!alive.current) return;
      setCameraState('off');
      setError('Camera unavailable or permission denied. You can still choose a photo.');
    }
  }, []);

  const startCamera = useCallback(() => {
    setError('');
    setCameraState('starting');
    return openCamera();
  }, [openCamera]);

  useEffect(() => {
    alive.current = true;
    void getWorker().catch(() => {
      if (alive.current) setError('The on-device text reader could not load. Reopen the scanner.');
    });
    // openCamera only sets state after the async permission prompt resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void openCamera();
    return () => {
      alive.current = false;
      stream.current?.getTracks().forEach((t) => t.stop());
      void worker.current?.terminate();
    };
  }, [getWorker, openCamera]);

  useEffect(() => {
    const el = video.current;
    if (cameraState === 'on' && el && stream.current && el.srcObject !== stream.current) {
      el.srcObject = stream.current;
      void el.play().catch(() => {
        setError('Camera preview could not start. Choose a photo instead.');
      });
    }
  }, [cameraState, phase]);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  // ---- review (full-quality recognition) ----------------------------------
  const review = useCallback(
    async (image: Blob) => {
      const current = ++job.current;
      reviewing.current = true;
      phaseRef.current = 'review';
      stopCamera();
      setCameraState('off');
      setPhase('review');
      setDetected([]);
      setSteady(0);
      setText('');
      setError('');
      setProgress(0);
      setReading(true);
      setPreview(URL.createObjectURL(image));
      try {
        const w = await getWorker();
        const result = await w.recognize(image);
        if (!alive.current || current !== job.current) return;
        const value = result.data.text.replace(/\n{3,}/g, '\n\n').trim();
        setText(value);
        if (!value) setError('No text found. Try a sharper photo with better lighting.');
      } catch {
        if (alive.current && current === job.current)
          setError('Text recognition failed. Retake the photo or choose another image.');
      } finally {
        if (alive.current && current === job.current) {
          setReading(false);
          reviewing.current = false;
        }
      }
    },
    [getWorker, stopCamera],
  );

  const capture = useCallback(async () => {
    const el = video.current;
    if (!el) return;
    const frame = grabFrame(el, 2400, false);
    if (!frame) return;
    try {
      await review(await canvasToBlob(frame));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [review]);

  const choose = async (file: File) => {
    setError('');
    try {
      await review(await prepareScanImage(file));
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  };

  const retake = () => {
    ++job.current;
    phaseRef.current = 'live';
    reviewing.current = false;
    setReading(false);
    setText('');
    setError('');
    setPreview('');
    setPhase('live');
    void startCamera();
  };

  // ---- live detection loop -------------------------------------------------
  useEffect(() => {
    if (phase !== 'live' || cameraState !== 'on' || !workerReady) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let previous: DetectedWord[] = [];
    let stable = 0;
    const tick = async () => {
      if (stopped) return;
      const el = video.current,
        w = worker.current;
      const frame = el && el.readyState >= 2 ? grabFrame(el, LIVE_SIDE) : null;
      if (frame && w) {
        try {
          const result = await w.recognize(frame, {}, { blocks: true, text: true });
          if (stopped || phaseRef.current !== 'live') return;
          const words = readableWords(result.data);
          const scale = (el?.videoWidth ?? frame.width) / frame.width;
          const mapped = words.map((word) => ({
            ...word,
            x0: word.x0 * scale,
            y0: word.y0 * scale,
            x1: word.x1 * scale,
            y1: word.y1 * scale,
          }));
          const avg = mapped.reduce((s, x) => s + x.confidence, 0) / (mapped.length || 1);
          const good = mapped.length >= 3 && avg >= 68;
          stable = good && similarity(mapped, previous) >= 0.6 ? stable + 1 : good ? 1 : 0;
          previous = mapped;
          setDetected(mapped);
          setSteady(stable);
          if (autoRef.current && stable >= 2) {
            stopped = true;
            void capture();
            return;
          }
        } catch {
          /* a dropped frame is fine; try the next one */
        }
      }
      timer = setTimeout(() => void tick(), 250);
    };
    timer = setTimeout(() => void tick(), 400);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [phase, cameraState, workerReady, capture]);

  // ---- overlay drawing -----------------------------------------------------
  useEffect(() => {
    const canvas = overlay.current,
      box = stage.current,
      el = video.current;
    if (!canvas || !box || !el) return;
    const draw = () => {
      const W = box.clientWidth,
        H = box.clientHeight,
        dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const vw = el.videoWidth,
        vh = el.videoHeight;
      if (!vw || !vh || !detected.length) return;
      // The preview uses object-cover: map video pixels to on-screen pixels.
      const s = Math.max(W / vw, H / vh),
        ox = (W - vw * s) / 2,
        oy = (H - vh * s) / 2;
      const color = steady >= 1 ? '52, 211, 153' : '96, 165, 250';
      for (const w of detected) {
        const x = w.x0 * s + ox - 3,
          y = w.y0 * s + oy - 3,
          bw = (w.x1 - w.x0) * s + 6,
          bh = (w.y1 - w.y0) * s + 6;
        ctx.fillStyle = `rgba(${color}, 0.22)`;
        ctx.strokeStyle = `rgba(${color}, 0.95)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, 4);
        ctx.fill();
        ctx.stroke();
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    return () => ro.disconnect();
  }, [detected, steady]);

  const insert = async () => {
    setSaving(true);
    try {
      await onInsert(text.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  const status = (() => {
    if (cameraState === 'starting') return { tone: 'idle', label: 'Starting camera…' };
    if (!workerReady) return { tone: 'idle', label: 'Loading text reader…' };
    if (steady >= 1) return { tone: 'good', label: 'Text detected — hold steady' };
    if (detected.length) return { tone: 'seen', label: 'Reading text…' };
    return { tone: 'idle', label: 'Point your camera at text' };
  })();

  const fileInput = (
    <input
      type="file"
      aria-label="Choose scanner image"
      accept="image/png,image/jpeg,image/webp"
      className="peer sr-only"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void choose(file);
        e.target.value = '';
      }}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <span className="grid size-8 place-items-center rounded-lg bg-primary/12 text-primary">
          <ScanText className="size-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-tight font-semibold">Scan text</p>
          <p className="truncate text-xs text-muted-foreground">On-device · nothing is uploaded</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close scanner" onClick={onClose}>
          <X />
        </Button>
      </div>

      {phase === 'live' ? (
        <>
          <div ref={stage} className="relative min-h-0 flex-1 overflow-hidden bg-black">
            {cameraState !== 'off' && (
              <video
                ref={video}
                muted
                playsInline
                autoPlay
                aria-label="Camera preview"
                className="absolute inset-0 size-full object-cover"
              />
            )}
            <canvas
              ref={overlay}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 size-full"
            />
            {cameraState !== 'off' && <FrameGuide active={steady >= 1} />}
            {cameraState === 'off' && (
              <div className="absolute inset-0 grid place-items-center p-8 text-center text-white">
                <div className="max-w-xs">
                  <span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-white/10">
                    <CameraOff className="size-7" aria-hidden="true" />
                  </span>
                  <p className="font-medium">Camera is off</p>
                  <p className="mt-1 text-sm text-white/70">
                    {error || 'Turn on the camera or choose a photo of printed text.'}
                  </p>
                  <Button className="mt-5" onClick={() => void startCamera()}>
                    <Camera /> Open camera
                  </Button>
                </div>
              </div>
            )}
            {cameraState !== 'off' && (
              <div className="absolute inset-x-0 top-4 flex justify-center px-4">
                <span
                  role="status"
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium shadow-lg backdrop-blur-md transition-colors',
                    status.tone === 'good'
                      ? 'bg-emerald-500/90 text-white'
                      : status.tone === 'seen'
                        ? 'bg-blue-500/85 text-white'
                        : 'bg-black/55 text-white',
                  )}
                >
                  {status.tone === 'good' ? (
                    <Sparkles className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Loader2
                      className={cn(
                        'size-3.5',
                        status.tone !== 'idle' || !workerReady ? 'animate-spin' : 'hidden',
                      )}
                      aria-hidden="true"
                    />
                  )}
                  {status.label}
                </span>
              </div>
            )}
            {detected.length > 0 && (
              <p className="absolute inset-x-4 bottom-4 line-clamp-2 rounded-xl bg-black/60 px-3 py-2 text-center text-xs leading-relaxed text-white/90 backdrop-blur-md">
                {detected.map((w) => w.text).join(' ')}
              </p>
            )}
          </div>

          {/* Controls */}
          <div className="grid shrink-0 grid-cols-3 items-center gap-2 border-t bg-background px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <label className="inline-flex cursor-pointer items-center justify-self-start">
              {fileInput}
              <span className="inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors hover:bg-accent peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50">
                <ImageUp className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Photo</span>
              </span>
            </label>
            <button
              type="button"
              aria-label="Capture photo"
              disabled={cameraState !== 'on'}
              onClick={() => void capture()}
              className="group justify-self-center rounded-full border-4 border-primary/25 p-1 transition-transform outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95 disabled:opacity-40"
            >
              <span
                className={cn(
                  'grid size-14 place-items-center rounded-full text-primary-foreground transition-colors',
                  steady >= 1 ? 'bg-emerald-500' : 'bg-primary',
                )}
              >
                <Camera className="size-6" aria-hidden="true" />
              </span>
            </button>
            <label className="flex cursor-pointer items-center gap-2 justify-self-end text-xs font-medium text-muted-foreground">
              <span className="text-right leading-tight">
                Auto
                <span className="hidden sm:inline"> capture</span>
              </span>
              <Switch
                checked={auto}
                aria-label="Auto capture when text is detected"
                onCheckedChange={(v) => {
                  setAuto(v);
                  writeBrowserValue(AUTO_KEY, v ? '1' : '0');
                }}
              />
            </label>
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <div className="space-y-4 p-4 sm:p-5">
            <div className="relative overflow-hidden rounded-xl border bg-muted">
              {preview && (
                <img src={preview} alt="Photo to scan" className="max-h-56 w-full object-contain" />
              )}
              {reading && (
                <div className="absolute inset-0 overflow-hidden">
                  <div className="scan-sweep absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-primary/30 to-transparent" />
                </div>
              )}
            </div>

            {reading && (
              <div role="status" className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Reading text…
                  </span>
                  <span className="tabular-nums">{progress}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${Math.max(6, progress)}%` }}
                  />
                </div>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <label className="block space-y-2">
              <span className="flex items-center justify-between text-sm font-medium">
                Recognized text
                {!reading && text && (
                  <span className="text-xs font-normal text-muted-foreground">
                    Edit before inserting
                  </span>
                )}
              </span>
              <textarea
                aria-label="Recognized text"
                value={text}
                disabled={reading}
                placeholder={reading ? 'Reading…' : 'No text yet'}
                onChange={(e) => setText(e.target.value)}
                className="min-h-44 w-full resize-y rounded-xl border bg-background p-3 text-sm leading-relaxed outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
              />
            </label>
          </div>
          <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-background/95 p-4 backdrop-blur pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button variant="outline" onClick={retake} disabled={saving}>
              <RotateCcw /> Retake
            </Button>
            <label className="inline-flex cursor-pointer">
              {fileInput}
              <span className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-accent peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50">
                <ImageUp className="size-4" aria-hidden="true" /> Other photo
              </span>
            </label>
            <span className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy recognized text"
              disabled={!text.trim() || reading}
              onClick={() =>
                void navigator.clipboard
                  .writeText(text)
                  .then(() => toast.success('Copied'))
                  .catch(() => toast.error('Clipboard unavailable.'))
              }
            >
              <Copy />
            </Button>
            <Button disabled={!text.trim() || reading || saving} onClick={() => void insert()}>
              <Check /> {saving ? 'Inserting…' : 'Insert into note'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Corner brackets that frame the scan area and turn green when text is steady. */
function FrameGuide({ active }: { active: boolean }) {
  const c = cn(
    'absolute size-8 border-[3px] transition-colors duration-300',
    active ? 'border-emerald-400' : 'border-white/85',
  );
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-[12%_8%]">
      <span className={cn(c, 'top-0 left-0 rounded-tl-xl border-r-0 border-b-0')} />
      <span className={cn(c, 'top-0 right-0 rounded-tr-xl border-b-0 border-l-0')} />
      <span className={cn(c, 'bottom-0 left-0 rounded-bl-xl border-t-0 border-r-0')} />
      <span className={cn(c, 'right-0 bottom-0 rounded-br-xl border-t-0 border-l-0')} />
    </div>
  );
}
