# CLAUDE.md — Personal BLOC

## Project Overview

React + Vite + TypeScript app modeling Bitcoin accumulation strategies using Strike's Bitcoin Line of Credit (BLOC). Five tabs: **Living on Bitcoin**, **Smart BLOC**, **Power Law**, **Sats** (converter), and **Mining**.

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
api/
  btc-history.js              # Vercel serverless proxy for Blockchain.com (CORS fix)

src/
  simulation/
    types.ts                  # All shared types including Mining types
    livingUtils.ts            # getBtcPrice (8-param, bear market aware)
    powerLaw.ts               # Power Law formula constants + utility functions
    miningUtils.ts            # Mining formulas + calcAllStrategies
    runNoBitcoin.ts
    runSellToLive.ts
    runSmartBLOC_Living.ts
    runMaxLeverage.ts
    runBLOC.ts                # Smart BLOC tab simulation
    runSTS.ts                 # Save the Surplus (Smart BLOC tab)
    __tests__/
      smartBloc.test.ts       # 12 tests
      living.test.ts          # 27 tests
      mining.test.ts          # 14 tests (53 total)

  hooks/
    useBtcPrice.ts            # Coinbase API, init-once store seed
    useSimulation.ts          # Smart BLOC tab hook
    useLivingSimulation.ts    # Living on Bitcoin tab hook
    usePowerLawData.ts        # Blockchain.com price (dev) / /api/btc-history (prod) + bands
    useMempoolData.ts         # mempool.space block height (halving computed from it)
    useMiningSimulation.ts    # calcAllStrategies wrapper, btcPrice resolution

  store/
    useStore.ts               # Zustand store — all state, persisted to localStorage

  utils/
    format.ts                 # fmtUSD, fmtMining, fmtMiningUSD

  components/
    Layout/
      AppShell.tsx            # Grid shell, 5-tab bar, conditional sidebar/main
      AppShell.module.css
      SmartBlocMain.tsx
      SmartBlocMain.module.css

    ui/
      SliderInput.tsx         # Stacked: label → large value → slider → min/max
      SliderInput.module.css
      NumberInput.tsx
      NumberInput.module.css
      Toggle.tsx
      ScenarioPills.tsx
      GrowthPresetPills.tsx
      LtvTypePills.tsx

    Inputs/
      InputsPanel.tsx
      InputsPanel.module.css
      SettingsDropdown.tsx

    Summary/
      SummaryBar.tsx

    Collateral/
      TierCards.tsx
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
      LivingInputsPanel.tsx
      LivingInputsPanel.module.css
      NetWorthChart.tsx
      NetWorthChart.module.css
      ComparisonBanner.tsx
      ComparisonBanner.module.css
      StrategyCards.tsx
      StrategyCards.module.css
      StressTest.tsx
      StressTest.module.css

    PowerLaw/
      PowerLawMain.tsx
      PowerLawMain.module.css
      PowerLawChart.tsx
      PowerLawChart.module.css
      PowerLawSidebar.tsx
      PowerLawSidebar.module.css

    Converter/
      ConverterMain.tsx
      ConverterMain.module.css
      ConverterSidebar.tsx
      ConverterSidebar.module.css

    Mining/
      MiningMain.tsx            # Assembles strategy cards, odds bar, pool setup, projection
      MiningMain.module.css
      MiningInputsPanel.tsx     # Sidebar: Your Miners, Electricity, Network (collapsible)
      MiningInputsPanel.module.css
      StrategyCard.tsx          # Solo / Split / Pooled comparison cards
      StrategyCard.module.css
      MiningOddsBar.tsx         # Logarithmic solo probability bar
      MiningOddsBar.module.css
      PoolSetupPanel.tsx        # Per-device pool assignment display
      PoolSetupPanel.module.css
      CurrencyToggle.tsx        # USD / sats / BTC tab-wide toggle
      CurrencyToggle.module.css
      MiningProjectionTable.tsx # Two-stage: SAT ACCUMULATION + IF BTC REACHES...
      MiningProjectionTable.module.css
```

---

## Zustand Store Shape (`useStore.ts`)

Wrapped with `persist` middleware — all state saved to `localStorage` key `'personal-bloc-store'`. Survives page refresh.

### Navigation
```typescript
activeTab: 'living' | 'bloc' | 'powerlaw' | 'converter' | 'mining';
```

### Smart BLOC Tab
```typescript
income: number;              // default 4000
expenses: number;            // default 3000
btcPrice: number;            // seeded from Coinbase API on first fetch
activeTier: 'min' | 'rec' | 'ideal' | 'custom';
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
ltvType: 'target' | 'current' | 'high' | 'hyper';
timeHorizonYears: number;    // default 1
```

### Sats Converter Tab
```typescript
converterActiveField: 'sats' | 'btc' | 'usd';  // default 'sats'
converterRawValue: string;                        // default '0'
```

### Mining Tab
```typescript
miningInputs: MiningInputs;
setMiningInputs: (patch: Partial<MiningInputs>) => void;
setMiningDevice: (index: number, patch: Partial<MiningDevice>) => void;
setMiningCurrency: (currency: MiningCurrency) => void;
setMiningStrategy: (strategy: MiningStrategy) => void;
addMiningDevice: () => void;
removeMiningDevice: (index: number) => void;
```

---

## Mining Types (`simulation/types.ts`)

```typescript
export type MiningCurrency = 'usd' | 'sats' | 'btc';
export type MiningStrategy = 'solo' | 'split' | 'pooled';

export interface MiningDevice {
  name: string;
  hashrateTH: number;
  powerW: number;
  efficiencyJTH: number;
  enabled: boolean;
  soloMining: boolean;      // true = solo pool, false = pooled
  poolName: string;         // user-entered, cosmetic only — PENDING REFACTOR
  poolFee: number;          // percent (e.g. 2.0) — drives EV math
}

export interface MiningInputs {
  devices: MiningDevice[];
  electricityRateCents: number;
  btcPriceOverride: number | null;
  networkHashrateEH: number;
  selectedStrategy: MiningStrategy;
  currency: MiningCurrency;
  projectionYears: number;
  btcPriceScenarios: number[];
}
```

**Default devices:**
```typescript
{ name: 'Gamma 601', hashrateTH: 1.07, powerW: 22.3, efficiencyJTH: 20.23, enabled: true, soloMining: true,  poolName: '', poolFee: 0.5 }
{ name: 'Gamma 602', hashrateTH: 1.20, powerW: 18,   efficiencyJTH: 15,    enabled: true, soloMining: false, poolName: '', poolFee: 2.0 }
```

---

## Mining Formulas (`miningUtils.ts`)

```typescript
// Revenue per TH/s per day in USD
revPerTHPerDay(btcPrice) = (3.125 × 144 × btcPrice) / 1_000_000_000

// Daily expected value for a device
dailyEV_usd(hashTH, btcPrice, feePercent) =
  hashTH × revPerTHPerDay(btcPrice) × (1 - feePercent / 100)

// Monthly electricity cost in USD
monthlyElecCost(powerW, rateCents) =
  (powerW / 1000) × 24 × 30 × (rateCents / 100)

// Lottery odds for solo mining
calcLotteryOdds(soloHashTH, networkEH):
  dailyProb = (soloHashTH / (networkEH × 1_000_000)) × 144
  annualProb = 1 - (1 - dailyProb)^365
  expectedYears = 1 / (dailyProb × 365)
```

**Key insight:** `dailyEV_sats` is price-independent:
```
dailyEV_sats = round(hashTH × 3.125 × 144 / 1e9 × (1 - fee/100) × 1e8)
             = round(hashTH × 450 × (1 - fee/100))
```

---

## Mining Tab — Component Behavior

### `useMiningSimulation.ts`
```typescript
const { livePrice } = useBtcPrice();
const btcPrice = miningInputs.btcPriceOverride ?? livePrice ?? 80000;

// Override btcPriceScenarios[0] with live price for projection
const scenariosWithLive = [btcPrice, ...miningInputs.btcPriceScenarios.slice(1)];
const strategies = useMemo(
  () => calcAllStrategies({ ...miningInputs, btcPriceScenarios: scenariosWithLive }, btcPrice),
  [miningInputs, btcPrice]
);
```

### Strategy Cards (Fully Solo / Split / Fully Pooled)
- Fixed comparison presets — EV numbers reflect strategy's fixed pool assignments
- Clicking a card calls `handleStrategySelect(strategy)` in `MiningMain.tsx`
- `handleStrategySelect` calls `setMiningStrategy` AND patches `device.soloMining` per device:
  - `solo`: all devices `soloMining = true`
  - `pooled`: all devices `soloMining = false`
  - `split`: device[0] `soloMining = true`, rest `false`
- Strategy cards do NOT update based on per-device soloMining changes — they are fixed scenarios

### Device Card (MiningInputsPanel)
- **Click card body** (not sliders/inputs/buttons) → toggles `device.enabled`
  - `data-no-toggle` on sliders and deviceToggles div prevents propagation conflicts
  - `target.closest('[data-no-toggle], input, button')` guard in onClick
- Enabled: `border: 1px solid var(--orange)`, opacity 1
- Disabled: `border: 1px solid var(--border)`, opacity 0.4
- **Collapsible sections:** YOUR MINERS, ELECTRICITY, NETWORK (default closed), all via local `useState`
- **PROJECTION slider** lives in `MiningProjectionTable.tsx`, NOT in the sidebar
- **Hashrate range:** 0.01–1,000 TH/s (covers Bitaxe to industrial ASIC)
- **Add/Remove miners:** `addMiningDevice()` appends default device; `removeMiningDevice(i)` removes; guard prevents removing last device

### `MiningOddsBar.tsx`
- Hidden when `soloHashTH === 0` (all pooled)
- Reads `devices` and `networkHashrateEH` directly from store (NOT from `selected.lotteryOdds`)
- Reactive to TH/s slider and solo toggle changes
- Computes odds inline from `soloDevices.reduce(sum, d.hashrateTH)`

### `MiningProjectionTable.tsx` — Two-stage layout

**Stage 1 — SAT ACCUMULATION:**
- Projection horizon slider (1–20 years) at top — NOT in sidebar
- Month scrubber (playbook-style): orange fill, year tick labels, hint text
- Breakdown rows: ⛏ Mined / ⚡ Electricity (USD, fiat) / NET ACCUMULATED
- Electricity is shown as USD fiat context only — NOT deducted from sats
- `netSats = grossSats` (all mined sats kept; electricity paid in fiat)
- `grossSats` uses `pooledFraction` — scales to pooled devices only

**Stage 2 — IF BTC REACHES...**
- Three fixed scenario cards: $150k / $300k / $1M
- Always USD — independent of currency toggle
- `value = (grossSats / 1e8) × scenarioPrice`

**Lottery display (when any device is soloMining):**
- Red `lotteryBox` with annual win chance, expected years, jackpot sats
- "IF YOU FIND A BLOCK..." red scenario cards (one-time jackpot × 3 prices)
- When all pooled: no lottery elements shown

**Conditional states:**
- `allSolo`: no scrubber, lottery only
- `isMixed`: scrubber (pooled EV) + lottery callout
- `allPooled`: scrubber only, no lottery

---

## Format Functions (`utils/format.ts`)

```typescript
// Mining-internal USD formatter (NOT exported)
function fmtMiningUSD(n: number): string {
  if (n < 0.01) return '$' + n.toFixed(4);
  if (n < 100)  return '$' + n.toFixed(2);
  return '$' + Math.round(n).toLocaleString();
}

// Exported — currency-aware mining value formatter
export function fmtMining(value_usd: number, currency: MiningCurrency, btcPrice: number): string {
  if (currency === 'usd') return fmtMiningUSD(value_usd);
  const sats = Math.round((value_usd / btcPrice) * 100_000_000);
  if (currency === 'sats') return `${sats.toLocaleString()} sats`;
  return `${(sats / 100_000_000).toFixed(8)} BTC`;
}

// fmtMiningUSD is also exported for use in MiningProjectionTable
export function fmtMiningUSD(n: number): string { ... }
```

**CRITICAL:** Do NOT import `miningUtils.ts` inside `format.ts` — circular dependency.
Sats math in `fmtMining` is inlined: `Math.round((value_usd / btcPrice) * 100_000_000)`.

---

## Power Law Model (`powerLaw.ts`)

```typescript
export const PL_B         = 5.82;
export const PL_A_FAIR    = 1.16e-17;
export const PL_A_FLOOR   = 0.42e-17;
export const PL_A_CEILING = 10 ** -16.12;  // ≈ 7.586e-17
export const GENESIS      = new Date('2009-01-03T00:00:00Z');
```

**Three independent A constants — never derive floor/ceiling as multipliers of fair value.**

### Data Sources
- **Historical price:** env-conditional in `usePowerLawData.ts`:
  ```typescript
  const BLOCKCHAIN_URL = import.meta.env.DEV
    ? 'https://api.blockchain.info/charts/market-price?timespan=all&format=json&cors=true'
    : '/api/btc-history';  // Vercel serverless proxy
  ```
- **Block height:** `https://mempool.space/api/blocks/tip/height`
- **Halving:** Computed from block height only (no API):
  ```typescript
  const nextHalvingBlock = Math.ceil((blockHeight + 1) / 210_000) * 210_000;
  const daysUntilHalving = Math.ceil((nextHalvingBlock - blockHeight) * 10 / (60 * 24));
  ```

### `api/btc-history.js` (Vercel serverless proxy)
- Fetches `api.blockchain.info` server-side (no CORS restriction)
- `Cache-Control: s-maxage=3600` — cached 1 hour on Vercel edge
- Used in production only; dev hits Blockchain.com directly

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
- Local `useState` initialized from store (`useStore.getState()`) for immediate UI
- Both updated together: `updateActiveField()` + `updateRawValue()`
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
- Sats amounts: `丰 {value} SATS` or `丰 {value} sats`
- Converter prefix prop: `"丰"` for SATS, `"₿"` for BTC, `"$"` for USD
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

// Chart Y-axis — abbreviated (NEVER exact, causes label overlap)
(v) => v >= 1_000_000 ? '$' + (v/1_000_000).toFixed(1) + 'M'
     : v >= 1_000     ? '$' + Math.round(v/1_000) + 'k' : '$' + v

// ComparisonBanner delta — abbreviated
const fmtDelta = (n) => n >= 1_000_000 ? '$' + (n/1_000_000).toFixed(1) + 'M'
                      : n >= 1_000     ? '$' + Math.round(n/1_000) + 'k'
                      : '$' + Math.round(n);
```

---

## LTV Type Mapping (`useLivingSimulation.ts`)

```typescript
const LTV_TYPE_MAP = {
  target:  0.02,
  current: 0.05,
  high:    0.10,
  hyper:   0.20,
};
```

Serves as BOTH trigger AND paydown target in `runSmartBLOC_Living`.

---

## Simulation Engines

### `getBtcPrice` (`livingUtils.ts`)
8-parameter, bear market aware. `timeHorizonMonths` and `annualBtcGrowth` kept for API compat.

### `runNoBitcoin`
`realReturn = (finalNetWorthReal - finalNetWorthNominal) / finalNetWorthNominal`

### `runSellToLive`
`btcSoldForTaxes = taxesPaid / finalBtcPrice` — taxes paid by selling BTC

### `runSmartBLOC_Living`
Trigger = `inputs.ltvCeiling`; paydown target = `inputs.ltvCeiling` (NOT hardcoded 0.15)

### `runMaxLeverage`
Interest paid from income (NOT capitalized); LoC grows from expenses only

---

## Verified Reference Values (5-year Strike reference)

| Strategy | Net Worth (real) | BTC | LoC | Interest/Tax | Real Return |
|---|---|---|---|---|---|
| Max Leverage | $1,272,607 | ₿ 3.1674 | $300,000 | $99,125 | +389.5% |
| Smart BLOC | $986,908 | ₿ 2.1991 | $76,382 | $22,875 | +279.6% |
| Sell to Live | $826,935 | ₿ 1.7373 | — | $52,100 | +218.1% |
| No Bitcoin | $203,726 | 0 | — | — | −21.6% |

---

## UI Conventions

### AppShell
- 5 tabs: Living on Bitcoin, Smart BLOC, Power Law, Sats, Mining ⛏
- `₿ Smart BLOC` branding far right of tab bar
- Tab bar: `position: sticky; top: 0; background: var(--bg-base)`
- Unified background: sidebar, tab bar, main all `var(--bg-base)`

### SliderInput
- Stacked: label → 20px bold value → slider → min/max
- `labelSuffix?: React.ReactNode` — used for LIVE badge
- Click value → text input; blur/Enter commits; Escape cancels
- Range `onChange` has `!editing` guard

### Mining Device Card
- Click body (not sliders/toggles/buttons) → toggle `enabled`
- `data-no-toggle` on `.deviceToggles` div and each SliderInput wrapper
- `target.closest('[data-no-toggle], input, button')` guard in onClick
- Enabled: orange border; Disabled: muted border + 40% opacity

### NetWorthChart
- Y-axis: `computeYTicks` — 5–12 ticks, anchors at 0 when `min < max × 0.25`
- X-axis: ≤12mo→Mo, ≤36mo→Yr 2-step, ≤60mo→Yr 5-step, etc.

---

## Design Tokens

```css
--orange: #E8836A  --green: #4ECB82  --red: #E85A4F  --amber: #E8A84A
--bg-base, --bg-card, --bg-input
--text-primary, --text-secondary, --text-ghost, --text-muted, --text-faint
--border
```

---

## Test Suite

- **53 tests total:** 12 smartBloc + 27 living + 14 mining
- `npx vitest run` — all must pass before every commit
- Mining test fixtures must include `soloMining: false` on `MiningDevice` objects

---

## Build & Deploy

```bash
npx vitest run && git add . && git commit -m "..." && git push && vercel --prod
```

`vercel.json`:
```json
{
  "buildCommand": "vite build",
  "outputDirectory": "dist",
  "framework": "vite",
  "functions": {
    "api/btc-history.js": { "runtime": "nodejs20.x" }
  }
}
```

---

## Known Constraints

- **SummaryBar formatter:** Local sign-preserving — never replace with shared `fmtUSD`
- **Chart Y-axis:** Always abbreviated — exact format causes label overlap
- **`getBtcPrice` unused params:** `timeHorizonMonths`, `annualBtcGrowth` kept for API compat
- **`runNoBitcoin`:** Does NOT call `getBtcPrice`
- **Power Law A constants:** Three independent values — never multiply fair × scalar
- **Converter `displayValue`:** Always formatted — never pass `rawValue` as `displayValue`
- **Halving:** Computed from block height only — no second API endpoint
- **`fmtMining` sats math:** Inlined in `format.ts` — never import `miningUtils.ts` into `format.ts`
- **Mining projection:** `netSats = grossSats` — electricity is fiat overhead, not deducted from sats
- **Strategy cards:** Fixed comparison presets — do NOT update based on per-device `soloMining`
- **`MiningOddsBar`:** Reads `devices` from store directly — NOT from `selected.lotteryOdds`
- **Projection slider:** Lives in `MiningProjectionTable.tsx` — NOT in `MiningInputsPanel`
- **localStorage migration:** If `MiningDevice` shape changes, run `localStorage.removeItem('personal-bloc-store')` once in browser console after deploy

---

## Pending Work

- **Pool refactor:** Replace hardcoded `MINING_POOLS` with per-device `poolName` (text input) and `poolFee` (slider). Removes pool bias for public release. `poolName` is cosmetic; `poolFee` drives EV math.
