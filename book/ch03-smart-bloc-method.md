# Chapter 03 — The Smart BLOC Method

*Part 1: Plan · The Personal ₿LOC Book*

Chapter 02 showed Smart BLOC winning the crash test. This chapter explains the method itself: one ceiling, one draw line, three collateral tiers, and a first year that unfolds in four phases. None of it is complicated. All of it is enforced in code rather than remembered under stress.

## The 15% operating ceiling

The core rule is a single number: keep the Strike BLOC at or under 15% LTV, and defend that ceiling with income.

Every month the engine draws expenses onto the line, capitalizes interest, and then checks: is the balance above 15% of the collateral's value? If so, income pays the loan down before it buys a single sat:

```
paydown = min(income, balance − collateralValue × 0.15)
```

Up to 100% of the month's income goes to the paydown. This is the whole discipline. In good months the check never fires and everything after expenses buys bitcoin. In bad months — price down, or interest compounding on a grown balance — buying pauses and defense takes priority. The ceiling is not advice printed on a card; it is a branch in the simulation, and the projected months show you exactly when it will fire.

Why 15%? Because of the crash lens. An 80% drawdown multiplies LTV by five: 15% becomes 75% — above Strike's 70% margin call, but below the 85% partial-liquidation line, with a 72-hour window to act. The ceiling is set so that the worst drawdown in bitcoin's history leaves you bruised and alive, not liquidated. The constant has one definition in the codebase — `BLOC_OPERATING_CEILING = 0.15` in `strikeCredit.ts` — and every surface that runs the advisor passes it in rather than typing its own 0.15. A ceiling with two definitions would eventually disagree with itself.

## The 50% draw line, and what "available credit" binds on

The operating ceiling is your rule. The draw line is Strike's: credit can be drawn until the balance reaches 50% of collateral value. Between 15% and 50% is deliberate headroom — the ceiling is where you live, the draw line is where the lender stops you.

But "available credit" is subtler than one number, and the app computes it honestly:

```
limit     = min(creditLine, collateralBtc × price × 0.50)
available = limit − drawn
```

Two things cap your borrowing, and only one binds at a time. If your collateral at half its value covers less than your approved line, **collateral binds** — and your available credit falls when the price falls. If the collateral comfortably covers the line, **the line binds** — and a price drop costs you nothing until it doesn't. The app reports which one is binding, plus the `fullyBackedPrice`: the price above which your full credit line is collateral-backed. Below that price, the number on your lender's screen starts shrinking with the market. Knowing which regime you are in is the difference between a red month and a surprise.

## Collateral tiers: sizing the position

How much bitcoin does this method need? The app answers with three tiers, all from one formula:

```
collateral needed = monthly expenses / (ltv × price)
```

| Tier | LTV per month of expenses | Meaning |
|---|---|---|
| Minimum | 15% | one month of spending takes you to the ceiling |
| Recommended | 5% | one month of spending costs 5 points of LTV |
| Ideal | 2% | spending is a rounding error against the collateral |

Read the minimum tier plainly: with this much collateral, a single month of expenses drawn on the line puts you *at* the 15% ceiling, and every subsequent month triggers a paydown. It works, but you live at the ceiling. At the recommended tier you can draw for months before the rule fires. At the ideal tier the loan barely registers, and the method degenerates — pleasantly — into "hold bitcoin, spend the line, ignore it."

The formula runs on your actual expenses and the live price, so the tiers are dollar-denominated answers to a personal question, not generic thresholds.

## Year one, in four phases

The month-by-month view (`runBlocYearOne`) simulates your first twelve months and classifies each month into a phase. The order of operations each month: draw expenses (capped at available credit), accrue interest, run the ceiling check, then buy bitcoin with whatever income remains.

**Phase 1 — Accumulate.** The balance is under the ceiling. No paydown fires. All income buys bitcoin while expenses ride the line. Early months look like this, and if your collateral is at the recommended tier or better, most of the year does.

**Phase 2 — First paydown.** The month the ceiling check fires for the first time. It is classified separately because it is a psychological event as much as a financial one: the first month the method asks you to buy less bitcoin than you could. The projection shows you this month in advance, which is precisely the point of projecting.

**Phase 3 — Subsequent paydowns.** The rhythm of the mature position: some months buy, some months defend, most months split. The balance oscillates under the ceiling instead of climbing through it.

**Phase 4 — Credit exceeded.** The month a full expense draw no longer fits under the line. The engine draws what fits and flags the month: the remainder of your expenses must come from fiat. Phase 4 is a planning failure caught in the projection, months before it becomes a cash-flow failure at the grocery store. The app also derives a recommended credit line from this simulation — the peak projected balance plus 10% headroom — so Phase 4 stays hypothetical.

Phase classification is strict priority: credit-exceeded beats everything, then first paydown, then subsequent paydown, then accumulation.

## What the method is, and is not

The Smart BLOC method is one rule applied monthly with a position sized so the rule rarely fires. It is not a promise that borrowing against bitcoin is safe — the crash math in Chapter 02 is the honest version of that sentence, and the 72-hour window it relies on belongs to Strike, not to you. The app models the method; whether to run it, and at which tier, is your call.

*Planning software, not financial advice. Bitcoin-collateralized borrowing carries liquidation risk — model it before you live it.*

---

## From the code

- **Files:** `src/simulation/runBLOC.ts` (the 60-month engine, `calcTiers`), `src/simulation/runBlocYearOne.ts` (year-one phases, `getCollateralForTier`), `src/simulation/strikeCredit.ts` (`BLOC_OPERATING_CEILING`, `STRIKE_MAX_DRAW_LTV`, `strikeAvailableCredit`, `computeStrikeLtv`)
- **Numbers:** operating ceiling 0.15 (single definition, `BLOC_OPERATING_CEILING`) · max draw LTV 0.50 (`STRIKE_MAX_DRAW_LTV`) · available = `min(line, collateral × price × 0.50) − drawn`, binding: collateral vs line · collateral tiers min 15% / rec 5% / ideal 2%, sized as `expenses / (ltv × price)` · Strike bands 65/70/85 (72h) · recommended credit line = peak balance × 1.10, rounded up to $500 · phases: 1 accumulate · 2 first paydown · 3 subsequent · 4 credit exceeded
- **Tests:** `smartBloc.test.ts`, `strikeCredit.test.ts`

*Related chapters: ch02 (the four strategies compared), ch04 (the Advisor that runs this ceiling alongside a second loan), ch09 (the live Strike LTV bar).*

<!-- DRAFT v0.1 — Founder review -->
