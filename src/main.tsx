import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './lib/theme';
import { App } from './app/App';
import { isDesktopApp } from './lib/platform';

// After a new deploy, an open tab may request code-split files from the previous
// build that no longer exist. Reload once to pick up the current version instead
// of leaving a broken page (guarded so it can never loop).
window.addEventListener('vite:preloadError', (event) => {
  try {
    const key = 'noted:chunk-reload';
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem(key, String(Date.now()));
    event.preventDefault();
    window.location.reload();
  } catch {
    /* storage unavailable: let the error surface */
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (isDesktopApp()) {
  // Desktop: all assets ship inside the installer, so no service worker is needed.
  void import('./desktop/desktop').then((m) => m.initDesktop());
}

// Web only: immutable app assets enter this cache. Auth/API requests are never cached.
if (import.meta.env.PROD && !isDesktopApp() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => undefined);
  });
}
