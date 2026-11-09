import { Link } from 'react-router';
import { Check, CloudUpload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/common';
import { useAuth } from '@/features/auth/AuthProvider';
import { postAuthNext } from '@/lib/mode';

/** Step 1–3 of guest→account conversion: explain, then Register or Login. */
export function CloudSaveDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { configured } = useAuth();
  const next = '/import';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 grid size-11 place-items-center rounded-xl bg-accent text-primary">
            <CloudUpload className="size-5" aria-hidden="true" />
          </div>
          <DialogTitle>Save your notes to the cloud</DialogTitle>
          <DialogDescription>
            Create a free account (or log in) to keep your notes safe and open them on any device.
          </DialogDescription>
        </DialogHeader>
        <ul className="my-2 space-y-2 text-sm">
          {[
            'Your notes are private — only you can read them.',
            'Access them from your computer, phone or tablet.',
            'After signing in you choose which guest notes to import. Nothing is uploaded without your OK.',
            'Your guest notes stay on this device until the upload is verified.',
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
        {!configured && <Alert>Cloud accounts aren’t configured for this deployment yet.</Alert>}
        <DialogFooter className="gap-2 sm:gap-2">
          {configured ? (
            <>
              <Button variant="outline" asChild>
                <Link
                  to={`/login?next=${encodeURIComponent(next)}`}
                  onClick={() => postAuthNext.set(next)}
                >
                  Log in
                </Link>
              </Button>
              <Button asChild>
                <Link
                  to={`/register?next=${encodeURIComponent(next)}`}
                  onClick={() => postAuthNext.set(next)}
                >
                  Create free account
                </Link>
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>OK</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
