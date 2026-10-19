# The test suite — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

## Test Suite

🔴 **`income − expenses` IS THE BASELINE, NOT THE STRATEGY.** The Cycling Cash-flow card read
"Surplus $X/mo buys bitcoin" with X = `income − expenses`. While the flywheel is DRAWING that is wrong by
the entire expense figure — the credit line pays the bill, so the WHOLE income buys (less Strike's minimum when income
pays it — the plan of record's Run 2, `strikeMinPaidUsd`). On a budget whose
surplus is a quarter of income, the copy understates the flywheel by **4x**. `income −
expenses` is the never-draw baseline the strategy is *measured against*. ⚠ The old copy was right in ONE
state — once the cap stops the draw, income pays the bill itself and only the surplus buys (again less Strike's
minimum when income pays it) — which is why
the fix is STATE-DEPENDENT (`cashFlowAtMonth`, keyed to the SCRUBBED month) rather than a swap: scrub past
the cap and the sentence changes.

⚠ **The engine now emits `CyclingRow.btcBoughtUsd`** and the view must read it, never re-derive it. A
cbColl delta is no longer the purchase — the sweep cascade and the emergency top-up move collateral into
that same pool. ⚠ Both faces also state the LEVERED half: the funded bill becomes Strike debt at the
Strike APR until the sweep moves it, so "the whole income buys bitcoin" is not free money. Ownership's
surplus-vs-interest line is a SOLVENCY read and stays; it gained the buys figure rather than losing it.


🔴 **`fmtLtvPct` IS THE ONLY LTV FORMATTER.** `computeStrikeLtv`, `cbMetrics.ltv` and
`computeLiquidationAnalysis.newLtv` deliberately return `POSITIVE_INFINITY` for debt with no collateral —
returning 0 there rendered the worst possible state as perfectly safe. But `(x * 100).toFixed(n)` on a
non-finite number silently produces the string **"Infinity%"**, and that shipped across the Safety
Dashboard, Simple Mode, the Coinbase Loan tab, the Liquidation Modeler, the Advisor, the Emergency
Console, Daily Mode, the Ledger face and the Monthly Playbook — only the two Almanac faces were guarded,
because the formatter was defined locally in `cyclingFaceView` instead of app-wide. It now lives in
`utils/format` and `cyclingFaceView` re-exports it. ⚠ **EDITABLE FIELDS ARE DIFFERENT:** a form value
round-trips through `parseFloat`, so `MonthlyLogSection.ltvFieldValue` / `MonthlyLogOverlay.ltvFieldNumber`
degrade a non-finite LTV to `0` rather than rendering `∞`. `utils/__tests__/fmtLtvPct.test.ts` greps
`src/components/` and FAILS on any re-open-coded `(…ltv * 100).toFixed(…)`.

⚠ **The guard's identifier class is `[A-Za-z0-9_]*`** — the narrower `[a-zA-Z]*` couldn't cross an
underscore, so it never saw `LiqSimulator.tsx`'s snake_case `cb_ltv_now`/`cb_ltv_new`/`sk_ltv_new`/
`sk_ltv_at_T`: four sites silently printing `0.0%` for an unbacked loan while this guard reported clean.
The guard watches FORMATTING only — it cannot catch a fallback that's computed inline and never rendered
via `.toFixed`, which is why `LiqSimulator`'s four LTVs were extracted to the pure
`src/components/Tools/liqSimulatorView.ts` (reusing `cbMetrics`/`computeStrikeLtv`, never a local
`value > 0 ? … : 0`) and pinned by `liqSimulatorView.test.ts` — the repo has zero `.test.tsx`, so a figure
computed inline in a component is a figure nothing else can pin. (Both files left with the Liq Sim in the plan of
record's Run 4.)

⚠ **The ratio itself now lives in ONE place: `src/simulation/ltv.ts`.** `fmtLtvPct` is the single
*formatter*; `ltvOf` / `ltvOfUsd` are the single *computation*. The two guards are complementary and
both are needed — the formatter guard greps `src/components/` for `(…ltv * 100).toFixed(…)`, the
computation guard greps all of `src/` (excluding `__tests__`) for `<= 0 ? Number.POSITIVE_INFINITY`.
Reverting a computation while leaving `fmtLtvPct` in place does NOT trip the formatter guard; that gap
is exactly how LiqSimulator drifted. ⚠ `runCoinbaseLoan` was the one OUTLIER of the five, not a copy:
it omitted the `collateral <= 0` term, so a zero *price* reported ∞ where every other surface reports
0. Normalising it is inert only because `LiquidationModeler` returns early on
`liquidationPrice === 0 || btcPrice === 0` — if that early return is ever removed, this becomes
load-bearing. ⚠ **Named follow-up:** `emergencyModel`'s LTV now routes through `ltvOf`, but
`runAdvisor` (4 copies) and `AdvisorMain` (1) still open-code the flattering `x > 0 ? a / b : 0` shape (AdvisorMain's
went in the plan of record's Run 4 — its Coinbase card reads Safety's `cbLtv` — so the four left are `runAdvisor`'s,
which goes a release after the merge). The
computation grep only matches the `<= 0 ? Number.POSITIVE_INFINITY` shape, so it cannot see them — and it is
deliberately NOT widened until those are migrated.

⚠ **`deriveOwnership`'s `coldBtc` has TWO caller conventions.** It is ADDED to `btcHeld`, which is right
only when the caller's `btcHeld` EXCLUDES cold: the **viewer** passes strike+cb plus cold separately
(4-arg), while **both Almanac faces** pass `CyclingRow.btcHeld`, which already contains cold (3-arg).
Passing a row's `btcHeld` AND its `coldBtc` double-counts the pool, and `yoursShare` is clamped to [0,1]
so the result still looks plausible. `ownership.test.ts` pins both conventions and asserts the Almanac
call sites stay 3-arg. ⚠ Its cold guard is `Number.isFinite(c) && c > 0`, NOT `Math.max(0, c)` — the
latter returns NaN for NaN, which poisoned every field instead of clamping (matches `viewerVenue.clean`).
⚠ **It RETURNS `totalHeld` — the denominator every share was divided by — and a caller must render THAT,
never re-add cold itself.** `OwnershipBar` used to recompute it as `btcHeld + Math.max(0, coldBtc)`: a
second rule for one number, eight lines from the comment forbidding that exact expression, so the
displayed total could disagree with the shares beside it. `totalHeld` is correct under BOTH conventions —
with no 4th arg it is just `btcHeld`, so the Almanac's 3-arg call sites are unaffected.


🔴 **FIXTURES ARE SYNTHETIC. THIS REPO IS PUBLIC.** Every engine fixture uses round, invented numbers —
`cyclingSim.test.ts`'s `LIVE`, `ownership.test.ts`'s `SEED`, `emergencyModel.test.ts`'s `BASE`. They once
carried the owner's ACTUAL position (collateral, debts, credit line, monthly income and expenses), one of
them labelled "a real one", which published his finances to anyone who read the tests. The swap preserves
the SHAPE that makes each fixture useful — ~46% CB LTV and ~17% Strike LTV at month 0, a credit line that
binds before the collateral cap, skDrawn held to its documented `0.15 × skColl × price` relation — so the
pins still guard what they were written to guard. ⚠ If a future test needs a more realistic scenario,
change the RATIO, never the provenance. Absolute pins derived from a fixture carry a comment saying they
are fixture-bound, and where a value can be re-derived from a formula the test does that too (the seizure
pin re-derives `debt × CB_LIF / price` from the breaching row rather than trusting its own constant).
⚠ Scrubbing forward does NOT clean git history — earlier commits still contain the real figures.


All tests must pass — `npx vitest run` before every commit. (Every ⭐ below for the Advisor price path, the cold ledger, the
Coinbase debt events, the paydown badge, `provisional`, the Ledger cold total, the daily-month collateral correction,
the engine defense fixes, the support-anchored policy, the cold rules and the crash playbook was mutation-checked: revert the fix → the test
goes red.)
- **Support-anchored policy** (Run 1 — engine only; every ⭐ mutation-checked; see § Support-anchored policy):
  - `supportPolicy.test.ts` — the leaf: every zone boundary + the epsilon pair + junk → paused; headroom sign and
    junk → 0; sweep keep and junk → +∞; sale sizing and its clamp; ⭐ `resolveStrikeCall` cases a–f (cash first,
    ≥ at the call, the immediate sale leaves cash AND cold untouched, a partial cure spends cold before selling,
    f: an emptied Strike is `'none'` — no phantom sale); the breaker's consecutive rule and LATCH; the opt-in
    re-arm (null ≡ `nextBreakerState`, exactly the Nth month-end, a dip resets the count, the float guard, a second
    break); pay-down order.
  - `cyclingSimPolicy.test.ts` — ⭐ **G1** (policy absent, and every invalid variant, deep-equal the golden on its
    STORED path; the path itself matches P2 to a relative 1e-12; non-cycle modes ignore it; a guard walks
    `cyclingSim.ts`'s imports and fails on any implementation-approximated Math); the alignment pin + the opening row; ⭐ the ceiling invariant **plus the CONDUIT
    clause** (an accumulate row's Strike balance ≤ one month's interest on a full bill — ⚠ it is this clause, not
    the Strike ceiling, that catches price-for-support in the draw: once the migration keeps the full line at
    support, Strike's own ceiling cannot bind); ⭐ **G2** on every A5 path (non-vacuity from test 16's fixture +
    seeded cold) + an over-the-ceiling opening that DOES pull cold at support, so the field's accounting is pinned;
    ⭐ **G3** on every in-scope path (P6, P9 and the spec's synthetic 2.8× → 1.0× path included; P3 out of scope)
    + P9 as a real test (the ceiling fills, the defense engages, Coinbase survives) + the non-vacuity SUBSTITUTE
    (the OFF twin with its defense stack stripped liquidates; the policy never fires a defense); zones (hold =
    no new principal, payDown repays before buying, paused on P4/P5, the draw resumes ≤ 1.5); pay-down to zero with
    the buffer kept as collateral; restore order; ⭐ the modelled call (sale / cash cure / flag-only / cold cure);
    migration (full line at support, BOTH halves of the retrieval rule, the 60-day hold); the refinance ceiling;
    both breakers; ⭐ **G4** ledgers on every path + the call, cold-cure, liquidation and emptied-Strike fixtures,
    and every modelled call moved something; ⭐ no phantom sales (a sale that empties Strike is its last call; restore
    repays the debt left); the re-arm (absent ≡ undefined ≡ a never-firing N on every A5 path; P6 on exactly the Nth
    month-end; a dip resets; a second break; G2/G3/G4 at N = 6; the layering guard); `incomePath`; the clamps; the
    draw causes (v1.1 #1 / v1.2 #9); Strike called AFTER a Coinbase liquidation (v1.1 #3); P9's measured
    construction. G1 replays all three golden runs, and its import walker accepts either quote style.
  - `supportPolicyPaths.ts` (the shared SP_REPRO fixture and P1–P9 — never a test file),
    `goldens/supportPolicyG1.golden.json` (⚠ regenerate only deliberately, from the SHA in its meta — a diff means
    policy-absent behaviour moved), `supportPolicyReport.test.ts` (the env-gated A5 generator; its only asserts are
    FIDELITY — the OFF arm reproduces this suite's pinned 82 / 920 / 0, the re-arm table's months are the engine's
    events, and P7's all-in equity is the same with cash 0 and cash 6).
  - ⚠ The policy-OFF draw test's knife-edge mutants — `<` → `<=`, cap +0.1 pt, cap +1 pt — are NOT seen by the G1
    golden, P9-OFF included: the draw test runs after a month of interest and price growth, so its LTV never lands on
    or just over the cap. The whole suite sees all three: the ⭐ exact-at-cap pin in `cyclingSim.test.ts` (0% CB APR,
    a flat price, debt = cap × collateral × price, so the draw test reads exactly 0.5) kills each; +0.1 pt also fails
    the CB_LIF seizure pin, and +1 pt the A3/A5 grid pins. Mutation checks run in memory through vitest's Node API,
    and each must prove it applied (an exact-once match, controls green and red) before it can read as survived.
  - `cyclingSim.test.ts`'s TEST-ONLY grep now also covers `incomePath` and `modelStrikeLiquidation`.
- **Support policy faces — the pure layer** (Run 2a; every guarded line mutation-checked — revert it → red):
  - `cyclingSimPolicy.test.ts`:
    - `effectivePolicyStops`: a unit table; the engine's opening headrooms recover the helper's stops across a grid;
      above the defense line ≡ the clamped value; a source guard against an inline copy;
    - `baselineUnfundedUsd`: 0 on SP_REPRO, N × the gap, P7's income path, absent from the G1 golden;
    - `totalStrikeCureColdBtc`: Σ rows, and the ledger foots;
    - `allInEquity`: ⭐ P7 cash 0 ≡ cash 6, exact with no adjustments, cure cash subtracted.
  - `supportPolicyInputs.test.ts`:
    - the path, ⭐ bit-equal to the on-the-line price path from month 1;
    - `supportPolicyFor`: off / non-cycle → undefined, the cash, the liquidation fallback and the exact key set;
    - ⭐ the re-arm key is absent under a `vi.doMock` override of the constant;
    - ⭐ a face-shaped input IS Run 1's default policy plus the re-arm.
  - `supportPolicyView.test.ts`:
    - defaults, ranges, the clamp, the push and the flags; ⭐ the readout agrees with the engine's headrooms;
    - exhaustive labels and the call sentences;
    - ⭐ every adjacent headline pair, including a sale vs a re-armed break;
    - the details' order and edge cases;
    - Run 1's fixtures: the restore, P6 latched vs re-arm, the calls, P7, the cold alarm;
    - ⭐ `neverDraws` over every A5 path and grid cell, with each kind's defining property;
    - pause reasons; `drawPauseClause`; the strip, limit and cold gate; a layering guard.
  - `cyclingFaceView.test.ts` / `ownershipFaceView.test.ts`:
    - `creditExhaustedNote` never prints "$0/mo"; `strikeCapReading` sold / cured;
    - ⭐ the all-in verdict: a synthetic flip, and the engine's P3 $4k / $6k run, which loses on raw equity and wins
      all-in;
    - `cbLimit` and the three-argument `unfundedNote`.
    - The ONE moved pin: the verdict `toEqual` gains `allIn: false`, values unchanged.
  - Run 1's `CALL_*` / `callRun`, `runPolicy`, `RESTORE_OPENING`, `OVER_CEILING_COLD_OPENING` and the report's grid
    builders now live in `supportPolicyPaths.ts`, and the report's figures are byte-identical after the "all-in" rename.
- **Support policy faces — the card and the wiring** (Run 2b; every ⭐ proven red by reverting its fix, or by a
  temporary edit to a real face):
  - `supportPolicyView.test.ts`:
    - ⭐ `policyPauseReason` is null at bills $0 / −$500 / NaN in every zone, and on the engine at bills $0 (v1.2 #9);
    - ⭐ the breaker sentence states the re-arm rule when it doesn't fire in the run (a path that never recovers,
      re-arm 6); a true latch still says "stays that way" (v1.2 #12);
    - ⭐ `policyUnpaidNote` is the card's own unpaid line; the "(nothing was left for it this month)" parenthesis;
    - `billsRemainderTail` byte-equal to the pause reason's tail; `policyAlert`; `policyStopSentence`;
      `policyIgnoredNote` (exhaustive; ⭐ `'strikeLadder'` reachable at a 70% Strike liquidation LTV);
    - `ZONE_COLOR` / `ZONE_ORDER` / `zoneStripLabel`; ⭐ `settingReadouts`' clamp forms (v1.2 #13) and `payDownPushed`
      (v1.3 #17); ⭐ the effective stop in `policyTileSub` / `defenseLineNote` / `policyTip` (v1.3 #18);
      `policyColdNote`.
    - Moved pins: the latched-break headline now states the rule; P6's latched arm reads a reading with
      `rearmRule: null`; the pause-reason parenthesis.
  - `cyclingFaceView.test.ts`:
    - ⭐ `allIn` and `verdictBasisClause` on the $0.50 floor (a cure-only engine run → ", after reserve cash");
    - ⭐ `noBillsNote` (exact copy; the suffix at $0.50 vs $0.49; the engine at bills $0, policy on and off);
    - the opening and post-liquidation sentences;
    - ⭐ v1.3 #15, rows found by predicate: the shortfall-above-income invariant (P9 $4k, policy off); the policy-on
      cause on P9 ($4k) with `creditExhaustedMonth === null` asserted first; the zero-draw sentence on P2 with the
      policy off; partial / full / nothing-bought synthetic cases; a zero draw with unpaid bills; ⭐ a sub-dollar draw
      under the policy names the limits at support, never a full Strike line.
  - `ownershipFaceView.test.ts`: ⭐ `strikeCallVerdict` on both call fixtures (sold → red, cured → amber), with
    `strikeMarginMonth === null` asserted first; policy-off `called` byte-identical; `unfundedNote`'s required third
    argument (the 2-argument "same gap" case deleted, a dust case added).
  - `resetMirror.test.ts`: ⭐ `supportPolicy` in the `engineInputs` body and both dep arrays — proven red on all three
    faces with the key in `engineInputs` only.
  - `supportPolicyWiring.test.ts` (source-reading): see § Faces (Run 2) → Structural guards.
- **Support policy faces — copy follow-ups** (Run 2b.1; every ⭐ proven red by a temporary edit):
  - `cyclingFaceView.test.ts`:
    - ⭐ `rateStopNote`: both strings pinned (a dash drifting in "3–16%" goes red), no edge spaces;
    - ⭐ a $0 paycheck: the full draw ("No bitcoin bought this month.", identical policy on) and the partial draw
      ("covers none of the rest", off and on); ⭐ the engine: P1 at a $0 paycheck, off and on, both shapes present,
      and no drawing month's text matches `/\$0(?![\d,])/`;
    - ⭐ `creditExhaustedNote`: one sentence for every case; the engine's no-draw decision month keeps no "$0/mo"; ⭐ on
      P9 ($4k / $6k), policy off, it names `creditExhaustedMonth` with no "$" and no "thereafter" — the premises
      (a shortfall above the paycheck, a later full draw) asserted by predicate.
    - Moved pins: every `creditExhaustedNote` expectation (the "$X/mo … thereafter" and "income covers the rest"
      sentences are gone); the never-"$0/mo" check is kept on the engine's no-draw month.
  - `supportPolicyWiring.test.ts`: the two face-level pins (see § Faces (Run 2) → Structural guards).
- **Support policy faces — the last inline cash-flow sentences** (Run 2b.2; every ⭐ proven red by a temporary edit):
  - `cyclingFaceView.test.ts`:
    - ⭐ `stoppedCashFlowNote` and `noDrawCashFlowNote`, every shape whole (bills $6,000 against a $4,000 / $6,000 /
      $8,000 paycheck), and the $0.50 dust floor (sub-50¢ residue never reads as "$0 of bills went unpaid");
    - ⭐ the engine: P9 ($4k / $6k), policy off — its stopped month reads the unpaid shape, never "pays the bills
      again"; P2 at a $0 paycheck, policy off — no stopped month names $0 or says "pays the bills again"; P1 in `hold`
      at $4k / $6k — every month names $2,000 unpaid and no $0.
  - `supportPolicyWiring.test.ts`: the 2b.2 face-level pins (see § Faces (Run 2) → Structural guards); restoring
    either face from before 2b.2 turns them red.
  - No pin moved — no test pinned either sentence.
- **Support policy faces — the last zero buy figures** (Run 2b.3; every ⭐ proven red by a temporary edit):
  - `cyclingFaceView.test.ts`:
    - ⭐ `noBillsNote`'s two new shapes whole (debt repaid, nothing bought; nothing bought, nothing repaid) and
      `liquidatedCashFlowNote`'s paid-in-full shape;
    - ⭐ the $0.50 dust floor: a 30¢ repayment reads as nothing repaid, a 30¢ gap after a liquidation as paid in full;
    - ⭐ the engine: P2 with the policy on at $0 of bills — no month's `noBillsNote` (m > 0) matches
      `/\$0(?![\d,])/`, with the debt-repaid, nothing-bought row asserted present.
  - `supportPolicyWiring.test.ts`: ⭐ every face switches each printed buy figure on the dust floor — red on
    Ownership's unguarded leveraged branch.
  - Moved pin: the `noBillsNote` engine case's pay-down row. Its predicate (`policyZone === 'payDown' &&
    shownUsd(payDownUsd)`) landed on P2 month 21, which sent all the spare income to debt and bought nothing, so the
    pin enshrined "so $0/mo buys bitcoin." It now finds two rows by predicate: the first pay-down month that bought
    nothing (the new shape) and the first that both bought and repaid (today's shape, unchanged, asserted present).
- **Real cold in the projections** (real-cold spec v1; every ⭐ proven red by a temporary edit):
  - `cyclingSimPolicy.test.ts` — "real cold" block (a synthetic 0.5 ₿ seed; the stress is `stressFrom12`, price × f
    from m12):
    - ⭐ a seed nothing spends changes nothing but the seed (P1 on, P2 off, P2 on): premise = per-row retrievals equal;
      only `btcHeld` / `coldBtc` / `collateralValue` / `equity` move; `baselineBtc` +seed; the verdict's ₿ and all-in
      deltas equal. Red: the seed dropped from the baseline;
    - ⭐ G2 holds with the reserve on every A5 path (policy on) + two below-support spends (non-vacuity); ledgers foot.
      Red: the emergency top-up ungated (fires without a breach). ⚠ A price-relative reversion of the four ceiling
      sites (draw CB room, Strike ceiling, refinance cap, sweep keep) stays GREEN here (and in the unseeded G2) —
      defense in depth: the zones still keep cold below support. It turns four ceiling-at-support mechanism tests red
      instead: "every accumulate row sits under both ceilings at support", "P2 pay-down rows repay before they buy",
      "P2 at $16k / $6k: … 12 × bills of room at support", "every refinance month ends at or under the ceiling at
      support";
    - ⭐ the reserve saves what the swept pool couldn't: P1 × 0.4 from m12, policy off and the month-end reading, liq 12
      → none (by default Policy v2 seizes it on the way down at 12, with or without the reserve); the CALL fixture's
      sale → 0. Red: the engine ignores the seed.
  - `supportPolicyView.test.ts`: `shownBtc` / `DISPLAY_DUST_BTC`; ⭐ `coldShown` opens for a reserve alone;
    `policyReserveNote` every variant (⭐ P1 × 0.35 reads the FULL sentence — since Policy v2 the seizure on the way down
    kept the reserve out — and ⭐ F4's fixture at k2 0.5 reads the first clause only; see the cold-rules bullet below;
    the spent-and-saved FULL case is F4's fixture at k2 0.72). The three
    existing `coldShown` literals gained `openingColdBtc: 0` (type-only — no value moved).
  - `cyclingFaceView.test.ts`: `coldOriginsParts` every shape + ⭐ the footing on an engine run with all four parts;
    `coldMovesSentence`, `seedLine`, `sweepOffReserveNote`.
  - `resetMirror.test.ts`: ⭐ `openingColdBtc` in the `engineInputs` body, its deps and the lens-reset deps.
  - `coldWiring.test.ts` (new, source-reading): ⭐ the selector reads `getCurrentColdBtc()`; ⭐ `openingBtc` includes the
    reserve; ⭐ no `deriveOwnership` call under `src/components/Almanac/` takes 4 args; ⭐ the "Keep me safe down to"
    slider sits behind `coldBufferPct > 0` (Cycling, Strategy).
  - `supportPolicyReport.test.ts` (env-gated): a "Real cold" table (A5 paths + P1/P2 × {0.6, 0.5, 0.4} + the CALL
    fixture × policy off/on × seed 0/0.5) and the P1 × 0.35 doomed-top-up table.
- **Cold rules — the doom gate ADOPTED, Strike first after a liquidation ADOPTED, C retired** (every ⭐ proven red by a
  temporary edit; the tests run on the SHIPPED defaults, the crash playbook included):
  - `cyclingSimPolicy.test.ts` — "cold rules" block (sweep = every A5 path, the stress rows and the CALL fixture × seeds
    0 / 0.5, policy on):
    - ⭐ D is the default: absent ≡ `doomGateCbTopUp: true`; policy OFF ignores it (`true` / `false` ≡ absent);
      non-vacuous on P1 × 0.35 under the month-end reading (`MONTH_END`) — by default it moves nothing there (Policy v2,
      F3). Red: the default flipped back;
    - ⭐ D is inert without a liquidation: every run the old order survives ≡ the default; non-vacuous (survivors that DO
      use the emergency top-up). Red: the top-up gated on something weaker than doom;
    - ⭐ D never pours into a doomed Coinbase (P1 × 0.35 from m12, 0.5 ₿, under `MONTH_END`; by default month 12 is
      seized on the way down, `topUpBtc` 0): premise under `doomGateCbTopUp: false` =
      liquidated at month 12 with the seed in that month's top-up; the default moves no cold and no Strike collateral
      that month, and the seed stays in cold. Red: the gate removed;
    - ⭐ Strike first is on by default and policy-only: absent ≡ `true`; policy OFF ignores it; no liquidation ⇒ `false`
      ≡ absent; non-vacuous on P1 × 0.35 under `MONTH_END`. Plus a pay-down month BEFORE any liquidation (`RESTORE_OPENING` on a 2.5 ×
      support path) still restores Coinbase first — ⚠ asserted on the BALANCES (Coinbase repaid, Strike only accrues):
      both legs open over their ceilings, so a Strike-first restore would total the same `restoreUsd`. Red: the default
      flipped; the `liqMonth` condition dropped;
    - ⭐ Strike first after a liquidation (P1 × 0.35 from m12, 0.5 ₿, under `MONTH_END` — by default there is no
      deficiency): ⚠ the premise is `deficiencyUsd > 0`, never the
      liquidation row's `cbDebt` (pushed PRE-seizure); Strike inside its own ceiling at support (why Strike's half of the
      restore takes nothing); the runs identical before the first post-liquidation month; off → the surplus repays
      Coinbase and Strike only accrues; on → it repays Strike and Coinbase only accrues; ledgers foot. Red: the gate
      removed;
    - ⭐ G2 under both variants (base and D, pinned to the pre-playbook order, × the sweep; ledgers foot; non-vacuous
      below-support spends). (The C tests are gone with C — their invariants are ported to the crash-playbook block.)
  - `supportPolicyView.test.ts` — `policyReserveNote`: ⭐ P1 × 0.35 on the defaults → the FULL sentence (premise: Coinbase
    liquidated — on the way down since Policy v2 — and `totalTopUpFromColdBtc === 0`); ⭐ F4's fixture at k2 0.5 → the
    first clause only (premises: seized on the way down at 2, cold at 1, none at 2, none above support). Red: the gate
    reverted to the liquidation month only. The synthetic-rows case pins "up to and including" (a later month keeps the sentence).
    ⚠ No test-only input name may appear in this file — the grep test reads `src/components/`, tests included.
  - `supportPolicyPaths.ts`: `COLD_RULE_VARIANTS` is EXPLICIT — `base` = `doomGateCbTopUp: false`, `D` = true, both
    pinned to the pre-playbook order (`strikeReleaseRules: false, topUpBeforeShift: false`); plus `stressFrom12` and
    `coldRuleRows()`, shared by the tests and the report.
  - `cyclingSim.test.ts`: the test-only grep covers `doomGateCbTopUp`, `strikeFirstAfterLiquidation` and the crash
    playbook's three switches (red: any of them planted in a face).
  - `supportPolicyReport.test.ts` (env-gated): the cold-rules block (base / D on the pre-playbook order, §4 v1.1 applied
    mechanically) and a third block, `-t "repayment"` — Strike first off vs on (every zone) × D off / on per grid × seed,
    with a fidelity check that the deficiency does not depend on the order; the real-cold doomed-top-up table carries
    the doom-gate-off arm.
- **Decision face (Run A — the engine touchpoints and the pure layer)** (every ⭐ proven red by a mutation):
  - **The temporary snapshot (§6.1) — the proof the extraction is inert.** Taken BEFORE any engine edit, over
    **6,362 runs**: `a5Cases()` ON and OFF, plus every `faceWorldGrid()` / `reachGrid()` cell both arms. ⚠ BOTH
    arms (R2): `sweepToCold`'s classic call site is reached only by a policy-OFF run. Three checkpoints — deep-equal
    after the keep extraction; **stored-keys** after the four row fields, then snapshot #2 with every key; deep-equal
    against #2 after the opening inputs, with `openingBroken` false everywhere. ⚠ `CyclingResult.last` is a full row
    INSIDE the result, so a stored-keys comparison must project it onto the same keys or the added fields read as a
    diff. **Never committed.** Any diff stops the run.
  - `cyclingSimPolicy.test.ts` — I22 (both leaves called, neither expression inlined; `strikeKeepBtc` ≡ the leaf at
    that month, through the engine's own `effectivePolicyStops`); ⭐ the three footings on BOTH arms + per-arm
    non-vacuity; `strikeKeepBtc` null with the policy absent; I23 (absent ⇒ identical; ⭐ junk ⇒ as if absent; policy
    OFF inert; ⭐ a seeded broken breaker re-arms at the Nth month with `modelBrokenMonth` still null; ⭐ a seeded
    hold blocks the migration, with the unseeded run migrating inside the same window).
  - `placement.test.ts` — I1 (both keeps are the leaves), I2 (conservation; a fill and a drain never coexist),
    ⭐ **I3 the equivalence sweep** (20,001 random positions across all three zones, every routing branch reached —
    v1's rejected "excess → cold" rule fails it by 1.2 ₿), I4 (every gate, incl. ⭐ the all-or-nothing "under 50%
    after" refusal, and `cbToCold` independent of a blocked Strike leg), I5, ⭐ I6/I7 against the engine over
    `a5Cases()` × four owner fixtures, I8 (the suggested line's rounding, clamps and defense term), I16 (junk in ⇒
    no junk out, per input), I27 (the 0.01 ₿ threshold), ⭐ I30 (`cbOverCeilingUsd`, incl. SP_REPRO with
    `cbDebt: 50_000`). ⚠ Below support, over-the-ceiling and past-liquidation coincide by construction, so that
    case also pins the state CHECK ORDER.
  - `planSearch.test.ts` — I9 (the stitched floor; ragged → []), I11 (⭐ each ranking rule, ties → lowest index,
    ⭐ M4 on a genuinely MIXED call — the support path covers one price path but not the other — ⚠ AMENDED by W1,
    see below), I12. (⚠ The
    block labelled "I10 / I12" never tested I10's dated degeneracy — Run B built it and relabelled the block.)
  - `decisionMemory.test.ts` — ⭐ **I24**: chains of fresh two-month runs, each from the realized balances and
    seeded with the breaker folded over the realized month-ends, reproduce the continuous run to 1e-9 ₿ on P6, both
    false-recovery paths and a stressed P2. ⭐ NON-VACUITY: unseeded, the $50k false recovery re-borrows, is
    liquidated, and ends behind. Adds `falseRecoveryPath` to `supportPolicyPaths.ts`.
  - `decisionView.test.ts` — ⭐ **I13** the completeness sweep (12,245 runs / ~490k rows: `a5Cases()` (15) both arms ×
    five owner fixtures, both grids off and on, the synthetic grid, and the three `callRun` fixtures — the ONLY
    source of a cash cure, a cold cure and a Strike sale; every kind reached). The plan of record's Run 2 added the fifth
    fixture, `strikeMinFromIncome: true` — the ONLY source of a `payMinimum` action (12,215 runs before). ⚠ Collect mismatches, don't `expect`
    in the innermost loop (8M assertions is 110s of suite time; one assertion at the end is 3s), and reuse the
    schedule's own actions rather than re-deriving them. I14 (no `$0`, no `0.000 ₿`), ⭐ I31 (`moveCard`'s every
    line by example, plus a sweep of placement states × the breaker's four readings × with and without a loan),
    ⭐ I29's line, ⭐ S3's over-the-limit line REPLACING the aligned line.
  - `decisionChartView.test.ts` — I15 (⭐ the exact seam; the support line continuous across it), downsampling,
    I16 (a gap, never a 0), ⭐ I29's cliff path (≡ `cbMetrics().liqPrice`; under the path on a run that never
    liquidates; null with no loan, no collateral, and on/after the liquidation row — ⚠ a RUN can't test the no-loan
    case, since the policy buys and pledges its way into one).
  - `supportPolicyInputs.test.ts` — ⭐ `supportAtDates` bit-equal to `buildSupportPath`; ⭐ I25 (the fold equals a
    direct fold and the engine's own zone, on three paths × 72 months, from a 2027-01-31 start so `addMonths` lands
    every engine month on a calendar month-end; ⚠ `brokenMonth` is excluded — a seeded break has no "correct" month
    number, which is why the engine never reads one); junk CARRIES the state; no usable history ⇒ null; I26.
  - `supportPolicyView.test.ts` — ⭐ the opening-broken reading through **both** `policyHeadline` and
    `policyDetails` (R1), ⭐ R5's re-arm clause with `brokenMonth` null and "It broke again in month N.", the
    in-run head unchanged, and ⭐ a source test that `brokenMonth !== null` survives exactly once (inside
    `brokeInRun`) with both gates calling `hadBreak`.
- **Decision face (Run B — the face)** (every ⭐ proven red by a mutation or a temporary edit):
  - `placement.test.ts` — ⭐ **M7**: Strike 0.004 ₿ over its keep, $140,000 on 2 ₿ ⇒ exactly $20,000 over its limit
    at support (premise: not worth moving, `opening` 2 ₿ ≠ `after` 2.004 ₿). Red when `cbOverCeilingUsd` reads
    `after` (19,760) — the one mutation Run A's tests missed (the I30 case there sits under the limit, so both read 0).
  - `planSearch.test.ts` — ⭐ **I10**, built as the face builds its paths (anchor 80,000; anchor-independent, pinned
    at 30,000 and 250,000 too): 2026-09-29 identical to Support bit for bit at windows 48, 120 and on the line;
    2028-01-01 departs first at month 31 at window 48 (the 4-yr path is lowest there), and is identical again on the
    line at horizon 240. Red when `worstCasePath` returns `paths[0]` (the departure) or takes `Math.max` (the
    identities); `sameSeries` red when it always returns true.
  - `decisionView.test.ts` — the Run B copy, each red first: ⭐ the path-invariant line closes every applied card and
    never an unavailable or off one; ⭐ the line's Try / Back action; ⭐ the 'loading' breaker reading (the I31 sweep
    now feeds all five readings) and `breakerReading`; ⭐ D13's crash note verbatim, and ⭐ `scheduleToText` printing
    it (the old "work from the Emergency Console on the day" line is gone); the disclaimer (policy on / off);
    ⭐ `pathSublabel` / `pathNote` every shape, with D4's degeneracy sentence; ⭐ `scheduleHeader`; ⭐ `outcomeTiles`
    (dust reads "none" / "even", never "$0" or "0.000 ₿"); `stressNote`, `moveCardText`, the file name, the
    manual-price note; ⭐ the Today row and the loan line's "today" require `sim.policyApplied`.
  - `decisionChartView.test.ts` — ⭐ `chartDomain` (spans every plotted price; a gap never drags it to 0; nothing ⇒
    null) and ⭐ `xExtent`. Its three `yearTicks` cases moved to `chartZoom.test.ts` with chart zoom: `timeTicks`
    gives two of them unchanged, and the ≤ 6-year span yearly labels, by design.
  - `decisionWiring.test.ts` (new, source-reading, 35 checks — 36 with W1's, 37 with the legend note's — see
    § Decision face → the wiring guard). Every check proven red by one of 23 temporary edits, each restoring the file.
- **Decision face — W1: Worst (modeled) = closest to a forced sale** (each ⭐ red under a named mutation, every file
  restored):
  - `planSearch.test.ts` — I11 AMENDED, each rule ALONE deciding and `worstBy` naming it: ⭐ rule 1 (a doomed path
    beats a safe one that comes CLOSER to seizure first — red dropping "any liquidation is worse than none"); ⭐ an
    earlier liquidation (the later one comes closer first and ends poorer — red dropping or flipping the month
    compare); ⭐ rule 2 (P6 vs P1, policy on: P1 is richer and holds more ₿ "yours", yet comes closer — red dropping
    the cushion rule, whose fallback is also v1.8's pick); ⭐ **the W1 regression** (policy off, 2028-01-01, horizon
    60, window 48, 1.3× support, SP_REPRO at 12% / 10%: the 4-yr cycle rides the 70% defense line and is crowned —
    the old ranking crowns Resistance, dropping the cushion rule crowns Support); ⭐ ∞ with no Coinbase loan (red
    reading it as 0); ⭐ rule 3 (two ∞ paths, the poorer — red dropping the equity rule); ⭐ rule 4 (identical paths ⇒
    index 0, `'index'` — red when ties replace); ⭐ M4, both halves (⚠ the second half now RANKS both paths: the policy
    applies only to a price path exactly as long as the support path, so the 73-month P1 had been silently unranked
    under the 85-month support path and the doomed path won alone); ⭐ W1b (A ties B closest and is poorer, C poorer
    still ⇒ `'cushion'` — red naming the runner-up's rule); ⭐ W1a (a gap wider than ε decides, a narrower one ties;
    two cushions an ulp apart tie; the engine lands Support and the 4-yr cycle on the defense line and the dollars
    break it — red on an exact comparison, which crowns the 4-yr cycle); `minCushionOf` (the minimum, skipping the
    liquidation row; ∞ with no loan, dust or no collateral; ⭐ T1 skips month 0 by the row's own month — red counting
    month 0, skipping by array position, or starting at month 2); ⭐ **T1** (policy on, 2026-09-29, horizon 240,
    window 48, 1.2× support, 0.8 ₿ on Coinbase owing $45,000, SP_REPRO at 12% / 10%: today is every path's tightest
    month ⇒ Support, `'cushion'` — red counting month 0, which ties every path at today's cushion and lets the dollars
    crown the 4-yr cycle). ⚠ The noise pin asserts only the TOLERANT outcome —
    the cushions' last bits are Math.pow's, which differ on CI's Node 22.
  - `cbMetrics.test.ts` — `cbSeizurePrice` ≡ `cbMetrics().liqPrice`; ⭐ null under 50¢ (50¢ counts), ⭐ with no
    collateral, ⭐ on a `postLiquidation` row; junk → null. Red dropping each guard.
  - `decisionChartView.test.ts` — ⭐ the cushion reads the cliff from month 1 (min price ÷ cliff over
    months ≥ 1, on a safe and a liquidating run; the cliff still draws month 0 — red when the cliff skips today; since
    Policy v2 the liquidating run is seized on the way down, so its liquidation row is the survivor — no debt, no
    seizure price — and the "cushion counts the liquidation row" mutation is caught by cbMetrics.test and
    planSearch.test instead) and ⭐ ONE seizure-price rule (source: both files call
    `cbSeizurePrice(` and name no `CB_LLTV` / `cbMetrics(` / `.liqPrice` outside comments — red pasting a formula
    into either). The cliff tests drop the trigger argument (`liqPrice` never read it).
  - `decisionView.test.ts` — ⭐ the four crown sentences (red swapping two clauses); a plain path names no rule.
  - `decisionWiring.test.ts` — ⭐ `pathNote` gets `worstBy: crown.worstBy` (red on a literal).
  - `supportPolicyView.test.ts` — ⭐ ONE dust floor: `DUST_USD =` and `shownUsd =` defined once in `src/`, in
    `utils/format.ts`, and re-exported as the SAME binding (red re-adding a local definition).
  - Suite lists: `resetMirror.test.ts` — the face in `FACES`; ⭐ red under the old cold regex (G1), then the widened
    regex, ⭐ red again for a seed with no store fallback and for an inverted ternary, and ⭐ red when `breakerSeed` is
    dropped from the reset list. `coldWiring.test.ts` — the face in `FACES` (⭐ red for `st.coldStorageBtc` and for an
    `openingBtc` without the reserve). `stressAnchor.test.ts` — red on its own once the face existed, then listed.
  - `e2e/navigation.spec.ts` — ⭐ the Decision smoke (G9): with history stubbed (THE MOVE, the plan-of-record line,
    the chart, no crash) and with it failing (the "didn't load" breaker line). Red when the hub's branch is removed.
- **Chart zoom** (§ Chart zoom, spec through v1.11; every ⭐ red under its named mutation, every file restored and
  hash-checked):
  - `src/lib/__tests__/chartZoom.test.ts` — round synthetic figures:
    - ⭐ 1–2 scale and pixels (the log midpoint of [1,000, 100,000] is 10,000; the plot's top pixel is the HIGH end);
    - ⭐ 3–6 the box: Plotly's rule, including the 20px cap and the 8px click; direction never matters; a dates-only box
      leaves y auto; a box pins log-space prices;
    - ⭐ 7–10 step, pan, pinch and the clamp. ⚠ Test 10 pins the shift at BOTH ends (Z7): a clip at the low end
      stayed green until [−50, 50] days → [0, 100] joined the high-end case;
    - ⭐ 11 `timeTicks` ≡ the frozen old `yearTicks` at density 6 over a 500-plus-span sweep; ⭐ 12 the zoomed re-flow
      at UTC month starts; ⭐ 13 a fixed month table ("Sep", never ICU's "Sept");
    - ⭐ 14–15 `logTicks` pins, and a differential over 510 domains against recharts' own vendored d3
      (`victory-vendor/d3-scale`, imported by the TEST only) — the proof that the unzoomed axis is unchanged;
    - ⭐ 16 the base formatter while its labels are distinct; ⭐ 17 the double tap; 18 the note's wording;
      ⭐ 19–20 Z3a / Z3b;
    - ⭐ 21 `lockAxis` (Z6) — red dropping the absolute values (a leftward scrub reads as vertical), the 8px gate (a
      tap's twitch locks), or with ties held sideways;
    - ⭐ 22 `nextMode` (Z15) — red under the old radio rule (a computer keeps the pressed Pan), or resting on Zoom on
      a phone too (a touch device could never get back to scrolling);
    - ⭐ 23–28 the reach, on a HOME of 1,000 days × $1,000–$100,000 and the Decision shape's REACH ($0.01–$10M, the
      dates' reach = home):
      - ⭐ 23 − from home: 4 decades, 8 shifted down inside the reach, then the whole reach and no further; the dates
        stay auto (red ignoring the reach, with a span at the reach → auto, or without the early return);
      - ⭐ 24 a pan at home moves the price; 10 heights stop at the reach's top with the span kept; sideways stays home
        (red ignoring the reach, or clipping instead of shifting);
      - ⭐ 25 a pan up and back down is auto again, and its view IS home (Reset's); half a span off home stays pinned
        (red dropping the home check, or either of its end conjuncts);
      - ⭐ 26 a reach equal to home ≡ a FROZEN copy of the pre-reach `normAxis`, bit for bit (`Object.is`) — 4 homes
        (incl. epoch-ms and Z3a's 60 days) × 13 unit pins + 5 junk + auto + 3,000 seeded random pins, plus `[750,
        1e12 − 750]` on `[0, 1e12]`; both outcomes counted > 100. Green before and after BY DESIGN — it guards the
        refactor (red dropping the home check's span conjunct, or the early return);
      - ⭐ 27 the reach always contains home, end by end (red with no union — a "zoom out" that zooms in — or dropping
        `r0 === h0` / `r1 === h1`);
      - ⭐ 28 `leavesHome` (an inside box and home false; a price zoom-out and a pan up true) and the note's two wordings
        (red with `||` → `&&`, or a note that never says reset).
  - `src/components/ui/__tests__/chartZoomWiring.test.ts` — source-reading:
    - per adopter (`ADOPTERS`: DecisionFace, PowerLawChart): `useChartZoom(` once; both axes `domain={zoom.view.x|y}`
      with `allowDataOverflow` and `ticks={`; `timeTicks(` / `logTicks(`; the probe;
    - ⭐ the Tooltip: `active={zoom.quiet ? false : undefined}`, `isAnimationActive={false}` and `wrapperStyle={{
      transitionProperty: 'none' }}` (red back on `zoom.dragging`, or dropping either of the others — Z23);
    - ⭐ Z17: every `/<(Area|Line)\b/` tag has `activeDot={!zoom.quiet}` (red dropping it from one series). ⚠ Z24: `\b`,
      not a trailing space — Power Law's band `<Line` is followed by a newline, inside its `.map`;
    - ⭐ Z18: ONE `<ChartZoomToolbar`, inside the `chartHead` element, and `<ChartHead zoom={zoom} />` before
      `<ChartZoomFrame zoom={zoom}>` (red with the toolbar back inside the box);
    - VIEW ONLY: `zoom` reaches no data memo (Decision's `engineInputs` / `chart` / `domain` / `xRange`, PowerLaw's
      `chartData`), and the eight `buildChartSeries` arguments stand;
    - `chartZoom.ts` imports nothing; exactly ONE `passive: false`, on the touchmove;
    - ⭐ every touch listener states its `passive:` option and touchstart's is `true` (red dropping touchstart's
      options object — an element's listener is non-passive by default in WebKit);
    - ⭐ the Z6 lock goes through `lockAxis(` (red open-coding it in the hook);
    - ⭐ `pressMode` goes through `nextMode(` (Z15 — red with the old rule inline);
    - Z1's three `pointer-events: none` rules; ⭐ Z9's toolbar order (red swapping + and − back);
    - ⭐ Z17, quiet outlives the gesture: `endDrag` / `endPinch` never call `setQuiet(`; two `setQuiet(true)` (the
      arm, the pinch's start) and two `setQuiet(false)` (the wakes); the touchmove wake reads `wake !== null && !drag &&
      e.touches.length === 1`, the mousemove wake `!drag && !pinch`, and its listener is passive (red with `endPinch`
      clearing quiet, or `!drag` dropped from the touchmove wake);
    - ⭐ Z18, one layout: no `@media` block mentions `.toolbar`, and `.toolbar` has no `position: absolute` and no
      `opacity` (red with the fine-pointer overlay restored);
    - ⭐ the reach: every `normalizePins(` call in the hook (≥ 5) ends its arguments with `reach`; Decision calls
      `useChartZoom(fullView, TIME_LOG, reachView)`, PowerLaw `useChartZoom(fullView, TIME_LOG)` (red with the pan
      frame dropping `L2.reach`);
    - its helpers: `tag()` / `tagAt()` skip a `/>` inside `{…}`, `memoBody()` matches parens (a multi-line memo never
      runs into the next), `stripComments()` drops comments (a `//` after a `:` is a URL, kept), and `callArgs()`
      reads a call's arguments to its matching paren.
  - e2e: the Decision zoom smoke (⭐ BOX — red with the box back at 316; ⭐ ROW — red with the toolbar back inside the
    box), ⭐ the Z6 synthetic-touch test (red dropping the scrub's preventDefault, or holding a vertical stroke too; its
    pinch lifts in the same task as its last move, so ⭐ Z14 — red dropping the release's apply), ⭐ the Z17 pinch test
    (red at its own tag: the Tooltip back on `dragging` → TIP-AFTER; no `activeDot` on History → DOTS-DURING;
    `endPinch` clearing quiet → TIP-AFTER; a second finger not clearing `wake` → LEFTOVER; a wake at touchstart →
    FRESH-START; no mousemove wake → WAKE), ⭐ the price-reach test (red ignoring the reach → OUT; a note that never says
    reset → NOTE), ⭐ the Z18 computer test (red at ROW with the toolbar back in the box, or the overlay CSS back), and
    the Power Law drag test's zoom, ⭐ STEADY and title-row assertions — § Build & Deploy → E2E. The title row at 30px
    (Z22) now turns the 360px Power Law test red at ROW almanac loading (30), on a FRESH dev server: since the Power Law
    face, "Price and the bands" fits on one line beside the toolbar at 390, so the 390 test's STEADY no longer sees it.
- **Decision face — the chart zoom follow-up** (D2 and the legend note, spec v1.5; every ⭐ red under its named
  mutation, every file restored and hash-checked):
  - `decisionChartView.test.ts` — ⭐ `pathOnSupport` on the defaults, Support on the line (premise: month 0 is spot;
    red comparing from month 0); ⭐ bit for bit — a one-ulp nudge in one month is off the line (red with a relative
    1e-12 tolerance); false with a stress, a 48-month window, Fair, a short or ragged path, and months 0; ⭐ every
    month 1…horizon is compared — a one-ulp sweep (red stopping a month short or starting a month late); ⭐ both a
    month short → false over the horizon (red without the length guard).
  - `decisionView.test.ts` — ⭐ `SCHEDULE_KEEP_HEADER` / `SCHEDULE_KEEP_KEY` and ⭐ `ON_SUPPORT_NOTE`, pinned exactly.
  - `decisionWiring.test.ts` — ⭐ the note reads `pathOnSupport(displayedPath, supportPath, months)` (red with
    `pricePath`, which would keep the note under an engaged stress); I31's non-vacuity anchor is now 'Moves'.
  - e2e — ⭐ D2: the `schedule-keep` header cell is ONE line and doesn't overflow at 390px and 375px (red with "Keep ₿
    at support" restored: two lines at 390px); ⭐ the first Decision smoke sees the legend note on the defaults (red
    when it isn't rendered).
- **Sticky controls — the control dock** (Run 1, spec `pbloc-spec-sticky-controls-v1.md` v1.1; Run 1b, v1.3; Run 2,
  v1.6 — D6–D8 — and v1.7 — R4–R6 and Δ12's measured need; 62 named mutations — Run 1b's MT1–MT4 and Run 2's MP1–MP23
  among them — each an exact-once edit, red at its own tag, every file restored and md5-checked):
  - `src/components/Almanac/__tests__/controlDockView.test.ts` (10) — the dock's words:
    - ⭐ TODAY and ⭐ READOUT (the month: "today" at 0; the scrubber card's readout, word for word);
    - ⭐ OFF and ⭐ MINUS (the stress: "0%" and plain at 1×; a true minus, down bad, up good — red with a hyphen);
    - ⭐ LENGTH — every path's tab value fits 8 characters, no two alike, and BAND: Support / Fair are `PL_BAND_LABEL`'s
      (red with "Resistance", or a typed 'Floor');
    - ⭐ THOUSANDS — "$40k" · "$3.5k" · "$128k", and $99,950 → "$100k" (red with the prototype's unrounded format:
      "$100.0k");
    - ⭐ STATES (the policy tab reads `policyCardState`'s four states) and ⭐ FIVE-TABS (the order, each from its helper);
    - Run 2: ⭐ PARENT-TABS (Month · Stress · Path · Policy, each from its helper) and ⭐ STRATEGY-TABS (the same four,
      then Lens; LENS: Position / Flywheel, each ≤ 8 characters).
  - `src/components/Almanac/__tests__/controlDockWiring.test.ts` (17, source-reading):
    - PREMISE — EdgeBackGesture's `.page` still has `will-change: transform` (red when it doesn't: the guard is then
      vacuous);
    - ⭐ STICKY-CSS — `.dock` is sticky, nothing in its CSS is fixed or hex (TOKENS), its z-index sits under an open
      InfoTip's (STACK), and no stylesheet sets `scroll-padding` (NO-SCROLL-PADDING);
    - ⭐ ONE-DOCK — the face's last child (after the disclaimer, nothing after it but the print portal), and the dock
      reads no store (LAYOUT-ONLY);
    - ⭐ ONCE — "Inspect month" / "Price stress multiplier" exist once, in the dock's panels, and VIEWER: the Line is
      `disabled={s.viewerMode}` with `viewerMode: st.viewerMode,` in the selector (R1);
    - ⭐ NOTES — the scrubber's three notes read inside the chart card;
    - ⭐ DOUBLED — `.faceDocked.faceDocked` 0 under 1024 px and 12 px from it, the dock's media query and `WIDE` at 1024
      (R2), and FULL-MODE: `[data-active-tab="almanac"] .main` is no scroll container (`overflow-x: clip;
      overflow-y: visible; min-width: 0`, and no auto / scroll / hidden) with `padding-bottom: 0`;
    - ⭐ ONE-PICKER — `PathPicker` in the What-if card and, `compact`, in the dock;
    - ⭐ SIX-ONCE — each support-policy slider written once in the app, in SupportPolicyCard.tsx (since the plan of
      record's Run 4 the six labels are one constant, `PLAN_RULE_LABEL`: no component types a `label="…"`, and each
      `label={PLAN_RULE_LABEL.…}` is written once, in SupportPolicyCard.tsx);
    - ⭐ ONE-BRANCH — the card's disclosure and the dock's panel both render `SupportPolicySliders`, branching on
      `policyCardState`;
    - Run 2, each looping Cycling, Ownership and Strategy:
      - ⭐ P-ONE-DOCK — one dock, after the disclaimer, and nothing after it but the face's own closing tag;
      - ⭐ P-ONCE — RENAME (no `aria-label="Month"`; "Inspect month" once) · the month and stress inputs once, in the
        dock · RANGE (each face's stress range) · WORDS (`monthReadout`, the `post-liq` flag, `stressPct`; R6) · SCRUB
        (Ownership's `.dockScrub`);
      - ⭐ P-NOTES — the four notes once, in place, never in the dock (non-vacuous: the dock exists);
      - ⭐ P-DOUBLED — the root takes `faceDocked`, each module the doubled 0 / 12px pair, no hex;
      - ⭐ P-ONE-PICKER — one `PATH_META.map`, two `<PathPicker `, the picker's `aria-pressed`;
      - ⭐ P-TIMING — the dock's 4-yr timing range carries the card's attributes and the lock, and only while 4-yr is on;
      - ⭐ P-LENS (Strategy) — I20 (the switch once, in the dock; both views remain), F18 (the Stress writes `setLens`,
        the Lens `setLensView`), LENS-NO-RESET;
      - ⭐ P-POLICY — the dock's `SupportPolicyControls` carries the card's props and `layout="grid"`; the tab reads
        `policyCardState` with the face's mode.
  - e2e `e2e/controlDock.spec.ts` (13) — hermetic (prices aborted, history stubbed, `seedLoanAndGoto`):
    - phone (390×844): the edge — STICKY · OPAQUE (`rgb(14, 18, 25)`) · PINNED at scroll 0, ¼, ½, ¾ · END (under the
      disclaimer, on the same edge) · ONCE-DOM; the tabs — TABS (five, Month open) · EDGE (the slider starts right of
      `edge-back-zone`) · MONTH / READOUT (five ArrowRights) · FOLD · ARIA · PATH-TAB · REMOTE (the What-if card's Fair
      pressed); Policy — POLICY (under half the screen, scrolls) · NOTE (the stress note once, in the chart card) ·
      POLICY-TAB · REMOTE-POLICY;
    - computer (1440×900, `isMobile: false, hasTouch: false` — Z20): the edge at 888 (12 px up) · ONCE-DOM · LAYOUT
      1023 (the tabs) / LAYOUT 1024 (the chips); the bar — LIVE · UP (Policy's panel above the month slider, the chart
      box above the dock) · TAB-INTO · ESCAPE (after a blur) · ESCAPE-FOCUS · EDIT-ESC (a typed value's Escape cancels
      only the edit; a second folds the panel); the tabs at 900×900 (Run 1b, DC1) — TABS · TABS-ESCAPE (Escape from the
      Path panel's Fair button folds it) · TABS-FOCUS (the Path tab has focus) · TABS-EDIT-ESC (a typed value's Escape
      cancels only the edit; the panel stays) · TABS-PAGE (with focus on `<body>`, Escape leaves the open tab alone).
      Red on HEAD's dock at TABS-ESCAPE; MT1 no `onKeyDown` → TABS-ESCAPE · MT2 no focus return → TABS-FOCUS · MT3 no
      text-field skip → TABS-EDIT-ESC · MT4 `dropId` left on under 1024 px (the bar's document listener hears the page)
      → TABS-PAGE;
    - full mode (Δ1): one test, two contexts (the computer and the phone), `simpleMode: false`, Tools → Almanac →
      ◆ Decision → the edge checks with a surface tag;
    - Run 2 — the parents (`expectPinned` takes `end` — the dock's preceding sibling, `.shell` on Ownership — and
      `minScroll` 600):
      - phone: Cycling (ONCE-DOM · TABS · EDGE · NOTE · the edge · PATH-TAB · REMOTE · TIMING · TIMING-REMOTE ·
        PATH-4YR · POLICY-TAB · REMOTE-POLICY); Ownership (RENAME · READOUT · TABS · EDGE · NOTE · the edge, END under
        `.shell` · PATH-TAB · REMOTE · POLICY-TAB); Strategy (TABS · EDGE · LENS-ONCE · VIEW · STRESS · LENS ·
        STRESS-HOLDS · LENS-BACK · NOTE · the edge);
      - computer: the three bars in one test (ONCE-DOM · LIVE · NO-WRAP at 1440 and 1024 · UP · 4YR-UP · the edge at
        888); Strategy's Lens chip (LENS-CHIP · LENS-UP · LENS-VIEW · ESCAPE · ESCAPE-FOCUS);
      - full mode: Ownership, the computer and the phone.
    - Run 2's red-at: MP1 Cycling's dock first → P-ONE-DOCK, PINNED at 0 · MP2 Ownership's dock in `.side` →
      P-ONE-DOCK, PINNED at 0 (full mode, phone), NO-WRAP (Ownership at 1440) · MP3 the switch also on the page → P-LENS
      I20, LENS-ONCE · MP4 the Lens writes nothing → P-LENS F18, LENS · MP5 `lensView` in the reset list →
      LENS-NO-RESET, STRESS-HOLDS · MP6 the Lens live → LIVE · MP7 the stress note in the dock → P-NOTES, NOTE · MP8
      `aria-label="Month"` → RENAME (both) · MP9 a single `.faceDocked` → P-DOUBLED · MP10 Ownership's root without
      `faceDocked` → P-DOUBLED, END on the same edge (phone, full mode) · MP11 the dock's timing max → P-TIMING · MP12 a
      lock on the card's timing only → P-TIMING · MP13 a second `PATH_META.map` → P-ONE-PICKER · MP14 no `aria-pressed`
      → P-ONE-PICKER, REMOTE · MP15 the dock's Policy ignores onChange → P-POLICY, POLICY-TAB · MP16 the Stress writes
      the month → P-LENS F18, STRESS · MP17 Ownership's stress min 0.35 → RANGE · MP18 back on `styles.scrub` → SCRUB ·
      MP19 no Lens tab → STRATEGY-TABS, TABS · MP20 'Flywheel view' → LENS · MP21 Path before Stress → PARENT-TABS,
      TABS · MP22 the inline readout → WORDS, READOUT · MP23 the chip's 11px padding back → NO-WRAP (Strategy at 1440).
    - R15 (the lenses, Run 2 — spec `pbloc-spec-policy-v2-lenses-v1.md` v1.5): `expectPinned` first waits for the
      Support policy card's futures line to land — `aria-busy="false"`, not "Running the …" — tagged `LANDED <surface>`;
      then it measures. The line grows when its first run lands, and a landing between the END check's two reads moved
      the block under the dock. Measured with `--grep "the three bars" --repeat-each=6 --retries=0`: on an idle M1, 0 of
      6 failed without the wait and 0 of 6 with it; under six busy loops, 4 of 12 failed without it — every one at
      `END: under the block before it ownership computer` — and 0 of 12 with it (the reviewer's 2 cores: 2–3 of 6
      failed without it, 12 of 12 passed with it).
  - Measured, never moved: the phone chart-zoom tests' plot centre (y ≈ 702) clears the dock's top (y 710) by ~8–9 px,
    and their box and pan drags end under the dock but complete (pointer capture). A taller dock would turn them red —
    a kill criterion, never a moved target.
- **Milestones on a phone** (spec `pbloc-spec-milestones-phone-v1.md` v1.5, Run 2 — the switch table; 28 named mutations,
  MV1–MV28, each an exact-once edit, red at its own tag, every file restored and md5-checked; red first on `c8d7a5b`'s
  source — 4 of 8 and 7 of 7):
  - `src/components/Almanac/__tests__/milestones.test.ts` (8, each titled by its tag):
    - YEAR — `msYearLabel` over 12, 13, 18, 36, 60, 120;
    - QUERIES — the two query strings, and SIDE: Ownership's max is one under the `.shell` breakpoint read from its CSS;
    - VIEWS — per face, the views PARTITION the table's columns less Year (read from the face's own `<thead>` source) and
      keep its ORDER; one key a view, each named; LABEL-IN-NAME — a lettered view's spoken name contains its text;
    - ⭐ ONE-MARKUP — per face: one `useMediaQuery(MS_TABLE…)`, one `<MilestoneSwitchTable`, one table, the table first in
      the switch and the switch table in its else; its own views, and no other face's;
    - ⭐ STRATEGY-COLUMNS — Yours · Debt · Equity;
    - ⭐ LAYOUT-ONLY — MilestoneSwitchTable imports only `react` and its CSS; WORDLESS — no word in a quoted literal, a
      template literal's text or JSX text (roles, keys and spaces only; an arrow's `=>` is not a tag's end); TOKENS — no hex;
    - ⭐ FIT — `.th`, `.td`, `.turn` nowrap; `.td` and `.value` at `clamp(10px, 3.2vw, 12.5px)`;
    - ⭐ TABS — CLAMP (`.tabValue`); BLEED (the dock's margin reads `--dock-bleed`, whose value is `.main`'s padding).
  - e2e `e2e/milestones.spec.ts` (7) — hermetic (`seedLoanAndGoto`, prices aborted, history stubbed), every assertion
    tagged; `expectFit` and `readPhone` check the switch exists first, so a missing one fails fast at a tag:
    - phone: FIT, ONCE — the switch table, no table, > 1 row; FIT on every view at 390 and 320 px: every header and figure
      on one line (a flag may wrap under its year), no two cells' text closer than 3 px, the table inside its card, no
      sideways scroll in the card or the page;
    - phone: SWITCH — > 1 view; NAME-ONCE (no switch button has a `title`); the first pressed on open; each button pressed
      alone, showing Year + its own columns, none in two views; VIEW-STAYS on Strategy and Ownership (a picked row keeps
      the last view);
    - phone: JUMP — one button a row on Strategy and Ownership; tap the first, Enter the last, Space the first, each
      moving the dock's `month N · X yr`; LIT, only that row, also while focused; Cycling's table holds no button;
    - computer (Z20): SAME — on ONE page, the table (1440 px; Ownership's at 900, its Horizon typed to 36 months — D7),
      then every view at 390, row for row: year, flags, turn, DIM and every column's text; PARTITION; FIT. On the 4-yr
      path, then at month 0 with the stress at its floor; turn, flagged and dimmed rows each > 0, on all three faces;
    - computer: EDGES — 767 the switch table + FIT, 768 and 1440 the table; Ownership 919 the table, 920 and 1440 the
      switch table; NO-SCROLL; ALIGN (R5);
    - TABS, BLEED — fresh phone contexts at 320 and 360 px, simple and full mode, Strategy's Flywheel: no tab value cut;
      BLEED x 0, the window's width; FIT on every view;
    - FULL — full mode at 320 px (Cycling's frame, 218 px), the probe seed, all three faces, the 4-yr path then a deep
      stress (flagged rows > 0), FIT on every view.
  - Red at (measured 4 Oct 2026, the 4-yr path's 5 Oct trough still a row):
    - MV1 Cycling's query always matches → W ONE-MARKUP cycling: the query · E ONCE, SWITCH (views), JUMP (rows), SAME
      (the switch table at 390), EDGES cycling 767, FULL; MV2 Strategy's switch table rendered over its table too → W
      ONE-MARKUP strategy: one switch table · E ONCE, SWITCH (the first view on open), JUMP and SAME (strict-mode
      violations: two tables, two switches), EDGES strategy 767, TABS, FULL;
    - MV3 Strategy's $ view without Equity → U PARTITION strategy · E PARTITION strategy 4-yr; MV4 Yours in two of
      Ownership's views → U PARTITION ownership · E SWITCH ownership: Yours in one view, PARTITION ownership 4-yr; MV5
      Strategy's Equity cell reads the debt → E SAME strategy 4-yr row 0: Equity;
    - MV6 Ownership's rows don't jump → E JUMP ownership: one button a row; MV7 Enter ignored → E JUMP strategy Enter;
    - MV8 the figures at a fixed 12.5 px → W FIT .value: the clamp · E FIT FULL cycling 4-yr Bitcoin: the table inside its
      card; MV9 Ownership's side column the table → U QUERIES · E EDGES ownership 920; MV10 the table from 640 → U QUERIES
      · E EDGES cycling 767;
    - MV11 the component imports the store → W LAYOUT-ONLY; MV12 `switchLabel || 'figures'` → W WORDLESS;
    - MV13 Strategy remounts the switch table on a pick (`key={monthIdx}`) → E VIEW-STAYS strategy; MV14 no
      `aria-pressed` → E SWITCH cycling: the first view on open; MV22 the switch opens on its last view → the same;
    - MV15 the turn's line dropped → E SAME cycling 4-yr row 0: turn — **dated**: from 5 Oct 2026 `row 2: turn` (rows 12,
      24, then the 3 Sep 2029 peak at 35; measured with the app's clock at 7 Oct); MV16 Cycling drops `post-liq` → E SAME
      cycling stress row 0: flags, FULL cycling: flagged rows (non-vacuous); MV17 Strategy's rows never dim → E SAME
      strategy stress row 0: dim; MV18 the year always to one decimal → U YEAR · E SAME cycling 4-yr row 1: year —
      **dated**: from 5 Oct 2026 `row 0: year`; MV19 Ownership's LTV view out of order → U ORDER ownership ltv;
    - MV20 `.on.on` single again → E LIT strategy Enter; MV21 `.td` may wrap → W FIT .td · E FIT FULL cycling stress
      Bitcoin: every header and figure on one line;
    - MV23 Ownership passes two of its views → W ONE-MARKUP ownership: its own views · E PARTITION ownership 4-yr; MV26
      Ownership imports Strategy's views under its own name → W ONE-MARKUP ownership: no other face's views · E PARTITION
      ownership 4-yr; MV27 the LTV view's name back to "Loan to value" → U LABEL-IN-NAME cycling ltv; MV28 the switch
      buttons' `title` back → E NAME-ONCE cycling;
    - MV24 the tab values at 12px → W CLAMP · E TABS simple 320; MV25 no bleed → W BLEED · E TABS full 320.
  - Every e2e runs on a fresh server, through an out-of-tree config: the repo's own, with `testDir` and the `webServer`
    cwd pointed at the repo, port 5174 and `reuseExistingServer: false` — a long-running server can serve a stale composed
    CSS module, and the owner's 5173 is never reused. The measurement harness (production builds, the fit sweep, the
    markup check against `c8d7a5b`) lives outside the tree: inside it, `npm run lint` fails on its node globals.
- **Policy v2 — the lenses: the futures** (spec `pbloc-spec-policy-v2-lenses-v1.md` v1.8 — MF1–MF60: Run 1's MF1–MF33,
  Run 2's MF34–MF56 and R16's MF57–MF60, MF7 in Run 2's form, MF32 / MF33 retired with W-1 / W-2 and MF49 with R16 —
  plus KILL300 and the O3-ORDER control; each an exact-once edit on a sandbox copy, run on the unit files and then the
  e2e with `--retries=0` on a fresh 5174 server, restored and md5-checked, red at its own tag. R16's run took the e2e
  for MF7, MF8, MF11, MF14, MF20, MF22, MF36, MF39, MF41 and KILL300):
  - `src/simulation/__tests__/futures.test.ts` (12, + the report):
    - SEEDED (DISTINCT) · PREFIX (count, months; ⭐ R13 `PREFIX: the faces' count` — `FUTURES_COUNT` is 1,000 or §9's
      300, nothing else) · ANCHOR · JUNK;
    - REGIMES and CALIBRATION (dip p50 / p10, worst) — they draw a fixed `FAMILY` of 1,000, never `FUTURES_COUNT` (D-3),
      so §9's cut moves no calibration target;
    - WALL pricePaths · QUANTILE · OUTCOME (⭐ Run 2 `seizedMonth`) · SEIZED (the premise: policy off, `liqMonth` null,
      the way-down test at month 2; ⭐ Run 2 the month — `off: the month`, `on: the month`, ⭐ `month 0` (a loan opening
      past 86% is seized at month 0, the month-end reading's), ⭐ `the earlier` (no cold reserve: the way-down test at 2,
      the month-end reading at 4)) · SUMMARY (COUNTS on / off / hold; ⭐ Run 2 `when` — seized at months 16, 2, 13 and
      12, out of order, and one never: 2 within the year, half by month 12; `when — odd`; `when — none`) · WALL
      monteCarlo;
    - `FUTURES_REPORT` — `describe.runIf`, skipped in the gate; F3's table and Run 2's two timing columns (within a year,
      half of the seizures by month):
      `FUTURES_REPORT=1 npx vitest run src/simulation/__tests__/futures.test.ts --reporter=verbose`.
  - `src/components/Almanac/__tests__/futuresFace.test.ts` (15) — a module-level, calling-through `vi.mock` spy on
    `priceFutures`:
    - RUN · SAME FUTURES (⭐ D-2 `REUSE` — a setting draws no futures, a new horizon draws once) · ANCHOR GRID;
    - SHARE · RANGE (HORIZON, ⭐ Run 2 `HORIZON words`, ⭐ `WHEN month` (December rolls the year), TITLE, ⭐ R12 `TIP: no
      count` — the ⓘ contains neither "1,000" nor the count — ⭐ R14 `TIP: not the four paths`) · FOUR (⭐ Run 2 the subs:
      `the middle`, `the cold middle`, `when`, `all early`, `none early`, `a year`, `none seized`, O-1 `none`) · CHANCE
      ALONE (⭐ R16 `twin`: 191 seized, 190 of them in the first year — the value "19.1%" over "19.0% within a year") ·
      LINE (running, and whole lines: on, off, never, all, off never, ⭐ `all early`, ⭐ `a year`, ⭐ `13 months`, ⭐ R16
      `twin` — "19.1% of them — 19.0% within the first year", ⭐ O-3 `close early` in R16's words — "19.4% of them —
      18.5% …", ⭐ `none early`; ⭐ W-4 `NAME` — no word futuresView builds says "future");
    - LATEST ONLY (a fake worker; ⭐ D-2 `content key` and `300 ms`, read off `useFutures`' source) · FALLBACK (a failed
      reply; no worker);
    - EVERY FACE (ONE RUN, INPUTS, LINE per face) · STRATEGY (after the tiles, before the lenses; ⭐ D-1 `the tip label`)
      · WORKER (the reply; the tsconfigs; the spawn) · LAYOUT-ONLY (imports, WORDLESS, TOKENS, CLAMP) · WALL.
  - `e2e/futures.spec.ts` (5; hermetic; it reads shapes and behaviour, never a figure, and the count as `[\d,]+`):
    READOUT (+ WORKER; OFF, with Run 2's ⭐ `OFF rows: when` and `OFF: why`; ON) · LINE (all four faces; NOT-CYCLE;
    Run 2's sentences, the WHEN clause required whenever some seize — O-2) · SAME · FIT (the ×10 seed, full mode,
    320 px) · FALLBACK.
  - Red first on `45c9049`'s source: both unit files fail to load (`'../pricePaths'`; `futuresRun`, by its absolute
    path under the spy); the e2e 5 of 5, at `READOUT: the readout` · `LINE cycling: one line` · `SAME first: the readout`
    · `FIT: the readout` · `FALLBACK worker: the readout`.
  - Run 2, red first on `0228baf`'s source (its three test files): the unit files load, and 7 `it`s are red at their
    first tag — `OUTCOME seizedMonth` · `SEIZED off: the month` · `SUMMARY: when — the premise` · `TITLE` ·
    `FOUR: the middle` · `CHANCE ALONE` · `LINE`; soft-asserted, 31 tags are red, and RANGE stops at `HORIZON words`
    (`0228baf` has no `horizonWords`); the e2e 5 of 5, at `READOUT: the readout` · `LINE cycling` ·
    `SAME first: the readout` · `FIT: the readout` · `FALLBACK worker: the readout`.
  - R16, red first (the patched test file on Run 2's futuresView): 2 `it`s red — CHANCE ALONE at `CHANCE ALONE: twin`,
    LINE at `LINE twin`; soft-asserted, `LINE close early` too.
  - W-5 (spec v1.10 — the coin subs read "where 8 of 10 simulations end · half end above x ₿", a no-break space
    before ₿), red first (the new test file on the old words): FOUR at `FOUR: the middle`; soft-asserted, `FOUR: none`
    and `FOUR: the cold middle` too. A plain space back before ₿ → `FOUR: the middle` (on phones the ₿ wrapped alone
    in 22 of 56 measured subs without it, 0 with).
  - Red at (U = futures.test.ts, W = futuresFace.test.ts, E = the e2e):
    - MF1 one generator for every future → U SEEDED (DISTINCT) · REGIMES · CALIBRATION; MF2 drawn only to the horizon →
      U PREFIX months; MF3 month 0 from the curve → U ANCHOR · JUNK; MF4 no shocks, MF5 troughs higher → U CALIBRATION
      dip p50; MF6 pricePaths imports the engine → U WALL pricePaths;
    - MF7 (Run 2's form — the seizure month from `liqMonth` alone) → U SEIZED off · SUMMARY: when — the premise; MF8
      `countsSeizures` always true → U COUNTS off · E READOUT (OFF rows), LINE (NOT-CYCLE readout); MF9 no interpolation
      → U QUANTILE; MF10 monteCarlo imports a belief → U WALL monteCarlo;
    - MF11 the cache keyed by nothing → W SAME FUTURES (+ RUN, LATEST ONLY) · E LINE ownership (Cycling's 60-month
      futures on its 24-month face: the policy can't apply, so the line reads policy-off); MF12 no anchor grid → W ANCHOR
      GRID; MF13 every share rounded → W SHARE · FOUR · LINE · CHANCE ALONE (Run 2: the seizure sub carries a share);
      MF14 the four rows whatever the policy → W CHANCE ALONE · E READOUT (OFF rows), LINE (NOT-CYCLE readout);
    - MF15 a replaced request never settles → W LATEST ONLY (timeout); MF16 a failed reply settles null → W FALLBACK
      failed reply; MF17 no worker settles null → W FALLBACK no worker · E FALLBACK; MF18 the worker never spawns → E
      READOUT (WORKER);
    - MF19 the readout only in the Flywheel lens → E 5 of 5; MF20 Cycling passes no line → W LINE CyclingFace · E LINE
      cycling; MF21 Decision on the raw anchor → W INPUTS DecisionFace; MF22 the line for another strategy too → E LINE
      (NOT-CYCLE: no line); MF23 the card writes a word → W WORDLESS; MF24 `Math.random` → U SEEDED · PREFIX · W RUN,
      SAME FUTURES · E SAME, FALLBACK; MF25 the values a fixed 17 px → W CLAMP · E FIT;
    - MF26 the cache keyed by the inputs too → W SAME FUTURES: REUSE; MF27 the hook keyed by the job's identity → W
      LATEST ONLY: content key; MF28 no debounce → W LATEST ONLY: 300 ms; MF29 the ⓘ label written in the face → W
      STRATEGY: the tip label; MF30 "1,000" back in the ⓘ → W TIP: no count; MF31 a count of 100 → U PREFIX: the faces'
      count; MF32 and MF33 retired with W-1 and W-2 (Run 2), and MF49 with R16 (one decision now serves the line and
      the readout, so "all" can't differ between them).
    - Run 2 (MF37, MF40, MF42, MF52 and MF55 re-anchored in `seizedShares` since R16): MF34 the first year as `< 12` →
      U SUMMARY: when; MF35 the upper median → U SUMMARY: when; MF36 the month label a month late → W WHEN month ·
      FOUR: when · CHANCE ALONE · LINE; MF37 the year guard removed ("within the first year" at a year) → W FOUR: a
      year · LINE a year; MF38 "futures" in a shown word → W NAME; MF39 the line drops WHEN → W LINE · E OFF line,
      LINE cycling (O-2); MF40 "all" removed → W FOUR: all early · LINE all; MF41 the start not handed through → W RUN
      · SAME FUTURES · E OFF rows: when, LINE cycling;
    - Run 2's D-3 — each passed the prototype's whole set, unit and e2e: MF42 the year guard past 12 months → W LINE
      13 months · CHANCE ALONE: twin; MF43 `monthYear`'s year off at December → W WHEN month · CHANCE ALONE: twin ·
      LINE twin (the twins' Dec 2026); MF44 the months unsorted → U SUMMARY: when; MF45 the lower median as
      `floor(n / 2) − 1` → U SUMMARY: when — odd; MF46 the first year as `<= 13` → U SUMMARY: when; MF47 a truthy filter
      drops month 0 → U SEIZED: month 0; MF48 the later of the two tests → U SEIZED: the earlier; MF50 "of the futures"
      in the bare seizure sub → W FOUR: none seized · NAME; MF51 the cold sub from the coins you own → W FOUR: none
      (O-1's pin comes first in the `it`; soft-asserted, FOUR: the cold middle is red too); MF52 "none within the first
      year" dropped → W FOUR: none early · LINE none early; MF53 the way-down test alone → U SEIZED: month 0;
    - Run 2's options and R14: MF54 a "none" range names its middle (O-1) → W FOUR: none; MF55 O-3 and R16 off, the
      alike pair as it prints → W CHANCE ALONE: twin · LINE twin (it was LINE close early before R16); MF56 v1.4's tip
      phrase back (R14) → W TIP: not the four paths.
    - R16: MF57 the total left whole (Run 2's words) → W CHANCE ALONE: twin · LINE twin; MF58 the readout's value from
      `shareText` → W CHANCE ALONE: twin; MF59 the line's total from `shareText` → W LINE twin; MF60 the first year's
      decimal dropped → W CHANCE ALONE: twin · LINE twin; O3-ORDER, the control (the decimal rule decided before "all")
      → W FOUR: all early · LINE all.
  - Green where expected: MF7 and MF36 at the e2e (it reads shapes, not figures); MF18, MF19 and MF22 at the unit (the
    e2e sees them); MF31 at the e2e (it reads the count as `[\d,]+`). **KILL300** (`FUTURES_COUNT = 300` — §9's cut) is
    green on the unit files and the e2e: the cut is one constant, and every word that shows the count follows it.
- **Power Law chart polish** (spec `pbloc-spec-powerlaw-polish-v1`, P1–P11; every ⭐ red under its named mutation,
  every file restored and hash-checked):
  - `src/utils/__tests__/fmtTooltipUsd.test.ts` — ⭐ never "$0" for a positive price (red with `fmtUSD` for every
    value: "$0" at $0.04; red without the sub-cent branch); ⭐ a log-spaced sweep from 1e-15 to 1e7: nothing reads as
    zero, nothing prints in exponent notation (red with `String(v)` below a cent).
  - `src/components/PowerLaw/__tests__/powerLawView.test.ts`:
    - ⭐ `PL_SERIES` — the `PL_BAND_LABEL` names plus "History", D1's tokens, all distinct, only Resistance dashed (red
      on "Fair Value", on History taking Fair's colour, on a dashed Support);
    - ⭐ the tooltip head is UTC (red with local getters: "Dec 2026" for 1 Jan 2027);
    - ⭐ `vite.config` pins the forks pool;
    - ⭐ the rows: order, > 0 only, priced through `fmtTooltipUsd` (red dropping the filter, or with `fmtUSD`);
    - ⭐ `historyDrawn` / `legendEntries` (red at `>= 1`).
    - ⚠ **The suite's first TZ pin:** `vi.stubEnv('TZ', 'Pacific/Honolulu')` (UTC−10, no DST) BEFORE any Date is
      made, restored in `afterAll`. In a UTC container local time IS UTC, so without it the local-getters mutation
      would pass vacuously. The pin only takes effect in a child process, so `vite.config.ts` pins `pool: 'forks'`
      (vitest's default, made explicit). Under `--pool=threads` the premise — `new Date(Date.UTC(2027, 0, 1))
      .getFullYear() === 2026` — fails loudly rather than vacuously.
  - `src/components/PowerLaw/__tests__/powerLawWiring.test.ts` (source-reading, 12 checks since the Power Law face — its
    files are read LAZILY, '' while absent, and every face check opens with a positive anchor, so a missing file is red
    at its own assertion and can't pass a negative check):
    - no hex in any PowerLaw source file (the list names `PowerLawChart.tsx`, `PowerLawFace.tsx` and
      `PowerLawFace.module.css`);
    - the `useId` gradient;
    - the grid, plus the history `<Area>` with `isAnimationActive={false}` (P2);
    - Today as one timestamp per mount;
    - the CSS-sized box: comments stripped, ≥ 2 `--pl-*` values, every one a length, `height: var(--pl-plot)`, and no
      `--pl-toolbar` (P8 — red on a unitless `--pl-plot: 360`, and with `--pl-toolbar` back: Z18 moved the toolbar to
      the title row, so a term that was always 0px went);
    - ONE tooltip price formatter in both tooltips;
    - the swatches through `legendEntries(`, with the FACE rendering none (its code, comments stripped) and the chart
      only once loaded — on ONE error test, `error !== null` / `error === null` (red with the chart branch back on
      `!error`: an empty error string rendered the error box AND the chart);
    - one tick colour on both zoom charts (P6);
    - the face's copy comes from powerLawView (replaces the old sidebar check, D6): `todayTiles(`, `modelLines()`,
      `{PL_FACE_TITLE}`, `{PL_FRAMING}`, `{PL_DISCLAIMER.lead}` / `.body`, `style={{ color: t.color }}`, and the chart's
      `{PL_CHART_TITLE}`; no `$`+digit and no band name in the face's code (W6); D1's order in PowerLawFace's render
      (E1); `useState(() => new Date())` for today;
    - ONE layout — `PowerLawFace.module.css` is exactly the twelve compose-only rules (W4);
    - both surfaces bare — the Almanac branch `<PowerLawFace />`, AppShell's `? null` inside `<aside>` and
      `? <PowerLawFace />` inside `<main>`, both `[data-active-tab="powerlaw"]` rules, and the four old files gone
      (W1–W3);
    - no block-height fetch — no `useMempoolData` / `mempool` / `useChainTip` / `fetch(` in the face (W5),
      `useMempoolData.ts` gone, the face's hooks exactly `useBtcPrice` + `usePowerLawData`, `useBtcPrice(` only in
      TodayTiles, and `export const PowerLawChart = memo(function PowerLawChart(` (R2 — red with the memo dropped).
  - `src/styles/__tests__/composedOverrides.test.ts` — ⭐ ONE source-reading `it`, and it IS the audit (P9–P11).
    - **What it checks.** For every composing rule in every `*.module.css` under `src/`, no single-class rule of the
      composing class declares a property the composed class sets. Media queries are included, and the composed
      class's own `composes:` is followed.
    - **Shorthand-aware.** Two declarations clash when the longhands they set intersect, so `border` covers
      `border-color`.
    - **Non-vacuous.** A control pair must clash (`border` against `border-color`, with `border-radius` against
      `border` as the negative), and the five doubled overrides must be found (PowerLawMain's went with its file, spec
      pbloc-spec-powerlaw-face-v1):
      - MiningMain and ConverterMain `.main.main`;
      - DecisionFace `.chartBox.chartBox` and `.moveCard.moveCard`;
      - PowerLawChart `.chartBox.chartBox`.

      It also finds a sixth, PowerLawChart `.chartEmpty.chartEmpty`, which is correct.
    - **Red when:**
      - `max-width` goes back beside `composes:` (MiningMain's `.main.main` → `.main` — C1);
      - `height` goes back beside `composes:` (DecisionFace);
      - MiningMain's `.main.main` is deleted;
      - ConverterMain's is un-doubled;
      - `.moveCard`'s `border-color` goes back beside `composes:`.
- **Sats face — the rates under the converter** (spec `pbloc-spec-sats-rates-v1`; every ⭐ red under its named mutation,
  at its own test or tagged assertion, every file restored and hash-checked):
  - `src/components/Converter/__tests__/converterView.test.ts`:
    - ⭐ `rateRows(82_000)`: the nine rows exact, with no unit words, covering fmtUsdLocal's three bands (V3: the unit
      words back → red);
    - ⭐ S4: at 0, −1, NaN and ∞ every dollar cell is "—" (V1: the guard dropped; V2: `>= 0`; V2b: `Number.isFinite`
      dropped → "$∞"). The sats and bitcoin cells are compared with the priced rows, never with literals, so V3 turns
      only the first test red.
  - `src/components/Converter/__tests__/converterWiring.test.ts` (source-reading, 3 checks):
    - ⭐ ConverterSidebar renders no table, no store setter and no table styles, and keeps its four headers (W1: the
      old block pasted back);
    - ⭐ S2: `fillFromRate` calls the fields' own updates; the store setters appear once each, inside those updates;
      the row — sliced, since ConverterField has an Enter handler of its own — has the click and Enter / Space (W2: the
      row on the store setters; W3: `onKeyDown` dropped);
    - ⭐ the `<section>` prints `rateRows`' text — no price, `SATS_PER_BTC`, `fmtUsdLocal(`, `toFixed(` or
      `toLocaleString(` inside it — after the converter card, and neither component defines the unit or the formatter
      (W4: a dollar cell back on inline maths).
  - e2e (`navigation.spec.ts`, "Sats face") — every assertion is tagged, and each mutation, run with `--retries=0`, is
    red at its own tag:

    | Tag | Mutation |
    |---|---|
    | S1 | E2: `<ConverterMain />` wrapped in a `.facePanel` div |
    | S2 | E1: the row back on the store setters (the fields stay "0") |
    | KEY | E5: `tabIndex` dropped |
    | D2 | E4: the inset class removed (x = 0) |
    | D1@390 | E3: the unit words back |
    | D1@375 | E6: the ≤480px rule back to 13px / 12px |
    | SCROLL@350 | E7: the sidebar's three min-widths back (340 in 316) |
- **InfoTip fit** (spec `pbloc-spec-infotip-fit-v1`, v1.1; every ⭐ red under its named mutation, at its own test or
  tagged assertion, every file restored and md5-checked):
  - `src/components/ui/__tests__/infoTipModel.test.ts` (26):
    - ⭐ `tipShift` (14) — the rows, at 390 unless noted:
      - fits ⇒ 0;
      - off the left, and in the left gutter ⇒ right to 16;
      - off the right, and in the right gutter ⇒ left to width − 16;
      - exactly on both gutters ⇒ 0;
      - too wide ⇒ the left edge pinned (20..400 → −4);
      - six non-finite rows, each non-zero without the guard;
      - the spec's measured panels (129..481 at 390 → −107; 129..472 at 375 → −113).

      The mutations:
      - T1: the left branch dropped;
      - T2: the right branch dropped;
      - T3: gutter 0;
      - T4: gutter 17;
      - T5: the screen edge compared instead of the gutter — only the two in-gutter rows catch it;
      - T6: too wide pins the right;
      - T7: the guard dropped;
      - T8: the too-wide check dropped.
    - ⚠ `<` → `<=` on any of the three comparisons is an EQUIVALENT mutant. The shift is continuous at each gutter, so
      no row can catch it. It was run once and stayed green, as expected.
    - ⭐ `nextTipState` (12) — all 12 transitions. The mutations:
      - R1: a press toggles a hover-opened tip shut;
      - R2: leaving closes a pinned tip;
      - R3: hover demotes a pinned tip;
      - R4: a second press keeps it;
      - R5: dismiss spares a pinned tip;
      - R6: a first press only hovers.
  - `src/components/ui/__tests__/infoTipWiring.test.ts` (source-reading, 8 checks, comments stripped first):
    - the model imports nothing;
    - the `useLayoutEffect` places the panel through `tipShift(`, with `getBoundingClientRect()` and
      `documentElement.clientWidth`, and adds and removes a `resize` listener;
    - no React hover props;
    - native `pointerenter` / `pointerleave`, each `send('hover…')` gated on `pointerType === 'mouse'`;
    - `useReducer(nextTipState`, the click sends `'press'`, and nothing toggles;
    - the CSS: no 480px rule, `left: -8px`, the max-width tied to `2 × TIP_GUTTER_PX`, `transition-property: none`;
    - unchanged: unmount when closed, Escape, the outside pointerdown, the aria attributes.

    The mutations:
    - W1: `onMouseEnter` back;
    - W2: a gate dropped;
    - W3: the resize listener dropped;
    - W4: `window.innerWidth`;
    - W5: the 480 rule back;
    - W6: the transition guard dropped;
    - W7: the click back to a toggle.
  - e2e (`navigation.spec.ts`, "InfoTip") — every assertion is tagged, and each mutation, run with `--retries=0`, is
    red at its own tag. The red-first run puts HEAD's InfoTip under the new test. The rects in the table are what each
    run measured.

    | Tag | Mutation |
    |---|---|
    | TAP | HEAD (I3): one tap leaves it shut |
    | FIT@390 | E1: `tipShift` → 0 (129..481 at 390) |
    | FIT@375 | E2: the resize listener dropped (22..365 at 375); E3: `transition-property` dropped (123..466 at 375 — F3) |
    | COMPAT-MOUSE | E4: `onMouseEnter` / `onMouseLeave` back |
    | COMPAT-TOUCH | E5: the hover-in gate dropped |
    | CLICK-KEEPS | E6: a press on a hover-opened tip toggles it shut |
    | AWAY-KEEPS | E7: leaving closes a pinned tip |
    | ESCAPE | E8: Escape no longer closes |
- **The sheet-entry race** (spec `pbloc-spec-e2e-sheet-race-v1`, v1.2; tests and docs only. Every count is from
  `--retries=0` on this Mac, and every mutation was restored and md5-checked — see § Build & Deploy → E2E):
  - e2e (`eventSheet.spec.ts`, "the sheet openers") — one test per opener: `openConsentSheet`, `openEventSheet`,
    `openEventSheetEdit`. Its `beforeEach` aborts the Google Fonts requests (R6), then slows the slide to 1 s with an
    author `!important` on `[data-testid="draggable-sheet"]`. Each test reads the box top the instant the opener returns,
    then again 1.2 s later:
    - PREMISE: the sheet's inline transform is `translateY(0px)` (the CSSOM adds the unit, R5). The test id sits on the
      element the entry slides, so the helper and AT-REST measure the right box; on a wrapper both would pass vacuously;
    - ⭐ AT-REST: the two tops are equal.
  - **Red first** — the openers as they were at `5cb35a6`:
    - the natural race: consent ×20 → 5 failed, every one at `toHaveCount(0)` (the drag ran below the screen);
      eventSheet ×20 → 0 failed (180 passed · 40 skipped);
    - AT-REST ×5 → 15 of 15 red, PREMISE passing. At return vs settled: consent 779–783 vs 459.75, add 712–756 vs
      301.75, edit 786–806 vs 608.25.
  - **After the fix:** AT-REST ×5 → 15 passed; consent ×20 → 20 passed; eventSheet ×20 → 240 passed · 40 skipped.
  - **Mutations:**

    | # | Mutation | Result |
    |---|---|---|
    | M1 | `return;` as the helper's first statement | AT-REST ×5 → 15 of 15 red (at return 710–844); consent ×20 → 11 failed, every one at `toHaveCount(0)`; eventSheet ×20 → 60 failed, all at AT-REST (20 per opener), and its other tests 180 passed · 40 skipped |
    | M2 | the edit opener's call dropped | AT-REST ×3 → only `openEventSheetEdit` red (3 of 9) |
    | M3 | the add opener's call dropped | AT-REST ×3 → only `openEventSheet` red (3 of 9) |
    | M4 | the consent opener's call dropped | AT-REST ×3 → only `openConsentSheet` red (3 of 9) |

    The natural race is consent's alone on this Mac: under M1 the four box-reading eventSheet tests still passed 80 of
    80, so AT-REST is what turns a lost wait red everywhere.
- **The Power Law face** (spec `pbloc-spec-powerlaw-face-v1`, v1.1; every ⭐ red under its named mutation, at its own test
  or tag, every file restored and hash-checked; the e2e with `--retries=0` on a fresh server):
  - `powerLaw.test.ts` — ⭐ `plDateAtPrice` over 3 bands × 71 log-spaced levels ($1–$10M): a UTC midnight, `≥ usd` that
    day, `< usd` the day before; ⭐ the face's two projections (2028-02-29, 2032-11-24). U1 `ceil` → `floor`, U2 `days + 1`
    and U3 every band through fair's A turn both red.
  - `powerLawView.test.ts`:
    - ⭐ today's tiles with a price — keys, labels, `$50,000 · −50.0% · $200,000 · $100,000 · $40,000`, colours, "live"
      (V1 Resistance `--red`; V2 an ASCII hyphen);
    - ⭐ vs Fair — 150k `+50.0%` green "above"; 100k `0.0%` green "above"; 99,990 `0.0%` red "below" (the colour follows the
      true side); 99,900 `−0.1%` (V2; V3 `above = dev > 0`);
    - ⭐ no live price (null, 0, −1, NaN, ∞) — "—", "no live price yet", vs Fair dropped, never NaN (V4 the guard dropped);
    - ⭐ the band subs from the constants (V5 a typed "2.1× fair");
    - ⭐ modelLines — under the Honolulu TZ pin: the formula, "(3 Jan 2009)", the projections line exactly, and
      `fmtMonthYear` in UTC (premise: 1 Nov 2032 UTC is 31 Oct locally) (V7; V8; local getters → "Oct 2032");
    - ⭐ derived, never typed — a source read of modelLines' body: `plDateAtPrice(` twice, `fmtCoef(PL_A_FAIR)`, no
      Mon-YYYY literal, no `~20xx` or `20xx–20xx` (V6 a typed "Nov 2032" — the rendered text alone stays green; V7);
    - ⭐ fmtCoef — `1.16 × 10⁻¹⁷`, `4.2 × 10⁻¹⁸`, `2.4 × 10⁻¹⁷`, `1 × 10⁵`, and the carry `9.999e-18 → 1 × 10⁻¹⁷` (V8; the
      carry dropped → "10 × 10⁻¹⁸").
  - powerLawWiring (12 checks — above): W1–W3 at "both surfaces bare"; W4 at ONE layout and the composedOverrides audit;
    W5 at "no block-height fetch"; W6 at the copy check; the memo dropped (R2) and `useBtcPrice()` called in
    PowerLawFace (Δ1) at "no block-height fetch"; the tiles above the chart (E1) at the copy check's D1 order too.
  - composedOverrides: C1 (MiningMain's `.main.main` → `.main`) is red at the audit's clashes.
  - **Red first** (the tests on d521cd1's code): 15 red — powerLaw 2 and powerLawView 7 ("not a function", except the
    source read, at its body anchor), powerLawWiring 6 (checks 1, 7, 9–12; 2–6 and 8 green); composedOverrides green;
    the rewritten e2e at IN VIEW (1,190.5 > 844), the 360px test at SIDEBAR full.
  - e2e (§ Build & Deploy → E2E): E1 the tiles above the chart → IN VIEW (880.2 > 844); E2 a head line that appears
    with the price → PRICE (310.5 → 333.25); E3 a mempool fetch in the face → OFFLINE (two requests — Strict Mode);
    E4 the long title back → TITLE (390) and ROW almanac 47.25 (360); E5 the full-mode hide dropped → SIDEBAR full;
    R1's probe (a 300px spacer above the chart card and the body scrolled 300 at open) → TOP (300); the title row at
    30px (Z22) → ROW almanac loading (30), the 390 test green.
- **5a — the plan log's size** (spec `pbloc-spec-plan-log-size-v1` v1.1 — § Phase 4 → 5a; 4 new test files, no existing
  test changed; the suite 2,494 → 2,516, 152 → 155 files; e2e 66 → 67; 19 mutations, MB1–MB19, each an exact-once edit run
  on its test files with `--reporter=verbose` — the e2e too for MB1, MB10, MB11 — red at its tag, the file restored from a
  saved copy and sha-checked, the tree's digest unchanged):
  - `src/lib/planEvents/__tests__/planLogSize.test.ts` (13, pure) — ⭐ BURST (a 173-notch drag → its last notch; the edits
    before and after stay) · ⭐ BURST edge (exactly the window is a burst, +1 ms two edits) · ⭐ BURST per field · ⭐ BURST
    device-blind · ⭐ BURST pairs · ⭐ BURST ties · 90 DAYS · ⭐ BUDGET (the payload fits, oldest first, every latest kept, no
    tighter than needed) · ⭐ BUDGET latest-only · BUDGET untouched (+ premise) · ⭐ BUDGET wrapper (250 edits padded to
    32,760 B as a bare log — 32,771 B as the payload — lose exactly their oldest edit: the deterministic catch for MB19) ·
    ⭐ FOLD-SAFE (1,500 seeded logs against an independent oracle — the fold, every latest, idempotence, only the rules, the
    budget, oldest first; non-vacuous) · ⭐ CONVERGE (200 seeded three-device histories: no step moves a fold; they settle
    within 6 rounds on one log). Both sweeps carry an explicit 60 s timeout, as cyclingSim's sweeps do: a few seconds
    alone, they ran past vitest's 5 s default in a loaded full suite (FOLD-SAFE 18.5 s, CONVERGE 8–9 s, on the build's Mac).
  - `src/store/__tests__/planLogEmit.test.ts` (6, the REAL store, fake timers) — ⭐ EMIT drag (173 notches → ONE income event,
    the last value, in the fold and the scalar) · ⭐ EMIT pause (a 5-second rest is one burst) · ⭐ EMIT history (15 s apart →
    two; the ts advances) · ⭐ EMIT pairs · ⭐ EMIT other fields · ⭐ PUBLISH (a log from an older build — a 78,730 B payload —
    goes out inside the budget, the fold unchanged, the oldest history trimmed; the stub signer has no nip44, so the
    publish compacts, persists, then fails network-free).
  - `src/lib/nostr/__tests__/payloadSize.test.ts` (3) — ⭐ PADDING (nostr-tools' own NIP-44: 40,960 → 40,960, 40,961 →
    49,152; the budget pads to itself) · ⭐ TINT · ⭐ DEVPANEL (source-reading).
  - `e2e/planLogSize.spec.ts` (1) — DRAG: a 1-second drag of Living's Monthly Income slider leaves one income event in the
    persisted log, at the slider's value, under 2,000 B (INCOME slider · DRAG moved the slider · DRAG one event · DRAG the
    slider's value · DRAG log size).
  - Red-first (a plain export of bd9c31a outside the repo, never `-t`): A, the tests alone — 17 red, 2 green (90 DAYS, EMIT
    history), `payloadSize.test.ts` can't load; B, + the two constants on main's rules and `payloadSize.ts` — 16 red, 6
    green (90 DAYS, BUDGET untouched, CONVERGE, EMIT history, PADDING, TINT), BUDGET wrapper red at "fits" (32,771), PUBLISH
    at "inside the budget" (78,730); the e2e on main's code red at DRAG one event (61).
  - The mutations, red at: MB1 (the burst rule off) → every BURST, FOLD-SAFE only the rules, EMIT drag / pause / pairs /
    other fields, PUBLISH the drag, e2e DRAG one event (61) · MB2 (`>=`) → BURST edge W, FOLD-SAFE only the rules · MB3 (the
    walk forward) → 16: `planEvents.test`'s 3 compaction tests and all 13 here · MB4 (keyed by device too) → BURST
    device-blind, FOLD-SAFE only the rules · MB5 (no 90 days) → 2 `planEvents.test` compaction tests, 90 DAYS, FOLD-SAFE only
    the rules · MB6 (no budget) → BUDGET fits (70,512), BUDGET latest-only, BUDGET wrapper fits (32,771), FOLD-SAFE budget,
    PUBLISH inside the budget (60,608) · MB7 (newest first) → BUDGET trimmed some, BUDGET wrapper trims the oldest, FOLD-SAFE
    oldest first, PUBLISH oldest first · MB8 (a latest trimmable) → BUDGET latest-only · MB9 (no commas) → BUDGET fits
    (33,268), BUDGET wrapper fits (32,771), FOLD-SAFE idempotent, PUBLISH inside the budget (33,347) · MB10 (the emit appends
    raw) → EMIT drag, pause, pairs, other fields, e2e (61) · MB11 (compact before appending) → the same EMITs (2 events), e2e
    (2) · MB12 (the publish sends raw) → PUBLISH inside the budget (78,730) · MB13 → TINT near · MB14 (step 49,152) →
    PADDING at the step · MB15 → DEVPANEL tint · MB16 → DEVPANEL log size · MB17 (1 s) → EMIT pause, BURST device-blind ·
    MB18 (60 s) → EMIT history, BUDGET wrapper trims the oldest (its edits are a minute apart — one burst) · MB19 (no
    wrapper — the prototype's first version) → BUDGET wrapper fits (32,771), FOLD-SAFE budget (#160).
- **5b — the journal's size** (spec `pbloc-spec-journal-pages-v1` v1.1 — § Phase 4 → 5b; 5 new test files, 2 changed
  assertions; the suite 2,516 → 2,555, 155 → 160 files; e2e unchanged; 26 mutations, MS1–MS26, each an exact-once edit run
  against the five 5b files plus `sync.test` and `liveSync.test` with `--reporter=verbose`, red at its tag, the file
  restored and md5-checked, the tree's digest unchanged):
  - `src/lib/nostr/__tests__/journalPages.test.ts` (17, pure) — LAYOUT · ⭐ DETERMINISTIC · ⭐ DETERMINISTIC TIES · ⭐ SPLIT ·
    ⭐ SPLIT tight · COMMAS (300 items of 327 B: 99 a page, never the 100th) · OVERSIZE · ⭐ CANONICAL · BUILD · SIZES · V1 ·
    MANIFEST and PAGE · ⭐ UNION · ⭐ UNION ≡ FOLD · AGED (2,000 random sets of parts; a tombstone past the TTL keeps an older
    copy deleted, as one merge did before 5b) · ⭐ FETCH · PUBLISH · ⭐ LISTING · ⭐ TARGET.
  - `src/lib/nostr/__tests__/journalSync.test.ts` (17; one device, the real modules over mocked relays and store) — ⭐ LAZY ·
    ⭐ MIGRATE · ORDER · ⭐ FULL · PARTIAL · ⭐ MISSING-HELD · RETRY · REPUBLISH · ⭐ CARRY · ⭐ TORN · RESUME · ⭐ GUARD ·
    NO-RECONNECT · WARN · PRUNE · ⭐ STUB · FULL AGAIN · ⭐ PRE-PULL · PRE-PULL-DIRTY · PRE-PULL-TOO-LARGE ·
    ⭐ WRITE-DURING-PUBLISH · DIRTY-KEPT · ⭐ SKEW · FLOOR · ⭐ WRITE-DURING-PULL · MID-PULL · ⭐ DECRYPT · TOMBSTONES ·
    ⭐ LIVE · ECHO-SKIP · LIVE-PULL · ⭐ RECONNECT · SIZE-NOT-SIGNER.
  - `src/lib/nostr/__tests__/journalSweep.test.ts` (1) — ⭐ SWEEP, the kill criterion: per seed, 2–4 devices on one key,
    each on its own module instances, some on the pre-5b app; clocks up to 10 s off; two relays, one always a stock strfry
    (an event past 65,536 B, measured as NIP-44 would send it, is refused); 120 random steps (writes, bursts, re-dated
    edits, deletes, re-logs, syncs, live pulls, a write during a pull, injected relay failures, dropped pages,
    relaunches, updates). After every step, on every device: no id or month twice, nothing lost without a newer
    tombstone, nothing deleted back. At the end every device holds exactly the oracle's journal, and a new device
    signed in gets all of it from the relays. Non-vacuous: 17 counters must be above zero. 40 seeds in the suite;
    `SWEEP_FROM` / `SWEEP_SEEDS` (the first and the LAST seed) and `SWEEP_TOTALS` for longer runs — 1–250 and 251–500
    passed in 79 s each on the build's Mac, their totals equal to the spec's (the test's timeout is 600 s).
  - `src/lib/nostr/__tests__/relayLimits.test.ts` (3) — ⭐ NIP44-LEN (against nostr-tools' real NIP-44: 40,960 → 54,704,
    40,961 → 65,628) · ⭐ PROBE · NIP-11.
  - `src/components/Settings/__tests__/syncTooLargeNotice.test.tsx` (1; `renderToStaticMarkup`, no DOM) — ⭐ WARN.
  - Changed: `sync.test.ts` — "4e/5b: the pull asks for records, the journal manifest, plan-events and prefs only";
    `liveSync.test.ts` — "LIVE four".
  - Red-first (a plain export of a494e97 outside the repo; the new modules and tests on main's sync code): 20 red, 42
    green of 62 — all 17 of `journalSync`, the sweep (`pullJournalNow is not a function`), LIVE four and the pull's d-tag
    pin.
  - The sweep found two defects in the prototype's first versions: a write made while a pull waited for pages was lost
    (WRITE-DURING-PULL; MS1 puts it back) and a device whose clock ran behind never converged (SKEW, seed 420; MS24).
  - The mutations, red at: MS1 (merge the journal read before the fetch) → SWEEP at the step (seed 1 step 53, "month 10
    LOST on d3"), MID-PULL · MS2 (the manifest without its tombstones) → BUILD, SWEEP (seed 1 doesn't converge) · MS3
    (fetch only the months held) → FETCH, CARRY, WRITE-DURING-PULL, DECRYPT, SWEEP (seed 1) · MS4 (no full check) → FULL,
    RETRY, SWEEP (seed 2: a new device can't get the whole journal) · MS5 (no carry) → CARRY, SWEEP non-vacuity (carried)
    · MS6 (the manifest, every page from this device, goes out before the pages) → ORDER, TORN, STUB, PRE-PULL, SKEW,
    SWEEP non-vacuity (tornRuns) · MS7 (this device's listing) → CARRY, GUARD · MS8 (every page failure a size refusal) →
    TORN, RECONNECT, SWEEP non-vacuity (tornRuns) · MS9 (the guard off) → GUARD (41,098 B reached the signer), RECONNECT,
    WARN · MS10 (no prune) → PRUNE · MS11 (no stub) → TARGET, STUB, SWEEP non-vacuity (stubWrites) · MS12 (records:v1 alone
    always behind) → LAZY, ORDER, PRE-PULL, `sync.test` IGNORED and "identical" · MS13 (the pre-pull publish clears dirty)
    → PRE-PULL-DIRTY, SWEEP non-vacuity (v1Refused — a reshuffled history) · MS14 (dirty cleared after every publish) →
    DIRTY-KEPT · MS15 (no echo skip) → ECHO-SKIP · MS16 (a size refusal a failure in syncNow) → SIZE-NOT-SIGNER · MS17 (no
    retry) → RETRY · MS18 (plain JSON.stringify) → CANONICAL · MS19 (the pull ignores records:v1) → ORDER, six `sync.test`
    records cases · MS20 (no commas) → COMMAS (100 a page) · MS21 (an endless budget) → COMMAS (300 on one page),
    OVERSIZE (a crash), SWEEP (seed 1) · MS22 (a missing page kept as held) → REPUBLISH, CARRY, SWEEP (seed 2) · MS23
    (NIP-44's chunk at a quarter) → NIP44-LEN (32,769 B), PROBE · MS24 (no floor) → SKEW FLOOR · MS25 (the union's tie
    to the later part) → UNION ≡ FOLD (parts #7) · MS26 (the union applies its own tombstones) → UNION, AGED.
- **5d — a buy's dollars** (spec `pbloc-spec-buy-dollars-v1` v1.1 — § Phase 4 → 5d; 1 new unit file, 5 changed — four
  sheet fixtures gain `buyUsd: null`, three of them nothing else; the suite 2,610 → 2,638, 165 → 166 files; a new e2e
  spec, 3 tests; 33 mutations, MD1–MD33, each an exact-once edit run against its unit files and, where marked, the e2e
  spec (`--retries=0`), red at its tag, the file restored and md5-checked):
  - `src/store/__tests__/buyDollarsStore.test.ts` (21, the REAL store) — ⭐ SIGNOFF (dollars-only keeps · figures kept
    — a sign-off's own $2,500 for $3,000 drawn, a $210 minimum for $200, an NDP · btc reopens · date reopens · unsigned
    stays unsigned · legacy · manual month · lagging entry — a newer event · — BTC bought · — the balances stay · rule)
    · ⭐ ANCHOR other edits (a reading edited $5,000 → $5,500 moves the balance) · ⭐ KILL2 nothing else moves ×9 (the
    whole store before and after, a deep copy: an unsigned month; a signed month; a pledged buy with a Coinbase loan and
    a cold move; a buy with no dollars yet; a sign-off's own figures; the review's rounded seeds; a hand-entered Strike
    collateral; balances typed in Settings on the day of a reading; two signed months).
  - `src/components/Daily/__tests__/eventSheet.test.ts` — the 5d block (7): ⭐ DOLLARS typed · guess · cents · pledge ·
    edit kept · old figure · implied; `FULL` gains `buyUsd: null`.
  - `src/components/Daily/__tests__/dailyView.test.ts` — ⭐ ROW buy dollars ("₿ 0.0125 · $1,000.00", tagged "CENTS a logged buy's dollars"; was "(~$1,000.00)").
  - Fixtures only (`buyUsd: null` in each `SheetState`): `eventSheetCold.test.ts`, `cbDebtSheet.test.ts`,
    `dailyModeStore.test.ts`.
  - `e2e/buyDollars.spec.ts` (3; a manual $100,000 price, so the guess is exact) — ⭐ E DOLLARS add (E DOLLARS tap
    premise — $0.00 before any bitcoin · — no hint before a guess · E DOLLARS tap — the guess still comes · E DOLLARS
    gate — premise · — no dollars, no save · — dollars typed, save on) · ⭐ E DOLLARS edit (E DOLLARS edit gate — no
    dollars, no save · — dollars back, save on) · ⭐ E SIGNOFF (premise — the seeded sign-off · premise — the dollars
    field · figures kept · re-rolled).
  - Red-first (a plain export of `a68c494` with only the 7 test and e2e files): vitest 21 red (16 by an AssertionError, 5
    by a TypeError), 2,617 passed, 6 skipped, every file loading; the full e2e (`--retries=0`) 3 red, 71 passed, 2
    skipped. The mutations: the spec's §6.3 and Appendix P.
- **5c — the plan-load guard** (spec `pbloc-spec-plan-load-guard-v1` v1.1 — § Phase 4 → 5c; 5 new test files, 6 changed;
  the suite 2,555 → 2,610, 160 → 165 files; a new e2e spec, 4 tests; 65 mutations, MC1–MC65, each an exact-once edit
  run against the new unit files plus `calendarModel.test` and `sync.test` (MC64–MC65 with `escapeHatch.test` too) —
  and, for the screens, the e2e spec — red at its tag, the file restored and md5-checked, the tree's digest unchanged):
  - `src/store/__tests__/planLoadGuard.test.ts` (26, the REAL store) — planMissing (who waits — whatever the key; who
    never does) · ⭐ MINT (a minted key holds its plan; a rolled-back stamp takes it back) · ⭐ GUARD (day events; the
    monthly log — a manual log, a delete, a sign-off, a reopen; ⭐ PLAN EDITS — the setup modal's four fields, a viewer
    added, the Coinbase collateral; ⭐ RELAYS — kept local; ⭐ LATCH — the key-custody stamp goes through; non-vacuity
    twice) · ⭐ INCIDENT (5b's §16 on the real store: planless, the reconcile changes nothing and its flag waits; the
    premise; once the plan loads, a no-op and the sign-offs stand) · ⭐ HYDRATE (a fresh store; no blob — the escape
    hatch on a minted key; a blob from before 5c — a plan log and a plan sync time, or a minted key; a blob that
    carries the flag; the reconcile flag; ⭐ MERGE — the persist merge's wiring; ⭐ VIEWER CLEAR; a restored backup) ·
    ⭐ HELD (the plan and the journal at the gate, dirty kept; non-vacuity; the public relay list; the viewer fan-out)
    · ⭐ START (only after a confirm, only on 'none', only while waiting).
  - `src/lib/nostr/__tests__/planLoadPull.test.ts` (15; the store, the pool and the engine mocked) — ⭐ STATUS (applied ·
    decrypt · parse — the log names the error and the size, never the payload · shape · apply · prefs untouched) ·
    ⭐ TRIM (past the step, republished even when nothing is missing; within it, not) · ⭐ PULL (none — and still
    waiting · absent · ⭐ PUT BACK · put back empty · unreachable · not-reached · applied).
  - `src/lib/nostr/__tests__/syncNowHeld.test.ts` (1) — both channels HELD, no Reconnect, the log says why.
  - `src/components/Settings/__tests__/planNotLoadedNotice.test.tsx` (4; `renderToStaticMarkup`) — ⭐ NOTICE · ⭐ NONE
    (the two readings, "Start a new plan") · nothing unsettled or loaded · every reason's words, a backup-gated key's
    included.
  - `src/components/Entry/__tests__/noPlanNotice.test.tsx` (5; the store and the hooks mocked) — ⭐ NO-PLAN ('none' and
    waiting: no "starting fresh", "Start a new plan"; the entry fork's sign-in card promises no fresh start either) ·
    ⭐ NO-PLAN unreachable · loaded · unsettled · as before 5c.
  - `e2e/planLoadGuard.spec.ts` (4) — ⭐ PAUSED (the note, Save off, no sign-off banner) · ⭐ LOADED (non-vacuity) ·
    ⭐ HEADLINE (bought 0.04, moved 0.05 Strike → Coinbase: "+0.0400 ₿", "+$4,000 stacked", "Moved: Strike −0.0500 ₿ ·
    Coinbase +0.0500 ₿", in Week and in Month) · ⭐ REVIEW (the review sheet's "Moved" row; no "Net collateral").
  - Changed: `calendarModel.test.ts` (25 → 29: `netBtc` → `moves`; ⭐ HEADLINE, ⭐ PLEDGE, `formatMoves` twice) ·
    `sync.test.ts` (a relay answers; IGNORED's log check is now no "unreadable" or "parse failed" line — 5c retired
    "payload parse failed (skipped)" from the apply) · `journalSync.test.ts` / `journalSweep.test.ts` (the pools answer;
    `setPlanLoaded`) · `characterization.test.ts` (98 persisted keys, 104 with the plan of record's Run 1, 107 with its
    Run 2; `planLoaded: false`).
  - Red-first and the mutations: the spec's §6.3 and Appendix P.
- **Phase 4e — the `settings:v1` bridge retired** (spec `bitbloc-spec-4e-bridge-stop-v1` v1.3 — § Phase 4; 25 test files,
  3 new; the suite 2,505 → 2,494, 149 → 152 files; 32 mutations + X-PARITY-ORDER, each an exact-once edit run on its
  unit files with `--reporter=verbose`, red at its tag, the file restored and md5-checked, the tree's digest unchanged):
  - `src/lib/nostr/__tests__/bridgeRetired.test.ts` (5) — the RELAY layer is mocked (`nostr-tools/pool`, every relay
    ACKs; a signer that works — G3), so a publish routed inside `publish.ts`, the bridge's own path, is seen:
    - ⭐ RETIRED — a code-only walk of `src/` (comments stripped, `__tests__` skipped) for the channel and its machinery
      (`settings:v1`, `SETTINGS_DTAG`, `publishSettings`, `scheduleSettingsPublish`, `syncSettingsToNostr`,
      `[sS]ettingsDirty`, `[lL]astSettingsSyncAt`, `[lL]astV1FallbackApplyAt`, `hydrateSettings`,
      `synthesizeGenesisEvents`, `pickPlanFields`, `sawSettingsV1`, `sawPlanEvents`); the one allowed hit is
      `store/persistConfig.ts` (its strip);
    - ⭐ CHAIN — on a plan publish the only non-viewer d-tag that reaches the relays is plan-events (CHAIN only the plan
      channel); the fan-out and the revocation reach `viewerDTag(…)` of the two pubkeys and the revocation queue clears;
      from a planted DIVERGED reading (CHAIN parity premise, G6) only a parity call inside this publish turns it OK
      (CHAIN parity);
    - SEED — before the first pull both publishes refuse, nothing reaches a relay, and both dirty flags stay (green on
      the pre-4e code by design: it pins what 4c already did);
    - ⭐ RETRY — `syncDirty`'s truth table, plus RETRY wired and RETRY waits for the unlock (source pins on the hook);
    - ⭐ PLAN SYNCED — Settings → SYNC reads `relativeSync(lastPlanEventsSyncAt)` under "Plan synced".
  - `src/store/__tests__/viewerSettingsApply.test.ts` (4, the REAL store) — ⭐ VIEWER plan (a trusted snapshot lands the
    plan fields) · ⭐ VIEWER strip (never the viewer's relays, roster, gate stamp or cold stamp — "the rest still lands")
    · ⭐ VIEWER keys (the applier's whitelist IS the trusted snapshot's key set; whitelist + strip = SETTINGS_FIELDS) ·
    ⭐ PREFS / PREFS whitelist · ⭐ RAW (neither applier emits or dirties).
  - `src/lib/planEvents/__tests__/coverage.test.ts` (3) — ⭐ COVERAGE (pure: a non-seed absent field is listed; seed-valued
    and logged ones are skipped) · ⭐ COVERAGE real store (a fresh store reads none; a raw write is a gap; its emit
    clears it) · ⭐ COVERAGE row (DevPanel's call against `getInitialState()`, and the row's label).
  - Changed: `sync.test.ts` 26 → 19 (the pull asks for three; changes nothing + IGNORED; ROSTER pull) ·
    `liveSync.test.ts` +1 (LIVE three) · `useNostrSync.test.ts` +1 (⭐ RETRY locked) · `planEventsCutover.test.ts` 21 → 17
    (LATCH authed clear / one emit site / null returns first · ⭐ ROSTER, ROSTER peer · ⭐ RETIRED <key> · ⭐ STRIP <key>)
    · `relaySync.test.ts` 11 → 6 (RELAYS defaults) · `settingsClobber.test.ts` 4 → 2 · `backupGate.test.ts` 27 → 24 ·
    `planEvents.test.ts` 23 → 20 · `viewerRoster.test.ts` 8 → 7 · `characterization.test.ts` (the 97 persisted data
    keys) · 12 more retargeted, same counts.
  - Red-first (the 25 test files on the pre-4e app code): 24 red, `coverage.test.ts` can't load, 228 green — SEED, LATCH,
    ROSTER (+ peer, + pull) and RELAYS defaults are green by design.
  - The mutations, red at: M-CHAIN → CHAIN fan-out · M-REVOKE → CHAIN revocation · M-VIEWER → VIEWER plan, VIEWER strip:
    the rest still lands · M-VIEWER-CALL → `viewerSync.test.ts`'s 5 trusted-path `it`s · M-PREFS → PREFS whitelist ·
    M-STRIP-VIEWER → VIEWER strip, VIEWER keys · M-RETRY → RETRY plan · M-RETRY-WIRE → RETRY wired · M-PARTIALIZE →
    STRIP settingsDirty · M-PULL → the pull asks for three · M-PULL-LIT → RETIRED, LIVE three · M-READ → changes nothing ·
    M-LATCH → LATCH authed clear (+ both RAW-clear tests) · M-SEED → SEED plan · M-SEED-PREFS → SEED prefs · M-RETIRED →
    RETIRED · M-SAW → RETIRED · M-LIVE-ASM → LIVE three (RETIRED stays green — why LIVE three exists) · M-LABEL → PLAN
    SYNCED · M-PARITY → CHAIN parity · M-ROSTER-GUARD → ROSTER peer · M-RELAY-GUARD → RELAYS defaults · M-RAW → RAW ·
    M-HIDDEN (a `publish.ts` helper sending an assembled `settings:v1` d-tag from the plan publish's success) → CHAIN
    only the plan channel (RETIRED stays green — why the watch is at the relay layer) · M-READ-SWALLOW, M-READ-DIRTY →
    IGNORED · M-SYNC-GUARD → ROSTER pull · M-RETRY-AUTH → RETRY locked · M-RETRY-AUTH-WIRE → RETRY waits for the unlock
    · M-COVERAGE-SEED → COVERAGE, COVERAGE fresh store · M-COVERAGE-FOLD → COVERAGE, COVERAGE emitted · M-COVERAGE-ROW →
    COVERAGE row; the check X-PARITY-ORDER (an earlier `it` reads parity, and the publish's call is dropped) → CHAIN
    parity. An `it` stops at its first failure: M-RETRY shows RETRY plan only, M-READ the first "not called" check.
- **The plan of record (Run 1 — the support policy's saved settings)** (spec `pbloc-spec-plan-of-record-v1` v1.1 — § The
  plan of record (Run 1); 1 new unit file, 1 new e2e, 5 changed; the suite 2,494 → 2,509, 152 → 153 files; e2e 68 → 69;
  49 mutations, each an exact-once edit run on its unit files with `--reporter=verbose` (the e2e too for nine), red at
  its tag, the file restored and md5-checked, the tree's digest unchanged):
  - `src/store/__tests__/planPolicy.test.ts` (14, the REAL store) — ⭐ PLAN FIELDS (synced, in the backup, never prefs;
    C1 the one default; the ranges one object; six keys — no off switch; the slices' initial state is C1, read from
    `getInitialState()`; `lib/planPolicy.ts` has zero imports) · ⭐ EMIT · ⭐ CLAMP · ⭐ QUIET (an unchanged value or
    `enabled` emits nothing) · ⭐ RESET (all six, one ts, folds to C1) · ⭐ READ (the reader clamps: junk reads C1, out of
    range the edge) · ⭐ FOLD · ⭐ BACKUP (the six export; a pre-Run-1 backup validates and restores, leaving them be) ·
    ⭐ VIEWER (a trusted viewer receives and applies the six raw; a safe snapshot carries none) · ⭐ SEED (both seed
    resets) · ⭐ FACES START FROM THE PLAN (the four faces' order and deps; no face writes the plan; the hook only reads) ·
    ⭐ SETTINGS (owner-only page and row; writes through the store; its C1 label, no off switch; one clamp; the faces'
    label; THE ONLY EDITOR — a comment-stripped walk of `src/` outside the store and the tests, more than 100 files:
    only `YourPlanSection.tsx` names the setters, and no file names `emitPlanSets`) · ⭐ ONE CLAMP (70) · ⭐ CONSOLE (the
    console, THIS MONTH's crash line, the Outlook and both its parents pass the plan's limit — since Run 3 the console and
    the card's inputs hook, `usePlanCardInputs`; the Outlook left with runAdvisor).
  - `src/components/Tools/__tests__/crashPlaybookView.test.ts` — ⭐ PLAN STOP (0.45 at C1; 0.55 when the plan says 55;
    the depth follows; junk reads 0.45; 99 reads the 70% edge); the depth loop runs four plan limits {40, 45, 55, 70}.
    (Run 3 deleted `playbookDepthFor` with the Outlook: the depth's line and the depth loop went; PLAN STOP stays.)
  - `e2e/planOfRecord.spec.ts` (1, hermetic) — Settings → "Your plan" opens at C1 with no off switch; one notch saves
    46%; the Decision face's card opens on it; its what-if moves to 47% and "Back to your plan" returns 46%; Settings
    still holds 46%; "Back to the defaults (C1)" returns 45%. Every step carries a tag (PLAN row … PLAN C1 again).
  - Changed: `planEvents.test.ts` (`PLAN_EVENT_FIELDS` 35 → 41) · `characterization.test.ts` (blob 97 → 103; payload 39 →
    45 keys, 38 → 44 entries; C-trusted +6, with the D9 note) · `viewerSnapshot.test.ts` (the trusted key set 34 → 40) ·
    `planEventsCutover.test.ts` (a title).
  - Red-first (the new and moved tests on `bd9c31a`'s code): 8 red, and `planPolicy.test.ts` can't load; with the two
    pure modules added, 12 of 14 red — READ and FOLD green by construction; the e2e red at "PLAN row".
  - The mutations (spec Appendix P, MR1–MR49) are red at their tags. MR24 (the hook overrides the limit) and MR25 (the
    hook drops `useShallow`) are green at the unit by design — the e2e catches them (PLAN saved; Your plan opens).
- **The plan of record (Run 2 — THIS MONTH and Daily)** (spec `pbloc-spec-plan-of-record-v1` v1.7.2 — § The plan of
  record (Run 2); 6 new test files, 13 changed; the suite 2,625 → 2,703 (+6 skipped), 166 → 172 files (171 / 1); e2e
  72 → 73 (+2 skipped); 104 mutations — M01–M100 unit, E1–E4 through the e2e — applied from the review's
  `pbloc-por-run2-mutations-v1.7.1.json`, each an exact-once edit run on its test files, restored and md5-checked, and
  red at its tag by an ASSERTION (M64 at its untagged test). A "Test timed out" never counts as a red):
  - `planRun.test.ts` (12) — ⭐ ONE (the run's placement input and engine inputs are the builders' own, at today's price
    and S₀) · ⭐ MOVE (the horizon can't change the move: S₀ is the same on 12 and 60 months, over 96 cells) · ⭐ GATE
    (off, the seed's $60,000 on 1.48 ₿ never reaches a plan) · ⭐ SWITCH (the over household is back in month 8; never
    month 0; one rule with the status — dust) · ⭐ INT (Σ `strikeInterestUsd` is the total, both modes) · ⭐ MIN (false ≡
    absent; income pays the minimum before the buy; only an unpaid part capitalises; the drawing-month identity).
  - `planMonthView.test.ts` (31) — ⭐ WORDS (every sentence the two cards print, the meter's spoken one included, over 600
    runs × 12 months — three incomes, the last also with a 3-month cash reserve, five prices, five Coinbase legs,
    three Strike legs, both minimum modes; over
    40,000 strings asserted: never "should", "need to" or "safe", never "$0", "₿0.000" or "0.000 ₿") · NOTE · ⭐ STATUS
    (today's fact, the time and the catch-up; later months; N8 after a liquidation, swept; invariant 4 — no new
    Coinbase borrowing in a month over the limit, over 1,000 such months; Δ9's three bodies against the run; Δ8's
    refused policy) · ⭐ ROWS (the kinds are `planSchedule`'s for every month, 13 reached; muted anchors; "today";
    unpaid) · ⭐ VENUE · ⭐ AFTER (the row's support; the engine's verdict; the meter read aloud; the cliff is
    `cbSeizurePrice`; never "₿0.000 held") · ⭐ TRACK · ⭐ FOOT (ordinals, the minimum, the NDP, the Ledger, next month,
    the savings count, the price line; `planLedgerTargets` against the month's to-do rows — Δ4) · ⭐ BREAKER (fresh,
    cached, loading, none; Δ6, Δ12) · LOGGED · CRASH.
  - `planRunWiring.test.ts` (17) — ⭐ ONE (the face and the hook build through planRun; no main screen calls
    `runCyclingSim(` or `placementPlan(`; Δ7's 15 facts read by the same expression in both selectors; Δ3's today per
    render and the accrual's key) · ⭐ GATE · ⭐ MIN · ⭐ CARD (the hook on both screens; `runAdvisor` only for the overlay
    — none at all since Run 3;
    no figure formatted in the card; no dead toggle; next month hidden at month 12; Δ4, Δ5, Δ8, Δ10) · ⭐ I31 (every text
    of three or more words on either plan card, read off its syntax tree, is one of eleven listed labels) · NOTE ·
    ⭐ CACHE (one write, fresh only, in an effect; read through `planBreakerCacheOf`) · ⭐ HOLD · WHATIF · CRASH.
  - `planRunStore.test.ts` (6) — ⭐ DEVICE (the three keys' defaults from `getInitialState()`; the setters write and emit
    nothing; never synced; persisted; `clearViewerData` clears the viewer's date) · ⭐ HOLD (the trusted snapshot's date;
    never in the safe one).
  - `strikeHoldRule.test.ts` (3) — ⭐ HOLD (invariant 8: over 4,000 journals × 9 days, `strikeHoldFrom` and
    `strikeHoldAt(latestStrikeDepositISO(…))` both equal `3580f92`'s rule, frozen in the test; the device's fact; the
    edges — day 60, day 61, a future deposit, junk, null).
  - `strikeMinimum.test.ts` (3) — ⭐ INT, ⭐ MIN at the engine's other sites (the policy-off cycle, hold, clearStrike,
    clearBoth), and Δ11's baseline: a "hold" run equals never-draw in both modes.
  - Changed: viewerSync (+2, HOLD), cyclingFaceView (+4: MIN ×3, GATE), decisionView (the sweep's fifth fixture —
    12,245 runs; `payMinimum`; the first line), decisionWiring (the pins read planRun.ts), crashPlaybookView (the
    fixture carries the hold's fact), emergencyConsoleWiring, monthlyPlaybookWiring (two label sites; the card's crash
    status), resetMirror (the builder call), ownershipFaceView (two fixture fields), advisorPricePath (three
    `runAdvisor` callers — none since Run 3, invariant 3), characterization (107 persisted keys), planPolicy (ONE CLAMP,
    CONSOLE), viewerSnapshot
    (`strikeLastDepositISO`); the e2e `planOfRecord.spec.ts` ("Run 2": DAILY status · DAILY row · MONTH status … ·
    CATCH-UP · WHY · NOTE shows … stays dismissed) and `navigation.spec.ts` (the Decision smoke's first line).
  - ⚠ **Why five sweeps carry 60 s** (spec v1.7.1, §13.13): WORDS, STATUS (invariant 4), ROWS and AFTER (at support) in
    `planMonthView.test.ts`, and HOLD in `strikeHoldRule.test.ts`, end `}, 60_000);` with a one-line reason. On Node 26,
    `Number.prototype.toLocaleString` — what `fmtUSD` calls for every dollar figure — is about 40× slower than on Node 22
    (27 µs a call against 0.7), and WORDS makes over 400,000 `expect` calls (419,287 over 147,763 sentences). Without the
    timeouts WORDS (9–10 s alone on Node 26, ~20 s in a loaded full suite) and ROWS (~6 s loaded) ran past vitest's 5 s
    default. HOLD (about 1 s on both Nodes) carries 60 s as headroom for a loaded suite. Measured in the build's two
    full runs on Node 26.11.1: WORDS 20.4 / 20.2 s, ROWS 6.0 / 6.1 s.
  - Red-first (the new and moved tests on `3580f92`'s code, in a plain export outside the repo): six files can't load
    (planRun, planMonthView, strikeMinimum and decisionWiring — no planRun.ts; planRunWiring — no usePlanMonth.ts;
    crashPlaybookView — "dayLog is not iterable"); 24 tests red (planRunStore 4, strikeHoldRule 3, characterization 3,
    cyclingFaceView 4, viewerSync 2, planPolicy 2, monthlyPlaybookWiring 2, and viewerSnapshot, decisionView,
    advisorPricePath and emergencyConsoleWiring 1 each); resetMirror and ownershipFaceView green by construction; the
    e2e red at "DAILY status", and the Decision smoke at `navigation.spec.ts:301` (Run 2 flips the card's first line,
    `PLAN_OF_RECORD_LINE`). Of the 24, 19 fail by an AssertionError and 5 by a TypeError, each calling a function Run 2 adds.
  - The mutations (spec Appendix P2, M01–M100 and E1–E4) are red at their tags by an assertion.
- **The plan of record (Run 2.1 — the device check's fixes)** (spec `pbloc-spec-plan-of-record-v1` v1.12 — § The plan of
  record (Run 2.1); 5 unit files and 2 e2e specs changed, no new file; the suite 2,703 → 2,714 (+6 skipped), 172 files
  (171 / 1); e2e 73 → 75 (+2 skipped); 60 unit mutations and 8 through the e2e, each an exact-once edit from
  `pbloc-por-run21-mutations-v1.12.json`, red at its tag (the 60 unit ones by an AssertionError), restored and
  md5-checked):
  - `planMonthView.test.ts`, the block "⭐ RUN 2.1" (+7):
    - ⭐ CENTS the formatter — two decimals, grouped, no sign; `fmtUSD` stays whole (the faces and full mode); `toCents`
      keeps a stored value to the cent (1.005 → 1.01);
    - ⭐ every to-do amount and every buy's dollars to the cent, over 600 runs × 4 months (60 s): CENTS a to-do amount ·
      a buy's dollars · the refinance fee · TODAY'S PRICE a later month's buy · TODAY'S PRICE never this month's;
    - ⭐ CENTS every figure on the card, over 600 runs × 12 months (60 s): the status, its catch-up, the after box, the
      price line, the savings need and "Why this plan?";
    - ⭐ CENTS the NDP estimate to the cent · the engine keeps its whole dollar (full mode) · the NDP balance: the
      reading, else 15% of the line;
    - ⭐ CENTS "Why this plan?": the face stays whole; the cards' words to the cent; the same words;
    - ⭐ DOT the split covers the border; one venue is its colour; a "—" is a ring;
    - ⭐ BARS against the plan · nothing logged yet · over the target · a past month · no target, no fill · never
      "$0 / $0" · Week's caption.
  - ⭐ WORDS' zero rule (δ1) is `/(?<![\d.,])\$0(?:\.00)?(?!\d|[.,]\d)/` — a zero, whole or ".00", not followed by a digit,
    or by a "." or "," and a digit — with a nine-string self-check ("WORDS the zero rule sees $0.00"). The old rule
    couldn't see "$0.00" (MC59 — the after box's zero Strike balance) or a zero before a sentence's own comma or full stop
    (MC60 — "Strike's interest, $0.00, rolls…").
  - Moved pins, same file: the status, its catch-up and the limit line; the later status; a liquidated month's body; the
    after box; the savings need; the price line; the interest; the Ledger so far; a logged payment and month-end; next
    month (cents, and the label); the tiny buy (month 2, so labelled); ROWS through `fmtUSDCents`; VENUE `border-box`.
  - `planRunWiring.test.ts`:
    - CARD — BARS (Week reads the current month; the month so far in both scopes; a past month has no target; one
      builder; Week's caption; no bar composed in the screen); CARD Daily paydown, both loans; the interest sites to the
      cent;
    - ⭐ CENTS — Daily's other figures: the month rollup; the borrow sheet's fee; the paydown sheet's minimum — its cents,
      whatever the ordinal (δ2) — and, apart, ORDINAL the paydown sheet's due day (δ5); the minimum's estimate kept to
      the cent; the sheet's estimate and price; the month review's totals and its Coinbase note; the sign-off seeds kept
      to the cent; no seed rounds to a dollar;
    - ⭐ CENTS — no whole-dollar figure on THIS MONTH or Daily: no `fmtUSD(` or `toLocaleString(` in DailyModeView,
      PlanMonthCard, SafetyDashboard, PriceChart, dailyView, EventSheet, eventSheetModel, ReviewSheet, planMonthView or
      MonthEventsModal (δ3, last); THIS MONTH's NDP card and its estimate, one NDP balance on both screens, the review's
      NDP seed; the Safety card's price chart; the price chart and the month log whole by default; only the Outlook's
      re-anchor stays whole on Simple mode's own lines (Run 3 moved it onto THIS MONTH, to the cent — Simple mode has no
      whole-dollar figure left).
  - `crashPlaybookView.test.ts`: ⭐ `fmtStepUsdCents` — a step to the cent, floored (a capped shift never prints over the
    line), none under $1; the line's five shift pins move to cents; the sweep's parity test reads the line's shift whole
    (`wholeOf`) against the card's.
  - `dailyView.test.ts` and `cbDebtSheet.test.ts`: the day log's amounts, a reading's balances, the Coinbase and Strike
    rows and the stale-balance note to the cent (+1 test: a paydown, and the suggested balance).
  - e2e, `planOfRecord.spec.ts` — "the plan of record — Run 2.1" (+2):
    - E BARS caption · week · month · no caption in Month;
    - E CENTS Daily row · no whole dollars on Daily · the price · THIS MONTH row and amount · the status to the cent · no
      whole dollars on THIS MONTH. Each scan reads the screen's text — a whole figure before a comma or a full stop
      counts — and needs more than five figures to the cent;
    - E TODAY'S PRICE this month: dollars to the cent · this month: no label · E month 2 · E TODAY'S PRICE a later
      month.
  - Moved e2e pins: Run 2's MONTH test (the status, the to-do, the catch-up, "Why this plan?") and planLoadGuard's
    "+$4,000.00 stacked", now tagged "E HEADLINE stacked, to the cent" (δ6).
  - Sweep times (Node 26.11.1, the file alone): WORDS 6.4 s, the to-do CENTS sweep 0.8 s, the card's 0.5 s; in a loaded
    full suite 14.3 s, 1.6 s and 1.1 s — all inside their 60 s.
  - Red-first (a plain export of `520c233` with only the 7 test and e2e files): 37 red — 27 by an AssertionError, 10 by a
    TypeError (`fmtUSDCents` 7 times; `planBars`, `fmtStepUsdCents` and `planNdpEstimateUsd` once each) — 2,677 passed,
    every file loading; the full e2e (`--retries=0`) 4 red, 71 passed, 2 skipped: the two new tests at "E BARS caption"
    and "E TODAY'S PRICE this month: dollars to the cent", Run 2's MONTH test at "DAILY status", HEADLINE at "E HEADLINE
    stacked, to the cent".
  - The mutations (spec §14.9): MC1–MC60, every one red at its tag by an AssertionError. 21 don't pass tsc and none needs
    to — vitest never type-checks: eleven name a formatter their file doesn't import (MC20, MC21, MC24–MC28, MC32, MC33,
    MC48, MC57), ten leave a name unused (MC15, MC17, MC35, MC49–MC51, MC53, MC55, MC56, MC58). Through the e2e
    (`-g "Run 2.1"`, `--retries=0`, the unmutated control first): MC1 → E CENTS Daily row; MC3 → E TODAY'S PRICE a later
    month; MC10, MC41, MC42 → E CENTS no whole dollars on Daily; MC15, MC23 → E BARS week; MC17 → E BARS caption.
- **The plan of record (Run 3 — the year)** (spec `pbloc-spec-plan-of-record-v1` v1.16 — § The plan of record (Run 3);
  one new unit file, `planYearWiring.test.ts`, and one deleted, `outlookView.test.ts`; the suite 2,742 → 2,727 (+6
  skipped), 173 files (172 / 1) — 41 test names gone and 26 new, at least 8 of the 41 renamed or re-homed; e2e 78 → 81
  (+2 skipped); 47 unit mutations and 5 through the e2e, each an exact-once edit from
  `pbloc-por-run3-mutations-v1.16.json`, red at its tag by an assertion, restored and md5-checked):
  - `planYearWiring.test.ts` (12, new; read off the source — no render harness):
    - ⭐ YEAR — the Advisor tab's one run (`usePlanCardInputs`, once); THIS MONTH's card with its crash line, NDP and
      Ledger; the Ledger from full mode; no plan rows, Pay / Skip, runAdvisor month or projection; the sidebar's
      projection line gone;
    - ⭐ INPUTS — the NDP as THIS MONTH read it; the annual clause in roll mode only; the accrued Coinbase balance
      behind the loan switch; the crash gate on it; THIS MONTH takes them and computes no second NDP;
    - ⭐ LOG — both screens hand the log and the overlay their run's rows (`planLogRows`); both take `PlanLogRow`s, no
      Advisor row and no income residual, and start their forms from the plan's paydown and month-end LTVs;
    - ⭐ PATHS — no switch; THIS MONTH's link; the Advisor tab's, while the Almanac tab can open; the link's face;
      `goAlmanac` unchanged (no face, no argument — the nav passes it as `onClick`); the effect that forgets the face;
      both modes pass the face; the hub reads it at mount; the expenses prompt owner-only;
    - ⭐ INV6 — no component reads `advisorSkip*`, `cbRotateBackPct` or `advisorMonthStartBalance` (a sweep of more
      than 100 component files); one writer left, the sign-off's carry; their keys stay in `SETTINGS_FIELDS` and
      `VALIDATE_WHITELIST`, so an older backup restores; no Rotate-back input; the order check without it; no
      month-start field in Settings or Quick Setup; no "Outlook" in Settings.
  - `planMonthView.test.ts`, "⭐ LOG — Run 3" (+3): ⭐ LOG strategy month k is the run's month k − current + 1, over every
    run × current month {1, 4, 12} — more than 10,000 rows, each the run's own figures — and this month is the card's
    month 1; ⭐ LOG PAID — the Strike paydown plus Coinbase's is Daily's "paid" target every month, with a refinance, a
    cash cure (a household past Strike's call) and spare income each reached; ⭐ PATHS and REANCHOR — the link's words,
    the prompt to the cent, no banned word.
  - Rewritten for the new source: `planRunWiring` (CARD — the card takes its screen's run and runs nothing itself; no
    `runAdvisor` on any plan screen; HOLD, CRASH and the NDP's CENTS pins read the hook; THIS MONTH has no whole-dollar
    formatter); `monthlyPlaybookWiring` (3 — no plan screen says "CB paydown"; the crash line builds in the hook, its
    builder's first line pinned whole; both screens call the hook once and build no line); `advisorPricePath` (⭐
    invariant 3 — more than 200 source files, and only `runAdvisor.ts`'s definition says `runAdvisor(`); `planPolicy`
    (CONSOLE — the console and the hook); `crashPlaybookView` (PLAN STOP and the one stop call, re-homed).
  - Deleted with their code: `outlookView.test.ts` (7); `playbookDepthFor`'s three (two re-homed); the Outlook label's
    and legend's (rewritten, 5 → 3); the `simpleModePlan` helpers' 16 (runAdvisor's own two — a monthly Coinbase payment
    lowers the row's LTV and is reserved once — re-homed) and `deriveForMonth`'s two in paydownState;
    `displaySettledLtv` / `isLtvFigureStressed`' (paydownState 3, paydownPeak 2; the stuck case keeps its engine
    assertion).
  - e2e, `planOfRecord.spec.ts` — "the plan of record — Run 3" (+3): YEAR (the Advisor tab: the card's status, its
    to-do to the cent, no Skip, Pay or projection; LOG the plan's buy, paused; PATHS the Decision face; full mode's
    Tools menu opens the default face once the hub is left) · PATHS (THIS MONTH: no Outlook switch; the link; ← Back;
    the nav's button opens the default face — checked by its own words, "Next halving") · REANCHOR (the prompt to the
    cent; Update; the field to the cent).
  - Red-first (`dcd6cb5`'s app code with the new tests): 25 red — 23 by an AssertionError, 2 by a TypeError
    (`planLogRows`, `planStrikePaidUsd`); `planYearWiring` and `planRunWiring` load only once `usePlanCardInputs.ts`
    exists, so an empty one stood in. Green by design: INV6's keys, ONE's absences, the re-homed crash pins. The e2e: 3
    red, at "YEAR the card's status", "PATHS no Outlook switch" and "REANCHOR on THIS MONTH, to the cent".
  - The mutations (spec §15.7): Y01–Y47, every one red at its tag by an assertion. Through the e2e (`-g "Run 3"`,
    `--retries=0`; the unmutated tree passes): Y23 → REANCHOR saved to the cent; Y24 → PATHS the Decision face; Y31 →
    PATHS the default face; Y32 → PATHS forgotten on leaving (YEAR) and PATHS the default face; Y35 → PATHS the
    Decision face (both).
- **The plan of record (Run 4 — Safety and the edges)** (spec `pbloc-spec-plan-of-record-v1` v1.20 §16 — § The plan of
  record (Run 4); three new unit files and one deleted, `liqSimulatorView.test.ts`; the suite 2,727 → 2,764 (+6
  skipped), 173 → 175 files; e2e 81 → 89 (+2 skipped). The mutations are spec v1.20 §16's — no counts here):
  - `src/utils/__tests__/timeLimit.test.ts` (7, new):
    - ⭐ STALL — `withTimeLimit`: a request that never answers fails AT the limit, not before, with an AbortError (as
      fetch reports it); the limit is 15 s; a request that answers in time is never aborted afterwards and leaves no
      timer; an unmount (the outer signal) aborts at once, and an outer signal already aborted never starts a live one;
      an error inside the limit passes through unchanged;
    - ⭐ STALL — read off the source (no render harness): both hooks fetch AND read the body inside the limit, one fetch
      each; `usePowerLawData` ends its loading and aborts on unmount; `useBtcHistory` keeps the chart drawn for its range
      when a refresh fails (`shownRange`) and aborts on unmount.
  - `src/simulation/__tests__/safetyAtSupport.test.ts` (17, new; round synthetic figures):
    - ⭐ ATS — debt ÷ (collateral × support) beside the plan's limit; none without a reading (no loan, dust, no
      collateral, no or zero support, no limit, junk); "over" is THIS MONTH's rule — a sweep against `placementPlan`'s
      `cbOverCeilingUsd` (116 positions) that reaches both sides, the half cent and the 50¢ dust floor (`DUST_USD`)
      from both sides; amber at most, never red;
      `planCbLimitOf` equals the plan's own run (`planPolicySettingsOf(planPolicyOf(s)).cbStopEffPct / 100`) over the
      setting's range (40–70), past both ends and on nine junk values; `supportToday` is the plan's S₀ on five dates; the words — to the cent, whole, no price on the
      safe path, never "safe";
    - ⭐ MOVE — Safety reads the position as it stands, THIS MONTH's card after the move: over a sweep, the only way
      the two differ is Safety "over" and the card "within", when this month's move tops Coinbase up from Strike
      (`planMoveBringsCbWithin`; the plan's `strikeToCbBtc` above 0) — within at support stays within after the move —
      and an inert plan never counts; the owner's line names the move then, and only then;
    - ⭐ VERDICT — over at support with today's bars green → amber, in its own words; within → today's words; today's
      amber keeps its words; red stays red; no loan, or no support supplied → no reading, nothing changes;
    - ⭐ VIEWER — the owner seals the ratio and its verdict, the viewer folds the verdict and never scales the ratio;
      the safe line has no price; an older snapshot shows no reading and leaves the overall as it was; the trusted path
      reads it live with the support price; no absolute — two positions with the same ratios seal the same block
      (except within 50¢ of the limit, or on a debt under 50¢, where the dust floor decides — one bit about size), and
      the block's keys are exact.
  - `src/components/Advisor/__tests__/planEdgesWiring.test.ts` (16, new; read off the source, beside the pure words):
    ⭐ GATE (the console's one gate is the loan and the Liq Sim's three files are gone; every label — the tab, the face
    and Settings' tab list — and no component's code names the Liq Sim; the Decision face's
    `consoleRuns`; with the loan off, neither of the loan's tabs stays open; the crash day in `usePlanCardInputs` and
    Daily; `isCrashDay` at and under the trigger and with no loan) · ⭐ INV6 (no component reads or writes `cbPaymentStrategy` or `cbMonthlyPayment` — a sweep of more than 100
    component files; their keys stay in `SETTINGS_FIELDS` and `VALIDATE_WHITELIST`; no strategy pills, "Monthly
    payment", "payment strategy" in any case, MONTHLY PAYMENT or "Min. payment"; the crash-day thresholds sit inside the loan's block) · ⭐ RULES (YOUR
    PLAN's rows as the plan runs them, no typed rules; C1's six values in the sliders' words; a pushed pay-down zone; a
    limit held to its line) · ⭐ CBTAB (no protocol; the crash day, its banner and card, the two alert rows, the bar's
    marker, the shell's two links; Safety's level and words; no projection or second classifier; the plan's year; the
    words of `atTriggerLine`, `cbTabCrashDayLine` and `CONSOLE_LINK`, one copy — decisionView's alert reads it) ·
    ⭐ COLOUR (the Advisor tab's Current LTV is Safety's; no tiers) · ⭐ SAFETY (today's support, keyed on the day; one
    input set; the line to the cent; amber when over; the verdict; the move from THIS MONTH's and Daily's own run) · ⭐ VIEWER (the trusted path's support; the gauge's
    sub-line; the snapshot's support and the plan's limit) · ⭐ MIN (the suggested line on the plan's Coinbase leg,
    accrued; its words; no year-one minimum; `suggestedLineWords`, one copy with THE MOVE).
  - Changed: `planMonthView.test.ts` (REANCHOR on BL26's words and both buttons, to the cent; +1, ⭐ REANCHOR one figure
    — a 2,000-step sweep across half-cent edges: the line, Update's label and `toCents` agree) · `monthlyLog.test.ts`
    (+2, ⭐ F-R4-1: the month in progress stays out, a bound of 13 counts all twelve (THIS MONTH passes 12 once the year is
    done), fewer than three before this
    one → no prompt; a month that records no expenses stays out — never "averaged $0.00") · `planRunWiring.test.ts`
    (CENTS: the prompt's words, Update to the cent, Keep dismisses; REANCHOR: the month in progress stays out) ·
    `decisionView.test.ts` (`consoleRuns` in the context; the console pointer — no strategy named — the crash note and
    THE MOVE's alert read "(it runs once your Coinbase loan is switched on)") · `planYearWiring.test.ts` (INPUTS: the
    crash gate without the strategy) · `controlDockWiring.test.ts` (⭐ SIX-ONCE on `PLAN_RULE_LABEL`) ·
    `safetyView.test.ts` (the selector maps the plan's Coinbase limit at support) · `characterization.test.ts` (the safe
    snapshot: `cbLimitAtSupport` 0.45 at C1; `cbLtvAtSupport` null and `cbAtSupportLevel` 'safe', the seed having no
    Coinbase loan) · `viewerSnapshot.test.ts` (`cbAtSupportLevel` a level, `cbLtvAtSupport` a ratio or null, the safe
    thresholds' key set exact).
  - Deleted with its code: `liqSimulatorView.test.ts` (6).
  - e2e, `planOfRecord.spec.ts` — "the plan of record — Run 4" (+8): STALL (both histories held open: no breaker line
    and the chart loading while open; past the 15 s limit the cached breaker's line and "price history unavailable") ·
    SAFETY ×3 (THIS MONTH over the plan's limit at support: the line, amber, today's bar green, the at-support verdict
    and the card agreeing; Daily within the limit: the line, no tone, today's verdict; with 2 ₿ on Strike, this
    month's move tops Coinbase up: the line names the move, still amber, and the card reads within) · VIEWER (the
    owner's Dashboard, the trusted path: the line in whole dollars, and the overall folds it) · CONSOLE (with a Coinbase loan
    the `liqsim` tab runs the console) · NO LOAN (with the loan switched off, the Emergency tab gives way to the first tab,
    never an empty page) · CBTAB (the "On a crash day" card and its words; no Emergency Protocol and no
    projection; the "Your trigger" row; the link opens the console). Run 3's REANCHOR reads BL26's words, with a month in
    progress that stays out of the average; `navigation.spec.ts`'s MOVE-ALERT reads the alert with no strategy clause.
- **Crash playbook (Run 1)** (every ⭐ proven red by a temporary edit):
  - `cbDefense.test.ts` — the leaves: `strikeReleasableBtc` (⭐ exactly 40% releases to just UNDER 50%; ⭐ 40.01% → 0, the
    hold → 0; a balance of 0 → all of it; junk → 0); `ceilingLiquidationMultiple` (stop ÷ lltv; junk → +∞); `topUpToCbLtv`'s
    release cap (⭐ binds the Strike leg only; ⭐ absent ≡ undefined ≡ a non-binding cap, `toStrictEqual` across the
    fixtures; NaN / negative / ±∞ → no Strike leg, never NaN); `cbDoomedThisMonth`'s release term (⭐ it REPLACES the
    margin term — alive under the margin bound, doomed under the rules; ⭐ absent ≡ byte-identical, non-finite → false).
  - `crashPlaybook.test.ts` (new) — every order (none / topUpFirst / shiftFirst below the depth and at or above support /
    doomed), ⭐ a full top-up records no shift step, cold before Strike, ⭐ the release rules (over 40%, the hold, a binding
    release left just under 50%), ⭐ the fallback only for the shift's shortfall, ⭐ the dust drop, coins and debt
    conserved, `shortfallBtc` > 0 exactly when the line doesn't hold, junk → none.
  - `cyclingSimPolicy.test.ts` — the "crash playbook" block: ⭐ the switches (absent ≡ the playbook across the A5 paths,
    the stress rows and a double-drop sample; policy OFF ignores all three; each non-vacuous on a named fixture);
    ⭐ release rules 1–3 (Strike 46% → no Strike leg; the line full + Strike 36% → month-end Strike LTV < 50%; the hold —
    month 2's premise through the leaf, red by dropping ONLY the hold condition); ⭐ the release-aware doom question;
    ⭐ P9 with 0.05 ₿ (all the cold, then released Strike collateral, no shift; rows before the dip ≡ R's); ⭐ shift first
    below the depth ≡ R; ⭐ the dust drop; no phantom shift after a full restore (the synthetic grid); ⭐ the pre-shift
    reserve with a Strike cap of 40; ⭐ P3 on `reachGrid()[0]`; the repayment-split identity; `firstUnheldMonth`;
    ⭐ **parity** — the engine's month 1 ≡ `crashPlaybook().after`, bit for bit, with every order and step kind; ⭐ G2 under
    the playbook and any depth. The G3 P9 pin moved to `firstDefenseMonth ?? firstTopUpMonth` (the dip is now a top-up).
  - `supportPolicyView.test.ts` — the after-liquidation lines: ⭐ "after Strike" while Strike owes, "first" once it is
    repaid (reach cell 0 — a month-0 seizure, the one way a leftover arises since Policy v2 — months 2–6, then 7–9 and
    repaid at 10), month 0 keeps the words before it, no line says "room at support"; ⭐ the accumulate
    headline (constructed); ⭐ `repaidTail` in the pause reason (P6 and reach cell 0 moved — see the report).
  - `cyclingFaceView.test.ts` — `playbookNote` shapes, `defendedFromSub`, `collateralMovedFlag`, `unheldMonth`, and the
    engine-backed P9 at $4k with 0.05 ₿. `supportPolicyWiring.test.ts` — the face-level pins (Structural guards).
  - `supportPolicyReport.test.ts` (env-gated) — the `-t "crash playbook"` block: pre / R / playbook / anyDepth per set,
    all grids, double drops by first-leg depth, custody, the invariants ("STOP — invariant broken" if either is non-zero)
    and §4 v1.1 applied mechanically.
- **Crash playbook (Run 2 — the Emergency Console)** (every ⭐ proven red by a temporary edit; round synthetic figures):
  - `src/components/Tools/__tests__/crashPlaybookView.test.ts`:
    - the builder: ⭐ pass-through + the four lender constants; ⭐ the stop at support through `effectivePolicyStops`
      (on the plan's limit — C1 in LIVE since the plan of record's Run 1: target 70 → 0.45, 40 → 0.40, every target 40–85 equal to the helper), with a source guard — the module calls
      `effectivePolicyStops(` and holds no inline min (the values alone can't tell the one clamp from a copy);
      ⭐ cold under a satoshi (or junk) → 0;
    - ⭐ Strike's 60-day hold on both sides (60 days back → in hold through the deposit + 60 days; 61 → free); the
      latest deposit sets the dates, a future-dated one counts; other targets, a withdrawal and junk dates never hold;
      the builder's `strikeInHold` agrees;
    - the formatters: ⭐ `fmtStepBtc` FLOORS (a binding release prints `0.59999`, never `0.60000`); ⭐ the float guard
      (`0.3 − 0.25` prints `0.05000`, `0.04999` without it); `fmtStepUsd` (whole dollars, none under $1);
      ⭐ `fmtMultiplePair` widens (0.70× → `0.700` / `0.698`; 0.6975× → `0.6975` / `0.6977`);
    - `waitingCard`: the target–trigger band waits; at the trigger, at or under the target, past 86% and on junk → null;
    - `playbookCard`, one fixture per shape with exact strings: none / junk; ⭐ top up first (LIVE); cold then Strike;
      below the depth; at or above support; ⭐ doomed at the open, saved by the debt shift (held — never doom);
      ⭐ the doom warning (after ≥ 86%, the cold untouched); ⭐ short (the floored release, the named rest); ⭐ an exact
      tie at 86% (not doomed, no step, the whole card `toEqual`, outcome doom); the four gap shapes; the widened
      multiples; no Strike balance;
    - ⭐ the sweep (the spec grid, the waiting card included): no NaN / Infinity / undefined / "$0" / "0.00000 ₿";
      topUpFirst never ends past 86% — a tie AT 86% is possible (the exact-86% ⭐); a held outcome ends at or under
      the target; ⭐ residue cold never moves; non-vacuous (every order and outcome occurs);
    - ⭐ layering: the module imports no power law, cycle model, store or React.
  - `src/components/Tools/__tests__/emergencyConsoleWiring.test.ts` (source-reading): ⭐ the console calls the view's
    four helpers, `crashPlaybook(` and `accruedCbBalance(`, reads the live figures (the Strike balance is
    `advisorActualBlocBalance`) and keeps `plBandsAt(`; ⭐ none of the Phase-1 surface survives in it; ⭐ SettingsMain
    has no "Emergency ceiling" field (deleted in Run 2) and no reader of its setting.
- **Crash playbook (Run 3 — the Monthly Playbook)** (every ⭐ proven red by a temporary edit; round synthetic figures):
  - `crashPlaybookView.test.ts` (extended):
    - `monthPlaybookLine` — one exact whole-object `toEqual` per shape (the `LINE_CASES` table; the `LINE_*` strings
      are the line's, not the card's):
      - none / junk → null;
      - ⭐ top up first (LIVE);
      - cold then Strike;
      - ⭐ three listed steps — premise `result.steps.length === 3`; `.slice(0, 2)` → red;
      - ⭐ doomed at the open, saved by the shift — premise `result.doomed`; doom keyed off `result.doomed` → red;
      - the doom outcome;
      - ⭐ short — `₿0.59999`; `fmtColdBtc` prints `₿0.60000` → red;
      - the gaps: Strike over 40%, a $0.30 line, nothing movable, the exact-86% tie;
      - at or above support.
    - `playbookDepthFor` (deleted in the plan of record's Run 3 with the Outlook legend, its only screen; the
      one-call guard stays, under "the live builder's Coinbase stop at support"):
      - ⭐ it equals the builder's stop at support ÷ 86% for every target 40–85 × plan limits {40, 45, 55, 70} (the plan
        of record, Run 1; `'0.52'` at 65 and `'0.47'` at 40 on the C1 45% limit; a literal → red);
      - ⭐ the module calls `effectivePolicyStops(` exactly once. A second inlined call → red, while the Run 2 presence
        guard stays green.
    - The sweep gains a 72% Coinbase LTV (a waiting card clearly inside the band) and the line:
      - ⭐ the line lists exactly the card's steps — count, order, printed amount — and some line lists three;
      - the line is null iff `'none'`;
      - it has the same outcome kind, gap presence and past-liquidation presence as the card;
      - no NaN / Infinity / undefined / "$0" / "₿0.00000".
  - `monthlyPlaybookWiring.test.ts` (new, source-reading):
    - ⭐ the one label;
    - ⭐ the four label sites render `CB_PAYDOWN_LABEL` and say neither "CB paydown" nor "pay down CB", comments included
      (two sites since the plan of record's Run 2 — "the two Advisor sites", OutlookProjection and AdvisorMain; the test
      also fails if SimpleModeView, DailyModeView or PlanMonthCard names the label, or either bare wording, again);
    - ⭐ the space beside every label expression is kept. JSX drops whitespace at a line break, so "between" ⏎
      `{playbookDepthFor(…)}` renders "between0.70×";
    - ⭐ SimpleModeView builds through `playbookInputFromLive` / `crashPlaybook` / `monthPlaybookLine` / `plBandsAt` on the
      live figures (`strikeBalance: advisorActualBlocBalance`) and holds neither deleted name; since Run 2 it hands the
      line to the card (`crashLine={playbookLine}`), whose status shows `{PLAN_CRASH_TITLE}`, with `crashNote(true)` as a
      foot under the rows (Box 3's suffix retired with the boxes);
    - ⭐ OutlookProjection computes the legend's depth — no typed depth multiple anywhere in its source (`0.70×` before
      Policy v2, `0.52×` since).
    - The plan of record's Run 3 rewrote the file: the label and the Outlook left (runAdvisor is on no screen), so it
      pins that no plan screen says "CB paydown" or "pay down CB", comments included, and that the card's crash line
      builds in `usePlanCardInputs` — which THIS MONTH and the Advisor tab each call once — with neither screen building
      it itself.
- **Policy v2 — Run A (the model)** (every ⭐ red under a named mutation, every file restored and md5-checked):
  - `seizeOnTheWayDown.test.ts` (new) — ONE streaming pass over the kill sweep's grids (a5 with its cash-6 twin, the
    cold rows × seeds 0 / 0.5, the double drops, face-world, synthetic both arms, reach) at the fixtures' policy and at
    C1 (`V2_DEFAULTS`); each run is checked and dropped (counters and the first five violation labels kept), and the
    switch flips run on a stride (every 4th double drop and reach cell — reach cells 0 and 4 are month-0 seizures — and
    every 16th synthetic cell). ⭐ I1 the kill criterion (non-vacuous: fired, hidden, unchanged, same-month and later
    all occur); ⭐ I2 the seizure (the price after the interest, 0.898 of the pool, debt exactly 0, nothing acted, the
    survivor); ⭐ I3 month 1 on — always on the way down, no deficiency, nothing left owing; month 0 the month-end
    reading; ⭐ I4 what the rule retires; I5 absent ≡ on, the policy-off engine ignores it; ⭐ I6 one liquidation price
    (source and values); I8 the month-end F9 (covered pools found by predicate — the old round trip recomputed from the
    breaching row, never a cell index); ⭐ I7 the resolution — equal to the run, all ten reasons reached, the answers
    pinned; `resolveSupportPolicy` has one caller.
  - `cyclingSimPolicy.test.ts` — ⭐ F4's describe (k2 0.72: saved only by the reserve's month-1 top-up; k2 0.5: seized
    with the cold inside). The tests of a mechanism the rule retires run under `MONTH_END` (`{ seizeOnTheWayDown:
    false }`), each beside one line pinning what the default does; the ones whose mechanism is still reachable moved to
    fixtures that open under 86%.
  - ⭐ I9 (`supportPolicyView.test.ts`, F5a), ⭐ I10 (`decisionView.test.ts`, F5b), ⭐ I11 (`placement.test.ts` — C1
    within 0.025 ₿, worse at least once), F5c (`ownershipFaceView.test.ts` — the price, never "at 0.0%"; a 30¢ price
    names no price), F5d (`cyclingFaceView.test.ts` — engine-backed on F4's fixture, plus synthetic).
  - The forbidden-input grep in `cyclingSim.test.ts` names `seizeOnTheWayDown` (red when planted in a component file).
  - `supportPolicyPaths.ts`: `V2_DEFAULTS` and F4's `lineFirstInputs` / `LINE_FIRST_SUPPORT`; `policyFor` stays the
    fixtures' pre-v2 policy.
  - `supportPolicyReport.test.ts` (env-gated) — the `-t "policy v2"` block: PV2-1 (liquidations month-end → rule, fired
    and where the month-end reading liquidated them, Δ yours, month-end breaches and deficiencies m ≥ 1) and PV2-2 (the
    runs each switch moves, rule on · month-end), with the kill criterion as its fidelity check.
- **Policy v2 — Run B (the faces)** (every ⭐ red first — new helpers stubbed with HEAD's behaviour, so each failed on an
  assertion — and red under a named mutation, each an exact-once edit restored from a scratchpad copy and md5-checked):
  - `seizeOnTheWayDown.test.ts` — two checks inside the existing pass (no new runs):
    - ⭐ B1, every seizure price under its month's price — non-vacuous, F11's floor and cap rows both occur. Red with
      `cbSeizurePrice` dropping `postLiquidation ||` (a month-0 seizure's liquidation row is at or above the price).
    - ⭐ B5, `firstOpenPastLltvMonth` — under the applied policy the rule's month (or null) in both readings. On the
      stride's policy-off arm it is the FIRST month rebuilt from the rows (non-vacuous: rescued, same month, later, and
      multi-open runs all occur). Red gated on `seizeOnWay`, recording the last month, and evaluated at month-end.
  - `supportPolicyView.test.ts`:
    - ⭐ `fmtBelowPct`'s table (red dropping the floor or the cap);
    - ⭐ the card's line on synthetic readings (red placing it after the Strike line);
    - ⭐ engine-backed: P1 every month, C1's double drop m13 ("less than 1%"), P6 at C1 m45 ("more than 99%"), reach
      cell 0, and a 60¢-on-2 ₿ row (R9).
  - `cbMetrics.test.ts` — R9: the dust-floor test re-pinned (50¢ on 0.5 ₿ seizes at $1.16; 60¢ on 2 ₿ → null). Red, with
    test 3 and `chartCliffUsd`'s test, dropping the price floor.
  - `cyclingFaceView.test.ts`:
    - ⭐ `chartCliffUsd` (red on the dust floor);
    - ⭐ `openPastLltvNote`'s shapes (red dropping the same-month exclusion or the applied gate);
    - ⭐ engine-backed: P1 × 0.5 from m12 is named, × 0.4 is not (liquidated that month), the 0.6 / 0.6 double drop is
      named (liquidated later), and policy on, none.
  - `ownershipFaceView.test.ts`:
    - ⭐ `liq` is `chartCliffUsd` on every row and null from the liquidation month on (the first face-world cell with a
      month-end liquidation and a deficiency, found by predicate). Red restoring the old formula.
    - ⭐ B6: a 30¢ deficiency is never printed (red dropping the guard).
  - `decisionView.test.ts` — four tests:
    - ⭐ the alert (red dropping the console clause or the validity guard, or pushing the line after the depth line);
    - ⭐ at or past the trigger (red dropping `T < price`);
    - ⭐ F11 and dust — `PLACE`'s fixtures pinned with `strikeCollateralBtc: 0.01`, so nothing moves. ⚠ A bare
      `place({ cbDebt: 0.6 })` sweeps to 1.2 ₿ and is a 58¢ cliff, not a dust case. Red on `pctInt`, on
      `m.liqPrice > 0`, and dropping R11's sliver gate;
    - ⭐ B4: `seedsFromMove` agrees with the run at a Strike liquidation LTV of 1 / 50 / 70 / 0 / 71 / 85% (red with
      HEAD's rule).
  - `decisionWiring.test.ts` — ⭐ ONE `ENGINE_CONTEXT` (red re-declaring `cbLtvCapPct` in `engineInputs`). The
    literal-'cycle' and gate checks moved to `ENGINE_CONTEXT` / `seedsFromMove`. (Since the plan of record's Run 2 these
    pins read planRun.ts too: `PLAN_ENGINE_CONTEXT`, spread by `engineInputsOf`, which declares none of the five.)
  - `supportPolicyWiring.test.ts`:
    - ⭐ each face's "Coinbase seizes" series in the Decision chart's style, and Cycling's `hasCliff` gate (R10; red
      restoring `strokeWidth={2}`, or dropping the gate);
    - ⭐ one formula: `chartOwnershipRows` names no LLTV, and both callers pass `(rows, limitStopPct)`;
    - ⭐ each face renders `openPastLltvNote(sim)`;
    - ⭐ the four deficiency prints are guarded.
  - `cyclingSimPolicy.test.ts` — the G1 golden stores no `firstOpenPastLltvMonth` (G1 compares stored keys; never
    regenerated).
  - `ownershipFaceView.test.ts`'s 14 `chartOwnershipRows` calls dropped their `CB_LLTV`; `supportPolicyView.test.ts`'s
    L375 reads the Strike line at `[2]`.
  - `supportPolicyReport.test.ts` (env-gated, `-t "policy v2"`) — PV2-3 (B5 with the policy off, per grid: flagged ·
    never / that month / later · what rescued month N) and PV2-4 (B1: rows with a cliff, at or above the price, the
    closest, under 1%, 99.5% or more). Fidelity: the field against the rows (policy off) and the rule (policy on), and no
    cliff at or above the price.
- **Engine defense fixes** (16 tests; every ⭐ mutation-checked):
  - `cyclingSim.test.ts`:
    - ⭐ **a liquidation ENDS the Coinbase loop.** The fixture is a V-path (crash → seizure at month 4 → recovery to
      $150k) with defense, sweep 30 and cadence 1. After the seizure: no `strikeToCbBtc`, `cbDebt` grows by
      interest only, and the fee count, fee total and refinanced total equal the run cut off at the seizure.
      Each gate reverted alone goes red (refinance → the month-6 re-borrow; migration → month 10);
    - ⭐ **above an 81.7% stop, no phantom yield.** A stop-84 single crash where the CB top-up runs: no
      `firstSurvivalYieldMonth`, no cut, the reserve is Strike's whole need, and the coin movement is what it
      always was. The premise is stated with the old 5-arg need. Reverting the engine call OR the leaf goes red;
    - ⭐ **unfunded bills**, 4 cases:
      - the stopped branch: $46,000 on a flat $100k (the stop holds from month 2), and $2,000 on REPRO's own
        4-yr path;
      - the drawing branch: the line runs dry under an 85% stop, $3,000 a month;
      - a default budget → 0;
      - `hold` → a gap > 0 while `cycleUnfunded` stays false.

      Every case checks Σ rows, `> 0 ⇒ btcBoughtUsd 0`, and `firstUnfundedMonth`. Zeroing each branch alone goes
      red;
    - ⚠ the A3/A5 guard-only `strikeWorse`/`futile` and the calls pins MOVED with the terminal-liquidation fix
      (see the STRIKE-side evidence bullet). Every Coinbase count is unchanged.
  - `cbDefense.test.ts`:
    - ⭐ `topUpToCbLtv` with NaN cold → `fromColdBtc` 0, no NaN anywhere;
    - `cbSurvivalCollateralBtc(…, stopLtv)`, with the existing tests unchanged:
      - (b) at or below the survival line ≡ the 5-arg value;
      - (c) ⭐ above it ≡ `topUpToCbLtv(...).requiredBtc` at that stop (the two leaves agree on "BTC to reach an
        LTV");
      - (d) NaN / ±∞ / 0 / negative ≡ the 5-arg value.

      (b) and (d) are red only under `tsc` at the old signature, since JS ignores an extra argument.
  - `emergencyModel.test.ts`, the LTV through `ltvOf`:
    - no-debt-no-collateral stays 0 / `'normal'`;
    - ⭐ zero-collateral CB debt → ∞ / `'liquidated'`.

    Reverted, the site goes red, and the `classifyStage` pins don't move (the other two sites were deleted in Run 2).
  - `ownershipFaceView.test.ts`:
    - ⭐ `cycleUnfunded` only in cycle mode;
    - ⭐ `unfundedNote`'s exact cause-neutral sentence.
- **`provisional` clears on a reading** (`provisional-clears-on-reading-spec-v1`, 16 tests; every ⭐ mutation-checked):
  - `dailyMode.test.ts`:
    - ⭐ a reading emits `provisional: false` explicitly;
    - carry-forward → true, no stocks → absent;
    - `sameRollupFields` IGNORES `provisional` (the old "differs … / provisional" case is INVERTED on purpose — never
      restore the compare).
  - `dailyModeStore.test.ts`:
    - ⭐ adding a reading clears the flag (the ReviewSheet promise);
    - ⭐ a legacy key-less entry and ⭐ a stale `true` are both inert to the reconcile;
    - self-heal un-signs the month (LD4, pinned);
    - delete → true again;
    - F1 pins Correction 1's `sameRollupFields` premise;
    - ⭐ 3b: a past-dated reading leaves current collateral at 0.6 (the mutation double-counts to 0.7) and records no
      `btcHeld`.
  - `calendarModel.test.ts`: ⭐ `readingTargetDate` (4 cases).
  - `eventSheet.test.ts`: ⭐ `readingCollateralPolicy`, `readingComplete`'s waiver, and the builder omitting (never 0).
- **Ledger cold total** (`ledger-cold-total-onboarding-date-spec-v2`, 7 tests):
  - `ledgerCold.test.ts`:
    - ⭐ logged/unlogged split;
    - ⭐ the footing invariant;
    - the visible total is unchanged;
    - the four footnote rows;
    - ⭐ one residue at all three sites (the premise is asserted first);
    - ⭐ `COLD_EPS` hides no satoshi, and `fmtColdBtc` never prints a real move — or a zero — as `0.00000`/`-0.00000`.
  - `recordedCollateralStore.test.ts`: ⭐ a backdated onboarding records collateral in TODAY's month; month 1 has no
    row.
- **Daily-month collateral correction** (`daily-month-collateral-edit-spec-v2`, 15 tests):
  - `monthlyLogForm.test.ts`:
    - ⭐ `source` preserved, never forced;
    - ⭐ only null removes;
    - byte-identical carry-through;
    - ⭐ the strict parser rejects `'0.42abc'` / `'-1'` / `'1e-3'` / sub-satoshi / > 21M;
    - ⭐ the durability truth table.
  - `recordedCollateralStore.test.ts`:
    - ⭐ a write to a SIGNED daily month lands (M2 satisfied);
    - ⭐ `stable` survives a re-roll, starting signed so the LD4 reopen is real;
    - `fragile` is overwritten;
    - ⭐ the carry-forward re-tracks (SE1);
    - a reading wins;
    - Clear record;
    - ⭐ the classifier matches real re-rolls on all 5 fixtures;
    - ⭐ the `stable` hint's second clause (delete / backfill).
- **Paydown badge** (45 tests — 33, plus 12 from paydown-badge-followup spec v2, listed in the last sub-bullet):
  - `src/simulation/__tests__/paydownPeak.test.ts` — sweeps both engines:
    - the sweep is non-vacuous (it reaches paid, partial and undefended months);
    - ⭐ peak ≥ settled, strictly greater when a paydown fires;
    - ⭐ a paydown ⇒ peak > ceiling;
    - peak > ceiling with an income budget ⇒ a paydown (deliberately NOT a biconditional);
    - ⭐ ∞ peak at zero collateral, with the `blocLtv` dependency written into the test (A3).
  - `src/simulation/__tests__/paydownState.test.ts`:
    - the four states, each via the real engine; ⭐ partial and ⭐ undefended;
    - the float boundary;
    - `paydownReadout`: ⭐ the ledger wins on a closed month, ⭐ the in-progress month keeps the plan;
    - ⭐ `deriveForMonth` paydown = `blocPaydown` with the allocation summing to income (sweep);
    - ⭐ the decoupled case.
    - (Both left with `deriveForMonth` in the plan of record's Run 3 — no screen had called it since Run 2.)
  - `src/components/Playbook/__tests__/playbookView.test.ts`:
    - badge text and tone for every state;
    - no state says "triggered";
    - ⭐ the narrative's hit clause reports the peak;
    - partial and undefended sentences;
    - the quiet sentence byte-identical.
  - **Spec v2 — `noCollateral` + the figure rule** (every ⭐ mutation-checked):
    - `paydownState.test.ts`:
      - ⭐ the guard runs FIRST (moving it below `paydown > 0` → `'defended'` → red);
      - ⭐ A2 through the engine (month 1 of a fresh install draws unbacked and pays OFF, so `displaySettledLtv` is 0;
        month 2 is `defended`);
      - ⭐ the stuck case reads ∞ (`displaySettledLtv` returning `blocLtv` → red);
      - `peak === 0` is quiet;
      - the `isLtvFigureStressed` table;
      - `displaySettledLtv` is the identity when there is collateral.
    - `paydownPeak.test.ts`: ⭐ the figure rule is equivalent to `state ∈ {partial, undefended}` on every sweep row — this
      BLOCKED the `:213` deletion until it passed.
    - The plan of record's Run 3 deleted `displaySettledLtv` and `isLtvFigureStressed` (no screen since Run 2) with their
      table, identity and figure-rule tests; A2 and the stuck case keep their engine assertions (the state, the balance,
      the engine's own 0).
    - `playbookView.test.ts`:
      - ⭐ a projected `LTV ∞ · drawn with no collateral behind it` (dropping the substitution → red);
      - ⭐ in progress keeps the LEDGER figure + `now · plan:` (substituting in progress → red);
      - ⭐ a real runBLOC zero-collateral month is `noCollateral`, and its narrative says none of "no income left",
        "back to 15%", "well below", "0.0%" or "Infinity";
      - the runAdvisor-shaped narrative names the paydown with no %;
      - "triggered" is covered for all five states.
- **Coinbase debt events** (42 tests):
  - `src/simulation/__tests__/cbDebtRollup.test.ts`:
    - `flowVenue` — ⭐ a legacy target-less draw still rolls up (flipping the default to `'cb'` goes red);
    - ⭐ a mixed month keeps a CB borrow out of `expensesActual`; ⭐ a CB-only month rolls up to `{}`;
    - `unreconciledCbFlows` (a)–(f) — ⭐ backfill-before-anchor excluded, ⭐ a Strike-only reading doesn't reconcile;
    - characterisation of pre-existing defect 1, plus its no-op control.
  - `src/store/__tests__/cbDebtEvents.test.ts`:
    - ⭐ a CB borrow THEN a Strike draw → `expensesActual` = the Strike draw; ⭐ the same for paydown;
    - ⭐ a CB-only month creates nothing, and manual/confirmed months stay so;
    - ⭐ the venue-flip edit re-rolls the OLD month (the `monthOf(before)` union);
    - characterisation of pre-existing defect 2.
  - `src/components/Daily/__tests__/cbDebtSheet.test.ts`:
    - ⭐ a Strike flow keeps its exact key set; ⭐ no loan collapses to Strike; ⭐ a CB flow is written alone;
    - the fee comes from `cbBorrowFee` across the bracket break;
    - ⭐ `rebuildEditedFlow` keeps the venue;
    - the stale-balance note and the labels.
  - `calendarModel.test.ts`:
    - the old field-by-field `streams` assertions are now one whole-object `toEqual`;
    - ⭐ mixed-venue `buildMonthRollup`.
  - `src/lib/backup/__tests__/validateCbFlows.test.ts`.
- `src/simulation/__tests__/advisorPricePath.test.ts` — Advisor price path (12). It opens with the operating-plan
  GOLDEN, captured at HEAD 07ab7a2 BEFORE the engine edit (monthly + ltvTriggered mid-year inline snapshots), and the
  equivalence no-path ≡ explicit-CAGR path (full rows). Then:
  - a path overrides the CAGR and reaches the LTV math;
  - indexing is months-elapsed (startingMonth 5);
  - degenerate entries ([], short, NaN, 0, negative, Infinity) fall through to the CAGR;
  - rising vs falling diverge (monthly strategy — ltvTriggered can tie at target);
  - ⭐ the NAMED month-1-step trap at fixed UTC dates: the sign flips with the anchor, m≥1 sits ON the curve,
    mid-2029 is not monotone, and the step lifts month-1 CB LTV;
  - ⭐ invariant 3 (the plan of record's Run 3; it replaced the grep guard that only OutlookProjection hands runAdvisor a
    pricePath): every non-test .ts/.tsx under `src/` — more than 200 files, a non-vacuity floor — is read, and only
    `runAdvisor.ts`'s own definition contains `runAdvisor(`; no screen calls the engine, which stays one release as the
    comparison engine.
- `src/components/Advisor/__tests__/outlookView.test.ts` — DELETED in the plan of record's Run 3 with `outlookView.ts` and
  the Outlook (it held 7: the subtitle Record, the signed `lineStep`, `footerCbLtv`)
- `src/simulation/__tests__/coldStorage.test.ts` — `deriveColdStorage` (8):
  - no cold events → the anchor exactly;
  - the (date, ts) boundary — the rev-1 date-only rule would lose a move logged after re-typing the total;
  - with no anchor, every move sums;
  - sign comes from the kind, and other targets are ignored;
  - the result is never NaN or negative;
  - `coldMovesSinceAnchor` agrees with the derive;
  - the strike and cb derives are unaffected by cold moves.
- `src/store/__tests__/coldStorage.test.ts` — (7):
  - the paired setter shares ONE ts;
  - re-entering the live total is lossless;
  - a cold move creates no month and keeps manual + confirmed months as they were (the BUG1 class);
  - the trusted snapshot ships the DERIVED cold total — the anchor stays in settings, `coldStorageBtcAsOf` is
    stripped, and the safe snapshot ships none;
  - a `SETTINGS_FIELDS` tripwire;
  - a grep guard that no component reads the raw `coldStorageBtc` anchor.
- `src/components/Daily/__tests__/eventSheetCold.test.ts` — (9):
  - a no-loan cold deposit stays cold and is written ALONE;
  - 'cb' still collapses to strike without a loan;
  - the three-way `COLLATERAL_TARGET_RULES` and the target-venue withdraw cap;
  - `totalHoldingsAfter` — the transfer double-count is a decision, shown before save;
  - the cold log labels.
- `src/simulation/__tests__/cyclePath.test.ts` — the 4-yr cycle path (23): `CYCLE_LOW_MULT` derived; trough ≡
  support compared as PRICES (relative, 1e-12); exact multiples at every turn (pins exactness, not the exact-hit
  shortcut — the interpolation is exact there without it); monotone between turns; the ms phase shift
  translates all 14 turns × 25 shifts exactly (incl. 2034-07-31); clamps + never NaN; the plConvergencePath
  mirror; `cycleTurnsInHorizon` (rows 1/36/48 on the 2026-09-12 default; ties → later pinned by a 2026-08-20
  start, since the 09-20 tie lands on row 1 via the snap either way; row-0 snap; no row 0 over two years of
  starts); the drawdown gap (Support `=== 0`, cycle ≈ −52%); and an engine run on a synthetic position that
  liquidates inside the 2029→30 descent while the same position on Support never does
- `src/components/Almanac/__tests__/resetMirror.test.ts` — grep-style guard: each face's lens-reset dep array ⊇
  its `engineInputs` deps minus `startDate` (16 — four faces, Cycling, Ownership, Unified and Decision, four each). Proven red on
  `coldBufferPct` before that fix, and again on `strikeCapPct` across all three faces before this one. Since the plan of
  record's Run 2 its regexes accept the Decision face's builder call (`engineInputsOf({ … })`) as well as the parents'
  object literal, and the cold check accepts the face's fact `coldBtc: s.openingColdBtc` (the seeding ternary moved into
  `engineInputsOf`, pinned by decisionWiring)
- `src/lib/crypto/__tests__/cryptoClient.test.ts` — Phase 2a crypto worker. In node `typeof Worker === 'undefined'`, so every op takes the SYNCHRONOUS in-thread FALLBACK (byte-identical to pre-2a). Fallback round-trip encrypt→decrypt at `logn:1` returns the original sk; wrong passphrase → `CryptoError` `kind:'passphrase'`; malformed input → `kind:'malformed'`; **caller-buffer safety** (after `nip49Encrypt(sk,…)` the caller's `sk` is NOT zeroed — the internal-copy contract); pure helpers `encode{Encrypt,Decrypt}Request` (op/field names + transfer list) and `classifyWorkerFailure` (known kinds passthrough, unknown → `'generic'`). The worker itself (real Worker + WebKit) is device-gated, not unit-tested
- `src/lib/nostr/__tests__/disconnect.test.ts` — R2c-6b, the three teardowns as a contrast set (6 cases; `escapeHatch.test.ts`'s `window.location.reload` + localStorage shims, installed before the store import). Seeds a VERIFIED local owner, then: **`signOutLocal`** retains the identity (`nostrPubkey`/`nostrSigningMethod`/`nostrAuthEnabled` → lands on `LocalUnlockGate`, not the login screen), retains `writerKeyWrapped`/`writerKeyWrapMeta` (something is left to unlock), ⭐ **retains `keyProvenance` + `backupVerifiedAt`** (a verified key stays verified across sign-out — no backup ladder, no nag), and clears only `nostrSigner`/`isAuthenticated`/`nostrLogin` + reloads once. **`reconnectNostr`** shows the SAME retention (proving `signOutLocal` added its flag without altering the shared teardown NIP-46 depends on). **`disconnectNostr`** CLEARS pubkey/method/`keyProvenance`/`backupVerifiedAt` — the contrast that gives "Sign out" and "Remove local key" their different weights; if a future edit collapses the two teardowns, this fails. **`signOut(method)` dispatch** — the three teardowns are same-module siblings (un-spyable from `signOut`), so each arm is pinned by its unique store fingerprint, with `nostrAuthEnabled` seeded FALSE as the discriminator (only `signOutLocal` sets it): `'local'` → auth true + pubkey/key/provenance retained; `'nip46'` → pubkey + provenance retained, auth still false, `nostrLogin` cleared; ⭐ `'nip07'` → pubkey/method/provenance/`backupVerifiedAt` all **null**, i.e. **NOT `reconnectNostr`** (whose retained pubkey would let `useNostrAutoRestore` silently re-authenticate through the extension — the regression this test names); `null` → no-op, no `reload()`. Plus `signOutConfirmMessage` copy-truth: a PIN key is never promised a biometric, and the nip07 string makes no identity-retention claim. **R2c-6b remanence contrast** (seeds `personal-bloc-store` + `personal-bloc-onboarded` + `bloc-device-tag` on the shim): ⭐ `disconnectNostr` WIPES the blob AND the onboarded flag (the latter is what shows the fresh entry fork — blob-only would be a half-fix) while retaining the device tag; `signOut('nip07')` wipes too (it IS disconnectNostr); `signOutLocal` + `reconnectNostr` RETAIN both — the pin that fails if anyone unifies the teardowns. All three wipe assertions go red with the `wipeLocalPlanData()` call removed (verified). Plus `identityForgetConfirmMessage`: both normal branches name the local-data removal + the unsynced-changes loss; ⭐ the `neverSynced` branch NEVER says "stays on the relay" (a generated + unverified key has no relay copy) and names the action it warns about
- `src/lib/store/__tests__/wipeLocalPlanData.test.ts` — R2c-6b, **the key inventory as an executable contract** (in-memory `localStorage` + `sessionStorage` shims, installed before the import): `it.each` over the 9 plan-scoped localStorage keys + the 1 sessionStorage key (all removed) and the 1 device-level key (retained); `leaves nothing behind but the device tag` (a whole-map equality — a NEW app storage key that nobody classified fails HERE); ⭐ `removes personal-bloc-onboarded, not just the blob` (the half-fix pin); idempotent + never throws on an already-clean device
- `src/lib/__tests__/bufferAliasing.test.ts` — R2c-7b, the executable form of the R2c-7a **`.slice()` Critical Constraints row** (3 cases, pure, no React). Reconstructs the hazard: a `Uint8Array` in a struct (React state) + a consumer that PERSISTS its argument then zeros it in a `finally` before throwing (`establishLocalOwner`'s real ordering — wrap+persist BEFORE deriving the pubkey). **ALIASED** → the throw zeros `state.sk` in place, and the retry persists 32 ZERO bytes (a corrupted credential for an identity that never existed). **COPIED** → `.slice()` sacrifices the copy, `state.sk` survives, the retry persists the real key. Plus `.slice()` is a copy not a view. ⚠ It does NOT exercise NostrAuthGate's retry (no render harness — house rule); it makes "copy a buffer you're about to zero" fail loudly if a refactor deletes the copy as redundant
- `src/lib/backup/__tests__/recoveryFile.test.ts` — R2c-7b pure file builder (10 cases): plaintext-words body, plaintext-nsec body, encrypted-ncryptsec body (`(ENCRYPTED)` + names the passphrase, and does NOT say "never share it" — a different mitigation); a `PERSONAL BLOC RECOVERY KEY` header precedes a blank line + the artifact for ALL THREE kinds (the header is the honest mitigation for a plaintext artifact — never droppable by kind); exactly one trailing newline; filenames per kind (plaintext → `DO-NOT-SHARE`, encrypted → `-encrypted` and NOT `DO-NOT-SHARE`, `qr` → `.png` keeping the marker)
- `src/lib/nostr/__tests__/ncryptsec.test.ts` — R2c-7a-fix, the two layers that let the Recovery-key tab tell a malformed payload from a wrong passphrase (15 cases, real `nip49` output, `logn:1` so scrypt stays fast). **Layer 1 `isWellFormedNcryptsec`:** a real encrypt output → true; **a full handoff token (`ncryptsec + ':' + npub`) → false** (the exact input R2c-7a misreported as "Wrong passphrase" — it still prefix-matches as `encrypted`, so only the shape gate catches it); truncated / bare nsec / trailing newline / uppercase / garbage → false; **a 1-char typo PASSES** (documented hole — length + charset intact → Layer 2 owns it); `NCRYPTSEC_LENGTH === 162` pinned across `logn` 1/8/16 (a silent length change would disable the gate; `logn:20` is omitted — 2²⁰ scrypt rounds blow the 5s timeout for zero extra coverage, and `logn` is one payload byte so it cannot affect length). **Layer 2 `classifyNcryptsecError`:** `decrypt(valid, wrongPass)` → `'passphrase'`; broken checksum / wrong prefix / full token → `'malformed'`; a non-Error throw → `'malformed'` (safe default); discriminates on `'invalid tag'` specifically
- `src/store/__tests__/backupNagDismissed.test.ts` — R2c-2 session-transient dismissal (mirrors `remotePlanFound.test.ts`): default `false`; absent from `buildSettingsPayload`; **EXCLUDED from `partializeState`** (persisting it would keep the nag dismissed across launches, defeating the ladder); `dismissBackupNag()` sets true. NO module latch (single writer)
- `src/lib/__tests__/backupGate.test.ts` — R2a-1 pure predicate (6 cases): `'generated'`+null → false; `'generated'`+ts → true; `'imported'`/`'external'`/`null` → true (the last IS the legacy grandfathering); `backupVerifiedAt: 0` → true (the check is `!= null`, not truthiness)
- `src/store/__tests__/backupGate.test.ts` — R2a-1 store plumbing (24 cases since 4e): field posture (both default null; `backupVerifiedAt` IN `buildSettingsPayload`, `keyProvenance` NOT; both ride `partializeState`); `setKeyProvenance` write-once (a different non-null → ignored + warns "already set"; the SAME value → silent no-op — an establish retry must not warn; `null` clears, then a new provenance sticks; **R2c-6-final: writes through to standalone `personal-bloc-provenance` [stamp writes, `null` clears], and an ignored write-once conflict never touches it**); **bypass 1 — `gateHydratedIdentity` prefers the standalone provenance over the blob (⭐ escape-hatch survival: blob has NO `keyProvenance`, standalone `'generated'` → `keyProvenance:'generated'` → `isBackupGateSatisfied` FALSE, still gated; standalone wins even when the blob disagrees). Both go red if the `gateProvenance ??` line is removed (verified);** `setBackupVerifiedAt` (an authed stamp sets the field, emits a plan event and marks `planDirty`; a PRE-AUTH stamp — onboarding's quiz-pass, before K3 — sets the field only, nothing dirty, no event; the `null` teardown clear marks nothing dirty and emits nothing); 4e — the latch on the apply paths that remain (neither `hydratePrefs` nor `applyViewerSettings` can write it — not a null, not a stamp — while a sibling field still lands; a peer's real stamp arrives through the fold, `applyPlanFold`); gate integration (**the interim K2 bridge stamp pair → satisfied** — this fails loudly at R2c if the bridge line is removed without a ceremony replacing it; generated-unverified → gated; both-null legacy → satisfied; `gateHydratedIdentity` nulls both on the signed-out branch while non-identity data passes through, and leaves both alone when signed in); publish guards (4e: `publishPlanEventsNow` bails at the gate BEFORE `setNostrSyncing`, `planDirty` held for the ceremony; `publishPrefsNow` likewise). ⚠ Assert warn CONTENT, not call count — zustand's persist middleware warns on every `set` under node ("storage is currently unavailable")
- `src/simulation/__tests__/gestureModel.test.ts` — Gesture & Motion System pure state machine (35 cases, node/no-DOM): slop (sub-slop stays tracking; tap→cancelled); **R2c-3 capture-on-arm contract** (DraggableSheet's y/8/24 config: tap down→up → cancelled [never armed → usePointerDrag never captures → native click survives]; 20px<24 → axisLocked; 30px≥24 → armed = the capture frame); axis-lock (x dominates → axisLocked; ratio < 1.4 → cancelled; wrong dominant axis → cancelled); **P1 arm-on-lock** (single move past slop+armThreshold → armed; single-move flick commits via velocity); arm/disarm both directions; commit-by-distance + commit-by-velocity (real timestamps) + release-below-both → cancelled; velocity 3-sample window math + 0-guards (<2 samples, Δt=0) + window bounded at 3; primaryDelta per axis; rubberBand f(0)=0/monotonic/asymptote<max/sign-preserving; terminal identity from committed & cancelled; cancel from every non-terminal phase. **P1.3 resolveScrollClaim** (7 cases): claim at scrollTop 0+down, no claim scrolled, no claim up-at-top, stays claimed once claimed even if scrollTop later >0, two-way release at dyClaim≤0, re-claim after release, + the claim-BASELINE case (claim after 180px travel → release at 20px back up from the claim point, dyClaim=−20, NOT 180 from touchstart). (DraggableSheet + usePointerDrag/haptics/useReducedMotion DOM behavior defers to the device gate.)
- `dailyMode.test.ts` (Strategy-Month Calendar Fix block) — calendar-anniversary `bucketEventToMonth` (Jun-1 start: Jun 30=M1, **Jul 1=M2**, Aug 1=M3; Jan-31 start short-month clamp Feb 28=M2; `strategyMonthIndex` unclamped <1 pre-start / =13 at start+12mo = the completion signal) + `strikeCollateralDelta` (strike ±, ignores cb/non-collateral, honors the bucket fn — calendar vs `legacyBucketEventToMonth` place a boundary deposit in different months) + `sameRollupFields` (0≡absent; undefined-entry↔empty-fresh; differ on amount/stock/provisional). `dailyModeStore.test.ts` reconcile block: a boundary event M1→M2 empties the stale M1 daily entry + creates M2, second run idempotent, flag set; **Correction 1** — a boundary strike deposit re-rolls BOTH neighbors even when every `sameRollupFields` key matches (the collateral-delta comparison caught it); `monthBucketReconcileDone` default-false / rides partialize / absent from `buildSettingsPayload`. `collateral.test.ts` fixture re-expressed in calendar terms (`startMonthsBack(4)` → deterministic Month 5).
- `src/simulation/__tests__/readingAnchors.test.ts` — §5b Readings-Unification pure `deriveReadingAnchors`: guard (date ≥ asOf; null asOf always applies; idempotent already-anchored → empty patch), select-by-DATE-not-ts (edited older reading with a newer ts does NOT win), delete/date-move fallback (date+value proxy re-points to the survivor; no survivor → unchanged; KNOB-SET IMMUNITY — unrelated same-day delete whose value ≠ the knob-set anchor doesn't clobber), cbLiqPrice omit/present, Strike-only reading leaves CB anchors alone. (`dailyModeStore.test.ts` §5b block: add re-anchors advisorActualBlocBalance/cbLoanBalance/cbLiquidationPrice + asOf=today; `setDayLog` merge folds cbCollateralBtc but NOT the balance anchors; delete-fallback; `advisorActualBlocBalanceAsOf` synced/default-null/stamped. `eventSheet.test.ts`: `reading.cbLiqPrice` omitted when blank/0, present when entered, never on a collateral move.)
- `src/lib/nostr/__tests__/establishOwner.test.ts` — Phase 1.5 `establishLocalOwner` (5 cases, mocked wrapSecretKey/syncNow/NSecSigner; nip06Key NOT mocked → real derivation): PIN path persists the wrapped pair + sets nostrPubkey(from sk)/nostrSigningMethod='local'/isAuthenticated=true IN ORDER (invocationCallOrder pubkey<method<auth) + calls syncNow/markSignerFresh + zeros the payload, wrap 5th arg 'sk'; PRF path forwards the passkey label (not a pin), 5th arg 'sk'; **R2b-1 entropy path** — `generatePlanKey()` entropy wrapped with 5th arg 'nip06-entropy' + **nostrPubkey === getPublicKey(sk) DERIVED INTERNALLY (never passed in)** + the entropy buffer zeroed; **R2c-4b words-import** — `entropyFromWords(VECTOR_WORDS)` wrapped as 'nip06-entropy' and **nostrPubkey === getPublicKey(skFromWords(VECTOR_WORDS))** (⚠ wrapping entropy instead of the sk did NOT change who we signed in as) + buffer zeroed; **the asymmetry** — an nsec import (no `payloadKind`) still wraps 'sk'
- `src/lib/backup/__tests__/exportPlan.test.ts` — Plan Export/Backup Tool: `buildPlanBackup` excludes viewerNpub/viewerPubkey/viewerLabel/nostrRelays (sharing/transport config) while including real plan settings (income/creditLine/cbLtvTriggerPct); includes the full records set (monthlyLog/deletedMonths/dayLog/deletedDayEvents); the wrapper has format/schemaVersion/storeVersion/exportedAt/plan; device-local/session fields (devMode/viewerMode/planDirty/initialSettingsPullDone/nostrPubkey) stay naturally absent
- `src/store/__tests__/settingsClobber.test.ts` — Fresh-install seed-clobber — the pull gate (4e: the successor to Fix C/D, both retired with the bridge, and to Fix B, retired with the settings branch): with `!initialSettingsPullDone` both `publishPlanEventsNow` and `publishPrefsNow` refuse at the gate, before `setNostrSyncing`, and the edit waits (`planDirty` stays true); after the pull the plan publish passes the gate (publishing not broken)
- `src/simulation/__tests__/safetyView.test.ts` — Viewer Revamp V1 `deriveSafetyView`/`deriveViewerOverall` (19 cases): credit bands at the new 0.75/0.90 edges + creditLine-0 guard; Strike LTV bands (0.646/0.697 at 85% liq) + crashLtv (20%-of-price) + zero-collateral guard; CB LTV gating (!hasCbLoan → cbLtv 0/safe even with cb inputs) + bands + cbCollateral-0 guard; overall = worst of gauges SHOWN, credit INCLUDED, cb folded only when hasCbLoan. The plan of record's Run 4 (D7): the selector test also maps the plan's Coinbase limit at support (`cbLimitAtSupport`, through its clamp); the at-support reading's own tests are `safetyAtSupport.test.ts` (ATS, VERDICT, VIEWER)
- `smartBloc.test.ts` — uses `runBLOC` (not `runBlocYearOne`)
- `simpleModePlan.test.ts` — `minPaymentStatus` (§2b: roll → ROLLS; income PAID / DUE / MISSED) and runAdvisor's own behaviour (the comparison engine, kept one release): **Simple Mode Corrections:** income source ends month 12 with a LOWER BLOC balance than roll (+ roll === omitted-input default); shortfall path (min > income → pay income, capitalize the rest); **mis-ordered thresholds guard** (target ≥ trigger → cbPaydownDraw/cbLtvTriggered suppressed, draw/interest still run); a monthly CB payment lowers the row's LTV below the start-of-month figure and is reserved from income once. The plan of record's Run 3 deleted `deriveForMonth`, `isOperatingMonth` and `composeMonthSummary` (no screen since Run 2) with their tests
- `src/store/__tests__/strikeMinPayment.test.ts` — Simple Mode Corrections A synced settings: `blocMinPaymentSource`/`blocStatementMinimum` default roll/null, appear in `buildSettingsPayload`, a folded plan event applies both (cross-device — 4e: the plan channel), and a fold lacking them doesn't clobber (absent = not set, §6)
- `src/components/Daily/__tests__/dailyView.test.ts` — Daily Mode P4a pure helpers: `selectMonthEvents` (bucketEventToMonth filter, asc-by-ts sort, empty-month) + `describeDayEvent` per kind (draw/paydown USD — to the cent since the plan of record's Run 2.1, as are a buy's dollars, a minimum and a reading's balances; buy BTC ±usd; deposit/withdraw target labels; cbCollateralReading BTC; balanceReading Strike-always + CB-when-present)
- `src/components/Daily/__tests__/calendarModel.test.ts` — Daily Mode P4c-1a pure calendar model (15 cases): `monthDateRange` (every date buckets back to its strategy month via bucketEventToMonth — load-bearing; contiguous+ascending; month 1 starts at advisorStartDate; boundary last-of-N/first-of-N+1 adjacency), `weekDates` (7 dates Mon→Sun, Monday-first incl. Sunday-input), `buildDayCells` (draw→[logged]; balanceReading→[reading]; both→both; cb-deposit→[logged,cbCollateral]; strike-deposit→[logged]; empty→[]; weekday Mon=0..Sun=6), timezone no-drift (exact yyyy-mm-dd near a month boundary)
- `src/components/Daily/__tests__/eventSheet.test.ts` — Daily Mode P4b-1 pure helpers (import `../eventSheetModel`): `readingComplete` gate matrix (Strike-only when !hasCbLoan; +CB fields iff hasCbLoan) + `buildEventsFromSheet` per type (setBalance→[reading]; draw/paydown→[flow,reading] USD; buy→[buy usd=amount*price (untyped dollars → the guess),reading] BTC; collateral→[deposit target,reading], target strike+cb, defaults strike when !hasCbLoan), reading carries price, **LTV percent ÷100 → fraction (11.2→0.112)**, CB reading fields present iff hasCbLoan, flow+reading share ts with distinct ids. **v20 (C-P3):** `readingComplete` false when strikeCollateral null; reading carries strikeCollateral from `s.strikeCollateral` (falls back to the `currentStrikeCollateral` arg); manual override wins; `autoStrikeCollateral` post-move total (deposit+/withdraw−/pledged-buy+/else current); pledge ON → [buy,deposit target:'strike' amount=buy,reading] shared date+ts distinct ids, pledge OFF → [buy,reading]. **5d:** ⭐ DOLLARS typed · guess · cents · pledge · edit kept · old figure · implied
- `src/store/__tests__/planBars.test.ts` — `showPlan*Bar` default true, setters, device-local (neither `hydratePrefs` nor `applyViewerSettings` can write them — absent from SETTINGS_FIELDS)
- `src/store/__tests__/relaySync.test.ts` — Option C: `buildSettingsPayload` INCLUDES `nostrRelays` + `buildViewerSnapshotPayload` settings STRIPS it; 4e — the `hydrateSettings` relay guard retired: a folded `nostrRelays` event replaces the local list (add + remove propagate) and ⭐ a folded `DEFAULT_RELAYS` replaces a custom one (RELAYS defaults); a fold without the field leaves the list alone while a sibling lands; + the publish-trigger follow-on (`setNostrRelaysAndSync` sets the list AND marks `planDirty` — a plan event; plain `setNostrRelays` sets it RAW — fake timers swallow the debounce)
- `src/store/__tests__/viewerPublishGate.test.ts` — `publishRecordsNow` viewerMode backstop: with full publish creds + `viewerMode:true` → returns false at the gate (`setNostrSyncing` never called); with `viewerMode:false` → passes the gate (`setNostrSyncing(true)` called) and only then fails at the stub-signer publish step (owner baseline unchanged); the plan-events and prefs publishes are blocked for a read-only viewer too (4e — they replaced the settings publish)
- `cbMetrics.test.ts` — `cbMetrics` (ltv/liqPrice/triggerPrice/pctTo* + divide-by-zero guards), `accruedCbBalance` (null/0-day/30-day compounding), `activeLiqPrice` entered-vs-computed authority + cushion divergence, `barLevel`/`worseLevel` state selection, Strike 85% gauge, refactor-safety (cbMetrics == old inline Main/Sidebar formulas)
- `emergencyModel.test.ts` — the Emergency Console's retained model (crash playbook Run 2): `classifyStage` (the liquidation price, the ladder band prices, a positive distance), the two last-resort walls (`wall3Sale` / `wall4External` round-trip to a target liquidation price), `CB_LADDER` pinned, and the LTV through `ltvOf` (⭐ no debt and no collateral stays 0 / normal; ⭐ zero-collateral Coinbase debt is ∞ / liquidated). Deleted in Run 2 with their tests: `firepower`, `drawToLtv`, `floorTable`, `direSwitch`, `surplus`
- `src/simulation/__tests__/cycleModel.test.ts` — Almanac CycleClock P1 (12 cases): `epochFromHeight` epoch-5 classification + 2028 rollover (Epoch 6/1.5625, no code change); `epochProgress.fraction` 0..1 single-source (half-open — ~1 just below endBlock, 0 at rollover) + `blocksRemaining === 1_050_000 − h` exactness; `dateAtBlock` 144-blocks≈1-day; `blockAtDate(H4.date)===H4.block`; `CYCLE_TURNS` IMG_7080 premise (14 turns, anchor high @ 6 Oct 2025, first low Mon 5 Oct 2026 @ +364d, every turn `getUTCDay()===1`, strictly increasing, strict high/low alternation); `nextTurnAfter` selection + null past end
- `living.test.ts`
- `mining.test.ts`
- `monthlyLog.test.ts` — deriveAdvisorStart/deriveCurrentPosition/upsertEntry + the persistConfig v20 backfill replica + 4 badge status tests (the recomputeBtcHeld chain tests were DELETED with the function — spec v3) + `computeExpenseReanchor` (spec §9; the plan of record's Run 4 added ⭐ F-R4-1 ×2 — the month in progress and a month that records no expenses stay out of the average)
- **Recorded Strike collateral (spec v3)** — `src/simulation/__tests__/recordedCollateral.test.ts` (pure): ⭐ each month records its OWN reading's `strikeCollateral`; ⭐ a reading without it leaves `btcHeld` ABSENT and the reroll bridge keeps the stored value (mutation `?? 0` → red); zero records 0 (truthiness mutation → red); carry-forward + provisional; ⭐ a cold-destined buy doesn't move `btcHeld`; grep guard `recomputeBtcHeld` absent from `src/` (non-vacuous walker); onboarding source-order guard (`emitBalanceReading` after `setAdvisorStartDate`, baseline write kept). `src/store/__tests__/recordedCollateralStore.test.ts` (real store): cold-destined buy; ⭐ B1 a Strike-only re-anchor records NOTHING, not 0; §9 onboarding anchor; ⭐ B2 a joining device's reconcile reopens no confirmed month (mutation: `btcHeld` in `ROLLUP_NUM_KEYS` → red); ⭐ A4 a `btcHeld`-less entry end to end (CSV → buildPlanBackup → validatePlanBackup → applyPlanBackup; mutation: `btcHeld` back in the validator's required list → red) + the validator both ways. `src/lib/__tests__/ledgerCold.test.ts` (`coldMovedByMonth`, `hasColdColumn`, the CSV column + empty Strike col). `src/components/Advisor/__tests__/monthlyLogForm.test.ts` (`strikeColFragment`: blank → omitted, "0" → 0). `viewerSync.test.ts` S4 + `sync.test.ts`: entries apply VERBATIM (recompute mutation → red). `dailyModeStore.test.ts`: a reading without `strikeCollateral` / a buy records no `btcHeld`
- `dailyMode.test.ts` — Daily Mode P1: `bucketEventToMonth` (date→month 1–12, clamp) + `rollupMonth` (flows draw/buy±usd/paydown; `target:'strike'` deposit/withdraw signed into `collateralDelta`, `target:'cb'` + `cbCollateralReading` journal-only/ignored; latest-`balanceReading`-by-ts stocks, `cbCollateral` never in entry; carry-forward `provisional` w/ priorStocks; empty→`{}`; entry never has collateralAdjustment/btcHeld/cbCollateral/source/confirmed; date-boundary isolation). P2a: `deriveCbCollateral` (latest cbCollateral-bearing event by ts across both kinds; cache fallback; ignores readings w/o cbCollateral)
- `src/store/__tests__/dailyModeStore.test.ts` — Daily Mode P2a store: add(draw+balanceReading)→entry flows+stocks/source:daily/btcHeld intact; buy→btcHeld; **C1 double-count** (two strike deposits + edit-one + delete-one each net once via getCurrentBtcHeld); target:cb journal-only (no collateral change; cb-only month creates NO entry / doesn't flip a manual month to daily; mixed cb+draw month is daily via the draw) + cbCollateral feeds the clock; **BUG1** (cbCollateralReading creates no monthlyLog entry); Partial→Full preserves miningSats/ndpPaid/loggedAt; **C2** (setCbCollateralBtc emits a cbCollateralReading, absent from buildSettingsPayload); **M2** guard (non-daily upsert vs a daily month blocked); confirmMonth + reopen-on-edit; date-change re-rolls both months; `migrateState` v19 backfill (source/confirmed, cbCollateralReading seed for hasCbLoan, cbLtvAction default, cbCollateralBtc reproduced); `partializeState` includes dayLog+cbLtvAction. **P3:** `deleteDayEvent` writes a numeric `deletedDayEvents[id]` + removes the event; a journal-only `addDayEvent(cbCollateralReading)` sets `recordsDirty` + leaves `monthlyLog` empty (publish trigger for the no-month path); raw `setDayLog([cbColl@ts1, cbColl@ts2])` derives `cbCollateralBtc` to the newest (the fold) WITHOUT rerolling monthlyLog; `setDeletedDayEvents` raw-set; `partializeState` includes `deletedDayEvents`
- `src/store/__tests__/collateral.test.ts` — **v20 reading-anchored Strike collateral** on the REAL store: a `balanceReading.strikeCollateral` anchors `getCurrentBtcHeld`; a post-anchor `deposit target:'strike'` adds once; **SEMANTIC SHIFT** — a bare deposit with no reading does NOT move current; `target:'cb'` never touches Strike; latest reading re-anchors; Strike LTV tracks `getCurrentBtcHeld` (not the frozen baseline); baseline stability (`advisorActualBtcHeld` never moves); `setDayLog` folds the strike derive; sandbox isolation; delete keeps the surviving months' RECORDED `btcHeld` verbatim + tombstone; ⭐ upsert never rewrites another month's `btcHeld` (spec v3). `src/simulation/__tests__/strikeCollateral.test.ts` — pure `deriveStrikeCollateral` (anchor by date/ts, post-anchor sum, atomic same-ts flow+reading NOT double-counted, backfill excluded, buys/cb ignored, withdraw sign, no-anchor→fallback)
- `src/store/__tests__/clearViewerData.test.ts` — `clearViewerData()` resets viewer-hydrated fields (monthlyLog→[], deletedMonths→{}, strike*→null, financial SETTINGS_FIELDS→seeds, viewerDataLoaded→false) — the data-remanence fix. Since the plan of record's Run 2 it also resets `viewerStrikeDepositISO` → null (pinned by `planRunStore.test.ts`'s DEVICE)
- `src/lib/store/__tests__/storeCrypto.test.ts` — Phase B encrypted persist adapter (PIN path, in-memory localStorage shim): setItem writes a {ct,iv} envelope (NOT plaintext) + getItem decrypts it; LOCKED (no key) → getItem null + setItem writes NOTHING; plaintext (non-envelope) passthrough; wrong key → getItem null (no throw)
- `src/lib/store/__tests__/storeMigration.test.ts` — Phase C migration (PIN path, localStorage shim, `decryptBlob` vi.mock for the fault path): plaintext→encrypted round-trips to the EXACT original + idempotent; **VERIFY-BEFORE-DELETE — a forced verify mismatch returns false AND the plaintext SURVIVES** (the critical encryption-arc test); no-key → false untouched; encrypted→plaintext restores exactly; decrypt failure → false, envelope intact
- `src/store/__tests__/writerKeyStandalone.test.ts` — the wrap credential is standalone-backed: `setWriterKeyWrapped`/`setWriterKeyWrapMeta` write through to `personal-bloc-writer-key-wrapped`/`-meta` (NOT the persist blob); setting null clears them
- `src/lib/store/__tests__/escapeHatch.test.ts` — escape hatch: `resetPlanToSeeds` (plan/records/strike → seeds; writer credential + nostr identity/relays PRESERVED; 5c: the case marks its signed-in store loaded first — a store without the plan refuses the setters, and the case then proved nothing about income, expenses, credit line and cold; MC64); `resetAndResync` is now RELOAD-BASED — clears all four (enc flag + pending-decrypt marker + on-disk `personal-bloc-store` blob + in-memory key via `clearStoreEncryptionState`) then `window.location.reload()` (node `window`/`localStorage` shims; `reloadMock`); idempotent (no flag/blob/key → still reloads, no throw); + **THE STRUCTURAL GUARANTEE — the module references NO publish symbol** (source-read assertion — a push is impossible by construction, relay data can never be erased; 4e widened the regex to `/\bpublish\w*\(|syncEngine|schedule\w*Publish/`, so the plan and prefs publishers are covered too — F8)
- `mergeRecords.test.ts` — per-month entries merge table: union, newest-wins, loggedAt fallback, tie rule, tombstones, 90-day GC, string-key coercion. P3 dayLog block: union-by-id, higher-ts-wins (edit in place), exact-ts tie→local, tombstone-newer→suppressed, edit-after-delete→survives + stale tombstone dropped, >90d GC, idempotent
- `aprAnchors.test.ts` — pins APR unit conventions (runCoinbaseLoan=percentage, runBlocYearOne=decimal)
- `strikeCredit.test.ts` — strikeAvailableCredit = min(line, collateral×50%) − drawn; computeStrikeLtv (value + zero-collateral/price guards)
- `src/hooks/__tests__/useBtcHistory.test.ts` — pure `parseCandles` (newest-first → asc, close index 4, s→ms, slice newest `count`, empty/malformed guards) + `RANGE_CFG` (1H/1D/1W granularity/count ≤300)
- `src/lib/nostr/__tests__/keyVault.test.ts` — PIN-path wrap→unwrap round-trip (PBKDF2→HKDF→AES-GCM), wrong-PIN rejects, malformed-meta throws, PIN-required guards, fresh salt/iv per wrap (the PRF/Face-ID path needs WebAuthn — verified on-device, not jsdom); + Phase-A store-key suite: deriveStoreKey round-trips encryptBlob/decryptBlob, is independent of the nsec-wrap key (same pin+salt, different HKDF info → can't cross-decrypt) while the wrap path still unwraps, wrong-pin blob rejects, random IV per encrypt; + 3a.1 `deriveStoreKeyFromNsec` suite: deterministic (same nsec+pubkey round-trips), nsec-dependent + pubkey-salted (cross-decrypt throws), independent from the nsec-wrap key (can't decrypt the wrap ciphertext), and does not mutate the caller sk; + R2a-2 `payloadKind` suite: wrapping entropy records the kind and `unwrapSecretKey` returns a **32-byte** sk (not the 16-byte payload — that length assertion is what proves derivation rather than passthrough) whose pubkey matches `deriveSkFromEntropy`; a new `'sk'` wrap records `payloadKind:'sk'`; **LEGACY** — meta with the field stripped AND JSON round-tripped (exactly how `WK_META_KEY` persists it) unwraps byte-identically as `'sk'`; `unwrapRecoveryPayload` returns the payload AS STORED (entropy stays 16 bytes, it must NOT derive) and reports `'sk'` for absent; a made-up FUTURE `payloadKind` falls through the legacy path rather than becoming unreadable; the malformed-meta + PIN-required guards still fire through the new reader
- `src/lib/nostr/__tests__/nip06Key.test.ts` — R2a-2 NIP-06 derivation (24 cases, node/real WebCrypto). **The published-vector case PINS the derivation path** (`m/44'/1237'/0'/0/0`, account 0, no passphrase): `leader monkey parrot ring guide accident before fence cannon height naive bean` → sk `7f7ff03d…ba9a` / pubkey `17162c…cd917` / `nsec10allq0…`, plus an independent cross-check that the spec's own npub decodes to the same pubkey. ⚠ **A failure here is DATA LOSS, not a stale fixture.** Also: 16 bytes → 12 words; `skFromWords ∘ wordsFromEntropy === deriveSkFromEntropy` (round-trip); deterministic + distinct-per-entropy; entropy not mutated; `generatePlanKey` self-consistency (both derivation routes reach the same sk, pubkey matches) + fresh entropy per call; `InvalidSeedWordsError` on bad checksum (`'abandon'×12` — ⚠ the canonical `abandon×11 + about` IS valid, so it can't be used here), on a non-English word (`ábaco`), and on empty/whitespace; the error message never leaks the words; `skFromWords` normalizes a hand-typed phrase (padded/doubled spaces, newlines, mixed case). **R2c-4b `entropyFromWords` suite:** `entropyFromWords ∘ wordsFromEntropy === identity` (round-trip); returns 16 bytes; ⚠ **`deriveSkFromEntropy(entropyFromWords(w)) === skFromWords(w)` on the published vector — IDENTITY PRESERVATION, the property the words-import flip rests on** (a failure means every words-import silently authenticates as a different key); normalizes exactly as `skFromWords`; `InvalidSeedWordsError` on bad checksum / non-English / empty; **the error never contains a seed word** (pins the validate-first + rethrow guard against @scure/base's `Unknown letter: "<word>"`)
- `src/lib/nostr/__tests__/ownerGate.test.ts` — `isOwnerPubkey`: matches the owner, rejects a non-owner/null key when configured, unset/empty env → true (no lockout)
- `src/lib/nostr/__tests__/proxyAuth.test.ts` — `getProxyAuthHeader` token cache: caches within ~50s (signs once), re-signs after expiry / on url change / on method change, returns the `"Nostr "` scheme prefix (mock signer, stubbed `Date.now`, `resetProxyAuthCache` per case)
- `src/lib/nostr/__tests__/relays.test.ts` — `normalizeRelayUrl` (passthrough/trailing-slash/lowercase/prepend-wss/reject-http/reject-garbage/localhost-ws/reject-nonlocalhost-ws), `addRelay` (append/dup/invalid), `DEFAULT_RELAYS` shape; + P2 `importNip65RelayList` (mocked pool: found→all-r-tags flat + normalize/dedupe, newest-event-wins, no-event→{found:false}, throw→{found:false}, no-usable-r-tags→{found:true,relays:[]})
- `src/lib/nostr/__tests__/publishRelayList.test.ts` — P2 `publishRelayListNip65` event-shape (mocked signer+pool): PLAIN kind-10002, content '', flat `r` tags, `signer.nip44.encrypt` NEVER called (G2), publishes to `publishTo` when wider than the tag list
- `src/hooks/__tests__/useRelayStatus.test.ts` — P3 pure `readyStateToStatus` mapping (1→connected, 0→connecting, 2/3/other→offline); the hook's socket lifecycle is device-verified, not unit-tested
- `src/lib/nostr/__tests__/ownerAuth.test.ts` — `validateOwnerRequest` (imported from `api/_lib/ownerAuth.js`): valid owner-signed token → `{ ok: true }`; wrong/non-owner key → 403; expired ts / url mismatch / method mismatch / malformed token / missing header / unset owner → 401 (real schnorr via `finalizeEvent` + test keys)
- `src/hooks/__tests__/useMorphoRate.test.ts` — pure `parseMorphoRate` (GraphQL `state.borrowApy`/`netBorrowApy` fraction → percent ×100; per-field independence; malformed/empty/null → nulls, no crash)
- `src/lib/__tests__/recoveryQuiz.test.ts` — R2c-1 ceremony verify logic (pure, node, injected `rand`, 19 cases): `pickQuizIndices` (an injected sequence yields the expected distinct pair; both ∈ 0–11; **a CONSTANT rand still returns two distinct indices** — the loop-free proof; default `Math.random` over 500 draws always distinct+in-range); `checkQuizAnswers` (correct → true; one wrong → false; **transposed answers → false**; trims+lowercases); `checkNsecTail` (last-6 → true; input trimmed; wrong → false; **case-sensitive** — an upper-cased tail of a lowercase nsec fails). **R2c-7b-fix `checkBackupPassphrase`** (the encrypted path): exact match; ⚠ **trims BOTH sides** — surrounding whitespace on either input still matches (the load-bearing case: the ceremony encrypts with `filePass.trim()`, so comparing untrimmed would reject a re-entry that *would* decrypt the file); inner whitespace IS significant (a passphrase is not a seed phrase — no normalization); case-sensitive; a real mismatch fails; **an empty expected passphrase never passes** (nothing can confirm by submitting nothing); an empty re-entry against a real passphrase fails
- `src/lib/__tests__/recoveryGrid.test.ts` — R2b-3 capture-grid logic (pure, node, real wordlist + validateWords, 19 cases): `distributePaste` (12-exact from any focus → 'fill-from-start'; 5@focus9 → 3 tokens truncated at box 12; 5@focus0 → all 5; single/zero → []; 2@box12 → 1); `suggestWords` ('ab' → abandon/ability/able/about capped at 4; case-insensitive; custom max; 'zzz'/''→[]; a full word still returns itself); `phraseStatus` (NIP-06 vector → valid; **one word swapped to ANOTHER valid word → 'bad-checksum'** — all words valid, checksum fails; normalizes case+whitespace; any empty / <12 → incomplete); `isWord` (case/whitespace-insensitive membership)
- `src/lib/nostr/__tests__/recoveryInput.test.ts` — R2b-2 shape classification (pure, node): `nsec1…` → `nsec` trimmed; a MALFORMED `nsec1garbage` still routes to the nsec door (nip19.decode owns the verdict); UPPERCASE `NSEC1…` → not nsec (bech32 is lowercase) → single token → unknown; exactly 12 tokens → `words`; newlines/tabs/doubled-spaces collapse to single spaces; **12 NONSENSE tokens → `words`, then `skFromWords` throws `InvalidSeedWordsError`** (the classifier/validator boundary); a real phrase round-trips classifier → skFromWords → 32-byte sk; unknown table (empty, whitespace-only, 11 tokens, 13 tokens, single word, garbage, an npub). **R2c-7a fourth kind:** `ncryptsec1…` → `encrypted` trimmed; a malformed `ncryptsec1garbage` still routes to the decrypt door (nip49.decrypt owns the verdict); UPPERCASE → unknown; **the disjointness pin** — `'ncryptsec1'.startsWith('nsec1') === false`, so no check order can confuse the two prefixes (a future prefix edit that introduces a collision fails here)
- `src/store/__tests__/remotePlanFound.test.ts` — R2b-2 (`vi.hoisted` localStorage shim): defaults null; absent from `buildSettingsPayload`; **EXCLUDED from `partializeState`** (session-transient — persisting it would surface a stale `false` on the next boot before any pull ran). Set-once latch asserted as ONE lifecycle `it` (the latch is module-level and vitest isolates the registry per FILE, not per `it`): record(false) → false; record(true) → still false; setRemotePlanFound(null) [Dismiss] → null; **record(false) again → still null** (a bare `=== null` guard instead of the latch would resurrect the notice here)
- `src/lib/nostr/__tests__/sync.test.ts` — 4e: ⭐ the pull asks for records, the journal manifest, plan-events and prefs only (never `settings:v1`); ⭐ a stale `settings:v1` that still arrives changes nothing, on an empty-log and on a migrated device — **IGNORED**: only the records branch's five setters are called and the pull logs no "payload parse failed (skipped)" (`applyRemoteEvent` swallows a throw, so a revived branch calling a setter the mock lacks would otherwise pass); ⭐ **ROSTER pull** — an empty roster and `DEFAULT_RELAYS` reach `applyPlanFold` unfiltered; the prefs pull goes through `hydratePrefs`; records merge-apply (legacy array + v2 payload), relay-behind dirty flag, **fetchAndSync `{ok, planFound}`** (R2b-2: decrypt failure + events present → `{ok:false, planFound:true}` — an unreachable signer must never claim "no plan found"; empty relay → `{ok:true, planFound:false}`; a d-tag-less event doesn't count as a plan), publishEncrypted first-ACK. P3: a records payload carrying dayLog/dayLogDeletions → setDayLog/setDeletedDayEvents called with the merged values; a legacy payload without dayLog hydrates safely (defaults []/{}, no throw). (4e retired the settings-watermark, settings-dirty, Fix B, DUAL-READ STRIP and 4d-stamp tests with the settings branch; the decrypt-failure and d-tag-less fixtures moved to plan-events.)
- `src/store/__tests__/viewerSnapshot.test.ts` — viewer snapshot builders. **⚠ Carries the EXHAUSTIVE trusted-settings key-set assertion (`Object.keys(snap.settings).sort()` vs a 40-key literal — 34 before the plan of record's Run 1 EXPOSED its six policy settings, D9) — brittle BY DESIGN.** The sibling deep-equal test is only DIFFERENTIAL (it derives its expectation from `buildSettingsPayload`), so a newly-synced field would leak into every trusted viewer's snapshot and still pass; the exhaustive set is the backstop. Adding a synced setting must be a conscious decision to EXPOSE (add the key here) or to STRIP (add it to `buildViewerSnapshotPayload`'s destructure) — never paste the key in to make the test green. Also: R2a-1 `backupVerifiedAt` is the 4th stripped key; `keyProvenance` is device-local (absent from the payload and BOTH tiers). Plus: owner viewer-config (viewerNpub/Pubkey/Label) IN buildSettingsPayload but STRIPPED from snapshot.settings (+nostrRelays); the Option-B shape (settings+records+strike+**cbCollateralBtc** P3 + **strikeCollateralBtc** C-P4); **P3 BUG2** — snap.cbCollateralBtc === deriveCbCollateral(dayLog,cache) (newest reading, not the cache); **C-P4** — snap.strikeCollateralBtc === deriveStrikeCollateral(dayLog,cache) (the reading, not the cache) + the SAFE payload's Object.keys excludes BOTH scalars; snap.records has entries+deletions but NOT dayLog; viewer-side fields device-local. The plan of record's Run 2 (D9): the C-trusted top-level key set gains `strikeLastDepositISO` (exhaustive; the latest logged Strike deposit date — the viewer reads the 60-day hold from it); the safe snapshot never carries it. The plan of record's Run 4 (D9): the safe block's levels include `cbAtSupportLevel`, `cbLtvAtSupport` is a ratio or null, and the safe thresholds' key set is exhaustive (`cbLimitAtSupport` joins `cbLiqFrac`, `cbLtvTriggerPct` and `strikeLiqLtv`)
- `src/lib/nostr/__tests__/viewerSync.test.ts` — P3/C-P4 viewer hydrate (mocked SimplePool + NSecSigner decrypt + store getState/setState): **BUG3** — a snapshot raw-sets cbCollateralBtc + strikeCollateralBtc (C-P4) AND leaves dayLog empty + NEVER calls setCbCollateralBtc (no spurious reading injected into the viewer's journal); a pre-P3/pre-C-P4 snapshot without the scalars keeps the existing values (?? fallback); a revoked snapshot → clearViewerData, neither scalar applied. 4e: the trusted path calls `applyViewerSettings` (the mock's applier — `viewerSettingsApply.test.ts` pins what it keeps on the REAL store); M-VIEWER-CALL turns its 5 trusted-path `it`s red. The plan of record's Run 2 (D9): ⭐ HOLD — a trusted snapshot raw-sets `viewerStrikeDepositISO` from `strikeLastDepositISO` (no journal event on the viewer), and a pre-Run-2 snapshot with none reads null, never a stale date
- `src/lib/nostr/__tests__/log.test.ts` — nostrLog ring: 50-cap, newest-last, clear
- `src/lib/nostr/__tests__/deviceTag.test.ts` — stable persisted tag, 'anon' fallback, platform label prefix
- `src/lib/nostr/__tests__/liveSync.test.ts` — singleton: double open → one sub, close+reopen, no-pubkey guard; ⭐ **LIVE four** (4e/5b — the live sub's `'#d'` is exactly records / the journal manifest / plan-events / prefs; RETIRED's name grep can't see an assembled d-tag, this can)
- `src/lib/nostr/__tests__/session.test.ts` — `waitForNostrExtension` (the async-injection-race fix): already-present → true immediately; injected mid-poll (fake timers) → true; absent through the timeout → false
- `src/lib/nostr/__tests__/restoreSignerSingleFlight.test.ts` — `restoreSigner` single-flight (Bug 2): two concurrent calls share ONE ceremony (`unwrapSecretKey` invoked once) + resolve to the SAME signer (stub NSecSigner + mocked unwrapSecretKey, no real crypto); a later non-concurrent call runs the worker again (guard cleared on settle); + #5 live-method re-verify: a method flipped to 'nip46' between the entry destructure and the pre-unwrap guard (counter-backed getter on a `getState` spy) bails BEFORE `unwrapSecretKey` (no spurious passkey) and returns the current signer. **P0 pin-forwarding + the pin-aware guard** (5 cases, a deferred `unwrapSecretKey` impl holds a call genuinely in-flight; `beforeEach` re-installs the default impl since `mockClear` keeps the old one): a supplied pin reaches `unwrapSecretKey(ct, meta, '1234')`; no pin → `undefined` (the PRF path is byte-identical); ⭐ **a pin-bearing call does NOT join a pinless in-flight restore** (two workers — it would otherwise inherit the doomed promise's failure and report a wrong PIN); a pinless call DOES join a pinned one (one ceremony, same signer); two pinless PRF callers still share ONE ceremony

When `BlocYearOneInputs` gains new required fields, add defaults (e.g. `btcGrowthRate: 0`) to any test fixtures.

---

