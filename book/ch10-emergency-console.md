# Chapter 10 — The Emergency Console

*Part 3: Defend · The Personal ₿LOC Book*

There is a page in Personal ₿LOC built for one day: the day the price is falling fast and your Coinbase LTV is climbing toward a line that liquidates instantly, with no phone call and no grace period. On that day you do not want a simulator, a chart, or a decision to make from first principles. You want the decision already made, the amounts already computed, and the fallbacks already ranked. That page is the Emergency Console.

It appears when your Coinbase strategy is set to LTV-triggered mode (the crash-defense posture; monthly mode keeps the quieter Liquidation Simulator). And it is a **read-only calculator** — it computes what to do and by how much, but it never writes to your journal and never touches your funds. Real moves happen on your lender's screen and get logged through the daily flow like any other day. The console plans the defense; you execute it. Planning software, not an execution venue.

## The ladder: your bands before Morpho's

Morpho liquidates a Coinbase loan at 86% LTV — instantly, no margin call, no 72-hour window, with a liquidation penalty of about 4.4%. Against that cliff the console holds a fixed four-rung ladder of Coinbase LTV levels:

| Stage | CB LTV | What it means |
|---|---|---|
| Watch | 69% | Pay attention. Check readings, check firepower. |
| Prepare | 72% | Stage the defense: know your top-up number, cure Strike if you can. |
| Execute | 75% | Act. Move collateral now. |
| Last resort | 81% | The final rung before the walls. Everything is on the table. |
| — | 86% | Morpho liquidates. Instant. ~4.4% penalty. |

The ladder is deliberately front-run: the first rung fires 17 points below liquidation, and even the last-resort rung leaves 5 points of room. The console's stage header classifies your live position onto the ladder, and — because an LTV band is really a price — it renders every rung as a **price**: the bitcoin price at which you'd reach watch, prepare, execute, last resort, and liquidation, plus the distance to liquidation as a percentage fall from here. You can read your whole crash-day schedule off one rail before the crash starts.

## Collateral first: the doctrine in the denominator

The console's central doctrine is written into the arithmetic. Your Coinbase liquidation price is:

```
liquidation price = debt / (collateral in BTC × 0.86)
```

Two levers move it. Paying down debt shrinks the numerator. Adding collateral grows the denominator. The console prefers the denominator, for a reason worth being precise about: **a collateral top-up is price-independent.** Moving 0.10 BTC from Strike to Coinbase grows the denominator by 0.10 BTC whether bitcoin trades at $100,000 or $40,000 — the same sats push the liquidation price down by the same proportion at any price, so the move works exactly as well mid-crash as it does in calm. A paydown, by contrast, needs dollars, and mid-crash your ways of raising dollars are either selling bitcoin at the bottom or drawing credit whose collateral just lost value.

So the primary lever is the top-up: draw against Strike, buy bitcoin, pledge it to Coinbase. The console's action calculator (`drawToLtv`) prices the whole move: how many dollars a draw to a target Strike LTV raises — clamped to Strike's 50% maximum-draw line, not merely your credit line — how much BTC that buys, the new Coinbase liquidation price, and how far the floor dropped. It also shows the cost honestly: every dollar drawn *tightens Strike while loosening Coinbase*, so the calculator reports your new Strike LTV and Strike's new margin-call price (the 70% line) alongside the Coinbase relief. Defense is a transfer of risk between your two loans, and the console refuses to show you only the good half.

Paydown is not banished — it is demoted. It is the **Dire Switch**, the Wall-2 fallback for when the top-up lever is exhausted.

## Slow and fast firepower

How much can Strike actually raise? The console computes two answers, because there are two situations.

**Slow (cured).** In steady state the Smart BLOC method keeps Strike at or below its 15% operating ceiling (chapter 3). If you've held that discipline — or have time to pay Strike down to it before the storm — then everything between 15% and your chosen emergency ceiling is free headroom. That headroom is a *fixed amount of BTC*: (ceiling − 0.15) × your Strike collateral. Price-independent, knowable in advance, printable on a card.

**Fast (stuck).** If the crash finds Strike already drawn above 15%, your firepower is whatever room remains between the live drawn balance and the emergency ceiling — and that number depends on the price at the moment you act, shrinking as the price falls. The console shows both figures side by side with a cured/stuck toggle. The gap between them is the price of discipline, stated in dollars: the borrower who kept Strike cured walks into the crash with more ammunition, and the console makes that visible *before* the crash, when it can still change behavior.

## The floor table: how low can you push it?

The emergency ceiling — how far you're willing to lever Strike in a crisis — is yours to set, defaulting to 30% and clamped between 20% and 50%. The floor table runs the cured top-up at each of four ceilings — 20%, 25%, 30%, 50% — plus the standing row (no action), and shows for each: the BTC moved, the new Coinbase liquidation price ("the floor"), how much lower that floor sits than doing nothing, and — the sober column — how much *further* bitcoin could fall before Strike itself margin-calls at that draw level. Push the ceiling to 50% and your Coinbase floor drops furthest, but Strike's own alarm moves closest. The table lets you pick your trade-off in daylight instead of improvising it at 3 a.m.

## The four walls

When the ladder runs out, the walls begin — the ranked fallbacks, each with its arithmetic precomputed:

1. **Wall 1 — the collateral top-up.** The doctrine above; everything the console was built to make routine.
2. **Wall 2 — the Dire Switch.** Pay Coinbase down. A slider shows the new liquidation price for any paydown amount.
3. **Wall 3 — sell to pay down.** The console computes the exact paydown needed to reach a target liquidation price, and the BTC you'd have to sell at today's price to raise it. Selling is the thing this whole product exists to avoid — which is why the number is computed rather than hidden. You should know the size of the last-but-one resort.
4. **Wall 4 — external cash.** Money from outside the position: savings, income, anything not bitcoin. The final wall is the oldest financial technology there is, and the console does it the courtesy of pricing it like the others.

Alongside the walls, a surplus line answers the endurance question — what your monthly income clears after expenses and interest on the emergency balance — because surviving the day matters little if you can't carry the position through the month after.

## No clock, no cycle, no comfort

Two hard rules keep this page trustworthy. First, the model is **clock-free**: it contains no dates and never reads the time. Interest accrual happens outside, at the boundary — the view accrues the Coinbase balance to today and hands the model a plain number. Every figure on the page is reproducible from its inputs, and every one is pinned by tests against the Emergency Directive's fixtures to the dollar. Second, the model is **cycle-free by an import wall**: it imports nothing from the power-law or cycle models, and they import nothing from it — enforced in the module graph, not by policy. On the worst day, no one wants to hear that the four-year cycle says the bottom is near. The Almanac's patterns stay behind their wall (chapter 5); no speculation ever touches a liquidation number.

The console ends with a session-only checklist — steps to tick off as you execute, deliberately unpersisted, because a crash checklist is for the day you're in, not the record. The record is the journal, where the real draws and deposits get logged once they're made.

Model it before you live it: planning software, not financial advice — the decisions, and the loans, are yours.

---

## From the code

- **Files:** `src/simulation/emergencyModel.ts` (`CB_LADDER`, `classifyStage`, `firepower`, `drawToLtv`, `floorTable`, `direSwitch`, `wall3Sale`, `wall4External`, `surplus`, `STRIKE_MARGIN_CALL_LTV`), `src/components/Almanac/EmergencyConsole.tsx` (seven sections: staleness banner · stage header + band rail · firepower toggle · draw-to-LTV calculator · floor table · Walls 1–4 accordion · session-only checklist), `src/simulation/cbMetrics.ts` (`accruedCbBalance`, the accrual boundary), `src/simulation/strikeCredit.ts` (`STRIKE_MAX_DRAW_LTV`, `BLOC_OPERATING_CEILING`)
- **Numbers:** ladder 0.69 / 0.72 / 0.75 / 0.81 vs `CB_LLTV` 0.86 (instant, `CB_LIF` ≈ 1.04384, ~4.4% penalty) · Strike margin call 0.70 · draw clamp 0.50 · operating ceiling 0.15 · emergency ceiling default 30, clamped 20–50 · floor-table ceilings 20 / 25 / 30 / 50%
- **Tests:** `src/simulation/__tests__/emergencyModel.test.ts` — Directive fixtures ±$1 (liq 41,650.62; bands watch 51,912 / execute 47,759 / last-resort 44,222; slow floor 38,842 / fast floor 39,621 at crash price 48,000; `drawToLtv(30)` @ 48,000 → $5,990.73, 50%-line clamp; walls round-trip; ladder pinned at 69/72/75/81)

*Related chapters: ch03 (the 15% ceiling and why cured matters), ch05 (the wall the Almanac stays behind), ch06 (logging the real moves), ch09 (the dashboard that sends you here).*

<!-- DRAFT v0.1 — Founder review -->
