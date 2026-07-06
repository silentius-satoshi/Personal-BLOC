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
- Vitest (571 tests — all must pass before every commit)
- Vercel (deployment + serverless proxy for Power Law data)
- @dnd-kit/core + @dnd-kit/sortable + @dnd-kit/utilities (drag-and-drop tab reordering)
- PWA: `public/manifest.json` + `src/sw.ts` → `dist/sw.js` (Workbox full-build precache via vite-plugin-pwa `injectManifest`; real offline support)

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
    strikeCredit.ts             # STRIKE_MAX_DRAW_LTV (0.50), strikeAvailableCredit = min(line, collateral×50%) − drawn, computeStrikeLtv(bloc, btcHeld, price) (shared by SimpleModeView headline + SafetyDashboard Strike bar). ALSO the SINGLE definition of BLOC_OPERATING_CEILING (0.15) — the advisor's steady-state Strike ceiling; the 4 runAdvisor call sites (AdvisorMain/OutlookProjection/DailyModeView/SimpleModeView) pass it instead of a bare 0.15, and emergencyModel consumes it
    emergencyModel.ts           # Emergency Console pure model (Phase 1) — clock-free, plain numbers (the VIEW pre-accrues cbDebt via accruedCbBalance). Doctrine: collateral top-up is the PRIMARY lever (grow the CB denominator → push liq DOWN); paydown = Wall-2 fallback. CB_LADDER (69/72/75/81, liq=CB_LLTV 0.86) + STRIKE_MARGIN_CALL_LTV 0.70. classifyStage / firepower (slow=cured, fast=stuck) / drawToLtv (clamps to the 50% Strike line) / floorTable / direSwitch|wall3Sale|wall4External (paydown walls) / surplus. Imports CB_LLTV (runCoinbaseLoan) + STRIKE_MAX_DRAW_LTV/BLOC_OPERATING_CEILING (strikeCredit); NO cycle/power-law imports (§7 hard wall)
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
    logUtils.ts                 # recomputeBtcHeld (chains btcBought + collateralAdjustment — HISTORICAL only, v20),
                                # deriveAdvisorStart/deriveCurrentPosition (v20: take currentStrikeCollateral, NOT
                                # pending/baseBtcHeld) + deriveStrikeCollateral (v20 Collateral-Truth — reading-anchored
                                # current Strike collateral: strikeCollateral-bearing balanceReading latest by (date,ts) +
                                # target:'strike' moves strictly after; = getCurrentBtcHeld),
                                # upsertEntry — standalone, no cross-sim imports. Daily Mode P1: strategyMonthIndex
                                # (calendar-anniversary, UNclamped) + bucketEventToMonth (clamp 1–12) — THE month clock
                                # (runAdvisor's getCurrentStrategyMonth/isStrategyComplete now delegate here) + rollupMonth (DayEvent[] →
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

    Tools/
      CbDefenseTool.tsx         # THE mode-gate (cbPaymentStrategy==='ltvTriggered' ? EmergencyConsole : LiqSimulator),
                                # zero props. Shared by BOTH mount points — the `liqsim` tab (AppShell) and the
                                # Almanac's gated `defense` face — so they can never disagree on which tool shows
      LiqSimulator.tsx          # Liq Price Simulator overlay content; reads store directly, no props. Rendered
                                # via CbDefenseTool ONLY in `monthly` CB mode (ltvTriggered → EmergencyConsole)
      LiqSimulator.module.css   # .container now `composes: toolContainer from './toolShell.module.css'` (600px)
      EmergencyConsole.tsx      # Emergency Console (Phase 1) — the actionable crash-day page for `ltvTriggered`
                                # CB mode; READ-ONLY calculator (no dayLog writes). Reads store, builds cbDebt via
                                # accruedCbBalance (the accrual boundary) + Strike position via deriveCurrentPosition,
                                # feeds emergencyModel. 7 sections: staleness banner / stage header + band rail /
                                # firepower (cured|stuck toggle) / draw-to-LTV action calculator / floor table /
                                # Walls 1–4 accordion (Wall 2 salvaged paydown slider) / session-only crash checklist
      EmergencyConsole.module.css
      toolShell.module.css      # Shared `.toolContainer` (Almanac's tokens: 600px centered + iOS-safe overflow).
                                # Phase 1 adopters: EmergencyConsole + LiqSimulator. FOLLOW-UP (device-verify pending):
                                # Converter / Mining / PowerLaw / Almanac still to adopt via `composes:`

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
                                # + Access Phase 2: .identityCard hero (--surface-2 + orange ring) /.identityRing/
                                # .identityNpub(+Text/CopyHint)/.identityMeta/.identityChip/.identityStatus/
                                # .identityDotOn(green)/.identityDotWarn(amber) + .syncRow/.syncRowLabel/.syncRowValue
      RevealRecoveryKey.tsx     # Access Phase 2 — lost-my-backup escape hatch (+ .module.css). Rendered ONLY in the
                                # identity subpage for a 'local' signer (leaving the page unmounts → discards the nsec).
                                # Tap → PRF Face ID / PIN field → unwrapSecretKey (EVERY reveal) → nip19.nsecEncode →
                                # sk.fill(0) → <SecretKeyCard/> → auto-clear ~30s / Hide / unmount. NEVER logs the key
      SharingPage.tsx           # Viewer V2 — the 'sharing' subpage EXTRACTED from SettingsMain (+ .module.css; the FIRST
                                # delegated subpage — SettingsMain renders <SharingPage/> for settingsPage==='sharing',
                                # owner-only). YOUR SHARE CODE (owner npub + copy) + YOUR VIEWER (list-ready grant card:
                                # label + npub + Active dot + "Show real figures" Toggle [viewerPrivacyTrusted] +
                                # Revoke-with-confirm; else the add-viewer form w/ nip19 validation). Self-contained:
                                # own store reads + draft/error/copied state + the verbatim publishViewerSnapshotNow/
                                # publishViewerRevocationNow handlers
      DevPanel.tsx              # Dev diagnostics (devMode only): sync state, PUBLISH ACKS, COLLATERAL (baseline/pending/
                                # current — ON-DEVICE only), signer probe, Nostr log ring, copy-diagnostics.
                                # ALL sections are COLLAPSIBLE via a local <Section title/action?/defaultOpen?> (returns a
                                # FRAGMENT — header + conditional body stay flex siblings of .panel so layout is unchanged
                                # when open; header reuses .sectionTitle with a ▸/▾ chevron; action buttons stopPropagation
                                # so they don't toggle; session-only open state). defaultOpen: SYNC STATE only. PUBLISH ACKS
                                # (after SYNC STATE) renders getPublishReports() newest-first — per-attempt label/age/outcome
                                # + per-relay url·status·Nms lines; a ghost Refresh re-snapshots the in-place-mutated buffer;
                                # copyDiagnostics adds lastPublish (newest report, metadata only).
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
                                # month) = ascending ISO dates that bucket to that STRATEGY month (via the fixed
                                # calendar-anniversary bucketEventToMonth — now AGREES with strategyMonthDate's calendar stepping;
                                # the 30.4375 constant only sizes the ±6 scan window; loOffset clamped ≥0 so month 1 begins exactly
                                # at start, since bucket clamps pre-start days to month 1); weekDates(selectedDay) = 7 ISO Mon→Sun; buildDayCells(dayLog, dates) →
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
                                # v20 (C-P3): a REQUIRED "Strike collateral (BTC)" NumberInput after the Strike-LTV field on
                                # every reading-bearing sheet (readingComplete gates strikeCollateral!==null). AUTO-TRACK: an
                                # untouched field = autoStrikeCollateral(getCurrentBtcHeld(), move) = the POST-move total
                                # (current±amount for a strike collateral move, current+amount for a pledged buy, else
                                # current) — via a track useEffect gated on !strikeCollateralTouched; a manual edit sets
                                # touched (venue truth) + freezes it. This is LOAD-BEARING: the flow + its reading share a ts
                                # and deriveStrikeCollateral EXCLUDES the same-ts move, so the reading MUST state the post-move
                                # total. A buy-only "Pledged to Strike" Off|On toggle (add path, targetToggle styling) → ON
                                # emits [buy, deposit target:'strike' amount=buy, reading]. buildEventsFromSheet gains a
                                # currentStrikeCollateral arg (= getCurrentBtcHeld()). EventSheet.module.css alongside (+ .deleteBtn/.confirmBox/.confirmText)
      eventSheetModel.ts        # PURE builders for EventSheet (no React/store; named eventSheetModel to avoid the macOS
                                # case-collision with EventSheet.tsx): SheetType/SheetState (v20 += strikeCollateral:number|null
                                # + pledgeToStrike:boolean) + readingComplete(s,hasCbLoan) (Save gate — v20 ALSO requires
                                # strikeCollateral!==null) + autoStrikeCollateral(base,s) (v20 PURE — POST-move total: strike
                                # collateral move → base±amount, pledged buy → base+amount, else base; shared by the sheet's
                                # auto-track + its tests) + buildEventsFromSheet(s,hasCbLoan,btcPrice,today,ts,idFn,
                                # currentStrikeCollateral) → DayEvent[] ([reading] | [flow,reading] | [deposit,reading];
                                # v20 buy pledge → [buy,deposit target:'strike' amount=buy,reading]; reading.strikeCollateral =
                                # s.strikeCollateral ?? currentStrikeCollateral, BTC no conversion; fresh id per event;
                                # flow+reading share date+ts; usd=amount*price for buy; **LTV percent ÷100 → fraction**).
                                # Tested in __tests__/eventSheet.test.ts
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
                                # (hasCbLoan ? worseLevel(cb,strike) : strikeLevel) is the top headline (see above).
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
strikeCollateralBtc: number;                       // default 0 (v20 Collateral-Truth) — derived cache (deriveStrikeCollateral over dayLog); reading-anchored current Strike collateral (= getCurrentBtcHeld). NOT synced (rides partialize ...rest); converges cross-device via the dayLog on records:v1. Refreshed in the 3 dayLog mutators + setDayLog + onRehydrate
cbAprPct:            number;                       // default 4.77
cbMonthlyPayment:    number;                       // default 0
cbLiquidationPrice:  number;                       // default 0 (0 = not set; guard before calling compute fn)
cbPaymentStrategy:   'monthly' | 'ltvTriggered';  // default 'monthly'
cbLtvTriggerPct:     number;                       // default 75 (percent, e.g. 75 = 75%)
cbLtvTargetPct:      number;                       // default 65 (percent, pay down to this LTV)
cbRotateBackPct:     number;                       // default 55 (percent, reverse-rotation gate; synced in SETTINGS_FIELDS/payload like trigger/target)
cbEmergencyCeilingPct: number;                     // Emergency Console — target Strike LTV for crash-day collateral top-ups; default 30, CLAMPED 20–50 in the setter; synced (in SETTINGS_FIELDS/payload)
cbLoanBalanceAsOf:      string | null;             // v13 — ISO date cbLoanBalance was last re-anchored (interest accrues daily from here); synced
cbLiquidationPriceAsOf: string | null;             // v13 — ISO date cbLiquidationPrice was last re-entered (drifts up with interest); synced
strikeLiquidationLtvPct: number;                   // v13 — Strike partial-liquidation LTV, default 85 (published terms); synced
```

### Advisor Tab
```typescript
advisorStartDate:         string;   // ISO date, default today
advisorActualBlocBalance: number;   // default 0 — LIVE drawn BLOC balance right now (CURRENT box, Advisor, SafetyDashboard, NDP)
advisorMonthStartBalance: number;   // default 0 — BLOC balance at the START of the current month; projection base ONLY (deriveAdvisorStart month-1). SYNCED. Distinct from advisorActualBlocBalance (live drawn) so mid-month the AFTER box stacks the full draw on the start base, not on the live balance
advisorActualBtcHeld:     number;   // default 0 — TRUE month-0 baseline BTC, NEVER back-solved; feeds recomputeBtcHeld's historical chain + migrate fallback (NOT current position). (v20: pendingCollateralAdjustment RETIRED — Strike collateral is reading-anchored)
sandboxCollateralBtc:     number | null;  // default null — Smart BLOC what-if collateral; IN-MEMORY only (partialize-excluded, never synced); null = tracks current
advisorSkipBlocDraw:      boolean;  // default false (persisted + synced)
advisorSkipCbPayment:     boolean;  // default false (persisted + synced)
advisorSkipBtcBuying:     boolean;  // default false (persisted + synced)
monthlyLog:               MonthlyLogEntry[];  // default []
showMiningInLog:          boolean;            // default false
```

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
> now take `currentStrikeCollateral` (from `getCurrentBtcHeld()`), not baseBtcHeld/pending. `recomputeBtcHeld`
> / per-entry `btcHeld` / `advisorActualBtcHeld` are KEPT for the historical chain + sync-norm + migrate
> fallback (no live position consumer reads them). **C-P3** = the write UI (EventSheet required `strikeCollateral`
> field + auto-track to the post-move total, buy "pledge to Strike" toggle, `emitBalanceReading` collateral
> override, the three collateral inputs re-editable as reading-emitters). **C-P4** = the trusted viewer receives
> `strikeCollateralBtc` as a derived-from-dayLog scalar (raw-set in `viewerSync`, viewer dayLog stays `[]`; SAFE
> payload excludes it), so the viewer's `getCurrentBtcHeld()`/Strike figures are correct. The rest of this section
> is HISTORICAL (pre-v20).

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
| Settings "Current BTC collateral" | REALITY — editable (C-P3): draft/onBlur → `emitBalanceReading({ strikeCollateral })` (a journaled reading re-anchors `getCurrentBtcHeld`; `strikeBal` defaults to the live drawn balance). A read-only "Initial BTC collateral" line (`advisorActualBtcHeld`, month-0 baseline) sits ABOVE it |
| Advisor "CURRENT BTC HELD" | REALITY — same draft/onBlur → `emitBalanceReading({ strikeCollateral })` (C-P3) |
| Simple Mode Quick Setup "BTC held" | REALITY — editable `ModalField` (C-P3); `handleSaveSetup` keeps `emitBalanceReading({ strikeBal })` for the debt field and MERGES `strikeCollateral` into that SAME emission only when the collateral changed (never two emissions) |
| Simple Mode displays / Liq Sim | REALITY — `getCurrentBtcHeld` = reading-anchored `deriveStrikeCollateral` |
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
  `draw | buy | paydown | minPayment | deposit | withdraw | balanceReading | cbCollateralReading`. Base = `{ id,
  date (ISO yyyy-mm-dd), ts (ms) }`. `draw`/`paydown`/`minPayment` carry `amount` (USD); `buy` carries `amount`
  (BTC) + optional `usd`; `deposit`/`withdraw` carry `amount` (BTC magnitude) + `target: 'strike' | 'cb'`;
  `cbCollateralReading` carries `cbCollateral` (BTC); `balanceReading` carries a nested `reading { strikeBal,
  strikeLtv, cbBal?, cbLtv?, cbCollateral?, cbLiqPrice?, price? }` (`cbLiqPrice?` = §5b anchor input, re-anchors
  `cbLiquidationPrice`; NOT a monthly stock — never in the rollup entry). (`minPayment` = the Strike monthly minimum paid from
  income — Logging Consolidation §2b; **balance-neutral**, rolls up to `strikeMinPaid` only.)
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

- **INVARIANT — dayLog `ts` is the MERGE VERSION CLOCK; `date` is occurrence.** Same-id conflict resolves
  higher-ts-wins, tie → local (self-pull idempotence — pulling your own just-published copy back must not
  thrash). Therefore **`updateDayEvent` MUST bump `ts` to `Date.now()` on every edit** (`addDayEvent` uses
  the event's creation ts; `deleteDayEvent` already stamps `Date.now()` on its tombstone). A preserved-ts
  edit would tie with the stale remote copy on every other device → tie→local → the edit loses everywhere
  → permanent split-brain (the P3 edit-propagation bug — fixed). Acceptable consequences: an edited event
  moves to edit-time in same-day ts ordering, and an edited `balanceReading` becomes the date-latest
  reading (§5b re-anchors from it) — both correct, since the edit is the freshest statement.
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
  (replicated into DailyModeView.module.css). The **outer cube containers** use Daily-restyle classes `.posrow` (grid
  wrapper) and `.posbox` (`--surface` bg, `--line` border, 14px radius) — distinct from the content classes
  `.positionTitle/.positionStat/.btcAmt/.parenSub` which stay Monthly-format inside the boxes. The preview-style
  `.posrow/.posbox/.postitle/.posval/.posvalBtc/.possub` block is gone; the new `.posrow/.posbox` are the cube shells only.
  **The trio stays 3-across on mobile in both Monthly and Daily** — the `@media (max-width: 760px) { grid-template-columns: 1fr }` collapse was removed from `DailyModeView.module.css` (both `.posrow` and `.positionRow`) and `SimpleModeView.module.css` (`.positionRow`). On mobile (≤760px), `.parenSub` parenthetical amounts stack below the highlighted amount (`display: block` override in both files) so the narrow 3-across cubes stay readable; wider screens keep the inline layout.
- **Header parity (polish pass):** Daily `.brandMark` now matches Monthly's plain ₿ (`font-size:18px; color:var(--orange)`, no gradient badge); Daily `.brandName` bumped to 16px/700 to match Monthly. Monthly's `.settingsBtn`/`.modeToggleBtn` restyled to match Daily's boxed `.iconBtn` (34×34, border 1px `var(--line)`, bg `var(--surface)`, `var(--text-muted)` → hover `var(--text-primary)`); `.headerRight` gap bumped 4px → 8px. Daily trio gap equalized: `.cards` `margin-top:13px`→`0` + `gap:13px`→`16px` (SafetyDashboard's own `margin-bottom:16px` is the sole above-gap → both sides 16px).
- **`dailyView.ts` UNCHANGED** — `describeDayEvent` keeps its `{icon,label,detail}` shape (the log-row uses label/
  detail; dot/tone mapping lives in the component); `dailyView.test.ts` unaffected. Still read-only (FAB/add-sheet P4b,
  calendar + drill-down gauge/CB sheets P4c).
- **Position area subsequently replaced with compact trio** (post-P4a): the Monthly-format `.posrow` projection
  boxes were replaced with a single `.trioCard` containing three divided `.trioCell` cells — **Strike BLOC
  collateral** / **Strike BLOC balance** / **Avail credit** — all present-tense live values (collateral →
  balance → available, natural lending progression). Monthly view's projection trio (`SimpleModeView`) is
  unchanged. Projection vars (`eomBtcHeld`, `eomBlocBalance`, `eomLtv`, `availCredit`, `hasPaydown`,
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

- **`calendarModel.ts`** gains pure builders (+ types `StreamAgg`/`DayActivity`/`MonthRollup`):
  `buildDayActivity(dayLog, date)` (a single date's events + stream sums + netBtc),
  `buildMonthRollup(dayLog, advisorStartDate, month)` (a strategy month's events + totals + `entryCount` =
  distinct dates; filters via `bucketEventToMonth`), `groupEventsByDay(events)` (group by date, groups DESC,
  per-group ts ASC). The shared `aggregateEvents` REPRODUCES DailyModeView's prior inline agg EXACTLY
  (draw/paydown sums, buyBtc sum, netBtc = buys + strike deposits − strike withdrawals; CB-target moves
  journal-only/excluded) — guarded by a buildMonthRollup-equals-old-agg test. Suite 398 → 403.
- **`DailyModeView`** — the inline `agg`/`monthEvents` memos are replaced by `dayActivity`/`monthRollup`
  memos + `const view = isMonth ? monthRollup : dayActivity`; the activity card reads `view.netBtc/streams`,
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
  banner reappears. Correct, left as-is.
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
not the viewed past month). The ‹ › nav lives in the `Calendar` title row (new optional props
`onPrevMonth`/`onNextMonth`/`canPrevMonth`/`canNextMonth` → `.calNav`/`.calNavBtn`/`.calNavLabel`; the title
owns the label, no duplicate) — the Calendar **date math is unchanged** (it receives `safeViewedMonth` through
its existing `currentMonth` prop). Buttons disable at the bounds (‹ at Month 1, › at the current month).
**Week scope unaffected** (about specific days); entering Month scope resets `viewedMonth` to `currentMonth`
(`useEffect` on `scope`/`currentMonth`). The **FAB still logs to today/`selectedDay`** (backfill INTO a viewed
past month is not wired this phase). Store / `buildMonthRollup` / `confirmMonth` / Monthly view unchanged.

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
"This Month / Outlook" toggle cramped against the trio); `.cards gap` 12px→13px; `.card` and
`.positionCol border-radius` →20px (matches the preview's `.card` and Daily's `.trioCard`). Orange
toggle style (`.segmentBtn`/`.segmentBtnActive`) unchanged; modal (`.modalCard`) and confirm-sheet
(`.confirmSheet`) radii unchanged. No JSX, no logic, no other CSS changed.

---

## Almanac / CycleClock (P1 — pure model + tests + static dial; store unchanged)

The risk-free foundation for an Almanac "CycleClock" — a pure, unit-tested domain model and a static
presentational SVG dial. **No fetch, no lifecycle, no nav wiring, no live data, no settings** (those are
P3/P4). The dial is built but **NOT mounted on any surface** (the surface switch is P4). Prior art for
P3's `useChainTip`: `useMempoolData.ts` (existing tip fetch, consumed by `PowerLawSidebar`) — untouched
in P1, superseded later.

- **`src/simulation/cycleModel.ts`** — PURE, standalone (no React, no fetch, no `Date.now()` in the
  exported math; callers pass `ms`/`height`). 🔴 Imports NOTHING from the risk/position core
  (`runAdvisor`/`runCoinbaseLoan`/`strikeCredit`/`cbMetrics`/store) — the §2 boundary holds from P1.
  Two INDEPENDENT lifetimes that never mix in code:
  - **Halving math (GENERALIZES):** `epochFromHeight(height)` → `{index, era, startBlock, endBlock,
    reward}` (`index=floor(h/210000)`, `era=index+1`, `reward=50/2**index`); `epochProgress(height)`
    adds `{blocksIntoEpoch, blocksRemaining, fraction}` where `fraction=(h−startBlock)/210000` —
    **THE single source** for the dial's hand/arc/% (half-open [0,1): at exactly `endBlock` the height
    rolls to the next epoch → fraction 0, which IS the halving wrap). `dateAtBlock(target, tip, blockS=
    600)`, `blockAtDate(ms)` (anchored at `H4`), `blockPositionInEpoch(ms, e)` (caller clamps/hides
    outside [0,1]). Constants: `HALVING_INTERVAL 210_000`, `GENESIS_REWARD 50`, `TARGET_BLOCK_S 600`,
    `H4 {block 840_000, date 20 Apr 2024}`, `NEXT_HALVING_BLOCK 1_050_000`, `H5_EST` (date-fallback
    boundary only). Epoch 6 (height ≥1,050,000 → reward 1.5625, new bounds) derives with no code change.
  - **Cycle projection (FIXED-ANCHORED, does NOT generalize):** `CYCLE_TURNS` (14 turns built from
    `CYCLE_ANCHOR` = Mon 6 Oct 2025 high, alternating High→Low +364d / Low→High +1064d to ~2050; both
    steps ×7 so EVERY turn lands on a Monday; first low = Mon 5 Oct 2026) + `nextTurnAfter(ms)`.
- **`src/simulation/__tests__/cycleModel.test.ts`** (12 cases) — epoch-5 classification + 2028 rollover
  (Epoch 6/1.5625, no code change), `fraction` 0..1 single-source (half-open: ~1 just below endBlock,
  0 at rollover), `blocksRemaining === 1_050_000 − h` exactness, `dateAtBlock` 144-blocks≈1-day,
  `blockAtDate(H4.date)===H4.block`, and the IMG_7080 premise (14 turns, anchor high, first low Mon
  5 Oct 2026, every turn `getUTCDay()===1`, strictly increasing, strict high/low alternation).
- **`src/components/Almanac/CycleDial.tsx`** (+ `.module.css`) — STATIC presentational SVG dial, a
  declarative React port of the preview's `drawDial(…,'halving')` (no `createElementNS`). Props
  `{height, mode:'live'|'estimated', emphasis?:'halving'|'cycle'}` (`emphasis` accepted as the P2 seam;
  P1 renders the **halving** face only). HR-1 one-coordinate-system: hand, progress arc, and "%" ALL
  from `epochProgress(height).fraction` — `mode==='estimated'` just means the caller passed a
  `blockAtDate(now)` height (the dial doesn't care how it was derived). Geometry ported verbatim
  (`viewBox 0 0 360 360`, `CX/CY 180`, `R 140`, pure `polar`/`arc` helpers): track + 12 ticks → ghosted
  projection markers (band + dashed hollow + muted label, **clamped/hidden outside [0,1]**: high
  `--amber`, low `--maroon`) → BTC→green progress arc `arc(R,0.4,NOW)` (0.4 clears the round cap off the
  cut) → halving cut + "½ HALVING" at 0% → NOW hand. a11y: `role="progressbar"`, `aria-valuemin/max`
  0/100, `aria-valuenow=round(NOW)`, `aria-valuetext`. Colors via app tokens (gradient/cut/hand `--btc`/
  `--green`, dot outline `--bg-base`, mono labels `--mono`); `.module.css` carries only wrapper sizing +
  neutral track/tick hairlines + the mono label font.
- **New token** `--maroon: #8B3A3A` in `tokens.css` (additive — low/floor marker accent).

### P2 — certainty inversion (HR-2) + second face + sub-nav (still STATIC; store unchanged)

The presentation layer over P1. `CycleDial` is now **emphasis-aware** (`'halving' | 'cycle'`, §14.2):
markers ghosted vs confident (glow + solid dot), arc BTC→green-gradient (sw9) vs dim solid `--btc`
(sw8, opacity .55), halving cut confident vs ghosted (lowercase "halving" in `--text-faint`), NOW hand
`--green` vs `--text-primary` — but the hand/arc/% POSITION stays `epochProgress(height).fraction` on
BOTH (HR-1; the framing flips, the geometry doesn't). Marker HUES fixed both ways (high `--amber`, low
`--maroon`). The gradient `<defs>` is emitted only for halving (cycle arc is solid). `CycleDial` also
accepts a `children` center overlay (absolute `.dialCenter` inside `.dialwrap`) so faces align their
readout to the dial's own sized box. a11y `aria-valuetext` branches per emphasis. **`viewBox` stays `"0 0 360 360"`** — coordinate math unchanged. iOS-portrait overflow (dial
off-center-right, content zoomed) was fixed via CSS containment instead: `AlmanacView .container`
gains `width:100%; box-sizing:border-box; overflow-x:hidden` (stops SVG `overflow:visible` labels
from propagating to the viewport); `.dialwrap` is now `width:100%; max-width:300px; margin:0 auto`
(centered, slightly narrower, leaves label headroom). A prior attempt to pad the viewBox
(`"-34 -34 428 428"`) did not fix the overflow and was reverted.

- **`HalvingClock.tsx`** (+ `.module.css`) — DEFAULT honest face (§5): real hero = next-halving
  **day-count** (`Math.round(blocksRemaining·TARGET_BLOCK_S/86400)`, NO ticking seconds — HR-2) + `est.
  ~{Mon YYYY}` (from `H5_EST`) + `block N / 1,050,000`; real 3-cell stat row (Through epoch / Blocks to
  halving / Block height); demoted GHOSTED projection card (next-low floor + last-high peak via
  `CYCLE_TURNS`, soft proj-bar at the descending %, "pattern not a forecast" caption). One-time
  `Date.now()` read, no interval.
- **`CycleClock.tsx`** (+ `.module.css`) — OPT-IN projection-hero (§14.2): hero = ticking
  projected-floor countdown `Nd HH:MM:SS` to the next `CYCLE_TURNS` low — **the ONE permitted ticker
  (§14.4)**, a 1s `setInterval` gated by `usePageVisibility` (pauses hidden, resyncs on resume) +
  cleaned up on unmount; carries the REQUIRED "idealized cadence" tag + "why idealized" note (both
  §14.4, always shown with the countdown); stat row (Descending phase `--maroon` / Since proj. peak
  `--amber` / Block height); demoted halving card with an "Open Halving Clock →" link (`--btc`) calling
  `onSwitchToHalving`.
- **`AlmanacView.tsx`** (+ `.module.css`) — local `face` state (default `'halving'`, §14.3, unpersisted)
  + the sub-nav (Halving · Cycle · Mining-soon-disabled · Power-Law-soon-disabled); passes the SAME
  `height`/`mode` to both faces (props default to a static review fixture `955_710`/`'estimated'`) — the
  P3 `useChainTip` seam lives here so a face switch never remounts the data layer (§14.5).
- Token mapping: preview `--blue` (floor/low) → `--maroon`; the plain "Open Halving Clock" link →
  `--btc`; cycle hand → `var(--text-primary)` (no foreign hex); translucent ghost surfaces via
  `color-mix` on app tokens. 🔴 Both faces import nothing from the risk/position core (§2 holds on Cycle
  specifically — grep-clean). Still STATIC (no fetch/`useChainTip` — P3).

### P4 — nav wiring (full-app Tools + Simple-mode book icon; store `ActiveTab` gains `'almanac'`)

`'almanac'` added to `ALL_TABS_META` + `TOOL_KEYS` + `toolTabs` default (the latter covers desktop;
`TOOL_KEYS` covers mobile) → lives in the **Tools dropdown** (null sidebar, `<AlmanacView/>` in main,
no `hasCbLoan` gate — always available). Store `ActiveTab` union gains `'almanac'`; `tabOrder` default
is unchanged (almanac auto-appends as a new key). Simple mode: an **inline FA book-solid SVG** icon
button (`15px` Daily / `16px` Monthly, matching each view's existing grid icon) in both appbars
(DailyModeView + SimpleModeView) → `setActiveTab('almanac')` → a new
`simpleMode && activeTab === 'almanac'` surface with a ← Back header (mirrors the Settings-in-Simple-mode
pattern, reuses `.simpleModeSettings`/`.simpleModeSettingsHeader`/`.simpleModeBackBtn`/
`.simpleModeSettingsTitle` CSS — no new CSS). `onOpenAlmanac: () => void` prop added to both views.
Still STATIC (default fixture height 955_710/'estimated'; P3 wires live data via `useChainTip`).
**Bugfix:** `onOpenAlmanac`/`onOpenSettings` in simple mode now call `setPreviousTab(activeTab)` before
navigating (mirroring `BrandingDropdown`'s `openSettings`) — fixes the "← Back" button doing nothing
(previousTab was stale/never set; could be `'almanac'` → no-op after opening Settings from Almanac).
**iOS-portrait overflow fix:** on 375px portrait the Almanac content rendered wider than the viewport
(dial off-center-right, zoomed). Fixed via: (1) reverted the bad `viewBox="-34 -34 428 428"` back to
`"0 0 360 360"`; (2) `.dialwrap` → `width:100%; max-width:300px; margin:0 auto` (centered, narrower);
(3) `AlmanacView .container` gains `width:100%; box-sizing:border-box; overflow-x:hidden` (stops SVG
`overflow:visible` from propagating to the viewport and triggering iOS zoom).
`AlmanacView` content is wrapped in a `.container` (`max-width: 600px; margin: 0 auto; padding: 0
16px 32px`) — matches Daily/Monthly's `.content` exactly, fixing full-width sprawl in both full-mode
and simple-mode. One container, no mode branching. `AppShell.module.css` carries
`[data-active-tab="almanac"]` sidebar-collapse rules (`.sidebar { display: none }` +
`.main { grid-column: 1 / -1 }`) matching the liqsim/settings pattern — the empty 280px rail
no longer renders in full-mode.

### Hub expansion — Mining / Power Law / Sats / gated defense faces (Almanac becomes a 6-face hub)

`AlmanacView` widened from 2 live faces (Halving/Cycle) + 2 disabled "soon" placeholders to a full **6-face**
hub: **Halving / Cycle / Mining / Power Law / Sats / defense**. Locked design — **EMBED with per-face
width**: the Almanac is only the roof (eyebrow + sub-nav); each tool keeps its own already-shipped container
byte-identical. `face` widened to `'halving' | 'cycle' | 'mining' | 'powerlaw' | 'sats' | 'defense'` (still
local `useState`, default `'halving'`, nothing persisted/synced — unchanged §14.3).

- **§8 toolContainer adoption is now CLOSED** — every tool shares one `src/components/Tools/toolShell.module.css`
  `.toolContainer` (structural tokens: centering, iOS-safe overflow, horizontal/bottom padding + a 600px
  DEFAULT max-width): `EmergencyConsole`/`LiqSimulator` adopted it in Phase 1; **this change closes the
  deferred follow-up** for `MiningMain.module.css`, `PowerLawMain.module.css`, `ConverterMain.module.css`
  (each `.main` now `composes: toolContainer from '../Tools/toolShell.module.css'`, dropping its own
  width/margin/base-horizontal-padding — Mining also drops its now-redundant
  `@media (max-width:640px) { .main { padding:16px } }`, since toolContainer's fixed 16px horizontal already
  covers what that query existed for), and for `AlmanacView.module.css`'s own `.container` (now
  composes-only from the same file — **zero visual change**, since `.container` WAS the byte-identical
  reference `toolContainer` was originally extracted from). **DESKTOP-WIDTH FIX:** the 600px default
  initially collapsed Mining (was 960px) and Converter (was 700px) on desktop — an unintended regression, not
  the "intended" 600px-for-PowerLaw case. Fixed by RE-ASSERTING each tool's own `max-width` locally, on the
  same `.main` rule, immediately after the `composes:` line (CSS-modules same-rule cascade: a local
  declaration following `composes:` wins by source order) — Mining/PowerLaw → `max-width:960px`, Converter →
  `max-width:700px`. `EmergencyConsole`/`LiqSimulator`/`AlmanacView`'s own `.container` keep the 600px
  default unmodified (always their intended width). Mobile is unaffected either way (every viewport under
  the relevant max-width hits `width:100%` regardless of which value is set).
- **Render restructure:** the root wraps in a full-width `.shell` (`width:100%`, no max-width/padding); the
  eyebrow+sub-nav still sit inside `.container`; Halving/Cycle are re-wrapped in a SECOND `.container`
  (unchanged content/props — `useChainTip()` stays the single per-mount data source for those two faces
  only); Mining/PowerLaw/Sats render each tool's own main content **stacked with its input panel** in a new
  `.faceStack` (mobile: `display:flex; flex-direction:column; gap:16px`, no width of its own, since the tool
  inside already brings its `toolContainer` width); `defense` renders `<CbDefenseTool/>` bare (no
  `.faceStack` — it has no separate input panel).
- **`.faceStack` goes two-column at `≥768px`** (`display:grid; grid-template-columns:280px minmax(0,1fr);
  gap:20px; max-width:1240px; margin:0 auto; padding:0 16px`) — mirrors `AppShell.module.css`'s own `.shell`
  grid (`280px 1fr`) so the Almanac hub gets the same panel-width rhythm as the standalone tabs. A `.facePanel`
  wrapper div (`order:-1; grid-column:1` at `≥768px`, no-op below it) pins the panel to the left column
  regardless of each face's own mobile DOM order.
- **Panel stacking mirrors each tool's own mobile DOM order** (confirmed from `AppShell.tsx`'s sidebar+main
  mount order and `AppShell.module.css`'s `[data-active-tab]` rules): mining = `<MiningInputsPanel/>` then
  `<MiningMain/>`; powerlaw = `<PowerLawSidebar/>` then `<PowerLawMain/>` (both panel-first — AppShell has NO
  `order` override for either tab, so they fall back to plain DOM order, sidebar before main); sats =
  `<ConverterMain/>` then `<ConverterSidebar/>` (main-first — `converter` is the ONLY tab with an explicit
  `[data-active-tab="converter"] .main { order:1 } .sidebar { order:2 }` override, at `≤767px`). All three
  panel components (`MiningInputsPanel`, `PowerLawSidebar`, `ConverterSidebar`) are props-free,
  store/hook-connected named exports taking ZERO parameters — since none can accept a `className` prop,
  each is mounted inside a plain `<div className={styles.facePanel}>` wrapper (not passed a prop directly),
  otherwise identical to how `AppShell` already mounts them as each tab's sidebar.
- **`CbDefenseTool.tsx`** (`src/components/Tools/`) — the ONE mode-gate definition
  (`cbPaymentStrategy === 'ltvTriggered' ? <EmergencyConsole/> : <LiqSimulator/>`), extracted from the
  inline ternary that used to live in `AppShell.tsx`'s `liqsim` render branch. **Both mount points** — the
  `liqsim` tab (`AppShell.tsx`) AND the Almanac's `defense` face — render `<CbDefenseTool/>`, so they can
  never disagree on which tool is showing. Tab label logic (`withEmergencyLabel` in `AppShell.tsx`) is
  UNCHANGED — it still computes the `liqsim` tab's label independently of this component.
- **Sub-nav:** Mining/Power Law buttons set `face` like Halving/Cycle (no disabled/soon treatment). A new
  **Sats button (`丰 Sats`, mirroring the `converter` tab's own shortLabel/fullLabel) is ALWAYS visible** —
  not gated. A **defense button renders ONLY when `hasCbLoan`**, labeled `🚨 Emergency` / `Liq Sim` by
  `cbPaymentStrategy`, mirroring the `liqsim` tab's own label rule. A guard `useEffect` falls back to
  `'halving'` if the defense face is showing and `hasCbLoan` flips false mid-session. `.subnav` already had
  `overflow-x:auto` + hidden scrollbar + `flex:none` buttons (pre-existing) — scrolls gracefully at 6 buttons
  with no CSS change needed.
- **ISOLATION WALL restated (unchanged):** `cycleModel`/`HalvingClock`/`CycleClock` import nothing from the
  risk/position core (§2); `emergencyModel` imports nothing from `cycleModel`/power-law (§7). Co-locating
  all six faces under one hub is navigation only — it crosses neither wall.
- `tabOrder`/`hiddenTabs`/`ALL_TABS_META`/`ActiveTab` are UNTOUCHED — this is purely faces added inside the
  existing `almanac` tab's content, not new tabs. No store fields added; only reads of the already-existing
  `hasCbLoan`/`cbPaymentStrategy`. No persistence/sync changes. `AppShell.tsx`/`AppShell.module.css`
  untouched by this change — the standalone-tab experience for all four tools uses the same components,
  same AppShell wrapper; only each tool's own inner container CSS changed, uniformly for both the tab and
  the Almanac-hub render paths.

### P3 — live block height (opt-in fetch; store stays v19)

The Almanac height is now REAL and updating — but **sovereign-first: DEFAULT OFF**. With the toggle off the
clock fetches NOTHING; `height = Math.round(blockAtDate(Date.now()))` (mode `'estimated'`). Live is opt-in.
Off and live feed the SAME `epochProgress(height).fraction` geometry (§4 fallback parity / HR-1) — only the
badge + an off-mode `~`/`est.` precision marker differ.
- **`src/hooks/useChainTip.ts`** (NEW) — `{ height, mode, source, lastUpdated, isStale }`. Multi-provider
  config-ready `PROVIDERS` array `{name,url,parse}` tried sequentially: mempool.space → blockstream.info →
  blockchain.info (plain-text height) → blockchair.com (`data.blocks` JSON); 8s AbortController each;
  plausibility guard `isPlausibleHeight` = `800_000 < h < 2_000_000`; first valid wins (else keeps the last
  good tip, silent). Lifecycle mirrors `useBtcPrice`: Effect A = a 60s `now` ticker (off-estimate freshness
  + staleness clock); Effect B = the live poll gated `[isVisible, almanacLiveEnabled]` (120s interval,
  `clearInterval` + `abortRef.abort()` on cleanup → never fetches when off/hidden, flipping off aborts
  in-flight). `inFlightRef` prevents stacked polls. `isStale` = live && lastUpdated >10min old. Exports
  `PROVIDERS` + `isPlausibleHeight` (pure-tested). 🔴 imports `usePageVisibility` + `cycleModel.blockAtDate`
  + the store (toggle flag ONLY) — nothing from the risk core.
- **Store (mirror `devMode`, NO version bump):** `almanacLiveEnabled`/`almanacLiveConsented` (default
  `false`) + plain `set()` setters (no `syncSettingsToNostr`). DEVICE-LOCAL — ride `partializeState`'s
  `...rest`, ABSENT from `buildSettingsPayload`/`SETTINGS_FIELDS`. Never synced → the owner's and a viewer's
  choices are independent (**viewer parity for free**). No `migrateState` entry (the custom `merge` fills the
  default, `simpleView` precedent).
- **`FreshnessBadge.tsx`** (NEW, eyebrow row, in `AlmanacView`) — a plain `<button>` (NOT the auto-disabled
  `Toggle`, so a viewer can flip it). OFF: muted "date-only · live off"; LIVE: green "live · {ago} ·
  {source}" (amber when stale). Tap = the toggle: enabled→off (silent); else consented→on (silent); else →
  open the consent sheet. a11y `aria-label`. The badge is shared by both faces (single fetch in AlmanacView).
- **`AlmanacConsentSheet.tsx`** (NEW) — one-time consent on FIRST enable (createPortal scrim/sheet mirroring
  `EventSheet`): title + the four hosts as mono pills + a green "block height only — no holdings, no
  identity" reassurance + Stay-offline / Turn-on (`--btc`). Confirm → consent+enable; cancel → stays off.
- **`AlmanacView.tsx`** — dropped the static `height`/`mode` props; calls `useChainTip()` ONCE and feeds
  `tip.height`/`tip.mode` to both faces (face switch never refetches — §14.5). Owns the badge tap + consent
  state.
- **Faces (off-mode precision marker, conditional on the existing `mode` prop, no new prop):** HalvingClock
  `.sub2` prepends `~` when estimated + the block-height stat rsub reads `estimate`/`live`; CycleClock's
  block-height stat rsub same; CycleDial's cycle-branch `aria-valuetext` gains the `(estimated)` suffix
  (halving branch already had it).
- **Settings → Display** gains an ALMANAC group "Live block height" toggle (canonical entry, owner-only
  block; viewers use the badge) — ON also sets consent (the inline host disclosure satisfies it).
- Supersedes `useMempoolData` conceptually (PowerLawSidebar still uses the old single-provider hook,
  unmigrated). Test: `src/hooks/__tests__/useChainTip.test.ts` (PROVIDERS parse per shape + guard range).
  Suite 419 → 425.

---

## Viewer Experience Revamp (V1 — the dedicated viewer home; store stays v19, NO bump)

The first phase of giving a read-only viewer (e.g. the owner's father) a calm, abstracted experience
instead of the owner's dense Daily/Monthly surface. **V1 is the home page only** — three radial
status gauges + greeting + one overall pill, **C-safe DISPLAY only** (renders ratios/levels the
viewer already receives — NO absolute figures stripped from the snapshot yet; the C-safe/C-trusted
privacy mechanism + sharing-page revamp = V2, onboarding name step = V3, stripped viewer Settings =
V4, roles scaffolding = V5 — all out of scope). **READ-ONLY by construction** (no inputs).

- **`src/simulation/safetyView.ts`** (+ `__tests__/safetyView.test.ts`, 19 cases) — the PURE shared
  derivation; see the simulation/ file list above. The 3 dimensions reuse the owner's exact health
  math (`SafetyLevel` = `'safe'|'watch'|'act'`; badges Safe/Fair/Poor). The ONE new behavior: the
  credit gauge is **risk-colored** (band 0.75/0.90) — a deliberate divergence from the owner's
  always-green capacity bar (chosen by the user). Suite 425 → 444.
- **`src/components/Viewer/ViewerHomeView.tsx`** (+ `.module.css`) — reads the store directly
  (recomputes on price tick), calls `deriveSafetyView`/`deriveViewerOverall`. Header (brand + ⚙ →
  `onOpenSettings`) → greeting ("Good morning/afternoon/evening"; **no name in V1** — the
  `viewerDisplayName` capture is V3) → overall pill (level dot + copy "All positions safe / Worth
  keeping an eye / Action needed" + "updated Nm ago" from `viewerLastSyncAt`) → 3 `<RadialGauge>`
  cards (Strike credit / Strike LTV / Coinbase LTV, the CB card gated on `hasCbLoan`; each a gauge +
  Safe/Fair/Poor badge + a plain C-safe sub-line) → minimal bottom nav (Home + Settings). Local
  `LEVEL_COLOR` mirrors SafetyDashboard. Trusted-mode StatusCard subtext (`creditSub`/`strikeSubLine`/
  `cbSub`) is TWO-LINE (`\n`-joined + `.cardSub`'s `white-space: pre-line`) — e.g. "$X of $Y" / "$Z
  available" — reading cleanly beside the fixed 120px ring; safe-mode subs (short single phrases) are
  unaffected (no `\n`, render as before).
- **`src/components/Viewer/RadialGauge.tsx`** (+ `.module.css`) — lightweight presentational SVG
  donut (stroke-dasharray fill, props `{pct,color,label}`, center "{pct}%", `role="img"`). NOT the
  Almanac `CycleDial` (coordinate-system-specialized). The `stroke-dashoffset` CSS transition on the
  progress circle was REMOVED (device-evidenced iOS WebKit ghost-arc artifact when an animating stroke
  shares an element with the `transform="rotate(-90 ...)"` attribute; trusted-mode-only, since safe
  mode's static snapshot `pct` never re-triggered the transition) — the gauge now renders statically.
  `.gauge` is also a FIXED-SIZE flex child (`flex: 0 0 auto` — no shrink): as a flex child of `.card`
  alongside `.cardBody`, it previously shrank unevenly under text pressure (device-measured 92/104/100px
  instead of 120×120, worse in trusted mode's longer subtext); that uneven safe↔trusted resize is what
  left iOS's stale-scale raster behind the fresh ring (device-confirmed — backgrounding the PWA
  re-rasterizes and clears the ghost until the next toggle). Independent of, and stacked with, the
  transition-removal fix above. **Precision:** the center text shows ONE-DECIMAL precision with the
  trailing zero stripped (`clamped % 1 === 0 ? clamped.toFixed(0) : clamped.toFixed(1)`) — was
  `Math.round`, which could misrepresent e.g. 8.8% as "9%". `ViewerHomeView`'s `StatusCard` mirrors the
  same clamp+format via a local `gaugePctLabel` helper so its `aria-label` always matches the visible text.
- **`AppShell.tsx`** — a new render branch `viewerMode && viewerDataLoaded && activeTab !== 'settings'
  && activeTab !== 'almanac'` → `<ViewerHomeView onOpenSettings={…}/>`, inserted AFTER the
  `PrivateAppNotice` owner gate and BEFORE the `simpleMode` branches. So the viewer home REPLACES
  Daily/Monthly for the viewer; Settings/Almanac still fall through to their existing simple-mode
  branches (a provisioned viewer has `simpleMode===true`). Owner (`viewerMode===false`) skips it.
- **Store `viewerLastSyncAt: number | null`** (transient — NOT persisted, in the partialize
  exclusion alongside `viewerDataLoaded`; setter `setViewerLastSyncAt`) — set in `viewerSync.ts`
  `applyViewerEvent` on a valid hydrate (the freshness clock for the home pill). No persisted field →
  no store version bump.
- **`SafetyDashboard.tsx` UNTOUCHED** (V1) — it kept its inline level math. ✅ **RESOLVED (dedup spec
  v2, `fb35eb5`+):** SafetyDashboard now consumes `deriveSafetyView(selectSafetyViewInputs(...))` — its
  inline copy is gone and the store→inputs mapping is shared too (the ONE selector feeds owner +
  viewer + Viewer V2's snapshot builder), so the two surfaces can't drift. See the safetyView.ts
  file-list entry above. Zero owner-UX change (value-identical); safetyView gained the CB display
  intermediates (accruedBalance/cbLiqPrice/cbLiqFrac) so the dashboard could drop its whole block, and
  `safetyView.test.ts` pins them + the selector (suite 456 → 460). No store version bump.

---

## Viewer V2 — C-safe/C-trusted Privacy + Sharing Revamp (store stays v19, NO bump)

The owner→viewer snapshot is now **MODE-SHAPED**, default **C-safe** (privacy-first). Builds on the dedup
(`selectSafetyViewInputs`/`deriveSafetyView` are the shared owner+viewer source).

- **Two payloads, one `ViewerSnapshot` type (publish.ts, all fields optional → compat):**
  - **C-safe (default):** `{ snapshotVersion:2, privacyMode:'safe', asOf, hasCbLoan, btcPriceAtSnapshot,
    thresholds:{strikeLiqLtv, cbLtvTriggerPct, cbLiqFrac}, safety: ViewerSafeSafety }` — **NO
    settings/records/strike/cbCollateralBtc exist in it by construction** (the privacy audit is
    `Object.keys`). Every leaf is a health RATIO, a level string, or public price — no absolute is
    recoverable (2 unknowns, 1 equation).
  - **C-trusted (opt-in):** today's full `{settings, records, strike, cbCollateralBtc}` + the common
    `{snapshotVersion:2, privacyMode:'trusted', asOf}`.
  - **`privacyMode` absent (pre-V2 event) → treated trusted** (compat).
- **⚠ Privacy correction (load-bearing):** the dedup put `accruedBalance` ($ debt) + `cbLiqPrice` ($ liq
  price) on `SafetyView` — ABSOLUTES. `ViewerSafeSafety` (safetyView.ts) is the ratio/level-only projection
  that **drops both** (keeps `cbLiqFrac`, a ratio). `buildSafeSafety(view, hasCbLoan)` builds it.
- **Price-scaling eliminates v1's frozen-gauge tradeoff.** Between owner publishes balance/holdings are
  constant (owner actions republish); only price drifts, and LTV ∝ 1/price. `scaleSafetyView(SafeSnapshot,
  livePrice)` (pure, safetyView.ts, tested) = `f = snapPrice/livePrice`; `strikeLtv'/cbLtv' = ×f`;
  `capacityUsed` unchanged (price-free); `crashLtv' = strikeLtv'×5`; re-`barLevel`s from the payload
  thresholds; `overall'`; `strikeDropPct = 1 − strikeLtv'/liqLtv`. **`livePrice` absent → factor 1 → the
  at-snapshot levels are the offline fallback.** (CB accrual drift between publishes is negligible for a
  gauge.)
- **Owner control `viewerPrivacyTrusted: boolean`** (default false) — SYNCED (`buildSettingsPayload` +
  `SETTINGS_FIELDS`), STRIPPED from the snapshot in BOTH branches (safe has no settings; trusted's strip is
  now 5 fields: viewerNpub/viewerPubkey/viewerLabel/**viewerPrivacyTrusted**/nostrRelays), and STRIPPED from
  the **plan backup** (`exportPlan.ts` destructure — sharing config, not plan data). Its setter fires
  `syncSettingsToNostr()` **and** `publishViewerSnapshotNow()` so a mode flip reaches the viewer at once
  (mirrors saving a viewer npub). `buildViewerSnapshotPayload(s)` branches on it.
- **Viewer hydrate (`viewerSync.ts` `applyViewerEvent`, after the `revoked` check):** `privacyMode==='safe'`
  → `setViewerSafeSnapshot({safety, thresholds, btcPriceAtSnapshot, hasCbLoan})` + `viewerDataLoaded` +
  `viewerLastSyncAt`, **NO hydrateSettings/records/strike**; trusted/absent → clear the safe snapshot, then
  the existing full hydrate. **`viewerSafeSnapshot: SafeSnapshot | null`** is a new transient store field
  (partialize-excluded, cleared in `clearViewerData`).
- **Render (`ViewerHomeView.tsx`):** one `useViewerSafety(injectedSafeSnap?)` seam unifies both modes into a
  render shape — safe → `scaleSafetyView(viewerSafeSnapshot, liveBtcPrice)` (live via AppShell's
  `useBtcPrice()`); trusted → `deriveSafetyView(selectSafetyViewInputs(s))` + computed figures. Gauges/pill/
  badges identical; only the SUB-LINES differ — C-safe = plain V1 language + live drop% ("Safe through a ~N%
  dip"); C-trusted = real figures (credit "$X of $Y · $Z available"; Strike/CB "Liq at ~$P · $B balance"). CB
  card gates on the seam's `hasCbLoan` (safe mode's store `hasCbLoan` is a seed default — comes from the
  snapshot). The hook's PURE core is **`computeViewerSafety(safeSnap, livePrice, inputs)`** (safetyView.ts,
  node-tested); the hook is just the three unconditional store reads + `injectedSafeSnap !== undefined ?
  injectedSafeSnap : storeSnap` pick.
- **Owner "Preview as viewer" (`viewerPreview`, transient/NEVER persisted — partialize-stripped, so the app
  can't boot into preview):** the trigger sets `viewerPreview`; AppShell's owner simple-mode branch (J) renders
  `<ViewerPreview/>` instead of the Dashboard/Daily/Monthly fork. **Owner IA — the trigger RELOCATED** from the
  journal headers (the old 👁 button, now retired) into **Settings → Sharing (`SharingPage.tsx`, a "👁 Preview as
  viewer" button)**; it does `setViewerPreview(true); setActiveTab(previousTab);` so leaving Settings (branch H)
  drops into branch J where `viewerPreview && !viewerMode` shows the overlay. `ViewerPreview` itself is UNCHANGED
  (its banner + Safe/Trusted toggle stay — that is its job). `ViewerPreview` renders the
  REAL `ViewerHomeView` from the ACTUAL `buildViewerSnapshotPayload` — **safe mode injects a locally-built
  `SafeSnapshot`** (`previewSafeSnapFromPayload`, mirrors viewerSync's construction incl. `hasCbLoan ?? false`)
  as `previewSafeSnap`; **trusted mode passes `null`** → the live-derive path (what a trusted viewer's hydrated
  store shows). The renamed `preview` prop hides the settings affordances AND the bottom nav (a lone no-op Home
  button is dead weight) and makes the pill age read the literal `'live preview'` (the owner device's
  `viewerLastSyncAt` is forever null → `relativeAge` would show an endless "syncing…"). A sticky PREVIEW top bar
  names the mode + "✕ Exit preview" AND carries a preview-LOCAL **Safe|Trusted override** (`override: boolean |
  null` local state, `effectiveTrusted = override ?? trusted`) — a pure what-if lens that **NEVER writes
  `viewerPrivacyTrusted`**; forcing safe spreads `{ ...getState(), viewerPrivacyTrusted: false }` through
  `buildViewerSnapshotPayload` so the mode is exercised via the REAL builder (fidelity ≡ wire payload under the
  hypothetical setting), and an amber "previewing — actual: {Safe|Trusted}" caption flags drift. **Preview
  fidelity ≡ wire payload by construction** (the injected snap IS the safe branch of the payload — pinned by a
  deep-equal test, incl. the forced-safe-from-a-trusted-store override case). The viewer home (real viewer AND
  preview — one shared render path) embeds the full live `PriceChart` (`components/SimpleMode/PriceChart.tsx`,
  public Coinbase candles via `useBtcHistory`, self-fetching, no props/owner-data reads — privacy-clean for the
  viewer by construction) in a `.chartSlot` between the greeting and the pill, replacing an earlier plain-text
  BTC ticker. The greeting sub-line was removed (the pill is the single overall-status element — it had
  duplicated the pill copy verbatim). No sync/publish/persistence/schema change; no store bump.
- **Sharing page extracted → `components/Settings/SharingPage.tsx`** (+ `.module.css`, the FIRST delegated
  subpage; SettingsMain renders `<SharingPage/>` for `settingsPage==='sharing'`, owner-only). YOUR SHARE
  CODE (owner npub + copy) + YOUR VIEWER (list-ready grant card: label + npub + Active dot + the "Show real
  figures" `<Toggle>` [`viewerPrivacyTrusted`] + Revoke-with-confirm; or the add-viewer form). The
  viewer-config store reads + drafts moved out of SettingsMain (only `npubCopied` stays — the Identity page
  also uses it).
- **No store version bump** (additive-with-default). Suite 460 → 470.

---

## Viewer V3 + V4 + V5 — Name Step, Viewer Settings, Role Scaffolding (store stays v19, NO bump)

Three small viewer-side phases. Builds on Viewer V2.

- **V3 — onboarding name step (`ViewerLoginFlow.tsx`).** After the handshake succeeds (`setViewerMode(true)`),
  the flow advances to an internal `step: 'connect' | 'name'` → the name screen (₿ · "What should we call
  you?" · "Just for your greeting — this stays on your device and is never shared." · one field · **Skip**
  + **Continue**, always enabled — empty = skip) → `setViewerDisplayName(name.trim() || null)` → `onDone()`.
  Name AFTER the handshake (don't collect a name for a connection that might fail). Runs for BOTH entry
  points (onboarding fork + Settings access door) for free — it's internal to the flow. No Back on the
  name step (the handshake already succeeded).
- **Store field `viewerDisplayName: string | null`** (default null) + plain `set()` setter. **DEVICE-LOCAL
  PERSISTED, NEVER synced** — the `almanacLiveEnabled` pattern: rides `partializeState`'s `...rest` (NOT in
  the exclusion → survives reloads), absent from `SETTINGS_FIELDS` / `buildSettingsPayload` / BOTH snapshot
  branches. Migrate default `?? null`. Greeting: `ViewerHomeView` renders `Good {timeofday}{name ? ', '+name
  : ''}` (nameless when null).
- **V4 — the stripped viewer Settings (`components/Settings/ViewerSettings.tsx` + `.module.css`, NEW).**
  `SettingsMain` early-returns `<ViewerSettings/>` when `viewerMode` (a viewer never reaches the owner
  menu/subpages/`accessFlow`); AppShell mounts it as `<SettingsMain hideHeader/>` inside `.simpleModeSettings`,
  which supplies the ← Back header. One FLAT screen (no subpages): **YOU** (Your name — inline edit: tap →
  field + Save/Cancel; empty Save clears to null) · **DEVICE** (Live block height — a LOCAL `role="switch"`
  button, NOT the shared `ui/Toggle` which self-disables in viewerMode; sets `almanacLiveConsented`+`Enabled`)
  · **CONNECTION** (Sync status: green/amber dot + `relativeAge(viewerLastSyncAt)`; **Refresh now** →
  `await fetchViewerSnapshot()`, spins + disables, success/failure via a before/after `viewerLastSyncAt`
  compare since fetch swallows its own errors → inline error line on no-change) · **ABOUT** (Version = build
  string) · **[ Sign out ]** (red, full-width → `window.confirm` → `resetViewerSession()`). **Deliberate
  scope cut: NO theme toggle** (dark-only app). The old ungated Display/About viewer rows are gone.
  `relativeAge` was extracted from ViewerHomeView → `utils/format.ts` (shared by both).
- **Sign-out teardown — COMPLETE + SHARED (`resetViewerSession()` in `viewerSync.ts`).** Extracted from
  AppShell's `resetViewer` (which now just calls it — single source, no drift) and completed:
  `clearViewerData()` → clear wrapped key pair + plaintext migrant → **`setViewerDisplayName(null)`** →
  `setUnwrappedViewerKey(null)` (clears the in-memory holder + cached signer — the key-clear is explicit) →
  `setViewerMode(false)` + `setViewerWriterPubkey(null)` → `setOnboardingComplete(false)` → the device
  becomes UNDECIDED → **the fork renders** (never the empty owner shell). Shared by the Settings Sign-out
  AND the gate escapes (ViewerUnlockGate/ViewerWaitingGate). A sign-out that leaves residue isn't a sign-out.
- **V5 — dormant role scaffolding (`components/Viewer/RolePill.tsx`, NEW).** `useGrantedRoles(): readonly
  string[]` = today literally `viewerMode ? ['viewer'] : []` (derived, not stored — a future snapshot can
  carry granted roles and the derivation widens). `<RolePill roles={grantedRoles}/>` in the ViewerHomeView
  header returns **null unless `roles.length > 1`** — ships invisible. The seam exists so a second role
  (e.g. accountant) is additive, not a rewrite.
- **No store version bump.** Tests: `viewerDisplayName` absent from BOTH payload builders + `resetViewerSession`
  clears name/mode/writer/key/onboarding (472 total). `viewerDisplayName` added to the device-local
  persisted-but-unsynced list.

---

## Owner IA — dashboard-first + 5-icon header cluster (store stays v19, NO bump)

Promotes the owner's top-right header buttons into the **primary navigation** and adds a live owner Dashboard.
**⚠ AppShell's render-ladder auth/unlock/viewerMode gates (branches A–G) are UNTOUCHED** — all changes live in
the owner view-switching branch J (`simpleMode && activeTab !== 'settings'`) and the view components. The actual
viewer (father's device, `viewerMode`) is caught by branch G before J, so viewerMode is untouched by construction.

- **`HeaderNavCluster` (`components/Layout/`, NEW) — the SINGLE 5-icon cluster = owner primary nav**, byte-identical
  on every simple-mode surface: **Dashboard · Journal · Full mode · Almanac · Settings**. The four app icons are
  inline `<svg>` (Full mode = the existing 4-rect grid glyph reused verbatim; Almanac = the existing book glyph
  reused verbatim; Dashboard = a gauge glyph; Journal = a ledger glyph); **Settings is the ⚙ glyph, unchanged**.
  The active surface's icon gets `.iconBtnActive` (--btc accent). Handlers: Dashboard→`setSimpleView('dashboard')`,
  Journal→`setSimpleView('daily')` (enters Journal; the inner `ViewToggle` then flips daily↔monthly),
  Full mode→`setSimpleMode(false)` (into the existing tab shell), Almanac/Settings→the view's existing
  `onOpenAlmanac`/`onOpenSettings`. Rendered in DailyModeView + SimpleModeView headers (`active="journal"`) and
  injected into ViewerHomeView via the `ownerNav` prop (`active="dashboard"`).
- **Dashboard surface = `ViewerHomeView` reused owner-side with TRUSTED-LIVE inputs.** AppShell branch J gains a
  `simpleView === 'dashboard'` case mounting `<ViewerHomeView previewSafeSnap={null} ownerNav={<HeaderNavCluster
  active="dashboard" …/>} …/>`. `previewSafeSnap={null}` forces the trusted live-derive path (the exact data path
  preview-Trusted uses) — **no preview banner, no Safe/Trusted toggle**; owners always see live truth. The ONE
  additive `ViewerHomeView` change (never a fork): optional `ownerNav?: ReactNode` — when present it (a) renders in
  the header actions IN PLACE of the lone ⚙ (the cluster carries Settings), (b) suppresses the bottom Home|Settings
  nav (`{!preview && !ownerNav && …}`), (c) pill age reads `'live'` (`preview ? 'live preview' : ownerNav ? 'live'
  : relativeAge(lastSync)` — the owner device's `viewerLastSyncAt` is null). Viewer + ViewerPreview never pass
  `ownerNav` → byte-identical to before.
- **`simpleView` gains `'dashboard'` and it is the DEFAULT** (`'dashboard' | 'monthly' | 'daily'`, default now
  `'dashboard'`). Persisted device-local (rides `...rest`, never synced) → **migrate-default only**: the custom
  merge preserves an existing user's persisted choice; no store version bump. DailyModeView/SimpleModeView/ViewToggle
  prop types widened to the 3-value union (the two journal views still render only for daily/monthly; ViewToggle
  still renders only its 2 buttons). A viewer never reaches branch J (branch G catches it), so the default is
  owner-only-relevant.
- **JOURNAL = the existing Daily/Monthly surface; its inner `ViewToggle` SURVIVES** (NOT subsumed into the cluster).
- **Preview relocated + 👁 retired:** the old header 👁 "Preview as viewer" buttons (DailyModeView/SimpleModeView)
  are removed (dead `setViewerPreview` selectors dropped); the trigger moved to Settings → Sharing (`SharingPage`,
  "👁 Preview as viewer" → `setViewerPreview(true); setActiveTab(previousTab)`). `ViewerPreview` unchanged.
- **GROWTH INVARIANT (documented, NOT built):** the cluster is **fixed at 5 icons** — every future tool becomes an
  **Almanac face** (the existing face-registration pattern), NEVER a new header icon; no grid-modal launcher — the
  Almanac IS the app hub.
- Tests: `src/store/__tests__/simpleView.test.ts` (default `'dashboard'`; setter accepts all 3; device-local /
  absent from `buildSettingsPayload`; rides `partializeState`; migrate-default no-clobber). The dashboard's
  live-figures path is the already-green `computeViewerSafety(null,…) → trusted` case in `safetyView.test.ts`.
  The repo has **no component-render harness** (no testing-library/jsdom, zero `.test.tsx`), so the JSX assertions
  (svg-not-emoji cluster, Journal toggle retained, preview trigger in Settings, 👁 gone) are covered by `tsc -b` +
  build + manual — a deliberate scope call (no harness introduced).

---

## Access Layer Redesign (Phase 1 — the shippable lockout fix; store unchanged, AppShell ladder UNTOUCHED)

Fixes two front-door reachability defects WITHOUT touching the Bug-3-guarded AppShell auth/viewer
render ladder (that ladder refactor is deferred Phase 3):
- **D1 (viewer lockout):** viewer login was reachable ONLY via OnboardingModal's button, gated on
  `!onboardingComplete`. "Skip for now" flipped `onboardingComplete=true` permanently → the trigger
  vanished forever.
- **D2 (returning owner buried):** no front-door login — the owner had to toggle "Enable Nostr Lock"
  in Settings → Identity to trip NostrAuthGate.

**The real fix = always-present Settings doors.** The first-run fork is just the welcome replacement.

- **`src/components/Entry/ChoosePathView.tsx`** (+ `.module.css`) — the sovereign 3-path first-run
  fork that REPLACES OnboardingModal's step-1 welcome. Pure presentational, renders as the step-1
  content inside the modal. Props `{onStartNew, onLogIn, onConnectShared}`. Brand ring + tagline +
  3 cards (Start a new plan [accented `--btc`] / Log in to my plan / Connect to a shared plan) +
  footer. **"Start a new plan" copy is softened** ("set up a fresh plan") — it still routes to the
  numbers wizard; owner key-generation is the committed **Phase 1.5** fast-follow, NOT this phase.
- **`src/components/Auth/ViewerLoginFlow.tsx`** (+ `.module.css`) — the viewer-login flow EXTRACTED
  VERBATIM from OnboardingModal (byte-identical crypto/key sequence: `wrapSecretKey` →
  `setUnwrappedViewerKey` → `clearViewerData` → `setViewerWriterPubkey` → `setViewerMode(true)`).
  Self-contained full-screen overlay (own `.overlay`/`.modal`, mirroring NostrAuthGate) so it launches
  from BOTH onboarding AND Settings. The ONLY behavioral change: the final `onComplete(true)` became a
  `onDone()` prop. Props `{onDone, onBack}`.
- **`OnboardingModal.tsx`** — step 1 = `<ChoosePathView>`; the extracted viewer state/effect/handlers
  are GONE (live in ViewerLoginFlow). Two flow flags `viewerFlow`/`loginFlow`; the component
  early-returns the sub-flow overlays before its own modal: `viewerFlow` → `<ViewerLoginFlow
  onDone={() => onComplete(true)} …/>`, `loginFlow` → `<NostrAuthGate onSuccess={() => onComplete(false)}
  …/>`. The numbers wizard (steps 2-4 + `handleDone`) is INTACT; dots moved under the `step>=2` branch.
- **Completion-wiring principle (load-bearing):** `handleDone` (which writes the DRAFT plan numbers)
  belongs ONLY to the numbers-wizard path where the user actually entered them. Viewer + login use
  **flag-only** `onComplete` so they never clobber synced/incoming data with defaults — viewer onDone →
  `onComplete(true)` (today's behavior); login onSuccess → `onComplete(false)` (marks onboarding done,
  NO plan write). (This corrects the build prompt's literal §3 which said `handleDone(...)`.)
- **`SettingsMain.tsx` — persistent "Access" group** (the real D1/D2 fix): a labeled `.settingsGroupLabel`
  "ACCESS" + two `SettingsRow`s at the TOP of `.settingsMenu` (gated `!viewerMode`, no drill-down so
  they're found the moment Settings opens). Local `accessFlow: null|'login'|'viewer'`. "Connect Nostr
  identity" → `setAccessFlow('login')` → `<NostrAuthGate onSuccess/onBack={()=>setAccessFlow(null)}/>`
  (gate sets auth → owner gates take over). "Connect to a shared plan" → `window.confirm(...)` →
  `setAccessFlow('viewer')` → `<ViewerLoginFlow onDone={()=>{setSimpleMode(true);setAccessFlow(null);}}
  …/>` (sets viewerMode → viewer gates take over). Both overlays render at the end of SettingsMain.
- **Deferred / untouched:** the AppShell render ladder (Phase 3); `nostrAuthEnabled` + the "Enable
  Nostr Lock" toggle (Phase 2 removal); owner key-gen on "Start new" (Phase 1.5 — now SHIPPED, see
  below). Almanac, BLOC math, risk core, the V1 viewer home, the viewer snapshot/sync — all untouched.
  No store version bump.

---

## Access Layer — Phase 1.5 (owner key generation + recovery-key backup; store unchanged, NO bump)

"Start a new plan" now MINTS a real owner identity (nsec/npub generated + keyVault-wrapped on-device)
with a mandatory recovery-key backup **before** the numbers wizard — eliminating the
local-owner-without-identity limbo (device model is now cleanly `undecided | owner | viewer`) and
closing the clobber-fix's empty-baseline tradeoff (the new owner is authenticated before the wizard, so
the wizard's plan publishes as the legitimate first settings event). Out of scope: import/restore,
Log-in/Connect-shared, the AppShell render ladder, toggle retirement. Introduces two SHARED pieces later
specs reuse: `SecretKeyCard` (Access P2's Reveal-recovery-key) + `establishLocalOwner` (shared with
NostrAuthGate's import path so the two identity-establish paths can't drift).

- **Flow:** fork → "Start a new plan" → **K1** Create key → **K2** Save recovery key → **K3** Protect it
  → numbers wizard (existing steps 2–4) → `handleDone(true)` → app (owner, authed, synced). Key-first,
  then numbers.
- **`src/lib/nostr/establishOwner.ts`** — `establishLocalOwner(sk, method, nostr, opts?)`: the SINGLE
  local-owner establish path, extracted VERBATIM from NostrAuthGate's import body (wrap at rest → persist
  the wrapped credential via `setWriterKeyWrapped`/`setWriterKeyWrapMeta` → `new NSecSigner(sk.slice())`
  + `setNostrSigner` → `markSignerFresh` → `setNostrPubkey(getPublicKey(sk))` → `setNostrSigningMethod
  ('local')` → fire-and-forget `syncNow(nostr)` → `setIsAuthenticated(true)` → `sk.fill(0)`). `NostrAuthGate`'s
  `handleLocal` now calls it (behavior-identical; `wrapSecretKey`/`NSecSigner`/`getPublicKey` imports pruned
  there). ⚠ **Never logs the nsec** (no `nostrLog` of key material anywhere in the feature). `NostrSigner`
  imported from `./signers` (the sibling re-export, matching `session.ts`).
- **`src/components/Auth/SecretKeyCard.tsx`** (+ css) — shared presentational card: bech32 nsec in `--mono`
  `word-break: break-all`, **blurred by default** (`filter: blur(6px)` + "Tap to reveal" pill, local toggle),
  one-tap Copy (flashes "Copied ✓" 2s, fires `onCopied?`), "Best kept in a password manager." sub-line.
  Props `{ nsec, onCopied? }`. `--surface-2` bg / btc-tinted border.
- **`src/components/Onboarding/OwnerKeySetup.tsx`** (+ css) — the K1→K2→K3 sequence; own `.overlay`/`.modal`
  chrome mirroring `ViewerLoginFlow`, `--btc` primaries. Internal `step: 'intro'|'save'|'protect'`, props
  `{ onComplete, onBack, onLogIn }`. **sk in a `useRef`** generated on the K1 tap (NOT mount), zeroed on
  Start-over / unmount / establish. **K1** intro + "Generate my key" + **existing-key guard** (if
  `writerKeyWrapped || nostrPubkey` present → "This device already has a key" + [Log in]→`onLogIn` /
  [← Back]; never regenerate over an identity). **K2** `<SecretKeyCard/>` + mandatory ack checkbox
  (Continue disabled until checked) + "Start over" (no Back). **K3** `probeKeyVaultCapability` → single
  "Enable Face ID" (biometric) or the ViewerLoginFlow PIN+confirm UI (PIN); Success →
  `establishLocalOwner` → `onComplete`. `onLogIn` is a small justified extension of the spec's
  `{onComplete,onBack}` (the guard's [Log in] needs to reach the loginFlow).
- **`OnboardingModal`** gains a `keySetup` sub-state mirroring `viewerFlow`/`loginFlow` (early-return
  `<OwnerKeySetup onComplete={→setStep(2)} onBack={→fork} onLogIn={→setLoginFlow(true)}/>`); `onStartNew` →
  `setKeySetup(true)` (was `setStep(2)`). The numbers wizard + `handleDone` are untouched.
  **`ChoosePathView`** card-1 sub-line → "Create your own — keys generated on this device".
- **AppShell is SAFE with no edits** (verified): `AppShell.tsx:284` renders `<OnboardingModal>` while
  `!onboardingComplete`; every auth gate is `onboardingComplete && …`-gated, so `establishLocalOwner`
  flipping auth/pubkey/method mid-onboarding cannot unmount the modal or trip a gate. On final
  `onComplete → setOnboardingComplete(true)` the ladder re-evaluates and lands on the app (LocalUnlockGate/
  NostrAuthGate skip because `isAuthenticated` is already true).
- **Sync safety (tradeoff closure):** K3's `syncNow` hits an empty relay for the brand-new key → pulls
  nothing → `initialSettingsPullDone=true`, nothing publishes (not dirty; Fix D refuses seed defaults). The
  wizard's `handleDone(true)` then writes real numbers → the debounced publish ships the actual plan as the
  first settings event. **No store version bump** (wrapped key reuses existing keyVault storage). Suite 454
  → 456.

---

## Access Phase 2 — Identity, Access & Recovery cleanup (store unchanged, NO bump)

Makes the identity/access surface coherent after 1.5 (every owner is now authed from minute one). UI-only —
every store field is unchanged; `nostrAuthEnabled` + its `!!nostrPubkey` derivation are KEPT (load-bearing for
the Bug-3 render ladder + sync banners), only the dead toggle UI is removed. **Consumes 1.5's `SecretKeyCard`.**

- **NostrAuthGate `backLabel?: string` prop** (default `'← Back'`): the back button (was hardcoded
  "← Back to Face ID unlock") now reads `{backLabel ?? '← Back'}`. Only **AppShell:326** (the locked-out
  local-unlock escape) passes the original string; the **SettingsMain access door** + **OnboardingModal fork
  login** use the default. Label-only.
- **autoRestore nip46 guard** (`useNostrAutoRestore.ts`): after the `local` guard, `if (nostrSigningMethod ===
  'nip46' && !nostrLogin) return;` — a nip46 session with no persisted `nostrLogin` can't be silently rebuilt,
  so skipping optimistic auth kills the ~1.5s authed-app flash before the gate.
- **ACCESS group — state-aware login door** (SettingsMain menu): "Connect Nostr identity" is now gated
  `!viewerMode && !isAuthenticated` (an authed owner sees no duplicate sign-in door — Identity & Security is the
  connected-identity home; the "Identity & Security" drill-in row stays `!viewerMode`). "Connect to a shared
  plan" unchanged.
- **Toggle retired (UI only)**: the "Enable Nostr Lock" row + the orphaned `setNostrAuthEnabled`/`nostrAuthEnabled`
  selectors + the **dead** `nostrAuthEnabled && !nostrPubkey` warning (dead because `nostrAuthEnabled ≡
  !!nostrPubkey`) are removed. The rebuilt connected sections key off `nostrPubkey`.
- **Identity & Security page rebuilt** into grouped sections (all reusing existing handlers): **IDENTITY CARD**
  (hero `.identityCard`, `--surface-2` + orange-ring ₿: truncated npub tap-to-copy · method chip `Face ID · local
  key`/`Extension (NIP-07)`/`Remote signer (NIP-46)` · status dot `.identityDotOn` green Connected / `.identityDotWarn`
  amber "Reconnect needed" via `nostrReconnectNeeded`) → **SYNC** ("Settings synced · {relativeSync(lastSettingsSyncAt)}"
  / "Records synced · {relativeSync(lastRecordsSyncAt)}" [relative TIME, "never" when null — `relativeSync` mirrors
  ViewerHomeView's m/h/d convention; NOT relay hosts] + Sync now) → **THIS DEVICE** (signing-method row + exactly ONE
  exit per method: local → Remove local key; nip07/46 → **Disconnect** now with a confirm "…Your plan stays on the
  relay." → `disconnectNostr()`) → **RECOVERY** (`<RevealRecoveryKey/>` local-only · **Backup plan** →
  `setSettingsPage('backup')` · retained Reset-&-re-sync escape hatch · conditional decrypt-back) → footer "Your key
  is encrypted at rest and never stored in plain text." `!nostrPubkey` → a calm "No identity connected" hint.
- **`RevealRecoveryKey.tsx`** (+ css, NEW `components/Settings/`) — the lost-my-backup escape hatch. Rendered ONLY
  when `settingsPage === 'identity' && nostrSigningMethod === 'local'`, so leaving the page **unmounts it →
  discards the revealed nsec**. Tap "Reveal recovery key" → PRF: Face ID directly / PIN: an inline PIN field →
  `unwrapSecretKey(writerKeyWrapped, writerKeyWrapMeta, pin?)` (**unwrap required on EVERY reveal**) →
  `nip19.nsecEncode(sk)` → `sk.fill(0)` immediately → `<SecretKeyCard/>` → **auto-re-blur/clear after ~30s** (or
  Hide, or unmount). ⚠ Never logs the key.
- **No store version bump.** Suite unchanged at 456 (UI-only; flow is device territory).
- **Settings Phase 2 Step 2 — COMPLETE (gap audit against HEAD confirmed everything above is shipped; no
  further code):** the Identity & Security page ships the 5-group structure — **IDENTITY CARD → SYNC → THIS
  DEVICE → RECOVERY → security-note footer** (+ the `!nostrPubkey` "No identity connected" fallback), rows
  already organized into those labeled groups. The **"Enable Nostr Lock" inert toggle is already removed** (no
  `nostrAuthEnabled`/`setNostrAuthEnabled` control anywhere in `SettingsMain.tsx`; every remaining `Toggle` is
  wired to a real action). **RECOVERY** already carries `<RevealRecoveryKey/>` (local-only — the "prove the
  wrapped key still unwraps" decrypt path: `unwrapSecretKey → nsecEncode → SecretKeyCard`, auto-clear ~30s) +
  the **conditional decrypt-back** ("Turn off at-rest encryption", `showDecryptBack`/`handleDecryptBack`) +
  Backup plan + Reset-&-re-sync. The **nip46 reconnect-flash guard** is live at `useNostrAutoRestore.ts:21`
  (`if (nostrSigningMethod === 'nip46' && !nostrLogin) return;`, before the optimistic auth), with redundant
  lower-layer defense at `session.ts` (the nip46 restore worker throws on missing login). **Deliberate scope
  call:** **at-rest encryption STATE stays DevPanel-only** — no user-facing "On/Off" row on the Identity page
  (encryption is OFF-by-default, dev-gated maturation; the only user-facing surface is the conditional RECOVERY
  decrypt-back + the footer note).

---

## Plan Export / Backup Tool (EXPORT phase only; store unchanged)

A local, in-hand copy of the owner's plan independent of the relay/sync path — motivated by the
fresh-install settings-clobber incident (the relay was the *only* copy, with no way to get data out).
**Read-only / export-only this phase** — no import/restore (a separate, later, more careful build that
writes to the store + interacts with sync). The nsec key-backup ("save your recovery key") is a
different artifact (Phase 1.5) — not this tool.

- **`src/lib/backup/exportPlan.ts`** (+ `__tests__/exportPlan.test.ts`) — `buildPlanBackup(s:
  StoreState): PlanBackup`, a pure function reusing `buildSettingsPayload` (so future-added settings
  fields flow into the backup automatically) and stripping ONLY the sharing/transport config
  (`viewerNpub`/`viewerPubkey`/`viewerLabel`/`nostrRelays` — re-establishable, relationship-specific,
  not irreplaceable). Bundles the FULL records set (`monthlyLog`, `deletedMonths`, `dayLog`,
  `deletedDayEvents` — the RAW dayLog journal, not just rolled-up months; `cbCollateralBtc` needs no
  special handling since it's a derived cache reconstructable from the exported `dayLog`). Wrapper:
  `{ format: 'personal-bloc-plan-backup', schemaVersion: 1, storeVersion: 19, exportedAt (UTC ISO —
  correct here, a machine timestamp not a user-facing "today"), plan: { settings, records } }`.
  `downloadPlanBackup(s)` serializes + triggers a browser-standard Blob/`<a download>` save, filename
  `personal-bloc-backup-{todayLocalISO()}.json` (the LOCAL date, per the date-fix convention).
- **`SettingsMain.tsx` — "Backup" subpage** — `'backup'` added to `SettingsPage`/`SUBPAGE_TITLES`; a
  menu row (💾, `!viewerMode`-gated) placed right after "Identity & Security" (recovery-adjacent); the
  subpage is one paragraph + an "Export plan" button (`styles.syncButton`, calls
  `downloadPlanBackup(useStore.getState())`). No confirm (read-only, harmless). Owner-only.
- **Device-local/session fields are naturally absent** (not in `buildSettingsPayload`/the records
  set) — `devMode`, `viewerMode`, `settingsDirty`, `initialSettingsPullDone`, nostr identity fields
  never need explicit stripping.
- **Not built (explicitly deferred):** import/restore — will validate `format`/`schemaVersion`/
  `storeVersion` (migrating an older `storeVersion` if the store schema has since advanced) and write
  the plan back to the store; the settings-clobber fix (`initialSettingsPullDone`) makes a post-import
  publish safe (publishes the restored plan AFTER an initial pull, not seed defaults). Separate spec +
  device-check, since it writes state and interacts with sync. No store version bump this phase.

---

## Emergency Console (Phase 1 — actionable crash-day page for `ltvTriggered`; store stays v19)

Replaces the passive Liq Sim **for `ltvTriggered` CB mode only** with an actionable, **READ-ONLY**
calculator implementing the Emergency Directive. Monthly mode keeps `LiqSimulator` untouched. NO dayLog
writes / execution — real draws are still logged through Daily flows.

- **Mode gate (`AppShell.tsx`):** the `liqsim` render branch is `cbPaymentStrategy === 'ltvTriggered' ?
  <EmergencyConsole/> : <LiqSimulator/>`. Tab KEY stays `'liqsim'` (no tabOrder/hiddenTabs migration, still
  `hasCbLoan`-gated); the tab LABEL swaps to `Emergency`/`Emerg` by mode via a `withEmergencyLabel` resolver
  mapped over `mainTabs` + `toolTabsList` (label-only — `SortableTab`/`ToolsDropdown` internals unchanged; their
  tab-prop types were widened to `{key,fullLabel,shortLabel}` strings so the override typechecks).
- **`emergencyModel.ts` (pure, clock-free):** all debt math consumes the pre-accrued `cbDebt` — the VIEW builds
  it via `accruedCbBalance(cbLoanBalance, cbAprPct, cbLoanBalanceAsOf)` (cbMetrics) at the boundary, so the model
  never touches a clock and is fixture-testable. Strike position from `deriveCurrentPosition`. Functions:
  `classifyStage` (stage from cbLtv vs `CB_LADDER` 69/72/75/81; liq = CB_LLTV 0.86; band price = `cbDebt/(cbColl×band)`),
  `firepower` (slow=cured `(ceiling−0.15)×skColl`, fast=stuck `(ceiling×skColl×P − skDrawn)/P`), `drawToLtv`
  (clamped to the 50% Strike line — NOT creditLine; newSkMarginCallPrice = `newDrawn/(skColl×0.70)`), `floorTable`
  ([20,25,30,50]% + standing), `direSwitch`/`wall3Sale`/`wall4External` (paydown-numerator walls), `surplus`.
- **INVARIANTS:** emergency debt math **always** flows through `accruedCbBalance` (never raw `cbLoanBalance`);
  **collateral top-up is the primary lever** (grow the CB denominator → floor DOWN; paydown is the Dire
  Switch/Wall-2 fallback only); **`BLOC_OPERATING_CEILING` (strikeCredit.ts) is the single 0.15 definition** for
  the advisor path; emergencyModel imports **nothing** from cycle/power-law (§7 hard wall — grep-clean).
- **New synced setting `cbEmergencyCeilingPct`** (default 30, **clamped 20–50 in the setter**; SETTINGS_FIELDS +
  buildSettingsPayload + migrate `?? 30` + both reset presets; rides `partializeState`'s `...rest`). Settings →
  Coinbase Loan renders its NumberInput **only** in the `cbPaymentStrategy === 'ltvTriggered'` fragment. NO store
  version bump (additive defaulted field).
- **Phase 2 (Recovery/repatriation, `spareBtcOnCb`) is NOT built** — specced but deferred; not prebuilt.
- Tests: `src/simulation/__tests__/emergencyModel.test.ts` reproduces the directive fixtures ±$1 (liq 41650.62,
  slow floor 38842, fast floor 39621, bands 51912/47759/44222, drawToLtv(30)@48000 slow 5990.73) + clamp/wall math.

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
  { key: 'liqsim',   fullLabel: 'Liq Sim',           shortLabel: 'Liq'      },
  { key: 'almanac',  fullLabel: 'Almanac',            shortLabel: 'Almanac'  },
  { key: 'advisor',  fullLabel: 'Advisor',            shortLabel: 'Adv'      },
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

**`SettingsDropdown` retired** (the header's gear-icon mini-panel, a pre-Settings-era relic duplicating
the BLOC APR field) — BLOC APR editing is now single-homed in Settings → Strike Strategy.

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

**Living projection:** `getCurrentStrategyMonth(startDate)`, `isStrategyComplete(startDate)` exported from `runAdvisor.ts` — both now delegate to `logUtils`'s calendar-anniversary `bucketEventToMonth`/`strategyMonthIndex` of `todayLocalISO()` (no duplicate 30.4375 clock; see the Strategy-Month Calendar Fix section). Month N = `[start+(N−1) calendar months, +N months)`; the bucket clamps 1..12, the unclamped index >12 signals completion.

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

## Strike Minimum Payment + NDP re-scope (Simple Mode Corrections A; store v19, NO bump)

Corrects how the BLOC monthly minimum (accrued interest, billed monthly / due the 15th per Strike's terms)
is modeled. The payment SOURCE is now an owner-selectable policy (Settings → Strike → MINIMUM PAYMENT SOURCE),
and the NDP clause is re-scoped to roll-mode only.

- **Two synced settings (`useStore.ts`):** `blocMinPaymentSource: 'income' | 'roll'` (default `'roll'` —
  today's exact behavior, the migration-free choice) + `blocStatementMinimum: number | null` (this month's
  user-entered statement figure; `null` → the computed one-month-interest estimate `balance × APR/12`; reset to
  `null` at month-confirm). Both in `buildSettingsPayload` + `SETTINGS_FIELDS` + defensive `migrateState`
  defaults; **no store version bump** (initial-state default + custom shallow merge, `simpleView` precedent). Ride
  into the plan backup + trusted snapshot automatically; the safe snapshot (ratios-only) is untouched.
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
- **Threading:** the store `blocMinPaymentSource` is passed into `runAdvisor` at ALL app call sites
  (SimpleModeView, DailyModeView, AdvisorMain, and via a new prop into OutlookProjection) so projections show the
  income-mode tradeoff (lower balance/LTV, less BTC) honestly.
- **Simple Mode UI (`SimpleModeView.tsx`):** income mode adds a FROM MONTHLY INCOME allocation row "Strike minimum
  · due the 15th" (amount = `blocStatementMinimum ?? estimate` + a `statement`/`est.` chip; tap the amount →
  inline field → `setBlocStatementMinimum`; no Skip pill — contractual). Roll mode keeps the Interest-capitalizes
  row. The current-month reality math (`effectiveInterest`/`expectedBtcBuying`/`expectedPaydown`/`eomBlocBalance`/
  `loggedStrikeBal`/`allocatedFromIncome`) all gate the income-mode terms on `isIncomeSource` (roll = 0 → byte-
  identical). ConfirmLogSheet relabels the interest row "Strike minimum paid" in income mode; `handleApply` writes
  `strikeMinPaid` + `strikeMinSource` to the entry, and in income mode resets `blocStatementMinimum` to null +
  stamps `ndpLastPaidDate` (an external minimum IS a non-draw payment). Box 2 "THIS MONTH" Draw line now anchors on
  the MONTH's total (`effectiveDrawAmount`) with `($X left)` as the countdown parenthetical (was a bare "Draw: $0"
  once the month's draws were logged), plus a `Min:` line in both modes.
- **NDP re-scope:** `ndpActionActive` (SimpleModeView) is gated on `blocMinPaymentSource === 'roll'` — the annual
  NDP surfaces (`showNdpRow`, the "NDP paid $X" summary, the status pill/badge) only exist while minimums roll.
  `getNdpStatus`'s signature/estimate (one month's interest) is unchanged.
- **`MonthlyLogEntry` += `strikeMinPaid?` / `strikeMinSource?`** (optional additive, legacy-tolerant next to
  `ndpPaid?`).

## Threshold validation (Simple Mode Corrections B)

The three CB threshold `NumberInput`s (SettingsMain cbloan subpage) gain `max={85}` bounds; the ordering warning
extends to `rotate-back < target < trigger < 86% (Morpho liquidation)`. In `runAdvisor` a `thresholdsOrdered`
guard (`cbRotateBackPct < cbLtvTargetPct < cbLtvTriggerPct`) leads BOTH the forward-paydown `if` and the
reverse-rotation `else if` — mis-ordered config suspends rotation for the month (no churn) while draw/interest/BTC
still run. Simple Mode's plan card surfaces an amber `.misorderNotice` "⚠ CB thresholds mis-ordered — rotation
advice suspended; fix in Settings → Coinbase Loan." when the persisted config violates ordering (covers
legacy/synced-in bad values).

## Cumulative savings-need line (Simple Mode Corrections C)

`SimpleModeView` computes `savingsNeed = Σ (max(0, fiatGap) + max(0, blocMinShortfall))` over the remaining
projection rows (`month ≥ currentMonth`) and renders a `.savingsNeed` line "Needs ~$X from savings over the next N
months" when `> $0` (N = remaining months with a gap) — muted normally, `.savingsNeedAlert` amber when `≥ 1× income`.

---

## Logging Consolidation — One Ledger, One Sign-off, a Pure Playbook (§1–§4 + §2b; store stays v19, NO bump)

Retires the **second writer** of monthly actuals. Before: the Daily view (**Ledger** — `dayLog` events that
roll up) AND the Monthly view's `ConfirmLogSheet` (**Playbook** — a parallel skip-adjusted derivation) both
wrote the same entry → "the amounts don't match." Now the **Ledger is the sole writer of actuals** and the
**Sign-off** (ReviewSheet) is the sole monthly confirmation; the Playbook renders its current month exactly
like any projected month (figures from the engine via `deriveForMonth`).

- **§1 Vocabulary + Invariant 1:** Ledger = Daily, Playbook = Monthly, Sign-off = ReviewSheet flow. **The
  Ledger is the only writer of ACTUALS** (`dayLog` events + the sign-off's entry fields); the Playbook never
  logs. (Invariant 2 / readings-unification is **§5b — DEFERRED**, see below.)
- **§2 Sign-off absorbs the confirm (ONE atomic write):** `confirmMonth(month, extras?)` (useStore) —
  `extras` (`expensesActual`/`ndpPaid`/`strikeMinPaid`/`strikeMinSource`) land WITH `confirmed:true` in a
  single `upsertLogEntry` (spread preserves `source:'daily'` → M2 guard passes; zero-arg callers unchanged).
  `ReviewSheet` gains a **SIGN-OFF DETAILS** group (Expenses actually paid; income-mode Strike-minimum-paid
  with the statement/est chip prefilled `rollup.streams.minPayment ?? blocStatementMinimum ?? estimate`;
  roll-mode NDP row). The **btcBought override retired** (fix a wrong buy by editing the event). Side-effects
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
  on the Daily plan card + the Playbook Box 2 Min line. `MonthlyLogSection`/`Overlay` show `strikeMinPaid`;
  **`AdvisorSidebar`'s ANNUAL NON-DRAW PAYMENT card gates on `blocMinPaymentSource === 'roll'`** (an income
  minimum IS a monthly non-draw payment → the annual clause is gone).
- **§3 The Playbook goes pure (`SimpleModeView`):** RETIRED — `ConfirmLogSheet`, `handleApply`, the Pay/Skip
  pills, `custom*` overrides, the whole skip-adjusted block (`effective*`/`eom*`-skip/`expected*`/live
  `allocatedFromIncome`/`loggedStrike*`/`remainingDraw`), the "Log this month" button + logged-note Undo. The
  current month renders like any projected month via `selectedPlan`/`deriveForMonth`; Box 3 AFTER = the engine
  row's eom. A **sign-off pointer** ("Month N awaits sign-off in the Ledger →" → `setSimpleView('daily')`; shown
  when `currentEntry?.confirmed === false` or no entry) replaces the Log button; a read-only **MTD strip**
  ("Ledger: $X drawn · ₿Y bought · $Z paid ›" from `buildMonthRollup`) deep-links to the Ledger. Box 2/3 gain
  **paren symmetry** (plan headline + ledger progress: "Draw: $3,750 ($1,200 left)"). `composeMonthSummary`'s
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
**local-action-only**; cross-device travel stays on the settings channel.

- **The model (write-at-log-time, "last action wins"):** the anchors are **synced settings with 11 writers**, so
  they can't be pure derived caches like `cbCollateralBtc`. A reading writes them once, at add/update/delete time
  (a local action), then fires `syncSettingsToNostr()` — the anchor + its `asOf` ride the **settings** channel
  (LWW), exactly like a manual re-anchor.
- **Seam runs ONLY in `addDayEvent`/`updateDayEvent`/`deleteDayEvent`, NEVER in `setDayLog`** — a sync/merge must
  not jolt this device's SafetyDashboard (the anchor arrives via settings LWW instead). **Distinction from
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
  default `?? false`; no version bump). Invoked once via **`useMonthBucketReconcile`** (AppShell, beside
  `useNostrAutoRestore`) — subscribes `done` + `hasData` so it fires after hydration (incl. the encrypted
  async-rehydrate path). **⚠ NEVER in viewerMode** (a viewer's `monthlyLog` comes from the owner's
  snapshot with an empty local `dayLog` → reconciling would delete every daily month). Cross-device:
  each device reconciles once against its own store; records LWW converges (a device that pulls another's
  reconciled month merges it, then its own reconcile no-ops).
- **REOPEN PRINCIPLE (state once, inherited by future rollup-touching fixes):** *a sign-off attests
  specific figures; any operation that changes a confirmed month's rolled figures reopens it.*
  `rerollMonth` flips `confirmed→false` on re-roll — the diff-guard makes this correct (unchanged months
  are skipped → `confirmed` preserved; a changed month's stale sign-off reopens, surfacing via the
  existing reconcile banner / "awaits sign-off" pointer). The owner has no confirmed months yet.

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

## Date Formatting — `todayLocalISO()` / `toLocalISO()` (`src/utils/format.ts`)

**Never derive "today" or format a specific local `Date` via `new Date(...).toISOString().split('T')[0]`**
— `toISOString()` is always UTC. For "today", this shows TOMORROW's date once UTC has rolled over
while it's still evening in a behind-UTC zone (e.g. US) — a real bug that hit date-stamping
(`cbLoanBalanceAsOf`, `ndpLastPaidDate`), date-input `max` bounds, the Daily Mode event-filing date, and
several store defaults/seeds. The complementary bug (a LOCAL `Date` built via `new Date(y, m, d)` then
formatted via `.toISOString()`) shifts a day *earlier* in ahead-of-UTC zones — hit the month-entry-date
builders in `SimpleModeView`/`MonthlyLogOverlay`/`MonthlyLogSection`.

```typescript
export const toLocalISO = (date: Date): string => `${y}-${mm}-${dd}`;   // LOCAL getFullYear/getMonth/getDate
export const todayLocalISO = (): string => toLocalISO(new Date());
```

- **Use `todayLocalISO()`** anywhere "today" (the real wall-clock calendar day) is needed: date-stamping
  setters, date-input `max` attributes, day-event dates, `advisorStartDate` defaults/seeds.
- **Use `toLocalISO(date)`** anywhere a specific LOCAL `Date` object (e.g. `new Date(y, m, 1)`, the
  first-of-a-strategy-month) needs to become its correct calendar-day string — never `.toISOString()`.
- **`MonthlyLogSection.tsx`'s month-entry-date builder** goes one step further: it must extract
  `advisorStartDate`'s y/m from the RAW STRING (`.split('-').map(Number)`), never via
  `new Date(advisorStartDate).getFullYear()/.getMonth()` — that round-trip parses the string at UTC
  midnight (JS spec) then reads it back with LOCAL accessors, which shifts a MONTH in behind-UTC zones
  whenever the anchor date falls near a month boundary (mirrors `MonthlyLogOverlay.getMonthDate`'s
  already-correct pattern).
- **`useStore.ts`'s `strategyMonthDate`** is a distinct case — do NOT convert it to `toLocalISO`. Its
  output feeds `bucketEventToMonth`/`calendarModel.ts`'s UTC-string calendar-date convention, so it
  stays UTC-consistent THROUGHOUT (`setUTCMonth`/`getUTCMonth`, not local accessors) rather than mixing
  a UTC-parsed input with local month arithmetic (which was the actual bug — an off-by-one near month
  boundaries in behind-UTC zones).
- **`src/components/Daily/calendarModel.ts` stays UTC by design** — it never derives "today"; it only
  does UTC-midnight ms-stepping arithmetic on `'yyyy-mm-dd'` strings that are already correct (matching
  `bucketEventToMonth`'s spec-mandated UTC-midnight parse of date-only ISO strings). This is internally
  self-consistent and DST-safe; converting it to local-time arithmetic would risk DST bugs. `DailyModeView`
  compares its `today`/`selectedDay` as opaque `'yyyy-mm-dd'` strings, so once `todayLocalISO()` produces
  the correct calendar day upstream, it flows into the UTC-string calendar logic with no mismatch.
- **Almanac** (`HalvingClock`/`CycleClock`/`CycleDial`) and `DevPanel.tsx`'s diagnostic
  `now: new Date().toISOString()` stay UTC/full-ISO by design — unaffected.

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

562 tests — `npx vitest run` before every commit.
- `dailyMode.test.ts` (Strategy-Month Calendar Fix block) — calendar-anniversary `bucketEventToMonth` (Jun-1 start: Jun 30=M1, **Jul 1=M2**, Aug 1=M3; Jan-31 start short-month clamp Feb 28=M2; `strategyMonthIndex` unclamped <1 pre-start / =13 at start+12mo = the completion signal) + `strikeCollateralDelta` (strike ±, ignores cb/non-collateral, honors the bucket fn — calendar vs `legacyBucketEventToMonth` place a boundary deposit in different months) + `sameRollupFields` (0≡absent; undefined-entry↔empty-fresh; differ on amount/stock/provisional). `dailyModeStore.test.ts` reconcile block: a boundary event M1→M2 empties the stale M1 daily entry + creates M2, second run idempotent, flag set; **Correction 1** — a boundary strike deposit re-rolls BOTH neighbors even when every `sameRollupFields` key matches (the collateral-delta comparison caught it); `monthBucketReconcileDone` default-false / rides partialize / absent from `buildSettingsPayload`. `collateral.test.ts` fixture re-expressed in calendar terms (`startMonthsBack(4)` → deterministic Month 5).
- `src/simulation/__tests__/readingAnchors.test.ts` — §5b Readings-Unification pure `deriveReadingAnchors`: guard (date ≥ asOf; null asOf always applies; idempotent already-anchored → empty patch), select-by-DATE-not-ts (edited older reading with a newer ts does NOT win), delete/date-move fallback (date+value proxy re-points to the survivor; no survivor → unchanged; KNOB-SET IMMUNITY — unrelated same-day delete whose value ≠ the knob-set anchor doesn't clobber), cbLiqPrice omit/present, Strike-only reading leaves CB anchors alone. (`dailyModeStore.test.ts` §5b block: add re-anchors advisorActualBlocBalance/cbLoanBalance/cbLiquidationPrice + asOf=today; `setDayLog` merge folds cbCollateralBtc but NOT the balance anchors; delete-fallback; `advisorActualBlocBalanceAsOf` synced/default-null/stamped. `eventSheet.test.ts`: `reading.cbLiqPrice` omitted when blank/0, present when entered, never on a collateral move.)
- `src/lib/nostr/__tests__/establishOwner.test.ts` — Phase 1.5 `establishLocalOwner` (2 cases, mocked wrapSecretKey/syncNow/NSecSigner): PIN path persists the wrapped pair + sets nostrPubkey(from sk)/nostrSigningMethod='local'/isAuthenticated=true IN ORDER (invocationCallOrder pubkey<method<auth) + calls syncNow/markSignerFresh + zeros the sk; PRF path forwards the passkey label (not a pin)
- `src/lib/backup/__tests__/exportPlan.test.ts` — Plan Export/Backup Tool: `buildPlanBackup` excludes viewerNpub/viewerPubkey/viewerLabel/nostrRelays (sharing/transport config) while including real plan settings (income/creditLine/cbLtvTriggerPct); includes the full records set (monthlyLog/deletedMonths/dayLog/deletedDayEvents); the wrapper has format/schemaVersion/storeVersion/exportedAt/plan; device-local/session fields (devMode/viewerMode/settingsDirty/initialSettingsPullDone/nostrPubkey) stay naturally absent
- `src/store/__tests__/settingsClobber.test.ts` — Fresh-install seed-clobber fix: Fix C (`syncSettingsToNostr` does NOT dirty when `!initialSettingsPullDone`; DOES dirty once true — legitimate publishing intact) + Fix D (`publishSettingsNow` refuses a seed-identical payload pre-pull [returns false + warns + no state change]; after the pull the seed-guard does not fire). Fix B is in `sync.test.ts` (first pull with `!initialSettingsPullDone` hydrates real remote settings even when `settingsDirty` is spuriously true)
- `src/simulation/__tests__/safetyView.test.ts` — Viewer Revamp V1 `deriveSafetyView`/`deriveViewerOverall` (19 cases): credit bands at the new 0.75/0.90 edges + creditLine-0 guard; Strike LTV bands (0.646/0.697 at 85% liq) + crashLtv (20%-of-price) + zero-collateral guard; CB LTV gating (!hasCbLoan → cbLtv 0/safe even with cb inputs) + bands + cbCollateral-0 guard; overall = worst of gauges SHOWN, credit INCLUDED, cb folded only when hasCbLoan
- `smartBloc.test.ts` — uses `runBLOC` (not `runBlocYearOne`)
- `simpleModePlan.test.ts` — `deriveForMonth` (unskipped projection; monthly vs ltvTriggered CB; !hasCbLoan zeros CB; distinct rows → distinct values), `isOperatingMonth`, `composeMonthSummary` (clause inclusion + skip branches + past-tense logged), projection-vs-reality guarantee (deriveForMonth is skip-param-free; monthly CB payment drops row LTV below the start-of-month figure). **Simple Mode Corrections:** income source ends month 12 with a LOWER BLOC balance than roll (+ roll === omitted-input default); shortfall path (min > income → pay income, capitalize the rest); `deriveForMonth` folds `minPayment` into the allocation identity; narration income-vs-capitalizes; **mis-ordered thresholds guard** (target ≥ trigger → cbPaydownDraw/cbLtvTriggered suppressed, draw/interest still run)
- `src/store/__tests__/strikeMinPayment.test.ts` — Simple Mode Corrections A synced settings: `blocMinPaymentSource`/`blocStatementMinimum` default roll/null, appear in `buildSettingsPayload`, hydrate cross-device, and a remote event lacking them doesn't clobber (whitelist skips absent)
- `src/components/Daily/__tests__/dailyView.test.ts` — Daily Mode P4a pure helpers: `selectMonthEvents` (bucketEventToMonth filter, asc-by-ts sort, empty-month) + `describeDayEvent` per kind (draw/paydown USD; buy BTC ±usd; deposit/withdraw target labels; cbCollateralReading BTC; balanceReading Strike-always + CB-when-present)
- `src/components/Daily/__tests__/calendarModel.test.ts` — Daily Mode P4c-1a pure calendar model (15 cases): `monthDateRange` (every date buckets back to its strategy month via bucketEventToMonth — load-bearing; contiguous+ascending; month 1 starts at advisorStartDate; boundary last-of-N/first-of-N+1 adjacency), `weekDates` (7 dates Mon→Sun, Monday-first incl. Sunday-input), `buildDayCells` (draw→[logged]; balanceReading→[reading]; both→both; cb-deposit→[logged,cbCollateral]; strike-deposit→[logged]; empty→[]; weekday Mon=0..Sun=6), timezone no-drift (exact yyyy-mm-dd near a month boundary)
- `src/components/Daily/__tests__/eventSheet.test.ts` — Daily Mode P4b-1 pure helpers (import `../eventSheetModel`): `readingComplete` gate matrix (Strike-only when !hasCbLoan; +CB fields iff hasCbLoan) + `buildEventsFromSheet` per type (setBalance→[reading]; draw/paydown→[flow,reading] USD; buy→[buy usd=amount*price,reading] BTC; collateral→[deposit target,reading], target strike+cb, defaults strike when !hasCbLoan), reading carries price, **LTV percent ÷100 → fraction (11.2→0.112)**, CB reading fields present iff hasCbLoan, flow+reading share ts with distinct ids. **v20 (C-P3):** `readingComplete` false when strikeCollateral null; reading carries strikeCollateral from `s.strikeCollateral` (falls back to the `currentStrikeCollateral` arg); manual override wins; `autoStrikeCollateral` post-move total (deposit+/withdraw−/pledged-buy+/else current); pledge ON → [buy,deposit target:'strike' amount=buy,reading] shared date+ts distinct ids, pledge OFF → [buy,reading]
- `src/store/__tests__/planBars.test.ts` — `showPlan*Bar` default true, setters, device-local (hydrateSettings ignores them — absent from SETTINGS_FIELDS)
- `src/store/__tests__/relaySync.test.ts` — Option C: `buildSettingsPayload` INCLUDES `nostrRelays` + `buildViewerSnapshotPayload` settings STRIPS it; `hydrateSettings` relay guard (custom incoming replaces; empty/DEFAULT_RELAYS incoming guarded over a custom local list; applies when local is defaults/empty; order-independent sorted compare; skip-FIELD — a guarded relays field never blocks `income`); + the publish-trigger follow-on (`setNostrRelaysAndSync` sets the list AND marks `settingsDirty`; plain `setNostrRelays` sets it but leaves `settingsDirty` false — fake timers swallow the debounce)
- `src/store/__tests__/viewerPublishGate.test.ts` — `publishRecordsNow` viewerMode backstop: with full publish creds + `viewerMode:true` → returns false at the gate (`setNostrSyncing` never called); with `viewerMode:false` → passes the gate (`setNostrSyncing(true)` called) and only then fails at the stub-signer publish step (owner baseline unchanged)
- `cbMetrics.test.ts` — `cbMetrics` (ltv/liqPrice/triggerPrice/pctTo* + divide-by-zero guards), `accruedCbBalance` (null/0-day/30-day compounding), `activeLiqPrice` entered-vs-computed authority + cushion divergence, `barLevel`/`worseLevel` state selection, Strike 85% gauge, refactor-safety (cbMetrics == old inline Main/Sidebar formulas)
- `emergencyModel.test.ts` — Emergency Console Phase 1 pure model (9 cases), Directive fixtures ±$1: `classifyStage` liq 41650.62 + bands watch 51912/execute 47759/lastResort 44222; `firepower` slow floor 38842 (cured) / fast floor 39621 (stuck, crash 48000); `floorTable` ceiling-30 row; `drawToLtv(30)@48000` slow drawUsd 5990.73 + newSkLtv=0.30 + 50%-line clamp (capped); walls (direSwitch/wall3Sale/wall4External round-trip to a target liq); `surplus`; CB_LADDER fixed 69/72/75/81
- `src/simulation/__tests__/cycleModel.test.ts` — Almanac CycleClock P1 (12 cases): `epochFromHeight` epoch-5 classification + 2028 rollover (Epoch 6/1.5625, no code change); `epochProgress.fraction` 0..1 single-source (half-open — ~1 just below endBlock, 0 at rollover) + `blocksRemaining === 1_050_000 − h` exactness; `dateAtBlock` 144-blocks≈1-day; `blockAtDate(H4.date)===H4.block`; `CYCLE_TURNS` IMG_7080 premise (14 turns, anchor high @ 6 Oct 2025, first low Mon 5 Oct 2026 @ +364d, every turn `getUTCDay()===1`, strictly increasing, strict high/low alternation); `nextTurnAfter` selection + null past end
- `living.test.ts`
- `mining.test.ts`
- `monthlyLog.test.ts` — includes recomputeBtcHeld suite (+ collateralAdjustment chain math, pending in both derives) + 4 badge status tests
- `dailyMode.test.ts` — Daily Mode P1: `bucketEventToMonth` (date→month 1–12, clamp) + `rollupMonth` (flows draw/buy±usd/paydown; `target:'strike'` deposit/withdraw signed into `collateralDelta`, `target:'cb'` + `cbCollateralReading` journal-only/ignored; latest-`balanceReading`-by-ts stocks, `cbCollateral` never in entry; carry-forward `provisional` w/ priorStocks; empty→`{}`; entry never has collateralAdjustment/btcHeld/cbCollateral/source/confirmed; date-boundary isolation). P2a: `deriveCbCollateral` (latest cbCollateral-bearing event by ts across both kinds; cache fallback; ignores readings w/o cbCollateral)
- `src/store/__tests__/dailyModeStore.test.ts` — Daily Mode P2a store: add(draw+balanceReading)→entry flows+stocks/source:daily/btcHeld intact; buy→btcHeld; **C1 double-count** (two strike deposits + edit-one + delete-one each net once via getCurrentBtcHeld); target:cb journal-only (no collateral change; cb-only month creates NO entry / doesn't flip a manual month to daily; mixed cb+draw month is daily via the draw) + cbCollateral feeds the clock; **BUG1** (cbCollateralReading creates no monthlyLog entry); Partial→Full preserves miningSats/ndpPaid/loggedAt; **C2** (setCbCollateralBtc emits a cbCollateralReading, absent from buildSettingsPayload); **M2** guard (non-daily upsert vs a daily month blocked); confirmMonth + reopen-on-edit; date-change re-rolls both months; `migrateState` v19 backfill (source/confirmed, cbCollateralReading seed for hasCbLoan, cbLtvAction default, cbCollateralBtc reproduced); `partializeState` includes dayLog+cbLtvAction. **P3:** `deleteDayEvent` writes a numeric `deletedDayEvents[id]` + removes the event; a journal-only `addDayEvent(cbCollateralReading)` sets `recordsDirty` + leaves `monthlyLog` empty (publish trigger for the no-month path); raw `setDayLog([cbColl@ts1, cbColl@ts2])` derives `cbCollateralBtc` to the newest (the fold) WITHOUT rerolling monthlyLog; `setDeletedDayEvents` raw-set; `partializeState` includes `deletedDayEvents`
- `src/store/__tests__/collateral.test.ts` — **v20 reading-anchored Strike collateral** on the REAL store: a `balanceReading.strikeCollateral` anchors `getCurrentBtcHeld`; a post-anchor `deposit target:'strike'` adds once; **SEMANTIC SHIFT** — a bare deposit with no reading does NOT move current; `target:'cb'` never touches Strike; latest reading re-anchors; Strike LTV tracks `getCurrentBtcHeld` (not the frozen baseline); baseline stability (`advisorActualBtcHeld` never moves); `setDayLog` folds the strike derive; sandbox isolation; delete re-chains the historical `btcHeld` chain + tombstone. `src/simulation/__tests__/strikeCollateral.test.ts` — pure `deriveStrikeCollateral` (anchor by date/ts, post-anchor sum, atomic same-ts flow+reading NOT double-counted, backfill excluded, buys/cb ignored, withdraw sign, no-anchor→fallback)
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
- `src/lib/nostr/__tests__/sync.test.ts` — settings watermarks + settings-dirty receive gate, records merge-apply (legacy array + v2 payload), relay-behind dirty flag, fetchAndSync boolean (decrypt failure → false, nothing applied), publishEncrypted first-ACK. P3: a records payload carrying dayLog/dayLogDeletions → setDayLog/setDeletedDayEvents called with the merged values; a legacy payload without dayLog hydrates safely (defaults []/{}, no throw). Seed-clobber Fix B: the FIRST pull (`!initialSettingsPullDone`) hydrates real remote settings even when `settingsDirty` is spuriously true (the fixture default is `initialSettingsPullDone: true` = established session)
- `src/store/__tests__/viewerSnapshot.test.ts` — viewer snapshot builders: owner viewer-config (viewerNpub/Pubkey/Label) IN buildSettingsPayload but STRIPPED from snapshot.settings (+nostrRelays); the Option-B shape (settings+records+strike+**cbCollateralBtc** P3 + **strikeCollateralBtc** C-P4); **P3 BUG2** — snap.cbCollateralBtc === deriveCbCollateral(dayLog,cache) (newest reading, not the cache); **C-P4** — snap.strikeCollateralBtc === deriveStrikeCollateral(dayLog,cache) (the reading, not the cache) + the SAFE payload's Object.keys excludes BOTH scalars; snap.records has entries+deletions but NOT dayLog; viewer-side fields device-local
- `src/lib/nostr/__tests__/viewerSync.test.ts` — P3/C-P4 viewer hydrate (mocked SimplePool + NSecSigner decrypt + store getState/setState): **BUG3** — a snapshot raw-sets cbCollateralBtc + strikeCollateralBtc (C-P4) AND leaves dayLog empty + NEVER calls setCbCollateralBtc (no spurious reading injected into the viewer's journal); a pre-P3/pre-C-P4 snapshot without the scalars keeps the existing values (?? fallback); a revoked snapshot → clearViewerData, neither scalar applied
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

**PWA / offline (Workbox via vite-plugin-pwa `injectManifest`):** `src/sw.ts` is the custom SW; the plugin
injects the full-build precache manifest (`self.__WB_MANIFEST`) and emits `dist/sw.js` — every hashed
asset (index/js/css/svg) is precached, **per-deploy versioned + atomically activated**, with a
`NavigationRoute → '/index.html'` SPA fallback, so an offline launch no longer white-screens (the old
hand-rolled `sw.js` precached only `/` + `/index.html` and network-first'd the rest). On first activation of
the new SW the legacy `personal-bloc-v1` cache is deleted. **Cross-origin APIs (price/candles/relays) are
intentionally network-only** — no runtime caching; the stores carry last-known values and a failed poll is
handled gracefully. Registration is `registerSW({ immediate: true })` in `main.tsx` (autoUpdate; the inline
`index.html` script is gone), with `injectRegister: null` in the plugin config to avoid a double injection.
`src/sw.ts` typechecks under a dedicated **`tsconfig.worker.json`** (WebWorker lib, no DOM; referenced from
the root tsconfig, excluded from `tsconfig.app.json`) so `tsc -b` stays clean. **Vercel builds it via its
`vite build` buildCommand** (the plugin runs in `vite build`, not `tsc -b`). Note for the parked
security-hardening batch: SW response-caching policy now lives in `src/sw.ts`.

**Crash diagnostics:** a top-level `ErrorBoundary` + `GlobalErrorOverlay` (`src/components/Layout/ErrorBoundary.tsx`,
wrapped around `<NostrProvider><App/></NostrProvider>` in `main.tsx`) — white-screen crashes now render
on-device diagnostics (message/stack/component-stack, copy + reload) instead of a blank page; built for
offline-boot debugging, kept permanently (not a temp probe).

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
plan-card status-bar visibility, default true), `simpleView` (`'dashboard'|'monthly'|'daily'` consumer-shell view,
default `'dashboard'` — Owner IA dashboard-first; migrate-default only), `viewerDisplayName` (Viewer V3 — the viewer's greeting name, default
null; cleared on `resetViewerSession`), `writerKeyWrapped`/`writerKeyWrapMeta` (the writer
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
                                    # #4: optional onBack prop renders a back button in the main options view; its label
                                    # is the Phase-2 `backLabel?` prop (default "← Back"). AppShell's locked-out-unlock
                                    # escape passes backLabel="← Back to Face ID unlock" (+ onBack=()=>setUnlockEscape(false)
                                    # → falls back to LocalUnlockGate); the Settings access door + onboarding fork login use
                                    # the default. Absent in first-time onboarding which passes no onBack. #6: when a
                                    # writerKeyWrapped already exists (e.g. after a local→nip46→local switch) the local
                                    # section shows "Unlock with Face ID" (handleUnlockExisting → setNostrSigningMethod
                                    # ('local') → restoreSigner) instead of forcing an nsec re-import; a "Use a different
                                    # key" ghost sets forceImport to reveal the import form, and a 'pubkey mismatch' throw
                                    # (different account) catch-and-falls-back to import with a message
    LocalUnlockGate.tsx             # "Authenticated-but-locked" relaunch screen for the 'local' method —
                                    # gesture-driven "Unlock with Face ID" (restoreSigner→unwrap) + Retry +
                                    # "Use a different login" escape; reuses NostrAuthGate.module.css
    ViewerLoginFlow.tsx             # Access Layer Phase 1 — the viewer-login flow EXTRACTED VERBATIM from
                                    # OnboardingModal (byte-identical crypto: wrapSecretKey→setUnwrappedViewerKey
                                    # →clearViewerData→setViewerWriterPubkey→setViewerMode(true); only the final
                                    # onComplete(true) became an onDone() prop). Self-contained overlay (own
                                    # .overlay/.modal) → reusable from BOTH onboarding AND Settings. Props {onDone,onBack}
    SecretKeyCard.tsx               # Phase 1.5 — SHARED blurred-nsec recovery-key card: bech32 nsec in --mono
                                    # (word-break), blurred by default (tap-to-reveal pill) + one-tap Copy
                                    # (flash "Copied ✓") + "Best kept in a password manager." Props {nsec,onCopied?}.
                                    # Presentational, never logs the key; reused by Access P2's Reveal-recovery-key
    ViewerUnlockGate.tsx            # Phase 3 viewer-key gate — unlock (wrapped) / one-time wrap-setup (v17 migrant);
                                    # populates viewerSync's in-memory holder. Reuses NostrAuthGate.module.css
    ViewerWaitingGate.tsx          # Data-remanence guard — "Waiting for the owner's data…" until viewerDataLoaded
                                    # (valid decrypt) + "Reset viewing key" escape (a revoked/rotated-out viewer
                                    # isn't trapped → reset re-enters the onboarding fork → reconnect with a new
                                    # token). Handoff v4 PASTE-ONLY: the send-your-npub/"Copy my npub" affordance is
                                    # RETIRED (owner mints the key; viewer only pastes a token) — no getViewerNpub here
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
                                    # v2 — P3 += dayLog + dayLogDeletions, REQUIRED). ViewerSnapshot += optional cbCollateralBtc (P3 BUG2 scalar) + strikeCollateralBtc (C-P4 scalar, trusted-only).
                                    # P2: publishRelayListNip65(signer,_pubkey,relays,publishTo?,opTimeoutMs?) — a PLAIN
                                    # (unencrypted) kind-10002 relay list (flat r tags, no read/write markers); MUST NOT
                                    # route through publishEncrypted/signer.nip44 (10002 is public). Both share the
                                    # private publishSignedToRelays tail (now QUORUM-ACK min(2,pubs.length) via the pure
                                    # exported awaitAckQuorum, was first-ack; gains a `label` param + records a PublishReport;
                                    # 12s-timeout, pool close after allSettled) — extracted from publishEncrypted, whose
                                    # signature is unchanged. Exports awaitAckQuorum + PublishReport + getPublishReports (ring
                                    # buffer, last 10) for DevPanel PUBLISH ACKS + Copy Diagnostics (metadata only)
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
    establishOwner.ts               # Phase 1.5 — establishLocalOwner(sk, method, nostr, opts?): the SINGLE local-owner
                                    # establish path (wrap→persist writerKey→NSecSigner+setNostrSigner→markSignerFresh→
                                    # setNostrPubkey(getPublicKey(sk))→setNostrSigningMethod('local')→fire-and-forget
                                    # syncNow→setIsAuthenticated(true)→sk.fill(0)). Extracted VERBATIM from NostrAuthGate's
                                    # import body → BOTH the import path AND OwnerKeySetup K3 call it (zero drift).
                                    # ⚠ NEVER logs the nsec. NostrSigner from './signers' (sibling re-export)
    viewerKey.ts                    # Viewer-key derivation v1 — deriveViewerKeyFromNsec(sk, ownerPubkeyHex, version=1)
                                    # → deterministic 32-byte viewer secret key. WebCrypto DIRECTLY (crypto.subtle), NOT
                                    # keyVault's helpers/info labels (own crypto domain). HKDF-SHA256: ikm=owner sk,
                                    # salt=SHA-256(utf8(ownerPubkeyHex)), info=`personal-bloc/viewer-key/v${version}`,
                                    # deriveBits 256; if out-of-range (~2^-128) append `/${counter}` to info + re-derive
                                    # (validity gate = getPublicKey try/catch, no extra deps). Deterministic in
                                    # (ownerSk, ownerPubkeyHex, version) → the owner regenerates the SAME viewer nsec
                                    # anytime (no separate backup). Does NOT mutate sk; returns a fresh array the caller
                                    # zeroes. ⚠ Never logs/persists key material
    handoffToken.ts                 # Viewer handoff v3 — buildHandoffToken(keyPart, ownerNpub) → `<keyPart>:<ownerNpub>`
                                    # + parseHandoffToken → {kind:'nsec'|'ncryptsec', keyPart, ownerNpub} (ownerNpub NON-NULL).
                                    # PURE (nip19 bech32 only, NO crypto): trim, split on ':' (EXACTLY 2 parts required — bare
                                    # nsec / anything not 2-part → null, bare-nsec back-compat RETIRED), classify keyPart by
                                    # prefix, validate the npub half decodes as npub. Owner builds it in SharingPage (keyPart =
                                    # nip49.encrypt(derived,passphrase) or nip19.nsecEncode); viewer parses + nip49.decrypts it
                                    # in ViewerLoginFlow
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
                                    # setDeletedMonths/setStrike*); NEVER publishes/dirties. P3/C-P4 (BUG3): raw-sets
                                    # cbCollateralBtc + strikeCollateralBtc from snap via ONE useStore.setState — NEVER
                                    # setCbCollateralBtc/emitBalanceReading (they'd inject a reading into the viewer's OWN dayLog);
                                    # the viewer's dayLog stays []. useViewerSync (hook) mounts it on foreground; gated on viewerMode
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

- `publishEncrypted()` — NIP-44 self-encrypt → kind:30078 → returns the published `created_at` once an
  **ACK QUORUM of `min(2, pubs.length)`** confirms (pubs = the per-relay publish promises, === relays
  normally; deriving from pubs guards the URL-dedup case so quorum can't exceed the actual attempts) (was
  FIRST relay ACK — a single lying/dying relay
  could ACK an event retrievable from NO relay, clearing `recordsDirty`/`settingsDirty` and defeating the
  dirty-gated retry; device-confirmed Jul 2026). The shared tail `publishSignedToRelays(signed, relays,
  createdAt, label)` computes the quorum + awaits the pure exported **`awaitAckQuorum(pubs, quorum,
  timeoutMs, onOutcome?)`** (resolves at `acks >= quorum`; rejects the moment the quorum is unreachable
  [`pubs.length - rejections < quorum`, AggregateError of the reasons] or on the 12s timeout ["publish
  timeout — quorum not reached"]; `onOutcome` fires per settle regardless of resolve/reject state, feeding
  instrumentation). ⚠ **nostr-tools 2.23.5 footgun:** `SimplePool.publish` **RESOLVES** a connection
  failure as the STRING `"connection failure: …"` (`pool.js` `ensureRelay` catch → `return String(...)`,
  not a rejection; `maxWaitForConnection` 3000ms), so an offline publish would count as N fake acks at
  ~3001ms and clear the dirty flags. `publishSignedToRelays` NORMALIZES these to rejections via the
  exported `isConnectionFailure` (maps each `pub` to `throw` on the prefix) **before** the quorum — an ack
  counts only a genuine relay OK frame; the normalized rejection flows into `onOutcome`/the PUBLISH ACKS
  panel as a reject row. Genuine relay rejections (inside `r.publish`) already rethrow. Other relays
  continue in the background; pool closes after ALL settle; the watermark isn't stamped for a lost event. Per attempt it records a **`PublishReport`** into a module-level ring
  buffer (last 10, `getPublishReports()` — `{label (dTag/kind), createdAt, startedAt, perRelay:[{url,
  status:ack|reject|pending, ms?, err?}], outcome:ok|fail}`; metadata only — no amounts, safe for Copy
  Diagnostics), filled via `onOutcome`, and `nostrLog('warn', …)` when the quorum is met but a relay
  rejected (names the relay). `publishRelayListNip65` (kind-10002) shares the tail → inherits the quorum.
  **`created_at` is PER-D-TAG MONOTONIC** (module-level `lastCreatedAtByDtag`): `createdAt =
  max(floor(Date.now()/1000), last[dTag]+1)`. Second-granularity stamps would let two publishes of the
  same **replaceable** d-tag within one second TIE on `created_at` → NIP-01 tie-break (lowest id) can
  randomly keep the OLDER (incomplete) payload; the monotonic bump makes ties impossible within a session.
  Per-tag counter → settings/records/viewer never interfere (covered for free; `publishRelayListNip65` is a
  separate kind-10002 path, untouched)
- `publishSettingsNow()` — exported from the store; THE settings publish path (immediate, flag-managing,
  returns boolean — mirrors `publishRecordsNow`): builds the 34-field payload from current state, dynamic
  imports `publish.ts` (circular-dep avoidance); on success stamps `lastSettingsSyncAt` + clears
  `settingsDirty` + `nostrReconnectNeeded`; on failure sets `nostrReconnectNeeded` (dirty stays true →
  retried by `syncNow` exactly like records)
- `syncSettingsToNostr()` — thin wrapper called by every synced setter: marks `settingsDirty`
  SYNCHRONOUSLY (app close mid-debounce still retries next launch), then 2s debounce →
  `publishSettingsNow()`. Accepted micro-race: a setter firing during an in-flight publish re-marks
  dirty + re-schedules (~2s later); only loss window is full app close inside that ~2s
- `publishRecordsNow()` / `publishRecordsNowImmediate()` — exported from the store; publish the v2
  `RecordsPayload` `{ entries: monthlyLog, deletions: deletedMonths, dayLog, dayLogDeletions }`.
  **`publishRecordsNow()` is now a fire-and-forget TRAILING DEBOUNCE (~400ms, module-level
  `recordsDebounceTimer`, mirrors `syncSettingsToNostr`)** — the log mutators call it standalone (outside
  syncNow), and EventSheet's flow+reading saves as two back-to-back `addDayEvent` calls, so coalescing them
  into ONE publish prevents two same-second publishes of the replaceable records d-tag (the created_at-tie
  bug; belt-and-suspenders with the monotonic `created_at`). State is snapshotted at FIRE time (getState
  inside the immediate fn); `recordsDirty` stays true until the debounced publish succeeds, so an app kill
  mid-debounce self-heals on the next pull (`syncNow` publishes-if-dirty). **`publishRecordsNowImmediate()`
  is the un-debounced variant** (returns the awaited boolean; manages the flags — clears `recordsDirty` +
  `nostrReconnectNeeded` on success, sets `nostrReconnectNeeded` on failure) used by `syncNow` (honest push
  reporting), the sync-repair path, and the viewerMode-gate test; calling it clears any pending debounce
  (an immediate publish supersedes it → no redundant NIP-46 signer op). **Gated on `viewerMode`**
  (`!isAuthenticated || !nostrSigner || !nostrPubkey || viewerMode → return false`, on the immediate fn):
  a read-only viewer IS authenticated with its own nsec, so the auth gate alone wouldn't stop it — the
  `viewerMode` term is the relay-side backstop for the read-only-viewer invariant. The owner has
  `viewerMode===false` so it's unaffected; the owner→viewer snapshot publish (`publishViewerSnapshotNow`,
  gated on `viewerPubkey`) is a SEPARATE path, untouched
- **Repair-on-detect (`sync.ts`):** when a records pull detects the relay is behind
  (`norm(merged) !== norm(remote)` → `setRecordsDirty(true)`), it also fires `void
  publishRecordsNowImmediate()` right there — the gap self-heals immediately instead of lingering until the
  next user action. No loop: a successful publish clears `recordsDirty`, and the next pull's
  `norm(merged) === norm(remote)`
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
- **INVARIANT — a freshly-authenticated session must complete an initial settings PULL before it may
  PUBLISH settings; seed/un-established state must NEVER (a) block hydration of real remote data nor
  (b) be published over it.** (Fixes the fresh-install→login data-loss incident + closes parked backlog
  #6 — a seed-default store published defaults over the owner's real relay data.) The gate is the
  session-transient **`initialSettingsPullDone`** (in-memory, NOT persisted — in the `partializeState`
  exclusion, reset each boot + in `clearViewerData`; never in `SETTINGS_FIELDS`). It is set `true` in
  `syncNow` right after `fetchAndSync` returns (the settings pull query resolved — whether it hydrated
  real data or the relay was empty; NOT set if `fetchAndSync` threw). Four layered defenses:
  - **Fix A (`syncNow.ts`):** the settings publish is gated `settingsDirty && initialSettingsPullDone`
    — a fresh login can't publish settings until it has pulled first.
  - **Fix B (`sync.ts applyRemoteEvent`):** the settings-hydrate guard is relaxed on the FIRST pull —
    `(!settingsDirty || !initialSettingsPullDone) && remoteTs > lastSettingsSyncAt` — so real remote
    settings hydrate even if a benign post-auth setter spuriously seed-dirtied the store (no genuine
    unpublished edits exist yet). Subsequent pulls (flag now true) keep the genuine edit-protection.
  - **Fix C (`syncSettingsToNostr`):** early-returns `if (!initialSettingsPullDone)` — a benign
    post-auth setter (`setSimpleMode` etc.) firing the instant auth flips true no longer dirties the
    seed store. This is the root fix.
  - **Fix D (`publishSettingsNow`):** refuses (returns false + warns) when `!initialSettingsPullDone`
    AND the payload is the untouched seed (`income===4000 && expenses===3500 && creditLine===10000 &&
    !advisorActualBtcHeld`) — the belt-and-suspenders net. No store version bump (transient flag).
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
Seven entry points — all funnel into `syncNow()` — plus a receive-only live subscription:

| Trigger | Path |
|---|---|
| Login | NostrAuthGate ×3 (NIP-07, bunker URI, NostrConnect QR/deep link) → fire-and-forget `syncNow(nostr)` |
| Cold launch | `useNostrAutoRestore` (optimistic auth, reverts only if restore failed with no signer) |
| Tab visibility | `useNostrSync` visibilitychange → visible |
| Window focus | `useNostrSync` window `'focus'` → triggerSync — a visible desktop tab never fires visibilitychange; focus covers app/window switches |
| Network reconnect | `useNostrSync` window `'online'` → triggerSync (+ openLiveSync when live) — catches an OS-level reconnect that fires neither visibilitychange nor focus. **DESKTOP-ONLY in practice: iOS standalone PWAs NEVER fire `online`** (`navigator.onLine` stays true through an airplane-mode cycle, device-verified Jul 2026) → the dirty-gated retry below is the iOS self-heal |
| Dirty-gated retry | `useNostrSync` second effect (`scheduleDirtyRetry`) — while `recordsDirty`/`settingsDirty`, a self-rescheduling backoff (5s→10s→20s→40s→60s, cap 60s) re-invokes `triggerSync`. **live instance only** (AppShell's `{live:true}` mount — a bare SettingsMain mount must not double-publish) + viewerMode-off. Visible ticks call triggerSync + advance backoff; hidden ticks skip the call and hold the current delay (iOS freezes hidden timers anyway). A flag transition restarts at 5s; a successful publish clears the flags → the chain tears down. The ONLY self-heal on iOS for a publish that failed offline (see Network reconnect) |
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
| `personal-bloc:viewer:v1` | **Viewer Access — MODE-SHAPED (Viewer V2).** `ViewerSnapshot` NIP-44-encrypted to the configured **viewer's** pubkey (`viewerPubkey`). Default **C-safe**: `{ snapshotVersion:2, privacyMode:'safe', asOf, hasCbLoan, btcPriceAtSnapshot, thresholds, safety }` — health ratios/config/public price only, NO absolutes by construction. **C-trusted** (opt-in via `viewerPrivacyTrusted`): the full `{ settings, records:{entries,deletions}, strike:{usd,btcAvail,rate}, cbCollateralBtc, strikeCollateralBtc }` + common (both collateral scalars are derived-from-dayLog, trusted-only + optional — the SAFE payload carries NEITHER by construction; C-P4). Pre-V2 (no `privacyMode`) reads as trusted | Fire-and-forget `void publishViewerSnapshotNow()` in the success path of BOTH `publishRecordsNow` + `publishSettingsNow`, AND on `setViewerPrivacyTrusted`/saving a viewer npub; gated on `viewerPubkey` set; **log-only** on failure — NEVER touches `settingsDirty`/`recordsDirty`/`nostrReconnectNeeded`/`nostrSyncing`. **Revoke** publishes the same d-tag with an empty payload + `revoked: true` (tombstone) via `publishViewerRevocationNow()` → the viewer wipes + exits (checked before the mode branch; replaceable, supersedes the old snapshot) |

### Viewer-key derivation v1 + handoff v4 — deterministic owner-minted viewer key + combined token + rotation (store stays v19, NO bump)

The owner is the SOLE MINTER of the viewer key: the owner **deterministically derives** the viewer's
keypair from the owner's OWN nsec (so the owner can regenerate the exact same viewer key at any time — no
separate backup) and hands off a token. **Handoff v4 is TOKEN-PASTE-ONLY on BOTH sides** — the old
"viewer generates its own key + sends the owner its npub" model is RETIRED (`ViewerLoginFlow` has no
generate mode + `ViewerWaitingGate` has no send-your-npub affordance; a self-generated key could never be
authorized since `SharingPage` has no field to receive a viewer npub). **The token** (`<keyPart>:<ownerNpub>`)
carries the owner's npub and supports an encrypted (NIP-49) key part for remote transport (see the Handoff
bullet). `parseHandoffToken` requires exactly 2 parts (`ownerNpub` non-null; bare-nsec retired at v3). Plus
an owner-side **key-rotation** affordance (honors the handoff passphrase).
- **`src/lib/nostr/viewerKey.ts`** — `deriveViewerKeyFromNsec(ownerSk, ownerPubkeyHex, version=1)` (see the Key
  Files entry for the HKDF formula + counter-bump). Deterministic in (ownerSk, ownerPubkeyHex, version).
- **`viewerKeyVersion`** (settings, default 1) — the version byte. **SYNCED** (in `SETTINGS_FIELDS` +
  `buildSettingsPayload` + `migrateState` default + initial state + a `setViewerKeyVersion` that syncs), so
  re-derivation is stable across the owner's devices; **STRIPPED** from the trusted viewer snapshot (added to
  the line-674 rest-omit destructure alongside `viewerNpub/viewerPubkey/viewerLabel/viewerPrivacyTrusted/
  nostrRelays`; the safe branch carries no settings). No store version bump (additive merge-default, mirrors
  `viewerPrivacyTrusted`).
- **Owner affordance (`SharingPage.tsx` `GenerateViewerKeyBlock`)** — LOCAL-SIGNER-ONLY (gated
  `nostrSigningMethod === 'local'`; nip07/nip46 never expose the raw sk → the block is hidden). Unwrap the owner
  key (Face ID / PIN, mirrors `RevealRecoveryKey`) → derive → `hex = getPublicKey(derived)` → **replace-guard**
  (`window.confirm` when `viewerPubkey` exists and differs — re-deriving the SAME key skips the confirm, keeping
  the determinism/recovery path friction-free; **rotation suppresses it** via a `doGenerate({skipReplaceGuard})`
  option arg) → `setViewerPubkey(hex)`/`setViewerNpub` →
  `publishViewerSnapshotNow()` → reveal the viewer nsec via `<SecretKeyCard>` (auto-clear ~30s, unmount discards
  it). Both owner sk + derived key zeroed in `finally`; ⚠ never logs key material.
- **Rotation (`GenerateViewerKeyBlock` `onRotateTap`)** — a "↻ Rotate viewer key" button rendered when
  `viewerPubkey` is set (the block is already local-signer-gated). `window.confirm` ("Rotating invalidates the
  current viewer key…") → `setViewerKeyVersion(getState().viewerKeyVersion + 1)` (sync `set` → `getState()`
  reads the bumped value → the setter's own `syncSettingsToNostr` publishes it; NO new sync wiring) → regenerate
  with the new version and the replace-guard SUPPRESSED (rotation is already confirmed — one dialog, not two). A
  `skipGuard` state bridges the intent across the PIN-collection step (the PIN-row Generate passes it). **No
  rollback if derive fails after the bump** — the version stays bumped/synced but no key was handed out;
  re-running uses the new version and determinism is preserved (acceptable, intentional). **Rotation HONORS the
  handoff passphrase** — the single `handoffPassphrase` input renders unconditionally above BOTH the Generate
  and Rotate buttons (not generate-gated) and `doGenerate` reads it at emit time regardless of entry, so a
  passphrase set before tapping Rotate produces an encrypted `ncryptsec` token (same as initial generate).
- **Handoff v3 — combined token (`src/lib/nostr/handoffToken.ts`).** The owner hands the viewer ONE string:
  `<keyPart>:<ownerNpub>` (bech32 excludes `:` → unambiguous). `keyPart` = a bare `nsec1…` (in-person) OR a
  passphrase-encrypted `ncryptsec1…` (NIP-49, safe for remote transport); the `ownerNpub` half means the viewer
  no longer needs the owner's npub via a second channel. `buildHandoffToken`/`parseHandoffToken` (PURE — `nip19`
  bech32 only, NO crypto): parse trims, splits on `:` (EXACTLY 2 parts required → else null; bare-nsec back-compat
  RETIRED), classifies `keyPart` by prefix, and validates the npub half decodes as an npub. `ownerNpub` is
  NON-NULL on the returned `ParsedHandoff`.
- **Owner path (`SharingPage.tsx` `GenerateViewerKeyBlock`)** — an optional **passphrase** input above the
  generate button; after derive + replace-guard, `keyPart = pass ? nip49.encrypt(derived, pass) :
  nip19.nsecEncode(derived)` (encode/encrypt BEFORE `derived.fill(0)`), then `buildHandoffToken(keyPart,
  npubEncode(ownerPubkey))` → revealed via `<SecretKeyCard hint=…>` (same ~30s auto-clear/Hide/unmount). All v1
  semantics (derive, replace-guard, publish, zeroing) unchanged.
- **Viewer path (`ViewerLoginFlow.tsx` — PASTE-ONLY, v4)** — the generate mode + its viewer-npub readout/Copy
  are GONE; the page is unconditionally the token-paste flow. The input is the **token**; `parseHandoffToken` →
  `parsed`. `nsec` → `nip19.decode`; `ncryptsec` → a **passphrase field** + `nip49.decrypt(keyPart, passphrase)`
  in try/catch (wrong passphrase → null → friendly "Wrong passphrase"). Both passphrase inputs (owner's in
  `SharingPage` + viewer's here) carry `autoCapitalize="none" autoCorrect="off" spellCheck={false}
  autoComplete="off"` — iOS silently autocapitalizes/autocorrects an un-suppressed field, which would make the
  encrypted and decrypted strings permanently disagree. ⚠ The passphrase is **DEBOUNCED 450ms**
  (`tokenPassphrase` → `debouncedPassphrase`) — `nip49.decrypt` is SYNCHRONOUS scrypt (default logn 16), so
  decrypting per keystroke would freeze the mobile main thread. The decrypt itself runs in a **`useEffect`, NOT a
  memo** (`decryptState: {key, checking}`): the effect trims `debouncedPassphrase` (**symmetric** with the
  owner's `handoffPassphrase.trim()` at encrypt time — an untrimmed viewer-side passphrase would silently
  mismatch a trimmed owner-side one), sets `{key:null, checking:true}` (never carries a stale key from a prior
  passphrase while re-checking), then a 30ms `setTimeout` yields one frame so **"Checking passphrase…"** actually
  paints before the blocking `nip49.decrypt` call runs (cleaned up on re-fire so a stale in-flight decrypt can't
  land after a newer keystroke); success → `{key,checking:false}`, throw → `{key:null,checking:false}`. The
  `pastedKey` memo's `ncryptsec` branch is just `decryptState.key` (no crypto in the memo). "Wrong passphrase"
  renders only `!checking && trimmed && !key`. **The owner-npub field is ALWAYS token-sourced + read-only**
  (`tokenOwnerNpub = parsed?.ownerNpub ?? null` → value `tokenOwnerNpub ?? ''`, empty until a valid 2-part token
  is pasted; a bare nsec → `parsed` null → "Not a valid token"). `activeKey = pastedKey`; `handleViewerDone`
  decodes `tokenOwnerNpub` / `wrapSecretKey(activeKey.sk)` UNCHANGED; `viewerCanDone`'s `!!activeKey` already
  gates a failed/in-flight decrypt.
- **`SecretKeyCard`** — one optional additive `hint?` prop (default password-manager copy); RevealRecoveryKey +
  OwnerKeySetup omit it (byte-identical), SharingPage passes a token hint.
- Tests: `src/lib/nostr/__tests__/viewerKey.test.ts` (determinism; domain separation by version/pubkey/sk — the
  version case ALSO covers rotation's version-bump; valid secp key; input-not-mutated + distinct-output zeroing
  contract); `handoffToken.test.ts` (build/parse roundtrip for both kinds; bare-nsec → null + 2-part-required;
  garbage/>1-colon/trailing-colon/bad-npub → null; whitespace trim; a full
  NIP-49 encrypt→token→parse→decrypt byte-equal roundtrip + wrong-passphrase throw); `viewerSnapshot.test.ts`
  extended (`viewerKeyVersion` IN `buildSettingsPayload`, OUT of the trusted snapshot settings, in the deep-equal
  strip). SETTINGS_FIELDS count 38 → 39.

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
- A fresh install picks **"Connect to a shared plan"** in onboarding (`OnboardingModal` step-1 fork) → the
  PASTE-ONLY `ViewerLoginFlow` (Handoff v4). It pastes the owner's handoff token (`<keyPart>:<ownerNpub>`) —
  the owner MINTED the key + owner npub travel INSIDE the token (no viewer-generated key, no npub-to-send) —
  wraps the key at rest (`viewerKeyWrapped`), sets `viewerMode=true` + `viewerWriterPubkey`, and lands in the
  simple-mode dashboard. (Historically Phase 2 had the viewer `generateSecretKey` its own key + show its npub
  for the owner to add — RETIRED at Handoff v4.)
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
  carve-out). The slim amber **"👁 Viewing … · read-only"** banner that used to sit atop the app body in
  viewerMode was REMOVED (redundant — the viewer experience is inherently read-only by construction;
  reclaims headspace). Its copy-my-npub affordance moved into `ViewerSettings` ("Your viewing key" row,
  YOU group) so a connected viewer can still retrieve/share their npub; `ViewerWaitingGate`'s own
  copy-npub button (the pending/revoked-case affordance, shown BEFORE a viewer reaches Settings) is
  unaffected.
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

### All 39 Synced Settings Fields
(`cbCollateralBtc` AND `strikeCollateralBtc` are LOCAL derived caches, NOT synced settings scalars — Daily Mode P3 / Collateral-Truth v20 CONVERGE them cross-device by carrying `dayLog`/`dayLogDeletions` on the **records:v1** channel (NOT settings:v1); each device re-derives them from the merged `dayLog`. `pendingCollateralAdjustment` was RETIRED at v20 — dropped from this list.)
`income`, `expenses`, `blocApr`, `creditLine`, `advisorStartDate`,
`advisorActualBlocBalance`, `advisorActualBlocBalanceAsOf`, `advisorMonthStartBalance`, `advisorActualBtcHeld`, `cbLoanBalance`,
`cbAprPct`, `hasCbLoan`, `ndpLastPaidDate`,
`tabOrder`, `hiddenTabs`, `simpleMode`, `btcBuyingUnit`,
`cbLiquidationPrice`, `cbMonthlyPayment`, `cbPaymentStrategy`,
`cbLtvTriggerPct`, `cbLtvTargetPct`, `cbRotateBackPct`, `cbEmergencyCeilingPct`,
`cbLoanBalanceAsOf`, `cbLiquidationPriceAsOf`, `strikeLiquidationLtvPct`,
`blocMinPaymentSource`, `blocStatementMinimum`, `blocMinPaymentDueDay`,
`advisorSkipBlocDraw`, `advisorSkipCbPayment`, `advisorSkipBtcBuying`,
`nostrRelays`, `viewerNpub`, `viewerPubkey`, `viewerLabel`, `viewerPrivacyTrusted`, `viewerKeyVersion`
(`viewerKeyVersion` (Viewer-key derivation v1) is the version byte for deterministic viewer-key derivation
(`deriveViewerKeyFromNsec`); it syncs across the owner's devices so re-derivation is stable everywhere, and — like the
other `viewer*` sharing fields — is STRIPPED from the viewer snapshot in the trusted branch (the safe branch carries
no settings block). `viewerPrivacyTrusted` (Viewer V2) syncs the owner's C-safe/C-trusted choice across the owner's devices; like the
other three `viewer*` sharing fields it is STRIPPED from the viewer snapshot in both branches AND from the plan backup.
The two CB `asOf` markers sync so freshness travels atomically with `cbLoanBalance`/`cbLiquidationPrice`.
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
| `lastSettingsSyncAt` | number | ✅ | Unix SECONDS (event.created_at) of last relay hydration |
| `lastRecordsSyncAt` | number | ✅ | Unix SECONDS (event.created_at) of last records:v1 event seen — observability ONLY, not a gate |
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
| Strike collateral (v20 Collateral-Truth) | **Reading-anchored** — `getCurrentBtcHeld() = deriveStrikeCollateral(dayLog, strikeCollateralBtc)` (the `strikeCollateral`-bearing `balanceReading` latest by (date,ts) + `target:'strike'` moves strictly after). `pendingCollateralAdjustment` / `adjustCurrentCollateral` / graduation / restore-on-delete / rerollMonth Seam-1 all RETIRED at v20. `collateralAdjustment` never written again (historical ledger — never "fix" the data). **Buys never pledge** unless the buy sheet emits an explicit `deposit target:'strike'` (C-P3). A bare strike deposit with no `strikeCollateral` reading does NOT move current (LD5). `strikeCollateralBtc` is a LOCAL derived cache (rides partialize `...rest`, NEVER in `buildSettingsPayload`/`SETTINGS_FIELDS`; converges via the dayLog on records:v1). |
| `deriveAdvisorStart` / `deriveCurrentPosition` | **v20 signatures:** `deriveCurrentPosition(monthlyLog, currentStrikeCollateral, baseBlocBalance)` — `btcHeld` output = the passed `currentStrikeCollateral` (= `getCurrentBtcHeld()` = reading-anchored `deriveStrikeCollateral`); `deriveAdvisorStart(monthlyLog, currentStrikeCollateral, baseBlocBalance, currentStrategyMonth, monthStartBalance)` forwards it. (Pending + baseBtcHeld params RETIRED.) Standalone — no imports from runAdvisor/runBLOC/runBlocYearOne. **`deriveAdvisorStart.startingBtcHeld ≡ deriveCurrentPosition().btcHeld ≡ getCurrentBtcHeld()`** (single definition of current position — callers pass `getCurrentBtcHeld()`). `startingBlocBalance`/`startingMonth` anchor on the last CONFIRMED entry: `e.confirmed !== false` (undefined = confirmed; only a LIVING unconfirmed daily rollup, `confirmed===false`, is excluded) so the current-month unconfirmed entry does NOT advance the projection start. No confirmed entry → empty branch returns `startingBlocBalance: monthStartBalance` + `startingMonth: currentStrategyMonth`; confirmed branch returns `last.strikeBal` / `min(last.month+1, 12)`. `blocBalance`/`lastLoggedMonth` still read from the last logged entry. |
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
| Zustand v20 migration | **Collateral-Truth Consolidation (C-P2)** — Strike collateral becomes reading-anchored. **Strips** `pendingCollateralAdjustment` (added to the destructure so it can't ride `...rest`). **Seeds** `strikeCollateralBtc` = the old-math current position from the RAW blob BEFORE stripping: `(rawLast?.btcHeld ?? advisorActualBtcHeld ?? 0) + pendingCollateralAdjustment` — CACHE-SEED ONLY (no synthetic dayLog event; clean journals). No legacy `balanceReading` carries `strikeCollateral` → `deriveStrikeCollateral` returns the fallback = seed → `getCurrentBtcHeld` is byte-identical pre/post. `advisorActualBtcHeld` STAYS (synced; historical chain + fallback). **Determinism residual:** un-converged `pending` across devices at migrate time seeds divergent caches (not synced) until the first `strikeCollateral`-bearing reading re-anchors both — self-correcting (pending is normally 0). Current store version = 20 |
| Zustand v19 migration | **Daily Mode P2a** — backfills legacy `monthlyLog` entries with `source:'manual'`/`confirmed:true` (only where undefined); adds `dayLog` (`?? []`, LOCAL-only) + `cbLtvAction` (`?? 'paydown'`). **C2 seed:** a `hasCbLoan` user with a `cbCollateralBtc` gets ONE seeded `cbCollateralReading` into dayLog so `deriveCbCollateral` reproduces the pre-migration value; then `cbCollateralBtc = deriveCbCollateral(dayLog, persisted)`. `migrate`/`partialize` were EXTRACTED to exported `migrateState`/`partializeState` (unit-testable — the persist API is unavailable under Node) |
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
| Strike avail-credit invariant | EVERY Strike available-credit surface — the daily-view trio pill, the `SafetyDashboard` capacity subtext, AND the viewer trusted figures (`computeViewerSafety` `figures.credit`) — computes via `strikeAvailableCredit` (the LTV-capped `min(creditLine, collateral×price×0.50) − drawn`). **Naive `creditLine − drawn` is RETIRED** (it overstated drawable credit by the LTV gap — device-observed $901 divergence). `figures.credit.total` = the BINDING limit (`cap.limit`), so `used + avail ≡ total` (holds when not over-drawn); when collateral value exceeds the line the limit naturally equals the credit line again |
