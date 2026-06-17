# Personal ₿LOC — Master Spec Index

**Current shipped baseline: store v14 · 191/191 tests · HEAD `a99b0cd` (branch `main`).**
**Last rebuilt:** after the confirm-sheet / paydown-ceiling / playbook-polish arc (the Simple Mode +
rate-integration work is essentially complete — this is a historical record of what shipped, not a
forward queue).

> **Reading this:** Most specs below are **SHIPPED** (committed to `main`). The few **OPEN** items are
> at the bottom. Spec files live in `/mnt/user-data/outputs/`. When a spec has multiple versions, the
> **highest version is authoritative** (lower versions are superseded drafts). Volatile facts (exact
> test count, exact synced-field list) should be verified in code/CLAUDE.md — they drift.

> **Store-version rule (for any future bump):** assign the next integer, write the migration additively
> (`field: persisted.field ?? default`), bump `version:` in `useStore.ts`, update CLAUDE.md in the
> SAME commit. **Note:** the entire arc below shipped at **v14 with NO bump** — every change either used
> existing fields, added *additive optional* entry fields (`ndpPaid?`), or was ephemeral/non-synced
> (live rates) or display-only.

---

## Current state (verify against code)

- **Store version:** `v14` (`useStore.ts` `version: 14`) — unchanged across the entire post-rebuild arc.
- **Tests:** `191` passing (`npm run build && npx vitest run`) — was 188 at the prior rebuild (+3 from the
  Morpho parser tests; the paydown-ceiling change repurposed an assertion rather than adding one).
- **Verify gate:** `npm run build` (= `tsc -b && vite build`) + `npx vitest run`. **`tsc --noEmit` is a
  NO-OP** (root tsconfig references-only).
- **Branch:** `main`. Repo: `github.com/silentius-satoshi/Personal-BLOC`.
- **Store-version history:** v7 (records start) → … → **v11** (collateral reality/sandbox) → **v12**
  (cb-reverse-rotation: `cbRotateBackPct`) → **v13** (dashboard freshness: `cbLoanBalanceAsOf`,
  `cbLiquidationPriceAsOf`, `strikeLiquidationLtvPct`) → **v14** (Monthly Playbook bar flags, device-local).

---

## SHIPPED — post-rebuild arc (newest; the work since the v14/188 index rebuild `dc4f286`)

Chronological (oldest → newest). All committed to `main`, all at store v14.

| Spec (highest version) | Commit | What it shipped |
|---|---|---|
| `safety-dashboard-cb-bar-fixes-spec-v1` | `49b29c1` | CB dashboard bar: **whole-card tap-to-anchor** (mirrors Strike card's whole-container tap; root `<button>`→`<div role=button>` to legally nest the editBox, keydown self-guard), marker **ticks** (75%/86%) + price moved to a `.priceNote` subtext (fixes right-end label collision), ONE calm `.anchorNudge` for never-anchored (was 3 amber warnings). Root cause of "nothing happens on tap" was discoverability, not a broken handler. |
| `strike-edit-and-position-boxes-spec-v1` | `e1eb6f3` | Strike card **view-aware inline edit** (capacity → BLOC balance + credit line; liquidation → BLOC balance + liq LTV %; own state, `stopPropagation`, synced setters). Removed the **redundant** Strike `LTV` line + the **entire CB LOAN column** from "This Month" (both shown by the dashboard bars; orphaned `currentStrikeLtv`/`cbStatus`/`classifyLtv` removed). **Two-box** layout (dropped the outer card to avoid card-in-card; 2-up grid, stacks <560px). |
| `remove-fold-cc-spec-v1` | `d7356d7` | **Removed Fold CC entirely** (user switched to a variable-rate Gemini card — unmodelable). Gone across 9 files: store `showFoldCC`/`foldRewardRate` (non-synced → no migration), sim `foldRate`/`foldBTCThisMonth`/`fbtc`/`comb` (combined stack collapses to `btc`), Settings toggle, Playbook Fold row, BtcStackChart "+ Fold CC" variant. Build is the orphan guard. |
| `morpho-rate-display-assist-spec-v1` | `487bfba` | **Morpho borrow-rate display-assist** (Settings). New `api/morpho-rate.js` (same-origin POST proxy → `api.morpho.org/graphql`, `s-maxage=300`), `useMorphoRate` + pure `parseMorphoRate`. Shows live cbBTC/USDC (Base) borrow APY as a **labeled read-only reference** beside the manual `cbAprPct` — NEVER overwrites (Coinbase may add a spread). +3 tests (→191). |
| `editable-bloc-draw-cb-payment-spec-v1` | `2f86be8` | **Editable BLOC draw + CB payment** in the log confirm sheet (mirrors BTC-bought/expenses); edits **authoritative over projection** — edited draw recomputes logged Strike balance/LTV (`loggedStrikeBal`), edited CB drives the re-anchor (`effectiveCbPayment`, per-mode seed `projectedCbAmount`). CB row **hidden in ltvTriggered until `cbLtvTriggered` fires**; labeled per mode ("CB payment"/"CB paydown"). |
| `morpho-rate-cb-editbox-spec-v1` | `83fefc1` | The same Morpho rate reference line added to the **SafetyDashboard CB anchor editBox** (the contextually-best second home — where the user reconciles against Coinbase). Reuses `useMorphoRate`; local `.editHint` class. |
| `confirm-sheet-interest-ndp-spec-v1` | `8337050` | **Interest/mo replaces Expenses** in the confirm sheet (the BLOC draw already = expenses, so logged `expensesActual` auto-set to the draw; **Settings `expenses` untouched**). Edited interest authoritative over the logged balance (`effectiveInterest`). Added an **editable NDP amount** beside the yearly checkbox (new additive optional `MonthlyLogEntry.ndpPaid`; records + stamps, does not reduce the balance). |
| `simple-mode-playbook-smartbloc-ux-spec-v1` | `b47e4fe` | **Simple Mode playbook ← Smart BLOC UX, reality-engine-backed.** Added the conditional **LoC Paydown row** (appears in scrubbed months where `paydown > 0`, fed by `expectedPaydown`/`selectedPlan.paydown` — the behavior that was missing), Smart BLOC's **% allocation** + "(after paydown)/(100% of income)" subtext, a **"Line of Credit" separator**, and a **paydown segment** on the INCOME ALLOCATION bar. STRIKE/COINBASE bars + Pay/Skip pills + "this month also" strip + logged states all kept. |
| `advisor-match-smartbloc-paydown-ceiling-spec-v1` | `bd6750d` | **The calculation fix.** `runAdvisor` now defends the 15% BLOC ceiling with **up to 100% of income** (`min(income, balance − target)`), matching `runBLOC` — removed the prior **30%-of-income paydown cap** in both strategy paths. This is why Simple Mode's STRIKE LTV now snaps back to ≤15% like Smart BLOC (was drifting above). Behavioral: high-LTV months divert more income to paydown, less to BTC. Repurposed a now-invalid `cbLtvTrigger` assertion into a **ceiling-defense check** (`blocLtv ≤ 0.151`). |
| `simple-mode-playbook-polish-spec-v1` | `edc0fcc` | **The styling polish** (matches Smart BLOC's restraint). Single inline header ("Month X of 12 · [state] · LTV Z% — paydown triggered", coral when `hasPaydown`, de-boxed state badge + BTC price right); **two-tone scrubber** fill (red paydown / green rest, keyed to `barPaydownPct`) + **M1–M12 tick markers**; dot-row **`%` moved above the amount**; **red Interest** amount; calmer rows (8px dots, `--text-secondary` labels, lighter dividers, weight-600). 3 bars + pills + state badge kept. |
| `playbook-remove-income-bar-header-restructure-spec-v1` | `caa614d` | **Polish the polish.** Removed the now-**redundant INCOME ALLOCATION bar** (the two-tone scrubber already encodes the per-month paydown/buy split; its "$X / $X ✓" is always true in projected months + still surfaced in the confirm sheet for the current month) + its dead Settings toggle (store field `showPlanIncomeBar` kept — vestigial, `planBars.test.ts` asserts it). Header restructured to **two lines**: Month + state badge on top; LTV/paydown-flag + BTC price on their own `.scrubMeta` line above the scrubber. STRIKE/COINBASE bars + scrubber (`barPaydownPct`) unchanged. |
| `position-boxes-polish-spec-v1` | `a99b0cd` | **Position-box rebalance.** STRIKE BLOC (overloaded) de-noised + THIS MONTH (~80% empty) filled: removed "fully backed above $X" (kept only the amber collateral-limited line), gated the CB-buffer line on `> $0`, restructured the cramped "after this month" run-on into a clean labeled `.eomProjection` block (balance · LTV · ₿), **relocated the NDP reminder to THIS MONTH** gated on `ndp.status !== 'ok'` (hidden when paid/far-off, resurfaces when close), and moved the Pay/Skip pills **before** the amount (`flex:1` label pins the amount right → no x-shift across current/projected/logged). |

---

## SHIPPED — the Simple Mode redesign arc (prior; through the v14/188 rebuild)

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
| `monthly-playbook-restyle-spec-v1` | **v14** | **The Monthly Playbook.** Month scrubber (replaces carousel), colored-dot 3-row layout, 3 stacked bars, skip-aware **projection-vs-reality split**, summary paragraph. New pure `simpleModePlan.ts`. |
| `monthly-playbook-followups-spec-v1` | none | Current-actuals headline (was EoM projection), logged-current edit affordance, **decoupled Strike dashboard bar from `hasCbLoan`**, shared `computeStrikeLtv`. |

### MonthlyLogOverlay (edit-modal fixes)
| Spec | Store | What it shipped |
|---|---|---|
| `monthly-log-overlay-fixes-spec-v1` | none | Off-by-one, centered modal, header/arrows inside the card, `openInEditMode`. |
| `monthly-log-overlay-nesting-fix-spec-v1` | none | Collapsed a modal-in-modal regression + single-column form. |
| (inline fix, no spec file) | none | Transparent-modal fix: `.modalCard` `--bg-base` → `--bg-card`. |

### Price chart (Spec C)
| Spec (highest version) | Store | What it shipped |
|---|---|---|
| `simple-mode-price-chart-spec-v2` | none | BTC price chart: Coinbase candles via `api/btc-candles.js` proxy, 1H/1D/1W toggle, recharts AreaChart, `useBtcHistory` + pure `parseCandles`. v1 superseded. ⚠ live data only on a Vercel deploy. |

### Housekeeping
| Spec | Store | What it shipped |
|---|---|---|
| `bg-base-token-fix-spec-v1` | none | Defined the missing `--bg-base: #09090E` (referenced 25×, undefined → transparent). |
| `cleanup-bundle-spec-v1` | — | (historical) bundled cleanup. |
| `remove-pull-to-refresh-spec-v1` | — | Removed pull-to-refresh. |

### Nostr (sync stack — shipped earliest, stable)
| Specs | What it shipped |
|---|---|
| `nostr-live-sync`, `nostr-merge-sync`, `nostr-sync-integrity`, `nostr-sync-reliability`, `nostr-cleanup-consolidation`, `nostr-nip46-session-persistence` (all `-spec-v1`) | NIP-46 auth (Primal), per-month merge with tombstones, `mergeRecords`/`syncNow`, transport hardening (`ExponentialBackoff`), session persistence. Stack: `@nostrify/react ^0.6.2` + `@nostrify/nostrify ^0.52.2`, `nostr-tools` exact `2.23.5`, `websocket-ts@2.3.0`. |

---

## OPEN — remaining tail

| Item | Type | Notes |
|---|---|---|
| **Deploy verification — 3 fetch features** | smoke | The `api/` serverless proxies run only on a **Vercel preview/prod deploy**, NOT under `npm run dev`. Verify on deploy: (1) **price chart** candles render; (2+3) the **Morpho rate** line reads a plausible single-digit % in BOTH the Settings APR field and the CB anchor editBox — confirm the fraction→percent ×100 coercion (not 612% or 0.06%); `cbAprPct` never auto-changes. Locally all three correctly show their "unavailable" state. |
| **Two-engine parity eyeball** | smoke | After the paydown-ceiling fix, confirm with matching inputs that Simple Mode's STRIKE LTV trajectory + paydown timing now **track Smart BLOC's** (the prior divergence was the 30% cap). |
| **Playbook side-by-side eyeball** | smoke | Polish + income-bar removal shipped (HEAD `caa614d`). Confirm the two playbooks read as **siblings** side-by-side, and the two-tone scrubber thumb **drags on iOS** (native range-input cross-browser check). |
| **iOS local-key NIP-46 signer** | parked (MAX) | Standing rec; transient iOS deeplink races. Not blocking. |
| **Mining tab integration** | parked (MAX) | Spec produced earlier, iterating; outside this arc. |
| **`--bg-base` semantic consolidation** | optional cosmetic | Token defined (bug fixed). A future pass *could* alias backgrounds → `--bg-app`; no functional gain. |

---

## Key invariants (for future work)

- **`advisorActualBtcHeld`** = frozen month-0 baseline (never back-solved). **`getCurrentBtcHeld()`** =
  baseline + logged buys + pending (the "reality read"). Use the latter for current-state displays.
- **`cbMetrics` / `accruedCbBalance` / `computeStrikeLtv`** are the shared single-source helpers — CB
  LTV / liq-price / Strike LTV route through them so dashboard / CB tab / Liq Sim / headline can't
  disagree.
- **`simpleModePlan.ts`** (`deriveForMonth` / `isOperatingMonth` / `composeMonthSummary`): the
  projection-vs-reality split. Current month = skip-adjusted reality; other months = clean projection;
  logged = actuals. **`deriveForMonth.paydown`** is the income→BLOC paydown the playbook's LoC Paydown
  row renders (current month uses `expectedPaydown`).
- **`runAdvisor` defends the 15% BLOC ceiling with up to 100% of income** (`min(income, balance − target)`,
  `blocLtvCeiling = 0.15`) — matches `runBLOC.ts`. (The old 30%-of-income cap was the source of the
  Simple-Mode-vs-Smart-BLOC divergence.)
- **The `effective*` override pattern** (confirm sheet): `customX ?? projected` for the BLOC draw
  (`effectiveDrawAmount`), CB payment (`effectiveCbPayment`, per-mode seed), and interest
  (`effectiveInterest`). Un-edited always = the projection; an edit is authoritative over the logged
  entry / re-anchor. `expensesActual` is auto-set to the BLOC draw (Settings `expenses` is the
  independent projection assumption — NOT touched by the per-entry actual).
- **`MonthlyLogEntry` optional fields** travel through the records-sync merge with no migration:
  `cbBal?`, `collateralAdjustment?`, **`ndpPaid?`** (additive pattern — add new per-entry data this way,
  never a store bump).
- **Device-local (NOT synced)** flags: `devMode`, `expenseReanchorDismissedAt`, `showPlanIncomeBar`/
  `showPlanStrikeBar`/`showPlanCbBar`. Keep OUT of `SETTINGS_FIELDS`/payload (persist via `...rest`).
- **Strike API:** payments/trading only — balances endpoint exposes NO collateral/pledged field, no
  BLOC/loan endpoints, and **no lending APR endpoint** (`api/strike-rates.js` fetches the BTC↔USD
  exchange-rate ticker, NOT the borrow APR). The BLOC APR is variable (US Prime + margin, ≤quarterly) +
  account-specific → stays a **manual input** (`blocApr`).
- **Morpho rate (display-assist):** the "Coinbase loan" is an on-chain-confirmed cbBTC/USDC, 86%-LLTV
  position in **Base market `0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836`**
  (chainId 8453). Live borrow APY via `api.morpho.org/graphql` `marketById(...).state.borrowApy` through
  the `api/morpho-rate` proxy. **Schema quirk:** this endpoint's `Market` type uses **`marketId`, NOT
  `uniqueKey`**. Shown as a **labeled reference only** (Settings APR field + CB editBox) — NEVER
  overwrites the manual `cbAprPct` (Coinbase may add a spread; user observed ~4.89% Morpho vs ~5.15%
  Coinbase). `borrowApy` is a decimal fraction (×100 for %).
- **Coinbase:** spot via `api.coinbase.com` (`useBtcPrice`, direct — CORS-OK); candles via
  `api.exchange.coinbase.com` through the **`api/btc-candles` same-origin proxy**. **All `api/`
  functions run only on a Vercel deploy, NOT `npm run dev`.**
- **Power Law** `1.16e-17 × days^5.82`. **Morpho** liquidates instantly at 86% LLTV (no grace), LIF ≈
  1.04384. **Strike** 65% warning / 70% margin call / 85% partial liquidation (72h window).
- **Tokens:** `--bg-app` #09090E, `--bg-base` #09090E, `--bg-card` #111318, `--bg-input` #0D0E14,
  `--bg-hover` #13141F.
