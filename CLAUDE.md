# CLAUDE.md — Personal BLOC

## Project Overview

React + Vite + TypeScript app modeling Bitcoin accumulation strategies using Strike's Bitcoin Line of Credit (BLOC). Four tabs: **Living on Bitcoin**, **Smart BLOC**, **Power Law**, and **Sats** (converter).

Deployed to Vercel. Repo at `/Users/Brooks/Desktop/Personal-BLOC`.

---

## Tech Stack

- React 18 + Vite + TypeScript
- Zustand (global store) + `persist` middleware (localStorage)
- Recharts (charts)
- CSS Modules
- Vitest (tests)
- Vercel (deployment)

---

## File Structure

```
src/
  simulation/
    types.ts                    # BlocInputs, LivingInputs, StrategyResult, StrategyMonthData
    livingUtils.ts              # getBtcPrice (8-param, bear market aware)
    powerLaw.ts                 # Power Law formula constants + utility functions
    runNoBitcoin.ts
    runSellToLive.ts
    runSmartBLOC_Living.ts
    runMaxLeverage.ts
    runBLOC.ts                  # Smart BLOC tab simulation
    runSTS.ts                   # Save the Surplus (Smart BLOC tab)
    __tests__/
      smartBloc.test.ts         # 12 tests
      living.test.ts            # 27 tests

  hooks/
    useBtcPrice.ts              # Coinbase API, init-once store seed
    useSimulation.ts            # Smart BLOC tab hook
    useLivingSimulation.ts      # Living on Bitcoin tab hook
    usePowerLawData.ts          # Blockchain.com historical price + band generation
    useMempoolData.ts           # mempool.space block height (halving computed from it)

  store/
    useStore.ts                 # Zustand store — all state, persisted to localStorage

  utils/
    format.ts                   # fmtUSD (exact comma-formatted dollars)

  components/
    Layout/
      AppShell.tsx              # Grid shell, 4-tab bar, conditional sidebar/main
      AppShell.module.css
      SmartBlocMain.tsx         # Smart BLOC tab main panel
      SmartBlocMain.module.css

    ui/
      SliderInput.tsx           # Stacked layout: label → large value → slider → min/max
      SliderInput.module.css
      NumberInput.tsx           # Text input (Smart BLOC sidebar)
      NumberInput.module.css
      Toggle.tsx
      ScenarioPills.tsx
      GrowthPresetPills.tsx     # Conservative 30% / Moderate 50% / Historical 80%
      LtvTypePills.tsx          # Target 2% / Current 5% / High 10% / Hyper 20%

    Inputs/
      InputsPanel.tsx           # Smart BLOC sidebar (NumberInput-based)
      InputsPanel.module.css
      SettingsDropdown.tsx      # Fold CC toggle, APR, reward rate

    Summary/
      SummaryBar.tsx

    Collateral/
      TierCards.tsx             # Min / Rec / Ideal / Custom tier cards
      TierCards.module.css

    Playbook/
      MonthlyPlaybook.tsx
      PlaybookItems.tsx
      ProgressBar.tsx

    Charts/
      BtcStackChart.tsx
      NetEquityChart.tsx
      LTVSafetyChart.tsx

    LivingOnBitcoin/
      LivingOnBitcoin.tsx
      LivingOnBitcoin.module.css
      LivingInputsPanel.tsx     # SliderInput-based sidebar (stacked layout)
      LivingInputsPanel.module.css
      NetWorthChart.tsx         # 4-line Recharts LineChart, dynamic X/Y axes
      NetWorthChart.module.css
      ComparisonBanner.tsx      # Green banner: Smart BLOC vs Sell to Live
      ComparisonBanner.module.css
      StrategyCards.tsx         # 4-column single-row strategy cards
      StrategyCards.module.css
      StressTest.tsx            # Crash LTV bars
      StressTest.module.css

    PowerLaw/
      PowerLawMain.tsx
      PowerLawMain.module.css
      PowerLawChart.tsx         # Recharts log-log chart with 4 lines + Today reference
      PowerLawChart.module.css
      PowerLawSidebar.tsx       # Live model stats + block height + halving countdown
      PowerLawSidebar.module.css

    Converter/
      ConverterMain.tsx         # Three-way Sats/BTC/USD converter + reference table
      ConverterMain.module.css
      ConverterSidebar.tsx      # Live sats-per-dollar + key equivalences
      ConverterSidebar.module.css
```

---

## Zustand Store Shape (`useStore.ts`)

Wrapped with `persist` middleware — all state saved to `localStorage` key `'personal-bloc-store'`. Survives page refresh.

### Navigation
```typescript
activeTab: 'living' | 'bloc' | 'powerlaw' | 'converter';  // default 'living'
```

### Smart BLOC Tab
```typescript
income: number;              // default 4000
expenses: number;            // default 3000
btcPrice: number;            // seeded from Coinbase API on first fetch
activeTier: 'min' | 'rec' | 'ideal' | 'custom';  // default 'rec'
customCollateral: number;    // default 1.0
blocApr: number;             // default 13 (percent)
foldEnabled: boolean;        // default true
foldRate: number;            // default 1.5 (percent)
scenarioGrowth: number;      // default 50
```

### Living on Bitcoin Tab
```typescript
btcHoldings: number;         // default 0.7
annualBtcGrowth: number;     // default 50 (integer percent)
bearMarket: boolean;         // default false
bearPeriodYears: number;     // default 2
annualDecline: number;       // default -50 (integer percent)
inflationRate: number;       // default 2 (integer percent)
ltvType: 'target' | 'current' | 'high' | 'hyper';  // default 'current'
timeHorizonYears: number;    // default 1
```

### Sats Converter Tab
```typescript
converterActiveField: 'sats' | 'btc' | 'usd';  // default 'sats'
converterRawValue: string;                        // default '0'
```

---

## LTV Type Mapping (`useLivingSimulation.ts`)

```typescript
const LTV_TYPE_MAP = {
  target:  0.02,   // Target 2%
  current: 0.05,   // Current 5%
  high:    0.10,   // High 10%
  hyper:   0.20,   // Hyper 20%
};
```

Serves as BOTH trigger AND paydown target in `runSmartBLOC_Living`.

---

## Simulation Types (`types.ts`)

### `LivingInputs`
```typescript
interface LivingInputs {
  btcHoldings: number;
  startPrice: number;
  income: number;
  expenses: number;
  annualBtcGrowth: number;    // decimal (e.g. 0.50)
  apr: number;                // decimal (e.g. 0.13)
  inflationRate: number;      // decimal (e.g. 0.02)
  ltvCeiling: number;         // decimal (e.g. 0.05)
  timeHorizonMonths: number;  // years × 12
  bearMarket: boolean;
  bearPeriodMonths: number;   // bearPeriodYears × 12
  annualDecline: number;      // decimal (e.g. -0.50)
  capitalGainsTaxRate: number; // 0.30
}
```

### `StrategyResult`
```typescript
interface StrategyResult {
  label: string;
  color: string;
  monthlyData: StrategyMonthData[];
  finalBtcHeld: number;
  finalLocBalance: number;
  finalInterestPaid: number;
  finalTaxesPaid: number;
  finalNetWorthNominal: number;
  finalNetWorthReal: number;
  finalLtv: number;
  crashLtv: number;           // finalLtv / 0.20
  realReturn: number;
}
```

---

## Simulation Engines

### `getBtcPrice` (`livingUtils.ts`)
8-parameter, bear market aware. `timeHorizonMonths` and `annualBtcGrowth` kept for API compat — unused in body.
```
bearMarket=false: startPrice × (1 + monthlyGrowthRate)^month
bearMarket=true, month ≤ bearPeriodMonths: startPrice × (1 + monthlyDeclineRate)^month
bearMarket=true, month > bearPeriodMonths: troughPrice × (1 + monthlyGrowthRate)^(month - bearPeriodMonths)
monthlyDeclineRate = (1 + annualDecline)^(1/12) - 1
```

### `runNoBitcoin`
- `realReturn = (finalNetWorthReal - finalNetWorthNominal) / finalNetWorthNominal` (actual inflation erosion — NOT hardcoded `-inflationRate`)
- `finalNetWorthNominal` passed as `noBtcFinalNominal` to all other engines

### `runSellToLive`
- Taxes paid by selling BTC: `btcSoldForTaxes = taxesPaid / finalBtcPrice`
- `finalBtcHeld = btc - btcSoldForTaxes`
- `finalNetWorthNominal = finalBtcHeld × finalBtcPrice`

### `runSmartBLOC_Living`
- Trigger = `inputs.ltvCeiling`; paydown target = `inputs.ltvCeiling` (NOT hardcoded 0.15)
- Step order: interest capitalizes → draw expenses → LTV check → income buys BTC

### `runMaxLeverage`
- No paydowns; interest paid from income (NOT capitalized onto LoC)
- LoC grows from expenses only

---

## Verified Reference Values (5-year Strike reference)

Inputs: BTC=1.0, Price=$80,000, Income=$8,000, Expenses=$5,000, Growth=50%, APR=13%, LTV=Current 5%, Inflation=5%, Horizon=5yr, Bear=OFF

| Strategy | Net Worth (real) | BTC | LoC | Interest/Tax | Real Return |
|---|---|---|---|---|---|
| Max Leverage | $1,272,607 | ₿ 3.1674 | $300,000 | $99,125 | +389.5% |
| Smart BLOC | $986,908 | ₿ 2.1991 | $76,382 | $22,875 | +279.6% |
| Sell to Live | $826,935 | ₿ 1.7373 | — | $52,100 | +218.1% |
| No Bitcoin | $203,726 | 0 | — | — | −21.6% |

Stress Test: Max Leverage **78%** Margin Call, Smart BLOC **~29%** Safe.

---

## Power Law Model (`powerLaw.ts`)

```typescript
export const PL_B         = 5.82;
export const PL_A_FAIR    = 1.16e-17;
export const PL_A_FLOOR   = 0.42e-17;        // support band
export const PL_A_CEILING = 10 ** -16.12;    // ≈ 7.586e-17, resistance band
export const GENESIS      = new Date('2009-01-03T00:00:00Z');

// Each: A × daysSinceGenesis(date)^PL_B
plFairValue(date), plFloor(date), plCeiling(date), daysSinceGenesis(date)
```

**CRITICAL:** Use three independent A constants — never derive floor/ceiling as multipliers of fair value.

### Data Sources
- **Historical price:** `https://api.blockchain.info/charts/market-price?timespan=all&format=json&cors=true`
  - Parse: `{ timestamp: d.x * 1000, price: d.y }` (x is seconds → ms)
- **Block height:** `https://mempool.space/api/blocks/tip/height` (plain integer)
- **Halving:** Computed from block height — no API:
  ```typescript
  const nextHalvingBlock = Math.ceil((blockHeight + 1) / 210_000) * 210_000;
  const daysUntilHalving = Math.ceil((nextHalvingBlock - blockHeight) * 10 / (60 * 24));
  ```

### Chart (PowerLawChart.tsx)
- Recharts `ComposedChart`, `YAxis scale="log"`, `domain={[0.01, 100_000_000]}`
- Bands as primary axis; historical price snapped via binary search (±4 days)
- Tooltip order: Ceiling → Fair Value → Floor → spacer → BTC Price

---

## Sats Converter Tab

### Math
```
SATS_PER_BTC = 100_000_000
sats → btc:  sats / SATS_PER_BTC
sats → usd:  (sats / SATS_PER_BTC) × btcPrice
```

### Input State Pattern
- `converterActiveField` and `converterRawValue` in Zustand store (persistence)
- Local `useState` initialized from store for immediate UI response
- Both updated together: `updateActiveField()` and `updateRawValue()`
- `ConverterField` has local `isFocused`:
  - `true`: shows `rawValue` (editable)
  - `false`: shows `displayValue` (formatted, committed on blur/Enter)
  - Enter: `inputRef.current?.blur()`
- `displayValue` is ALWAYS formatted — never pass `rawValue` as `displayValue`
- Prefix always visible (no `active &&` guard)
- USD `displayValue`: `fmtUsdLocal(usd).replace(/^\$/, '')` prevents double `$`

---

## BTC/Sats Symbol Convention

- BTC amounts: `₿ {value} BTC` (prefix with space)
- Sats amounts: `丰 {value} SATS` or `丰 {value} sats` (prefix with space)
- Files: `PlaybookItems.tsx`, `LivingInputsPanel.tsx`, `StrategyCards.tsx`, `TierCards.tsx`, `ConverterMain.tsx`, `ConverterSidebar.tsx`

---

## BTC Price API (`useBtcPrice.ts`)

- **URL:** `https://api.coinbase.com/v2/prices/BTC-USD/spot`
- **Refresh:** 60s interval
- **Pattern:** `hasInitialized` ref — `setBtcPrice` called ONCE on first fetch
- **Returns:** `{ livePrice: number | null, lastUpdated: Date | null }`

---

## Dollar Formatting (`utils/format.ts`)

```typescript
// Shared — exact (no sign)
export const fmtUSD = (n) => '$' + Math.round(Math.abs(n)).toLocaleString();

// SummaryBar LOCAL — preserves sign (do NOT replace with shared fmtUSD)
function fmtUSD(n) { return (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString(); }

// Chart Y-axis ticks — abbreviated (NEVER exact, causes label overlap)
(v) => v >= 1_000_000 ? '$' + (v/1_000_000).toFixed(1) + 'M'
     : v >= 1_000     ? '$' + Math.round(v/1_000) + 'k' : '$' + v

// ComparisonBanner delta — abbreviated
const fmtDelta = (n) => n >= 1_000_000 ? '$' + (n/1_000_000).toFixed(1) + 'M'
                      : n >= 1_000     ? '$' + Math.round(n/1_000) + 'k'
                      : '$' + Math.round(n);
```

---

## UI Conventions

### SliderInput (Living on Bitcoin sidebar)
- Stacked layout: label row → 20px bold value display → slider → min/max
- `labelSuffix?: React.ReactNode` — used for LIVE badge
- Click value → text input (same 20px, orange underline); blur/Enter commits; Escape cancels
- Range `onChange` has `!editing` guard

### NumberInput (Smart BLOC sidebar)
- Local `raw` state; commits on blur/Enter; reverts on invalid

### LIVE Badge
- Both sidebars (Living: `labelSuffix`; Smart BLOC: JSX wrapper)
- Orange ≥ $1 from live price; green within $1; disabled (0.3 opacity) when null
- Click: `setBtcPrice(livePrice)`

### TierCards (Smart BLOC)
- 4 cards: Min (15%), Rec (5%), Ideal (2%), Custom; grid `repeat(4, 1fr)`
- Custom: local `customRaw` string state; `dayOneLtv = expenses / (btc × btcPrice)`; `crashLtv = dayOneLtv / 0.20`
- Active class: `styles.active`

### Bear Market Box
- Toggle row OUTSIDE the box
- Box only visible when `bearMarket === true`
- Red border/bg wraps: description + Bear Period slider + Annual Decline slider + trough note

### StrategyCards
- 4-column single row (not 2×2)
- Shows `finalNetWorthReal` (inflation-adjusted)
- BTC Held: `₿ {value} BTC`

### StressTest
- Bar label: `Math.ceil(crashLtv × 100)%` (crashLtv, NOT finalLtv)

### ComparisonBanner
- Renders only when `smartBloc.finalNetWorthNominal > sellToLive.finalNetWorthNominal`

### NetWorthChart
- Y-axis: `computeYTicks(min, max)` — 5–12 ticks from $2k step; anchors at 0 when `min < max × 0.25`
- X-axis intervals: ≤12mo→0, ≤24mo→1 (Mo), ≤36mo→2, ≤60mo→5, ≤96mo→8, >96mo→11 (Yr)

### AppShell
- 4 tabs; `₿ Smart BLOC` branding far right of tab bar
- Tab bar: `position: sticky; top: 0; background: var(--bg-base)`
- Sidebar, tab bar, main: all `var(--bg-base)` (unified)

---

## Design Tokens

```css
--orange: #E8836A  --green: #4ECB82  --red: #E85A4F  --amber: #E8A84A
--bg-base: darkest background (sidebar, tab bar, main)
--bg-card: slightly lighter (cards, chart boxes)
--text-primary, --text-secondary, --text-ghost, --text-muted, --text-faint
--border
```

---

## Test Suite

- 39 tests (12 smartBloc + 27 living) — all must pass before every commit
- `npx vitest run`
- Update expected values on algorithm changes — never revert fixes

---

## Build & Deploy

```bash
npx vitest run && git add . && git commit -m "..." && git push && vercel --prod
```

---

## Known Constraints

- **SummaryBar formatter:** Local only, preserves sign — never replace with shared `fmtUSD`
- **Chart Y-axis:** Always abbreviated — exact format causes label overlap
- **`getBtcPrice` unused params:** `timeHorizonMonths`, `annualBtcGrowth` kept for API compat — do not remove
- **`runNoBitcoin`:** Does NOT call `getBtcPrice` — no changes needed for bear market updates
- **Power Law A constants:** Always three independent values — never multiply fair × scalar for floor/ceiling
- **Converter `displayValue`:** Always formatted string — never pass `rawValue` as `displayValue`
- **Halving:** Computed from block height only — no second API endpoint
