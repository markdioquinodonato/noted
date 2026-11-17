import { useId, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import {
  Archive,
  Bell,
  ChevronDown,
  Users,
  Palette,
  Home,
  GraduationCap,
  Briefcase,
  Book,
  Heart,
  Folder as FolderIcon,
  FolderOpen,
  Hash,
  Inbox,
  MoreHorizontal,
  NotebookText,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { BrandLockup, BrandMark } from '@/components/BrandLogo';
import { useRepo } from '@/app/RepositoryProvider';
import type { NoteView } from '@/domain/types';
import { LIMITS } from '@/domain/types';
import { errorMessage } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDocumentImport } from '@/features/io/useDocumentImport';
import {
  useCounts,
  useFolderMutations,
  useFolders,
  useTagMutations,
  useTags,
  type ListFilters,
} from './hooks';
import { ConfirmDialog, NameDialog } from './dialogs';
import { CloudSaveDialog } from './CloudSaveDialog';
import './sidebar.css';

const VIEWS: { view: NoteView; label: string; icon: ReactNode }[] = [
  { view: 'all', label: 'Notes', icon: <NotebookText /> },
  { view: 'reminders', label: 'Reminders', icon: <Bell /> },
  { view: 'shared', label: 'Shared', icon: <Users /> },
  { view: 'archive', label: 'Archive', icon: <Archive /> },
  { view: 'trash', label: 'Trash', icon: <Trash2 /> },
];
const LIBRARY_SUBVIEWS: NoteView[] = ['favorites', 'recent', 'pinned'];

const iconClassName =
  'grid size-10 shrink-0 place-items-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:size-4';

function NavItem({
  active,
  icon,
  label,
  count,
  onClick,
  menu,
  collapsed = false,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
  menu?: ReactNode;
  collapsed?: boolean;
}) {
  if (collapsed) {
    return (
      <div className="noted-nav-item" data-active={active}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onClick}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className={iconClassName}
            >
              {icon}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            {label}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }
  return (
    <div className="noted-nav-item group relative flex items-center" data-active={active}>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'noted-nav-button flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:opacity-75',
          // Touch screens always show the menu button, so reserve room for it.
          menu && '[@media(hover:none)]:pr-9',
        )}
      >
        {icon}
        <span className="flex-1 truncate">{label}</span>
        {count !== undefined && count > 0 && (
          <span
            aria-hidden="true"
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

function OrganizationGroup({
  title,
  activeKey,
  onAdd,
  addLabel,
  children,
  collapsed,
  icon,
}: {
  title: string;
  activeKey: string | null;
  onAdd: () => void;
  addLabel: string;
  children: (onSelected?: () => void) => ReactNode;
  collapsed: boolean;
  icon: ReactNode;
}) {
  const id = useId();
  const [expansion, setExpansion] = useState({ open: Boolean(activeKey), activeKey });
  const [showCollection, setShowCollection] = useState(false);
  // A folder or tag opened through a link is discoverable in the sidebar, even
  // before the user has opened the disclosure themselves.
  const open = expansion.open || (activeKey !== null && activeKey !== expansion.activeKey);
  const addButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={onAdd} aria-label={addLabel}>
          <Plus />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{addLabel}</TooltipContent>
    </Tooltip>
  );

  if (collapsed) {
    return (
      <Popover open={showCollection} onOpenChange={setShowCollection}>
        <div className="noted-nav-item" data-active={!!activeKey}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button type="button" className={iconClassName} aria-label={title}>
                  {icon}
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={10}>
              {title}
            </TooltipContent>
          </Tooltip>
        </div>
        <PopoverContent
          aria-label={title}
          side="right"
          align="start"
          sideOffset={12}
          className="noted-sidebar noted-sidebar-collection w-56 overflow-auto rounded-xl p-2"
        >
          <div className="mb-1 flex items-center justify-between px-2">
            <p className="text-sm font-semibold">{title}</p>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={addLabel}
              onClick={() => {
                setShowCollection(false);
                onAdd();
              }}
            >
              <Plus />
            </Button>
          </div>
          {children(() => setShowCollection(false))}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setExpansion({ open: !open, activeKey })}
          className="noted-nav-organization flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium text-sidebar-foreground/85 transition-colors hover:bg-foreground/[0.05] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
              !open && '-rotate-90',
            )}
          />
          {title}
        </button>
        {open && addButton}
      </div>
      <div id={id} hidden={!open} className="space-y-0.5 pl-3">
        {children()}
      </div>
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
  const documents = useDocumentImport({
    folderId: filters.folderId,
    onImported: () => {
      if (new URLSearchParams(location.search).get('dashboard') === '1') select({ view: 'all' });
    },
  });
  const [dialog, setDialog] = useState<SidebarDialog | null>(null);
  const close = (o: boolean) => !o && setDialog(null);
  const target = dialog as { id: string; name: string } | null;

  const elements = (
    <>
      {documents.input}
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

  return { actions: { open: setDialog, importTxt: documents.open }, elements };
}

export function Sidebar({
  filters,
  actions,
  onSelect,
  onNavigate,
  collapsed = false,
  onToggle,
}: {
  filters: ListFilters;
  actions: SidebarActions;
  onSelect: (f: Partial<ListFilters>) => void;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const counts = useCounts();
  const folders = useFolders();
  const tags = useTags();

  const c = counts.data;
  const { repo } = useRepo();
  const qc = useQueryClient();
  const [addingFolders, setAddingFolders] = useState(false);
  const isView = (v: NoteView) =>
    (filters.view === v || (v === 'all' && LIBRARY_SUBVIEWS.includes(filters.view))) &&
    !filters.folderId &&
    !filters.tagId &&
    !filters.uncategorized;
  const select = (f: Partial<ListFilters>, onSelected?: () => void) => {
    onSelect({ folderId: null, tagId: null, uncategorized: false, view: 'all', ...f });
    onSelected?.();
    onNavigate?.();
  };
  // Dialogs opened from the mobile drawer close the drawer first.
  const openDialog = (d: SidebarDialog, onSelected?: () => void) => {
    onSelected?.();
    onNavigate?.();
    actions.open(d);
  };

  return (
    <nav
      className={cn(
        'noted-sidebar flex h-full min-h-0 flex-col text-sidebar-foreground',
        collapsed && 'noted-sidebar-collapsed',
      )}
      aria-label="Notes navigation"
    >
      <div className="noted-sidebar-brand flex shrink-0 items-center justify-between">
        <Link
          to="/notes"
          onClick={onNavigate}
          aria-label="Noted home"
          className="rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {collapsed ? <BrandMark size={28} /> : <BrandLockup size={28} />}
        </Link>
        {onToggle && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={onToggle}
                className="size-9 shrink-0 rounded-lg text-muted-foreground"
              >
                {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side={collapsed ? 'right' : 'bottom'}>
              {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="noted-sidebar-body min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-thin">
        <div className="space-y-0.5" role="group" aria-label="Workspace">
          {VIEWS.map((v) => (
            <NavItem
              key={v.view}
              active={isView(v.view)}
              icon={v.icon}
              label={v.label}
              count={v.view === 'reminders' ? c?.reminders : undefined}
              onClick={() => select({ view: v.view })}
              collapsed={collapsed}
            />
          ))}
        </div>

        <div
          className="noted-sidebar-organization space-y-0.5"
          role="group"
          aria-label="Organization"
        >
          <OrganizationGroup
            title="Folders"
            activeKey={filters.uncategorized ? 'uncategorized' : filters.folderId}
            onAdd={() => openDialog({ kind: 'new-folder' })}
            addLabel="New folder"
            icon={<FolderIcon />}
            collapsed={collapsed}
          >
            {(onSelected) => (
              <>
                <NavItem
                  active={filters.uncategorized}
                  icon={<Inbox />}
                  label="Uncategorized"
                  count={c?.uncategorized}
                  onClick={() => select({ uncategorized: true }, onSelected)}
                />
                {folders.data?.map((f) => (
                  <NavItem
                    key={f.id}
                    active={filters.folderId === f.id}
                    icon={
                      <span
                        style={{
                          color:
                            f.color && f.color !== 'default' ? `var(--note-${f.color})` : undefined,
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
                        )[f.icon ?? ''] ??
                          (filters.folderId === f.id ? <FolderOpen /> : <FolderIcon />)}
                      </span>
                    }
                    label={f.name}
                    count={c?.folders[f.id]}
                    onClick={() => select({ folderId: f.id }, onSelected)}
                    menu={
                      <ItemMenu
                        label={`Folder ${f.name}`}
                        onAppearance={() =>
                          openDialog({ kind: 'folder-appearance', id: f.id }, onSelected)
                        }
                        onRename={() =>
                          openDialog({ kind: 'rename-folder', id: f.id, name: f.name }, onSelected)
                        }
                        onDelete={() =>
                          openDialog({ kind: 'delete-folder', id: f.id, name: f.name }, onSelected)
                        }
                      />
                    }
                  />
                ))}
                {folders.data?.length === 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 justify-start text-xs text-muted-foreground"
                    disabled={addingFolders}
                    onClick={async () => {
                      setAddingFolders(true);
                      try {
                        for (const name of ['Personal', 'School', 'Work']) {
                          try {
                            await repo.createFolder(name);
                          } catch (error) {
                            if ((error as Error).name !== 'DuplicateNameError') throw error;
                          }
                        }
                        toast.success('Default folders added');
                      } catch (error) {
                        toast.error(errorMessage(error));
                      } finally {
                        await qc.invalidateQueries({ queryKey: ['folders', repo.scope] });
                        setAddingFolders(false);
                      }
                    }}
                  >
                    Add default folders
                  </Button>
                )}
              </>
            )}
          </OrganizationGroup>

          <OrganizationGroup
            title="Tags"
            activeKey={filters.tagId}
            onAdd={() => openDialog({ kind: 'new-tag' })}
            addLabel="New tag"
            icon={<Hash />}
            collapsed={collapsed}
          >
            {(onSelected) => (
              <>
                {tags.data?.map((t) => (
                  <NavItem
                    key={t.id}
                    active={filters.tagId === t.id}
                    icon={<Hash />}
                    label={t.name}
                    count={c?.tags[t.id]}
                    onClick={() => select({ tagId: t.id }, onSelected)}
                    menu={
                      <ItemMenu
                        label={`Tag ${t.name}`}
                        onRename={() =>
                          openDialog({ kind: 'rename-tag', id: t.id, name: t.name }, onSelected)
                        }
                        onDelete={() =>
                          openDialog({ kind: 'delete-tag', id: t.id, name: t.name }, onSelected)
                        }
                      />
                    }
                  />
                ))}
                {tags.data && !tags.data.length && (
                  <p className="px-2.5 py-1 text-xs text-muted-foreground">No tags yet</p>
                )}
              </>
            )}
          </OrganizationGroup>
        </div>
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
