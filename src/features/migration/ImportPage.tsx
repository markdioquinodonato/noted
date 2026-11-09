import { listAttachments } from '@/data/attachments';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, CloudUpload, HardDrive, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, EmptyState, FullPageSpinner, Spinner } from '@/components/common';
import { useRepo } from '@/app/RepositoryProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { ConfirmDialog } from '@/features/notes/dialogs';
import { errorMessage, formatRelative, plural } from '@/lib/format';
import { displayTitle } from '@/lib/text';
import {
  importLedgerKey,
  importRevisionsKey,
  noteSnapshot,
  migrateGuestData,
  MigrationError,
  type ImportLedger,
  type MigrationProgress,
  type MigrationResult,
} from './guestMigration';

const PHASE_LABEL: Record<MigrationProgress['phase'], string> = {
  preparing: 'Preparing…',
  folders: 'Creating folders…',
  tags: 'Creating tags…',
  notes: 'Uploading notes…',
  links: 'Attaching tags…',
  verifying: 'Verifying upload…',
  done: 'Done',
};

export function ImportPage() {
  const { user } = useAuth();
  const { local, cloud } = useRepo();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const guest = useQuery({
    queryKey: ['guest-data', user?.id],
    queryFn: async () => {
      const data = await local.exportAll();
      const ledger = (await local.getMeta<ImportLedger>(importLedgerKey(user!.id))) ?? {};
      const revisions =
        (await local.getMeta<Record<string, string>>(importRevisionsKey(user!.id))) ?? {};
      return { ...data, ledger, revisions };
    },
    enabled: !!user,
  });

  const notes = useMemo(
    () =>
      (guest.data?.notes ?? [])
        .filter((n) => n.title || n.content)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [guest.data],
  );
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const effectiveSelected = useMemo(
    () =>
      selected ??
      new Set(
        notes
          .filter(
            (n) =>
              (!guest.data?.ledger[n.id] || guest.data?.revisions[n.id] !== noteSnapshot(n)) &&
              !n.deletedAt,
          )
          .map((n) => n.id),
      ),
    [selected, notes, guest.data],
  );
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removed, setRemoved] = useState(false);

  if (!user || !cloud) return <FullPageSpinner />;
  if (guest.isLoading) return <FullPageSpinner />;

  const toggle = (id: string) => {
    const n = new Set(effectiveSelected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };

  const run = async () => {
    if (!guest.data) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await migrateGuestData({
        userId: user.id,
        guest: guest.data,
        selectedNoteIds: [...effectiveSelected],
        target: cloud,
        onProgress: setProgress,
      });
      const ledger = { ...(guest.data.ledger ?? {}), ...res.verifiedMap };
      await local.setMeta(importLedgerKey(user.id), ledger);
      await local.setMeta(importRevisionsKey(user.id), {
        ...guest.data.revisions,
        ...Object.fromEntries(
          Object.entries(res.verifiedSnapshots).map(([id, value]) => [
            id,
            noteSnapshot(value.local),
          ]),
        ),
      });
      setResult(res);
      void qc.invalidateQueries();
      if (res.failedVerification.length)
        toast.warning('Some notes could not be verified and were kept on this device.');
      else toast.success('Your notes are now saved in your account.');
    } catch (e) {
      setError(
        e instanceof MigrationError
          ? e.message
          : errorMessage(e, 'The import was interrupted. Nothing was lost — you can try again.'),
      );
    } finally {
      setRunning(false);
    }
  };

  const removeLocal = async () => {
    if (!result) return;
    const ids = Object.keys(result.verifiedMap);
    // Re-verify right before deleting anything local.
    const stored = await cloud.getNotes(Object.values(result.verifiedMap));
    const remote = new Map(stored.map((n) => [n.id, n]));
    const eligible: string[] = [];
    for (const id of ids) {
      const receipt = result.verifiedSnapshots[id],
        now = await local.getNote(id),
        cloudNow = remote.get(result.verifiedMap[id]);
      if (
        receipt &&
        now &&
        cloudNow &&
        noteSnapshot(now) === noteSnapshot(receipt.local) &&
        noteSnapshot(cloudNow) === noteSnapshot(receipt.cloud)
      )
        eligible.push(id);
    }
    if (eligible.length !== ids.length)
      toast.info(
        'Changed or unverified guest notes were kept. Review and transfer them again before clearing local copies.',
      );
    const safe: string[] = [];
    for (const id of eligible) if (!(await listAttachments(local, id)).length) safe.push(id);
    if (safe.length !== eligible.length)
      toast.info(
        'Guest notes with attachments were kept on this device. Download their files before removing them; attachments are not transferred by account import.',
      );
    const removedIds = await local.removeNotes(
      safe,
      Object.fromEntries(safe.map((id) => [id, result.verifiedSnapshots[id].local])),
    );
    // Keep guest folders/tags, including unrelated empty ones. Only selected verified note copies are removed.
    setRemoved(true);
    void qc.invalidateQueries();
    toast.success(`Removed ${plural(removedIds.length, 'local copy', 'local copies')}.`);
  };

  return (
    <div className="min-h-full bg-muted/40">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/notes')}
          aria-label="Back to notes"
        >
          <ArrowLeft />
        </Button>
        <h1 className="text-base font-semibold">Import guest notes</h1>
      </header>
      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:py-10">
        <p className="text-sm text-muted-foreground">
          Would you like to save your guest notes to your account? Review the selection below.
          Existing account note content is never overwritten.
        </p>
        {!notes.length ? (
          <div className="rounded-xl border bg-card">
            <EmptyState
              icon={<HardDrive />}
              title="No guest notes on this device"
              action={
                <Button asChild>
                  <Link to="/notes">Go to my notes</Link>
                </Button>
              }
            >
              Notes written as a guest in this browser would appear here.
            </EmptyState>
          </div>
        ) : result ? (
          <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6" aria-live="polite">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="size-8 text-success" aria-hidden="true" />
              <div>
                <h2 className="text-base font-semibold">Import complete</h2>
                <p className="text-sm text-muted-foreground">
                  {result.verified} of {result.selected} notes verified in your account.
                </p>
              </div>
            </div>
            <dl
              className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3"
              data-testid="import-summary"
            >
              <Stat label="Imported" value={result.imported} />
              <Stat label="Already in account" value={result.alreadyInAccount} />
              <Stat label="Verified" value={result.verified} />
              <Stat label="Folders created" value={result.foldersCreated} />
              <Stat label="Folders merged" value={result.foldersMerged} />
              <Stat
                label="Tags created / merged"
                value={`${result.tagsCreated} / ${result.tagsMerged}`}
              />
            </dl>
            {result.failedVerification.length > 0 && (
              <Alert tone="error">
                {plural(result.failedVerification.length, 'note')} could not be verified and remain
                only on this device. Try importing again.
              </Alert>
            )}
            {!removed ? (
              <div className="rounded-lg border bg-muted/50 p-4 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="size-4 text-success" aria-hidden="true" /> Your guest
                  copies are still on this device.
                </p>
                <p className="mt-1 text-muted-foreground">
                  Attachments remain on this device. Guest notes with attachments are kept. You can
                  keep all copies, or remove the{' '}
                  {plural(result.verified, 'local copy', 'local copies')} that were verified in your
                  account.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild>
                    <Link to="/notes">Open my notes</Link>
                  </Button>
                  {result.verified > 0 && (
                    <Button variant="outline" onClick={() => setConfirmRemove(true)}>
                      <Trash2 /> Remove local copies
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <Button asChild>
                <Link to="/notes">Open my notes</Link>
              </Button>
            )}
          </section>
        ) : (
          <>
            <section className="rounded-xl border bg-card p-5 sm:p-6">
              <div className="flex gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                  <CloudUpload className="size-5" aria-hidden="true" />
                </div>
                <div className="text-sm">
                  <h2 className="text-base font-semibold">Copy guest notes into {user.email}</h2>
                  <p className="mt-1 text-muted-foreground">
                    Selected notes are uploaded with their folders and tags. Existing notes in your
                    account are never overwritten — folders and tags with the same name are merged.
                    Your guest copies stay on this device until the upload is verified.
                  </p>
                </div>
              </div>
            </section>

            {error && <Alert tone="error">{error}</Alert>}

            <section className="rounded-xl border bg-card" aria-label="Guest notes">
              <div className="flex items-center gap-3 border-b px-4 py-3 text-sm">
                <Checkbox
                  aria-label="Select all guest notes"
                  checked={
                    effectiveSelected.size === notes.length
                      ? true
                      : effectiveSelected.size
                        ? 'indeterminate'
                        : false
                  }
                  onCheckedChange={(c) => setSelected(new Set(c ? notes.map((n) => n.id) : []))}
                  disabled={running}
                />
                <span className="flex-1 font-medium">{plural(notes.length, 'guest note')}</span>
                <span className="text-muted-foreground">{effectiveSelected.size} selected</span>
              </div>
              <ul className="max-h-[50vh] divide-y overflow-y-auto scrollbar-thin">
                {notes.map((n) => (
                  <li key={n.id} className="flex items-start gap-3 px-4 py-2.5">
                    <Checkbox
                      id={`g-${n.id}`}
                      checked={effectiveSelected.has(n.id)}
                      onCheckedChange={() => toggle(n.id)}
                      disabled={running}
                      className="mt-0.5"
                    />
                    <label htmlFor={`g-${n.id}`} className="min-w-0 flex-1 cursor-pointer text-sm">
                      <span className="block truncate font-medium">
                        {displayTitle(n.title, n.content)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Edited {formatRelative(n.updatedAt)}
                      </span>
                    </label>
                    {guest.data?.ledger[n.id] && <Badge variant="secondary">Imported</Badge>}
                    {n.deletedAt && <Badge variant="outline">Trash</Badge>}
                    {!n.deletedAt && n.isArchived && <Badge variant="outline">Archived</Badge>}
                  </li>
                ))}
              </ul>
            </section>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              {running && progress && (
                <p
                  className="mr-auto text-sm text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  {PHASE_LABEL[progress.phase]}{' '}
                  {progress.total > 0 && `${progress.done}/${progress.total}`}
                </p>
              )}
              <Button variant="ghost" asChild>
                <Link to="/notes">Not now</Link>
              </Button>
              <Button onClick={() => void run()} disabled={running || effectiveSelected.size === 0}>
                {running ? <Spinner /> : <CloudUpload />}
                {error ? 'Resume import' : `Import ${plural(effectiveSelected.size, 'note')}`}
              </Button>
            </div>
          </>
        )}
      </main>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove local guest copies?"
        description={
          <>
            {plural(result?.verified ?? 0, 'note')} {result?.verified === 1 ? 'is' : 'are'} safely
            stored in your account and will be removed from this browser’s guest storage. Notes that
            were not verified are kept.
          </>
        }
        confirmLabel="Remove local copies"
        destructive
        onConfirm={removeLocal}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-muted/60 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
