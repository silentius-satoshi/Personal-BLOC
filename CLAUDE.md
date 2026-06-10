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
- Vitest (114 tests — all must pass before every commit)
- Vercel (deployment + serverless proxy for Power Law data)
- @dnd-kit/core + @dnd-kit/sortable + @dnd-kit/utilities (drag-and-drop tab reordering)
- PWA: `public/manifest.json` + `public/sw.js` (network-first service worker)

---

## File Structure

```
src/
  simulation/
    types.ts                    # SimInputs (optional creditLine), LivingInputs, StrategyResult
    livingUtils.ts              # getBtcPrice (8-param, bear market aware)
    powerLaw.ts                 # PL_B, PL_A_FAIR, PL_A_FLOOR, PL_A_CEILING, GENESIS + utils
    runNoBitcoin.ts
    runSellToLive.ts
    runSmartBLOC_Living.ts      # Living on Bitcoin tab simulation
    runMaxLeverage.ts
    runBLOC.ts                  # Smart BLOC 5-year simulation (respects creditLine ?? Infinity)
    runBlocYearOne.ts           # Month-by-Month 12-month simulation + getCollateralForTier
    runCoinbaseLoan.ts          # CB Loan simulation + classifyLtv + CbLtvStatus
    runAdvisor.ts               # Advisor simulation + tier helpers + strategy month calc
    strikeCredit.ts             # STRIKE_MAX_DRAW_LTV (0.50), strikeAvailableCredit = min(line, collateral×50%) − drawn
    logUtils.ts                 # recomputeBtcHeld, deriveAdvisorStart, deriveCurrentPosition, upsertEntry — standalone, no cross-sim imports
    mergeRecords.ts             # PURE per-month records merge (RecordsState, mergeRecords) — newest updatedAt/loggedAt wins, tombstones, 90-day GC
    __tests__/
      smartBloc.test.ts
      living.test.ts
      mining.test.ts
      monthlyLog.test.ts
      aprAnchors.test.ts
      strikeCredit.test.ts

  hooks/
    useBtcPrice.ts              # Coinbase API, 60s interval; syncs store on every fetch (gated by btcPriceMode); returns isStale (5-min threshold, 30s self-tick)
    useSimulation.ts            # Smart BLOC tab simulation hook
    useLivingSimulation.ts      # Living on Bitcoin tab hook
    usePowerLawData.ts          # Blockchain.com historical price (via Vercel proxy in prod)
    useMempoolData.ts           # mempool.space block height (halving computed from it)

  store/
    useStore.ts                 # Zustand store — all state, persisted to localStorage

  utils/
    format.ts                   # fmtUSD, fmtMining (sats-aware)

  components/
    Layout/
      AppShell.tsx              # ALL_TABS_META array, tab bar DndContext, sidebar/main routing,
                                # hiddenTabs guard useEffect, [data-active-tab] on shell div
      AppShell.module.css

    Tools/
      LiqSimulator.tsx          # Liq Price Simulator overlay content; reads store directly, no props
      LiqSimulator.module.css

    ui/
      SliderInput.tsx           # Stacked: label → value → slider → min/max
      NumberInput.tsx           # prefix/suffix/decimals props (avoid suffix inside input)
      Toggle.tsx
      ScenarioPills.tsx
      GrowthPresetPills.tsx
      LtvTypePills.tsx

    Inputs/
      InputsPanel.tsx           # Smart BLOC sidebar — .scrollArea + sticky .recommendations
      InputsPanel.module.css

    Settings/
      SettingsMain.tsx          # Tab visibility toggles + drag-to-reorder (⠿ handles only);
                                # Build row (5 taps toggles devMode) + DevPanel mount
      SettingsMain.module.css
      DevPanel.tsx              # Dev diagnostics (devMode only): sync state, signer probe, Nostr log ring,
                                # copy-diagnostics. METADATA ONLY — never balances/amounts/log contents
      DevPanel.module.css

    Summary/
      SummaryBar.tsx            # Smart BLOC summary (local sign-preserving fmtUSD)

    Collateral/
      TierCards.tsx             # Min/Rec/Ideal/Custom — 4-col grid
      TierCards.module.css

    MonthBreakdown/
      MonthBreakdown.tsx        # 12-month table, growth scenario toggle, credit line rec
      MonthBreakdown.module.css # Phase 1-4 left-border + legend, scenario toggle styles

    Charts/
      BtcStackChart.tsx
      NetEquityChart.tsx
      LTVSafetyChart.tsx

    LivingOnBitcoin/
      LivingOnBitcoin.tsx
      LivingInputsPanel.tsx
      NetWorthChart.tsx
      ComparisonBanner.tsx
      StrategyCards.tsx
      StressTest.tsx

    PowerLaw/
      PowerLawMain.tsx
      PowerLawChart.tsx         # Recharts log-log, YAxis scale="log"
      PowerLawSidebar.tsx

    Converter/
      ConverterMain.tsx
      ConverterSidebar.tsx

    Mining/
      MiningMain.tsx
      MiningMain.module.css
      MiningInputsPanel.tsx     # Per-device: hashrate, pool name, pool fee, solo toggle
      MiningProjectionTable.tsx # SAT ACCUMULATION scrubber + IF BTC REACHES + IF YOU FIND A BLOCK
      MiningOddsBar.tsx         # Reads devices from store directly

    CoinbaseLoan/
      CoinbaseLoanMain.tsx      # 7 sections: header, emergency banner, stat cards, LTV bar,
                                # alert thresholds, liquidation modeler, 12-month projection,
                                # emergency protocol, Strike vs Coinbase comparison
      CoinbaseLoanMain.module.css
      CoinbaseLoanSidebar.tsx
      CoinbaseLoanSidebar.module.css
      LiquidationModeler.tsx    # 4-scenario liquidation math; gated by cbLiquidationPrice > 0
      LiquidationModeler.module.css

    Advisor/
      AdvisorMain.tsx           # Progress bar, position cards, This Month's Plan (Pay/Skip),
                                # MonthlyLogSection, 12-month projection with BTC growth scenarios
      AdvisorMain.module.css
      AdvisorSidebar.tsx        # BTC LIVE badge, YOUR PROGRESS (start date, BLOC balance,
                                # BTC held), read-only summaries, priority rules
      AdvisorSidebar.module.css
      MonthlyLogSection.tsx     # Horizontal carousel + detail panel (full mode)
      MonthlyLogSection.module.css
      MonthlyLogOverlay.tsx     # Portal overlay (full-screen, both modes), keyboard + swipe nav
      MonthlyLogOverlay.module.css

    SimpleMode/
      SimpleModeView.tsx        # Simple Mode full-screen view (global simpleMode flag); single-commit model:
                                # "Log this month & continue" → ConfirmLogSheet portal (summary + editable
                                # expensesActual) → handleApply(confirmedExpenses). NDP as action line inside
                                # FROM CREDIT LINE when ndp.status !== 'ok'. Log carousel = 4-state badges
                                # (logged/current/unlogged/future). MonthlyLogSection allowInlineLog=false.
                                # Completion = LOGGED, not checklist tally: card keys on isLogged
                                # (monthlyLog.some(e => e.month === currentMonth)), NOT allDone. Log button
                                # stays available all active year (gated !strategyDone); emphasized
                                # (.logThisMonthBtnReady) once allDone. Completion card Undo UNLOGS via
                                # deleteLogEntry (pills left intact for one-tap re-log). No store change (v11).

api/
  btc-history.js               # Vercel serverless proxy for Blockchain.com (CORS workaround)

public/
  manifest.json                # PWA: name "Personal ₿LOC", theme #E8836A
  sw.js                        # Network-first service worker
  icon.svg                     # Dark bg, orange ₿
```

---

## Zustand Store Shape (`useStore.ts`)

### Navigation
```typescript
activeTab:   'living'|'bloc'|'powerlaw'|'converter'|'mining'|'coinbase'|'advisor'|'settings';
hiddenTabs:  string[];   // default ['coinbase', 'advisor']
tabOrder:    string[];   // default ['living','bloc','powerlaw','converter','mining','coinbase','advisor']
previousTab: Exclude<ActiveTab, 'settings'>;
```

### Smart BLOC Tab
```typescript
income:           number;   // default 4000
expenses:         number;   // default 3500
btcPrice:         number;   // updated every 60s fetch when btcPriceMode === 'live'
btcPriceMode:     'live' | 'manual';   // default 'live'; 'manual' suppresses live overwrites
activeTier:       'min' | 'rec' | 'ideal' | 'custom';  // default 'rec'
blocApr:          number;   // default 13 (percent)
foldEnabled:      boolean;  // default true
foldRate:         number;   // default 1.5 (percent)
scenarioGrowth:   number;   // default 50
creditLine:       number;   // default 10000
```

### Living on Bitcoin Tab
```typescript
btcHoldings:      number;   // default 0.7
annualBtcGrowth:  number;   // default 50
bearMarket:       boolean;  // default false
bearPeriodYears:  number;   // default 2
annualDecline:    number;   // default -50
inflationRate:    number;   // default 2
ltvType:          'target'|'current'|'high'|'hyper';  // default 'current'
timeHorizonYears: number;   // default 1
```

### Sats Converter Tab
```typescript
converterActiveField: 'sats'|'btc'|'usd';  // default 'sats'
converterRawValue:    string;               // default '0'
```

### Mining Tab
```typescript
miningInputs: {
  devices: Array<{
    id:               string;
    name:             string;
    enabled:          boolean;
    hashrateThsInput: number;
    wattsInput:       number;
    soloMining:       boolean;
    poolName:         string;   // cosmetic only
    poolFee:          number;   // drives EV math (percent)
  }>;
  electricityRateCents: number;
  networkHashrateEH:    number;
  btcBlockRewardBtc:    number;
}
```

### CB Loan Tab
```typescript
cbLoanBalance:       number;                       // default 60000
cbCollateralBtc:     number;                       // default 1.48
cbAprPct:            number;                       // default 4.77
cbMonthlyPayment:    number;                       // default 0
cbLiquidationPrice:  number;                       // default 0 (0 = not set; guard before calling compute fn)
cbPaymentStrategy:   'monthly' | 'ltvTriggered';  // default 'monthly'
cbLtvTriggerPct:     number;                       // default 75 (percent, e.g. 75 = 75%)
cbLtvTargetPct:      number;                       // default 65 (percent, pay down to this LTV)
```

### Advisor Tab
```typescript
advisorStartDate:         string;   // ISO date, default today
advisorActualBlocBalance: number;   // default 0 — month-0 baseline BLOC balance (empty-log fallback)
advisorActualBtcHeld:     number;   // default 0 — month-0 baseline BTC (empty-log fallback); current holdings = latest entry.btcHeld
advisorSkipBlocDraw:      boolean;  // default false (persisted)
advisorSkipCbPayment:     boolean;  // default false (persisted)
advisorSkipBtcBuying:     boolean;  // default false (persisted)
monthlyLog:               MonthlyLogEntry[];  // default []
showMiningInLog:          boolean;            // default false
```

---

## Tab Architecture (`AppShell.tsx`)

```typescript
const ALL_TABS_META = [
  { key: 'living',    fullLabel: 'Living on Bitcoin', shortLabel: 'LO₿'      },
  { key: 'bloc',      fullLabel: 'Smart BLOC',        shortLabel: '₿LOC'     },
  { key: 'powerlaw',  fullLabel: 'Power Law',         shortLabel: 'Power Law' },
  { key: 'converter', fullLabel: 'Sats',              shortLabel: '丰'        },
  { key: 'mining',    fullLabel: 'Miners',            shortLabel: 'Miners'    },
  { key: 'coinbase',  fullLabel: 'CB Loan',           shortLabel: 'CB'        },
  { key: 'advisor',   fullLabel: 'Advisor',           shortLabel: 'Adv'       },
];
```

Visible tabs = `tabOrder` ordered → filtered by `hiddenTabs`. Tab bar uses `DndContext` + `SortableContext` (horizontal, 5px activation threshold). Settings page uses vertical sortable with ⠿ handles. New keys not in `tabOrder` auto-append to end.

**`SettingsMain.tsx` has its own local `ALL_TABS` constant** — must be kept in sync with `ALL_TABS_META` when adding new tabs.

---

## Smart BLOC Sidebar (`InputsPanel.tsx`)

Flex-column panel with two sections:
- **`.scrollArea`** — scrollable inputs (income, expenses, BTC price, credit line, collateral, APR, Fold settings)
- **`.recommendations`** — sticky bottom panel:
  - Recommended min credit line: `Math.ceil(peakBalance × 1.10 / 500) × 500` where `peakBalance = max(uncapped runBlocYearOne rows)`. Green ✓ / orange ↑.
  - Break-even draw: `income / (1 + blocApr/100/12)`. Green ✓ when `expenses ≤ breakEven`.

Collateral input reads `getCollateralForTier(activeTier, expenses, btcPrice, advisorActualBtcHeld)`. Editing auto-switches to Custom tier. `advisorActualBtcHeld` is the single canonical BTC collateral field (formerly `customCollateral`, removed in store v6).

---

## Month-by-Month Breakdown

### `runBlocYearOne.ts`
```typescript
interface BlocYearOneInputs {
  collateralBtc: number; btcPrice: number; income: number; expenses: number;
  apr: number; ltvCeiling: number; creditLine: number; btcGrowthRate: number;
}
interface BlocMonthRow {
  month: number; phase: 1|2|3|4; creditExceeded: boolean;
  availableCredit: number; btcPriceThisMonth: number;
  // ...balance, ltv, paydown, btcBought, incomeTowardBtc
}
```

**Phase classification (strict priority):**
1. `creditExceeded === true` → Phase 4 (red) — credit maxed, cover expenses from fiat
2. `paydown > 0 && !firstPaydownSeen` → Phase 2 (amber) — first paydown
3. `paydown > 0` → Phase 3 (blue) — subsequent paydown
4. Otherwise → Phase 1 (green) — full BTC buying

**Draw algorithm:** `actualDraw = min(expenses, max(0, creditLine - balance))` → `balance += draw` → interest → LTV paydown → BTC buying.

**BTC growth:** `btcPriceThisMonth = btcPrice × (1 + btcGrowthRate)^((month-1)/12)`

**Recommended credit line:** run with `creditLine: Infinity` → `peakBalance × 1.10` rounded up to $500.

### Growth Scenario Toggle (local state)
Bear (−30%) / Flat (0%) / Power Law (dynamic) / Bull (+80%)
Power Law rate: `Math.pow((daysNow + 365.25) / daysNow, PL_B) - 1` ≈ 33% currently.

---

## CB Loan (`runCoinbaseLoan.ts`)

```typescript
type CbLtvStatus = 'safe'|'watch'|'warning'|'emergency'|'critical'|'liquidated';
// <0.55 / 0.55-0.65 / 0.65-0.70 / 0.70-0.84 / 0.84-0.86 / ≥0.86

// Per month: interest accrues → payment applied
// netChange = balance - prevBalance (positive = bad)
// isBreach = btcPrice <= threshold.price (highlights alert rows)
```

Morpho/Coinbase: 86% LLTV instant liquidation, no grace period, 4.38% penalty.

---

## Advisor (`runAdvisor.ts`)

### Priority Tiers (based on CB LTV start of month)
| Tier | CB LTV | BLOC Draw | Extra CB | BTC |
|---|---|---|---|---|
| 4 | < 55% | Full | None | Remaining |
| 3 | 55–65% | Full | 25% income | Remaining |
| 2 | 65–70% | 50% | 50% income | Remaining |
| 1 | ≥ 70% | $0 | 100% income | $0 |

```typescript
interface AdvisorInputs {
  btcPrice: number; income: number; expenses: number;
  blocApr: number; creditLine: number; blocLtvCeiling: number;
  cbBalance: number; cbCollateralBtc: number; cbAprPct: number; cbMonthlyPayment: number;
  cbPaymentStrategy: 'monthly' | 'ltvTriggered';
  cbLtvTriggerPct: number;   // percent, e.g. 75
  cbLtvTargetPct:  number;   // percent, e.g. 65
  startingBlocBalance: number; startingBtcHeld: number; startingMonth: number;
  btcGrowthRate: number;
}

// AdvisorMonthRow key fields (defined in runAdvisor.ts, not types.ts):
// cbPaydownDraw:      number  — BLOC draw used for CB paydown this month (0 if not triggered)
// cbLtvTriggered:     boolean — true when CB LTV trigger fired this month
// cbPaydownCapped:    boolean — paydown capped by remaining credit line (cb-paydown-cap)
// cbPaydownShortfall: number  — desired paydown minus capped paydown
// strikeRepayDraw:    number  — CB draw used to repay Strike on recovery (reverse rotation)
// strikeRepayFired:   boolean — true when Strike→CB reverse rotation fired
```

Per-month price: `btcPrice × Math.pow(1 + btcGrowthRate, (month - startingMonth) / 12)`

**Living projection:** `getCurrentStrategyMonth(startDate)`, `isStrategyComplete(startDate)` exported from `runAdvisor.ts`. Month 1 = first month after start date. Clamps to 12.

**Skip overrides:** `advisorSkipBlocDraw/CbPayment/BtcBuying` in store. `overriddenPlan` memo in `AdvisorMain.tsx` applies overrides to current month display only. BLOC paydown is mandatory (LTV-triggered, no skip).

**Income constraint:** `blocPaydown + cbPayment + btcIncome = income` always.

**Growth scenarios:** same 4 presets as MonthBreakdown — affects both BLOC LTV and CB LTV each month, can auto-resolve emergency tiers in Bull scenario.

---

## Mining Tab

Per-device: `soloMining`, `poolName` (cosmetic), `poolFee` (EV math). No hardcoded pool names.
- Electricity = fiat overhead, never deducted from sats
- `data-no-toggle` on sliders/toggles prevents card click-to-enable
- Strategy cards = fixed presets patching `soloMining`, independent of per-device state
- `MiningOddsBar` reads devices from store directly
- `fmtMining` sats math inlined in `format.ts`
- Projection scrubber in `MiningProjectionTable`, not sidebar

---

## Power Law (`powerLaw.ts`)

```typescript
export const PL_B = 5.82; PL_A_FAIR = 1.16e-17; PL_A_FLOOR = 0.42e-17;
export const PL_A_CEILING = 10 ** -16.12; GENESIS = new Date('2009-01-03T00:00:00Z');
```

Three independent A constants — never `PL_A_FAIR × scalar`. Data: Blockchain.com (dev direct, prod via `/api/btc-history` proxy). Block height: mempool.space. Halving computed from block height only.

---

## Dollar Formatting

```typescript
// Shared — exact, no sign
export const fmtUSD = (n) => '$' + Math.round(Math.abs(n)).toLocaleString();

// SummaryBar LOCAL — sign-preserving (NEVER replace with shared fmtUSD)
function fmtUSD(n) { return (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString(); }

// Chart Y-axis — abbreviated (exact causes label overlap)
(v) => v >= 1e6 ? '$' + (v/1e6).toFixed(1) + 'M' : v >= 1000 ? '$' + Math.round(v/1000) + 'k' : '$' + v
```

---

## NumberInput

`prefix` (e.g. `'$'` or `'₿'`) renders before the number. `suffix` renders inside the input — **avoid suffix for BTC amounts** (cursor issues). Omit `decimals` to let user type freely. Use an external label or hint for units instead.

---

## Design Tokens

```css
--orange: #E8836A  --green: #4ECB82  --red: #E85A4F  --amber: #E8A84A
--bg-base (darkest)  --bg-card (slightly lighter)
--text-primary / secondary / ghost / muted / faint  --border
```

---

## Mobile Responsive

- Tab bar: `overflow-x: auto`, short labels ≤640px
- All tables: wrapped in `overflow-x: auto; -webkit-overflow-scrolling: touch`
- 4-col grids (Tier, Strategy): `overflow-x: auto` container, keep 4 cols
- 3-col grids (Mining): same
- CB Loan stat grid: 2-col at ≤640px
- All `.main`: `padding: 16px` at ≤640px
- `[data-active-tab="bloc"] .sidebar`: `overflow: hidden; padding: 0` (InputsPanel handles internally)

---

## Test Suite

114 tests — `npx vitest run` before every commit.
- `smartBloc.test.ts` — uses `runBLOC` (not `runBlocYearOne`)
- `living.test.ts`
- `mining.test.ts`
- `monthlyLog.test.ts` — includes recomputeBtcHeld suite + 4 badge status tests
- `mergeRecords.test.ts` — per-month merge table: union, newest-wins, loggedAt fallback, tie rule, tombstones, 90-day GC, string-key coercion
- `aprAnchors.test.ts` — pins APR unit conventions (runCoinbaseLoan=percentage, runBlocYearOne=decimal)
- `strikeCredit.test.ts` — strikeAvailableCredit = min(line, collateral×50%) − drawn
- `src/lib/nostr/__tests__/sync.test.ts` — settings watermarks, records merge-apply (legacy array + v2 payload), relay-behind dirty flag, publishEncrypted first-ACK
- `src/lib/nostr/__tests__/log.test.ts` — nostrLog ring: 50-cap, newest-last, clear

When `BlocYearOneInputs` gains new required fields, add defaults (e.g. `btcGrowthRate: 0`) to any test fixtures.

---

## Build & Deploy

```bash
npm run build && npx vitest run && git add . && git commit -m "..." && git push   # Vercel auto-deploys on push (local vercel CLI removed)
```

`npm run build` = `tsc -b && vite build` — this is the REAL typecheck gate. Run it (not bare `tsc`) before every commit.

**⚠️ The typecheck gate:** root `tsconfig.json` is references-only (`"files": []`), so `tsc` / `tsc --noEmit` is a NO-OP that compiles nothing and always reports 0 — it never catches type errors. The real typecheck is **`npx tsc -b`** (build mode, what `npm run build` runs). Vercel's `vite build` strips types with esbuild and does **not** typecheck, so type errors only surface via `tsc -b` locally.

`vercel.json`: `{ "buildCommand": "vite build", "outputDirectory": "dist", "framework": "vite" }`

**Build-version display:** `__BUILD_SHA__` / `__BUILD_TIME__` vite `define` constants (vite.config.ts:
Vercel `VERCEL_GIT_COMMIT_SHA` → local `git rev-parse --short HEAD` fallback → `'dev'`), ambient
declarations in `src/vite-env.d.ts`, rendered at the bottom of Settings (`.buildInfo`).

**⚠️ Cross-device testing:** before ANY cross-device smoke test, confirm both devices show the same
Build SHA in Settings — iOS home-screen PWAs are known to serve stale bundles after deploys; kill +
relaunch (or reinstall) the PWA until the SHA matches the latest deploy. With dev mode on, smoke-test
reports should include the Copy Diagnostics output from the failing device.

**Dev mode:** 5 taps on the Settings Build row toggles `devMode` (persisted, DEVICE-LOCAL — never synced,
not in SETTINGS_FIELDS or the settings payload). DevPanel shows: sync state (metadata), signer probe
(nip44 encrypt→decrypt round-trip — on nip46 may surface a Primal approval), the Nostr log ring
(sessionStorage `'bloc-nostr-log'`, 50 entries, survives reloads, dies with the PWA), and copy-diagnostics.
**Privacy rule:** diagnostics/log contain sync metadata only — never balances, amounts, incomes, expenses,
or log-entry contents. `nostrLog()` (lib/nostr/log.ts) is the standard for Nostr-layer logging (console
mirror + ring) — new code uses it instead of bare console.warn.

---

## Nostr Integration (Steps 1–3 ✅ Complete)

### Status

| Step | Description | Status |
|---|---|---|
| Step 1 | Auth gate — Nostr identity login | ✅ Complete |
| Step 2 | Encrypted relay publishing | ✅ Complete |
| Step 3 | Cross-device sync | ✅ Complete |
| Step 4 | publishRecords (monthlyLog) | ✅ Complete |

---

### Login Paths

| Method | Function | Notes |
|---|---|---|
| NIP-07 browser extension | NLogin.fromExtension() | Desktop; auto-restores on reload |
| Remote signer QR | NLogin.fromNostrConnect() | Desktop QR scanned with Primal iOS; persists across reload (nostrLogin) |
| Remote signer deep link | NLogin.fromNostrConnect() | Mobile two-step: warm relay → tap Open Signer App → approve → callback; persists across reload |

---

### Dependency Stack (version pins are hard requirements)

nostr-tools: 2.23.5    ← pinned exact; NIP-44 + Primal decrypt verified working at this version
@nostrify/nostrify: ^0.52.2
@nostrify/react: ^0.6.2
websocket-ts: 2.3.0    ← pinned exact as a DIRECT dep at the tree-resolved version (no dupe copy);
                         used to cap NRelay1's reconnect backoff (see NostrProvider)

---

### Key Files

```
src/
  providers/
    NostrProvider.tsx               # NPool + NRelay1 context; wrap root in main.tsx. Reconnect backoff capped
                                    # via ExponentialBackoff(1000, 4) → max 16s between attempts (nostrify
                                    # default is UNBOUNDED doubling — strands NIP-46 after an offline period)
  pages/
    RemoteLoginSuccessPage.tsx      # Callback page Primal opens after approval
  components/Auth/
    NostrAuthGate.tsx               # Auth gate; NLogin.fromNostrConnect() wiring; calls markSignerFresh()
                                    # after setting the signer so syncNow doesn't rebuild a duplicate
                                    # NConnectSigner session post-login
  hooks/
    useNostrAutoRestore.ts          # Optimistic session restore on reload — NIP-07 AND NIP-46 (via nostrLogin)
  lib/nostr/
    publish.ts                      # publishEncrypted (→ Promise<number>), publishSettings, publishRecords (RecordsPayload v2)
    session.ts                      # restoreSigner — rebuild signer from persisted login (no fetch/sync); exports NostrParam
    log.ts                          # nostrLog ring buffer — pure; console mirror + sessionStorage 'bloc-nostr-log'
                                    # (50 entries, survives reloads, dies with the PWA); the STANDARD for
                                    # Nostr-layer logging — use it instead of bare console.warn
    timeout.ts                      # withTimeout + signerOpTimeout — pure (store-free); method-aware signer-op
                                    # timeouts: nip46 20s / nip07 60s (human approval popup)
    sync.ts                         # fetchAndSync; settings watermark + records per-month MERGE (mergeRecords) + decrypt-failure surfacing (breaks loop on first decrypt fail)
    syncNow.ts                      # THE single unified sync sequence — all entry points call this (restore-if-needed → relays-if-empty → fetch+merge → publish-if-dirty)
    relays.ts                       # fetchUserRelays; NIP-65 kind:10002 discovery
    disconnect.ts                   # disconnectNostr — clears state + window.location.reload() to flush NPool
    signers.ts                      # connectNip07 only (connectNip46/connectNip46QR + SignerContext deleted)

vercel.json                         # Catch-all rewrite → index.html (required for SPA)
```

---

### Publishing Architecture

- `publishEncrypted()` — NIP-44 self-encrypt → kind:30078 → returns the published `created_at` on the
  FIRST relay ACK; other relays continue in the background; pool closes after ALL settle; 12s timeout;
  rejects AggregateError only if every relay rejects (watermark must not be stamped for a lost event)
- `syncSettingsToNostr()` — settings publish debounced (verify value in code); dynamic imports `publish.ts`
  to avoid circular dep; on success/failure toggles `nostrReconnectNeeded` false/true
- `publishRecordsNow()` — exported from the store; immediate (no debounce); publishes the v2
  `RecordsPayload` `{ entries: monthlyLog, deletions: deletedMonths }`; clears `recordsDirty` +
  `nostrReconnectNeeded` on success, sets `nostrReconnectNeeded` on failure (dirty stays true)
- `FALLBACK_RELAYS`: damus, primal, nos.lol (used if NIP-65 discovery fails)
- NIP-65 relay discovery: `syncNow` fetches the user's kind:10002 when `nostrRelays` is empty and
  stores it; subsequent publishes go to the user's own relays

---

### Sync Architecture

- **All entry points call the single `syncNow(nostr)`** (lib/nostr/syncNow.ts): restore-signer-if-needed
  (NIP-46 rebuild throttled ~20s, also covers cold-mount restore) → relays-if-empty → fetch+merge →
  publish-if-dirty. Pull-merge-THEN-push — with merge-based receive this is safe and publishes the
  merged superset. Returns boolean (auto-restore reverts optimistic auth only if it failed with no signer).
- Deduplicates relay events: takes highest `created_at` per d-tag before
  decrypting (prevents stale relay copies from overwriting fresh data)
- **Records receive is MERGE-based and unconditionally safe** (`mergeRecords`, per month): newest
  `updatedAt` (fallback `loggedAt`) wins; exact tie → local iff `recordsDirty`; tombstoned deletes
  (`deletedMonths`) beat older entries; entry newer than tombstone survives (re-log) and drops it;
  90-day tombstone GC. After merge: apply only if merged ≠ local (re-chained via `recomputeBtcHeld`);
  set `recordsDirty` if relay is missing something we have. NO receive gates.
- Settings hydrate on watermark only: `remoteTs > lastSettingsSyncAt` (whole-object LWW)
- Decrypt-failure surfacing: if an event fails to decrypt (signer unreachable) `nostrReconnectNeeded`
  is set; a successful decrypt clears it
- Signer-op timeouts are METHOD-AWARE via `signerOpTimeout()` (`src/lib/nostr/timeout.ts`, pure/store-free):
  nip46 20s (automated — rides out one capped relay-backoff window) / nip07 60s (human approval popup per op;
  a short timeout races the user's click). Wraps `nip44` decrypt/encrypt + `signEvent`; the decrypt loop
  **breaks on the first decrypt failure** (remaining events would fail identically). The nip07 RESTORE race
  in session.ts is also 60s. The 12s relay-publish timeout in publishEncrypted is separate and unchanged.
- Orange dot (`nostrSyncing`) shows during both publish and sync operations — hidden while
  `nostrReconnectNeeded` (the reconnect/re-authorize button replaces it at bottom-right)

---

### Sync Triggers
Four entry points — all funnel into `syncNow()`:

| Trigger | Path |
|---|---|
| Login | NostrAuthGate ×3 (NIP-07, bunker URI, NostrConnect QR/deep link) → fire-and-forget `syncNow(nostr)` |
| Cold launch | `useNostrAutoRestore` (optimistic auth, reverts only if restore failed with no signer) |
| Tab visibility | `useNostrSync` visibilitychange → visible |
| Manual button | "↻ Sync now" in Settings (via `useNostrSync().triggerSync`) |

- Reconnect affordance is **two-stage**: first tap retries (`triggerSync`); only if the retry still
  fails does the button escalate to "⚠ Re-authorize" (`reconnectNostr`) — transient failures recover
  without burning a NIP-46 session
- (Pull-to-refresh was removed — gesture + usePullToRefresh.ts deleted)

---

### Published Event Types

| d-tag | Contents | Trigger |
|---|---|---|
| `personal-bloc:settings:v1` | All 22 settings fields (incl. `advisorChecklist`) | Any synced setter (debounced — verify value in code) |
| `personal-bloc:records:v1` | Payload schema v2 `{ entries, deletions }` (legacy bare array readable); entries carry `updatedAt?` (merge falls back to `loggedAt`); per-month merge — newest wins, tombstoned deletes, 90-day tombstone GC | Immediately after every upsert/delete (no debounce) via `publishRecordsNow` |

### All 22 Synced Settings Fields
`income`, `expenses`, `blocApr`, `creditLine`, `advisorStartDate`,
`advisorActualBlocBalance`, `advisorActualBtcHeld`, `advisorChecklist`, `cbLoanBalance`,
`cbCollateralBtc`, `cbAprPct`, `hasCbLoan`, `ndpLastPaidDate`,
`tabOrder`, `hiddenTabs`, `simpleMode`, `btcBuyingUnit`,
`cbLiquidationPrice`, `cbMonthlyPayment`, `cbPaymentStrategy`,
`cbLtvTriggerPct`, `cbLtvTargetPct`
(`advisorChecklist` syncs the monthly Pay/Skip state so Simple Mode "THIS MONTH" ₿ matches across devices.)

---

### Zustand Store Fields (Nostr)

| Field | Type | Persisted | Notes |
|---|---|---|---|
| `nostrAuthEnabled` | boolean | ✅ | Gate toggle |
| `nostrPubkey` | string | ✅ | Hex pubkey |
| `nostrSigningMethod` | `'nip07' \| 'nip46' \| null` | ✅ | Login path used |
| `nostrBunkerUri` | string | ✅ | NIP-46 reconnect |
| `nostrRelays` | string[] | ✅ | From NIP-65 discovery |
| `lastSettingsSyncAt` | number | ✅ | Unix ts of last relay hydration |
| `lastRecordsSyncAt` | number | ✅ | Unix ts of last records:v1 event seen — observability ONLY, not a gate |
| `recordsDirty` | boolean | ✅ | Publish-needed marker + merge tie-breaker ONLY (NOT a receive gate); set on local edit or when the relay is behind; cleared on successful publish |
| `deletedMonths` | Record<number, number> | ✅ | month → deletedAt (Unix ms) tombstones for synced deletes; cleared per-month on re-log; 90-day GC in merge |
| `nostrLogin` | string | ✅ | JSON NIP-46 login (bunkerPubkey/clientNsec/relays/pubkey) — reconnect-free restore |
| `nostrSigner` | NostrSigner | ❌ | In-memory; recreated on restore |
| `isAuthenticated` | boolean | ❌ | In-memory; reset on reload |
| `nostrSyncing` | boolean | ❌ | In-memory; UI loading state |
| `nostrReconnectNeeded` | boolean | ❌ | In-memory; set on decrypt/publish failure → shows ⚠ Reconnect affordance (AppShell) |

---

## Critical Constraints

| Constraint | Rule |
|---|---|
| `SummaryBar fmtUSD` | Local sign-preserving — NEVER replace with shared version |
| Power Law A constants | Three independent values — never `PL_A_FAIR × scalar` |
| Mining electricity | Fiat overhead — 100% sats kept, never deducted |
| Mining strategy cards | Fixed presets — independent of per-device `soloMining` |
| `MiningOddsBar` | Reads store directly — not props |
| `fmtMining` | Inlined in `format.ts` — no circular import |
| `fiatGap` field | Named `fiatGap` in `AdvisorMonthRow` — never `fatGap` |
| `deriveAdvisorStart` / `deriveCurrentPosition` | Anchor to `last.btcHeld` (absolute); standalone — no imports from runAdvisor/runBLOC/runBlocYearOne |
| `publishRecords` cadence | Immediate via `publishRecordsNow` (no debounce); NOT triggered by `setMonthlyLog` |
| Records merge | Records receive is MERGE-based and unconditionally safe (`mergeRecords`); `recordsDirty` = publish-needed marker + merge tie-breaker ONLY (not a receive gate); `lastRecordsSyncAt` = observability only |
| Settings LWW | Settings remain whole-object last-write-wins — last publisher wins the FULL object, incl. `advisorChecklist` |
| Nostr reliability fix | Foreground/launch NIP-46 signer rebuild (`restoreSigner`, throttled ~20s inside `syncNow`) + merge-based receive + immediate records publish + decrypt-failure `nostrReconnectNeeded`; store stays v11 (no migration — `updatedAt?` optional, `deletedMonths` defaults `{}`) |
| Zustand v7 migration | Removes `customCollateral`; seeds `advisorActualBtcHeld` from it as fallback; adds `cbPaymentStrategy/TriggerPct/TargetPct` with defaults |
| Zustand v8 migration | Adds `btcPriceMode: 'live' \| 'manual'` (default `'live'`); typing a BTC price flips to `'manual'`; LIVE/SYNC button restores `'live'` |
| Zustand v9 migration | Adds `lastRecordsSyncAt` (seeded from old shared `lastSettingsSyncAt`) + `lastLocalChangedAt`; independent per-d-tag watermarks |
| Zustand v10 migration | Adds `nostrLogin` (JSON NIP-46 login) for session restore across reload |
| Zustand v11 migration | Adds `MonthlyLogEntry.btcHeld` (absolute) + `expensesActual`; resets `advisorActualBtcHeld` to month-0 baseline; current holdings = latest entry.btcHeld. Current store version = 11 |
| `ltvTriggered` mode | Suspends CB priority rules (tier halve/stop draw); trigger IS the safety mechanism; `cbPaydownDraw` added to `blocBalance`; no CB payment from income |
| `MonthlyLogOverlay` | React portal to `document.body` — same pattern as ToolsDropdown |
| `strikeLtv` storage | Decimal (0.1483); multiply ×100 for display, divide ÷100 on save |
| Phase 4 priority | `creditExceeded` checked FIRST in phase classification |
| BLOC draw order | Draw → interest → LTV paydown (not interest → draw) |
| `runAdvisor` | Standalone — no imports from `runBLOC` or `runCoinbaseLoan` |
| `getCollateralForTier` | Uses starting `btcPrice` — not per-month price |
| Chart Y-axis | Always abbreviated — exact format causes label overlap |
| `NumberInput` suffix | Avoid inside input — cursor issues; use external label |
| Skip fields | Persisted in store — reset only when user toggles back to Pay |
| Tab hidden guard | `useEffect` in `AppShell` redirects when active tab hidden |
| `SettingsMain` ALL_TABS | Keep in sync with `AppShell` `ALL_TABS_META` |
| `computeLiquidationAnalysis` | Standalone — no imports from runBLOC/runAdvisor/runBlocYearOne |
| `cbLiquidationPrice` | Synced to Nostr (settings payload) along with cbMonthlyPayment/cbPaymentStrategy/cbLtvTriggerPct/cbLtvTargetPct; 0 = not set; guard with `liquidationPrice === 0` check before rendering modeler |
| `disconnectNostr` | Full sign-out — clears all nostr state INCL. `nostrAuthEnabled` (disables the lock), then `window.location.reload()` to rebuild NPool clean; in lib/nostr/disconnect.ts |
| `reconnectNostr` | Revoke-recovery — clears the session but KEEPS `nostrAuthEnabled`, then reloads → auth gate lands on the NIP-46 login (open signer app → re-approve); the bottom-right `⚠ Reconnect` affordance AND the Settings "Reconnect" button both call it; in lib/nostr/disconnect.ts |
| nostr-tools pin | EXACT 2.23.5 — verified with Primal NIP-44; do NOT downgrade to 2.13 (breaks @nostrify peer compat) |
| NIP-46 mobile login | Two-step manual launch — relay warms in foreground BEFORE the deep-link; auto-firing breaks the handshake |
| `STRIKE_MAX_DRAW_LTV` | 0.50 in strikeCredit.ts; available = min(creditLine, collateral×price×0.50) − drawn |
