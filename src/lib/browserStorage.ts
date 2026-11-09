type StorageArea = 'localStorage' | 'sessionStorage';

/** UI preferences are optional; failure must never prevent access to guest notes. */
export function readBrowserValue(key: string, area: StorageArea = 'localStorage'): string | null {
  try {
    return window[area].getItem(key);
  } catch {
    return null;
  }
}

export function writeBrowserValue(
  key: string,
  value: string,
  area: StorageArea = 'localStorage',
): void {
  try {
    window[area].setItem(key, value);
  } catch {
    /* The current UI state remains usable. */
  }
}
