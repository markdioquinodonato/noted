import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ChevronsUpDown,
  Cloud,
  CloudUpload,
  Download,
  HardDrive,
  Info,
  LogIn,
  LogOut,
  RefreshCw,
  Settings,
  Upload,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useRepo } from '@/app/RepositoryProvider';
import { exportAllNotes } from '@/features/io/exportAll';
import { errorMessage } from '@/lib/format';
import { guestMode } from '@/lib/mode';
import { cn } from '@/lib/utils';
import { useAuth } from './AuthProvider';
import { isDesktopApp } from '@/lib/platform';

/**
 * The sidebar footer: a single account card. Everything secondary (import,
 * export, settings, sign out) lives in its menu instead of separate buttons.
 */
export function AccountMenu({
  onImport,
  onNavigate,
  onCloudSave,
}: {
  onImport(): void;
  onNavigate?: () => void;
  onCloudSave?: () => void;
}) {
  const { user, signOut } = useAuth(),
    { repo } = useRepo(),
    navigate = useNavigate();
  const [info, setInfo] = useState(false),
    [busy, setBusy] = useState(false);

  const displayName =
    (user?.user_metadata?.display_name as string | undefined)?.trim() || user?.email || '';

  const exportNotes = async () => {
    setBusy(true);
    try {
      const count = await exportAllNotes(repo);
      if (!count) toast.info('No notes to export yet.');
      else toast.success(`Exported ${count} ${count === 1 ? 'note' : 'notes'}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={user ? 'Account menu' : 'Guest account menu'}
            title={user ? undefined : 'Guest notes are saved only in this browser on this device.'}
            disabled={busy}
            className={cn(
              'group flex w-full items-center gap-2.5 rounded-xl border bg-card p-2.5 text-left text-sm transition-colors',
              'hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              'data-[state=open]:bg-accent/60 disabled:opacity-60',
            )}
          >
            {user ? (
              <span
                className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                aria-hidden="true"
              >
                {displayName.slice(0, 1).toUpperCase() || '?'}
              </span>
            ) : (
              <span
                className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
                aria-hidden="true"
              >
                <HardDrive className="size-4" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {user ? displayName : 'Guest Mode'}
              </span>
              <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                {user ? (
                  <>
                    <Cloud className="size-3" aria-hidden="true" /> Cloud account
                  </>
                ) : (
                  'Only in this browser'
                )}
              </span>
            </span>
            <ChevronsUpDown
              className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
              aria-hidden="true"
            />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={6}
          className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56"
        >
          {user ? (
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-sm font-medium">{displayName}</span>
              {displayName !== user.email && (
                <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
              )}
            </DropdownMenuLabel>
          ) : (
            <>
              <DropdownMenuItem asChild>
                <Link to="/login?next=%2Fimport" onClick={onNavigate}>
                  <LogIn />
                  Log In
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/register?next=%2Fimport" onClick={onNavigate}>
                  <UserPlus />
                  Create Account
                </Link>
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onImport}>
            <Upload />
            Import Notes
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void exportNotes()}>
            <Download />
            Export Notes
          </DropdownMenuItem>
          {!user && (
            <DropdownMenuItem onSelect={() => setInfo(true)}>
              <Info />
              Guest Data Information
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/settings" onClick={onNavigate}>
              <Settings />
              Settings
            </Link>
          </DropdownMenuItem>
          {isDesktopApp() && (
            <DropdownMenuItem
              onSelect={() =>
                void import('@/desktop/desktop').then((m) => m.checkForUpdates({ silent: false }))
              }
            >
              <RefreshCw />
              Check for updates
            </DropdownMenuItem>
          )}
          {user && (
            <DropdownMenuItem
              variant="destructive"
              disabled={busy}
              onSelect={async () => {
                setBusy(true);
                try {
                  await signOut();
                  guestMode.choose();
                  navigate('/notes?dashboard=1', { replace: true });
                  toast.success('Signed out. Continuing in Guest Mode.');
                } catch (e) {
                  toast.error(errorMessage(e, 'Could not sign out. Please retry.'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <LogOut />
              Sign out
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {!user && onCloudSave && (
        <Button size="sm" className="h-8 w-full rounded-lg" onClick={onCloudSave}>
          <CloudUpload /> Save my notes to cloud
        </Button>
      )}

      <Dialog open={info} onOpenChange={setInfo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Guest Data Information</DialogTitle>
            <DialogDescription>
              Guest notes, folders, tags and attachments are saved in this browser’s IndexedDB on
              this device.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Your notes survive refreshes and browser restarts while this browser retains its local
            data. Clearing site data, private browsing, or storage eviction can remove them. Guest
            Mode does not provide cloud backups, cross-device sync, account sharing or
            collaboration.
          </p>
          <p className="text-sm text-muted-foreground">
            Export a text backup regularly and download important attachments separately. Signing in
            lets you review guest notes before transferring them. Nothing is automatically uploaded
            or deleted.
          </p>
          <Button disabled={busy} onClick={() => void exportNotes()}>
            <Download />
            Export Notes
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
