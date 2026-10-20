# The engines — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

## CB Loan (`runCoinbaseLoan.ts`)

```typescript
type CbLtvStatus = 'safe'|'watch'|'warning'|'emergency'|'critical'|'liquidated';
// <0.55 / 0.55-0.65 / 0.65-0.70 / 0.70-0.84 / 0.84-0.86 / ≥0.86

// Per month: interest accrues → payment applied
// netChange = balance - prevBalance (positive = bad)
// isBreach = btcPrice <= threshold.price (highlights alert rows)
```

Morpho/Coinbase: 86% LLTV instant liquidation, no grace period, 4.38% penalty.

⚠ **The plan of record's Run 4:** no screen calls `runCoinbaseLoan()` or `classifyLtv()` — the CB Loan tab's 12-month
projection (it read the retired `cbMonthlyPayment`) is gone, and the tab colours today's LTV by Safety's level. Both
left the code in 5e (batch 1, D5-A), with `aprAnchors.test.ts`'s projection test; the type block above is their history. The tab's alert table (`isBreach`)
has two rows: the owner's trigger and 86% (§ The plan of record (Run 4)).

### Platform fee — `CB_PLATFORM_FEE_PCT` / `cbNetApr` 🔴 THE APR IS NOT MORPHO'S APR

```typescript
CB_PLATFORM_FEE_PCT = 1.5;              // percentage points, ON TOP of the market rate
cbNetApr(morphoApyPct)                  // market rate → what the owner actually pays
CB_REALIZED_NET_APR                     // useMorphoRate.ts — the realized band, restated all-in
```

Coinbase charges a **platform fee on top of the third-party (Morpho) variable rate**. From the owner's own
borrow screen, Sept 2026: variable rate **6.21%**, disclosed as *"Net APR 6.21% · Includes platform fee of
1.5%"* over a Morpho market rate of 4.71%. Plain addition: 4.71 + 1.5 = 6.21.

⚠ **PROVENANCE — the in-app disclosure, not the help centre.** The public pages still describe the loan as
having "no Coinbase fees" with rates "set by open lending markets"; they have not caught up with the
product. The screenshot is the newer and authoritative source. It is a Coinbase pricing decision that can
move, which is why it is ONE named constant.

⚠ **`cbAprPct` MEANS THE NET, ALL-IN RATE.** Every engine compounds it monthly (`cbAprPct/100/12`), which
is precisely how the platform fee is billed (*"Platform fees are added to your loan amount on a monthly
basis"*), so folding it into the APR is the CORRECT model rather than an approximation — no separate
accrual. **The store default moved 4.77 → 6.27** (4.77 was a raw Morpho reading, understating the loan by
1.5 points). **NO MIGRATION on purpose:** a blind +1.5 would double-count for anyone who had already typed
a net figure by hand, so persisted values stay put and the faces now state the live number all-in so the
owner can correct their own slider.

🔴 **`CB_APR_SEED_PCT` — ONE seed, four sites.** The first cut of that default change was a NO-OP for new
owners and this is the fix. Moving the store's initial `cbAprPct` left FOUR other seed sites hard-coded at
4.77, and one of them — the **`OnboardingModal` draft** — writes over the store default on first launch
(`setCbAprPct(draft.cbAprPct)`), so every new owner still got the understated rate. `viewerSlice`'s
`clearViewerData` AND `resetPlanToSeeds` also reseeded 4.77, meaning the owner escape hatch silently
DOWNGRADED anyone who used it, and `demoSeed` showed the raw rate as if it were all-in.
The fix was not to edit four literals — it was to stop having four literals:
`CB_APR_SEED_PCT = CB_MARKET_APR_SEED_PCT + CB_PLATFORM_FEE_PCT`, derived so a change to the platform fee
moves every seed with it. `src/store/__tests__/cbAprSeed.test.ts` reads the four files and FAILS on any
`cbAprPct: <number>` literal in them (mutation-verified against the original defect).
⚠ Test FIXTURES keep their own 4.77 — a fixture's job is to be a fixed arbitrary number, and rewriting
them would move pinned values for no gain. The guard only covers the four SEED sites.

⚠ **Two opposite "net"s — do not confuse them.** Coinbase's **"Net APR"** = market rate **PLUS** Coinbase's
fee (bigger). Morpho's **`netBorrowApy`** field = market rate **MINUS** reward incentives (smaller). Same
word, opposite directions. `parseMorphoRate` returns both raw fields; the faces read `borrowApy` and put
it through `cbNetApr`. A regression that subtracted instead of added is pinned by a test.

**Everywhere a Morpho reading becomes a `cbAprPct` must go through `cbNetApr`:**
- the "Use live X%" seed button in both faces (was seeding the RAW rate — the original defect)
- the live-rate hint line, which now prints market → all-in
- **`SafetyDashboard` + `SettingsMain`** — the same seed defect, plus a WORSE one: both gated their
  "Your APR differs" warning on `|morphoRate.borrowApy − cbAprPct| > 1`. Against a correctly-set
  `cbAprPct` that gap is the 1.5pt fee *permanently*, so the warning would have fired forever and its
  button then seeded the understated figure. Both now compare against `cbNetApr(...)`. ⚠ Their old copy
  — *"Coinbase may add a margin"* — was guessing at precisely this fee; it is now named and applied
- **`CB_REALIZED_NET_APR`** — the realized band restated all-in (5.6–9.0%, max 11.4), DERIVED from
  `MORPHO_REALIZED_APY` so the two cannot drift. The faces quote this one; quoting the raw band told the
  owner their debt was 1.5 points cheaper than it has ever been.

⚠⚠ **This is not only a cost — it moves the LIQUIDATION DATE.** On the stress fixture (cap 85, flat price,
monthly sweeps) the 1.5pt spread pulls the 86% breach from month **46 to month 39 — seven months earlier**,
more than twice what the origination fee cost. Modelling the loan at Morpho's market rate does not merely
understate the bill; it tells the owner the liquidation is further away than it is. Pinned by a test.
⚠ The faces' old "the rate is a cost, not a danger" copy was AMENDED rather than deleted: it holds *while
the draw cap binds* (the cap absorbs the rate into less accumulation, peak CB LTV moving under a point
across 3–16%), and stops holding once the cap is set high enough not to bind. Both halves are now stated — with
the support policy OFF; with it on (the faces' default) the card shows `rateStopNote`'s policy variant instead
(§ Support-anchored policy → Faces).

### Origination fee — `cbBorrowFee` / `cbMaxDrawForHeadroom`

```typescript
CB_FEE_TIER1_PCT = 0.02;   CB_FEE_TIER2_PCT = 0.01;   CB_FEE_TIER_BREAK = 250_000;
cbBorrowFee(amount, balance)          // fee on borrowing `amount` at a standing `balance`
cbMaxDrawForHeadroom(headroom, balance)   // exact inverse: largest cash draw whose principal+fee fits
```

Coinbase charges this on **every borrow**, not once at loan opening
(<https://help.coinbase.com/en/coinbase/trading-and-funding/loan/fee>). Two properties the model has to
get right, because both cost real bitcoin:

1. **MARGINAL brackets, like tax** — the slice of a new borrow landing under $250k pays 2%, the slice
   above pays 1%. Keyed off the STANDING balance, not the draw size: the same draw costs **twice as much**
   at a zero balance as it does once the loan is past $250k. (⚠ The brackets were calibrated against the
   owner's OWN observed fee on a real draw, not against a reading of the help page alone — the figure
   itself is deliberately not recorded here; this repo is public.)
2. **CAPITALISED** — the fee is added to principal, so it accrues interest for the rest of the run. It
   is not a cash cost you can pay and forget; it compounds. This is the part that moves outcomes.

⚠ **The fee moved a pinned liquidation: `liqMonth` 48 → 45 in `cyclingSim.test.ts`.** Not a loosened
pin — a real result. Every sweep capitalises 2%, the debt compounds off a bigger base, and the 86%
breach arrives THREE MONTHS EARLIER on that fixture. If a future change moves it back to 48 without
removing the fee, something is wrong.

**Break-even is amount-independent** — fee and interest saving both scale with the draw, so it reduces
to `feePct / (blocApr − cbApr) × 12` months. At 13% vs the stored 5.28%: **3.11 months**. At the realized
bull-regime 6.91%: 3.94. At the realized max 9.9%: 7.74. The Strike→Coinbase move still pays for itself
fast — the fee is a speed bump on the rotation, not an argument against it. Both faces and both Advisor
surfaces print this number rather than a bare "saves $X/yr", which was overstating year one.

⚠ **Cadence-NEUTRAL, which is why monthly sweeping survived the fee.** It is a percentage of VOLUME, not
a per-transaction charge, so batching saves nothing: over a 5-yr support/on-the-line/cap-70 run, monthly
sweeping and quarterly sweeping pay within ~1% of each other in total fees. Monthly is *slightly cheaper* —
less Strike interest accrues into the principal that gets fee'd. Pinned by a test, because "batch the
sweeps to save on fees" is the obvious wrong intuition and someone will have it.

**Two borrow sites, both wired:**
- `cyclingSim.ts` — the refinance sweep. `cbDebt += strikeBal + fee`; `CyclingResult` gained
  `totalCbFees` / `cbFeeCount`, which both faces print for the run in front of the owner.
- `runAdvisor.ts` (its engine gone at 5e, D5-A — this is history) — the **reverse rotation** (`strikeRepayDraw`, drawing cheap CB debt to repay
  expensive Strike). Same real-world action, same real fee. New row field `strikeRepayFee`.
  ⚠ **The rotation is NO LONGER DEBT-NEUTRAL** and the test that asserted it was renamed rather than
  relaxed: Strike falls by the CASH (`strikeRepayDraw`), Coinbase rises by cash **+ fee**. The fee buys
  nothing at Strike.
  ⚠ The fill uses `cbMaxDrawForHeadroom`, not the raw headroom — otherwise the capitalised fee would
  push the loan ~2% PAST the LTV target the rotation was aiming at. Grossing the headroom down through
  the same brackets keeps "fill to target" honest. A round-trip test pins the two functions as exact
  inverses so the brackets can't drift apart.

`runBLOC` / `runBlocYearOne` / `emergencyModel` are untouched — none of them models a Coinbase *borrow*
(`emergencyModel` models no borrow at all; `cbPaydownDraw` in the Advisor is a Strike draw paying CB down,
the opposite direction, and correctly pays no CB fee). The crash playbook's debt shift is the same move — a
Strike draw that pays Coinbase down — so it pays no Coinbase fee either.


### `cbMetrics.ts` — shared CB LTV / liq-price source of truth (v13)

`cbMetrics(loanBalance, collateralBtc, price, triggerPct)` → `{ ltv, liqPrice, triggerPrice,
pctToTrigger, pctToLiq }` (`liqPrice = balance/(collateral×CB_LLTV)`; `triggerPrice =
balance/(collateral×triggerPct%)`; `pctTo*` are price-relative — NEGATIVE when safe, i.e. the
trigger/liq price sits below the current price). `accruedCbBalance(balance, aprPct, asOf)` compounds
the balance daily from its `asOf` ISO date to now (`null` → unchanged) — feed it in as `loanBalance`
so LTV reflects accrued debt. Plus `barLevel(ltv, warnAt, actAt)` / `worseLevel(a,b)` for the
Safe/Watch/Act state line. **Single source** consumed by the Simple Mode `SafetyDashboard` AND the CB
Loan tab (`CoinbaseLoanMain` `currentLtv`/`autoLiqPrice`, `CoinbaseLoanSidebar` implied liq) — their
old inline formulas were removed so the figures can't disagree. `LiquidationModeler` keeps its own
`computeLiquidationAnalysis` (distinct post-repayment *scenario* math, not the current-LTV
duplication) but now receives `activeLiqPrice` (entered `cbLiquidationPrice` when > 0, else the
computed `cbMetrics.liqPrice`) as its `liquidationPrice` prop. Imports `CB_LLTV` from `runCoinbaseLoan`
(no circular dep — runCoinbaseLoan never imports back).

---

## Advisor (`runAdvisor.ts`)

⚠ **5e (batch 1, D5-A): `runAdvisor` left the code** — with its tests, its tier helpers (`getTier`, `getTierColor`,
`getTierLabel`), `deriveAdvisorStart`, `runCoinbaseLoan`'s projection and `classifyLtv`: the comparison engine kept one
release after the plan of record's Run 3, when it left every screen. This section is its history. `runAdvisor.ts`
keeps the helpers that stay — `getCurrentStrategyMonth`, `isStrategyComplete` and `getNdpStatus` — and invariant 3
(`advisorPricePath.test.ts`, GONE) pins that nothing defines or calls what left.

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

**Living projection:** `getCurrentStrategyMonth(startDate)`, `isStrategyComplete(startDate)` exported from `runAdvisor.ts` — both now delegate to `logUtils`'s calendar-anniversary `bucketEventToMonth`/`strategyMonthIndex` of `todayLocalISO()` (no duplicate 30.4375 clock; see the Strategy-Month Calendar Fix section). Month N = `[start+(N−1) calendar months, +N months)`; the bucket clamps 1..12, the unclamped index >12 signals completion.

⚠ **The plan of record's Run 3: no screen calls `runAdvisor`** (invariant 3) — the Advisor tab shows THIS MONTH's card, the month log reads the plan (`planLogRows`), and the Outlook (`OutlookProjection`, `outlookView`) is deleted. This section is the engine's record: it stays one release as the comparison engine, with its tests, then goes. The screens it names below are history.

**Skip overrides:** `advisorSkipBlocDraw/CbPayment/BtcBuying` in store. `overriddenPlan` memo in `AdvisorMain.tsx` applies overrides to current month display only. BLOC paydown is mandatory (LTV-triggered, no skip). (Retired in Run 3 with the Advisor tab's plan rows: the three fields are inert — invariant 6.)

**Income constraint:** `blocPaydown + cbPayment + btcIncome = income` always.

**BLOC paydown ceiling defense:** the income-funded BLOC paydown is `min(income, blocBalance − blocTarget)` (`blocTarget = btcHeld × price × 0.15`) in BOTH the ltvTriggered and monthly paths — i.e. up to **100% of income** defends the 15% ceiling, identical to Smart BLOC's `runBLOC`. (The prior `income * 0.3` 30%-of-income cap was removed — it under-paid in high-LTV months so Simple Mode's STRIKE BLOC LTV drifted above 15% instead of snapping back. Behavioral: high-LTV months divert more income to paydown, less to BTC — the intended hard-ceiling defense. The 15% ceiling value + CB/tier logic are unchanged.)

**Growth scenarios:** same 4 presets as MonthBreakdown — affects both BLOC LTV and CB LTV each month, can auto-resolve emergency tiers in Bull scenario. The scenario picker + its runAdvisor live ENTIRELY in `OutlookProjection` (shared with Simple Mode's Outlook segment). AdvisorMain keeps a SEPARATE runAdvisor pinned to `btcGrowthRate: 0` for the operating plan.

**4-yr cycle scenario — `pricePath` (OutlookProjection only).** `AdvisorInputs.pricePath?: number[]` holds absolute
prices indexed by MONTHS ELAPSED from `startingMonth`. A finite, positive entry REPLACES the CAGR for that month;
anything else (short, hole, NaN, 0, negative) falls through to it. Rows now carry `btcPrice` — additive, since rows
are computed per render and never persisted.
- ⚠ **Only `OutlookProjection` passes a path.** The operating plan (`AdvisorMain`, and Simple's log overlay) stays
  flat, and a grep guard in `advisorPricePath.test.ts` enforces it. Since the plan of record's Run 2, Daily and THIS
  MONTH's card no longer run the Advisor at all — they run the plan (`usePlanMonth`); SimpleModeView calls `runAdvisor`
  only for the log overlay's planned rows, and the guard's list of callers is three. Since Run 3 there is no caller at
  all: invariant 3's sweep in the same file replaced the guard.
- Its fifth scenario, **4-yr cycle**, builds `cycleConvergencePath(btcPrice, startDate, 12, PL_ON_THE_LINE)` in the
  VIEW. That is the §2 crossing: `runAdvisor` never imports `cyclePath`.
- The 12-month horizon makes it a SEGMENT whose leg depends on the date. From Sep 2026 it is the rise out of the
  modelled Oct-2026 trough; from mid-2029 it holds the top AND a −42.6% fall.

🔴 **NAMED TRAP — the month-1 step.** On the line, `path[0]` is the live price EXACTLY and `path[1..]` sits ON the
curve, so month 0→1 is a discontinuity whose SIGN depends on the anchor: −18.4% from $80k, +8.8% from $60k
(2026-09-13). It is invisible when you reason about "the path" instead of `path[0]` vs `path[1]`, and it has been
walked into three times: `cyclePath.test.ts` "Trap 1", the Advisor spec's rev 1, and a near-miss "won't show a crash"
copy. The rules:
- the note prints the step signed and computed (`lineStep`, the Almanac formula) — never a direction word;
- never assert whole-path monotonicity;
- tests pin fixed UTC dates and synthetic anchors.

The step is the model's claim — it can fire the ltvTriggered paydown in month 1 on its own. Do not smooth it.

The pure seams lived in `src/components/Advisor/outlookView.ts` (deleted in the plan of record's Run 3 with the Outlook):
- `scenarioSubtitle` — a Record; the old ternary fell through to "+80%/yr bull";
- `lineStep`;
- `footerCbLtv`.

The table gained a **Price** column. The footer CB LTV now reads the LAST ROW's own `cbLtv`. It used to re-price the
final balance at the live price, which was wrong for every non-flat scenario.

**Projection extraction (Phase 3) — conscious behavior shift:** the Advisor tab's carousel + log overlay months 2–12 previously followed the scenario toggle (they read the same scenario-driven `result`); they now render FLAT because AdvisorMain's retained call is fixed-flat and only `OutlookProjection` responds to the scenario picker. Operating console = assumption-light; scenario picker = Outlook only. Simple Mode was already flat (`advisorRows` btcGrowthRate:0) — no change there. This Month's Plan is unchanged either way (row[0] price is rate-independent: exponent 0).

---

## Power Law (`powerLaw.ts`)

```typescript
export const PL_B = 5.82; PL_A_FAIR = 1.16e-17; PL_A_FLOOR = 0.42e-17;
export const PL_A_CEILING = 2.4e-17; GENESIS = new Date('2009-01-03T00:00:00Z');
```

Three independent A constants — never `PL_A_FAIR × scalar`. **`PL_A_CEILING` was `10 ** -16.12` (6.54×
fair) and is now `2.4e-17` (2.07× fair)** — the old value was calibrated to the 2017-era tops and by 2026
overstated the upside ~3.2×, which is the dangerous direction in a leverage tool. The bands share `PL_B`,
so a parallel resistance can never be an envelope: tops decay toward trend every cycle (19.3× fair in 2011
→ 0.99× at the Oct-2025 top), so this constant is a calibration choice with an expiry, not a fit. The
floor, by contrast, IS a fit — it sits ~2% off Santostasi's published power-law floor and was touched at
the Nov-2022 low. ⚠ **User-facing label is "Resistance"; the `PlBand` key stays `'ceiling'`** — renaming
the key would ripple through four files for no functional gain. Pinned by `powerLaw.test.ts`
(`PL_A_CEILING / PL_A_FAIR ≈ 2.069`, a pin not a bound, so the old value can't drift back in).

**`PL_BAND_LABEL: Record<PlBand, string>`** (same module) is the ONE user-facing word per band —
`floor → "Support"`, `fair → "Fair"`, `ceiling → "Resistance"`. Every surface imports it; **nothing
renders a raw key.** Both Almanac faces used to interpolate `{band}` / `${pathKind}` straight into
prose, so a panel headed "Resistance" read "…reverts toward the power-law ceiling line" two lines
below. Pinned by a test that also asserts `floor`/`ceiling` never equal their own keys.

**`plDateAtPrice(band, usd)`** (same module, still zero imports) — the inverse of `plBandsAt`, exact to the day: the
first UTC midnight `d` with `plBandsAt(d)[band] >= usd` and `plBandsAt(d − 1 day)[band] < usd`. `daysSinceGenesis`
floors, so the day count is the CEILING of the real root: `max(1, ceil((usd / A_band)^(1/B)))`. The Power Law face's
model card reads its two projections from it — Support reaches $100k on 2028-02-29, Fair reaches $1M on 2032-11-24 — so
the card can never drift from the lines the chart draws (the old side panel's typed "~2033–2035" did). Pinned in
`powerLaw.test.ts`: 3 bands × 71 log-spaced levels from $1 to $10M, exact to the day, and the two dates (constants only,
so they can't rot). ⚠ Exact-day asserts over `Math.pow` are safe here, unlike an exact golden: the real root nearest a
whole day sits 0.0027 day from it (Fair at $10), ten orders of magnitude past Node 22's and Node 26's last-bit drift.

**`PL_ON_THE_LINE = 1`** — the opt-in "on the line" preset on BOTH Almanac faces. **Not an engine
branch:** it is `convergeMonths = 1`, where the existing weight `max(0, 1 − m/convergeMonths)` is
already 0 for every m ≥ 1, so month 1 onward IS the band value for that month. The faces only had to
drop their Convergence/Reversion slider floor (12 and 6 → `PL_ON_THE_LINE`) and add a ghost preset chip.
⚠ **Month 0 stays pinned to the live price**, so choosing it puts a real one-month STEP in the path —
today: support **−19.1%** → $64,468, fair **+123.5%**, resistance **+362.4%**. Both faces print the size
of that step in the path note; the chart shows it as a visible cliff, which is correct, not a bug.
Available on all three bands, though only support is a genuine stress — the other two are step-ups whose
peak CB LTV never exceeds today's.

**Coinbase APR context (both faces).** The APR slider is the owner's MANUAL `cbAprPct`, not a live feed —
the faces show what it has cost and let the owner pull the live number in by hand. 🔴 **`cbAprPct` is the
NET, all-in rate — Morpho's market rate PLUS Coinbase's 1.5% platform fee** (see **CB Loan → Platform
fee**); the live-rate seed and the quoted band both go through `cbNetApr`, and seeding the raw Morpho
number was the original defect. `MORPHO_REALIZED_APY` (in `useMorphoRate.ts`) is this market's realized
band from Morpho's `historicalState`: **4.1–7.5% over 23 months since Oct 2024, max 9.9%**, median 5.3 —
the MARKET rate, which is NOT what the loan cost. The faces quote the derived **`CB_REALIZED_NET_APR`**
(5.6–9.0%, max 11.4) instead. Static by design: those move ~0.2pt/yr, so re-fetching 24 points behind a
consent gate to recompute them would be a request for a rounding error; the refresh `curl` lives in the
constant's docblock. ⚠ The band excludes the first two months (1.6–3.1% on a brand-new market's thin
utilization — a property of a new market, not of this rate) and it is ONE CYCLE under one dollar-rate
regime: it says what has happened, never what can. The IRM permits 200% at target.
⚠ **The rate is a COST, not a danger, in this model** — peak CB LTV moves under a point across a 3→16%
sweep because the draw cap absorbs it into less accumulation. And the sign inverts with the path: on a
rising band the debt shrinks in BTC terms, so the spread between the stored rate and the realized
bull-regime rate is worth a rounding error over 20 years, while on a flat/support path it bites hardest. A regime-coupled rate was
measured and REJECTED on those grounds — a control and a concept for a rounding error.

⚠ **The APR is not the whole cost — the ORIGINATION FEE sits beside it in both faces.** Copy in the
block under the Coinbase APR slider names the 2%/1% brackets, says the fee is added to principal so it
compounds, prints this run's actual total (`sim.totalCbFees` over `sim.cbFeeCount` borrows) and closes
with the break-even. Unlike the APR, the fee is NOT a rounding error: on a 5-yr support/on-the-line/cap-70
run it costs a measurable fraction of a bitcoin, and the marginal rate only falls to 1% once the balance
crosses $250k. See **CB Loan → Origination fee** for the brackets, the cadence-neutrality result, and the
`liqMonth` 48 → 45 shift.

⚠ **BOTH faces now DEFAULT to Support + on the line** — the conservative read, not the flattering one.
`DEFAULT_CONVERGE_MONTHS = PL_ON_THE_LINE` on both; **`REVERT_PRESET_MONTHS`** (Cycling 48, Ownership 60)
is what the chip restores and **must stay distinct from the default**, or the toggle is a silent no-op.
Cycling also gained `DEFAULT_BAND = 'floor'` and `DEFAULT_INSPECT_MONTH = 24` (the scrubber opens at
2.0 yr, `Math.min`-clamped against the horizon, instead of at the far end). Ownership's `DEFAULT_PATH`
is now `'floor'`. **Cycling's `DEFAULT_CYCLE_MONTHS` is 1** (was 3), matching Ownership — sweeping monthly
parks the expensive 13% Strike balance for one month instead of three: Strike interest roughly HALVES and
peak Strike LTV drops 24.0% → 9.2%, against a much smaller rise in CB interest and ~1.2pt of peak CB LTV. Same bitcoin held either way — purchases follow income, not the sweep.
Pinned by two tests, one asserting month 1..24 equals `plBandsAt` per band, one asserting the step is a
real discontinuity (>5%) and signed correctly per band — so nobody can "simplify" the weight and
silently kill the preset.

⚠ **C2 NOTICE BUGFIX (OwnershipFace):** `degenerateCap` compared `rows[0].cbLtv * 100 <= capPct`, the
INVERSE of its own message ("at or above the cap, so this run never draws"). Since `drawing` is
`cbLtv < cap`, "never draws" means opening LTV **≥** cap. The old test hid the notice in exactly the case
`DEFAULT_CAP_PCT = 50` was chosen to surface (opening 50.58% vs a 50% cap) and showed it whenever the draw
was running fine. Now `>=`. This matters more since the faces default to Support + on the line, where the
draw stops at month 1 — the notice is the only thing that explains why.

## Cold-storage sweep (`coldStoreBufferPct`) — the THIRD pool

The Cycling engine gained an opt-in sweep: each month, Coinbase collateral in excess of a stated
survivable drawdown moves to a **cold pool** — unpledged, in no LTV denominator, and **not seizable**
(it lands in `survivorBtc`). `CyclingRow.coldBtc` is cumulative; `totalColdBtc` / `firstColdMonth` on the
result. `btcHeld` is now the THREE pools and stays display-only. `holdingsSplit` gained `cold`.
**OFF by default** (0/undefined/NaN → byte-identical to the old engine, pinned by a test).

🔴 **The knob is a SURVIVABLE DRAWDOWN, not an LTV** — `floor = CB_LLTV × (1 − buffer)`, so a 60% CB LTV
IS a 30% buffer. Stating it the second way is the point: 60% sounds conservative beside the 70% draw cap,
but it means "liquidated if price breaks 30% below the path."

⚠⚠ **CALIBRATE AGAINST THE REGRESSION LINE, NOT AGAINST SUPPORT.** On the support path the buffer reads as
"% below Support", and that unit has **no historical content on its own**: Support is PARALLEL to fair
(same `PL_B`) at a fixed **36.2%** of it (`0.42e-17 / 1.16e-17`), and its constant was **fitted to the
cycle bottoms** (the 2022 bottom implies 4.2317e-18 vs the 4.2e-18 used). Support already IS the deepest
drawdown on record, so a further "% below Support" prices a scenario nothing calibrates. Translated:
30% buffer → 25.3% of fair (0.70× the fitted floor); 50% → 18.1% (0.50×); 70% → 10.9% (**0.30×, i.e. 3.3×
deeper than any bottom ever recorded**). ⚠ An earlier draft of this feature recommended 50–70% because it
"cost no bitcoin" — it also cost five to eight years of waiting. `DEFAULT_COLD_BUFFER_PCT = 30`. The VIEW
prints the fair-value translation next to the slider and warns above 45%, so the knob can never be read as
more precise than it is. The §2 crossing lives in the view: the ENGINE's buffer is path-relative and it
still knows nothing about the power law.

🔴 **THE CLAMP — the sweep can never be looser than the draw cap** (`floor = min(CB_LLTV × (1 − buffer), cap)`).
Without it a 1% buffer implies an 85.1% floor and the sweep silently UNDOES the CB LTV STOP, stripping
collateral to a level the cap already calls too risky to borrow at. Measured unclamped on a −30%/yr path,
liquidation moved from month 13 to **month 2**. Withdrawing to a worse LTV than you will borrow at is
incoherent; the cap wins and the two knobs compose. Pinned by a test that every looser buffer behaves
exactly like the boundary one.

🔴 **THE CASCADE — TWO LEGS, ONE KNOB, RUN BY THE SWEEP *OR* THE DEFENSE.** The knob frees collateral at
BOTH venues and the engine chains them: **Strike → Coinbase → cold**. Only the Coinbase→cold hop is the
"sweep"; the Strike→Coinbase hop is a CADENCE MIGRATION that runs at each refinance turn when
**`coldOn || defend`** — its own justification is a DEFENSE one (the freed collateral is CB headroom that
lets more cheap debt refinance under the stop), so gating it on the sweep alone silently withheld it from
anyone who turned the sweep off. **Byte-identical only when BOTH are off** (then Strike collateral stays
fixed). ⚠ With the sweep off, `coldBuffer` is 0, so the `stressed` price the migration keeps collateral
against is the RAW price — the honest reading of "no buffer requested". ⚠ Both faces pass
`defendCbLtv: true` automatically, so a user who turns the sweep OFF sees different projections than
before: that is the fix, not a regression.
- **Strike → Coinbase (the migration — WHY the freed coins become CB headroom).** ⚠ `strikeCreditLine` is a
  FIXED DOLLAR amount that never grows with price, so the collateral needed to support the whole line
  SHRINKS as price rises. Over a twenty-year support path **~98% of the Strike pledge ends up idle** —
  pledged, earning nothing, still sitting with a custodian. The migration keeps the LARGER of two
  requirements, both evaluated AT THE STRESSED PRICE (`price × (1 − buffer)`): enough to still draw the
  FULL credit line after the break, and enough to stay under the margin-call LTV after it; the surplus
  moves to the CB pool BEFORE the refinance, so it creates headroom that lets more cheap debt move under
  the stop the same month. Both requirements pinned by tests. `strikeColl` is therefore **NO LONGER
  `const`** in the engine; purchases still never go there. ⚠ **If Strike ever RAISES the line, the migrated
  collateral is what you would need back.** The model has no way to know that will happen, so it migrates
  on today's line and the face says so.
- **Coinbase → cold (the sweep).** The loan de-levers as price rises, so collateral above the buffer's
  floor is surplus. Only this leg touches `coldBtc`. Origin attribution is **FIFO** (`strikeToCbPending`):
  migrated coins are attributed to Strike when they leave for cold, so `coldFromCb` / `coldFromStrike`
  stay separable even though the CB pool commingles them.
- **Retrieval (the emergency top-up reverses the Coinbase→cold hop).** `coldRetrievedBtc` is cumulative;
  the pool invariant is now **`openingColdBtc + coldFromCb + coldFromStrike − coldRetrievedBtc ===
  coldBtc`** (the opening reserve is a THIRD origin the two split fields do not carry — the owner's real cold
  since real-cold spec v1) and the Cycling card prints it as `C ₿ you hold today` beside the two sweep origins,
  less `− R ₿ used to defend the loans` (every retrieval: the CB top-up, the Strike top-up, a Strike cure), so the
  origins still reconcile.

🔴 **ON BY DEFAULT in BOTH faces** (`DEFAULT_COLD_ON = true`, `DEFAULT_COLD_BUFFER_PCT = 30`). Both faces
run the SAME engine, so a different default in one would make them disagree about one position. The
default band is Support, where the sweep is free, so defaulting it off was hiding the safest reading of
the strategy behind a toggle. ⚠ **While the support policy applies (on by default since Run 2b), the engine
ignores this buffer** — the policy's own sweep decides what goes to cold, and the faces hide the slider, the
fair-value text and the toggle (§ Support-anchored policy → Faces (Run 2)).

**Cycling card — outcome first, constraint second.** ⚠ The headline is the ₿ that reaches the owner's own
custody, with the split by origin under it; the knob comes after. Leading with the rule ("survive a break
of 30%") made the card read as a risk setting rather than a plan. And **the slider displays a PRICE**, not
a percentage — "Keep me safe down to $61,236" is a decision; "survive a break of 30%" is arithmetic you
have to do first. The % and the reference month ride along in the note beneath.

**Price stress readout** now leads with the price in BOTH states (`$78,651 · as modeled`), matching the
Ownership face's Price lens. Showing only "as modeled" at lens 1 made the reader hunt for the number the
card is about.

**Cycling face placement.** The card sits between **Holdings by venue** and **Coinbase LTV over time** —
it is the control that moves the venue segment and moves the LTV curve, so it belongs between the two
things it changes, not down in the Strategy row. The long-form reasoning (buffer↔LTV equivalence, the
fair-value calibration, the path-dependence warning) lives in an **`InfoTip`** on the card title rather
than three paragraphs of body copy nobody re-reads. **Milestones** gained a **Cold** column, rendered only
when the sweep is on and styled `--btc`: ⚠ it is a SUBSET of the BTC column beside it (`btcHeld` is all
three pools), never a second total to add.

**`InfoTip` (`components/ui/InfoTip.tsx` + the pure `infoTipModel.ts`)** — the repo's tooltip primitive. ⚠ NOT a CSS
`:hover` tip: this is a touch-first PWA, hover does not exist on a phone, and a hover-only tip is invisible to most
users. Spec `pbloc-spec-infotip-fit-v1` (v1.1).
- **Where.** Eight ⓘs on four faces:
  - the Support policy card (Decision, Cycling, Ownership, Strategy);
  - the Strike LTV cap / defense line (Cycling, Ownership, Strategy);
  - Cycling's Cold storage (policy off only).

  Mining and Living don't use it; they share only `ui/SliderInput` (I5).
- **Placement — measure and nudge (I1, I2).** CSS hangs the panel under the ⓘ (`left: -8px`).
  - A `useLayoutEffect` (before paint) reads its rect and slides it sideways by
    `tipShift(left, right, document.documentElement.clientWidth)`, so it sits inside [16, width − 16].
  - It is placed again on every `resize`, and a rotation fires one.
  - `place()` clears the shift before it measures, so a re-place never compounds a stale one.
  - ⚠ **No fixed side works.** On a phone the ⓘs sit left of centre (137–174px at 390) and the panel is about 90% of
    the screen wide. The old ≤480px rule hung it leftward and cut 44–55% off the left edge; hung rightward, it would
    run 90–127px off the right.
  - `max-width: min(calc(100vw - 32px), 26rem)` keeps it narrower than the space between the gutters. If it is too
    wide anyway, the left (reading) edge is pinned.
  - `clientWidth` leaves out a computer's scrollbar.
  - **The gutters are the viewport's.** That works because nothing clips an InfoTip sideways inside the viewport:
    - the faces' `.face` and `.card` have no overflow;
    - `html`/`body` and EdgeBackGesture's `.wrap` clip at the viewport's edge;
    - full-mode `.main` spans the viewport.

    A future InfoTip inside a narrower overflow box would need that box instead.
  - ⚠ **`.panel` has `transition-property: none`.** The global reduced-motion rule gives every element an 80ms
    transition. Without the guard, under Reduce Motion:
    - the panel slides in from its off-screen spot;
    - after a resize, the re-place measures a transition that has only just started, so the panel settles in the wrong
      place (123..466 at 375).
- **Opening — `nextTipState`: closed / hover / pinned (I3, I4).**
  - Hover opens it only for a mouse (`pointerType === 'mouse'`).
  - A tap or click pins it, until a second tap or click on the ⓘ, Escape, or a tap or click outside.
  - Moving the mouse away closes only a tip that hover opened.

  The reasons:
  - ⚠ **Never `onMouseEnter`.** A touch tap fires its pointer events, then mouseover → mouseenter → mousedown →
    mouseup → click. So a mouseenter-open plus a click toggle shut the tip in ONE tap in Chromium (Android). Only
    WebKit's hover heuristic spared iOS: a mouseover that reveals content swallows the click. With an ungated hover and
    pin-on-press, iOS would need three taps to close it. On a computer, the old click toggle also closed the tip being
    read.
  - **Hover uses NATIVE `pointerenter` / `pointerleave` listeners on the wrap.** They fire exactly on it, and they
    don't depend on React's over/out emulation, whose `toElement` fallback is engine-specific.
  - The trigger's `::after` sits on `.wrap`, its containing block, inset −9px. It bridges the 8px gap above the panel
    by 1px, so moving the mouse straight down onto the panel keeps a hover-opened tip open.
- **Unchanged.**
  - Escape and an outside `pointerdown` close it. ⚠ It is `pointerdown`, not `click`, or the trigger's own onClick
    reopens it and then instantly closes it in one gesture.
  - The panel is UNMOUNTED when closed. A hidden-but-mounted panel leaves its text in the accessibility tree and in
    Cmd-F.
- **Tests:** `infoTipModel.test.ts`, `infoTipWiring.test.ts` and the "InfoTip" e2e (§ Test Suite).

**Ownership face.** Same default and the same cold venue row, plus a **Cold series on the Held · owed
chart**. ⚠ It plots UNDER `yours` as a floor — the coins no lender can reach — and it is a SUBSET of
`held`, which already contains it. `OwnershipChartRow.cold` is 4dp-rounded like every other series, and
the `<Line>` is a DIRECT child of `LineChart` (wrapping a conditional series in a fragment makes recharts
render an empty grid — the existing comment in that file).

---

## `coldStorageBtc` — a REAL balance, not the projection

🔴 **Do not confuse these two.** The Almanac sweep above is a SIMULATION and never touches the store. The
viewer's "Where the coins sit" reports what the owner ACTUALLY holds, so it needed a real field:
`store.coldStorageBtc`, a plain owner-entered scalar (Settings → beside Current BTC collateral, NOT gated
on `hasCbLoan` — self-custodied coins exist with or without a loan). Additive: initial-state default +
`migrateState` default, **no store version bump** (the `blocMinPaymentSource` precedent). Syncs as a plan
field, so `SETTINGS_FIELDS` grew by one (payload 37 → 38 keys, `PLAN_EVENT_FIELDS` 33 → 34, persisted
blob 96 → 97 — all three pinned and all three updated).

`deriveVenueSplit(strikeBtc, cbBtc, coldBtc = 0)` gained a third venue; the default keeps every existing
two-arg caller byte-identical. ⚠ Cold IS in the denominator — the card answers "where are my coins", and
omitting the unpledged share would overstate how much of the stack is pledged. It is the one venue there
that is not collateral, which is why it takes `--btc` rather than a lender's colour, and the segment and
cell are hidden entirely at 0 rather than showing a permanent `0.000` for something the app is not
tracking.

**Cold ledger — anchor + events (store unchanged, NO bump).** Cold is now event-sourced on top of the scalar:
`live = deriveColdStorage(dayLog, coldStorageBtc, coldStorageBtcAsOf)` (`logUtils`). Every live reader goes through
the store getter **`getCurrentColdBtc()`** (`advisorJournalSlice`); a grep guard fails if any component reads the raw
anchor. The `DayEvent` deposit/withdraw `target` widened to `'strike' | 'cb' | 'cold'` (no new kind).
- **The scalar STAYS in `SETTINGS_FIELDS` — it is the ANCHOR.** Removing it would fail every existing backup
  (`VALIDATE_WHITELIST` rejects unknown keys); the new `coldStorageBtcAsOf` is additive and safe. Payload 38 → 39,
  `PLAN_EVENT_FIELDS` 34 → 35, blob 98 → 99 — all pinned, all updated.
- 🔴 **`coldStorageBtcAsOf` is EPOCH MS, not an ISO date** (unlike every other `…AsOf`).
  - The ordering is `deriveStrikeCollateral`'s (date, ts) rule, COPIED not shared: a move counts iff
    `ev.date > anchorDate || (ev.date === anchorDate && ev.ts > anchorMs)`.
  - A date-only rule silently loses the commonest flow: re-type the total, then log today's move.
  - `null` (legacy) → every cold move counts.
  - Residual (same as strike): `updateDayEvent` bumps ts, so editing a same-day pre-anchor move makes it count.
- **Paired setter:** `setColdStorageBtc(v)` is ONE `emitPlanSets([[coldStorageBtc, v], [coldStorageBtcAsOf, Date.now()]])`
  — one ts, so the pair cannot tear. `v` is the owner's cold TOTAL now; re-entering it IS the reconciliation.
- 🔴 **The Settings field binds the LIVE total, never the anchor.** `NumberInput.commit()` calls `onChange` on every
  blur with no equality check. An anchor-bound field would therefore re-stamp on a mere focus-and-leave and silently
  erase every cold move since. Bound to the live total, an unchanged blur is idempotent. It uses `decimals={8}`,
  because the total is a sum.
- 🔴 **Journal-only for the rollup.** `isMonthlyMeaningful` counts a deposit/withdraw ONLY with `target:'strike'`. A
  cold (or cb) move never creates a month, flips a manual month to daily, or reopens a confirmed one (the BUG1 class).
- **EventSheet:**
  - The target toggle always renders Strike | Coinbase (iff a loan) | Cold.
  - ⚠ Only `'cb'` collapses to Strike without a loan — in `EventSheet` AND in `buildEventsFromSheet`. A second copy
    of the collapse in the latter used to turn a no-loan cold deposit into a STRIKE deposit.
  - The per-target `COLLATERAL_TARGET_RULES` (`needsReading` / `needsLiqPrice` / `ltvWarnVenue`) drive every
    branch, so none can silently fall into the Strike arm again. The withdraw cap is `collateralAvailableFor(target, …)`.
  - A cold move is written ALONE — no `balanceReading`, no required balances.
- 🔴 **A transfer is TWO entries.** A lone cold deposit double-counts total holdings (OwnershipBar and
  `deriveVenueSplit` sum all three pools) until the source withdrawal is logged. DECIDED: the sheet shows **Total
  holdings after** (`totalHoldingsAfter`) plus a transfer note before save, and a test pins the window. A source
  selector that emits the paired withdrawal is out of scope.
- **Viewer — the C-P4 mirror.** The viewer's `dayLog` is `[]`, so a viewer-side derive would return the bare anchor.
  - The trusted snapshot ships a top-level derived `coldStorageBtc` (a conscious EXPOSE).
  - It STRIPS `coldStorageBtcAsOf` from its settings.
  - `applyViewerEvent` raw-sets the scalar in the same `setState` as the Strike/CB scalars.
  - The SAFE snapshot is unchanged.
- **Surfaces:**
  - `ViewerHomeView` (owner Dashboard, trusted viewer, preview) reads the getter.
  - The three engine faces (Cycling, Strategy, Ownership) read the getter into the engine's `openingColdBtc`
    (real-cold spec v1 — see "Real cold in the projections" below).
  - The Daily trio card gains a quiet cold footer row — shown when the total is > 0 or any cold move exists, and
    NOT a 4th cell.
  - Settings shows "Anchored <date> · N journal moves since", or "Not dated yet".
  - The Monthly Playbook is unchanged (it is a Strike plan). ⚠ Run 2 (the plan of record): THIS MONTH's card now runs the
    plan, which starts from the real cold reserve (`usePlanMonth` reads `getCurrentColdBtc()`), and its catch-up offers
    "Move ₿X from cold storage to Coinbase" when the reserve covers it.
- `resetPlanToSeeds` now resets `coldStorageBtc` and its stamp; it used to leave the cold balance behind.

**Real cold in the projections (real-cold spec v1 / v1.1 — store unchanged, NO bump; engine logic untouched).** The
three engine faces (Cycling, Strategy, Ownership) read `getCurrentColdBtc()` into the engine's `openingColdBtc`, so every
projection starts with the owner's real reserve in the cold pool and a crash defense can spend coins that exist, not
only the ones the run swept. The never-draw baseline holds the same reserve, so an UNSPENT reserve moves nothing but
itself: `btcHeld`/`coldBtc` +C, `collateralValue`/`equity` +C × price, the verdict's ₿ and all-in deltas unchanged (pinned).
- **Wiring, each face:** the `useShallow` selector `openingColdBtc: st.getCurrentColdBtc()` (a primitive); `openingColdBtc`
  in the `engineInputs` body and deps AND the lens-reset deps — a cold move logged on the Daily view clears a stress.
- **Every opening figure includes the reserve:** `openingBtc = strike + CB + cold` feeds "from X ₿", the seed row
  (`seedLine`: `· X ₿ (C ₿ in cold storage) against $Y` when a reserve shows) and Ownership's "Opening position".
  `seedLine`'s empty position (the plan of record's Run 2 — D-R2-4 lets a fresh install with the loan switched off
  reach it): "Seeded from your live plan · nothing held or owed yet", and "… nothing owed" / "nothing held, $Y owed"
  when only one side is empty — never "0.0000 ₿ against $0".
- **The cold card:** § Support policy — Faces (Run 2) → "Cold card with the owner's reserve".
- ⚠ **Under the support policy the emergency Coinbase top-up IS doom-gated** (the doom gate, adopted 2026-09-27 —
  § LTV defense → "The cold rules below support"): in a month Coinbase cannot survive, the reserve stays out of it. On
  P1 × 0.35 from m12 (a synthetic 0.5 ₿) the pre-adoption order poured the whole reserve into the month-12 top-up and
  Coinbase was liquidated anyway; the doom gate keeps it in cold — and since Policy v2 the seizure on the way down keeps
  it out first (month 12 opens past 86% and is seized before any top-up runs). SAME-MONTH by design — cold topped in
  while Coinbase was still savable can be lost to a later liquidation, which the cold card's reserve sentence gates on. With the policy
  OFF the top-up is NOT doom-gated (that arm is unchanged, real-cold decision 1).
- **Since the crash playbook (Run 1)**, between the liquidation depth and support the reserve goes into Coinbase BEFORE
  the debt shift (top up first, also doom-gated); below the depth it is still the fallback after the shift
  (§ LTV defense → "The crash playbook").

---

⚠ **NOT free safety — the sign depends on the PATH.** Swept coins are gone, so every later month starts
from a smaller base. **Rising:** free (identical total stack; a test pins it). **Flat:** trades stack for
time — the cap binds sooner, so less drawing and less accumulation, but never an earlier liquidation once
clamped (pinned). **Falling:** pulls liquidation FORWARD (pinned — an earlier version of this engine
claimed the sweep "can never cause a liquidation" and that claim was simply WRONG). The face shows the
liquidation month alongside the ₿ banked for exactly this reason.

---

⚠ **The Ownership face's `drift` ("Fixed rate") path is REMOVED** — `pathKind` was then exactly `PlBand`
(since widened to `PathKind = PlBand | 'fourYear'` — see below), the `growth` overlay key and the conditional
Annual-growth slider are gone, and `driftPath` was deleted from `ownershipFaceView.ts` as dead code. A
flat/fixed-rate price is not a thing bitcoin has ever done, so it was a scenario nobody would legitimately
plan on. The Cycling face never had it.

### 4-yr cycle price path — `fourYear` (`src/simulation/cyclePath.ts`; no engine or store change)

A FOURTH path kind on both the Cycling and Ownership faces, opt-in (`DEFAULT_BAND` / `DEFAULT_PATH` stay
`'floor'`). **Why:** `plConvergencePath` rides one band monotonically, so over the default horizon the Support
path's deepest drawdown after month 1 is **exactly 0** — it cannot fall. Liquidation is a PATH property, so a
monotone path never exercises the CB LTV stop or the defense cascade, and never shows what the cold-storage
sweep COSTS (the sweep fires on strength; coins moved to cold near a peak are collateral the next bear no
longer has). The cycle path oscillates support ↔ fair on `CYCLE_TURNS`: **−52%** from the 2029 top into the
2030 trough.

- **Model:** price = `plFairValue(d) × cycleMultAt(d)`. `CYCLE_TOP_MULT = 1.00` — tops on the fair line, a
  CALIBRATION CHOICE fitted to the Oct-2025 top (tops ran 19.3× → 11.6× → 6.0× → 2.5× → 0.99× fair; revisit
  each cycle; `PL_A_CEILING` plays NO role). `CYCLE_LOW_MULT = PL_A_FLOOR / PL_A_FAIR` — DERIVED, so the trough
  IS the support line by construction. Log-linear in days between turns. It predicts shallower bears than
  history (−52%, not −77%) — coherent and falsifiable, not a bug.
- **§2 wall:** `cyclePath.ts` imports from BOTH belief leaves so neither gains an import (`powerLaw.addMonths`
  is now exported for it). `cyclingSim.ts` and `cycleModel.ts` are untouched — the engine still gets a plain
  `number[]`. A belief: never importable by the risk core. The futures' `pricePaths.ts` (Policy v2 — the lenses) is the
  same kind of leaf: it reads both belief modules, `monteCarlo` runs its paths on the engine side, and `futuresRun` is
  the only module that imports both.
- **Naming — a deliberate asymmetry, do not harmonize:** the module/constants are `cyclePath` / `CYCLE_*`; the
  user-facing key is `'fourYear'` ("4-yr cycle" on Cycling, "Ride the 4-yr cycle" on Ownership) because
  `'cycle'` is already a `CyclingMode` and Ownership has a Strategy "Cycle" button on the same card — which is
  also why the slider is "4-yr cycle timing". `PlBand` stays exactly `'floor'|'fair'|'ceiling'`: `'fourYear'`
  must never reach `plBandsAt` / `plBandAt` / `PL_BAND_LABEL` (all `Record<PlBand, …>`). Both faces branch on
  `pathKind === 'fourYear'` before indexing, and the "sits on / tracks the line" copy has a cycle variant (an
  oscillating path tracks no line). CyclingFace's `band` / `Overlay.band` were renamed `pathKind`.
- **Phase shift** (`Overlay.phaseShiftMonths`, −12…+12, face-local 44px `.scrub`, positive = LATE): a fixed
  MILLISECOND offset, `CYCLE_SHIFT_MONTH_MS = 30.4375 d = 2,629,800,000 ms` — a whole number, so exactly
  invertible. ⚠ NOT `addMonths`: its day-of-month clamp is not invertible, and the shifted schedule and the
  shifted probe disagreed on the 2034-07-31 turn for 5 of 12 shifts. Framed as a robustness check, never a fit.
- **Milestones + path note — one schedule, two consumers.** `shiftedCycleTurns(shift)` is the single source.
  The path note reads it UNCLIPPED (`upcomingCycleTurns` → "Next low 5 Oct 2026, next high 3 Sep 2029"; a
  12-month horizon would otherwise lose the next high). Milestones read it clipped (`cycleTurnsInHorizon`):
  nearest row, **ties → later row**, and a turn nearest **row 0 SNAPS to row 1** — row 0 is live spot, and
  dropping it would hide the most imminent trough. Every turn row shows the turn's real date (`fmtTurnDate`,
  a fixed month table — `toLocaleDateString('en-GB')` renders "Sept" under Node's ICU). `mergeMilestoneRows`
  merges them with the fixed 12/24/36/60/120 rows; a turn landing on a fixed row keeps its label (row 36 on
  the default view). Ownership's turn rows jump the scrubber like its other rows; Cycling's are not clickable.
- **⚠ THE FLOAT HAZARD — compare PRICES, not multiples.** `plFloor(d)/plFairValue(d)` is not bit-equal to
  `PL_A_FLOOR/PL_A_FAIR` (47 of 168 monthly dates differ). The below-support warning is now
  `selRow.price < supportAtMonth * (1 − 1e-9)`, a float-equality guard for the cycle path's `fair × mult`
  construction. ⚠ It is NOT gated on the lens: the cycle path never dips under support on its own (the
  multiple is bounded below by `CYCLE_LOW_MULT`), and a gate would hide a real warning from a slow convergence
  out of a below-support spot.
- **Two PRE-EXISTING defects fixed alongside:** (1) the Cycling cold-storage InfoTip computed "survive down to
  X% of fair" from the constant `PL_A_FLOOR/PL_A_FAIR`, so it reported the Support answer on Fair and
  Resistance too. It now reads the displayed path at the inspected month (`plBandAt('fair', …)`, so it moves
  with the stress lens), and the old `coldBufferPct > 45` rule became the path-aware `coldBeyondRecord`.
  (2) The lens-reset mirror drift (`coldBufferPct`) — see the inspection-layer section above.
- **Colour:** `--maroon-lift` (#AE7575, 5.00:1 on `--surface`); the raw `--maroon` is 2.47:1, under WCAG's
  3:1 for text AND graphical objects such as a chart line. One `PATH_META` entry feeds the buttons, the path
  note, the BTC-price tile and the chart line. Ownership's `PATH_META` has no `color` (it was never read).
- Tests: `src/simulation/__tests__/cyclePath.test.ts` (23 — incl. the drawdown gap, Support maxDD `=== 0` vs
  cycle ≈ −52%, and an engine run where a synthetic leveraged position liquidates at month 42, inside the
  2029→30 descent, while the SAME position on Support never liquidates) + `cyclingFaceView.test.ts`
  (`coldBeyondRecord` 0/240 at 45% vs 240/240 at 46% on Support, the guard pinned on synthetic values;
  `mergeMilestoneRows`; the formatters) + `resetMirror.test.ts`.

Data: Blockchain.com (dev direct, prod via `/api/btc-history` proxy). The Power Law page fetches no block height (D2 of
spec pbloc-spec-powerlaw-face-v1 — `useMempoolData` is deleted).

---

## The plan's goal amount — `goalNetBtc` (BL14; batch 1 build 2; store unchanged, NO bump)

Spec `pbloc-spec-batch-1-v1` v0.6 §2.2. The owner's goal in NET COINS: every coin (Strike, Coinbase, cold) minus what is
owed, in bitcoin at the month's price — so borrowing can never reach it. The field and its readers: `store.md` § BL14;
the words: `almanac.md` § BL14; the Dashboard tile: `viewer.md` § BL14.

- **`simulation/goal.ts` — the pure leaf** the engine and the Dashboard tile share: `netCoinsBtc({ strikeBtc, cbBtc,
  coldBtc, strikeBalanceUsd, cbDebtUsd, price })` (null when it can't be read — no positive finite price, or a part that
  isn't finite) and `atGoalOf(net, goal)` (at or above, within `GOAL_EPS` = 1e-12 relative, so a figure computed onto the
  goal never reads as under it). 🔴 + − × ÷ only and zero imports: `cyclingSim.ts` imports it, so G1's import walk
  reaches it.
- **An input, `goalNetBtc`** (`CyclingInputs`) — REAL, never test-only (`.claude/rules/engine.md`). It applies only with
  the policy applied, in cycle mode, and as a finite number above zero; anything else is no goal (`CyclingResult.goalNetBtc`
  reports the goal the run applied, null otherwise). Readers pass it through `planGoalOf` (`lib/planGoal`).
- **Read once a month,** after Coinbase's interest and any on-the-way-down seizure, before the month acts (month 0
  reports the opening and acts on nothing): the row's `netCoinsBtc` and `atGoal` (null with no goal).
- **At or above the goal** the month draws nothing (the policy draw is skipped, so the month takes the policy's own
  not-drawing branch), buys nothing and refinances nothing (moving Strike's debt to Coinbase is borrowing on Coinbase).
  Spare income — after the bills (income → cash reserve → unpaid), a minimum paid from income and any restore — repays
  Strike, then Coinbase, to zero, through the pay-down zone's own code (`allocatePayDown`, the 0.005 sweep). What is left
  once both loans are at zero is KEPT: the row's `goalHeldUsd`. A month below the goal acts on its zone — no latch
  (D14).
- **What runs as before:** the zone and the breaker (read before the goal), the restore (a loan over its limit is repaid
  first), the migration, the sweep, and every defense — the debt shift still runs at the goal (it moves debt, never a
  coin), the only borrowing there. The goal itself never moves a coin between Strike, Coinbase and cold. THE MOVE's
  placement never reads the goal (G3, open: what THE MOVE keeps on Strike and Coinbase once both loans are repaid).
- **The never-draw baseline** reads the same goal at the same point (after its Coinbase interest, before Strike's): at
  the goal its surplus repays Strike, then Coinbase, and buys nothing; its leftover is kept. So a run that never acts
  still IS the never-draw world.
- **The kept income counts in all-in equity, on both sides:** `totalGoalHeldUsd` (Σ the rows' `goalHeldUsd`) in
  `allInEquity`, `baselineGoalHeldUsd` (the baseline's leftover after its pay-down) in `baselineAllInEquity` — each added
  only when above zero, so a run with no goal is bit for bit the same. Without it, whichever side cleared its loans first
  stopped counting its spare income from then on.
- **The never-draw verdict is ONE rule** — `neverDrawTie(r)` / `beatsNeverDraw(r)`: with a goal, a gap under
  `NEVER_DRAW_TIE_USD` (0.5, held equal to `utils/format`'s `DUST_USD` — a test pins it) is a TIE, never a win or a loss
  decided by rounding: a run at the goal from month 1 only repays, and the two sides' interest arithmetic differs in the
  last bits. Without a goal, never (BL14's kill criterion). `verdictVsNeverDraw` (the faces' head and the Decision tile)
  and `monteCarlo`'s `futureOutcome` (`beatsNeverDraw`, `tiesNeverDraw`; `FuturesSummary.tiesNeverDraw`) all read it.
- **No goal — absent, null, zero or junk — is byte-identical:** every gate reads as before, the three row fields are
  `null / null / 0`, both kept totals 0. Measured (spec v0.6): 12,734 runs, 630,014 months, against build 1's engine —
  0 differences; an unreachable goal moved no figure in 9,517 policy runs; over 24,384 runs no verdict changes.
- **Re-entry** (BL14's kill criterion, more than 1 month in 20 after first reaching the goal): 0.57% of the months on the
  Decision face's four paths, 1.46% over 18,000 futures — held. The tail: 13% of the futures that reach the goal re-enter
  in more than 1 month in 20 (they drift along its edge); a band (resume only some way under the goal) is the fix if an
  owner's numbers bounce; a latch stays rejected (D14).
- **Still open:** the build-1 engine's own no-goal tie (spec v0.6) — with no goal, a run that never acts (no Coinbase loan,
  the price under support for the whole horizon) IS the never-draw world too, and its verdict is residue; the tie rule
  without its goal gate fixes it, but moves no-goal screens, so it is queued as its own item.
- Tests: `src/simulation/__tests__/goalAmount.test.ts` (22) and `src/lib/__tests__/planGoal.test.ts` (5) — § Test
  Suite → "BL14 — the plan's goal amount".

---

