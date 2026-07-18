# Chapter 04 — The Advisor

*Part 1: Plan · The Personal ₿LOC Book*

The Smart BLOC method of Chapter 03 manages one loan. Real positions are often two: a Strike BLOC for monthly living, and a Coinbase loan (Morpho underneath) carrying a larger balance at a lower rate — and a much harder edge. Morpho liquidates at 86% LTV instantly, with no margin call, no grace, and a roughly 4.4% penalty. The Advisor is the engine that plans a year of income across both loans so that the hard edge stays far away.

Every month, the Advisor answers one question: where does this month's income go? The answer comes from the Coinbase LTV, through one of two strategies.

## The priority tiers

The Advisor classifies each month by the CB LTV at the start of the month:

| Tier | CB LTV | Label | BLOC draw | Extra to CB | Bitcoin |
|---|---|---|---|---|---|
| 4 | < 55% | Safe | full expenses | none | the remainder |
| 3 | ≥ 55% | Watch | full expenses | 25% of income | the remainder |
| 2 | ≥ 65% | Warning | 50% of expenses | 50% of income | the remainder |
| 1 | ≥ 70% | Emergency | $0 | 100% of income | $0 |

The tiers are a graduated retreat. Safe months look like Chapter 03: expenses on the line, income to bitcoin. As CB LTV climbs, income is progressively redirected to the Coinbase balance, and — at Tier 2 — the BLOC draw itself is cut in half, meaning half your expenses now come from fiat (the engine reports this as the `fiatGap`; it never pretends the money appears from nowhere). At Tier 1, everything stops except defense: no draw, no buying, every dollar of income to the CB loan.

Note where the tier boundaries sit: 55, 65, 70 — against Morpho's liquidation at 86. Tier 1 fires a full sixteen points before the cliff. The Advisor's bands are designed to exhaust themselves before the lender's begin.

One invariant holds every month, in every tier: BLOC paydown + CB payment + bitcoin purchase = income. The plan always allocates the whole month, and it always balances.

## Two strategies

The tier table above is the **monthly** strategy: a fixed CB payment each month, topped up by the tier-driven extra. It treats the Coinbase loan like a mortgage — steady amortization, accelerated when the LTV climbs.

The **ltvTriggered** strategy treats it like a reservoir instead. No monthly payment at all. The loan sits untouched until its LTV crosses a trigger, and then it is paid down in one decisive move — funded not from income but from the Strike line. Cheap debt is left alone; expensive interventions are rare and large. Which strategy fits you depends on temperament and rates; the app models both and recommends neither.

## Trigger, target, rotate-back — and why the band kills oscillation

The ltvTriggered strategy is governed by three thresholds, defaulting to 75 / 65 / 55:

- **Trigger (75%):** when CB LTV reaches it, the engine draws on Strike and pays Coinbase down to the **target** (65%). The draw is capped by Strike's available credit; if the cap bites, the engine reports the paydown as capped and names the shortfall rather than silently under-defending.
- **Rotate-back (55%):** when CB LTV falls to or below it — a recovering price does this — the engine reverses: it draws on the cheaper CB loan and repays the expensive Strike balance, refilling CB *up to the target*, never beyond it.

The design detail that matters is the asymmetry. Rotation back begins only at or below 55%, but it fills to 65%. Imagine the naive alternative — rotate back whenever LTV is below the trigger, and fill to the trigger. One paydown to 65% would be immediately followed by a rotation back toward 75%, which would re-arm the trigger, which would fire another paydown: a machine for oscillating, paying spread on every cycle. Instead there is a **neutral zone** from 55% to 75% where the engine does nothing at all. A position parked at 66% stays parked. Only a genuine recovery — LTV falling through 55% — earns a refill, and the refill stops at 65%, ten points short of re-arming the trigger. The band is quiet by construction. (The engine also refuses to run the block at all if the three thresholds are mis-ordered — nonsense configuration produces no churn, not creative churn.)

## The minimum payment: income or roll

Strike bills its monthly minimum — the accrued interest — and the Advisor models both ways of meeting it, as a setting:

- **Roll** (the default): the interest capitalizes onto the balance. Nothing is paid; the loan compounds. This is the classic BLOC posture and it is exactly what the Chapter 03 engines assume.
- **Income:** the minimum is paid from income before anything else. The paydown check and the bitcoin buy then run on the reduced budget. Lower balance, lower LTV, fewer sats — the projection shows the trade honestly.

Income mode has a failure state, and the engine names it: if the month's interest exceeds the month's income, only the covered portion is paid and the remainder — the `blocMinShortfall`, the **capitalized shortfall** — rolls onto the balance anyway. The row reports it as its own figure. A plan that quietly re-capitalizes what you thought you were paying is a plan lying to you; this one says so, per month, in advance.

## The Outlook

The Advisor's operating plan — this month's numbers, the ones you act on — is deliberately computed flat, with zero assumed price growth. Assumptions belong in the **Outlook**: a separate projection that runs the same engine under four scenarios — Bear (−30%), Flat, Power Law (the current model-implied rate, around 33%), and Bull (+80%) — and shows the year's tier pills under each. A bull scenario can show emergency tiers resolving on their own; a bear scenario shows which month the trigger fires. The scenario picker lives only in the Outlook. The console you operate from never depends on a growth guess.

And the projection is anchored, not imagined: it starts from your last **confirmed** month — a month you signed off in the journal (Chapter 07) — and its ending balances. A provisional month, one with flows but no balance reading, never advances the anchor. When your logged expenses drift more than 5% from the plan's assumption, the Outlook offers to re-anchor the assumption to reality. Projection is downstream of record; the record is downstream of you.

*Planning software, not financial advice. Bitcoin-collateralized borrowing carries liquidation risk — model it before you live it.*

---

## From the code

- **Files:** `src/simulation/runAdvisor.ts` (`getTier`, `runAdvisor`, `AdvisorInputs`, `AdvisorMonthRow`), `src/simulation/strikeCredit.ts` (`BLOC_OPERATING_CEILING`), `src/simulation/simpleModePlan.ts` (`deriveForMonth`, `composeMonthSummary`, `minPaymentStatus`), `src/components/Advisor/OutlookProjection.tsx`
- **Numbers:** tiers off CB LTV — T1 ≥ 0.70 (100% income to CB, $0 draw) / T2 ≥ 0.65 (50%) / T3 ≥ 0.55 (25%) / T4 safe · trigger/target/rotate-back defaults 75/65/55 (fill to target; rotate only ≤ rotate-back) · BLOC paydown = `min(incomeBudget, balance − btcHeld × price × 0.15)` — up to 100% of income · min-payment source `'income' | 'roll'`, default roll; shortfall capitalizes as `blocMinShortfall` · Outlook scenarios Bear −30% / Flat 0 / Power Law ~33% / Bull +80%; operating plan pinned to growth 0 · Morpho LLTV 86%, instant, ~4.4% penalty
- **Tests:** `strikeMinPayment.test.ts`, `simpleModePlan.test.ts`

*Related chapters: ch03 (the 15% ceiling this engine defends), ch07 (the sign-off that anchors the projection), ch09–ch10 (the bands and the console downstream of these tiers).*

<!-- DRAFT v0.1 — Founder review -->
