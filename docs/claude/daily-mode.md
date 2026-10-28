# Daily Mode — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

## Daily Mode (P1 — pure data layer; store stays v18)

A granular daily journal that rolls up into the existing month log. **P1 is types + two pure functions only** — no
store, no UI, no sync.

- **`DayEvent`** (types.ts) — a discriminated union over `DayEventKind` =
  `draw | buy | paydown | minPayment | deposit | withdraw | balanceReading | cbCollateralReading`. Base = `{ id,
  date (ISO yyyy-mm-dd), ts (ms) }`. `draw`/`paydown`/`minPayment` carry `amount` (USD); `buy` carries `amount`
  (BTC) + optional `usd`; `deposit`/`withdraw` carry `amount` (BTC magnitude) + `target: 'strike' | 'cb'`;
  `cbCollateralReading` carries `cbCollateral` (BTC); `balanceReading` carries a nested `reading { strikeBal,
  strikeLtv, cbBal?, cbLtv?, cbCollateral?, cbLiqPrice?, price? }` (`cbLiqPrice?` = §5b anchor input, re-anchors
  `cbLiquidationPrice`; NOT a monthly stock — never in the rollup entry). (`minPayment` = the Strike monthly minimum paid from
  income — Logging Consolidation §2b; **balance-neutral**, rolls up to `strikeMinPaid` only.)
- **LD5 — stocks are READINGS:** balances/LTVs are read off Strike/Coinbase (the `balanceReading` event), never
  chained. (P1-era: btcHeld was store-owned via a chain — SUPERSEDED: a reading's `strikeCollateral` anchors current
  collateral (v20), and `rollupMonth` records it as the month's `btcHeld` (spec v3).)
- **LD7 — CB collateral = a reading, not a chain:** `cbCollateralBtc` is DERIVED (latest `cbCollateral`-bearing event
  by date, then `orderTs` (Hotfix 1, A2-1) — `balanceReading` or `cbCollateralReading`), wired in P2; it is NOT a
  synced setting and is NEVER placed in
  the rollup entry.
- **`target` semantics:** `deposit`/`withdraw` `target:'strike'` feeds `collateralDelta` (the P2 collateral seam);
  `target:'cb'` is **journal-only** (ignored by rollup — CB collateral comes from the reading).
- **`rollupMonth(dayLog, month, advisorStartDate, priorStocks?)` → `{ entry: Partial<MonthlyLogEntry>, collateralDelta }`:**
  flows accumulate (`draw`→`expensesActual`, `buy`→`btcBought` [+`income` iff `usd`], `paydown`→`paydown`);
  `collateralDelta` = net `target:'strike'` BTC, **signed by kind** (deposit +, withdraw −); stocks from the LATEST
  `balanceReading` by date, then `orderTs` (Hotfix 1, A2-4): `strikeBal`/`strikeLtv` always, `cbBal`/`cbLtv` iff
  present. `entry` NEVER carries
  `collateralAdjustment`/`source`/`confirmed`/`cbCollateral` (spec v3: it carries `btcHeld` iff the reading states
  `strikeCollateral`). **Carry-forward** (LD6 backfill exception):
  flows present but no `balanceReading` + `priorStocks` given → stocks borrowed from `priorStocks` + `provisional:true`.
  ⚠ A reading emits **`provisional: false` EXPLICITLY** (not an omitted key) — `rerollMonth` spreads the rollup over the
  stored entry, so an omitted key let a stale `true` survive the very reading the ReviewSheet asked for
  (`provisional-clears-on-reading-spec-v1`). Flows with no reading and no priorStocks → the key is absent.
  Empty month → `{ entry: {}, collateralDelta: 0 }`. `bucketEventToMonth(date, advisorStartDate)` = the
  calendar-anniversary month clock (`getCurrentStrategyMonth` now delegates to it — see the Strategy-Month
  Calendar Fix section). `collateralDelta` is the extracted `strikeCollateralDelta` (reused by the reconcile).
- **LD6 — hard-require stocks at creation time:** a real month entry should be created from a `balanceReading`; the
  carry-forward `provisional` path is the explicit backfill exception (P2 enforces the creation-time requirement).
- **`MonthlyLogEntry` gains `source?: 'manual' | 'daily'` / `confirmed?: boolean` / `provisional?: boolean`** — all
  OPTIONAL (undefined on legacy entries = manual / confirmed / non-provisional), so no migration. `source`/`confirmed`
  are P2-stamped; `provisional` is set by `rollupMonth` carry-forward. **Store stays v18** (P1 adds only optional fields).

---

## Daily Mode (P2a — store wiring; store v18→19)

Wires P1 into the store. **No settings UI (P2b).** `dayLog` is **LOCAL-only this phase** — no records-sync plumbing;
**cross-device `cbCollateralBtc` sync is intentionally suspended P2a→P3** (removed from settings sync here, re-established
via dayLog records sync in P3).

- **State:** `dayLog: DayEvent[]` (default `[]`) + `cbLtvAction: 'paydown' | 'addCollateral'` (default `'paydown'`).
  Both persist via the partialize rest (not synced). `cbCollateralBtc` becomes a **derived cache** (no longer in
  `buildSettingsPayload`/`SETTINGS_FIELDS`).
- **Three mutators `addDayEvent`/`updateDayEvent`/`deleteDayEvent`** — mutate `dayLog`, refresh the cbCollateral clock,
  then route off kind:
  - **Route 1 (journal-only) — NOT "monthly-meaningful":** `cbCollateralReading` (clock-only, refreshes the
    `cbCollateralBtc` cache via `deriveCbCollateral`) AND a `deposit`/`withdraw` with `target:'cb'` (CB collateral comes
    from the reading). These **never** re-roll / touch `monthlyLog` — `monthOf()` returns null. The shared predicate
    `isMonthlyMeaningful(ev)` backs BOTH `monthOf` and `rerollMonth`'s filter so they can't drift; without this a
    `target:'cb'` move would flip a manual month to `source:'daily'` and trip the M2 guard (BUG1 class).
  - **Route 2 (monthly-meaningful) — draw/buy/paydown + `target:'strike'` deposit/withdraw + balanceReading:**
    `rerollMonth(month)` (update across a month boundary re-rolls BOTH old + new). `priorStocks` = the prior
    strategy-month's last `balanceReading` by date, then `orderTs` — its close, `rollupMonth`'s own rule (Hotfix 1).
- **Partial→Full bridge** (`rerollMonth`): spread the `rollupMonth` Partial onto the EXISTING month entry (preserve
  miningSats/ndpPaid/loggedAt) or a full numeric seed for a new month (never `{}`); stamp `source:'daily'`,
  `confirmed: existing.confirmed===true ? false : (existing.confirmed ?? false)` (reopen-on-edit, LD4). The new-month seed carries
  NO `btcHeld` (spec v3 — recorded only from a reading; there is no recompute to overwrite a placeholder). **Emptied-daily-month cleanup:** if no Route-2 events
  remain in the month and the entry is `source:'daily'`, `deleteLogEntry(month)` instead of a stale placeholder.
  **5d:** with `dollarsOnly` (a dollars-only buy edit on a current entry) the month gets only its Income → BTC
  rewritten — its `confirmed` and every other figure stay; every other edit, and an entry the lag check sees lagging,
  re-rolls and reopens (LD4). Every dollars-only edit — its entry current or not — skips `refreshBalanceAnchors` (a
  buy feeds no reading); every other edit still runs it.
- **Seam 1 (collateral)** — after the upsert (which graduated any prior pending into this month's `collateralAdjustment`),
  and ONLY when `collateralDelta !== 0`: `adjustCurrentCollateral(getCurrentBtcHeld() − thisMonth's existingAdj +
  collateralDelta)`. Subtracting `existingAdj` (the just-graduated amount) before adding the WHOLE-month net
  `target:'strike'` delta prevents double-counting earlier same-month deposits. `target:'cb'` contributes 0 (journal-only).
- **Seam 2 (cbCollateral clock)** — `deriveCbCollateral(dayLog, cache)` (logUtils) = latest `cbCollateral`-bearing event
  by date, then `orderTs` (Hotfix 1, audit A2-1: by ts alone, an older reading edited, restored or backfilled became the
  current one) across `balanceReading` + `cbCollateralReading`, fallback to the cache (never undefined). `setCbCollateralBtc(v)`
  now **emits a `cbCollateralReading`** (clock path) + sets the field — NO `syncSettingsToNostr`. The cache is recomputed
  in `migrate` AND `onRehydrateStorage` (every reload).
- **M2 guard** (centralized in `upsertLogEntry`): a write with `entry.source !== 'daily'` against an existing
  `source:'daily'` month is dropped (warn + return) — protects daily-owned months from the Monthly/Advisor UI paths (all
  funnel through `upsertLogEntry`). The daily routing stamps `'daily'`; `confirmMonth` preserves it; legacy/manual months
  (undefined source) are unaffected.
- **`confirmMonth(month)`** — sets that month's `confirmed:true` (spreads source through → passes the M2 guard).

---

## Daily Mode (P3 — `dayLog` rides records sync; store stays v19)

Wires `dayLog` into the Nostr **records:v1** channel (the same path as `monthlyLog`), re-establishing the
cross-device `cbCollateralBtc` sync suspended in P2a, and fixing two viewer bugs. **No store version bump** —
`deletedDayEvents` defaults via the custom shallow `merge` (`current` fills absent keys), exactly like
`deletedMonths`. **This is the project's most fragile surface (the data-scare origin)** — the design keeps
`sync.ts` *actions-only* (no new `useStore.setState` in the apply path) and reuses the tombstone/merge
discipline verbatim.

- **INVARIANT — dayLog `ts` is the MERGE VERSION CLOCK; `date` is occurrence.** Same-id conflict resolves
  higher-ts-wins, tie → local (self-pull idempotence — pulling your own just-published copy back must not
  thrash). Therefore **`updateDayEvent` MUST bump `ts` to `Date.now()` on every edit** (`addDayEvent` uses
  the event's creation ts; `deleteDayEvent` already stamps `Date.now()` on its tombstone). A preserved-ts
  edit would tie with the stale remote copy on every other device → tie→local → the edit loses everywhere
  → permanent split-brain (the P3 edit-propagation bug — fixed). **Hotfix 1 reverses the old "acceptable
  consequences"** — an edited event moving to edit-time in same-day ts ordering, an edited `balanceReading` becoming
  the date-latest reading. An edit corrects what an event said; it is not a new statement. Every order rule read ts as
  occurrence, so an edited, restored or backfilled older event acted as the newest (audit A2-1, A2-3, A2-4: the CB
  collateral, a month's close, a Strike move counted twice). Now `updateDayEvent` (off the STORED copy — the sheet
  rebuilds the event, and its ts may be an earlier edit's) and `undoDayEventDeletion` stamp `at` — the ts the event was
  first logged with (`orderTs` of the copy they start from) — and every "latest reading" and "after the anchor" rule
  orders by (date, then `orderTs` = `at ?? ts`). ts stays
  the version in the merge, the journal's pages and `monthEntryCurrent`. `at` is optional (absent = ts): no store bump.
  An edited Strike move carries its own reading (the one its Save wrote: same date, same place, states collateral —
  `ownReadingAfterEdit`) by the change, in whole sats, so the sheet's "Strike held after" holds while that reading is
  the anchor (a later reading's total stands); a delete or an Undo moves no reading.
- **State (`useStore.ts`):** `deletedDayEvents: Record<string, number>` (event id → deletedAt ms, default `{}`)
  + raw `setDeletedDayEvents` (plain `set`, non-emitting, mirrors `setDeletedMonths`). **Persisted-not-synced**
  (NOT in `partializeState`'s omit → rides the rest; NOT in `SETTINGS_FIELDS`). 90-day GC happens in `mergeRecords`.
- **Raw `setDayLog(events)` FOLDS the Seam-2 derive:** `set((s) => ({ dayLog: events, cbCollateralBtc:
  deriveCbCollateral(events, s.cbCollateralBtc) }))` — NO rollup, NO per-event derive; derives `cbCollateralBtc`
  ONCE from the merged array. The Seam-2 invariant (`dayLog ⇒ cbCollateralBtc`) becomes **structural at the
  setter**, so the hydrate path (`sync.ts`) stays actions-only — it calls `setDayLog`, no `deriveCbCollateral`
  import, no `setState`.
- **`deleteDayEvent` records a tombstone:** the same `set` adds `deletedDayEvents: { ...s.deletedDayEvents,
  [id]: Date.now() }` + `recordsDirty: true`.
- **All THREE dayLog mutators publish explicitly:** `addDayEvent`/`updateDayEvent`/`deleteDayEvent` each set
  `recordsDirty: true` AND call `void publishRecordsNow()` at the end. **Why branch-free:** journal-only events
  (`cbCollateralReading`, `target:'cb'`) have `monthOf===null` → no `rerollMonth` → would otherwise never
  publish (defeating P3). Monthly-meaningful events publish twice (once via `rerollMonth→upsertLogEntry`, once
  here) — harmless (replaceable kind-30078, idempotent merge, equal/higher `created_at` supersedes). Dirty-first
  so a failed immediate publish is retried by `syncNow`.
- **PUBLISH (`publish.ts`):** `RecordsPayload` += `dayLog: DayEvent[]` + `dayLogDeletions: Record<string, number>`
  (REQUIRED — `publishRecordsNow` always sends them; readers default). `ViewerSnapshot` += `cbCollateralBtc?:
  number` (OPTIONAL so the revocation tombstone literal still typechecks). `publishRecordsNow` serializes both
  new fields.
- **HYDRATE (`sync.ts`):** the records block builds a 4-field `remote`/`local` `RecordsState` (legacy bare array
  → `dayLog:[]`/`dayLogDeletions:{}`; object → `?? []`/`?? {}`), a generalized `norm()` that canonicalizes ALL
  FOUR collections (sorts entries by month + dayLog by id + both maps' keys) so a dayLog-only change is detected
  and key-order can't false-dirty, then on change writes back via `setDayLog` (folds the derive) +
  `setDeletedDayEvents`. **LD3 independence:** does NOT recompute `monthlyLog` from `dayLog` — `entries` is the
  synced source for `monthlyLog`, `dayLog` for derived `cbCollateralBtc`.
- **VIEWER BUG2 (the scalar — `buildViewerSnapshotPayload`):** add `cbCollateralBtc:
  deriveCbCollateral(s.dayLog, s.cbCollateralBtc)` as a TOP-LEVEL snapshot key (the viewer never got it before).
  `records` still carries `{ entries, deletions }` only — the viewer gets the **scalar, not the journal**
  (no `dayLog` in the snapshot).
- **VIEWER BUG3 (raw-set — `viewerSync.ts`):** `applyViewerEvent` raw-sets `useStore.setState({ cbCollateralBtc:
  snap.cbCollateralBtc ?? useStore.getState().cbCollateralBtc, strikeCollateralBtc: snap.strikeCollateralBtc ??
  useStore.getState().strikeCollateralBtc })` (C-P4 folds the Strike scalar into the SAME setState) — **MUST NOT**
  use `setCbCollateralBtc`/`emitBalanceReading` (they emit a `cbCollateralReading`/`balanceReading` → would inject
  a spurious event into the VIEWER's own `dayLog`). The viewer's `dayLog` stays `[]`; the `??` fallbacks preserve
  the values for a legacy/pre-P3 (cb) or pre-C-P4 (strike) owner snapshot. The revoked path returns before this
  via `clearViewerData()`.
- **C-P4 (the Strike scalar — mirrors BUG2/BUG3):** `buildViewerSnapshotPayload`'s TRUSTED branch adds
  `strikeCollateralBtc: deriveStrikeCollateral(s.dayLog, s.strikeCollateralBtc)` (the reading-anchored current
  Strike collateral, scalar not journal); the SAFE branch NEVER carries it (privacy audit is `Object.keys`).
  Fixes a real defect: the trusted viewer's `dayLog` is `[]`, so without the scalar its `strikeCollateralBtc`
  cache stayed 0 → `getCurrentBtcHeld()`=0 → wrong (zero-collateral) Strike LTV/liq figures. The viewer sources
  current Strike collateral via `getCurrentBtcHeld` → `deriveStrikeCollateral(dayLog=[], strikeCollateralBtc)` =
  the hydrated cache (no per-entry `btcHeld` chain read for current position), so the raw-set lands in exactly
  what the viewer renders. `ViewerSnapshot.strikeCollateralBtc?` is optional → the revocation tombstone still
  typechecks. **Collateral-Truth Consolidation C-P1→C-P4 is COMPLETE.**

---

## Daily Mode (P4a — read-only view shell + Monthly|Daily toggle; store stays v19)

The first Daily Mode UI surface. **READ-ONLY** — it proves the dayLog/rollup data renders before any writing
UI lands. NO event sheets / `addDayEvent`/`updateDayEvent`/`deleteDayEvent` wiring / FAB (P4b); NO Week|Month
calendar / scrubbing / reconcile / dry-powder readout (P4c).

- **`simpleView: 'dashboard' | 'monthly' | 'daily'`** (store, default `'dashboard'` — Owner IA dashboard-first;
  was `'daily'`) — DEVICE-LOCAL UI pref selecting the consumer-shell view (Dashboard / Daily journal / Monthly
  Playbook). NOT synced (absent from `SETTINGS_FIELDS`/`buildSettingsPayload`); rides `partializeState`'s
  `...rest` (NOT in the omit destructure); **no version bump** — the custom `merge` (`{...current, ...persisted}`)
  fills it for existing users from `current`, so the new default is **migrate-default only** (a persisted choice
  is preserved, never clobbered mid-session). Setter `setSimpleView` is a plain `set` (no `syncSettingsToNostr`),
  mirroring `showPlanStrikeBar`. (Owner IA, see the dedicated section below.)
- **Copy relabel "Simple Mode" → "Monthly Mode"** (copy only; the `simpleMode` store field + all code identifiers
  unchanged): SettingsMain Display row subtitle + the Display-subpage toggle title (one Customization row and page since
  BL15). The AppShell tab-bar button that
  ENTERS the consumer shell (`setSimpleMode(true)`) is relabeled **`aria-label="Switch to simple view"`** (generic —
  the shell now hosts BOTH Monthly and Daily, so "Monthly Mode" there would mislead once toggled to Daily).
- **`DailyModeView`** (`components/Daily/`) — mirrors `SimpleModeView`'s layout/visual language: same header +
  `<SafetyDashboard/>` verbatim + the CURRENT|THIS MONTH(proj)|AFTER position trio (same derivation cluster, skips
  treated as false). Its ACTIVITY CARD lists the current strategy month's `dayLog` (`selectMonthEvents` +
  `describeDayEvent`, both PURE in `dailyView.ts`), empty state "No activity logged this month." A read-only PLAN
  REFERENCE reuses `deriveForMonth` + `composeMonthSummary` (CB row reflects the engine: ltvTriggered shows
  `cbPaydownDraw` under `CB_PAYDOWN_LABEL` — "CB paydown (if you shift debt)", crash playbook Run 3 — monthly shows
  `plan.cbPayment`). Month indicator only — no scrubber. ⚠ Run 2 (the plan of record): the plan reference reads the
  PLAN's month 1 (`usePlanMonth`, the run THIS MONTH reads) — no `deriveForMonth`, `composeMonthSummary` or `runAdvisor`
  on Daily, and no `CB_PAYDOWN_LABEL` row; see the DailyModeView file entry and § The plan of record (Run 2).
- **Daily | Monthly toggle** — a segmented control (`<ViewToggle>` from `src/components/Layout/ViewToggle.tsx`;
  `.viewToggle*` in `ViewToggle.module.css`) bound to `simpleView`; rendered INSIDE each JOURNAL view (DailyModeView +
  SimpleModeView) immediately after its header and before `<SafetyDashboard>` (header → toggle → SafetyDashboard),
  matching the preview layout. `AppShell` passes `simpleView`/`setSimpleView` as props to both views; the toggle
  block was removed from AppShell. Button order: Daily-left, Monthly-right. Consumer shell only — full-app path untouched.
  (Owner IA: this is now JOURNAL's INNER control — it SURVIVES; primary surface navigation is the `HeaderNavCluster`,
  not this toggle. Its `simpleView` prop type is widened to the 3-value union but it still renders only Daily/Monthly.)

### P4a RESTYLE — DailyModeView aligned to `mode-toggle-preview.html`

A presentation-only pass over the read-only Daily surfaces (no data-logic change, no writes; `<SafetyDashboard/>`
+ its `PriceChart` BTC indicator render **verbatim, untouched**). Adopts the preview's visual language while
**reusing app tokens** (preview `--text/--dim/--mute` → `--text-primary/--text-muted/--text-faint`; `--green/
--amber/--red` as-is):
- **New global tokens** (`src/styles/tokens.css`, additive — consumed by DailyModeView AND the AppShell mode-switch,
  so global not local; extends the single token system, doesn't fork it): `--surface`/`--surface-2`/`--surface-3`
  (layered card backgrounds), `--line`/`--line-2` (translucent borders), `--btc` (#f7931a bitcoin accent, distinct
  from `--orange`), `--mono` (mono font stack).
- **Mode-switch pill** (`.viewToggle*`) restyled to the preview `.modeswitch`: `--surface-2` track, raised
  `--surface-3` active, + a green inset ring on the Daily-active button (`.viewToggleBtnDaily`, `rgba(78,203,130,.18)`);
  calendar SVG icons added to both buttons.
- **DailyModeView** restyled: `.appbar` header (plain ₿ brand mark matching Monthly — `font-size:18px; color:var(--orange)`, `.brandName` 16px/700, NO gradient badge; boxed `.iconBtn` buttons); position trio (see below);
  a TWO-PART activity card — (a) `.act-*/.streams` AGGREGATE (net BTC + Draw/Paydown/Buy bars at **actual/plan**
  width, a READ-ONLY rollup of `monthEvents`; interest foot) and (b) per-event `.log-row` LOG (`describeDayEvent`
  label/detail + a component-local `eventTone(kind)` → dot/ring + amount color); a `.pbcard` terminal/playbook PLAN
  REFERENCE. Empty → dashed `.empty`. Standalone month indicator dropped (context moved into act-when + pb-sub).
  Activity log capped at 5 events; "Show more (N more)" / "Show less" toggle (local `logExpanded` state, read-only).
- **Position trio reverted to Monthly format** (cross-view consistency): uppercase labels (CURRENT STRIKE BLOC /
  THIS MONTH / AFTER THIS MONTH), parenthetical USD and LTV amounts on the same line, default UI font (13px), `--orange`
  BTC color — exactly matching SimpleModeView's `.positionRow/.positionCol/.positionStat/.btcAmt/.parenSub` classes
  (replicated into DailyModeView.module.css; SimpleModeView's copies left in the plan of record's Run 3 CSS sweep — the
  Monthly trio had gone in Run 2 — and Daily's stay). The **outer cube containers** use Daily-restyle classes `.posrow` (grid
  wrapper) and `.posbox` (`--surface` bg, `--line` border, 14px radius) — distinct from the content classes
  `.positionTitle/.positionStat/.btcAmt/.parenSub` which stay Monthly-format inside the boxes. The preview-style
  `.posrow/.posbox/.postitle/.posval/.posvalBtc/.possub` block is gone; the new `.posrow/.posbox` are the cube shells only.
  **The trio stays 3-across on mobile in both Monthly and Daily** — the `@media (max-width: 760px) { grid-template-columns: 1fr }` collapse was removed from `DailyModeView.module.css` (both `.posrow` and `.positionRow`) and `SimpleModeView.module.css` (`.positionRow`). On mobile (≤760px), `.parenSub` parenthetical amounts stack below the highlighted amount (`display: block` override in both files — since the plan of record's Run 3, in DailyModeView.module.css only) so the narrow 3-across cubes stay readable; wider screens keep the inline layout.
- **Header parity (polish pass):** Daily `.brandMark` now matches Monthly's plain ₿ (`font-size:18px; color:var(--orange)`, no gradient badge); Daily `.brandName` bumped to 16px/700 to match Monthly. Monthly's `.settingsBtn`/`.modeToggleBtn` restyled to match Daily's boxed `.iconBtn` (34×34, border 1px `var(--line)`, bg `var(--surface)`, `var(--text-muted)` → hover `var(--text-primary)`); `.headerRight` gap bumped 4px → 8px. Daily trio gap equalized: `.cards` `margin-top:13px`→`0` + `gap:13px`→`16px` (SafetyDashboard's own `margin-bottom:16px` is the sole above-gap → both sides 16px).
- **`dailyView.ts` UNCHANGED** — `describeDayEvent` keeps its `{icon,label,detail}` shape (the log-row uses label/
  detail; dot/tone mapping lives in the component); `dailyView.test.ts` unaffected. Still read-only (FAB/add-sheet P4b,
  calendar + drill-down gauge/CB sheets P4c).
- **Position area subsequently replaced with compact trio** (post-P4a): the Monthly-format `.posrow` projection
  boxes were replaced with a single `.trioCard` containing three divided `.trioCell` cells — **Strike BLOC
  collateral** / **Strike BLOC balance** / **Avail credit** — all present-tense live values (collateral →
  balance → available, natural lending progression). Monthly view's projection trio (`SimpleModeView`) is
  unchanged (⚠ Run 2 (the plan of record): the trio is gone — THIS MONTH is one card, `PlanMonthCard`). Projection vars (`eomBtcHeld`, `eomBlocBalance`, `eomLtv`, `availCredit`, `hasPaydown`,
  `projBtcBought`, `projBlocDraw`, `currentBlocLtv`, `expectedPaydown`) were removed from
  `DailyModeView.tsx`; `computeStrikeLtv` import dropped; `currentAvail` stays (trio Cell 3).

---

## Daily Mode (P4b-1 — the write path: FAB + event sheet, ADD only; store stays v19)

The first Daily Mode WRITE surface. A Bitcoin-orange FAB in `DailyModeView` opens ONE adaptive bottom-sheet
(`EventSheet`) for logging a day event. Exercises the P2a store seams on-device for the first time (LD6 atomic
flow+reading, C1 Strike collateral, LD7 CB journal-only). **ADD path only** — edit/delete (D4), tap-to-edit on
log rows = **P4b-2** (not built). Today-only — no date picker; **M3 past-dated backfill → P4c**. No collateral
withdraw (deposit/add only). SafetyDashboard / position trio / Monthly view untouched.

- **`eventSheetModel.ts`** (PURE; named to dodge the macOS case-collision with `EventSheet.tsx`) — `SheetType`
  (`draw|buy|paydown|collateral|setBalance`) + `SheetState` (`type`, `amount: number|null`, `collateralTarget`,
  + five reading fields, LTVs held as **percent** as typed). Two functions: `readingComplete(s, hasCbLoan)` (the
  reading half of the Save gate — Strike Bal/LTV always, +CB Bal/LTV/Collateral iff hasCbLoan) and
  `buildEventsFromSheet(s, hasCbLoan, btcPrice, today, ts, idFn) → DayEvent[]`: `setBalance`→`[balanceReading]`;
  `draw`/`paydown`→`[{flow,amount(USD)}, reading]`; `buy`→`[{buy,amount(BTC),usd:amount*price}, reading]`;
  `collateral`→`[{deposit,amount(BTC),target}, reading]` (target = `hasCbLoan ? collateralTarget : 'strike'`).
  Fresh id per event; **flow + reading share `date`+`ts`** (LD6 atomic). **LTV percent ÷100 → fraction** in the
  reading (`strikeLtv`/`cbLtv` stored as the 0.1483 decimal convention). `reading.price = btcPrice`.
- **`EventSheet.tsx`** (`{open, onClose}`) — `createPortal` → `.scrim`/`.sheet` (mirrors SimpleModeView's confirm
  overlay; scrim onClick closes, sheet stopPropagation; `.grab` handle; title "Log an event" + sub-line
  `adds to {fmtDay(today)} · Month {getCurrentStrategyMonth(advisorStartDate)}`). **D1** type-pills (active =
  `--btc`) + a conditional amount NumberInput (hidden for Set balance; `$` draw/paydown, `₿` decimals 8
  buy/collateral — sat precision) + a REQUIRED "Current balances · required to log" reading section. **D2** Collateral pill:
  a Strike|Coinbase target toggle (viewToggle-style, shown ONLY when hasCbLoan; else forced `'strike'`, no
  toggle); `target:'cb'` → dry-powder readout (`strikeBtcAvailable` + `~$`) + "logged, not modeled (Feature B)"
  note; `target:'strike'` → "Strike held after: {getCurrentBtcHeld()+amount} ₿" + "Updates your Strike
  collateral" note. **D3** Set balance = reading-only (no amount → ONE balanceReading). **Scope-2 orange**:
  active pills + Save = `--btc` (green stays SafetyDashboard's semantic). **Save gate** = `readingComplete` AND
  (`setBalance` || `amount>0`); soft amber `>100%` LTV hint (non-blocking). **All NumberInputs pass `min={0}`**
  (NumberInput's `commit()` only clamps negatives when `min` is given) + `value={x ?? 0}` over null-tracked
  state (NumberInput has no empty render). Save → `buildEventsFromSheet` → `events.forEach(addDayEvent)` (each
  routes/rerolls/publishes independently; the `cb` journal-only event publishes via P3 even though `monthOf`
  is null), reset, onClose. `EventSheet.module.css` alongside.
- **FAB + wiring** (`DailyModeView.tsx`) — a `viewerMode` selector + `sheetOpen` state; a fixed bottom-right
  `+` FAB (`.fab`, `--btc` gradient, `right: max(20px, calc(50vw - 300px + 20px))` to hug the 600px content
  column on wide screens) → `setSheetOpen(true)`; both FAB and EventSheet gated `!viewerMode` (a read-only
  viewer can't write — the NumberInputs self-disable too, but the FAB must not even appear).

---

## Daily Mode (P4c-1a — Week|Month calendar + pure calendarModel; store stays v19)

The FOUNDATION of P4c (day-level granularity). A new `Calendar` renders inside `DailyModeView` between the
position trio (`.posrow`) and the activity card, backed by a new pure `calendarModel.ts`. **RENDER + SELECT
only** — you can toggle Week|Month and pick a day, but the calendar does **NOT yet drive the activity card**
(the card/log stay scoped to the current strategy month exactly as in P4a). Wiring `selectedDay`/`scope`
into the activity card + the month-events modal is **P4c-1b** (a separate later prompt); the backfill /
past-dated FAB is **P4c-2**. `scope`/`selectedDay` are captured in `DailyModeView` state now so P4c-1b can
consume them — nothing reads them yet except `<Calendar/>`.

- **⚠ CRITICAL — the calendar's month range uses `bucketEventToMonth`'s CALENDAR-ANNIVERSARY STRATEGY-month
  definition** (now agreeing with `strategyMonthDate`'s calendar stepping — see the Strategy-Month Calendar
  Fix section), so a day's calendar cell and the events `selectMonthEvents` buckets to that month AGREE.
  `monthDateRange` enumerates a generous day-offset window (±6, sized by the 30.4375 average — a HEURISTIC
  ONLY, not the definition) and KEEPS only dates that bucket to the target month (the fixed
  `bucketEventToMonth` is authoritative + self-corrects boundaries); every returned date round-trips
  `bucketEventToMonth(date,start)===month` (the load-bearing test). `loOffset` is clamped ≥0 —
  `bucketEventToMonth` clamps pre-start days to month 1, so without it month 1 would leak days before
  `advisorStartDate`.
- **Timezone-safe**: `bucketEventToMonth` parses `'yyyy-mm-dd'` via `new Date(iso)` = UTC midnight, so
  `calendarModel` does all date math in UTC (enumerate via `getTime()+N*86400000`, format with
  `toISOString().split('T')[0]`, weekday via `getUTCDay()` — `getDay()` would drift a day in tz-behind-UTC
  locales). `DailyModeView`'s `todayISO()` is likewise UTC.
- **`calendarModel.ts`** (PURE) — `PipKind` ('logged'|'reading'|'cbCollateral') + `DayCell`
  {date,day,weekday(Mon=0..Sun=6),pips}; `monthDateRange` / `weekDates` (7 ISO Mon→Sun) / `buildDayCells`
  (pips: 'logged' any draw/buy/paydown/deposit/withdraw; 'reading' any balanceReading; 'cbCollateral' a
  `deposit target:'cb'`, ADDITIVE to logged). Tested in `__tests__/calendarModel.test.ts` (15 cases —
  bucket round-trip, contiguity, week Mon-first, pip mapping, tz no-drift). Suite 383 → 398.
- **`Calendar.tsx`** (props `{dayLog,advisorStartDate,currentMonth,scope,selectedDay,monthLabel,
  onScopeChange,onSelectDay}`) — `.seg` Week|Month toggle; `.calcard` (title Week→"This week",
  Month→`monthLabel` = `getMonthLabel(advisorStartDate,currentMonth)` passed from the view); Month grid pads
  `leadBlanks` = first cell's weekday so dates align to columns; cells are `<button>`→`onSelectDay`, pips
  `.mG`/`.mRing`/`.mCb`(--btc), selected → `.cellSel` (green-filled num). **LEANER legend** (logged/reading/
  CB collateral; NO scheduled/needs-entry — follow-on). `Calendar.module.css` from preview ~:145-162 (app
  tokens; preview `--blue` pip → `--btc`). **`.seg` toggle styling fix:** the original `.seg button`
  descendant selector wasn't applying (inactive buttons received `className=""` — browser defaults showed
  instead). Fixed with an explicit `.segBtn` class on each button (same pattern as `ViewToggle.tsx`'s
  `.viewToggleBtn`); `.segActive` background is `#232b38` (the preview's exact active-segment color — pops
  against the `--surface-2` track).
- **`DailyModeView`** — added `scope`/`selectedDay` state + `todayISO()`; mounts `<Calendar/>` between
  `.posrow` and the activity `.card`. Activity card/log UNCHANGED. `viewerMode`: calendar renders fine (read-
  only browsing; selecting a day is harmless — no guard); FAB unchanged.

---

## Daily Mode (P4c-1b — calendar drives the activity card + month-events modal; store stays v19)

The calendar now DRIVES the activity card + log (P4c-1a only rendered/selected). **D3:** Week scope (a day
selected) → that day's big-number/streams/foot + the EDITABLE per-event log (P4b-2 tap-to-edit reused);
Month scope → a READ-ONLY summed rollup (month totals + fill vs the monthly plan) + a tappable "from N day
entries" line. **D4:** the Month-scope "from N entries" → `MonthEventsModal` listing the month's individual
events grouped by day (each editable via the P4b-2 sheet; the modal closes when an event opens to edit).
⚠ The plan of record's Run 2.1 (F13): the bars no longer read the day — Week's bars read the CURRENT month so far,
under "Month N so far", and Month's the viewed month's, with no target for a past month (planMonthView's `planBars`).
The day's own head and log are unchanged.

- **`calendarModel.ts`** gains pure builders (+ types `StreamAgg`/`DayActivity`/`MonthRollup`):
  `buildDayActivity(dayLog, date)` (a single date's events + stream sums + netBtc),
  `buildMonthRollup(dayLog, advisorStartDate, month)` (a strategy month's events + totals + `entryCount` =
  distinct dates; filters via `bucketEventToMonth`), `groupEventsByDay(events)` (group by date, groups DESC,
  per-group ts ASC). The shared `aggregateEvents` REPRODUCES DailyModeView's prior inline agg EXACTLY
  (draw/paydown sums, buyBtc sum, netBtc = buys + strike deposits − strike withdrawals; CB-target moves
  journal-only/excluded) — guarded by a buildMonthRollup-equals-old-agg test. Suite 398 → 403. **5c (the rider)
  retired `netBtc`:** `aggregateEvents` returns `moves` (`VenueMoves` { strike, cb, cold }) beside the streams, and the
  card's headline is `streams.buyBtc` (§ Phase 4 → 5c).
- **`DailyModeView`** — the inline `agg`/`monthEvents` memos are replaced by `dayActivity`/`monthRollup`
  memos + `const view = isMonth ? monthRollup : dayActivity`; the activity card reads `view.netBtc/streams` (5c: `streams.buyBtc` + `moves`),
  the log section branches on `scope`. Month scope renders read-only summary rows (Drawn/Bought/Paydown/
  Interest) + the `.entriesBtn` "from N entries" → `setMonthModalOpen(true)`. (FAB targets the selected day
  as of P4c-2.) The Calendar component, its pips, and the date math are UNCHANGED.
- **`MonthEventsModal.tsx`** (+ `.module.css`) — portal scrim/sheet (mirrors EventSheet); `groupEventsByDay`
  → per-day rows (describeDayEvent + a local kind→tone map); rows tappable when `!viewerMode &&
  isEditableKind` → `onEditEvent` (host closes modal, opens the P4b-2 edit sheet). Read-only/non-interactive
  for viewers.

---

## Daily Mode (P4c-2 — past-dated backfill; store stays v19, NO store changes)

The add-sheet can now target the calendar's `selectedDay` instead of always logging to today; past dates make
the balance reading OPTIONAL (the month is marked provisional for later reconciliation), future dates are
blocked. **No store changes** — `rollupMonth` (logUtils.ts:159-165) already carry-forwards prior stocks +
`provisional:true` when a month has flows but no `balanceReading`; this build just lets the UI CREATE such
reading-less events for past dates. The pure helpers (`buildEventsFromSheet`/`readingComplete`) are UNTOUCHED —
the reading-omit is a filter in `handleSave`. Edit mode, today-logging, the calendar, the activity card, the
rollup, SafetyDashboard, and Monthly view are all unaffected.

- **`EventSheet.tsx`** gains `targetDate?: string` (ISO yyyy-mm-dd = the calendar's `selectedDay`; ignored in
  edit mode). Add-mode now derives `effectiveDate = targetDate ?? today` (logs there) + `isPast = !isEdit &&
  effectiveDate < today` (yyyy-mm-dd string compare). The add-mode `month` is computed from `effectiveDate` via
  `bucketEventToMonth` (was `getCurrentStrategyMonth`, now dropped — its only use); the title reads
  `backfilling {fmtDay} · Month N` when past, `adds to {fmtDay} · Month N` otherwise.
- **M3 optional-reading gate (past dates):** the reading section still renders (you CAN fill it if you know the
  past balances) but its label becomes "Current balances · optional for past dates" + a `.note` explains the
  provisional consequence. `canSave` relaxes for past FLOW types only: `((isPast && type !== 'setBalance') ||
  readingComplete(state, hasCbLoan)) && (!showAmount || amountValid) && (!cbCollateralNeedsLiq || cbLiqOk)` — a
  reading-only `setBalance` past event STILL requires the reading (nothing else to write). `handleSave` passes
  `effectiveDate` to `buildEventsFromSheet`, then when `isPast && !readingComplete(...)` filters out the
  `balanceReading` event so only the flow is written → the store marks the month provisional via carry-forward.
  The CB-collateral liq-price write + its `AsOf = todayISO()` stay unchanged (the anchor is "now," not the
  backfill date). **Bugfix (pre-fill):** the open `useEffect` now leaves the five reading fields NULL when
  the target date is past (was: unconditionally seeded from the latest `balanceReading`, making
  `readingComplete()` true → the `handleSave` skip-filter never fired → "skip" silently wrote today's balances
  onto the past date and never marked the month provisional). Empty = skip → provisional; fill = write the
  entered past reading. `targetDate` added to the effect dep array so switching the selected day re-runs the
  branch. Today-logging pre-fill unchanged.
- **`DailyModeView.tsx`** passes `targetDate={selectedDay}` to `<EventSheet>` and disables the FAB when
  `selectedDay > today` (future) with a "Can't log a future date" title; the FAB stays `!viewerMode`-gated, so
  backfill inherits the read-only-viewer block. `DailyModeView.module.css` adds a `.fab:disabled` rule (0.4
  opacity, `not-allowed` cursor, no hover lift).

---

## Daily Mode (P4c-3a — collateral WITHDRAW; store stays v19, NO store changes)

The collateral pill could only DEPOSIT (always emitted `kind:'deposit'`). This build adds a **Deposit|Withdraw
direction toggle** (above the Strike|Coinbase target toggle) so the pill can also remove collateral. **The
store/rollup is UNCHANGED** — the `DayEvent` union already has a `withdraw` kind (`{kind, amount, target}`,
same shape as deposit) and `rollupMonth`'s `collateralDelta` is signed by kind (deposit +, withdraw −), so a
withdraw already flows correctly into `getCurrentBtcHeld()`. This is sheet UI + the pure-helper withdraw
emission + withdraw editability. Builds on P4c-2.

- **`eventSheetModel.ts`** — `SheetState` gains `collateralDir: 'deposit' | 'withdraw'` (only meaningful when
  `type==='collateral'`). `buildEventsFromSheet`'s `'collateral'` case emits `kind: collateralDir==='withdraw'
  ? 'withdraw' : 'deposit'` (amount stays POSITIVE — the store signs it negative in `collateralDelta`; same
  `{amount, target}` shape; `target='strike'` when `!hasCbLoan`). `readingComplete` UNCHANGED.
- **`EventSheet.tsx`** — D1 a `collateralDir` state + a Deposit|Withdraw toggle ABOVE the Strike|Coinbase
  toggle inside the collateral section, ADD-mode only (locked in edit; renders regardless of `hasCbLoan` — you
  can withdraw Strike collateral with no CB loan). D2 direction-aware "Strike held after" readout (`strikeAfter
  = currentBtcHeld − origEffect + dirSign·amount`; the edit-backout `origEffect` is KIND-AWARE — a withdraw
  edit already reduced holdings, so back out `−amount` — the double-count seam, now direction-aware) + a
  `(+x)/(−x)` delta hint. D3 CB coupling BOTH ways: the cb-branch `.note` reframes on withdraw ("Removing
  collateral raises your liquidation price — enter the new value from your Loan Center"); the liq-price field +
  its Save write (`setCbLiquidationPrice`/`AsOf`) already cover both directions (the
  `type==='collateral' && effectiveTarget==='cb'` gate is direction-agnostic). D4 withdraw is now EDITABLE:
  `isEditableKind` includes `'withdraw'`; the edit-prefill + `handleSave` edit path each gain a `'withdraw'`
  case mirroring `'deposit'`; `canSave`'s deposit branch + the cb re-anchor broadened to
  `(kind==='deposit' || kind==='withdraw')`. The `amountLabel` reads "Collateral removed (BTC)" on withdraw.
  D5 a SOFT, non-blocking LTV warning (`.warnNote`, amber): on a withdraw a conservative post-withdraw LTV
  estimate (Strike → `advisorActualBlocBalance / ((currentBtcHeld − amt)×price)`, warn >0.5; CB →
  `cbLoanBalance / ((cbCollateralBtc − amt)×price)`, warn >0.6) shows "approaching your limit" but NEVER gates
  `canSave`. `EventSheet.module.css` adds `.warnNote`.

---

## Daily Mode (P4c-3b — reconcile → Review → confirm flow; store stays v19, NO store changes)

Daily months carry two ORTHOGONAL flags (set by the store/rollup): `confirmed` (user signed off — undefined on
legacy ⇒ treated true) and `provisional` (stocks are carry-forward estimates because a logged day had no
balance reading). This build surfaces them: a Month-scope reconcile **banner** + a **Review sheet** so the
owner can sign off. **`confirmMonth`/rollup/store UNCHANGED** — `confirmMonth(month)` (useStore.ts:999) spreads
the existing entry + `confirmed:true` and **preserves `provisional`**; a real `balanceReading` clears
`provisional` independently via the rollup (before OR after confirm).

- **Orthogonal-flags model:** confirming does NOT clear provisional; a reading does. So a provisional month can
  be confirmed-as-provisional (honest sign-off when the past reading is unavailable) and later upgraded by
  adding a reading. Editing a confirmed month flips `confirmed→false` (LD4 reopen-on-edit, already built) → the
  banner reappears — except a dollars-only buy edit (5d), which rewrites Income → BTC alone. Correct, left as-is.
  **The reading half is now true:** `rollupMonth`'s reading branch emits
  `provisional: false` explicitly, so a reading clears a stored `true` on the next re-roll. ⚠ **`sameRollupFields`
  deliberately does NOT compare `provisional`** — it is a data-quality label, not a figure a sign-off attests, and
  comparing it made a joining device's one-shot reconcile re-roll (and un-sign) every month whose flag differed
  (legacy `undefined` vs `false`, or a stale `true`). Never restore the compare, strict or `?? false`. Accepted cost: a
  stale flag stays until the month's next natural re-roll, and that re-roll also un-signs it (LD4). No one-shot sweep —
  a second device-local one-shot is exactly what carried the hazard to new devices.
- **Banner rule (the subtle one):** show iff the current month's entry is **unconfirmed** (`confirmed ===
  false`; `needsReview = needsConfirm`). Copy branches on `provisional`. So confirm-as-provisional (sets
  `confirmed:true`) removes the banner even though provisional persists — a confirmed-but-provisional month is
  "done" from the user's view (the flag lives on as data-quality metadata, not a nag). A month with no entry
  yet → no banner.
- **`EventSheet.tsx`** gains an optional `initialType?: SheetType` prop — the add-mode open-effect uses
  `setType(initialType ?? 'draw')` (added to its dep array). So the Review's "Add balance reading" path opens
  the sheet directly in `setBalance` mode. Omitted ⇒ unchanged (the FAB still opens to 'draw'; it now also
  resets `sheetInitialType` to undefined).
- **`DailyModeView.tsx`** — derives `currentEntry`/`needsConfirm`/`isProvisional`/`needsReview`; renders the
  banner (`.reconcileBanner`, amber) after `<Calendar/>`, **gated `isMonth && !viewerMode && needsReview`**
  (Week scope + viewers show none). Copy: provisional → "Month N needs a balance reading"; clean → "Month N —
  confirm your log". "Review" → opens `<ReviewSheet>`. New state `reviewOpen` + `sheetInitialType`; the
  Add-reading path sets `setSheetInitialType('setBalance')` + opens the EventSheet.
- **`ReviewSheet.tsx`** (+ `.module.css`, NEW) — `createPortal` scrim/sheet mirroring `MonthEventsModal`; pure
  presentation (props `{open, month, rollup, isProvisional, onClose, onConfirm, onAddReading}`). Shows the
  rolled-up totals (Drawn/Bought/Paydown/Net + "from N day entries" from `MonthRollup`) + a "why review" note;
  actions branch: provisional → **Add balance reading** (→ EventSheet setBalance → a reading clears provisional
  via the rollup) + **Confirm as provisional** (→ `confirmMonth`, honest subtext "balances stay estimated, add
  later") + Cancel; clean → single **Confirm** + Cancel.

### P4c-3b-ii — past-month navigation in the Daily ledger (Month scope)

The Daily Month scope only showed the CURRENT month, so a passed unconfirmed/provisional month was
unreachable for reconcile. A `viewedMonth` state (`DailyModeView`, default + reset to `currentMonth`, clamped
`1…currentMonth` via `safeViewedMonth`) + ‹ › nav lets the **ledger** reach past months. **Conceptual split
(load-bearing):** Daily = the LEDGER (what happened + reconcile) → the calendar grid, activity rollup, "Month N
rollup", reconcile banner (+ its `viewedEntry` lookup), `MonthEventsModal`, and `ReviewSheet`/`confirmMonth`
all key off `safeViewedMonth`; Monthly = the PLANNER → the **PLAN reference card + the advisor projection
(`deriveAdvisorStart`/`advisorRows`/`currentRow`/`summaryText`) stay `currentMonth`** (the plan is about now,
not the viewed past month). ⚠ Run 2 (the plan of record): the reference card is the plan's month 1 (`usePlanMonth`)
— still the current month — and Daily's "Interest capitalized" shows only for it; the advisor projection left Daily
in the same run (no `runAdvisor` there since). The ‹ › nav lives in the `Calendar` title row (new optional props
`onPrevMonth`/`onNextMonth`/`canPrevMonth`/`canNextMonth` → `.calNav`/`.calNavBtn`/`.calNavLabel`; the title
owns the label, no duplicate) — the Calendar **date math is unchanged** (it receives `safeViewedMonth` through
its existing `currentMonth` prop). Buttons disable at the bounds (‹ at Month 1, › at the current month).
**Week scope unaffected** (about specific days); entering Month scope resets `viewedMonth` to `currentMonth`
(`useEffect` on `scope`/`currentMonth`). The **FAB still logs to today/`selectedDay`** (backfill INTO a viewed
past month is not wired this phase). ⚠ The ReviewSheet's **"Add balance reading" is the exception**: it targets
`readingTargetDate(selectedDay, advisorStartDate, safeViewedMonth, today)` (`calendarModel.ts`, pure) — `selectedDay`
when it is inside the reviewed month, else that month's last day ≤ today — because ‹ › moves `viewedMonth`, never
`selectedDay`, and a reading added while reviewing a past month used to land in the current one. Store / `buildMonthRollup` / `confirmMonth` / Monthly view unchanged.

### P4c-3c — CB-section enrichment in SafetyDashboard (factual fix)

`SafetyDashboard`'s CB bar card rendered a factually-WRONG warning — "Morpho liquidates instantly — no
margin-call window" — contradicting the code's own model (`runCoinbaseLoan.ts` `classifyLtv`: `ltv<0.65 →
watch`, `0.65–0.70 → warning`, liquidation at `CB_LLTV=0.86`). **SURGICAL CB-bar-card-only** (Strike bar, all
bar math `cbMetrics`/`cbLevel`/`cbFillPct`/markers, the `cushionRow`, freshness rows, setup card —
UNTOUCHED; display-only reads, no computed value changed):
- **Removed** the false `graceNote` AND the now-redundant `priceNote` (the headline carries the liq price); the
  orphaned `liqSource` local was dropped (`noUnusedLocals`).
- **Added** a distance-to-liquidation headline (`.cbDistance`) — "$X above liquidation · a Y% drop away from
  $Z liquidation price" — computed from `btcPrice`/`activeLiqPrice` (`liqDropUsd`/`liqDropPct`), color-coded by
  `cbFillColor` (same green/amber/red as the bar), gated `activeLiqPrice > 0`.
- **Added** a 2-row detail block (`.cbDetail`): "CB loan balance" = `fmtUSD(accruedBalance)`; "Warn ·
  liquidate" = `65%` (amber) `· 86%`. Exactly two rows — no LTV row (on the bar), no liq-price row (headline),
  no rate row (edit box), no source tag.
- New `export const CB_WARN_LTV = 0.65` in `runCoinbaseLoan.ts` (also de-magics `classifyLtv`'s watch
  boundary; behavior-identical). Renders in BOTH Monthly + Daily (shared dashboard).
- **Post-3c relocation:** the `.cbDistance` headline and `.cbDetail` block were moved from always-visible
  (between `cushionRow` and the freshness rows) INTO the `editing &&` tap-to-edit expansion — at the top, before
  "Read both from your Coinbase Loan Center" + the editable fields. At rest the CB card shows only bar +
  cushionRow + freshness (minimal); tapping reveals the distance context + detail + inputs.

### SafetyDashboard minimalist tidy (Option 1, display-only)

A presentation-only pass over the two bars — **no computed value / handler / edit-box content changed**
(byte-for-byte: all bar math, `cbMetrics`/`barLevel`/`computeStrikeLtv`, fills, markers, the state line,
priceSlot, drafts, `flipStrike`/`openStrikeEdit`/`toggleEdit`/`saveStrike`/`saveReanchor`). Only bar ORDER,
caption distillation, and always-visible-vs-expansion placement moved. Renders in BOTH Monthly + Daily.
- **Bar order SWAPPED** — Strike is now the PRIMARY (top) bar, Coinbase secondary (below): `stateLine →
  priceSlot → Strike barCard → CB (hasCbLoan ? barCard : setupCard)`.
- **Each bar distilled to a clean glance:** name + headline value + status pill + bar + ONE caption +
  a compact affordance.
- **Strike:** keeps its capacity⇄liquidation body-tap FLIP + the `edit` link. Header gains a grouped left
  side (`.barHeaderLeft`: label + `.barValue` headline `"X% used"`/`"X.X% LTV"` + a `.badge` colored by
  `LEVEL_COLOR[strikeLevel]`, text Safe/Fair/Poor). The wordy header flip hint is replaced by a compact
  `⇄ liquidation`/`⇄ capacity` (`.flipHint`) sitting on the RIGHT of the cushion row; the per-view caption
  (`.ltvNow`) is unchanged. Strike edit box unchanged (no freshness clutter → nothing moved into it).
- **Coinbase:** keeps its tap-to-expand. Header gains `.barHeaderLeft` (label + `.barValue` `"X.X% LTV"` +
  the `cbBadge`/`cbFillColor` badge) + a `.chevron` `›` expand affordance; the small "tap to update" hint
  stays. The two-part cushion row collapsed to a SINGLE distilled `.cushion` caption `"X.X% to liquidation"`
  (the price-drop framing already lives in the expansion's `cbDistance`); the dead `ltvGapToTrigger` local
  was removed. The `!neverAnchored` `freshRow` + `staleWarn` MOVED into the `editing &&` editBox (top, above
  `cbDistance`), keeping their exact gates; the `neverAnchored` `anchorNudge` stays at the glance (first-time
  setup). CB edit-box contents otherwise unchanged.
- **CSS (additive):** `.barHeaderLeft`/`.barValue`/`.chevron` in `SafetyDashboard.module.css`; captions reuse
  `.cushionRow`/`.cushion`/`.ltvNow`, flip hint reuses `.flipHint`, badge `.badge`, edit `.editLink`.

### SafetyDashboard structural minimalism (display-only — matches preview)

A second presentation-only pass on top of Option 1 — **no computed value / handler / edit-box content
changed** (one read-only local added). Merges the loose stack into a single card matching the preview:
- **Verdict → eyebrow:** the standalone `.stateLine`/`.stateDot` were removed; the verdict now renders as a
  `.eyebrow` card title — a muted mono `.eyebrowLabel` "SAFETY ·" + a `.eyebrowVerdict` (state-colored via
  `LEVEL_COLOR[state]`, natural case). `stateCopy`'s three strings lost their trailing period (CONDITIONS
  unchanged).
- **Two cards → one:** the two bordered `.barCard`s merged into ONE inner `.safetyCard` (border + bg-card +
  radius 12px); the bars are now borderless `.barRow`s separated by a single `.barDiv` hairline (between
  Strike and CB only). `.dashboard` stays the OUTER flex container; **`priceSlot` (the price chart) stays a
  sibling ABOVE `.safetyCard`** (chart on top, then the safety card titled by the eyebrow). Expansions open
  inline within the card (children of each `barRow`).
- **Tightened:** CB's standalone "tap to update" `.flipHint` line was dropped (the `›` chevron in the header
  is the affordance); Strike keeps its `⇄ liquidation/capacity` flip hint on the cushion row + the `edit`
  link.
- **Captions enriched (TEXT only):** Strike capacity → "X% of credit line used · avail $Y" (avail =
  `creditLine − advisorActualBlocBalance`, the matching remaining capacity — NOT the collateral-capped
  `strikeAvailableCredit`); Strike liquidation → "X.X% LTV · liq Y% · 80% crash → Z%" where `crashLtv =
  computeStrikeLtv(advisorActualBlocBalance, currentBtcHeld, btcPrice * 0.2)` (the ONE new read-only
  value — feeds nothing else); CB → "$X above liq · Y% drop away" (short form; the full "…from $Z
  liquidation price" stays in the expansion's `cbDistance`). The now-dead `ltvGapToLiq` local was removed.
- **Polish:** `.markerLabelRight` `transform: translateX(0)` → `translateX(-4px)` so the "85% liq"/"86%"
  edge labels sit fully inside the card.
- **CSS (additive + one fix):** `.safetyCard`/`.barRow`/`.barDiv`/`.eyebrow`/`.eyebrowLabel`/
  `.eyebrowVerdict` added; `.markerLabelRight` nudged; `.barCard`/`.stateLine`/`.stateDot` left orphaned
  (harmless). All bar math / flip / expand / edit logic byte-for-byte; renders in both Monthly + Daily.

### Daily view spacing + card-radius polish (CSS-only — matches preview)

Pure CSS pass — no JSX, no logic, no new classes. Six values updated across three files:
- **`ViewToggle.module.css`** — `.viewToggleWrap` gains `margin-bottom: 14px` (was `0`) → fixes the
  cramped toggle→chart gap; matches the preview's `.modeswitch { margin: 15px 0 14px }`.
- **`SafetyDashboard.module.css`** — `.dashboard` `gap` 12→**13px**, `margin-bottom` 16→**13px**;
  `.safetyCard` `border-radius` 12→**20px** (matches the preview's `.card` and the activity card).
- **`DailyModeView.module.css`** — `.cards` `gap` 16→**13px** (the main rhythm fix); `.trioCard`
  `border-radius` 14→**20px** (matching the activity card and the preview's `.card`).
- **`Calendar.module.css`** — NO CHANGES (`.calcard` already 18px, `.segBtn` padding already 8px —
  both preview-matched). Monthly-format classes and the activity card (already 20px) unchanged.

### ViewToggle width fix (CSS-only)

`.viewToggleWrap` dropped its redundant `max-width`/`width: 100%`/`padding: 0 16px` (now just
`margin: 12px 0 14px`). `ViewToggle` renders inside `.content` which already provides `max-width:
600px` + `padding: 0 16px`; the duplicated properties caused the toggle to be 32px narrower than every
section below it (double 16px inset vs. single). Fix applies to both Daily and Monthly views (shared
component). No JSX, no logic, no other CSS changed.

### Monthly view spacing + card-radius polish (CSS-only — matches preview + Daily fix)

`SimpleModeView.module.css` — four values only: `.segmentControl margin-bottom` 4px→13px (fixes the
"This Month / Outlook" toggle cramped against the trio — the toggle and its rules left in the plan of record's Run 3); `.cards gap` 12px→13px; `.card` and
`.positionCol border-radius` →20px (matches the preview's `.card` and Daily's `.trioCard`). Orange
toggle style (`.segmentBtn`/`.segmentBtnActive`) unchanged; modal (`.modalCard`) and confirm-sheet
(`.confirmSheet`) radii unchanged. No JSX, no logic, no other CSS changed.

---

