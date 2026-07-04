import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/global.css';
import App from './App.tsx';
import { NostrProvider } from './providers/NostrProvider';
import { ErrorBoundary, GlobalErrorOverlay } from './components/Layout/ErrorBoundary';

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
