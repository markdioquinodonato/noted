import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Image as ImageIcon } from 'lucide-react';
import { useRepo } from '@/app/RepositoryProvider';
import { Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { attachmentBlob, type Attachment } from '@/data/attachments';
import { downloadBlob } from '@/features/io/txt';
import { errorMessage } from '@/lib/format';

const THUMBNAIL_EDGE = 96;

async function imageThumbnail(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  try {
    const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image thumbnail unavailable.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((thumbnail) => {
      if (thumbnail) resolve(thumbnail);
      else reject(new Error('Image thumbnail unavailable.'));
    }, 'image/png');
  });
}

/** Revoke private file URLs as soon as their image or audio leaves the DOM. */
function useMediaSource(blob?: Blob) {
  return useCallback(
    (element: HTMLImageElement | HTMLAudioElement | null) => {
      if (!element || !blob) return;
      const url = URL.createObjectURL(blob);
      element.src = url;
      return () => {
        element.removeAttribute('src');
        URL.revokeObjectURL(url);
      };
    },
    [blob],
  );
}

export function AttachmentThumbnail({
  file,
  onPreview,
}: {
  file: Attachment;
  onPreview: (file: Attachment, trigger: HTMLButtonElement) => void;
}) {
  const { repo } = useRepo();
  const trigger = useRef<HTMLButtonElement>(null);
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');
  const thumbnail = useQuery({
    queryKey: ['attachment-thumbnail', repo.scope, file.id],
    queryFn: async () => imageThumbnail(await attachmentBlob(repo, file)),
    enabled: inView && typeof createImageBitmap === 'function',
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
  });
  const mediaRef = useMediaSource(thumbnail.data);

  useEffect(() => {
    if (inView || !trigger.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setInView(true);
        observer.disconnect();
      }
    });
    observer.observe(trigger.current);
    return () => observer.disconnect();
  }, [inView]);

  return (
    <Button
      ref={trigger}
      size="icon"
      variant="ghost"
      className="size-11 shrink-0 overflow-hidden rounded-lg bg-muted p-0 text-muted-foreground hover:ring-2 hover:ring-ring/40"
      aria-label={`Preview ${file.name}`}
      title={`View ${file.name}`}
      aria-haspopup="dialog"
      onClick={(event) => onPreview(file, event.currentTarget)}
    >
      {thumbnail.data ? (
        <img
          ref={mediaRef}
          alt=""
          decoding="async"
          width={44}
          height={44}
          className="size-full object-contain"
        />
      ) : (
        <ImageIcon aria-hidden="true" />
      )}
    </Button>
  );
}

export function AttachmentMediaPreview({
  file,
  onCloseAutoFocus,
}: {
  file: Attachment;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { repo } = useRepo();
  const image = file.mime_type.startsWith('image/');
  const media = useQuery({
    queryKey: ['attachment-preview', repo.scope, file.id],
    queryFn: () => attachmentBlob(repo, file),
    gcTime: 0,
    retry: false,
  });
  const mediaRef = useMediaSource(media.data);

  return (
    <DialogContent
      className={`max-h-[90dvh] overflow-y-auto p-4 sm:p-6 ${image ? 'sm:max-w-4xl' : ''}`}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <DialogHeader>
        <DialogTitle className="break-all pr-8">Preview {file.name}</DialogTitle>
        <DialogDescription className="sr-only">
          {image ? 'Image attachment' : 'Audio attachment'}
        </DialogDescription>
      </DialogHeader>
      {media.isPending && <Spinner label="Loading attachment preview" />}
      {media.isError && (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          <span className="text-sm text-destructive">{errorMessage(media.error)}</span>
          <Button size="sm" variant="outline" onClick={() => void media.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {media.data && (
        <>
          {image ? (
            <div className="grid min-h-0 place-items-center rounded-lg bg-muted/55 p-2">
              <img
                ref={mediaRef}
                alt={file.name}
                decoding="async"
                className="block h-auto max-h-[65dvh] w-auto max-w-full object-contain"
              />
            </div>
          ) : (
            <audio ref={mediaRef} controls className="w-full" />
          )}
          <Button
            variant="outline"
            size="sm"
            className="justify-self-end"
            onClick={() => {
              if (media.data) downloadBlob(media.data, file.name);
            }}
          >
            <Download /> Download original
          </Button>
        </>
      )}
    </DialogContent>
  );
}
