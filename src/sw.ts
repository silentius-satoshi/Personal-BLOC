// Custom service worker (vite-plugin-pwa injectManifest). Replaces the hand-rolled public/sw.js, which
// precached only '/' + '/index.html' and network-first'd everything else → offline launch white-screened
// whenever a hashed asset was missing from the runtime cache. Workbox precaches the FULL build instead
// (per-deploy versioned, atomic activation). Compiled by tsconfig.worker.json (WebWorker lib, no DOM).
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | import('workbox-precaching').PrecacheEntry)[];
};

// Full-build precache — every hashed asset from this deploy (index/js/css/svg), versioned + activated atomically.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA navigation fallback → the precached index.html (fixes the offline white-screen for any route).
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

// autoUpdate semantics — take over immediately (matches the old SW's skipWaiting + clients.claim).
self.skipWaiting();
clientsClaim();

// Orphan the legacy hand-rolled cache on first activation of this new SW.
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('personal-bloc-v1'));
});

// NO runtime caching for cross-origin API calls — price/candles/relays stay network-only (the stores carry
// last-known values, and a failed poll is already handled gracefully by the app).
