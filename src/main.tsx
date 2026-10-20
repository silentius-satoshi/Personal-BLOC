// Read by the inline SW-diagnostic watchdog in index.html: "the app has started". ESM runs every import below before this
// line, so the flag means the whole bundle has loaded and run. A normal boot sets it well within the 15 s window, so the
// panel never paints; a slow one that the watchdog painted over removes the panel the moment this runs (5e, F2).
(window as unknown as { __APP_BOOTED?: boolean }).__APP_BOOTED = true;

// C0 — MUST be the FIRST import: on the VITE_DEMO deploy this seeds localStorage, and useStore's module-init IIFEs
// read localStorage at import time. ESM evaluates imports depth-first in source order, and demoSeed pulls no store,
// so its side effect lands before App → AppShell → useStore evaluates. (No-op on the owner build — flag unset.)
import './lib/demo/demoSeed';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/global.css';
import App from './App.tsx';
import { NostrProvider } from './providers/NostrProvider';
import { ErrorBoundary, GlobalErrorOverlay } from './components/Layout/ErrorBoundary';
import { haptics, hapticsSupport } from './lib/haptics';

// Device-gate probe: console access to the haptics adapter (harmless in prod,
// also guarantees the module isn't tree-shaken out before P1 adds real consumers).
(window as unknown as Record<string, unknown>).__bloc = {
  hapticsSupport,
  haptics,
};

// Workbox SW (vite-plugin-pwa, autoUpdate) — registers immediately; reloads clients when a new deploy's SW activates.
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <NostrProvider>
        <App />
      </NostrProvider>
      <GlobalErrorOverlay />
    </ErrorBoundary>
  </StrictMode>,
);
