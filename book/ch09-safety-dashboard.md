# Chapter 09 — The Safety Dashboard

*Part 3: Defend · The Personal ₿LOC Book*

Every screen in Personal ₿LOC eventually points at this one. The playbook plans the year, the journal records it, and the Safety Dashboard tells you — right now, in three bars — whether the position you actually hold is safe. Plan and Log exist so that Defend has honest inputs.

The dashboard answers three questions, and only three:

1. **How much of your Strike credit line have you used?**
2. **How close is your Strike LTV to Strike's partial-liquidation line?**
3. **How close is your Coinbase LTV to Morpho's instant-liquidation line?**

Each question is a dimension. Each dimension gets a bar, a level — Safe, Watch, or Act — and a color: green, amber, red. Nothing else is on the page, because nothing else matters on a bad day.

## The three dimensions

**Credit used.** Drawn balance divided by credit line. This is capacity, not market risk — the price can't move it — so its bands are wide: amber at 75% used, red at 90%. In the owner's own view this bar is always green, because to the owner capacity is *room*, not danger (more on that below). The classifier still computes the level, and the viewer sees it.

**Strike LTV.** Debt divided by pledged collateral times price, via one shared function (`computeStrikeLtv`). Strike's published terms warn at 65%, margin-call at 70%, and partially liquidate at 85% with a 72-hour window. The dashboard's bands are set *relative to* your Strike liquidation LTV so they fire before Strike does: amber at liquidation × 0.76, red at liquidation × 0.82. At the default 85% liquidation line, that means the bar goes amber at 64.6% LTV and red at 69.7% — you turn amber before Strike's warning letter and red before its margin call.

**Coinbase LTV.** Debt divided by collateral times price, via `cbMetrics`, with the balance first *accrued*: Coinbase's Morpho loan compounds interest daily, so the app rolls your last entered balance forward from its as-of date before computing anything. A stale figure would understate the risk; accrual keeps the read honest. The bands: green below your own advisor trigger (75% by default — your paydown line, not Morpho's), amber from there, red at liquidation × 0.93. Morpho liquidates at 86% LTV, instantly, with no grace and a ~4.4% penalty — so red arrives just under 80%, while there is still time to act.

| Dimension | Watch (amber) | Act (red) | The lender acts at |
|---|---|---|---|
| Strike credit used | 75% | 90% | — (capacity, not a lender line) |
| Strike LTV | liq × 0.76 (64.6% at default) | liq × 0.82 (69.7%) | 65 warn / 70 margin call / 85 partial liq (72h) |
| Coinbase LTV | your trigger (75% default) | liq × 0.93 (~80%) | 86% instant, ~4.4% penalty |

The pattern in that table is the whole doctrine of Part 3: **your bands fire before the lender's.**

## One classifier, everywhere

Here is the part that is architecture, not display. The three dimensions are computed in exactly one place: `deriveSafetyView` in `src/simulation/safetyView.ts`, a pure function with no store, no UI, and no clock inside it. The band logic underneath is three tiny functions in `cbMetrics.ts` — `barLevel` (two ascending thresholds in, Safe/Watch/Act out), `cbBarLevel` (the Coinbase specialization), and `worseLevel` (the more severe of two levels). Even the colors are one map: `LEVEL_COLOR` in `safetyView.ts` is the only place that says green, amber, red.

Every surface that shows a safety number consumes these functions:

- the owner's **Safety Dashboard** (its old inline copy of the math was deleted, on purpose);
- the **Coinbase Loan tab**'s main panel and sidebar;
- the **Almanac Ledger**, which colors its CB LTV cells through the same `cbBarLevel` and the same `LEVEL_COLOR`;
- the **landing page's crash-test widget** (chapter 11), which imports the real thresholds;
- the **viewer's home screen**, for the person you've shared gauges with (chapter 14).

There is also exactly one mapping from stored state to inputs — `selectSafetyViewInputs` — so no surface can even *feed* the engine differently. The consequence is blunt: the dashboard, the CB tab, the ledger, the landing demo, and your family member's read-only view cannot disagree, because there is nothing to disagree *with*. In this codebase, two numbers that differ are a bug, not a styling choice. Nineteen test cases pin the bands, the guards, and the overall verdict.

## Liquidation distance, in plain dollars

An LTV percentage is abstract. The dashboard translates it: for each loan it shows the liquidation *price* — the bitcoin price at which your LTV hits the lender's line — and the distance to it as a fall the market would have to make. Strike's is your debt divided by (collateral × liquidation LTV); Coinbase's comes from `cbMetrics`, or from the liquidation price you copied off Coinbase's own screen if you entered one (an entered figure beats a computed one — readings are ground truth). The sentence on screen reads the way you'd say it out loud: *bitcoin would have to fall 58% from here.* That number is the one worth knowing cold.

## Readings drive the gauges

The gauges are live, but not because a server watches your accounts — nothing does. When you log a day in the journal, the required balance reading (chapter 6) writes the safety anchors: your Strike balance, your Coinbase balance, your entered liquidation price, each stamped with the reading's date, each guarded so a stale reading never overwrites a fresher one. The live price feed then moves the LTVs in realtime between readings. Feeds inform; readings anchor. Log a paydown at breakfast and the red bar retreats before you've finished your coffee — not because the app talked to your lender, but because you told it the truth and it did the arithmetic.

## The crash lens

Next to every live LTV sits its shadow: the same LTV computed at price × 0.2 — an 80% drawdown, roughly the worst bitcoin has done from a cycle top. `deriveSafetyView` returns it as `crashLtv`, and since LTV scales inversely with price, the crash figure is exactly five times the live one. The lens exists to keep a green dashboard humble. A position can be comfortably Safe today and still be a liquidation at price × 0.2; the lens shows you that *while everything is fine*, which is the only time the information is cheap.

## Two verdicts, one honest rule

The dashboard rolls the bars into an overall pill — the worst level among them, via `worseLevel`. But the owner's overall and the viewer's overall are deliberately composed differently, and the difference is a small essay in honesty.

The owner's overall excludes the credit bar. In the owner's view that bar is always green — capacity is room to maneuver, not market risk — and an always-green input would only dilute the verdict about the two dimensions the price can actually kill.

The viewer's overall — computed by `deriveViewerOverall` — *includes* credit. The viewer's credit gauge carries the 75/90 bands, so it can genuinely be amber or red; and a viewer's overall pill must be the worst of every gauge that viewer is shown. The rule has a name in the code comments: **no red card under a green overall.** If any bar on the screen is red, the summary may not say green. Same engine, same numbers — the composition differs only because what's on each screen differs, and the summary must never contradict the page it sits on.

The dashboard tells you where you stand. When the answer is Act, the next chapter is the room you walk into.

---

## From the code

- **Files:** `src/simulation/safetyView.ts` (`deriveSafetyView`, `selectSafetyViewInputs`, `deriveViewerOverall`, `LEVEL_COLOR`, `CREDIT_WARN_USED`, `CREDIT_ACT_USED`), `src/simulation/cbMetrics.ts` (`cbMetrics`, `accruedCbBalance`, `barLevel`, `cbBarLevel`, `worseLevel`, `CB_ACT_LTV_FACTOR`), `src/simulation/strikeCredit.ts` (`computeStrikeLtv`, `strikeAvailableCredit`), `src/simulation/runCoinbaseLoan.ts` (`CB_LLTV`), `src/components/SafetyDashboard.tsx`
- **Numbers:** credit warn 0.75 / act 0.90 · Strike bands at liq × 0.76 / × 0.82 (0.646 / 0.697 at the default 85% liquidation LTV) · Strike terms 65 / 70 / 85 (72h) · CB green below trigger (default 75), red at cbLiqFrac × 0.93 (`CB_ACT_LTV_FACTOR`) · `CB_LLTV` 0.86, instant, ~4.4% penalty · crash lens price × 0.2 (crash LTV = live LTV × 5)
- **Tests:** `src/simulation/__tests__/safetyView.test.ts` (19 cases: band edges, zero-guards, hasCbLoan gating, overall composition), `cbMetrics.test.ts` (metrics, accrual, entered-vs-computed liquidation price, `barLevel`/`worseLevel`)

*Related chapters: ch06 (readings anchor the gauges), ch10 (what Act means), ch11 (the crash test), ch14 (the viewer's gauges).*

<!-- DRAFT v0.1 — Founder review -->
