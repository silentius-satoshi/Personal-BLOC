# Crash day — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

## Emergency Console (crash playbook Run 2 — the crash-day page for `ltvTriggered`; store unchanged)

The console runs `crashPlaybook` — the one crash-day answer the engine also runs — on the live position and the owner's
real cold. Spec: `pbloc-spec-crash-playbook-run2-v1.md` (Run 2 of 3). **READ-ONLY** — no dayLog writes; real moves
happen on the lenders' screens and are logged through the Daily flows. Monthly CB mode keeps `LiqSimulator`, unchanged.

- **Mode gate (unchanged):** `CbDefenseTool` renders `cbPaymentStrategy === 'ltvTriggered' ? <EmergencyConsole/> :
  <LiqSimulator/>` for both the `liqsim` tab and the Almanac's defense face. Tab KEY stays `'liqsim'` (no
  tabOrder/hiddenTabs migration, still `hasCbLoan`-gated); the tab LABEL swaps to `Emergency`/`Emerg` by mode via
  `withEmergencyLabel` (label-only).
- **The gate — the playbook runs at the TRIGGER and restores the TARGET (A0).** The Advisor's `cbLtvTriggered` and
  SimpleModeView's `cbTriggered` both fire at `>= cbLtvTriggerPct`; a target gate would tell the owner to draw on Strike
  on an ordinary 68% day. `waitingCard(input, cbLtvTriggerPct)`: target < LTV < trigger (and under 86%) → "No action …
  where your plan waits"; otherwise null and the playbook runs — at or under the target it reads "nothing to do", at or
  over the trigger (or past 86%) it acts.
- **Inputs — `playbookInputFromLive` (crashPlaybookView), the one live builder:**
  - the Coinbase debt ALREADY accrued (`accruedCbBalance` — the accrual boundary stays in the component);
  - the Strike balance is the LIVE `advisorActualBlocBalance` (A1), never `deriveCurrentPosition`'s last logged
    `strikeBal` — that lags a knob re-anchor, and the playbook decides Strike's releases (the 40% rule), so a stale
    balance could name a release Strike refuses. Collateral `getCurrentBtcHeld()`; cold `getCurrentColdBtc()`, under a
    satoshi → 0;
  - the Coinbase stop at support through `effectivePolicyStops` on the plan of record's Coinbase limit
    (`policyCbStopAtSupportPct`, 45% at C1 — the owner's saved plan since Run 1), read through its clamp
    (`clampPlanPolicy`), as every face reads it;
  - Strike's 60-day hold from its one fact through its one rule — `strikeHoldAt(strikeDepositOf(store), today)` (the
    plan of record's Run 2, D9: the owner's latest logged `target:'strike'` deposit, or a trusted viewer's snapshot date,
    so a viewer's console holds exactly when the owner's does) — logged deposits only (a collateral increase entered
    only as a reading is invisible). With no deposit in the window the app assumes the line is more than 60 days old,
    and the card says so;
  - the EFFECTIVE price (simulated while simulating); support = `plBandsAt(today).floor` — the component keeps the
    power-law crossing, and both the model and the view module stay belief-free.
- **The card (`playbookCard`):** a neutral order badge · the depth sentence (top up first between the liquidation depth
  and support; shift first below the depth, at or above support, or when doomed at the open) · the past-liquidation
  note (opening ≥ 86%) · the steps in the playbook's order · a gap note when no step, no shift or no top-up is available
  · the Strike note (the hold with its dates, else Strike's release rules + "the app assumes yours is") · the after line
  · the outcome: held / short / doom. `'none'` reads "nothing to do", or "Check figures" on junk.
- **⚠ The doom warning reads the AFTER-state (`after.cbLtv >= 86%`), never `result.doomed`.** `doomed` is read at the
  open, from collateral alone (`possible < need`). So a doomed-at-open run can still be brought under 86% by the debt
  shift (held or short, never doom), and an exact tie — e.g. zero needed at an exact-86% open with nothing movable — is
  not doomed, yet ends AT 86% (doom, under whichever badge its order gives). The after-state is the only honest read.
- **⚠ Step amounts are FLOORED to their printed precision** (`fmtStepBtc`: 5 dp, then 8 dp, none under a satoshi;
  `fmtStepUsd`: whole dollars, none under $1). A binding Strike release of 0.5999999996 ₿ rounds to `0.60000` — exactly
  the 50% Strike refuses — and a line-capped shift of $3,487.50 must never print a draw over the line.
  `fmtMultiplePair` widens the support multiple and the depth (2 → 6 dp) until they differ.
- **Last resorts:** "Sell to pay down" (`wall3Sale`) and "Outside cash" (`wall4External`) — both start collapsed.
  **Checklist:** 7 order-neutral items, session-only.
- **Deleted in Run 2:** the Phase-1 buy-and-pledge functions `firepower`, `drawToLtv`, `floorTable`, `direSwitch` and
  `surplus` (emergencyModel), with the Firepower card, the Draw-to-LTV calculator, the floor table and Walls 1–2.
  `EmergencyState` is now `{ cbDebt, cbCollateralBtc, price }`. The Settings "Emergency ceiling %" field (deleted in Run 2)
  went with them, but `cbEmergencyCeilingPct` STAYS in the store — synced, migrated `?? 30`, clamped 20–50, in
  `SETTINGS_FIELDS`, the payloads and both reset presets (sync compatibility; removing it is a store change).
- **INVARIANTS:** Coinbase debt math always flows through `accruedCbBalance` (never raw `cbLoanBalance`); the console
  consumes `crashPlaybook`, never forks it; `emergencyModel` and `crashPlaybookView` import nothing from the cycle model
  or the power law (§7 — the view module's layering test pins it); READ-ONLY, no dayLog writes.
- **Phase 2 (Recovery/repatriation, `spareBtcOnCb`) is NOT built** — specced but deferred; not prebuilt.
- Tests: `crashPlaybookView.test.ts` and `emergencyConsoleWiring.test.ts` (§ Test Suite → "Crash playbook (Run 2 — the
  Emergency Console)"), and the retained `emergencyModel.test.ts`.

---

## The Monthly Playbook's crash line (crash playbook Run 3; store unchanged)

On a crash day the Monthly Playbook's THIS MONTH box shows the crash playbook's own line — the same steps, from the same
builder, as the Emergency Console — and every place the projection's Coinbase paydown appears is labelled "(if you
shift debt)". Spec: `pbloc-spec-crash-playbook-run3-v1.md` (Run 3 of 3). The projection (`runAdvisor`) is unchanged: it
still models the debt shift.

⚠ **Run 2 (the plan of record):** the line now sits in THIS MONTH's card STATUS on a crash day — `PLAN_CRASH_TITLE`
("Crash day — work from the Emergency Console") over the line's items, then `crashNote(true)` (PlanMonthCard; Daily's
plan card shows the title) — gated by `isCrashDay`, the console's own gate. Box 2, "CB runway" and Box 3's "(if you
shift debt)" suffix went with the three boxes, and the label is at two sites. The bullets below keep Run 3's record:
their "box" is now the card's status, which is full width, so the compact shapes' 70px reason is Run 3's; the inputs,
the one reading and the compact shapes themselves are current.

- **Where and when:** Box 2 (THIS MONTH) of `SimpleModeView`, `ltvTriggered` mode only. The gate is
  `cbTriggered ? playbookLine !== null : cbRunwayToTrigger > 0`. `cbTriggered` (Coinbase at or over its trigger) and the
  "CB runway" branch below the trigger are unchanged.
- **Inputs — the console's builder:** `playbookInputFromLive` gets:
  - the store price (live or manual — the Playbook has no simulation);
  - the ACCRUED Coinbase debt (`effectiveCbBalance`);
  - the LIVE Strike balance (`advisorActualBlocBalance`, never the start-of-month projection base);
  - `getCurrentBtcHeld()` and `getCurrentColdBtc()`;
  - the target, the plan's Coinbase limit (`policyCbStopAtSupportPct` — the plan of record, Run 1), Strike's 60-day
    hold's one fact (`strikeDepositOf` — Run 2, D9; it was the dayLog) and today.

  Support is `plBandsAt(today).floor` — the view keeps the power-law crossing. When the console is not simulating, the
  console and the box name the same amounts.
- **One reading:** `listSteps` / `gapKind` / `outcomeKind` (private to `crashPlaybookView`) feed BOTH `playbookCard` and
  `monthPlaybookLine`, so the box and the console can't disagree on a step, a gap or an outcome.
  - `playbookCard`'s output is byte-identical to Run 2's: deep-equal before and after the refactor across the sweep
    grid × four targets.
  - Amounts are the console's floored `fmtStepBtc` / `fmtStepUsd`. Since the plan of record's Run 2.1 (BL19) the line's
    shift prints to the cent, floored (`fmtStepUsdCents` — "$3,487.50" where the console says "$3,487"); the card stays
    whole.
  - Doom reads the after-state, never `result.doomed`.
- **The compact shapes:** a LIST, one line per item, because the box is a third of the row (about 70px of text on a
  phone):
  - the order: "Crash playbook: top up first" / "Crash playbook: shift debt first";
  - the past-liquidation note (red): "Coinbase is at or past 86%";
  - the gap: "No step available" / "No room on the Strike line" / "Nothing to top up with";
  - every listed step: "Move ₿X from cold" / "Release ₿X from Strike" / "Shift $X to Strike";
  - the outcome: "Coinbase back to T%" (green) / "Still ₿X short of T%" (amber) / "Can't clear 86% — see Emergency"
    (red).

  It prints no LTV.
- **Every listed step, never "the first two" (B1):** the playbook lists at most three steps, each kind at most once. A
  shift-first day can list all three: a line-capped shift, then cold, then a Strike release.
- **Box 3's suffix (B6):** AFTER THIS MONTH reads the engine row, which books the projection's debt shift. So in a month
  the projection pays Coinbase down (`afterIncludesShift`: `currentRow.cbPaydownDraw > 0`), its title reads "AFTER THIS
  MONTH (if you shift debt)". Beside a Box 2 that may say "move cold / release Strike collateral", an unlabelled Box 3
  would contradict it.
- **One label:** `CB_PAYDOWN_LABEL` = "CB paydown (if you shift debt)"; `IF_YOU_SHIFT_DEBT` is its suffix.
  - It appears at two sites since the plan of record's Run 2 (Daily's plan reference and the THIS MONTH ALSO strip went
    with it):
    - OutlookProjection's `ltvTriggered` header and legend;
    - AdvisorMain's CB LTV alert.
  - `monthlyPlaybookWiring.test.ts` fails if either says "CB paydown" or "pay down CB", comments included.
  - ⚠ JSX drops the whitespace at a line break next to an expression, so each label expression keeps its neighbouring
    text on its line. The same test pins the spacing.
- **The legend's depth is computed:** `playbookDepthFor(cbLtvTargetPct, planCbStopAtSupportPct)` — the builder's stop at
  support ÷ 86%, through the ONE `effectivePolicyStops` call, on the plan's Coinbase limit (a required prop from both of
  the Outlook's parents, since the plan of record's Run 1; ≈ 0.52× at the C1 45% limit — a 45% target and up — and
  0.47× at 40%). The
  legend reads "between D× and
  1× support the crash playbook tops up first when it can". Never a literal.
- **Deleted:** `cbPaydownToTarget` and `cbPaydownAffordable` — the Playbook's last naive `creditLine − drawn` reader.
- Tests: § Test Suite → "Crash playbook (Run 3 — the Monthly Playbook)".

---

