# Every source file — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

## File Structure

```
src/
  simulation/
    types.ts                    # SimInputs (optional creditLine), LivingInputs, StrategyResult, MonthlyLogEntry,
                                # DayEvent (Daily Mode P1 union) + source?/confirmed?/provisional? on MonthlyLogEntry
    livingUtils.ts              # getBtcPrice (8-param, bear market aware)
    powerLaw.ts                 # PL_B, PL_A_FAIR, PL_A_FLOOR, PL_A_CEILING (2.4e-17 — "Resistance" in the UI,
                                # key stays 'ceiling'), GENESIS + utils. ZERO imports
                                # (§2 wall side A). + plBandsAt(date) → {floor,fair,ceiling} (each from its OWN
                                # A constant — never PL_A_FAIR × scalar) and plConvergencePath(anchor, band,
                                # startDate, months, convergeMonths) — the Cycling face's price path: starts at
                                # the LIVE price (a fact) and reverts geometrically toward the band (a belief,
                                # a DESTINATION not an anchor) in log space, w = max(0, 1 − m/convergeMonths).
                                # ⚠ A naive `anchor × (days_m/days_0) ** PL_B` carries NO band coefficient, so
                                # all three bands share one growth ratio → IDENTICAL sims and inert band buttons
                                # (pinned by the not-constant-ratio test). ⚠ m===0 is special-cased to return
                                # the anchor EXACTLY (arithmetic drifts ~0.3% via day-clamping, and month 0 must
                                # equal what the SafetyDashboard shows). Local pure `addMonths` (UTC, day-of-month
                                # clamped) keeps the zero-import rule; callers pass a UTC-midnight startDate.
                                # + plBandAt(band, startDate, months) — one band at a selected month (the faces'
                                # Support marker), zero-import preserved
                                # + addMonths — now EXPORTED, shared with cyclePath.ts (⚠ day-of-month clamped,
                                # so NOT invertible — the 4-yr cycle's phase shift deliberately does not use it)
                                # + plDateAtPrice(band, usd) — the inverse of plBandsAt, exact to the day: the first UTC
                                # midnight d with plBandsAt(d)[band] >= usd and the day before < usd. daysSinceGenesis
                                # floors, so the day count is the CEILING of the real root, max(1, ceil((usd/A)^(1/B))).
                                # The Power Law face's model card reads its projections from it (Support $100k → Feb 2028,
                                # Fair $1M → Nov 2032); zero imports preserved
                                # + supportToday(todayISO) — today's support, the plan's S₀ (plBandAt('floor', today, 0)):
                                # Safety's callers ask it and pass the figure in (the plan of record's Run 4, D7), so
                                # safetyView stays belief-free; zero imports preserved
    cyclePath.ts                # 4-yr cycle price path — the Almanac faces' 4th path kind 'fourYear' (PathKind =
                                # PlBand | 'fourYear'). Imports BOTH belief leaves so neither gains an import:
                                # price = plFairValue(d) × cycleMultAt(d), CYCLE_TOP_MULT 1.00 (tops on fair) ↔
                                # CYCLE_LOW_MULT = PL_A_FLOOR/PL_A_FAIR (DERIVED — troughs ON support), log-linear
                                # in days between CYCLE_TURNS. cycleConvergencePath = structural mirror of
                                # plConvergencePath. Phase shift = fixed ms (CYCLE_SHIFT_MONTH_MS, 30.4375 d, a whole
                                # number of ms → exactly invertible). shiftedCycleTurns (unclipped) feeds
                                # upcomingCycleTurns (path note) + cycleTurnsInHorizon (Milestones: nearest row,
                                # ties → later, row 0 SNAPS to 1). 🔴 A belief — never importable by the risk core
    pricePaths.ts               # Policy v2 — the lenses: the PRICE FUTURES. A BELIEF leaf beside cyclePath — it imports ONLY
                                # ./powerLaw and ./cycleModel and returns plain number[]s; the risk core never imports it,
                                # and futuresRun is the one module that hands its prices to the engine. priceFutures({
                                # anchorPrice, startDate, months, count, seed }) → { regime, prices }[] · FUTURES_SEED 2026 ·
                                # FUTURES_COUNT 1,000 (or §9's 300 — R13 pins it to those two) · FUTURES_MAX_MONTHS 240 ·
                                # futureSeed(seed, i). A future: price[m] = trueFair[m] × cycle[m] × exp(noise[m] + shock[m]),
                                # price[0] = the anchor EXACTLY. The power law itself may be wrong (slope PL_B + 0.15·z, level
                                # × exp(0.08·z′), pivoting on today's model value); the 4-yr cycle keeps the model's cadence,
                                # each leg × U(0.75, 1.25); troughs at LogU(0.85, 1.8) × support's share of fair (derived,
                                # never typed); the first top at LogU(0.6, 2.3) × fair, later tops keeping 40–70% of their log
                                # distance to the trend; regimes 70 / 15 / 10 / 5 (ordinary · lost decade · support break ·
                                # supercycle); AR(1) noise, φ 0.85, σ U(0.04, 0.10); a 15–45% shock in about one month in 60,
                                # back in a straight log line over 3–18 months. CALIBRATED to the memo's harsh-on-purpose
                                # targets (L-I3): the ordinary futures' deepest month-end under the MODEL's support 0.80 × at
                                # the median and 0.59 × at p10, the worst month −34% at the median, 67% of the faces' default
                                # runs tripping the breaker (memo 0.82 / 0.61 / −35% / 64%) — never move the bounds to fit the
                                # code. SEEDED and PREFIX-STABLE: future i draws from its own mulberry32, seeded from (seed, i),
                                # so the first 300 ARE the 300-future set; every future is drawn to 240 months and cut, so a
                                # shorter horizon is a prefix of a longer one. Junk in → flat futures at the anchor
    placement.ts                # THE MOVE — the support policy's collateral placement for THIS month, previewed at
                                # today's inputs (Decision face, §4.1). 🔴 IT IS THE ENGINE'S OWN STEPS 5 AND 9:
                                # placementPlan calls strikeKeepCollateralBtc and cbKeepCollateralBtc, the same two
                                # leaves runCyclingSim calls, so the card, the run and the schedule are one plan —
                                # never a second placement rule. Direct routing (Coinbase filled to its keep, the
                                # rest straight to cold) reaches the engine's end state in one hop; an equivalence
                                # sweep over 20,001 random positions pins month 1 ≡ plan.after.
                                # 🔴 THE STATES, IN THIS ORDER: 'unavailable' → 'cbPastLiquidation' → 'broken' →
                                # 'paused' → 'ready'. A seizure is the most urgent fact and BELOW support it is
                                # the likeliest, so a pause must never hide it (the card would never name the 86%
                                # line or the Emergency Console). 'broken' reads the breaker seed — the SAME seed
                                # the run's openingBreaker gets — because a broken model is the engine's own zone
                                # and steps 5 and 9 never run there. Every state but 'ready' is inert.
                                # BL32 (G3-B, batch 1 build 2b): `goalNetBtc?` (read through goal.ts's goalOf) →
                                # `standDown` — at the goal with both loans repaid (goalStandsDown, on TODAY's
                                # position) neither 'broken' nor 'paused' applies: the plan is 'ready', both keeps are
                                # told so (0) and every coin goes to cold, Strike's straight there — Strike's hold
                                # still holds its coins. STAND I3 (goalStandDown.test.ts, 3,000 positions) pins
                                # month 1 ≡ after at the stand-down
                                # 🔴 `opening` vs `after`: `after` is the end state steps 5 and 9 reach (the I3
                                # contract); `opening` is what the owner ACTUALLY holds once today's move is made
                                # or deferred — `after` when seeded, today's holdings otherwise. The run seeds
                                # from `opening` (D10), and the cliff and cbOverCeilingUsd read it, because a
                                # sub-threshold move reaches `after` but never happens.
                                # StrikeLeg moves / nothing / hold / ltv (all-or-nothing, like step 5).
                                # + cbOverCeilingUsd (a FACT about the position, reported in every state but
                                # unavailable), MOVE_THRESHOLD_BTC 0.01 (moves under it WAIT for next month's
                                # re-plan; crash moves never do) and suggestedLineUsd (2 months of bills or one
                                # Coinbase paydown × 1.25, clamped to Strike's own range — ⚠ the "suggested line",
                                # never InputsPanel's "Recommended min", which is a different strategy's figure; since
                                # the plan of record's Run 4 the Smart BLOC sidebar shows THIS figure in its place, as
                                # "Your plan's suggested line").
                                # PURE LEAF: supportPolicy + cbDefense + cbMetrics + strikeCredit + runCoinbaseLoan
                                # + emergencyModel + ltv + goal. No belief, no store, no React, no components/
    planSearch.ts               # Path evaluation for the Decision face (§4.3) — a CONSUMER of runCyclingSim (runAdvisor,
                                # the other, left in 5e); paths arrive as plain number[]. evaluatePaths → per-path outcome +
                                # worstIndex + worstBy. WORST = CLOSEST TO A FORCED SALE (W1): any liquidation >
                                # none; earlier > later; then the smallest cushion (minCushionOf: min over months 1
                                # to the horizon before a liquidation — T1: month 0 is today, the same on every path,
                                # read by the row's m — of price ÷ cbSeizurePrice — ∞ with no Coinbase loan; ties
                                # within the RELATIVE CUSHION_EPS 1e-9); then the least allInEquity; ties → the
                                # lowest index. pickWorst's worstBy = the FIRST rule on which ANY ranked path differs
                                # from the crown ('index' if none). ⚠ M4: a run whose policyApplied differs from what
                                # was asked is NOT ranked. ⚠ yoursAtHorizon (reported, no longer ranked) is
                                # deriveOwnership at THREE args (a row's btcHeld already holds cold). worstCasePath = the stitched floor; ragged → []. ⚠ The extra
                                # runs are a SELECTOR for the Worst (modeled) crown, never a second truth.
                                # + sameSeries(a, b) (Run B) — bit for bit (equal length, Object.is every month),
                                # NEVER a tolerance: the face disables Worst (stitched) while it is Support
    monteCarlo.ts               # Policy v2 — the lenses: the futures' BATCH RUNNER — the ENGINE side of the §2 wall (imports
                                # ONLY ./cyclingSim and ./ownership, never a belief). futureOutcome(inputs, prices) → yours
                                # (deriveOwnership of the last row, THREE args — btcHeld already holds cold), cold
                                # (last.coldBtc), beatsNeverDraw (the engine's ONE rule, `beatsNeverDraw` — allInEquity >
                                # baselineAllInEquity, and with a goal never a gap under the dust floor; verdictVsNeverDraw's
                                # `wins`, R9) + tiesNeverDraw (BL14 — `neverDrawTie`, never true with no goal; the summary
                                # counts them apart), seized (liqMonth OR firstOpenPastLltvMonth — at a month-end or on the way down,
                                # R8), seizedMonth (Run 2, W-3: the EARLIER of the two; null when neither), policyApplied;
                                # runFutures(inputs, paths, startISO) → FuturesSummary { count, months, yoursBtc / coldBtc
                                # as p10 / p50 / p90, beatsNeverDraw / seized as counts, seizedWithinYear (month 12
                                # included), seizedHalfByMonth (the LOWER median of the seized months — the smallest m with
                                # at least half of them seized by m; null when none), startISO (month 0's LOCAL date, passed
                                # through for the words), countsSeizures }; quantile
                                # (linear between the nearest ranks). ⚠ countsSeizures = the policy APPLIED: without it the
                                # month-end reading rescues loans Morpho takes during the month (REPRO, 20 yr, policy off:
                                # liqMonth 0.6% of the futures vs the way-down test 95.1% — F4), so the coin figures would
                                # count coins that are gone, and the faces show the chance alone (R1)
    cyclingSim.ts               # Cycling strategy PURE engine (Almanac cycling/ownership/strategy faces) —
                                # + the STRIKE LTV CAP (strikeLtvCapPct, 0/undefined = off → byte-identical,
                                # pinned by a HEAD golden): a cold → Strike top-up with a TWO-PART reservation
                                # (cold AND a collateral floor), the COINBASE SURVIVAL GUARD and its FUTILITY
                                # CHECK (test-only cbSurvivalGuard/cbFutilityCheck, both default ON, no face
                                # may pass them; + the cold rules and the crash playbook, policy-only — the ADOPTED
                                # doom gate doomGateCbTopUp, strikeFirstAfterLiquidation (every zone after a
                                # liquidation), strikeReleaseRules and topUpBeforeShift, all default ON (`false`
                                # test-only), and topUpFirstAnyDepth, test-only default OFF — § LTV defense; C retired;
                                # + Policy v2's seizeOnTheWayDown — Morpho seizes on the way down, policy-only, default
                                # ON, `false` test-only — § Support-anchored policy → Policy v2),
                                # effectiveStrikeCapPct (the exported clamp) and the telemetry
                                # firstSurvivalYieldMonth/strikeReserveCutBtc. Draw bills on Strike,
                                # refinance into Coinbase every cycleMonths, route every purchase to the CB
                                # collateral pool, stop drawing at a CB LTV cap; verdict vs a never-draw baseline.
                                # Pays Coinbase's origination fee (cbBorrowFee) on EVERY sweep and CAPITALISES
                                # it; totals surface as totalCbFees/cbFeeCount.
                                # 🔴 §2 wall side B: imports ONLY CB_LLTV/CB_LIF/cbBorrowFee/cbLiquidationPrice + the
                                # fee-bracket inverse cbMaxDrawForHeadroom (runCoinbaseLoan, a leaf) + defendCbLtv/topUpToCbLtv and the other defense leaves (cbDefense) +
                                # the zero-import ltvOf (./ltv) + the zero-import ./goal + the leaf ./supportPolicy (the opt-in SUPPORT-
                                # ANCHORED POLICY, `supportPolicy?` — see § Support-anchored policy; absent ⇒
                                # byte-identical, pinned by the G1 golden; TEST-ONLY incomePath and
                                # modelStrikeLiquidation) — NOTHING from powerLaw/cycleModel/store. The
                                # price path arrives as a plain number[] and the
                                # lender ratios (strikeMaxDrawLtv/strikeMarginLtv) as plain numbers, so it stays a
                                # clock-free, fixture-testable leaf; the VIEW does the labelled crossing (the
                                # MonthBreakdown precedent). ⚠ TWO COLLATERAL POOLS, NEVER ONE — strikeColl and
                                # cbColl are separate denominators (purchases only ever grow cbColl); btcHeld is
                                # their sum (+ the cold pool) and DISPLAY ONLY, never a denominator (collapsing
                                # them understates CB LTV ~16pts and fires the cap late). ⚠ strikeColl is no
                                # longer fixed: the sweep CASCADE moves its surplus to cbColl and the emergency
                                # TOP-UP can draw both pools into cbColl (see the cold-sweep section).
                                # The cap tests cbLtv (a Coinbase metric), never a blended figure. The Strike
                                # credit line is a hard constraint — a draw is capped at min(creditLine,
                                # strikeColl×price×maxDrawLtv) − strikeBal and the shortfall comes out of income
                                # (self-limiting: fewer sats bought), surfacing as creditExhaustedMonth. Liquidation
                                # is TERMINAL. Under the support policy (Policy v2, seizeOnTheWayDown) Morpho seizes
                                # ON THE WAY DOWN: after the month's interest and before any monthly action, the
                                # carried loan at ≥ CB_LLTV at THIS month's price is seized at the liquidation price
                                # (cbLiquidationPrice) — CB_LIF × CB_LLTV ≈ 0.898 of the pool, debt EXACTLY 0, no
                                # deficiency — and that month's row is the SURVIVOR (result seizedOnTheWayDown /
                                # seizurePriceUsd). Month 0 and the policy-off engine keep the MONTH-END seizure:
                                # at cbLtv ≥ CB_LLTV it seizes min(cbColl, cbDebt×CB_LIF/price) and ⚠ subtracts the
                                # repayment rather than zeroing debt, so an under-collateralised seizure PRESERVES
                                # the deficiency (both facilities are full-recourse) — but a pool that COVERED the
                                # debt repays it in full, exactly 0 (F9: the round trip left a ≈3e-11 residue); that
                                # row is pushed PRE-seizure so it shows the position that breached and m+1 opens on
                                # the survivor. CB_LIQUIDATION_PENALTY is derived (CB_LIF − 1), not a literal.
                                # + supportPolicyResolution(PolicyRunContext) → { policyApplied, policyIgnoredReason }
                                # — the run's own answer without running it (Run B's check); the run and it share
                                # ONE resolveRunPolicy, so resolveSupportPolicy has no other caller.
                                # + result firstOpenPastLltvMonth (Policy v2 Run B, B5) — the first month (m ≥ 1) the
                                # loan carried from last month-end opens at or past 86% at that month's price, before any
                                # liquidation, while Coinbase holds collateral. ONE condition (`opensPastLltv`) serves it
                                # and the seizure on the way down; computed in every mode, policy on or off — under the
                                # applied policy it IS the rule's month (or null)
                                # ⚠ Terminal for the WHOLE Coinbase loop, not just the draw: the refinance and
                                # the cascade migration are gated `liqMonth === null` too. Ungated, they
                                # re-levered Coinbase after a seizure — a NEW loan the one-shot breach check
                                # could never liquidate. A post-seizure Strike balance now stays on Strike,
                                # accruing at its own APR (which is why post-seizure Strike calls can occur).
                                # DISCLOSURE: row `unfundedUsd` (bills nothing paid — drawing month
                                # max(0, strikeShortfall − income), stopped month and every non-cycle mode
                                # max(0, expenses − income); > 0 ⇒ btcBoughtUsd 0) + result totalUnfundedUsd /
                                # firstUnfundedMonth. Funding and baseline math unchanged (see the Unfunded
                                # bills subsection under the Cycling face).
                                # `defendCbLtv?: boolean` (default FALSE) adds the debt-shift cap defense —
                                # above the cap, draw Strike to PAY COINBASE DOWN to the cap; a due refinance
                                # sweeps only up to the remaining CB headroom (cbMaxDrawForHeadroom), so it
                                # shifts the debt back on recovery without re-breaching. If the line still
                                # leaves LTV above the stop, the FALLBACK top-up moves collateral into the CB
                                # pool — cold reserve first, then the Strike collateral above
                                # marginLtv×(1−TOPUP_MARGIN_BUFFER). Row fields defenseDrawnUsd/cbLtvPreDefense/
                                # defenseShortfallUsd/
                                # defended + strikeToCbBtc/topUpBtc/topUpFromColdBtc/topUpFromStrikeBtc/
                                # coldRetrievedBtc (cumulative); result firstDefenseMonth/defenseExhaustedMonth/
                                # totalDefenseDrawnUsd/defenseCount + firstTopUpMonth/topUpExhaustedMonth/
                                # totalTopUpBtc/totalTopUpFromColdBtc/totalTopUpFromStrikeBtc/
                                # totalStrikeToCbBtc/totalColdRetrievedBtc/openingColdBtc.
                                # ⚠ `openingColdBtc?: number` (default 0 → every pre-existing call site
                                # byte-identical) SEEDS the cold pool with the owner's REAL unpledged reserve,
                                # so the top-up's "cold FIRST" can spend coins the sim never swept; it is also
                                # added to the never-draw baseline (the owner holds it in that world too).
                                # WIRED from the four engine faces (real-cold spec v1): each passes
                                # getCurrentColdBtc(). ⚠ Under the policy the emergency CB top-up IS doom-gated
                                # (adopted, default on) — same-month: cold topped in while Coinbase was savable can
                                # be lost to a later liquidation; policy off, it is NOT (that arm is unchanged)
                                # RUN 2a: `effectivePolicyStops` (beside effectiveStrikeCapPct) is the ONE stop
                                # clamp — resolveSupportPolicy and the faces' readout both call it (a source test
                                # forbids an inline copy). `allInEquity` / `baselineAllInEquity` are the verdict's
                                # basis; the result adds `baselineUnfundedUsd` (the never-draw baseline's own gap,
                                # always computed, from the same per-month income) + `totalStrikeCureColdBtc`
                                # CRASH PLAYBOOK (Run 1, policy-only — § LTV defense → "The crash playbook"): under
                                # the policy the defense month IS the playbook — Strike's release rules on every
                                # Strike leg (`strikeReleaseRules`, default ON), top up first between the liquidation
                                # depth and support (`topUpBeforeShift`, default ON), `topUpFirstAnyDepth` (default
                                # OFF, measured and rejected) — all three TEST-ONLY. Row strikeRepaidUsd/cbRepaidUsd
                                # (restore + pay-down per leg); result firstUnheldMonth (the playbook ran and CB
                                # still ended over its line). ⚠ It runs the SAME sequence as crashPlaybook() inline
                                # (it adds the Strike cap's reserve and guard) — a parity test pins the two
                                # PLAN OF RECORD (Run 2): `strikeMinFromIncome?: boolean` — Strike's minimum as the
                                # owner pays it (`blocMinPaymentSource === 'income'`). Absent/false ("roll") ⇒ the
                                # interest capitalises, byte-identical; TRUE ⇒ income pays it after the bills and
                                # before any buy or repay, and only an unpaid part capitalises (the Advisor's rule),
                                # in every mode. ⚠ A REAL input, never test-only: the main screens and every face
                                # pass the owner's setting. The never-draw baseline pays its own Strike interest by
                                # the SAME rule (Δ11 — from the surplus first), so the verdict compares like with like
                                # and a "hold" run equals never-draw in both modes. Row `strikeInterestUsd` = the
                                # month's Strike interest (Strike's minimum; Σ = totalStrikeInterest — rolled in, all
                                # of it capitalises; paid from income, only strikeInterestUsd − strikeMinPaidUsd does)
                                # and `strikeMinPaidUsd` (the part income paid; 0 when it rolls). `validOpeningBreaker`
                                # is EXPORTED: the main screens' breaker cache is read through it (planRun's
                                # planBreakerCacheOf), so a cache the run would discard never steers THE MOVE
                                # BL14 (batch 1, build 2): `goalNetBtc?: number | null` — the plan's goal in NET COINS, a
                                # REAL input (every plan reader passes the owner's, through planGoalOf), policy- and
                                # cycle-only; absent/null/junk ⇒ byte-identical. Read once a month after Coinbase's
                                # interest and any seizure, before the month acts (./goal); at or above it the month draws,
                                # buys and refinances nothing and spare income repays Strike, then Coinbase, through the
                                # pay-down's own code. Row `netCoinsBtc` / `atGoal` (null with no goal) / `goalHeldUsd` (the
                                # leftover once both loans are repaid); result `goalNetBtc` (the goal applied),
                                # `totalGoalHeldUsd`, `baselineGoalHeldUsd` — both counted in allInEquity /
                                # baselineAllInEquity, each only above 0 — and the ONE verdict rule, `neverDrawTie` /
                                # `beatsNeverDraw` (`NEVER_DRAW_TIE_USD` = DUST_USD; a tie only with a goal). See
                                # engines.md § The plan's goal amount
                                # BL32 (build 2b): THE STAND-DOWN — goalStandsDown read ONCE a month at step 5, after
                                # the pay-down; steps 5 and 9 read that flag and keep nothing (both keeps told so), in
                                # any zone, past a seizure too; Strike's release goes STRAIGHT to cold. Row
                                # `strikeToColdBtc` (a flow, in coldFromStrike) and `goalStandDown`; the goal read
                                # through goal.ts's goalOf
    goal.ts                     # BL14 — net coins and the goal test, the PURE leaf the engine's month decision and the
                                # Dashboard's goal tile share: netCoinsBtc({ strikeBtc, cbBtc, coldBtc, strikeBalanceUsd,
                                # cbDebtUsd, price }) (null when unreadable — no positive finite price, or a part that isn't
                                # finite) and atGoalOf(net, goal) (at or above, within GOAL_EPS = 1e-12 relative). 🔴 + − × ÷
                                # only, ZERO imports — cyclingSim imports it, so G1's import walk reaches it
                                # BL32 (build 2b): + goalOf(v) — the goal as the plan reads it (a finite number above
                                # zero, else none; the engine's and THE MOVE's ONE read) · goalStandsDown(atGoal,
                                # strikeBalanceUsd, cbDebtUsd) — at the goal with both balances EXACTLY 0. Tested in
                                # __tests__/goalAmount.test.ts and __tests__/goalStandDown.test.ts (STAND …)
    supportPolicy.ts            # SUPPORT-ANCHORED POLICY leaf — imports only the zero-import ./ltv (support
                                # arrives as a plain number; the §2 wall holds). policyZone (k = price ÷ support →
                                # paused/accumulate/hold/payDown, junk → 'paused'), ceilingHeadroomUsd (room at
                                # support, negative = over), sweepKeepBtc ((debt + buffer)/(S × stop), junk → +∞),
                                # + strikeKeepCollateralBtc (step 5's keep: max(line, bal) / (skStop × S)) and
                                # cbKeepCollateralBtc (step 9's keep: max(sweepKeepBtc, debt / (cap × price))) —
                                # 🔴 ONE DEFINITION EACH, shared with the Decision face's THE MOVE (junk → +∞).
                                # BL32: both take `standDown` (goalStandsDown) → 0 — junk still +∞.
                                # collateralToSellForLtv, resolveStrikeCall (cash → cold → sale to the cure LTV;
                                # ≥ partial-liq → immediate; an emptied Strike is 'none' — no phantom sales),
                                # nextBreakerState (2 month-ends < 0.9 × S, LATCHED — the ONE trip rule),
                                # nextRearmableBreakerState (the opt-in re-arm: a LAYER over it; the engine imports
                                # only this), allocatePayDown (Strike first). SUPPORT_EPS 1e-9 · HARD_BREAKER_DEPTH/_MONTHS.
                                # Never NaN (`Number.isFinite && > 0` guards). See § Support-anchored policy
    cbDefense.ts                # LTV defense, BOTH legs — LEAF, imports only the zero-import ./ltv. Strike side:
                                # topUpStrikeLtv (cold → Strike, cold the ONLY source) + strikeCollateralAboveLtv
                                # (the one definition of what Strike can spare) + topUpToCbLtv's optional
                                # strikeFloorLtv (⚠ absent ≡ byte-identical). Survival guard: CB_SURVIVAL_BUFFER
                                # (0.05 — its OWN constant, NOT TOPUP_MARGIN_BUFFER) + cbSurvivalCollateralBtc +
                                # cbDoomedThisMonth (the futility check; buffer 0 and the MARGIN bound, both
                                # deliberate — see its docblock). Coinbase survival > Strike cap > Coinbase cap.
                                # cbSurvivalCollateralBtc gains an optional 6th `stopLtv?` — ⚠ absent (or junk,
                                # or ≤ the survival line) ≡ byte-identical; the target LTV is the LOOSER of the
                                # survival line and the stop, i.e. min(need(line), need(stop)), so above an 81.7%
                                # stop the guard reserves only what the CB top-up can use. topUpToCbLtv's cold
                                # guard is now `Number.isFinite && > 0` (was Math.max(0, x) → NaN for NaN),
                                # matching its topUpStrikeLtv twin — ⚠ Infinity cold now reads as 0 too.
                                # Coinbase side: strikeDrawCapacity(collBtc, drawn,
                                # price, maxDrawLtv, creditLine=∞) = min(creditLine, collateral×price×maxDrawLtv)
                                # − drawn; defendCbLtv(input) → paydown needed/capacity/draw/shortfall,
                                # post-defense CB+Strike LTVs, Strike margin-call price, recovery price;
                                # topUpToCbLtv(input) → requiredBtc/fromColdBtc/fromStrikeBtc/topUpBtc/
                                # shortfallBtc/fullyDefended/cbLtvAfter (cold first, then Strike down to
                                # marginLtv×(1−TOPUP_MARGIN_BUFFER) at the current price — a buffer INSIDE
                                # the call line, NEVER on it: the old bare-marginLtv bound landed an
                                # exhausting top-up exactly on the line, so cyclingSim's strikeMarginMonth
                                # fired the same month. TOPUP_MARGIN_BUFFER (0.05) is exported so a future
                                # spec can make it an input. ⚠ A leg already inside the buffer now yields
                                # ZERO, where it used to yield a sliver taken up to the call — the correct
                                # answer). ⚠ BOTH of defendCbLtv's LTVs now route through the SHARED
                                # ltvOf (simulation/ltv.ts), so skLtvAfter can be ∞ (debt with no Strike collateral) where it
                                # used to report a flat 0 — any future consumer MUST use fmtLtvPct.
                                # Consumed by cyclingSim (the automatic
                                # defense + top-up) and crashPlaybook
                                # STRIKE'S RELEASE RULES (crash playbook Run 1): strikeReleasableBtc (collateral
                                # leaves Strike only at or under 40% before, only down to strictly under 50% after —
                                # × (1 − STRIKE_RELEASE_EPS 1e-9) — and never within 60 days of a deposit; junk → 0,
                                # through ltvOf) + ceilingLiquidationMultiple(cbStop, lltv) = stop ÷ lltv (the depth
                                # gate; junk → +∞) + SHIFT_DUST_USD 0.005 (the dust drop). topUpToCbLtv gains
                                # `strikeReleaseCapBtc?` and cbDoomedThisMonth `strikeReleasableBtc?` (the release
                                # figure REPLACES the margin term) — ⚠ both absent ≡ byte-identical (pinned)
    crashPlaybook.ts            # THE CRASH PLAYBOOK — the ONE crash-day answer (crash playbook Run 1). Pure leaf:
                                # imports ./cbDefense, ./ltv and SUPPORT_EPS only (support arrives as a plain number —
                                # the §2 wall holds). crashPlaybook(input) → { order: 'none'|'topUpFirst'|'shiftFirst',
                                # steps (coldToCoinbase / strikeToCoinbase / shiftToStrike, zero-size omitted),
                                # after (pools, debts, cold, both LTVs via ltvOf), shortfallBtc, doomed (the opening
                                # state) }. Top up first when k ∈ [cbStop/0.86, 1) and not doomed — cold, then the
                                # collateral Strike RELEASES now, then the shift for the rest (a full restore ends it);
                                # shift first elsewhere, then the fallback top-up, skipped when doomed after the shift.
                                # ⚠ cyclingSim runs the same sequence inline with the engine's exact arithmetic; a
                                # parity test (the Strike cap off) pins engine ≡ crashPlaybook — never fork it. Its
                                # consumers: the Emergency Console, via components/Tools/crashPlaybookView (Run 2), and
                                # the Monthly Playbook's crash line (Run 3)
    runNoBitcoin.ts
    runSellToLive.ts
    runSmartBLOC_Living.ts      # Living on Bitcoin tab simulation
    runMaxLeverage.ts
    runBLOC.ts                  # Smart BLOC 5-year simulation (respects creditLine ?? Infinity)
    runBlocYearOne.ts           # Month-by-Month 12-month simulation + getCollateralForTier
    runCoinbaseLoan.ts          # CB facts: CB_LLTV/CB_LIF/CB_WARN_LTV + computeLiquidationAnalysis. (The 12-month
                                # simulation runCoinbaseLoan(), its CbLtvStatus/CbMonthRow types and classifyLtv left the
                                # code in 5e, D5-A — no screen had run them since the plan of record's Run 4, when the CB
                                # Loan tab's projection left and its colours became Safety's)
                                # + CB_PLATFORM_FEE_PCT 1.5 + cbNetApr() — Coinbase's spread ON TOP of Morpho's
                                # market rate; `cbAprPct` everywhere means the NET all-in rate
                                # + the ORIGINATION-FEE brackets: CB_FEE_TIER1_PCT 2% / CB_FEE_TIER2_PCT 1% /
                                # CB_FEE_TIER_BREAK $250k, `cbBorrowFee(amount, balance)` (marginal, like tax)
                                # and `cbMaxDrawForHeadroom(headroom, balance)` (its exact inverse). Still a
                                # LEAF — imports only the zero-import ./ltv — which is why cyclingSim/cbMetrics/
                                # emergencyModel (and runAdvisor, until 5e) import the CB facts from it with no cycle
                                # + cbLiquidationPrice(balance, collateralBtc) (Policy v2) — 🔴 THE liquidation price,
                                # balance ÷ (collateral × CB_LLTV), 0 with no collateral: cbMetrics' liqPriceOf and the
                                # engine's seizure on the way down both read it. It lives HERE, not in cbMetrics: the
                                # engine's import graph must stay + − × ÷ (the G1 walk) and cbMetrics accrues with
                                # Math.pow
    ltv.ts                      # 🔴 THE LTV definition — ltvOf(debt, collBtc, price) + ltvOfUsd(debt, collUsd,
                                # collBtc). ZERO IMPORTS. debt with no collateral → ∞; collateral with no PRICE
                                # → 0 (a zero-price guard is not an unbacked loan, so ltvOfUsd still needs
                                # collBtc to tell the two apart). Was hand-written 5× (cbDefense, cyclingSim,
                                # strikeCredit, cbMetrics, runCoinbaseLoan) + a 6th drifted copy in LiqSimulator
                                # that printed 0.0% for an unbacked loan. __tests__/ltv.test.ts greps src/
                                # (excluding __tests__) and FAILS if a new copy appears. emergencyModel's LTV
                                # (classifyStage) routes through it too. The NAMED FOLLOW-UP is closed: the flattering
                                # open-coded `x > 0 ? a/b : 0` copies left with their code — AdvisorMain's in the plan of
                                # record's Run 4 (Safety's cbLtv), runAdvisor's four in 5e (D5-A). The grep still matches
                                # only the `<= 0 ? Infinity` shape
    cbMetrics.ts                # SHARED CB LTV/liq-price source of truth: cbMetrics, accruedCbBalance,
                                # barLevel/worseLevel (Safe/Watch/Act). Consumed by SafetyDashboard +
                                # CoinbaseLoanMain/Sidebar (inline formulas removed). Imports cbLiquidationPrice from
                                # runCoinbaseLoan (liqPriceOf delegates — ONE liquidation-price expression, shared with
                                # the engine's seizure on the way down; a source test pins it) + ltvOfUsd from ./ltv
                                # + cbSeizurePrice(row) (W1) — 🔴 THE one PER-ROW seizure price (cbMetrics().liqPrice
                                # through one private liqPriceOf): the Decision face's cliff (cliffPath) draws it and
                                # its Worst (modeled) ranking measures the cushion against it; since Policy v2 Run B the
                                # support policy card's cliff line and the three parent faces' charts (chartCliffUsd)
                                # read it too. null on a postLiquidation row, when the debt OR the price is under the
                                # dust floor (shownUsd, from utils/format — the price floor is Run B's R9: 60¢ on 2 ₿
                                # seizes at 35¢) and with no collateral
    runAdvisor.ts               # The Advisor's helpers: getCurrentStrategyMonth / isStrategyComplete (on logUtils' month
                                # clock) and getNdpStatus / NdpStatus / NdpInfo. The engine itself — runAdvisor, its tier
                                # helpers (getTier / getTierColor / getTierLabel) and its projection's types — left the
                                # code in 5e (batch 1, D5-A): the comparison engine kept one release after the plan of
                                # record, no screen having called it since Run 3. Invariant 3
                                # (__tests__/advisorPricePath.test.ts) now pins that it, and what left with it, is gone.
                                # The file keeps its name, so its 11 importers keep theirs
    strikeCredit.ts             # + STRIKE_CURE_LTV (0.65 — a call must be cured back to it) and STRIKE_RETRIEVE_MAX_LTV
                                # (0.40 — collateral leaves Strike only at or below it); the support policy's
                                # inputs, passed in by the view — the engine imports neither.
                                # STRIKE_MAX_DRAW_LTV (0.50), strikeAvailableCredit = min(line, collateral×50%) − drawn, computeStrikeLtv(bloc, btcHeld, price) (shared by the SafetyDashboard Strike bar via safetyView, LiqSimulator (until the plan of record's Run 4 deleted it) and emitBalanceReading — SimpleModeView no longer reads it since the plan of record's Run 2). ALSO the SINGLE definition of BLOC_OPERATING_CEILING (0.15) — the advisor's steady-state Strike ceiling; Smart BLOC's Playbook (MonthlyPlaybook, PlaybookItems) passes it instead of a bare 0.15 (so did runAdvisor's screen call sites — AdvisorMain, OutlookProjection and SimpleModeView's log overlay; Daily's went with Run 2 — until the plan of record's Run 3 took runAdvisor off every screen)
    emergencyModel.ts           # The Emergency Console's retained pure model (crash playbook Run 2) — clock-free, plain numbers (the VIEW pre-accrues cbDebt via accruedCbBalance). Holds ONLY the stage ladder (CB_LADDER 69/72/75/81, liq = CB_LLTV 0.86; classifyStage → stage / cbLtv / liqPrice / distancePct / bandPrices), STRIKE_MARGIN_CALL_LTV 0.70 (the engine's inputs, the faces and the crash playbook import it from here) and the two last-resort walls (wall3Sale · wall4External). EmergencyState = { cbDebt, cbCollateralBtc, price } — the Strike position lives in CrashPlaybookInput; the crash-day answer is crashPlaybook, via components/Tools/crashPlaybookView. Deleted in Run 2: the Phase-1 buy-and-pledge functions (firepower, drawToLtv, floorTable, direSwitch, surplus). Imports CB_LLTV (runCoinbaseLoan) + the zero-import ltvOf (./ltv); NO cycle/power-law imports (§7 hard wall). classifyStage's LTV goes through ltvOf — so Coinbase debt with ZERO collateral reads cbLtv ∞ / stage 'liquidated' (was a flattering 0 / 'normal'); no-debt-no-collateral stays 0 / 'normal'; EmergencyConsole renders it via fmtLtvPct. ⚠ NAMED FOLLOW-UP (not fixed here): runAdvisor (4 copies) + AdvisorMain (1 — gone in the plan of record's Run 4) still open-code `x > 0 ? a/b : 0`; and the zero-collateral CB reading is still incoherent elsewhere on this model — distancePct = 1 (reads "100% above liquidation"), liqPrice and every bandPrice = $0
    safetyView.ts               # PURE single-source of the 3 safety dimensions for BOTH the owner's
                                # SafetyDashboard AND the viewer home (dedup DONE — SafetyDashboard's inline
                                # copy is GONE; the two can no longer drift). deriveSafetyView → {capacityUsed,
                                # creditLevel, strikeLtv, strikeLevel, crashLtv, cbLtv, cbLevel, + the CB
                                # display intermediates accruedBalance/cbLiqPrice/cbLiqFrac the dashboard
                                # needs (additive — the viewer ignores them; hoisted with no-CB defaults
                                # 0/0/CB_LLTV that never render)}; deriveViewerOverall = worst of the gauges
                                # SHOWN incl. credit. selectSafetyViewInputs(s: StoreState) = the SINGLE
                                # store→inputs mapping (pure, type-only StoreState import → no cycle) shared
                                # by BOTH consumers today + Viewer V2's safe-snapshot builder next.
                                # reuses barLevel/worseLevel/cbMetrics/accruedCbBalance (cbMetrics),
                                # computeStrikeLtv (strikeCredit), CB_LLTV (runCoinbaseLoan). credit risk
                                # band CREDIT_WARN_USED 0.75 / CREDIT_ACT_USED 0.90 (the owner's capacity bar
                                # is always-green — the returned creditLevel is deliberately IGNORED owner-
                                # side; the viewer colors it. Owner `state` is credit-EXCLUDED, unlike
                                # deriveViewerOverall). SafetyDashboard/ViewerHomeView subscribe the selector
                                # via useShallow (re-render only when a mapped value changes)
                                # The plan of record's Run 4 — D7, Coinbase at support: SafetyViewInputs gains
                                # cbLimitAtSupport (selectSafetyViewInputs sets planCbLimitOf(s), lib/planPolicy) and
                                # supportToday (a clock read the CALLER passes — powerLaw's supportToday(todayISO) = the
                                # plan's S₀, plBandAt('floor', …, 0)); SafetyView gains cbAtSupport (cbAtSupportOf: accrued debt ÷
                                # (collateral × S₀), the limit, `over` by the placement's rule — ceilingHeadroomUsd past
                                # the dust floor — and level watch / safe: amber, never red; null with no loan, no debt or
                                # no support) · cbAtSupportLine(r, money) (the line under the Coinbase bar; no price when
                                # r.support is null; Run 4.1, BL29: "If BTC were at support ($S): X% LTV — over the
                                # plan's L% limit", or "within", by r.level; the figure agrees with the word, and a limit
                                # with a decimal prints it) · CB_AT_SUPPORT_WATCH · ownerSafetyVerdict(view, hasCbLoan) (the
                                # owner's eyebrow: the worse of today's bars and the at-support reading) ·
                                # deriveViewerOverall folds the at-support level. D9: ViewerSafeSafety gains
                                # cbLtvAtSupport / cbAtSupportLevel and SafeSnapshot.thresholds cbLimitAtSupport (absent
                                # on older snapshots); scaleSafetyView passes them unscaled and folds the level;
                                # computeViewerSafety returns cbAtSupport (safe: no price; trusted: live, with S₀). New
                                # imports: ceilingHeadroomUsd (supportPolicy), planCbLimitOf (lib/planPolicy), fmtUSD /
                                # fmtUSDCents / fmtLtvPct / shownUsd (utils/format) — no belief: today's support arrives as
                                # an input, so scenarioDiff, which imports only safetyView, still reaches no model (pinned
                                # in ATS). D-R4-1:
                                # ownerAtSupportLine(r, moveBringsWithin) — the owner's line: cbAtSupportLine to the cent, +
                                # CB_MOVE_BRINGS_WITHIN ("; this month's move brings it within") when over and this month's
                                # move is the fix (Safety reads the position as it stands, THIS MONTH's card after the move).
                                # Tested in __tests__/safetyAtSupport.test.ts (ATS, MOVE, VERDICT, VIEWER)
    scenarioDiff.ts             # Phase 3a — Scenario Diff/Pin PURE model (UI is 3b). PinnedScenario {label,
                                # pinnedAt, btcPrice, inputs: SafetyViewInputs} + ScenarioOverlay (optional
                                # levers mapping 1:1 onto SafetyViewInputs members: btcPrice/advisorActualBloc
                                # Balance/currentBtcHeld/creditLine/cbLoanBalance/cbCollateralBtc; absent = keep
                                # base). applyOverlay (pure spread-substitution, present-but-undefined never
                                # clobbers) + diffScenarios(a,b) → runs deriveSafetyView on BOTH → three
                                # DimensionDiffs {from,to,delta,fromLevel,toLevel,worsened} for capacityUsed/
                                # strikeLtv/cbLtv (levels come OFF the views, never re-banded; worsened via
                                # worseLevel) + crashLtv/cbLiqFrac from/to pairs + overallFrom/To (deriveViewer
                                # Overall) + worsenedCount 0–3 (CB counted only when base hasCbLoan). Imports
                                # safetyView ONLY (§2/§7 walls — nothing from cycleModel/powerLaw/emergency
                                # Model/store). Tested in __tests__/scenarioDiff.test.ts
    logUtils.ts                 # (recomputeBtcHeld DELETED, spec v3 — monthly btcHeld is RECORDED by rollupMonth),
                                # deriveCurrentPosition (v20: takes currentStrikeCollateral, NOT pending/baseBtcHeld;
                                # deriveAdvisorStart left with runAdvisor in 5e) + deriveStrikeCollateral (v20 Collateral-Truth — reading-anchored
                                # current Strike collateral: strikeCollateral-bearing balanceReading latest by (date,ts) +
                                # target:'strike' moves strictly after; = getCurrentBtcHeld),
                                # upsertEntry — standalone, no cross-sim imports. Daily Mode P1: strategyMonthIndex
                                # (calendar-anniversary, UNclamped) + bucketEventToMonth (clamp 1–12) — THE month clock
                                # (runAdvisor's getCurrentStrategyMonth/isStrategyComplete now delegate here) + rollupMonth (DayEvent[] →
                                # { entry: Partial<MonthlyLogEntry>, collateralDelta }) + deriveCbCollateral (P2a:
                                # latest cbCollateral-bearing event by (date, then orderTs) across balanceReading + cbCollateralReading,
                                # fallback to the cache — never undefined) + latestStrikeDepositISO (the plan of
                                # record's Run 2, D9): the latest LOGGED target:'strike' deposit's date, any age (or
                                # null) — Strike's 60-day hold's ONE fact. The hold only ever depends on the latest
                                # deposit, so this date is all a trusted viewer (no journal) needs: the trusted
                                # snapshot carries it pre-derived as `strikeLastDepositISO`
                                # + computeExpenseReanchor(monthlyLog, expenses, dismissedAt, beforeMonth = ∞) — THIS
                                # MONTH's expenses prompt's predicate (spec §9). The plan of record's Run 4 (F-R4-1): only
                                # months before `beforeMonth` that record expenses (> 0) count; THIS MONTH passes
                                # currentMonth (12 once the year is done — month 12 keeps every later draw, so never counts)
                                # + orderTs (Hotfix 1 — `at ?? ts`, where an event falls in its day: every "latest" and
                                # "after the anchor" rule orders by (date, then orderTs); ts stays the merge's version)
                                # + ownReadingAfterEdit (an edited Strike move's own reading — same date, same place —
                                # moved by the change, in whole sats; updateDayEvent writes both in one set)
    mergeRecords.ts             # PURE records merge (RecordsState = entries+deletions+dayLog+dayLogDeletions, mergeRecords).
                                # Per-month entries: newest updatedAt/loggedAt wins, tombstones, 90-day GC. P3: dayLog
                                # union-by-id (higher ts wins, exact tie→local) + dayLogDeletions tombstone suppression
                                # (strict >, edit-after-delete drops the stale tombstone, 90-day GC); deterministic sort by ts,id
    fire.ts                     # Batch 1 build 3 — THE FIRE ENGINE, the sell lane (spec pbloc-spec-batch-1-v1 §2.3; engines.md
                                # § The FIRE engine). fireTimeline(x, prices) → one row a month (the price, the inflation step,
                                # ₿ and the other assets at the month's start, the market portfolio, afterTaxUsd — the run-out
                                # test's value, FI's and the scale's — the two needs, needBtc, yearsFunded / needYears, the
                                # savings, the draw, ₿ bought or sold, the tax, the phase) + the stop month used, FI against
                                # each need, the run-out month and the lowest point; withdrawalCapacity (the $10 search from the
                                # owner's stop month, held fixed; hi binding said); fundedSpending (E3), fireTargets (E4),
                                # yearsOfFundedSpending (the scale). 🔴 + − × ÷ only and ONE import, ./taxes (D-1 A): no belief,
                                # no engine; prices a plain number[], the horizon its length. Tested in __tests__/fire.test.ts
                                # (PARITY against goldens/fireParity.golden.json — the reference model's; G-FIRE against
                                # goldens/fireTimeline.golden.json — fire.ts's own, exact)
    fireBreakEven.ts            # Batch 1 build 3 — the break-even growth (the FIRE plan's M3): breakEvenGrowth(x, prices) — the
                                # face's stop month held fixed, steady paths p0 × (1 + g)^(m/12) bisected in −50% … +100% a
                                # year; null when nothing lasts. ⚠ Math.pow, so outside fire.ts's exact core and tolerance-tested
                                # only (__tests__/fireBreakEven.test.ts — M3, MONOTONE)
    taxes.ts                    # Batch 1 build 3 — ONE capital-gains formula (the FIRE plan's R1(d)): CAPITAL_GAINS_TAX_RATE 0.30
                                # (Living's; useLivingSimulation passes it), capitalGainsTax (Living's formula, lifted from
                                # runSellToLive's two sites in their own order — the Living tab bit for bit) and sellToNet (the
                                # sell lane's closed form). Zero imports, + − × ÷. Tested in __tests__/taxes.test.ts (LIVING)
    cycleReplays.ts             # Batch 1 build 3 — the bear-market replays, a BELIEF leaf beside cyclePath (imports only
                                # ./powerLaw): deriveReplays(history, today) — each cycle's top (the late 2013, Dec 2017 and
                                # Nov 2021 windows) and every month-end close after it ÷ the top, through the reclaim;
                                # monthEndCloses (breakerFromHistory's rule, restated — MONTH-END ≡ BREAKER pins the two equal);
                                # replayPath (spliced at the stop month's price, then the trend tail: plConvergencePath at
                                # Infinity). No price series is committed (D-2). Tested in __tests__/cycleReplays.test.ts
    __tests__/
      smartBloc.test.ts
      living.test.ts
      mining.test.ts
      monthlyLog.test.ts
      aprAnchors.test.ts
      strikeCredit.test.ts
      strikeCreditHardening.test.ts   # Hardening 1 — HS-01
      cbMetricsHardening.test.ts   # Hardening 1 — HS-02, HS-03
      safetyViewHardening.test.ts   # Hardening 1 — HS-04…HS-11
      runCoinbaseLoanHardening.test.ts   # Hardening 1 — HS-13, HS-14
      logUtilsHardening.test.ts   # Hardening 1 — HJ-05, HJ-06, HJ-07, HJ-25, HJ-26
      cyclingSimHardening.test.ts   # Hardening 1 — HE-02, HE-06, HE-07, HE-10, HE-11, HE-27…HE-31
      supportPolicyHardening.test.ts   # Hardening 1 — HE-26
      crashPlaybookHardening.test.ts   # Hardening 1 — HE-12, HE-13

  hooks/
    useBtcPrice.ts              # Coinbase API, 60s interval; syncs store on every fetch (gated by btcPriceMode); returns isStale (5-min threshold, 30s self-tick). Each store push goes through setBtcPrice, which now ALSO stamps btcPriceUpdatedAt (per-device staleness clock — DevPanel readout). Poll gated on the now-self-correcting usePageVisibility. MOUNTED AT AppShell ROOT so the poll runs for the whole session (Simple Mode mounts no price-consuming sidebar — without this, btcPrice froze at its last persisted value in Simple Mode); per-tab sidebar calls remain (harmless co-mounts)
    usePageVisibility.ts        # !document.hidden, SELF-CORRECTING (iOS-PWA resume fix): updates on visibilitychange + window focus/pageshow + a 20s interval re-read (one shared sync = setIsVisible(!document.hidden); the primitive bail-out adds no re-renders). visibilitychange ALONE misfires on iOS PWA launch/resume → isVisible could stick false → consumer polls (useBtcPrice/useBtcHistory) died forever; the extra signals recover it. Still genuinely pauses when backgrounded (NOT hardcoded true)
    useBtcHistory.ts            # BTC candle history (1H/1D/1W) via same-origin /api/btc-candles proxy; usePageVisibility gate + slow 60s refresh (NOT a tight poll); NEVER written to the store; pure parseCandles (Coinbase [t,low,high,open,close,vol] newest-first → asc close series, s→ms) + RANGE_CFG. BL23 (the plan of record's Run 4): the request AND its body run inside utils/timeLimit's withTimeLimit (15 s), so a stall ends as failed; a range change or an unmount aborts the request in flight. 5e (F12): it draws the range's history from this device's copy (lib/btcCandlesCache, through useSyncExternalStore — every mounted chart redraws when any fetch lands) at ANY age and refreshes behind it; `asOf` is the history's time once it is more than 5 minutes old (the chart labels it), and a timer labels a history on screen the moment it crosses (offline, nothing renews it); a landing goes through the cache's newer-wins rule; a range draws only its own history; a load that fails keeps whatever it can draw, and only with nothing to draw sets `error` (the chart's "price history unavailable"). Run 4's `shownRange` is gone
    useCountTo.ts               # 5e (F12) — the chart's headline counts to a new figure over COUNT_MS (400 ms), easing out (pure countFrame, + − ×): the device's copy handing over to the live history, and every refresh that moves the price. Never on the first draw, from no figure (the "BTC" placeholder) or with reduced motion (useReducedMotion); frames on requestAnimationFrame's timestamps, never Date.now (the e2e fixes Date.now); the figure on screen in a ref (StrictMode-safe). Tested in src/hooks/__tests__/useCountTo.test.ts (COUNT)
    useSimulation.ts            # Smart BLOC tab simulation hook
    useLivingSimulation.ts      # Living on Bitcoin tab hook
    usePowerLawData.ts          # Blockchain.com historical price (via Vercel proxy in prod). BL23 (the plan of record's Run 4): the request AND its body run inside utils/timeLimit's withTimeLimit (15 s), so a stall ends as failed (error "Blockchain.com timed out") — THIS MONTH then shows its cached breaker's line, the Decision face says the history didn't load, the Power Law face says it is unavailable; an unmount aborts it and sets nothing
    useMorphoRate.ts            # Live Morpho borrow APY for the confirmed cbBTC/USDC Base market via same-origin /api/morpho-rate; usePageVisibility gate + slow 5-min refresh; ephemeral, NEVER stored/synced; pure parseMorphoRate (GraphQL state.borrowApy/netBorrowApy fraction → percent ×100, null on malformed). Display-only reference beside the manual cbAprPct (Settings APR field AND the SafetyDashboard CB anchor editBox) — never feeds CB math
    useRelayStatus.ts           # Network subpage P3 — live per-relay connection dots. Owns its OWN dedicated NRelay1
                                # probe sockets (idleTimeout:false — NOT useNostr()'s NPool, which drives zero I/O and
                                # whose 30s default idleTimeout would self-close a status-only socket → false-offline
                                # dots; liveSync uses a separate nostr-tools SimplePool, so nothing is shared). Reads
                                # socket.readyState + listens websocket-ts open/close/error/retry/reconnect; pure
                                # readyStateToStatus (1→connected, 0/retry/reconnect→connecting, 2/3/close/error→
                                # offline). Sockets shared with nothing → cleanup removeEventListener AND relay.close()
                                # (the inverse of "never close shared sockets" — correct because they're ours). Effect
                                # keyed on the STABLE urls.join(',') (no re-subscribe thrash); functional setState
                                # early-returns on no-change. Probes ONLY the urls passed in (SettingsMain gates on
                                # settingsPage==='network' && !backupGated ? nostrRelays : EMPTY_RELAYS — no sockets unless viewing it)
    usePlanLoading.ts           # 5e (F1) — the "Loading your plan…" screen's state for AppShell ({ up, slow }), from
                                # lib/nostr/firstPull through useSyncExternalStore (the server snapshot too, so a static
                                # render works). Tested in src/lib/nostr/__tests__/firstPull.test.ts (GATE)
    usePlanLoad.ts              # 5c — the plan-load state for the screens: usePlanMissing (lib/nostr/planLoad's
                                # planMissing over the store) · usePlanPull (the last plan pull, useSyncExternalStore) ·
                                # planNotLoadedWhy / usePlanNotLoadedWhy (the reason in plain words; null until a pull
                                # has settled one, or the key waits on its backup) · startNewPlanHere (after a pull that
                                # found nothing, the owner's "Start a new plan" — confirmed, the one way a device ends the
                                # wait without the plan) · the copy (PLAN_NOT_LOADED_TITLE / _BODY, NO_PLAN_BODY,
                                # START_NEW_PLAN_LABEL / _CONFIRM, LOGGING_PAUSED). Read by AppShell's "⚠ Plan not
                                # loaded" pill (→ Settings), Settings' PlanNotLoadedNotice, EventSheet (the note; Save
                                # and Delete off), DailyModeView (no sign-off banner) and NoPlanNotice
    useSyncBlocked.ts           # 5b — the sync channels whose latest payload the size guard refused (syncGuard), via
                                # useSyncExternalStore; CHANNEL_LABEL + TOO_LARGE_COPY, the plain words. Read by AppShell's
                                # "⚠ Too large to sync" pill and Settings' SyncTooLargeNotice
    usePointerDrag.ts           # Gesture & Motion System P0 — the single gesture PRIMITIVE. A THIN React adapter over
                                # the pure src/lib/gestureModel.ts state machine, Pointer Events only (touch/mouse/pen).
                                # usePointerDrag(config & {onMove?,onArm?,onDisarm?,onEnd,enabled?}) → {onPointerDown}.
                                # ⚠ R2c-3 capture-on-ARM (NOT on down): setPointerCapture is deferred to the tracking→armed
                                # boundary (the onArm frame), never taken on pointerdown — eager capture retargeted the
                                # terminal pointerup/click to the sheet and SWALLOWED every DraggableSheet child click on
                                # desktop mouse (a tap never arms → never captured → its native click survives; a committed
                                # drag captures so a release over a child fires no stray click). move/up/cancel listeners
                                # live on WINDOW (not e.currentTarget) so a pre-arm drag whose travel-to-arm exceeds the
                                # element bounds still gets moves — REQUIRED by EdgeBackGesture's 20px zone vs 24px arm.
                                # teardown releasePointerCapture is a safe no-op when capture was never taken. TOUCH
                                # UNAFFECTED: DraggableSheet's P1.3 handoff keys off pointerActiveRef (set/read/cleared
                                # entirely in DraggableSheet, never by capture) + pointercancel-on-scroll is
                                # capture-independent. listeners attached { passive: true } (CSS touch-action does
                                # the scroll-blocking — NEVER preventDefault mid-gesture); pointermove feeds advance()
                                # and rAF-BATCHES onMove (one style write per frame, the codebase's first
                                # requestAnimationFrame — replaces the setInterval idiom for continuous tracking);
                                # onArm/onDisarm fire on the armed-boundary transition; onEnd(dx,dy,velocity,committed)
                                # on up/cancel. A second pointerId mid-drag synthesizes a cancel. All motion writes are
                                # the CALLER's job (transform/opacity only). enabled:false → onPointerDown is inert.
                                # Config kept in a ref so callbacks stay current without re-binding; unmount detaches +
                                # cancels the pending frame. NO consumer yet (P0 is foundation-only; P1+ wire it)
    useLongPress.ts             # Gesture & Motion System P2 — stationary press-and-hold (Pointer Events, passive).
                                # useLongPress({onLongPress,ms=500,slop=8,onProgressStart?,onProgressEnd?,enabled?}) →
                                # {handlers,holding,shouldSuppressClick,cancel}. pointerdown arms a timer; move>slop or
                                # up/cancel clears it; fires once (haptics.tick). shouldSuppressClick() swallows the
                                # click after a fired press. Calendar day cells use it → onLongPressDay opens the
                                # pre-dated add sheet; the SwipeStrip's onSwipeStart cancels a pending press (the strip
                                # captures the pointer, so the cell's own move handler can't clear it).
    useReducedMotion.ts         # Gesture & Motion System P0 — matchMedia('(prefers-reduced-motion: reduce)') → boolean,
                                # subscribed via addEventListener('change') with cleanup (usePageVisibility pattern);
                                # synchronous initial read; safe-default false when matchMedia is missing (node/test env).
                                # The JS side of the reduced-motion policy — lets finger-tracking motion drivers SNAP
                                # between rest states instead of animating (gestures still FUNCTION; the global.css block
                                # strips CSS transitions/animations). NO consumer yet (P1+)
    useMediaQuery.ts            # Sticky controls — useMediaQuery(query) → boolean, useReducedMotion's pattern (a synchronous
                                # first read, then addEventListener('change'); false when matchMedia is missing). The control
                                # dock reads '(min-width: 1024px)' for ONE markup at a time: the bar from 1024 px, the tabs below
                                # it. The three parents' Milestones read MS_TABLE / MS_TABLE_OWNERSHIP (cyclingFaceView)
                                # the same way — the table from 768 px, the switch table under it (§ Milestones on a phone)
    useChartZoom.ts             # Chart zoom — the thin React adapter over lib/chartZoom (§ Chart zoom). useChartZoom(
                                # full: View, scales, reach = full, min = MIN_SPAN_TIME_LOG) → { view, zoomed, mode,
                                # pressMode, zoomIn, zoomOut, reset, dragging, quiet, areaRef, boxRef, plotStyle,
                                # plotWidth, probe, note: { text, fading } | null, touchAction }. `full` is HOME (the
                                # opening view, Reset's target) and NON-NULL: an adopter mounts it only once it has an
                                # extent. `reach` (a memo) is how far zoom-out and pan go; every normalizePins call passes
                                # it (chartZoomWiring pins that). Clamps at RENDER + a tolerant write-back (the clampMonth
                                # pattern). The gesture state (drag · pinch · the Z6 stroke · the Z17 `wake`) lives in ONE
                                # effect closure per chart — never module state (Z11); only the once-per-session note
                                # flag is module-level. Window listeners once a gesture starts, rAF-batched, capture on
                                # ARM — usePointerDrag's PATTERNS, not the hook (its axis lock cancels a box, a second
                                # pointer cancels a pinch). The touchmove is the ONE non-passive listener (the pinch; Z6's
                                # sideways scrub); touchstart / touchend / touchcancel / mousemove are passive. A pinch's
                                # release lands its last move, as a drag's does (Z14). pressMode = nextMode (Z15: a
                                # computer's pressed Pan clicks back to Zoom). Z17 `quiet`: set at a drag's arm and a
                                # pinch's start, NEVER cleared by the gesture's end; woken only by the first move of a
                                # touch that started ALONE (a second finger clears `wake`) or by a mousemove — a tap's
                                # compat mousemove included — and never at touchstart. The once-per-session note says
                                # "reset the view" when the view left home (leavesHome). VIEW ONLY — nothing is persisted

  store/
    useStore.ts                 # Zustand store — Phase 1c: now COMPOSITION ONLY (~44 lines). Spreads the 9 slice
                                # creators into ONE create<StoreState>()(persist((set,get)=>({…}), persistOptions)) +
                                # the import-compat re-exports (storeEncEnabled/gateHydratedIdentity from bootstrap,
                                # partializeState/migrateState from persistConfig, StoreState/ViewerSlot + sim types +
                                # KeyProvenance). Phase 1b: the publish/orchestration layer was EXTRACTED to
                                # syncEngine.ts + payloads.ts; the store reaches the engine via DYNAMIC import only
                                # (kickRecordsPublish / the emit layer's schedulePlanPublish + schedulePrefsPublish kicks
                                # — no static back-edge, the syncNow precedent; 4e retired scheduleSettingsPublish)
    types.ts                    # Phase 1c — the StoreState interface + ViewerSlot + local aliases (Tier/Scenario/
                                # ActiveTab/LtvType), moved verbatim, type-only imports (no runtime edge). Adds
                                # StoreSet/StoreGet — the zustand handles every slice creator receives (so slices type
                                # against the store WITHOUT importing it — the cycle rule)
    bootstrap.ts                # Phase 1c — module-init plumbing (order-sensitive, runs before create()): storeEncEnabled
                                # flag · the standalone WK_*/GATE_* credential+gate keys + their seed IIFEs (localStorage
                                # side-effects + one-time back-fills) · gateHydratedIdentity · defaultMiningInputs ·
                                # kickRecordsPublish (dynamic engine import). Consts/seeds EXPORTED for the slices +
                                # persistConfig. References no store singleton
    dailyRouting.ts             # Phase 1c — the daily-routing helpers (strategyMonthDate/refresh*Cache/refreshBalance-
                                # Anchors/readingCtx/isMonthlyMeaningful/rerollMonth/monthOf). Store-touching ones take
                                # leading set/get params (getState()→get(), setState()→set()); pure ones verbatim. ⚠ NO
                                # "useStore" substring anywhere (the grep gate); called from dayLog+monthlyLog slice actions
                                # 5d: buyDollarsOnlyEdit(before, after) (both buys, the same id, date and BTC) · monthEntryCurrent(get,
                                # month) — the lag check: no event of the month newer than the entry's last save, and BTC bought the
                                # events' (it can't see a deletion of anything but a buy, an entry-only change such as an un-sign, or an
                                # event other than a buy older than the save — spec §7) · rerollMonth(get, month, { dollarsOnly }), whose
                                # dollars-only path writes only Income → BTC onto the stored entry — its sign-off and every other figure stay
    persistConfig.ts            # Phase 1c — partializeState + migrateState (verbatim) + the persist OPTIONS as an exported
                                # `persistOptions` (annotated PersistOptions<StoreState, ReturnType<typeof partializeState>>
                                # so its standalone merge/onRehydrate callbacks keep param types). Imports bootstrap +
                                # leaves; does NOT import useStore
                                # + __tests__/persistConfigHardening.test.ts (HJ-08…HJ-13, HY-17…HY-20, HK-13, HK-14 — Hardening 1: each migration keeps what is stored)
    slices/                     # Phase 1c — 9 domain slice files, each `type XSlice = Pick<StoreState,…>` + a
                                # `createXSlice(set, get): XSlice` creator (mining takes _get, unused). ui · planInputs ·
                                # mining · cbLoan (incl. Strike-API display fields) · advisorJournal (advisor+monthlyLog) ·
                                # dayLog · identity (nostr credentials+backup-gate) · viewer (roster+viewer-side) · sync
                                # (auth/flags/the plan + prefs emit layer/hydratePrefs + applyViewerSettings [4e — the two RAW
                                # appliers that replaced hydrateSettings; pinned on the REAL store by
                                # store/__tests__/viewerSettingsApply.test.ts]/applyPlanBackup + the remotePlanFoundResolved latch). EVERY StoreState key in EXACTLY ONE slice (slices.test.ts pins disjoint+union). ⚠ NO
                                # "useStore" substring (grep gate); the only body change is getState()→get(); the two dynamic
                                # import paths deepened one level (../../lib/nostr/...)
                                # The plan of record (Run 2): ui += planNoteDismissed + planBreakerCache (with plain-`set`
                                # setters); viewer += viewerStrikeDepositISO (raw-set by viewerSync's trusted apply, reset
                                # by clearViewerData) — the three device-local keys (§ Zustand Store Shape)
                                # Batch 1 build 4: planInputs += fireInputs + setFireInputs (a plain merge; null resets) —
                                # device-local, in no field list (store.md § FIRE's own inputs)
    payloads.ts                 # Phase 1b — the two PURE snapshot builders, moved verbatim out of useStore:
                                # buildSettingsPayload(s) (the 46-key settings payload, BL14's goal included — single source for the
                                # trusted viewer snapshot + the plan backup; 4e: no longer a relay payload of its own)
                                # + buildViewerSnapshotPayload(s, tier)
                                # (C-safe ratios / C-trusted full). `import type { StoreState } from './useStore'`
                                # (type-only — no runtime edge); nothing in useStore imports payloads. Consumed by
                                # syncEngine, exportPlan, ViewerPreview, tests. The plan of record (Run 2, D9): the
                                # C-trusted branch adds a top-level `strikeLastDepositISO` (latestStrikeDepositISO over
                                # the owner's dayLog — Strike's hold's one fact); the C-safe branch never carries it.
                                # The plan of record's Run 4 (D9): the C-safe branch runs deriveSafetyView with today's
                                # support (supportToday(todayLocalISO())) and adds thresholds.cbLimitAtSupport
                                # (planCbLimitOf(s)); its safety block (buildSafeSafety) gains cbLtvAtSupport /
                                # cbAtSupportLevel — ratios and a level, no new top-level key

  lib/
    demo/
      demoSeed.ts               # C0 — sandbox demo seed. PURE buildDemoSeedState(today) (exported, tested) + a
                                # top-level side-effect block gated `if (import.meta.env.VITE_DEMO === '1')` that
                                # writes the showcase plan to localStorage on EVERY load (that re-write IS the
                                # reload-reset). Seeds onboarded=1, REMOVES identity GATE keys + writer keys + the
                                # enc flag (no stale leak), writes the plan blob at DEMO_SEED_STORE_VERSION (=21, must
                                # equal the persist version). Showcase: advisorStartDate = today−7mo (Month 8), manual
                                # btcPrice for a deterministic dashboard (Strike LTV green, CB LTV ~72% watch band),
                                # 7 confirmed source:'manual' months (≥1 paydown), a Month-8 dayLog with a
                                # strikeCollateral-bearing balanceReading, monthBucketReconcileDone:true (or the
                                # one-shot reconcile deletes the seeded history), NO identity/viewer fields.
                                # ⚠ Imports ONLY utils/format, lib/storeVersion, simulation/runCoinbaseLoan + type-only shapes — must never pull useStore (main.tsx
                                # imports it FIRST, before the store's module-init IIFEs read localStorage)
    planEvents/                 # Phase 4b — event-sourced plan core (PURE leaves; ZERO wiring — no store/sync/
                                # publish/d-tag/emitter yet, all 4c). Runtime import ONLY from store/settingsFields
                                # (a zero-import leaf); everything else type-only. Design authority: the 4a plan-events
                                # design lock (§4 shape / §5 fold / §7 compaction / §9 union / §10 genesis).
      types.ts                  # PlanEvent { id, ts, device, kind:'set', field: PlanField, value: unknown } — mirrors
                                # DayEvent's {id,ts} base + the (ts,id) total order, NO date field. PlanState =
                                # Pick<StoreState, PlanField>. ⚠ kind:'set' ONLY — NO delete/tombstone: absent-from-log
                                # = seed default, set-to-empty (viewers=[], null) = an EVENT (§6, the whole point).
                                # viewers/nostrRelays are whole-array set values (op-events = the D2 multi-writer
                                # upgrade path); AsOf pairs stay 1:1 same-ts field events (paired-emit is 4c)
      fold.ts                   # foldPlanEvents(events) → Partial<PlanState>: sort (ts,id), latest-per-field, absent
                                # fields ABSENT (never seeded here). unionPlanEvents(a,b): union-by-id KEEP-FIRST
                                # (append-only ids are unique → a dup is an identical echo; DELIBERATELY unlike
                                # mergeRecords' higher-ts-wins, which exists because dayLog edits in place — plan
                                # events are never edited). Pure, deterministic (ts,id) output
      compact.ts                # compactPlanEvents(events, now): keep latest-per-field FOREVER; keep a superseded event
                                # only while it is <90d old (90*24*60*60*1000, the mergeRecords TTL mirror) AND its field's
                                # NEXT event, in (ts,id) order, follows more than BURST_WINDOW_MS (10 s) later — 5a's burst
                                # rule: a drag keeps its last notch, a same-ts tie keeps the (ts,id) winner, and it never
                                # reads `device`. Then 5a's budget: the history is trimmed OLDEST FIRST until the payload
                                # {"events":[…]} (the log + 11 bytes) fits PLAN_LOG_BUDGET_BYTES (32,768 — a full NIP-44
                                # padding step under 40,960); a latest is never trimmed. Merge-safe (§7): every rule drops
                                # only superseded events, so fold(compact(e,now)) ≡ fold(e); idempotent; a stale device
                                # re-unioning a compacted-away event is harmless (fold picks the true latest, re-compaction
                                # sweeps it). Tested in __tests__/planLogSize.test.ts (FOLD-SAFE, CONVERGE)
      genesis.ts                # nextPlanEventTs(lastTs, now=Date.now()) = max(now, lastTs+1) (monotonic guard) ·
                                # makePlanEventId(field, ts, rand=Math.random) = `${field}-${ts}-${rand4}`
                                # (recoveryQuiz rand-injection). Zero runtime imports. Phase 4e RETIRED
                                # synthesizeGenesisEvents (the one-time seed of a log from a pulled settings:v1 — one
                                # set-event per present key, ids genesis-${field}-${ts}, ts staggered) with the channel it
                                # read; the file keeps its name so the emit layer's imports don't move, and logs migrated
                                # at 4c still hold genesis-* ids. Tested in __tests__/planEvents.test.ts
      coverage.ts               # Phase 4e (G2) — planLogGaps(events, live, seed): the PLAN_EVENT_FIELDS absent from
                                # foldPlanEvents(events) whose live value differs from the seed (JSON compare). PURE.
                                # DevPanel's "log gaps" row reads it against useStore.getInitialState() (zustand 5.0.13's
                                # persist: the pre-hydration seed). Names only. A field held at a non-seed value the log
                                # never carried would come back as its seed on a new device or after an escape hatch
                                # (parity can't see it). Tested in __tests__/coverage.test.ts
    backupGate.ts               # R2a-1 — the backup-gate predicate. PURE, ZERO imports (no cycle):
                                # isBackupGateSatisfied({keyProvenance, backupVerifiedAt}) = keyProvenance !== 'generated'
                                # || backupVerifiedAt != null. A key this device GENERATED is the only copy until the
                                # user proves they saved it → nothing syncs/publishes. 'imported'/'external' are satisfied
                                # by construction (the user holds the key elsewhere); null = LEGACY (pre-R2 plan), satisfied
                                # STRUCTURALLY via the persist merge — deliberately NO migration. Consulted at exactly the
                                # layer isAuthenticated is (11 guard sites); NEVER on viewer paths. See § Backup Gate
    planPolicy.ts               # The plan of record (Run 1) — the support policy's settings as the owner's SAVED plan:
                                # the ONE source, PURE, ZERO imports (the backupGate.ts precedent — the store and the
                                # faces both read it; PLAN FIELDS pins it). PLAN_POLICY_DEFAULTS (C1, frozen) ·
                                # PLAN_POLICY_RANGES (the sliders' ranges) · PLAN_POLICY_FIELD (each setting's store key:
                                # policyCbStopAtSupportPct, policyStrikeStopAtSupportPct, policyAccumulateBelow,
                                # policyPayDownAbove, policyBearBufferMonths, policyCashReserveMonths) · PLAN_POLICY_KEYS ·
                                # PLAN_POLICY_SEED (the six store keys at C1, for the seed resets) · clampPlanPolicy(k, v)
                                # (a finite number into its range; anything else → the default) · planPolicyOf(state)
                                # (the six, read THROUGH the clamp — a restore writes what no setter wrote). No off
                                # switch: there is no seventh policy field (BL14's goal is the plan's own field, in
                                # planGoal.ts below). See § The plan of record (Run 1)
                                # The plan of record's Run 4: PLAN_CB_DEFENSE_PCT 70 (the plan's Coinbase defense line —
                                # planClamp's PLAN_CB_LTV_CAP_PCT reads it, ONE constant) · planCbLimitOf(s) — the plan's
                                # Coinbase limit at support as the plan runs it, a fraction, from store-shaped state (the
                                # clamp, then held to the defense line); Safety's selector and the safe snapshot read it,
                                # and safetyAtSupport.test pins it equal to planPolicySettingsOf(…).cbStopEffPct / 100
    planGoal.ts                 # BL14 (batch 1, build 2) — the plan's goal amount: PURE, ZERO imports (the planPolicy.ts
                                # precedent). PLAN_GOAL_FIELD ('planGoalNetBtc' — one plan event per change; null = no
                                # goal) · PLAN_GOAL_MAX_BTC (21M) · planGoalOf(v) — THE read rule every reader goes through
                                # (a finite number above zero, to the satoshi, at most 21M; anything else, junk from a
                                # restored backup included, is no goal) · parseGoalInput(raw) — Settings' field: empty →
                                # null (clears), an amount above zero → it, anything else → undefined (changes nothing).
                                # See store.md § BL14
    fireInputs.ts               # Batch 1 build 4 (D3 A) — the FIRE face's own inputs: PURE, its one import the zero-import
                                # tax leaf (CAPITAL_GAINS_TAX_RATE — the planPolicy.ts precedent). FireFaceInputs ·
                                # StoredFireInputs (what the store keeps: only what was typed; null = every default) ·
                                # FIRE_INPUT_DEFAULTS (none leans hopeful: 4% / 4%, nothing assumed, the return no more than
                                # inflation, Living's tax) · FIRE_INPUT_RANGES (each field's, and its NumberInput's min / max)
                                # · FIRE_TAX_PCT_DEFAULT (30, derived) · fireInputsOf(raw) — THE read rule (a field missing,
                                # junk or out of range reads its default; a cost of 0 is no cost; whole years only) ·
                                # fireTaxRateOf. ⚠ The face memoises the read on the stored object, never once a render.
                                # See store.md § FIRE's own inputs. Tested in src/lib/__tests__/fireInputs.test.ts
                                # (DEFAULTS, READ RULE) and src/store/__tests__/fireInputsStore.test.ts
    recoveryGrid.ts             # R2b-3 — PURE logic for WordGrid's input mode (12-box capture). Imports wordlist
                                # (@scure/bip39/wordlists/english.js) + validateWords (nostr-tools/nip06) + RECOVERY_WORD_COUNT.
                                # distributePaste(tokens,focusedIndex) → 'fill-from-start' (12 exact) | [] (0/1 token →
                                # native paste passthrough) | truncated slice (2–11 from the focused box, clamped to box 12);
                                # suggestWords(prefix,max=4) (≤4 prefix matches, lowercased); phraseStatus(values) →
                                # 'incomplete'|'valid'|'bad-checksum' (validateWords over the normalized phrase);
                                # isWord(w) (per-box tint, WORD_SET membership). ⚠ CAPTURE UX ONLY — skFromWords on submit is
                                # the validity authority; green/checksum are HINTS (same discipline as recoveryInput not
                                # owning validity). Tested in src/lib/__tests__/recoveryGrid.test.ts
    recoveryQuiz.ts             # R2c-1 — PURE verify-step logic for RecoveryKeyCeremony. pickQuizIndices(rand = Math.random)
                                # → two DISTINCT indices 0–11, LOOP-FREE (b = (a+offset)%12) so a constant rand can't hang it;
                                # `rand` is injectable for deterministic tests (this ESTABLISHES the rand-injection convention —
                                # the repo had none). checkQuizAnswers(words, indices, answers) (trim+lowercase, POSITION-
                                # sensitive → transposed answers fail). checkNsecTail(nsec, input) (last-6, input trimmed only,
                                # CASE-SENSITIVE as bech32 is lowercase). R2c-7b-fix: checkBackupPassphrase(expected, input)
                                # — the ENCRYPTED path's verify. ⚠ TRIMS BOTH SIDES (the ceremony encrypts with
                                # filePass.trim(), so the trimmed passphrase is what actually opens the file; comparing
                                # untrimmed would FALSE-MISMATCH a re-entry that would decrypt it perfectly). Case-sensitive;
                                # inner whitespace significant (NOT a seed phrase — no normalization); an empty expected
                                # never passes. ⚠ The encrypted path is NOT a word quiz: the saved artifact is a
                                # passphrase-locked ncryptsec, so quizzing the words would verify something the user never
                                # saved. Tested in src/lib/__tests__/recoveryQuiz.test.ts
    chartZoom.ts                # Chart zoom — the PURE, VIEW-ONLY math (§ Chart zoom). ZERO imports (chartZoomWiring pins
                                # it). The view is two domains, each axis AUTO (null — the chart's full extent) or PINNED;
                                # every op runs in SCALED space (identity / ln), so +/−, pan, pinch and the clamp are one
                                # code path on both axes. Domain = a MUTABLE [lo, hi] tuple (it passes straight to a
                                # recharts `domain`). toUnit/fromUnit/pxToX/pxToY (y inverted)/clampToRect/inRect ·
                                # classifyBox (Plotly's dragbox rule: MIN_DRAG_PX 8, BAND_PX 20)/boxRect/boxToPins ·
                                # lockAxis (Z6: null under 8px — it may be a tap; more sideways than vertical → 'x', the
                                # page holds; else 'y', it scrolls) · ZoomMode + nextMode (Z15: an unpressed button
                                # selects its mode; the pressed one returns a computer to Zoom, a touch device to Scroll)
                                # · scaleDomain/stepPins (ZOOM_STEP 2)/panPins/pinchPins
                                # (PINCH_AXIS_MIN_PX 40) · normalizePins(p, full, sc, min, reach = full) (raise to the
                                # minimum; a span at the REACH's IS the reach — auto when the reach is home; SHIFT into the
                                # reach, never clip; a pin back at home → auto; the reach ⊇ home, the union per axis, so
                                # reach = home is today's clamp bit for bit — test ⭐26; data shorter than the minimum →
                                # auto, Z3a)/effectiveView/isZoomed/leavesHome (a view past home: a zoom out or a pan) ·
                                # timeTicks (1 mo…8 y ladder; ≡ the old yearTicks at density 6)/tickDensity/fmtTimeTick
                                # (UTC, a fixed month table — never ICU's "Sept") · logTicks (d3-scale's log.ticks,
                                # ported)/priceTickFormatter (the chart's own formatter unless its labels repeat or a
                                # positive tick reads as zero, Z3b) · isDoubleTap/zoomBackNote(pointerType, outward —
                                # "…to reset the view" once the view left home). MIN_SPAN_TIME_LOG =
                                # { 90 days, ln 1.1 }. Tested in src/lib/__tests__/chartZoom.test.ts
    btcCandlesCache.ts          # 5e (F12) — the price chart's history kept on this device: ONE localStorage key of its
                                # own, 'bloc-btc-candles' ({ v: 1, ranges: { 1H|1D|1W: { at, candles } } }), outside the
                                # persisted store — no store version, never synced, never in a backup; read lazily into
                                # memory, with listeners for every mounted chart. A history's time = the EARLIER of `at`
                                # (when this device's fetch landed) and its newest candle's close (t + granularity), so an
                                # edge-cached copy is dated by its own candles. Drawn at ANY age unless future-dated or
                                # malformed; isOld past HISTORY_FRESH_MS (5 min — useBtcPrice's stale line) → the chart
                                # draws it muted with asOfLabel ("as of 2:05 PM" / "as of Oct 18, 2:05 PM", local, the day
                                # by toLocalISO); msUntilOld drives the label timer; writeHistory never lets a history
                                # replace a newer one (one held from the future gives way). Imports no store, and never
                                # usePowerLawData's history (the breaker's — that would be a Safety change). Device-level
                                # in wipeLocalPlanData's inventory: kept on "Remove local key". Tested in
                                # src/lib/__tests__/btcCandlesCache.test.ts (OLD, EDGE, NEWER, FUTURE, SHAPE, LABEL, STORE,
                                # OWN KEY, RANGE, MONEY)
                                # + src/lib/__tests__/ledgerCsvHardening.test.ts (HJ-23, HJ-24 — Hardening 1: CB bal / CB LTV under their own headers; RFC 4180 quote doubling)

    nostr/__tests__/            # Hardening 1 — the keys tests (HK-01, HK-02, HK-06, HK-07, HK-08; each title names its identity.md row)
      keyVaultHardening.test.ts   # Hardening 1 — HK-01, HK-02
      establishOwnerHardening.test.ts   # Hardening 1 — HK-06
      sessionHardening.test.ts   # Hardening 1 — HK-07, HK-08
    crypto/__tests__/
      cryptoClientHardening.test.ts   # Hardening 1 — HK-03, HK-04 (src/lib/crypto/__tests__/; its title names its identity.md row)

  utils/
    format.ts                   # fmtUSD, fmtMining (sats-aware) + DUST_USD / shownUsd — THE one $0.50 dust floor
                                # (W1 moved it here from supportPolicyView, which re-exports it, because
                                # src/simulation's cbSeizurePrice reads it too). A source guard pins ONE definition.
                                # + fmtTooltipUsd — THE chart-tooltip price (Power Law polish P1): the Decision AND the
                                # Power Law tooltips both print through it (powerLawWiring pins both). fmtUSD rounds
                                # to whole dollars, so a real sub-50¢ price read "$0". Whole dollars from $1; two
                                # significant digits below (never exponent notation); "under $0.01" below a cent (the
                                # power-law bands near GENESIS reach ~1e-12); "—" for ≤ 0 / not finite
                                # + fmtUSDCents — dollars to the cent (the plan of record's Run 2.1, BL19): EVERY dollar
                                # figure THIS MONTH, Daily and Daily's sheets print goes through it, through ONE cached
                                # Intl.NumberFormat (never toLocaleString with options — it builds a formatter per call);
                                # no sign, like fmtUSD. The Almanac faces, full mode's own figures and the Dashboard keep
                                # their own formatters — fmtUSD's whole dollars among them (§ Critical Constraints); the
                                # plan's card prints cents wherever it shows (THIS MONTH and, since Run 3, the Advisor
                                # tab). + toCents — a dollar VALUE kept to the cent, for a figure that
                                # seeds what gets stored (the month review's sign-off seeds, the Log sheet's minimum
                                # estimate, the NDP estimate); Number.EPSILON keeps 1.005 from rounding down; non-finite
                                # → 0
    timeLimit.ts                # BL23 (the plan of record's Run 4) — the price history's time limit: HISTORY_TIMEOUT_MS
                                # (15_000) and withTimeLimit(ms, run, outer?) — runs `run` with a signal that aborts after
                                # ms, or at once when `outer` aborts (an unmount); the timer is cleared however `run`
                                # ends. usePowerLawData and useBtcHistory fetch AND read the body inside it, so a request
                                # that never answers ends as failed. ZERO imports. Tested in
                                # src/utils/__tests__/timeLimit.test.ts (STALL)

  components/
    Layout/
      AppShell.tsx              # ALL_TABS_META array, tab bar DndContext, sidebar/main routing,
                                # hiddenTabs guard useEffect, [data-active-tab] on shell div;
                                # passes simpleView/setSimpleView as props to DailyModeView/SimpleModeView
                                # (ViewToggle lives inside each view, not here). GESTURE P3: Branch J's owner journal
                                # fork (dashboard→ViewerHomeView(ownerNav) / daily→DailyModeView / monthly→SimpleModeView)
                                # is extracted to a local renderOwnerJournal() (Branch J = viewerPreview&&!viewerMode ?
                                # <ViewerPreview/> : renderOwnerJournal()); renderSimpleUnder = viewerMode ?
                                # <ViewerHomeView/> : renderOwnerJournal() (the surface back-nav reveals). Branch H
                                # (simple-mode Settings) + Branch I (simple-mode Almanac) — the two ← Back surfaces — are
                                # each wrapped in <EdgeBackGesture onBack={()=>setActiveTab(previousTab)}
                                # renderUnder={renderSimpleUnder}> (iOS edge-swipe-back parallax; shared by owner+viewer).
                                # No other branch mounts it (gates/onboarding/full-mode shell untouched). P3.1 NESTED
                                # BACK-CHAIN: a `settingsBackRef` receives SettingsMain's one-level-back handler (via its
                                # registerBack prop); Branch H's edge onBack = settingsEdgeBack (subpage→list first, else
                                # exit Settings) and renderUnder = settingsBackRef.current ? null (bg one level deep) :
                                # renderSimpleUnder() — nav depth = parallax depth. The visible header ← Back is
                                # unchanged (a separate app-exit control). Branch I (Almanac, no subpages) unchanged.
                                # The plan of record's Run 3: the Almanac opens on a requested face — almanacFace
                                # (session state) → <AlmanacView initialFace> in both modes. goPlanPaths() opens the
                                # Decision face (THIS MONTH's and the Advisor tab's "Your plan on other price paths"
                                # link — the Outlook's place); an effect forgets the face once the hub is left — the one
                                # mechanism, so the nav, full mode's Tools menu and — on a device whose saved tab layout predates
                                # the Almanac, which Settings can't move out of Tools — its tab open the default. goAlmanac()
                                # (the nav) sets no face and takes NO argument — HeaderNavCluster passes it as onClick,
                                # so a click event must never become a face. Full mode passes the link only while the
                                # Almanac tab isn't hidden (planPathsInFullMode — a hidden tab bounces). AdvisorMain gets
                                # onOpenLedger (Simple mode's Daily view) and onOpenPlanPaths. The plan of record's Run 4
                                # (D3): the `liqsim` tab is always "Emergency" / "Emerg" in ALL_TABS_META (key kept;
                                # withEmergencyLabel and the cbPaymentStrategy read are gone) and still mounts
                                # <CbDefenseTool/>; CoinbaseLoanMain gets onOpenConsole (consoleInFullMode — none
                                # while the Emergency tab is hidden) and onOpenPlanPaths (planPathsInFullMode). A tab the bar doesn't show can't stay open: the bounce effect
                                # moves off a hidden tab, and — with hasCbLoan off — off `coinbase` and `liqsim` too (the console's
                                # gate would leave an empty page), to the first tab that shows. 5e (F1): between gates F
                                # and G (no new letter), one owner branch — `signedInApp && planLoading.up &&
                                # !import.meta.env.DEV` → <PlanLoadingGate/> ("Loading your plan…") while the session's
                                # first pull runs on a device without its plan (lib/nostr/firstPull — the plan, then the
                                # journal); it offers "Open the app" after 15 s, and an effect records the app on screen
                                # (markAppOnScreen), after which a later first pull never raises it. Display only — 5c
                                # refuses the writes. The one whole-app branch by design (identity.md's gate-ternary row).
      AppShell.module.css
      ViewToggle.tsx            # Shared Daily|Monthly segmented-control pill — JOURNAL's INNER control,
                                # rendered inside BOTH DailyModeView and SimpleModeView (between header +
                                # SafetyDashboard). Props: simpleView (widened to the 3-value union, renders
                                # only Daily/Monthly) + setSimpleView. CSS in ViewToggle.module.css.
      ViewToggle.module.css     # .viewToggle* rules (moved from AppShell.module.css)
      HeaderNavCluster.tsx      # Owner IA — the SINGLE 5-icon header cluster (Dashboard · Journal · Full mode ·
                                # Almanac · Settings) = owner primary nav; identical on every simple-mode surface.
                                # Props {active:'dashboard'|'journal', onDashboard/onJournal/onFullMode/onAlmanac/
                                # onSettings}. Four app icons are inline <svg> (Full mode + Almanac reuse the
                                # existing glyphs verbatim; Dashboard=gauge, Journal=ledger); Settings is the ⚙
                                # glyph unchanged. Rendered in DailyModeView + SimpleModeView headers (active
                                # 'journal') and injected into ViewerHomeView via ownerNav (active 'dashboard').
                                # GROWTH INVARIANT: fixed at 5 — new tools become Almanac faces, never header icons.
      HeaderNavCluster.module.css # boxed 34×34 .iconBtn + .iconBtnActive (--btc accent) highlight
      DemoBanner.tsx            # C0/C2 — slim STICKY (position:sticky;top:0, C2 — not fixed) sandbox strip (+ .module.css).
                                # Mounted by ONE AppShell line `{import.meta.env.VITE_DEMO === '1' && <DemoBanner/>}` (first
                                # child of the top-level fragment → sticky keeps it in flow, PUSHING content down instead of
                                # overlaying the app header, pinned on scroll). "Sandbox — example plan, edits reset on reload
                                # · Get the real thing →" linking VITE_PUBLIC_SITE_URL || '/'. Flag unset on the owner/public
                                # builds → dead branch, tree-shaken

    Almanac/                    # (the faces are documented in § Almanac / CycleClock; listed here: Run 2's files)
      DecisionFace.tsx          # Decision face (Run B) — the TWELFTH face (+ .module.css, composes the parents'). THE
                                # MOVE card, the Coinbase-loan line, the chart, the schedule (Copy · Download .txt ·
                                # Print), the outcome strip, the what-ifs, the tap-through. ONE run, many lenses. 🔴 It
                                # composes NO sentence (I31, pinned by decisionWiring's literal scan). The chart is the
                                # memoised same-file DecisionChart sub-component (chart zoom — a pan re-renders only
                                # it, not the 60-row schedule). See § Decision face (Run B) and § Chart zoom.
                                # Policy v2 Run B (B4): ENGINE_CONTEXT — the five engine constants (mode, the two caps,
                                # the Strike margin and draw lines), ONE object that `engineInputs` spreads and the
                                # seeding gate hands to `seedsFromMove`. ⚠ Since the plan of record's Run 2 it is
                                # planRun.ts's PLAN_ENGINE_CONTEXT, and the face builds THE MOVE's input and its engine
                                # inputs through planRun's two builders (placementInputOf / engineInputsOf) — the ones
                                # THIS MONTH runs (invariant 2). Coinbase comes through planCbCollateralOf /
                                # planCbLoanBalanceOf (D-R2-4: none with the loan switched off), the minimum as
                                # strikeMinFromIncome (D-R2-7), Strike's hold through strikeDepositOf → strikeHoldAt
                                # (D9), and `moveWhatIf` (a policy or line what-if) switches the card's first line.
                                # Sticky controls (Run 1): the face's LAST child is <ControlDock> — the month and the
                                # stress live only there, and Path / Line / Policy are remote controls for the cards (the
                                # same overlay). The Inspect-month / Price-stress card is gone; its three notes read under
                                # the chart. PathPicker is ONE path picker for the What-if card and the dock's Path panel;
                                # the dock's Line is `disabled={s.viewerMode}` (R1). See § Decision face → Sticky controls
                                # The plan of record's Run 4 (D3): consoleRuns = s.hasCbLoan (the LTV-triggered strategy
                                # until then) — the crash rows' console link, the crash note on screen and in the
                                # printout, and THE MOVE's console clause read it; the face reads no cbPaymentStrategy
                                # BL32: the placement memo passes goalNetBtc: s.goalNetBtc and depends on it (THE MOVE
                                # stands down on it)
                                # BL33: the cold-storage card (ColdStorageCard, from coldCardView) under the outcome
                                # strip, showTotal={false} — the strip's first tile is its total — at the run's own buffer,
                                # PLAN_COLD_BUFFER_PCT (engineInputsOf)
      decisionView.ts           # Decision face (Run A) — the SCHEDULE and THE MOVE's copy, pure. ACTION_FIELDS is
                                # ONE field → action table in the engine's month order (a field added to CyclingRow
                                # without a row here is a step the printed schedule silently drops; a completeness
                                # sweep enumerates it). todayActions reads the PLAN, rowActions a row verbatim;
                                # planSchedule · planOutcome · coinbaseLoanLine · scheduleToText (the print
                                # artifact). 🔴 moveCard(ctx) is THE MOVE's copy AS DATA — every §7 line, in §7's
                                # order, each with a tone — so the face renders and composes NOTHING (a sentence
                                # written in JSX is one no test can reach). 🔴 The cliff is cbMetrics().liqPrice,
                                # the same formula the Safety Dashboard uses — never a second one; it reads
                                # plan.opening. 🔴 The state-line block is an EXHAUSTIVE switch with a `never`
                                # default: as an if/else chain a state with no branch fell into the READY arm, so
                                # an inert plan printed "Nothing to move". 🔴 ONE "has a Coinbase loan" predicate,
                                # `hasCbLoan && shownUsd(cbDebt)` — the setting alone let a paid-off loan print
                                # "$0 debt" and a "$0" seizure price. 'unavailable' prints the plan-of-record line
                                # and one sentence, nothing else. No figure under its dust floor is ever named
                                # ($0, 0.000 ₿, NaN, Infinity and undefined appear nowhere).
                                # Run B — the REST of the face's copy, so the face composes none (I31): the
                                # path-invariant line (PATH_INVARIANT_LINE, closes every card that renders the
                                # policy) · MoveLine.action (the line's Try $L / Back to $X button) · the breaker's
                                # 'loading' reading (BREAKER_LOADING_LINE) + breakerReading(seed, loading) · crashNote
                                # (D13, screen AND printout — scheduleToText takes a REQUIRED consoleRuns) ·
                                # consoleLinkLabel · decisionDisclaimer (Strategy's policy-aware wording) · pathNoun /
                                # pathSublabel / pathNote (DecisionPath = PathKind | the two worst options — face-local,
                                # D2; W1 — pathNote's crown sentence names the rule that crowned it, from worstBy) ·
                                # scheduleHeader · outcomeTiles · scheduleFileName · manualPriceNote · stressNote
                                # · BELOW_SUPPORT_NOTE · moveCardText · DECISION_FRAMING. ⚠ The Today row (planSchedule)
                                # and coinbaseLoanLine's "today" require sim.policyApplied — off or ignored, the card
                                # names no move, so neither does anything else. Chart zoom follow-up:
                                # SCHEDULE_KEEP_HEADER ("Strike keep" — one line, D2) + SCHEDULE_KEEP_KEY (what the
                                # column is, Z12) · ON_SUPPORT_NOTE (the legend note). Policy v2 Run B: the cliff line
                                # takes the dust floor (no "$0") and fmtBelowPct (F11), and a private alertLine follows it
                                # (B3: the price alert at the owner's trigger, or "at or past your t% trigger"; never on
                                # a sliver — R11) · seedsFromMove(seeded, PolicyRunContext) (B4 — the face's seeding
                                # gate; asks supportPolicyResolution)
                                # The plan of record (Run 2, §4.7): PLAN_OF_RECORD_LINE ("This is your plan of record's
                                # move this month — the support policy, with your settings.") / PLAN_WHAT_IF_LINE ("A
                                # what-if — your plan is unchanged.") / planOfRecordLine(whatIf) — MoveCardContext gains
                                # `whatIf`. ACTION_FIELDS gains `payMinimum` (strikeMinPaidUsd → "Pay Strike's minimum,
                                # $X, from income."); the buy sentence drops its "(≈ … ₿)" under the dust floor and the
                                # refinance never names a "$0" fee — THIS MONTH prints these sentences too, to the cent.
                                # Run 2.1 (BL19): `UsdFmt` — ACTION_FIELDS' texts, rowActions and planSchedule take a
                                # dollar formatter, whole (fmtUSD) by default: the face passes none and stays whole;
                                # planMonthSummary passes fmtUSDCents, so "Why this plan?" reads the face's own words to the
                                # cent. The words never change, only how their dollars print
                                # The plan of record's Run 4 (D3): MoveCardContext's `ltvTriggered` became `consoleRuns`
                                # (true with a Coinbase loan); the console's gate words — crashNote(false), consoleTail —
                                # read "(it runs once your Coinbase loan is switched on)" (CONSOLE_GATE); the at-or-past
                                # alert is crashPlaybookView's atTriggerLine(t, consoleRuns), one copy with the CB Loan
                                # tab's banner. + suggestedLineWords(ownerLineUsd, suggestedUsd, hasLoan, triggerPct,
                                # targetPct) → { covers, text } — THE MOVE's line words, ONE copy: the Smart BLOC
                                # sidebar reads it too
                                # BL32 (build 2b): ACTION_FIELDS gains a MONTH `strikeToCold` (the stand-down's step 5 —
                                # "Release X ₿ of Strike collateral to cold storage.", "(small — can wait)" under
                                # 0.01 ₿); moveCard at plan.standDown — the why and aligned lines in
                                # GOAL_STAND_DOWN_WORDS' terms, the moves line lists only what moves (δ2), and no line
                                # words (δ1 — the what-if pair stays)
      decisionChartView.ts      # Decision face (Run A) — the chart series, pure. buildChartSeries (the seam is
                                # EXACT: history's last point IS forward's first; the support line spans both
                                # halves — history via supportAtDates, forward via the engine's own path; history
                                # stride-downsampled to ≤ 800 keeping the first and last) + cliffPath(rows) (the
                                # cliff per row = cbSeizurePrice, the ONE rule the Worst (modeled) cushion reads too;
                                # null with no loan, no collateral, and ON and AFTER the liquidation row).
                                # ⚠ An uncomputable point is a GAP (null), never 0 — a zero draws to the floor of
                                # a log axis and reads as a crash that never happened.
                                # Run B: chartDomain (an explicit positive log domain, ×0.8 / ×1.25; null ⇒ the
                                # placeholder) · xExtent (the full extent — the date ticks moved to lib/chartZoom.ts as
                                # timeTicks, chart zoom) — ⚠ with per-series data and no chart-level data, recharts
                                # falls back to one tick PER DATA POINT, so the axis always takes explicit ticks.
                                # + pathOnSupport(path, support, months) — the legend note's test: sameSeries over
                                # months 1…horizon, bit for bit (month 0 is spot), never a tolerance
      FireFace.tsx              # Batch 1 build 4 — the THIRTEENTH face, ◎ FIRE, ungated, appended last (+ .module.css:
                                # composes CyclingFace's classes only, plus the doubled .faceDocked pair): selling to live.
                                # The four faces' position reads and the plan's income / expenses; the path from the held
                                # anchor, .slice(0, months); the inputs read ONCE a change (useMemo on s.fireInputs); the
                                # history from usePowerLawData as it is. The chart, six tiles, "Stop working" (eleven
                                # literal NumberInput tags, all 'leave'), the scale, the replays, the Milestones (the table
                                # or MilestoneSwitchTable), the model card, the disclaimer, <ControlDock> last. Writes only
                                # setFireInputs and setInflationRate; its buttons disabled for a viewer (D-1). 🔴 It
                                # composes NO sentence (I31). See almanac.md § FIRE face. Tested in
                                # __tests__/fireWiring.test.ts and e2e/fire.spec.ts
      fireFaceView.ts           # Batch 1 build 4 — the FIRE face's every word, figure and tone, pure (no belief, no store,
                                # no React). fireEngineOf (savings signed, the buffer folded in, the return factor, the
                                # tax) · yoursAt — the ONE three-argument deriveOwnership call · fireRunOf · replayRunsOf
                                # (the stop held: { ...x, stopMonth: stop }) · historyStateOf · capacityOf (the LOWEST, only
                                # with all three, ÷ (1 + b ÷ 100)) · fireTiles · replaysCard · the chart (fireChartPoints —
                                # a gap is null, never 0 — fireChartDomain, fireTooltipLines) · fireScale · the Milestones
                                # (fireMilestoneMonths: m < n over the rows' own count; MS_VIEWS_FIRE) · the model card ·
                                # fireMonthYear (one fixed month table, never ICU). ⚠ Zero is never printed: usdOrNull /
                                # btcOrNull / yearsOrNull → "—". Tested in __tests__/fireFaceView.test.ts (BANNED sweeps it)
      fireReplays.ts            # Batch 1 build 4 (D-3) — the replays' one belief crossing (imports cycleReplays):
                                # fireReplayReadings (= deriveReplays) · replayPathsAt(path, startDate, stop, readings) —
                                # each replay spliced at the face's own stop; [] without a stop inside the horizon; a cycle
                                # that didn't replay keeps its reason. Tested in __tests__/fireReplays.test.ts
      FireScale.tsx             # Batch 1 build 4 — the scale of years of funded spending (+ .module.css, tokens only): a
                                # bar, a you-are-here dot, the need's marks. LAYOUT ONLY and wordless — imports only its
                                # CSS; the view hands it every label and the aria-label (fireWiring WORDLESS)
      ownershipFaceView.ts      # Ownership face — pure: chartOwnershipRows (the three charts' series; yours / owed
                                # through deriveOwnership, 3-arg), ownershipGained, ownershipHero, modeConstraints,
                                # unfundedNote, liquidationVerdict, strikeCallVerdict, MODE_NOTE. BL32 (δ3):
                                # strikeLimitTail(cap, row, usd) — the tail of "Where the position stands": a month that
                                # stood down with nothing on Strike reads "Limit is bound by collateral — at your goal
                                # with both loans repaid, nothing is pledged to Strike." (never "backed again above $0");
                                # every other month the face's words. OwnershipFace renders it. Tested in
                                # __tests__/ownershipFaceView.test.ts and goalViews.test.ts (STAND LIMIT)
      supportPolicyInputs.ts    # Support policy — the faces' ONLY §2 crossing for it: buildSupportPath(start, months)
                                # = plBandAt('floor', start, m), bit-equal to the on-the-line price path from month 1;
                                # supportPolicyFor(settings, path, bills, strikeLiqPct, mode) → the engine input, or
                                # undefined when off / not cycle. See § Support-anchored policy → Faces (Run 2).
                                # + THE POLICY'S MEMORY (Decision face §4.5–4.6): supportAtDates(dates) (plFloor per
                                # date — the chart's history half reads the SAME line as the engine's forward path,
                                # bit-aligned with buildSupportPath) · breakerFromHistory(history, today, rearm) →
                                # { state, lastMonthEndISO } | null — the breaker folded over real month-end closes
                                # vs support, through the engine's OWN nextRearmableBreakerState (never a second
                                # trip rule); a month's close is the last point before the next month's UTC start
                                # and only within 7 days of it, junk CARRIES the state, and no usable month ⇒ null
                                # so the card SAYS the history didn't load · holdMonthsFrom(throughISO, startDate)
                                # → Strike's hold in engine months. ⚠ R4 — this module does NOT import
                                # Tools/crashPlaybookView: it takes the throughISO strikeHoldAt already computed (the
                                # face and usePlanMonth read the date through strikeDepositOf — Run 2, D9).
                                # History is typed structurally (HistoryPoint), so the §2 crossing imports no hook
      futuresRun.ts             # Policy v2 — the lenses: 🔴 THE §2 CROSSING for the futures, and the only one — it imports
                                # pricePaths AND monteCarlo, and a source test (W WALL) pins that nothing else does.
                                # FuturesJob { inputs (the face's engineInputs, no path), anchorPrice, startISO, months,
                                # count?, seed? } — plain data, it crosses postMessage as is. futuresFor(job) = runFutures over
                                # priceFutures, with the job's startISO (Run 2). A ONE-ENTRY CACHE of the drawn futures,
                                # keyed by anchor · start · horizon · count · seed and NEVER by the inputs: a setting re-runs
                                # the engine on the SAME futures (L-I6;
                                # the worker at 240 months: 128–140 ms for a setting vs 161–184 for new futures).
                                # futuresAnchor(price) = the face's anchor on a 1% grid in log price (≤ 0.501% off; junk
                                # passes) — R4: a live quote moves the futures only at a grid line (measured on all four faces:
                                # one run per crossing; 8 runs over 9 quotes 0.15% apart without the grid)
      futures.worker.ts         # The futures worker: futuresFor off the main thread. The crypto worker's pattern — `declare
                                # const self: DedicatedWorkerGlobalScope`, a local message contract, compiled by
                                # tsconfig.worker.json and excluded from tsconfig.app.json; a precache entry (14 at c7f709e)
      futuresClient.ts          # runFuturesJob(job) → Promise<FuturesSummary | null> (null = superseded). The crypto client's
                                # pattern: one lazy module worker, `new Worker(new URL('./futures.worker.ts',
                                # import.meta.url), { type: 'module' })` (precache-safe); a `typeof Worker` check; a worker
                                # error / message error / 20 s timeout → in-thread for the session, through the SAME
                                # futuresFor (worst case: slower, never missing or different — L-I7). LATEST ONLY (R6): one
                                # job in the worker, one waiting; a newer request replaces the waiting one, which settles
                                # null. resetFuturesClientForTests(factory?)
      useFutures.ts             # useFutures(job | null) → { summary, running }. ⚠ Keyed by the job's CONTENT (JSON.stringify),
                                # never its identity: a face rebuilds the job on every price tick (its anchor is a dep), and
                                # an identity key re-ran the futures on each one (measured: 8 runs instead of 1 over 9 live
                                # quotes). Runs after FUTURES_DEBOUNCE_MS (300) of stillness; a stale result is dropped; the
                                # last summary stays, dimmed, while a new run goes (R6)
      futuresView.ts            # EVERY WORD of the futures (the faces compose none — I31). On screen the 1,000 are
                                # "simulations" (Run 2, W-4): no word built here says "future" — the code's names keep it
                                # (L-I13). futuresReadout (the owner's four numbers under the applied policy — You own · In
                                # your cold storage · Beats never borrowing (BL14: its sub-line adds "· N% tie" when any
                                # simulation ties, which only a goal makes) · Coinbase seizes; the coin subs "where 8 of 10
                                # simulations end · half end above x ₿" — W-5, a no-break space holding ₿ to its figure;
                                # a "none" range names no middle — O-1 — else the chance
                                # alone and its note, R1) · futuresCardLine (the card's line, in sentences: "Over the next 5
                                # years, in 1,000 simulations: in 8 of 10, you end owning a–b ₿; Coinbase seizes in x% of
                                # them — y% within the first year, half of those seizures by <Mon YYYY>."; "none of them"
                                # when none) · seizedShares (R16: the two seizure shares as printed, { total, early } — ONE
                                # decision for the card's line, the readout's value and whenText. early is the share of ALL
                                # the simulations seized within the first year, month 12 included: "all" when every seizure
                                # is, decided first, so a whole year never reads "100.0%"; "none" when none is; null at a
                                # horizon of a year or less. When the two would print alike, BOTH go to one decimal — O-3,
                                # R16: never "19% … 19.0%", nor a first year larger than the whole) · whenText (Run 2, W-3:
                                # seizedShares' first-year share, then the month by which half of the seizures have
                                # happened) · horizonWords ("the next year", "the next 5 years") · monthYear (month m after
                                # the start, "Nov 2029" — a fixed month table, never toLocaleDateString) · futuresTitle
                                # ("Across 1,000 simulations · 5 yr") · shareText (never "0%" / "100%" unless none / all; one
                                # decimal under 10% and over 99% — R10) · rangeText · horizonText · FUTURES_TIP (names NO
                                # count — the title beside it does, R12 — and says the simulations are not the four Price
                                # paths (Support, Fair, Resistance, 4-yr cycle) — R14) · FUTURES_TIP_LABEL ("About the
                                # simulations" — D-1) · FUTURES_RUNNING ("Running the simulations…") · FUTURES_DEBOUNCE_MS
      FuturesCard.tsx           # The futures readout on the Strategy face (+ .module.css, tokens only) — LAYOUT ONLY: reads no
                                # store or engine and writes no word (a source test scans its literals and JSX text); a
                                # <section> named by its title, aria-busy while a run goes (the figures dim, never blank); a
                                # two-column grid (four from 768 px) of term · value · sub. `.value` is clamp(12px, 3.8vw,
                                # 17px), nowrap (R11): two-digit ₿ ranges fit full mode's 246 px card at 320 px (the fit
                                # sweep: 0 of 96, the tightest 7.7 px); a 14 px floor ran 3 of 96 past their cells (F7)
      supportPolicyView.ts      # Support policy — pure display math: settings, defaults, ranges and the clamp
                                # (payDownPushed) — the defaults are Policy v2's C1 (45 · 2.0 / 3.0 · 12), the ranges
                                # D2's (buy zone to 2.5×, pay down to 5.0×, room to 48 months). Since the plan of record
                                # (Run 1) both are RE-EXPORTED from lib/planPolicy, the one source:
                                # DEFAULT_SUPPORT_POLICY_SETTINGS = { enabled: true, ...PLAN_POLICY_DEFAULTS } and
                                # SUPPORT_POLICY_RANGES = PLAN_POLICY_RANGES (the same object); ZONE_LABEL / ZONE_LETTER / ZONE_COLOR; policyReading →
                                # policyHeadline / policyDetails / neverDrawsNote; policyPauseReason; policyUnpaidNote;
                                # policyAlert; policyStopSentence; billsRemainderTail; DUST_USD / shownUsd (the ONE
                                # dust floor — defined in utils/format since W1, re-exported here); drawPauseClause; zoneStrip / zoneStripLabel; policyLimitPct; coldShown;
                                # the card's copy (settingReadouts, policyIgnoredNote, policyTip) and the faces'
                                # (defenseLineNote, policyTileSub, policyColdNote, policyColdGoalNote); the call sentence. Policy v2 Run B
                                # (B1): PolicyReading.cliff (cbSeizurePrice of the inspected row, only under its price)
                                # → the card's cliff line, right after the Coinbase line; fmtBelowPct — THE F11 wording
                                # ("less than 1%" / "more than 99%"), shared with THE MOVE. No belief, no
                                # store, no React — and it never imports cyclingFaceView (which imports it).
                                # Sticky controls: `PolicyCardState` / `policyCardState(mode, enabled, applied)` — the
                                # card's four states (notCycle · off · notRun · on), ONE branch that the card and the
                                # control dock's Policy panel both read, so the two can never disagree
                                # The plan of record's Run 4: PLAN_RULE_LABEL — the six settings' labels, ONE copy (the
                                # sliders, so Settings' "Your plan" and every face's card, and the Advisor tab's sidebar)
                                # · planRuleRows(settings, expenses) → { key, label, value }[] — each setting as the plan
                                # runs it (settingReadouts; a limit held to its defense line shows that line)
                                # BL32: GOAL_STAND_DOWN_WORDS — the stand-down in words, ONE phrase (THE MOVE's card, the
                                # cold card, "Why this plan?"; since BL33 Settings' goal rules too) · BL33: policyColdNote(s)
                                # — the cold card's rule alone; policyColdGoalNote(goal) — its stand-down line with the
                                # run's applied goal, null without one (build 2b had it as policyColdNote(s, goal)'s second
                                # sentence); the card lists them one a line (coldCardView)
      planClamp.ts              # The plan of record (Run 1) — the plan's ONE clamp: PLAN_CB_LTV_CAP_PCT (70, the
                                # Coinbase defense line), PLAN_STRIKE_CAP_PCT / PLAN_STRIKE_CAP_EFF (the Strike cap's
                                # defaults) and PLAN_CLAMP. Since the plan of record's Run 2 the Decision face's aliases
                                # are gone: planRun.ts's PLAN_ENGINE_CONTEXT and its two builders read these names, so the
                                # face and THIS MONTH / Daily (planMonthRun) share one clamp, and Settings' "Your plan"
                                # reads the plan's effective stops through PLAN_CLAMP. A parent face's own cap slider
                                # stays a what-if on that face. The plan of record's Run 4: PLAN_CB_LTV_CAP_PCT reads
                                # lib/planPolicy's PLAN_CB_DEFENSE_PCT — ONE constant with Safety's limit at support
      usePlanPolicy.ts          # The plan of record (Run 1) — the READ-ONLY hook: useStore(useShallow((st) =>
                                # planPolicyOf(st))). ⚠ useShallow keeps the object's identity until a setting changes —
                                # the faces memoise on it; without it the hook returns a fresh object on every read and
                                # the page never renders (MR25). Every face builds policyRaw = { ...DEFAULT_SUPPORT_POLICY_
                                # SETTINGS, ...plan, ...overlay.supportPolicy } from it; Settings' "Your plan" reads it too,
                                # and so does usePlanMonth (Run 2 — THIS MONTH and Daily run the saved plan, no what-if)
      planRun.ts                # The plan of record (Run 2) — the ONE input builder, PURE (no store, no React, no clock:
                                # today, the price and the policy's memory arrive as values). PLAN_ENGINE_CONTEXT (the five
                                # engine constants — was the Decision face's ENGINE_CONTEXT) + PLAN_COLD_BUFFER_PCT 30 /
                                # PLAN_CYCLE_MONTHS 1 / PLAN_RUN_MONTHS 12 · placementInputOf / engineInputsOf — THE MOVE's
                                # input and the engine's inputs; the Decision face and planMonthRun build through BOTH, so
                                # the face and THIS MONTH can't disagree (one copy, not two compared — invariant 2) ·
                                # planCbCollateralOf / planCbLoanBalanceOf (D-R2-4 — Coinbase as every plan screen reads it:
                                # the owner's only with the loan switched on; off, none — never the seed's $60,000 on
                                # 1.48 ₿; the ONLY deriveCbCollateral caller under Almanac / SimpleMode / Daily — GATE) ·
                                # planMonthRun(facts) → THE MOVE at today's price and S₀, then months 0..12 on a FLAT path
                                # at today's price (D4), from the saved plan — no what-if · planBreakerCacheOf (Δ6 — the
                                # device's breaker cache read through the engine's own validOpeningBreaker and dated
                                # yyyy-mm-dd: the stored object itself, or null) · cbOverLimitAtMonthEnd — THE one "over
                                # Coinbase's limit at month-end" rule (the engine's headroom at that month's support, past
                                # the dust floor; the switch month, later months' status, the track and the after box read
                                # it — month 1's status reads TODAY's fact, so its status and band can differ) ·
                                # firstMonthUnderLimit (§4.5 — the switch month's time) · planPolicySettingsOf(plan)
                                # (the plan of record's Run 4) — the saved plan as every plan reader runs it (C1 under it,
                                # range-clamped, its stops held to PLAN_CLAMP): planMonthRun and the Advisor tab's sidebar
                                # read it
                                # BL32: PlacementFacts REQUIRES goalNetBtc — placementInputOf passes it, so THE MOVE
                                # stands down on the same goal the run reads
      planMonthView.ts          # The plan of record's month AS WORDS (Run 2 — §4.3, §4.5, §4.7). PURE: every sentence THIS
                                # MONTH and Daily's plan card show is built here (I31 — the cards compose none). STATUS —
                                # planStatus: within the limits (one green line), or over with today's fact, the time back
                                # (firstMonthUnderLimit) and the catch-up "To be within it today" as arithmetic on the
                                # run's numbers, never "should"; Δ9's three over-limit bodies (repays it / "No spare income
                                # repays it this month" / "Back within your plan's limit this month."); a refused policy
                                # reads the Decision card's own policyIgnoredNote (Δ8); past the liquidation line or
                                # liquidated, red. TO DO — planMonthActions: THE MOVE's legs "today" first, then EXACTLY
                                # the Decision face's schedule rows for that month (planSchedule's kinds; one WORDS Record
                                # per ActionKind, so a new kind can't reach a screen without words); muted "—" anchors for
                                # no buy / no draw. VENUE — Strike white, Coinbase blue, cold storage orange (the faces'
                                # own tokens; venueSegments / venuesOf / planRowDot — one venue fills the dot, two split
                                # it; Run 2.1, F8: the split ends `border-box`, or the inline `background` shorthand starts
                                # the gradient inside THIS MONTH's `.pmDot` 1px border and repeats it under the border — a
                                # class rule can't fix it, the shorthand resets the origin). AFTER — planAfter: both loans
                                # at month-end, Coinbase at THE ROW'S support with a meter (limit and seizure ticks, read
                                # aloud by planMeterAria), the cliff cbSeizurePrice with fmtBelowPct; no meter and no
                                # over-the-limit tone under a refused policy. monthTrack
                                # — the scrubber's year (past months faint, green within, amber over until the cure, red
                                # from a liquidation, never green under a refused policy). A past month from the Ledger
                                # (loggedMonthRows / loggedMonthAfter / loggedMonthStatus — the plan keeps no history,
                                # D14). The breaker offline — planBreakerSource (today's fold → this device's cache →
                                # loading / none) and planBreakerLine (with a cache: nothing while the fetch runs, its date
                                # once the fetch failed, Δ12; with none: the loading line, then "didn't load"). The foot — fmtDayOrdinal,
                                # planMinimumOwed / planMinimumLine /
                                # planInterestRollsLine, planNdpLine, planLedgerParts (the Ledger so far, both loans'
                                # paydowns), planLedgerTargets (the bars' target, in the Ledger's own streams, Δ4),
                                # planNextMonthLine, planSavingsLine, planPriceLine, planSignoffLine / planSignoffSub. The
                                # note — planSwitchNote (D8). "Why this plan?" — planMonthSummary (the Decision face's own
                                # sentences). PLAN_CRASH_TITLE (D13). Never "should", "need to" or "safe", never "$0",
                                # "₿0.000" or "0.000 ₿" (WORDS sweeps every sentence over 600 runs × 12 months; since Run
                                # 2.1 its zero rule also reads "$0.00", and a zero before a "," or a ".").
                                # Run 2.1 (BL18 / BL19): EVERY figure to the cent through fmtUSDCents — it no longer imports
                                # fmtUSD; a buy after this month reads "$X.XX · at today's price" (PLAN_AT_TODAYS_PRICE,
                                # R2-a — the run is flat at today's price, D4); next month's line ends its buy with the
                                # same words ("buy ₿0.0050 at today's price"). planBars /
                                # planBarsCaption (F13 — Daily's bars: the month so far against the plan's month, in Week
                                # and Month; a stream with no target — a past month, or one the plan doesn't plan — shows
                                # what was logged, muted, with no fill, or "—": never "$0 / $0"; Week's "Month N so far").
                                # ⚠ This planBars is planMonthView's — the store's planBars.test.ts is the showPlan*Bar
                                # toggles. planNdpEstimateUsd / planNdpBalance — THIS MONTH's NDP card and the month
                                # review's NDP seed, to the cent, on ONE balance (the Strike balance read, else 15% of the
                                # line); the engine's getNdpStatus rounds its estimate to a whole dollar, for full mode.
                                # The plan of record's Run 3: planLogRows (the month log's planned figures — strategy
                                # month k is the run's month k − currentMonth + 1, from the current month to 12; no past
                                # month, D14) with planStrikePaidUsd (the Ledger's Strike paydown: spare income's, a
                                # refinance's, the cash cure — with Coinbase's it is planLedgerTargets' "paid");
                                # PLAN_PATHS_LINK (the Outlook's place — the link to the Decision face); planReanchorLine
                                # (THIS MONTH's expenses prompt, to the cent) — replaced in the plan of record's Run 4 by
                                # planReanchorWords(avg, expenses) → { line, update, keep } (BL26: "Monthly expenses: your
                                # last 3 logged months averaged $X; your plan uses $Y." · "Update plan to $X" · "Keep
                                # $Y"; ONE figure — toCents(avg) is what the line prints, Update names and Update stores)
                                # · planMoveBringsCbWithin(plan) (Run 4, D-R4-1) — this month's move brings Coinbase within its
                                # limit (seeded, and no over-limit left on the placement's opening): THIS MONTH and Daily
                                # hand it to the Safety card, whose at-support line then names the move
                                # BL32: a month's Strike → cold row reads month-end ("small, can wait" under 0.01 ₿);
                                # planMonthSummary adds the stand-down's sentence from the row's goalStandDown
      usePlanMonth.ts           # The plan of record's month for the main screens (Run 2): gathers the store's live
                                # position (Coinbase through planCbCollateralOf / planCbLoanBalanceOf), the saved plan
                                # (usePlanPolicy), today's price, the minimum's source and the policy's memory — Strike's
                                # hold from strikeDepositOf → strikeHoldAt (D9); the breaker from month-end prices, else
                                # this device's cache (planBreakerCacheOf) — and runs planMonthRun. "Today" per render (Δ3
                                # — todayLocalISO(), never frozen at mount: an installed PWA resumes without remounting;
                                # the Coinbase accrual re-keys on it, so a screen left open re-plans once a day). The ONLY
                                # write is the breaker cache — a fresh fold, in an effect (device-local public price
                                # data); the plan is read-only. Read by usePlanCardInputs (THIS MONTH and, since the plan
                                # of record's Run 3, the Advisor tab — one call per screen) and Daily's plan card
      SupportPolicyCard.tsx     # Run 2b — THE support policy card, shared by the Cycling, Ownership, Strategy and Decision
                                # faces (+ .module.css, tokens only). Props {sim, monthIdx, raw, settings, onChange, onReset,
                                # mode, expenses} — renders only what the face hands it (no belief, no store; a
                                # structural test pins the imports). States, from `policyCardState`: not cycle / off
                                # (+ Turn on) / ignored (policyIgnoredNote) / on (headline, zone strip, details, a
                                # collapsed <details> Settings disclosure with six SliderInputs; no re-arm control).
                                # Sticky controls: ONE settings block — `SupportPolicySliders` (the six sliders, their
                                # clauses, Turn policy off (faces only) / Back to your plan; `layout: 'stack' | 'grid'`),
                                # rendered by the card's disclosure and by `SupportPolicyControls`, the control dock's
                                # Policy panel (the card's no-reading states, else the sliders in a grid). The card's
                                # markup was unchanged on all four faces by sticky controls (measured: outerHTML
                                # byte-identical to that run's HEAD, every state); the plan of record (Run 1) later
                                # renamed the reset button. Since the plan of record the sliders take two props whose
                                # defaults are the faces' words — `resetLabel = 'Back to your plan'` (the face drops its
                                # what-if) and `offSwitch = true`; Settings' "Your plan" passes "Back to the defaults (C1)"
                                # and `offSwitch={false}` (the saved plan has no off switch)
                                # Policy v2 — the lenses: two optional props, futuresLine / futuresRunning — the futures' line
                                # (FuturesLine) after the details list ('on') and inside the state body's section ('off' /
                                # 'notRun'), never for another strategy ('notCycle', R2); `.futures` / `.futuresStale`
                                # The plan of record's Run 4: the six sliders' labels are supportPolicyView's
                                # PLAN_RULE_LABEL — no typed copy (SIX-ONCE)
      coldCardView.ts           # BL33 — the cold-storage card's words, ONE PURE view for the four engine faces (Cycling,
                                # Strategy, Ownership, Decision): coldCardView(sim, settings, coldBufferPct, labels) →
                                # { total, totalSub, parts, moves, rules } | null — null exactly when !coldShown. Every
                                # sentence an existing one-definition helper's (coldOriginsParts, coldMovesSentence,
                                # policyColdNote, policyColdGoalNote, policyReserveNote) behind its own gates; the rules only
                                # while the policy applies. COLD_CARD_TITLE ("Cold storage") · COLD_RULES_TITLE ("How the
                                # plan uses cold storage") · NOTHING_MOVES_TO_COLD (the four faces' one no-reserve sentence).
                                # Each face supplies its own time labels. Tested in __tests__/coldCard.test.tsx (COLD VIEW,
                                # COLD CARD, COLD FACES) and goalViews.test.ts (STAND COLD)
      ColdStorageCard.tsx       # BL33 — THE cold-storage card (+ .module.css: Cycling's shell, label, headline and origin
                                # line composed from CyclingFace.module.css; tokens only), pure-from-props: the label, the
                                # total (showTotal — false on Decision, whose outcome strip carries it), the origins, the
                                # moves line and, with rules, "How the plan uses cold storage ›" folded (<details>). A face
                                # adds only its own: `info` (Cycling's InfoTip) and `children` (the policy-off sweep
                                # controls, Cycling and Strategy). <section aria-label="Cold storage"> — one per face
      ControlDock.tsx           # Sticky controls (Runs 1–2) — THE control dock (+ .module.css, tokens only): a face's
                                # controls, kept in reach while the face scrolls — on the four engine faces (Decision,
                                # Cycling, Ownership, Strategy; Run 2 changed nothing in the .tsx). LAYOUT ONLY — the face
                                # hands it each panel's content and words; it owns which one is open. Sticky to the window's
                                # bottom edge, the face's LAST child. ONE markup at a time (useMediaQuery('(min-width:
                                # 1024px)')): under 1024 px four or five tabs (label over value) over one open panel — inset
                                # 14 px, clear of EdgeBackGesture's swipe-back zone, capped at 34vh; from 1024 px a bar
                                # floating 12 px up — the live controls side by side, chips whose panel opens upward (after
                                # the bar in the DOM, above it via `order: -1`); Δ12 (Run 2): the bar's gap 12px and the
                                # chip padding 6px 8px (were 18 and 11), so Strategy's default stress head stays on one line
                                # beside its third chip. Escape folds the panel from the document (Safari never focuses a
                                # clicked button), never a typed value's, and returns focus to the chip; under 1024 px (Run
                                # 1b) it folds the open tab only from inside the dock — an open tab is the resting state, not
                                # a pop-up — and gives that tab focus; `aria-controls` only while open; z-index 30, under an
                                # open InfoTip's 40. ⚠ Never `position: fixed` (F2)
      controlDockView.ts        # Sticky controls — the dock's words, pure: DockTabView · monthTabValue / monthReadout ·
                                # stressPct / stressTabValue / stressTone (a true minus) · PATH_TAB_VALUE (Support and Fair
                                # from PL_BAND_LABEL, then Resist. · 4-yr · Stitched · Worst — a phone tab fits 8 characters)
                                # · lineTabValue (rounded to one decimal first: $99,950 → "$100k") · policyTabValue ·
                                # decisionDockTabs (the Decision face's five, in order) · Run 2: parentDockTabs (Cycling's and
                                # Ownership's four — Month · Stress · Path · Policy) · strategyDockTabs (those four, then the
                                # Lens) · LensView / LENS_TAB_VALUE (Position · Flywheel). ONE private constructor per shared
                                # tab (month, stress, path, policy) — all three builders use them, so a tab reads the same on
                                # every face. Batch 1 build 4: fireDockTabs (the FIRE face's three — Month · Stress · Path)
      MilestoneSwitchTable.tsx  # Milestones on a phone (Run 2) — THE Milestones where the table doesn't fit (+ .module.css,
                                # tokens only). The three parents render it OR their table — useMediaQuery(MS_TABLE), ONE
                                # markup at a time, never a CSS toggle: under 768 px, and in Ownership's side column (from
                                # 920 px). One line a year under a "Year" header, and a switch above it showing a few of the
                                # table's columns at a time: a role="group" ("Milestones figures"), one aria-pressed button
                                # a view whose spoken name is its aria-label alone (R7: a title equal to it is read twice).
                                # The open view is its own state — the first on open; a month pick keeps it. LAYOUT ONLY and
                                # wordless: the face builds every row from its table's own expressions (year, flags, turn,
                                # then cells { label = the header, value, color?, name? (a symbol's spoken name — the zone
                                # letter, role="img"), sub?, subColor? }) and names the table, the switch, the year header
                                # and the views (MS_VIEWS_* — a partition of the table's columns less Year). A view shows
                                # only the columns some row carries (Cycling's Cold; the Zone with the policy off). One
                                # <tbody> a year: its line, then the turn's line (a colSpan cell); with onPick the tbody is
                                # the row's button (click, Enter, Space — as the tables' rows). Figures and the year
                                # clamp(10px, 3.2vw, 12.5px): Cycling's ₿ view in full mode at 320 px has a 218 px frame,
                                # and a fixed 12.5 px ran 6–14 px past it (measured). Headers, figures and turns nowrap; the
                                # year cell may wrap before a long flag. `.on.on` lit (--surface-2, its year --btc) —
                                # DOUBLED to TIE the hover and focus rules (0,2,2) and win by coming after them, so a
                                # keyboard pick stays lit (LIT pins the order); `.post` 0.55 (the tables' msPost). Batch 1
                                # build 4: the FIRE face renders it too, under 768 px (MS_VIEWS_FIRE)

    Tools/
      CbDefenseTool.tsx         # THE Emergency Console's ONE gate (the plan of record's Run 4, D3): hasCbLoan ?
                                # EmergencyConsole : null — it was the mode gate (cbPaymentStrategy==='ltvTriggered' ?
                                # EmergencyConsole : LiqSimulator) until then. Zero props. Shared by BOTH mount points —
                                # the `liqsim` tab (AppShell) and the Almanac's gated `defense` face — so they can never
                                # disagree on which tool shows
      (LiqSimulator.tsx, LiqSimulator.module.css and liqSimulatorView.ts — DELETED in the plan of record's Run 4 (D3),
       with liqSimulatorView.test.ts: the Emergency Console runs with any Coinbase loan, and the Liq Sim had no other
       screen)
      EmergencyConsole.tsx      # Emergency Console (crash playbook Run 2) — the crash-day page for `ltvTriggered` CB
                                # mode — any Coinbase loan's since the plan of record's Run 4 (D3); READ-ONLY (no
                                # dayLog writes). Store reads above the early return; cbDebt via
                                # accruedCbBalance (the accrual boundary); support via plBandsAt (the view keeps the
                                # crossing); card = waitingCard(input, cbLtvTriggerPct) ?? playbookCard(crashPlaybook(
                                # input), input, hold) on playbookInputFromLive(...) at the EFFECTIVE price (simulated
                                # while simulating). Sections: staleness banner / simulate banner / stage header + band
                                # rail + sim scrub (unchanged) / Crash playbook card / Last resorts (Sell to pay down ·
                                # Outside cash, both collapsed) / 7-item session-only checklist. See § Emergency Console
      EmergencyConsole.module.css
      crashPlaybookView.ts      # crash playbook Runs 2–3 — the ONE live front-end of crashPlaybook: the console and the
                                # Monthly Playbook's THIS MONTH line both build through it — never copy it. PURE: no
                                # power law, cycle model, store or React (a layering test). Strike's 60-day hold (the plan
                                # of record's Run 2, D9 — invariant 8, one rule): strikeHoldAt(depositISO, todayISO) — THE
                                # rule (in hold iff that date is at most 60 days before today; yyyy-mm-dd only) ·
                                # strikeDepositOf(st) — its ONE fact on this device: the owner's journal
                                # (latestStrikeDepositISO), or a trusted viewer's viewerStrikeDepositISO (the snapshot's
                                # copy — a viewer has no journal). Every hold reader (the Decision face and
                                # the Emergency Console, which a viewer reaches; usePlanMonth, THIS MONTH's crash line) reads the hold through
                                # these two · strikeHoldFrom (the hold straight from a journal — strikeHoldAt over
                                # latestStrikeDepositISO; no screen calls it) · isCrashDay (D13 — the crash day THIS MONTH
                                # and Daily read: the console's own gate, hasCbLoan && ltvTriggered && Coinbase at or past
                                # its trigger at today's price; since the plan of record's Run 4 (D3) hasCbLoan && at or
                                # past — no ltvTriggered — and the CB Loan tab reads it too) · CONSOLE_LINK ·
                                # atTriggerLine(triggerPct, consoleRuns) (Run 4 — at or past the trigger today: the
                                # Decision face's alert and the CB Loan tab's banner, one sentence) ·
                                # cbTabCrashDayLine(triggerPct, triggerPriceUsd) (Run 4 — the CB Loan tab's "On a crash
                                # day" card; no price when there is none to show — shownUsd) ·
                                # playbookInputFromLive (the one live CrashPlaybookInput builder: cold under a satoshi →
                                # 0; the stop at support through effectivePolicyStops on the plan's Coinbase limit — the
                                # REQUIRED LivePlaybookFigures.planCbStopAtSupportPct, read through its clamp
                                # (clampPlanPolicy) — plan of record, Run 1; the lender constants; the hold, from
                                # LivePlaybookFigures.strikeDepositISO — strikeDepositOf(store), Run 2) ·
                                # fmtStepBtc / fmtStepUsd (FLOORED to
                                # their printed precision) · fmtStepUsdCents (the plan of record's Run 2.1, BL19 — THIS
                                # MONTH's line: floored to the cent, and still no step under $1; the console's card keeps
                                # fmtStepUsd's whole dollars — listSteps(result, stepUsd) takes the step formatter, whole
                                # by default) · fmtMultiplePair (widens 2 → 6 dp until k and the depth
                                # differ) · waitingCard (target < LTV < trigger, under 86% → the plan waits) ·
                                # playbookCard (the card's shapes) · monthPlaybookLine (the THIS MONTH line — compact,
                                # with the card's listed steps, gap and outcome through one private reading:
                                # listSteps / gapKind / outcomeKind). The plan of record's Run 3 deleted
                                # CB_PAYDOWN_LABEL / IF_YOU_SHIFT_DEBT and playbookDepthFor with the Outlook, their last
                                # screen (runAdvisor's projection is on none). ⚠ No inline min in the file, and exactly
                                # one effectivePolicyStops call (source guards). Pinned by
                                # __tests__/crashPlaybookView.test.ts + __tests__/emergencyConsoleWiring.test.ts +
                                # __tests__/monthlyPlaybookWiring.test.ts (+ Run 4: Advisor/__tests__/planEdgesWiring
                                # GATE and CBTAB)
      toolShell.module.css      # Shared `.toolContainer` (Almanac's tokens: 600px centered + iOS-safe overflow), composed
                                # by all three tools (EmergencyConsole, Mining, Converter — Power Law's became a face; the
                                # Liq Sim's left with the LTV-triggered strategy, the plan of record's Run 4) +
                                # AlmanacView's `.container`. A wider tool overrides the 600px on a DOUBLED class —
                                # `.main.main { max-width }`: Mining 960, Converter 700 — never beside `composes:` (P10;
                                # § Critical Constraints; composedOverrides.test.ts)

    ui/
      SliderInput.tsx           # Stacked: label → value → slider → min/max
      NumberInput.tsx           # prefix/suffix/decimals props (avoid suffix inside input). BL33: + `ariaLabel?` — the
                                # input's accessible name (the visible label is a span, not a <label>); absent, nothing
                                # renders (Settings' "Total in cold storage" passes it). BL34–BL35: `save` (required) —
                                # 'button' ("Save — dated today" and Cancel under the field while it holds typing), 'leave'
                                # or 'live'; leaving, Enter and Save commit through numberCommit; `typed` (state) gates it.
                                # F-2d-1 (build 2e): a focused 'leave' field also saves what was typed when the app goes
                                # away (the window's blur, or the page hidden; awaySaves) — through writeTyped, not
                                # commit: the edit goes on, its text untouched
      NumberInput.module.css    # BL35: + .inputWrapHeld (an amber edge while a 'button' field holds typing), .saveRow,
                                # .saveBtn, .cancelBtn
      numberInputModel.ts       # BL34–BL35 (F-2c-1) — NumberInput's save rules, PURE: `NumberSave`, `numberCommit`
                                # (nothing unless typed; clamped to [min, max]; never the figure the field shows — a dated
                                # 'button' field's re-entry aside), `keystrokeWrite` (only 'live' saves as typed),
                                # `leaveCommits` ('button' keeps its typing), `awaySaves` (F-2d-1: only 'leave' saves when
                                # the app goes away), `SAVE_DATED`, `fmtNumberField`. A click in
                                # and out re-dated a dated figure. Pinned by numberInputModel.test.ts (SITES: every
                                # field's mode; AWAY) + e2e/numberField.spec.ts, numberFieldAway.spec.ts
      Toggle.tsx
      PassphraseInput.tsx       # R2c-7a-2-polish — THE masked-entry widget (+ .module.css). A controlled input +
                                # focus-guarded Show/Hide toggle, adopted at ALL 18 RENDERED masked fields:
                                # NostrAuthGate (remediation encrypt · saved-key PIN unlock · ncryptsec unlock · PIN · Confirm PIN),
                                # RecoveryKeyCeremony (PIN unlock · encrypt · verify re-entry), ViewerLoginFlow
                                # (token pass · PIN ×2), OwnerKeySetup (PIN ×2), ViewerUnlockGate (PIN ×2),
                                # RevealRecoveryKey (PIN), SharingPage (PIN), LocalUnlockGate (PIN). ⚠ NOT AppUnlockGate/StoreMigrationGate
                                # — both UNRENDERED (retained verbatim as the Option-3a rebuild basis), so a
                                # `grep type="password" src` should show exactly those two and nothing else.
                                # ⚠ THE FOUR iOS SUPPRESSIONS ARE BAKED IN (autoComplete/autoCorrect/autoCapitalize/
                                # spellCheck), not props — iOS autocapitalizes an unsuppressed field, which would make
                                # the encrypt and decrypt sides permanently disagree. One default beats 18 chances to
                                # forget one. ⚠ FOCUS GUARD: the toggle is `onPointerDown` + `preventDefault()` (the
                                # WordGrid suggestion-strip idiom) + tabIndex={-1} — an onClick-only toggle blurs the
                                # field first, and on iOS the keyboard collapses and the caret is lost mid-passphrase.
                                # Show/Hide TEXT, not an emoji glyph (matches NostrAuthGate's own recovery-key
                                # Show/Hide + SecretKeyCard's "Tap to reveal"; renders identically everywhere).
                                # `className` passthrough is REQUIRED — hosts use 3 different input classes
                                # (.input/.pinInput/.dateInput) and each keeps its exact look. `inputMode="numeric"`
                                # passthrough keeps the PIN keypad in BOTH masked and revealed states. ⚠ `.wrap` is
                                # `flex:1 1 auto; min-width:0` and NOT `width:100%`: several hosts put the input in a
                                # flex row where the INPUT carried `flex:1` (.pinRow, .fieldInput) — interposing the
                                # wrapper makes IT the flex child, and a hard width:100% would wrap the adjacent
                                # button onto a new line. The input's width/box-sizing/padding-right are INLINE
                                # (the host's class sets padding; CSS-module source order can't be relied on to win)
      ScenarioPills.tsx
      GrowthPresetPills.tsx
      LtvTypePills.tsx
      DraggableSheet.tsx        # Gesture & Motion System P1 — the SHARED drag-to-dismiss bottom-sheet shell
                                # ({ open, onDismiss, dirty?, labelledBy?, maxHeight?='92vh', scrollRef?, children }).
                                # createPortal→body. P1.2 Bug E STRUCTURE: .root (positioning only, NEVER
                                # opacity-animated) wraps a SIBLING .backdrop (the sole opacity target) + the .sheet
                                # (position:relative/z-index:1 → paints above the backdrop) — so animating backdrop
                                # opacity never fades the sheet itself (the pre-P1.2 scrim>sheet ancestor-opacity bug,
                                # device-confirmed). handleScrimTap lives on the backdrop's onClick; the sheet keeps
                                # onClick stopPropagation for safety. Adopters (EventSheet/ReviewSheet/
                                # AlmanacConsentSheet) DELETE their own .scrim/.sheet/.grab CSS.
                                # Gesture via usePointerDrag (axis 'y', slop 8, armThreshold 24, commitThreshold =
                                # measuredHeight×0.45 [read live — the hook reads config per event], commitVelocity
                                # 900). onMove writes transform/opacity DIRECTLY (rAF-batched, no React state):
                                # downward tracks 1:1 (dirty → rubberBand cap at 25%), upward → native scroll when
                                # the content is scrollable else rubberBand 24px; BACKDROP.opacity = 1−clamp(ty/h) (the
                                # backdrop IS the progress bar). onMove is a SHARED handler (applyMove/applyArmHaptic/
                                # finishGesture — extracted so both gesture sources call one impl). P1.3 SCROLL/DRAG
                                # HANDOFF (replaces P1.2's scrollTop-gate + touch-action-flip, BOTH disproved by device
                                # gates): .sheet has NO touch-action (only overscroll-behavior-y:contain kept); ONE
                                # scoped non-passive touchmove listener on the sheet (active only while open) decides
                                # per frame via the pure resolveScrollClaim(gestureModel): claim a DOWNWARD stroke only
                                # at scrollTop<=0, stay claimed until the finger returns to/above the CLAIM point
                                # (dyClaim = y−claimStartY, a two-way release), preventDefault while claimed. When a
                                # claim occurs but the pointer pipeline is already TERMINAL (a scroll-triggered
                                # pointercancel — pointer can't resume mid-touch) the touch handler TAKES OVER as the
                                # source for the SAME model (createGesture/advance('down'|'move'|'up'|'cancel') → the
                                # shared applyMove/applyArmHaptic/finishGesture); touchDrivingRef ⇒ exactly one source
                                # drives; a terminal touch-drive clears claim+driver together (endTouchDrive). onEnd
                                # dismiss = committed && dy>0 && !dirty → exit
                                # (translateY 100% --ease-standard/--motion-standard) then onDismiss; else spring
                                # back (--ease-spring/--motion-settle). Entry: translateY 100%→0 280ms
                                # --ease-decelerate + scrim fade (inline style, one transform channel shared with
                                # drag/spring/exit; transition cleared to none during tracking). DIRTY-GUARD
                                # (non-negotiable 1): 25% cap + one haptics.warn() on first arm + release ALWAYS
                                # springs back → dismissing a dirty sheet is TAP-ONLY (children's Cancel/X). onArm is
                                # DIRECTION-GATED (dyRef>0 else return) so an upward content-scroll fires no haptic;
                                # clean → haptics.tick(). DIRTY comes from the child via a `touched` flag flipped by
                                # DraggableSheet's `onUserInput` prop (wired to onChangeCapture on the sheet → fires on
                                # any real descendant <input> edit; programmatic setState never trips it) — so a
                                # freshly-opened sheet (ADD or EDIT, incl. a seeded amount) is clean until the user
                                # edits a field (P1 device-gate Bug A fix — replaced the earlier heuristic that
                                # mis-read a seeded edit-mode amount as dirty). `data-dirty` + `data-testid=
                                # "draggable-sheet"` on the sheet (e2e/diagnostic). FOCUS GUARD (P1.3 Fix 2, replaces
                                # the P1.2 activeElement-bail which made the sheet undraggable after ANY field tap since
                                # iOS keeps focus — H1): handlePointerDown reads document.activeElement — if it's an
                                # INPUT/TEXTAREA/SELECT AND the press is ON that field (e.target===ae or contained) →
                                # return (typing, no drag); pressing ANYWHERE ELSE → blur() the field (keyboard closes)
                                # and the drag proceeds. The old inputFocused state / onFocusCapture-onBlurCapture /
                                # enabled:!inputFocused wiring is DELETED. REDUCED-MOTION (useReducedMotion): entry/exit instant,
                                # drag renders no continuous translation (snaps at commit/cancel) — still functions.
                                # a11y: role=dialog/aria-modal/aria-labelledby on the SHEET, grabber aria-hidden;
                                # scrim stays a plain div (aria-hidden there would hide the dialog — deliberate
                                # deviation from the literal spec). Adopters keep their own if(!open)return null (so
                                # open is effectively always true while mounted; entry animates on mount, drag-exit
                                # animates, tap-close stays instant). Consumers: EventSheet + ReviewSheet each hold a
                                # `touched` useState (reset on open) flipped by onUserInput → dirty=touched (P1 Bug A);
                                # config pills/toggles are button clicks (no <input> change) → stay clean by design,
                                # which is correct (a bare pill tap stages no financial value). AUDIT (P1 fix): neither
                                # sheet has any onClick that programmatically mutates a staged financial value (no
                                # fill-from-current / ±step shortcut) → onChangeCapture fully covers the financial
                                # surface. AlmanacConsentSheet (static → never dirty). NOT adopted: SimpleMode Quick Setup (a
                                # bottom-ALIGNED card, not a flush sheet — parked) + MonthEventsModal (future).
      SwipeStrip.tsx            # Gesture & Motion System P2 — shared horizontal 3-pane PAGER (Calendar month/week +
                                # MonthlyLogOverlay months. ⚠ The P3 Almanac face pager was REMOVED — Almanac face
                                # switching is TAP-ONLY via the sub-nav pills). Props {onPage(dir),canPage(dir),
                                # renderPane(offset:-1|0|1),onSwipeStart?,shouldStart?,disabled?}. 300%-wide strip at rest
                                # translateX(-33.3%); usePointerDrag axis 'x' (touch-action:pan-y → vertical scroll
                                # never stolen), commitThreshold=0.35×measured-width, commitVelocity 800. onMove tracks
                                # dx (P3.1: rubberBand 20 — stiffer — at a !canPage boundary); onEnd committed&&canPage →
                                # DOUBLE-BUFFERED snap (animate to target, THEN in one commit onPage + reset to rest — no
                                # flash) else spring back — BOTH ease --ease-spring-SOFT (P3.1, calmer/less overshoot than
                                # --ease-spring). ONE haptics.tick on COMMIT only (no arm haptic — paging isn't
                                # consequential). onSwipeStart (first onMove) cancels a pending child long-press. Real
                                # state changes ONLY at rest (design.md §3.1). reduced-motion: no continuous track.
                                # P3: OPTIONAL shouldStart(e: React.PointerEvent) → boolean gate on the strip's
                                # onPointerDown (default → always start) — return false to REFUSE paging so the pointer
                                # falls through. ⚠ CURRENTLY NO CONSUMER: AlmanacView was its only caller and its face
                                # pager is REMOVED (face switching is tap-only); Calendar/MonthlyLogOverlay omit it. Kept
                                # as part of the shared pager API. P3.1: renderPane gains a 2nd arg
                                # renderPane(offset, live) — `live` is a `dragging` state true from gesture start (set in
                                # the onPointerDown wrapper after shouldStart passes) until the snap/spring settles;
                                # offset 0 is always live. Consumers can mount REAL neighbour content only while live
                                # (AlmanacView mounts the adjacent faces during a gesture, null at rest — no heavy hooks on
                                # a peek). CLOBBER GUARD (load-bearing): `dragging` is cleared ONLY at settle (in the snap
                                # setTimeout / spring-back setTimeout / reduced-motion branch), when the transform is
                                # already at restPct → the JSX inline-transform re-render write is a no-op and can't fight
                                # an in-flight animation. P2 call sites ignore the 2nd arg (identical output; 2 harmless
                                # extra renders/swipe).
      EdgeBackGesture.tsx       # Gesture & Motion System P3 — iOS-style edge-swipe-back (standalone PWAs have no system
                                # swipe-back). Props {onBack(), renderUnder?(), disabled?, children}. A 20px left-edge
                                # capture .zone (z-index above content, touch-action:PAN-Y not none — vertical strokes
                                # scroll natively THROUGH the bezel; the contested axis is HORIZONTAL, which pan-y leaves
                                # to our pointer stream; fallback if WebKit still cancels = P1 selective-preventDefault
                                # scoped to the zone) drives usePointerDrag (axis 'x', slop 8, armThreshold 24,
                                # commitThreshold=½ measured width, commitVelocity 700). onMove (dx>0 only; leftward
                                # rubberBands 16) translates the .page right 1:1 while renderUnder() rides in behind at
                                # scale(.92→1) + a .dim overlay .4→0 (iOS parallax); onEnd committed&&dx>0 → animate off-
                                # right (--ease-standard) then onBack(), else spring back (--ease-spring) + unmount the
                                # under-layer. P3.1: after the exit onBack it ALSO setPage(0,'none')+setDragging(false) so
                                # an IN-PLACE onBack (nested settings back → the list) snaps the revealed content to
                                # center (no-op for a top-level unmount — React flushes it before paint); the under-layer
                                # is gated on `renderUnder()` returning CONTENT (a null return → the page slides over
                                # plain app-bg, no dim gap — used one level deep in nested settings). NO haptics on
                                # back-nav (paging policy). renderUnder mounts at pointerdown (during slop, hiding the
                                # mount cost); AppShell passes a viewerMode-branched renderSimpleUnder (owner journal /
                                # viewer home — the exact surface back-nav reveals).
                                # TAP FORWARDING: a sub-slop cancel (movement < slop = a tap) re-dispatches the tap to the
                                # content beneath via zone.pointerEvents='none' + document.elementFromPoint(x,y)?.click()
                                # — the left 20px is never a dead strip. reduced-motion: no continuous track, committed →
                                # onBack immediately. a11y: zone aria-hidden (the visible ← Back button is the accessible
                                # path). MOUNTS ONLY on AppShell Branch H/I (simple-mode Settings/Almanac ← Back surfaces),
                                # NEVER on an auth/viewer gate, onboarding, or the full-mode shell (grep-proven: 2 sites).
                                # BL34–BL35 (F1): blurFocused() before a committed swipe's onBack() and before a forwarded
                                # tap's click — React runs no onBlur for a field it unmounts, and neither moves focus, so
                                # a typed plan setting (or the goal) would go unsaved. Pinned: numberInputModel.test.ts
                                # GESTURE + e2e/numberFieldSwipe.spec.ts.
                                # EdgeBackGesture.module.css alongside (.wrap overflow-x:clip, .under, .dim, .page, .zone).
      SwipeStrip.module.css     # .viewport (overflow hidden, touch-action pan-y) + .strip (300%, flex) + .pane (1/3)
      Snackbar.tsx              # Gesture & Motion System P2 — transient bottom toast (portal, above safe-area,
                                # --surface-3, message + one action, 5s auto-dismiss + progress hairline, role=status).
                                # The action is a labeled TAP (undo restores data — never a gesture). Snackbar.module.css alongside.
      DraggableSheet.module.css # .root (fixed positioning) + .backdrop (absolute, rgba(0,0,0,.65) — the opacity
                                # target) + .sheet (position:relative/z-index:1, overscroll-behavior-y:contain, NO
                                # touch-action [P1.3 — the non-passive touchmove handoff owns scroll-vs-drag]; max-height
                                # from the prop, inline) + .grab (36×5 radius 3, eases
                                # to --text-muted while the sheet has [data-tracking]). P1.2: was a single .scrim>.sheet
      ChartZoomFrame.tsx        # Chart zoom — the shared UI (+ .module.css, tokens only), in TWO pieces (Z18).
                                # ChartZoomFrame = div.area, the gesture surface (touch-action by mode, user-select none,
                                # data-testid="chart-zoom" + data-zoomed / data-mode / data-dragging / data-quiet) holding
                                # the chart, div.plot (at the probed plot rect, data-testid="chart-zoom-plot") > div.box,
                                # and div.note (role=status). ChartZoomToolbar = Zoom · Pan · + · − · Reset (Z9, pinned;
                                # inline SVG, aria-pressed), which each chart places in its card's TITLE ROW,
                                # right-aligned — one layout on every device, never over the plot (no media query touches
                                # .toolbar; chartZoomWiring pins it). 🔴 Z1:
                                # .plot, .box and .note are pointer-events: none, or recharts gets no hover and no tap and
                                # the tooltip dies. Also exports PlotProbe — the <Customized component={zoom.probe}/>
                                # child that reports recharts' `offset` (the plot rect) after layout. Plain buttons (not
                                # the shared inputs, which disable themselves for viewers): zoom writes nothing
      InfoTip.tsx               # The ⓘ tooltip primitive (+ .module.css) — § Cold-storage sweep → InfoTip. Hover opens it
                                # for a mouse only (native pointerenter/pointerleave, pointerType 'mouse'); a tap or click
                                # pins it; a second press, Escape or an outside pointerdown closes it. Placed against the
                                # screen: CSS hangs the panel under the ⓘ, a useLayoutEffect slides it inside the 16px
                                # gutters (tipShift), and again on resize. Unmounted when closed
      infoTipModel.ts           # InfoTip's pure rules, ZERO imports: TIP_GUTTER_PX 16 · tipShift(left, right, width)
                                # (too wide ⇒ pin the left edge; non-finite ⇒ 0) · nextTipState (closed | hover | pinned ×
                                # hoverIn | hoverOut | press | dismiss). Pinned by infoTipModel.test.ts + infoTipWiring.test.ts

    Inputs/
      InputsPanel.tsx           # Smart BLOC sidebar — .scrollArea + sticky .recommendations. The plan of record's Run 4:
                                # the recommendation is "Your plan's suggested line" — placement's suggestedLineUsd on
                                # the plan's Coinbase leg (planCbLoanBalanceOf / planCbCollateralOf, accrued) at today's
                                # price, with decisionView's suggestedLineWords under it (one copy with THE MOVE's line);
                                # it replaced "Recommended min" (runBlocYearOne's peak × 1.10 at a typed 0.15 ceiling)
      InputsPanel.module.css

    Settings/
      SettingsMain.tsx          # PHASE 1 NAVIGATION SHELL — an iOS-style section MENU (rows) that drills into
                                # dedicated SUBPAGES, driven by a LOCAL `settingsPage` state (NOT the store/activeTab):
                                # 'menu' | 'identity' | 'sharing' | 'strike' | 'plan' | 'cbloan' | 'display' | 'tabs' |
                                # 'network' | 'about' | 'backup'.
                                # Menu view = header (when !hideHeader → ← Back to app) + the section rows (SettingsRow
                                # helper: glyph icon + title + subtitle + chevron). Subpage view = a .subHeader (← Settings
                                # → menu + SUBPAGE_TITLES[page]) then that section's content. Split A (controls moved
                                # VERBATIM — same handlers/selectors/hooks, only relocated): identity = NOSTR IDENTITY
                                # (Enable-Nostr-Lock toggle + identity row + sync + recovery + decrypt-back); sharing =
                                # VIEWER ACCESS (pulled out of the shared Nostr section; topped by the owner's OWN npub
                                # truncated + "Copy your npub" button — reuses existing npubCopied/npubEncode logic —
                                # so the owner can hand their npub to the viewer without navigating to Identity);
                                # strike = BUDGET + STRIKE BLOC + COLD STORAGE (BL33: its own group after STRIKE BLOC,
                                # never behind hasCbLoan — "Total in cold storage" on the LIVE total, setColdStorageBtc,
                                # decimals 8, coldStorageView's words; the menu row adds "cold storage") inputs (+ a
                                # READ-ONLY "Strike API · Connected/Not connected" status row at the top of
                                # STRIKE BLOC, mirroring the derived strikeApiConnected — no connect/key UI; the Strike
                                # key is server-side + NIP-98-signed); plan = "Your plan" (the plan of record, Run 1 —
                                # the 🧭 row between Strike Strategy and Coinbase Loan; the page is YourPlanSection, the
                                # ONLY place the owner edits the saved support policy); cbloan = COINBASE LOAN details (P2b: when
                                # cbPaymentStrategy === 'ltvTriggered', an ACTION AT TRIGGER sub-toggle — Paydown | Add
                                # collateral — wires cbLtvAction; sub-toggle first, then the three threshold NumberInputs;
                                # middle label flexes ('Pay down to LTV' / 'Reduce to LTV'); a fieldHint warns
                                # add-collateral shapes logging/guidance only. The plan of record's Run 3: the
                                # Rotate-back LTV input left with its last reader (runAdvisor's refill, on no screen) —
                                # the order hint checks target < trigger < 86% — and the Strike page's "Balance at start
                                # of this month" with the projection it based; both values stay stored, inert. The plan
                                # of record's Run 4, D3: the payment-strategy pills and "Monthly payment" are gone — the
                                # ACTION AT TRIGGER sub-toggle, the trigger, the target and the order hint show whenever
                                # a loan is switched on);
                                # display = Simple Mode toggle + mining-in-log (the plan-bar toggles left with the plan
                                # of record's Run 2 — the card has no Strike or Coinbase bar; showPlan*Bar stay in the
                                # store, inert); tabs = TAB VISIBILITY & ORDER + DnD; network = RELAY LIST mgmt (P1:
                                # view/add/remove/restore the local nostrRelays via addRelay+normalizeRelayUrl; P3 (DONE):
                                # each row's dot is a LIVE connection status (green/amber/red) via useRelayStatus. P2 (DONE):
                                # the SYNC group's Import-from-Nostr
                                # (window.confirm → importRelaysFromNip65 → message by found/empty/not-found; replaces
                                # the local list only on a real found list) + Publish-to-Nostr (publishRelayListToNip65,
                                # no confirm) are LIVE; relaySyncBusy 'idle'|'import'|'publish' disables both + busy
                                # labels, relaySyncMsg in a .fieldHint); about = build-tap row + DevPanel.
                                # GATING PRESERVED: identity/sharing/strike/plan/cbloan/tabs rows stay !viewerMode (display/about
                                # always) — viewer visibility is unchanged from before (the zero-risk reading of the spec's
                                # "always" table). The ONE behavioral change: the `hasCbLoan` toggle moved OUT of the subpage
                                # ONTO a persistent Coinbase Loan menu row — off → row dimmed (.settingsRowDisabled), no
                                # chevron, body not tappable (only the toggle, stopPropagation so it doesn't navigate); on →
                                # tappable → cbloan subpage; a useEffect bounces 'cbloan'→'menu' if the loan is turned off
                                # while there. simpleMode embed (hideHeader): menu omits the app-back button, subpages still
                                # render their ← Settings sub-header. AUTH UNTOUCHED (NOSTR IDENTITY verbatim — Phase 2 will
                                # rework it). Still owns the local ALL_TABS constant (its `liqsim` row reads "Emergency"
                                # since the plan of record's Run 4, in step with the tab bar; its Coinbase Loan row reads "Balance,
                                # collateral, APR, crash-day trigger") + 5-tap devMode
                                # build row. P3.1: an
                                # optional registerBack?(fn|null) prop reports a one-level-back handler to the host — a
                                # useEffect([settingsPage,registerBack]) BEFORE the viewerMode early-return calls
                                # registerBack(settingsPage==='menu' ? null : ()=>setSettingsPage('menu')) (cleanup null),
                                # so AppShell's edge-swipe-back chains subpage→list then exits (mirrors the visible ← Settings)
      SettingsMain.module.css   # + Phase 1: .settingsMenu/.settingsRow(+Disabled/Icon/Body/Title/Subtitle/Toggle/Chevron)
                                # + .subHeader/.subBackBtn/.subTitle (theme tokens; additive — no existing class changed).
                                # + Phase 1 polish: .setupDateInput gains box-sizing:border-box + min-width:0 +
                                # -webkit-appearance/appearance:none (fixes iOS native date-control overflow; keeps
                                # color-scheme:dark) + read-only .strikeStatusRow/.strikeStatusLabel/.strikeStatusDotOn
                                # (green glow) /.strikeStatusDotOff (var(--text-faint), mirrors InputsPanel's strike dot)
                                # + Access Phase 2: .identityCard hero (--surface-2 + orange ring) /.identityRing/
                                # .identityNpub(+Text/CopyHint)/.identityMeta/.identityChip/.identityStatus/
                                # .identityDotOn(green)/.identityDotWarn(amber) + .syncRow/.syncRowLabel/.syncRowValue
      YourPlanSection.tsx       # The plan of record (Run 1) — Settings → "Your plan", the ONE place the owner edits the
                                # saved support policy (D2). SupportPolicySliders over the saved plan (usePlanPolicy):
                                # onChange={setPlanPolicy} onReset={resetPlanPolicy}, resetLabel="Back to the defaults
                                # (C1)", offSwitch={false}, readouts through effectivePolicySettings(raw, PLAN_CLAMP).
                                # BL14 (batch 1, build 2): + the GOAL group — its hint (GOAL_HINT until BL33), and GoalField,
                                # the goal's ONE editor: "Your goal — net coins", saved on blur or Enter (never per
                                # keystroke) through parseGoalInput → setPlanGoalNetBtc; after a save it shows what the plan
                                # kept (a 5c-refused edit snaps back); "No goal" clears it; anything else says GOAL_BAD and
                                # changes nothing. BL33 (build 2c): the GOAL group (GoalGroup) comes FIRST, before the six;
                                # the hint is GOAL_LEAD (two sentences) + GOAL_RULES folded under GOAL_RULES_TITLE ("What
                                # happens at your goal", one fact a line — δ-L9's bills and spare income, the stand-down's
                                # GOAL_STAND_DOWN_WORDS, the way back); GoalNow — net coins today in the Dashboard tile's
                                # words (goalNowView), read through useNetCoinsToday on useViewerSafety(null), the owner
                                # Dashboard's own mount, against the SAVED goal. The menu row reads "Your goal, and the
                                # support policy's limits and zones". Tested in __tests__/yourPlanGoal.test.ts (6)
                                # Styles come from SettingsMain's module (a `styles` prop), plus — for the goal field —
                                # its own YourPlanSection.module.css and NumberInput's module. ⚠
                                # Owner-only: emitPlanSets has no viewer guard, so SettingsMain mounts it (and its row)
                                # behind !viewerMode — SETTINGS pins both, and that no other file names the setters
      coldStorageView.ts        # BL33 — Settings → Strike Strategy's COLD STORAGE group as words, PURE: COLD_GROUP_LEAD
                                # (in your own custody; it counts in your net coins, never in a loan's LTV),
                                # COLD_FIELD_LABEL ("Total in cold storage"), COLD_HOW (log a move in Daily → Collateral →
                                # Cold; entering a total dates it today) and coldAsOfLine(asOfMs, movesSince) — "Entered
                                # <day>, plus N moves since." / "Entered <day>." / "Not dated yet — enter your total once to
                                # date it." for a stamp the derive can't read (null or non-finite: isAfterColdAnchor's own
                                # test); N is coldMovesSinceAnchor's, so "since", never "logged since". Never "anchor",
                                # "journal" or the Almanac's sweep. Tested in __tests__/coldStorageGroup.test.ts (the words,
                                # and the group's wiring read off SettingsMain's source)
      RevealRecoveryKey.tsx     # Access Phase 2 → R2c-1 — lost-my-backup escape hatch, VIEW-ONLY (+ .module.css).
                                # Rendered ONLY in the identity subpage for a 'local' signer (leaving the page unmounts →
                                # discards the material). Tap → PRF Face ID / PIN field → **unwrapRecoveryPayload** (EVERY
                                # reveal) → branch on payloadKind: 'nip06-entropy' → <WordGrid mode="reveal"> of
                                # wordsFromEntropy(bytes) + an "Advanced: show as nsec" disclosure that derives
                                # nip19.nsecEncode(deriveSkFromEntropy(bytesRef)) ONLY when opened, zeroing the derived sk
                                # right after encoding (bytesRef held for the disclosure, zeroed on Hide / ~30s auto-clear /
                                # unmount); 'sk'/absent → nip19.nsecEncode(bytes) + bytes.fill(0) now → <SecretKeyCard/>
                                # (unchanged). ⚠ It NEVER verifies or stamps backupVerifiedAt — it is the utility; the
                                # ceremony is the flow. NEVER logs key material
      RecoveryKeyCeremony.tsx   # R2c-1 — the REAL backup ceremony (+ .module.css): explain → reveal → verify → done.
                                # Own overlay (accessFlow-style, z-index 99999) — NOT a settingsPage subpage (a guided
                                # reveal+quiz must own the screen + must not inherit the subpage back-chain / edge-swipe
                                # that could escape mid-quiz). Entry = a "Save your Recovery Key" button in the identity
                                # RECOVERY group (local-signer-gated, above RevealRecoveryKey) with a "Backed up ✓ <date>"
                                # chip when backupVerifiedAt != null. EXPLAIN copy is owner-facing prose (body 3 —
                                # "generated fresh … never use as a Bitcoin wallet" — renders ONLY for payloadKind
                                # 'nip06-entropy'). REVEAL reuses RevealRecoveryKey's unlock shape (PIN row / passkey-on-tap)
                                # → unwrapRecoveryPayload → derives words/nsec and ⚠ ZEROS bytes IMMEDIATELY (earliest —
                                # verify + "view again" read only the strings, never bytes; contrast RevealRecoveryKey which
                                # retains bytes for its on-open Advanced-nsec); WordGrid reveal (its own Copy) / SecretKeyCard.
                                # R2c-7b SAVE AIDS — three aids over ONE `ensureArtifact()` gate: **Download** (a .txt via the
                                # shared downloadBlob + the pure buildRecoveryFileText/recoveryFileName), **Save…**
                                # (navigator.share, rendered only when it exists — an iOS enhancement ALONGSIDE the download,
                                # never instead of it; the download is the universal floor since desktop has no share), and
                                # **Show printable QR** (QRCodeSVG of the artifact + numbered words / nsec on white, plus a
                                # **Download QR** .png). ⚠ The PNG comes from a HIDDEN <QRCodeCanvas ref size=512
                                # marginSize=4 style=display:none> → canvas.toBlob() — qrcode.react@4 forwards a real
                                # HTMLCanvasElement ref and draws purely from props, so there is NO SVG→PNG rasterization
                                # (no XMLSerializer, no Image load, no WebKit canvas-taint risk). marginSize=4 is the spec
                                # quiet zone: the on-screen SVG omits it because the white .qrPanel pads it, but a bare PNG
                                # would scan unreliably. ENCRYPT TOGGLE (default OFF; shared ui/Toggle — owner-only surface,
                                # so its viewerMode self-disable is moot) → a passphrase field whose copy is STATE-SPECIFIC
                                # per the R1.5 rule ("Passphrase to encrypt this file" / "…it is not your device PIN, and we
                                # can't recover it") because it is the ENCRYPT direction of the widget R2c-7a uses to DECRYPT
                                # and a device-PIN field can be on screen simultaneously; the 4 iOS suppressions are
                                # mandatory (an autocapitalized passphrase would never decrypt). ON → the artifact becomes
                                # ncryptsec = nip49.encrypt(sk, filePass.trim()) — ⚠ `.trim()` is SYMMETRIC with every
                                # decrypt site (SharingPage encrypt, ViewerLoginFlow + NostrAuthGate decrypt); an untrimmed
                                # passphrase here would silently never restore. ⚠ THE SK IS RE-DERIVED FROM THE DISPLAY
                                # STRINGS (skFromWords(words) for entropy, nip19.decode(nsec).data for sk), NEVER from
                                # retained bytes — that is what keeps the earliest-zeroing invariant above intact; the
                                # derived buffer is zeroed in a `finally`, on success and on throw. Plaintext is the DEFAULT
                                # (a mnemonic backup is meant to be readable off paper; filename + header are the honest
                                # mitigation) and an entropy key shows the asymmetry line "Encrypted backups restore as a
                                # key, not your 12 words" (an ncryptsec decrypts TO an sk → payloadKind 'sk' → the word grid
                                # never returns; the line is hidden for an sk key, where the restore is a key either way).
                                # ⚠ ENCRYPT IS A ONE-SHOT ON TAP, NOT DEBOUNCED (unlike 7a's decrypt, nothing here reacts to
                                # typing) — it yields 30ms so "Encrypting…" paints before ~1s of synchronous scrypt, well
                                # inside navigator.share's 5s transient-activation window. A monotonic `prepRef` token +
                                # disabling the toggle/passphrase while `encrypting` kill the stale-result race (the inputs
                                # are live during the paint yield; without the token an encrypt started under the OLD
                                # passphrase would land in the cache and Download would write a file locked with a passphrase
                                # the user never typed — the same hazard, and the same fix, as 7a's clearTimeout). Errors →
                                # a generic "Couldn't encrypt — try again." (⚠ NEVER e.message). `artifact`/`qrValue` are
                                # invalidated on any toggle/passphrase change, so the QR on screen can never disagree with
                                # what Download writes. ⭐ THE ENCRYPTED EXPORT IS THE FIRST OWNER-KEY ncryptsec THIS APP
                                # PRODUCES — it is exactly R2c-7a's acceptance-test input (see § Recovery-key encrypted
                                # import).
                                # R2c-7b-fix DOWNLOAD-REQUIRED GATE: `savedOnce` (default false) is set by doDownload,
                                # downloadQR (a saved QR IS a saved backup), and share — the latter ONLY when
                                # navigator.share RESOLVES (an iOS share-sheet cancel rejects with AbortError, and a
                                # cancelled share is not a save; the guard is `if (!navigator.share) return` FIRST, never
                                # `await navigator.share?.()`, which resolves undefined and would open the gate). Continue is
                                # `disabled={!savedOnce}` with a hint ("Download or save your Recovery Key first…").
                                # ⚠ savedOnce RESETS inside `invalidateArtifact` — the same change that stales the cached
                                # artifact stales what the user already saved (download plaintext → toggle encrypt ON → the
                                # file on disk is NOT the encrypted backup they're about to be quizzed on) — and in
                                # `clearAids`. Without the gate a user could walk the whole ceremony, answer the quiz off the
                                # ON-SCREEN grid, and stamp backupVerifiedAt with the key living only in RAM.
                                # VERIFY — PER-PATH (R2c-7b-fix), branching on `verifyEncrypted`, a SNAPSHOT of encryptOn
                                # taken at Continue-time in goVerify (the reveal toggle is unreachable during verify, so
                                # freezing it stops a stray toggle changing the question mid-verify; going ← Back re-enters
                                # goVerify → re-snapshots, correct since invalidateArtifact already forced a re-save).
                                # PLAINTEXT — entropy: a 2-word quiz (pickQuizIndices, re-randomized on every fail, unlimited
                                # attempts, "← View words again"); sk: the nsec last-6. ENCRYPTED — passphrase RE-ENTRY
                                # (checkBackupPassphrase(filePass, verifyPass), compared TRIMMED both sides; mismatch →
                                # "That doesn't match the passphrase you just set."; ghost reads "← Back to save"), because
                                # the artifact they saved is a passphrase-locked ncryptsec and a forgotten passphrase is the
                                # only thing that can lose the plan. `filePass` survives reveal→verify (component state; only
                                # clearSecrets clears it). SUCCESS → setBackupVerifiedAt(Date.now(),
                                # nostr) — the setter's OWN dirty+syncNow self-wake un-gates sync; ⚠ NO second wake added.
                                # The stamp path is byte-identical across both verify paths — only what's compared differs.
                                # IDEMPOTENT: an already-stamped user runs it end-to-end as a re-verify (never a dead end);
                                # success re-stamps (monotonic-forward). ⚠ Never logs; strings nulled on done/close/unmount
      BackupGateInterstitial.tsx # R2c-2 ladder rung 3 (+ .module.css) — the hard gate that REPLACES the Sharing +
                                # Network page bodies while the backup gate is unsatisfied ("Save your Recovery Key
                                # first"). Self-contained: owns its own ceremonyOpen + renders <RecoveryKeyCeremony/>;
                                # ghost ← Back = onBack (SettingsMain wires it to setSettingsPage('menu')). For a
                                # generated-unverified key the engine is idle anyway (R2a-1) → these pages silently no-op
                                # → the interstitial converts that into a path forward. Mounted at both SettingsMain
                                # branches (sharing ternary + gated network sibling; useRelayStatus also gated so no
                                # probe sockets open behind it). See § Backup Gate Escalation Ladder
      SharingPage.tsx           # Viewer M3 — the 'sharing' subpage (+ .module.css; SettingsMain renders <SharingPage/>
                                # for settingsPage==='sharing', owner-only). YOUR SHARE CODE (owner npub + copy) + YOUR
                                # VIEWERS = <ViewerRoster/> (LOCAL-SIGNER-gated: a non-local device shows a note) + a
                                # PREVIEW trigger. ViewerRoster lists every provisioned viewer (one .grantCard each:
                                # label · npub · tier chip · "Show real figures" per-row Toggle [slot.tier] · ↻ Rotate ·
                                # Remove-with-confirm) + the ADD flow (label + Safe|Trusted picker + optional passphrase →
                                # Face-ID/PIN unwrap → deriveViewerKeyFromNsec(pk, keyVersion, index) → addViewerSlot →
                                # publishViewerSnapshotNow → SecretKeyCard token reveal ~30s). ONE shared derive engine
                                # for add + rotate; `rotatingIndex` (null ⇒ ADD) carries the intent through the PIN step.
                                # The owner MINTS every viewer key — NO viewer-supplied-npub add path (died at Handoff v4).
                                # NO replace-guard (add = fresh nextViewerIndex; rotate = the only confirmed overwrite).
                                # Per-row Remove → publishViewerRevocationNow(slot.pubkeyHex) + removeViewerSlot
      DevPanel.tsx              # Dev diagnostics (devMode only): sync state, PUBLISH ACKS, COLLATERAL (baseline/pending/
                                # current — ON-DEVICE only), signer probe, Nostr log ring, copy-diagnostics.
                                # ALL sections are COLLAPSIBLE via a local <Section title/action?/defaultOpen?> (returns a
                                # FRAGMENT — header + conditional body stay flex siblings of .panel so layout is unchanged
                                # when open; header reuses .sectionTitle with a ▸/▾ chevron; action buttons stopPropagation
                                # so they don't toggle; session-only open state). defaultOpen: SYNC STATE only. PUBLISH ACKS
                                # (after SYNC STATE) renders getPublishReports() newest-first — per-attempt label/age/outcome
                                # + per-relay url·status·Nms lines; a ghost Refresh re-snapshots the in-place-mutated buffer;
                                # copyDiagnostics adds lastPublish (newest report, metadata only). Phase 4a-inst adds a
                                # size suffix to each PUBLISH ACKS row (eventBytes/plainBytes, real bytes via publish.ts's
                                # byteLen) and a PAYLOAD SIZES block inside SYNC STATE (newest report per records /
                                # plan events / prefs / viewer channel, via RECORDS_DTAG/PLAN_EVENTS_DTAG/PREFS_DTAG + a
                                # viewer:v2: label-prefix match — 4e dropped the settings row). 5a: every size display (the
                                # PAYLOAD SIZES rows + each PUBLISH ACKS row) is tinted by sizeStyle(report) →
                                # payloadSizeLevel (lib/nostr/payloadSize.ts) on the PLAIN bytes: --orange past 32,768 B
                                # (the plan log's budget), --red past 40,960 B (NIP-44's padding step — past it the event
                                # goes out ~66 KB, over a 64 KiB relay limit); a report with no plain size (the public
                                # kind-10002 list) keeps the 60,000 B wire budget (WARN_EVENT_BYTES is gone) — display-only,
                                # no behavior change. PLAN EVENTS section: event count ("events raw/compacted"), 5a's "log
                                # size" (the plain bytes of { events: compacted } — what the next publish would send, live,
                                # same tint), planDirty/prefsDirty, plan/prefs sync, parity,
                                # and (4e, G2) "log gaps" — planLogGaps(planEvents, getState(), getInitialState()):
                                # "none" green / the names amber / "n/a (viewer)" in viewerMode. 4e removed the
                                # "settings sync" and "v1 fallback" rows; Copy Diagnostics carries planSync.
                                # 5b: JOURNAL (pages · the largest page · the manifest · the v1 bridge, whole or stub ·
                                # the last pull's relay check — full or changed pages, listed, fetched, missing · carried ·
                                # too large; sizes and month keys only) · RELAY LIMITS → Probe (relayLimits.ts: each
                                # relay's NIP-11 frame cap, then three throwaway events from a one-time key — 1 KB, 40,960 B
                                # and 40,961 B plain as NIP-44 sends them — and each relay's OK or refusal). The size rows:
                                # "records v1" (was "records"), "journal page", "journal manifest". Copy Diagnostics += journal
                                # 5c: PLAN EVENTS += "plan pull" (the last plan pull: applied / none / unreachable /
                                # unreadable · why · plain size · time; amber when unreadable or unreachable) and "plan
                                # here" ("loaded" / "not loaded — writes held", amber / "own copy (not signed in, or a
                                # viewer)"). Copy Diagnostics += planLoad { last, planLoaded, writesHeld } — statuses,
                                # sizes and flags only
                                # AT-REST ENCRYPTION (3a.5: flag/blob-state/key-in-memory/GATE_* readout + an
                                # ASYMMETRIC flag toggle that reloads — Enable RAW, Disable decrypts-first; dev tooling).
                                # Copy Diagnostics + log ring stay METADATA-ONLY (pendingNonZero boolean,
                                # never balances/amounts/log contents); the panel itself may show position figures.
                                # SYNC STATE grid also carries a BTC-PRICE-AGE row (store price + "Ns/Nm ago", ⚠ stale
                                # >5min, from btcPriceUpdatedAt; 5s now-tick so a dead poll's age climbs visibly) —
                                # DevPanel-ONLY, rendered in JSX not the syncState object (kept out of Copy Diagnostics).
                                # SERVICE WORKER section (container-local — reads only navigator.serviceWorker/caches/
                                # matchMedia, no store): display mode (standalone PWA vs browser tab), controller,
                                # registration installing/waiting/active states, a fired registration.update() result,
                                # caches.keys(), per-workbox-precache-* cache entry count + /index.html match
                                # (cache.match with ignoreSearch — precached URLs carry a __WB_REVISION__ query param),
                                # per-same-origin-script cache match, and a confirm-gated "Re-register SW + reload"
                                # repair (unregister all → clear all caches → re-register /sw.js → reload). Exists
                                # because the index.html ?swdebug probe can't be reached once installed as a
                                # Home-Screen PWA, and on iOS the PWA's storage/SW registration is ISOLATED from
                                # Safari — a Safari-tab probe can't see the installed container at all; DevPanel
                                # (devMode-gated) is reachable from WITHIN the running PWA container itself
      DevPanel.module.css
      SyncTooLargeNotice.tsx    # 5b — Settings › SYNC: what the size guard refused, in plain words (useSyncBlocked);
                                # renders nothing while everything fits
      PlanNotLoadedNotice.tsx   # 5c — Settings › SYNC: the plan hasn't loaded on this device — why, and that nothing is
                                # lost or overwritten meanwhile (usePlanLoad); after a pull that found nothing at all, the
                                # two readings and "Start a new plan". Renders nothing once the plan is loaded, or before
                                # a pull has settled why

    Summary/
      SummaryBar.tsx            # Smart BLOC summary (local sign-preserving fmtUSD)

    Collateral/
      TierCards.tsx             # Min/Rec/Ideal/Custom — 4-col grid
      TierCards.module.css

    MonthBreakdown/
      MonthBreakdown.tsx        # 12-month table, growth scenario toggle, credit line rec
      MonthBreakdown.module.css # Phase 1-4 left-border + legend, scenario toggle styles

    Charts/
      BtcStackChart.tsx
      NetEquityChart.tsx
      LTVSafetyChart.tsx

    LivingOnBitcoin/
      LivingOnBitcoin.tsx
      LivingInputsPanel.tsx
      NetWorthChart.tsx
      ComparisonBanner.tsx
      StrategyCards.tsx
      StressTest.tsx

    PowerLaw/
      PowerLawFace.tsx          # THE Power Law face (spec pbloc-spec-powerlaw-face-v1) — the four faces' layout (Ownership,
                                # Cycling, Strategy, Decision): one column, the SAME on both surfaces, each of which mounts
                                # it bare (AlmanacView `if (f === 'powerlaw') return <PowerLawFace />;`; AppShell's main
                                # `<PowerLawFace />`, its sidebar `null`, and `[data-active-tab="powerlaw"]` hides the
                                # sidebar). D1's order: the head ("POWER LAW" + PL_FRAMING) → the chart card (a
                                # <section className={styles.card}> holding the three branches verbatim — ONE error test:
                                # `loading` → PowerLawChartEmpty "Loading price history…"; `!loading && error !== null` →
                                # "Price history unavailable"; `!loading && error === null` → PowerLawChart) → today's
                                # tiles → "The model" card (modelLines) → the amber disclaimer. Nothing above the chart waits
                                # on the network, so on a phone the chart opens on screen (309.5–669.5 at 390×844) and never
                                # moves as the numbers fill in (F2). Hooks: useBtcPrice + usePowerLawData only — NO block-
                                # height fetch (D2: the old side panel fetched mempool.space on open, breaking the Almanac's
                                # "live off" promise, F1). The face types no figure and no band name (I8) — its copy comes
                                # from powerLawView; it types only "The model" and the two chart states, as DecisionFace
                                # does. A same-file TodayTiles owns useBtcPrice() and `today` (useState(() => new Date())),
                                # so its own poll re-renders only the tiles; AppShell's root useBtcPrice still re-renders the
                                # face on every 10 s poll and 30 s tick, which is why PowerLawChart is memoised (R2). Tiles:
                                # two per row in the Almanac at every phone width; on the full-mode tab one per row below
                                # 362px (a 288px grid at 360); five in one row on a computer. powerLawWiring pins all of it
      PowerLawFace.module.css   # COMPOSE-ONLY: exactly twelve rules, each `composes: <name> from
                                # '../Almanac/CyclingFace.module.css';` (face, head, title, framing, card, cardLabel,
                                # noteQuiet, statGrid, stat, statValue, statSub, disclaimer) — nothing else, so the face
                                # can't drift from the four and composedOverrides has nothing to arbitrate (I2; powerLawWiring's
                                # ONE-layout check)
      PowerLawChart.tsx         # Recharts calendar time × log price (YAxis scale="log", fixed [0.01, 1e8]; NOT log-log —
                                # the X axis is dates) + the shared chart zoom (§ Chart zoom): UTC 1-January year ticks
                                # from timeTicks, full extent = the first and last weekly row. POLISHED to the Decision
                                # chart's conventions (spec pbloc-spec-powerlaw-polish-v1): tokens only (no hex —
                                # powerLawWiring); the token tooltip (powerLawTooltip: a UTC "D Mon YYYY" head, prices
                                # via fmtTooltipUsd); CartesianGrid --line-2; the history an <Area> (a per-mount useId
                                # gradient, never animated — P2 — or it trails the bands on every pan); the bands
                                # <Line>s from PL_SERIES; "Today" one timestamp per mount (useState); ticks
                                # --text-muted (P6); margin {8,12,0,0}, Y width 52. The Tooltip stays quiet through a
                                # gesture and after it, and every series carries activeDot={!zoom.quiet} (Z17); the box
                                # snaps to the pointer (isAnimationActive false + transitionProperty none, Z23). Renders
                                # its TITLE ROW (ChartHead: PL_CHART_TITLE "Price and the bands" — D4: in the face's card
                                # the old "Price · history and the power-law bands" wrapped to three or four lines beside the
                                # toolbar on a phone, past the 32px row, so the box dropped when the chart arrived (F6) —
                                # plus ChartZoomToolbar, Z18), its own fixed-height box
                                # (data-testid "powerlaw-chart-box") and, under it, the swatch line from
                                # legendEntries(historyDrawn(chartData)) (data-testid "powerlaw-legend") — it lives
                                # here because only this component has chartData (chartZoomWiring reads its memo here).
                                # Exports PowerLawChartEmpty (the loading / error state: the same title row and box).
                                # MEMOISED (R2) — `export const PowerLawChart = memo(function PowerLawChart(…))`, the
                                # Decision chart's pattern: AppShell's root useBtcPrice re-renders the whole tree on every
                                # 10 s poll and 30 s tick, and the props are stable references from usePowerLawData. Chart
                                # renders in 40 s idle (dev, Strict Mode doubles): d521cd1 10 · the face with its own price
                                # poll 20 · TodayTiles 10 · TodayTiles + memo 0 (powerLawWiring pins the memo)
      PowerLawChart.module.css  # The box (D4): --pl-plot 480px desktop / 360px at max-width 640px — the toolbar sits in
                                # the title row (Z18), so there is no toolbar term (the old --pl-toolbar is gone). ⚠ P8:
                                # every --pl-* value is a LENGTH (a bare number makes height: var(--pl-plot) invalid → the
                                # box collapses to 0px; powerLawWiring pins the units). .chartHead / .cardLabel COMPOSE
                                # the Decision chart's title row. ⚠ The height sits on a DOUBLED class (.chartBox.chartBox and
                                # .chartEmpty.chartEmpty), as the Decision chart's does since P9: beside `composes:` it
                                # would tie the composed height, so load order would decide — and here OwnershipFace's
                                # 240px won (measured; § Critical Constraints). The tooltip and swatch classes COMPOSE
                                # the Decision chart's (CyclingFace / DecisionFace) — reused, not copied
      powerLawView.ts           # PURE view model (+ __tests__/powerLawView.test.ts). PL_SERIES — ONE table the chart's
                                # series, the tooltip rows and the swatches all read: History --btc area · Resistance
                                # --amber dashed · Fair --text-secondary solid · Support --green solid (see Design
                                # Tokens → chart colours). powerLawTooltip(t, values) · historyDrawn(rows) (P3: at least
                                # two rows with a finite price > 0 — the log axis drops $0, and a lone point draws
                                # nothing) · legendEntries(drawn). THE FACE'S COPY (spec pbloc-spec-powerlaw-face-v1) — every
                                # piece that carries a figure or a band name (I8): PL_FACE_TITLE · PL_FRAMING · PL_CHART_TITLE
                                # · todayTiles(livePrice, plBandsAt(today)) → Price · vs Fair · Resistance · Fair · Support
                                # (labels from PL_BAND_LABEL, values through fmtUSD; vs Fair a true minus and no sign at 0.0,
                                # ONE `above` predicate for its sign, words and colour; no live price — null, ≤ 0 or not
                                # finite — reads "—" with "no live price yet" and drops vs Fair, stricter than the old panel,
                                # whose 0 read −100.0%; the band subs are the constants' own multiples, "2.07× fair" /
                                # "the trend line" / "0.36× fair") · fmtCoef (1.16e-17 → "1.16 × 10⁻¹⁷"; a mantissa that
                                # rounds to 10 carries) · fmtMonthYear (fmtTurnDate's fixed UTC month table, never ICU's
                                # "Sept") · modelLines() (the formula from the constants, "(3 Jan 2009)", "On the model,
                                # Support reaches $100k in Feb 2028 and Fair reaches $1M in Nov 2032." via plDateAtPrice —
                                # the old panel's typed "~2033–2035" disagreed with the line — and the calibration sentence)
                                # · PL_DISCLAIMER

    Converter/
      ConverterMain.tsx         # The title, the converter card (SATOSHIS / BITCOIN / US DOLLAR), then the Satoshi Rates
                                # card (spec pbloc-spec-sats-rates-v1 — it was the sidebar's last section): a
                                # <section aria-labelledby> holding the nine rows from rateRows(btcPrice). Each row is
                                # <tr role="button" tabIndex={0}> (the Decision row idiom: a tap, a click, Enter or Space)
                                # → fillFromRate → the fields' OWN updateActiveField / updateRawValue, which set the state
                                # AND the store (S2). ⚠ The store is written ONLY by those two. This component reads it
                                # once, in its useState initialisers, so a row that wrote the store alone changed nothing
                                # on screen — the old sidebar table did exactly that. converterWiring pins it
      ConverterMain.module.css  # + the rates card: the table fills it (the card has no padding); the title is the
                                # sidebar's old section header (8px, orange). No column min-widths: their 340px floor
                                # overflows the full-mode tab's 316px box. ≤480px — D1 TIGHTENED (the owner): 12px text,
                                # 8px cell padding, so every row is one line on a phone. The rows need 305px (312 from
                                # $100k); the card gets 356px in the Almanac face at 390 and 316px in the full-mode tab
                                # (AppShell's 20px + the 16px gutters) — 13px / 12px would need 350
      ConverterSidebar.tsx      # Four sections: Sats Per Dollar, Bitcoin Price, Key Equivalences, What is a Satoshi? — no
                                # table and no store writes (the rates moved under the converter)
      converterView.ts          # PURE (no store, no React). The ONE SATS_PER_BTC and fmtUsdLocal the Sats page prints
                                # (6 decimals under a cent, 4 under a dollar, then 2, grouped) · RATE_SATS (1 →
                                # 100,000,000) · rateRows(btcPrice) → { sats, satsText, btcText, usdText }. D1: no unit
                                # words in the cells — "丰 1,000", "₿ 0.00001000", "$0.8200"; the column headers name the
                                # units. S4: no usable price (Number.isFinite && > 0 fails) → "—", never "$0.000000"

    Mining/
      MiningMain.tsx
      MiningMain.module.css
      MiningInputsPanel.tsx     # Per-device: hashrate, pool name, pool fee, solo toggle
      MiningProjectionTable.tsx # SAT ACCUMULATION scrubber + IF BTC REACHES + IF YOU FIND A BLOCK
      MiningOddsBar.tsx         # Reads devices from store directly

    CoinbaseLoan/
      CoinbaseLoanMain.tsx      # The CB Loan tab, since the plan of record's Run 4: header; the crash-day banner (on
                                # isCrashDay — the console's line, atTriggerLine(trigger, true), and "Open the
                                # Emergency Console →", onOpenConsole); stat cards (CURRENT LTV in Safety's colour and
                                # words — SAFE / FAIR / POOR from deriveSafetyView's cbLevel); the LTV bar (LtvSafetyBar —
                                # Safety's colour, the owner's trigger marked "↑N% your trigger", and 86%); the price
                                # alerts (two rows: "Your trigger" — cbLtvTriggerPct at cbMetrics' trigger price, "Work
                                # from the Emergency Console" — and "Auto-Liquidation", 86%; a price under the dust floor reads —); the liquidation modeler;
                                # PLAN_PATHS_LINK (onOpenPlanPaths; none while the Almanac tab is hidden); "On a crash
                                # day" (cbTabCrashDayLine + the console link); the Strike vs Coinbase comparison. Props
                                # onOpenConsole / onOpenPlanPaths (AppShell; each null while its tab is hidden — no link). Run 4 removed the 12-month projection (it
                                # read the retired cbMonthlyPayment, through runCoinbaseLoan), the typed 70% / 76% / 84%
                                # alert rows and the "Emergency Protocol" card — a fourth crash-day answer — and
                                # classifyLtv's colours
      CoinbaseLoanMain.module.css # The plan of record's Run 4: 39 dead rules pruned (the projection's table and summary,
                                # its status and LTV colour classes, the protocol list, the 76% / 84% badges);
                                # + .consoleLink / .pathsLink
      CoinbaseLoanSidebar.tsx   # The plan of record's Run 4: MONTHLY PAYMENT is gone (cbMonthlyPayment retired, D3)
      CoinbaseLoanSidebar.module.css
      LiquidationModeler.tsx    # 4-scenario liquidation math; gated by cbLiquidationPrice > 0
      LiquidationModeler.module.css

    Advisor/
      AdvisorMain.tsx           # The full-mode Advisor tab — the plan of record's Run 3 (D5): progress bar, position
                                # cards, THEN THIS MONTH'S CARD (<PlanMonthCard>, on the tab's ONE run from
                                # usePlanCardInputs — the crash line, the NDP and the Ledger pointer, which opens Simple
                                # mode's Daily view), then MonthlyLogSection and its overlay (their planned figures:
                                # planLogRows on the same run), then the "Your plan on other price paths" link to the
                                # Decision face (onOpenPlanPaths; none while the Almanac tab is hidden). No runAdvisor, no
                                # Pay / Skip (the policy has no skip; advisorSkip* are inert), no projection table; the
                                # card's figures print to the cent (THIS MONTH's own card). Year complete: one card, as
                                # before. The plan of record's Run 4: the Coinbase position card's Current LTV figure and
                                # colour are Safety's (deriveSafetyView(selectSafetyViewInputs) — cbLtv,
                                # LEVEL_COLOR[cbLevel]), no longer getTier / getTierColor
      AdvisorMain.module.css
      (OutlookProjection.tsx and outlookView.ts — DELETED in the plan of record's Run 3, with outlookView.test.ts: the
       Outlook became a link to the Decision face, and runAdvisor's scenario projection left every screen)
      AdvisorSidebar.tsx        # BTC LIVE badge, YOUR PROGRESS (start date, BLOC balance,
                                # BTC held), read-only summaries, priority rules (Run 4 replaces them — done: YOUR PLAN,
                                # planRuleRows(planPolicySettingsOf(usePlanPolicy()), expenses) — the six settings in the
                                # sliders' words, as the plan runs them, always shown — where the typed PRIORITY RULES
                                # (55 / 65 / 70) stood; the Coinbase summary lost "Min. payment"). Its "projecting
                                # from Mo N" line left with the projection (the plan of record, Run 3)
      AdvisorSidebar.module.css # The plan of record's Run 4: the rule* rules (ruleList / ruleRow / ruleDot / ruleText)
                                # went with PRIORITY RULES
      MonthlyLogSection.tsx     # Horizontal carousel + detail panel (full mode). The plan of record's Run 3: its
                                # "(proj)" figures and its inline form's starting figures are the plan's run —
                                # `months: PlanLogRow[]` (planLogRows): the buy, the Strike balance and LTV, Coinbase's
                                # balance and LTV at month-end, and the Strike paydown planStrikePaidUsd (never the old
                                # income residual); a past month has none (D14)
      MonthlyLogSection.module.css
      MonthlyLogOverlay.tsx     # Portal CENTERED MODAL (.overlay dim backdrop → .modalCard; was
                                # full-screen) with header/✕/‹›arrows/dots INSIDE the card; ✕ or
                                # click-outside closes; keyboard + swipe nav (handlers on .modalCard).
                                # initialMonth is 0-INDEXED (0–11) — Simple Mode passes currentMonth-1 /
                                # selectedMonth-1; Advisor passes currentMonth-1. Optional openInEditMode
                                # opens a LOGGED month straight in the edit form (a didInit ref keeps the
                                # per-month nav-reset from clobbering the seeded `editing`); Simple Mode's
                                # "Edit this month" sets it, the Advisor multi-month browser omits it.
                                # The inner month card sits FLUSH on the .modalCard surface (.card chrome
                                # stripped — transparent/no-border/no-radius; the shell is the only card,
                                # one inset via .cardScroll padding) — no card-in-card. Edit .formGrid is
                                # SINGLE-COLUMN (1fr) so long decimals fit; .viewGrid is a label/value column.
                                # Run 2.1 (BL19): a `money` prop for its rows' dollars, whole (fmtUSD) by default — full
                                # mode's Advisor passes none; THIS MONTH (SimpleModeView) passes fmtUSDCents. The edit
                                # form still shows a value as stored (unrounded). The plan of record's Run 3: `months` are
                                # PlanLogRow[] (planLogRows, both hosts' one run); the current month's LOG form starts from
                                # the plan's own Strike paydown and month-end LTVs (ltvFieldNumber: ∞ → 0); the tier
                                # collateral prop is gone
      MonthlyLogOverlay.module.css

    Daily/
      DailyModeView.tsx         # Daily Mode P4a — READ-ONLY day-level consumer view, presentation aligned to
                                # mode-toggle-preview.html's visible Daily panel: header + <SafetyDashboard/> VERBATIM
                                # (the plan of record's Run 4, D-R4-1: moveBringsCbWithin from Daily's own run) +
                                # the compact trio (Strike collateral · balance · avail credit via strikeAvailableCredit).
                                # RESTYLED to the preview: .appbar header (boxed .iconBtn); a TWO-PART ACTIVITY card —
                                # (a) AGGREGATE .act-*/.streams: what was bought (5c) + Draw/Paydown/Buy bars whose width =
                                # actual/plan (a READ-ONLY rollup of the month's dayLog) + the interest foot, (b) per-event
                                # .log-row LOG (describeDayEvent label/detail + a component-local eventTone(kind)→dot/ring
                                # + amt color); and a .pbcard PLAN card. ⚠ Since the plan of record's Run 2 the planned
                                # side is the PLAN's month 1 — usePlanMonth, the run THIS MONTH reads (no runAdvisor,
                                # deriveForMonth or composeMonthSummary here). The .pbcard shows planStatus's title (or
                                # PLAN_CRASH_TITLE on a crash day — isCrashDay, the console's gate: the Coinbase loan
                                # since the plan of record's Run 4, D3), the month's rows
                                # (planMonthActions: venue dots + VenueText), Strike's minimum (income: planMinimumLine +
                                # its chip; roll: a "Strike interest" row) and "Why this plan?" (planMonthSummary) — and,
                                # BL14, the goal line under the status (planGoalLine on month 1; none with no goal). The
                                # bars' targets are planLedgerTargets(row 1) — drawn: the bills' draw + a defense's draw;
                                # paid: spare income's repayments + a refinance's payment to Strike + a defense's payment
                                # to Coinbase + the margin cure — against the Ledger's paydowns on BOTH loans (Δ4).
                                # "Interest capitalized" is the plan's interest less the minimum income paid, shown only
                                # past the dust floor and only for the current month (Δ5). ⚠ Run 2.1 (F13): the bars come
                                # from planMonthView's planBars — the month so far in BOTH scopes: Week reads
                                # `currentRollup` (the CURRENT month's rollup, under planBarsCaption's "Month N so far"),
                                # Month the viewed month's; a past month gets no target (D14) and no fill; `clampPct` is
                                # gone. The day's own head and log are unchanged. Every dollar figure to the cent
                                # (fmtUSDCents, BL19 — it no longer imports fmtUSD); the month review's NDP seed is
                                # planNdpEstimateUsd on planNdpBalance — the balance THIS MONTH's NDP card and Daily's NDP
                                # check read too.
                                # Empty → dashed .empty. The standalone month indicator was dropped (month context lives in
                                # act-when + pb-sub). P4b-1: a Daily-only orange .fab (bottom-right, --btc gradient, hidden
                                # when viewerMode) → opens <EventSheet/> for ADD (setEditEvent(undefined)). P4b-2: each
                                # editable-kind log row (isEditableKind — draw/paydown/buy/deposit/balanceReading; not
                                # withdraw/cbCollateralReading) is tap-to-EDIT (role=button + Enter/Space + .logRowClickable
                                # hover) → setEditEvent(ev) → the SAME <EventSheet/> in edit mode; gated !viewerMode (the
                                # row is inert for viewers). calendar/scrubber + past-dating still out (P4c). Props
                                # {onOpenSettings}. DailyModeView.module.css alongside (own classes incl. .fab +
                                # .logRowClickable; uses the global --surface*/--line*/--btc/--mono tokens + reuses --green/--amber/--red/--text-*)
      dailyView.ts              # PURE display helpers (no store/UI/price dep): selectMonthEvents(dayLog, month,
                                # advisorStartDate) (bucketEventToMonth filter + asc-by-ts sort) + describeDayEvent(ev)
                                # → {icon,label,detail} for all 7 DayEvent kinds (buy shows usd when present; deposit/
                                # withdraw carry target; balanceReading summarizes Strike + CB). Since the plan of record's
                                # Run 2.1 every amount prints to the cent (fmtUSDCents) — Daily's log and MonthEventsModal
                                # both print through it. Tested in __tests__/dailyView.test.ts
      calendarModel.ts          # Daily Mode P4c-1a — PURE calendar date model (no store/UI/price dep; imports only the pure
                                # bucketEventToMonth + DayEvent type, mirroring dailyView.ts). monthDateRange(advisorStartDate,
                                # month) = ascending ISO dates that bucket to that STRATEGY month (via the fixed
                                # calendar-anniversary bucketEventToMonth — now AGREES with strategyMonthDate's calendar stepping;
                                # the 30.4375 constant only sizes the ±6 scan window; loOffset clamped ≥0 so month 1 begins exactly
                                # at start, since bucket clamps pre-start days to month 1); weekDates(selectedDay) = 7 ISO Mon→Sun; buildDayCells(dayLog, dates) →
                                # DayCell{date,day,weekday(Mon=0),pips} (pips: 'logged' any draw/buy/paydown/deposit/withdraw;
                                # 'reading' any balanceReading; 'cbCollateral' a deposit target:'cb', ADDITIVE to logged). ALL
                                # date math UTC (new Date(iso)=UTC midnight; getUTCDay, not getDay → tz-safe). Tested in
                                # __tests__/calendarModel.test.ts (every monthDateRange date buckets back to its month — load-bearing)
                                # + __tests__/calendarModelHardening.test.ts (HJ-21, HJ-22 — Hardening 1: the minimum is balance-neutral; a withdraw-only day carries the logged pip)
      Calendar.tsx              # Daily Mode P4c-1a — the Week|Month calendar. RENDER + SELECT only (does NOT yet drive the
                                # activity card — P4c-1b). Props {dayLog,advisorStartDate,currentMonth,scope,selectedDay,
                                # monthLabel,onScopeChange,onSelectDay}. .seg Week|Month toggle; .calcard title (Week→"This week",
                                # Month→monthLabel); Week=weekDates (7 cells w/ weekday letter), Month=monthDateRange + .wd-row
                                # header + .grid with leadBlanks=first cell's weekday padding; cells=buildDayCells, each a
                                # <button>→onSelectDay with .num + .ind pips (.mG logged / .mRing reading / .mCb=--btc
                                # cbCollateral), selectedDay→.cellSel (green-filled num). LEANER legend (logged/reading/CB
                                # collateral; NO scheduled/needs-entry — follow-on). Calendar.module.css alongside (from preview
                                # ~:145-162, app tokens; preview --blue pip → --btc)
      EventSheet.tsx            # Daily Mode P4b-1 — the one adaptive event-entry BOTTOM-SHEET (ADD path only; createPortal
                                # → .scrim/.sheet mirroring SimpleModeView's confirm overlay). Props {open,onClose}. D1
                                # bundled cash-event sheet: type-pills (Draw/Buy ₿/Paydown/Collateral/Set balance, active =
                                # --btc) + an amount NumberInput (hidden for Set balance; $ for draw/paydown, ₿ for buy/
                                # collateral) + a REQUIRED "Current balances · required to log" reading section (Strike Bal/
                                # LTV always, + CB Bal/LTV/Collateral iff hasCbLoan). D2 Collateral pill: a Strike|Coinbase
                                # target toggle (shown only when hasCbLoan; else forced 'strike', no toggle) — target:'cb'
                                # shows the dry-powder readout (strikeBtcAvailable) + a "logged, not modeled (Feature B)"
                                # note; target:'strike' shows "Strike held after: …" (feeds the C1 collateralDelta seam).
                                # D3 Set balance = reading-only (no amount → one balanceReading). Save (--btc orange) gated
                                # on readingComplete + (setBalance || amount>0); soft amber >100% LTV hint (non-blocking).
                                # 5d: a buy adds "Dollars spent (incl. fee)" under "Bitcoin bought" — $0.00 until a BTC amount is typed,
                                # then buyUsdGuess, following the BTC until the owner changes the figure (typed only when it differs from
                                # what the field shows; since BL34 leaving no longer re-emits it); the edit shows the stored dollars and keeps them
                                # (rebuildEditedBuy — never re-priced; a figure logged before 5d is stored to the cent); Save needs
                                # dollars above zero; the implied price under the field ("≈ $102,880.00 per ₿ · today $100,000.00").
                                # ALL NumberInputs pass min={0} (NumberInput only clamps negatives when min is given) +
                                # value={x ?? 0} with null-tracked state for the gate. Save → buildEventsFromSheet →
                                # events.forEach(addDayEvent) (LD6 atomic flow+reading = TWO addDayEvent calls, same date/ts).
                                # Today-only (M3 past-dating → P4c). ON OPEN: a
                                # useEffect([open]) pre-fills the five reading fields from the latest balanceReading
                                # in dayLog (LTV fraction×100 → percent for display; null when no prior reading) so
                                # the user only needs to enter the flow amount. Amount stays blank. Dep-array is [open]
                                # only — not [open,dayLog] — so in-progress edits can't be clobbered by a concurrent
                                # addDayEvent. CB-target collateral move also captures + writes cbLiquidationPrice +
                                # cbLiquidationPriceAsOf (anchor-to-today), mirroring the Loan Center re-anchor; the
                                # liq-price field prefills from the current scalar (cbLiquidationPrice > 0) and is
                                # required for save on CB collateral; Strike target and loan balance unaffected.
                                # P4b-2 EDIT + DELETE (the same shell): an optional editEvent?: DayEvent prop flips the
                                # sheet into type-LOCKED edit mode (Option A — one DayEvent per log row; a flow and its
                                # reading are independent rows). isEdit hides the type-pills + the Strike|CB toggle (target
                                # locked) and shows ONLY that kind's fields: draw/paydown/buy → amount (a buy: + its dollars, 5d); deposit → amount
                                # (+ liq-price when target:'cb'); balanceReading → the reading section (CB block gated on
                                # the ORIGINAL reading's cbBal!=null via showCbReading, NOT current hasCbLoan). The reading
                                # section renders ONLY in add mode OR for a balanceReading edit — a flow edit never shows
                                # it (no LD6 re-enforcement). Title "Edit event"; month via bucketEventToMonth(editEvent.date).
                                # canSave branches by kind (reading→readingComplete(state,showCbReading,collPolicy.required) — N1; cb-deposit→
                                # amount>0 && liq>0; else amount>0; a buy: + its dollars, 5d). The open useEffect keys on [open, editEvent?.id] and
                                # seeds fields from editEvent (LTV ×100 for display). handleSave reconstructs ONE event
                                # preserving id/date/ts → updateDayEvent (LTV ÷100 on reading edits — rebuildEditedReading since N1; cb-deposit edit also
                                # re-anchors cbLiquidationPrice/AsOf) — NO buildEventsFromSheet, no second event. Delete
                                # (edit only) → an inline .confirmBox (copy names the month + provisional warning) →
                                # deleteDayEvent(id). Exports isEditableKind(k) (draw/paydown/buy/deposit/balanceReading)
                                # — DailyModeView gates row taps on it (withdraw/cbCollateralReading rows stay
                                # non-tappable). The Strike-target "Strike held after" readout is edit-aware: it backs
                                # out the original deposit amount in edit mode (currentBtcHeld − editEvent.amount + amount)
                                # so it doesn't double-count (the edited deposit is already in currentBtcHeld via the C1
                                # seam); add mode + non-deposit edits subtract 0 — readout only, no data effect.
                                # v20 (C-P3): a REQUIRED "Strike collateral (BTC)" NumberInput after the Strike-LTV field on
                                # every reading-bearing sheet (readingComplete gates strikeCollateral!==null) — not a past-dated add's (3b) nor
                                # an edit's of a reading that records none (N1), both below. AUTO-TRACK (an ADD's — never an edit's, N1): an
                                # untouched field = autoStrikeCollateral(getCurrentBtcHeld(), move) = the POST-move total
                                # (current±amount for a strike collateral move, current+amount for a pledged buy, else
                                # current) — via a track useEffect gated on !strikeCollateralTouched; a manual edit sets
                                # touched (venue truth) + freezes it. This is LOAD-BEARING: the flow + its reading share a ts
                                # and deriveStrikeCollateral EXCLUDES the same-ts move, so the reading MUST state the post-move
                                # total. A buy-only "Pledged to Strike" Off|On toggle (add path, targetToggle styling) → ON
                                # emits [buy, deposit target:'strike' amount=buy, reading]. buildEventsFromSheet gains a
                                # currentStrikeCollateral arg (= getCurrentBtcHeld()). EventSheet.module.css alongside (+ .deleteBtn/.confirmBox/.confirmText)
                                # ⚠ PAST-DATED ADD (provisional-clears-on-reading-spec-v1, 3b): readingCollateralPolicy(isPast,
                                # current) → the field is HIDDEN (not blank — NumberInput renders null as "0", and a figure typed
                                # there would be stamped on the past date), not required, and the builder gets fallback null → the reading OMITS
                                # strikeCollateral. The only figure the sheet knows is TODAY's: stamping it on a past date is
                                # the app inferring history, and a past reading that becomes the latest-dated anchor makes
                                # deriveStrikeCollateral count every later Strike move twice. Today's add unchanged. A
                                # past Set balance's label reads "Balances on that day · required to log" (the "optional"
                                # note is hidden for it). CB collateral is date-first since Hotfix 1 (A2-1), so a past
                                # reading's typed CB collateral no longer becomes the current one.
                                # ⚠ AN EDIT KEEPS A READING'S STRIKE COLLATERAL AS RECORDED (N1, BL39 — spec
                                # pbloc-spec-n1-reading-collateral-v1): readingCollateralPolicy(isPast, current, the edited
                                # reading). A reading that records a figure → the field shows it (the prefill reads the
                                # policy's fallback), required, and Save writes the field's figure. One that records none (a
                                # past-dated add's, a balance saved from the Safety card or Quick Setup, any reading from
                                # before v20) → the field HIDDEN with "This reading doesn't record Strike collateral — an edit
                                # keeps it that way." (the past date's note element, keyed on isEdit), the gate waived
                                # (readingComplete(…, collPolicy.required)), and rebuildEditedReading writes none whatever the
                                # field holds. Was: the prefill and Save fell back to today's total (`?? currentBtcHeld`) —
                                # the double count above, once that reading was the latest-dated to state collateral (₿1.5
                                # for ₿1.3). The collateral track never runs on an edit (`if (isEdit) return`): the touched
                                # flag the prefill sets couldn't stop its first run — that effect still saw the closed sheet's
                                # touched=false and wrote after the prefill — so every reading edit showed today's total, a
                                # reading that records a figure included, and an untouched Save stamped it (₿1.4 for ₿1.2).
                                # To state Strike collateral for a reading that records none, log a reading for today — an
                                # edit never adds one.
                                # The plan of record's Run 2.1 (BL19): every readout to the cent (fmtUSDCents) — a Coinbase
                                # borrow's origination fee, Strike's minimum, the dry-powder estimate, the last liquidation
                                # price; the minimum's estimate is `toCents` (balance × APR ÷ 12), so a minimum logged from
                                # it stores cents. δ5 (the owner's call): the paydown line's due day prints through
                                # planMonthView's fmtDayOrdinal — "Minimum · due the 1st · $X.XX", never "the 1th"
      eventSheetModel.ts        # PURE builders for EventSheet (no React/store; named eventSheetModel to avoid the macOS
                                # case-collision with EventSheet.tsx): SheetType/SheetState (v20 += strikeCollateral:number|null
                                # + pledgeToStrike:boolean) + readingComplete(s,hasCbLoan,requireStrikeCollateral=true) (Save
                                # gate — a past add, and an edit of a reading that records none (N1), pass false via
                                # readingCollateralPolicy; otherwise v20 ALSO requires
                                # strikeCollateral!==null) + autoStrikeCollateral(base,s) (v20 PURE — POST-move total: strike
                                # collateral move → base±amount, pledged buy → base+amount, else base; shared by the sheet's
                                # auto-track + its tests) + buildEventsFromSheet(s,hasCbLoan,btcPrice,today,ts,idFn,
                                # currentStrikeCollateral) → DayEvent[] ([reading] | [flow,reading] | [deposit,reading];
                                # v20 buy pledge → [buy,deposit target:'strike' amount=buy,reading]; reading.strikeCollateral =
                                # s.strikeCollateral ?? currentStrikeCollateral, BTC no conversion; fresh id per event;
                                # flow+reading share date+ts; the buy's usd = the typed buyUsd, else buyUsdGuess, to the cent (5d);
                                # **LTV percent ÷100 → fraction**). 5d: SheetState.buyUsd ("Dollars spent (incl. fee)" as typed; null → the
                                # guess) + roundUsdCents (one rounding for the typed figure and the guess) + buyUsdGuess (the BTC at today's
                                # price, to the cent) + impliedBtcPrice (dollars ÷ BTC — a readout, never stored) + rebuildEditedBuy (the
                                # edit's rebuild: id/date/ts kept, the dollars as given, to the cent — never re-priced).
                                # + staleCbBalanceNote (the stale Coinbase-balance warning: the borrow, its fee, the paydown
                                # and the suggested balance — to the cent since Run 2.1; tested in cbDebtSheet.test.ts).
                                # + latestReadingForPrefill (Hotfix 1 — the today sheet's prefill: the latest reading by
                                # date, then orderTs, never a backfilled or just-edited older one; journalOrder.test.ts).
                                # + readingCollateralPolicy(isPastAdd,current,edited?) — N1: the edit case, as recorded (a
                                # figure → required, its own as the fallback; none → not required, no fallback) — and
                                # rebuildEditedReading(ev,s,btcPrice) (N1 — the edit's rebuild of a reading, was inline in
                                # handleSave: none stays none whatever the field holds; a figure stores the field's, else its
                                # own; id/date/ts kept, the LTVs ÷100, today's price, the CB block only on a reading that has
                                # one).
                                # Tested in __tests__/eventSheet.test.ts (+ N1: src/store/__tests__/editedReadingStore.test.ts,
                                # e2e/editedReading.spec.ts)
      ReviewSheet.tsx           # The month review — Daily's sign-off (Logging Consolidation §2): the month's rolled-up
                                # totals ("Drawn (expenses)", "BLOC paydown"), a note when the month also has a Coinbase
                                # borrow or paydown (journal-only, so outside the totals), and the SIGN-OFF DETAILS —
                                # expenses actually paid, Strike's minimum (income mode), the NDP (roll mode) →
                                # confirmMonth(month, extras). The plan of record's Run 2.1 (BL19): every figure to the
                                # cent; the three fields are seeded with toCents (the NDP's from planNdpEstimateUsd), so a
                                # sign-off stores cents unless the owner edits them. They are number inputs: they show
                                # the raw value ("1234.5" is $1,234.50)
    SimpleMode/
      PlanMonthCard.tsx         # The plan of record's Monthly Playbook (Run 2, D-R2-2 + D-R2-8) — THIS MONTH's card: one
                                # card, one month, each fact once. The scrubber picks the month (this month and the rest
                                # of the strategy year from the plan's run — the card's month k is the run's month
                                # k − currentMonth + 1 — a past month from the Ledger, D14); the track is monthTrack. Then
                                # the status (planStatus with its "To be within it today" catch-up, or on a crash day the
                                # console's line under PLAN_CRASH_TITLE), the breaker line, the goal line (BL14 — planGoalLine
                                # on the run's own month and goal; none with no goal), the to-do rows (planMonthActions
                                # — THE MOVE's legs "today", then the Decision face's schedule rows, with venue dots and
                                # VenueText), the minimum's foot (income: planMinimumLine + its PAID / DUE / MISSED chip;
                                # roll: planInterestRollsLine) and the NDP line, the after box (planAfter, with the meter),
                                # the sign-off pointer or the Ledger strip (planSignoffLine / planLedgerParts), the savings
                                # line, "Why this plan?" (planMonthSummary) and "Next month" (planNextMonthLine, hidden in
                                # month 12). Takes `pm` — its screen's one run (usePlanCardInputs; the plan of record's
                                # Run 3 — THIS MONTH and the Advisor tab both show it); every sentence from planMonthView (or
                                # decisionView, crashPlaybookView, supportPolicyView) — the card composes none (I31, planRunWiring reads
                                # its syntax tree). The one-time note (D8 —
                                # planSwitchNote, dismissed per device by planNoteDismissed; never to a viewer). One status
                                # colour per card — no Advisor tier border (Δ10). Exports VenueText (Daily reuses it).
                                # Every dollar figure prints to the cent — through planMonthView, and the crash line's
                                # shift through crashPlaybookView's fmtStepUsdCents (Run 2.1, BL19 — the file itself is
                                # unchanged). Styles come from SimpleModeView.module.css
      usePlanCardInputs.ts      # The plan of record's Run 3 — the card's inputs, gathered ONCE per screen that shows it
                                # (THIS MONTH, the full-mode Advisor tab): usePlanMonth's run (shared with that screen's
                                # month log and overlay — one run, so one fetch of the plan's price history,
                                # usePowerLawData), the crash line (D13 — the
                                # console's builder on the LIVE figures: isCrashDay, playbookInputFromLive, crashPlaybook,
                                # monthPlaybookLine; Strike's hold through strikeDepositOf) and the NDP (planNdpBalance /
                                # planNdpEstimateUsd / getNdpStatus; ndpActionActive in roll mode). Pinned by
                                # monthlyPlaybookWiring, planRunWiring (HOLD, CRASH, CENTS) and planPolicy (CONSOLE).
                                # The plan of record's Run 4 (D3): the crash day reads the Coinbase loan alone — no
                                # cbPaymentStrategy here (planYearWiring INPUTS, planEdgesWiring GATE)
      PriceChart.tsx            # BTC price chart atop the Safety Dashboard — recharts AreaChart (line/area,
                                # not candlesticks), 1H/1D/1W pills (default 1D), header price + range %Δ
                                # (green/red), auto padded Y-domain (intraday visible), graceful loading/
                                # "price history unavailable" states. Owns its own range state + useBtcHistory. One prop
                                # since the plan of record's Run 2.1 (BL19): `money`, for the price and its tooltip, whole
                                # (fmtUSD) by default — ViewerHomeView (the Dashboard, every viewer's home, ViewerPreview)
                                # passes none; the Safety card passes fmtUSDCents. Data never in the store. 5e (F12): the
                                # history is drawn at once from this device's copy (useBtcHistory → lib/btcCandlesCache);
                                # one more than 5 minutes old is drawn muted (`data-old`, `.old`) with its time in place
                                # of the %Δ ("as of 2:05 PM", asOfLabel) until a fresh one lands; the headline counts to a
                                # new figure (useCountTo) and prints `money(shown ?? last)` — cents on THIS MONTH and
                                # Daily. The readout wraps on a narrow phone, never past the edge.
                                # PriceChart.module.css alongside
      SafetyDashboard.tsx       # Top-of-SimpleMode safety read (reads store directly, recomputes on price tick):
                                # the Safe/Watch/Act .stateLine VERDICT is the FIRST child — a prominent 15px/700
                                # headline at the very top (moved up from the buried last child; render-position +
                                # style only, state/stateCopy derivation unchanged) → then
                                # <PriceChart/> strip (BTC candles) → CB bar (primary; fill = ltv/cbLiqFrac, where
                                # cbLiqFrac = the effective liquidation LTV from the AUTHORITATIVE cbLiquidationPrice
                                # (accruedBalance/(collateral×activeLiqPrice)), falling back to CB_LLTV when no price
                                # is set — so editing the CB liquidation price MOVES the bar fill + trigger marker +
                                # 0.93 level band consistently, not just the cushion subtext. (The old Monthly Playbook
                                # card's COINBASE bar that mirrored this left with the plan of record's Run 2.) bare
                                # 75%/86% marker TICKS — trigger/liq prices + "Coinbase"/"~est." source moved to a
                                # .priceNote subtext, no label collision; cushion = LTV-POINT GAPS "X% to trigger ·
                                # Y% to liquidation" (ltvGapToTrigger = trigger% − cbLtv; ltvGapToLiq = cbLiqFrac −
                                # cbLtv, the authoritative-liq-price LTV — the price
                                # view stays in the priceNote/liq-price field; the old ↓price-drop pct() was removed),
                                # Safe/Fair/
                                # Poor badge, no-grace note in amber/red) → Strike bar (body tap flips capacity-used
                                # ↔ liquidation gauge vs strikeLiquidationLtvPct; LTV via
                                # computeStrikeLtv(advisorActualBlocBalance, getCurrentBtcHeld(), price) — the
                                # CURRENT position, not the frozen baseline. The liquidation-view cushion row NOW
                                # mirrors the CB card's own liq-cushion format (superseding the earlier 80%-crash
                                # stress figure): "₿X.XXXXX · $Y above liq ~$Z · W% drop away · $B balance"
                                # (.cushion-styled — muted, matching the CB section's cushion idiom), where
                                # strikeLiqPrice = advisorActualBlocBalance / (getCurrentBtcHeld() × strikeLiqLtv)
                                # (0 when collateral is 0) — the EXACT formula safetyView.ts's trusted
                                # computeViewerSafety branch uses for the viewer's strike.liqPrice figure, so the
                                # two surfaces can't disagree; strikeDropUsd/strikeDropPct are the $ / % distance
                                # from the live btcPrice to that liq price. The LTV/liq segment was dropped as
                                # redundant with the bar header's own LTV value — display-only.
                                # Card is a <div role=button> (was
                                # <button>) with a view-aware inline EDIT control (.editLink, stopPropagation so it
                                # doesn't flip): capacity edits BLOC balance + credit line, liquidation edits BLOC
                                # balance + liq LTV %; Save → synced setters, no Settings trip). The state line
                                # (hasCbLoan ? worseLevel(cb,strike) : strikeLevel) is the top headline (see above) —
                                # since the plan of record's Run 4 through ownerSafetyVerdict(view, hasCbLoan): that
                                # reading and Coinbase at support, the worse wins (amber at most from support), worded
                                # "Watch — Coinbase is over the plan's limit at support" when only that one is amber.
                                # The WHOLE CB card is tap-to-
                                # anchor: a <div role=button onClick={toggleEdit}/onKeyDown> (guarded e.target===
                                # currentTarget so typing in a field can't toggle) with .flipHint "tap to set/update"
                                # cue + stopPropagation on the .editBox — mirrors the Strike whole-card tap (the thin
                                # barTrackBtn is gone). The .editBox also shows a read-only live Morpho rate
                                # reference line (via useMorphoRate, same as the Settings APR field). When
                                # cbAprPct diverges >1pt from the live Morpho rate, the divergence hint gains a
                                # one-tap "Use X%" apply (.editLink button → setCbAprPct(morphoRate.borrowApy),
                                # standard synced setter) — applying it closes the gap so the hint + button
                                # self-clear next render. Save → balance + liq price, both set…AsOf today. neverAnchored
                                # (both asOf null) → ONE calm .anchorNudge (not three amber warnings); freshness "as
                                # of N days"/stale "may be low" (>30d) lines apply only once anchored. Strike bar is
                                # DECOUPLED from hasCbLoan — only the
                                # CB bar gates on it: !hasCbLoan → CB-setup prompt in the CB slot, Strike bar +
                                # Strike-only state line still render. Evergreen (past month 12). All CB math via
                                # cbMetrics — same numbers as the CB Loan tab. The plan of record's Run 2.1 (BL19): every
                                # dollar figure to the cent (fmtUSDCents — the Strike line and its limit, the distances to
                                # liquidation, the liquidation prices, the Coinbase balance), and its chart through
                                # `money={fmtUSDCents}` — on THIS MONTH (above the plan's card — before the plan of record's
                                # Run 3, above the This Month / Outlook switch) and on Daily. The plan of record's Run 4
                                # (D7): under the Coinbase cushion row, ownerAtSupportLine(cbAtSupport, moveBringsCbWithin)
                                # — Coinbase's accrued debt against its collateral at today's support (supportToday of
                                # todayLocalISO(), memoised on the day), beside the plan's limit, to the cent; amber
                                # (LEVEL_COLOR.watch) when over, never red (.atSupport in SafetyDashboard.module.css). Its
                                # prop moveBringsCbWithin (default false; D-R4-1): THIS MONTH and Daily pass
                                # planMoveBringsCbWithin on their own run, and the line then adds "; this month's move
                                # brings it within"
      SimpleModeView.tsx        # Simple Mode full-screen view (global simpleMode flag): header + HeaderNavCluster,
                                # BackupNagCard, ViewToggle, <SafetyDashboard/> (the plan of record's Run 4, D-R4-1:
                                # moveBringsCbWithin from THIS MONTH's run), then THIS MONTH (the plan of record's Run 3
                                # removed the This Month / Outlook switch). ⚠ REWRITTEN by the plan of record's Run 2 — THIS MONTH
                                # runs the plan: the NDP urgency card (soon / overdue) and
                                # <PlanMonthCard/> (above), handed its one run and `crashLine`, `ndp`, `ndpActionActive` —
                                # all from usePlanCardInputs (Run 3; the Advisor tab calls the same hook). The crash line: on a
                                # crash day (isCrashDay — the Emergency Console's own gate: hasCbLoan, ltvTriggered (until
                                # the plan of record's Run 4, D3 — the loan alone since), Coinbase at or past its trigger
                                # at today's price) the card's status is PLAN_CRASH_TITLE
                                # with monthPlaybookLine(crashPlaybook(playbookInputFromLive(…))) — the console's builder
                                # on the live position, Strike's hold through strikeDepositOf (D9); crashNote(true) foots the rows.
                                # `ndpActionActive` = roll mode && the NDP not ok (the annual clause only while minimums
                                # roll). Run 3: no runAdvisor — MonthlyLogOverlay's planned rows are planLogRows on the
                                # same run; under the card, "Your plan on other price paths" opens the Almanac on the
                                # Decision face (onOpenPlanPaths — the Outlook's place), then the expenses prompt
                                # (owner-only). Gone with Run 2: the old card (the paydownBadge
                                # header, the two-tone scrubber, the Strike / CB status bars, the coloured-dot allocation
                                # rows, the "this month also" strip, the summary paragraph); the three position boxes
                                # (CURRENT / THIS MONTH / AFTER — and with them "CB runway", Box 3's "(if you shift debt)"
                                # suffix and the remaining-draw countdown); the misordered-thresholds notice; the inline
                                # statement-minimum editor (the figure lives in Settings → Strike Strategy); the savings
                                # line's local sum (planSavingsLine now); and the Advisor tier border on THIS MONTH (Δ10
                                # — the Advisor tab kept its tiers until the plan of record's Run 3, and since then only its
                                # position card's Coinbase LTV colour and the sidebar's PRIORITY RULES, which Run 4 replaces
                                # — done: Safety's colour and the plan's rules).
                                # (ConfirmLogSheet / handleApply / the Pay/Skip pills
                                # went earlier, with Logging Consolidation §3.) The Quick Setup modal is ALWAYS reachable
                                # ("⚙ Edit your numbers" once established, first-run copy while isDefaultSetup; Save →
                                # the three setters + ONE emitBalanceReading — Run 3 dropped "Balance at start of this
                                # month", the projection's base). The expenses re-anchor nudge (§9; on the Outlook until
                                # Run 3): when the trailing 3-entry avg of expensesActual drifts >5% from the `expenses`
                                # assumption, a dismissible banner (planReanchorLine — to the cent) offers Update
                                # (setExpenses(toCents(avg))) / Dismiss (persists the rounded avg to device-local
                                # expenseReanchorDismissedAt; resurfaces only when drift moves >5% past it);
                                # computeExpenseReanchor (logUtils, pure) is the predicate. ⚠ The plan of record's Run 4:
                                # only the months before this one that record expenses count (F-R4-1 — currentMonth; month
                                # 12, which keeps every draw after the year, never counts), and the words and buttons are BL26's (planReanchorWords: "Monthly
                                # expenses: your last 3 logged months averaged $X; your plan uses $Y." with [Update plan
                                # to $X] [Keep $Y] — Keep does what Dismiss did). The plan of record's Run 2.1
                                # (BL19): the NDP card's estimate to the cent — planNdpEstimateUsd on planNdpBalance
                                # (getNdpStatus' own estimate is a whole dollar, for full mode); the month log gets
                                # `money={fmtUSDCents}`. Since Run 3 THIS MONTH has no whole-dollar figure at all

api/
  btc-history.js               # Vercel serverless proxy for Blockchain.com (CORS workaround)
  btc-candles.js               # Vercel serverless proxy for Coinbase Exchange candles (api.exchange.coinbase.com; granularity whitelist, s-maxage=60) — same-origin so the browser avoids CORS; feeds useBtcHistory
  morpho-rate.js               # Vercel serverless proxy — POST GraphQL to api.morpho.org/graphql, marketById for the on-chain-confirmed cbBTC/USDC Base market 0x9103c3b4… (chainId 8453, 86% LLTV), s-maxage=300; feeds useMorphoRate. Schema note: this endpoint's Market uses `marketId`, NOT `uniqueKey`
  strike-balances.js           # Strike balances proxy (STRIKE_API_KEY server-only). NIP-98 gated: validateOwnerRequest(Authorization, PUBLIC_ORIGIN+req.url, method, OWNER_PUBKEY) → 401/403 (see NIP-98 Proxy Auth)
  strike-rates.js              # Strike BTC→USD rate proxy — same NIP-98 gate as strike-balances
  strike-invoices.js           # Strike invoices proxy — same NIP-98 gate (no client calls it today; gated for parity / fail-closed)
  _lib/
    ownerAuth.js               # SHARED NIP-98 validator (validateOwnerRequest) for all three Strike proxies — _-prefixed so Vercel does NOT route it; plain ESM .js (imports in Vercel node AND vitest). validateToken (kind/ts/url/method + verifyEvent) → handles BOTH false-return AND throw → unpack → pubkey===OWNER_PUBKEY else 403. Co-located ownerAuth.d.ts so the TS test imports it under tsc -b

public/
  manifest.json                # PWA: name "Personal ₿LOC", theme #E8836A (untouched; kept with its index.html <link>)
  icon.svg                     # Dark bg, orange ₿
  # NB: the hand-rolled public/sw.js is GONE — the SW is now src/sw.ts, built to dist/sw.js by vite-plugin-pwa

src/
  sw.ts                        # Custom Workbox service worker (vite-plugin-pwa injectManifest). precacheAndRoute(
                               # self.__WB_MANIFEST) — precaches the FULL build (per-deploy versioned, atomic
                               # activation) + cleanupOutdatedCaches; NavigationRoute→createHandlerBoundToURL('/index.html')
                               # SPA fallback; skipWaiting + clientsClaim (autoUpdate); activate deletes the legacy
                               # 'personal-bloc-v1' cache. NO runtime caching (cross-origin price/candles/relays stay
                               # network-only). Compiled by tsconfig.worker.json (WebWorker lib, no DOM); registered from
                               # main.tsx via registerSW({ immediate: true })

tsconfig.e2e.json            # Hardening 1 G2 — tsconfig.node.json's flags + DOM, types node; includes e2e/**/*.ts + playwright.config.ts;
                                # referenced from the root tsconfig.json, so `tsc -b` (the build) type-checks the e2e specs too
```

---

