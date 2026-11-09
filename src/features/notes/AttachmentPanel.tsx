import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Camera,
  CameraOff,
  ClipboardPaste,
  Download,
  File as FileIcon,
  FileAudio,
  FileText,
  ImageIcon,
  Loader2,
  Mic,
  Play,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useRepo } from '@/app/RepositoryProvider';
import {
  attachmentBlob,
  deleteAttachment,
  FILE_TYPES,
  listAttachments,
  uploadAttachment,
  type Attachment,
} from '@/data/attachments';
import { downloadBlob } from '@/features/io/txt';
import { errorMessage } from '@/lib/format';
import { cn } from '@/lib/utils';

const ACCEPT = Object.values(FILE_TYPES)
  .flat()
  .map((e) => `.${e}`)
  .join(',');

/** Local date-time for generated file names, e.g. 2026-11-09-00-55-06. */
const stamp = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, '-');
};

function sizeLabel(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.ceil(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function TypeIcon({ mime }: { mime: string }) {
  if (mime.startsWith('image/')) return <ImageIcon />;
  if (mime.startsWith('audio/')) return <FileAudio />;
  if (mime === 'application/pdf' || mime.startsWith('text/') || mime.includes('word'))
    return <FileText />;
  return <FileIcon />;
}

/** One of the "how do you want to add a file?" choices. */
function Option({
  icon,
  title,
  hint,
  tone,
  onClick,
  disabled,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  tone: string;
  onClick?: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const body = (
    <>
      <span
        className={cn(
          'grid size-10 place-items-center rounded-xl transition-transform group-hover:scale-105 [&_svg]:size-5',
          tone,
        )}
      >
        {icon}
      </span>
      <span className="mt-2.5 block text-sm font-semibold text-foreground">{title}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
    </>
  );
  const cls =
    'group flex flex-col items-center rounded-2xl border bg-card px-3 py-4 text-center transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-within:ring-[3px] focus-within:ring-ring/50 has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50';
  if (children)
    return (
      <label className={cn(cls, 'cursor-pointer')}>
        {children}
        {body}
      </label>
    );
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(cls, 'outline-none disabled:opacity-50')}
    >
      {body}
    </button>
  );
}

export function AttachmentPanel({
  noteId,
  onRecordVoice,
}: {
  noteId: string;
  onRecordVoice(): void;
}) {
  const { repo } = useRepo();
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ url: string; file: Attachment } | null>(null);
  const files = useQuery({
    queryKey: ['attachments', repo.scope, noteId],
    queryFn: () => listAttachments(repo, noteId),
  });
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  const upload = useCallback(
    async (selected: File[]) => {
      if (!selected.length) return;
      setBusy(true);
      try {
        for (const file of selected.slice(0, 10)) await uploadAttachment(repo, noteId, file);
        toast.success(selected.length === 1 ? 'File attached' : 'Files attached', {
          id: 'files-attached',
        });
      } catch (e) {
        toast.error(errorMessage(e));
      } finally {
        setBusy(false);
        void files.refetch();
      }
    },
    [repo, noteId, files],
  );

  // Ctrl/⌘+V anywhere while the panel is open attaches copied files or images.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (!pasted.length) return;
      e.preventDefault();
      void upload(
        pasted.map((f) =>
          f.name && f.name !== 'image.png'
            ? f
            : new File([f], `Pasted-${stamp()}.${FILE_TYPES[f.type]?.[0] ?? 'png'}`, {
                type: f.type,
              }),
        ),
      );
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [upload]);

  const pasteFromClipboard = async () => {
    try {
      if (!navigator.clipboard?.read) throw new Error('unsupported');
      const items = await navigator.clipboard.read();
      const found: File[] = [];
      for (const item of items) {
        const type = item.types.find((t) => FILE_TYPES[t]);
        if (!type) continue;
        const blob = await item.getType(type);
        found.push(new File([blob], `Pasted-${stamp()}.${FILE_TYPES[type][0]}`, { type }));
      }
      if (!found.length) toast.info('Nothing to paste. Copy an image or file first.');
      else await upload(found);
    } catch {
      toast.info(`Press ${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+V to paste here.`);
    }
  };

  const list = files.data ?? [];

  return (
    <div
      className="space-y-5"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void upload(Array.from(e.dataTransfer.files));
      }}
    >
      {camera ? (
        <CameraCapture
          disabled={busy}
          onCancel={() => setCamera(false)}
          onCapture={async (file) => {
            await upload([file]);
            setCamera(false);
          }}
        />
      ) : (
        <div
          className={cn(
            'relative rounded-2xl border-2 border-dashed p-3 transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-transparent',
          )}
        >
          <p className="mb-3 text-sm font-medium">How do you want to add a file?</p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Option
              icon={<Camera />}
              title="Take a photo"
              hint="Use your camera"
              tone="bg-sky-500/12 text-sky-600 dark:text-sky-400"
              disabled={busy}
              onClick={() => setCamera(true)}
            />
            <Option
              icon={<Upload />}
              title="Choose files"
              hint="From this device"
              tone="bg-primary/12 text-primary"
            >
              <input
                type="file"
                aria-label="Attach files"
                multiple
                accept={ACCEPT}
                disabled={busy}
                className="sr-only"
                onChange={(e) => {
                  void upload(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </Option>
            <Option
              icon={<Mic />}
              title="Record audio"
              hint="Voice memo"
              tone="bg-rose-500/12 text-rose-600 dark:text-rose-400"
              disabled={busy}
              onClick={onRecordVoice}
            />
            <Option
              icon={<ClipboardPaste />}
              title="Paste"
              hint="From clipboard"
              tone="bg-violet-500/12 text-violet-600 dark:text-violet-400"
              disabled={busy}
              onClick={() => void pasteFromClipboard()}
            />
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {dragging ? (
              <span className="font-medium text-primary">Drop to attach</span>
            ) : (
              <>or drag &amp; drop files here</>
            )}
          </p>
          {busy && (
            <div className="absolute inset-0 grid place-items-center rounded-2xl bg-background/70 backdrop-blur-[1px]">
              <span role="status" className="inline-flex items-center gap-2 text-sm font-medium">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Attaching…
              </span>
            </div>
          )}
        </div>
      )}

      <p className="rounded-xl bg-muted/70 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        Images, PDF, TXT, Markdown, DOCX and audio · up to 10 MB each.{' '}
        {repo.kind === 'local'
          ? 'Files stay in this browser. Guest account import does not transfer attachments; download them before removing local copies.'
          : 'Files are stored privately. Attachments are accessible to the owner only.'}
      </p>

      {files.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(files.error)}{' '}
          <button className="underline" onClick={() => void files.refetch()}>
            Retry
          </button>
        </p>
      )}

      <section aria-label="Attached files">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          Attached
          {list.length > 0 && (
            <span className="rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground tabular-nums">
              {list.length}
            </span>
          )}
        </h3>
        {!files.isLoading && !list.length && (
          <p className="rounded-xl border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
            No attachments yet.
          </p>
        )}
        <ul className="space-y-1.5">
          {list.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-3 rounded-xl border bg-card p-2 pr-1.5 transition-colors hover:bg-muted/40"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
                <TypeIcon mime={file.mime_type} />
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="block truncate font-medium">{file.name}</span>
                <span className="block text-xs text-muted-foreground">{sizeLabel(file.size)}</span>
              </span>
              {(file.mime_type.startsWith('image/') || file.mime_type.startsWith('audio/')) && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Preview ${file.name}`}
                  onClick={async () => {
                    try {
                      setPreview({
                        file,
                        url: URL.createObjectURL(await attachmentBlob(repo, file)),
                      });
                    } catch (e) {
                      toast.error(errorMessage(e));
                    }
                  }}
                >
                  <Play />
                </Button>
              )}
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Download ${file.name}`}
                onClick={async () => {
                  try {
                    downloadBlob(await attachmentBlob(repo, file), file.name);
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                <Download />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="hover:text-destructive"
                disabled={busy}
                aria-label={`Delete attachment ${file.name}`}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await deleteAttachment(repo, file);
                    setPreview(null);
                    await files.refetch();
                  } catch (e) {
                    toast.error(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {preview && (
        <div className="relative rounded-xl border bg-muted/40 p-2">
          <Button
            size="icon-xs"
            variant="ghost"
            className="absolute top-1.5 right-1.5 z-10 bg-background/80"
            aria-label="Close preview"
            onClick={() => setPreview(null)}
          >
            <X />
          </Button>
          {preview.file.mime_type.startsWith('image/') ? (
            <img
              src={preview.url}
              alt={preview.file.name}
              className="mx-auto max-h-64 rounded-lg object-contain"
            />
          ) : (
            <audio src={preview.url} controls className="w-full" />
          )}
        </div>
      )}
    </div>
  );
}

/** In-app camera: live preview → shutter → review → attach as a JPEG. */
function CameraCapture({
  disabled,
  onCapture,
  onCancel,
}: {
  disabled: boolean;
  onCapture(file: File): Promise<void>;
  onCancel(): void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);

  const open = useCallback(async () => {
    try {
      const media = await Promise.resolve().then(() =>
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
          audio: false,
        }),
      );
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play().catch(() => undefined);
      }
      setReady(true);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // open() only updates state after the async camera permission resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void open();
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, [open]);

  useEffect(
    () => () => {
      if (shot) URL.revokeObjectURL(shot.url);
    },
    [shot],
  );

  const snap = () => {
    const el = video.current;
    if (!el?.videoWidth) return;
    const scale = Math.min(1, 2400 / Math.max(el.videoWidth, el.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(el.videoWidth * scale);
    canvas.height = Math.round(el.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(el, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => blob && setShot({ blob, url: URL.createObjectURL(blob) }),
      'image/jpeg',
      0.9,
    );
  };

  const retake = () => {
    setShot(null);
    void video.current?.play().catch(() => undefined);
  };

  if (failed)
    return (
      <div className="rounded-2xl border bg-muted/40 p-6 text-center">
        <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <CameraOff className="size-6" aria-hidden="true" />
        </span>
        <p className="text-sm font-medium">Camera unavailable</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Allow camera access, or use your device’s camera app instead.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Back
          </Button>
          <label className="inline-flex">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              capture="environment"
              className="peer sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onCapture(f);
                e.target.value = '';
              }}
            />
            <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50">
              <Camera className="size-4" aria-hidden="true" /> Open camera app
            </span>
          </label>
        </div>
      </div>
    );

  return (
    <div className="overflow-hidden rounded-2xl border bg-black">
      <div className="relative aspect-[4/3] w-full">
        <video
          ref={video}
          muted
          playsInline
          aria-label="Camera preview"
          className={cn('absolute inset-0 size-full object-cover', shot && 'invisible')}
        />
        {shot && (
          <img
            src={shot.url}
            alt="Captured photo"
            className="absolute inset-0 size-full object-contain"
          />
        )}
        {!ready && !shot && (
          <div className="absolute inset-0 grid place-items-center text-sm text-white/80">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Starting camera…
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 bg-background p-3">
        <Button variant="ghost" onClick={onCancel} disabled={disabled}>
          Cancel
        </Button>
        {shot ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={retake} disabled={disabled}>
              <RotateCcw /> Retake
            </Button>
            <Button
              disabled={disabled}
              onClick={() =>
                void onCapture(
                  new File([shot.blob], `Photo-${stamp()}.jpg`, { type: 'image/jpeg' }),
                )
              }
            >
              {disabled ? <Loader2 className="animate-spin" /> : <Upload />} Attach photo
            </Button>
          </div>
        ) : (
          <button
            type="button"
            aria-label="Take photo"
            disabled={!ready}
            onClick={snap}
            className="rounded-full border-4 border-primary/25 p-0.5 transition-transform outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95 disabled:opacity-40"
          >
            <span className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground">
              <Camera className="size-5" aria-hidden="true" />
            </span>
          </button>
        )}
        {!shot && <span className="w-[4.5rem]" aria-hidden="true" />}
      </div>
    </div>
  );
}
