# Chapter 10 — The Emergency Console

*Part 3: Defend · The Personal ₿LOC Book*

There is a page in Personal ₿LOC built for one day: the day the price is falling fast and your Coinbase LTV is climbing toward a line that liquidates instantly, with no phone call and no grace period. On that day you do not want a simulator, a chart, or a decision to make from first principles. You want the decision already made, the amounts already computed, and the fallbacks already ranked. That page is the Emergency Console.

It appears whenever you have a Coinbase loan switched on — as the Emergency tab (unless you've hidden it), and as the Almanac's Emergency face. And it is a **read-only calculator** — it computes what to do and by how much, but it never writes to your journal and never touches your funds. Real moves happen on your lender's screen and get logged through the daily flow like any other day. The console plans the defense; you execute it. Planning software, not an execution venue.

## The ladder: your bands before Morpho's

Morpho liquidates a Coinbase loan at 86% LTV — instantly, no margin call, no 72-hour window, with a liquidation penalty of about 4.4%. Against that cliff the console holds a fixed four-rung ladder of Coinbase LTV levels:

| Stage | CB LTV | What it means |
|---|---|---|
| Watch | 69% | Pay attention. Check readings. |
| Prepare | 72% | Stage the defense: know your top-up number, cure Strike if you can. |
| Execute | 75% | Act. Work the playbook's steps now. |
| Last resort | 81% | The final rung before the last resorts. Everything is on the table. |
| — | 86% | Morpho liquidates. Instant. ~4.4% penalty. |

The ladder is deliberately front-run: the first rung fires 17 points below liquidation, and even the last-resort rung leaves 5 points of room. The console's stage header classifies your live position onto the ladder, and — because an LTV band is really a price — it renders every rung as a **price**: the bitcoin price at which you'd reach watch, prepare, execute, last resort, and liquidation, plus the distance to liquidation as a percentage fall from here. You can read your whole crash-day schedule off one rail before the crash starts.

## Collateral first: the doctrine in the denominator

The console's central doctrine is written into the arithmetic. Your Coinbase liquidation price is:

```
liquidation price = debt / (collateral in BTC × 0.86)
```

Two levers move it. Paying down debt shrinks the numerator. Adding collateral grows the denominator. Between two lines — the power-law support line and a liquidation depth below it (next section) — the console prefers the denominator, for a reason worth being precise about: **a collateral top-up is price-independent.** Moving 0.10 BTC from Strike to Coinbase grows the denominator by 0.10 BTC whether bitcoin trades at $100,000 or $40,000 — the same sats push the liquidation price down by the same proportion at any price, so the move works exactly as well mid-crash as it does in calm. A paydown, by contrast, needs dollars, and mid-crash your ways of raising dollars are either selling bitcoin at the bottom or drawing credit whose collateral just lost value.

So inside that band the console tops up first, with collateral you already own: coins from cold storage, then the Strike collateral Strike will release. Paydown is not banished — it becomes the **debt shift**, a draw on Strike that pays Coinbase down. It goes first outside the band, and it covers whatever a top-up leaves. Every dollar shifted *tightens Strike while loosening Coinbase*, so the console's card reports your new Strike LTV and Strike's new margin-call price (the 70% line) alongside the Coinbase relief. Defense is a transfer of risk between your two loans, and the console refuses to show you only the good half.

## The crash playbook

How much, from where, and in what order? The console answers with the **crash playbook** — `crashPlaybook`, the one crash-day answer and the same sequence the plan's engine runs — on your live position: your Strike balance and collateral, your Coinbase debt accrued to today, and your real cold storage. Its card lists the steps, with their amounts, drawn from three moves:

- **Move coins from cold storage into Coinbase.**
- **Release Strike collateral into Coinbase** — only what Strike will let go: at or under 40% LTV, only down to under 50% after, and never within 60 days of a Strike deposit.
- **Shift debt** — draw on Strike and pay Coinbase down with it.

The band comes from the power-law **support line**, which the stage header shows beside the liquidation price. Its floor is the *liquidation depth*: the multiple of support at which a Coinbase loan at your plan's limit would already reach 86%. Between that depth and support, the playbook tops up first — cold, then releasable Strike collateral, then a shift for whatever is left. Below the depth, at or above support, or when even every coin the rules allow couldn't clear 86%, it shifts first, then tops up the shift's shortfall — unless Coinbase is still doomed after the shift, when it doesn't. The card says which, and why, in one sentence before the steps.

It acts at your trigger — 75% LTV by default — and brings Coinbase back to your target, 65% by default; between the two it reads "No action," because that is where your plan waits. When it acts, the card ends with the after-state and the outcome: back at your target, still short (and by how much), or unable to clear 86% at all.

A **Simulate** button lets you move the price and watch the stage, the rail and the playbook follow — for this session only, never saved.

## The last resorts

When the playbook can't clear 86% even with every coin the rules allow, its card says so: only the last resorts remain. There are two, each collapsed until you open it, each with its arithmetic precomputed:

1. **Sell to pay down.** The console computes the exact paydown needed to reach a target liquidation price, and the BTC you'd have to sell at today's price to raise it. Selling is the thing this whole product exists to avoid — which is why the number is computed rather than hidden. You should know the size of the last-but-one resort.
2. **Outside cash.** Money from outside the position: savings, income, anything not bitcoin. The final resort is the oldest financial technology there is, and the console does it the courtesy of pricing it like the other: enter the cash, read the new liquidation price.

## No clock, no cycle, no comfort

Two hard rules keep this page trustworthy. First, the model is **clock-free**: it contains no dates and never reads the time. Interest accrual happens outside, at the boundary — the view accrues the Coinbase balance to today and hands the model a plain number. Every figure on the page is reproducible from its inputs: the ladder and the last resorts are pinned by tests against the Emergency Directive's fixtures to the dollar, and the playbook by its own. Second, the models are **cycle-free by an import wall**: `emergencyModel` and `crashPlaybook` import nothing from the power-law or cycle models, and they import nothing from them — enforced in the module graph, not by policy. On the worst day, no one wants to hear that the four-year cycle says the bottom is near; the cycle stays behind its wall (chapter 5). The power law's support line does come in, deliberately: the page reads it and hands the playbook a plain number to choose its order, and labels it "a historical regression, not a guarantee." No liquidation price ever reads it.

The console ends with a session-only checklist — steps to tick off as you execute, deliberately unpersisted, because a crash checklist is for the day you're in, not the record. The record is the journal, where the real draws and deposits get logged once they're made.

Model it before you live it: planning software, not financial advice — the decisions, and the loans, are yours.

---

## From the code

- **Files:** `src/simulation/emergencyModel.ts` (`CB_LADDER`, `classifyStage`, `wall3Sale`, `wall4External`, `STRIKE_MARGIN_CALL_LTV`), `src/simulation/crashPlaybook.ts` (`crashPlaybook`, the one crash-day answer), `src/components/Tools/crashPlaybookView.ts` (`playbookInputFromLive`, `waitingCard`, `playbookCard`, `isCrashDay`), `src/components/Tools/EmergencyConsole.tsx` (staleness banner · simulate banner · stage header + band rail · crash playbook card · last resorts · session-only checklist), `src/components/Tools/CbDefenseTool.tsx` (the one gate: a Coinbase loan), `src/simulation/cbMetrics.ts` (`accruedCbBalance`, the accrual boundary), `src/simulation/strikeCredit.ts` (`STRIKE_MAX_DRAW_LTV`, `STRIKE_RETRIEVE_MAX_LTV`)
- **Numbers:** ladder 0.69 / 0.72 / 0.75 / 0.81 vs `CB_LLTV` 0.86 (instant, `CB_LIF` ≈ 1.04384, ~4.4% penalty) · Strike margin call 0.70 · draw clamp 0.50 · Strike releases collateral only at or under 0.40, never within 60 days of a deposit · trigger / target 75 / 65 by default
- **Tests:** `src/simulation/__tests__/emergencyModel.test.ts`, `crashPlaybook.test.ts`; `src/components/Tools/__tests__/crashPlaybookView.test.ts`, `emergencyConsoleWiring.test.ts`

*Related chapters: ch03 (the 15% ceiling), ch05 (the wall the Almanac stays behind), ch06 (logging the real moves), ch09 (the dashboard that sends you here).*

<!-- DRAFT v0.1 — Founder review -->
