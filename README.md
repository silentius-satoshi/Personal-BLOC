# Personal BLOC

A Bitcoin financial modeling app built on top of Strike's Bitcoin Line of Credit (BLOC). Model what your financial life looks like when you live on Bitcoin — comparing four strategies side by side, or planning your Smart BLOC setup in detail.

---

## What It Does

### Living on Bitcoin
Compare four strategies with identical inputs to see how each performs over your chosen time horizon:

| Strategy | Description |
|---|---|
| **Max Leverage** | Draw all expenses from the LoC, buy BTC with all income. Never pay down. Highest upside, highest risk. |
| **Smart BLOC** | Same as Max Leverage but automatically pays down the LoC when LTV hits your chosen ceiling. Crash-safe. |
| **Sell to Live** | No LoC. Buy BTC with income, sell BTC for expenses. No debt, but capital gains taxes apply. |
| **No Bitcoin** | Sell all BTC for cash. Live on income, save the surplus. Baseline comparison. |

Outputs for each strategy: net worth (real, inflation-adjusted), BTC held, LoC balance, interest or taxes paid, final LTV, real return, and a crash stress test showing what happens if BTC drops 80%.

### Smart BLOC
A 5-year planning tool. Enter your income, expenses, and BTC price, then pick a collateral tier (Minimum, Recommended, Ideal, or Custom). See a month-by-month playbook, BTC stack growth chart, net equity chart, and LTV safety chart.

---

## Inputs

### Living on Bitcoin
- **BTC Holdings** — how much BTC you're starting with
- **BTC Price** — current price (auto-fetched from Coinbase, live badge to restore)
- **Monthly Income** — your take-home pay
- **Monthly Expenses** — your monthly cost of living
- **BTC Annual Growth Rate** — your assumed BTC CAGR (presets: 30% / 50% / 80%)
- **Bear Market Phase** — optional: model a downturn before recovery
  - Bear Period: 1–5 years
  - Annual Decline: −10% to −80%
- **Inflation Rate** — adjusts all outcomes to real purchasing power
- **LTV Type** — Smart BLOC paydown trigger: Target 2% / Current 5% / High 10% / Hyper 20%
- **Time Horizon** — 1–10 years

### Smart BLOC
- Monthly income and expenses
- BTC price (live)
- Collateral tier (Min / Rec / Ideal / Custom BTC amount)
- BLOC APR (default 13%)
- Fold CC toggle (1.5% BTC cashback on expenses)

---

## How the Algorithms Work

### BTC Price Path
```
No bear market:
  price(month) = startPrice × (1 + monthlyGrowthRate)^month

Bear market active:
  During bear phase (month ≤ bearPeriodMonths):
    price = startPrice × (1 + monthlyDeclineRate)^month
  After bear phase:
    price = troughPrice × (1 + monthlyGrowthRate)^(month - bearPeriodMonths)
```

### Smart BLOC Paydown Logic
```
Each month:
  1. Interest capitalizes onto LoC
  2. Expenses drawn from LoC
  3. If LTV > ltvCeiling: pay down LoC back to ltvCeiling (using income)
  4. Remaining income buys BTC
```

### Max Leverage
```
Each month:
  1. Interest paid from income (does NOT capitalize onto LoC)
  2. Expenses drawn from LoC
  3. Remaining income buys BTC
  LoC grows by expenses only — never by interest
```

### Sell to Live
```
Each month:
  - All income buys BTC at current price
  - All expenses sell BTC at current price
Tax at end:
  - Capital gains = (total dollar sold - total BTC sold × startPrice) × 30%
  - Taxes paid by selling BTC at final price
```

### No Bitcoin
```
- Sell all BTC at startPrice for cash
- Monthly surplus (income - expenses) accumulates as cash
- Real return = inflation erosion of nominal value
```

### Crash Stress Test
```
crashLTV = finalLTV / 0.20
(equivalent to: what LTV would be if BTC dropped 80%)

Thresholds:
  < 70%: Safe
  70–84%: Margin Call
  ≥ 85%: Liquidated
```

### Real Return Formula (all strategies)
```
realReturn = (finalNetWorthReal - noBtcFinalNominal) / noBtcFinalNominal

where finalNetWorthReal = finalNetWorthNominal / cumulativeInflation
and noBtcFinalNominal = the No Bitcoin strategy's nominal final net worth
```

---

## Tech Stack

| Layer | Tool |
|---|---|
| Framework | React 18 + Vite + TypeScript |
| State | Zustand |
| Charts | Recharts |
| Styles | CSS Modules |
| Tests | Vitest |
| Deployment | Vercel |
| BTC Price | Coinbase public API |

---

## Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npx vitest run

# Type check
npx tsc --noEmit

# Build
npm run build
```

---

## Deploy

```bash
npx vitest run    # all 39 tests must pass
git add .
git commit -m "..."
git push
vercel --prod
```

---

## Project Structure

```
src/
  simulation/       # Pure functions — no React dependencies
  hooks/            # React hooks wrapping simulation + store
  store/            # Zustand global state
  utils/            # Shared formatters
  components/
    Layout/         # App shell, tab bar
    ui/             # Shared primitives (SliderInput, NumberInput, Toggle)
    Inputs/         # Smart BLOC sidebar
    Collateral/     # Tier cards
    Playbook/       # Monthly playbook scrubber
    Charts/         # Smart BLOC charts
    LivingOnBitcoin/ # All Living on Bitcoin components
```

---

## Key Design Decisions

**All net worth values are inflation-adjusted (real).** Nominal values are used internally for calculations but the UI always shows purchasing-power-adjusted figures.

**Crash stress test uses crashLTV = finalLTV / 0.20.** This answers: "what would your LTV be if BTC dropped 80% from its end-of-simulation price?" It does not model a crash during the simulation period.

**Max Leverage interest is paid from income, not capitalized.** This keeps the LoC growing only from expense draws, producing exactly `expenses × months` in LoC balance at end.

**Smart BLOC trigger and paydown target are the same value** (the selected LTV type). The paydown fires when LTV crosses the ceiling and pays down to that same ceiling.

**BTC price is seeded from Coinbase once on load.** Subsequent 60s interval fetches update a local `livePrice` state only — manual slider adjustments are never overwritten. The LIVE badge restores the current fetched price on demand.

---

## Disclaimer

This app is for educational and modeling purposes only. It does not constitute financial advice. Bitcoin is volatile. The BLOC is a real financial product with real liquidation risk — model conservatively.
