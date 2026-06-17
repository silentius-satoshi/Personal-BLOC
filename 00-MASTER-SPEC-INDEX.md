# Personal ₿LOC — Master Spec Index

**Current shipped baseline: store v14 · 188/188 tests · HEAD `4f59f89` (branch `main`).**
**Last rebuilt:** end of the Simple Mode redesign arc (historical record of what shipped + the
remaining tail, not a forward queue — the Simple Mode arc is essentially complete).

> **Reading this:** Most specs below are **SHIPPED** (committed to `main`). The few **OPEN** items are
> at the bottom. Spec files live in `/mnt/user-data/outputs/`. When a spec has multiple versions, the
> **highest version is authoritative** (lower versions are superseded drafts). Volatile facts (exact
> test count, exact synced-field list) should be verified in code/CLAUDE.md — they drift.

> **Store-version rule (for any future bump):** assign the next integer, write the migration additively
> (`field: persisted.field ?? default`), bump `version:` in `useStore.ts`, update CLAUDE.md in the
> SAME commit.

---

## Current state (verify against code; end-of-arc values)

- **Store version:** `v14` (`useStore.ts` `version: 14`).
- **Tests:** `188` passing (`npm run build && npx vitest run`).
- **Verify gate:** `npm run build` (= `tsc -b && vite build`) + `npx vitest run`. **`tsc --noEmit` is a
  NO-OP** (root tsconfig references-only).
- **Branch:** `main`. Repo: `github.com/silentius-satoshi/Personal-BLOC`.
- **Store-version history:** v7 (records start) → … → **v11** (collateral reality/sandbox era) →
  **v12** (cb-reverse-rotation: `cbRotateBackPct`) → **v13** (dashboard freshness: `cbLoanBalanceAsOf`,
  `cbLiquidationPriceAsOf`, `strikeLiquidationLtvPct`) → **v14** (Monthly Playbook: `showPlanIncomeBar`/
  `showPlanStrikeBar`/`showPlanCbBar`, device-local).

---

## SHIPPED — the Simple Mode redesign arc

### Foundation & engine
| Spec (highest version) | Store | What it shipped |
|---|---|---|
| `btc-price-live-sync-spec-v1` | ±`btcPriceMode` | Live Coinbase spot (`useBtcPrice`), live/manual mode. Foundational. |
| `cb-paydown-cap-spec-v1` | none (row fields) | Caps the ltvTriggered CB paydown; adds `cbPaydownCapped`/`cbPaydownShortfall` to `AdvisorMonthRow`. |
| `cb-reverse-rotation-spec-v2` | **v12** | **The substantive engine bug.** Added the missing `cbRotateBackPct`, keyed reverse rotation off it (band `rotate-back 55 < target 65 < trigger 75`). v1 superseded. |

### Collateral model (reality/sandbox)
| Spec (highest version) | Store | What it shipped |
|---|---|---|
| `collateral-reality-sandbox-spec-v4` | v11-era | Dated collateral adjustments, pending/graduation, reality-vs-sandbox split, delete-recompute. `advisorActualBtcHeld` = frozen month-0 baseline; `getCurrentBtcHeld()` = baseline + logged + pending. v1–v3 superseded. |
| `initial-btc-collateral-display-spec-v1` | none | Settings shows read-only "Initial BTC collateral" (baseline) above "Current BTC collateral" + green "since start" delta. |

### Monthly log + workflow
| Spec (highest version) | Store | What it shipped |
|---|---|---|
| `monthly-log-spec-v1` | — | Monthly log foundation (merged-commit loop, `MonthlyLogEntry`). |
| `simple-mode-workflow-spec-v2` | — | Simple Mode operating workflow (§2–§9 shipped). v1 superseded. |
| `editable-btc-bought-log-spec-v1` | none | "Log this month" confirm sheet's BTC-bought figure editable (was hardwired projection). |
| `simple-mode-checklist-removal-spec-v1` | — | Removed the old checklist UI. |

### Outlook projection
| Spec | Store | What it shipped |
|---|---|---|
| `outlook-cb-quiet-triggered-spec-v1` | none | Option A — quiet CB columns in ltvTriggered (muted non-trigger months, amber fired month). |
| `outlook-projection-legend-spec-v1` | none | Symbol/tier legend beneath the projection table (shared Advisor tab + Simple Mode Outlook). |

### Strike-BTC trio (initial / current / dry-powder)
| Spec | Store | What it shipped |
|---|---|---|
| `strike-btc-dry-powder-fetch-spec-v1` | none | Fetch Strike spendable BTC (`available`) — display-only "dry powder," never in LTV math. Settings row. |
| `strike-dry-powder-inputspanel-widget-spec-v1` | none | (superseded) inline dry-powder line in the USD widget. |
| `strike-two-widgets-usd-drypowder-spec-v1` | none | Split into two parallel sidebar widgets: STRIKE USD HOLDINGS + STRIKE BTC DRY POWDER. |

### Safety dashboard (Spec B) + Monthly Playbook (the big restyle)
| Spec (highest version) | Store | What it shipped |
|---|---|---|
| `simple-mode-dashboard-bars-spec-v3` | **v13** | **Safety Dashboard** (CB + Strike LTV bars, Safe/Watch/Act), shared `cbMetrics` helper (unified CB-tab + Sidebar + LiqSim authority), balance/liq-price freshness. v1/v2 superseded. |
| `monthly-playbook-restyle-spec-v1` | **v14** | **The Monthly Playbook.** Month scrubber (replaces carousel), colored-dot 3-row layout, 3 stacked bars, skip-aware **projection-vs-reality split** (current = skip-adjusted reality; others = clean projection), summary paragraph. New pure `simpleModePlan.ts`. |
| `monthly-playbook-followups-spec-v1` | none | Current-actuals headline (was EoM projection — fixed Settings conflation), logged-current edit affordance, **decoupled Strike dashboard bar from `hasCbLoan`**, shared `computeStrikeLtv` (+ fixed stale-baseline dashboard LTV bug). |

### MonthlyLogOverlay (edit-modal fixes)
| Spec | Store | What it shipped |
|---|---|---|
| `monthly-log-overlay-fixes-spec-v1` | none | Off-by-one (opened next month), centered modal (was full-screen), header/arrows inside the card, `openInEditMode`. |
| `monthly-log-overlay-nesting-fix-spec-v1` | none | Collapsed a modal-in-modal regression (inner `.card` chrome stripped) + single-column form. |
| (inline fix, no spec file) | none | Transparent-modal fix: `.modalCard` `--bg-base` → `--bg-card`. |

### Price chart (Spec C — last feature)
| Spec (highest version) | Store | What it shipped |
|---|---|---|
| `simple-mode-price-chart-spec-v2` | none | BTC price chart in the dashboard's price slot: Coinbase candles via same-origin proxy (`api/btc-candles.js`), 1H/1D/1W toggle, recharts AreaChart, `useBtcHistory` + pure `parseCandles`. v1 superseded. ⚠ live data only on a Vercel deploy. |

### Housekeeping
| Spec | Store | What it shipped |
|---|---|---|
| `bg-base-token-fix-spec-v1` | none | Defined the missing `--bg-base: #09090E` (referenced 25×, undefined → transparent; incl. 2 invisible button-text uses). |
| `cleanup-bundle-spec-v1` | — | (historical) bundled cleanup. |
| `remove-pull-to-refresh-spec-v1` | — | Removed pull-to-refresh. |

### Nostr (sync stack — shipped earlier, stable)
| Specs | What it shipped |
|---|---|
| `nostr-live-sync`, `nostr-merge-sync`, `nostr-sync-integrity`, `nostr-sync-reliability`, `nostr-cleanup-consolidation`, `nostr-nip46-session-persistence` (all `-spec-v1`) | NIP-46 auth (Primal), per-month merge with tombstones, `mergeRecords`/`syncNow`, transport hardening (`ExponentialBackoff`), session persistence. Stack: `@nostrify/react ^0.6.2` + `@nostrify/nostrify ^0.52.2`, `nostr-tools` exact `2.23.5`, `websocket-ts@2.3.0`. |

### Prompts (not specs)
`monthly-log-claude-code-prompt.md`, `simple-mode-ui-replication-prompt.md` — historical prompt drafts.

---

## OPEN — remaining tail

| Item | Type | Notes |
|---|---|---|
| **Price chart deploy verification** | smoke | Shipped & committed; live candle data must be confirmed on a **Vercel preview/prod deploy** (the `api/btc-candles` proxy doesn't run under `npm run dev` → "price history unavailable" locally is expected). |
| **Carousel/scrubber-preview polish** | deferred | The scrubber replaced the carousel preview; further "preview other months" polish deferred — likely subsumed by the scrubber. Revisit only if a gap surfaces. |
| **`--bg-base` semantic consolidation** | optional cosmetic | Token now defined (bug fixed). A future pass *could* alias the 23 backgrounds → `--bg-app` and 2 text-colors → `#000`; no functional gain, low priority. |
| **iOS local-key NIP-46 signer** | parked (MAX) | Standing rec; transient iOS deeplink races. Not blocking. |
| **Mining tab integration** | parked (MAX) | Spec produced earlier, iterating; outside the Simple Mode arc. |

---

## Key invariants (for future work)

- **`advisorActualBtcHeld`** = frozen month-0 baseline (never back-solved). **`getCurrentBtcHeld()`** =
  baseline + logged buys + pending (the "reality read"). Use the latter for current-state displays.
- **`cbMetrics` / `accruedCbBalance` / `computeStrikeLtv`** are the shared single-source helpers — CB
  LTV / liq-price / Strike LTV route through them so dashboard / CB tab / Liq Sim / headline can't
  disagree.
- **`simpleModePlan.ts`** (`deriveForMonth` / `isOperatingMonth` / `composeMonthSummary`): the
  projection-vs-reality split. Current month = skip-adjusted reality; other months =
  `deriveForMonth` clean projection; logged = actuals.
- **Device-local (NOT synced)** flags: `devMode`, `expenseReanchorDismissedAt`, `showPlanIncomeBar`/
  `showPlanStrikeBar`/`showPlanCbBar`. Keep OUT of `SETTINGS_FIELDS`/payload (persist via `...rest`).
- **Strike API:** balances endpoint exposes NO collateral/pledged field, no BLOC/loan endpoints →
  collateral stays manually tracked; fetched Strike BTC (`available`) is spendable-only by construction.
- **Coinbase:** spot via `api.coinbase.com` (`useBtcPrice`, direct — CORS-OK); candles via
  `api.exchange.coinbase.com` through the **`api/btc-candles` same-origin proxy** (candles host not
  CORS-permissive).
- **Power Law** `1.16e-17 × days^5.82`. **Morpho** liquidates instantly at 86% LLTV (no grace), LIF ≈
  1.04384. **Strike** 65% warning / 70% margin call / 85% partial liquidation (72h window).
- **Tokens:** `--bg-app` #09090E, `--bg-base` #09090E (now defined), `--bg-card` #111318,
  `--bg-input` #0D0E14, `--bg-hover` #13141F.
