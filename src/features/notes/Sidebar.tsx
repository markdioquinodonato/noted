import { useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import {
  Archive,
  Star,
  Bell,
  Users,
  LayoutDashboard,
  Palette,
  Home,
  GraduationCap,
  Briefcase,
  Book,
  Heart,
  Clock,
  Folder as FolderIcon,
  FolderOpen,
  Hash,
  Inbox,
  MoreHorizontal,
  NotebookText,
  Pencil,
  Pin,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { NOTE_COLORS } from '@/lib/richText';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BrandLockup } from '@/components/BrandLogo';
import { AccountMenu } from '@/features/auth/AccountMenu';
import { Kbd } from '@/components/common';
import { useRepo } from '@/app/RepositoryProvider';
import type { NoteView } from '@/domain/types';
import { LIMITS } from '@/domain/types';
import { errorMessage, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { readDocuments } from '@/features/io/documents';
import {
  useCounts,
  useFolderMutations,
  useFolders,
  useRefreshLists,
  useTagMutations,
  useTags,
  type ListFilters,
} from './hooks';
import { ConfirmDialog, NameDialog } from './dialogs';
import { CloudSaveDialog } from './CloudSaveDialog';
import { openDownloadDialog } from '@/features/download/DownloadDialog';
import { isDesktopApp } from '@/lib/platform';
import { MonitorDown } from 'lucide-react';

const VIEWS: { view: NoteView; label: string; icon: ReactNode }[] = [
  { view: 'all', label: 'All Notes', icon: <NotebookText /> },
  { view: 'favorites', label: 'Favorites', icon: <Star /> },
  { view: 'reminders', label: 'Reminders', icon: <Bell /> },
  { view: 'shared', label: 'Shared Notes', icon: <Users /> },
  { view: 'recent', label: 'Recent', icon: <Clock /> },
  { view: 'pinned', label: 'Pinned', icon: <Pin /> },
  { view: 'archive', label: 'Archive', icon: <Archive /> },
  { view: 'trash', label: 'Trash', icon: <Trash2 /> },
];

function NavItem({
  active,
  icon,
  label,
  count,
  onClick,
  menu,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
  menu?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'group relative flex items-center rounded-lg transition-colors',
        active
          ? 'bg-primary/10 font-medium text-primary [&_svg]:opacity-100!'
          : 'text-sidebar-foreground/85 hover:bg-foreground/[0.05] hover:text-sidebar-foreground',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:opacity-75',
          // Touch screens always show the menu button, so reserve room for it.
          menu && '[@media(hover:none)]:pr-9',
        )}
      >
        {icon}
        <span className="flex-1 truncate">{label}</span>
        {count !== undefined && count > 0 && (
          <span
            className={cn(
              'min-w-5 rounded-full bg-foreground/[0.06] px-1.5 text-center text-[0.7rem] leading-5 font-medium tabular-nums text-muted-foreground',
              menu &&
                '[@media(hover:hover)]:group-focus-within:invisible [@media(hover:hover)]:group-hover:invisible',
            )}
          >
            {count}
          </span>
        )}
      </button>
      {menu && (
        <div className="absolute right-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          {menu}
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  title,
  onAdd,
  addLabel,
}: {
  title: string;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <div className="mt-5 mb-1 flex items-center justify-between pr-1 pl-2.5">
      <h2 className="text-[0.7rem] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h2>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={onAdd} aria-label={addLabel}>
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{addLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function ItemMenu({
  label,
  onRename,
  onDelete,
  onAppearance,
}: {
  label: string;
  onRename: () => void;
  onDelete: () => void;
  onAppearance?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`${label} options`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onRename}>
          <Pencil /> Rename
        </DropdownMenuItem>
        {onAppearance && (
          <DropdownMenuItem onSelect={onAppearance}>
            <Palette /> Color & icon
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type SidebarDialog =
  | { kind: 'folder-appearance'; id: string }
  | { kind: 'new-folder' }
  | { kind: 'rename-folder'; id: string; name: string }
  | { kind: 'delete-folder'; id: string; name: string }
  | { kind: 'new-tag' }
  | { kind: 'rename-tag'; id: string; name: string }
  | { kind: 'delete-tag'; id: string; name: string }
  | { kind: 'cloud-save' };

export interface SidebarActions {
  open: (d: SidebarDialog) => void;
  importTxt: () => void;
}

/**
 * Owns the sidebar's dialogs and the hidden file input. Rendered by the
 * workspace OUTSIDE the mobile drawer, so closing the drawer never unmounts an
 * open dialog (which would leave the page inert).
 */
export function useSidebarHost({
  filters,
  select,
}: {
  filters: ListFilters;
  select: (f: Partial<ListFilters>) => void;
}): { actions: SidebarActions; elements: ReactNode } {
  const { repo } = useRepo();
  const qc = useQueryClient();
  const location = useLocation();
  const folderM = useFolderMutations();
  const tagM = useTagMutations();
  const refresh = useRefreshLists();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<SidebarDialog | null>(null);
  const close = (o: boolean) => !o && setDialog(null);
  const target = dialog as { id: string; name: string } | null;

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const { ok, errors } = await readDocuments(Array.from(files));
      let created = 0;
      for (const f of ok) {
        await repo.createNote({
          title: f.title,
          content: f.content,
          folderId: filters.folderId ?? null,
        });
        created++;
      }
      await refresh();
      if (created) {
        if (new URLSearchParams(location.search).get('dashboard') === '1') select({ view: 'all' });
        toast.success(`Imported ${plural(created, 'note')}`);
      }
      errors.slice(0, 3).forEach((e) => toast.error(e));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const elements = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.markdown,.pdf,.docx"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void importFiles(e.target.files)}
        data-testid="import-txt-input"
      />
      {dialog?.kind === 'folder-appearance' && (
        <FolderAppearance
          folderId={dialog.id}
          onClose={() => setDialog(null)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['folders', repo.scope] });
          }}
        />
      )}
      <NameDialog
        open={dialog?.kind === 'new-folder'}
        onOpenChange={close}
        title="New folder"
        label="Folder name"
        submitLabel="Create"
        maxLength={LIMITS.folderNameMax}
        onSubmit={(name) =>
          folderM.create.mutateAsync(name).then((f) => select({ folderId: f.id }))
        }
      />
      <NameDialog
        open={dialog?.kind === 'rename-folder'}
        onOpenChange={close}
        title="Rename folder"
        label="Folder name"
        initial={dialog?.kind === 'rename-folder' ? dialog.name : ''}
        maxLength={LIMITS.folderNameMax}
        onSubmit={(name) => folderM.rename.mutateAsync({ id: target!.id, name })}
      />
      <ConfirmDialog
        open={dialog?.kind === 'delete-folder'}
        onOpenChange={close}
        title={`Delete folder “${dialog?.kind === 'delete-folder' ? dialog.name : ''}”?`}
        description="The notes inside will not be deleted — they’ll move to Uncategorized."
        confirmLabel="Delete folder"
        destructive
        onConfirm={async () => {
          const id = target!.id;
          await folderM.remove.mutateAsync(id);
          if (filters.folderId === id) select({ view: 'all' });
          toast.success('Folder deleted. Its notes are now uncategorized.');
        }}
      />
      <NameDialog
        open={dialog?.kind === 'new-tag'}
        onOpenChange={close}
        title="New tag"
        label="Tag name"
        submitLabel="Create"
        maxLength={LIMITS.tagNameMax}
        onSubmit={(name) => tagM.create.mutateAsync(name)}
      />
      <NameDialog
        open={dialog?.kind === 'rename-tag'}
        onOpenChange={close}
        title="Rename tag"
        label="Tag name"
        initial={dialog?.kind === 'rename-tag' ? dialog.name : ''}
        maxLength={LIMITS.tagNameMax}
        onSubmit={(name) => tagM.rename.mutateAsync({ id: target!.id, name })}
      />
      <ConfirmDialog
        open={dialog?.kind === 'delete-tag'}
        onOpenChange={close}
        title={`Delete tag “${dialog?.kind === 'delete-tag' ? dialog.name : ''}”?`}
        description="The tag will be removed from all notes. The notes themselves are not affected."
        confirmLabel="Delete tag"
        destructive
        onConfirm={async () => {
          const id = target!.id;
          await tagM.remove.mutateAsync(id);
          if (filters.tagId === id) select({ view: 'all' });
        }}
      />
      <CloudSaveDialog open={dialog?.kind === 'cloud-save'} onOpenChange={close} />
    </>
  );

  return { actions: { open: setDialog, importTxt: () => fileRef.current?.click() }, elements };
}

export function Sidebar({
  filters,
  actions,
  onSelect,
  onNewNote,
  onNavigate,
}: {
  filters: ListFilters;
  actions: SidebarActions;
  onSelect: (f: Partial<ListFilters>) => void;
  onNewNote: () => void;
  onNavigate?: () => void;
}) {
  const counts = useCounts();
  const folders = useFolders();
  const tags = useTags();

  const c = counts.data;
  const location = useLocation();
  const onDashboard =
    location.pathname === '/notes' && new URLSearchParams(location.search).get('dashboard') === '1';
  const isView = (v: NoteView) =>
    !onDashboard &&
    filters.view === v &&
    !filters.folderId &&
    !filters.tagId &&
    !filters.uncategorized;
  const select = (f: Partial<ListFilters>) => {
    onSelect({ folderId: null, tagId: null, uncategorized: false, view: 'all', ...f });
    onNavigate?.();
  };
  // Dialogs opened from the mobile drawer close the drawer first.
  const openDialog = (d: SidebarDialog) => {
    onNavigate?.();
    actions.open(d);
  };

  return (
    <nav
      className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground"
      aria-label="Notes navigation"
    >
      <div className="flex h-16 shrink-0 items-center px-4">
        <Link
          to="/welcome"
          aria-label="Noted home"
          className="rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <BrandLockup size={28} />
        </Link>
      </div>
      <div className="px-3 pb-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="h-10 w-full justify-start rounded-xl shadow-md shadow-primary/25"
              onClick={onNewNote}
            >
              <Plus /> New note
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            New note <Kbd>Alt</Kbd>+<Kbd>N</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 scrollbar-thin">
        <div className="space-y-0.5">
          <Link
            to="/notes?dashboard=1"
            onClick={onNavigate}
            aria-current={onDashboard ? 'page' : undefined}
            className={cn(
              'flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-4 [&_svg]:shrink-0',
              onDashboard
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-sidebar-foreground/85 hover:bg-foreground/[0.05] [&_svg]:opacity-75',
            )}
          >
            <LayoutDashboard />
            Dashboard
          </Link>
          {VIEWS.map((v) => (
            <NavItem
              key={v.view}
              active={isView(v.view)}
              icon={v.icon}
              label={v.label}
              count={c?.[v.view]}
              onClick={() => select({ view: v.view })}
            />
          ))}
        </div>

        <SectionHeader
          title="Folders"
          onAdd={() => openDialog({ kind: 'new-folder' })}
          addLabel="New folder"
        />
        <div className="space-y-0.5">
          <NavItem
            active={filters.uncategorized}
            icon={<Inbox />}
            label="Uncategorized"
            count={c?.uncategorized}
            onClick={() => select({ uncategorized: true })}
          />
          {folders.data?.map((f) => (
            <NavItem
              key={f.id}
              active={filters.folderId === f.id}
              icon={
                <span
                  style={{
                    color: f.color && f.color !== 'default' ? `var(--note-${f.color})` : undefined,
                  }}
                >
                  {(
                    {
                      home: <Home />,
                      school: <GraduationCap />,
                      briefcase: <Briefcase />,
                      book: <Book />,
                      heart: <Heart />,
                    } as Record<string, ReactNode>
                  )[f.icon ?? ''] ?? (filters.folderId === f.id ? <FolderOpen /> : <FolderIcon />)}
                </span>
              }
              label={f.name}
              count={c?.folders[f.id]}
              onClick={() => select({ folderId: f.id })}
              menu={
                <ItemMenu
                  label={`Folder ${f.name}`}
                  onAppearance={() => openDialog({ kind: 'folder-appearance', id: f.id })}
                  onRename={() => openDialog({ kind: 'rename-folder', id: f.id, name: f.name })}
                  onDelete={() => openDialog({ kind: 'delete-folder', id: f.id, name: f.name })}
                />
              }
            />
          ))}
        </div>

        <SectionHeader
          title="Tags"
          onAdd={() => openDialog({ kind: 'new-tag' })}
          addLabel="New tag"
        />
        <div className="space-y-0.5">
          {tags.data?.map((t) => (
            <NavItem
              key={t.id}
              active={filters.tagId === t.id}
              icon={<Hash />}
              label={t.name}
              count={c?.tags[t.id]}
              onClick={() => select({ tagId: t.id })}
              menu={
                <ItemMenu
                  label={`Tag ${t.name}`}
                  onRename={() => openDialog({ kind: 'rename-tag', id: t.id, name: t.name })}
                  onDelete={() => openDialog({ kind: 'delete-tag', id: t.id, name: t.name })}
                />
              }
            />
          ))}
          {tags.data && !tags.data.length && (
            <p className="px-2.5 py-1 text-xs text-muted-foreground">No tags yet</p>
          )}
        </div>
      </div>

      <div className="shrink-0 space-y-1.5 border-t border-foreground/[0.06] p-2.5">
        {!isDesktopApp() && (
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              openDownloadDialog();
            }}
            className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-xs font-medium text-sidebar-foreground/75 transition-colors hover:bg-foreground/[0.05] hover:text-sidebar-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <MonitorDown className="size-3.5" aria-hidden="true" /> Download Noted
          </button>
        )}
        <AccountMenu
          onImport={actions.importTxt}
          onNavigate={onNavigate}
          onCloudSave={() => openDialog({ kind: 'cloud-save' })}
        />
      </div>
    </nav>
  );
}

function FolderAppearance({
  folderId,
  onClose,
  onSaved,
}: {
  folderId: string;
  onClose(): void;
  onSaved(): void;
}) {
  const { repo } = useRepo();
  const folders = useFolders();
  const folder = folders.data?.find((f) => f.id === folderId);
  const [color, setColor] = useState(folder?.color ?? 'default'),
    [icon, setIcon] = useState(folder?.icon ?? 'folder'),
    [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Folder color & icon</DialogTitle>
          <DialogDescription>Customize {folder?.name ?? 'this folder'}.</DialogDescription>
        </DialogHeader>
        <label className="text-sm">
          Color{' '}
          <select
            aria-label="Folder color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="rounded border bg-background p-2"
          >
            {NOTE_COLORS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Icon{' '}
          <select
            aria-label="Folder icon"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            className="rounded border bg-background p-2"
          >
            {['folder', 'home', 'school', 'briefcase', 'book', 'heart'].map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await repo.setFolderAppearance(folderId, color, icon);
              onSaved();
              onClose();
            } catch (e) {
              toast.error(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Save appearance
        </Button>
      </DialogContent>
    </Dialog>
  );
}
