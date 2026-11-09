import { useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Spinner } from '@/components/common';
import { errorMessage } from '@/lib/format';

export function NameDialog({
  open,
  onOpenChange,
  title,
  label,
  initial = '',
  submitLabel = 'Save',
  maxLength,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  label: string;
  initial?: string;
  submitLabel?: string;
  maxLength?: number;
  onSubmit: (value: string) => Promise<unknown>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {/* Content unmounts when closed, so form state resets on every open. */}
        <NameForm
          title={title}
          label={label}
          initial={initial}
          submitLabel={submitLabel}
          maxLength={maxLength}
          onSubmit={onSubmit}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function NameForm({
  title,
  label,
  initial,
  submitLabel,
  maxLength,
  onSubmit,
  onDone,
}: {
  title: string;
  label: string;
  initial: string;
  submitLabel: string;
  maxLength?: number;
  onSubmit: (value: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return setError(`${label} cannot be empty.`);
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="sr-only">{label}</DialogDescription>
      </DialogHeader>
      <div className="my-5 space-y-1.5">
        <Label htmlFor="name-dialog-input">{label}</Label>
        <Input
          id="name-dialog-input"
          value={value}
          maxLength={maxLength}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          aria-invalid={!!error}
        />
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown> | void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <ConfirmBody
          title={title}
          description={description}
          confirmLabel={confirmLabel}
          destructive={destructive}
          onConfirm={onConfirm}
          onDone={() => onOpenChange(false)}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmBody({
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
  onDone,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown> | void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div>{description}</div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      {error && <Alert tone="error">{error}</Alert>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
        <AlertDialogAction
          className={destructive ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
          disabled={busy}
          onClick={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onConfirm();
              onDone();
            } catch (err) {
              setError(errorMessage(err));
              setBusy(false);
            }
          }}
        >
          {busy && <Spinner />}
          {confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
