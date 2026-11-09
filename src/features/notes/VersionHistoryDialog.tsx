import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { History, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, Spinner } from '@/components/common';
import { useRepo } from '@/app/RepositoryProvider';
import type { Note } from '@/domain/types';
import { errorMessage, formatDateTime, formatRelative } from '@/lib/format';
import { plainText } from '@/lib/richText';
import { displayTitle } from '@/lib/text';
import { cn } from '@/lib/utils';
import { qk } from './hooks';

export function VersionHistoryDialog({
  open,
  onOpenChange,
  noteId,
  current,
  beforeRestore,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  noteId: string;
  current: { title: string; content: string };
  beforeRestore: () => Promise<void>;
  onRestored: (n: Note) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(640px,90dvh)] max-w-[calc(100%-1.5rem)] flex-col gap-0 p-0 sm:max-w-3xl">
        <HistoryBody
          noteId={noteId}
          current={current}
          beforeRestore={beforeRestore}
          onRestored={onRestored}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function HistoryBody({
  noteId,
  current,
  beforeRestore,
  onRestored,
  onClose,
}: {
  noteId: string;
  current: { title: string; content: string };
  beforeRestore: () => Promise<void>;
  onRestored: (n: Note) => void;
  onClose: () => void;
}) {
  const { repo } = useRepo();
  const qc = useQueryClient();
  const versions = useQuery({
    queryKey: qk.versions(repo.scope, noteId),
    queryFn: () => repo.listVersions(noteId),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = versions.data ?? [];
  const selected = list.find((v) => v.id === selectedId) ?? null;

  const restore = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await beforeRestore();
      const n = await repo.restoreVersion(selected.id);
      void qc.invalidateQueries({ queryKey: qk.versions(repo.scope, noteId) });
      onRestored(n);
      toast.success(
        `Restored version ${selected.versionNo}. Your previous text was saved as a version.`,
      );
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader className="border-b p-5">
        <DialogTitle>Version history</DialogTitle>
        <DialogDescription>
          Checkpoints are saved automatically every 10 minutes of editing and whenever you press
          Save. Restoring keeps your current text as a new version.
        </DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <ul
          className="max-h-48 shrink-0 overflow-y-auto border-b p-2 scrollbar-thin sm:max-h-none sm:w-60 sm:border-r sm:border-b-0"
          aria-label="Versions"
        >
          <li>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className={cn(
                'w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent',
                !selectedId && 'bg-accent text-accent-foreground',
              )}
            >
              <span className="font-medium">Current</span>
              <span className="block text-xs text-muted-foreground">Now editing</span>
            </button>
          </li>
          {versions.isLoading && (
            <li className="p-3 text-center">
              <Spinner />
            </li>
          )}
          {list.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => setSelectedId(v.id)}
                className={cn(
                  'w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent',
                  selectedId === v.id && 'bg-accent text-accent-foreground',
                )}
              >
                <span className="font-medium">Version {v.versionNo}</span>
                <span
                  className="block text-xs text-muted-foreground"
                  title={formatDateTime(v.createdAt)}
                >
                  {formatRelative(v.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex min-h-0 flex-1 flex-col">
          {versions.isError && (
            <div className="p-4">
              <Alert tone="error">{errorMessage(versions.error)}</Alert>
            </div>
          )}
          {!versions.isLoading && !list.length && !versions.isError ? (
            <EmptyState icon={<History />} title="No earlier versions yet" className="flex-1">
              Press Save ({'Ctrl/⌘+S'}) to create a checkpoint, or keep editing — versions are
              created automatically over time.
            </EmptyState>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-thin">
                <h3 className="mb-2 text-lg font-semibold">
                  {displayTitle((selected ?? current).title, (selected ?? current).content)}
                </h3>
                {/* Plain text rendering — never interpreted as HTML. */}
                <pre className="font-sans text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground/90">
                  {plainText((selected ?? current).content) || (
                    <span className="text-muted-foreground italic">Empty</span>
                  )}
                </pre>
              </div>
              <div className="flex items-center justify-end gap-2 border-t p-3">
                {selected && (
                  <span className="mr-auto text-xs text-muted-foreground">
                    {formatDateTime(selected.createdAt)}
                  </span>
                )}
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
                <Button disabled={!selected || busy} onClick={() => void restore()}>
                  {busy ? <Spinner /> : <RotateCcw />} Restore this version
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
