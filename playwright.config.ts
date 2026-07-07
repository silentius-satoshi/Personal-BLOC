import { defineConfig } from '@playwright/test';

/**
 * Gesture & Motion System — P1 e2e smoke harness (Chromium mobile-emulated only).
 * Reproduces what Chromium CAN reproduce of the DraggableSheet gesture layer (dirty-guard, keyboard
 * guard, scroll coexistence, reduced-motion). NOT a substitute for the iOS device gate — real WebKit
 * haptics / the PWA container / iOS blur-timing are out of scope. Run via `npm run e2e`; kept OUT of
 * `vitest` (see vite.config.ts test.exclude).
 */
export default defineConfig({
  testDir: './e2e',
  // Gesture/motion timing (rAF-batched transforms, spring/exit durations) is CPU-contention-sensitive —
  // run serially so a busy machine can't starve an animation frame and flake a transform/dismiss assertion.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // The PWA service worker is irrelevant to gesture testing and its precache can serve stale bundles
    // across runs — block it so every run boots the fresh dev build.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
