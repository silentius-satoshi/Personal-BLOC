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
- Vitest (191 tests — all must pass before every commit)
- Vercel (deployment + serverless proxy for Power Law data)
- @dnd-kit/core + @dnd-kit/sortable + @dnd-kit/utilities (drag-and-drop tab reordering)
- PWA: `public/manifest.json` + `public/sw.js` (network-first service worker)

---

## File Structure

```
src/
  simulation/
    types.ts                    # SimInputs (optional creditLine), LivingInputs, StrategyResult
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
                                # upsertEntry — standalone, no cross-sim imports
    mergeRecords.ts             # PURE per-month records merge (RecordsState, mergeRecords) — newest updatedAt/loggedAt wins, tombstones, 90-day GC
    __tests__/
      smartBloc.test.ts
      living.test.ts
      mining.test.ts
      monthlyLog.test.ts
      aprAnchors.test.ts
      strikeCredit.test.ts

  hooks/
    useBtcPrice.ts              # Coinbase API, 60s interval; syncs store on every fetch (gated by btcPriceMode); returns isStale (5-min threshold, 30s self-tick)
    useBtcHistory.ts            # BTC candle history (1H/1D/1W) via same-origin /api/btc-candles proxy; usePageVisibility gate + slow 60s refresh (NOT a tight poll); ephemeral, NEVER written to store; pure parseCandles (Coinbase [t,low,high,open,close,vol] newest-first → asc close series, s→ms) + RANGE_CFG
    useSimulation.ts            # Smart BLOC tab simulation hook
    useLivingSimulation.ts      # Living on Bitcoin tab hook
    usePowerLawData.ts          # Blockchain.com historical price (via Vercel proxy in prod)
    useMempoolData.ts           # mempool.space block height (halving computed from it)
    useMorphoRate.ts            # Live Morpho borrow APY for the confirmed cbBTC/USDC Base market via same-origin /api/morpho-rate; usePageVisibility gate + slow 5-min refresh; ephemeral, NEVER stored/synced; pure parseMorphoRate (GraphQL state.borrowApy/netBorrowApy fraction → percent ×100, null on malformed). Display-only reference beside the manual cbAprPct (Settings APR field AND the SafetyDashboard CB anchor editBox) — never feeds CB math

  store/
    useStore.ts                 # Zustand store — all state, persisted to localStorage

  utils/
    format.ts                   # fmtUSD, fmtMining (sats-aware)

  components/
    Layout/
      AppShell.tsx              # ALL_TABS_META array, tab bar DndContext, sidebar/main routing,
                                # hiddenTabs guard useEffect, [data-active-tab] on shell div
      AppShell.module.css

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
      SettingsMain.tsx          # Tab visibility toggles + drag-to-reorder (⠿ handles only);
                                # Build row (5 taps toggles devMode) + DevPanel mount
      SettingsMain.module.css
      DevPanel.tsx              # Dev diagnostics (devMode only): sync state, COLLATERAL (baseline/pending/
                                # current — ON-DEVICE only), signer probe, Nostr log ring, copy-diagnostics.
                                # Copy Diagnostics + log ring stay METADATA-ONLY (pendingNonZero boolean,
                                # never balances/amounts/log contents); the panel itself may show position figures
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

    SimpleMode/
      PriceChart.tsx            # BTC price chart atop the Safety Dashboard — recharts AreaChart (line/area,
                                # not candlesticks), 1H/1D/1W pills (default 1D), header price + range %Δ
                                # (green/red), auto padded Y-domain (intraday visible), graceful loading/
                                # "price history unavailable" states. Owns its own range state + useBtcHistory
                                # (no props). Data ephemeral (never stored). PriceChart.module.css alongside
      SafetyDashboard.tsx       # Top-of-SimpleMode safety read (reads store directly, recomputes on price tick):
                                # <PriceChart/> strip (BTC candles) → CB bar (primary; fill = ltv/CB_LLTV, bare
                                # 75%/86% marker TICKS — trigger/liq prices + "Coinbase"/"~est." source moved to a
                                # .priceNote subtext, no label collision; ↓drop-to-trigger/liq cushion, Safe/Fair/
                                # Poor badge, no-grace note in amber/red) → Strike bar (body tap flips capacity-used
                                # ↔ liquidation gauge vs strikeLiquidationLtvPct; LTV via
                                # computeStrikeLtv(advisorActualBlocBalance, getCurrentBtcHeld(), price) — the
                                # CURRENT position, not the frozen baseline. Card is a <div role=button> (was
                                # <button>) with a view-aware inline EDIT control (.editLink, stopPropagation so it
                                # doesn't flip): capacity edits BLOC balance + credit line, liquidation edits BLOC
                                # balance + liq LTV %; Save → synced setters, no Settings trip) → Safe/Watch/Act state line
                                # (hasCbLoan ? worseLevel(cb,strike) : strikeLevel). The WHOLE CB card is tap-to-
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
                                # a TWO-LINE header — top "Month X of 12 · [de-boxed state badge]", second
                                # line (.scrubMeta, above the scrubber) "LTV Z% — paydown triggered" (LTV +
                                # flag coral when hasPaydown) left + "BTC $price" right;
                                # a month SCRUBBER (1–12, selectedMonth,
                                # snaps to currentMonth via effect; replaced the removed MonthlyLogSection
                                # carousel) with a TWO-TONE fill (red paydown share / green rest, keyed to
                                # the --paydownPct = barPaydownPct CSS var) + month-tick markers
                                # (M1·M3·M6·M9·M12, replaced the "drag to scrub" caption); TWO stacked status
                                # bars (Strike / CB — toggle-gated by showPlanStrikeBar/showPlanCbBar). The
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
                                # Advisor tab. The POSITION block is TWO CARDED BOXES (STRIKE BLOC | THIS MONTH —
                                # .positionRow is a 1fr/1fr grid that stacks <560px; the outer .card wrapper was
                                # dropped to avoid card-in-card). STRIKE box headlines CURRENT ACTUALS
                                # (advisorActualBlocBalance / getCurrentBtcHeld()) + the skip-aware EoM projection
                                # as a labeled .eomProjection mini-block ("After this month" → balance · LTV (orange
                                # when hasPaydown) · ₿; replaced the old run-on "→ after this month" hint) — so
                                # editing Amount Drawn / BTC collateral in
                                # Settings moves it cleanly. STRIKE was de-noised: the "fully backed above $X"
                                # binding line was removed (only the amber "collateral-limited (50% LTV)" branch
                                # remains, shown at the 50% ceiling); the ltvTriggered CB-buffer line is gated on
                                # cbPaydownBuffer > 0; and the NDP badge moved OUT to the THIS MONTH box (shown only
                                # when ndp.status !== 'ok' — hidden when paid/far-off, resurfaces when due). In the
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

public/
  manifest.json                # PWA: name "Personal ₿LOC", theme #E8836A
  sw.js                        # Network-first service worker
  icon.svg                     # Dark bg, orange ₿
```

---

## Zustand Store Shape (`useStore.ts`)

### Navigation
```typescript
activeTab:   'living'|'bloc'|'powerlaw'|'converter'|'mining'|'coinbase'|'advisor'|'settings';
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
cbCollateralBtc:     number;                       // default 1.48
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
advisorActualBlocBalance: number;   // default 0 — month-0 baseline BLOC balance (empty-log fallback)
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

`prefix` (e.g. `'$'` or `'₿'`) renders before the number. `suffix` renders inside the input — **avoid suffix for BTC amounts** (cursor issues). Omit `decimals` to let user type freely. Use an external label or hint for units instead.

---

## Design Tokens

```css
--orange: #E8836A  --green: #4ECB82  --red: #E85A4F  --amber: #E8A84A
--bg-app / --bg-base (both #09090E, darkest)  --bg-card #111318 (slightly lighter)  --bg-input  --bg-hover
--text-primary / secondary / ghost / muted / faint  --border
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

191 tests — `npx vitest run` before every commit.
- `smartBloc.test.ts` — uses `runBLOC` (not `runBlocYearOne`)
- `simpleModePlan.test.ts` — `deriveForMonth` (unskipped projection; monthly vs ltvTriggered CB; !hasCbLoan zeros CB; distinct rows → distinct values), `isOperatingMonth`, `composeMonthSummary` (clause inclusion + skip branches + past-tense logged), projection-vs-reality guarantee (deriveForMonth is skip-param-free; monthly CB payment drops row LTV below the start-of-month figure)
- `src/store/__tests__/planBars.test.ts` — `showPlan*Bar` default true, setters, device-local (hydrateSettings ignores them — absent from SETTINGS_FIELDS)
- `cbMetrics.test.ts` — `cbMetrics` (ltv/liqPrice/triggerPrice/pctTo* + divide-by-zero guards), `accruedCbBalance` (null/0-day/30-day compounding), `activeLiqPrice` entered-vs-computed authority + cushion divergence, `barLevel`/`worseLevel` state selection, Strike 85% gauge, refactor-safety (cbMetrics == old inline Main/Sidebar formulas)
- `living.test.ts`
- `mining.test.ts`
- `monthlyLog.test.ts` — includes recomputeBtcHeld suite (+ collateralAdjustment chain math, pending in both derives) + 4 badge status tests
- `src/store/__tests__/collateral.test.ts` — dated-collateral store actions on the REAL store: adjust, graduation (current-month only, preservation, negative), delete recompute + current-month pending-restore, baseline stability, sandbox isolation, settingsDirty marking; Strike LTV tracks getCurrentBtcHeld() (current), not the frozen baseline
- `mergeRecords.test.ts` — per-month merge table: union, newest-wins, loggedAt fallback, tie rule, tombstones, 90-day GC, string-key coercion
- `aprAnchors.test.ts` — pins APR unit conventions (runCoinbaseLoan=percentage, runBlocYearOne=decimal)
- `strikeCredit.test.ts` — strikeAvailableCredit = min(line, collateral×50%) − drawn; computeStrikeLtv (value + zero-collateral/price guards)
- `src/hooks/__tests__/useBtcHistory.test.ts` — pure `parseCandles` (newest-first → asc, close index 4, s→ms, slice newest `count`, empty/malformed guards) + `RANGE_CFG` (1H/1D/1W granularity/count ≤300)
- `src/hooks/__tests__/useMorphoRate.test.ts` — pure `parseMorphoRate` (GraphQL `state.borrowApy`/`netBorrowApy` fraction → percent ×100; per-field independence; malformed/empty/null → nulls, no crash)
- `src/lib/nostr/__tests__/sync.test.ts` — settings watermarks + settings-dirty receive gate, records merge-apply (legacy array + v2 payload), relay-behind dirty flag, fetchAndSync boolean (decrypt failure → false, nothing applied), publishEncrypted first-ACK
- `src/lib/nostr/__tests__/log.test.ts` — nostrLog ring: 50-cap, newest-last, clear
- `src/lib/nostr/__tests__/deviceTag.test.ts` — stable persisted tag, 'anon' fallback, platform label prefix
- `src/lib/nostr/__tests__/liveSync.test.ts` — singleton: double open → one sub, close+reopen, no-pubkey guard

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
dismissal watermark, spec §9), and `showPlanIncomeBar`/`showPlanStrikeBar`/`showPlanCbBar` (Simple Mode
plan-card status-bar visibility, default true). New per-device prefs follow this pattern, NOT the
in-memory exclusion list (which is for transient fields like `nostrSyncing`/`sandboxCollateralBtc`).

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
                                    # NConnectSigner session post-login
  hooks/
    useNostrAutoRestore.ts          # Optimistic session restore on reload — NIP-07 AND NIP-46 (via nostrLogin)
  lib/nostr/
    publish.ts                      # publishEncrypted (→ Promise<number>), publishSettings, publishRecords (RecordsPayload v2)
    session.ts                      # restoreSigner — rebuild signer from persisted login (no fetch/sync); exports NostrParam
    log.ts                          # nostrLog ring buffer — pure; console mirror + sessionStorage 'bloc-nostr-log'
                                    # (50 entries, survives reloads, dies with the PWA); the STANDARD for
                                    # Nostr-layer logging — use it instead of bare console.warn
    timeout.ts                      # withTimeout + signerOpTimeout — pure (store-free); method-aware signer-op
                                    # timeouts: nip46 20s / nip07 60s (human approval popup)
    deviceTag.ts                    # getDeviceTag/getDeviceLabel — pure; stable per-device 4-hex tag
                                    # (localStorage 'bloc-device-tag', NEVER synced) → 'iOS-a3f2' etc.;
                                    # used in the nostrconnect name + DevPanel/diagnostics
    sync.ts                         # applyRemoteEvent — THE single apply path for a remote event (both transports);
                                    # fetchAndSync → boolean (decrypt health; breaks loop on first decrypt fail);
                                    # settings watermark (read FRESH per event) + records per-month MERGE (mergeRecords);
                                    # does NOT manage the reconnect flag
    liveSync.ts                     # foreground-only live relay subscription — module singleton (openLiveSync/
                                    # closeLiveSync); transport only, every event → applyRemoteEvent; opened on
                                    # visible, torn down on hidden, fresh since−60s each open
    syncNow.ts                      # THE single unified sync sequence — all entry points call this (restore-if-needed → relays-if-empty → fetch+merge → publish-if-dirty); honest result (true only if pull AND push-if-dirty succeeded); concurrent calls deduped to one in-flight run
    relays.ts                       # fetchUserRelays; NIP-65 kind:10002 discovery
    disconnect.ts                   # disconnectNostr — clears state + window.location.reload() to flush NPool
    signers.ts                      # connectNip07 only (connectNip46/connectNip46QR + SignerContext deleted)

vercel.json                         # Catch-all rewrite → index.html (required for SPA)
```

---

### Publishing Architecture

- `publishEncrypted()` — NIP-44 self-encrypt → kind:30078 → returns the published `created_at` on the
  FIRST relay ACK; other relays continue in the background; pool closes after ALL settle; 12s timeout;
  rejects AggregateError only if every relay rejects (watermark must not be stamped for a lost event)
- `publishSettingsNow()` — exported from the store; THE settings publish path (immediate, flag-managing,
  returns boolean — mirrors `publishRecordsNow`): builds the 29-field payload from current state, dynamic
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
  `nostrReconnectNeeded` on success, sets `nostrReconnectNeeded` on failure (dirty stays true)
- `FALLBACK_RELAYS`: damus, primal, nos.lol (used if NIP-65 discovery fails)
- NIP-65 relay discovery: `syncNow` fetches the user's kind:10002 when `nostrRelays` is empty and
  stores it; subsequent publishes go to the user's own relays

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
| `personal-bloc:settings:v1` | All 29 settings fields | Any synced setter (marks `settingsDirty`, 2s debounce → `publishSettingsNow`); retried by `syncNow` while dirty |
| `personal-bloc:records:v1` | Payload schema v2 `{ entries, deletions }` (legacy bare array readable); entries carry `updatedAt?` (merge falls back to `loggedAt`); per-month merge — newest wins, tombstoned deletes, 90-day tombstone GC | Immediately after every upsert/delete (no debounce) via `publishRecordsNow` |

### All 29 Synced Settings Fields
`income`, `expenses`, `blocApr`, `creditLine`, `advisorStartDate`,
`advisorActualBlocBalance`, `advisorActualBtcHeld`, `cbLoanBalance`,
`cbCollateralBtc`, `cbAprPct`, `hasCbLoan`, `ndpLastPaidDate`,
`tabOrder`, `hiddenTabs`, `simpleMode`, `btcBuyingUnit`,
`cbLiquidationPrice`, `cbMonthlyPayment`, `cbPaymentStrategy`,
`cbLtvTriggerPct`, `cbLtvTargetPct`, `cbRotateBackPct`,
`cbLoanBalanceAsOf`, `cbLiquidationPriceAsOf`, `strikeLiquidationLtvPct`,
`advisorSkipBlocDraw`, `advisorSkipCbPayment`, `advisorSkipBtcBuying`,
`pendingCollateralAdjustment`
(The two CB `asOf` markers sync so freshness travels atomically with `cbLoanBalance`/`cbLiquidationPrice`.
The three skips and `pendingCollateralAdjustment` are STANDING plan-shaping/position state with a settings-like write pattern — whole-object
LWW handles them like income or APR. `advisorChecklist` was REMOVED — per-month ritual ticking is
multi-writer ephemeral state, incompatible with LWW settings; that's why the skips sync and the
checklist was deleted. Old remote events missing/carrying extra fields hydrate cleanly: the
`SETTINGS_FIELDS` whitelist skips absent fields and ignores unknown ones.)

---

### Zustand Store Fields (Nostr)

| Field | Type | Persisted | Notes |
|---|---|---|---|
| `nostrAuthEnabled` | boolean | ✅ | Gate toggle |
| `nostrPubkey` | string | ✅ | Hex pubkey |
| `nostrSigningMethod` | `'nip07' \| 'nip46' \| null` | ✅ | Login path used |
| `nostrBunkerUri` | string | ✅ | NIP-46 reconnect |
| `nostrRelays` | string[] | ✅ | From NIP-65 discovery |
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
| `deriveAdvisorStart` / `deriveCurrentPosition` | Anchor to `last.btcHeld` (absolute) + `pendingCollateralAdjustment` as a REQUIRED param (never default it — the compiler must flag unthreaded surfaces); standalone — no imports from runAdvisor/runBLOC/runBlocYearOne |
| `publishRecords` cadence | Immediate via `publishRecordsNow` (no debounce); NOT triggered by `setMonthlyLog` |
| Records merge | Records receive is MERGE-based and unconditionally safe (`mergeRecords`); `recordsDirty` = publish-needed marker + merge tie-breaker ONLY (not a receive gate); `lastRecordsSyncAt` = observability only |
| Settings LWW | Settings remain whole-object last-write-wins — last publisher wins the FULL object; only single-writer prefs belong in the payload (the checklist died for this) |
| Nostr reliability fix | Foreground/launch NIP-46 signer rebuild (`restoreSigner`, throttled ~20s inside `syncNow`) + merge-based receive + immediate records publish + decrypt-failure `nostrReconnectNeeded`; store stays v11 (no migration — `updatedAt?` optional, `deletedMonths` defaults `{}`) |
| Zustand v7 migration | Removes `customCollateral`; seeds `advisorActualBtcHeld` from it as fallback; adds `cbPaymentStrategy/TriggerPct/TargetPct` with defaults |
| Zustand v8 migration | Adds `btcPriceMode: 'live' \| 'manual'` (default `'live'`); typing a BTC price flips to `'manual'`; LIVE/SYNC button restores `'live'` |
| Zustand v9 migration | Adds `lastRecordsSyncAt` (seeded from old shared `lastSettingsSyncAt`) + `lastLocalChangedAt`; independent per-d-tag watermarks |
| Zustand v10 migration | Adds `nostrLogin` (JSON NIP-46 login) for session restore across reload |
| Zustand v11 migration | Adds `MonthlyLogEntry.btcHeld` (absolute) + `expensesActual`; resets `advisorActualBtcHeld` to month-0 baseline. The dated-collateral change (spec v4) ships WITHOUT a bump: `collateralAdjustment?` is optional and `pendingCollateralAdjustment` defaults via shallow merge |
| Zustand v14 migration | Adds `showPlanIncomeBar`/`showPlanStrikeBar`/`showPlanCbBar` (Simple Mode plan-card bar toggles, default `?? true`); additive shallow-merge, no transform. Device-local (NOT synced). (Intervening v12/v13 bumps preceded this.) |
| Zustand v12 migration | Adds `cbRotateBackPct` (default 55, reverse-rotation gate) — additive optional-default (`?? 55`), `...rest` carries everything else; in `SETTINGS_FIELDS`/settings payload (synced like trigger/target) |
| Zustand v13 migration | Adds `cbLoanBalanceAsOf`/`cbLiquidationPriceAsOf` (ISO date, default null) + `strikeLiquidationLtvPct` (default 85) — additive shallow-merge defaults (`?? null` / `?? 85`), no transform; all three SYNCED (in `SETTINGS_FIELDS`/payload — the `asOf` markers must travel atomically with their already-synced values). Current store version = 13 |
| `ltvTriggered` mode | Suspends CB priority rules (tier halve/stop draw); trigger IS the safety mechanism; `cbPaydownDraw` added to `blocBalance`; no CB payment from income |
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
| `disconnectNostr` | Full sign-out — clears all nostr state INCL. `nostrAuthEnabled` (disables the lock), then `window.location.reload()` to rebuild NPool clean; in lib/nostr/disconnect.ts |
| `reconnectNostr` | Revoke-recovery — clears the session but KEEPS `nostrAuthEnabled`, then reloads → auth gate lands on the NIP-46 login (open signer app → re-approve); the bottom-right `⚠ Reconnect` affordance AND the Settings "Reconnect" button both call it; in lib/nostr/disconnect.ts |
| nostr-tools pin | EXACT 2.23.5 — verified with Primal NIP-44; do NOT downgrade to 2.13 (breaks @nostrify peer compat) |
| NIP-46 mobile login | Two-step manual launch — relay warms in foreground BEFORE the deep-link; auto-firing breaks the handshake |
| `STRIKE_MAX_DRAW_LTV` | 0.50 in strikeCredit.ts; available = min(creditLine, collateral×price×0.50) − drawn |
