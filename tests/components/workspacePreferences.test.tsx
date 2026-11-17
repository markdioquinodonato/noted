import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useNotesLayout, useSidebarPreference } from '@/features/notes/workspacePreferences';

const storage = vi.hoisted(() => ({ scope: 'guest' }));
vi.mock('@/app/RepositoryProvider', () => ({
  useRepo: () => ({
    repo: { scope: storage.scope, kind: storage.scope === 'guest' ? 'local' : 'cloud' },
  }),
}));

it('isolates guest and account settings while keeping existing guest preferences', () => {
  storage.scope = 'guest';
  localStorage.setItem('noted:layout', 'list');
  localStorage.setItem('noted:sidebar-collapsed', '1');
  const first = renderHook(() => ({
    ...useNotesLayout(),
    ...useSidebarPreference(),
  }));
  const second = renderHook(() => useNotesLayout());
  expect(first.result.current).toMatchObject({ layout: 'list', collapsed: true });

  act(() => first.result.current.setLayout('board'));
  expect(second.result.current.layout).toBe('board');

  storage.scope = 'account-a';
  first.rerender();
  expect(first.result.current).toMatchObject({ layout: 'grid', collapsed: false });
  act(() => {
    first.result.current.setLayout('compact');
    first.result.current.setCollapsed(true);
  });

  storage.scope = 'account-b';
  first.rerender();
  expect(first.result.current).toMatchObject({ layout: 'grid', collapsed: false });

  storage.scope = 'guest';
  first.rerender();
  expect(first.result.current).toMatchObject({ layout: 'board', collapsed: true });

  storage.scope = 'account-a';
  first.rerender();
  expect(first.result.current).toMatchObject({ layout: 'compact', collapsed: true });
});
