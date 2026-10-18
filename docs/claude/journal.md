# The journal's money — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

## Coinbase borrow & paydown events (journal-only; store unchanged, NO bump)

The daily journal can now record a **Coinbase borrow** (the hinge of the flywheel: Strike draw → Coinbase borrow → Strike
paydown) and a **Coinbase paydown** (the `ltvTriggered` policy action).
- **Shape:** `draw`/`paydown` gain `target?: 'strike' | 'cb'` and `fee?: number`. `fee` is the origination fee from
  `cbBorrowFee`; it is USD, capitalised, and only present on a CB draw.
- **Journal-only:** a CB flow is recorded, dated, fee-bearing and visible in the journal, but it **never enters a monthly
  figure**. CB debt stays reading-anchored, so there is no `deriveCbDebt`.
- **No migration.** `ROLLUP_NUM_KEYS` and the entry shape are unchanged, and there is no new `DayEventKind`.

🔴 **`flowVenue(ev)` (logUtils) is the ONE venue definition, and a MISSING target reads as `'strike'`.** That default IS
the migration: every stored draw/paydown predates the field. Any other default would:
- pull every historical draw out of the rollup;
- collapse `expensesActual` across all 12 months;
- make `reconcileMonthBuckets` delete the emptied daily-owned entries.

Any non-`'strike'` value reads as `'cb'`, so an unknown value can never inflate a monthly figure.

🔴 **Journal-only must hold at EVERY reader of the dayLog, not one filter.** Each reader goes through `flowVenue`:

| Reader | What it does with a CB flow |
|---|---|
| `rollupMonth` | skip at the top of the `draw`/`paydown` cases, **before** `hasFlow` is set |
| `isMonthlyMeaningful` | returns false |
| `aggregateEvents` | `draw`/`paydown` are Strike-only; CB goes to `cbDraw`/`cbFee`/`cbPaydown` |
| EventSheet edit rebuild | `rebuildEditedFlow` keeps the venue |
| `describeDayEvent` | labels the row "Coinbase borrow" / "Coinbase paydown" |

- ⚠ **Two guards, two jobs — keep both.** `rerollMonth` and `reconcileMonthBuckets` hand `rollupMonth` the **full**
  dayLog. `isMonthlyMeaningful` only decides whether a month re-rolls.
  - The **rollup skip** prevents corruption: without it, a CB borrow lands in `expensesActual` in any month that also
    holds a Strike event.
  - The **`isMonthlyMeaningful` line** prevents create/flip/reopen (BUG1): without it, a CB-only month is created
    with zeros and flipped to daily.
- ⚠ **`aggregateEvents` is a write path in disguise.** `streams.draw` prefills the ReviewSheet's "Expenses actually
  paid", which `confirmMonth` writes to `expensesActual`. Counting a CB draw there bypasses both guards at sign-off.
- ⚠ **The edit rebuild once dropped `target`.** EventSheet's inline `{id,date,ts,kind,amount}` turned an edited CB
  borrow into a Strike draw. It is now the pure `rebuildEditedFlow`: the stored fee is kept when the amount is
  unchanged and recomputed when it changes. The `monthOf(before) ∪ monthOf(after)` union in `updateDayEvent` is what
  re-rolls the old month when a flow leaves Strike; it is pinned by a test.

**EventSheet:**
- The Strike | Coinbase toggle for draw/paydown is ADD-only and renders only with `hasCbLoan`. Without a loan the
  venue collapses to Strike — the **opposite** of cold, which never depends on the loan.
- A CB flow is written **alone** (`DEBT_TARGET_RULES.cb.needsReading` is false), because writing a reading would
  re-state the stale pre-filled CB balance.
- A CB borrow shows its fee before save. The fee basis is `accruedCbBalance`; a past-dated borrow is priced at
  log-time balance.
- The Strike-minimum readout is hidden for a CB paydown.
- `buildEventsFromSheet` takes an 8th parameter, `currentCbBalance`.

**ReviewSheet (S3 — refinance legs documented, not modeled).** The Strike half of a refinance stays a Strike event:
- a Strike paydown funded by a CB borrow counts as `paydown`;
- a Strike draw that funds a CB paydown counts as `expensesActual`.

When the month has any CB flow, a note under "Expenses actually paid" prompts the back-out. That is tolerable because
the 2% fee makes refinancing a batched, few-times-a-year action. The follow-on, a `transfer` flag on the Strike legs,
needs its own spec.

**Backup validator:** a draw/paydown `target` must be absent, `'strike'` or `'cb'`; `fee` must be absent or finite ≥ 0.
A pre-change backup still validates.

⚠ **TWO PRE-EXISTING DEFECTS — characterised, NOT fixed (each has a test pinning current behaviour):**
1. **The stale Coinbase prefill erases accrued interest.**
   - A today-dated EventSheet pre-fills the reading's CB balance from the last reading and requires it.
   - `deriveReadingAnchors`' early return needs value AND date to match, so an unedited save re-anchors the old
     balance under today's date.
   - `accruedCbBalance` then restarts its clock and the interest since the prior reading vanishes. It needs no borrow.
   - `unreconciledCbFlows(dayLog)` is the first signal the app has ever had that a reading's CB balance is stale: CB
     flows after the latest CB-bearing reading, ordered by (date, ts) — `deriveStrikeCollateral`'s rule, copied.
   - The EventSheet shows it pre-save (`staleCbBalanceNote`) as a hint with a suggested balance that excludes
     interest. It never prefills and never anchors.
   - Interest-only staleness stays undetected; prefilling from `accruedCbBalance` is the candidate fix.
2. **A re-roll never clears a flow field the month no longer has.**
   - `rerollMonth` writes `{ ...existing, ...rollupEntry }`, and `rollupMonth` only emits keys for the flows present.
   - So deleting a month's last Strike draw while other events keep the month alive leaves `expensesActual` stale.
     The same applies to `paydown`/`btcBought`/`income`/`strikeMinPaid`.
   - It predates CB flows. It is also why the venue-flip test uses a draw-only month.

## Paydown badge — says what actually happened (reporting only; store unchanged, NO bump)

The Playbook badge used to read "LTV 12.8% — paydown triggered". Three defects stacked:
1. **The flag was routine plan mechanics.** Drawing expenses and paying income back to the 15% ceiling fires every
   month by design (12/12 on a steady fixture), and orange plus "triggered" made that read as a breach.
2. **The LTV beside it was the post-paydown, post-buy figure.** It always understated what the paydown answered, and
   often sat below 15%, contradicting the flag.
3. **On a logged month, the halves came from different sources:** the ledger's LTV paired with the plan's projected
   paydown.

**No paydown, draw, buy, interest or balance math changed** — the advisor golden snapshots still pass byte-identical.

**Engines report two new fields:**
- `AdvisorMonthRow.blocPaydown` — the real ceiling defense, which used to be a function-local.
- `blocLtvPeak` / `MonthData.ltvPeak` — the in-month HIGH: after interest and the expenses draw, before the paydown
  and the buy.
- ⚠ The peak is captured on the line right after `blocTarget`, from the same `blocBalance`/`btcHeld`. Capturing it
  later reproduces the defect.
- ⚠ At zero collateral the peak is **∞, never 0**, matching `computeStrikeLtv`.
- `MonthData.ltvPeak` is **required**, because `runBLOC` is its only builder. `runSTS` etc. use their own types.

**`deriveForMonth` reads `row.blocPaydown`.** It used to reconstruct an income residual, which agreed in every reachable
configuration but would invent a paydown if a CB-paying row met `hasCbLoan:false`.

🔴 **FIVE states** (`classifyPaydownState(peak, paydown, settled, ceiling)`, simpleModePlan — `noCollateral` added by
paydown-badge-followup spec v2):

| State | Meaning | Badge |
|---|---|---|
| **quiet** | no paydown, never crossed | `LTV 12.8%` |
| **defended** | paid down to at or below the ceiling | `LTV 14.7% · peaked 18.9% → paid down $3,900` — **muted**, the plan working |
| **partial** | paid, but income ran out and it SETTLED ABOVE the ceiling | `LTV 18.0% · paid down $500, still above the 15% ceiling` — **amber** |
| **undefended** | above the ceiling with NO paydown (no income budget) | `LTV 19.2% · above the 15% ceiling — no income to pay it down` — **amber** |
| **noCollateral** | the draw landed with NO collateral behind it (peak ∞). ⚠ Checked FIRST — a paydown can fire there, and the settled LTV is a pre-existing 0 | projected: `LTV ∞ · drawn with no collateral behind it`; in progress: the LEDGER figure + ` now · plan: drawn with no collateral behind it` — **amber** |

- ⚠ **Partial must stay distinct from defended.** Both have a paydown, and in a stressed sweep partial months
  outnumber defended ones about 3:1. Collapsed, a losing month looks identical to a healthy one.
- ⚠ **"peak > ceiling ⟺ paydown" is FALSE:** with no income budget, the LTV sits above the ceiling unpaid — that is
  the undefended state.
- `stillAbove` has a 1e-9 tolerance, because a paydown sized exactly to the gap lands on the ceiling as a float.
- **Amber is reserved for partial and undefended.** Orange is gone from the badge, the plan bar, the paydown dot, the
  Simple scrubber's paydown share and the full-mode ProgressBar segment.

🔴 **`paydownReadout(plan, logged, isCurrent, ceiling)` — the header's LTV and paydown from ONE source:**

| Month | Reports |
|---|---|
| closed logged | the **ledger** — even a logged $0 beats a projected paydown; this was the reported bug |
| **current with an entry** | **in progress:** the ledger LTV so far, but the **planned** paydown stays the instruction, with a `($X left)` paren from the ledger's progress |
| unlogged | the plan |

⚠ The in-progress case is load-bearing. The owner journals in Simple mode daily, so the current month has an entry
from its first event; letting the ledger win there would hide the plan all month.

The ledger paydown is Strike-only, and it inherits the pre-existing stale-field defect (see the Coinbase section).

**Copy lives in `src/components/Playbook/playbookView.ts`** (pure and testable):
- `paydownBadge` is shared by both badges;
- `buildNarrative` moved out of `MonthlyPlaybook.tsx` and now narrates the **peak** in "LTV hit X% after drawing
  expenses" (it printed the settled figure, a number the LTV never "hit");
- a partial month no longer claims "back to 15%", an undefended one no longer claims "well below", and the quiet
  sentence is byte-identical.

**The figure rule (paydown-badge-followup spec v2): a bare LTV figure is coloured by THAT figure, and the figure must
be true.** Two pure helpers in `simpleModePlan`:
- `displaySettledLtv(row)` reads `AdvisorMonthRow.blocBalance`/`btcHeld` (⚠ NOT `MonthlyLogEntry.btcHeld`). It returns
  ∞ for debt with no collateral, 0 when the balance is paid off, and `blocLtv` otherwise.
- `isLtvFigureStressed(ltv, c)` is `ltv > c + CEILING_EPS`.

Both surfaces that show a bare figure now use them:
- the AFTER THIS MONTH box (`eomLtv` via `displaySettledLtv`, `eomStressed = isLtvFigureStressed(eomLtv)`);
- the plan bar (the projected `barStrikeLtv` via `displaySettledLtv`, coloured by `barStressed`).

⚠ **Run 2 (the plan of record):** Simple Mode's badge, AFTER box and plan bar are gone — THIS MONTH's card runs the
plan (§ The plan of record (Run 2)). `paydownReadout` / `paydownBadge`'s only app caller is now the Smart BLOC tab's
Playbook (`MonthlyPlaybook.tsx`), and `displaySettledLtv` / `isLtvFigureStressed` have no screen left: they wait for
Run 3, with `deriveForMonth` / `composeMonthSummary` / `isOperatingMonth`.

Only the header keeps `badge.tone`, because its two halves are labelled.

The old `eomStressed = eomState === 'partial' || eomState === 'undefended'` was an `===` consumer that the new member
slipped past. It was deleted only after an equivalence sweep in `paydownPeak.test.ts` proved the figure rule is
identical to it on every collateralised row.

⚠ `currentRow` is null when the current month already carries a confirmed entry (`startingMonth = last.month + 1`).
It never is because `currentMonth > 12`: that value clamps. **PlaybookItems** rewords its "(reducing LTV back to 15%)"
subtext in the partial state. Its `=== 'partial'` check misses `noCollateral` too; that is safe only because runBLOC
never pays down without collateral.

## Strike Minimum Payment + NDP re-scope (Simple Mode Corrections A; store v19, NO bump)

Corrects how the BLOC monthly minimum (accrued interest, billed monthly / due the 15th per Strike's terms)
is modeled. The payment SOURCE is now an owner-selectable policy (Settings → Strike → MINIMUM PAYMENT SOURCE),
and the NDP clause is re-scoped to roll-mode only.

- **Two synced settings (`useStore.ts`):** `blocMinPaymentSource: 'income' | 'roll'` (default `'roll'` —
  today's exact behavior, the migration-free choice) + `blocStatementMinimum: number | null` (this month's
  user-entered statement figure; `null` → the computed one-month-interest estimate `balance × APR/12`; reset to
  `null` at month-confirm). Both in `buildSettingsPayload` + `SETTINGS_FIELDS` + defensive `migrateState`
  defaults; **no store version bump** (initial-state default + custom shallow merge, `simpleView` precedent). Ride
  into the plan backup + trusted snapshot automatically; the safe snapshot (ratios-only) is untouched. ⚠ Run 2 (the
  plan of record): on THIS MONTH and Daily the owed figure is the statement's, else the PLAN's month-1 interest
  (`planMinimumOwed` — what Strike bills); with nothing owed there is no minimum line, so never a "MISSED".
- **Engine (`runAdvisor.ts`):** optional input `blocMinPaymentSource?` (defaults `'roll'` inside → every existing
  call site is byte-identical unless it threads the real value). After `blocInterest = blocBalance ×
  blocMonthlyRate` in BOTH branches: `roll` capitalizes (`blocBalance += blocInterest`, unchanged); `income` pays
  `blocMinPayment = min(income, interest)` from income (does NOT capitalize), re-capitalizes only the
  `blocMinShortfall = max(0, interest − income)`, and runs the LTV-paydown + BTC/CB-split on the reduced
  `incomeBudget = income − blocMinPayment`. New row fields `blocMinPayment` / `blocMinShortfall` (0 in roll).
  ⚠ The min-payment computation + the expense `blocDraw` + `fiatGap` + the Strike-LOC-funded cbPaydownDraw use RAW
  `income`/`expenses`, NOT `incomeBudget`.
- **`simpleModePlan.ts`:** `MonthPlan.minPayment` (= `row.blocMinPayment`); `deriveForMonth` subtracts it so
  `allocatedFromIncome = paydown + btcBoughtUsd + cbPayment + minPayment` still equals income;
  `composeMonthSummary` emits **"Pay/Paid the $X Strike minimum from income."** when `minPayment > 0`, else the
  existing **"Interest of $X capitalizes onto the balance."** (roll).
- **Threading:** the store `blocMinPaymentSource` is passed into `runAdvisor` at ALL app call sites so projections
  show the income-mode tradeoff (lower balance/LTV, less BTC) honestly — since the plan of record's Run 2 that is three
  (AdvisorMain, OutlookProjection via its prop, SimpleModeView's log overlay; Daily no longer runs the Advisor), and the
  plan reads the same setting as `strikeMinFromIncome` on every face and on THIS MONTH / Daily.
- **Simple Mode UI (`SimpleModeView.tsx`):** income mode adds a FROM MONTHLY INCOME allocation row "Strike minimum
  · due the 15th" (amount = `blocStatementMinimum ?? estimate` + a `statement`/`est.` chip; tap the amount →
  inline field → `setBlocStatementMinimum`; no Skip pill — contractual). Roll mode keeps the Interest-capitalizes
  row. The current-month reality math (`effectiveInterest`/`expectedBtcBuying`/`expectedPaydown`/`eomBlocBalance`/
  `loggedStrikeBal`/`allocatedFromIncome`) all gate the income-mode terms on `isIncomeSource` (roll = 0 → byte-
  identical). ConfirmLogSheet relabels the interest row "Strike minimum paid" in income mode; `handleApply` writes
  `strikeMinPaid` + `strikeMinSource` to the entry, and in income mode resets `blocStatementMinimum` to null +
  stamps `ndpLastPaidDate` (an external minimum IS a non-draw payment). Box 2 "THIS MONTH" Draw line now anchors on
  the MONTH's total (`effectiveDrawAmount`) with `($X left)` as the countdown parenthetical (was a bare "Draw: $0"
  once the month's draws were logged), plus a `Min:` line in both modes. ⚠ Run 2 (the plan of record): THIS MONTH's
  card replaced this UI — the minimum's foot is `planMinimumLine` + its PAID / DUE / MISSED chip (income mode) or
  `planInterestRollsLine` (roll mode), the due day is an ordinal ("the 1st", `fmtDayOrdinal`), and there is no inline
  statement editor on THIS MONTH (the figure is entered in Settings → Strike Strategy).
- **NDP re-scope:** `ndpActionActive` (SimpleModeView) is gated on `blocMinPaymentSource === 'roll'` — the annual
  NDP surfaces (`showNdpRow`, the "NDP paid $X" summary, the status pill/badge) only exist while minimums roll.
  `getNdpStatus`'s signature/estimate (one month's interest) is unchanged. ⚠ Run 2 (the plan of record): on THIS MONTH
  the NDP surface is the card's `planNdpLine` ("1 day", never "1 days"), roll mode only, plus the NDP urgency card
  above it, which reads `ndp.status` in either mode. ⚠ Run 2.1 (BL19): the urgency card's estimate and the month review's
  NDP seed are computed to the cent — `planNdpEstimateUsd` on `planNdpBalance` (the Strike balance read, else 15% of the
  line); `getNdpStatus`'s own estimate stays a whole dollar, read only by full mode's AdvisorSidebar.
- **`MonthlyLogEntry` += `strikeMinPaid?` / `strikeMinSource?`** (optional additive, legacy-tolerant next to
  `ndpPaid?`).

## Threshold validation (Simple Mode Corrections B)

The three CB threshold `NumberInput`s (SettingsMain cbloan subpage) gain `max={85}` bounds; the ordering warning
extends to `rotate-back < target < trigger < 86% (Morpho liquidation)`. In `runAdvisor` a `thresholdsOrdered`
guard (`cbRotateBackPct < cbLtvTargetPct < cbLtvTriggerPct`) leads BOTH the forward-paydown `if` and the
reverse-rotation `else if` — mis-ordered config suspends rotation for the month (no churn) while draw/interest/BTC
still run. Simple Mode's plan card surfaces an amber `.misorderNotice` "⚠ CB thresholds mis-ordered — rotation
advice suspended; fix in Settings → Coinbase Loan." when the persisted config violates ordering (covers
legacy/synced-in bad values). ⚠ Run 2 (the plan of record): that notice went with the old card — THIS MONTH runs the
plan, which reads no rotation thresholds; the Advisor's guard and Settings' ordering warning are unchanged.

## Cumulative savings-need line (Simple Mode Corrections C)

`SimpleModeView` computes `savingsNeed = Σ (max(0, fiatGap) + max(0, blocMinShortfall))` over the remaining
projection rows (`month ≥ currentMonth`) and renders a `.savingsNeed` line "Needs ~$X from savings over the next N
months" when `> $0` (N = remaining months with a gap) — muted normally, `.savingsNeedAlert` amber when `≥ 1× income`.
⚠ Run 2 (the plan of record): the line is `planSavingsLine` on THIS MONTH's card now — the bills nothing in the plan
pays (the run's `unfundedUsd`) over the strategy year's months left, same words, muted.

---

## Logging Consolidation — One Ledger, One Sign-off, a Pure Playbook (§1–§4 + §2b; store stays v19, NO bump)

Retires the **second writer** of monthly actuals. Before: the Daily view (**Ledger** — `dayLog` events that
roll up) AND the Monthly view's `ConfirmLogSheet` (**Playbook** — a parallel skip-adjusted derivation) both
wrote the same entry → "the amounts don't match." Now the **Ledger is the sole writer of actuals** and the
**Sign-off** (ReviewSheet) is the sole monthly confirmation; the Playbook renders its current month exactly
like any projected month (figures from the engine via `deriveForMonth`). ⚠ Run 2 (the plan of record): the
Playbook's figures now come from the plan's run (`usePlanMonth` — PlanMonthCard and Daily's plan card), not
`deriveForMonth`; the Ledger is still the only writer of actuals.

- **§1 Vocabulary + Invariant 1:** Ledger = Daily, Playbook = Monthly, Sign-off = ReviewSheet flow. **The
  Ledger is the only writer of ACTUALS** (`dayLog` events + the sign-off's entry fields); the Playbook never
  logs. (Invariant 2 / readings-unification is **§5b — DEFERRED**, see below.)
- **§2 Sign-off absorbs the confirm (ONE atomic write):** `confirmMonth(month, extras?)` (useStore) —
  `extras` (`expensesActual`/`ndpPaid`/`strikeMinPaid`/`strikeMinSource`) land WITH `confirmed:true` in a
  single `upsertLogEntry` (spread preserves `source:'daily'` → M2 guard passes; zero-arg callers unchanged).
  `ReviewSheet` gains a **SIGN-OFF DETAILS** group (Expenses actually paid; income-mode Strike-minimum-paid
  with the statement/est chip prefilled `rollup.streams.minPayment ?? blocStatementMinimum ?? estimate`;
  roll-mode NDP row). ⚠ Since the plan of record's Run 2.1 the three seeds are kept to the cent (`toCents`; the NDP's
  from `planNdpEstimateUsd`), so a sign-off stores cents unless edited. The **btcBought override retired** (fix a wrong
  buy by editing the event). Side-effects
  in `DailyModeView`'s confirm handler (mirror the corrections build): income → `setBlocStatementMinimum(null)`
  + stamp `ndpLastPaidDate`; roll → stamp when an NDP was recorded.
- **§2b The minimum payment, first-class:** a new `DayEvent` kind **`minPayment` `{ amount /* USD */ }`**
  (types.ts). `rollupMonth` (logUtils) sums it to `entry.strikeMinPaid` + `strikeMinSource:'income'` —
  **balance-NEUTRAL** (never `paydown`/balance; stocks still from readings; it's `isMonthlyMeaningful` via the
  default). `StreamAgg` gains a `minPayment` sum (calendarModel `aggregateEvents`). New synced setting
  **`blocMinPaymentDueDay`** (default 15, bounds 1–28; setter clamps; in payload + `SETTINGS_FIELDS` + migrate
  default; NO version bump). Pure **`minPaymentStatus(...)`** (simpleModePlan) → income: `PAID`/`DUE`/`MISSED`;
  roll: `ROLLS`. `EventSheet` gains a `'minPayment'` type-pill (income-mode only, gated on
  `blocMinPaymentSource`) — a one-field reading-free sheet (prefill `blocStatementMinimum ?? estimate`); the
  Paydown sheet shows a `Minimum · due the Nth · $X · STATUS` context line. Settings → Strike Strategy → a
  **MINIMUM PAYMENT** group (Source pills + This month's amount + Due day). Status chips (PAID/DUE/MISSED/ROLLS)
  on the Daily plan card + the Playbook Box 2 Min line. ⚠ Run 2 (the plan of record): the chip now follows the plan
  cards' minimum line — Daily's plan card and THIS MONTH's card foot (the current month) — in income mode only, and only
  with something owed (never a "MISSED" with nothing owed); roll mode shows the interest that rolls instead of a ROLLS
  chip, and Box 2 is gone. `MonthlyLogSection`/`Overlay` show `strikeMinPaid`;
  **`AdvisorSidebar`'s ANNUAL NON-DRAW PAYMENT card gates on `blocMinPaymentSource === 'roll'`** (an income
  minimum IS a monthly non-draw payment → the annual clause is gone).
- **§3 The Playbook goes pure (`SimpleModeView`):** RETIRED — `ConfirmLogSheet`, `handleApply`, the Pay/Skip
  pills, `custom*` overrides, the whole skip-adjusted block (`effective*`/`eom*`-skip/`expected*`/live
  `allocatedFromIncome`/`loggedStrike*`/`remainingDraw`), the "Log this month" button + logged-note Undo. The
  current month renders like any projected month via `selectedPlan`/`deriveForMonth`; Box 3 AFTER = the engine
  row's eom. A **sign-off pointer** ("Month N awaits sign-off in the Ledger →" → `setSimpleView('daily')`; shown
  when `currentEntry?.confirmed === false` or no entry) replaces the Log button; a read-only **MTD strip**
  ("Ledger: $X drawn · ₿Y bought · $Z paid ›" from `buildMonthRollup`) deep-links to the Ledger. Box 2/3 gain
  **paren symmetry** (plan headline + ledger progress: "Draw: $3,750 ($1,200 left)"). ⚠ Run 2 (the plan of record): the boxes are gone; the
  sign-off pointer and the Ledger strip live on in PlanMonthCard, their words from `planSignoffLine` / `planSignoffSub`
  / `planLedgerParts` (only what was logged, both loans' paydowns — never "$0 drawn"). `composeMonthSummary`'s
  skip args (`skipDraw/skipBtc/skipCb/unallocated` + `isCurrent`) are RETIRED from `MonthSummaryArgs`; the
  current voice = the imperative plan voice. **`advisorSkip*` stay DORMANT** in store + payload (sync compat;
  no consumers).
- **§4 Advisor surfaces = history, not writers:** `MonthlyLogSection` inline-log/Edit gates to legacy
  `source !== 'daily'`; a daily month is a VIEWER ("Edit the day's events in the Ledger" hint) and its
  Unlog/Undo becomes **Reopen → `unconfirmMonth(month)`** (flip `confirmed→false`, entry + rollup preserved —
  DELETE would tombstone the month and suppress its own future rollups). `MonthlyLogOverlay` same rule (viewer
  for all; edit gated to manual; a `useEffect` forces `editing:false` for daily). `deleteLogEntry` remains only
  for legacy `manual` entries. New **`unconfirmMonth`** store action.
- **§5b DONE (see the dedicated section below):** readings-unification — a `balanceReading` logged via the
  Daily FAB now re-anchors the live SafetyDashboard gauges in realtime; the SafetyDashboard / Quick-Setup
  editors emit a journaled reading; `reading.cbLiqPrice` + the EventSheet liq field re-anchor the CB
  liquidation. **R2 RESOLVED:** a CB balance reading re-anchors `cbLoanBalance` with a fresh `asOf` (the
  confirm-sheet auto-accrual is restored via the reading seam).

---

## Logging Consolidation §5b — Readings-Unification (the journal drives the live safety anchors; store stays v19)

Closes the last split from the consolidation arc: a `balanceReading` used to update only the monthly rollup,
never the three live **anchors** the SafetyDashboard reads (`advisorActualBlocBalance`, `cbLoanBalance`,
`cbLiquidationPrice`). Now a reading **writes** them. This delivers the owner's ask (log real balances → gauges
move in realtime) and restores the **R2** CB-accrual freshness. Most fragile surface — the seam is
**local-action-only**; cross-device travel stays on the plan channel (plan events since 4c; `settings:v1` before).

- **The model (write-at-log-time, "last action wins"):** the anchors are **synced settings with 11 writers**, so
  they can't be pure derived caches like `cbCollateralBtc`. A reading writes them once, at add/update/delete time
  (a local action) — since 4c through `emitPlanSets` (it fired `syncSettingsToNostr()` before) — so the anchor + its
  `asOf` ride the **plan-events** channel as one-ts plan events, exactly like a manual re-anchor.
- **Seam runs ONLY in `addDayEvent`/`updateDayEvent`/`deleteDayEvent`, NEVER in `setDayLog`** — a sync/merge must
  not jolt this device's SafetyDashboard (the anchor arrives as a plan event through the fold instead). **Distinction from
  `cbCollateralBtc`:** that continuous derive DOES run in `setDayLog` (a sum over ordered events, not a synced
  scalar); the anchor derive is local-action-only.
- **Pure `deriveReadingAnchors(dayLog, current, removed?)`** (`logUtils.ts`, mirrors `deriveCbCollateral`) — picks
  the **DATE-latest** surviving `balanceReading` (ties → latest `ts`; select-by-DATE, not `ts`, so editing an old
  reading — which bumps `ts` under LWW — can't resurrect it) and returns ONLY the anchor fields to write, each
  `asOf ← reading.date`: `strikeBal→advisorActualBlocBalance`, `cbBal→cbLoanBalance`, `cbLiqPrice→cbLiquidationPrice`.
  **Guard:** apply only if `reading.date ≥ anchor.asOf` (null asOf → always apply). **Idempotent** (already anchored
  to this exact reading → empty patch → no redundant publish). The store wrapper `refreshBalanceAnchors(ctx?)`
  applies the patch + syncs; `readingCtx(before)` builds the delete-fallback proxy from the pre-mutation reading.
- **Delete/date-move fallback (date + value proxy):** when the mutated reading's `oldDate == anchor.asOf` **AND**
  its pre-mutation value `== the current anchor value` (proxy for "this reading WAS the source"), that anchor
  re-points to the date-latest **survivor** unconditionally (falls off the deleted value); no survivor → unchanged
  (never nulled). **Date + value, not date alone** — a **knob-set** anchor (Settings/Advisor/CoinbaseLoan-sidebar
  direct-set, `asOf=today`, no emitted reading) plus deleting an *unrelated* same-day reading gives
  `oldDate==asOf`; the value match spares any knob-set anchor whose value differs. **Documented residual:** a knob
  value that coincidentally equals a deleted same-day reading's value still misfires — vanishingly rare +
  self-correcting (next reading re-anchors). The **emit-converted** surfaces are immune (their write IS the
  same-date `ts`-latest reading → the re-point lands back on it).
- **New synced field `advisorActualBlocBalanceAsOf: string | null`** (default null; in `buildSettingsPayload` +
  `SETTINGS_FIELDS` + `migrateState` default + both seed-resets; **no version bump**, merge-default). Gives the
  Strike balance an `asOf` for the guard (CB already had `cbLoanBalanceAsOf`/`cbLiquidationPriceAsOf`).
  `setAdvisorActualBlocBalance` now stamps it `= todayLocalISO()` (manual freshness → guarded from stale readings).
  SETTINGS_FIELDS count **37 → 38**.
- **`emitBalanceReading(overrides)`** (store action) — the emit-conversion for the SafetyDashboard inline editors
  (Strike box `saveStrike` / CB box `saveReanchor`) + the SimpleModeView **Quick-Setup** ("position modal"): a
  manual re-anchor becomes a journaled `balanceReading` (one write path). Synthesizes the un-edited half from
  current derived state (`computeStrikeLtv`, `accruedCbBalance`→`cbLtv` via `cbMetrics`, `cbCollateralBtc`). The
  **CB half is included ONLY when a CB field is overridden** (CB box) — a Strike-only re-anchor (Strike box /
  Quick Setup) emits a Strike-only reading so it never re-bases the CB balance or fake-freshens the CB freshness
  label. CB-box emit re-bases `cbLoanBalance` to `accruedCbBalance` + `asOf=today` (this is the **R2** restore).
  **v20 (C-P3): a `strikeCollateral?` override** makes the emit a COLLATERAL anchor — the reading carries
  `strikeCollateral` AND `strikeLtv` is computed against the **NEW** collateral (not `getCurrentBtcHeld()`); absent
  → byte-identical to today (no `strikeCollateral` key; a debt re-anchor). Only the collateral inputs
  (Settings/Advisor "current BTC" + Quick-Setup "BTC held" when changed) pass it — the SafetyDashboard Strike/CB
  debt re-anchors NEVER do, so a debt re-anchor can't hijack the collateral anchor. The CB-half gate is unchanged
  (keyed on `cbBal`/`cbLiqPrice`).
  ⚠ **Conscious consequence:** a `balanceReading` is monthly-meaningful → an emit re-rolls the current month and
  marks it `source:'daily'` (consistent with "one Ledger").
- **`reading.cbLiqPrice?`** (types.ts) — optional CB liq price on a reading; **anchor input, NOT a monthly stock**
  (`rollupMonth` never puts it in the entry, like `cbCollateral`). EventSheet's reading section gains a **"New
  Coinbase liquidation price (optional)"** field (via `SheetState.cbLiqPriceReading`, distinct from the
  collateral-move `cbLiqPrice`; **prefill EMPTY**, `subtext` "last: $X — leave blank to keep it"). Blank/0 →
  omitted → the seam leaves `cbLiquidationPrice` + its `asOf` stale (honest freshness); positive → re-anchors to
  the reading's date. Hidden for CB-collateral moves (they keep their own liq field — mutually exclusive, no
  double-write).
- **R2 RESOLVED** (was the interim regression): a CB balance reading (FAB) or CB-box re-anchor now re-bases
  `cbLoanBalance` to accrued + fresh `asOf`; CB freshness no longer depends on a separate manual re-anchor.
- Tests: `src/simulation/__tests__/readingAnchors.test.ts` (guard, select-by-date, delete-fallback + knob-set
  immunity, cbLiqPrice omit/present, Strike-only); `dailyModeStore.test.ts` §5b block (add re-anchors; `setDayLog`
  merge folds `cbCollateralBtc` but not the anchors; delete-fallback; `advisorActualBlocBalanceAsOf` synced);
  `eventSheet.test.ts` (`reading.cbLiqPrice` omitted when blank/0, present when entered, never on a collateral move).

---

## Strategy-Month Calendar Fix — anniversary bucketing, reconcile, start-balance carry (store stays v19)

**INVARIANT — a strategy month is a CALENDAR-ANNIVERSARY span, not average days.** Month N =
`[advisorStartDate + (N−1) calendar months, + N calendar months)`. Prior art computed months by
`floor(elapsedDays / 30.4375) + 1`, which pulled boundary days into the wrong month (a Jun-1 start
bucketed Jul 1 = 30 elapsed days into Month 1 — the owner's bug, in BOTH the calendar grid and the
Review/sign-off). One implementation now, in `logUtils.ts`:
- **`strategyMonthIndex(date, advisorStartDate)`** — the UNclamped 1-based calendar-anniversary index
  (may be <1 pre-start / >12 past-end). Day-of-month clamps for 29/30/31 starts (Jan 31 start → the Feb
  anniversary is Feb 28/29). Both dates parsed UTC-midnight (the date-only-ISO convention; mirrors
  `strategyMonthDate`, which already calendar-stepped — the two clocks now agree).
- **`bucketEventToMonth` = `clamp(strategyMonthIndex, 1, 12)`.** **`runAdvisor` now imports both** (no
  more duplicate clock): `getCurrentStrategyMonth(start) = bucketEventToMonth(todayLocalISO(), start)`;
  `isStrategyComplete(start) = strategyMonthIndex(todayLocalISO(), start) > 12`. "Today" is
  `todayLocalISO()` (the user's LOCAL calendar day) — a `yyyy-mm-dd` string in the same UTC-midnight
  space as `advisorStartDate` (consistent, no local/UTC mixing). runAdvisor→logUtils/format is cycle-free
  (both leaves). `calendarModel.monthDateRange` keeps its enumerate-AND-FILTER shape (the fixed
  `bucketEventToMonth` is authoritative); its 30.4375 constant only SIZES the scan window (margins widened
  to ±6 so the window always contains the 28–31-day calendar range). **Auto-fixed for free** (both read a
  FRESH rollup via `buildMonthRollup`/`bucketEventToMonth`): the calendar grid + the Review sheet/Daily
  activity card.

- **One-shot reconcile (`reconcileMonthBuckets`, useStore):** stored `monthlyLog` entries were rolled
  under the old buckets and don't re-roll on their own. Ascending loop 1..12; a month re-rolls (via the
  canonical `rerollMonth`) ONLY when its fresh rollup differs OR a **boundary strike-collateral move**
  changed its attribution. **The collateral blind spot (why the last clause exists):** `rollupMonth`
  returns `collateralDelta` SEPARATELY from the entry and the stored `collateralAdjustment` folds in
  graduated pending, so a moved `target:'strike'` deposit/withdraw changes NO comparable entry field —
  caught by comparing `strikeCollateralDelta(dayLog, start, m, bucketEventToMonth)` vs the same under the
  comparison-only, exported-solely-for-this **`legacyBucketEventToMonth`** (the pre-fix 30.4375 formula;
  NEVER used for live bucketing). Pure helpers extracted to `logUtils` (shared with `rerollMonth`, no
  drift): `strikeCollateralDelta` (bucket-parameterized; `rollupMonth` reuses it), `priorStocksForMonth`,
  `sameRollupFields` (rollup-owned-keys comparator, 0≡absent). Diff-guarded ⇒ **idempotent** (a re-run
  finds no diffs) and only CHANGED months publish. **Device-local flag `monthBucketReconcileDone`**
  (default false; rides `partializeState`'s `...rest`, ABSENT from `SETTINGS_FIELDS`/payload; migrate
  default `?? false`; no version bump; **5c:** settled `true` at every hydration of a store that holds no journal —
  `hydrateDeviceFlags` — and by `clearViewerData`, so a journal that arrives by sync is never re-rolled). Invoked once
  via **`useMonthBucketReconcile`** (AppShell, beside
  `useNostrAutoRestore`) — subscribes `done` + `hasData` so it fires after hydration (incl. the encrypted
  async-rehydrate path). **⚠ NEVER in viewerMode** (a viewer's `monthlyLog` comes from the owner's
  snapshot with an empty local `dayLog` → reconciling would delete every daily month). **⚠ NEVER before the plan
  loads (5c)** — against a seed plan (its start date today) it deleted months 2–4 and rewrote month 1 (5b's spec
  §16): `reconcileMonthBuckets` refuses (`refuseWithoutPlan`, the flag left unset) and the hook waits on
  `planMissing`. Cross-device:
  each device reconciles once against its own store; records LWW converges (a device that pulls another's
  reconciled month merges it, then its own reconcile no-ops).
- **REOPEN PRINCIPLE (state once, inherited by future rollup-touching fixes):** *a sign-off attests the figures its
  review shows and records; any operation that changes one of them reopens the month. A buy's dollars aren't one of
  them: a dollars-only buy edit on a current entry rewrites Income → BTC alone and keeps the sign-off (5d) — the
  pledged pair's display glitch aside, which can change the review's "Moved" row.*
  `rerollMonth`'s full path flips `confirmed→false` — the diff-guard makes this correct (unchanged months
  are skipped → `confirmed` preserved; a changed month's stale sign-off reopens, surfacing via the
  existing reconcile banner / "awaits sign-off" pointer).

- **Start-balance carry at sign-off (`DailyModeView` `onConfirm`):** the signed month's ENDING Strike
  balance becomes the next month's projection base — `setAdvisorMonthStartBalance(e.strikeBal)` after
  `confirmMonth`, **gated `safeViewedMonth === currentMonth − 1`** (a past-month sign-off via the ‹›nav
  must NOT clobber the current base; do NOT widen to `=== currentMonth`) and **narrowed
  `typeof e.strikeBal === 'number'`** (a provisional carry-forward month may leave `strikeBal` absent →
  don't write `undefined`/`NaN`). Fixes the "Playbook projects Month 2 from $0" report. Composes with the
  reopen principle: re-signing a reopened `currentMonth−1` carries the CORRECTED ending balance.
  **Documented residual:** an early sign-off of the STILL-current month won't stamp the base when the
  clock later rolls — rare (the banner flow signs after month end, hitting the gate); the Settings field
  stays editable (its second hint is the correction path). SettingsMain "Balance at start of this month"
  gained a second `fieldHint`: "Auto-carried from each month's sign-off — edit only to correct…".

---

