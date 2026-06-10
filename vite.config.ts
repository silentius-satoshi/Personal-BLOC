import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

function gitSha(): string {
  // Vercel provides the commit SHA at build time; local builds fall back to git.
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_SHA__:  JSON.stringify(gitSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    globals: true,
  },
})