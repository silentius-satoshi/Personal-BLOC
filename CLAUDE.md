# CLAUDE.md — Personal BLOC

## Project Overview

React + Vite + TypeScript app modeling Bitcoin accumulation strategies using Strike's Bitcoin Line of Credit (BLOC). Two tabs: **Living on Bitcoin** (compare 4 strategies) and **Smart BLOC** (5-year planning tool).

Deployed to Vercel. Repo at `/Users/Brooks/Desktop/Personal-BLOC`.

---

## Tech Stack

- React 18 + Vite + TypeScript
- Zustand (global store)
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

  store/
    useStore.ts                 # Zustand store — all state

  utils/
    format.ts                   # fmtUSD (exact comma-formatted dollars)

  components/
    Layout/
      AppShell.tsx              # Grid shell, tab bar, conditional sidebar/main
      AppShell.module.css
      SmartBlocMain.tsx         # Smart BLOC tab main panel
      SmartBlocMain.module.css

    ui/
      SliderInput.tsx           # Range slider + click-to-edit + labelSuffix prop
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
      LivingInputsPanel.tsx     # SliderInput-based sidebar
      LivingInputsPanel.module.css
      NetWorthChart.tsx         # 4-line Recharts LineChart
      NetWorthChart.module.css
      ComparisonBanner.tsx      # Green banner: Smart BLOC vs Sell to Live
      ComparisonBanner.module.css
      StrategyCards.tsx         # 2×2 grid of strategy result cards
      StrategyCards.module.css
      StressTest.tsx            # Crash LTV bars
      StressTest.module.css
```

---

## Zustand Store Shape (`useStore.ts`)

### Smart BLOC Tab
```typescript
// Inputs
income: number;              // default 4000
expenses: number;            // default 3000
btcPrice: number;            // seeded from Coinbase API on first fetch
activeTier: 'min' | 'rec' | 'ideal' | 'custom';  // default 'rec'
customCollateral: number;    // default 1.0
blocApr: number;             // default 13 (percent)
foldEnabled: boolean;        // default true
foldRate: number;            // default 1.5 (percent)
scenarioGrowth: number;      // default 50

// Setters: setIncome, setExpenses, setBtcPrice, setActiveTier,
//          setCustomCollateral, setBlocApr, setFoldEnabled, setFoldRate, setScenarioGrowth
```

### Living on Bitcoin Tab
```typescript
// Inputs
btcHoldings: number;         // default 0.7
annualBtcGrowth: number;     // default 50 (integer percent)
bearMarket: boolean;         // default false
bearPeriodYears: number;     // default 2
annualDecline: number;       // default -50 (integer percent)
inflationRate: number;       // default 2 (integer percent)
ltvType: 'target' | 'current' | 'high' | 'hyper';  // default 'current'
timeHorizonYears: number;    // default 1

// Setters: setBtcHoldings, setAnnualBtcGrowth, setBearMarket,
//          setBearPeriodYears, setAnnualDecline, setInflationRate,
//          setLtvType, setTimeHorizonYears
```

### Shared
```typescript
activeTab: 'living' | 'bloc';  // default 'living'
setBtcPrice: (v: number) => void;  // shared between tabs
setActiveTab: (v: 'living' | 'bloc') => void;
```

---

## LTV Type Mapping (`useLivingSimulation.ts`)

Matches Strike's reference values:
```typescript
const LTV_TYPE_MAP = {
  target:  0.02,   // Target 2%
  current: 0.05,   // Current 5%
  high:    0.10,   // High 10%
  hyper:   0.20,   // Hyper 20%
};
```

The selected LTV type becomes `ltvCeiling` in `LivingInputs` and serves as BOTH the trigger threshold AND the paydown target in `runSmartBLOC_Living`.

---

## Simulation Types (`types.ts`)

### `LivingInputs`
```typescript
interface LivingInputs {
  btcHoldings: number;        // starting BTC
  startPrice: number;         // BTC price at start
  income: number;             // monthly income
  expenses: number;           // monthly expenses
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
  realReturn: number;         // (finalNetWorthReal - noBtcFinalNominal) / noBtcFinalNominal
}
```

---

## Simulation Engines

### `getBtcPrice` (`livingUtils.ts`)
8-parameter function. Bear market aware.
```typescript
function getBtcPrice(
  month: number,
  startPrice: number,
  monthlyGrowthRate: number,    // (1 + annualBtcGrowth)^(1/12) - 1
  bearMarket: boolean,
  timeHorizonMonths: number,    // kept for API compat, unused
  annualBtcGrowth: number,      // kept for API compat, unused
  bearPeriodMonths: number,
  annualDecline: number,        // decimal, e.g. -0.50
): number

// Logic:
// bearMarket=false: startPrice × (1 + monthlyGrowthRate)^month
// bearMarket=true, month ≤ bearPeriodMonths: startPrice × (1 + monthlyDeclineRate)^month
// bearMarket=true, month > bearPeriodMonths: troughPrice × (1 + monthlyGrowthRate)^(month - bearPeriodMonths)
// where monthlyDeclineRate = (1 + annualDecline)^(1/12) - 1
```

### `runNoBitcoin`
- Sells all BTC at startPrice for cash
- Accumulates monthly surplus (income − expenses) as cash
- `finalNetWorthNominal = cashBalance`
- `finalNetWorthReal = finalNetWorthNominal / cumulativeInflation`
- `realReturn = (finalNetWorthReal - finalNetWorthNominal) / finalNetWorthNominal`
  (measures inflation erosion — NOT hardcoded to -inflationRate)
- This result's `finalNetWorthNominal` is passed as `noBtcFinalNominal` to other engines

### `runSellToLive`
- Starts with `btcHoldings`
- All income buys BTC each month
- All expenses sell BTC each month
- Tax: `max(0, (cumulativeDollarSold - cumulativeBtcSold × startPrice)) × 0.30`
- Taxes paid by selling BTC at finalBtcPrice: `btcSoldForTaxes = taxesPaid / finalBtcPrice`
- `finalBtcHeld = btc - btcSoldForTaxes`
- `finalNetWorthNominal = finalBtcHeld × finalBtcPrice`
- `realReturn = (finalNetWorthReal - noBtcFinalNominal) / noBtcFinalNominal`

### `runSmartBLOC_Living`
- Starts with `btcHoldings`
- Monthly step order: interest capitalizes → draw expenses → LTV check → income buys BTC
- **LTV trigger = `inputs.ltvCeiling`** (NOT hardcoded 0.15)
- **Paydown target = `inputs.ltvCeiling`** (pay down to the same threshold)
  ```
  if (loc / collateralValue > inputs.ltvCeiling) {
    paydown = Math.min(income, loc - collateralValue * inputs.ltvCeiling);
  }
  ```
- No Fold CC rewards on this tab
- `crashLtv = finalLtv / 0.20`
- `realReturn = (finalNetWorthReal - noBtcFinalNominal) / noBtcFinalNominal`

### `runMaxLeverage`
- No LTV ceiling — never triggers paydown
- Interest paid from income (NOT capitalized onto LoC)
  ```
  const interest = loc * monthlyApr;
  availableForBtc = Math.max(0, income - interest);
  loc += expenses;  // LoC only grows from expenses
  ```
- `crashLtv = finalLtv / 0.20`
- `realReturn = (finalNetWorthReal - noBtcFinalNominal) / noBtcFinalNominal`

---

## Verified Reference Values

### 1-year baseline (from original spec)
Inputs: Income=$3,500, Expenses=$3,000, BTC=0.7, Price=$80,000, Growth=50%, APR=13%, LTV=5%, Inflation=2%, Horizon=1yr, Bear=OFF

| Strategy | Net Worth (nominal) | BTC | LoC | Interest/Tax | LTV | Real Return |
|---|---|---|---|---|---|---|
| No Bitcoin | $62,000 | 0 | — | — | — | −2.0% |
| Sell to Live | ~$87,165 | ~0.741 | — | ~$2,070 tax | — | +40.6% |
| Smart BLOC | ~$90,638 | ~0.843 | ~$8,729 | ~$1,052 | ~8.6% | +46.2% |
| Max Leverage | ~$94,156 | ~1.100 | ~$36,000 | ~$2,535 | ~27.3% | +51.9% |

### 5-year Strike reference (target values post-algorithm-fixes)
Inputs: BTC=1.0, Price=$80,000, Income=$8,000, Expenses=$5,000, Growth=50%, APR=13%, LTV=Current 5%, Inflation=5%, Horizon=5yr, Bear=OFF

| Strategy | Net Worth (real) | BTC | LoC | Interest/Tax | Real Return |
|---|---|---|---|---|---|
| Max Leverage | $1,272,607 | 3.1674 | $300,000 | $99,125 | +389.5% |
| Smart BLOC | $986,908 | 2.1991 | $76,382 | $22,875 | +279.6% |
| Sell to Live | $826,935 | 1.7373 | — | $52,100 | +218.1% |
| No Bitcoin | $203,726 | 0 | — | — | −21.6% |

Stress Test: Max Leverage **78%** Margin Call, Smart BLOC **~29%** Safe.
Final BTC price: $607,500. Inflation factor: 1.27628.

---

## Key Formulas

```
finalBtcPrice = startPrice × (1 + annualBtcGrowth)^timeHorizonYears
cumulativeInflation = (1 + inflationRate)^timeHorizonYears
crashLtv = finalLtv / 0.20
realReturn = (finalNetWorthReal - noBtcFinalNominal) / noBtcFinalNominal
noBtcNominal = btcHoldings × startPrice + (income - expenses) × timeHorizonMonths
```

---

## BTC Price API (`useBtcPrice.ts`)

- **URL:** `https://api.coinbase.com/v2/prices/BTC-USD/spot`
- **Parse:** `parseFloat(response.data.amount)`
- **Refresh:** 60s interval
- **Pattern:** `hasInitialized` ref — `setBtcPrice` called ONCE on first fetch only.
  Subsequent fetches update `livePrice` state only (preserves manual slider adjustments).
- **Returns:** `{ livePrice: number | null, lastUpdated: Date | null }`

---

## Dollar Formatting (`utils/format.ts`)

```typescript
// Shared utility — exact comma-formatted dollars
export const fmtUSD = (n: number): string =>
  '$' + Math.round(Math.abs(n)).toLocaleString();

// SummaryBar uses a LOCAL sign-preserving variant (not imported):
function fmtUSD(n: number): string {
  return (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString();
}

// Chart Y-axis ticks use inline abbreviated lambda (NOT fmtUSD):
(v: number) => v >= 1_000_000
  ? '$' + (v / 1_000_000).toFixed(1) + 'M'
  : v >= 1_000
  ? '$' + Math.round(v / 1_000) + 'k'
  : '$' + v

// ComparisonBanner delta uses local abbreviated formatter:
const fmtDelta = (n: number): string =>
  n >= 1_000_000 ? '$' + (n / 1_000_000).toFixed(1) + 'M'
  : n >= 1_000 ? '$' + Math.round(n / 1_000) + 'k'
  : '$' + Math.round(n);
```

---

## UI Conventions

### SliderInput
- Props: `label, value, onChange, min, max, step, display, minLabel?, maxLabel?, labelSuffix?`
- `labelSuffix` rendered inside `.labelGroup` flex span — used for LIVE badge
- Click-to-edit: clicking `display` span opens text input with orange underline
- Range onChange has `!editing` guard to prevent overwriting during text edit
- Commit on blur/Enter; Escape cancels; clamps to min/max

### NumberInput (Smart BLOC sidebar)
- Local `raw` string state + `useEffect` sync from store value
- Commits on blur/Enter via `parseFloat` + clamp
- Reverts to stored value on invalid input
- No debounce

### LIVE Badge
- Shown next to BTC Price in BOTH sidebars (Living via `labelSuffix`, Smart BLOC via JSX wrapper)
- Orange when `Math.abs(btcPrice - livePrice) >= 1`
- Green when synced (within $1)
- Disabled (opacity 0.3) when `livePrice === null`
- Click: `setBtcPrice(livePrice)`

### TierCards (Smart BLOC)
- 4 cards: Minimum (15% LTV), Recommended (5% LTV), Ideal (2% LTV), Custom
- Custom card: editable BTC input when selected; shows day-one LTV + crash LTV live
- `customDayOneLtv = expenses / (customCollateral × btcPrice)`
- `customCrashLtv = customDayOneLtv / 0.20`
- Grid: `repeat(4, 1fr)`
- Active state class: `styles.active` (not `styles.cardSelected`)

### Bear Market Box
- Toggle row is OUTSIDE the red box
- Red box (`border: 1px solid rgba(220,80,80,0.35)`, `background: rgba(180,40,40,0.08)`) wraps only:
  - Description text
  - Bear Period slider (conditional on toggle ON)
  - Annual Decline slider (conditional on toggle ON)
  - Trough note: `BTC falls to ~${fmtUSD(btcPrice × (1 + annualDecline/100)^bearPeriodYears)} after bear phase`

### ComparisonBanner
- Renders only when `smartBloc.finalNetWorthNominal > sellToLive.finalNetWorthNominal`
- Interest paid: `fmtUSD(smartBloc.finalInterestPaid)` (exact)
- Delta: `fmtDelta(delta)` (abbreviated, bold green)

### StressTest
- Bar fill: `min(crashLtv × 100, 100)%`
- Label next to bar: `Math.ceil(crashLtv × 100)%` (NOT finalLtv)
- Reference lines at 70% (amber) and 85% (red) via `position: absolute`
- Badge: < 70% = Safe (green), 70–84% = Margin Call (amber), ≥ 85% = Liquidated (red)

### StrategyCards
- Headline NET WORTH shows `finalNetWorthReal` (inflation-adjusted)
- Real Return color: green if positive, red if negative

---

## Design Tokens (CSS Variables)

```css
--orange: #E8836A
--green:  #4ECB82
--red:    #E85A4F
--amber:  #E8A84A
--bg-card: (dark card background)
--bg-input: (input background)
--text-primary, --text-secondary, --text-ghost, --text-muted, --text-faint
--border: (border color)
```

---

## Test Suite

- **Files:** `src/simulation/__tests__/smartBloc.test.ts` (12 tests), `living.test.ts` (27 tests)
- **Run:** `npx vitest run`
- **All 39 tests must pass before every commit**
- Key constants in `living.test.ts`: `capitalGainsTaxRate: 0.30`
- When algorithm changes are made, update expected values in tests — do NOT revert the fix to match old tests

---

## Build & Deploy

```bash
npx vitest run              # must pass (39/39)
git add .
git commit -m "..."
git push
vercel --prod               # requires: vercel login
```

`vercel.json`:
```json
{ "buildCommand": "vite build", "outputDirectory": "dist", "framework": "vite" }
```

---

## Known Constraints

- **CORS in widget iframe:** Outbound API calls blocked. BTC price fetched client-side via Coinbase public endpoint (no auth required). No other external API calls.
- **Chart axis ticks:** Must stay abbreviated (`$120k`, `$1.2M`) — exact format causes label overlap.
- **SummaryBar formatter:** Local only, must preserve negative sign — do NOT replace with shared `fmtUSD`.
- **`timeHorizonMonths` and `annualBtcGrowth` in `getBtcPrice`:** Kept in signature for API compatibility but unused in the function body. Do not remove.
- **`runNoBitcoin` does NOT call `getBtcPrice`:** Confirmed by grep. No changes needed there for bear market or getBtcPrice updates.

---

## Pending / Recent Work

### Algorithm discrepancy fixes (next to implement)
Five discrepancies found vs Strike reference (same inputs, different outputs):

1. **StressTest label** — shows `finalLtv` instead of `crashLtv` as the percentage label
2. **StrategyCards net worth** — shows nominal instead of real (inflation-adjusted)
3. **No Bitcoin real return** — hardcoded `-inflationRate` instead of actual formula
4. **Sell to Live BTC held** — taxes should reduce BTC held, not just net worth
5. **Smart BLOC trigger** — currently fires at hardcoded 0.15; should fire at `inputs.ltvCeiling`; LTV_TYPE_MAP values need to match Strike: `{target:0.02, current:0.05, high:0.10, hyper:0.20}`

See `/mnt/user-data/outputs/algorithm_discrepancy_fixes.md` for full spec.
