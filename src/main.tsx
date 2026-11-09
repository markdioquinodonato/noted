import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './lib/theme';
import { App } from './app/App';
import { isDesktopApp } from './lib/platform';

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
