# Chapter 05 — The Almanac

*Part 1: Plan · The Personal ₿LOC Book*

Every bitcoiner carries two kinds of numbers in their head. The first kind is fact: your balance, your LTV, the price on the screen. The second kind is belief: where the power law says fair value sits, how long until the halving, where we are in the cycle. Both kinds are useful. Only one kind belongs anywhere near a liquidation calculation.

Personal ₿LOC keeps them in separate rooms. The beliefs live in the Almanac — a hub of model faces you can study, project with, and argue about. The facts live everywhere else. This chapter covers what the Almanac shows, and then the rule that matters more than any chart in it: how the wall between the two rooms is built.

## The power law

The oldest face in the Almanac is the power law: the observation that bitcoin's price, plotted against time since the genesis block, has tracked a straight line on log-log axes for its entire history. The model is one formula with three calibrations:

```
price = A × days^5.82        (days since 2009-01-03)

fair    A = 1.16e-17
floor   A = 0.42e-17
ceiling A = 10^-16.12
```

Fair is the center of the historical channel. Floor is the line price has bounced off in every capitulation so far. Ceiling is where blow-off tops have stalled. The three A constants are deliberately independent — none is derived by scaling another — because they were fitted to different edges of the same scatter, and the code refuses to pretend otherwise.

What the power law gives you is a sense of *where you are in the channel*: near the floor, near fair, or stretched toward the ceiling. What it does not give you is a promise. Every one of those constants was fitted to the past; the model has no mechanism, only fit. The Almanac presents it as exactly that.

## The halving clock

The second face is not a model at all — it is arithmetic on the protocol. Every 210,000 blocks the subsidy halves. The fourth halving landed at block 840,000 in April 2024; the next comes at block 1,050,000, estimated around April 2028. The clock computes the current epoch, the blocks remaining, and the fraction complete from the block height alone — one source (`epochProgress`) drives the dial's hand, its arc, and its percentage, so the face cannot disagree with itself.

The halving face is the Almanac's default, and its restraint is deliberate: the hero number is a day count, not a ticking seconds counter, because a countdown estimated from a 600-second block target does not deserve second-level precision. Honest instruments display honest resolution. The date is always marked as an estimate; the block number is the truth.

The halving math generalizes: when block 1,050,000 arrives, the fifth epoch derives with no code change. That is the difference between arithmetic and a story.

## The cycle dial

The third face is a story, and it says so. The cycle dial encodes one idealized premise: from the ATH of Monday, 6 October 2025, price falls to a low 364 days later, rises to the next high 1,064 days after that, and repeats. Both intervals are multiples of seven, so every projected turn lands on a Monday — a wink at the pattern's own tidiness. The projection runs fourteen turns, out to roughly 2050.

The dial is captioned in the app with the phrase that governs it: **a pattern, not a forecast.** And the interface enforces the epistemology. The halving face — the arithmetic — is the confident default. The cycle face is opt-in; its markers render ghosted on the halving face and only render solid when you deliberately switch to it. The one ticking countdown in the entire app lives on the cycle face, counting to a *projected* low, and it carries a permanent "idealized cadence" tag explaining why it should not be believed. The app is most precise about the number it trusts least, and it labels the irony.

Unlike the halving math, the cycle projection is fixed-anchored: it is bolted to one specific ATH and does not generalize. If the pattern breaks — and patterns break — the dial does not adapt. It is a museum piece of a premise, on display, dated.

## The wall

Here is the doctrine, and it is the real subject of this chapter: **nothing in the Almanac can touch a risk number.** Not as a default, not as a hint, not as a fallback. The power law cannot soften a liquidation price. The cycle dial cannot postpone an emergency tier. No screen in the app will ever tell you that your position is safe *because the floor model says the price can't go lower*.

This is not a style guideline. It is the import graph. `powerLaw.ts` and `cycleModel.ts` import nothing from the risk core — not the advisor, not the loan engines, not `strikeCredit`, not `cbMetrics`, not the store — and nothing in the risk core imports them. The `emergencyModel` behind the emergency console is clock-free and cycle-free by construction: it cannot ask what time it is, let alone where the cycle says we are. The safety dashboard's three dimensions are computed from your readings, the live price, and the lenders' thresholds — full stop. If a future change tried to feed a model output into a risk calculation, it would have to add an import that the architecture forbids and the tests would flag. The wall is grep-clean and meant to stay that way.

Why so absolute? Because the failure mode is seductive. Every leveraged bitcoiner who has been liquidated had a model that said it couldn't happen. The floor has held *so far* is a statement about the past wearing the grammar of the future. An emergency console that discounted an 80% crash because the power-law floor sits at 60% down would be an emergency console that fails exactly when emergencies happen — at the edge of the historical distribution. So the crash lens multiplies the price by 0.2 without consulting the floor, and the emergency ladder fires on your actual LTV without asking the dial for permission.

The Almanac is not lesser for living behind the wall. Models are genuinely useful for the *planning* imagination — the Outlook's power-law scenario in Chapter 04 is one honest use, clearly labeled as a scenario among scenarios. The Almanac is where conviction lives. The dashboard is where consequences live. The wall is the app knowing the difference.

---

## From the code

- **Files:** `src/simulation/powerLaw.ts`, `src/simulation/cycleModel.ts`, `src/components/Almanac/CycleDial.tsx`, `src/components/Almanac/HalvingClock.tsx`, `src/components/Almanac/CycleClock.tsx`, `src/simulation/emergencyModel.ts` (the walled consumer that never imports either)
- **Numbers:** power law `A × days^5.82`, fair A = 1.16e-17, floor A = 0.42e-17, ceiling A = 10^-16.12, genesis 2009-01-03 · halving interval 210,000 blocks; H4 at block 840,000 (Apr 2024); next at block 1,050,000 (~Apr 2028) · cycle: anchor Mon 6 Oct 2025 ATH, high→low 364 days, low→high 1,064 days, 14 turns, every turn a Monday
- **Tests:** `cycleModel.test.ts` (12 cases: epoch rollover, fraction single-source, the Monday premise), `emergencyModel.test.ts` (clock-free, cycle-free)

*Related chapters: ch04 (the Outlook's power-law scenario — the one sanctioned crossing, by explicit label), ch09 (the risk numbers the wall protects), ch10 (the emergency console that cannot see the floor).*

<!-- DRAFT v0.1 — Founder review -->
