import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

function gitSha(): string {
  // Vercel provides the commit SHA at build time; local builds fall back to git.
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
}

export default defineConfig({
  plugins: [
    react(),
    // Workbox full-manifest precaching (real offline support). injectManifest → we own src/sw.ts.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: null,   // registered manually via registerSW in main.tsx — avoids a double injection
      manifest: false,        // keep the existing public/manifest.json + its <link> untouched
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The crypto.worker chunk (nip49 + scrypt) is comfortably small, but raise the cap defensively:
        // workbox's silent 2 MiB default would drop an oversized chunk from the precache manifest and break
        // OFFLINE unlock with only a build warning.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  define: {
    __BUILD_SHA__:  JSON.stringify(gitSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    globals: true,
    // Playwright e2e specs live in e2e/*.spec.ts — vitest's default include globs *.spec.ts, so exclude
    // them or `vitest run` would collect the Playwright suites (they import @playwright/test). Keep e2e
    // strictly on `npm run e2e`.
    exclude: ['e2e/**', ...configDefaults.exclude],
  },
})