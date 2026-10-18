# CLAUDE.md — Personal ₿LOC

## Project Overview

React + Vite + TypeScript PWA modeling Bitcoin accumulation strategies using Strike's Bitcoin Line of Credit (BLOC). Eight tabs: **Living on Bitcoin**, **Smart BLOC**, **Power Law**, **Sats**, **Miners**, **CB Loan** (hidden by default), **Advisor** (hidden by default), and **Settings** (not a tab — accessible via branding dropdown).

Deployed to Vercel.

---

## Tech Stack

- React 18 + Vite + TypeScript
- Zustand (global store) + `persist` middleware → localStorage key `'personal-bloc-store'`
- Recharts (charts)
- CSS Modules
- Vitest — all tests must pass before every commit (`npx vitest run` for the count)
- ESLint 9 (flat config, `eslint.config.js`) — `npm run lint` must be clean before every commit
- Vercel (deployment + serverless proxy for Power Law data)
- @dnd-kit/core + @dnd-kit/sortable + @dnd-kit/utilities (drag-and-drop tab reordering)
- PWA: `public/manifest.json` + `src/sw.ts` → `dist/sw.js` (Workbox full-build precache via vite-plugin-pwa `injectManifest`; real offline support)

---

## How these instructions are organized

This file and `.claude/rules/general.md` — the constraints whose code is everywhere — load in every session. Everything else that was here moved, word for word (BL21; spec `pbloc-spec-claude-md-split-v1`):

- **`.claude/rules/`** — the Critical Constraints, split by area. They bind. Each file loads by itself when you Read, Write or Edit a file its `paths:` cover, and a compaction drops it until the next such read. So Read a file before you change it — again after a compaction — and before you create one, Read one beside it.
- **`docs/claude/`** — the reference: how each part works, why, and its traps. Nothing loads these. Before you change a source file, grep `docs/claude/file-structure.md` for its name — its entry describes the file, traps included — and read the sections of its area's doc that cover what you touch. The docs are long: grep, then read the section.
- "CLAUDE.md § X" in code comments, specs and the master index means the section headed X, now in `docs/claude/` (grep for its heading); "§ Critical Constraints" means `.claude/rules/`.
- Each section has one copy. Edit it where it lives now.

## The gate

`npm run lint` clean, `npm run build` (`tsc -b && vite build` — the real typecheck; `tsc --noEmit` checks nothing) and `npx vitest run` green before every commit; `npm run e2e` runs the Playwright specs, serially. The store version, CI and deploy: `docs/claude/build-deploy.md`. Test conventions — tags, mutations, exact goldens: `docs/claude/test-suite.md`.

## Working rules

Each line points at the full rule: the doc named, under the words quoted.

- **Fixtures are synthetic: this repo is public.** Engine fixtures use round, invented numbers — change the ratio, never the provenance (`docs/claude/test-suite.md`, "FIXTURES ARE SYNTHETIC").
- **Anything that leaves the device stays amount-free.** Diagnostics and the log ring carry sync metadata only; Nostr-layer code logs through `nostrLog()`, never with amounts (`docs/claude/build-deploy.md`, "Privacy rule").
- **A `migrateState` bump moves two constants together:** `CURRENT_STORE_VERSION` (`src/lib/storeVersion.ts`) and e2e's own `STORE_VERSION` (`e2e/helpers.ts`) (`docs/claude/build-deploy.md`, "Store-version bump discipline").
- **Local dates come from `todayLocalISO()` / `toLocalISO()`,** never from `toISOString()` split at the `T` — that is UTC (`docs/claude/ui.md`, "Date Formatting").
- **A new e2e spec that measures or drags a sheet right after opening it** opens it through the helpers, or calls `waitForSheetAtRest` itself (`docs/claude/build-deploy.md`, "The sheet openers wait").
- **`fmtLtvPct` is the only LTV formatter.** An LTV with debt and no collateral is infinite, and `(x * 100).toFixed(n)` prints "Infinity%"; a test greps `src/components/` for an open-coded `(…ltv * 100).toFixed(…)` (`docs/claude/test-suite.md`, "IS THE ONLY LTV FORMATTER").

## The map

| Area | Reference — `docs/claude/` | Rules — `.claude/rules/` |
|---|---|---|
| The three Vercel deploys and the landing funnel (C1). ⚠ `VITE_DEMO` never on an origin with real users | `commercialization.md` | — |
| Every source file, one entry each — grep for its name | `file-structure.md` | — |
| The store's shape; the dated-collateral model (superseded at v20) | `store.md` | `store.md`, `journal.md` |
| Daily Mode — the journal's data layer, store wiring, sync, view, write path, calendar, backfill, withdraw, review → sign-off | `daily-mode.md` | `journal.md`, `engine.md` |
| The Almanac (CycleClock) and its faces | `almanac.md` | `engine.md`, `charts.md`, `journal.md` |
| The viewer home, sharing (C-safe / C-trusted), viewer settings and roles; the owner's IA | `viewer.md` | `identity.md`, `engine.md` |
| The access layer — the lockout fix, owner key generation, the recovery-key backup, identity clean-up | `access.md` | `identity.md` |
| Plan export and import | `backup.md` | `store.md` |
| Crash day — the Emergency Console, the Playbook's crash line | `crash.md` | `engine.md` |
| The tabs, the Smart BLOC sidebar, the month-by-month table, the Mining tab | `screens.md` | `ui.md` |
| The engines — the CB loan, the Advisor, the power law, the cold-storage sweep and the real cold balance | `engines.md` | `engine.md` |
| The journal's money — Coinbase borrow and paydown, the paydown badge, Strike's minimum and the NDP, thresholds, the savings line, one ledger and one sign-off, readings, the strategy-month calendar | `journal.md` | `journal.md`, `engine.md` |
| Formatting (dollars, dates), `NumberInput`, design tokens, gestures and motion, chart zoom, mobile | `ui.md` | `ui.md`, `charts.md` |
| Every test file — its tags, mutations and red-first | `test-suite.md` | `general.md` |
| The gate, lint, the store-version bump discipline, e2e, CI and deploy | `build-deploy.md` | `store.md` |
| Recovery — no plan found, payload kinds, the backup gate and its ladder, remanence | `recovery.md` | `identity.md` |
| Nostr — the sync channels, signers, relays and viewers | `nostr.md` | `sync.md`, `identity.md` |
| The event-sourced plan (Phase 4) | `phase-4.md` | `sync.md`, `store.md` |
