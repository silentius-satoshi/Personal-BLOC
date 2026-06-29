# CLAUDE.md — Personal ₿LOC

## Project Overview

React + Vite + TypeScript PWA modeling Bitcoin accumulation strategies using Strike's Bitcoin Line of Credit (BLOC). Eight tabs: **Living on Bitcoin**, **Smart BLOC**, **Power Law**, **Sats**, **Miners**, **CB Loan** (hidden by default), **Advisor** (hidden by default), and **Settings** (not a tab — accessible via branding dropdown).

Deployed to Vercel.

---

## Tech Stack

- React 18 + Vite + TypeScript
- Zustand (global store) + `persist` middleware → localStorage key `'personal-bloc-store'`
- Recharts (charts)
- CSS Modules
- Vitest (398 tests — all must pass before every commit)
- Vercel (deployment + serverless proxy for Power Law data)
- @dnd-kit/core + @dnd-kit/sortable + @dnd-kit/utilities (drag-and-drop tab reordering)
- PWA: `public/manifest.json` + `public/sw.js` (network-first service worker)

---

## File Structure

```
src/
  simulation/
    types.ts                    # SimInputs (optional creditLine), LivingInputs, StrategyResult, MonthlyLogEntry,
                                # DayEvent (Daily Mode P1 union) + source?/confirmed?/provisional? on MonthlyLogEntry
    livingUtils.ts              # getBtcPrice (8-param, bear market aware)
    powerLaw.ts                 # PL_B, PL_A_FAIR, PL_A_FLOOR, PL_A_CEILING, GENESIS + utils
    runNoBitcoin.ts
    runSellToLive.ts
    runSmartBLOC_Living.ts      # Living on Bitcoin tab simulation
    runMaxLeverage.ts
    runBLOC.ts                  # Smart BLOC 5-year simulation (respects creditLine ?? Infinity)
    runBlocYearOne.ts           # Month-by-Month 12-month simulation + getCollateralForTier
    runCoinbaseLoan.ts          # CB Loan simulation + classifyLtv + CbLtvStatus + CB_LLTV/CB_LIF + computeLiquidationAnalysis
    cbMetrics.ts                # SHARED CB LTV/liq-price source of truth: cbMetrics, accruedCbBalance,
                                # barLevel/worseLevel (Safe/Watch/Act). Consumed by SafetyDashboard +
                                # CoinbaseLoanMain/Sidebar (inline formulas removed). Imports CB_LLTV from runCoinbaseLoan
    runAdvisor.ts               # Advisor simulation + tier helpers + strategy month calc
    strikeCredit.ts             # STRIKE_MAX_DRAW_LTV (0.50), strikeAvailableCredit = min(line, collateral×50%) − drawn, computeStrikeLtv(bloc, btcHeld, price) (shared by SimpleModeView headline + SafetyDashboard Strike bar)
    logUtils.ts                 # recomputeBtcHeld (chains btcBought + collateralAdjustment), deriveAdvisorStart,
                                # deriveCurrentPosition (both take pendingCollateralAdjustment as a REQUIRED param),
                                # upsertEntry — standalone, no cross-sim imports. Daily Mode P1: bucketEventToMonth
                                # (date→strategy-month 1–12, replicates getCurrentStrategyMonth's formula with the event
                                # date — kept inline so logUtils stays import-standalone) + rollupMonth (DayEvent[] →
                                # { entry: Partial<MonthlyLogEntry>, collateralDelta }) + deriveCbCollateral (P2a:
                                # latest cbCollateral-bearing event by ts across balanceReading + cbCollateralReading,
                                # fallback to the cache — never undefined)
    mergeRecords.ts             # PURE records merge (RecordsState = entries+deletions+dayLog+dayLogDeletions, mergeRecords).
                                # Per-month entries: newest updatedAt/loggedAt wins, tombstones, 90-day GC. P3: dayLog
                                # union-by-id (higher ts wins, exact tie→local) + dayLogDeletions tombstone suppression
                                # (strict >, edit-after-delete drops the stale tombstone, 90-day GC); deterministic sort by ts,id
    __tests__/
      smartBloc.test.ts
      living.test.ts
      mining.test.ts
      monthlyLog.test.ts
      aprAnchors.test.ts
      strikeCredit.test.ts

  hooks/
    useBtcPrice.ts              # Coinbase API, 60s interval; syncs store on every fetch (gated by btcPriceMode); returns isStale (5-min threshold, 30s self-tick). Each store push goes through setBtcPrice, which now ALSO stamps btcPriceUpdatedAt (per-device staleness clock — DevPanel readout). Poll gated on the now-self-correcting usePageVisibility. MOUNTED AT AppShell ROOT so the poll runs for the whole session (Simple Mode mounts no price-consuming sidebar — without this, btcPrice froze at its last persisted value in Simple Mode); per-tab sidebar calls remain (harmless co-mounts)
    usePageVisibility.ts        # !document.hidden, SELF-CORRECTING (iOS-PWA resume fix): updates on visibilitychange + window focus/pageshow + a 20s interval re-read (one shared sync = setIsVisible(!document.hidden); the primitive bail-out adds no re-renders). visibilitychange ALONE misfires on iOS PWA launch/resume → isVisible could stick false → consumer polls (useBtcPrice/useBtcHistory) died forever; the extra signals recover it. Still genuinely pauses when backgrounded (NOT hardcoded true)
    useBtcHistory.ts            # BTC candle history (1H/1D/1W) via same-origin /api/btc-candles proxy; usePageVisibility gate + slow 60s refresh (NOT a tight poll); ephemeral, NEVER written to store; pure parseCandles (Coinbase [t,low,high,open,close,vol] newest-first → asc close series, s→ms) + RANGE_CFG
    useSimulation.ts            # Smart BLOC tab simulation hook
    useLivingSimulation.ts      # Living on Bitcoin tab hook
    usePowerLawData.ts          # Blockchain.com historical price (via Vercel proxy in prod)
    useMempoolData.ts           # mempool.space block height (halving computed from it)
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
                                # settingsPage==='network' ? nostrRelays : EMPTY_RELAYS — no sockets unless viewing it)

  store/
    useStore.ts                 # Zustand store — all state, persisted to localStorage

  utils/
    format.ts                   # fmtUSD, fmtMining (sats-aware)

  components/
    Layout/
      AppShell.tsx              # ALL_TABS_META array, tab bar DndContext, sidebar/main routing,
                                # hiddenTabs guard useEffect, [data-active-tab] on shell div;
                                # passes simpleView/setSimpleView as props to DailyModeView/SimpleModeView
                                # (ViewToggle lives inside each view, not here)
      AppShell.module.css
      ViewToggle.tsx            # Shared Daily|Monthly segmented-control pill — rendered inside BOTH
                                # DailyModeView and SimpleModeView (between header + SafetyDashboard).
                                # Props: simpleView + setSimpleView. CSS in ViewToggle.module.css.
      ViewToggle.module.css     # .viewToggle* rules (moved from AppShell.module.css)

    Tools/
      LiqSimulator.tsx          # Liq Price Simulator overlay content; reads store directly, no props
      LiqSimulator.module.css

    ui/
      SliderInput.tsx           # Stacked: label → value → slider → min/max
      NumberInput.tsx           # prefix/suffix/decimals props (avoid suffix inside input)
      Toggle.tsx
      ScenarioPills.tsx
      GrowthPresetPills.tsx
      LtvTypePills.tsx

    Inputs/
      InputsPanel.tsx           # Smart BLOC sidebar — .scrollArea + sticky .recommendations
      InputsPanel.module.css

    Settings/
      SettingsMain.tsx          # PHASE 1 NAVIGATION SHELL — an iOS-style section MENU (rows) that drills into
                                # dedicated SUBPAGES, driven by a LOCAL `settingsPage` state (NOT the store/activeTab):
                                # 'menu' | 'identity' | 'sharing' | 'strike' | 'cbloan' | 'display' | 'tabs' | 'about'.
                                # Menu view = header (when !hideHeader → ← Back to app) + the section rows (SettingsRow
                                # helper: glyph icon + title + subtitle + chevron). Subpage view = a .subHeader (← Settings
                                # → menu + SUBPAGE_TITLES[page]) then that section's content. Split A (controls moved
                                # VERBATIM — same handlers/selectors/hooks, only relocated): identity = NOSTR IDENTITY
                                # (Enable-Nostr-Lock toggle + identity row + sync + recovery + decrypt-back); sharing =
                                # VIEWER ACCESS (pulled out of the shared Nostr section; topped by the owner's OWN npub
                                # truncated + "Copy your npub" button — reuses existing npubCopied/npubEncode logic —
                                # so the owner can hand their npub to the viewer without navigating to Identity);
                                # strike = BUDGET + STRIKE BLOC
                                # inputs (+ a READ-ONLY "Strike API · Connected/Not connected" status row at the top of
                                # STRIKE BLOC, mirroring the derived strikeApiConnected — no connect/key UI; the Strike
                                # key is server-side + NIP-98-signed); cbloan = COINBASE LOAN details (P2b: when
                                # cbPaymentStrategy === 'ltvTriggered', an ACTION AT TRIGGER sub-toggle — Paydown | Add
                                # collateral — wires cbLtvAction; sub-toggle first, then the three threshold NumberInputs;
                                # middle label flexes ('Pay down to LTV' / 'Reduce to LTV'); a fieldHint warns
                                # add-collateral shapes logging/guidance only — Outlook projection still models paydown);
                                # display = Simple Mode toggle + plan-bar toggles +
                                # mining-in-log; tabs = TAB VISIBILITY & ORDER + DnD; network = RELAY LIST mgmt (P1:
                                # view/add/remove/restore the local nostrRelays via addRelay+normalizeRelayUrl; P3 (DONE):
                                # each row's dot is a LIVE connection status (green/amber/red) via useRelayStatus. P2 (DONE):
                                # the SYNC group's Import-from-Nostr
                                # (window.confirm → importRelaysFromNip65 → message by found/empty/not-found; replaces
                                # the local list only on a real found list) + Publish-to-Nostr (publishRelayListToNip65,
                                # no confirm) are LIVE; relaySyncBusy 'idle'|'import'|'publish' disables both + busy
                                # labels, relaySyncMsg in a .fieldHint); about = build-tap row + DevPanel.
                                # GATING PRESERVED: identity/sharing/strike/cbloan/tabs rows stay !viewerMode (display/about
                                # always) — viewer visibility is unchanged from before (the zero-risk reading of the spec's
                                # "always" table). The ONE behavioral change: the `hasCbLoan` toggle moved OUT of the subpage
                                # ONTO a persistent Coinbase Loan menu row — off → row dimmed (.settingsRowDisabled), no
                                # chevron, body not tappable (only the toggle, stopPropagation so it doesn't navigate); on →
                                # tappable → cbloan subpage; a useEffect bounces 'cbloan'→'menu' if the loan is turned off
                                # while there. simpleMode embed (hideHeader): menu omits the app-back button, subpages still
                                # render their ← Settings sub-header. AUTH UNTOUCHED (NOSTR IDENTITY verbatim — Phase 2 will
                                # rework it). Still owns the local ALL_TABS constant + 5-tap devMode build row
      SettingsMain.module.css   # + Phase 1: .settingsMenu/.settingsRow(+Disabled/Icon/Body/Title/Subtitle/Toggle/Chevron)
                                # + .subHeader/.subBackBtn/.subTitle (theme tokens; additive — no existing class changed).
                                # + Phase 1 polish: .setupDateInput gains box-sizing:border-box + min-width:0 +
                                # -webkit-appearance/appearance:none (fixes iOS native date-control overflow; keeps
                                # color-scheme:dark) + read-only .strikeStatusRow/.strikeStatusLabel/.strikeStatusDotOn
                                # (green glow) /.strikeStatusDotOff (var(--text-faint), mirrors InputsPanel's strike dot)
      DevPanel.tsx              # Dev diagnostics (devMode only): sync state, COLLATERAL (baseline/pending/
                                # current — ON-DEVICE only), signer probe, Nostr log ring, copy-diagnostics,
                                # AT-REST ENCRYPTION (3a.5: flag/blob-state/key-in-memory/GATE_* readout + an
                                # ASYMMETRIC flag toggle that reloads — Enable RAW, Disable decrypts-first; dev tooling).
                                # Copy Diagnostics + log ring stay METADATA-ONLY (pendingNonZero boolean,
                                # never balances/amounts/log contents); the panel itself may show position figures.
                                # SYNC STATE grid also carries a BTC-PRICE-AGE row (store price + "Ns/Nm ago", ⚠ stale
                                # >5min, from btcPriceUpdatedAt; 5s now-tick so a dead poll's age climbs visibly) —
                                # DevPanel-ONLY, rendered in JSX not the syncState object (kept out of Copy Diagnostics)
      DevPanel.module.css

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
      PowerLawMain.tsx
      PowerLawChart.tsx         # Recharts log-log, YAxis scale="log"
      PowerLawSidebar.tsx

    Converter/
      ConverterMain.tsx
      ConverterSidebar.tsx

    Mining/
      MiningMain.tsx
      MiningMain.module.css
      MiningInputsPanel.tsx     # Per-device: hashrate, pool name, pool fee, solo toggle
      MiningProjectionTable.tsx # SAT ACCUMULATION scrubber + IF BTC REACHES + IF YOU FIND A BLOCK
      MiningOddsBar.tsx         # Reads devices from store directly

    CoinbaseLoan/
      CoinbaseLoanMain.tsx      # 7 sections: header, emergency banner, stat cards, LTV bar,
                                # alert thresholds, liquidation modeler, 12-month projection,
                                # emergency protocol, Strike vs Coinbase comparison
      CoinbaseLoanMain.module.css
      CoinbaseLoanSidebar.tsx
      CoinbaseLoanSidebar.module.css
      LiquidationModeler.tsx    # 4-scenario liquidation math; gated by cbLiquidationPrice > 0
      LiquidationModeler.module.css

    Advisor/
      AdvisorMain.tsx           # Progress bar, position cards, This Month's Plan (Pay/Skip),
                                # MonthlyLogSection, <OutlookProjection>. Its OWN runAdvisor call is the
                                # FLAT operating plan (drives This Month's Plan + carousel + overlay);
                                # the scenario projection is the separate OutlookProjection call
      AdvisorMain.module.css
      OutlookProjection.tsx     # SHARED scenario projection (bear/flat/powerlaw/bull table) — owns the
                                # growthScenario picker + scenario→rate + its OWN runAdvisor; rendered by
                                # BOTH AdvisorMain (Section 4) and Simple Mode's Outlook segment. Starting
                                # position arrives as props (each host threads pending via deriveAdvisorStart).
                                # Imports AdvisorMain.module.css for styling. In ltvTriggered CB mode the CB
                                # columns go QUIET between triggers: CB LTV muted (.muted) on non-trigger
                                # months, amber (.triggerCell) on the fired month, + a faint amber row wash
                                # (.rowTrigger); CB Paydown cell already muted-between-triggers. monthly mode
                                # unchanged (CB-every-month, tier-colored CB LTV). Reflects the engine's
                                # event-driven CB (cbTotalPayment=0; paydown only at cbLtvTriggerPct).
                                # A LEGEND sits beneath the table (.projLegend, shared → both Advisor tab
                                # and Simple Mode Outlook): always shows tier pills (T1 red → T4 green) +
                                # NOW; CB signal entries (amber forward paydown, green ↩ rotation, ⚠ capped,
                                # amber row-wash swatch) gated on hasCbLoan && cbPaymentStrategy ===
                                # 'ltvTriggered' (Option B). Swatches reuse the table's own classes so
                                # colors never drift; only the layout wrappers are new
      AdvisorSidebar.tsx        # BTC LIVE badge, YOUR PROGRESS (start date, BLOC balance,
                                # BTC held), read-only summaries, priority rules
      AdvisorSidebar.module.css
      MonthlyLogSection.tsx     # Horizontal carousel + detail panel (full mode)
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
                                # SINGLE-COLUMN (1fr) so long decimals fit; .viewGrid is a label/value column
      MonthlyLogOverlay.module.css

    Daily/
      DailyModeView.tsx         # Daily Mode P4a — READ-ONLY day-level consumer view, presentation aligned to
                                # mode-toggle-preview.html's visible Daily panel. Same data as SimpleModeView (header +
                                # <SafetyDashboard/> VERBATIM + position trio CURRENT|THIS MONTH(proj)|AFTER, same
                                # deriveAdvisorStart→runAdvisor→computeStrikeLtv/strikeAvailableCredit cluster, advisorSkip*
                                # treated false — P4a has no Pay/Skip). RESTYLED to the preview: .appbar header (gradient
                                # brand badge + boxed .iconBtn); .posrow/.posbox divided trio (mono nums, --btc accent);
                                # a TWO-PART ACTIVITY card — (a) AGGREGATE .act-*/.streams: net BTC + Draw/Paydown/Buy bars
                                # whose width = actual/plan (READ-ONLY rollup of this month's dayLog via a local agg over
                                # selectMonthEvents; NO writes/new reads) + interest foot, (b) per-event .log-row LOG
                                # (describeDayEvent label/detail + a component-local eventTone(kind)→dot/ring + amt color);
                                # and a .pbcard terminal/playbook PLAN REFERENCE (deriveForMonth + composeMonthSummary).
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
                                # withdraw carry target; balanceReading summarizes Strike + CB). Tested in __tests__/dailyView.test.ts
      calendarModel.ts          # Daily Mode P4c-1a — PURE calendar date model (no store/UI/price dep; imports only the pure
                                # bucketEventToMonth + DayEvent type, mirroring dailyView.ts). monthDateRange(advisorStartDate,
                                # month) = ascending ISO dates that bucket to that STRATEGY month (uses bucketEventToMonth's
                                # 30.4375-day def — NOT strategyMonthDate's calendar-month stepping — so cells + bucketed events
                                # AGREE; loOffset clamped ≥0 so month 1 begins exactly at start, since bucket clamps pre-start
                                # days to month 1); weekDates(selectedDay) = 7 ISO Mon→Sun; buildDayCells(dayLog, dates) →
                                # DayCell{date,day,weekday(Mon=0),pips} (pips: 'logged' any draw/buy/paydown/deposit/withdraw;
                                # 'reading' any balanceReading; 'cbCollateral' a deposit target:'cb', ADDITIVE to logged). ALL
                                # date math UTC (new Date(iso)=UTC midnight; getUTCDay, not getDay → tz-safe). Tested in
                                # __tests__/calendarModel.test.ts (every monthDateRange date buckets back to its month — load-bearing)
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
                                # locked) and shows ONLY that kind's fields: draw/paydown/buy → amount; deposit → amount
                                # (+ liq-price when target:'cb'); balanceReading → the reading section (CB block gated on
                                # the ORIGINAL reading's cbBal!=null via showCbReading, NOT current hasCbLoan). The reading
                                # section renders ONLY in add mode OR for a balanceReading edit — a flow edit never shows
                                # it (no LD6 re-enforcement). Title "Edit event"; month via bucketEventToMonth(editEvent.date).
                                # canSave branches by kind (reading→readingComplete(state,showCbReading); cb-deposit→
                                # amount>0 && liq>0; else amount>0). The open useEffect keys on [open, editEvent?.id] and
                                # seeds fields from editEvent (LTV ×100 for display). handleSave reconstructs ONE event
                                # preserving id/date/ts → updateDayEvent (LTV ÷100 on reading edits; cb-deposit edit also
                                # re-anchors cbLiquidationPrice/AsOf) — NO buildEventsFromSheet, no second event. Delete
                                # (edit only) → an inline .confirmBox (copy names the month + provisional warning) →
                                # deleteDayEvent(id). Exports isEditableKind(k) (draw/paydown/buy/deposit/balanceReading)
                                # — DailyModeView gates row taps on it (withdraw/cbCollateralReading rows stay
                                # non-tappable). The Strike-target "Strike held after" readout is edit-aware: it backs
                                # out the original deposit amount in edit mode (currentBtcHeld − editEvent.amount + amount)
                                # so it doesn't double-count (the edited deposit is already in currentBtcHeld via the C1
                                # seam); add mode + non-deposit edits subtract 0 — readout only, no data effect.
                                # EventSheet.module.css alongside (+ .deleteBtn/.confirmBox/.confirmText)
      eventSheetModel.ts        # PURE builders for EventSheet (no React/store; named eventSheetModel to avoid the macOS
                                # case-collision with EventSheet.tsx): SheetType/SheetState + readingComplete(s,hasCbLoan)
                                # (the reading half of the Save gate) + buildEventsFromSheet(s,hasCbLoan,btcPrice,today,ts,
                                # idFn) → DayEvent[] ([reading] | [flow,reading] | [deposit,reading]; fresh id per event;
                                # flow+reading share date+ts; usd=amount*price for buy; **LTV percent ÷100 → fraction** to
                                # match the stored decimal convention). Tested in __tests__/eventSheet.test.ts
    SimpleMode/
      PriceChart.tsx            # BTC price chart atop the Safety Dashboard — recharts AreaChart (line/area,
                                # not candlesticks), 1H/1D/1W pills (default 1D), header price + range %Δ
                                # (green/red), auto padded Y-domain (intraday visible), graceful loading/
                                # "price history unavailable" states. Owns its own range state + useBtcHistory
                                # (no props). Data ephemeral (never stored). PriceChart.module.css alongside
      SafetyDashboard.tsx       # Top-of-SimpleMode safety read (reads store directly, recomputes on price tick):
                                # the Safe/Watch/Act .stateLine VERDICT is the FIRST child — a prominent 15px/700
                                # headline at the very top (moved up from the buried last child; render-position +
                                # style only, state/stateCopy derivation unchanged) → then
                                # <PriceChart/> strip (BTC candles) → CB bar (primary; fill = ltv/cbLiqFrac, where
                                # cbLiqFrac = the effective liquidation LTV from the AUTHORITATIVE cbLiquidationPrice
                                # (accruedBalance/(collateral×activeLiqPrice)), falling back to CB_LLTV when no price
                                # is set — so editing the CB liquidation price MOVES the bar fill + trigger marker +
                                # 0.93 level band consistently, not just the cushion subtext. The playbook COINBASE bar
                                # mirrors this (cbLiquidationPrice>0 ? cbLoanBalance/(collateral×price) : CB_LLTV, raw
                                # basis). bare
                                # 75%/86% marker TICKS — trigger/liq prices + "Coinbase"/"~est." source moved to a
                                # .priceNote subtext, no label collision; cushion = LTV-POINT GAPS "X% to trigger ·
                                # Y% to liquidation" (ltvGapToTrigger = trigger% − cbLtv; ltvGapToLiq = cbLiqFrac −
                                # cbLtv, the authoritative-liq-price LTV; matches the playbook "CB runway" — the price
                                # view stays in the priceNote/liq-price field; the old ↓price-drop pct() was removed),
                                # Safe/Fair/
                                # Poor badge, no-grace note in amber/red) → Strike bar (body tap flips capacity-used
                                # ↔ liquidation gauge vs strikeLiquidationLtvPct; LTV via
                                # computeStrikeLtv(advisorActualBlocBalance, getCurrentBtcHeld(), price) — the
                                # CURRENT position, not the frozen baseline. Card is a <div role=button> (was
                                # <button>) with a view-aware inline EDIT control (.editLink, stopPropagation so it
                                # doesn't flip): capacity edits BLOC balance + credit line, liquidation edits BLOC
                                # balance + liq LTV %; Save → synced setters, no Settings trip). The state line
                                # (hasCbLoan ? worseLevel(cb,strike) : strikeLevel) is the top headline (see above).
                                # The WHOLE CB card is tap-to-
                                # anchor: a <div role=button onClick={toggleEdit}/onKeyDown> (guarded e.target===
                                # currentTarget so typing in a field can't toggle) with .flipHint "tap to set/update"
                                # cue + stopPropagation on the .editBox — mirrors the Strike whole-card tap (the thin
                                # barTrackBtn is gone). The .editBox also shows a read-only live Morpho rate
                                # reference line (via useMorphoRate, same as the Settings APR field; cbAprPct
                                # untouched). Save → balance + liq price, both set…AsOf today. neverAnchored
                                # (both asOf null) → ONE calm .anchorNudge (not three amber warnings); freshness "as
                                # of N days"/stale "may be low" (>30d) lines apply only once anchored. Strike bar is
                                # DECOUPLED from hasCbLoan — only the
                                # CB bar gates on it: !hasCbLoan → CB-setup prompt in the CB slot, Strike bar +
                                # Strike-only state line still render. Evergreen (past month 12). All CB math via
                                # cbMetrics — same numbers as the CB Loan tab
      SimpleModeView.tsx        # Simple Mode full-screen view (global simpleMode flag); mounts <SafetyDashboard/>
                                # at top. handleApply re-anchors store cbLoanBalance by the month's CB paydown
                                # (ltvTriggered → cbPaydownDraw, monthly → cbPayment) + stamps cbLoanBalanceAsOf
                                # today (liq price NOT auto-updated — manual oracle re-entry). single-commit model:
                                # "Log this month & continue" → ConfirmLogSheet portal (inline component:
                                # summary + editable BTC-bought (seeds to the
                                # plan's projected buy, or 0 if Buy row skipped; user overrides with the
                                # actual; shows "Skipped" read-only when skipped) + editable BLOC draw +
                                # editable CB payment (both authoritative over the projection — "Skipped"
                                # read-only when skipped) + editable "Interest /mo" (REPLACED the old
                                # "Expenses this month" field — BLOC draw already = expenses, so logged
                                # expensesActual is auto-set to the draw; Settings `expenses` assumption
                                # untouched) + optional NDP toggle row when ndp.status !== 'ok' (relabeled
                                # "made this year"; checking it reveals an editable NDP-amount $ input,
                                # records the actual NDP paid as MonthlyLogEntry.ndpPaid + stamps
                                # ndpLastPaidDate — does NOT reduce the balance)
                                # → handleApply(confirmedBtcBought) writes the confirmed
                                # bought value to MonthlyLogEntry.btcBought (not the hardwired projection).
                                # The EDITED BLOC draw (effectiveDrawAmount via customBlocDraw) AND EDITED
                                # interest (effectiveInterest via customInterest) recompute the
                                # logged Strike balance/LTV (loggedStrikeBal/loggedStrikeLtv — substitute the
                                # edited draw/interest for the projected currentRow values); the EDITED CB payment
                                # (effectiveCbPayment via customCbPayment, seeded per-mode: ltvTriggered →
                                # cbPaydownDraw, monthly → cbPayment) drives the CB-balance re-anchor (un-edited
                                # = today's projected behavior; all customs reset to null on apply). CB row is
                                # labeled per mode ("CB payment" monthly / "CB paydown" ltvTriggered) and, in
                                # ltvTriggered mode, HIDDEN until currentRow.cbLtvTriggered fires (showCbRow).
                                # Plan card = "Monthly Playbook" (polished toward Smart BLOC's restraint):
                                # a TWO-LINE header — top "Monthly Playbook · Month X of 12 · [de-boxed state badge]"
                                # (.planTitleSep ghost dot before "Month"), second
                                # line (.scrubMeta, above the scrubber) "LTV Z% — paydown triggered" (LTV +
                                # flag coral when hasPaydown) left + "BTC $price" right;
                                # a month SCRUBBER (1–12, selectedMonth,
                                # snaps to currentMonth via effect; replaced the removed MonthlyLogSection
                                # carousel) with a TWO-TONE fill (red paydown share / green rest, keyed to
                                # the --paydownPct = barPaydownPct CSS var) + month-tick markers
                                # (M1·M3·M6·M9·M12, replaced the "drag to scrub" caption); TWO stacked status
                                # bars (Strike / CB — toggle-gated by showPlanStrikeBar/showPlanCbBar). On the CURRENT
                                # month each bar's value shows a current→eom TRANSITION "A% → B% LTV" (.planBarFrom/
                                # .planBarArrow ghost; Strike's eom number stays orange on hasPaydown); projected/logged
                                # months show the single eom value. The
                                # INCOME ALLOCATION bar was REMOVED (redundant — the two-tone scrubber already
                                # encodes the per-month paydown/buy split; allocation-complete ✓ is always true
                                # in projected months + still surfaces in the confirm sheet) along with its dead
                                # Settings toggle (the showPlanIncomeBar store field is kept, vestigial/device-
                                # local). A colored-dot action layout borrowing the Smart BLOC playbook
                                # structure on the REALITY engine: Buy Bitcoin (now with % allocation +
                                # "(after paydown)/(100% of income)" subtext) → a conditional LoC Paydown
                                # row (orange, % + $, no pill; rowPaydownUsd = isCurrent ? expectedPaydown :
                                # selectedPlan.paydown — appears only in months where paydown fires) → a
                                # "Line of Credit (funds your lifestyle)" separator → Monthly Draw / Interest
                                # (+ a Pay-Coinbase row in monthly CB
                                # mode). Each allocation row's % sits ABOVE the amount (right-aligned
                                # .dotRightInner/.dotPct — Buy Bitcoin/LoC Paydown only), the Interest
                                # amount is red, and the rows are dialed back to Smart BLOC's restraint
                                # (8px dots, --text-secondary labels, lighter dividers, weight-600 amounts).
                                # A demoted
                                # "this month also" strip (CB alert / capped / rotation /
                                # fiat-gap / NDP), and a plain-English summary paragraph. PROJECTION-VS-
                                # REALITY SPLIT (simpleModePlan.ts): isCurrent (selectedMonth === currentMonth)
                                # → operate console (Pay/Skip pills + Log active; SKIP-ADJUSTED reality — bars
                                # read allocatedFromIncome/eomLtv + a skip-aware EoM CB LTV, summary branches
                                # on advisorSkip*); other months → read-only preview of the UNSKIPPED
                                # deriveForMonth projection (logged → actuals + "✎ Edit this month" overlay;
                                # "← back to current month"). Log button gated isCurrent && !strategyDone;
                                # a logged current month shows a ✓ note + "✎ Edit this month" (opens the overlay
                                # for currentMonth) + Undo (deleteLogEntry). MonthlyLogSection kept for the
                                # Advisor tab. The POSITION block is THREE CARDED BOXES in a row — CURRENT STRIKE
                                # BLOC | THIS MONTH | AFTER THIS MONTH (now → action → projected; .positionRow is a
                                # 1fr/1fr/1fr grid that stacks to 1col ≤760px; the outer .card wrapper was dropped to
                                # avoid card-in-card). Split from the old lopsided 2-box layout — the left box used to
                                # cram CURRENT + the embedded AFTER projection + Avail, wrapping "credit line used · LTV"
                                # onto two lines, while THIS MONTH sat ~85% empty; three full-width-each boxes fix both.
                                # Box1 CURRENT + Box3 AFTER show the SAME three lines in the same order for line-for-line
                                # comparison (asset → debt → avail, NO inline labels — titles carry the meaning, fixes
                                # ⅓-width wrapping): "₿ held ($usd)" / "$balance (Z% LTV)" / "Avail: $A". The ₿ amount
                                # is ORANGE (.btcAmt) and the ($usd) paren is a smaller ghost SUBTEXT (.parenSub, 11px)
                                # — not same size/color as the ₿. The debt-line "(Z% LTV)" paren is ALSO .parenSub ghost
                                # subtext (AFTER keeps the orange Z number on hasPaydown — orange overrides the ghost).
                                # CURRENT Z =
                                # currentBlocLtv via computeStrikeLtv (matches the dashboard Strike bar); AFTER Z = eomLtv
                                # (orange span when hasPaydown). usd = ₿ × live btcPrice. PER-BOX AVAIL CORRECTNESS:
                                # CURRENT uses currentAvail = strikeAvailableCredit(creditLine, currentBtcHeld, price,
                                # advisorActualBlocBalance) (current basis); AFTER uses availCredit (eom basis) — fixed a
                                # latent mislabel where the eom Avail was shown as current. (The AFTER collateral-limited
                                # binding hint was REMOVED — de-noised.) Box2 THIS MONTH is a two-line
                                # action card "Buy: ₿ +X" (₿-only) / "Draw: $Y" (both labeled — bare values would be
                                # ambiguous), "(proj)" consolidated to the box title; NDP badge below (gated ndp.status
                                # !== 'ok'). THIS MONTH's "Draw" shows the REMAINING draw (remainingDraw =
                                # max(0, expectedBlocDraw − (advisorActualBlocBalance − slmBlocBal)) = full plan minus
                                # what's already drawn live this month), so mid-month it counts down to 0 as you draw;
                                # AFTER (eomBlocBalance) + the ConfirmLogSheet draw + loggedStrikeBal keep the FULL-month
                                # draw on slmBlocBal (= advisorMonthStartBalance, the start-of-month base) → true
                                # end-of-month. AFTER was promoted from the embedded .eomProjection sub-section (retired;
                                # .eom*/.usedLabel CSS removed) to a peer box. So
                                # editing Amount Drawn / BTC collateral in
                                # Settings moves it cleanly. STRIKE was de-noised: the "fully backed above $X"
                                # binding line was removed (only the amber "collateral-limited (50% LTV)" branch
                                # remains, shown at the 50% ceiling). The ltvTriggered CB indicator was RELOCATED from
                                # the CURRENT STRIKE BLOC box (category error — a CB metric in the Strike box) into
                                # THIS MONTH (Box 2), after the NDP badge behind a .positionDivider, and REFRAMED by
                                # band to match the engine: below the 75% trigger → neutral "CB runway: Z% / before
                                # 75% trigger" (Z = cbLtvTriggerPct − currentCbLtv×100, the LTV gap to the trigger as a
                                # PERCENTAGE; the cbRunwayToTrigger dollar derivation still gates the block's >0
                                # visibility but the displayed value is the % gap); at/above trigger →
                                # "CB paydown: $X / to reach 65% LTV" (balance −
                                # collateral×price×target%, the engine's draw; green/red by Strike-credit
                                # affordability). cbTriggered reuses currentCbLtv; the old single cbPaydownBuffer/
                                # cbBufferAffordable + the 65%-keyed CURRENT-box line are gone. The NDP badge moved to
                                # the THIS MONTH box. In the
                                # dot-rows the Pay/Skip pills sit BEFORE the amount so the amount anchors right
                                # across current/projected/logged months. The Strike LTV line AND the whole CB LOAN column were
                                # REMOVED (both LTVs now read from the SafetyDashboard bars above — de-duped;
                                # currentStrikeLtv/cbStatus/classifyLtv dropped as orphaned). No checklist
                                # (removed; see Synced Settings).
                                # Quick Setup modal ALWAYS reachable ("⚙ Edit your numbers" once
                                # established, first-run copy while isDefaultSetup). This Month / Outlook
                                # segmented control (gated !strategyDone): This Month = console + a
                                # next-month preview line (advisorRows month currentMonth+1, hidden at Mo 12);
                                # Outlook = shared <OutlookProjection> (same props/numbers as the Advisor
                                # tab) + an Outlook re-anchor nudge (§9): when the trailing 3-entry avg of
                                # expensesActual drifts >5% from the `expenses` assumption, a dismissible
                                # banner offers Update (setExpenses(round(avg))) / Dismiss (persists the avg
                                # to device-local expenseReanchorDismissedAt; resurfaces only when drift
                                # moves >5% past it). computeExpenseReanchor (logUtils, pure) is the predicate.

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
  manifest.json                # PWA: name "Personal ₿LOC", theme #E8836A
  sw.js                        # Network-first service worker
  icon.svg                     # Dark bg, orange ₿
```

---

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
cbCollateralBtc:     number;                       // default 1.48 — derived cache (deriveCbCollateral over dayLog); NOT a synced scalar, but P3 CONVERGES it cross-device via the synced dayLog (rides records:v1). setCbCollateralBtc emits a cbCollateralReading
cbAprPct:            number;                       // default 4.77
cbMonthlyPayment:    number;                       // default 0
cbLiquidationPrice:  number;                       // default 0 (0 = not set; guard before calling compute fn)
cbPaymentStrategy:   'monthly' | 'ltvTriggered';  // default 'monthly'
cbLtvTriggerPct:     number;                       // default 75 (percent, e.g. 75 = 75%)
cbLtvTargetPct:      number;                       // default 65 (percent, pay down to this LTV)
cbRotateBackPct:     number;                       // default 55 (percent, reverse-rotation gate; synced in SETTINGS_FIELDS/payload like trigger/target)
cbLoanBalanceAsOf:      string | null;             // v13 — ISO date cbLoanBalance was last re-anchored (interest accrues daily from here); synced
cbLiquidationPriceAsOf: string | null;             // v13 — ISO date cbLiquidationPrice was last re-entered (drifts up with interest); synced
strikeLiquidationLtvPct: number;                   // v13 — Strike partial-liquidation LTV, default 85 (published terms); synced
```

### Advisor Tab
```typescript
advisorStartDate:         string;   // ISO date, default today
advisorActualBlocBalance: number;   // default 0 — LIVE drawn BLOC balance right now (CURRENT box, Advisor, SafetyDashboard, NDP)
advisorMonthStartBalance: number;   // default 0 — BLOC balance at the START of the current month; projection base ONLY (deriveAdvisorStart month-1). SYNCED. Distinct from advisorActualBlocBalance (live drawn) so mid-month the AFTER box stacks the full draw on the start base, not on the live balance
advisorActualBtcHeld:     number;   // default 0 — TRUE month-0 baseline BTC, NEVER back-solved; current = derives + pending
pendingCollateralAdjustment: number;  // default 0 — un-graduated collateral delta; SYNCED; folds into the current month's entry on log
sandboxCollateralBtc:     number | null;  // default null — Smart BLOC what-if collateral; IN-MEMORY only (partialize-excluded, never synced); null = tracks current
advisorSkipBlocDraw:      boolean;  // default false (persisted + synced)
advisorSkipCbPayment:     boolean;  // default false (persisted + synced)
advisorSkipBtcBuying:     boolean;  // default false (persisted + synced)
monthlyLog:               MonthlyLogEntry[];  // default []
showMiningInLog:          boolean;            // default false
```

---

## Dated Collateral Model (spec v4 — store stays v11)

```
btcHeld[i] = baseline + Σ_{j≤i} (btcBought[j] + (collateralAdjustment[j] ?? 0))
current    = (last.btcHeld ?? baseline) + pendingCollateralAdjustment
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
| Settings "Current BTC collateral" | REALITY — shows current; blur-commit → `adjustCurrentCollateral`. A read-only "Initial BTC collateral" line (`advisorActualBtcHeld`, the fixed month-0 baseline) sits ABOVE it, plus a green "+X ₿ since start" delta (current − initial, hidden when equal). Initial is read-only BY DESIGN — editing it would re-chain logged history (v4 "never back-solved"); current edits stay dated adjustments. Display-only, store v12 unchanged |
| Advisor "CURRENT BTC HELD" | REALITY — same pattern |
| Simple Mode Quick Setup "BTC held" | REALITY — seeds current; save routes through adjust |
| Simple Mode displays / Liq Sim | REALITY — derives + pending |
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

## Daily Mode (P1 — pure data layer; store stays v18)

A granular daily journal that rolls up into the existing month log. **P1 is types + two pure functions only** — no
store, no UI, no sync.

- **`DayEvent`** (types.ts) — a discriminated union over `DayEventKind` =
  `draw | buy | paydown | deposit | withdraw | balanceReading | cbCollateralReading`. Base = `{ id, date (ISO
  yyyy-mm-dd), ts (ms) }`. `draw`/`paydown` carry `amount` (USD); `buy` carries `amount` (BTC) + optional `usd`;
  `deposit`/`withdraw` carry `amount` (BTC magnitude) + `target: 'strike' | 'cb'`; `cbCollateralReading` carries
  `cbCollateral` (BTC); `balanceReading` carries a nested `reading { strikeBal, strikeLtv, cbBal?, cbLtv?,
  cbCollateral?, price? }`.
- **LD5 — stocks are READINGS:** balances/LTVs are read off Strike/Coinbase (the `balanceReading` event), never
  chained. **btcHeld is NOT in `balanceReading`** — Strike BTC stays store-owned via `recomputeBtcHeld` /
  `adjustCurrentCollateral`.
- **LD7 — CB collateral = a reading, not a chain:** `cbCollateralBtc` is DERIVED (latest `cbCollateral`-bearing event
  by `ts` — `balanceReading` or `cbCollateralReading`), wired in P2; it is NOT a synced setting and is NEVER placed in
  the rollup entry.
- **`target` semantics:** `deposit`/`withdraw` `target:'strike'` feeds `collateralDelta` (the P2 collateral seam);
  `target:'cb'` is **journal-only** (ignored by rollup — CB collateral comes from the reading).
- **`rollupMonth(dayLog, month, advisorStartDate, priorStocks?)` → `{ entry: Partial<MonthlyLogEntry>, collateralDelta }`:**
  flows accumulate (`draw`→`expensesActual`, `buy`→`btcBought` [+`income` iff `usd`], `paydown`→`paydown`);
  `collateralDelta` = net `target:'strike'` BTC, **signed by kind** (deposit +, withdraw −); stocks from the LATEST
  `balanceReading` by `ts` (`strikeBal`/`strikeLtv` always, `cbBal`/`cbLtv` iff present). `entry` NEVER carries
  `btcHeld`/`collateralAdjustment`/`source`/`confirmed`/`cbCollateral`. **Carry-forward** (LD6 backfill exception):
  flows present but no `balanceReading` + `priorStocks` given → stocks borrowed from `priorStocks` + `provisional:true`.
  Empty month → `{ entry: {}, collateralDelta: 0 }`. `bucketEventToMonth(date, advisorStartDate)` replicates
  `getCurrentStrategyMonth`'s formula with the event date (kept inline — logUtils stays import-standalone).
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
    strategy-month's last `balanceReading` by ts.
- **Partial→Full bridge** (`rerollMonth`): spread the `rollupMonth` Partial onto the EXISTING month entry (preserve
  miningSats/ndpPaid/loggedAt) or a full numeric seed for a new month (never `{}`); stamp `source:'daily'`,
  `confirmed: existing.confirmed===true ? false : (existing.confirmed ?? false)` (reopen-on-edit, LD4). `recomputeBtcHeld`
  (inside `upsertLogEntry`) fixes the `btcHeld:0` placeholder. **Emptied-daily-month cleanup:** if no Route-2 events
  remain in the month and the entry is `source:'daily'`, `deleteLogEntry(month)` instead of a stale placeholder.
- **Seam 1 (collateral)** — after the upsert (which graduated any prior pending into this month's `collateralAdjustment`),
  and ONLY when `collateralDelta !== 0`: `adjustCurrentCollateral(getCurrentBtcHeld() − thisMonth's existingAdj +
  collateralDelta)`. Subtracting `existingAdj` (the just-graduated amount) before adding the WHOLE-month net
  `target:'strike'` delta prevents double-counting earlier same-month deposits. `target:'cb'` contributes 0 (journal-only).
- **Seam 2 (cbCollateral clock)** — `deriveCbCollateral(dayLog, cache)` (logUtils) = latest `cbCollateral`-bearing event
  by ts across `balanceReading` + `cbCollateralReading`, fallback to the cache (never undefined). `setCbCollateralBtc(v)`
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
  snap.cbCollateralBtc ?? useStore.getState().cbCollateralBtc })` — **MUST NOT** use `setCbCollateralBtc` (P2a
  made it emit a `cbCollateralReading` → would inject a spurious event into the VIEWER's own `dayLog`). The
  viewer's `dayLog` stays `[]`; the `??` fallback preserves the value for a legacy/pre-P3 owner snapshot. The
  revoked path returns before this via `clearViewerData()`.

---

## Daily Mode (P4a — read-only view shell + Monthly|Daily toggle; store stays v19)

The first Daily Mode UI surface. **READ-ONLY** — it proves the dayLog/rollup data renders before any writing
UI lands. NO event sheets / `addDayEvent`/`updateDayEvent`/`deleteDayEvent` wiring / FAB (P4b); NO Week|Month
calendar / scrubbing / reconcile / dry-powder readout (P4c).

- **`simpleView: 'monthly' | 'daily'`** (store, default `'daily'`) — DEVICE-LOCAL UI pref selecting the
  consumer-shell view. NOT synced (absent from `SETTINGS_FIELDS`/`buildSettingsPayload`); rides `partializeState`'s
  `...rest` (NOT in the omit destructure); **no version bump** — the custom `merge` (`{...current, ...persisted}`)
  fills it for existing users from `current`. Setter `setSimpleView` is a plain `set` (no `syncSettingsToNostr`),
  mirroring `showPlanStrikeBar`.
- **Copy relabel "Simple Mode" → "Monthly Mode"** (copy only; the `simpleMode` store field + all code identifiers
  unchanged): SettingsMain Display row subtitle + the Display-subpage toggle title. The AppShell tab-bar button that
  ENTERS the consumer shell (`setSimpleMode(true)`) is relabeled **`aria-label="Switch to simple view"`** (generic —
  the shell now hosts BOTH Monthly and Daily, so "Monthly Mode" there would mislead once toggled to Daily).
- **`DailyModeView`** (`components/Daily/`) — mirrors `SimpleModeView`'s layout/visual language: same header +
  `<SafetyDashboard/>` verbatim + the CURRENT|THIS MONTH(proj)|AFTER position trio (same derivation cluster, skips
  treated as false). Its ACTIVITY CARD lists the current strategy month's `dayLog` (`selectMonthEvents` +
  `describeDayEvent`, both PURE in `dailyView.ts`), empty state "No activity logged this month." A read-only PLAN
  REFERENCE reuses `deriveForMonth` + `composeMonthSummary` (CB row reflects the engine: ltvTriggered shows
  `cbPaydownDraw`, monthly shows `plan.cbPayment`). Month indicator only — no scrubber.
- **Daily | Monthly toggle** — a segmented control (`<ViewToggle>` from `src/components/Layout/ViewToggle.tsx`;
  `.viewToggle*` in `ViewToggle.module.css`) bound to `simpleView`; rendered INSIDE each view (DailyModeView +
  SimpleModeView) immediately after its header and before `<SafetyDashboard>` (header → toggle → SafetyDashboard),
  matching the preview layout. `AppShell` passes `simpleView`/`setSimpleView` as props to both views; the toggle
  block was removed from AppShell. Button order: Daily-left, Monthly-right. Consumer shell only — full-app path untouched.

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
  (replicated into DailyModeView.module.css). The **outer cube containers** use Daily-restyle classes `.posrow` (grid
  wrapper) and `.posbox` (`--surface` bg, `--line` border, 14px radius) — distinct from the content classes
  `.positionTitle/.positionStat/.btcAmt/.parenSub` which stay Monthly-format inside the boxes. The preview-style
  `.posrow/.posbox/.postitle/.posval/.posvalBtc/.possub` block is gone; the new `.posrow/.posbox` are the cube shells only.
  **The trio stays 3-across on mobile in both Monthly and Daily** — the `@media (max-width: 760px) { grid-template-columns: 1fr }` collapse was removed from `DailyModeView.module.css` (both `.posrow` and `.positionRow`) and `SimpleModeView.module.css` (`.positionRow`). On mobile (≤760px), `.parenSub` parenthetical amounts stack below the highlighted amount (`display: block` override in both files) so the narrow 3-across cubes stay readable; wider screens keep the inline layout.
- **Header parity (polish pass):** Daily `.brandMark` now matches Monthly's plain ₿ (`font-size:18px; color:var(--orange)`, no gradient badge); Daily `.brandName` bumped to 16px/700 to match Monthly. Monthly's `.settingsBtn`/`.modeToggleBtn` restyled to match Daily's boxed `.iconBtn` (34×34, border 1px `var(--line)`, bg `var(--surface)`, `var(--text-muted)` → hover `var(--text-primary)`); `.headerRight` gap bumped 4px → 8px. Daily trio gap equalized: `.cards` `margin-top:13px`→`0` + `gap:13px`→`16px` (SafetyDashboard's own `margin-bottom:16px` is the sole above-gap → both sides 16px).
- **`dailyView.ts` UNCHANGED** — `describeDayEvent` keeps its `{icon,label,detail}` shape (the log-row uses label/
  detail; dot/tone mapping lives in the component); `dailyView.test.ts` unaffected. Still read-only (FAB/add-sheet P4b,
  calendar + drill-down gauge/CB sheets P4c).

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

- **⚠ CRITICAL — the calendar's month range uses `bucketEventToMonth`'s 30.4375-day STRATEGY-month
  definition** (logUtils.ts:98), NOT `strategyMonthDate`'s calendar-month `setMonth` stepping (useStore.ts) —
  so a day's calendar cell and the events `selectMonthEvents` buckets to that month AGREE. `monthDateRange`
  enumerates a safe day-offset window and KEEPS only dates that bucket to the target month (self-corrects
  boundaries); every returned date round-trips `bucketEventToMonth(date,start)===month` (the load-bearing
  test). `loOffset` is clamped ≥0 — `bucketEventToMonth` clamps pre-start days to month 1, so without it
  month 1 would leak days before `advisorStartDate`.
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

## Tab Architecture (`AppShell.tsx`)

```typescript
const ALL_TABS_META = [
  { key: 'living',    fullLabel: 'Living on Bitcoin', shortLabel: 'LO₿'      },
  { key: 'bloc',      fullLabel: 'Smart BLOC',        shortLabel: '₿LOC'     },
  { key: 'powerlaw',  fullLabel: 'Power Law',         shortLabel: 'Power Law' },
  { key: 'converter', fullLabel: 'Sats',              shortLabel: '丰'        },
  { key: 'mining',    fullLabel: 'Miners',            shortLabel: 'Miners'    },
  { key: 'coinbase',  fullLabel: 'CB Loan',           shortLabel: 'CB'        },
  { key: 'advisor',   fullLabel: 'Advisor',           shortLabel: 'Adv'       },
];
```

Visible tabs = `tabOrder` ordered → filtered by `hiddenTabs`. Tab bar uses `DndContext` + `SortableContext` (horizontal, 5px activation threshold). Settings page uses vertical sortable with ⠿ handles. New keys not in `tabOrder` auto-append to end.

**`SettingsMain.tsx` has its own local `ALL_TABS` constant** — must be kept in sync with `ALL_TABS_META` when adding new tabs.

---

## Smart BLOC Sidebar (`InputsPanel.tsx`)

Flex-column panel with two sections:
- **`.scrollArea`** — scrollable inputs (income, expenses, BTC price, credit line, collateral, APR)
- **`.recommendations`** — sticky bottom panel:
  - Recommended min credit line: `Math.ceil(peakBalance × 1.10 / 500) × 500` where `peakBalance = max(uncapped runBlocYearOne rows)`. Green ✓ / orange ↑.
  - Break-even draw: `income / (1 + blocApr/100/12)`. Green ✓ when `expenses ≤ breakEven`.

Collateral input reads `getCollateralForTier(activeTier, expenses, btcPrice, sandboxBtc)` where
`sandboxBtc = sandboxCollateralBtc ?? getCurrentBtcHeld()` — the Smart BLOC tab is a SANDBOX
(what-if collateral, in-memory, no write-back; see Dated Collateral Model). Editing auto-switches to
Custom tier. `advisorActualBtcHeld` is the month-0 BASELINE only (formerly `customCollateral`,
removed in store v6); the real position is edited in Settings/Advisor via `adjustCurrentCollateral`.

---

## Month-by-Month Breakdown

### `runBlocYearOne.ts`
```typescript
interface BlocYearOneInputs {
  collateralBtc: number; btcPrice: number; income: number; expenses: number;
  apr: number; ltvCeiling: number; creditLine: number; btcGrowthRate: number;
}
interface BlocMonthRow {
  month: number; phase: 1|2|3|4; creditExceeded: boolean;
  availableCredit: number; btcPriceThisMonth: number;
  // ...balance, ltv, paydown, btcBought, incomeTowardBtc
}
```

**Phase classification (strict priority):**
1. `creditExceeded === true` → Phase 4 (red) — credit maxed, cover expenses from fiat
2. `paydown > 0 && !firstPaydownSeen` → Phase 2 (amber) — first paydown
3. `paydown > 0` → Phase 3 (blue) — subsequent paydown
4. Otherwise → Phase 1 (green) — full BTC buying

**Draw algorithm:** `actualDraw = min(expenses, max(0, creditLine - balance))` → `balance += draw` → interest → LTV paydown → BTC buying.

**BTC growth:** `btcPriceThisMonth = btcPrice × (1 + btcGrowthRate)^((month-1)/12)`

**Recommended credit line:** run with `creditLine: Infinity` → `peakBalance × 1.10` rounded up to $500.

### Growth Scenario Toggle (local state)
Bear (−30%) / Flat (0%) / Power Law (dynamic) / Bull (+80%)
Power Law rate: `Math.pow((daysNow + 365.25) / daysNow, PL_B) - 1` ≈ 33% currently.

---

## CB Loan (`runCoinbaseLoan.ts`)

```typescript
type CbLtvStatus = 'safe'|'watch'|'warning'|'emergency'|'critical'|'liquidated';
// <0.55 / 0.55-0.65 / 0.65-0.70 / 0.70-0.84 / 0.84-0.86 / ≥0.86

// Per month: interest accrues → payment applied
// netChange = balance - prevBalance (positive = bad)
// isBreach = btcPrice <= threshold.price (highlights alert rows)
```

Morpho/Coinbase: 86% LLTV instant liquidation, no grace period, 4.38% penalty.

### `cbMetrics.ts` — shared CB LTV / liq-price source of truth (v13)

`cbMetrics(loanBalance, collateralBtc, price, triggerPct)` → `{ ltv, liqPrice, triggerPrice,
pctToTrigger, pctToLiq }` (`liqPrice = balance/(collateral×CB_LLTV)`; `triggerPrice =
balance/(collateral×triggerPct%)`; `pctTo*` are price-relative — NEGATIVE when safe, i.e. the
trigger/liq price sits below the current price). `accruedCbBalance(balance, aprPct, asOf)` compounds
the balance daily from its `asOf` ISO date to now (`null` → unchanged) — feed it in as `loanBalance`
so LTV reflects accrued debt. Plus `barLevel(ltv, warnAt, actAt)` / `worseLevel(a,b)` for the
Safe/Watch/Act state line. **Single source** consumed by the Simple Mode `SafetyDashboard` AND the CB
Loan tab (`CoinbaseLoanMain` `currentLtv`/`autoLiqPrice`, `CoinbaseLoanSidebar` implied liq) — their
old inline formulas were removed so the figures can't disagree. `LiquidationModeler` keeps its own
`computeLiquidationAnalysis` (distinct post-repayment *scenario* math, not the current-LTV
duplication) but now receives `activeLiqPrice` (entered `cbLiquidationPrice` when > 0, else the
computed `cbMetrics.liqPrice`) as its `liquidationPrice` prop. Imports `CB_LLTV` from `runCoinbaseLoan`
(no circular dep — runCoinbaseLoan never imports back).

---

## Advisor (`runAdvisor.ts`)

### Priority Tiers (based on CB LTV start of month)
| Tier | CB LTV | BLOC Draw | Extra CB | BTC |
|---|---|---|---|---|
| 4 | < 55% | Full | None | Remaining |
| 3 | 55–65% | Full | 25% income | Remaining |
| 2 | 65–70% | 50% | 50% income | Remaining |
| 1 | ≥ 70% | $0 | 100% income | $0 |

```typescript
interface AdvisorInputs {
  btcPrice: number; income: number; expenses: number;
  blocApr: number; creditLine: number; blocLtvCeiling: number;
  cbBalance: number; cbCollateralBtc: number; cbAprPct: number; cbMonthlyPayment: number;
  cbPaymentStrategy: 'monthly' | 'ltvTriggered';
  cbLtvTriggerPct: number;   // percent, e.g. 75
  cbLtvTargetPct:  number;   // percent, e.g. 65
  startingBlocBalance: number; startingBtcHeld: number; startingMonth: number;
  btcGrowthRate: number;
}

// AdvisorMonthRow key fields (defined in runAdvisor.ts, not types.ts):
// cbPaydownDraw:      number  — BLOC draw used for CB paydown this month (0 if not triggered)
// cbLtvTriggered:     boolean — true when CB LTV trigger fired this month
// cbPaydownCapped:    boolean — paydown capped by remaining credit line (cb-paydown-cap)
// cbPaydownShortfall: number  — desired paydown minus capped paydown
// strikeRepayDraw:    number  — CB draw used to repay Strike on recovery (reverse rotation)
// strikeRepayFired:   boolean — true when Strike→CB reverse rotation fired
```

Per-month price: `btcPrice × Math.pow(1 + btcGrowthRate, (month - startingMonth) / 12)`

**Living projection:** `getCurrentStrategyMonth(startDate)`, `isStrategyComplete(startDate)` exported from `runAdvisor.ts`. Month 1 = first month after start date. Clamps to 12.

**Skip overrides:** `advisorSkipBlocDraw/CbPayment/BtcBuying` in store. `overriddenPlan` memo in `AdvisorMain.tsx` applies overrides to current month display only. BLOC paydown is mandatory (LTV-triggered, no skip).

**Income constraint:** `blocPaydown + cbPayment + btcIncome = income` always.

**BLOC paydown ceiling defense:** the income-funded BLOC paydown is `min(income, blocBalance − blocTarget)` (`blocTarget = btcHeld × price × 0.15`) in BOTH the ltvTriggered and monthly paths — i.e. up to **100% of income** defends the 15% ceiling, identical to Smart BLOC's `runBLOC`. (The prior `income * 0.3` 30%-of-income cap was removed — it under-paid in high-LTV months so Simple Mode's STRIKE BLOC LTV drifted above 15% instead of snapping back. Behavioral: high-LTV months divert more income to paydown, less to BTC — the intended hard-ceiling defense. The 15% ceiling value + CB/tier logic are unchanged.)

**Growth scenarios:** same 4 presets as MonthBreakdown — affects both BLOC LTV and CB LTV each month, can auto-resolve emergency tiers in Bull scenario. The scenario picker + its runAdvisor live ENTIRELY in `OutlookProjection` (shared with Simple Mode's Outlook segment). AdvisorMain keeps a SEPARATE runAdvisor pinned to `btcGrowthRate: 0` for the operating plan.

**Projection extraction (Phase 3) — conscious behavior shift:** the Advisor tab's carousel + log overlay months 2–12 previously followed the scenario toggle (they read the same scenario-driven `result`); they now render FLAT because AdvisorMain's retained call is fixed-flat and only `OutlookProjection` responds to the scenario picker. Operating console = assumption-light; scenario picker = Outlook only. Simple Mode was already flat (`advisorRows` btcGrowthRate:0) — no change there. This Month's Plan is unchanged either way (row[0] price is rate-independent: exponent 0).

---

## Mining Tab

Per-device: `soloMining`, `poolName` (cosmetic), `poolFee` (EV math). No hardcoded pool names.
- Electricity = fiat overhead, never deducted from sats
- `data-no-toggle` on sliders/toggles prevents card click-to-enable
- Strategy cards = fixed presets patching `soloMining`, independent of per-device state
- `MiningOddsBar` reads devices from store directly
- `fmtMining` sats math inlined in `format.ts`
- Projection scrubber in `MiningProjectionTable`, not sidebar

---

## Power Law (`powerLaw.ts`)

```typescript
export const PL_B = 5.82; PL_A_FAIR = 1.16e-17; PL_A_FLOOR = 0.42e-17;
export const PL_A_CEILING = 10 ** -16.12; GENESIS = new Date('2009-01-03T00:00:00Z');
```

Three independent A constants — never `PL_A_FAIR × scalar`. Data: Blockchain.com (dev direct, prod via `/api/btc-history` proxy). Block height: mempool.space. Halving computed from block height only.

---

## Dollar Formatting

```typescript
// Shared — exact, no sign
export const fmtUSD = (n) => '$' + Math.round(Math.abs(n)).toLocaleString();

// SummaryBar LOCAL — sign-preserving (NEVER replace with shared fmtUSD)
function fmtUSD(n) { return (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString(); }

// Chart Y-axis — abbreviated (exact causes label overlap)
(v) => v >= 1e6 ? '$' + (v/1e6).toFixed(1) + 'M' : v >= 1000 ? '$' + Math.round(v/1000) + 'k' : '$' + v
```

---

## NumberInput

`prefix` (e.g. `'$'` or `'₿'`) renders before the number. `suffix` renders inside the input — **avoid suffix for BTC amounts** (cursor issues). Omit `decimals` to let user type freely. Use an external label or hint for units instead. Suppresses the `value → raw` re-sync while focused (fixes mid-type clobber on high-decimal fields like BTC amounts); formats to `fmt(clamped)` on blur.

---

## Design Tokens

```css
--orange: #E8836A  --green: #4ECB82  --red: #E85A4F  --amber: #E8A84A
--bg-app / --bg-base (both #09090E, darkest)  --bg-card #111318 (slightly lighter)  --bg-input  --bg-hover
--text-primary / secondary / ghost / muted / faint  --border
/* Daily Mode P4a (mode-toggle-preview.html) — layered surfaces + accents, additive: */
--surface #0e1219 / --surface-2 #151b25 / --surface-3 #1c2431  --line / --line-2 (translucent white borders)
--btc #f7931a (bitcoin accent, distinct from --orange)  --mono (mono font stack)
```
`--bg-base: #09090E` (= `--bg-app`) is defined in `tokens.css` — it had been referenced in 25 places across
15 files but never defined (resolved transparent: 23 `background:` uses masked by the dark app bg, 2
`color:` uses = invisible dark-on-bright button text in SafetyDashboard, both fixed by the one definition).

---

## Mobile Responsive

- Tab bar: `overflow-x: auto`, short labels ≤640px
- All tables: wrapped in `overflow-x: auto; -webkit-overflow-scrolling: touch`
- 4-col grids (Tier, Strategy): `overflow-x: auto` container, keep 4 cols
- 3-col grids (Mining): same
- CB Loan stat grid: 2-col at ≤640px
- All `.main`: `padding: 16px` at ≤640px
- `[data-active-tab="bloc"] .sidebar`: `overflow: hidden; padding: 0` (InputsPanel handles internally)

---

## Test Suite

398 tests — `npx vitest run` before every commit.
- `smartBloc.test.ts` — uses `runBLOC` (not `runBlocYearOne`)
- `simpleModePlan.test.ts` — `deriveForMonth` (unskipped projection; monthly vs ltvTriggered CB; !hasCbLoan zeros CB; distinct rows → distinct values), `isOperatingMonth`, `composeMonthSummary` (clause inclusion + skip branches + past-tense logged), projection-vs-reality guarantee (deriveForMonth is skip-param-free; monthly CB payment drops row LTV below the start-of-month figure)
- `src/components/Daily/__tests__/dailyView.test.ts` — Daily Mode P4a pure helpers: `selectMonthEvents` (bucketEventToMonth filter, asc-by-ts sort, empty-month) + `describeDayEvent` per kind (draw/paydown USD; buy BTC ±usd; deposit/withdraw target labels; cbCollateralReading BTC; balanceReading Strike-always + CB-when-present)
- `src/components/Daily/__tests__/calendarModel.test.ts` — Daily Mode P4c-1a pure calendar model (15 cases): `monthDateRange` (every date buckets back to its strategy month via bucketEventToMonth — load-bearing; contiguous+ascending; month 1 starts at advisorStartDate; boundary last-of-N/first-of-N+1 adjacency), `weekDates` (7 dates Mon→Sun, Monday-first incl. Sunday-input), `buildDayCells` (draw→[logged]; balanceReading→[reading]; both→both; cb-deposit→[logged,cbCollateral]; strike-deposit→[logged]; empty→[]; weekday Mon=0..Sun=6), timezone no-drift (exact yyyy-mm-dd near a month boundary)
- `src/components/Daily/__tests__/eventSheet.test.ts` — Daily Mode P4b-1 pure helpers (import `../eventSheetModel`): `readingComplete` gate matrix (Strike-only when !hasCbLoan; +CB fields iff hasCbLoan) + `buildEventsFromSheet` per type (setBalance→[reading]; draw/paydown→[flow,reading] USD; buy→[buy usd=amount*price,reading] BTC; collateral→[deposit target,reading], target strike+cb, defaults strike when !hasCbLoan), reading carries price, **LTV percent ÷100 → fraction (11.2→0.112)**, CB reading fields present iff hasCbLoan, flow+reading share ts with distinct ids
- `src/store/__tests__/planBars.test.ts` — `showPlan*Bar` default true, setters, device-local (hydrateSettings ignores them — absent from SETTINGS_FIELDS)
- `src/store/__tests__/relaySync.test.ts` — Option C: `buildSettingsPayload` INCLUDES `nostrRelays` + `buildViewerSnapshotPayload` settings STRIPS it; `hydrateSettings` relay guard (custom incoming replaces; empty/DEFAULT_RELAYS incoming guarded over a custom local list; applies when local is defaults/empty; order-independent sorted compare; skip-FIELD — a guarded relays field never blocks `income`); + the publish-trigger follow-on (`setNostrRelaysAndSync` sets the list AND marks `settingsDirty`; plain `setNostrRelays` sets it but leaves `settingsDirty` false — fake timers swallow the debounce)
- `src/store/__tests__/viewerPublishGate.test.ts` — `publishRecordsNow` viewerMode backstop: with full publish creds + `viewerMode:true` → returns false at the gate (`setNostrSyncing` never called); with `viewerMode:false` → passes the gate (`setNostrSyncing(true)` called) and only then fails at the stub-signer publish step (owner baseline unchanged)
- `cbMetrics.test.ts` — `cbMetrics` (ltv/liqPrice/triggerPrice/pctTo* + divide-by-zero guards), `accruedCbBalance` (null/0-day/30-day compounding), `activeLiqPrice` entered-vs-computed authority + cushion divergence, `barLevel`/`worseLevel` state selection, Strike 85% gauge, refactor-safety (cbMetrics == old inline Main/Sidebar formulas)
- `living.test.ts`
- `mining.test.ts`
- `monthlyLog.test.ts` — includes recomputeBtcHeld suite (+ collateralAdjustment chain math, pending in both derives) + 4 badge status tests
- `dailyMode.test.ts` — Daily Mode P1: `bucketEventToMonth` (date→month 1–12, clamp) + `rollupMonth` (flows draw/buy±usd/paydown; `target:'strike'` deposit/withdraw signed into `collateralDelta`, `target:'cb'` + `cbCollateralReading` journal-only/ignored; latest-`balanceReading`-by-ts stocks, `cbCollateral` never in entry; carry-forward `provisional` w/ priorStocks; empty→`{}`; entry never has collateralAdjustment/btcHeld/cbCollateral/source/confirmed; date-boundary isolation). P2a: `deriveCbCollateral` (latest cbCollateral-bearing event by ts across both kinds; cache fallback; ignores readings w/o cbCollateral)
- `src/store/__tests__/dailyModeStore.test.ts` — Daily Mode P2a store: add(draw+balanceReading)→entry flows+stocks/source:daily/btcHeld intact; buy→btcHeld; **C1 double-count** (two strike deposits + edit-one + delete-one each net once via getCurrentBtcHeld); target:cb journal-only (no collateral change; cb-only month creates NO entry / doesn't flip a manual month to daily; mixed cb+draw month is daily via the draw) + cbCollateral feeds the clock; **BUG1** (cbCollateralReading creates no monthlyLog entry); Partial→Full preserves miningSats/ndpPaid/loggedAt; **C2** (setCbCollateralBtc emits a cbCollateralReading, absent from buildSettingsPayload); **M2** guard (non-daily upsert vs a daily month blocked); confirmMonth + reopen-on-edit; date-change re-rolls both months; `migrateState` v19 backfill (source/confirmed, cbCollateralReading seed for hasCbLoan, cbLtvAction default, cbCollateralBtc reproduced); `partializeState` includes dayLog+cbLtvAction. **P3:** `deleteDayEvent` writes a numeric `deletedDayEvents[id]` + removes the event; a journal-only `addDayEvent(cbCollateralReading)` sets `recordsDirty` + leaves `monthlyLog` empty (publish trigger for the no-month path); raw `setDayLog([cbColl@ts1, cbColl@ts2])` derives `cbCollateralBtc` to the newest (the fold) WITHOUT rerolling monthlyLog; `setDeletedDayEvents` raw-set; `partializeState` includes `deletedDayEvents`
- `src/store/__tests__/collateral.test.ts` — dated-collateral store actions on the REAL store: adjust, graduation (current-month only, preservation, negative), delete recompute + current-month pending-restore, baseline stability, sandbox isolation, settingsDirty marking; Strike LTV tracks getCurrentBtcHeld() (current), not the frozen baseline
- `src/store/__tests__/clearViewerData.test.ts` — `clearViewerData()` resets viewer-hydrated fields (monthlyLog→[], deletedMonths→{}, strike*→null, financial SETTINGS_FIELDS→seeds, viewerDataLoaded→false) — the data-remanence fix
- `src/lib/store/__tests__/storeCrypto.test.ts` — Phase B encrypted persist adapter (PIN path, in-memory localStorage shim): setItem writes a {ct,iv} envelope (NOT plaintext) + getItem decrypts it; LOCKED (no key) → getItem null + setItem writes NOTHING; plaintext (non-envelope) passthrough; wrong key → getItem null (no throw)
- `src/lib/store/__tests__/storeMigration.test.ts` — Phase C migration (PIN path, localStorage shim, `decryptBlob` vi.mock for the fault path): plaintext→encrypted round-trips to the EXACT original + idempotent; **VERIFY-BEFORE-DELETE — a forced verify mismatch returns false AND the plaintext SURVIVES** (the critical encryption-arc test); no-key → false untouched; encrypted→plaintext restores exactly; decrypt failure → false, envelope intact
- `src/store/__tests__/writerKeyStandalone.test.ts` — the wrap credential is standalone-backed: `setWriterKeyWrapped`/`setWriterKeyWrapMeta` write through to `personal-bloc-writer-key-wrapped`/`-meta` (NOT the persist blob); setting null clears them
- `src/lib/store/__tests__/escapeHatch.test.ts` — escape hatch: `resetPlanToSeeds` (plan/records/strike → seeds; writer credential + nostr identity/relays PRESERVED); `resetAndResync` is now RELOAD-BASED — clears all four (enc flag + pending-decrypt marker + on-disk `personal-bloc-store` blob + in-memory key via `clearStoreEncryptionState`) then `window.location.reload()` (node `window`/`localStorage` shims; `reloadMock`); idempotent (no flag/blob/key → still reloads, no throw); + **THE STRUCTURAL GUARANTEE — the module references NO publish symbol** (source-read assertion — a push is impossible by construction, relay data can never be erased)
- `mergeRecords.test.ts` — per-month entries merge table: union, newest-wins, loggedAt fallback, tie rule, tombstones, 90-day GC, string-key coercion. P3 dayLog block: union-by-id, higher-ts-wins (edit in place), exact-ts tie→local, tombstone-newer→suppressed, edit-after-delete→survives + stale tombstone dropped, >90d GC, idempotent
- `aprAnchors.test.ts` — pins APR unit conventions (runCoinbaseLoan=percentage, runBlocYearOne=decimal)
- `strikeCredit.test.ts` — strikeAvailableCredit = min(line, collateral×50%) − drawn; computeStrikeLtv (value + zero-collateral/price guards)
- `src/hooks/__tests__/useBtcHistory.test.ts` — pure `parseCandles` (newest-first → asc, close index 4, s→ms, slice newest `count`, empty/malformed guards) + `RANGE_CFG` (1H/1D/1W granularity/count ≤300)
- `src/lib/nostr/__tests__/keyVault.test.ts` — PIN-path wrap→unwrap round-trip (PBKDF2→HKDF→AES-GCM), wrong-PIN rejects, malformed-meta throws, PIN-required guards, fresh salt/iv per wrap (the PRF/Face-ID path needs WebAuthn — verified on-device, not jsdom); + Phase-A store-key suite: deriveStoreKey round-trips encryptBlob/decryptBlob, is independent of the nsec-wrap key (same pin+salt, different HKDF info → can't cross-decrypt) while the wrap path still unwraps, wrong-pin blob rejects, random IV per encrypt; + 3a.1 `deriveStoreKeyFromNsec` suite: deterministic (same nsec+pubkey round-trips), nsec-dependent + pubkey-salted (cross-decrypt throws), independent from the nsec-wrap key (can't decrypt the wrap ciphertext), and does not mutate the caller sk
- `src/lib/nostr/__tests__/ownerGate.test.ts` — `isOwnerPubkey`: matches the owner, rejects a non-owner/null key when configured, unset/empty env → true (no lockout)
- `src/lib/nostr/__tests__/proxyAuth.test.ts` — `getProxyAuthHeader` token cache: caches within ~50s (signs once), re-signs after expiry / on url change / on method change, returns the `"Nostr "` scheme prefix (mock signer, stubbed `Date.now`, `resetProxyAuthCache` per case)
- `src/lib/nostr/__tests__/relays.test.ts` — `normalizeRelayUrl` (passthrough/trailing-slash/lowercase/prepend-wss/reject-http/reject-garbage/localhost-ws/reject-nonlocalhost-ws), `addRelay` (append/dup/invalid), `DEFAULT_RELAYS` shape; + P2 `importNip65RelayList` (mocked pool: found→all-r-tags flat + normalize/dedupe, newest-event-wins, no-event→{found:false}, throw→{found:false}, no-usable-r-tags→{found:true,relays:[]})
- `src/lib/nostr/__tests__/publishRelayList.test.ts` — P2 `publishRelayListNip65` event-shape (mocked signer+pool): PLAIN kind-10002, content '', flat `r` tags, `signer.nip44.encrypt` NEVER called (G2), publishes to `publishTo` when wider than the tag list
- `src/hooks/__tests__/useRelayStatus.test.ts` — P3 pure `readyStateToStatus` mapping (1→connected, 0→connecting, 2/3/other→offline); the hook's socket lifecycle is device-verified, not unit-tested
- `src/lib/nostr/__tests__/ownerAuth.test.ts` — `validateOwnerRequest` (imported from `api/_lib/ownerAuth.js`): valid owner-signed token → `{ ok: true }`; wrong/non-owner key → 403; expired ts / url mismatch / method mismatch / malformed token / missing header / unset owner → 401 (real schnorr via `finalizeEvent` + test keys)
- `src/hooks/__tests__/useMorphoRate.test.ts` — pure `parseMorphoRate` (GraphQL `state.borrowApy`/`netBorrowApy` fraction → percent ×100; per-field independence; malformed/empty/null → nulls, no crash)
- `src/lib/nostr/__tests__/sync.test.ts` — settings watermarks + settings-dirty receive gate, records merge-apply (legacy array + v2 payload), relay-behind dirty flag, fetchAndSync boolean (decrypt failure → false, nothing applied), publishEncrypted first-ACK. P3: a records payload carrying dayLog/dayLogDeletions → setDayLog/setDeletedDayEvents called with the merged values; a legacy payload without dayLog hydrates safely (defaults []/{}, no throw)
- `src/store/__tests__/viewerSnapshot.test.ts` — viewer snapshot builders: owner viewer-config (viewerNpub/Pubkey/Label) IN buildSettingsPayload but STRIPPED from snapshot.settings (+nostrRelays); the Option-B shape (settings+records+strike+**cbCollateralBtc** P3); **P3 BUG2** — snap.cbCollateralBtc === deriveCbCollateral(dayLog,cache) (newest reading, not the cache) + snap.records has entries+deletions but NOT dayLog; viewer-side fields device-local
- `src/lib/nostr/__tests__/viewerSync.test.ts` — P3 viewer hydrate (mocked SimplePool + NSecSigner decrypt + store getState/setState): **BUG3** — a snapshot raw-sets cbCollateralBtc AND leaves dayLog empty + NEVER calls setCbCollateralBtc (no spurious cbCollateralReading injected into the viewer's journal); a pre-P3 snapshot without the scalar keeps the existing value (?? fallback); a revoked snapshot → clearViewerData, scalar NOT applied
- `src/lib/nostr/__tests__/log.test.ts` — nostrLog ring: 50-cap, newest-last, clear
- `src/lib/nostr/__tests__/deviceTag.test.ts` — stable persisted tag, 'anon' fallback, platform label prefix
- `src/lib/nostr/__tests__/liveSync.test.ts` — singleton: double open → one sub, close+reopen, no-pubkey guard
- `src/lib/nostr/__tests__/session.test.ts` — `waitForNostrExtension` (the async-injection-race fix): already-present → true immediately; injected mid-poll (fake timers) → true; absent through the timeout → false
- `src/lib/nostr/__tests__/restoreSignerSingleFlight.test.ts` — `restoreSigner` single-flight (Bug 2): two concurrent calls share ONE ceremony (`unwrapSecretKey` invoked once) + resolve to the SAME signer (stub NSecSigner + mocked unwrapSecretKey, no real crypto); a later non-concurrent call runs the worker again (guard cleared on settle); + #5 live-method re-verify: a method flipped to 'nip46' between the entry destructure and the pre-unwrap guard (counter-backed getter on a `getState` spy) bails BEFORE `unwrapSecretKey` (no spurious passkey) and returns the current signer

When `BlocYearOneInputs` gains new required fields, add defaults (e.g. `btcGrowthRate: 0`) to any test fixtures.

---

## Build & Deploy

```bash
npm run build && npx vitest run && git add . && git commit -m "..." && git push   # Vercel auto-deploys on push (local vercel CLI removed)
```

`npm run build` = `tsc -b && vite build` — this is the REAL typecheck gate. Run it (not bare `tsc`) before every commit.

**⚠️ The typecheck gate:** root `tsconfig.json` is references-only (`"files": []`), so `tsc` / `tsc --noEmit` is a NO-OP that compiles nothing and always reports 0 — it never catches type errors. The real typecheck is **`npx tsc -b`** (build mode, what `npm run build` runs). Vercel's `vite build` strips types with esbuild and does **not** typecheck, so type errors only surface via `tsc -b` locally.

`vercel.json`: `{ "buildCommand": "vite build", "outputDirectory": "dist", "framework": "vite" }`

**Build-version display:** `__BUILD_SHA__` / `__BUILD_TIME__` vite `define` constants (vite.config.ts:
Vercel `VERCEL_GIT_COMMIT_SHA` → local `git rev-parse --short HEAD` fallback → `'dev'`), ambient
declarations in `src/vite-env.d.ts`, rendered at the bottom of Settings (`.buildInfo`).

**⚠️ Cross-device testing:** before ANY cross-device smoke test, confirm both devices show the same
Build SHA in Settings — iOS home-screen PWAs are known to serve stale bundles after deploys; kill +
relaunch (or reinstall) the PWA until the SHA matches the latest deploy. With dev mode on, smoke-test
reports should include the Copy Diagnostics output from the failing device.

**Device-local persisted-but-unsynced fields** (persist via `...rest`, NOT in SETTINGS_FIELDS / the
publishSettingsNow payload / the partialize exclusion destructure — so they survive reloads yet never
publish or clobber across devices): `devMode`, `expenseReanchorDismissedAt` (the Outlook re-anchor
dismissal watermark, spec §9), `showPlanIncomeBar`/`showPlanStrikeBar`/`showPlanCbBar` (Simple Mode
plan-card status-bar visibility, default true), `simpleView` (`'monthly'|'daily'` consumer-shell view,
default `'daily'` — Daily Mode P4a), `writerKeyWrapped`/`writerKeyWrapMeta` (the writer
local-key signer's encrypted nsec + wrap meta — key material, MUST never leave the device; **persisted in
STANDALONE localStorage `personal-bloc-writer-key-wrapped`/`-meta`, NOT inside the persist blob** — they're the
credential that UNLOCKS the encrypted store, so they must be readable before/without decryption (else the
circular-dependency bug: the store key locked inside the data it decrypts). The store fields are
standalone-backed: seeded from those keys at module init (with a one-time back-fill from the legacy in-blob
location for existing plaintext users), write-through on set, and EXCLUDED from partialize),
`viewerMode`/`viewerWriterPubkey`/`viewerSecretKey` (viewer-side read-client config — this install's read-only
mode, the owner it follows, and a v17-migrant plaintext-nsec holder), and `viewerKeyWrapped`/`viewerKeyWrapMeta`
(Phase 3 — the viewer key wrapped at rest via keyVault; key material, MUST never leave the device). New per-device
prefs follow this pattern, NOT the in-memory exclusion list (which is for transient fields like
`nostrSyncing`/`sandboxCollateralBtc`/`viewerUnlocked`/`viewerDataLoaded`/`storeUnlocked`).
**At-rest store encryption — ⚠ USER-FACING FLOW REVERTED (lockout-proof).** The Phase B/C user flow (Settings
"Encrypt local data" toggle + `AppUnlockGate`/`StoreMigrationGate` render branches + the conditional encrypted
persist adapter) **locked users out twice on real iOS and has been removed.** The user-facing flow stays reverted —
Settings has NO toggle and AppShell renders NO `AppUnlockGate`. **Option-3a is now being rebuilt in steps behind the
MANUAL `storeEncEnabled` flag** (standalone `personal-bloc-store-enc-enabled`='1', set by hand; OFF by default → the
sections below are byte-identical no-ops). **3a.1** (done): `restoreSigner`'s local branch derives an nsec-rooted
store key at unlock (`deriveStoreKeyFromNsec`) and holds it — derivation only. **3a.2** (done): persist `storage` is
now flag-conditional — `storeEncEnabled ? createJSONStorage(() => encryptedStorage) : createJSONStorage(() =>
window.localStorage)`, and after `setStoreKey` the local branch calls `await useStore.persist.rehydrate()` so the
encrypted blob decrypts post-unlock (first hydration runs keyless → seeds → rehydrate after Face ID). The flag-on
cold-start path reuses the EXISTING `LocalUnlockGate` (already carries the escape hatch) — NO new gate; the adapter
never writes plaintext when locked; derivation/rehydrate failure is non-fatal (logs, login still succeeds).
**3a.3** (done): the local branch runs `migratePlaintextToEncrypted()` INLINE between `setStoreKey` and
`rehydrate()` — a flag-on cold start with an existing plaintext blob migrates it to the `{ct,iv}` envelope using the
nsec-derived key, **VERIFY-BEFORE-DELETE** (overwrite only after the ciphertext decrypts back === original; a failure
returns false WITHOUT writing → plaintext survives → rehydrate passthrough-reads it → login succeeds). No separate
migration gate (the key is already derived at unlock, unlike the original Phase C); idempotent, non-fatal. So with
3a.3 flag-on-your-REAL-store is now SAFE (the tested verify-before-delete is the net). **3a.4** (done): the four
gate-condition fields (`onboardingComplete`, `nostrAuthEnabled`, `nostrSigningMethod`, `nostrPubkey`) are now ALSO
persisted in standalone localStorage (`GATE_*` keys: `personal-bloc-onboarded`/`-nostr-auth`/`-nostr-method`/
`-nostr-pubkey`), seeded into the store initial state at module init (before hydration) and written through in their
setters — mirroring `writerKeyWrapped`. Fixes the encrypted-cold-start DEADLOCK: on a `{ct,iv}` cold start the blob
can't be read until unlock, but the `LocalUnlockGate` condition needs those four — locked inside the box the gate
would open → onboarding showed instead. Now they live outside the blob (kept IN the blob too — redundant, serves the
plaintext path; the standalone copy is the cold-start bootstrap), so the gate shows → Face ID → rehydrate → decrypt.
Fresh-install/flag-off parity: no `GATE_*` keys → seeds false/null, identical to the old constants. One-time
back-fill from a plaintext blob for existing users (same as the WK_* back-fill). **3a.5** (done): the human-facing
surfaces, split by audience. DEV — `DevPanel` gains an AT-REST ENCRYPTION section (status readout: flag /
blob-state {ct,iv}-vs-plaintext / store-key-in-memory / GATE_* keys + a flag toggle that reloads) as developer
maturation tooling (in-app diagnostics so the remaining device tests need no Mac console). The toggle is ASYMMETRIC:
ENABLE is RAW (just sets the flag + reloads — migration happens at unlock per 3a.3, NOT here); DISABLE decrypts-FIRST
(`migrateEncryptedToPlaintext`, verify-before-overwrite, guarded on `isStoreUnlocked()`) THEN clears the flag THEN
reloads → lands on clean plaintext (no seed-flash/half-state), mirroring the user opt-out so maturation toggling is
smooth; a locked state or failed decrypt leaves the flag ON (nothing lost). USER — `SettingsMain` RECOVERY gains a
"Turn off at-rest encryption (decrypt local data)" opt-out, shown ONLY when `!blobIsPlaintext() && isStoreUnlocked()`
(encrypted AND unlocked): `migrateEncryptedToPlaintext()` (verify-before-overwrite) → THEN clear the flag → THEN
reload — a failed decrypt short-circuits BEFORE the flag is touched (encryption stays on, nothing lost). The opt-out
lives in RECOVERY (not the dev panel) so a non-dev user can always exit. **No prominent enable-toggle** — encrypted-
by-default is the earned end state (later default-on flip, NOT 3a.5). The flag stays OFF by default; it's a
module-load constant, so both surfaces reload to apply. **3a polish** (from the 3a.5 device round-trip): **Bug 1
FIXED** — the plaintext cold-start seed-flash (`LocalUnlockGate.unlock` now `await
useStore.persist.rehydrate()` before `setIsAuthenticated`, so async plain-localStorage hydration lands before the
gate dismisses; the encrypted path already rehydrated inside `restoreSigner`). (`resetAndResyncFromGate` is now
reload-based per the teardown-desync fix — it no longer rehydrates-then-flips-auth; it clears encryption state +
reloads into the normal boot path.) **Bug 2 FIXED** — the
`LocalUnlockGate` escape's double-Face-ID loop → `NostrAuthGate` bounce. Root cause CONFIRMED from device logs: the
escape path's `restoreSigner` and a reactive `syncNow`'s `restoreSigner` (via `useNostrSync`) fired CONCURRENTLY →
two WebAuthn ceremonies at once → one aborts (AbortError), the other loops (NotAllowedError). Fix: a **single-flight
guard on `restoreSigner`** (module-level in-flight promise mirroring syncNow — the public `restoreSigner` wraps the
renamed `doRestoreSigner` worker; concurrent callers share ONE ceremony AND the SAME signer, `.finally` clears the
guard). `useNostrAutoRestore` was ruled out (early-returns for `'local'`); the second caller was `syncNow`. The
`[3a-bug2]` instrumentation was removed. The primary Settings→RECOVERY escape works; the escape hatch never publishes
(structural) so the loop never threatened data. **Bug 3 FIXED** — the unlock double-flash: `restoreSigner` sets
`nostrSigner` internally mid-`unlock()` (across `unlock`'s await boundaries), which tripped AppShell's `!nostrSigner`
`LocalUnlockGate` condition (AppShell.tsx:310) and UNMOUNTED the gate before `isAuthenticated`+rehydrate completed →
fell through to `NostrAuthGate` (Flash A) or seed-data `SimpleModeView` (Flash B) for 1–3s. Fix (two scoped gate-chain
edits): `LocalUnlockGate` now holds until `isAuthenticated` (dropped `!nostrSigner` from its condition) so a
mid-unlock signer-set can't unmount it; and the `NostrAuthGate` fallthrough (312) is guarded with `!nostrSigner` so a
present signer never shows the re-auth screen (verified safe — every NostrAuthGate handler sets signer→`isAuthenticated`
synchronously/batched, and the nip07/46 reload path sets auth optimistically before the signer). **Flash B
INSTRUMENTED (not yet fixed)** — the seed-data flash after the gate drops on a plaintext post-escape reload has only
a hypothesised render-timing cause (`rehydrate()` resolves before React re-renders with hydrated values), so —
mirroring the Bug-2 discipline — temporary `console.log('[flashB] …', Date.now(), …)` probes (tagged `// TEMP
[flashB] — remove after diagnosis`) were added at three points to confirm on-device before fixing: `LocalUnlockGate`
`unlock()` (before/after `rehydrate()`, after `setIsAuthenticated`), `SimpleModeView` render body, and the `AppShell`
render body. (Diagnosis done — the `[flashB]` probes have since been REMOVED.) With the flag OFF
(default) persist is plain `window.localStorage`. **⚠ Zustand v5 gotcha (regression fixed):
`storage: undefined` does NOT mean "default localStorage" — in v5 it hits the `if (!storage)` branch and DISABLES
persistence entirely** (warns "storage is currently unavailable" on every write, nothing saved → logout-on-refresh,
empty localStorage). The revert had set `storage: undefined`; it must be an explicit `createJSONStorage`. Use the
`() => window.localStorage` getter form (zustand's own default): real storage in the browser, while under Node
(tests, no `window`) the getter throws → `createJSONStorage` returns undefined → persist cleanly disables (the
pre-existing test posture) instead of building a broken adapter. A stranded `personal-bloc-store-enc-enabled` / `-pending-decrypt`
localStorage flag is now **inert** (nothing reads them to gate) → a previously stuck install loads normally on next
launch (the lockout occurred at the gate before any `{ct,iv}` envelope was written, so the blob is plaintext).
**RETAINED for an Option-3a redesign (nsec-derived store key, escape-hatch-first):** the Phase A primitives
(`keyVault` `encryptBlob`/`decryptBlob`/`deriveStoreKey`), `storeCrypto.ts` (adapter + holder), `storeMigration.ts`
(verify-before-delete fns), the `AppUnlockGate`/`StoreMigrationGate` component files (unrendered), `storeEncEnabled`
(now a dead export), `storeUnlocked` (transient), and the standalone writer-credential storage fix
(`personal-bloc-writer-key-wrapped`/`-meta`, partialize-excluded). The retained component/lib files carry the prior
design inline (+ git history) as the rebuild basis. **NOTE: the writer-side `viewerNpub`/`viewerPubkey`/
`viewerLabel` are NOT here — they are now SYNCED in the owner's settings:v1 (public npubs + the owner's nickname;
cross-device sharing config), stripped from the viewer snapshot. Only the viewer-SIDE fields stay device-local.**

**Dev mode:** 5 taps on the Settings Build row toggles `devMode` (persisted, DEVICE-LOCAL — never synced,
not in SETTINGS_FIELDS or the settings payload). DevPanel shows: sync state (metadata), signer probe
(nip44 encrypt→decrypt round-trip — on nip46 may surface a Primal approval), the Nostr log ring
(sessionStorage `'bloc-nostr-log'`, 50 entries, survives reloads, dies with the PWA), and copy-diagnostics.
**Privacy rule (refined):** anything that LEAVES the device must stay amount-free — Copy Diagnostics and
the log ring contain sync metadata only (never balances, amounts, incomes, expenses, or log-entry
contents; collateral is represented by a `pendingNonZero` boolean). The on-device PANEL may show position
figures in its COLLATERAL section — that's the point of on-device verification. `nostrLog()`
(lib/nostr/log.ts) is the standard for Nostr-layer logging (console mirror + ring) — new code uses it
instead of bare console.warn, and log messages never include amounts.

---

## Nostr Integration (Steps 1–3 ✅ Complete)

### Status

| Step | Description | Status |
|---|---|---|
| Step 1 | Auth gate — Nostr identity login | ✅ Complete |
| Step 2 | Encrypted relay publishing | ✅ Complete |
| Step 3 | Cross-device sync | ✅ Complete |
| Step 4 | publishRecords (monthlyLog) | ✅ Complete |

---

### Login Paths

| Method | Function | Notes |
|---|---|---|
| NIP-07 browser extension | NLogin.fromExtension() | Desktop; auto-restores on reload |
| Remote signer QR | NLogin.fromNostrConnect() | Desktop QR scanned with Primal iOS; persists across reload (nostrLogin) |
| Remote signer deep link | NLogin.fromNostrConnect() | Mobile two-step: warm relay → tap Open Signer App → approve → callback; persists across reload |
| Local key (Face ID) | `NSecSigner` + `keyVault` | **iOS-only** (Step 4); encrypted local nsec, Face-ID(PRF)/PIN unlock. Import behind a HARD BACKUP GATE; on relaunch an "authenticated-but-locked" `LocalUnlockGate` (gesture-driven unlock), NOT the full login. nip07/nip46 keep optimistic auto-restore |

### Writer local-key signer (Nostr Step 4) — `keyVault` + `'local'` method

Third auth option (additive; NIP-07/46 untouched): an **encrypted local nsec, iOS-only, Face-ID-unlocked**,
to give iOS one-tap reliability without the NIP-46 deeplink/QR race. Built on a NEW **identity-agnostic
`src/lib/nostr/keyVault.ts`** (PRF primary / PIN fallback, client-side, no server: PBKDF2→HKDF→AES-GCM via
WebCrypto; `wrapSecretKey`/`unwrapSecretKey`/`probeKeyVaultCapability`; unwrapped key in MEMORY ONLY,
never persisted) — shared infra the queued viewer-access phase reuses.
- **HARD BACKUP GATE (load-bearing):** the device copy is convenience, never the only copy — the wrap path
  is structurally unreachable until the user checks "I have my nsec backed up outside this device"
  (`NostrAuthGate` local flow, iOS-gated via `isIOS`). Losing the only copy = permanent data loss.
- **Launch-unlock gate (the wrinkle):** `useNostrAutoRestore` does NOT optimistically auth for `'local'`
  (Face ID needs a user gesture); `AppShell` renders `LocalUnlockGate` (a NEW branch BEFORE `NostrAuthGate`,
  gated `nostrSigningMethod==='local' && nostrPubkey && !nostrSigner && !isAuthenticated`) — tap to unlock →
  `restoreSigner` (`unwrapSecretKey` → Face ID) → signer set → `isAuthenticated`. Escape ("Use a different
  login") sets a local `unlockEscape` → falls through to `NostrAuthGate`. nip07/nip46 keep optimistic auth.
- `restoreSigner` gains a `'local'` branch (unwrap → `new NSecSigner(sk)` → pubkey-match → `sk.fill(0)`);
  `NSecSigner` is a drop-in `NostrSigner` so the whole publish/sync path is unchanged. `signerOpTimeout`
  treats `'local'` like nip07 (60s — human-in-the-loop). Settings shows a "Local · Face ID" badge +
  "Remove local key" (clears the wrapped key + signs out; reinforces backup). Switch semantics: setting up
  local makes `'local'` the singular method (a prior NIP-46 session is simply unused, no silent fallback).

### Owner-pubkey gate — app render + Strike fetch locked to the owner

The auth gate isn't just "authenticated" — it's **authenticated AS the owner**. `isOwnerPubkey(nostrPubkey,
import.meta.env.VITE_OWNER_PUBKEY)` (`src/lib/nostr/ownerGate.ts`, pure) gates both:
- **App render** (`AppShell`): the ternary is LocalUnlockGate → `<NostrAuthGate>` (`!isAuthenticated`) →
  **`<PrivateAppNotice>`** (`isAuthenticated && !isOwner`) → app. A foreign valid nsec sees "This app is
  private to its owner." + a "Use a different key" button (`reconnectNostr` — clears session, keeps the lock,
  reloads to the login). `!import.meta.env.DEV` preserved on the gate branches (dev bypass intact).
- **Strike fetch** (`useStrikeData(enabled)`): the effect early-returns unless `enabled` — AppShell passes
  `isAuthenticated && isOwner`, so `/api/strike-balances`/`/api/strike-rates` NEVER fire for an
  un-authenticated visitor or a non-owner key (closes a prior unconditional-fetch leak where the proxy
  response landed in any visitor's devtools).
- **`VITE_OWNER_PUBKEY`** = the owner's **hex** pubkey (matches stored `nostrPubkey`; not the npub), a
  build-time client env var (set in Vercel, never committed). **Unset-env fallback
  (load-bearing):** when unset (local dev / fork / misconfigured deploy) `isOwnerPubkey` returns true →
  degrades to "any authenticated key" (no lockout — a forgotten env var can't brick the app). Lockdown is
  active only when the var is set. Store v15 (no bump — env var, not state).
- **Viewer carve-out (DOCUMENTED, not built):** the queued viewer-access spec will change the non-owner
  branch to `isAuthenticated && !isOwner && !viewerMode` so a provisioned `viewerMode` viewer (a different
  pubkey) passes into the **read-only** render. The viewer's live Strike balances arrive via the encrypted
  `viewer:v1` snapshot (Option B — owner's device seals `strikeUsdBalance`/`strikeBtcAvailable` to the
  viewer's pubkey); the viewer renders them read-only with `useStrikeData(false)` and **never fetches**. The
  owner-only fetch gate is correct as-is for the viewer — do NOT add a viewer Strike-fetch path (and per
  NIP-98 the proxy 403s any non-owner key anyway).

---

### NIP-98 Proxy Auth — Strike proxies gated by owner-signed requests (the bundle holds NO secret)

The owner-gate controls *when the client fetches*; **NIP-98 is the server-side enforcement beneath it** — it
closes the deeper gap that `VITE_APP_PROXY_SECRET` used to be **embedded in the deployed bundle** (extractable
from devtools → anyone could `curl /api/strike-balances` with the secret and read the owner's balances; the
`STRIKE_API_KEY` itself never left the server). **`VITE_APP_PROXY_SECRET` / `APP_PROXY_SECRET` are REMOVED.**
- **Client** signs every Strike request with the authenticated Nostr key: `getProxyAuthHeader(url, 'GET',
  signer)` (`src/lib/nostr/proxyAuth.ts`) → `nip98.getToken` builds + signs a kind-27235 event →
  `Authorization: Nostr <base64>`. `useStrikeData.fetchAll` reads `useStore.getState().nostrSigner` (bails if
  null), builds **absolute** URLs from `window.location.origin` (the NIP-98 `u` tag must equal the request URL
  exactly), and sends the header. **Short-lived token cache (~50s, per url+method, in-memory):** NIP-98 events
  are valid ±60s and `useStrikeData` polls every 60s — on **NIP-46** signing is a remote round-trip, so the
  cache makes it ~1 sign per ~50s per URL instead of per-fetch prompt-spam (local/NIP-07 sign instantly).
- **Server** (`api/_lib/ownerAuth.js` → `validateOwnerRequest(authHeader, url, method, OWNER_PUBKEY)`, shared
  by all three Strike proxies — balances, rates, invoices): `validateToken` (kind/ts/url/method + `verifyEvent`
  schnorr sig) — handles BOTH the
  false-return AND the throw — then `unpackEventFromToken` → `pubkey === OWNER_PUBKEY` else **403**; missing/
  expired/bad-sig/url-mismatch → **401**. The `STRIKE_API_KEY` 503-guard stays first; the Strike fetch is
  unchanged. `_lib/` is `_`-prefixed so Vercel does NOT route it (bundled into each function's import graph);
  plain ESM `.js` so it imports in both the Vercel node runtime AND vitest.
- **The `u`-tag gotcha (get right on first deploy):** server validates against **`PUBLIC_ORIGIN` + req.url**
  (a configured env, robust over header reconstruction behind Vercel's edge). `PUBLIC_ORIGIN` must equal the
  deployment origin **exactly** (trailing-slash-sensitive) — a mismatch → 401 on every fetch. Client uses
  `window.location.origin`, which equals `PUBLIC_ORIGIN` on the real deploy.
- **Server env (new):** `OWNER_PUBKEY` (hex — the proxy's owner gate) + `PUBLIC_ORIGIN` (exact deploy origin).
  `OWNER_PUBKEY` (server proxy gate) and `VITE_OWNER_PUBKEY` (client UI gate) hold the **same** hex pubkey,
  two scopes. Store v15 (no bump — env + in-memory cache, no state).

---

### Known NIP-46/Primal Properties

- **SESSION DEATH ON NETWORK DROP** (proven via dev-panel diagnostics): a network drop kills the existing
  NIP-46 session on Primal's side; foregrounding Primal does NOT revive it; only a fresh NostrConnect
  handshake (the ⚠ Re-authorize stage of the affordance) restores service. Routine recovery cost:
  retry tap (~20s, fails) → Re-authorize → approve in Primal.
- **POISON-ENTRY WEDGE** (refined): the DETERMINISTIC blocker is a metadata-less (bunker-style) session
  in Primal (blank name / "unknown url") — it reliably hangs NEW nostrconnect handshakes for the same
  pubkey at "getting public key…" until removed. Dead but WELL-FORMED labeled sessions are at worst an
  INTERMITTENT blocker (re-auth observed succeeding with two lingering labeled iOS sessions; Primal is
  also actively patching nostrconnect). Per-device connect names make pruning confident; the auth gate
  shows a stuck-hint after ~15s on 'getting-public-key'. Primal-side (worth an upstream report).
- **DESKTOP SIGNER**: desktop uses a LOCAL-key NIP-07 extension (Alby) — out of Primal's session table
  entirely; signer probe ~27ms local vs ~2s over NIP-46. Only iOS uses NIP-46.
- **Connect identity**: nostrconnect name = `Personal ₿LOC · <platform>-<tag>` (e.g. `iOS-a3f2`) via
  `src/lib/nostr/deviceTag.ts` (`'bloc-device-tag'` in localStorage, never synced) — each device's
  session is distinguishable in Primal's connected-apps list.

---

### Dependency Stack (version pins are hard requirements)

nostr-tools: 2.23.5    ← pinned exact; NIP-44 + Primal decrypt verified working at this version
@nostrify/nostrify: ^0.52.2
@nostrify/react: ^0.6.2
websocket-ts: 2.3.0    ← pinned exact as a DIRECT dep at the tree-resolved version (no dupe copy);
                         used to cap NRelay1's reconnect backoff (see NostrProvider)

---

### Key Files

```
src/
  providers/
    NostrProvider.tsx               # NPool + NRelay1 context; wrap root in main.tsx. Reconnect backoff capped
                                    # via ExponentialBackoff(1000, 4) → max 16s between attempts (nostrify
                                    # default is UNBOUNDED doubling — strands NIP-46 after an offline period)
  pages/
    RemoteLoginSuccessPage.tsx      # Callback page Primal opens after approval
  components/Auth/
    NostrAuthGate.tsx               # Auth gate; NLogin.fromNostrConnect() wiring; calls markSignerFresh()
                                    # after setting the signer so syncNow doesn't rebuild a duplicate
                                    # NConnectSigner session post-login. + the iOS-only "Use a local key
                                    # (Face ID)" flow (hard backup gate → nsec decode → keyVault wrap → NSecSigner).
                                    # #4: optional onBack prop renders a "← Back to Face ID unlock" button in the main
                                    # options view (AppShell passes onBack=()=>setUnlockEscape(false) → falls back to
                                    # LocalUnlockGate; absent in first-time onboarding which passes no onBack). #6: when a
                                    # writerKeyWrapped already exists (e.g. after a local→nip46→local switch) the local
                                    # section shows "Unlock with Face ID" (handleUnlockExisting → setNostrSigningMethod
                                    # ('local') → restoreSigner) instead of forcing an nsec re-import; a "Use a different
                                    # key" ghost sets forceImport to reveal the import form, and a 'pubkey mismatch' throw
                                    # (different account) catch-and-falls-back to import with a message
    LocalUnlockGate.tsx             # "Authenticated-but-locked" relaunch screen for the 'local' method —
                                    # gesture-driven "Unlock with Face ID" (restoreSigner→unwrap) + Retry +
                                    # "Use a different login" escape; reuses NostrAuthGate.module.css
    ViewerUnlockGate.tsx            # Phase 3 viewer-key gate — unlock (wrapped) / one-time wrap-setup (v17 migrant);
                                    # populates viewerSync's in-memory holder. Reuses NostrAuthGate.module.css
    ViewerWaitingGate.tsx          # Data-remanence guard — "Waiting for the owner's data…" until viewerDataLoaded
                                    # (valid decrypt) + "Reset viewing key" escape (revoked viewer isn't trapped) +
                                    # "Copy my npub" (via getViewerNpub — derives the viewer's own npub from the
                                    # holder so a pending/revoked viewer can re-send it; banner has it too)
    AppUnlockGate.tsx              # ⚠ UNRENDERED (user-facing encryption reverted) — retained for Option-3a. Was:
                                    # Face ID / PIN → deriveStoreKey (keyed on writerKeyWrapMeta.scheme) → setStoreKey
                                    # + useStore.persist.rehydrate() → decrypt the blob. NOT imported by AppShell now
    StoreMigrationGate.tsx         # ⚠ UNRENDERED (user-facing encryption reverted) — retained for Option-3a. Was:
                                    # mode='encrypt'|'decrypt' migration gate (encrypt→migratePlaintextToEncrypted;
                                    # decrypt→migrateEncryptedToPlaintext→clear flag+marker→reload). NOT imported now
  hooks/
    useNostrAutoRestore.ts          # Optimistic session restore on reload — NIP-07 AND NIP-46 (via nostrLogin).
                                    # 'local' is SKIPPED here (no optimistic auth — LocalUnlockGate drives unlock).
                                    # RETRIES the syncNow restore ONCE (1.5s gap) before flipping isAuthenticated(false)
                                    # — defense-in-depth for the async window.nostr injection race (a slow extension
                                    # inject can outlast restoreSigner's own 3s wait). Only a genuinely-null signer
                                    # flips auth off; a failed sync with a live signer does not
  lib/nostr/
    publish.ts                      # publishEncrypted (→ Promise<number>), publishSettings, publishRecords (RecordsPayload
                                    # v2 — P3 += dayLog + dayLogDeletions, REQUIRED). ViewerSnapshot += optional cbCollateralBtc (P3 BUG2 scalar).
                                    # P2: publishRelayListNip65(signer,_pubkey,relays,publishTo?,opTimeoutMs?) — a PLAIN
                                    # (unencrypted) kind-10002 relay list (flat r tags, no read/write markers); MUST NOT
                                    # route through publishEncrypted/signer.nip44 (10002 is public). Both share the
                                    # private publishSignedToRelays tail (first-ack/all-reject/12s-timeout, pool close
                                    # after allSettled) — extracted from publishEncrypted, whose signature is unchanged
    keyVault.ts                     # identity-agnostic encrypted-key vault (PRF/Face-ID primary, PIN fallback;
                                    # PBKDF2→HKDF→AES-GCM via WebCrypto; wrap/unwrap/probe; key in MEMORY only,
                                    # never persisted). Shared infra: writer local-key now, viewer key later.
                                    # Phase A at-rest store enc (primitives only, NO store wiring): deriveStoreKey
                                    # derives an INDEPENDENT AES key from the SAME unlock via a distinct HKDF info
                                    # (STORE_ENC_INFO='personal-bloc/store-enc/v1') — one Face ID/PIN, two keys;
                                    # + encryptBlob/decryptBlob (AES-GCM string blob, random IV). deriveAesKey
                                    # gained a defaulted `info` param (nsec-wrap path byte-identical). Phase B wires
                                    # these into the persist adapter (lib/store/storeCrypto.ts) behind a flag.
                                    # 3a.1: deriveStoreKeyFromNsec(sk, pubkeyHex) — derives the store key from the
                                    # NSEC ITSELF (HKDF: salt=SHA256(pubkeyHex), info=STORE_ENC_INFO), no separate
                                    # credential. Deterministic + stable across reinstalls; independent from the
                                    # nsec-WRAP key (distinct info); copies sk (never mutates caller). In memory only
    session.ts                      # restoreSigner — rebuild signer from persisted login (no fetch/sync); exports NostrParam.
                                    # SINGLE-FLIGHT (Bug 2 fix): the public restoreSigner wraps doRestoreSigner in a
                                    # module-level in-flight promise (mirrors syncNow) — concurrent callers (gate escape
                                    # + reactive syncNow) share ONE WebAuthn ceremony + the SAME signer; two ceremonies
                                    # at once aborted one (AbortError) + looped the other (NotAllowedError).
                                    # 'local' branch: [#5: re-read LIVE nostrSigningMethod right BEFORE unwrap — if it
                                    # flipped off 'local' (a nip46 login racing auto-restore on a device with a leftover
                                    # wrapped key) RETURN the current signer, no WebAuthn, no spurious passkey prompt] →
                                    # unwrapSecretKey (→ Face ID) → new NSecSigner(sk) → pubkey-match →
                                    # [3a.1: storeEncEnabled ? deriveStoreKeyFromNsec(sk,pubkey)→setStoreKey, AFTER the
                                    # pubkey check, BEFORE sk.fill(0); + 3a.3: await migratePlaintextToEncrypted()
                                    # (verify-before-delete, idempotent) then + 3a.2: await useStore.persist.rehydrate()
                                    # (key now available → migrate plaintext→envelope, then decrypt + load real data);
                                    # flag-gated (OFF=no-op, byte-identical login) + try/catch NON-FATAL so login never
                                    # breaks] → sk.fill(0).
                                    # nip07 branch AWAITS waitForNostrExtension() (exported; polls window.nostr every
                                    # 100ms up to 3s) before throwing 'no extension' — extensions inject window.nostr
                                    # ASYNCHRONOUSLY on load, so a refresh that runs the restore effect first must wait,
                                    # else it silently logs the user out (fixed). Fails fast if genuinely absent
    log.ts                          # nostrLog ring buffer — pure; console mirror + sessionStorage 'bloc-nostr-log'
                                    # (50 entries, survives reloads, dies with the PWA); the STANDARD for
                                    # Nostr-layer logging — use it instead of bare console.warn
    timeout.ts                      # withTimeout + signerOpTimeout — pure (store-free); method-aware signer-op
                                    # timeouts: nip46 20s / nip07 + local 60s (human approval popup / Face ID)
    deviceTag.ts                    # getDeviceTag/getDeviceLabel — pure; stable per-device 4-hex tag
                                    # (localStorage 'bloc-device-tag', NEVER synced) → 'iOS-a3f2' etc.;
                                    # used in the nostrconnect name + DevPanel/diagnostics
    proxyAuth.ts                    # NIP-98 client token cache for the Strike proxies — getProxyAuthHeader(url,
                                    # method, signer) → nip98.getToken (kind-27235, Authorization: Nostr <base64>),
                                    # cached ~50s per (url,method) in-memory so NIP-46 doesn't round-trip per 60s
                                    # poll. resetProxyAuthCache() is test-only. See NIP-98 Proxy Auth
    sync.ts                         # applyRemoteEvent — THE single apply path for a remote event (both transports);
                                    # fetchAndSync → boolean (decrypt health; breaks loop on first decrypt fail);
                                    # settings watermark (read FRESH per event) + records MERGE (mergeRecords, 4-field:
                                    # entries+deletions+dayLog+dayLogDeletions). P3: generalized norm() canonicalizes all
                                    # four; write-back via setDayLog (folds the cbCollateralBtc derive) + setDeletedDayEvents
                                    # — actions-only (NO setState/deriveCbCollateral import); LD3 (no monthlyLog-from-dayLog);
                                    # does NOT manage the reconnect flag
    liveSync.ts                     # foreground-only live relay subscription — module singleton (openLiveSync/
                                    # closeLiveSync); transport only, every event → applyRemoteEvent; opened on
                                    # visible, torn down on hidden, fresh since−60s each open
    viewerSync.ts                   # Viewer Access Phase 2 (READ-ONLY) — the mirror of liveSync, but reads the
                                    # OWNER's snapshot (authors:[viewerWriterPubkey], #d:[VIEWER_DTAG]) and decrypts
                                    # with the VIEWER's key (NSecSigner(hexToBytes(viewerSecretKey).slice())).
                                    # fetchViewerSnapshot (batch) + open/closeViewerSync (singleton live sub) →
                                    # applyViewerEvent → read-only hydrate (hydrateSettings/setMonthlyLog/
                                    # setDeletedMonths/setStrike*); NEVER publishes/dirties. P3 (BUG3): raw-sets
                                    # cbCollateralBtc from snap.cbCollateralBtc via useStore.setState — NEVER setCbCollateralBtc
                                    # (it would inject a cbCollateralReading into the viewer's OWN dayLog); the viewer's dayLog
                                    # stays []. useViewerSync (hook) mounts it on foreground; gated on viewerMode
    syncNow.ts                      # THE single unified sync sequence — all entry points call this (restore-if-needed → relays-if-empty → fetch+merge → publish-if-dirty); honest result (true only if pull AND push-if-dirty succeeded); concurrent calls deduped to one in-flight run
    relays.ts                       # fetchUserRelays; NIP-65 kind:10002 discovery. DEFAULT_RELAYS = the SINGLE
                                    # source for the default relay list (store nostrRelays default + Network "Restore
                                    # defaults" + publish.ts FALLBACK_RELAYS + BOOTSTRAP_RELAYS all reference it — no
                                    # drift). normalizeRelayUrl (trim → prepend wss:// if no scheme → require wss:/
                                    # ws:-localhost → lowercase host → strip trailing slash → null on malformed) +
                                    # addRelay (pure normalize+dedupe+append → {list,error}) for the Network subpage.
                                    # P2: importNip65RelayList(pubkey) — reads the user's kind-10002 and returns a
                                    # DISCRIMINATED {found:true,relays} | {found:false}; UNLIKE fetchUserRelays it does
                                    # NOT fall back to defaults on no-event/empty/error (the caller must distinguish a
                                    # real list from nothing, else Import silently clobbers with the default 3). Flat:
                                    # ALL r tags (no write/read filter), normalize+dedupe, newest event wins; a 10002
                                    # with no usable r tags → {found:true,relays:[]} (distinct from not-found).
                                    # fetchUserRelays is LEFT UNTOUCHED (its sync-bootstrap caller wants the fallback)
    disconnect.ts                   # disconnectNostr — clears state + window.location.reload() to flush NPool
    signers.ts                      # connectNip07 only (connectNip46/connectNip46QR + SignerContext deleted)
  lib/store/
    storeCrypto.ts                  # At-rest store encryption (Phase B) — in-memory storeKey holder (getStoreKey/
                                    # setStoreKey/isStoreUnlocked, never persisted) + encryptedStorage adapter:
                                    # getItem decrypts the {ct,iv} envelope (locked→null, non-envelope→passthrough),
                                    # setItem encrypts (LOCKED→drops the write, NEVER plaintext). 3a.2: WIRED into
                                    # persist as the `storage` adapter WHEN storeEncEnabled (else plain
                                    # window.localStorage). The held key is the nsec-derived 3a.1 key (set at unlock).
                                    # clearStoreEncryptionState() — TEARDOWN SAFETY: clears ALL FOUR (enc flag +
                                    # pending-decrypt marker + on-disk `personal-bloc-store` blob + in-memory key) so a
                                    # later plaintext-adapter load can't misread a stale {ct,iv} envelope → seeds (the
                                    # "settings revert to defaults" desync). FIRST action of BOTH teardown paths
                                    # ("Remove local key" + escapeHatch.resetAndResync), which reload after
    storeMigration.ts               # migratePlaintextToEncrypted (3a.3: WIRED — restoreSigner calls it inline at
                                    # unlock, between setStoreKey + rehydrate) / migrateEncryptedToPlaintext (still
                                    # unused until 3a.5 opt-OUT). VERIFY-BEFORE-DELETE: never overwrite the source
                                    # until the new blob decrypts back === original; idempotent; use getStoreKey. +
                                    # blobIsPlaintext. Tested (incl. the critical verify-mismatch-keeps-plaintext)
    escapeHatch.ts                  # ESCAPE HATCH — resetAndResync(_nostr?): void. Now RELOAD-BASED (teardown-desync
                                    # fix): clearStoreEncryptionState() (enc flag + pending-decrypt + on-disk {ct,iv}
                                    # blob + in-memory key) → window.location.reload(). The identity (nostrPubkey/
                                    # nostrSigningMethod) is retained, so the NORMAL boot path repopulates: local unlock
                                    # gate → restoreSigner (3a no-op, flag off) → LocalUnlockGate.unlock → syncNow pulls
                                    # from the relay into the clean plaintext slate. Nuking the blob → boot hydrates to
                                    # seeds → lastSettingsSyncAt defaults null → the sync-apply guard (remoteTs >
                                    # lastSettingsSyncAt) does NOT block → relay data applies (so the bespoke in-line
                                    # pull — resetPlanToSeeds + dirty-clear + watermark-zero + restoreSigner +
                                    # fetchAndSync, and the 'ok'/'no-relays'/'no-auth' returns — was REMOVED; the boot
                                    # path replaces it). Still imports NO publish symbol (structural no-publish
                                    # guarantee preserved); the post-reload boot sync is dirty-gated, so a freshly-pulled
                                    # clean state can't push over real relay data. The `_nostr` param is retained for
                                    # call-site stability (unused). Wired into Settings (RECOVERY button) + LocalUnlockGate
                                    # ("Can't unlock — reset & re-sync"). resetPlanToSeeds is now app-orphaned (left as a
                                    # store action). KNOWN FOLLOW-ON: the persist adapter is chosen at MODULE LOAD from
                                    # the enc flag — a mid-session flag change doesn't swap the live adapter; the teardown
                                    # paths nuke+reload to stay coherent, but a structural fix (adapter re-reads the flag
                                    # per op) is deferred

vercel.json                         # Catch-all rewrite → index.html (required for SPA)
```

---

### Publishing Architecture

- `publishEncrypted()` — NIP-44 self-encrypt → kind:30078 → returns the published `created_at` on the
  FIRST relay ACK; other relays continue in the background; pool closes after ALL settle; 12s timeout;
  rejects AggregateError only if every relay rejects (watermark must not be stamped for a lost event)
- `publishSettingsNow()` — exported from the store; THE settings publish path (immediate, flag-managing,
  returns boolean — mirrors `publishRecordsNow`): builds the 34-field payload from current state, dynamic
  imports `publish.ts` (circular-dep avoidance); on success stamps `lastSettingsSyncAt` + clears
  `settingsDirty` + `nostrReconnectNeeded`; on failure sets `nostrReconnectNeeded` (dirty stays true →
  retried by `syncNow` exactly like records)
- `syncSettingsToNostr()` — thin wrapper called by every synced setter: marks `settingsDirty`
  SYNCHRONOUSLY (app close mid-debounce still retries next launch), then 2s debounce →
  `publishSettingsNow()`. Accepted micro-race: a setter firing during an in-flight publish re-marks
  dirty + re-schedules (~2s later); only loss window is full app close inside that ~2s
- `publishRecordsNow()` — exported from the store; immediate (no debounce); publishes the v2
  `RecordsPayload` `{ entries: monthlyLog, deletions: deletedMonths }`; returns boolean and STILL
  manages the flag itself (the log mutators call it standalone, outside syncNow): clears `recordsDirty` +
  `nostrReconnectNeeded` on success, sets `nostrReconnectNeeded` on failure (dirty stays true).
  **Gated on `viewerMode`** (`!isAuthenticated || !nostrSigner || !nostrPubkey || viewerMode → return false`):
  a read-only viewer IS authenticated with its own nsec, so the auth gate alone wouldn't stop it — the
  `viewerMode` term is the relay-side backstop for the read-only-viewer invariant. The owner has
  `viewerMode===false` so it's unaffected; the owner→viewer snapshot publish (`publishViewerSnapshotNow`,
  gated on `viewerPubkey`) is a SEPARATE path, untouched
- `FALLBACK_RELAYS`: = `DEFAULT_RELAYS` (damus, primal, nos.lol — relays.ts; used if NIP-65 discovery fails)
- NIP-65 relay discovery: `syncNow` fetches the user's kind:10002 when `nostrRelays` is empty and
  stores it; subsequent publishes go to the user's own relays
- `importRelaysFromNip65()` / `publishRelayListToNip65()` (Network P2) — exported from the store; the manual
  Network-subpage NIP-65 sync. Import calls `importNip65RelayList(nostrPubkey)` and `setNostrRelays` ONLY on a
  real found list (returns `{found,count,empty}` so the UI toasts the right message; absent/empty never overwrites).
  Publish guards `isAuthenticated && nostrSigner && nostrPubkey` and calls `publishRelayListNip65` (PLAIN kind-10002)
  to `[...nostrRelays, ...DEFAULT_RELAYS]` for reach. Both are out-of-band one-offs: they toggle only `nostrSyncing`
  (the orange dot) and DELIBERATELY do NOT touch `settingsDirty`/`recordsDirty`/`nostrReconnectNeeded` (flipping the
  reconnect flag would mis-fire the ⚠ Reconnect affordance)
- **Network feature COMPLETE** — P1 (local list add/remove/restore), P2 (NIP-65 import/publish), P3 (live status dots
  via `useRelayStatus` — owned NRelay1 probes, `idleTimeout:false`, NOT the NPool; see hooks/useRelayStatus.ts)

---

### Sync Architecture

- **All entry points call the single `syncNow(nostr)`** (lib/nostr/syncNow.ts): restore-signer-if-needed
  (NIP-46 rebuild throttled ~20s, also covers cold-mount restore) → relays-if-empty → fetch+merge →
  publish-if-dirty. Pull-merge-THEN-push — with merge-based receive this is safe and publishes the
  merged superset. The push step covers BOTH dirty records (`publishRecordsNow`) AND dirty settings
  (`publishSettingsNow`). **Honest result**: returns true ONLY when the pull and every attempted push
  succeeded; `nostrReconnectNeeded` is cleared only on full success and set on any
  signer-attributable failure; logs `'sync ok'` only on true success,
  `'sync incomplete (pull ok|FAILED, records ok|FAILED|skipped, settings ok|FAILED|skipped)'` otherwise
  (`skipped` = not dirty — never reported `ok` when nothing was pushed). Concurrent calls are **deduped to a single in-flight run** (AppShell + SettingsMain
  double-mount races share one promise). Auto-restore reverts optimistic auth only if it failed with no signer.
- Deduplicates relay events: takes highest `created_at` per d-tag before
  decrypting (prevents stale relay copies from overwriting fresh data)
- **Records receive is MERGE-based and unconditionally safe** (`mergeRecords`, per month): newest
  `updatedAt` (fallback `loggedAt`) wins; exact tie → local iff `recordsDirty`; tombstoned deletes
  (`deletedMonths`) beat older entries; entry newer than tombstone survives (re-log) and drops it;
  90-day tombstone GC. After merge: apply only if merged ≠ local (re-chained via `recomputeBtcHeld`);
  set `recordsDirty` if relay is missing something we have. NO receive gates.
- Settings hydrate on watermark AND `!settingsDirty` (mirrors records): `remoteTs > lastSettingsSyncAt`
  (whole-object LWW) — while local changes are unpublished, an older/foreign remote must not clobber
  them; `syncNow` pushes local first, then the watermark governs normally
- Decrypt-failure surfacing: `fetchAndSync` returns false when an event fails to decrypt (signer
  unreachable) and no longer touches the flag itself — `syncNow` (its sole caller) sets
  `nostrReconnectNeeded` from the boolean; the flag clears only on a fully successful sync.
  Parse failures are data-level skips (logged, no effect on the result)
- Signer-op timeouts are METHOD-AWARE via `signerOpTimeout()` (`src/lib/nostr/timeout.ts`, pure/store-free):
  nip46 20s (automated — rides out one capped relay-backoff window) / nip07 60s (human approval popup per op;
  a short timeout races the user's click). Wraps `nip44` decrypt/encrypt + `signEvent`; the decrypt loop
  **breaks on the first decrypt failure** (remaining events would fail identically). The nip07 RESTORE race
  in session.ts is also 60s. The 12s relay-publish timeout in publishEncrypted is separate and unchanged.
- Orange dot (`nostrSyncing`) shows during both publish and sync operations — hidden while
  `nostrReconnectNeeded` (the reconnect/re-authorize button replaces it at bottom-right)

---

### Live Sync (`liveSync.ts`)

Foreground-only relay subscription so the other device's publishes apply in ~seconds. Principles:
- **Durable state, ephemeral connections** — the sub is disposable: created on foreground, torn down on
  hidden, recreated with a fresh `since` every time. No keepalives, no reconnect state machines.
- **One apply path, two feeds** — every event goes through `applyRemoteEvent` (sync.ts), same as the
  batch pull; batch and live are transports only, zero new semantics.
- **Overlap is free, gaps are expensive** — `since = now − 60s` deliberately overlaps the batch path;
  appliers are idempotent/monotonic, and self-echo of our own publishes no-ops naturally (settings echo
  fails the watermark, records echo merges to identity).
- **Don't ring a dead phone** — the live handler skips decrypt attempts while `nostrReconnectNeeded` is
  set; the post-re-auth batch sync catches up.

Module singleton (`openLiveSync` idempotent / `closeLiveSync`); opt-in via `useNostrSync({ live: true })`
— ONLY AppShell mounts it live (SettingsMain stays batch-only). EOSE ignored (batch path owns history).
NOTE: at nostr-tools 2.23.5 `SimplePool.subscribeMany(relays, filter, params)` takes a SINGLE Filter,
not an array. D-tag constants `SETTINGS_DTAG`/`RECORDS_DTAG` are exported from publish.ts.

---

### Sync Triggers
Five entry points — all funnel into `syncNow()` — plus a receive-only live subscription:

| Trigger | Path |
|---|---|
| Login | NostrAuthGate ×3 (NIP-07, bunker URI, NostrConnect QR/deep link) → fire-and-forget `syncNow(nostr)` |
| Cold launch | `useNostrAutoRestore` (optimistic auth, reverts only if restore failed with no signer) |
| Tab visibility | `useNostrSync` visibilitychange → visible |
| Window focus | `useNostrSync` window `'focus'` → triggerSync — a visible desktop tab never fires visibilitychange; focus covers app/window switches |
| Live subscription | `liveSync.ts` while visible — receive-only transport (no syncNow); applies the other device's publishes in ≈1s desktop / 2–3s iOS (NIP-46 decrypt) |
| Manual button | "↻ Sync now" in Settings (via `useNostrSync().triggerSync`) |

- Reconnect affordance is **two-stage**: first tap retries (`triggerSync`); only if the retry still
  fails does the button escalate to "⚠ Re-authorize" (`reconnectNostr`) — transient failures recover
  without burning a NIP-46 session
- (Pull-to-refresh was removed — gesture + usePullToRefresh.ts deleted)

---

### Published Event Types

| d-tag | Contents | Trigger |
|---|---|---|
| `personal-bloc:settings:v1` | All 33 settings fields | Any synced setter (marks `settingsDirty`, 2s debounce → `publishSettingsNow`); retried by `syncNow` while dirty |
| `personal-bloc:records:v1` | Payload schema v2 `{ entries, deletions, dayLog, dayLogDeletions }` (legacy bare array + pre-P3 dayLog-less object readable — readers default `[]`/`{}`); entries carry `updatedAt?` (merge falls back to `loggedAt`); per-month entries merge + **P3 dayLog union-by-id + tombstones**, 90-day GC | Immediately after every upsert/delete AND every dayLog mutator (no debounce) via `publishRecordsNow` |
| `personal-bloc:viewer:v1` | **Viewer Access (Phase 1, writer-side).** Combined `ViewerSnapshot` `{ settings: buildSettingsPayload, records: { entries, deletions }, strike: { usd, btcAvail, rate } }` (Option B — carries live Strike balances) NIP-44-encrypted to the configured **viewer's** pubkey (`viewerPubkey`), not the owner's | Fire-and-forget `void publishViewerSnapshotNow()` in the success path of BOTH `publishRecordsNow` + `publishSettingsNow` (after the success log, before `return true`); gated on `viewerPubkey` set; **log-only** on failure (`'viewer snapshot failed'`) — NEVER touches `settingsDirty`/`recordsDirty`/`nostrReconnectNeeded`/`nostrSyncing`, so the owner's own sync result is independent. **Revoke** publishes the same d-tag with an empty payload + `revoked: true` (tombstone) via `publishViewerRevocationNow()` → the viewer wipes + exits (replaceable, supersedes the old snapshot) |

### Viewer Access (Phase 1 writer-side + Phase 2 read client)

The owner can provision a **viewer** (e.g. a family member) who gets a continuously-updated, **read-only**
encrypted copy of the full model + live Strike balances. **The viewer arc (Phases 1–3) is complete.** The
viewer key is now **wrapped at rest** (Phase 3) — see below; the plaintext `viewerSecretKey` survives only as
a v17-migrant holder until the one-time wrap.

**Phase 1 (writer-side):**
- **`buildSettingsPayload(s)`** (`useStore.ts`, exported) is THE single source of the settings object — consumed
  by BOTH `publishSettingsNow` AND the viewer snapshot. **It INCLUDES the owner's writer-side viewer config
  `viewerNpub`/`viewerPubkey`/`viewerLabel`** (so the owner's sharing config + nickname sync across the owner's own
  devices), but **EXCLUDES the viewer-SIDE fields** (`viewerMode`/`viewerWriterPubkey`/`viewerSecretKey`/
  `viewerKeyWrapped` — device-local). **`buildViewerSnapshotPayload` then STRIPS `viewerNpub`/`viewerPubkey`/
  `viewerLabel`** — AND `nostrRelays` (Option C — the owner's transport config) — from its `settings` (rest-omit
  destructure) so the viewer never learns who else the owner shares with, the owner's nickname for them, nor the
  owner's relay set — the **load-bearing boundary**, guarded by `viewerSnapshot.test.ts` + `relaySync.test.ts`
  (payload HAS them; snapshot.settings does NOT).
- **`buildViewerSnapshotPayload(s)`** = `{ settings: buildSettingsPayload(s) minus viewerNpub/viewerPubkey/viewerLabel,
  records: { entries: monthlyLog, deletions: deletedMonths }, strike: { usd, btcAvail, rate } }`.
  `publishViewerSnapshotNow()` seals it to `viewerPubkey` via `publishViewerSnapshot` (`VIEWER_DTAG =
  'personal-bloc:viewer:v1'`, NIP-44 to the viewer's key). Fire-and-forget, log-only — see the Published Event
  Types table.
- **`viewerNpub` / `viewerPubkey` / `viewerLabel`** (writer-side, the provisioned viewer + the owner's nickname for
  them): **SYNCED in the owner's own settings:v1** (public npubs — NIP-44 to self, no secret leak; viewer
  set/removed on one owner device propagates to all, and editing on any device publishes the snapshot because it
  has the synced `viewerPubkey`). Set/removed in Settings → NOSTR IDENTITY → VIEWER ACCESS (npub `nip19.decode`
  validated; optional nickname input above the npub; **Revoke** publishes a real-time tombstone then clears all
  three — see Revocation below). The
  VIEWER ACCESS row shows `viewerLabel` primary with the npub as ghost subtext — "Dad's iPhone (npub1abc…)" — or
  the npub alone when no nickname. (`viewerLabel` is the OWNER's private label — NOT the viewer's passkey name,
  which is authenticator-held and never transmitted.) The setters call `syncSettingsToNostr()`. **Saving a viewer
  npub fires `publishViewerSnapshotNow()` immediately**
  (`void`, fire-and-forget) so the viewer hydrates right away — without it the snapshot would only publish on the
  next settings/records edit (the "viewer sees no data until the owner makes an edit" gap).

**Phase 2 (viewer read client) — store v17:**
- A fresh install picks **"View someone else's plan (read-only)"** in onboarding (`OnboardingModal` step-1
  fork): it generates its own key (`generateSecretKey`), shows its npub for the owner to add, takes the
  **owner's** npub, then sets `viewerMode=true` + `viewerSecretKey` (hex) + `viewerWriterPubkey` and lands in
  the simple-mode dashboard.
- **`viewerSync.ts`** (mirrors `liveSync.ts`): batch `fetchViewerSnapshot()` + a singleton live sub, both
  filtered `{ kinds:[30078], authors:[viewerWriterPubkey], '#d':[VIEWER_DTAG] }` (SINGLE filter at 2.23.5).
  Builds one `NSecSigner(hexToBytes(viewerSecretKey).slice())` (**`.slice()` — the writer-signer ref bug**),
  `nip44.decrypt(viewerWriterPubkey, …)` → `{ settings, records, strike }` → **read-only hydrate**
  (`hydrateSettings`/`setMonthlyLog`(via `recomputeBtcHeld`)/`setDeletedMonths`/`setStrike*`). NEVER sets dirty
  flags, NEVER publishes. `useViewerSync` (hook) wires it on foreground; AppShell mounts it (no-op unless
  viewerMode).
- **READ-ONLY is two layers; structural is load-bearing.** (1) **No writer publish/sync path is reachable in
  viewerMode by construction:** AppShell passes `useNostrSync({ live: !viewerMode })`, and `useNostrSync`
  early-returns its whole effect + no-ops `triggerSync` when viewerMode → no `syncNow`/`openLiveSync`/`publish*`
  wired; the viewer's only data source is the owner's snapshot (re-hydrated live, overwriting any stray local
  edit). `useStrikeData(isAuthenticated && isOwner)` → the viewer is never `isOwner` so it **never fetches
  Strike** (Strike comes from the snapshot). (2) **UX:** the shared inputs (`NumberInput`/`Toggle`/`SliderInput`
  + the pill components) read `viewerMode` → disabled (covers all tabs' numeric/toggle/slider/pill inputs in one
  place; programmatic hydration is unaffected); the SimpleMode bespoke mutation controls (Pay/Skip pills, Log,
  Quick Setup, Edit-this-month) + SafetyDashboard inline editors are gated on `viewerMode`. The month scrubber
  stays enabled (view-only). Exhaustive per-control hardening of every tab is deferred — backstopped by the
  structural guarantee.
- **Owner-gate amendment:** all three auth-gate branches (LocalUnlockGate/NostrAuthGate/PrivateAppNotice) gain
  `&& !viewerMode` so a viewer install short-circuits straight to the app render (the spec's `|| viewerMode`
  carve-out). A slim amber **"👁 Viewing … · read-only"** banner sits atop the app body in viewerMode.
- **Data-remanence guard (decrypted data must not outlive the viewer key).** A viewer's hydrated financial data
  lives in the persisted Zustand store; clearing the viewer *key* alone left it rendering after revoke/reset (a
  revoked viewer correctly got "invalid MAC" — encryption held — but the OLD numbers still showed). Two parts:
  (1) **`clearViewerData()`** (store action) resets every viewer-hydrated field to its seed (financial
  `SETTINGS_FIELDS` + `monthlyLog` + `deletedMonths` + `strike*` + owner-config nulls); pure local `set`, **no
  `syncSettingsToNostr`**. Called from **VIEWER paths only** (audited): `resetViewer` (before `setViewerMode(false)`),
  `applyViewerEvent` decrypt-failure, `fetchViewerSnapshot` zero-events, onboarding viewer-provision (before
  `setViewerMode(true)`) — NEVER the owner's Remove or any owner edit (it would wipe the owner's real data; it has
  **no internal `viewerMode` guard** by design, because the onboarding call precedes `setViewerMode(true)`).
  (2) **`viewerDataLoaded`** (transient, non-persisted, in the partialize exclusion) is set true ONLY after a VALID
  `applyViewerEvent` hydrate; AppShell gates the viewer render on it — `viewerMode && !viewerDataLoaded` →
  **`ViewerWaitingGate`** ("Waiting for the owner's data…" + a **Reset viewing key** escape, essential because a
  revoked viewer unlocks fine yet never decrypts the re-sealed snapshot). So stale store data never renders for a
  key that hasn't validly decrypted a snapshot; the gate sits AFTER the unlock branches.
- **Real-time revocation (tombstone — Option A).** Settings → VIEWER ACCESS **Revoke** (was "Remove") calls
  `publishViewerRevocationNow()` (store, mirrors `publishViewerSnapshotNow`) BEFORE clearing the viewer fields —
  it seals an EMPTY payload + `revoked: true` (a `ViewerSnapshot` field) to the still-set `viewerPubkey`. The
  viewer's `applyViewerEvent` detects `snap.revoked` right after JSON.parse → `clearViewerData()` + return (no
  hydrate) → `viewerDataLoaded` false → `ViewerWaitingGate`. So the viewer EXITS the data in real-time (online via
  the live sub) or on reconnect (offline). `viewer:v1` is replaceable, so the tombstone supersedes the old
  snapshot (no NIP-09 needed). Fire-and-forget, log-only — never touches the owner's own sync.
- **Owner-only Settings hidden in viewerMode.** `SettingsMain` reads `viewerMode` and wraps the NOSTR IDENTITY +
  VIEWER ACCESS section, the SETUP section, the TAB VISIBILITY & ORDER section, and the DevPanel render in
  `{!viewerMode && …}` — a viewer sees none of the owner's identity/setup/layout/diagnostics (just a small
  "viewing a shared plan, read-only" note + the build row). The owner (viewerMode=false) sees everything unchanged.
- **`viewerMode` / `viewerWriterPubkey` / `viewerSecretKey`** are **device-local, NEVER synced** (not in
  `SETTINGS_FIELDS` / the payload / the partialize exclusion → persist via `...rest`; setters plain `set()`) —
  same discipline as `writerKeyWrapped`.

**Phase 3 (viewer key wrapped at rest) — store v18:**
- The viewer key is **wrapped at rest** with the EXISTING `keyVault.ts` (AES-GCM via Face-ID-PRF / PIN), mirroring
  the writer's local-key pattern (`NostrAuthGate` wraps → `LocalUnlockGate` unwraps). New device-local persisted
  fields `viewerKeyWrapped` (base64 AES-GCM ciphertext) + `viewerKeyWrapMeta` (`WrapMeta`) — **NEVER synced**
  (not in `SETTINGS_FIELDS`/payload/partialize-exclusion, persist via `...rest`), same discipline as
  `writerKeyWrapped`. `viewerSecretKey` is now ONLY a transient v17-migrant plaintext holder.
- **The unwrapped key NEVER touches serializable store state.** It lives in an **in-memory holder inside
  `viewerSync.ts`** (`unwrappedViewerKey`); `setUnwrappedViewerKey(sk)` (exported) sets/clears it, rebuilds the
  cached `NSecSigner`, and mirrors the **transient store boolean `viewerUnlocked`** (excluded from persistence)
  so AppShell can reactively gate. `getViewerSigner()` is arg-less (builds from the holder). The 3 read sites
  (`applyViewerEvent`/`fetchViewerSnapshot`/`openViewerSync`) guard on `!unwrappedViewerKey` and **back-fill the
  holder from a surviving plaintext `viewerSecretKey`** (v17 migrant keeps syncing pre-wrap).
- **`ViewerUnlockGate.tsx`** (mirrors `LocalUnlockGate`, reuses `NostrAuthGate.module.css`) — two modes off store
  state: **unlock** (`viewerKeyWrapped` set → `unwrapSecretKey` → holder) and **setup** (v17 migrant: `!wrapped`
  but plaintext present → one-time `wrapSecretKey` → store the pair, populate holder, `setViewerSecretKey(null)`).
  Ghost **"Reset viewing key"** → `onReset`.
- **AppShell gate** (before the writer branches, `!import.meta.env.DEV`): `viewerMode && viewerKeyWrapped &&
  !viewerUnlocked` → `<ViewerUnlockGate>` (must unlock before render); `viewerMode && !viewerKeyWrapped &&
  viewerSecretKey` → `<ViewerUnlockGate>` (migrant one-time wrap, then falls through). `resetViewer` clears the
  wrapped pair + holder + plaintext + viewerMode/writerPubkey and re-opens onboarding (lossless — the snapshot
  stays on the owner's relay). **Recovery = re-provision** (fresh key + new npub).
- **Onboarding** (`OnboardingModal` viewer flow) wraps on provision: probe capability (+ PIN field if `'pin'`) →
  `wrapSecretKey(sk)` → `setViewerKeyWrapped`/`setViewerKeyWrapMeta` → `setUnwrappedViewerKey(sk)` (session
  unlocked, no re-prompt) → **NO plaintext stored**.
- **DevPanel** VIEWER ACCESS adds `key wrapped` + `unlocked` boolean rows (booleans only, never the key). (The
  `runViewerProbe` viewer-side decrypt still reads plaintext `viewerSecretKey`, so for a wrapped viewer it reports
  "no viewer key" rather than decrypting — event-presence query unaffected; decrypt-verify covers migrant + owner.)

### All 33 Synced Settings Fields
(`cbCollateralBtc` is a LOCAL derived cache, NOT a synced settings scalar — but Daily Mode P3 CONVERGES it cross-device by carrying `dayLog`/`dayLogDeletions` on the **records:v1** channel (NOT settings:v1); each device re-derives `cbCollateralBtc` from the merged `dayLog`.)
`income`, `expenses`, `blocApr`, `creditLine`, `advisorStartDate`,
`advisorActualBlocBalance`, `advisorMonthStartBalance`, `advisorActualBtcHeld`, `cbLoanBalance`,
`cbAprPct`, `hasCbLoan`, `ndpLastPaidDate`,
`tabOrder`, `hiddenTabs`, `simpleMode`, `btcBuyingUnit`,
`cbLiquidationPrice`, `cbMonthlyPayment`, `cbPaymentStrategy`,
`cbLtvTriggerPct`, `cbLtvTargetPct`, `cbRotateBackPct`,
`cbLoanBalanceAsOf`, `cbLiquidationPriceAsOf`, `strikeLiquidationLtvPct`,
`advisorSkipBlocDraw`, `advisorSkipCbPayment`, `advisorSkipBtcBuying`,
`pendingCollateralAdjustment`, `nostrRelays`, `viewerNpub`, `viewerPubkey`, `viewerLabel`
(The two CB `asOf` markers sync so freshness travels atomically with `cbLoanBalance`/`cbLiquidationPrice`.
`nostrRelays` (Option C) syncs across the OWNER's devices — identical-lists / replace-on-hydrate (add + remove both
propagate). `hydrateSettings` GUARDS it: a default-looking incoming list (empty OR exactly `DEFAULT_RELAYS`,
order-independent sorted compare) never overwrites a non-empty custom local list — skips ONLY that field, applies the
rest (skip-FIELD, not skip-all). Tradeoff: a deliberate reset-to-defaults doesn't auto-propagate (restore per-device).
User edits publish on their OWN via `setNostrRelaysAndSync` (the plain `setNostrRelays` stays for boot discovery) —
and Restore-defaults DOES publish `DEFAULT_RELAYS`, so the receiver-side guard is the load-bearing protector that keeps
that from wiping the other device's custom list (guard + trigger are complementary).
STRIPPED from `buildViewerSnapshotPayload` (owner transport config — a viewer reads via its own relay set).
`viewerNpub`/`viewerPubkey`/`viewerLabel` (the owner's writer-side sharing config + the owner's nickname for the
viewer) sync so viewer access propagates across the owner's devices — but `buildViewerSnapshotPayload` STRIPS all
three so the viewer never sees the owner's sharing config.
The three skips and `pendingCollateralAdjustment` are STANDING plan-shaping/position state with a settings-like write pattern — whole-object
LWW handles them like income or APR. `advisorChecklist` was REMOVED — per-month ritual ticking is
multi-writer ephemeral state, incompatible with LWW settings; that's why the skips sync and the
checklist was deleted. Old remote events missing/carrying extra fields hydrate cleanly: the
`SETTINGS_FIELDS` whitelist skips absent fields and ignores unknown ones.)

---

### Zustand Store Fields (Nostr)

| Field | Type | Persisted | Notes |
|---|---|---|---|
| `nostrAuthEnabled` | boolean | ✅ | **B1: DERIVED from `!!nostrPubkey` (signed-in), not an independent toggle.** `setNostrPubkey` sets it in lockstep + mirrors `GATE_AUTH_KEY` to `GATE_PUBKEY_KEY`; seed returns `!!pubkey`; migrate derives `!!(persistedState.nostrPubkey ?? seedNostrPubkey)`. Can't desync → kills the signed-in-but-auth-disabled half-state (the "unlock failed, no prompt" bug). `setNostrAuthEnabled` setter kept (disconnect calls it `false`); its true-path is dead. The "Enable Nostr Lock" toggle is now inert pending removal in Step 2 |
| `nostrPubkey` | string | ✅ | Hex pubkey |
| `nostrSigningMethod` | `'nip07' \| 'nip46' \| 'local' \| null` | ✅ | Login path used (`'local'` = iOS Face-ID signer) |
| `writerKeyWrapped` / `writerKeyWrapMeta` | `string \| null` / `WrapMeta \| null` | ✅ (device-local) | Encrypted writer nsec + wrap meta — **NEVER synced** (not in SETTINGS_FIELDS) |
| `viewerKeyWrapped` / `viewerKeyWrapMeta` | `string \| null` / `WrapMeta \| null` | ✅ (device-local) | Phase 3 — wrapped-at-rest viewer nsec + wrap meta — **NEVER synced**. Unwrapped bytes live only in viewerSync's in-memory holder |
| `viewerUnlocked` | boolean | ❌ | In-memory; true once viewerSync's key holder is populated (post-unlock/provision) — AppShell gates the ViewerUnlockGate on it |
| `nostrBunkerUri` | string | ✅ | NIP-46 reconnect |
| `nostrRelays` | string[] | ✅ | From NIP-65 discovery. **Option C: now SYNCED** across the owner's devices (in `SETTINGS_FIELDS`/`buildSettingsPayload`) — replace-on-hydrate, guarded so a default-looking incoming list can't clobber a real custom local one; stripped from the viewer snapshot. **User edits go through `setNostrRelaysAndSync`** (set + `syncSettingsToNostr` → marks `settingsDirty` → publishes on its own); the plain `setNostrRelays` is retained for the `syncNow` boot bootstrap (`fetchUserRelays` discovery) so fetched/default relays don't spuriously publish |
| `lastSettingsSyncAt` | number | ✅ | Unix ts of last relay hydration |
| `lastRecordsSyncAt` | number | ✅ | Unix ts of last records:v1 event seen — observability ONLY, not a gate |
| `recordsDirty` | boolean | ✅ | Publish-needed marker + merge tie-breaker ONLY (NOT a receive gate); set on local edit or when the relay is behind; cleared on successful publish |
| `settingsDirty` | boolean | ✅ | Per-device publish state — never synced (not in SETTINGS_FIELDS/payload); settings publish-needed marker AND settings receive gate; set synchronously by every synced setter; cleared on successful settings publish |
| `deletedMonths` | Record<number, number> | ✅ | month → deletedAt (Unix ms) tombstones for synced deletes; cleared per-month on re-log; 90-day GC in merge |
| `nostrLogin` | string | ✅ | JSON NIP-46 login (bunkerPubkey/clientNsec/relays/pubkey) — reconnect-free restore |
| `nostrSigner` | NostrSigner | ❌ | In-memory; recreated on restore |
| `isAuthenticated` | boolean | ❌ | In-memory; reset on reload |
| `nostrSyncing` | boolean | ❌ | In-memory; UI loading state |
| `nostrReconnectNeeded` | boolean | ❌ | In-memory; set on decrypt/publish failure → shows ⚠ Reconnect affordance (AppShell) |

---

## Critical Constraints

| Constraint | Rule |
|---|---|
| `SummaryBar fmtUSD` | Local sign-preserving — NEVER replace with shared version |
| Power Law A constants | Three independent values — never `PL_A_FAIR × scalar` |
| Mining electricity | Fiat overhead — 100% sats kept, never deducted |
| Mining strategy cards | Fixed presets — independent of per-device `soloMining` |
| `MiningOddsBar` | Reads store directly — not props |
| `fmtMining` | Inlined in `format.ts` — no circular import |
| `fiatGap` field | Named `fiatGap` in `AdvisorMonthRow` — never `fatGap` |
| `deriveAdvisorStart` / `deriveCurrentPosition` | Anchor to `last.btcHeld` (absolute) + `pendingCollateralAdjustment` as a REQUIRED param (never default it — the compiler must flag unthreaded surfaces); standalone — no imports from runAdvisor/runBLOC/runBlocYearOne. `deriveAdvisorStart`'s month-1 (empty-log) branch returns `startingBlocBalance: monthStartBalance` (the trailing param = `advisorMonthStartBalance`, the start-of-month base — NOT the live `advisorActualBlocBalance`, which is now the 3rd param `_advisorActualBlocBalance`, retained for signature stability but unused); the logged branch still returns `last.strikeBal` |
| `publishRecords` cadence | Immediate via `publishRecordsNow` (no debounce); NOT triggered by `setMonthlyLog` |
| Records merge | Records receive is MERGE-based and unconditionally safe (`mergeRecords`); `recordsDirty` = publish-needed marker + merge tie-breaker ONLY (not a receive gate); `lastRecordsSyncAt` = observability only |
| Settings LWW | Settings remain whole-object last-write-wins — last publisher wins the FULL object; only single-writer prefs belong in the payload (the checklist died for this) |
| Nostr reliability fix | Foreground/launch NIP-46 signer rebuild (`restoreSigner`, throttled ~20s inside `syncNow`) + merge-based receive + immediate records publish + decrypt-failure `nostrReconnectNeeded`; store stays v11 (no migration — `updatedAt?` optional, `deletedMonths` defaults `{}`) |
| Zustand v7 migration | Removes `customCollateral`; seeds `advisorActualBtcHeld` from it as fallback; adds `cbPaymentStrategy/TriggerPct/TargetPct` with defaults |
| Zustand v8 migration | Adds `btcPriceMode: 'live' \| 'manual'` (default `'live'`); typing a BTC price flips to `'manual'`; LIVE/SYNC button restores `'live'` |
| Zustand v9 migration | Adds `lastRecordsSyncAt` (seeded from old shared `lastSettingsSyncAt`) + `lastLocalChangedAt`; independent per-d-tag watermarks |
| Zustand v10 migration | Adds `nostrLogin` (JSON NIP-46 login) for session restore across reload |
| Zustand v11 migration | Adds `MonthlyLogEntry.btcHeld` (absolute) + `expensesActual`; resets `advisorActualBtcHeld` to month-0 baseline. The dated-collateral change (spec v4) ships WITHOUT a bump: `collateralAdjustment?` is optional and `pendingCollateralAdjustment` defaults via shallow merge |
| Zustand v15 migration | Adds `writerKeyWrapped`/`writerKeyWrapMeta` (writer local-key signer — AES-GCM ciphertext + WrapMeta, default `?? null`); additive shallow-merge, no transform. **Device-local, NEVER synced** (not in `SETTINGS_FIELDS`/payload). `nostrSigningMethod` gains `'local'`. **(Later moved OUT of the persist blob into STANDALONE localStorage** `personal-bloc-writer-key-wrapped`/`-meta` — they unlock the encrypted store, so can't live inside it; seeded at module init + back-filled once from the legacy in-blob location; partialize-excluded. The migrate row falls back to the standalone seed, not null.) |
| Zustand v16 migration | Adds `advisorMonthStartBalance` (start-of-month BLOC balance — projection base, distinct from live-drawn `advisorActualBlocBalance`); default `persistedState.advisorMonthStartBalance ?? persistedState.advisorActualBlocBalance ?? 0` (mid-month installs seed from the current live balance; fresh = 0). SYNCED (in `SETTINGS_FIELDS`/payload — real strategy state) |
| Zustand v17 migration | Adds Viewer Access Phase-2 fields `viewerMode` (default `?? false`), `viewerWriterPubkey`/`viewerSecretKey` (default `?? null`) — additive shallow-merge, no transform. **Device-local, NEVER synced** (not in `SETTINGS_FIELDS`/payload/partialize-exclusion). `viewerSecretKey` was plaintext (wrapped at rest in v18) |
| Zustand v18 migration | Viewer Access **Phase 3** — adds `viewerKeyWrapped`/`viewerKeyWrapMeta` (wrapped-at-rest viewer key: AES-GCM ciphertext + `WrapMeta`, default `?? null`) — additive shallow-merge, no transform. **Device-local, NEVER synced.** **Back-compat: LEAVES any existing plaintext `viewerSecretKey` in place** (wrapping needs a Face ID gesture, impossible in migrate — the one-time wrap-setup screen clears it). Transient `viewerUnlocked` (not persisted). |
| Zustand v19 migration | **Daily Mode P2a** — backfills legacy `monthlyLog` entries with `source:'manual'`/`confirmed:true` (only where undefined); adds `dayLog` (`?? []`, LOCAL-only) + `cbLtvAction` (`?? 'paydown'`). **C2 seed:** a `hasCbLoan` user with a `cbCollateralBtc` gets ONE seeded `cbCollateralReading` into dayLog so `deriveCbCollateral` reproduces the pre-migration value; then `cbCollateralBtc = deriveCbCollateral(dayLog, persisted)`. `migrate`/`partialize` were EXTRACTED to exported `migrateState`/`partializeState` (unit-testable — the persist API is unavailable under Node). Current store version = 19 |
| Zustand v14 migration | Adds `showPlanIncomeBar`/`showPlanStrikeBar`/`showPlanCbBar` (Simple Mode plan-card bar toggles, default `?? true`); additive shallow-merge, no transform. Device-local (NOT synced). (Intervening v12/v13 bumps preceded this.) |
| Zustand v12 migration | Adds `cbRotateBackPct` (default 55, reverse-rotation gate) — additive optional-default (`?? 55`), `...rest` carries everything else; in `SETTINGS_FIELDS`/settings payload (synced like trigger/target) |
| Zustand v13 migration | Adds `cbLoanBalanceAsOf`/`cbLiquidationPriceAsOf` (ISO date, default null) + `strikeLiquidationLtvPct` (default 85) — additive shallow-merge defaults (`?? null` / `?? 85`), no transform; all three SYNCED (in `SETTINGS_FIELDS`/payload — the `asOf` markers must travel atomically with their already-synced values). Current store version = 13 |
| `ltvTriggered` mode | Suspends CB priority rules (tier halve/stop draw); trigger IS the safety mechanism; `cbPaydownDraw` added to `blocBalance`; no CB payment from income. The Simple Mode CURRENT-month display (`SimpleModeView` `expectedBlocDraw`/`expectedBtcBuying`, gated on `isLtvTriggered`) mirrors this — full expense draw + income-funded BTC buying, NO tier gating (tier halving/zeroing stays for `monthly` mode only); projected months already read the engine |
| `ltvTriggered` band | Three-threshold band: `cbRotateBackPct < cbLtvTargetPct < cbLtvTriggerPct` (defaults 55/65/75). Forward rescue (Strike→CB) at/above trigger pays CB down to target; reverse rotation (CB draw→repay Strike) at/below rotate-back fills CB UP TO target; the neutral zone between rotate-back and trigger fires nothing. Reverse rotation is debt-neutral at the instant it fires and capped at `min(Strike balance, CB headroom-to-target)`. The 10-point default buffers prevent month-to-month oscillation. HISTORICAL FIX (v12): the reverse branch was previously mis-keyed to `cbLtvTargetPct` (collapsed the neutral zone → every-month rotation under growth); v12 added the proper `cbRotateBackPct` gate. Projection renders reverse rotation as green `↩` (`.rotateCell`), distinct from amber forward paydown and EXCLUDED from the Option-A trigger row-wash |
| `MonthlyLogOverlay` | React portal to `document.body` — same pattern as ToolsDropdown; centered modal (`.overlay` dim backdrop + `.modalCard`), header/arrows/dots inside the card; `initialMonth` 0-indexed; `openInEditMode` opens a logged month in the edit form |
| `strikeLtv` storage | Decimal (0.1483); multiply ×100 for display, divide ÷100 on save |
| Phase 4 priority | `creditExceeded` checked FIRST in phase classification |
| BLOC draw order | Draw → interest → LTV paydown (not interest → draw) |
| `runAdvisor` | Standalone — no imports from `runBLOC` or `runCoinbaseLoan` |
| `getCollateralForTier` | Uses starting `btcPrice` — not per-month price |
| Chart Y-axis | Always abbreviated — exact format causes label overlap |
| `NumberInput` suffix | Avoid inside input — cursor issues; use external label |
| Skip fields | Persisted + SYNCED via settings (standing plan-shaping prefs) — reset only when user toggles back to Pay |
| Tab hidden guard | `useEffect` in `AppShell` redirects when active tab hidden |
| `SettingsMain` ALL_TABS | Keep in sync with `AppShell` `ALL_TABS_META` |
| `computeLiquidationAnalysis` | Standalone — no imports from runBLOC/runAdvisor/runBlocYearOne |
| `cbLiquidationPrice` | Synced to Nostr (settings payload) along with cbMonthlyPayment/cbPaymentStrategy/cbLtvTriggerPct/cbLtvTargetPct/cbRotateBackPct; 0 = not set; guard with `liquidationPrice === 0` check before rendering modeler |
| `disconnectNostr` | Full sign-out — clears all nostr state INCL. `nostrPubkey` (auth auto-clears under the B1 pin) + removes the standalone GATE_* keys synchronously via the setters, then `window.location.reload()` to rebuild NPool clean; in lib/nostr/disconnect.ts. **Sign-out authority lives in the persist `merge`, not the racy blob:** the blob write isn't guaranteed to land before `reload()`, so a stale un-flushed `nostrPubkey` would (under the pin) resurrect auth — `gateHydratedIdentity` in the store's `merge` gates identity on the SYNCHRONOUS `GATE_PUBKEY_KEY` (removed by disconnect), so a stale blob can't sign you back in. (The fix is in `merge`, which runs on EVERY rehydrate; `migrate` only fires on a version bump, so it can't cover the same-version disconnect→reload.) **`merge`/`gateHydratedIdentity` gate BOTH `nostrPubkey` AND `nostrSigningMethod` on the live GATE keys (`GATE_PUBKEY_KEY` + `GATE_METHOD_KEY`), GATE-first with blob fallback — the racy blob is NEVER authoritative for identity. (A method-only gap once let a local-key login hydrate the stale blob `nip46` → nonexistent bunker signer → nip44 decrypt/probe timeouts → default data; gating method on the live `GATE_METHOD_KEY` fixed it.)** |
| `resetAndResync` (escape hatch) | RELOAD-BASED recovery that can NEVER erase relay data: `clearStoreEncryptionState()` (enc flag + pending-decrypt + on-disk `{ct,iv}` blob + in-memory key) → `window.location.reload()`. Identity retained → the normal boot local-unlock → `syncNow` repopulates from the relay into the clean plaintext slate (no bespoke in-line pull). Imports NO publish symbol (structural) + the boot sync is dirty-gated, so a freshly-pulled clean state can't push over real relay data. Returns void (it reloads — callers drop result handling). In `lib/store/escapeHatch.ts`; buttons in Settings + LocalUnlockGate. (`resetPlanToSeeds` is now app-orphaned — left as a store action.) See `clearStoreEncryptionState` / the teardown-desync fix |
| `reconnectNostr` | Revoke-recovery — clears only the dead SESSION (`nostrSigner`/`nostrLogin`/`nostrBunkerUri`/`isAuthenticated`) but **RETAINS the identity (`nostrPubkey` + `nostrSigningMethod`)** so the B1-pinned `nostrAuthEnabled` stays true → the auth gate (`nostrAuthEnabled && !nostrSigner`) reappears on the NIP-46 login; `nostrLogin` cleared so `restoreSigner` can't revive the dead session. (Pre-B1 it cleared pubkey + relied on an independent `nostrAuthEnabled`; that's gone now — clearing pubkey would clear auth.) The bottom-right `⚠ Reconnect` affordance AND the Settings "Reconnect" button both call it; in lib/nostr/disconnect.ts. NOTE: reconnect reload shows a brief (~1.5s) optimistic-auth flash before the gate (autoRestore early-returns only for `'local'`); a follow-up autoRestore guard is deferred to Step 2/3 |
| nostr-tools pin | EXACT 2.23.5 — verified with Primal NIP-44; do NOT downgrade to 2.13 (breaks @nostrify peer compat) |
| NIP-46 mobile login | Two-step manual launch — relay warms in foreground BEFORE the deep-link; auto-firing breaks the handshake |
| `STRIKE_MAX_DRAW_LTV` | 0.50 in strikeCredit.ts; available = min(creditLine, collateral×price×0.50) − drawn |
