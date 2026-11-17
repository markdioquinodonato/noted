import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  CloudUpload,
  Download,
  Info,
  LogIn,
  LogOut,
  MonitorDown,
  NotebookText,
  RefreshCw,
  Settings,
  ShieldCheck,
  Upload,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
import { useCentralAdminMembership } from '@/features/admin/useCentralAdminMembership';
import { openDownloadDialog } from '@/features/download/DownloadDialog';
import { exportAllNotes } from '@/features/io/exportAll';
import { errorMessage } from '@/lib/format';
import { guestMode } from '@/lib/mode';
import { isDesktopApp } from '@/lib/platform';
import { useAuth } from './AuthProvider';

const sectionLabel = 'px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground';
const menuItem = 'min-h-9 gap-2.5 rounded-md';

/** The profile and account actions used by each signed-in and guest workspace. */
export function AccountMenu({
  onImport,
  onCloudSave,
  inAdministration = false,
}: {
  onImport?: () => void;
  onCloudSave?: () => void;
  inAdministration?: boolean;
}) {
  const { user, signOut } = useAuth();
  const { repo } = useRepo();
  const navigate = useNavigate();
  const hasAdminRole = useCentralAdminMembership(!inAdministration);
  const desktop = isDesktopApp();
  const [info, setInfo] = useState(false);
  const [busy, setBusy] = useState(false);

  const profileName: unknown = user?.user_metadata?.display_name;
  const displayName =
    (typeof profileName === 'string' ? profileName.trim() : '') || user?.email || 'Noted account';

  const exportNotes = async () => {
    setBusy(true);
    try {
      const count = await exportAllNotes(repo);
      if (!count) toast.info('No notes to export yet.');
      else toast.success('Exported ' + count + ' ' + (count === 1 ? 'note' : 'notes'));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const endSession = async () => {
    setBusy(true);
    try {
      await signOut();
      guestMode.clear();
      void navigate('/welcome', { replace: true });
      toast.success('Signed out');
    } catch (error) {
      toast.error(errorMessage(error, 'Could not sign out. Please retry.'));
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
            aria-label="Profile"
            title={
              user ? displayName : 'Guest notes are saved only in this browser on this device.'
            }
            disabled={busy}
            className="grid size-10 shrink-0 place-items-center rounded-full border border-border/75 bg-card transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=open]:bg-accent disabled:opacity-60"
          >
            <span
              aria-hidden="true"
              className="grid size-7 place-items-center overflow-hidden rounded-full bg-accent text-sm font-semibold text-accent-foreground"
            >
              {user ? (
                Array.from(displayName)[0]?.toLocaleUpperCase()
              ) : (
                <UserRound className="size-4" />
              )}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="w-60 max-w-[calc(100vw-1.5rem)] rounded-xl p-1.5"
        >
          <DropdownMenuLabel className="px-2 py-2 font-normal">
            <span className="block truncate text-sm font-semibold">
              {user ? displayName : 'Guest Mode'}
            </span>
            {(!user || displayName !== user.email) && (
              <span className="block truncate text-xs text-muted-foreground">
                {user ? user.email : 'Saved in this browser'}
              </span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup aria-label="Account">
            <DropdownMenuLabel className={sectionLabel}>Account</DropdownMenuLabel>
            {user ? (
              <DropdownMenuItem asChild className={menuItem}>
                <Link to="/settings?section=account">
                  <UserRound /> My Profile
                </Link>
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem asChild className={menuItem}>
                  <Link to="/login?next=%2Fimport">
                    <LogIn /> Sign In
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className={menuItem}>
                  <Link to="/register?next=%2Fimport">
                    <UserPlus /> Create Account
                  </Link>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem asChild className={menuItem}>
              <Link to="/settings">
                <Settings /> Settings
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup aria-label="Application">
            <DropdownMenuLabel className={sectionLabel}>Application</DropdownMenuLabel>
            {desktop ? (
              <DropdownMenuItem
                className={menuItem}
                onSelect={() =>
                  void import('@/desktop/desktop').then((m) => m.checkForUpdates({ silent: false }))
                }
              >
                <RefreshCw /> Check for updates
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem className={menuItem} onSelect={openDownloadDialog}>
                <MonitorDown /> Download Noted
              </DropdownMenuItem>
            )}
            {hasAdminRole && !inAdministration && (
              <DropdownMenuItem asChild className={menuItem}>
                <Link to="/admin">
                  <ShieldCheck /> Admin Dashboard
                </Link>
              </DropdownMenuItem>
            )}
            {inAdministration && (
              <DropdownMenuItem asChild className={menuItem}>
                <Link to="/notes">
                  <NotebookText /> My notes
                </Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup aria-label="Notes and data">
            <DropdownMenuLabel className={sectionLabel}>Notes &amp; data</DropdownMenuLabel>
            {!user && onCloudSave && (
              <DropdownMenuItem className={menuItem} onSelect={onCloudSave}>
                <CloudUpload /> Save my notes to cloud
              </DropdownMenuItem>
            )}
            {onImport ? (
              <DropdownMenuItem className={menuItem} onSelect={onImport}>
                <Upload /> Import Notes
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem asChild className={menuItem}>
                <Link to="/settings?section=storage">
                  <Upload /> Import Notes
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className={menuItem} onSelect={() => void exportNotes()}>
              <Download /> Export Notes
            </DropdownMenuItem>
            {!user && (
              <DropdownMenuItem className={menuItem} onSelect={() => setInfo(true)}>
                <Info /> Guest Data Information
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          {user && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup aria-label="Session">
                <DropdownMenuLabel className={sectionLabel}>Session</DropdownMenuLabel>
                <DropdownMenuItem
                  className={menuItem}
                  variant="destructive"
                  disabled={busy}
                  onSelect={() => void endSession()}
                >
                  <LogOut /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

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
            <Download /> Export Notes
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
