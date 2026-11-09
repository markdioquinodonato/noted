import { useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'noted:theme';
const listeners = new Set<() => void>();

function readStoredPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

function systemPrefersDark() {
  return (
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  );
}

let state: { preference: ThemePreference; resolved: ResolvedTheme } = (() => {
  const preference = typeof window === 'undefined' ? 'system' : readStoredPreference();
  return { preference, resolved: resolve(preference) };
})();

function resolve(pref: ThemePreference): ResolvedTheme {
  return pref === 'dark' || (pref === 'system' && systemPrefersDark()) ? 'dark' : 'light';
}

function apply() {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', state.resolved === 'dark');
  document.documentElement.style.colorScheme = state.resolved;
}

export function setThemePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* ignore */
  }
  state = { preference, resolved: resolve(preference) };
  apply();
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  apply();
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (state.preference === 'system') setThemePreference('system');
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useThemeState() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}
