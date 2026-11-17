import { useCallback, useSyncExternalStore } from 'react';
import { Columns3, Grid2X2, Grid3X3, List } from 'lucide-react';
import { useRepo } from '@/app/RepositoryProvider';
import { readBrowserValue, writeBrowserValue } from '@/lib/browserStorage';

export const NOTE_LAYOUT_OPTIONS = [
  {
    value: 'grid',
    label: 'Comfortable Grid',
    icon: Grid2X2,
    description: 'Balanced cards with room for previews.',
  },
  {
    value: 'compact',
    label: 'Compact Grid',
    icon: Grid3X3,
    description: 'Smaller cards so more notes fit on screen.',
  },
  {
    value: 'list',
    label: 'Clean List',
    icon: List,
    description: 'Full-width rows for quick scanning.',
  },
  {
    value: 'board',
    label: 'Adaptive Board',
    icon: Columns3,
    description: 'Cards adjust to the length of their previews.',
  },
] as const;

export type NotesLayout = (typeof NOTE_LAYOUT_OPTIONS)[number]['value'];

const changed = new EventTarget();
const fallbackValues = new Map<string, string>();

function useWorkspacePreference(name: string, legacyKey: string) {
  const { repo } = useRepo();
  const key = `noted:workspace:${repo.scope}:${name}`;
  const subscribe = useCallback(
    (notify: () => void) => {
      const onStorage = (event: StorageEvent) => {
        if (event.storageArea === window.localStorage && (event.key === key || event.key === null))
          notify();
      };
      window.addEventListener('storage', onStorage);
      changed.addEventListener(key, notify);
      return () => {
        window.removeEventListener('storage', onStorage);
        changed.removeEventListener(key, notify);
      };
    },
    [key],
  );
  const value = useSyncExternalStore(
    subscribe,
    () =>
      fallbackValues.get(key) ??
      readBrowserValue(key) ??
      (repo.kind === 'local' ? readBrowserValue(legacyKey) : null),
    () => null,
  );
  const setValue = (value: string) => {
    if (writeBrowserValue(key, value)) fallbackValues.delete(key);
    else fallbackValues.set(key, value);
    changed.dispatchEvent(new Event(key));
  };
  return [value, setValue] as const;
}

export function useNotesLayout() {
  const [preference, setValue] = useWorkspacePreference('layout', 'noted:layout');
  const layout = NOTE_LAYOUT_OPTIONS.find(({ value }) => value === preference)?.value ?? 'grid';
  return { layout, setLayout: (value: NotesLayout) => setValue(value) };
}

export function useSidebarPreference() {
  const [preference, setValue] = useWorkspacePreference('sidebar', 'noted:sidebar-collapsed');
  return {
    collapsed: preference === '1',
    setCollapsed: (value: boolean) => setValue(value ? '1' : '0'),
  };
}
