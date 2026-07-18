# Chapter 11 — Scenario Diff & the Crash Test

*Part 3: Defend · The Personal ₿LOC Book*

The dashboard tells you where you stand (chapter 9). The console tells you what to do when it's bad (chapter 10). This chapter is about the third capability a defense needs: rehearsal. What would my three bars look like if bitcoin fell to $60,000? If I drew another $10,000? If I moved half my collateral? Personal ₿LOC answers those questions twice — once for the owner, in an Almanac face called Scenario, and once for a total stranger, in a widget on the landing page. Both answers come from the same engine as the live dashboard, which is the entire point.

## Pin a posture

The Scenario face starts with a pin. Tap *Pin today's plan* and the app snapshots your complete safety posture — every input the safety engine takes: Strike balance, credit line, collateral held, the bitcoin price, both loans' figures, your thresholds — with a label and a timestamp. The pin is device-local and never synced; it's a bookmark, not a record (the journal is the record).

The pin gives you drift. From then on, the face shows a line comparing the pinned posture to your live one — *2 of 3 worse*, with signed point-deltas per dimension. Pin at the start of the month, glance at the end: the drift line is the month's risk story in one row, computed rather than remembered.

## Overlay a hypothetical

Below the pin sits the overlay editor: one input per lever, six levers in all — bitcoin price, Strike debt, Strike collateral, credit line, and (when you have a Coinbase loan) its balance and collateral. Each lever maps one-to-one onto an input the safety engine already takes, and the overlay does **substitution only**: a lever you set replaces the live value; a lever you leave alone keeps it. No unit conversion, no derived math, no cleverness — the overlay module (`applyOverlay`) is a spread and a loop, and it is deliberately too simple to be wrong. All the math stays where it lives, in `deriveSafetyView`.

The overlay itself is session-ephemeral — plain component state, never persisted, never synced. A hypothetical should evaporate when you close it; only the pin survives a reload.

## Diff through the real engine

Here is the load-bearing design decision. To compare two postures, `diffScenarios` runs **both** — base and overlay — through `deriveSafetyView`, the same pure function the live dashboard, the CB tab, the ledger, and the viewer consume. Not a copy of it, not a "preview approximation" — the function. Then it compares the outputs:

```
diffScenarios(current, applyOverlay(current, overlay))
  → capacityUsed / strikeLtv / cbLtv:
      { from, to, delta, fromLevel, toLevel, worsened }
  → crashLtv + cbLiqFrac from/to pairs
  → overallFrom / overallTo · worsenedCount (0–3)
```

Each of the three dimensions gets a from/to pair, a signed delta, and its Safe/Watch/Act level on each side — and the levels come *off the returned views*, never re-derived; no band or threshold is reimplemented anywhere in the diff. A dimension "worsened" only if its level actually crossed a boundary for the worse (a bigger number inside the same band is a delta, not a downgrade), and the verdict counts worsened dimensions — with the Coinbase dimension counted only when you actually have a Coinbase loan, so a no-CB plan can't be charged with a phantom worsening. The overall pills on both sides come from `deriveViewerOverall`, the same composition the viewer sees.

The consequence: a scenario preview **cannot drift from the dashboard**. If the what-if grid says a fall to $60,000 turns your Strike bar red, then the live dashboard at $60,000 will show exactly that red, at exactly that LTV — same function, same inputs, same thresholds. A rehearsal that used different math would be worse than none; it would teach you the wrong reflexes with a straight face.

Like the console, the Scenario face is read-only by construction: its only store write is the pin itself. And like the emergency model, it sits behind the import wall — the diff module imports the safety engine and nothing else; no cycle model, no power law, no store. It lives in the Almanac as its eighth face, but it imports none of the Almanac's speculation.

## The public twin: the crash test

Now the same idea, pointed outward. The landing page — the one a stranger reaches before creating anything — carries a widget headed *Set up a loan, then drag the price down.* Two fields: collateral (default 1 BTC) and borrowed (default $20,000). One slider: the bitcoin price, $15,000 to $250,000, starting at $100,000. Drag it left.

The LTV readout climbs. The bar fills toward a marked liquidation line. The verdict pill walks the app's real ladder — Safe, then Watch, then Act — and below the liquidation price the pill flips to LIQUIDATED and the caption changes from

> Liquidation at **$23,256** — bitcoin would have to fall **77%** from here.

to

> Below **$23,256** this position is **liquidated**. The app would have flagged this months earlier.

That last sentence is the product's pitch compressed to nine words. The lender's dashboard shows a number; this app plans a defense, and the flags come early enough to matter.

The widget is store-free and self-contained — no account, no state, nothing saved; the page renders for a visitor who has never onboarded. But its thresholds are not a marketing approximation. The component imports four things from the app's own simulation core: `barLevel` (the Safe/Watch/Act classifier from chapter 9), `CB_WARN_LTV` (0.65, the Coinbase warning-band start), `CB_LLTV` (0.86, the Morpho liquidation line), and `LEVEL_COLOR` (the one green/amber/red map every surface uses). The bands the stranger feels — green below 65%, amber from 65% to 75%, red at 75% and above, the fill gauged against 86% with the trigger tick drawn at its true position — are the app's bands, resolved by the app's classifier, painted in the app's colors. These are the only app imports the landing page has, and they exist precisely so that **the demo cannot drift from the app**. If a threshold ever changes in the simulation core, the landing widget changes with it, in the same commit, or the build fails to say otherwise.

So the crash test is the honest kind of demo: the same cliff, the same colors, the same arithmetic a real position would face — just with someone else's hypothetical numbers. A visitor who drags the slider to $20,000 has already had the product's central experience: watching a position die in a widget, months before it would have died in the world. Everything past the sign-up is that same experience with your real numbers and a defense attached.

## One engine, three mirrors

Step back and Part 3 resolves into a single shape. One safety engine. Three mirrors held up to it: the dashboard shows the present, the console shows the emergency, and the scenario tools — private and public — show the hypothetical. None of the three recomputes anything; all of them display the same functions over different inputs. That is why the numbers cannot disagree, why the rehearsal is trustworthy, and why the demo on the landing page is not a separate claim about the product but a window into it.

What you do with the rehearsal is yours. The footer means it: planning software, not financial advice — bitcoin-collateralized borrowing carries liquidation risk; model it before you live it.

---

## From the code

- **Files:** `src/simulation/scenarioDiff.ts` (`PinnedScenario`, `ScenarioOverlay`, `applyOverlay`, `diffScenarios`, `DimensionDiff`), `src/simulation/safetyView.ts` (`deriveSafetyView`, `deriveViewerOverall`, `selectSafetyViewInputs`, `LEVEL_COLOR`), `src/components/Almanac/ScenarioFace.tsx` (the eighth Almanac face; pin row · drift line · overlay editor · what-if grid), `src/pages/LandingPage.tsx` (the `CrashTest` widget), `src/simulation/cbMetrics.ts` (`barLevel`), `src/simulation/runCoinbaseLoan.ts` (`CB_WARN_LTV`, `CB_LLTV`)
- **Numbers:** overlay levers ×6 (price, Strike debt, Strike collateral, credit line, CB balance, CB collateral) · `worsenedCount` 0–3, CB counted only when `hasCbLoan` · crash-test defaults 1 BTC / $20,000 / $100,000, slider $15,000–$250,000 step $1,000 · widget bands green <65% (`CB_WARN_LTV`), amber 65–75%, red ≥75%, liquidation 86% (`CB_LLTV`) · pin device-local, never synced; overlay never persisted
- **Tests:** `src/simulation/__tests__/scenarioDiff.test.ts` (overlay substitution, present-but-undefined never clobbers, worsened logic, `worsenedCount` gating), `safetyView.test.ts` (the shared engine both paths run through)

*Related chapters: ch05 (the Almanac the Scenario face lives in, and the wall it respects), ch09 (the engine and its bands), ch10 (when the hypothetical becomes the day), ch17 (the landing-first funnel the crash test anchors).*

<!-- DRAFT v0.1 — Founder review -->
