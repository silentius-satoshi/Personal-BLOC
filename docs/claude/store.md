# The store's shape; the dated-collateral model — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

## Zustand Store Shape (`useStore.ts`)

### Navigation
```typescript
activeTab:   'living'|'bloc'|'powerlaw'|'converter'|'mining'|'coinbase'|'advisor'|'settings';   // SESSION-ONLY (omitted from partialize) — every launch lands on the default 'living' (simple view when simpleMode); can't get stuck on a tab. Not in SETTINGS_FIELDS (no Nostr sync)
hiddenTabs:  string[];   // default ['coinbase', 'advisor']
tabOrder:    string[];   // default ['living','bloc','powerlaw','converter','mining','coinbase','advisor']
previousTab: Exclude<ActiveTab, 'settings'>;
```

### Smart BLOC Tab
```typescript
income:           number;   // default 4000
expenses:         number;   // default 3500
btcPrice:         number;   // updated every 60s fetch when btcPriceMode === 'live'
btcPriceMode:     'live' | 'manual';   // default 'live'; 'manual' suppresses live overwrites
btcPriceUpdatedAt: number | null;   // default null; ms of last setBtcPrice. PER-DEVICE, NOT synced (not in SETTINGS_FIELDS/buildSettingsPayload); persists via partialize rest; stamped by setBtcPrice → DevPanel price-age diagnostic
activeTier:       'min' | 'rec' | 'ideal' | 'custom';  // default 'rec'
blocApr:          number;   // default 13 (percent)
scenarioGrowth:   number;   // default 50
creditLine:       number;   // default 10000
```

### Living on Bitcoin Tab
```typescript
btcHoldings:      number;   // default 0.7
annualBtcGrowth:  number;   // default 50
bearMarket:       boolean;  // default false
bearPeriodYears:  number;   // default 2
annualDecline:    number;   // default -50
inflationRate:    number;   // default 2
ltvType:          'target'|'current'|'high'|'hyper';  // default 'current'
timeHorizonYears: number;   // default 1
```

### Sats Converter Tab
```typescript
converterActiveField: 'sats'|'btc'|'usd';  // default 'sats'
converterRawValue:    string;               // default '0'
```

### Mining Tab
```typescript
miningInputs: {
  devices: Array<{
    id:               string;
    name:             string;
    enabled:          boolean;
    hashrateThsInput: number;
    wattsInput:       number;
    soloMining:       boolean;
    poolName:         string;   // cosmetic only
    poolFee:          number;   // drives EV math (percent)
  }>;
  electricityRateCents: number;
  networkHashrateEH:    number;
  btcBlockRewardBtc:    number;
}
```

### CB Loan Tab
```typescript
cbLoanBalance:       number;                       // default 60000
cbCollateralBtc:     number;                       // default 1.48 — derived cache (deriveCbCollateral over dayLog); NOT a synced scalar, but P3 CONVERGES it cross-device via the synced dayLog (rides the journal sync — 5b: monthly pages, and records:v1 while it fits). setCbCollateralBtc emits a cbCollateralReading. ⚠ Every plan reader (the four faces' selectors, usePlanMonth for THIS MONTH's and Daily's plan cards, and — since the plan of record's Run 4 — the Smart BLOC sidebar's suggested line) reads it — and cbLoanBalance — only through planRun's planCbCollateralOf / planCbLoanBalanceOf (the plan of record's Run 2, D-R2-4): 0 with hasCbLoan off, so a fresh install's seed $60,000 on 1.48 ₿ never reaches a plan. The crash gate (isCrashDay — the Emergency Console and the plan card's crash line, usePlanCardInputs; since Run 4 also the CB Loan tab's banner) still reads the store figures, behind hasCbLoan (so did runAdvisor's three screen callers — the Advisor tab, Simple Mode's Outlook and THIS MONTH's log overlay — until the plan of record's Run 3 took runAdvisor off every screen)
strikeCollateralBtc: number;                       // default 0 (v20 Collateral-Truth) — derived cache (deriveStrikeCollateral over dayLog); reading-anchored current Strike collateral (= getCurrentBtcHeld). NOT synced (rides partialize ...rest); converges cross-device via the dayLog on records:v1. Refreshed in the 3 dayLog mutators + setDayLog + onRehydrate
cbAprPct:            number;                       // default 4.77
cbMonthlyPayment:    number;                       // default 0. INERT since the plan of record's Run 4 (D3): no component reads or writes it — the CB Loan tab's projection, its sidebar's MONTHLY PAYMENT, Settings' "Monthly payment" and the Advisor sidebar's "Min. payment" are gone (invariant 6 — the key stays)
cbLiquidationPrice:  number;                       // default 0 (0 = not set; guard before calling compute fn)
cbPaymentStrategy:   'monthly' | 'ltvTriggered';  // default 'monthly'. INERT since the plan of record's Run 4 (D3): no component reads or writes it — the Emergency Console and the crash day run on hasCbLoan, the liqsim tab is always "Emergency", and Settings lost its pills; the demo seed still writes 'ltvTriggered' (invariant 6 — the key stays)
cbLtvTriggerPct:     number;                       // default 75 (percent, e.g. 75 = 75%)
cbLtvTargetPct:      number;                       // default 65 (percent, pay down to this LTV)
cbRotateBackPct:     number;                       // default 55 (percent, reverse-rotation gate; synced in SETTINGS_FIELDS/payload like trigger/target). INERT since the plan of record's Run 3: no screen runs runAdvisor, and Settings no longer edits it (invariant 6 — the key stays)
cbEmergencyCeilingPct: number;                     // retained for sync compatibility — no UI consumer since the crash playbook (Run 2); default 30, clamped 20–50 in the setter; synced
cbLoanBalanceAsOf:      string | null;             // v13 — ISO date cbLoanBalance was last re-anchored (interest accrues daily from here); synced
cbLiquidationPriceAsOf: string | null;             // v13 — ISO date cbLiquidationPrice was last re-entered (drifts up with interest); synced
strikeLiquidationLtvPct: number;                   // v13 — Strike partial-liquidation LTV, default 85 (published terms); synced
```

### Advisor Tab
```typescript
advisorStartDate:         string;   // ISO date, default today
advisorActualBlocBalance: number;   // default 0 — LIVE drawn BLOC balance right now (the plan of record's Strike balance — THIS MONTH, Daily, the faces — Advisor, SafetyDashboard, NDP)
advisorMonthStartBalance: number;   // default 0 — BLOC balance at the START of the current month; projection base ONLY (deriveAdvisorStart month-1, which left with runAdvisor in 5e — the Advisor tab, the Outlook and THIS MONTH's log overlay until the plan of record's Run 3; INERT since: no screen runs the projection, Settings and Quick Setup no longer edit it, the month review's sign-off still carries it). SYNCED. Distinct from advisorActualBlocBalance (live drawn). (The Simple Mode AFTER box that stacked the full draw on it went with the plan of record's Run 2.)
advisorActualBtcHeld:     number;   // default 0 — DEPRECATED (spec v3): feeds no computation (monthly btcHeld is recorded, not chained); kept for sync compat + Fix D's seed sentinel — LEAVE IT ALONE, never zero it. (v20: pendingCollateralAdjustment RETIRED — Strike collateral is reading-anchored)
sandboxCollateralBtc:     number | null;  // default null — Smart BLOC what-if collateral; IN-MEMORY only (partialize-excluded, never synced); null = tracks current
advisorSkipBlocDraw:      boolean;  // default false (persisted + synced) — INERT since the plan of record's Run 3 (the Pay / Skip toggles left the Advisor tab)
advisorSkipCbPayment:     boolean;  // default false (persisted + synced) — INERT since Run 3
advisorSkipBtcBuying:     boolean;  // default false (persisted + synced) — INERT since Run 3
monthlyLog:               MonthlyLogEntry[];  // default []
showMiningInLog:          boolean;            // default false
```

### The plan of record (Run 1) — the support policy's saved settings (`planInputsSlice`)
```typescript
policyCbStopAtSupportPct:     number;   // default 45 (C1) — Coinbase limit at support, % (range 40–70)
policyStrikeStopAtSupportPct: number;   // default 50 — Strike limit at support, % (30–60)
policyAccumulateBelow:        number;   // default 2.0 — buy with the line up to this × support (1.0–2.5)
policyPayDownAbove:           number;   // default 3.0 — pay down above this × support (1.5–5.0)
policyBearBufferMonths:       number;   // default 12 — borrowing room kept, months (0–48)
policyCashReserveMonths:      number;   // default 0 — cash reserve, months (0–12)
setPlanPolicy:   (patch: Partial<PlanPolicySettings>) => void;   // clamp each value; drop unchanged ones and `enabled`; ONE emitPlanSets (one ts)
resetPlanPolicy: () => void;   // "Back to the defaults (C1)" — all six as explicit events, one ts
```
All six are SYNCED plan fields (`SETTINGS_FIELDS`, plan events on `plan-events:v1`), in the plan backup and EXPOSED to a
trusted viewer (D9). No off switch. Absent from the log = C1. Every reader goes through `planPolicyOf` /
`clampPlanPolicy` (`lib/planPolicy`). Settings' "Your plan" is the only place the owner edits them — see § The plan of
record (Run 1).

### The plan of record (Run 2) — three device-local keys (`uiSlice`, `viewerSlice`)
```typescript
planNoteDismissed:      boolean;   // default false — the one-time note (D8), dismissed on THIS device
setPlanNoteDismissed:   (v: boolean) => void;   // plain set — no emit, no dirty channel
planBreakerCache:       { state: RearmableBreakerState; lastMonthEndISO: string } | null;   // default null — the breaker as last folded from month-end prices on THIS device (§4.3, invariant 10): THIS MONTH reads it offline; public price data only
setPlanBreakerCache:    (v: … | null) => void;   // plain set — usePlanMonth's ONE write, a fresh fold, in an effect
viewerStrikeDepositISO: string | null;   // default null — a TRUSTED viewer's copy of the owner's latest Strike deposit date (D9; the snapshot's strikeLastDepositISO, raw-set by viewerSync); null on an owner device; reset by clearViewerData
```
All three persist via `partializeState`'s `...rest` and are NEVER synced: not in `SETTINGS_FIELDS`, `PREFS_FIELDS`,
`VIEWER_SETTINGS_FIELDS` or the plan backup, and no settings or prefs apply writes them — the one outside writer is
viewerSync's trusted apply, which raw-sets `viewerStrikeDepositISO` from the snapshot. No store version bump — the
persist merge fills the defaults, and a demo or e2e blob without them shows the note. The cache is read only through
planRun's `planBreakerCacheOf` (the engine's own `validOpeningBreaker`, dated `yyyy-mm-dd`): a damaged cache reads as
none, and the next fresh fold rewrites it. See § The plan of record (Run 2).

---

## Dated Collateral Model — ⚠ SUPERSEDED at v20 by reading-anchored Strike collateral

> **Collateral-Truth Consolidation — C-P1→C-P4 COMPLETE (store v20):** Current Strike collateral is **reading-anchored**,
> NOT computed from the log chain. `getCurrentBtcHeld() = deriveStrikeCollateral(dayLog, strikeCollateralBtc)`
> — the `strikeCollateral`-bearing `balanceReading` latest by (date, then ts) + `target:'strike'`
> deposit/withdraw moves STRICTLY after it (see the §deriveStrikeCollateral in `logUtils.ts`). **RETIRED:**
> `pendingCollateralAdjustment`, `adjustCurrentCollateral`, graduation (`upsertLogEntry`), restore-on-delete
> (`deleteLogEntry`), and rerollMonth's Seam-1. `collateralAdjustment` is **never written again** (existing
> values stay as historical ledger — never "fix" the data). **Semantic shift (intended, LD5):** a bare
> `deposit target:'strike'` with no accompanying `strikeCollateral` reading no longer moves current — the
> reading anchors. **Buys never count** toward Strike collateral. `deriveCurrentPosition`/`deriveAdvisorStart`
> now take `currentStrikeCollateral` (from `getCurrentBtcHeld()`), not baseBtcHeld/pending. ⚠ **SUPERSEDED
> again by strike-collateral-recorded spec v3:** `recomputeBtcHeld` is DELETED; per-entry `btcHeld` is RECORDED
> (see § Recorded Strike collateral below); `advisorActualBtcHeld` is deprecated-but-read (Fix D). **C-P3** = the write UI (EventSheet required `strikeCollateral`
> field + auto-track to the post-move total, buy "pledge to Strike" toggle, `emitBalanceReading` collateral
> override, the three collateral inputs re-editable as reading-emitters). **C-P4** = the trusted viewer receives
> `strikeCollateralBtc` as a derived-from-dayLog scalar (raw-set in `viewerSync`, viewer dayLog stays `[]`; SAFE
> payload excludes it), so the viewer's `getCurrentBtcHeld()`/Strike figures are correct. The rest of this section
> is HISTORICAL (pre-v20).

### Recorded Strike collateral (strike-collateral-recorded spec v3 — store unchanged, NO bump)

`MonthlyLogEntry.btcHeld` (the Ledger's **"Strike col"**) is **RECORDED**, exactly like `strikeBal`. `rollupMonth`
stamps it from the month's latest reading's `strikeCollateral` (carry-forward included), and nothing recomputes it.
**`recomputeBtcHeld` is DELETED**, with its four call sites (upsert, delete, the Nostr records merge, the viewer
hydrate). The old chain, `advisorActualBtcHeld + Σ(btcBought + collateralAdjustment)`, counted every buy as pledged,
and the v20 back-solve drove the baseline negative on a real install.

- **Which `btcHeld`:** five data fields share the name, and ONLY `MonthlyLogEntry.btcHeld` changed. These are
  untouched:
  - `AdvisorMonthRow.btcHeld` (simulated; the paydown badge's `displaySettledLtv` read it until the plan of record's
    Run 3 deleted it);
  - `CyclingRow.btcHeld` (all three pools);
  - `deriveCurrentPosition().btcHeld`;
  - `StrategyMonthData.btcHeld`.
- ⚠ **OPTIONAL — absent means never recorded. NEVER write 0.**
  - The `rerollMonth` new-month seed carries no `btcHeld`.
  - The two monthly editors write it only when their "Strike collateral" field has a value (`strikeColFragment`). That
    field applies to manual months only; daily months are read-only in those editors.
  - A Strike-only re-anchor records nothing.
- ⚠ **Readers were LISTED, not assumed.** Making the field optional forces only the sites that use it as a number.
  - LedgerFace renders "—".
  - `buildLedgerCsv` emits an empty cell.
  - ⚠ `validatePlanBackup` now accepts absent or finite. `btcHeld` used to be in its required list, so the new build
    would have rejected its own backups.
- ⚠ **`ROLLUP_NUM_KEYS` is untouched.** Adding `btcHeld` would make a joining device's one-shot reconcile see "absent vs
  stored", re-roll, and reopen every signed month.
- **The "→ Cold" Ledger column is COMPUTED, never stored.** It comes from the dayLog via `coldMovedByMonth`. Cold moves
  are journal-only, so a stored figure would go stale.
- **Onboarding records collateral as a reading.** `handleDone` calls `emitBalanceReading({ strikeCollateral })` AFTER
  `setAdvisorStartDate`. A fresh install's `strikeCollateralBtc` is 0, so `getCurrentBtcHeld()` used to be 0 for every
  new owner. Side effect: the current month gets an unconfirmed daily entry on day one.
  ⚠ The reading is dated **TODAY** (`emitBalanceReading` hard-codes it). A BACKDATED strategy start therefore records
  the collateral in the month containing today, and the earlier months have NO row. **By design:** the owner typed a
  CURRENT position, and the app does not infer a historical one. Never add a dated `emitBalanceReading` for this. The
  owner can state history themselves — collateral through the monthly correction path, balances through a backdated
  EventSheet reading.
  `getCurrentBtcHeld()` is correct either way (pinned in `recordedCollateralStore.test.ts`).
- ⚠ **`advisorActualBtcHeld` is DEPRECATED — LEAVE IT ALONE, never zero it.**
  - It feeds no computation, but Fix D's seed sentinel (`syncEngine`) reads it and onboarding still writes it.
  - The Settings "Initial BTC collateral" field is gone.
  - `persistConfig`'s v20 block is untouched; the stored bad baseline is inert.
- **History is NOT auto-repaired.** Pre-cold-ledger venues were never recorded.
  - To repair a DAILY month's collateral, use **"Set collateral"** in the monthly-log editors — the correction path
    below (`daily-month-collateral-edit-spec-v2`). ⚠ The old route, a backdated FULL reading carrying
    `strikeCollateral`, is GONE from the EventSheet: a past-dated add never states collateral
    (`readingCollateralPolicy`, `provisional-clears-on-reading-spec-v1` 3b). A backdated reading still restates the
    month's `strikeBal`/`strikeLtv` (`rollupMonth` picks the reading by `ts`, so it supersedes every stock), and it
    turns a `fragile` month `stable`, so a correction made after it holds.
  - ⚠ **Mixed-version hazard:** a device still on an old build recomputes and republishes, so update every device.
- **Correcting a DAILY month's collateral (`daily-month-collateral-edit-spec-v2`).** `btcHeld` is RECORDED, not rolled,
  so it is the ONE field a daily month lets the owner edit. Every rolled-up field stays read-only, and the wide Edit form
  stays closed.
  - **Where:** a **"Set collateral"** button, owner-only (`!viewerMode`), in both monthly-log editors:
    - `MonthlyLogSection`'s header, on the Advisor tab;
    - `MonthlyLogOverlay`'s active card: Simple Mode → Monthly Playbook → scrub to a past logged month →
      "✎ View / edit this month". Its ‹ › / dots / swipe then reach any month, including the current one.
  - **The narrow mode** holds ONE `type="text" inputMode="decimal"` field, parsed by the strict
    `parseCollateralInput` (at most 8 decimals, at most 21M, and "0,42" reads as 0.42). ⚠ Not `type="number"`: that
    input hands React `''` for ANY unparseable entry, so a typo would silently clear the record. Save is disabled until
    the text parses. **Clear record** is its own button, and the only way to un-record.
  - **The write:** `collateralCorrection(entry, btcHeld | null)` is read FRESH via `getState()` and written with
    `upsertLogEntry`. It preserves `source` (so the M2 guard is satisfied, not bypassed), `confirmed` and `loggedAt`.
    Save re-checks the durability class and writes nothing on a month that turned `stated` mid-edit.
  - **Both views** show a read-only "Strike collateral" row ("—" when never recorded).
  - **Durability — `correctionDurability(dayLog, start, month)`** mirrors `rollupMonth` exactly, and the line
    `DURABILITY_HINT` shows the owner comes from it:
    - `stated` — the LATEST in-month reading states it. No button; the hint says to edit that reading.
    - `stable` — there is an in-month reading that doesn't state it, or no in-month reading and the prior month's
      doesn't either. The bridge keeps the correction.
    - `fragile` — no in-month reading, and the prior month's latest reading states it. The carry-forward stamps it.
  - **Precedence:** in-month reading > carry-forward from the prior month's reading > the owner's correction. The
    middle rung is a known inversion — the app's guess beats the owner's statement.
  - ⚠ The class describes the NEXT re-roll. Deleting the month's only reading, or backfilling a prior-month reading that
    states collateral, makes a `stable` month `fragile`, which is why the `stable` hint names BOTH ways out.
  - 🔴 **DO NOT TOUCH (stale-field defect 2):** a future fix that clears every key the rollup omits must NOT clear
    `btcHeld`, or every correction vanishes on the next re-roll. `provisional-clears-on-reading-spec-v1` is the scoped
    precedent — it fixed `provisional` only.
  - **Rejected: a bridge guard that keeps `base.btcHeld` over a carry-forward.** The bridge has no provenance:
    - **SE1** — a carry-forward would freeze instead of re-tracking the prior month's later reading;
    - **SE2** — a deleted reading's figure would outlive it.

    The sound fix is an entry-level provenance field (`btcHeldStated?`) — its own spec.
  - The overlay's ← / → paging ignores key presses while an input has focus. They move the caret, and paging would
    discard what was typed.

The (pre-v20) computed-chain model, kept for history:

```
btcHeld[i] = baseline + Σ_{j≤i} (btcBought[j] + (collateralAdjustment[j] ?? 0))
current    = (last.btcHeld ?? baseline) + pendingCollateralAdjustment   // ⚠ RETIRED at v20
```

- `MonthlyLogEntry.collateralAdjustment?: number` — OPTIONAL; net BTC deposited(+)/withdrawn(−) that
  month, separate from btcBought. **STORE-OWNED**: written only by graduation in `upsertLogEntry`
  (UI log handlers untouched). Remote pre-v4 entries lack it — `?? 0` everywhere; merges pass winner
  objects through whole. **No store bump** (v3's v12 cancelled: optional field + shallow-merge default,
  no transform; Spec B stays v12).
- **Graduation** (`upsertLogEntry`): the CURRENT month's upsert folds `pendingCollateralAdjustment`
  into the entry's adjustment and zeroes pending; past-month edits preserve the stored adjustment and
  never graduate; re-editing a logged current month with pending=0 keeps the graduated value (read off
  the LOGGED entry). Both commit paths (Simple Mode confirm + Advisor inline) hit the same upsert.
  When graduation zeroes a non-zero pending it ALSO calls `syncSettingsToNostr()` — pending→0 must
  reach the relay or the other device shows inflated current.
- **`deleteLogEntry`**: recomputes the surviving chain (`recomputeBtcHeld` — fixes the old stale-chain
  gap) and, for the CURRENT month only, restores the deleted entry's adjustment to pending (un-logging
  must not erase a real deposit; it re-graduates on the next log; publishes settings when restored).
  Past-month deletes do NOT restore. Tombstone + dirty + records publish unchanged.
- **Reality reads/writes**: `getCurrentBtcHeld()` (store getter) and `adjustCurrentCollateral(target)`
  (delta lands in pending; publishes settings). `deriveCurrentPosition` AND `deriveAdvisorStart` take
  `pendingCollateralAdjustment` as a REQUIRED param — the compiler flags any unthreaded surface.
  Baseline feeds to `recomputeBtcHeld` stay `advisorActualBtcHeld` everywhere (store upsert/delete,
  applyRemoteEvent merge apply, migrate).

| Surface | Role |
|---|---|
| Settings "Current BTC collateral" | REALITY — editable (C-P3): draft/onBlur → `emitBalanceReading({ strikeCollateral })` (a journaled reading re-anchors `getCurrentBtcHeld`; `strikeBal` defaults to the live drawn balance). (The read-only "Initial BTC collateral" line was REMOVED in spec v3 — it fed nothing and could not be corrected.) |
| Advisor "CURRENT BTC HELD" | REALITY — same draft/onBlur → `emitBalanceReading({ strikeCollateral })` (C-P3) |
| Simple Mode Quick Setup "BTC held" | REALITY — editable `ModalField` (C-P3); `handleSaveSetup` keeps `emitBalanceReading({ strikeBal })` for the debt field and MERGES `strikeCollateral` into that SAME emission only when the collateral changed (never two emissions) |
| Simple Mode displays (and the Liq Sim, until the plan of record's Run 4 deleted it) | REALITY — `getCurrentBtcHeld` = reading-anchored `deriveStrikeCollateral` |
| Smart BLOC tab (InputsPanel, TierCards, MonthBreakdown, useSimulation) | SANDBOX — `sandboxCollateralBtc ?? current`, ephemeral, no write-back |
| Settings "Spendable BTC (dry powder)" | NOT collateral — read-only live figure from the Strike API (`strikeBtcAvailable`); see Strike Dry-Powder note below |

**Strike Dry-Powder (spendable BTC) — DISPLAY-ONLY, never collateral:** `useStrikeData.ts` reads the BTC
balance's `available` field from `/api/strike-balances` (same array as the USD `current` parse) into
`strikeBtcAvailable` — live-fetched, in-memory, NOT persisted/synced (excluded from partialize like
`strikeUsdBalance`/`strikeRate`; store v12 unchanged). Shown in TWO places, both display-only: (1)
**Settings → STRIKE BLOC** as a read-only "Spendable BTC (dry powder)" row BENEATH Initial/Current
collateral (completing the Initial → Current → Spendable trio), in a neutral muted color (distinct from
the orange baseline + green delta), gated on `strikeApiConnected && strikeBtcAvailable !== null`, reusing
the `readOnly`/`valueColor` NumberInput props; and (2) the Smart BLOC tab's `InputsPanel` as its OWN
**STRIKE BTC DRY POWDER** widget — a card structurally identical to STRIKE USD HOLDINGS (header +
connection dot + big `strikeBalanceValue` figure + `~$USD` secondary line + "spendable — not collateral"
note), stacked directly beneath the USD widget (`.scrollArea` flex `gap` spaces them). Placeholder "—"
when disconnected OR `strikeBtcAvailable === null`. The `strikeRateDelta` "Strike BTC: $price (vs
Coinbase)" RATE line stays in the USD widget (it's a price readout, not a balance). InputsPanel renders
only on the Smart BLOC/default tab — not Simple Mode; Settings remains the cross-mode home.
It NEVER enters LTV/collateral/projection math (`strikeBtcAvailable` appears only in the store, the fetch
hook, and the Settings display block). **API constraint:** Strike's balances endpoint exposes no
collateral/pledged field and the public API has no BLOC/loan endpoints, so collateral stays manually
tracked (`advisorActualBtcHeld` + `collateralAdjustment`); the fetched BTC is spendable-only by construction.

**Observability** (added post-v4 for smoke verification): DevPanel COLLATERAL section (baseline/pending/
current — ON-DEVICE only; Copy Diagnostics gets a `pendingNonZero` boolean, never the amounts); an
orange pending hint under both reality inputs incl. the graduation month ("+0.05000 ₿ pending — dates
to Month N when logged"); an ADJ stat on log entries with a non-zero adjustment (carousel mini-card,
detail panel, overlay — absent when zero); `adjustCurrentCollateral` logs 'collateral adjustment
recorded' (no amounts — the log ring stays paste-safe).

---

