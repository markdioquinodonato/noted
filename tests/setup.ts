import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { closeGuestDb } from '@/data/local/idb';
import { closeDraftsDb } from '@/data/drafts';

// Fresh, isolated IndexedDB for every test.
beforeEach(async () => {
  await closeGuestDb();
  await closeDraftsDb();
  globalThis.indexedDB = new IDBFactory();
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* node env */
  }
});

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});

if (typeof window !== 'undefined') {
  // jsdom gaps used by Radix UI / layout code.
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;
  window.matchMedia ??= ((query: string) => ({
    matches: query.includes('min-width: 768px') || query.includes('min-width: 1024px'),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  document.elementFromPoint ??= () => null;
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
}
