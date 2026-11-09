import { useMemo, useState, type KeyboardEvent } from 'react';
import { Check, Folder as FolderIcon, FolderInput, Hash, Plus, Tags } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Folder, Tag } from '@/domain/types';
import { errorMessage } from '@/lib/format';
import { nameKey } from '@/lib/text';
import { cn } from '@/lib/utils';

export function FolderPicker({
  folders,
  value,
  onChange,
  disabled,
}: {
  folders: Folder[];
  value: string | null;
  onChange: (folderId: string | null) => void;
  disabled?: boolean;
}) {
  const current = folders.find((f) => f.id === value);
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <Button
              variant="ghost"
              size="sm"
              className="max-w-[11rem] text-muted-foreground"
              aria-label={`Folder: ${current?.name ?? 'Uncategorized'}`}
            >
              {current ? <FolderIcon /> : <FolderInput />}
              <span className="truncate">{current?.name ?? 'No folder'}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Move to folder</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
        <DropdownMenuLabel>Move to folder</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value ?? '__none'}
          onValueChange={(v) => onChange(v === '__none' ? null : v)}
        >
          <DropdownMenuRadioItem value="__none">Uncategorized</DropdownMenuRadioItem>
          {folders.map((f) => (
            <DropdownMenuRadioItem key={f.id} value={f.id}>
              <span className="truncate">{f.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {!folders.length && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Create folders from the sidebar.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TagPicker({
  tags,
  value,
  onChange,
  onCreate,
  disabled,
}: {
  tags: Tag[];
  value: string[];
  onChange: (tagIds: string[]) => void;
  onCreate: (name: string) => Promise<Tag>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = new Set(value);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? tags.filter((t) => t.name.toLocaleLowerCase().includes(q)) : tags;
  }, [tags, query]);
  const exact = tags.find((t) => nameKey(t.name) === nameKey(query.replace(/^#+/, '')));

  const toggle = (id: string) =>
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);

  const create = async () => {
    const name = query.trim();
    if (!name) return;
    if (exact) {
      if (!selected.has(exact.id)) toggle(exact.id);
      setQuery('');
      return;
    }
    try {
      const tag = await onCreate(name);
      onChange([...value, tag.id]);
      setQuery('');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void create();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild disabled={disabled}>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              aria-label="Edit tags"
            >
              <Tags />
              <span className="hidden sm:inline">Tags</span>
              {value.length > 0 && (
                <span className="rounded bg-accent px-1 text-xs text-accent-foreground">
                  {value.length}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Add or remove tags</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="border-b p-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Find or create a tag…"
            aria-label="Find or create a tag"
            className="h-8"
            maxLength={40}
            autoFocus
          />
        </div>
        <ul
          className="max-h-60 overflow-y-auto p-1"
          role="listbox"
          aria-multiselectable="true"
          aria-label="Tags"
        >
          {filtered.map((t) => (
            <li key={t.id} role="option" aria-selected={selected.has(t.id)}>
              <button
                type="button"
                onClick={() => toggle(t.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <Hash className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1 truncate">{t.name}</span>
                <Check
                  className={cn('size-4 text-primary', !selected.has(t.id) && 'invisible')}
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
          {query.trim() && !exact && (
            <li>
              <button
                type="button"
                onClick={() => void create()}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-primary hover:bg-accent"
              >
                <Plus className="size-3.5" aria-hidden="true" /> Create “
                {query.trim().replace(/^#+/, '')}”
              </button>
            </li>
          )}
          {!filtered.length && !query.trim() && (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">
              No tags yet. Type to create one.
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
