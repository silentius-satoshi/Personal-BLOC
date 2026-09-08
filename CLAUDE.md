# CLAUDE.md — Personal ₿LOC

## Project Overview

React + Vite + TypeScript PWA modeling Bitcoin accumulation strategies using Strike's Bitcoin Line of Credit (BLOC). Eight tabs: **Living on Bitcoin**, **Smart BLOC**, **Power Law**, **Sats**, **Miners**, **CB Loan** (hidden by default), **Advisor** (hidden by default), and **Settings** (not a tab — accessible via branding dropdown).

Deployed to Vercel.

---

## Commercialization (C1 — landing-first funnel)

**Topology — ONE repo, THREE Vercel projects, split by build-time env flags.** C0 shipped landing + seeded sandbox on
one public deploy where a REAL sign-up was impossible (the demo seed re-writes `personal-bloc-store` on every load) and
sign-ins dead-ended (`VITE_OWNER_PUBKEY` → `PrivateAppNotice`). C1 makes the **public deploy the free real app** with
the landing as its front door, and moves the origin-destructive sandbox to its OWN project.

| Project | Env | Serves |
|---|---|---|
| owner (`personal-bloc`) | `VITE_OWNER_PUBKEY` only | the private app — byte-identical, untouched |
| public (`personal-bloc-public`) | `VITE_LANDING=1`, `VITE_REPO_URL`, `VITE_SANDBOX_URL` — ⚠ **NO** `VITE_DEMO`, **NO** `VITE_OWNER_PUBKEY` | landing at `/` (not-onboarded) · the real free app for everyone |
| sandbox (`personal-bloc-demo`) | `VITE_DEMO=1`, `VITE_OWNER_PUBKEY` (free-riding closure lives HERE now), `VITE_PUBLIC_SITE_URL` | seeded reset-on-reload sandbox |

Unset flags → dead branches, tree-shaken. `vercel.json` rewrites every path to index.html.

**Landing gating (`App.tsx`).** `VITE_LANDING === '1' && pathname === '/' && !onboarded` → `LandingPage`, else
`AppShell`. `onboarded` is read DIRECTLY from the standalone GATE key `localStorage['personal-bloc-onboarded'] === '1'`
(synchronous, try/catch; App must not couple to the store — the store's seed-reader IIFE reads the same key). So the
landing shows ONLY to a not-yet-onboarded visitor; a returning owner/viewer (or anyone who finished onboarding) lands
straight in their app at `/`.

**The funnel — no new auth plumbing.** Every landing CTA links `/app` → `AppShell` → `!onboardingComplete` →
`OnboardingModal` opens on the `ChoosePathView` fork (Get started / I have a plan or a key / Connect to a shared plan).
**That fork IS the sign-up/log-in surface** — no params, no deep links. Completing onboarding flips the GATE key to
`'1'` → `/` renders the app (landing skipped). ⚠ The landing's four internal `/app` CTAs use `window.location.replace`
(a shared `goApp` onClick that falls through on modified/middle clicks so new-tab opens still work) — NOT a pushed
anchor nav — so `/` is removed from history; plus a `pageshow(persisted)` belt re-reads the standalone
`personal-bloc-onboarded` GATE key and bounces to `/app` when onboarded. Both close a Safari edge-swipe-back
bfcache backdoor: a bfcache restore doesn't re-run App's onboarded branch, so without these an onboarded/viewer
device could restore the marketing landing over its app.

**Landing UI (C2 v2 — `LandingPage.tsx`/`.module.css`).** Nav bar (brand + "View source" + "Sign up / Log in" →
`/app`). Hero: two-line headline "Borrow against your bitcoin. / Never sell." (2nd line `--btc`) + the verbatim
sovereign-planner subtitle + primary "Get started — it's free" → `/app` + a "Try the sandbox" ghost rendered ONLY when
`VITE_SANDBOX_URL` is set (`SANDBOX_URL = env || null` — no fallback, a dead sandbox link is worse than none) + a
"Free · No email · Your keys stay yours" hint. **Crash-test widget** (`CrashTest`): two EDITABLE store-free fields —
collateral (₿) + borrowed ($), held as raw strings and coerced/clamped only at compute so mid-type clears don't snap —
plus a price slider; drag the price down to watch LTV, a Safe/Watch/Act (or LIQUIDATED) verdict pill, the gauge fill,
and a plain-English story line ("Liquidation at $X — bitcoin would have to fall N%…") all react. ⚠ The band math flows
through the REAL app thresholds (`barLevel`/`CB_WARN_LTV`/`CB_LLTV`/`LEVEL_COLOR` — imports unchanged) so the demo
can't drift from the app. **Below the widget (C3 v3 — sectioned):** eyebrow-labeled sections with vertical rhythm —
**Features** (title "Plan, log, and defend bitcoin-backed loans — private by design." + 3 cards, icons centered:
Safety dashboard · Monthly playbook · Censorship-resistant by design "encrypted sync over Nostr — open relays no
company can shut off"), **How it works** (3 columns w/ hairline dividers + one-line descriptions), **FAQ** (a
native `<details>`/`<summary>` accordion — zero JS, keyboard/a11y-free — 4 items), **Pricing** (`id="pricing"`, TWO
cards: Early access "Free / for now" → Get started; Hosted featured w/ a "COMING SOON" chip, unpriced "Coming soon" +
an INERT `aria-disabled` ghost CTA — **NO self-host card**), and a 3-column **footer** (brand + the
not-financial-advice **disclaimer** under it · Product links · Resources links incl. License → `${REPO_URL}/blob/main/LICENSE`
+ Nostr) with a bottom "© 2026 · Your keys, your plan" bar. The C0 pricing + FAQ sections returned here in v3.

**Sandbox is origin-destructive.** `src/lib/demo/demoSeed.ts` (imported FIRST in main.tsx, before the store's
module-init IIFEs read localStorage) writes a curated showcase plan on EVERY load — the re-write IS the reload-reset —
so it clobbers any real plan sharing the same localStorage. ⚠ **`VITE_DEMO` must NEVER be set on an origin with real
users** (that's the whole reason it gets its own project). The seed sets `onboarded=1` + a plan blob with **NO Nostr
identity**, so AppShell's ladder skips onboarding + the auth gates (`nostrAuthEnabled` derives from pubkey → false) +
the viewer gates → **Branch J renders the hydrated plan**. **Publish is impossible by construction:** every publish
path guards `!isAuthenticated || !nostrSigner || !nostrPubkey`, and no signer can exist without an identity. NO
AppShell gate change (only the one `DemoBanner` line). Showcase = Month 8 of a 12-month strategy, manual price for
determinism (Strike LTV green, CB LTV ~72% watch band), 7 confirmed history months. `DemoBanner`'s "Get the real
thing" links `VITE_PUBLIC_SITE_URL || '/'` (on the sandbox origin, a bare `/` would loop back to the sandbox). C2: the
banner is `position: sticky; top: 0` (**not fixed**) — as the first in-flow child of AppShell's fragment it PUSHES the
app content down (header stays visible) instead of overlaying it, and stays pinned on scroll.

**Free-riding closure — now on the SANDBOX project.** The sandbox deploy sets `VITE_OWNER_PUBKEY` (the owner's hex), so
a visitor who signs in with their own real key on the sandbox domain hits `PrivateAppNotice` (`isAuthenticated &&
!isOwner`) — the sandbox domain cannot be adopted as free hosting. The **public** project must NOT set it (real users
sign in there). Deployment requirement, no code.

**License.** `LICENSE` at root = **FSL-1.1-MIT** (Functional Source License v1.1, MIT future grant; Licensor
`silentius-satoshi`), making the landing's "source-available under FSL-1.1-MIT" claim true. package.json has no
`license` field (unchanged).

Files: `src/App.tsx` (onboarded gate), `src/pages/LandingPage.tsx`/`.module.css`, `src/lib/demo/demoSeed.ts`,
`src/components/Layout/DemoBanner.tsx`/`.module.css`, `src/vite-env.d.ts`, `LICENSE`.

---

## Tech Stack

- React 18 + Vite + TypeScript
- Zustand (global store) + `persist` middleware → localStorage key `'personal-bloc-store'`
- Recharts (charts)
- CSS Modules
- Vitest (1054 tests — all must pass before every commit)
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
                                # clamped) keeps the zero-import rule; callers pass a UTC-midnight startDate
    cyclingSim.ts               # Cycling strategy PURE engine (Almanac `cycling` face) — draw bills on Strike,
                                # refinance into Coinbase every cycleMonths, route every purchase to the CB
                                # collateral pool, stop drawing at a CB LTV cap; verdict vs a never-draw baseline.
                                # 🔴 §2 wall side B: imports ONLY CB_LLTV/CB_LIF (runCoinbaseLoan) — NOTHING from
                                # powerLaw/cycleModel/store. The price path arrives as a plain number[] and the
                                # lender ratios (strikeMaxDrawLtv/strikeMarginLtv) as plain numbers, so it stays a
                                # clock-free, fixture-testable leaf; the VIEW does the labelled crossing (the
                                # OutlookProjection precedent). ⚠ TWO COLLATERAL POOLS, NEVER ONE — strikeColl is
                                # FIXED (nothing is pledged to Strike after the opening position), cbColl GROWS
                                # with every purchase, and btcHeld is their sum and DISPLAY ONLY, never a
                                # denominator (collapsing them understates CB LTV ~16pts and fires the cap late).
                                # The cap tests cbLtv (a Coinbase metric), never a blended figure. The Strike
                                # credit line is a hard constraint — a draw is capped at min(creditLine,
                                # strikeColl×price×maxDrawLtv) − strikeBal and the shortfall comes out of income
                                # (self-limiting: fewer sats bought), surfacing as creditExhaustedMonth. Liquidation
                                # is TERMINAL: at cbLtv ≥ CB_LLTV it seizes min(cbColl, cbDebt×CB_LIF/price) and
                                # ⚠ subtracts the repayment rather than zeroing debt, so an under-collateralised
                                # seizure PRESERVES the deficiency (both facilities are full-recourse); the row is
                                # pushed PRE-seizure so it shows the position that breached and m+1 opens on the
                                # survivor. CB_LIQUIDATION_PENALTY is derived (CB_LIF − 1), not a literal
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

  store/
    useStore.ts                 # Zustand store — Phase 1c: now COMPOSITION ONLY (~44 lines). Spreads the 9 slice
                                # creators into ONE create<StoreState>()(persist((set,get)=>({…}), persistOptions)) +
                                # the import-compat re-exports (storeEncEnabled/gateHydratedIdentity from bootstrap,
                                # partializeState/migrateState from persistConfig, StoreState/ViewerSlot + sim types +
                                # KeyProvenance). Phase 1b: the publish/orchestration layer was EXTRACTED to
                                # syncEngine.ts + payloads.ts; the store reaches the engine via DYNAMIC import only
                                # (kickRecordsPublish / syncSettingsToNostr's scheduleSettingsPublish tail — no static
                                # back-edge, the syncNow precedent)
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
    persistConfig.ts            # Phase 1c — partializeState + migrateState (verbatim) + the persist OPTIONS as an exported
                                # `persistOptions` (annotated PersistOptions<StoreState, ReturnType<typeof partializeState>>
                                # so its standalone merge/onRehydrate callbacks keep param types). Imports bootstrap +
                                # leaves; does NOT import useStore
    slices/                     # Phase 1c — 9 domain slice files, each `type XSlice = Pick<StoreState,…>` + a
                                # `createXSlice(set, get): XSlice` creator (mining takes _get, unused). ui · planInputs ·
                                # mining · cbLoan (incl. Strike-API display fields) · advisorJournal (advisor+monthlyLog) ·
                                # dayLog · identity (nostr credentials+backup-gate) · viewer (roster+viewer-side) · sync
                                # (auth/flags/syncSettingsToNostr/hydrateSettings/applyPlanBackup + the remotePlanFoundResolved
                                # latch). EVERY StoreState key in EXACTLY ONE slice (slices.test.ts pins disjoint+union). ⚠ NO
                                # "useStore" substring (grep gate); the only body change is getState()→get(); the two dynamic
                                # import paths deepened one level (../../lib/nostr/...)
    payloads.ts                 # Phase 1b — the two PURE snapshot builders, moved verbatim out of useStore:
                                # buildSettingsPayload(s) (the 37-key settings payload — single source for
                                # publishSettingsNow + the viewer snapshot) + buildViewerSnapshotPayload(s, tier)
                                # (C-safe ratios / C-trusted full). `import type { StoreState } from './useStore'`
                                # (type-only — no runtime edge); nothing in useStore imports payloads. Consumed by
                                # syncEngine, exportPlan, ViewerPreview, tests

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
                                # ⚠ Imports ONLY utils/format + type-only shapes — must never pull useStore (main.tsx
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
      compact.ts                # compactPlanEvents(events, now): keep latest-per-field FOREVER + superseded <90d
                                # (90*24*60*60*1000, the mergeRecords TTL mirror), drop older. Merge-safe (§7):
                                # fold(compact(e,now)) ≡ fold(e); a stale device re-unioning a compacted-away event
                                # is harmless (fold picks the true latest, re-compaction sweeps it)
      genesis.ts                # nextPlanEventTs(lastTs, now=Date.now()) = max(now, lastTs+1) (monotonic guard) ·
                                # makePlanEventId(field, ts, rand=Math.random) = `${field}-${ts}-${rand4}`
                                # (recoveryQuiz rand-injection) · synthesizeGenesisEvents(fields, baseTs, device):
                                # one set-event per PRESENT key (absent stay absent — never invent seeds), ids
                                # genesis-${field}-${ts}, ts STAGGERED monotonically over PLAN_EVENT_FIELDS order
                                # (field-qualified ids + staggering = the §13 collision answer).
                                # fold(synthesize(partition)) ≡ partition. Tested in __tests__/planEvents.test.ts
    backupGate.ts               # R2a-1 — the backup-gate predicate. PURE, ZERO imports (no cycle):
                                # isBackupGateSatisfied({keyProvenance, backupVerifiedAt}) = keyProvenance !== 'generated'
                                # || backupVerifiedAt != null. A key this device GENERATED is the only copy until the
                                # user proves they saved it → nothing syncs/publishes. 'imported'/'external' are satisfied
                                # by construction (the user holds the key elsewhere); null = LEGACY (pre-R2 plan), satisfied
                                # STRUCTURALLY via the persist merge — deliberately NO migration. Consulted at exactly the
                                # layer isAuthenticated is (11 guard sites); NEVER on viewer paths. See § Backup Gate
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

  utils/
    format.ts                   # fmtUSD, fmtMining (sats-aware)

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
      PassphraseInput.tsx       # R2c-7a-2-polish — THE masked-entry widget (+ .module.css). A controlled input +
                                # focus-guarded Show/Hide toggle, adopted at ALL 16 RENDERED masked fields:
                                # NostrAuthGate (remediation encrypt · ncryptsec unlock · PIN · Confirm PIN),
                                # RecoveryKeyCeremony (PIN unlock · encrypt · verify re-entry), ViewerLoginFlow
                                # (token pass · PIN ×2), OwnerKeySetup (PIN ×2), ViewerUnlockGate (PIN ×2),
                                # RevealRecoveryKey (PIN), SharingPage (PIN). ⚠ NOT AppUnlockGate/StoreMigrationGate
                                # — both UNRENDERED (retained verbatim as the Option-3a rebuild basis), so a
                                # `grep type="password" src` should show exactly those two and nothing else.
                                # ⚠ THE FOUR iOS SUPPRESSIONS ARE BAKED IN (autoComplete/autoCorrect/autoCapitalize/
                                # spellCheck), not props — iOS autocapitalizes an unsuppressed field, which would make
                                # the encrypt and decrypt sides permanently disagree. One default beats 16 chances to
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
                                # rework it). Still owns the local ALL_TABS constant + 5-tap devMode build row. P3.1: an
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
                                # byteLen) and a PAYLOAD SIZES block inside SYNC STATE (newest report per settings/
                                # records/viewer channel, via SETTINGS_DTAG/RECORDS_DTAG + a viewer:v2: label-prefix
                                # match); rows exceeding WARN_EVENT_BYTES (60,000) render amber via inline sizeStyle —
                                # display-only, no behavior change.
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

### M-L1 — Ledger face (seventh Almanac face) + CSV export (store unchanged, NO bump)

A SEVENTH Almanac face **Ledger** — a READ-ONLY accounting table of `monthlyLog` + CSV copy/download.
**WRITES NOTHING** (collision note: the "one Ledger writes actuals" invariant in the Logging Consolidation
arc refers to the *Daily* writing surface — this table is a pure projection/export, not that Ledger). The
`face` union widens in place to add `'ledger'` (still local `useState`, default `'halving'`, nothing
persisted/synced — §14.3). No store fields, no `tabOrder`/`ActiveTab` change.
- **Data-presence gate:** the sub-nav Ledger button (LAST position, glyph `▤`) renders only when
  `ledgerFaceAvailable(monthlyLog)` (= `monthlyLog.length > 0`) — a safe viewer with an empty log never
  sees it. A fallback `useEffect` (mirrors the defense pattern) sends `face → 'halving'` if the log empties
  while Ledger is showing. `AlmanacView` gains a `monthlyLog` selector for the gate; `LedgerFace` reads the
  store itself. Rendered BARE in the ternary (own container, like `<CbDefenseTool/>`).
- **`src/lib/ledgerCsv.ts`** (PURE, no React) — `ledgerFaceAvailable(monthlyLog)` + `buildLedgerCsv(entries,
  {hasCbLoan, showMining})`. CSV columns = the visible columns PLUS an ISO `Date` col:
  `Mo, Date, Income→BTC, Paydown, BTC bought, Strike bal, Strike col, Strike LTV [+ CB bal, CB LTV iff
  hasCbLoan] [+ Mining sats iff showMining]`. `Mo`=`entry.month` (int), `Date`=`entry.date` (ISO). Raw
  decimals (no $/₿/% ornament; `strikeLtv`/`cbLtv` stay the stored 0.1483 decimal). Missing optional cells →
  empty. RFC-4180 `csvCell` escaping. **CRLF**, no trailing newline, **NO totals row**. Sort = single-key
  `a.month - b.month` (the real monthlyLog convention; dayLog's `(ts,id)` two-key sort is unrelated).
- **`src/components/Almanac/LedgerFace.tsx`** (+ `.module.css`) — face chrome (mono-uppercase "Ledger"
  title + framing line) → CSV actions (`.actionBtn` vocabulary mirrored from SharingPage: **Copy CSV** via
  `navigator.clipboard.writeText` in try/catch with a "Copied ✓"/"Copy failed" flash + **Download .csv** via
  Blob→`<a download>` mirroring `downloadPlanBackup`, filename `personal-bloc-ledger-${todayLocalISO()}.csv`;
  BOTH always present — Copy is the reliable iOS-PWA fallback for the open-instead-of-save caveat) → the
  `<table>`. **Totals row** in `<tfoot>` (comment the distinction): FLOWS SUMMED (income/paydown/btcBought/
  miningSats), STOCKS SHOW LATEST (last month's strikeBal/btcHeld/strikeLtv/cbBal/cbLtv). `ndpPaid`/
  `strikeMinPaid` → a `†` superscript on the Paydown cell + one footnote line. **P3.1:** the `.tableWrap`
  (`overflow-x:auto` scroll container) scrolls horizontally on its own — the `data-gesture-exempt` marker and
  the scoped `touch-action` rule that paired with it are GONE with the Almanac face-pager (face switching is
  tap-only, so there is nothing to arbitrate against); the `.footnote` was MOVED OUT of
  `.tableWrap` (now a sibling below) so the horizontal scrollbar no longer overlays the caption.
- **Visual-spec decisions (LOCKED — future faces should stay coherent):**
  - **Type:** every numeric cell `var(--mono)` + `font-variant-numeric: tabular-nums`, right-aligned; Month
    cell left-aligned `--text-secondary`; headers 10–11px uppercase `0.08em` `--text-muted`.
  - **Ink hierarchy:** flow columns (Income→BTC, Paydown, BTC bought) `--text-primary`; stock columns
    (Strike bal, Strike col) `--text-secondary`. **BTC-quantity cells get a `₿` prefix in `--text-faint` —
    the ONLY ornament** (dollar cells are bare grouped integers, no `$`).
  - **LTV zone colors — Strike vs CB differ:** **Strike LTV** by fixed named consts `LTV_AMBER_AT 0.10 /
    LTV_RED_AT 0.13` (`<0.10 green / 0.10–0.13 amber / >0.13 red`, Strike-ONLY). **CB LTV** by the app's
    SHARED CB gauge logic — `LEVEL_COLOR[cbBarLevel(cbLtv, cbLtvTriggerPct, cbLiqFrac)]` — so a 57% CB LTV
    under the default 75% trigger renders green exactly like the SafetyDashboard (NOT Strike's thresholds).
  - **SIGNATURE meter:** a 2px hairline beneath each LTV number (track `--line-2`, fill = the zone color).
    Strike meter fills to `STRIKE_METER_CEIL 0.15`; CB meter fills to `CB_LLTV` (0.86) and uses the CB zone
    color. Translates the ring-gauge language into table idiom.
  - **Ledger close:** the totals row sits below a DOUBLE hairline (`.closeRule` = two 1px `--line` rules 3px
    apart); totals numerals `--text-primary`, label `--text-muted` small caps.
  - **Row states:** 1px `--line-2` row rules, hover `--bg-hover` at `≥768px` only. **Provisional** → Month
    cell only `--text-muted` italic (figures NOT dimmed). **confirmed===false** → row tint
    `color-mix(in srgb, var(--amber) 9%, transparent)` (token-pure amber — no literal rgba).
  - **Mobile (<768px):** `overflow-x:auto` with the Month column `position:sticky` (`--bg-card` fill + a 12px
    right-edge fade scrim); `≥768px` full-width, no scroll.
  - **Motion:** the ONE animation — `ledgerRowIn` staggered row fade-in (15ms/row, 200ms ease-out), disabled
    under `prefers-reduced-motion` (the app's first reduced-motion guard, intentional).
- **CB zone-coloring extraction (drift-proof shared source):** the CB gauge's zone boundary + color map were
  not importable before. `CB_ACT_LTV_FACTOR` (0.93) + `cbBarLevel(cbLtv, cbLtvTriggerPct, cbLiqFrac)` now
  live in `cbMetrics.ts` (de-dups the two inline `0.93` literals `safetyView.ts` had at `deriveSafetyView` +
  `scaleSafetyView`, both now call `cbBarLevel` — behavior-identical, guarded by `safetyView.test.ts`).
  `LEVEL_COLOR` (`{safe:--green, watch:--amber, act:--red}`) lifted from `SafetyDashboard.tsx` (module-private)
  into `safetyView.ts` and imported by BOTH `SafetyDashboard` and `LedgerFace` — one shared color source.
- Tests: `src/lib/__tests__/ledgerCsv.test.ts` (column toggles, legacy-missing→empty, CRLF/no-totals,
  sort + fixture roundtrip, `ledgerFaceAvailable`) + a `cbBarLevel` case in `cbMetrics.test.ts` (57%→green,
  band boundaries, regression pin against the extracted 0.93). No component-render harness in the repo, so
  the JSX (meters/zone colors/sticky column/motion) is covered by `tsc -b` + build + manual.

### Phase 3b — Scenario face (EIGHTH Almanac face; store unchanged, NO bump)

An EIGHTH Almanac face **Scenario** (`⚖ Scenario`) — the UI over the Phase 3a pure engine
(`src/simulation/scenarioDiff.ts`). Pin the current plan's safety posture, edit a session-ephemeral
hypothetical overlay, and read the what-if diff. **READ-ONLY by construction** — the ONLY store write is
`setPinnedScenario` (device-local pin, `pinnedScenario` field); the overlay is `useState<ScenarioOverlay>`
and is NEVER persisted (the `sandboxCollateralBtc` sandbox precedent). Ungated — the `Face` union widens in
place (`+ 'scenario'`, still local `useState`, default `'halving'`), the sub-nav/pager `visibleFaces` array
APPENDS it LAST (after the ledger spread — preserves the e2e face-order assumptions), and `renderFace` wraps
it in the hub `.container` (the halving/cycle simple-content path). No guard `useEffect`, no
store-shape change.
- **`src/components/Almanac/ScenarioFace.tsx`** (+ `.module.css`) — LedgerFace chrome (mono-uppercase
  `.title` + framing line). Store reads are VALUE selectors only (`useStore(useShallow(selectSafetyViewInputs))`
  for the current inputs + `s.pinnedScenario`; `s.setPinnedScenario` is the SOLE `s.set*` reference). PIN row
  (Pin today's plan / Pinned {todayLocalISO label} · {relativeAge} + ghost Re-pin/Clear); a DRIFT line when
  pinned (`diffScenarios(pinned.inputs, current)` → "N of 3 worse" + signed pp mini-deltas); an OVERLAY editor
  (one `NumberInput` per `ScenarioOverlay` lever — btcPrice/Strike debt/Strike collateral/credit line, + the CB
  pair iff `hasCbLoan`; `value = overlay[k] ?? current[k]`; ghost Reset → `{}`); a WHAT-IF grid
  (`diffScenarios(current, applyOverlay(current, overlay))` → Credit used / Strike LTV / CB LTV rows, each side
  `LEVEL_COLOR`-tinted per its level + a signed pp delta chip; secondary crash-LTV + CB-liq-frac pairs; verdict
  from `worsenedCount`). Empty overlay → identity grid (zero deltas), correct. Viewer devices: NumberInputs
  self-disable in `viewerMode`; a local pin is harmless — no special gating. No tests (no render harness; the
  engine is pinned by 3a's `scenarioDiff.test.ts`).

### Cycling face (NINTH Almanac face; store unchanged, NO bump)

A NINTH face **Cycling** (`♻ Cycling`) — the UI over `src/simulation/cyclingSim.ts`. Ported from a
standalone JSX prototype (`cycling-sim copy/`, since DELETED) whose model carried **eight defects**, all
fixed in the port: identical sims across all three bands (no band coefficient in the price path), an
over-specified anchor, a collapsed CB-LTV denominator, an uncomputable Strike LTV, non-terminal
liquidation, an unconstrained Strike draw, a default cap seeded from `cbLtvTriggerPct`, and a seizure that
erased a full-recourse deficiency. ⚠ **The prototype is NOT the reference** — correctness is defined by
agreement with `cbMetrics` at t=0 plus the invariants in `cyclingSim.test.ts`.

- **READ-ONLY by construction: ZERO store writes** — not even a pin (stricter than `ScenarioFace`, which
  writes `setPinnedScenario`). Every control is seeded from live state and overridden only in a
  session-ephemeral local `useState` overlay (`value = overlay[k] ?? live`), with a ghost "Reset to live".
- **GATED on `hasCbLoan`** (the strategy IS a Strike→Coinbase refinance loop) with the `defense`-face
  fallback `useEffect`, and **appended LAST** in `visibleFaces` so `halving` stays the first (default) face.
  (The old index-0/index-1 e2e pin is gone — the face-nav specs now tap pills by NAME, not position.)
- **`src/components/Almanac/CyclingFace.tsx`** (+ `.module.css`) — LedgerFace chrome + its 960px `.face`.
  Sections: price path (band buttons + Reversion window + Horizon) → verdict → 6 stat cards → CB-LTV chart →
  paired price/collateral charts → paired cash-flow/strategy cards → rates → constraint notices → milestones
  → disclaimer. Paired rows go 2-col at ≥768px. Recharts restyled to tokens (zero new hex) with a local
  token-surfaced tooltip; `isAnimationActive={false}` throughout.
- **⚠ THE §2 CROSSING LIVES IN THE VIEW, deliberately** — it imports the power law (a BELIEF) AND the risk
  constants (FACTS), builds a plain `number[]`, and hands it to an engine that has heard of neither. Exactly
  the `OutlookProjection`/`MonthBreakdown` shape. Neither wall moves.
- **⚠ THE CAP DEFAULTS TO A FACE-LOCAL 70%, NOT `cbLtvTriggerPct`.** Still face-local, and still not the
  owner's trigger — that is the PAYDOWN threshold, a different action from stopping the draw, and it stays
  one tap away as a labelled preset chip. **It was 50** (chosen when the seed's opening CB LTV was 50.58%,
  so the cap bound instantly). With both faces now opening ON THE LINE at support, a 50 cap stopped the
  draw at month 1 and the default frame was inert. At 70 the draw runs and the cost is visible: peak CB LTV
  ~69% (Cycling) / ~70% (Ownership), ~16 points under the 86% liquidation line, worth roughly **+0.73 ₿**
  over the horizon. Re-measured on the CURRENT seed: no liquidation on any band out to 240 months at 50,
  70 **or** 75 — the old "75 liquidates at month 83" warning was written against an earlier position and no
  longer holds. The engine tests pass `cbLtvCapPct` explicitly, so they pin the ENGINE, not this default.
  ⚠ The cap bounds the DRAW, not the refinance sweep, so peak LTV can end a month just past it (70.1%
  observed on Ownership) — the unbounded-refinance gap from the review is now visible at the default.
- **Gesture coexistence:** nothing to arbitrate — the Almanac face pager is removed, so a slider drag can no
  longer page the face. The former `data-gesture-exempt` markers on the control cards are deleted. *(This also
  retired the Mining face's latent slider-vs-pager conflict.)*
- **Zone colours** reuse the shared gauge (`cbBarLevel` + `LEVEL_COLOR`) but band against **`CB_LLTV`**, the
  LTV this projection actually liquidates at — NOT the dashboard's `cbLiqFrac`, which comes from the owner's
  entered liq price, a TODAY anchor that says nothing about a position five years out. The trigger boundary
  is still the owner's own setting.
- Connectors: `getCurrentBtcHeld()` (verified Strike-only) · `advisorActualBlocBalance` · `creditLine` ·
  `cbCollateralBtc` · `accruedCbBalance(...)` (the accrual boundary, as `EmergencyConsole` crosses it) ·
  `income`/`expenses`/`blocApr`/`cbAprPct`/`btcPrice` · `STRIKE_MAX_DRAW_LTV` · `STRIKE_MARGIN_CALL_LTV`.
  The prototype's direct CoinGecko `fetch` is GONE — no new external host. ⚠ **AMENDED:** the Almanac's
  only *background* network call remains the consented `useChainTip`. Both cycling faces now also carry
  **`useMorphoRateOnDemand`** — same-origin `/api/morpho-rate`, **never on mount and never on a timer**,
  fires only when the owner taps "Check live rate" / "Refetch". It writes to the SESSION OVERLAY, never the
  store, so the faces stay zero-store-write. The polling `useMorphoRate` is still confined to Settings and
  the SafetyDashboard.
- Tests: `src/simulation/__tests__/cyclingSim.test.ts` (26) + `powerLaw.test.ts` (10, all RELATIONAL against
  a fixed UTC date — absolute band dollars grow daily and would rot). Suite 968 → **1004**.

#### Inspection layer — month scrubber · price lens · BTC gained · holdings (UI-only, NO engine change)

Display math over rows the engine already emits. `src/simulation/` is UNTOUCHED; all state is ephemeral
component state; no store bump. The pure helpers live in **`src/components/Almanac/cyclingFaceView.ts`**
(React-free, store-free, TYPE-only import of `CyclingRow`) so they are testable without a render harness.

- **`applyPriceLens(row, multiplier)`** → re-prices ONE row, holding every dollar DEBT figure and every BTC
  COUNT fixed. Guard (`multiplier <= 0 || row.price <= 0`) returns the row's own price/LTVs/collateral/equity
  and `netBtc = row.btcHeld` — `CyclingRow` has no `netBtc` field, so there is no "own value" to fall back
  to; the debt term contributes 0, matching `btcGained`'s zero-price guard.
- **`btcGained(row, base, rowPriceOverride?)`** → `{gross, net}`. Gross is price-independent (BTC counts);
  net is `btcHeld − debt/price` on both sides. ⚠ **The override lenses the ROW side ONLY** — `base` keeps its
  own real price, because base is *today* and the lens is a what-if about the *selected* month.
- **`holdingsSplit(row)`** → Strike / Coinbase / Combined. **TWO VENUES.**
- **`clampMonth(selected, rowCount)`** — see the crash note below.
- ⚠ **LTV is recomputed locally, not routed through `cbMetrics`.** Architecture invariant 2 governs the
  user's LIVE position; these are projected hypotheticals on a speculative price path, and `cbMetrics` reads
  store state. Same reasoning as `cyclingSim`'s local `ltvOf()`. **This module must never be imported by the
  risk core.**

**⚠ THE CLAMP IS A CRASH FIX, AND IT MUST HAPPEN AT RENDER TIME.** The Horizon slider is `step=1`, so one
leftward tick shrinks `rows` while `selectedMonth` still points past the end → `rows[stale]` is `undefined`
→ `applyPriceLens` throws on `row.price` and the face blanks into the ErrorBoundary. An effect runs *after*
that render. So `monthIdx = clampMonth(selectedMonth, rows.length)` is derived during render and used
EVERYWHERE — including as the scrubber's own `value`, or the range input renders pinned past its max.
`rows[selectedMonth]` must never appear in the file. The effect exists only to write the clamped value back
so re-growing the horizon doesn't snap to a stale index. Pinned by `clampMonth` unit tests.

**The lens is display-only** — range 0.35–2.2, default 1, label "as modeled" at exactly 1. It never re-runs
the engine and never moves the charts (they keep reading unlensed `chartRows`). ⚠ Its reset effect
**MIRRORS the sim memo's dep array** (`pricePath`, `cbDebt`, the four store-derived position values, and the
six overlay inputs) plus `monthIdx` — *if an input is added to `runCyclingSim`, add it there too*, or a
stress test silently survives an engine change. `pricePath` subsumes `btcPrice`/`band`/`months`/
`convergeMonths`/`startDate`.

**BTC gained appears twice, deliberately split:** the **tile** is LENSED (`btcGained(selRow, rows[0],
lensed.price)`) and the **Milestones column** is NOT (`btcGained(r, rows[0])`) — the table is not a lensed
surface. So tile and column agree only at lens 1; at any other value the tile's net moves and the column's
does not. Both show **gross over net** — gross is accumulation, net is what survives the debt — and on a
`postLiquidation` row the net drops hard, **shown, never clamped**.

**Six tiles are month-scoped; `Strike interest` is not** — it renders the result-level
`sim.totalStrikeInterest`, and `CyclingRow` carries no per-row cumulative interest (adding one is an engine
change). Its sub-label reads **`full horizon · N yrs`** so it is visibly the odd one out.

⚠ The scrubber + lens live in ONE card. (It formerly carried `data-gesture-exempt` to stop a horizontal
slider drag from paging the Almanac; the pager is gone, so the marker is too.) ⚠ The two range inputs are
**face-local, 44px-tall** — the shared
`ui/SliderInput` is NOT restyled, since `MiningInputsPanel`/`MiningProjectionTable`/`LivingInputsPanel`
consume it and a track change would relayout all three.

**NOT MODELED (and out of scope by construction):** **`mode` (S1) adds four strategies — cycle / hold /
clearStrike / clearBoth. Still NOT MODELED:** a cold-storage / unpledged reserve (there are two
collateral pools, not three) and a support-line "switch" mode. Both remain `CyclingInputs`/
`CyclingRow` changes on top of `mode`, not modes within it.

- Tests: `src/components/Almanac/__tests__/cyclingFaceView.test.ts` (19). ⚠ **The seizure test asserts at
  `liqMonth + 1`, NOT at the first `postLiquidation` row** — `cyclingSim` pushes the BREACHING row and
  applies the seizure afterwards while setting `postLiquidation: true` on that same row, so `rows[liqMonth]`
  still holds the intact pre-seizure position and a naive assertion there passes vacuously. A sibling case
  pins that trap. Suite 1004 → **1023**.

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

### Almanac face navigation — TAP-ONLY (the face swipe pager was REMOVED)

Face switching happens **only** by tapping a sub-nav pill, on desktop and mobile alike. The `<SwipeStrip>`
face pager (Gesture P3/P3.1) is GONE, along with everything that existed to arbitrate against it. No
data/store change; `SwipeStrip` itself stays (Calendar + MonthlyLogOverlay still page).
- **`visibleFaces: { key: Face; label: string }[]`** remains the SINGLE source for the sub-nav pill map — now
  the only face-switching surface. Gated faces (defense iff `hasCbLoan`, ledger iff `ledgerFaceAvailable`,
  cycling iff `hasCbLoan`) are simply absent from the array. `idx`/`onPage`/`canPage`/`renderPane`/
  `shouldStart` are deleted; the host renders `{renderFace(face)}` directly.
- **ONE face mounts at a time.** The P3.1 real-neighbour panes are gone, so a heavy face (Power Law/Mining
  hooks) mounts exactly when its pill is tapped — never on a peek. `useChainTip` still lives at the hub and is
  never remounted by a face change (§14.5 holds by construction, as before).
- **The scoped `touch-action` block in `AlmanacView.module.css` is DELETED** (`.shell .recharts-wrapper/canvas
  { touch-action: none }` + `.shell [data-gesture-exempt] { touch-action: pan-x }`). It existed only to stop
  native scroll from stealing a chart scrub *from the pager*; with no pager the faces own their own axes and
  the owner-accepted trade-off it carried — "a vertical page-scroll stroke can't START on a chart/exempt
  element" — is retired. Charts scrub, the Ledger table scrolls horizontally in its own `overflow-x` container,
  sliders drag, and a vertical stroke anywhere scrolls the page.
- **Every `data-gesture-exempt` attribute is REMOVED** (LedgerFace `.tableWrap`; CyclingFace's control/scrubber
  cards + milestones wrap; OwnershipFace's scrub card + milestones wrap) — they were inert once `shouldStart`
  and the CSS above went away. A `grep -rn "gesture-exempt" src/` must come back empty.
- **EdgeBackGesture is unaffected** — the left 20px bezel still backs out of the simple-mode Almanac subpage;
  it no longer has to win a priority contest against a pager.
- ⚠ Do NOT re-introduce a face pager without re-deriving the chart/edge exclusions and the axis-ownership CSS
  above; the reason each existed is recorded here.
- Tests: `e2e/navigation.spec.ts` (tap the sub-nav title halving→cycle, asserting `Open Halving Clock` has
  count **1** — ⚠ `Next halving` is NOT Halving-only, CycleClock's demoted halving card carries it too, so the
  Cycle-only string at count 1 is what proves a single mounted face; a committed mid-screen horizontal drag
  does NOT change face; gated-face skip by tapping every pill while `!hasCbLoan`; a chart scrub stays on the
  Power Law face; edge-swipe back still works on Almanac). `faceHostBox` was deleted from `e2e/helpers.ts`.

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
- **`src/components/Viewer/VenueBar.tsx`** (+ `.module.css`) + **`src/simulation/viewerVenue.ts`** — the
  collateral-COMPOSITION bar under the gauge cards (last child of `.cards`, so it inherits the 14px gap):
  a two-segment proportion bar + Strike / Coinbase / Combined figures with dollar values. Answers what none
  of the three gauges answer — what SHARE of the stack sits on the facility that liquidates instantly with
  no cure window (each gauge reports a ratio WITHIN one facility; none reports concentration ACROSS both).
  Pure `deriveVenueSplit(strikeBtc, cbBtc)` → `{strikeBtc,cbBtc,combinedBtc,strikeShare,cbShare,hasData}`;
  negatives/non-finites clamp to 0, `combined <= 0` → `hasData:false` → the component returns `null`
  (render NOTHING — not an empty bar, not a zero state). ⚠ Shares are EXACT quotients, never rounded in the
  module, or the two segment widths stop summing to 100%.
  - **⚠ NOT a fourth gauge, and deliberately BADGE-LESS.** The card grammar is gauge → Safe/Fair/Poor →
    sub-line; a badge needs a level, a level needs a threshold, and thresholds come from lender rules
    (`CREDIT_WARN_USED`/`CB_LLTV`/`strikeLiqLtv`). **No lender rule defines a venue-concentration
    threshold**, so a badge here would mean inventing a risk threshold and dressing it as a peer of three
    that are real. Never give it `barLevel()` colouring.
  - **⚠ NO level colour and NO new token.** `green`/`amber`/`red` are load-bearing as Safe/Fair/Poor on the
    cards directly above, so any of them on a *composition* read would be misread as a risk verdict — which
    rules out a green "Combined" figure just as much as a green Coinbase segment. Strike takes **`--btc`**
    (non-semantic here, and the same token the Almanac Cycling face's venue bar uses, so the two agree),
    Coinbase **`--text-muted`**, the total **`--text-primary`**. `tokens.css` is untouched.
  - **TRUSTED-ONLY**, gated `s.mode === 'trusted'` (`mode`/`figures` are set together in
    `computeViewerSafety`, so they can't disagree). NOT gated on `hasCbLoan` — collateral can sit on
    Coinbase with no loan against it — and never inferred from the values being non-zero, since a trusted
    owner with genuinely zero CB collateral must stay distinguishable from a safe-mode viewer.
    **The gate is structural, not cosmetic:** the C-safe snapshot carries no absolutes by construction, so
    the bar's two inputs *cannot exist* there (pinned in `viewerVenue.test.ts` against the REAL
    `buildViewerSnapshotPayload`). Extending it to safe mode would be a privacy decision — re-deriving the
    "2 unknowns, 1 equation" claim with a third ratio in play — not a UI task.
  - **NO PAYLOAD CHANGE was needed** — C-P4 already ships `strikeCollateralBtc` and VIEWER BUG2 ships
    `cbCollateralBtc` to the trusted viewer (`applyViewerEvent` raw-sets both in one `setState`).
    `ViewerHomeView` reads them through the DERIVES (`getCurrentBtcHeld()` /
    `deriveCbCollateral(dayLog, cache)`), never the raw caches — the viewer's `dayLog` is `[]` so each
    returns the hydrated scalar, but the helper is the single definition. ⚠ Read-only: no
    `setCbCollateralBtc`/`emitBalanceReading` anywhere (they'd inject a reading into the viewer's OWN
    `dayLog`, which BUG3 exists to prevent). The dollar figures use a new `btcPrice` binding — the gauge
    sub-lines render pre-computed absolutes, so there was no resolved-price binding to reuse.
  - ⚠ **No CSS transition on the segment widths** — same iOS WebKit ghost-raster hazard that removed
    `RadialGauge`'s `stroke-dashoffset` transition (below). a11y mirrors the gauge: the bar is one
    `role="img"` with a worded `aria-label`, segments `aria-hidden`, the three cells carry the numbers.
  - **The OWNER DASHBOARD inherits it** — `AppShell` mounts `<ViewerHomeView previewSafeSnap={null}
    ownerNav=…/>` for `simpleView === 'dashboard'`, which forces the trusted live-derive, so any
    trusted-gated content renders there too. Trusted `ViewerPreview` likewise. Intended, not a leak.
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
- **Owner control — the C-safe/C-trusted tier.** ⚠ **SUPERSEDED at Multi-viewer M1:** the global
  `viewerPrivacyTrusted` boolean is GONE — the tier is now **per-viewer** (`ViewerSlot.tier: 'safe'|'trusted'`,
  default `'safe'`, part of the synced `viewers` roster). `buildViewerSnapshotPayload(s, tier)` branches on the
  explicit `tier` param (M2 — the fan-out passes each `slot.tier`; M1's `viewers[0]` read was removed). The roster is STRIPPED from the snapshot in BOTH
  branches (safe has no settings; trusted's strip is now `viewers`/`nextViewerIndex`/`nostrRelays`) AND from the
  **plan backup** (`exportPlan.ts`). SharingPage's tier `<Toggle>` calls `updateViewerSlot(index,{tier})` +
  `publishViewerSnapshotNow()` so a mode flip reaches the viewer at once.
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
  content inside the modal. Props `{onStartNew, onLogIn, onConnectShared}` (prop names unchanged).
  Brand ring + tagline + 3 cards + footer. **R2b-2 — the copy is IDENTITY-FRAMED, not protocol-framed:
  the fork asks what the user HAS, never what technology they hold, and the word "Nostr" appears nowhere
  (it now lives behind Advanced sign-in in NostrAuthGate).** Card 1 (accented `--btc`, `onStartNew`) =
  **"Get started"** / "Free, on this device — we'll create a key for you" → OwnerKeySetup, then the
  numbers wizard. Card 2 (`onLogIn`) = **"I have a plan or a key"** / "Sign in with your Recovery Key,
  extension, or signer — we'll load your plan, or start fresh on your key" (the second clause is the
  honest promise the `remotePlanFound` notice keeps). Card 3 (`onConnectShared`) unchanged.
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
  `{ onComplete, onBack, onLogIn }`. **R2b-1 — K1 mints a NIP-06 plan key** via `generatePlanKey()` (was
  `generateSecretKey()`): 128-bit WebCrypto entropy → 12 words → sk. **TWO refs**, both generated on the K1 tap
  (NOT mount) and zeroed on Start-over / unmount / successful establish: **`entropyRef`** (16 bytes — THE WRAPPED
  PAYLOAD) and **`skRef`** (32 bytes — display-only, feeds the Advanced-nsec). `words: string[]` lives in React
  state *because K2 renders it* — ⚠ a transient secret (a JS string can't be zeroed), never in the store / logs /
  Error messages, cleared at the same three points; it joins the documented pre-existing residual (`nsec` has had
  this property since Phase 1.5). **K1** intro + "Generate my key" + **existing-key guard** (if
  `writerKeyWrapped || nostrPubkey` present → "This device already has a key" + [Log in]→`onLogIn` /
  [← Back]; never regenerate over an identity).
  ⚠ **HOOK-ORDER (React #311 — fixed; do not regress):** `hasExistingKey` MUST be computed from **two separate,
  unconditional `useStore` calls**. It was once written `!!useStore((s) => s.writerKeyWrapped) || !!useStore((s) =>
  s.nostrPubkey)` — the `||` **short-circuits**: while `writerKeyWrapped` is null the second `useStore` runs, but
  the instant K3's `establishLocalOwner` calls `setWriterKeyWrapped` the left side turns truthy and the second
  `useStore` is **never called**. The hook count drops mid-flow and React throws #311 ("rendered more hooks than
  during the previous render") at the exact moment onboarding completes — crashing into the ErrorBoundary instead
  of rendering the fresh plan. Dev hook table: slot 6 `useCallback` (the 2nd store subscription) → `useState`. **K2** `<WordGrid words={words}/>` (blurred 12 words) + a
  seed-phrase **hygiene line** — the DISPLAY variant, mirroring RecoveryKeyCeremony verbatim ("These words were
  generated fresh for this plan. Never use them as a Bitcoin wallet — same format, different job.")
  + an **"Advanced: show as nsec"** disclosure (`.advBtn`/`.advChevron`/`.advPanel`)
  rendering the existing `<SecretKeyCard nsec={nip19.nsecEncode(sk)}/>` for Nostr natives.
  **R2c-6a — the ack checkbox is GONE; K2 merges the ceremony's semantics:** save aids (Download / Save… / QR,
  reusing `buildRecoveryFileText`/`recoveryFileName`/`downloadBlob` + `QRCodeSVG`/`QRCodeCanvas` — plaintext
  `kind='words'`, no encrypt toggle) gate a **word quiz** (`pickQuizIndices`/`checkQuizAnswers`); Continue needs
  `savedOnce` (require-save) + two correct words → `setBackupVerifiedAt(Date.now())` (pre-auth field-only, the K2
  bridge's spot) → K3 → VERIFIED. A ghost **"I'll do this later"** skips quiz+stamp → generated-UNVERIFIED → the
  R2c-2/5b ladder. ⚠ `handleGenerate`/`handleStartOver` `setBackupVerifiedAt(null)` on (re)mint (the field rides
  partialize `...rest` → a stale stamp would falsely verify fresh words). + "Start over" (no Back). **K3**
  `probeKeyVaultCapability` → single "Enable Face ID" (biometric) or the ViewerLoginFlow PIN+confirm UI (PIN);
  Success → `establishLocalOwner(entropyRef.current, m, nostr, { pin, payloadKind: 'nip06-entropy' })` (wraps the
  ENTROPY; the sk is derived internally) → `onComplete`. `setKeyProvenance('generated')` precedes the establish;
  the catch-block clears BOTH provenance + `backupVerifiedAt` (a K3 failure rolls back a real K2 verification).
  `onLogIn` is a small justified extension of the spec's
  `{onComplete,onBack}` (the guard's [Log in] needs to reach the loginFlow).
- **`src/components/Onboarding/WordGrid.tsx`** (+ css) — the 12-word recovery grid, **dual-mode** (a `WordGrid`
  dispatcher over two internal components so hooks stay unconditional). Props are a discriminated union on `mode`.
  **`mode: 'reveal'`** (R2b-1 — `<RevealGrid>`, OwnerKeySetup K2): the R2b-1 body relocated verbatim (output
  byte-identical) — mirrors `SecretKeyCard`'s blur/reveal + Copy (btc-tinted `--surface-2` card, `--mono`,
  `filter: blur(6px)` + `user-select:none`, "Tap to reveal" pill, `Copy → Copied ✓` over `words.join(' ')`);
  numbered 1–12 `<ol>`; **NOT a `<button>` wrapper** (a grid is flow content, invalid inside `<button>`) → the
  repo's `role="button" tabIndex={0}` + Enter/Space `keydown` idiom. **`mode: 'input'`** (R2b-3 — `<InputGrid>`,
  NostrAuthGate's Recovery-phrase tab): 12 controlled `<input>` boxes (`{ values, onChange, onKeyPasted,
  onSubmitAttempt? }`), each with the 4 iOS suppressions. **⚠ CLEAR TEXT by deliberate decision** — a masked
  12-box grid is unusable (no proofread, no autocomplete) and clear-text seed entry is the wallet convention;
  accepted shoulder-surf tradeoff. **The three LOCKED interaction decisions:** (1) **commit keys** — Space/Enter
  commit + advance (`preventDefault` + focus box i+1, or blur+`onSubmitAttempt` at box 12); **Tab is left native**
  (DOM order already advances box→box; suggestion buttons are `tabIndex={-1}` so Tab from box 12 reaches Continue);
  NO auto-jump on 4 letters. (2) **paste** (per-box, `classifyRecoveryInput(clipboard)` first) — `nsec` **or
  `encrypted`** (R2c-7a) → `onKeyPasted` (routes to the parent's Recovery-key tab); exactly 12 → fill all from box 1; 2–11 → distribute from the
  focused box, truncate at box 12; single → native. (3) **validity surface** — per-box tint neutral until first
  blur, then green (`isWord`) / amber; a paste does NOT mark touched (LOCKED "until first blur" is literal). One
  suggestion strip below the grid bound to the focused box (≤4 `suggestWords`); **buttons use `onPointerDown` +
  `preventDefault`** so the tap never blurs the box first (focus + selection survive → the suggestion commits and
  advances). ⚠ **That focus-preservation is a NEW pattern for this repo** — no prior precedent; the standard
  toolbar-button-beside-input technique. `DraggableSheet`'s `activeElement`-aware pointerdown is the nearest
  *conceptual* cousin (it reads `activeElement`), NOT the same mechanism (it force-`blur()`s). ⚠ Never logs. **The
  grid is capture UX only — `skFromWords` on submit is the validity authority; green/checksum are hints.**
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
  `downloadPlanBackup(s)` serializes + calls the SHARED `downloadBlob` (below), filename
  `personal-bloc-backup-{todayLocalISO()}.json` (the LOCAL date, per the date-fix convention).
- **`src/lib/backup/downloadFile.ts`** (R2c-7b) — `downloadBlob(blob, filename)`, the browser-standard
  anchor/`download`/click/`revokeObjectURL` save, EXTRACTED VERBATIM from `downloadPlanBackup` (the
  iOS-verified original). Two callers: the plan backup + the Recovery Key ceremony's save aids — one
  implementation, so they can't drift. iOS caveat (unchanged): a standalone PWA may OPEN the file rather
  than save it, which is why every download surface also offers a copy/share alternative.
- **`src/lib/backup/recoveryFile.ts`** (R2c-7b, PURE; + `__tests__/recoveryFile.test.ts`) — the ceremony's
  downloadable-backup content. `RecoveryArtifactKind = 'words' | 'nsec' | 'ncryptsec'` — a THREE-KIND union
  (not `(kind, encrypted)`) so the impossible `('ncryptsec', false)` combination is unrepresentable.
  `buildRecoveryFileText(kind, artifact)` = a warning header + blank line + artifact + trailing newline
  (plaintext → "anyone with this file can open your plan…"; encrypted → "(ENCRYPTED) — you need your
  passphrase to restore this…"). `recoveryFileName(kind, today, qr?)` → `personal-bloc-recovery-key[-qr]-
  {DO-NOT-SHARE|encrypted}-{today}.{txt|png}`. ⚠ `DO-NOT-SHARE` is the mitigation for a PLAINTEXT file; an
  encrypted file's mitigation is the passphrase, so its name carries `-encrypted` instead. ⚠ These functions
  HANDLE the secret but never own its lifecycle — never log/persist `artifact` here.
- **`SettingsMain.tsx` — "Backup" subpage** — `'backup'` added to `SettingsPage`/`SUBPAGE_TITLES`; a
  menu row (💾, `!viewerMode`-gated) placed right after "Identity & Security" (recovery-adjacent); the
  subpage is one paragraph + an "Export plan" button (`styles.syncButton`, calls
  `downloadPlanBackup(useStore.getState())`). No confirm (read-only, harmless). Owner-only.
- **Device-local/session fields are naturally absent** (not in `buildSettingsPayload`/the records
  set) — `devMode`, `viewerMode`, `settingsDirty`, `initialSettingsPullDone`, nostr identity fields
  never need explicit stripping.
- **Import/restore SHIPPED** — see the next section (was deferred here).

---

## Plan Import / Restore (the restore counterpart; store unchanged, NO bump)

Loads a `PlanBackup` file back in: **pick → validate fully → summary → destructive confirm → ATOMIC
replace → normal sync resumes.** Owner-only (mounted inside SettingsMain's `!viewerMode` tree).

**Semantic — MERGE-FORWARD, not time-travel** (stated verbatim in the confirm copy): settings are
whole-object LWW (the imported settings republish with a fresh `created_at` and win); records are
union+tombstones (`mergeRecords`), so the next relay pull unions back any day/month events created
*after* the backup. True point-in-time rollback is Phase 4f event-replay.

- **`src/lib/storeVersion.ts` (NEW, zero-import):** `CURRENT_STORE_VERSION` — the SINGLE store-version
  constant, consumed by the persist `version`, `exportPlan`, `demoSeed` (`DEMO_SEED_STORE_VERSION`), and
  the validator's gate. `e2e/helpers.ts` keeps its own pinned literal (Playwright can't import `src/`).
- **`src/store/settingsFields.ts` (NEW, zero-import):** `SETTINGS_FIELDS` lifted out of
  `hydrateSettings`' closure (single source; `hydrateSettings` now imports it). Two derived subsets:
  **`VALIDATE_WHITELIST`** = `SETTINGS_FIELDS − {viewers, nextViewerIndex, nostrRelays}` (a file key
  outside it → reject as tampered/foreign — the transport fields must never be restored), and
  **`APPLY_FIELDS`** = that `− backupVerifiedAt`.
  **Phase 4b partition** (for the event-sourced plan core): **`PREFS_FIELDS`** = `[tabOrder, hiddenTabs,
  simpleMode, btcBuyingUnit]` (device-taste, stays whole-object LWW on `prefs:v1` — a stale clobber is
  cosmetic + self-corrects) and **`PLAN_EVENT_FIELDS`** = the other **33** (event-sourced). `33 plan + 4
  prefs = 37 SETTINGS_FIELDS`. ⚠ AMENDMENT to the 4a design lock's §3: `backupVerifiedAt` (R2a-1, joined
  the synced set after the lock was written) is a PLAN field. `PlanField = Exclude<SettingsField,
  PrefsField>` and `PLAN_EVENT_FIELDS` uses a **type-guard filter predicate** (`(f): f is PlanField`) so
  the array narrows to `readonly PlanField[]` — a naive `.filter()` widens the element type and would make
  `PlanField` the wrong (too-wide) union.
- **⚠ THE CRITICAL VALIDATE↔APPLY SPLIT.** `backupVerifiedAt` **is** in the validate whitelist (every
  export carries it — must not reject) but is **NOT** in `APPLY_FIELDS` — `applyPlanBackup` **never
  writes it** (and `keyProvenance` is never in the payload). *The stamp attests KEY custody, not plan
  data — a backup restores a plan onto whatever key the device holds.* Without this, importing any
  export onto a generated-unverified key would open R2a-1's eleven gate sites for an un-backed-up key.
  A gated key imports fine (data lands local-only, engine gated) and **stays gated** — the gate opens
  only via the real ceremony. Pinned by tests.
- **`src/lib/backup/validatePlanBackup.ts` (NEW, PURE/node-tested):** `validatePlanBackup(raw) → {ok,
  backup, summary} | {ok:false, reason}`. Imports only `CURRENT_STORE_VERSION`, `VALIDATE_WHITELIST`,
  and TYPE-only `PlanBackup` (so it never pulls useStore). Checks (all before any store touch): format
  string · `schemaVersion===1 && storeVersion===CURRENT_STORE_VERSION` (**lean-reject** mismatch,
  version-honest message) · every settings key ∈ `VALIDATE_WHITELIST` (unknown/transport → reject) ·
  four record collections present + per-event/entry shape-checks · **tombstone maps accepted as
  `Record<string,number>`** (JSON stringifies `deletedMonths`' numeric keys — do NOT reject on key
  typeof) · counts capped ≤100k (OOM guard) · `ImportSummary` (exportedAt + counts + income/expenses/
  balances preview).
- **`applyPlanBackup(backup)` store action (`useStore.ts`) — ONE atomic `set()`:** (a) settings
  partition filtered to `APPLY_FIELDS`; (b) records wholesale (`monthlyLog`/`deletedMonths`/`dayLog`/
  `deletedDayEvents` — the PlanBackup record names match the store field names 1:1; per-entry `btcHeld`
  restored verbatim as historical ledger); (c) `cbCollateralBtc`/`strikeCollateralBtc` folded from the
  imported `dayLog` in the SAME commit (the `setDayLog` discipline; the §5b `deriveReadingAnchors` seam
  is NOT run — imported settings already carry the anchor scalars+asOf); (d) `settingsDirty`/
  `recordsDirty` + **`initialSettingsPullDone:true`** (load-bearing twice: blocks `sync.ts`'s first-pull
  exception from hydrating remote OVER the import, and lets publish proceed). Then kicks
  `syncSettingsToNostr()` + `publishRecordsNow()` (both gate/auth/viewer-guarded → no-op for a gated/
  unauth/viewer key).
- **`RestoreBackupFlow.tsx` (+ `.module.css`, NEW):** ceremony-style overlay (`{onClose}`, own
  `.overlay`/`.modal` z-index 99999, no portal — the `RecoveryKeyCeremony` pattern; owns the screen so
  no back-chain/edge-swipe escapes mid-restore). Steps `pick → validating → summary → applying → done
  → error`; `<input type="file" accept="application/json">` + `FileReader.readAsText`, 10 MB cap before
  parse (net-new — no prior file-input in the repo). Mounted from the SettingsMain **Backup** subpage
  via a `restoreOpen` boolean beside "Export plan" (mirrors `ceremonyOpen`); owner-only by construction.
- **Tests:** `validatePlanBackup.test.ts` (round-trip of a real `buildPlanBackup`, all rejections,
  string-keyed `deletedMonths` accepted, the gate test, + a drift-guard pinning `VALIDATE_WHITELIST`/
  `APPLY_FIELDS` against `buildSettingsPayload` keys) + `applyPlanBackup.test.ts` (gated key stays gated,
  transport untouched, `initialSettingsPullDone` set, caches match the imported dayLog). No store bump.

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
export const PL_A_CEILING = 2.4e-17; GENESIS = new Date('2009-01-03T00:00:00Z');
```

Three independent A constants — never `PL_A_FAIR × scalar`. **`PL_A_CEILING` was `10 ** -16.12` (6.54×
fair) and is now `2.4e-17` (2.07× fair)** — the old value was calibrated to the 2017-era tops and by 2026
overstated the upside ~3.2×, which is the dangerous direction in a leverage tool. The bands share `PL_B`,
so a parallel resistance can never be an envelope: tops decay toward trend every cycle (19.3× fair in 2011
→ 0.99× at the Oct-2025 top), so this constant is a calibration choice with an expiry, not a fit. The
floor, by contrast, IS a fit — it sits ~2% off Santostasi's published power-law floor and was touched at
the Nov-2022 low. ⚠ **User-facing label is "Resistance"; the `PlBand` key stays `'ceiling'`** — renaming
the key would ripple through four files for no functional gain. Pinned by `powerLaw.test.ts`
(`PL_A_CEILING / PL_A_FAIR ≈ 2.069`, a pin not a bound, so the old value can't drift back in).

**`PL_BAND_LABEL: Record<PlBand, string>`** (same module) is the ONE user-facing word per band —
`floor → "Support"`, `fair → "Fair"`, `ceiling → "Resistance"`. Every surface imports it; **nothing
renders a raw key.** Both Almanac faces used to interpolate `{band}` / `${pathKind}` straight into
prose, so a panel headed "Resistance" read "…reverts toward the power-law ceiling line" two lines
below. Pinned by a test that also asserts `floor`/`ceiling` never equal their own keys.

**`PL_ON_THE_LINE = 1`** — the opt-in "on the line" preset on BOTH Almanac faces. **Not an engine
branch:** it is `convergeMonths = 1`, where the existing weight `max(0, 1 − m/convergeMonths)` is
already 0 for every m ≥ 1, so month 1 onward IS the band value for that month. The faces only had to
drop their Convergence/Reversion slider floor (12 and 6 → `PL_ON_THE_LINE`) and add a ghost preset chip.
⚠ **Month 0 stays pinned to the live price**, so choosing it puts a real one-month STEP in the path —
today: support **−19.1%** → $64,468, fair **+123.5%**, resistance **+362.4%**. Both faces print the size
of that step in the path note; the chart shows it as a visible cliff, which is correct, not a bug.
Available on all three bands, though only support is a genuine stress — the other two are step-ups whose
peak CB LTV never exceeds today's.

**Coinbase APR context (both faces).** The APR slider is the owner's MANUAL `cbAprPct`, not a live feed —
the faces show what it has cost and let the owner pull the live number in by hand. `MORPHO_REALIZED_APY`
(in `useMorphoRate.ts`) is this market's realized band from Morpho's `historicalState`: **4.1–7.5% over 23
months since Oct 2024, max 9.9%**, median 5.3 — which is where the stored 5.28% already sits (50th
percentile, well calibrated). Static by design: those move ~0.2pt/yr, so re-fetching 24 points behind a
consent gate to recompute them would be a request for a rounding error; the refresh `curl` lives in the
constant's docblock. ⚠ The band excludes the first two months (1.6–3.1% on a brand-new market's thin
utilization — a property of a new market, not of this rate) and it is ONE CYCLE under one dollar-rate
regime: it says what has happened, never what can. The IRM permits 200% at target.
⚠ **The rate is a COST, not a danger, in this model** — peak CB LTV moves under a point across a 3→16%
sweep because the draw cap absorbs it into less accumulation. And the sign inverts with the path: on a
rising band the debt shrinks in BTC terms, so 5.28% vs the realized bull-regime 6.91% is worth **0.03 ₿
over 20 years**, while on a flat/support path the same spread bites hardest. A regime-coupled rate was
measured and REJECTED on those grounds — a control and a concept for a rounding error.

⚠ **BOTH faces now DEFAULT to Support + on the line** — the conservative read, not the flattering one.
`DEFAULT_CONVERGE_MONTHS = PL_ON_THE_LINE` on both; **`REVERT_PRESET_MONTHS`** (Cycling 48, Ownership 60)
is what the chip restores and **must stay distinct from the default**, or the toggle is a silent no-op.
Cycling also gained `DEFAULT_BAND = 'floor'` and `DEFAULT_INSPECT_MONTH = 24` (the scrubber opens at
2.0 yr, `Math.min`-clamped against the horizon, instead of at the far end). Ownership's `DEFAULT_PATH`
is now `'floor'`. **Cycling's `DEFAULT_CYCLE_MONTHS` is 1** (was 3), matching Ownership — sweeping monthly
parks the expensive 13% Strike balance for one month instead of three: Strike interest HALVES
($5,470 → $2,677) and peak Strike LTV drops 24.0% → 9.2%, against ~$892 more CB interest and ~1.2pt of
peak CB LTV. Same bitcoin held either way — purchases follow income, not the sweep.
Pinned by two tests, one asserting month 1..24 equals `plBandsAt` per band, one asserting the step is a
real discontinuity (>5%) and signed correctly per band — so nobody can "simplify" the weight and
silently kill the preset.

⚠ **C2 NOTICE BUGFIX (OwnershipFace):** `degenerateCap` compared `rows[0].cbLtv * 100 <= capPct`, the
INVERSE of its own message ("at or above the cap, so this run never draws"). Since `drawing` is
`cbLtv < cap`, "never draws" means opening LTV **≥** cap. The old test hid the notice in exactly the case
`DEFAULT_CAP_PCT = 50` was chosen to surface (opening 50.58% vs a 50% cap) and showed it whenever the draw
was running fine. Now `>=`. This matters more since the faces default to Support + on the line, where the
draw stops at month 1 — the notice is the only thing that explains why.

⚠ **The Ownership face's `drift` ("Fixed rate") path is REMOVED** — `pathKind` is now exactly `PlBand`,
the `growth` overlay key and the conditional Annual-growth slider are gone, and `driftPath` was deleted
from `ownershipFaceView.ts` as dead code. A flat/fixed-rate price is not a thing bitcoin has ever done,
so it was a scenario nobody would legitimately plan on. The Cycling face never had it.

Data: Blockchain.com (dev direct, prod via `/api/btc-history` proxy). Block height: mempool.space.
Halving computed from block height only.

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
--coinbase #0052FF (Coinbase venue accent — the design system's only brand-colour token)  --maroon #8B3A3A (CycleClock low/floor marker)
/* Gesture & Motion System P0 — springs as duration+easing pairs (CSS transitions AND WAAPI): */
--motion-fast 120ms / --motion-standard 200ms / --motion-settle 320ms
--ease-standard / --ease-decelerate (cubic-beziers)  --ease-spring / --ease-spring-soft (linear() spring curves)
```
`--bg-base: #09090E` (= `--bg-app`) is defined in `tokens.css` — it had been referenced in 25 places across
15 files but never defined (resolved transparent: 23 `background:` uses masked by the dark app bg, 2
`color:` uses = invisible dark-on-bright button text in SafetyDashboard, both fixed by the one definition).

**Venue palette — ONE convention across ALL THREE surfaces.** The venue bars use the same two tokens in
`src/components/Viewer/VenueBar.module.css`, `src/components/Almanac/OwnershipFace.module.css`, and
`src/components/Almanac/CyclingFace.module.css`: Strike = `--text-primary` (white), Coinbase = `--coinbase`
(blue). **A change to one is a change to all three** — never migrate one bar onto a new pair without the
other two. `--coinbase` is the design system's only brand-colour token; the bar for adding a second is the
same argument made for it (a venue read, not a level colour — no lender rule defines a venue threshold, so
a green/amber/red on a composition bar reads as a risk verdict it doesn't have).

**Motion vocabulary (Gesture & Motion System P0):** springs (`--ease-spring`/`--ease-spring-soft`, `linear()`
approximations, Safari 17.2+) belong on anything that *moved under a finger* (sheets, swiped rows); beziers
(`--ease-standard`/`--ease-decelerate`) on anything that merely *appears* (fades, scrim). `transform`/`opacity`
only — no layout property is animated. A global `@media (prefers-reduced-motion: reduce)` block in `global.css`
collapses all CSS transitions to 80ms cross-fades (was 1-of-78 modules; now one global policy); the JS side reads
`useReducedMotion` to snap finger-tracking motion between rest states. Gestures still FUNCTION under reduced motion.

---

## Gesture & Motion System (P0 — foundation layer; no consumer surfaces changed)

Pure infrastructure for native-app touch fidelity — the base every later phase (sheets, journal gestures,
edge-back, micro-interactions) consumes. **Zero new dependencies.** P0 ships the primitives ONLY; nothing renders
differently yet. NON-NEGOTIABLES (design.md §0): no gesture ever commits a financial write (swipes reveal/navigate/
dismiss/stage — commit is always an explicit labeled tap); emergency surfaces stay gesture-free; every gesture has a
visible tap equivalent; motion explains causality, never decoration.

- **`src/lib/gestureModel.ts`** (PURE, no React, no DOM) — the single gesture STATE MACHINE, fully node-testable.
  `advance(state, event, config): GestureState` = `(state, event) → state'`, states `idle → tracking → axisLocked →
  armed → committed|cancelled` (committed/cancelled TERMINAL → `advance` is their identity). Beyond `slop` (default
  8) it axis-locks ONLY when the dominant axis beats the cross axis by `axisLockRatio` (default 1.4) AND matches
  `config.axis`, else CANCELS (releases to native scroll). `armThreshold`/`commitThreshold`/`commitVelocity` are
  REQUIRED (per-surface); commit on release = `|primaryDelta| ≥ commitThreshold` OR `|velocity| ≥ commitVelocity`.
  **P1 arm-on-lock fix:** the move that crosses `slop` + passes the axis test evaluates `armThreshold` in the SAME
  call (`dominantMag ≥ armThreshold ? 'armed' : 'axisLocked'`), so a single-move flick (`down→one big move→up`)
  reaches the velocity-commit branch instead of cancelling from `axisLocked`.
  A `cancel` event (incl. synthesized second-pointer) cancels from any non-terminal phase. Also `createGesture`,
  `velocity` (px/s over a 3-sample rolling window along the locked axis; 0 if <2 samples or Δt=0), `primaryDelta`,
  `rubberBand(pull,max) = pull*max/(pull+max)` (sign-preserving, asymptote < max). Consumed by `usePointerDrag`
  (thin adapter) — see hooks/. **P1.3 `resolveScrollClaim({claimed},{scrollTop,goingDown,dyClaim}) →
  {claim,claimed}`** (pure) — the bottom-sheet scroll/drag handoff rule: claim a downward stroke only at
  `scrollTop<=0`; stay claimed until `dyClaim<=0` (release measured from the CLAIM point, not touchstart) hands
  control back to native scroll. Consumed by DraggableSheet's non-passive touchmove listener.
- (P1.3's temporary `gestureDebug.ts` + `GestureDebugOverlay.tsx` + the DevPanel GESTURE DEBUG toggle were
  DELETED in P2 — the touch handoff is device-proven.)
- **`src/lib/haptics.ts`** — capability-honest haptics, no faking. `haptics = { tick, confirm, warn }` +
  `hapticsSupport(): 'vibrate'|'none'` (detected once, cached). Ladder (P1.2 lock-down): `navigator.vibrate()`
  patterns (Android/Chromium) → `'none'` for EVERYTHING else, **including iOS**. ⚠ **iOS has NO programmatic
  haptic path (device-verified Jul 2026):** WebKit's `<input switch>` system haptic fires ONLY on a physical user
  tap of the control, not on synthetic activation — all three variants (`label.click()`/`input.click()`/`checked+
  dispatch`) × both host pointer-events states were silent, so the entire ios-switch path was DELETED. Called at
  exactly two moment-types: a gesture crossing `armed` (`tick`) + a `confirm` landing; `warn` on a blocked action —
  no-ops on iOS/desktop, live on Android. Every haptic has a same-instant visual twin (§5.4) — the VISUAL channel
  is the primary feedback channel; haptics are seasoning where the platform allows them. (design.md §1.3's iOS ≥18
  haptics-table row is superseded → `none`; design.md is owner-maintained and not edited here.)
- **`src/hooks/usePointerDrag.ts` / `src/hooks/useReducedMotion.ts`** — see the hooks/ file list above.
- **Test:** `src/simulation/__tests__/gestureModel.test.ts` (23 cases, node/no-DOM: slop, axis-lock ratio + wrong
  axis, arm/disarm both directions, commit-by-distance + commit-by-velocity, velocity window math + 0-guards,
  rubberBand monotonic/sign-preserving, terminal identity, cancel from every phase). The hook/haptics DOM behavior
  defers to the P1 device gate (`hapticsSupport()` from the console).

---

## Gesture & Motion System (P2 — Journal gestures)

Gestures on the Journal, all riding `usePointerDrag` (pointer events; Chromium-e2e-able unlike the P1.3 touch
handoff). NON-NEGOTIABLE 1 governs: no gesture commits a financial write — swipes REVEAL/NAVIGATE; deletes are a
TAP on a revealed control. Zero new deps. Removed the P1.3 gesture-debug scaffolding (device-proven).

- **`SwipeStrip` (components/ui)** — the shared pager; see the ui/ file list. Calendar + MonthlyLogOverlay adopt it.
- **`useLongPress` (hooks)** + **`Snackbar` (components/ui)** — see the hooks/ + ui/ lists.
- **Calendar (`components/Daily/Calendar.tsx`)** — the wdRow+grid unit is wrapped in `<SwipeStrip>`; `renderPane`
  renders the target month/week purely (`monthDateRange(currentMonth+offset)` / `weekDates(shiftISO(selectedDay,
  offset*7))`). MONTH paging reuses the existing `onPrevMonth`/`onNextMonth`/`canPrev/NextMonth`; WEEK paging is
  NEW (`onPrevWeek`/`onNextWeek`/`canPrev/NextWeek` — DailyModeView shifts `selectedDay` ±7, bounds
  `advisorStartDate..today`). Nav buttons remain (gesture additive). Each day cell is a `<DayCell>` sub-component
  (hooks-in-a-map → its own `useLongPress`) with `data-testid="day-cell"`/`data-date`; a 500ms hold → new
  `onLongPressDay` → DailyModeView selects the day + opens the pre-dated add sheet (future-day guarded like the
  FAB); `data-holding` eases the cell bg to `--surface-3` over the hold. The SwipeStrip's `onSwipeStart` cancels a
  pending long-press (the strip captures the pointer).
- **Swipe-to-delete (`components/Daily/MonthEventsModal.tsx`)** — editable rows wrap in a local `SwipeDeleteRow`
  (design.md §3.3): usePointerDrag axis 'x', LEFT-only (rightward → rubberBand 16, reveals nothing), track
  0→96px, **armThreshold 64** (arm → icon settles + `haptics.tick`), **`commitThreshold`/`commitVelocity`
  Infinity — NO velocity/full-swipe delete, velocity NEVER deletes ledger data (non-negotiable 1)**. The arm is
  DIRECTION-GATED (`onArm: dxRef>=0 → return`; rest-open requires `armedRef && dx<0`) — same class as P1's
  DraggableSheet dy>0 gate. Release armed → row rests OPEN at 96px (spring); else springs shut. Delete = a TAP on
  the revealed button → 200ms `max-height` collapse (the ONE sanctioned height animation) → `onDeleteEvent(ev)`.
  ONE row open at a time (`openRowId`; scrolling the list closes it; `data-open` on the row). a11y: an off-screen
  focusable `Delete` button (visible on focus) → deletion never requires the gesture. Non-editable/viewer rows
  stay inert (no swipe).
- **Undo (`Snackbar` + store `undoDayEventDeletion(event)`)** — DailyModeView holds the deleted `DayEvent` (the
  store discarded it) and shows a 5s Snackbar; UNDO calls `undoDayEventDeletion` which re-adds the event with a
  FRESH `ts=Date.now()` + strips the `deletedDayEvents` tombstone (mirrors add/delete's cache/reroll/publish tail).
  **LWW guarantee:** `deleteDayEvent` publishes the tombstone via the 400ms-debounced `publishRecordsNow`, so it
  likely reaches relays within the window; undo does NOT need to beat it — per `mergeRecords` a dayLog event is
  suppressed only when `tombstone.ts > event.ts` (strict), so a `ts=Date.now()`≥tombstone restore SURVIVES on
  every device and drops the stale tombstone (the canonical edit-after-delete revive). `recordsDirty` + syncNow
  make it durable if the immediate publish fails.
- **MonthlyLogOverlay migration (`components/Advisor/MonthlyLogOverlay.tsx`)** — the legacy `handleTouchStart`/
  `handleTouchEnd` ±50px month-swipe (the app's LAST pre-standard gesture code) is DELETED; the card region is a
  `<SwipeStrip>` (onPage → `setCurrentIdx` 0..11, canPage → idx bounds). `renderCard()` → `renderMonthCard(mn,
  active)` — the `active` (center) pane renders the full stateful card (edit form / LOG button, single-instance
  form state tied to currentIdx); neighbors (±1) render the read-only view (logged→view grid; else projected).
  Nav buttons + dots + keyboard nav stay.

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

1054 tests — `npx vitest run` before every commit.
- `src/lib/crypto/__tests__/cryptoClient.test.ts` — Phase 2a crypto worker. In node `typeof Worker === 'undefined'`, so every op takes the SYNCHRONOUS in-thread FALLBACK (byte-identical to pre-2a). Fallback round-trip encrypt→decrypt at `logn:1` returns the original sk; wrong passphrase → `CryptoError` `kind:'passphrase'`; malformed input → `kind:'malformed'`; **caller-buffer safety** (after `nip49Encrypt(sk,…)` the caller's `sk` is NOT zeroed — the internal-copy contract); pure helpers `encode{Encrypt,Decrypt}Request` (op/field names + transfer list) and `classifyWorkerFailure` (known kinds passthrough, unknown → `'generic'`). The worker itself (real Worker + WebKit) is device-gated, not unit-tested
- `src/lib/nostr/__tests__/disconnect.test.ts` — R2c-6b, the three teardowns as a contrast set (6 cases; `escapeHatch.test.ts`'s `window.location.reload` + localStorage shims, installed before the store import). Seeds a VERIFIED local owner, then: **`signOutLocal`** retains the identity (`nostrPubkey`/`nostrSigningMethod`/`nostrAuthEnabled` → lands on `LocalUnlockGate`, not the login screen), retains `writerKeyWrapped`/`writerKeyWrapMeta` (something is left to unlock), ⭐ **retains `keyProvenance` + `backupVerifiedAt`** (a verified key stays verified across sign-out — no backup ladder, no nag), and clears only `nostrSigner`/`isAuthenticated`/`nostrLogin` + reloads once. **`reconnectNostr`** shows the SAME retention (proving `signOutLocal` added its flag without altering the shared teardown NIP-46 depends on). **`disconnectNostr`** CLEARS pubkey/method/`keyProvenance`/`backupVerifiedAt` — the contrast that gives "Sign out" and "Remove local key" their different weights; if a future edit collapses the two teardowns, this fails. **`signOut(method)` dispatch** — the three teardowns are same-module siblings (un-spyable from `signOut`), so each arm is pinned by its unique store fingerprint, with `nostrAuthEnabled` seeded FALSE as the discriminator (only `signOutLocal` sets it): `'local'` → auth true + pubkey/key/provenance retained; `'nip46'` → pubkey + provenance retained, auth still false, `nostrLogin` cleared; ⭐ `'nip07'` → pubkey/method/provenance/`backupVerifiedAt` all **null**, i.e. **NOT `reconnectNostr`** (whose retained pubkey would let `useNostrAutoRestore` silently re-authenticate through the extension — the regression this test names); `null` → no-op, no `reload()`. Plus `signOutConfirmMessage` copy-truth: a PIN key is never promised a biometric, and the nip07 string makes no identity-retention claim. **R2c-6b remanence contrast** (seeds `personal-bloc-store` + `personal-bloc-onboarded` + `bloc-device-tag` on the shim): ⭐ `disconnectNostr` WIPES the blob AND the onboarded flag (the latter is what shows the fresh entry fork — blob-only would be a half-fix) while retaining the device tag; `signOut('nip07')` wipes too (it IS disconnectNostr); `signOutLocal` + `reconnectNostr` RETAIN both — the pin that fails if anyone unifies the teardowns. All three wipe assertions go red with the `wipeLocalPlanData()` call removed (verified). Plus `identityForgetConfirmMessage`: both normal branches name the local-data removal + the unsynced-changes loss; ⭐ the `neverSynced` branch NEVER says "stays on the relay" (a generated + unverified key has no relay copy) and names the action it warns about
- `src/lib/store/__tests__/wipeLocalPlanData.test.ts` — R2c-6b, **the key inventory as an executable contract** (in-memory `localStorage` + `sessionStorage` shims, installed before the import): `it.each` over the 9 plan-scoped localStorage keys + the 1 sessionStorage key (all removed) and the 1 device-level key (retained); `leaves nothing behind but the device tag` (a whole-map equality — a NEW app storage key that nobody classified fails HERE); ⭐ `removes personal-bloc-onboarded, not just the blob` (the half-fix pin); idempotent + never throws on an already-clean device
- `src/lib/__tests__/bufferAliasing.test.ts` — R2c-7b, the executable form of the R2c-7a **`.slice()` Critical Constraints row** (3 cases, pure, no React). Reconstructs the hazard: a `Uint8Array` in a struct (React state) + a consumer that PERSISTS its argument then zeros it in a `finally` before throwing (`establishLocalOwner`'s real ordering — wrap+persist BEFORE deriving the pubkey). **ALIASED** → the throw zeros `state.sk` in place, and the retry persists 32 ZERO bytes (a corrupted credential for an identity that never existed). **COPIED** → `.slice()` sacrifices the copy, `state.sk` survives, the retry persists the real key. Plus `.slice()` is a copy not a view. ⚠ It does NOT exercise NostrAuthGate's retry (no render harness — house rule); it makes "copy a buffer you're about to zero" fail loudly if a refactor deletes the copy as redundant
- `src/lib/backup/__tests__/recoveryFile.test.ts` — R2c-7b pure file builder (10 cases): plaintext-words body, plaintext-nsec body, encrypted-ncryptsec body (`(ENCRYPTED)` + names the passphrase, and does NOT say "never share it" — a different mitigation); a `PERSONAL BLOC RECOVERY KEY` header precedes a blank line + the artifact for ALL THREE kinds (the header is the honest mitigation for a plaintext artifact — never droppable by kind); exactly one trailing newline; filenames per kind (plaintext → `DO-NOT-SHARE`, encrypted → `-encrypted` and NOT `DO-NOT-SHARE`, `qr` → `.png` keeping the marker)
- `src/lib/nostr/__tests__/ncryptsec.test.ts` — R2c-7a-fix, the two layers that let the Recovery-key tab tell a malformed payload from a wrong passphrase (15 cases, real `nip49` output, `logn:1` so scrypt stays fast). **Layer 1 `isWellFormedNcryptsec`:** a real encrypt output → true; **a full handoff token (`ncryptsec + ':' + npub`) → false** (the exact input R2c-7a misreported as "Wrong passphrase" — it still prefix-matches as `encrypted`, so only the shape gate catches it); truncated / bare nsec / trailing newline / uppercase / garbage → false; **a 1-char typo PASSES** (documented hole — length + charset intact → Layer 2 owns it); `NCRYPTSEC_LENGTH === 162` pinned across `logn` 1/8/16 (a silent length change would disable the gate; `logn:20` is omitted — 2²⁰ scrypt rounds blow the 5s timeout for zero extra coverage, and `logn` is one payload byte so it cannot affect length). **Layer 2 `classifyNcryptsecError`:** `decrypt(valid, wrongPass)` → `'passphrase'`; broken checksum / wrong prefix / full token → `'malformed'`; a non-Error throw → `'malformed'` (safe default); discriminates on `'invalid tag'` specifically
- `src/store/__tests__/backupNagDismissed.test.ts` — R2c-2 session-transient dismissal (mirrors `remotePlanFound.test.ts`): default `false`; absent from `buildSettingsPayload`; **EXCLUDED from `partializeState`** (persisting it would keep the nag dismissed across launches, defeating the ladder); `dismissBackupNag()` sets true. NO module latch (single writer)
- `src/lib/__tests__/backupGate.test.ts` — R2a-1 pure predicate (6 cases): `'generated'`+null → false; `'generated'`+ts → true; `'imported'`/`'external'`/`null` → true (the last IS the legacy grandfathering); `backupVerifiedAt: 0` → true (the check is `!= null`, not truthiness)
- `src/store/__tests__/backupGate.test.ts` — R2a-1 store plumbing (25 cases): field posture (both default null; `backupVerifiedAt` IN `buildSettingsPayload`, `keyProvenance` NOT; both ride `partializeState`); `setKeyProvenance` write-once (a different non-null → ignored + warns "already set"; the SAME value → silent no-op — an establish retry must not warn; `null` clears, then a new provenance sticks; **R2c-6-final: writes through to standalone `personal-bloc-provenance` [stamp writes, `null` clears], and an ignored write-once conflict never touches it**); **bypass 1 — `gateHydratedIdentity` prefers the standalone provenance over the blob (⭐ escape-hatch survival: blob has NO `keyProvenance`, standalone `'generated'` → `keyProvenance:'generated'` → `isBackupGateSatisfied` FALSE, still gated; standalone wins even when the blob disagrees). Both go red if the `gateProvenance ??` line is removed (verified);** `setBackupVerifiedAt` (stamp sets field **and** `settingsDirty`; the `null` teardown clear touches neither); the hydrate ONE-WAY LATCH (incoming `null` never clobbers a latched local, and a sibling `income` STILL applies — skip-FIELD; a real ts hydrates; `null` over unlatched applies; an OMITTED field is skipped by the whitelist; later ts overwrites earlier); gate integration (**the interim K2 bridge stamp pair → satisfied** — this fails loudly at R2c if the bridge line is removed without a ceremony replacing it; generated-unverified → gated; both-null legacy → satisfied; `gateHydratedIdentity` nulls both on the signed-out branch while non-identity data passes through, and leaves both alone when signed in); publish guards (`publishSettingsNow` bails at the gate BEFORE `setNostrSyncing`/the seed-guard warn; `syncSettingsToNostr` won't dirty while gated). ⚠ Assert warn CONTENT, not call count — zustand's persist middleware warns on every `set` under node ("storage is currently unavailable")
- `src/simulation/__tests__/gestureModel.test.ts` — Gesture & Motion System pure state machine (35 cases, node/no-DOM): slop (sub-slop stays tracking; tap→cancelled); **R2c-3 capture-on-arm contract** (DraggableSheet's y/8/24 config: tap down→up → cancelled [never armed → usePointerDrag never captures → native click survives]; 20px<24 → axisLocked; 30px≥24 → armed = the capture frame); axis-lock (x dominates → axisLocked; ratio < 1.4 → cancelled; wrong dominant axis → cancelled); **P1 arm-on-lock** (single move past slop+armThreshold → armed; single-move flick commits via velocity); arm/disarm both directions; commit-by-distance + commit-by-velocity (real timestamps) + release-below-both → cancelled; velocity 3-sample window math + 0-guards (<2 samples, Δt=0) + window bounded at 3; primaryDelta per axis; rubberBand f(0)=0/monotonic/asymptote<max/sign-preserving; terminal identity from committed & cancelled; cancel from every non-terminal phase. **P1.3 resolveScrollClaim** (7 cases): claim at scrollTop 0+down, no claim scrolled, no claim up-at-top, stays claimed once claimed even if scrollTop later >0, two-way release at dyClaim≤0, re-claim after release, + the claim-BASELINE case (claim after 180px travel → release at 20px back up from the claim point, dyClaim=−20, NOT 180 from touchstart). (DraggableSheet + usePointerDrag/haptics/useReducedMotion DOM behavior defers to the device gate.)
- `dailyMode.test.ts` (Strategy-Month Calendar Fix block) — calendar-anniversary `bucketEventToMonth` (Jun-1 start: Jun 30=M1, **Jul 1=M2**, Aug 1=M3; Jan-31 start short-month clamp Feb 28=M2; `strategyMonthIndex` unclamped <1 pre-start / =13 at start+12mo = the completion signal) + `strikeCollateralDelta` (strike ±, ignores cb/non-collateral, honors the bucket fn — calendar vs `legacyBucketEventToMonth` place a boundary deposit in different months) + `sameRollupFields` (0≡absent; undefined-entry↔empty-fresh; differ on amount/stock/provisional). `dailyModeStore.test.ts` reconcile block: a boundary event M1→M2 empties the stale M1 daily entry + creates M2, second run idempotent, flag set; **Correction 1** — a boundary strike deposit re-rolls BOTH neighbors even when every `sameRollupFields` key matches (the collateral-delta comparison caught it); `monthBucketReconcileDone` default-false / rides partialize / absent from `buildSettingsPayload`. `collateral.test.ts` fixture re-expressed in calendar terms (`startMonthsBack(4)` → deterministic Month 5).
- `src/simulation/__tests__/readingAnchors.test.ts` — §5b Readings-Unification pure `deriveReadingAnchors`: guard (date ≥ asOf; null asOf always applies; idempotent already-anchored → empty patch), select-by-DATE-not-ts (edited older reading with a newer ts does NOT win), delete/date-move fallback (date+value proxy re-points to the survivor; no survivor → unchanged; KNOB-SET IMMUNITY — unrelated same-day delete whose value ≠ the knob-set anchor doesn't clobber), cbLiqPrice omit/present, Strike-only reading leaves CB anchors alone. (`dailyModeStore.test.ts` §5b block: add re-anchors advisorActualBlocBalance/cbLoanBalance/cbLiquidationPrice + asOf=today; `setDayLog` merge folds cbCollateralBtc but NOT the balance anchors; delete-fallback; `advisorActualBlocBalanceAsOf` synced/default-null/stamped. `eventSheet.test.ts`: `reading.cbLiqPrice` omitted when blank/0, present when entered, never on a collateral move.)
- `src/lib/nostr/__tests__/establishOwner.test.ts` — Phase 1.5 `establishLocalOwner` (5 cases, mocked wrapSecretKey/syncNow/NSecSigner; nip06Key NOT mocked → real derivation): PIN path persists the wrapped pair + sets nostrPubkey(from sk)/nostrSigningMethod='local'/isAuthenticated=true IN ORDER (invocationCallOrder pubkey<method<auth) + calls syncNow/markSignerFresh + zeros the payload, wrap 5th arg 'sk'; PRF path forwards the passkey label (not a pin), 5th arg 'sk'; **R2b-1 entropy path** — `generatePlanKey()` entropy wrapped with 5th arg 'nip06-entropy' + **nostrPubkey === getPublicKey(sk) DERIVED INTERNALLY (never passed in)** + the entropy buffer zeroed; **R2c-4b words-import** — `entropyFromWords(VECTOR_WORDS)` wrapped as 'nip06-entropy' and **nostrPubkey === getPublicKey(skFromWords(VECTOR_WORDS))** (⚠ wrapping entropy instead of the sk did NOT change who we signed in as) + buffer zeroed; **the asymmetry** — an nsec import (no `payloadKind`) still wraps 'sk'
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
- `src/lib/nostr/__tests__/sync.test.ts` — settings watermarks + settings-dirty receive gate, records merge-apply (legacy array + v2 payload), relay-behind dirty flag, **fetchAndSync `{ok, planFound}`** (R2b-2: decrypt failure + events present → `{ok:false, planFound:true}` — an unreachable signer must never claim "no plan found"; empty relay → `{ok:true, planFound:false}`; a d-tag-less event doesn't count as a plan), publishEncrypted first-ACK. P3: a records payload carrying dayLog/dayLogDeletions → setDayLog/setDeletedDayEvents called with the merged values; a legacy payload without dayLog hydrates safely (defaults []/{}, no throw). Seed-clobber Fix B: the FIRST pull (`!initialSettingsPullDone`) hydrates real remote settings even when `settingsDirty` is spuriously true (the fixture default is `initialSettingsPullDone: true` = established session)
- `src/store/__tests__/viewerSnapshot.test.ts` — viewer snapshot builders. **⚠ Carries the EXHAUSTIVE trusted-settings key-set assertion (`Object.keys(snap.settings).sort()` vs a 33-key literal) — brittle BY DESIGN.** The sibling deep-equal test is only DIFFERENTIAL (it derives its expectation from `buildSettingsPayload`), so a newly-synced field would leak into every trusted viewer's snapshot and still pass; the exhaustive set is the backstop. Adding a synced setting must be a conscious decision to EXPOSE (add the key here) or to STRIP (add it to `buildViewerSnapshotPayload`'s destructure) — never paste the key in to make the test green. Also: R2a-1 `backupVerifiedAt` is the 4th stripped key; `keyProvenance` is device-local (absent from the payload and BOTH tiers). Plus: owner viewer-config (viewerNpub/Pubkey/Label) IN buildSettingsPayload but STRIPPED from snapshot.settings (+nostrRelays); the Option-B shape (settings+records+strike+**cbCollateralBtc** P3 + **strikeCollateralBtc** C-P4); **P3 BUG2** — snap.cbCollateralBtc === deriveCbCollateral(dayLog,cache) (newest reading, not the cache); **C-P4** — snap.strikeCollateralBtc === deriveStrikeCollateral(dayLog,cache) (the reading, not the cache) + the SAFE payload's Object.keys excludes BOTH scalars; snap.records has entries+deletions but NOT dayLog; viewer-side fields device-local
- `src/lib/nostr/__tests__/viewerSync.test.ts` — P3/C-P4 viewer hydrate (mocked SimplePool + NSecSigner decrypt + store getState/setState): **BUG3** — a snapshot raw-sets cbCollateralBtc + strikeCollateralBtc (C-P4) AND leaves dayLog empty + NEVER calls setCbCollateralBtc (no spurious reading injected into the viewer's journal); a pre-P3/pre-C-P4 snapshot without the scalars keeps the existing values (?? fallback); a revoked snapshot → clearViewerData, neither scalar applied
- `src/lib/nostr/__tests__/log.test.ts` — nostrLog ring: 50-cap, newest-last, clear
- `src/lib/nostr/__tests__/deviceTag.test.ts` — stable persisted tag, 'anon' fallback, platform label prefix
- `src/lib/nostr/__tests__/liveSync.test.ts` — singleton: double open → one sub, close+reopen, no-pubkey guard
- `src/lib/nostr/__tests__/session.test.ts` — `waitForNostrExtension` (the async-injection-race fix): already-present → true immediately; injected mid-poll (fake timers) → true; absent through the timeout → false
- `src/lib/nostr/__tests__/restoreSignerSingleFlight.test.ts` — `restoreSigner` single-flight (Bug 2): two concurrent calls share ONE ceremony (`unwrapSecretKey` invoked once) + resolve to the SAME signer (stub NSecSigner + mocked unwrapSecretKey, no real crypto); a later non-concurrent call runs the worker again (guard cleared on settle); + #5 live-method re-verify: a method flipped to 'nip46' between the entry destructure and the pre-unwrap guard (counter-backed getter on a `getState` spy) bails BEFORE `unwrapSecretKey` (no spurious passkey) and returns the current signer. **P0 pin-forwarding + the pin-aware guard** (5 cases, a deferred `unwrapSecretKey` impl holds a call genuinely in-flight; `beforeEach` re-installs the default impl since `mockClear` keeps the old one): a supplied pin reaches `unwrapSecretKey(ct, meta, '1234')`; no pin → `undefined` (the PRF path is byte-identical); ⭐ **a pin-bearing call does NOT join a pinless in-flight restore** (two workers — it would otherwise inherit the doomed promise's failure and report a wrong PIN); a pinless call DOES join a pinned one (one ceremony, same signer); two pinless PRF callers still share ONE ceremony

When `BlocYearOneInputs` gains new required fields, add defaults (e.g. `btcGrowthRate: 0`) to any test fixtures.

---

## Build & Deploy

```bash
npm run build && npx vitest run && git add . && git commit -m "..." && git push   # Vercel auto-deploys on push (local vercel CLI removed)
```

`npm run build` = `tsc -b && vite build` — this is the REAL typecheck gate. Run it (not bare `tsc`) before every commit.

**⚠️ Store-version bump discipline:** the store version is now the **single constant `CURRENT_STORE_VERSION`** in `src/lib/storeVersion.ts` (zero-import leaf) — it drives the `useStore` persist `version`, `exportPlan.ts`'s `storeVersion`, `demoSeed.ts`'s `DEMO_SEED_STORE_VERSION`, and `validatePlanBackup.ts`'s version gate. A `migrateState` bump therefore means: **bump `CURRENT_STORE_VERSION` + the standalone `STORE_VERSION` literal in `e2e/helpers.ts`** (Playwright can't resolve `src/` imports, so e2e keeps its own pinned copy). A stale `STORE_VERSION` drops the e2e seed into the migrate/onboarding path and `seedAndGoto`'s landing assertion fails loudly. `validatePlanBackup` lean-rejects any backup whose `storeVersion !== CURRENT_STORE_VERSION`, so a version bump makes older exports un-restorable until 4f schema negotiation.

**E2E gesture harness (Playwright, `npm run e2e`) — the app's first e2e layer, opt-in, NOT in `vitest`.**
`@playwright/test` (chromium only) + `playwright.config.ts` (mobile-emulated 390×844, `hasTouch`/`isMobile`,
`serviceWorkers:'block'`, **`workers:1`/`fullyParallel:false`** — gesture/rAF/spring timing flakes under
parallel CPU contention; run serially. **`retries:1`** (2 in CI) — the drag→commit→exit-timing sheet specs are
inherently timing-sensitive under full-suite load and occasionally flake (each passes deterministically in
isolation); a single retry absorbs it without masking a real break) + `e2e/*.spec.ts` + `e2e/helpers.ts`. `vite.config.ts` `test.exclude:
['e2e/**', …]` keeps `vitest run` from collecting the `.spec.ts` files (vitest's default include globs
`*.spec.ts`). **Reach:** the dev server bypasses every auth/viewer gate via `import.meta.env.DEV`, so a
3-field `addInitScript` localStorage seed (`onboardingComplete/simpleMode/simpleView:'daily'` + the
`personal-bloc-onboarded` GATE key + `window.__APP_BOOTED=true` to suppress index.html's 6s boot-watchdog
overlay) lands on DailyModeView; the FAB (`getByLabel('Log an event')`) opens EventSheet, a seeded `dayLog`
draw event + `data-testid="log-row"` tap opens EDIT mode, `getByLabel('Almanac')` → the live-height badge
opens the consent sheet. Gestures drive `page.mouse` (real pointer events, capture-capable) from the grabber.
**Covers:** dirty-guard (clean flick-dismiss + `data-dirty`, cap-no-dismiss after a keystroke), keyboard
guard (zero movement while focused), scroll coexistence (scrolled → drag blocked), reduced-motion (no
continuous transform, still dismisses), P1.2 Bug E (sheet computed-opacity stays '1' mid-drag while the
`sheet-backdrop` fades), P1.2 Bug D (downward drag from a mid-content field label dismisses), P1.3 focus-then-
drag (a focused field + press elsewhere → blur + drag + dismiss; H1) + keyboard guard (press the focused field
itself → no drag). **P2 `journal.spec.ts`:** calendar month swipe pages (multi-month seed) + boundary rubber-band;
long-press (600ms) opens the pre-dated add sheet + short-press just selects; swipe-to-delete reveal → tap DELETE →
Snackbar → UNDO restores; one-open-row (`data-open`); ⭐ a fast flick NEVER deletes (non-negotiable 1). Selectors:
`data-testid="day-cell"`/`data-date` (the visible CENTER pane is filtered by viewport-x since the SwipeStrip
renders 3 panes), `event-row`/`swipe-delete-btn`; a month-scope cell needs `scrollIntoViewIfNeeded` (below the
fold); the double-buffered snap needs retrying label assertions. **P3 `navigation.spec.ts`:** edge-swipe-back from
Settings returns to the journal (drag from x=8 past 50% width); a mid-page drag (x=60) does NOT back-nav; TAP
FORWARDING (a tap over the zone at the ← Back button's 16–20px overlap forwards + navigates — the left 20px isn't
dead); gate exclusion (the journal never mounts `data-testid="edge-back-zone"`; gates are dev-bypass-unreachable so
the component-level grep covers them). **Almanac (face nav is TAP-ONLY — the pager was removed):** tapping the
`Cycle Clock` pill switches face, asserted via `Open Halving Clock` at count **1** (⚠ NOT `Next halving`, which
CycleClock's demoted halving card also carries — the Cycle-only string at count 1 is what proves exactly ONE
mounted face, no neighbour panes); a committed mid-screen horizontal drag does NOT change face (the pager-removal
regression pin); gated-face skip (`!hasCbLoan` → no defense pill after tapping every visible pill); a chart scrub
stays on the Power Law face — the PowerLaw face's `/api/blockchain.info` route is `page.route`-fulfilled with valid
data so the chart renders, since PowerLawMain gates it on `!loading && !error`; edge-swipe back still works on
Almanac. **P3.1 additions:** NESTED edge-back (open a Settings subpage → one edge-back lands on the LIST [subpage
`← Settings` gone, the row back], a second → journal — **run against HEAD first, it FAILS**, proving the repro); the
chart scrub also asserts `document.scrollingElement.scrollTop` is unchanged — ⚠ that half passes TRIVIALLY in
Chromium since synthetic `page.mouse` can't drive native touch-scroll; kept as an intent marker, the real proof is
the device gate. Helper `mouseDragX(...,{release?})` drives raw `page.mouse` from a coordinate. (`faceHostBox` was
deleted with the pager.) **CANNOT cover** (→ the iOS device gate stays MANDATORY): real WebKit system haptics (iOS
has NO programmatic path — `hapticsSupport()` is `'none'` there); the P1.3 **scroll/drag handoff** (`scroll
coexistence` + `jitter handoff` are `test.fixme` device-gated) — it needs real touch + native scroll +
`pointercancel` coordination, and synthetic touch drives no pointer pipeline / starts no native scroll, so the
claim RULE is unit-tested (`resolveScrollClaim`) instead; the iOS blur-races-pointerdown timing; the
standalone-PWA container; true 60fps.

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
default `'dashboard'` — Owner IA dashboard-first; migrate-default only), `pinnedScenario` (Phase 3a Scenario
Diff/Pin — the pinned safety posture `PinnedScenario | null`, default null; plain-`set` setter, no sync;
merge-default so a pin survives reload), `viewerDisplayName` (Viewer V3 — the viewer's greeting name, default
null; cleared on `resetViewerSession`), `planEvents`/`planDirty`/`lastPlanEventsSyncAt`/`prefsDirty`/
`lastPrefsSyncAt` (Phase 4c plan-events channel — the append-only `PlanEvent[]` log + its publish-needed/watermark
flags; default `[]`/`false`/`null`/`false`/`null`; raw setters, merge-default, NO bump; the log is the plan
partition's source of truth, published on `plan-events:v1`, NEVER a synced setting), `lastV1FallbackApplyAt`
(Phase 4d — v1-fallback soak telemetry, unix seconds; stamped when an EMPTY-log device applies plan fields
from `settings:v1` [the migration window]; default null, raw setter, merge-default, NO bump; drives the 4e
fence — see § the Phase 4 campaign), `keyProvenance` (R2a-1 backup gate — `'generated'|'imported'|'external'|null`,
default null; **WRITE-ONCE** with `null` as the explicit identity-teardown clear; cleared by `disconnectNostr` +
"Remove local key" + `gateHydratedIdentity`'s signed-out branch. R2c-6-final: **also STANDALONE-backed** in
localStorage `personal-bloc-provenance` — seeded at module init, write-through in the setter, read authoritatively by
`gateHydratedIdentity` — so it survives the escape hatch [`resetAndResync` nukes the blob but keeps GATE keys]; wiped
by `wipeLocalPlanData`. Its partner `backupVerifiedAt` is the exception that IS synced [needs NO standalone key — a
verified key re-hydrates it from the relay on the post-reset pull] — see § Backup Gate / § Remanence),
`writerKeyWrapped`/`writerKeyWrapMeta` (the writer
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
`nostrSyncing`/`sandboxCollateralBtc`/`viewerUnlocked`/`viewerDataLoaded`/`storeUnlocked`/`remotePlanFound`/
`backupNagDismissed` (R2c-2 — the dashboard backup-nag's session dismissal; single-writer, NO module latch;
resets each boot so the nag returns while the gate is unsatisfied — that's the escalation ladder)).
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

## "No plan found on this key" — `remotePlanFound` (R2b-2; no store version bump)

Sign in with a key that has nothing published under it and the app used to render a **seed-default dashboard
with no explanation** — the user could not tell "my plan failed to load" from "this key has no plan yet." The
entry fork now *promises* "we'll load your plan, or start fresh on your key"; this is the code that keeps the
second half of that promise honest.

- **`fetchAndSync` → `{ ok, planFound }`** (was a bare boolean; its 3 test assertions + `syncNow.ts` updated).
  `planFound = latestByDTag.size > 0`, computed **before** the decrypt loop from a map whose keys can only be the
  two owner d-tags. So it survives `ok: false` — ⚠ **an unreachable signer must NEVER be reported as "no plan
  found"** (pinned by a test: decrypt failure + events present → `{ ok: false, planFound: true }`). A d-tag-less
  event doesn't count either (the build loop `continue`s past it). Decrypt/apply semantics are untouched.
- **Store `remotePlanFound: boolean | null`** — SESSION-TRANSIENT (in `partializeState`'s omit destructure,
  pinned by a test; never in `buildSettingsPayload`/`SETTINGS_FIELDS`/either snapshot). `null` = not yet
  determined **or** dismissed.
  - `recordRemotePlanFound(v)` — syncNow's first-pull write. **LATCHED** by a module-level
    `remotePlanFoundResolved` (beside the debounce timers), so it fires exactly once per session.
  - `setRemotePlanFound(v)` — the notice's **Dismiss** (`→ null`). Deliberately does **not** unlatch.
- **⚠ Why a latch and not a bare `=== null` check.** Dismiss writes `null`, so a bare null-guard would let the
  **next foreground `syncNow`** re-write `false` and resurrect the banner. The latch makes "syncNow sets it
  exactly once per session" and "the notice is one-time" true simultaneously: on the first pull the field *is*
  null, so both conditions agree; afterwards only the latch holds.
- **Dismissal is per-session by design** — the field is transient and the latch is module-scoped, so a **reload
  on a still-empty plan may re-show the notice; the user's first edit ends it permanently** (the settings
  publish means the next pull sees `planFound: true`).
- **Never touched by viewers or gated keys.** A `viewerMode` install never reaches `doSyncNow` (`useNostrSync`'s
  effect early-returns and `triggerSync` no-ops); a backup-gated generated key returns at `syncNow.ts`'s gate
  before `fetchAndSync`. `clearViewerData` deliberately does not reset it.
- **`components/Entry/NoPlanNotice.tsx`** (+ `.module.css`) — self-gating: renders `null` unless
  `remotePlanFound === false && keyProvenance !== 'generated'` (a freshly generated key obviously has no plan;
  the notice would be noise — and it's gated out of syncNow anyway, so the field stays `null` for it). Copy:
  *"No plan found on this key — starting fresh. Your first edits will create it."* Visual language clones
  `SimpleModeView`'s `.reanchorBanner` (the app's only other dismissible banner); a text **Dismiss**, not a ✕
  (no ✕-dismiss precedent exists).
- **⚠ OWNER-ONLY BY CONSTRUCTION.** `ViewerHomeView` gains `notice?: ReactNode`, rendered `{ownerNav && notice}`
  after `</header>`. `AppShell`'s `simpleView === 'dashboard'` arm of `renderOwnerJournal()` is the **only** call
  site that passes it, and it sits after gates D/E/F (`isAuthenticated && isOwner` guaranteed). The real viewer,
  the edge-back under-layer, and `ViewerPreview` pass neither `ownerNav` nor `notice` → the notice cannot leak
  into a viewer surface or corrupt Preview-as-viewer fidelity. **Never add a branch to AppShell's gate ternary**
  — anything there replaces the whole app. Accepted scope: an owner on Journal or in full mode sees it on their
  next Dashboard visit (Dashboard is the default `simpleView`, so a fresh sign-in lands there).

---

## Recovery-key payload kinds (R2a-2 — `payloadKind` + NIP-06 derivation; no store change)

R2a-1 made the backup gate real, but the artifact the owner must back up is a raw 32-byte secp256k1 key rendered
as a bech32 `nsec`. An nsec can't be verified by a word quiz, can't be written down reliably, and can't be
re-typed. **R2c's ceremony needs BIP-39 words.** R2a-2 lays the crypto foundation and nothing else:
`src/lib/nostr/nip06Key.ts` (pure NIP-06 derivation) + a `payloadKind` discriminator on the wrap meta, so a
wrapped blob can hold either the raw key or the **128-bit entropy those words encode**.

**Entropy adoption — R2b-1 (done):** `OwnerKeySetup` K1 now mints via `generatePlanKey()` and K3 wraps the
entropy as `payloadKind: 'nip06-entropy'` (the first non-test consumer of `generatePlanKey`). **R2c-4b extended
this to the words IMPORT path** — `NostrAuthGate` passes `'nip06-entropy'` for a 12-word import and `'sk'` for an
nsec import (see the asymmetry row in Critical Constraints; this SUPERSEDES R2b-2's "imported keys still wrap
`'sk'`"). Every existing wrapped key keeps working byte-identically (absent `payloadKind` ⇒ `'sk'`), so users who
imported words *before* R2c-4b keep their `'sk'` ciphertext — there is **no migration** (it would need their
phrase). `restoreSigner`/`unwrapSecretKey` already handle both branches. `RevealRecoveryKey` (since R2c-1) calls
`unwrapRecoveryPayload` and re-displays the **words** for any `'nip06-entropy'` key — which, post-4b, includes
freshly imported phrases.

### ⚠ THE COMPATIBILITY CONTRACT: absent `payloadKind` means `'sk'`

`WrapMeta.payloadKind?: 'sk' | 'nip06-entropy'` is **optional forever**. Every key wrapped before R2a-2 — writer
*and* viewer, on every device already in the field — has meta with no such key, JSON round-tripped through an
unvalidated `as WrapMeta` cast (`useStore`'s standalone `WK_META_KEY`, and the persist blob for the viewer). So
absence is their normal, permanent state. **Never make it required. Never infer the kind from the payload's byte
length.** The rule is stated at the type AND mirrored at the unwrap read site.

The unwrap branch tests **`!== 'nip06-entropy'`**, not `=== 'sk'`, deliberately: absent, `'sk'`, and any future
unknown kind all fall through the legacy path unchanged, so a wrapped key can never become unreadable by a
version skew. (Pinned by a test that unwraps a meta carrying a made-up future kind.)

### keyVault surface

- **`wrapSecretKey(payload, method, pin?, label?, payloadKind = 'sk')`** — first param renamed `payload` (it may
  now be 16-byte entropy). The kind is **recorded on every wrap**, including `'sk'`. It is a *defaulted 5th
  positional*, not an options-object refactor: `establishOwner.test.ts` asserts `toHaveBeenCalledWith(...)` with
  **exact arity 4**, and the 4-arg call sites are out of scope here. (An options-object cleanup belongs with R2b,
  which touches those call sites anyway.)
- **`decryptWrapped(ciphertext, meta, pin?)`** (private) — the pre-R2a-2 `unwrapSecretKey` body extracted
  **verbatim** (malformed-meta guard → PIN/PRF IKM → HKDF → AES-GCM → `new Uint8Array(pt)`). Both public readers
  share it, so they can never drift and a read costs **one** Face ID prompt / one PBKDF2 run.
- **`unwrapSecretKey` — RETURN CONTRACT UNCHANGED: it ALWAYS yields the 32-byte secret key.** When the payload is
  entropy it calls `deriveSkFromEntropy` and zeroes the intermediate entropy in a `finally`. Its four call sites
  (`session.restoreSigner`, `RevealRecoveryKey`, `SharingPage`, `ViewerUnlockGate`) are untouched and must never
  be made payload-aware.
- **`unwrapRecoveryPayload(ciphertext, meta, pin?) → { payloadKind, bytes }`** (NEW) — same auth flow, returns the
  payload **as stored** (`meta.payloadKind ?? 'sk'`) so R2c can render/verify words. **Caller zeroes `bytes`.**
  ⚠ **R2c note:** a `'sk'` payload has **no words** (a raw secp key is not BIP-39-derived) — legacy keys must fall
  back to nsec display (today's `RevealRecoveryKey`), never be presented as an unverifiable phrase.

### nip06Key.ts

Path **`m/44'/1237'/0'/0/0`**, **account 0**, **no BIP-39 passphrase** — all three are `nostr-tools`
`privateKeyFromSeedWords` defaults, all three pinned by the published-vector test
(`leader monkey parrot ring guide accident before fence cannon height naive bean` → sk `7f7ff03d…ba9a`, pubkey
`17162c…cd917`, `nsec10allq0…`; the pubkey is cross-confirmed by decoding the spec's own npub). ⚠ **Treat a
failure of that test as data loss, not a stale fixture** — it would mean every recovery phrase ever written down
now derives a different key. (The commonly-quoted *second* NIP-06 vector does **not** reproduce against this
library and is deliberately not pinned.)

`validateWords` → `@scure/bip39`'s `validateMnemonic`, which **returns `false` rather than throwing**, so
`skFromWords` checks explicitly and raises `InvalidSeedWordsError` — the repo's **first `Error` subclass**
(everything else throws a bare `new Error`, discriminated at most by substring). The UI catch blocks do
`setError(e.message)`, so its message is user-facing prose and must never interpolate the words.

**Import direction `keyVault → nip06Key → nostr-tools`; nip06Key never imports keyVault.** The import is
**static, deliberately**: `keyVault` is already in the main chunk (`storeCrypto → useStore`), R2b/R2c pull
nip06Key into onboarding anyway, and the SW precaches the full build — so a lazy chunk would buy nothing while
adding an async boundary inside the Face-ID unlock path. **Measured cost: +14.2 kB gz on the main chunk**
(413.4 → 427.6), dominated by `@scure/bip32`'s HDKey/curve math — unavoidable, since NIP-06 *is* BIP-32.

---

## Backup Gate (R2a-1 — store plumbing + sync-engine gating; store stays v21, NO bump)

A key this device **generated** is the only copy of the plan until the user proves they saved it. Relays hold
ciphertext, so a lost sole key is permanently unrecoverable data. Before R2a-1 the only "I saved it" signals
were two **ephemeral `useState` booleans** (`OwnerKeySetup.tsx` `ack`, `NostrAuthGate.tsx` `backupConfirmed`)
that died on unmount — `keyVault.ts` already stated the unenforced contract: *"the caller enforces the backup
gate."* R2a-1 makes it real at the data layer. **No verification UI ships here** (that is R2c).

- **`src/lib/backupGate.ts`** (PURE, ZERO imports → no cycle) — the single predicate:
  `isBackupGateSatisfied({ keyProvenance, backupVerifiedAt }) = keyProvenance !== 'generated' || backupVerifiedAt != null`.
  (`!= null`, not truthiness — a `backupVerifiedAt` of `0` counts as verified.)
- **`KeyProvenance = 'generated' | 'imported' | 'external'`** — how *this device's* identity was established.
  `'imported'` (pasted nsec) and `'external'` (NIP-07 extension / NIP-46 remote signer) mean the user already
  holds the key elsewhere → **never gated**.
- **⚠ STRUCTURAL GRANDFATHERING — `keyProvenance: null` = a plan established before R2 = satisfied. There is
  DELIBERATELY NO MIGRATION and no store version bump.** The custom persist `merge`
  (`{ ...current, ...gateHydratedIdentity(persisted, …) }`) fills the absent key from `current` (= `null`) on
  every rehydrate, for every existing user. Adding a `migrateState` case would be the only way to get this wrong.
  `exportPlan.ts`'s hand-copied `storeVersion: 21` therefore stays correct.

### Store fields

| Field | Persist | Sync | Notes |
|---|---|---|---|
| `keyProvenance: KeyProvenance \| null` | ✅ (rides `partializeState`'s `...rest`) | ❌ **never** | Absent from `buildSettingsPayload` — an ALLOWLIST, so it's absent from both snapshot tiers + the plan backup for free. **WRITE-ONCE.** |
| `backupVerifiedAt: number \| null` | ✅ | ✅ (`buildSettingsPayload` + `SETTINGS_FIELDS`, 36→**37**) | The attestation travels with the plan. **ONE-WAY LATCH** on hydrate. STRIPPED from the trusted viewer snapshot (4th strip key). ⚠ It does NOT un-gate a gated peer — see below. |

- **`setKeyProvenance(p)` — write-once, `null` is an explicit CLEAR.** A *different* non-null over a non-null is
  ignored (+`console.warn`); the SAME value is a silent no-op (an establish retry must not warn). The `null`
  write is **identity teardown**: without it, `generate → never verify → disconnect → import a different nsec`
  would leave `'generated'` frozen with `backupVerifiedAt: null` → **sync permanently gated with no UI to fix
  it**. Provenance is identity-scoped, so it dies with the identity.
  - `disconnectNostr()` + SettingsMain **"Remove local key"** → clear BOTH.
  - `reconnectNostr()` + `escapeHatch.resetAndResync()` **RETAIN** the identity → deliberately do NOT clear.
  - **`gateHydratedIdentity` nulls both on the signed-out branch** (no `GATE_PUBKEY_KEY`). Same authority rule as
    the identity fields, and for the same reason: disconnect's persist-blob write isn't guaranteed to land before
    `reload()`, so a stale `'generated'` in the blob could re-gate a device that has since imported a key.
- **`setBackupVerifiedAt(ts, nostr?)`** — stamping OPENS the gate, so it must also **wake the engine**:
  (a) `set` the field, (b) **if authenticated**, mark `settingsDirty` **DIRECTLY** — `syncSettingsToNostr`
  early-returns on `!initialSettingsPullDone`, which is still `false` *precisely because the gate held `syncNow`
  off all session* — and (c) run the SAME initial-pull-then-publish sequence a fresh authentication runs:
  `syncNow` (cf. `establishOwner.ts`). **No second wake mechanism.** ⚠ **ORDER: `set()` FIRST**, so the gate
  reads satisfied inside `doSyncNow`'s and the publish guards' `useStore.getState()` reads. `syncNow` is
  **dynamic-imported** (cycle-safe, mirroring `publishSettingsNow`'s `publish.ts` import) and `.catch`-logged.
  `nostr` is optional (tests assert state without a signer; `OwnerKeySetup` relies on `establishLocalOwner`'s own
  internal `syncNow` as the wake). `ts === null` is the teardown clear: no dirty, no wake.
- **⚠ THE PRE-AUTH GUARD IS LOAD-BEARING (seed-clobber, Fix C).** `settingsDirty` is **persisted** (rides
  `partializeState`'s `...rest`), and `doSyncNow` flips `initialSettingsPullDone(true)` **before** its
  publish-if-dirty step — so **Fix D's seed-guard is structurally unreachable from inside `syncNow`**, and Fix C
  ("nothing may dirty pre-pull") is the ONLY thing protecting the first sync. The K2 bridge calls
  `setBackupVerifiedAt` on an **unauthenticated, untouched-SEED store**. Dirtying there would (a) publish the
  seed as the owner's first settings event before the numbers wizard runs — breaking Phase 1.5's stated
  invariant *"nothing publishes (not dirty; Fix D refuses seed defaults)"* — and (b) if the establish then
  **throws** (Face ID cancelled), persist `settingsDirty: true` into a later **real** login, publishing the seed
  payload over the owner's real relay settings under whole-object LWW. So pre-auth only the field is set; it
  rides the wizard's first genuine settings publish (it's in `buildSettingsPayload`).
- **Establish-failure ROLLBACK.** Every stamp lands *before* the establish (which owns the wake), and
  `setKeyProvenance` is write-once — so a throw would freeze `'generated'` for a key that never existed,
  silently rejecting the later correct `'imported'`/`'external'` stamp, and leave a false backup attestation.
  `OwnerKeySetup.handleProtect`'s catch clears **both**; `NostrAuthGate.handleLocal`'s catch clears provenance.
- **Edits made while gated are NOT lost.** `syncSettingsToNostr` is gated → they never mark dirty, but they still
  persist locally. On verification, `publishSettingsNow` builds the payload from **current state**, so everything
  ships. A generated-unverified key is by definition a brand-new plan with no peer device.
- **`backupVerifiedAt` does NOT un-gate a peer.** A gated device runs **no sync at all, not even a pull**, so it
  can never *receive* the field. It needn't: only the sole **generating** device is ever gated, and no other
  device can hold `'generated'` for the same key (importing that nsec yields `'imported'`). The field is synced
  so the attestation travels with the plan and imported/external peers can see it — not as an un-gate channel.

### Hydrate skip-guard — the one-way latch

`hydrateSettings`' whitelist applies any value `!== undefined`, so a `null` **hydrates**. The device that
publishes an explicit `null` is a **new-bundle peer** that is legacy (`keyProvenance: null` → gate satisfied →
syncs freely) or not-yet-verified; it would clobber a verified device's timestamp and **re-gate it**. A *stale
pre-R2 bundle* omits the field entirely (`undefined` → the whitelist skips it) and is already safe. Guard: an
incoming `null` never overwrites a non-null local value. **Third member of the whole-object-LWW skip-guard
class** (`nostrRelays`, `viewers`, this) — the entire class is scheduled for **structural deletion at Phase 4e**,
when settings move to plan-events and absent vs null vs set become first-class in the fold.

### Gated engine entry points (the predicate is added to the EXISTING guard, never deeper)

`isBackupGateSatisfied(...)` is consulted at exactly the layer `isAuthenticated` already is. One predicate,
11 sites:

| File | Guard |
|---|---|
| `useStore.ts` | `publishRecordsNowImmediate` (also the `viewerMode` backstop) |
| `useStore.ts` | `publishSettingsNow` (bails BEFORE `setNostrSyncing` / the seed-guard) |
| `useStore.ts` | `publishRelayListToNip65` |
| `useStore.ts` | `publishViewerSnapshotNow` |
| `useStore.ts` | `publishViewerRevocationNow` |
| `useStore.ts` | `syncSettingsToNostr` (the mark-dirty trigger) |
| `syncNow.ts` | `doSyncNow` — a gated key runs **no sync at all, not even a pull** (a pull sets `initialSettingsPullDone`, which would re-arm publishing) |
| `liveSync.ts` | `openLiveSync` |
| `useNostrSync.ts` | `scheduleDirtyRetry` (`args.backupGateOk`) |
| `useNostrSync.ts` | `triggerSync` (live `getState()` read, mirroring `viewerMode`) |
| `useNostrSync.ts` | the orchestration effect |

- **`useNostrSync` SUBSCRIBES both fields** (`useStore((s) => s.keyProvenance)` etc.) and adds the derived
  `backupGateOk` to **both effects' dep arrays** — otherwise a verification flip wouldn't re-run them and the
  live sub would never open.
- `publishRecordsNow` (the 400ms debounce) has no guard of its own — covered at fire time by
  `publishRecordsNowImmediate`. `importRelaysFromNip65` is a **read**, not a publish → **not gated**.
  `useNostrAutoRestore` calls `syncNow` → covered transitively.
- **NEVER consulted on viewer paths**: `viewerSync.ts` publishes nothing, and every owner publish path already
  fails its `viewerMode`/auth guard before the predicate is reached. A viewer's `keyProvenance` is `null` anyway.

### Provenance is stamped BEFORE establishment (load-bearing)

`establishLocalOwner()` calls `syncNow(nostr)` **internally**, and the three `NostrAuthGate` handlers call it
*before* `setIsAuthenticated(true)`. A provenance write placed **after** would let a generated key's very first
sync publish ungated. `establishLocalOwner` itself is untouched — it is shared verbatim by the generated and
imported paths and cannot distinguish them, so every **call site** stamps first:

| Site | Stamp |
|---|---|
| `OwnerKeySetup.handleProtect` (before `establishLocalOwner`) | `'generated'` **+ the interim K2 bridge** |
| `NostrAuthGate.handleLocal` (paste-nsec import, before `establishLocalOwner`) | `'imported'` |
| `NostrAuthGate.handleNip07` / `handleNip46` / the nostrconnect effect (each before its `syncNow`) | `'external'` |

Not stamped: `handleUnlockExisting`, `LocalUnlockGate`, `useNostrAutoRestore` (returning users — provenance is
already set, or legacy `null`), and viewer establishment (`ViewerLoginFlow`).

### ✅ RETIRED — the K2 verification bridge (R2a-1 → R2c-4a)

**HISTORICAL.** R2a-1 shipped the gate but no verification ceremony, so `OwnerKeySetup` K2's mandatory "I saved
it" ack was wired to stamp `setBackupVerifiedAt(Date.now())` beside `setKeyProvenance('generated')` — an interim
bridge so no new-plan user regressed. **R2c-4a DELETED that stamp.** An ack is a promise, not a verification.

**Current behavior:** a freshly generated key enters **`generated` + UNVERIFIED**, so R2a-1's 11 gate sites hold
sync/publish off (no settings/records publish, no relay sync, no viewer snapshot) until the user completes the
**R2c-1 ceremony** (`RecoveryKeyCeremony`, reveal → word-quiz → `setBackupVerifiedAt`), which is now the **SOLE**
opener of the gate. The **R2c-2 ladder** (⚙ badge → dashboard nag → Sharing/Network interstitial) is what makes
that path discoverable. `OwnerKeySetup` still stamps provenance only, still BEFORE `establishLocalOwner` (whose
internal `syncNow` is the wake); its catch-block still clears both (provenance because `setKeyProvenance` is
WRITE-ONCE; `backupVerifiedAt` as belt-and-braces against a stray prior-session stamp).

⚠ **`backupGate.test.ts`'s "K2 bridge" test never actually pinned the bridge** — it drives the store setters
directly and never reads `OwnerKeySetup`'s source, so it stayed green through the retirement. Its old comment
claimed otherwise; R2c-4a re-labeled it (`'the ceremony stamp pair … leaves the gate SATISFIED'`) and re-labeled
the pre-auth-stamp test as **defensive** (no caller stamps pre-auth now). The pure-predicate case
`'generated' + no verification → NOT satisfied` (`src/lib/__tests__/backupGate.test.ts`) now describes
**production reality**, not a hypothetical.

### ⚠ TWO KNOWN GATE-BYPASSES — NOW LIVE (R2c-4a made the gate load-bearing); close in R2c-4b

Both were harmless while the K2 bridge stamped `backupVerifiedAt` (the gate was always satisfied for a generated
key). **R2c-4a removed that stamp, so these are now real one-tap bypasses.** Close them in R2c-4b.

1. **Escape hatch erases the gate state.** `escapeHatch.resetAndResync()` → `clearStoreEncryptionState()` →
   `localStorage.removeItem('personal-bloc-store')`. `keyProvenance` and `backupVerifiedAt` ride that blob
   (`partializeState`'s `...rest`), while the identity survives in the standalone `GATE_*` keys. So after the
   escape hatch the device returns as `keyProvenance: null` → grandfathered → **gate silently disabled forever**
   (nothing re-stamps: `handleUnlockExisting` never calls `setKeyProvenance`). This also makes `disconnect.ts`'s
   comment (*"resetAndResync … deliberately do NOT clear these"*) factually wrong. **Fix:** persist the pair in
   standalone localStorage keys, seeded at module init + write-through in the setters — the exact
   `writerKeyWrapped` / `GATE_METHOD_KEY` precedent. Both must move together: keeping only `keyProvenance`
   outside the blob would strand a generated device at `'generated'` + `null` with the pull gated off → lockout.
2. **Disconnect → "Unlock with Face ID" launders provenance.** `disconnectNostr()` clears the pair but
   **retains `writerKeyWrapped`**; `NostrAuthGate.handleUnlockExisting` then re-establishes the SAME
   never-backed-up generated key via `restoreSigner` and stamps nothing → `keyProvenance: null` → satisfied.
   **Fix:** scope provenance to the **key material**, not the session — retain it across `disconnectNostr`
   (only "Remove local key", which deletes `writerKeyWrapped`, should clear it) and make the establishment call
   sites clear-then-stamp, since `establishLocalOwner` *replaces* the key material. That reordering is what makes
   the retain safe (it is the write-once escape the teardown clear currently provides).

---

## Backup Gate Escalation Ladder (R2c-2 — badge → nag → hard gate; store stays v21, NO bump)

R2c-1 shipped the real ceremony (`RecoveryKeyCeremony`) but a generated-unverified owner has no prompt to open
it. R2c-2 adds a **three-rung escalation ladder** so the owner is guided to back up their key with rising
urgency. All three rungs read ONE predicate — `!isBackupGateSatisfied({ keyProvenance, backupVerifiedAt })`
(imported from `src/lib/backupGate.ts`, never re-derived) — and are **owner-only by construction** (a viewer's
`keyProvenance` is null → gate satisfied; and none of the mount points render for a viewer). On ceremony success
the gate flips satisfied and **every rung self-clears reactively** (all subscribe the two fields) — NO imperative
cleanup. Additive UI + one transient store field; the gate plumbing / ceremony internals / `OwnerKeySetup`
(bridge = R2c-3) / viewer components are untouched.

| Rung | Surface | Condition | Copy / action |
|---|---|---|---|
| **1 — Badge** (ambient) | Amber `.badgeDot` on the Settings ⚙: simple-mode `HeaderNavCluster` (all 3 instances — the cluster reads the gate directly) AND full-mode `BrandingDropdown` trigger (the ⚙ item lives in a collapsed portal → the dot rides the always-visible `.brandingBtn`). **R2c-5 extends this into a BREADCRUMB CHAIN** — see below | gate unsatisfied | decoration only (5-icon invariant holds) |
| **2 — Nag** (active) | `BackupNagCard` (`components/Entry/`) on **FOUR surfaces**: `ViewerHomeView`'s `notice` slot (dashboard), standalone on **both journal surfaces** (`DailyModeView` + `SimpleModeView`, post-header slot before `<ViewToggle>`), and at the **top of the Settings menu** (outside `.settingsMenu`, menu-only) | `keyProvenance === 'generated'` && `!gate` && `!backupNagDismissed` — ⚠ **R2c-5b: fires PRE-LOG**, the data condition is gone | **"Your plan's key isn't backed up yet."** / "Save your Recovery Key so you never lose access to this plan — it takes a minute." + **Save it now** (opens the ceremony) + **Dismiss** (`dismissBackupNag()`, session-transient, shared across all four) |
| **3 — Hard gate** | `BackupGateInterstitial` (`components/Settings/`) replaces the Sharing + Network page bodies | gate unsatisfied | "Save your Recovery Key first" / "Sharing your plan and syncing to relays create copies only your key can open. Prove you've saved it, then this unlocks." + **Save my Recovery Key** + ghost **← Back** |

- **The shared notice slot + mutual exclusivity.** `AppShell.tsx` (dashboard arm) passes
  `notice={<><NoPlanNotice /><BackupNagCard /></>}` — the ONLY `notice` call site, owner-only (gates D/E/F
  passed). The two are **mutually exclusive by construction**: `NoPlanNotice` gates `keyProvenance !== 'generated'`,
  the nag gates `keyProvenance === 'generated'` — at most one ever renders. Both self-gate + are owner-only via
  `ViewerHomeView`'s `{ownerNav && notice}` (a viewer gets neither `ownerNav` nor `notice`).
- **R2c-5 — the nag ALSO mounts on both journal surfaces** (`DailyModeView`, `SimpleModeView`), in the
  post-header slot before `<ViewToggle>` (the structural parallel of the dashboard's post-`</header>` notice).
  `BackupNagCard` is drop-in there: it self-gates, reads the store directly (no props), and owns its own
  ceremony overlay. **Owner-only twice over:** both surfaces are reachable only via `AppShell`'s
  `renderOwnerJournal()` — the `!viewerMode` branch (Branch J / `renderSimpleUnder`'s else), *and* the card
  gates on `keyProvenance === 'generated'` (null for a viewer). **`NoPlanNotice` stays dashboard-only**, so the
  two never co-mount on the Journal (and would still be mutually exclusive if they did). **Dismiss is shared:**
  `backupNagDismissed` is session store state → dismissing on the dashboard also dismisses on the Journal for
  that session. **One nag, one dismiss** — intended.
- **The BREADCRUMB CHAIN** (⚙ nav icon → **Identity & Security** row → **Save your Recovery Key** button). Rung
  1's dot used to light with no trail; now a skipper is led all the way into the ceremony. **R2c-5b escalates
  the treatment down the chain** — an 8px dot is an *ambient* idiom (right on the nav ⚙, where there's no room
  for more) but reads as a mystery pixel on a row or a CTA:
  - **Nav ⚙** — the amber `.badgeDot` (`HeaderNavCluster` + `BrandingDropdown`), unchanged.
  - **Identity row** — `SettingsRow`'s additive `alert?: boolean` (default false → every other row
    byte-identical) now applies `.settingsRowAlert`: amber border + amber-tinted bg + a left accent via
    **`box-shadow: inset 3px 0`, NOT `border-left`** (no layout shift). The R2c-5 `.rowBadgeDot` is deleted —
    two signals for one state is noise. `alert` is **purely visual, never a behavior flag**.
  - **RECOVERY button** — `.recoveryCtaAlert` (amber border/text/tint, weight 600; **geometry unchanged so it
    doesn't jump when the gate flips**) plus an amber **`· Not backed up`** chip mirroring the green
    `· Backed up ✓` one. The two chips are **mutually exclusive by construction**
    (`backupGated ⇒ backupVerifiedAt == null`). `.btnBadgeDot` is deleted.

  `SettingsMain` **reuses its existing `backupGated`** (computed once, also feeding the Sharing/Network
  interstitials — never recomputed). All three treatments + the nag subscribe `keyProvenance` +
  `backupVerifiedAt`, so the ceremony's stamp clears every one **reactively — no imperative cleanup**.
- **⚠ THE IDENTITY ROW STAYS NAVIGATION.** Do NOT wire it to open the ceremony when gated. It opens the identity
  subpage, where reveal-key / backup-plan / reset-&-re-sync / decrypt-back all live — a gated user still needs
  every one of them, and auto-triggering on transient gate state would **silently change what the row does once
  the user verifies**. The highlight says *"the thing you want is in here"*; the button inside is the trigger.
  **The ceremony has exactly TWO triggers:** the nag's "Save it now" and RECOVERY's "Save your Recovery Key".
  (Recorded in a comment at the row so a future edit doesn't "helpfully" wire it.)
  ⚠ **The Identity row's dot also requires `nostrSigningMethod === 'local'`** so the breadcrumb never points at
  a page with no ceremony (the "Save your Recovery Key" button + `RevealRecoveryKey` render only for a local
  signer). This is **a NO-OP today and DEFENSIVE, not a live fix**: a `'generated'` key is always minted locally
  by `OwnerKeySetup` (which sets method `'local'`) and `disconnectNostr` clears provenance, so
  `backupGated ⇒ local`. It makes the "generated key on an external signer" state — which shouldn't exist —
  render correctly rather than misleadingly. **Don't delete it as dead code.**
- **R2c-5b — the nag fires PRE-LOG, and `hasLoggedData` is DELETED.** The nag used to also require
  `dayLog.length > 0 || monthlyLog.length > 0` ("something worth losing"). That was wrong: **the danger is an
  unverified generated key existing at all**, not data existing to lose — sync/publish are already gated off
  (R2a-1), so a user who walks away right after onboarding holds an unbacked-up sole key *and* a silently inert
  app. Dropping the condition orphaned `src/lib/hasLoggedData.ts` (its only production caller was the nag), so
  the module + its 4-case test were **removed** rather than kept: it was a one-line predicate, and dead code with
  a dedicated test suite reads as a live contract. (Contrast `skFromWords`, kept while orphaned because it is the
  published-vector-pinned canonical derivation.) `src/lib/__tests__/backupGate.test.ts`'s
  `'generated' + no verification → NOT satisfied` is now the **sole** pin on the nag's trigger.
- **`backupNagDismissed`** (transient store field, default false; `dismissBackupNag()` sets true). Session-only —
  in `partializeState`'s omit list, absent from `buildSettingsPayload`/`SETTINGS_FIELDS`. **Simpler than
  `remotePlanFound` — NO module latch** (single writer: the Dismiss button; nothing re-writes it mid-session), so
  it resets each boot → the nag returns next launch while unsatisfied (that reappearance IS the ladder).
- **Interstitial mount points — both at the `SettingsMain` branch boundary** (keeps `setSettingsPage('menu')` in
  scope for the ghost back; leaves `SharingPage` + the network relay content untouched; the shared `← Settings`
  sub-header stays as chrome): `sharing` (`backupGated ? <BackupGateInterstitial …/> : <SharingPage/>`) and
  `network` (a gated sibling branch; `useRelayStatus` is also gated `&& !backupGated` so no probe sockets open
  behind the interstitial). **2 mount points today**; more later (R3 link-device, paid tier). *For a
  generated-unverified key the engine is idle anyway (R2a-1), so these pages silently no-op today — the
  interstitial converts silent failure into a path forward.*
- **Ceremony-from-anywhere.** `RecoveryKeyCeremony` is self-contained (`{ onClose }`). The nag and the interstitial
  each own a LOCAL `ceremonyOpen` and render the overlay themselves — exactly as `SettingsMain` does. No lifted
  state, no cross-component navigation; the reactive self-clear (above) handles teardown.

---

## Remanence — identity-forget wipes the plan; sign-out retains it (R2c-6b; store unchanged, NO bump)

**The bug (found on device):** after a nip07 disconnect the persisted plan blob SURVIVED. `disconnectNostr` cleared
identity *fields* only; it never touched `localStorage['personal-bloc-store']`. AppShell's auth gates all condition on
`nostrAuthEnabled` → now false → the ladder falls straight through to Branch J and the **identity-less shell renders
the full hydrated plan to whoever opens the tab next**. Same hole in "Remove local key" (nulled key material +
provenance, left the blob).

**The rule.** **IDENTITY-FORGET** (`disconnectNostr`; Settings → THIS DEVICE → "Remove local key" and "Disconnect")
wipes plan-scoped storage via **`wipeLocalPlanData()`**. **SIGN-OUT** (`signOutLocal`, nip46 `reconnectNostr`) retains
it — the same user returns to the same plan behind the lock, so wiping would force a relay re-pull and lose anything
not yet synced. `resetAndResync` retains `WK_* + onboarded + GATE_*` (it nukes only the blob, via
`clearStoreEncryptionState`) and is therefore a **re-hydrate, not a forget** — that key-set difference is the whole
distinction between the two functions.

**`src/lib/store/wipeLocalPlanData.ts`** (NEW; sibling of `escapeHatch.ts` so the latter's structural "references no
publish symbol" test stays unentangled). Reuses `clearStoreEncryptionState()` (which already covers the blob + enc
flag + pending-decrypt marker + the in-memory `storeKey`) then removes the rest. **No `reload()` inside** — callers own
reload ordering (the `signOutLocal` lesson: navigation ends execution).

⚠ **THE KEY INVENTORY IS THE CONTRACT** (duplicated as the function's doc comment; `wipeLocalPlanData.test.ts` asserts
it exhaustively — a new storage key added without classifying it here fails the suite):

| Key | Store | Class |
|---|---|---|
| `personal-bloc-store` | local | PLAN — the persist blob (plaintext or `{ct,iv}`) |
| `personal-bloc-store-enc-enabled` | local | PLAN — at-rest enc flag for that blob |
| `personal-bloc-store-enc-pending-decrypt` | local | PLAN — migration marker for that blob |
| `personal-bloc-writer-key-wrapped` / `-meta` | local | PLAN — wrapped nsec + wrap meta (key material) |
| `personal-bloc-onboarded` | local | PLAN — ⚠ gates the entry fork, see below |
| `personal-bloc-nostr-pubkey` / `-auth` / `-method` | local | PLAN (identity) — also removed by the setters; wiped here too so the fn is correct STANDALONE |
| `personal-bloc-provenance` | local | PLAN (identity) — `keyProvenance` standalone (R2c-6-final; survives the escape hatch) |
| `bloc-nostr-log` | **session** | PLAN — relay/sync metadata for the departing identity |
| `bloc-device-tag` | local | **DEVICE — RETAIN** (the only retained key) |

- ⚠ **`personal-bloc-onboarded` is NOT blob-resident.** It's the standalone `GATE_ONBOARDED_KEY`, seeded into the
  store's INITIAL state at module init. **Wiping only `personal-bloc-store` leaves `onboardingComplete: true` → the
  fresh entry fork never renders** — the same bug, half-fixed. Removing it is what lands a forgotten device on
  `ChoosePathView`.
- ⚠ **Never sweep by `personal-bloc-` prefix** — `bloc-device-tag` and `bloc-nostr-log` don't carry it. A prefix sweep
  misses the log ring and tempts a "fix" that eats the device tag.
- ⚠ Not storage keys: `personal-bloc-plan-backup*` / `personal-bloc-recovery-key*` are `downloadBlob` **filenames**.
  There is **no** disclaimer/consent ack key (grep-verified — the `disclaimer` hits in `src/` are CSS class names).

**`nip07` sign-out wipes, BY DESIGN.** `signOut('nip07')` routes to `disconnectNostr` (it is the only teardown
auto-restore can't silently undo — see the Critical Constraints row), so the bottom "Sign out" now removes the plan.
That is right for the shared-desktop context an extension lives in: the data follows the identity off the device, and
one extension approval re-hydrates it from the relay. Its confirm says exactly that. `local`/`nip46` sign-out keep
their copy verbatim — neither wipes.

**Confirm copy must be true in every state.** `identityForgetConfirmMessage(kind, neverSynced)` (pure, `disconnect.ts`)
backs the two Settings confirms. `neverSynced = !isBackupGateSatisfied({ keyProvenance, backupVerifiedAt })` — imported
from `lib/backupGate`, **never re-derived** (SettingsMain reuses its existing `backupGated`). The normal branch promises
the relay copy AND warns "Any changes not yet synced will be lost"; the `neverSynced` branch **must not** promise a relay
copy at all — a `generated` key with no `backupVerifiedAt` has had all 11 R2a-1 gate sites holding sync/publish off
since minute one, so **the relay holds NOTHING** and forgetting the identity deletes the plan permanently ("⚠ This plan
has never been backed up or synced — {disconnecting | removing this key} deletes it permanently. Save your Recovery Key
first…"). Destructive-weight styling is already present: both call sites are `.nostrDisconnectBtn` (red); only
`.signOutBtn` stays neutral.

**"Remove local key" DELEGATES** (`SettingsMain`): it keeps its two local-key-specific clears
(`setWriterKeyWrapped(null)` / `setWriterKeyWrapMeta(null)`) then calls `disconnectNostr()` — which owns the identity
clears, the backup-gate clears, the wipe, and the reload. Its hand-rolled teardown sequence is gone (no duplication,
no drift), and it lands on the same fresh fork.

### R2c-6-final — two backup-gate bypasses closed + onboarding verifies by default (store unchanged, NO bump)

- **Bypass 1 (escape hatch ungated the backup gate) — CLOSED.** `resetAndResync` nukes the `personal-bloc-store` blob
  but keeps the GATE keys; `keyProvenance`/`backupVerifiedAt` lived only in that blob, so on rehydrate the persist
  `merge` refilled provenance to `null` (= legacy grandfather = satisfied) → a generated-unverified key ungated itself
  by tapping "reset & re-sync". Fix: `keyProvenance` is now **standalone-backed** via `GATE_PROVENANCE_KEY`
  (`personal-bloc-provenance`) — mirrors the GATE_* pattern (const + seed-reader IIFE + write-through in
  `setKeyProvenance` + a plaintext-blob back-fill **gated on provenance ALONE**, since the existing all-absent back-fill
  gate is skipped on every install that already has GATE keys). `gateHydratedIdentity` gains a `gateProvenance` param;
  its signed-in branch is `keyProvenance: gateProvenance ?? persisted ?? null` (standalone authoritative). ⚠ **ASYMMETRY:**
  `backupVerifiedAt` needs **no** standalone key — it's a SYNCED plan field, so a verified key re-hydrates it from the
  relay on the post-reset pull; an unverified key's `null` (empty relay) is correct. The escape-hatch confirm
  (`resetAndResyncConfirmMessage(neverSynced)`, pure in `escapeHatch.ts` — string-only, keeps the no-publish guarantee)
  warns of **permanent deletion** for a never-synced key at both call sites (SettingsMain `handleResetAndResync`,
  LocalUnlockGate). ⚠ On an encrypted cold start `backupVerifiedAt` reads null → the warning may show for a verified
  key; accepted (enc flag is dev-only, off by default).
- **Bypass 2 (disconnect → unlock re-establish) — verified CLOSED by R2c-6b, no new code.** `disconnectNostr` →
  `wipeLocalPlanData` removes `personal-bloc-writer-key-wrapped`/`-meta`, so post-disconnect NostrAuthGate's #6 branch
  (gated `hasWrappedKey = !!writerKeyWrapped`) can't render and LocalUnlockGate (needs `nostrSigningMethod`/`nostrPubkey`,
  both GATE-wiped) never mounts. Re-entry is only **import** (`'imported'` → satisfied) or **Get-started** (`'generated'`
  → gated). Pinned by `wipeLocalPlanData.test.ts` (both writer keys in the inventory).
- **R2c-6a — onboarding verifies by default.** `OwnerKeySetup` K2 replaces the ack-checkbox with the **ceremony's own
  semantics**: save aids (Download / Save… / QR, reusing `buildRecoveryFileText`/`recoveryFileName`/`downloadBlob` +
  `QRCodeSVG`/`QRCodeCanvas`) gate the **word quiz** (`pickQuizIndices`/`checkQuizAnswers`) — Continue needs `savedOnce`
  (require-save, R2c-7b-fix discipline) + two correct words. On quiz-pass, `setBackupVerifiedAt(Date.now())` (no `nostr`
  arg → the pre-auth field-only branch, the retired K2 bridge's exact spot) → K3's `establishLocalOwner` `syncNow` wakes
  **ungated** → the key enters VERIFIED. A ghost **"I'll do this later"** skips the quiz + stamp → generated-UNVERIFIED
  → the R2c-2/5b ladder. ⚠ `handleGenerate` + `handleStartOver` `setBackupVerifiedAt(null)` — `backupVerifiedAt` rides
  partialize `...rest`, so a quiz-pass → abandon-K3 → relaunch → regenerate → skip would otherwise carry the prior run's
  stamp (falsely verified). Copy fixes riding along: the ceremony's explain body-3 is provenance-honest (imported →
  "words you restored this plan with"; generated → "generated fresh"), and SettingsMain's local-key label is
  scheme-aware (`PIN · local key` vs `{biometricLabel()} · local key`).

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
| Local key (biometric) | `NSecSigner` + `keyVault` | **All platforms** (Step 4; the iOS-only gate was removed in R1). Encrypted local nsec, WebAuthn-PRF/PIN unlock; label is PLATFORM-HONEST via `src/lib/biometricLabel.ts` — "Face ID" on iOS, "passkey" elsewhere (Touch ID / Windows Hello / QR-to-phone). Import gates ONLY on a valid resolved key per tab (the backup-attestation checkbox was retired as tautological — the paste proves possession); on relaunch an "authenticated-but-locked" `LocalUnlockGate` (gesture-driven unlock), NOT the full login. nip07/nip46 keep optimistic auto-restore |

### Writer local-key signer (Nostr Step 4) — `keyVault` + `'local'` method

Third auth option (additive; NIP-07/46 untouched): an **encrypted local nsec, biometric-unlocked, on ALL
platforms** (R1 removed the original iOS-only gate + made the labels platform-honest via `biometricLabel` —
"Face ID" on iOS, "passkey" elsewhere; **R1.5** completed the sweep across the viewer surfaces
`ViewerLoginFlow`/`ViewerUnlockGate` + `StoreMigrationGate`, so `src/lib/biometricLabel.ts` is now the SINGLE
source for that label — never re-inline the UA check), giving one-tap reliability without the NIP-46 deeplink/QR race. Built on a NEW **identity-agnostic
`src/lib/nostr/keyVault.ts`** (PRF primary / PIN fallback, client-side, no server: PBKDF2→HKDF→AES-GCM via
WebCrypto; `wrapSecretKey`/`unwrapSecretKey`/`probeKeyVaultCapability`; unwrapped key in MEMORY ONLY,
never persisted) — shared infra the queued viewer-access phase reuses.
- **✅ RETIRED (copy-truth fix) — the import-path "hard backup gate" attestation checkbox.** `NostrAuthGate`'s
  Recovery-key import used to gate the whole form on `backupConfirmed` ("I have my nsec backed up outside this
  device"). **That attestation was TAUTOLOGICAL: on the IMPORT path the user is pasting a key they already hold,
  so the paste IS the proof of possession.** It gated nothing real and trained reflexive ticking, eroding the acks
  that DO mean something (`OwnerKeySetup` K2, the ceremony's verify). Import now gates ONLY on the real
  precondition — a valid RESOLVED key for the active tab (`localCanContinue`: words checksum via `phraseStatus` /
  `keyTabReady` = not-a-handoff-token + kind resolved + an ncryptsec actually decrypted) plus a confirmed PIN when
  there is no passkey. **Never re-add an attestation checkbox to the import path.**
  ⚠ The `OwnerKeySetup` **K2 ack is INDEPENDENT state (`ack`) and stays** — a freshly MINTED key exists nowhere
  else, so there the attestation is real (it gates Continue only; it has not stamped `backupVerifiedAt` since R2c-4a).
- **On-device notice — state only what is TRUE.** The import path shows a PASSIVE (non-gating) hint: *"The app
  keeps your key protected on this device, but that's not a backup — keep the key you just pasted somewhere safe.
  If you lose this device without it, your plan can't be recovered."* ⚠ It deliberately does **NOT** claim that
  plan DATA is encrypted at rest. The **KEY** is always keyVault-wrapped (passkey/PIN) — unconditionally true —
  but plan data is **plaintext at rest today** (`storeEncEnabled` is off by default; default-on is Phase 5). The
  prior copy asserted "this stores an encrypted copy on this device… all your encrypted data is permanently
  unrecoverable," which was FALSE. Do not restore that claim before Phase 5 actually ships.
- The device copy is convenience, never the only copy. Losing the only copy = permanent data loss.
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
@scure/bip39: 2.0.1    ← pinned exact as a DIRECT dep at nostr-tools 2.23.5's ALREADY-RESOLVED transitive
                         version (same discipline as websocket-ts). Adding it must NOT change the tree:
                         verify `npm ls @scure/bip39` still shows one 2.0.1 (deduped) and that the lockfile
                         diff is ONLY the added key under packages[""].dependencies. Needed directly because
                         nostr-tools/nip06 exposes no entropy→mnemonic function (see nip06Key.ts).
                         ⚠ The wordlist subpath needs the LITERAL `.js`: '@scure/bip39/wordlists/english.js'
                         — the package's exports map has no extensionless key (ERR_PACKAGE_PATH_NOT_EXPORTED).

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
    LandingPage.tsx                 # C0 — commercial marketing page (+ .module.css), served at '/' on the PUBLIC
                                    # deploy (VITE_LANDING=1) via App.tsx. Self-contained (no store/sim/NostrProvider);
                                    # hero + interactive LtvDemo widget (drags BTC price → LTV → Safe/Watch/Act via the
                                    # REAL band constants barLevel/CB_WARN_LTV 0.65/CB_LLTV + LEVEL_COLOR — can't drift)
                                    # + features + steps + pricing (self-host free · hosted over Lightning) + FAQ +
                                    # footer. Reads only VITE_REPO_URL (env + fallback); all demo CTAs → internal '/app'
  components/Auth/
    NostrAuthGate.tsx               # Auth gate; NLogin.fromNostrConnect() wiring; calls markSignerFresh()
                                    # after setting the signer so syncNow doesn't rebuild a duplicate
                                    # NConnectSigner session post-login. + the all-platform "Use a local key"
                                    # flow (R1 removed the iOS-only entry gate; label is platform-honest via
                                    # `src/lib/biometricLabel.ts` — "Face ID" on iOS / "passkey" elsewhere)
                                    # (valid-key gate → nsec decode → keyVault wrap → NSecSigner; the old backup-
                                    # attestation checkbox is RETIRED — see § the local-key signer. The form's only
                                    # precondition is localCanContinue, and a PASSIVE hint states the true posture:
                                    # the KEY is wrapped, that is not a backup. It must NOT claim plan-data
                                    # encryption-at-rest — that is plaintext today, Phase 5 flips it).
                                    # #4: optional onBack prop renders a back button in the main options view; its label
                                    # is the Phase-2 `backLabel?` prop (default "← Back"). AppShell's locked-out-unlock
                                    # escape passes backLabel="← Back to Face ID unlock" (+ onBack=()=>setUnlockEscape(false)
                                    # → falls back to LocalUnlockGate); the Settings access door + onboarding fork login use
                                    # the default. Absent in first-time onboarding which passes no onBack. #6: when a
                                    # writerKeyWrapped already exists (e.g. after a local→nip46→local switch) the local
                                    # section shows "Unlock with Face ID" (handleUnlockExisting → setNostrSigningMethod
                                    # ('local') → restoreSigner) instead of forcing an nsec re-import; a "Use a different
                                    # key" ghost sets forceImport to reveal the import form, and a 'pubkey mismatch' throw
                                    # (different account) catch-and-falls-back to import with a message.
                                    # R2b-2 IA: the options view leads with a STACKED "Use my Recovery Key" row
                                    # (.methodBtn/.methodTitle/.methodSub — the card is align-items/text-align CENTER, so
                                    # the stacked row must opt out of both) subtitled "12 words or nsec — unlocks or imports
                                    # on this device" → openLocal (unchanged). The three PROTOCOL methods (nip07 extension,
                                    # its divider, QR remote-signer, bunker) collapse under an "Advanced sign-in" disclosure
                                    # (.disclosureBtn + aria-expanded/aria-controls + a [data-open] chevron; .disclosurePanel),
                                    # COLLAPSED BY DEFAULT, order + handlers byte-identical. onBack sits outside the panel;
                                    # the #6 unlock-existing branch, the QR/bunker sub-views, and the viewer path
                                    # (ViewerLoginFlow — a different component) are untouched.
                                    # R2b-2 DUAL-FORMAT IMPORT: the paste field takes an nsec OR 12 words (state renamed
                                    # nsecInput → recoveryInput; placeholder "nsec1… or your 12 words"). handleLocal calls
                                    # classifyRecoveryInput → 'nsec' runs the existing nip19.decode path VERBATIM; 'words'
                                    # runs entropyFromWords (R2c-4b — was skFromWords), rendering InvalidSeedWordsError.message
                                    # verbatim (it is user-facing prose by contract); 'unknown' errors naming BOTH forms.
                                    # R2c-4b PAYLOAD ASYMMETRY: ONE `payload` local + a `payloadKind` local feed ONE
                                    # establishLocalOwner call — words → the 16-byte entropy as 'nip06-entropy' (so the
                                    # ceremony/RevealRecoveryKey show the user's REAL words); nsec → the raw sk as 'sk'
                                    # FOREVER (a raw key has no mnemonic; nothing to re-display). Provenance stays 'imported'
                                    # for both, stamped in the same place; the finally's payload.fill(0) zeroes either result.
                                    # R2c-7a-2 BARE-NSEC REMEDIATION: the `nsec` branch NO LONGER falls through to
                                    # establishLocalOwner. A raw nsec is an UNPROTECTED key, so after the (unchanged)
                                    # decode+validate it captures `pendingSkRef.current = decoded.data.slice()` (a
                                    # defensive copy — the raw decode buffer, still assigned to `payload`, is zeroed by the
                                    # existing finally) + `setRemediating(true)` and RETURNS. The remediating branch renders
                                    # FIRST inside `showLocal` (before the hasWrappedKey/#6 ternary): "Protect this key
                                    # first" → an ENCRYPT-direction passphrase field (R1.5 state-specific label: "Passphrase
                                    # to encrypt this backup"; a device-PIN field was on the previous screen) → **Download
                                    # encrypted backup** (nip49.encrypt(sk, pass.trim()) → buildRecoveryFileText('ncryptsec')
                                    # + recoveryFileName('ncryptsec', todayLocalISO()) → downloadBlob) → **Continue**
                                    # (disabled until `bareNsecSaved`) → the SAME establish tail (method resolve →
                                    # setKeyProvenance('imported') → establishLocalOwner(…, payloadKind:'sk') → onSuccess;
                                    # catch → provenance rollback). ⚠ THE GATE IS ON **WHEN**, NOT **WHAT** — a bare nsec
                                    # still wraps 'sk' (a raw key has no mnemonic); the three-way payloadKind asymmetry is
                                    # untouched. The 'encrypted' + 'words' branches SKIP remediation entirely (an ncryptsec
                                    # already arrives protected; words are the richer artifact) and still fall through to
                                    # `establishLocalOwner(payload, method, nostr, {pin,keyLabel,payloadKind})` unchanged.
                                    # FOUR DISCIPLINES, each mirroring the ceremony: (1) ⚠ `establishLocalOwner(sk.slice())`
                                    # — NOT the held ref, and the ref is zeroed on SUCCESS/Back/openLocal/unmount but NEVER
                                    # in a finally: establishLocalOwner wraps+persists BEFORE deriving the pubkey and zeros
                                    # its arg either way, so zeroing the held buffer would make a cancelled-Face-ID RETRY
                                    # wrap 32 zero bytes (the bufferAliasing.test.ts hazard). A failed establish therefore
                                    # leaves Continue retryable. (2) ⚠ nip49.encrypt is ~1s of SYNCHRONOUS scrypt → yield 30ms
                                    # so "Encrypting…" paints before the freeze; no prepRef needed (one-shot on tap + the
                                    # passphrase input is disabled while encrypting, so inputs can't change mid-encrypt).
                                    # (3) STALENESS: editing the passphrase resets `bareNsecSaved` (the prior download is
                                    # locked with the OLD passphrase). (4) Save… sets saved ONLY on a RESOLVED
                                    # navigator.share (an iOS cancel rejects AbortError), guarded by `if (!navigator.share)
                                    # return` first. Errors → generic "Couldn't encrypt — try again." (⚠ never e.message).
                                    # pendingSkRef is a REF not state so the unmount cleanup zeroes the CURRENT buffer.
                                    # R2c-7a-fix KEY-FIELD ERROR PRECEDENCE (strict, mutually exclusive; each suppresses
                                    # the passphrase field — a payload we can't parse must never be blamed on the
                                    # passphrase): (1) pastedIsHandoffToken = recoveryInput.trim().includes(':') →
                                    # "That's a viewer share code, not your Recovery Key." ⚠ NEVER auto-strip the suffix:
                                    # the key inside a SharingPage token is a VIEWER key, so importing it as the owner is
                                    # a silent CATEGORY ERROR. `:` isn't in the bech32 alphabet (nor in 12 words), so a
                                    # colon anywhere means "token" — we test .includes(':') and NOT parseHandoffToken(…)
                                    # !== null, because that returns null for a MALFORMED token which would then fall
                                    # through and be misreported; it also catches a plaintext `nsec1…:npub1…` token that
                                    # classifies as 'nsec'. Guarded again in handleLocal (defense in depth) so a token can
                                    # never reach establishLocalOwner. (2) kind==='encrypted' && !isWellFormedNcryptsec →
                                    # "That doesn't look like a valid key — check for a truncated paste." (also shown when
                                    # decryptState.error==='malformed', i.e. a checksum typo that only surfaced inside
                                    # decrypt). (3) only a WELL-FORMED ncryptsec shows the passphrase field, so "Wrong
                                    # passphrase" finally means what it says (decryptState.error==='passphrase'). The
                                    # words/unknown hints are suppressed for a token (`garbage:npub1…` classifies as
                                    # R2c-7a-2-polish: the passphrase field's three feedback branches are MUTUALLY
                                    # EXCLUSIVE over the existing decryptState — `checking` → "Checking passphrase…",
                                    # `error==='passphrase'` → "Wrong passphrase…", and (NEW) `!checking && sk &&
                                    # !error` → a green "✓ Key unlocked" (styles.checksumLine + .checksumValid, the
                                    # same classes the word grid's "✓ valid recovery phrase" uses). Without the
                                    # success branch a CORRECT passphrase merely made "Checking…" vanish after ~4s
                                    # (3000ms debounce + ~1s scrypt) while Continue quietly enabled — which reads as
                                    # "nothing happened". Display-only: no new state, no effect, no decrypt/debounce/
                                    # trim change. (ViewerLoginFlow's token passphrase has the same shape and was
                                    # deliberately left alone — it already surfaces the decoded viewer npub.)
                                    # 'unknown' and would otherwise double-error). ⚠ SCOPE — ✅ NO LONGER INPUT-STARVED:
                                    # **R2c-7b's encrypted backup export is this branch's producer** (RecoveryKeyCeremony →
                                    # encrypt toggle → Download → a `-encrypted-<date>.txt` holding an owner-key ncryptsec),
                                    # so the ROUND-TRIP is the real acceptance test — export → sign out → paste → passphrase →
                                    # establishes to the SAME pubkey. **R2c-7a-2 (bare-nsec remediation) is the SECOND
                                    # producer** — a pasted raw nsec must now save an encrypted backup before it establishes,
                                    # and that backup pastes straight back into this branch. It
                                    # was starved at 7a/7a-fix: the only well-formed ncryptsec then obtainable was the VIEWER
                                    # key inside a share token, which (1) rejects — so R2c-7a's manual gate "mint a viewer
                                    # token to get a real ncryptsec" was never a valid acceptance test. ⚠ An imported
                                    # ncryptsec wraps payloadKind 'sk' (it decrypts TO a raw key), so a user who exported an
                                    # ENCRYPTED backup of an entropy key and restores from it gets an nsec, not their 12
                                    # words — the asymmetry the ceremony's helper line warns about, and why plaintext is the
                                    # export default.
                                    # R2c-7a ENCRYPTED KEY: the key tab is PREFIX-AWARE and takes an nsec OR a NIP-49
                                    # ncryptsec. A memoized keyInput = classifyRecoveryInput(recoveryInput) (stable effect
                                    # dep) drives everything. kind==='encrypted' reveals an UNLOCK-passphrase field whose
                                    # copy is STATE-SPECIFIC by requirement ("Passphrase to unlock this key" + "…it is not
                                    # your device PIN") — a device-PIN field can be on screen simultaneously, and R2c-7a-2
                                    # adds the inverse ENCRYPT passphrase here, so a generic "Passphrase" would be
                                    # ambiguous in BOTH directions (the R1.5 confusion). Mechanism MIRRORS ViewerLoginFlow
                                    # verbatim: 3000ms debounce → decrypt in an EFFECT not a memo (nip49.decrypt is
                                    # SYNCHRONOUS scrypt; a memo blocks the paint that would show "Checking passphrase…")
                                    # → 30ms setTimeout yields one frame so it paints → clearTimeout cleanup so a stale
                                    # in-flight decrypt can't land after a newer keystroke → {sk:null,checking:true} first
                                    # so a stale key is never carried. handleLocal's encrypted branch takes the sk from
                                    # that state (never re-decrypts) and MUST .slice() it (see the Critical Constraints
                                    # row — zeroing the state buffer corrupts writerKeyWrapped on a retry). payloadKind
                                    # 'sk' (an ncryptsec decrypts TO a raw key; no phrase to re-display). localCanContinue
                                    # is kind-aware: unknown can't submit, and an ncryptsec can't submit until it decrypts.
                                    # Hints keep a disabled Continue from being mute (unknown → accepted forms; 12 words in
                                    # the key field → "switch to the phrase tab", NOT blocked — handleLocal imports them
                                    # correctly via the entropy path). openLocal also scrubs keyPassphrase/debounced/decryptState.
                                    # R2b-3 TAB SPLIT: a "Recovery phrase (12 words) | Recovery key" segmented toggle (recoveryTab,
                                    # 'words' | 'key' — R2c-7a renamed the value from 'nsec', which would now be a lie;
                                    # default 'words', reset in openLocal; .recoveryTabs/.recoveryTab/.recoveryTabActive, this
                                    # file's own tokens). WORDS tab = <WordGrid mode="input"> over gridValues (12 boxes, reset
                                    # in openLocal) + a single parent-owned CHECKSUM line (phraseStatus → "phrase incomplete" /
                                    # "✓ valid recovery phrase" / "checksum doesn't match — check your words") + (R2c-4a) the
                                    # CAPTURE-variant hygiene hint BELOW the checksum line, words tab only, reusing .hint:
                                    # "Never type your Bitcoin wallet's seed phrase here — a plan uses its own words."
                                    # (below, not above, so it never interrupts the grid→live-status feedback path); a pasted KEY
                                    # (onKeyPasted — nsec OR ncryptsec since R2c-7a) flips to the key tab with the field filled;
                                    # onSubmitAttempt (Enter on box
                                    # 12) submits if valid. KEY tab = the SAME single field (password + Show/Hide +
                                    # the 4 iOS suppressions), placeholder "Paste your recovery key — nsec or encrypted"
                                    # (never the token "ncryptsec" — jargon). handleLocal is STILL ONE PATH —
                                    # only the raw source is tab-selected (words: gridValues joined; key: the field) → the same
                                    # classifyRecoveryInput → decode/skFromWords → 'imported' stamp → establishLocalOwner, all
                                    # byte-identical from classification onward. localCanContinue is tab-aware (words:
                                    # phraseStatus==='valid'; nsec: !!recoveryInput.trim()) — but skFromWords on submit is still
                                    # the authority (the checksum gate is a hint). ⚠ RESIDUAL (pre-existing, NOT introduced
                                    # here): openLocal is the ONLY scrub site — gridValues/recoveryInput/pin/pinConfirm survive a
                                    # successful handleLocal + the ← Back buttons in React state until re-entry (flagged for the
                                    # R2c scrub pass, not fixed). [Superseded R2b-2 note: the field was once a single dual-format
                                    # box "nsec1… or your 12 words"; the words half is now its own grid tab.]
    LocalUnlockGate.tsx             # "Authenticated-but-locked" relaunch screen for the 'local' method —
                                    # gesture-driven "Unlock with Face ID" (restoreSigner→unwrap) + Retry +
                                    # "Use a different login" escape; reuses NostrAuthGate.module.css
    ViewerLoginFlow.tsx             # Access Layer Phase 1 — the viewer-login flow EXTRACTED VERBATIM from
                                    # OnboardingModal (byte-identical crypto: wrapSecretKey→setUnwrappedViewerKey
                                    # →clearViewerData→setViewerWriterPubkey→setViewerMode(true); only the final
                                    # onComplete(true) became an onDone() prop). Self-contained overlay (own
                                    # .overlay/.modal) → reusable from BOTH onboarding AND Settings. Props {onDone,onBack}.
                                    # R1.5 PROGRESSIVE DISCLOSURE: the wrap-step field groups (the viewerMethod!=='pin'
                                    # "Name this viewer" group AND the viewerMethod==='pin' PIN/confirm groups) are gated
                                    # on `activeKey` — token + passphrase resolve FIRST, device protection appears after.
                                    # Safe because viewerCanDone already requires !!activeKey (probe/wrapSecretKey/
                                    # handleViewerDone byte-identical). R1.5 LAYER-HONEST COPY: the PIN label reads
                                    # "Create a PIN for this device" + a hint naming the two layers ("it is not the
                                    # owner's passphrase, and the owner never needs it") — the viewer's DEVICE PIN and the
                                    # owner's HANDOFF PASSPHRASE ("Passphrase (from the owner)") must never be conflated
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
  lib/crypto/
    crypto.worker.ts                # Phase 2a — the codebase's FIRST dedicated module Web Worker. Runs nip49's ~1s of
                                    # SYNCHRONOUS scrypt OFF the main thread so unlocking an encrypted key / producing an
                                    # encrypted backup never freezes the UI. `declare const self: DedicatedWorkerGlobalScope`
                                    # (mirrors sw.ts); imports ONLY nostr-tools/nip49 + classifyNcryptsecError (small chunk).
                                    # Two ops: nip49encrypt (payload = TRANSFERRED sk copy → result string) / nip49decrypt
                                    # (ncryptsec+pass → TRANSFERRED sk copy). ⚠ Zeroes every received/derived key buffer in
                                    # `finally`; classifies decrypt errors INSIDE the worker and posts only the STRING
                                    # ('malformed'|'passphrase'|'generic') — NEVER e.message (bech32 echoes key material).
                                    # Compiled by tsconfig.worker.json (WebWorker lib), excluded from tsconfig.app.json (the
                                    # sw.ts pattern). Vercel builds it via vite build (worker chunk, precache-manifested)
    cryptoClient.ts                 # Phase 2a — the client for crypto.worker.ts. Feature-detects module-worker support once
                                    # (typeof Worker); spawns `new Worker(new URL('./crypto.worker.ts', import.meta.url),
                                    # {type:'module'})` — the precache-safe form ONLY. On no support / worker error /
                                    # onmessageerror / 30s op timeout → terminate + mark unavailable for the SESSION + re-run
                                    # the op via the SYNCHRONOUS in-thread nip49 FALLBACK (identical I/O — worst case = pre-2a
                                    # status quo). API cryptoClient.nip49Encrypt(sk,pass,logn?)→Promise<string> /
                                    # nip49Decrypt(ncryptsec,pass)→Promise<Uint8Array>. ⚠ INTERNAL-COPY CONTRACT: .slice()s
                                    # `sk` and transfers/uses THE COPY, so the caller's buffer is never neutered → every
                                    # caller-side `finally { sk.fill(0) }` keeps working verbatim. Both paths surface failures
                                    # as a `CryptoError` carrying `.kind` (classification centralized here + in the worker), so
                                    # call sites read one shape. Pure node-testable exports (CryptoError / classifyWorkerFailure
                                    # / encode{Encrypt,Decrypt}Request / the message types) — the worker itself is device-gated,
                                    # not unit-tested (tests force the fallback since node has no Worker). ⚠ ONLY nip49 crosses
                                    # the boundary — NIP-07/NIP-46 signers can't; sync.ts/viewerSync.ts nip44 (single-op, no
                                    # freeze) + keyVault WebAuthn-PRF (gesture-bound) stay on the main thread by design.
                                    # ⚠ Phase 2 CLOSED at 2a — 2b (worker NIP-44 fan-out batching) DESCOPED on grounded
                                    # evidence: nip44 is µs-scale symmetric crypto and batching would require resident raw-sk
                                    # (a key-hygiene regression); NSecSigner remains the sole key holder
  lib/nostr/
    syncEngine.ts                   # Phase 1b — the publish/orchestration ENGINE, extracted VERBATIM (move-only, zero
                                    # behavior change) from useStore.ts. Owns: publishRecordsNow (400ms trailing debounce) ·
                                    # publishRecordsNowImmediate · publishSettingsNow · scheduleSettingsPublish (the 2s
                                    # settings debounce, ex-syncSettingsToNostr tail) · importRelaysFromNip65 ·
                                    # publishRelayListToNip65 · publishViewerSnapshotNow (fan-out) · publishViewerRevocationNow,
                                    # plus the module timers syncDebounceTimer/recordsDebounceTimer. STATICALLY imports
                                    # useStore + ./publish (the store's 5 former DYNAMIC publish imports are now ordinary static
                                    # imports here) + ../../store/payloads + ./relays + ./log + ./timeout + ../backupGate.
                                    # ⚠ useStore MUST NOT statically import this (store→engine is dynamic-only; the :syncNow
                                    # precedent) — a static back-edge is an instant cycle. remotePlanFoundResolved latch does
                                    # NOT live here (stays in useStore with recordRemotePlanFound)
    publish.ts                      # publishEncrypted (→ Promise<number>), publishSettings, publishRecords (RecordsPayload
                                    # v2 — P3 += dayLog + dayLogDeletions, REQUIRED). ViewerSnapshot += optional cbCollateralBtc (P3 BUG2 scalar) + strikeCollateralBtc (C-P4 scalar, trusted-only).
                                    # P2: publishRelayListNip65(signer,_pubkey,relays,publishTo?,opTimeoutMs?) — a PLAIN
                                    # (unencrypted) kind-10002 relay list (flat r tags, no read/write markers); MUST NOT
                                    # route through publishEncrypted/signer.nip44 (10002 is public). Both share the
                                    # private publishSignedToRelays tail (now QUORUM-ACK min(2,pubs.length) via the pure
                                    # exported awaitAckQuorum, was first-ack; gains a `label` param + records a PublishReport;
                                    # 12s-timeout, pool close after allSettled) — extracted from publishEncrypted, whose
                                    # signature is unchanged. Exports awaitAckQuorum + PublishReport + getPublishReports (ring
                                    # buffer, last 10) for DevPanel PUBLISH ACKS + Copy Diagnostics (metadata only).
                                    # Phase 4a-inst: PublishReport += eventBytes/plainBytes (real byte lengths via a
                                    # TextEncoder byteLen helper, NOT String.length — additive-only, no publish/quorum
                                    # logic change)
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
                                    # nsec-WRAP key (distinct info); copies sk (never mutates caller). In memory only.
                                    # R2a-2: WrapMeta gains `payloadKind?: 'sk' | 'nip06-entropy'` — ⚠ ABSENT MEANS
                                    # 'sk' (see § Recovery-key payload kinds). wrapSecretKey's first param is renamed
                                    # `payload` + gains a DEFAULTED 5th positional `payloadKind` (recorded on every
                                    # wrap; 5th-positional, not an options object, so the 4-arg call sites + their
                                    # arity-exact toHaveBeenCalledWith assertions in establishOwner.test.ts stay valid).
                                    # The old unwrap body is extracted VERBATIM into a private decryptWrapped() so both
                                    # readers share ONE auth flow (one Face ID prompt / one PBKDF2 run). unwrapSecretKey
                                    # KEEPS its return contract (ALWAYS the 32-byte secret key; derives via
                                    # deriveSkFromEntropy + zeroes the intermediate entropy when the payload is entropy).
                                    # unwrapRecoveryPayload → {payloadKind, bytes} returns the payload AS STORED (caller
                                    # zeroes) — R2c-1 gave it its FIRST TWO consumers: RecoveryKeyCeremony (reveal) +
                                    # RevealRecoveryKey (both branch on payloadKind to show words vs nsec). Imports nip06Key
                                    # (one-way; nip06Key never imports keyVault). Entropy adoption at keygen shipped in R2b-1
    nip06Key.ts                     # R2a-2 — NIP-06 plan-key derivation, the BIP-39 foundation for R2c's word-quiz
                                    # backup ceremony. PURE, node-testable, imports NOTHING from keyVault (keyVault
                                    # imports THIS — one-way, no cycle). PATH m/44'/1237'/0'/0/0, ACCOUNT 0, NO BIP-39
                                    # passphrase (nostr-tools privateKeyFromSeedWords defaults) — both pinned by the
                                    # published-vector test; ⚠ changing either silently derives a DIFFERENT key from the
                                    # same words = undetectable permanent data loss. ENGLISH WORDLIST ONLY (v1) — the
                                    # words are a written-down recovery artifact, so the language is part of the contract;
                                    # widening it later is additive to skFromWords, never a re-derivation.
                                    # ENTROPY_BYTES 16 (128-bit → 12 words); wordsFromEntropy / deriveSkFromEntropy /
                                    # skFromWords (normalizes trim+collapse-whitespace+lowercase, then validateWords —
                                    # which RETURNS FALSE rather than throwing, so the check must be explicit) /
                                    # entropyFromWords (R2c-4b — the exact INVERSE of wordsFromEntropy; what the words-IMPORT
                                    # path wraps. Shares ONE private normalizeWords+assertValidWords contract with skFromWords
                                    # so the two doors can't drift. IDENTITY-SAFE: deriveSkFromEntropy(entropyFromWords(w)) ===
                                    # skFromWords(w) — the property the whole import flip rests on, pinned by test. ⚠ Validates
                                    # BEFORE decoding and rethrows ANY decode failure as InvalidSeedWordsError, because
                                    # mnemonicToEntropy bottoms out in @scure/base's alphabet decoder which throws
                                    # `Unknown letter: "<word>"` — it INTERPOLATES THE SEED WORD, which this module forbids;
                                    # the try/catch makes that leak structurally impossible. Caller zeroes the buffer) /
                                    # generatePlanKey() → {entropy, words, sk, pubkeyHex}. skFromWords is NO LONGER app-orphaned
                                    # (R2c-7b: RecoveryKeyCeremony's encrypt path calls it to re-derive the sk FROM THE DISPLAYED
                                    # WORDS rather than retain the entropy bytes) — and it remains the published-vector-pinned
                                    # canonical derivation + the LHS of the identity equality.
                                    # InvalidSeedWordsError is the
                                    # repo's FIRST Error subclass (everything else throws bare `new Error`); the UI catch
                                    # blocks render e.message verbatim, so the message is user-facing prose and must NEVER
                                    # interpolate the words. ⚠ THE WORDS STRING IS A TRANSIENT SECRET — a JS string cannot
                                    # be zeroed; never persist/log it or hold it in state outliving its screen. The
                                    # ZEROABLE forms are entropy (16B) + sk (32B): CALLERS OWN ZEROING BOTH
    establishOwner.ts               # Phase 1.5 — establishLocalOwner(payload, method, nostr, opts?): the SINGLE local-owner
                                    # establish path (wrap→persist writerKey→NSecSigner+setNostrSigner→markSignerFresh→
                                    # setNostrPubkey(getPublicKey(sk))→setNostrSigningMethod('local')→fire-and-forget
                                    # syncNow→setIsAuthenticated(true)→zero). Extracted VERBATIM from NostrAuthGate's
                                    # import body → BOTH the import path AND OwnerKeySetup K3 call it (zero drift).
                                    # R2b-1: opts gains payloadKind?:PayloadKind (default 'sk' → nsec-import/legacy path);
                                    # it is forwarded as wrapSecretKey's 5th arg. R2c-4b: NostrAuthGate now PASSES it —
                                    # 'nip06-entropy' on the words branch, 'sk' on the nsec branch. establishOwner itself
                                    # needed NO change (it already derived the sk from an entropy payload internally).
                                    # ⚠ The signing sk is DERIVED from the payload it just WRAPPED (payload for 'sk';
                                    # deriveSkFromEntropy(payload) for 'nip06-entropy'), NEVER accepted from the caller — so
                                    # the identity we authenticate as is provably the one unwrapSecretKey later re-derives
                                    # from this exact ciphertext (a caller-supplied sk could silently disagree → the wrapped
                                    # key would never unlock the identity). Zeroes BOTH the caller's payload AND the derived
                                    # sk. ⚠ NEVER logs key material. NostrSigner from './signers' (sibling re-export)
    viewerKey.ts                    # Viewer-key derivation — deriveViewerKeyFromNsec(sk, ownerPubkeyHex, keyVersion, index)
                                    # → deterministic 32-byte viewer secret key. M2: 4-ARG, PER-SLOT-INDEXED. WebCrypto
                                    # DIRECTLY (crypto.subtle), NOT keyVault's helpers/info labels (own crypto domain).
                                    # HKDF-SHA256: ikm=owner sk, salt=SHA-256(utf8(ownerPubkeyHex)),
                                    # info=`personal-bloc/viewer-key/v${keyVersion}/i${index}`, deriveBits 256; if
                                    # out-of-range (~2^-128) append `/${counter}` to info + re-derive (validity gate =
                                    # getPublicKey try/catch, no extra deps). Deterministic in (ownerSk, ownerPubkeyHex,
                                    # keyVersion, index) → the owner regenerates the SAME viewer nsec for that slot anytime
                                    # (no separate backup). The index makes every roster slot's key distinct at the same
                                    # keyVersion; keyVersion is per-slot (rotation bumps it). Does NOT mutate sk; returns a
                                    # fresh array the caller zeroes. ⚠ Never logs/persists key material
    handoffToken.ts                 # Viewer handoff v3 — buildHandoffToken(keyPart, ownerNpub) → `<keyPart>:<ownerNpub>`
                                    # + parseHandoffToken → {kind:'nsec'|'ncryptsec', keyPart, ownerNpub} (ownerNpub NON-NULL).
                                    # PURE (nip19 bech32 only, NO crypto): trim, split on ':' (EXACTLY 2 parts required — bare
                                    # nsec / anything not 2-part → null, bare-nsec back-compat RETIRED), classify keyPart by
                                    # prefix, validate the npub half decodes as npub. Owner builds it in SharingPage (keyPart =
                                    # nip49.encrypt(derived,passphrase) or nip19.nsecEncode); viewer parses + nip49.decrypts it
                                    # in ViewerLoginFlow
    session.ts                      # restoreSigner(nostr, pin?) — rebuild signer from persisted login (no fetch/sync);
                                    # exports NostrParam. P0: `pin` is supplied ONLY by the unlock UI for a
                                    # scheme:'pin' key (LocalUnlockGate / NostrAuthGate #6) and forwarded to
                                    # unwrapSecretKey(wrapped, meta, pin) — which already accepted it, and ignores it
                                    # for a PRF key, so the passkey path is byte-identical. Without it keyVault threw
                                    # 'PIN required' and a PIN-fallback user was locked out after every reload.
                                    # SINGLE-FLIGHT (Bug 2 fix): the public restoreSigner wraps doRestoreSigner in a
                                    # module-level in-flight promise (mirrors syncNow) — concurrent callers (gate escape
                                    # + reactive syncNow) share ONE WebAuthn ceremony + the SAME signer; two ceremonies
                                    # at once aborted one (AbortError) + looped the other (NotAllowedError).
                                    # ⚠ THE GUARD IS PIN-AWARE: a pin-bearing call NEVER joins a pinless in-flight
                                    # restore (that one is doomed for a pin-scheme key → a correct PIN would report
                                    # failure); every other combination shares as before. PRF never passes a pin, so
                                    # two PRF callers always match and always share → WebAuthn single-flight intact.
                                    # The `.finally` has an ownership check so a superseded promise can't null its
                                    # replacement's slot. A boolean is held at module scope, never the pin.
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
    recoveryInput.ts                # R2b-2 + R2c-7a — PURE, zero imports. classifyRecoveryInput(raw) →
                                    # {kind:'nsec'|'encrypted'|'words'|'unknown'}. SHAPE ONLY, never validity:
                                    # `ncryptsec1` prefix → encrypted (NIP-49; the caller collects a passphrase and
                                    # decrypts); `nsec1` prefix → nsec; else exactly RECOVERY_WORD_COUNT (12) whitespace
                                    # tokens → words (collapsed to single spaces); else unknown. All prefixes are
                                    # case-sensitive (bech32 is lowercase). ⚠ ncryptsec1 is checked first for
                                    # READABILITY, not because the prefixes collide — they diverge at char 2 (`ns` vs
                                    # `nc`) so `'ncryptsec1'.startsWith('nsec1') === false`; a test pins that so a future
                                    # prefix edit can't quietly introduce a collision. nip19.decode / nip49.decrypt /
                                    # nip06Key own their own verdicts, so 12 nonsense tokens classify as `words` and are
                                    # rejected downstream with a real message. ⚠ Do NOT add validation here — it would
                                    # duplicate (and drift from) three separate crypto contracts. ⚠ It also has NO ':'
                                    # logic and NO ncryptsec shape check — those live in ncryptsec.ts + NostrAuthGate
    ncryptsec.ts                    # R2c-7a-fix — PURE, zero imports. The two layers that let the Recovery-key tab
                                    # fail HONESTLY. Exists because nip49 exports only encrypt/decrypt (no shape check)
                                    # and decrypt runs ~1s of SYNCHRONOUS scrypt before it can tell you anything.
                                    # LAYER 1 isWellFormedNcryptsec(s) — prefix + exact NCRYPTSEC_LENGTH (162) + bech32
                                    # charset. No crypto → safe per keystroke. Gates whether the passphrase field even
                                    # appears, so a malformed payload is never blamed on the passphrase. Rejects a
                                    # `:npub` handoff-token suffix, truncation, a bare nsec, newline damage. ⚠ Does NOT
                                    # verify the CHECKSUM (that would need bech32 from @scure/base — NOT a direct dep),
                                    # so a 1-char typo passes → LAYER 2. 162 is deterministic: the payload is fixed-width
                                    # (1+1+16+24+1+48 = 91 bytes → 146 words → 9+1+146+6), and `logn` is one byte OF it.
                                    # LAYER 2 classifyNcryptsecError(e) → 'malformed' | 'passphrase'. nip49.decrypt runs
                                    # every structural check (bech32 → prefix → version) BEFORE scrypt, so only the final
                                    # AEAD step can fail on the passphrase: 'invalid tag' ⇒ passphrase, everything else
                                    # ('Invalid checksum in …', 'Unknown letter: …', 'invalid prefix …', 'invalid
                                    # version …') ⇒ malformed. ⚠ POSITIVE TEST on 'invalid tag' DELIBERATELY — if a dep
                                    # renames it we degrade to calling a wrong passphrase "malformed" (confusing, never
                                    # imports a key); the inverse default IS the R2c-7a bug. ⚠ NEVER render e.message:
                                    # bech32 echoes the ENTIRE ncryptsec into it (and 'Unknown letter' the offending
                                    # char) — same leak class as entropyFromWords
    sync.ts                         # applyRemoteEvent — THE single apply path for a remote event (both transports);
                                    # fetchAndSync → { ok, planFound } (R2b-2; was a bare boolean). `ok` = decrypt health
                                    # (breaks loop on first decrypt fail). `planFound` = latestByDTag.size > 0 — computed
                                    # BEFORE the decrypt loop from a map whose keys can only be the two owner d-tags (the
                                    # query filters authors+#d, and the build loop `continue`s on a missing d-tag), so it
                                    # means "an owner plan exists on the relays" and stays TRUE when ok=false. ⚠ An
                                    # unreachable signer must NEVER be reported as "no plan found";
                                    # settings watermark (read FRESH per event) + records MERGE (mergeRecords, 4-field:
                                    # entries+deletions+dayLog+dayLogDeletions). P3: generalized norm() canonicalizes all
                                    # four; write-back via setDayLog (folds the cbCollateralBtc derive) + setDeletedDayEvents
                                    # — actions-only (NO setState/deriveCbCollateral import); LD3 (no monthlyLog-from-dayLog);
                                    # does NOT manage the reconnect flag
    liveSync.ts                     # foreground-only live relay subscription — module singleton (openLiveSync/
                                    # closeLiveSync); transport only, every event → applyRemoteEvent; opened on
                                    # visible, torn down on hidden, fresh since−60s each open
    viewerSync.ts                   # Viewer Access Phase 2 (READ-ONLY) — the mirror of liveSync, but reads the
                                    # OWNER's snapshot (authors:[viewerWriterPubkey], #d:[viewerDTag(myPubkey)] — M2
                                    # per-viewer addressing; getViewerPubkeyHex() computes the viewer's own pubkey from
                                    # the in-memory holder) and decrypts with the VIEWER's key (NSecSigner(...)).
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
    disconnect.ts                   # THREE teardowns + a METHOD-AWARE dispatch (see disconnect.test.ts):
                                    # signOut(method) — the user-facing "get me out of this session" action,
                                    # surfaced as the LAST item of the Settings menu (the conventional, discoverable
                                    # spot) and in the full-mode BrandingDropdown. Dispatch:
                                    #   'local' → signOutLocal()    (key stays on device → LocalUnlockGate)
                                    #   'nip46' → reconnectNostr()  (nostrLogin cleared → NostrAuthGate)
                                    #   'nip07' → disconnectNostr() ⚠ NOT reconnectNostr
                                    #   null    → no-op (viewer / not signed in)
                                    # ⚠ WHY nip07 → disconnectNostr, twice over. (1) reconnectNostr RETAINS
                                    # nostrPubkey, and after its reload useNostrAutoRestore early-returns ONLY for
                                    # 'local' and for (nip46 && !nostrLogin) — a nip07 session falls through to
                                    # setIsAuthenticated(true) → restoreSigner → NLogin.fromExtension(), which an
                                    # authorized extension answers SILENTLY. The user would tap Sign out, the page
                                    # would reload, and they'd still be signed in. It is the ONLY teardown
                                    # auto-restore cannot undo. (2) DESTRUCTIVENESS IS A PROPERTY OF WHAT'S AT
                                    # STAKE, NOT OF THE FUNCTION: a nip07 user has no on-device key (it lives in the
                                    # extension), and disconnectNostr's cleared fields all re-stamp on the next
                                    # login (keyProvenance → 'external' ⇒ isBackupGateSatisfied true by
                                    # construction; backupVerifiedAt is irrelevant to that predicate). Re-login is
                                    # one approval. ACCEPTED DUPLICATION: for nip07 the bottom Sign out ≡ THIS
                                    # DEVICE's "Disconnect" — one act, two framings.
                                    # signOutConfirmMessage(method, scheme) — the copy must match the MECHANISM: a
                                    # PIN-scheme local key is never promised a biometric (the P0 lesson), and the
                                    # nip07 string makes NO identity-retention claim (disconnectNostr clears the
                                    # app-side record; the KEY is safe in the extension).
                                    # The Identity & Security "Sign out" row stays LOCAL-ONLY (it is the in-context
                                    # entry beside its destructive sibling "Remove local key") and calls signOutLocal
                                    # directly. Viewers are excluded structurally (SettingsMain early-returns
                                    # <ViewerSettings/>; a viewer's nostrSigningMethod is null).
                                    # identityForgetConfirmMessage(kind:'disconnect'|'remove-key', neverSynced) —
                                    # PURE copy for the two Settings identity-forget confirms. Both wipe (they route
                                    # through disconnectNostr) so both say so + warn "changes not yet synced will be
                                    # lost". ⚠ neverSynced = !isBackupGateSatisfied(...) (imported, never re-derived):
                                    # a generated + unverified key has had sync gated off since minute one, so the
                                    # relay holds NOTHING and the copy must NOT promise a relay copy — it warns of
                                    # permanent deletion instead. See § Remanence
                                    # signOutLocal (R2c-6b) — NON-DESTRUCTIVE local sign out. Sets
                                    # setNostrAuthEnabled(true) then DELEGATES to reconnectNostr (no duplicated
                                    # clears; reconnectNostr's body is untouched). ⚠ The setter runs BEFORE the
                                    # delegate because reconnectNostr's reload() is its LAST statement and
                                    # navigation ends execution. ⚠ It is an INVARIANT PIN, not dead code: today
                                    # nostrAuthEnabled DERIVES from the retained pubkey (setNostrPubkey sets both in
                                    # lockstep; gateHydratedIdentity pins it true), so it's a no-op — but if that
                                    # derivation ever changes, the line visibly contradicts a regression instead of
                                    # letting sign-out silently become a full logout. Retains identity + wrapped key
                                    # + keyProvenance/backupVerifiedAt → lands on LocalUnlockGate, unlock returns to
                                    # the SAME plan, still verified. Surfaced as "Sign out" in Settings → THIS
                                    # DEVICE (above "Remove local key") and in the full-mode BrandingDropdown, both
                                    # gated nostrSigningMethod === 'local'. ⚠ NOT for nip07/46 — their existing
                                    # "Disconnect" IS their sign-out (the key lives in the extension/bunker); a
                                    # second control would be two words for one action.
                                    # disconnectNostr — the ONE identity-FORGET: clears state, then calls
                                    # wipeLocalPlanData() as its LAST mutation (⚠ a store set() after it re-persists
                                    # the blob), then window.location.reload() to flush NPool. Lands on the fresh
                                    # entry fork. reconnectNostr/signOutLocal deliberately do NOT wipe (§ Remanence)
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
                                    # (escapeHatch.resetAndResync + wipeLocalPlanData), which reload after
    wipeLocalPlanData.ts            # R2c-6b — wipeLocalPlanData(): void. The plan-data wipe for the IDENTITY-FORGET
                                    # paths (disconnectNostr, which "Remove local key" delegates to). Reuses
                                    # clearStoreEncryptionState() (blob + enc flag + pending-decrypt + in-memory key),
                                    # then removes WK_* + personal-bloc-onboarded + the 3 GATE_* identity keys +
                                    # personal-bloc-provenance (R2c-6-final) + sessionStorage 'bloc-nostr-log'.
                                    # RETAINS 'bloc-device-tag' (the only device-level
                                    # key). ⚠ THE CLASSIFIED KEY INVENTORY IN ITS DOC COMMENT IS THE CONTRACT — a new
                                    # storage key must be classified there; wipeLocalPlanData.test.ts asserts it
                                    # exhaustively. ⚠ personal-bloc-onboarded is standalone, NOT blob-resident: wiping
                                    # only the blob leaves onboardingComplete true → the fresh entry fork never renders
                                    # (the same bug, half-fixed). ⚠ NEVER sweep by 'personal-bloc-' prefix (bloc-device-
                                    # tag / bloc-nostr-log don't carry it). NO reload() inside — callers own ordering.
                                    # NOT called by signOutLocal / reconnectNostr / resetAndResync. See § Remanence
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
                                    # ("Can't unlock — reset & re-sync"). resetAndResyncConfirmMessage(neverSynced)
                                    # (R2c-6-final, PURE string-only — keeps the no-publish guarantee) backs BOTH confirms:
                                    # a generated-unverified key has no relay copy, so the neverSynced branch warns of
                                    # PERMANENT loss instead of promising "reloads from the relays" (bypass 1 honesty).
                                    # resetPlanToSeeds is now app-orphaned (left as a
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
  rejected (names the relay). **Phase 4a-inst** adds two optional fields — `eventBytes` (real byte length
  of `JSON.stringify(signed)`, the wire size of the final signed event) and `plainBytes` (real byte length
  of the pre-encryption JSON, set only by `publishEncrypted`; stays absent on the plain `kind:10002` path).
  Both are computed via a `byteLen` helper (`new TextEncoder().encode(s).length`) — deliberately NOT
  `String.length` (UTF-16 code units), since NIP-44's plaintext ceiling is 65,535 real BYTES and this
  instrumentation exists to confirm that budget. Surfaced in DevPanel's PUBLISH ACKS rows (a size suffix)
  and a new PAYLOAD SIZES block in SYNC STATE (newest report per settings/records/viewer channel).
  `publishRelayListNip65` (kind-10002) shares the tail → inherits the quorum.
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
| `personal-bloc:settings:v1` | All 37 settings fields | **4c: now a one-way write-through BRIDGE** — published from current state inside `publishPlanEventsNow`'s success path (fold output ≡ current state under D2), NOT triggered by setters (nothing marks `settingsDirty` post-4c). Read-as-authority only on an empty-log device; a migrated device strips `PLAN_EVENT_FIELDS` from it. Retired at 4e |
| `personal-bloc:plan-events:v1` | **4c** `{ events: PlanEvent[] }` — the append-only plan log, NIP-44 self-encrypted | Any plan-field setter via `emitPlanSets` (marks `planDirty`, 2s debounce → `publishPlanEventsNow` → compact → publish → bridge → parity); retried by `syncNow` while dirty. Pull = union-by-id + fold-to-state, order-independent (NO watermark) |
| `personal-bloc:prefs:v1` | **4c** `{ tabOrder, hiddenTabs, simpleMode, btcBuyingUnit }` | The 4 prefs setters via `emitPrefs` (marks `prefsDirty`, 2s debounce → `publishPrefsNow`); tiny whole-object LWW; pull hydrates via `hydrateSettings` (whitelist → only prefs land) |
| `personal-bloc:records:v1` | Payload schema v2 `{ entries, deletions, dayLog, dayLogDeletions }` (legacy bare array + pre-P3 dayLog-less object readable — readers default `[]`/`{}`); entries carry `updatedAt?` (merge falls back to `loggedAt`); per-month entries merge + **P3 dayLog union-by-id + tombstones**, 90-day GC | Immediately after every upsert/delete AND every dayLog mutator (no debounce) via `publishRecordsNow` |
| `personal-bloc:viewer:v2:<pubkeyHex>` | **Viewer Access — MODE-SHAPED (Viewer V2) + PER-VIEWER (M2).** `ViewerSnapshot` NIP-44-encrypted to EACH roster viewer's pubkey (`slot.pubkeyHex`), addressed to that viewer's own d-tag `viewerDTag(pubkeyHex)` = `personal-bloc:viewer:v2:<pubkeyHex>` — one live event per viewer (kind-30078 is per-author-per-d-tag, so a shared d-tag would overwrite). **CLEAN-CUT: the old `personal-bloc:viewer:v1` d-tag is deleted** (owner rotates + re-provisions after deploy). Default **C-safe**: `{ snapshotVersion:2, privacyMode:'safe', asOf, hasCbLoan, btcPriceAtSnapshot, thresholds, safety }` — health ratios/config/public price only, NO absolutes by construction. **C-trusted** (per-slot `tier:'trusted'`): the full `{ settings, records:{entries,deletions}, strike:{usd,btcAvail,rate}, cbCollateralBtc, strikeCollateralBtc }` + common. Pre-V2 (no `privacyMode`) reads as trusted | Fire-and-forget `void publishViewerSnapshotNow()` (M2 FAN-OUT: one publish per roster slot, `Promise.allSettled` isolation, payload built once per tier) in the success path of BOTH `publishRecordsNow` + `publishSettingsNow`, AND on a tier toggle / adding a viewer; gated on the roster being non-empty; **log-only** on failure — NEVER touches `settingsDirty`/`recordsDirty`/`nostrReconnectNeeded`/`nostrSyncing`. **Revoke** (`publishViewerRevocationNow(pubkeyHex)`, PER-SLOT) publishes THAT viewer's d-tag with an empty payload + `revoked: true` (tombstone) → the viewer wipes + exits (checked before the mode branch; replaceable, supersedes the old snapshot) |

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
- **`src/lib/nostr/viewerKey.ts`** — `deriveViewerKeyFromNsec(ownerSk, ownerPubkeyHex, keyVersion, index)` (M2:
  4-arg, per-slot-indexed — label `personal-bloc/viewer-key/v${keyVersion}/i${index}`; see the Key Files entry
  for the HKDF formula + counter-bump). Deterministic in (ownerSk, ownerPubkeyHex, keyVersion, index).
- **Key version** — ⚠ **SUPERSEDED at Multi-viewer M1 (store v21):** the global `viewerKeyVersion` scalar is
  GONE — the version byte is now **per-slot** (`ViewerSlot.keyVersion`, part of the synced `viewers` roster;
  rotation bumps a single slot's version). Historically (v1→handoff-v4) it was a standalone synced setting
  stripped from the viewer snapshot; it's absorbed into the roster, which is stripped wholesale.
- **Owner affordance** — ⚠ **the `GenerateViewerKeyBlock` component + its replace-guard/rotation described in
  the next three bullets are SUPERSEDED by Multi-viewer M3** (`ViewerRoster`, per-slot add/rotate/remove,
  replace-guard deleted — see the M3 section). The historical single-slot design (kept for context):
  **`GenerateViewerKeyBlock`** — LOCAL-SIGNER-ONLY (gated
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
  encrypted and decrypted strings permanently disagree. ⚠ The passphrase is **DEBOUNCED 3000ms**
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
  (rewritten at M1 — the roster `viewers`/`nextViewerIndex` IN `buildSettingsPayload`, OUT of the trusted snapshot
  settings + plan backup, per-tier build). SETTINGS_FIELDS count 39 → **36** at Multi-viewer M1 (−5 scalars +2 roster).

### Multi-Viewer M1 — sharing roster replaces the single-viewer scalars (store v20→v21)

The first milestone of multi-viewer support. **Store-only** — indexed key derivation, per-viewer d-tag publish
fan-out, and the SharingPage roster UI are later milestones (M2/M3). The 5 single-viewer scalars
(`viewerNpub`/`viewerPubkey`/`viewerLabel`/`viewerPrivacyTrusted`/`viewerKeyVersion`) become a
`viewers: ViewerSlot[]` roster + a monotonic `nextViewerIndex`, both synced settings. **Clean-cut, NO
back-compat** (the only existing viewer was a test key): migration DROPS the old scalars and starts the roster
EMPTY; the owner re-adds viewers fresh.

- **`ViewerSlot`** (`useStore.ts`, exported) `= { index, pubkeyHex, npub, label, tier: 'safe'|'trusted', keyVersion }`.
  `index` is stable + monotonic (never reused after removal — `nextViewerIndex` never regresses). `pubkeyHex` is
  the NIP-44 encrypt target; `tier`/`keyVersion` are per-viewer.
- **Setters** `addViewerSlot(Omit<ViewerSlot,'index'>)` (assigns `index = nextViewerIndex`, increments),
  `updateViewerSlot(index, patch)` (merge by index), `removeViewerSlot(index)` (filter by index) — each
  `syncSettingsToNostr()` (existing convention).
- **Payload/strip:** `viewers` + `nextViewerIndex` join `buildSettingsPayload` + `SETTINGS_FIELDS` (count 39→**36**),
  and are STRIPPED from the trusted `buildViewerSnapshotPayload` settings (the roster invariant — a viewer never
  sees who else the owner shares with, tiers, or key versions) AND from `exportPlan.ts`'s plan backup. The safe
  snapshot branch carries no settings block at all.
- **Tier source (M1 slot-0 — ⚠ SUPERSEDED by M2):** M1 read `s.viewers[0]?.tier` inside
  `buildViewerSnapshotPayload` and targeted `s.viewers[0]?.pubkeyHex`. M2 replaced this: the tier is an explicit
  param `buildViewerSnapshotPayload(s, tier)` and `publishViewerSnapshotNow` FANS OUT one encrypted publish per
  slot on `viewerDTag(pubkeyHex)`; `publishViewerRevocationNow(pubkeyHex)` is per-slot. (See the M2 section.)
- **Skip-guard (`hydrateSettings`, mirrors the relay guard):** an EMPTY incoming `viewers` never clobbers a
  populated local roster — skips BOTH `viewers` + `nextViewerIndex` (so the counter can't regress); a populated
  incoming roster hydrates. Publish-side is already covered by `initialSettingsPullDone` (Fix C/D).
- **Component slot-0 adapters (⚠ SUPERSEDED by M3 for SharingPage — the roster UI shipped):** `SharingPage`'s
  slot-0 grant card + `GenerateViewerKeyBlock` are gone (→ `ViewerRoster`, see the M3 section); `DevPanel`
  (`viewers[0]?.pubkeyHex`) + `ViewerPreview` (tier/label from `viewers[0]`) stay slot-0 reads. `clearViewerData`
  resets `viewers: []`/`nextViewerIndex: 0`.
- **Migration v21** (`migrateState`): strip the 5 old keys from the `...rest` destructure; seed `viewers: []` +
  `nextViewerIndex: 0` unconditionally; `version: 20 → 21`. Tests: `viewerRoster.test.ts` (migration drop/empty,
  setter monotonic-index/no-reuse/merge, skip-guard) + the rewritten `viewerSnapshot.test.ts` (per-tier build +
  roster strip). Suite 592 → 601.

### Multi-Viewer M2 — indexed derivation + per-viewer d-tag publish fan-out (store stays v21)

The PLUMBING for N viewers (the roster UI stays slot-0 until M3). Kind-30078 is parameterized-replaceable (one
live event per author+d-tag), so N viewers on one d-tag would overwrite each other. M2 makes derivation
per-slot-indexed and publishing per-viewer-addressed. **CLEAN-CUT: no old-label / no old-d-tag compat** — after
deploy the owner rotates slot 0 and re-provisions the (test) viewer device.

- **Derivation (`viewerKey.ts`):** `deriveViewerKeyFromNsec(sk, ownerPubkeyHex, keyVersion, index)` — 4-ARG,
  index required; info `personal-bloc/viewer-key/v${keyVersion}/i${index}` (counter-bump unchanged). Each roster
  slot derives a distinct key at the same keyVersion; keyVersion is per-slot (rotation bumps it). Regression pin:
  the new label is NOT reproducible by the old index-less `…/v${version}` label (tested with a local HKDF helper;
  the old code path is gone).
- **Addressing (`publish.ts`):** `viewerDTag(pubkeyHex) = 'personal-bloc:viewer:v2:' + pubkeyHex`. `VIEWER_DTAG`
  (v1) is DELETED. `publishViewerSnapshot` computes `viewerDTag(viewerPubkey)` internally (covers snapshots +
  revocation tombstones).
- **Fan-out (`publishViewerSnapshotNow`, useStore):** iterates `s.viewers` (empty ⇒ no-op, same gate shape);
  builds the payload **once per distinct tier** (`Map<tier, ViewerSnapshot>`, at most 2 builds) via
  `buildViewerSnapshotPayload(s, tier)` — the tier is now an **explicit required param** (the M1 slot-0 read is
  removed; it moved into the loop). Encrypts N times: `Promise.allSettled(viewers.map(slot =>
  publishViewerSnapshot(signer, slot.pubkeyHex, payloadFor(slot.tier), …)))` — **failure isolation**, one slot's
  relay failure never aborts the rest. Per-slot reporting is automatic: each publish pushes its OWN
  `PublishReport` labeled by `viewerDTag(slot.pubkeyHex)` (distinct per viewer); a final `nostrLog('info',
  'viewer fan-out: N ok / M failed')`.
- **Revocation (`publishViewerRevocationNow(viewerPubkeyHex)`, useStore):** PER-SLOT — takes the target pubkey
  (was slot-0), tombstones only that viewer's d-tag. `SharingPage.revoke` captures `slot0.pubkeyHex` before
  `removeViewerSlot`.
- **Viewer side (`viewerSync.ts`):** new `getViewerPubkeyHex()` (the viewer's own pubkey from the in-memory
  holder); the subscription/fetch filter uses `'#d': [viewerDTag(myPubkeyHex)]`. `DevPanel`'s two probes moved to
  `viewerDTag` (owner probe → `viewers[0].pubkeyHex`; viewer probe → `getViewerPubkeyHex()`).
- **SharingPage derive:** add-path derives with `index = nextViewerIndex` (the value `addViewerSlot` WILL assign
  — coupling commented); rotate-path with `slot.index` + the bumped `slot.keyVersion`.
- **`ViewerPreview` safe-force:** now `buildViewerSnapshotPayload(state, 'safe')` (the required tier param
  replaced the `{ ...state, viewers: [] }` spread — fidelity preserved).
- Tests: `viewerKey.test.ts` (index domain separation + regression pin), `viewerFanout.test.ts` (NEW — 2-tier
  fan-out to the right pubkeys, once-per-tier reference-equal build, `allSettled` isolation, per-slot revocation),
  `viewerSync.test.ts` (`#d` = `viewerDTag(myPubkey)` + v2 shape), and the tier-param call-site updates in
  `viewerSnapshot.test.ts`/`relaySync.test.ts`. Suite 601 → 610.

### Multi-Viewer M3 — SharingPage roster UI (owner-mints-only; store unchanged v21)

The UI catches up to the M1/M2 plumbing: the slot-0 grant card + `GenerateViewerKeyBlock` are replaced by a
`ViewerRoster` that lists N viewers. **The owner MINTS every viewer key — there is no other add path** (the
legacy npub-paste "Add" form is DELETED; a viewer-supplied npub can't occur since Handoff v4).

- **`ViewerRoster`** (`SharingPage.tsx`, LOCAL-SIGNER-gated — the whole block, since every action derives from
  the raw owner sk; a non-local device shows a note, share-code + preview stay ungated) — one `.grantCard` per
  `viewers` slot: label · truncated npub · tier chip · a per-row "Show real figures" `<Toggle>`
  (`updateViewerSlot(slot.index,{tier})` + `publishViewerSnapshotNow()`) · **↻ Rotate** · **Remove** (inline
  `confirmRemoveIndex` → `publishViewerRevocationNow(slot.pubkeyHex)` + `removeViewerSlot`). Below it an ADD block
  (label + Safe|Trusted picker + optional passphrase + "🔑 Add viewer").
- **ONE shared derive engine (`doDerive`)** for add + rotate. `rotatingIndex: number | null` (null ⇒ ADD)
  carries the intent through the PIN step. ADD: `index = nextViewerIndex` (the same value `addViewerSlot` will
  assign — M2 coupling), `keyVersion = 1` → `addViewerSlot({…,tier:addTier,keyVersion:1})`. ROTATE(slot) is ATOMIC
  (derive-at-target, commit-on-success — NO pre-bump): confirm → `doDerive` derives at the TARGET version
  (stored kv + 1) → ONE atomic `updateViewerSlot(slot.index,{pubkeyHex,npub,keyVersion})` on success (preserves
  tier) → `publishViewerRevocationNow(oldPubkeyHex)` (revoke the OLD d-tag so the old viewer device wipes + exits
  to the waiting gate on its next live event / reconnect — the Remove mechanism); cancel/failure = true no-op
  (slot untouched, old key keeps working). `keyVersion` always means "version of the key currently issued," never
  "next." Both: unwrap → `deriveViewerKeyFromNsec(pk, keyVersion, index)` → `publishViewerSnapshotNow()` (fan-out)
  → `SecretKeyCard` token reveal (~30s, keys zeroed). **Handoff tokens are ALWAYS ncryptsec** — a passphrase is
  REQUIRED for BOTH add and rotate (empty → inline error BEFORE the unwrap, nothing derived/published; the
  R2c-7a-2 no-unprotected-key-artifacts doctrine); there is NO plaintext-nsec branch.
- **REPLACE-GUARD + `skipGuard` DELETED** — ADD always uses a fresh index (nothing to overwrite); ROTATE is the
  only intentional overwrite and is confirmed by its own dialog. (Supersedes the handoff-v4
  `GenerateViewerKeyBlock` replace-guard.)
- **Preview trigger UNCHANGED** — `ViewerPreview` already carries its own Safe|Trusted override toggle, so it
  renders either tier on demand; no tier selector at the trigger, ViewerPreview untouched. (Residual: its
  "actual" baseline reads `viewers[0]?.tier` — a generic tier lens, not per-specific-viewer; acceptable.)
- **CSS:** reuses all existing classes; only new rule `.rowActions` (flex row for Rotate+Remove + the tier
  picker). **Tests:** none (UI; store logic unchanged) — suite stays 610.

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
- **`buildViewerSnapshotPayload(s, tier)`** (M2 — required tier param) = the mode-shaped payload (see Viewer V2).
  `publishViewerSnapshotNow()` FANS OUT (M2): one `publishViewerSnapshot` per roster slot, each sealed to
  `slot.pubkeyHex` on `viewerDTag(slot.pubkeyHex)` = `personal-bloc:viewer:v2:<pubkeyHex>` (the v1 d-tag is
  deleted), payload built once per tier, `Promise.allSettled` isolation. Fire-and-forget, log-only — see the
  Published Event Types table.
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
  filtered `{ kinds:[30078], authors:[viewerWriterPubkey], '#d':[viewerDTag(getViewerPubkeyHex())] }` (M2 —
  the viewer's OWN d-tag; SINGLE filter at 2.23.5).
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

### All 37 Synced Settings Fields
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
`nostrRelays`, `backupVerifiedAt`, `viewers`, `nextViewerIndex`
(`backupVerifiedAt` (R2a-1) is synced so the backup attestation travels with the plan (an imported/external peer
device sees it). ⚠ It does NOT un-gate a gated peer — a gated device runs no sync at all, not even a pull, and
needn't, since only the sole GENERATING device is ever gated. It is a **ONE-WAY LATCH** on hydrate (an incoming `null` never clobbers a latched local value —
the third member of the whole-object-LWW skip-guard class alongside `nostrRelays`/`viewers`), STRIPPED from the
trusted viewer snapshot (the owner's key-custody state is not the viewer's business), and RETAINED in the plan
backup (a restore lands on a device whose `keyProvenance` is null → satisfied → harmless). Its partner
`keyProvenance` is device-local and NEVER synced — see § Backup Gate.
`viewers` + `nextViewerIndex` (Multi-viewer M1, store v21) are the sharing roster — they REPLACE the 5 old
single-viewer scalars (`viewerNpub`/`viewerPubkey`/`viewerLabel`/`viewerPrivacyTrusted`/`viewerKeyVersion`), which
were dropped clean-cut. Each `ViewerSlot` = `{ index, pubkeyHex, npub, label, tier: 'safe'|'trusted', keyVersion }`;
`nextViewerIndex` is monotonic (an index is NEVER reused). Both sync across the owner's devices so the roster +
removals propagate, but are STRIPPED from EVERY viewer snapshot (a viewer must never learn who else the owner shares
with, their tiers, or key versions) AND from the plan backup. `hydrateSettings` GUARDS them: an EMPTY incoming
`viewers` never clobbers a populated local roster (skips both `viewers` + `nextViewerIndex` so the counter can't
regress — mirrors the relay guard). Per-tier snapshot: `buildViewerSnapshotPayload` reads `viewers[0]?.tier` (M1
single-viewer / slot-0; M2 fans out per-viewer on their own d-tags). The two CB `asOf` markers sync so freshness travels atomically with `cbLoanBalance`/`cbLiquidationPrice`.
`nostrRelays` (Option C) syncs across the OWNER's devices — identical-lists / replace-on-hydrate (add + remove both
propagate). `hydrateSettings` GUARDS it: a default-looking incoming list (empty OR exactly `DEFAULT_RELAYS`,
order-independent sorted compare) never overwrites a non-empty custom local list — skips ONLY that field, applies the
rest (skip-FIELD, not skip-all). Tradeoff: a deliberate reset-to-defaults doesn't auto-propagate (restore per-device).
User edits publish on their OWN via `setNostrRelaysAndSync` (the plain `setNostrRelays` stays for boot discovery) —
and Restore-defaults DOES publish `DEFAULT_RELAYS`, so the receiver-side guard is the load-bearing protector that keeps
that from wiping the other device's custom list (guard + trigger are complementary).
STRIPPED from `buildViewerSnapshotPayload` (owner transport config — a viewer reads via its own relay set).
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
| `keyProvenance` | `'generated' \| 'imported' \| 'external' \| null` | ✅ (device-local; **standalone-backed** via `GATE_PROVENANCE_KEY`) | R2a-1 backup gate. **WRITE-ONCE** (`null` = identity-teardown clear). **NEVER synced.** `null` = legacy plan = gate satisfied (structural, no migration). R2c-6-final: also written through to standalone localStorage (`personal-bloc-provenance`) + read by `gateHydratedIdentity` so it survives the escape hatch (bypass 1); wiped by `wipeLocalPlanData`. See § Backup Gate / § Remanence |
| `backupVerifiedAt` | `number \| null` | ✅ | R2a-1 backup gate. **SYNCED** (in SETTINGS_FIELDS/payload) so verifying on one owner device un-gates the others; **ONE-WAY LATCH** on hydrate; STRIPPED from the trusted viewer snapshot. Setter marks `settingsDirty` + wakes `syncNow` |
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

## Event-Sourcing Migration — Phase 4 (plan-events campaign; store unchanged, NO bump through 4c)

Phase 4 replaces whole-object LWW settings sync with an append-only **plan event log** folded into state
(design authority: the 4a plan-events design lock — event shape / fold / compaction / union / genesis).

- **4a-inst** (SHIPPED): `PublishReport` gains `eventBytes`/`plainBytes` (see `publish.ts` Key Files + the
  `PublishReport` doc above), surfaced in DevPanel PUBLISH ACKS + a new PAYLOAD SIZES block, to confirm the
  relay payload-size budget with real data before any migration. This IS the lock's §8 `contentBytes`
  instrumentation, shipped as the two `*Bytes` fields. No publish/quorum/ack/store logic touched.
- **4b** (SHIPPED): the PURE core — `src/lib/planEvents/{types,fold,compact,genesis}.ts` (leaf modules;
  runtime import only from `store/settingsFields`) + the `PREFS_FIELDS`/`PLAN_EVENT_FIELDS` partition (see
  the settingsFields entry) + a Suite-3 viewer shape-lock comment. ZERO wiring. Invariant: kind:'set' only,
  absent-from-log = seed default, set-to-empty = an event (§6).
- **4c** (SHIPPED — THE HARD CUTOVER): every plan-field setter now EMITS a `PlanEvent` instead of marking
  `settingsDirty`; a `plan-events:v1` channel publishes the log; a **one-way BRIDGE** keeps writing
  `settings:v1` (from current state ≡ fold output under D2 single-writer) so a rollback stays lossless;
  genesis synthesizes the initial log from `settings:v1` strictly AFTER the first pull. **Store unchanged
  (5 additive device-local fields with merge defaults, NO bump).**

  | d-tag | Content | Semantics |
  |---|---|---|
  | `personal-bloc:plan-events:v1` | `{ events: PlanEvent[] }` NIP-44 self-encrypted | append-only · union-by-id · fold-to-state · compaction; NO watermark gate (order-independent) |
  | `personal-bloc:prefs:v1` | `{ tabOrder, hiddenTabs, simpleMode, btcBuyingUnit }` | tiny whole-object LWW (device-taste; stale clobber cosmetic) |
  | `personal-bloc:settings:v1` | write-through BRIDGE (fold output) | published-not-read-as-authority on a migrated device; retired at 4e |
  | `personal-bloc:records:v1` | unchanged | unchanged |

  - **Emit layer (`syncSlice.ts`):** `emitPlanSets(pairs)` — ONE atomic set of the scalar writes + appended
    events (all sharing ONE ts via `nextPlanEventTs(maxPlanTs(log))` → AsOf pairs can never tear) + `planDirty`,
    then a dynamic-import `schedulePlanPublish` kick. Auth-UNGATED (pre-auth edits accumulate; publish is fully
    gated in the engine). `applyPlanFold(folded)` = the pull-side RAW derived-scalar apply (no event/dirty).
    `emitPrefs(patch)` = set + `prefsDirty` + `schedulePrefsPublish`. **All 39 `syncSettingsToNostr()` callers
    converted** (grep-empty outside `syncSlice`'s retained definition; the 2 test hits exercise that retained
    definition). Clarifications: `setCbLoanBalance`/`setCbLiquidationPrice` are plan-SINGLE (their AsOf fields
    have their own setters); only `setAdvisorActualBlocBalance` is a true paired-AsOf; plain `setNostrRelays`
    stays RAW (boot discovery); `setBackupVerifiedAt` null-branch stays RAW, its pre-auth stamp is field-only
    (NO event — rides genesis; **residual: a fresh key verified pre-auth never syncs the attestation as an
    event — healed by any authed re-verify; gate semantics unaffected**), its authed stamp emits.
  - **Engine (`syncEngine.ts`):** `publishPlanEventsNow` (gate + Fix A → compact → `setPlanEvents` → publish →
    success: THE BRIDGE `void publishSettingsNow()` [chains the viewer fan-out] + `checkPlanParity`);
    `publishPrefsNow`; `schedule{Plan,Prefs}Publish` (2s debounce). **Bridge is acyclic** (`plan → settings →
    viewer`, no back-edge). **`checkPlanParity` compares FOLD-PRESENT KEYS ONLY** — absent-from-log keys are
    seed defaults, never compared (§6; the `pickPlanFields` guard fields stay absent by DESIGN), else every
    sparse-log device reads DIVERGED forever + poisons the 4e "parity green" precondition.
  - **Pull (`sync.ts` + `liveSync.ts` filters += both d-tags):** a plan-events branch BEFORE settings
    (union+fold+`setPlanEvents`+`applyPlanFold`; local ⊃ remote → repair republish); a prefs branch; **THE
    DUAL-READ STRIP** — once `planEvents.length > 0`, strip `PLAN_EVENT_FIELDS` from incoming `settings:v1`
    before `hydrateSettings` (the fold owns the partition; settings:v1 is bridge-echo). `fetchAndSync` returns
    += `sawPlanEvents`/`sawSettingsV1`.
  - **Genesis (`syncNow.ts`):** after the pull + `initialSettingsPullDone`, if `planEvents.length===0 &&
    !sawPlanEvents && sawSettingsV1` → `synthesizeGenesisEvents(pickPlanFields(state), …)` + `planDirty`.
    **`pickPlanFields` replicates the three `hydrateSettings` skip-guards at the genesis boundary** (drops
    null `backupVerifiedAt`, empty `viewers`+`nextViewerIndex`, default-looking `nostrRelays`) because the
    fold has NO equivalent latch/roster/relay guard — a raw genesis would emit a fold-winning null/empty that
    clobbers a peer (RISK-2). A fresh key (no settings:v1) → NO genesis (its log accrues from the first edit);
    idempotent. **Residual (RISK-4, documented):** a plan setter firing pre-first-pull → genesis skipped; no
    real boot path does this, local state + the bridge stay correct.
  - **`applyPlanBackup`:** the APPLY_FIELDS loop fuses plan scalars + appended events into its ONE atomic set
    (planDirty + recordsDirty, NO settingsDirty; `backupVerifiedAt` stays APPLY_FIELDS-excluded).
  - **DevPanel:** a PLAN EVENTS section (event count raw/compacted, planDirty/prefsDirty, sync ages, parity)
    + `plan events`/`prefs` PAYLOAD SIZES rows. Metadata-only.
  - ⚠ **NOTHING deleted:** `syncSettingsToNostr` (caller-less), `settingsDirty`, Fix C/D, the three
    hydrateSettings skip-guards, `lastSettingsSyncAt` + its apply-gate all STAY as rollback insurance — retired
    at 4e with quotes.
- **4d** (SHIPPED): the read path was already v2-first structurally at 4c (plan-events branch first + the
  settings:v1 strip). 4d INSTRUMENTS the v1 fallback: `lastV1FallbackApplyAt` (device-local, unix seconds) is
  stamped ONLY in the settings:v1 branch's empty-log `else` (the un-stripped apply — the genuine fallback); the
  strip path / prefs branch / plan-events branch stamp nothing. A device stamps ONCE while its log is empty (its
  migration/join pull; genesis then fills the log in the same syncNow), then never again (the strip fires). The
  4e soak clock STARTS at this release: fence only after `lastV1FallbackApplyAt` shows no post-migration stamps
  for ≥1 week AND parity stays OK. DevPanel PLAN EVENTS gains a `v1 fallback` row (never=green / stamped=amber);
  the fallback + guard class are deleted together at 4e. No behavior change, no store bump.
- **4e** (NOT built): stop the bridge → delete the guard class + the v1 fallback.

---

## Critical Constraints

| Constraint | Rule |
|---|---|
| Backup ceremony stamps once, self-waking | `RecoveryKeyCeremony` stamps verification via `setBackupVerifiedAt(Date.now(), nostr)` and **nothing else** — the setter's own `settingsDirty`+`syncNow` wake un-gates sync. **Never add a second dirty/publish** at the call site. The ceremony is the ONLY verified stamp; `OwnerKeySetup`'s pre-auth stamp is the interim bridge (retired in R2c-2) |
| Every masked field goes through `ui/PassphraseInput` | Never hand-roll an `<input type="password">`. The shared widget bakes in the four iOS suppressions (an autocapitalized passphrase never decrypts) and the `onPointerDown`+`preventDefault` focus guard (an onClick-only toggle blurs the field and collapses the iOS keyboard mid-entry). A `grep -rn 'type="password"' src` must return ONLY `AppUnlockGate.tsx` + `StoreMigrationGate.tsx` — both unrendered, retained as the Option-3a rebuild basis. PINs use it too, passing `inputMode="numeric"` so the keypad survives reveal |
| NEVER collapse the sign-out dispatch to `external → reconnectNostr` | `reconnectNostr` retains `nostrPubkey`, and `useNostrAutoRestore` early-returns only for `'local'` and for `(nip46 && !nostrLogin)` — so a **nip07** session falls through to `setIsAuthenticated(true)` → `restoreSigner` → `NLogin.fromExtension()`, which an authorized extension answers **silently**. Sign out would reload and leave the user signed in: a control that visibly does nothing. `signOut()` therefore routes `nip07 → disconnectNostr` (the only teardown auto-restore can't undo), `nip46 → reconnectNostr`, `local → signOutLocal`. This is not "the harder action" for nip07 — **destructiveness is a property of what's at stake**, and a nip07 user has no on-device key; the cleared fields re-stamp on the next one-approval login. Pinned by `disconnect.test.ts` ("'nip07' → disconnectNostr, NOT reconnectNostr") |
| An identity-forget must never leave the plan blob readable | Clearing identity *fields* is not forgetting an identity. AppShell's auth gates all condition on `nostrAuthEnabled` — once false, the ladder falls through to Branch J and renders **whatever is in the persist blob** to whoever opens the tab next. So `disconnectNostr` (and "Remove local key", which delegates to it) calls **`wipeLocalPlanData()` as its LAST mutation before `reload()`** — zustand's persist writes the blob synchronously on every `set()`, so a store setter placed after the wipe resurrects it. Removing `personal-bloc-onboarded` is what produces the fresh entry fork; **wiping only `personal-bloc-store` does not**, because `onboardingComplete` is standalone-seeded at module init. **Never sweep by `personal-bloc-` prefix** — `bloc-device-tag` and `bloc-nostr-log` don't carry it. Sign-out (`signOutLocal`, nip46 `reconnectNostr`) must NOT wipe: the same user returns to the same plan behind the lock. Pinned by `disconnect.test.ts` + `wipeLocalPlanData.test.ts` |
| Sign out must NEVER clear `keyProvenance` / `backupVerifiedAt` (local) | These two are what `isBackupGateSatisfied` reads. Clearing them on sign-out would re-gate sync and resurrect the backup nag **every time a verified user unlocks** — turning a reversible action into a repeated interrogation. `signOutLocal` (→ `reconnectNostr`) retains them, along with the identity and the wrapped key; only `disconnectNostr` and "Remove local key" clear them, because those destroy the identity. **The two exits must also READ as different weights** — "Sign out" is neutral (`.signOutBtn`), "Remove local key" is red (`.nostrDisconnectBtn`) — since a user who mistakes the destructive one for sign-out loses their only on-device key. Pinned by `disconnect.test.ts` |
| ✅ FIXED (P0) — every unlock surface for a `scheme:'pin'` key MUST collect and forward the PIN | `restoreSigner(nostr, pin?)` forwards the pin to `unwrapSecretKey(wrapped, meta, pin)`, which **already accepted it** (keyVault unchanged) and ignores it for a PRF key. Both unlock surfaces branch on `writerKeyWrapMeta?.scheme === 'pin'` and render a PIN `PassphraseInput`: `LocalUnlockGate` and `NostrAuthGate.handleUnlockExisting` (#6). Before this, `restoreSigner` passed **no pin** and `LocalUnlockGate` rendered **zero inputs**, so keyVault threw `'PIN required'` → the gate showed a bare `Unlock failed` → **total lockout**, exitable only through the destructive escape hatch. Reachable via OwnerKeySetup's K3 PIN fallback or any browser without a platform authenticator. **Any NEW unlock surface must do the same** — `useNostrAutoRestore` deliberately skips `'local'` (unlock needs a gesture), so it needs no pin |
| ⚠ The `restoreSigner` single-flight guard is PIN-AWARE — do not simplify it back | `syncNow` calls `restoreSigner(nostr)` with **no pin**, and it can run concurrently with the unlock gate (the Bug-2 history). For a `scheme:'pin'` key that pinless promise is **already doomed** (`'PIN required'` → caught → `null`). A plain `if (restoreInFlight) return restoreInFlight` would hand the user that doomed promise and report failure **on a correct PIN**. Rule: **a pin-bearing call never joins a pinless in-flight restore**; every other combination shares as before (a pinless `syncNow` joining a pinned unlock is desirable — it gets the real signer). WebAuthn's one-ceremony rule is preserved because the PRF path never passes a pin, so two PRF callers always match and always share; the only case that starts a second worker is pin-scheme, which runs PBKDF2, not WebAuthn. The in-flight `.finally` carries an **ownership check** so a superseded promise can't null the slot its replacement owns. Only a `boolean` is held at module scope — never the pin. Pinned by `restoreSignerSingleFlight.test.ts` |
| A bare nsec must save an encrypted backup BEFORE it establishes | R2c-7a-2: the `nsec` branch of `handleLocal` captures the sk and returns; establishment happens only from the remediation step's Continue, gated on `bareNsecSaved`. The friction is the point twice over — the app refuses to swallow an unprotected key, and the step *produces* the encrypted backup the user demonstrably lacked (it is also R2c-7a's second producer). ⚠ **The gate is on WHEN, not WHAT:** a bare nsec still wraps `payloadKind: 'sk'` — a raw key has no mnemonic. `'encrypted'` (already protected) and `'words'` (richer artifact) skip remediation and fall through unchanged. Never route them through it |
| A held key buffer is zeroed on success/teardown, NEVER in an establish `finally` | `establishLocalOwner` **wraps and persists `writerKeyWrapped` before deriving the pubkey**, then zeros its argument on success *and* on failure. So always pass a `.slice()`, and zero the long-lived buffer only on success, Back, scrub, and unmount. Zeroing it in the `finally` means a cancelled Face ID wipes it in place and the user's **retry** wraps 32 zero bytes — a corrupted credential for an identity that never existed (pinned by `src/lib/__tests__/bufferAliasing.test.ts`). Applies to `decryptState.sk` (R2c-7a) and `pendingSkRef` (R2c-7a-2) alike |
| `nip49.encrypt` is ~1s of SYNCHRONOUS scrypt — yield before it | Setting `encrypting` state and calling `nip49.encrypt` in the same tick means React never commits the "Encrypting…" render; the button just freezes. Every encrypt site (`RecoveryKeyCeremony.ensureArtifact`, `NostrAuthGate.buildEncryptedBackup`) does `setEncrypting(true)` → `await new Promise(r => setTimeout(r, 30))` → encrypt. A `prepRef` stale-guard is needed only where inputs stay live during the yield; a one-shot tap with `disabled={encrypting}` inputs does not need one |
| A hook may never sit to the right of `\|\|`, `&&`, or `?:` | Short-circuit evaluation makes it a **conditional hook**, and the hook count changes the render the left operand flips — React #311. This is how `OwnerKeySetup`'s `hasExistingKey = !!useStore(…writerKeyWrapped) \|\| !!useStore(…nostrPubkey)` crashed onboarding the instant `establishLocalOwner` set `writerKeyWrapped`. Assign each `useStore` to its own `const` on its own line, then combine the VALUES. ⚠ Neither `tsc -b` nor a grep for indented/after-return hooks catches this shape (both calls sit on one line at normal indentation), and there is no render harness — so it is invisible until it crashes on device. The repo is currently clean of it (grep: hooks after `\|\|`/`&&`/ternary → none) |
| Reproducing onboarding-transition crashes | `npm run dev` DOES reproduce bugs inside `OnboardingModal`/`OwnerKeySetup` — they render regardless of AppShell's gate ladder. But every AppShell gate branch is suffixed `&& !import.meta.env.DEV`, so a crash in the **auth/viewer gates** will NOT reproduce in dev; that needs a scratch neuter of those suffixes (never committed). Headless chromium has no platform authenticator → `probeKeyVaultCapability()` returns `'pin'`, so the whole mint→protect flow is driveable end-to-end **without a passkey** |
| Never claim plan-data encryption-at-rest before Phase 5 | Two different things are encrypted, and the copy must not conflate them. The **KEY** is always keyVault-wrapped (passkey/PIN) — unconditionally true. **Plan DATA is plaintext at rest today** (`storeEncEnabled` off by default; default-on is Phase 5). `NostrAuthGate`'s import notice once said "this stores an encrypted copy on this device… all your **encrypted data** is permanently unrecoverable" — false, and it made a security promise the code didn't keep. Any copy touching at-rest posture states only that the key is protected and that this is **not a backup** |
| No attestation checkbox on the IMPORT path | Importing means the user is pasting a key they already hold — **the paste IS the proof of possession**, so "I have my key backed up" attests to nothing and trains reflexive ticking, eroding the acks that DO mean something. `localCanContinue` gates only on a valid RESOLVED key per tab (words checksum / nsec decode / ncryptsec decrypted) + a confirmed PIN when there's no passkey. ⚠ `OwnerKeySetup` K2 no longer has an ack (R2c-6a — replaced by a real save+quiz verification); the IMPORT path still never gets an attestation checkbox. Never add one to import |
| The ceremony verifies the artifact the user SAVED, not the one on screen | Verify branches on `verifyEncrypted` (a snapshot of `encryptOn` taken at Continue-time in `goVerify`). PLAINTEXT → the word quiz / nsec last-6. ENCRYPTED → **passphrase re-entry**, because the saved artifact is a passphrase-locked ncryptsec and the words on the grid are not what they saved — a forgotten passphrase is the only thing that can lose the plan. **Never quiz the words on the encrypted path.** `checkBackupPassphrase` **trims both sides** (the ceremony encrypts with `filePass.trim()`, so the trimmed passphrase is what opens the file; comparing untrimmed false-mismatches a re-entry that would decrypt it perfectly). The `setBackupVerifiedAt` stamp is byte-identical across both paths — only the comparison before it differs |
| No save, no Continue | `savedOnce` gates `Continue` in the reveal step; it is set by `doDownload` / `downloadQR` / a **resolved** `share` (an iOS share-sheet cancel rejects with `AbortError` and must not open the gate — and guard `if (!navigator.share) return` FIRST, since `await navigator.share?.()` resolves `undefined` and would open it). ⚠ It **resets inside `invalidateArtifact`**: the same change that stales the cached artifact stales what the user already saved (download plaintext → toggle encrypt ON → the file on disk is not the encrypted backup they're about to be quizzed on). Without this gate a user walks the ceremony, answers the quiz off the on-screen grid, and stamps `backupVerifiedAt` with the key living only in RAM — the gate that un-gates sync satisfied by nothing |
| `RevealRecoveryKey` is view-only | It reveals words/nsec for inspection and **NEVER** verifies or stamps `backupVerifiedAt` — that is the ceremony's job. It is the utility; the ceremony is the flow. Both branch on `payloadKind` (entropy → words, sk → nsec) via `unwrapRecoveryPayload`, never `unwrapSecretKey` |
| Ceremony idempotency | An already-stamped user (bridge-era or a prior ceremony) MUST run explain→reveal→verify→done end-to-end as a re-verify — never a dead end; success re-stamps (monotonic-forward). The explain step shows a `Backed up ✓ <date>` chip but does not short-circuit |
| `fetchAndSync` return shape | `{ ok, planFound }`, not a boolean. `planFound` is computed from `latestByDTag` **before** the decrypt loop and is INDEPENDENT of `ok` — a decrypt failure with events present must stay `planFound: true`, or an unreachable signer fires the "no plan found on this key" notice at a user whose plan is sitting right there |
| Import `payloadKind` is THREE-WAY asymmetric: **words → `'nip06-entropy'`, nsec → `'sk'`, ncryptsec → `'sk'`** | **By construction.** `NostrAuthGate.handleLocal` passes `payloadKind: 'nip06-entropy'` for the words branch (R2c-4b) — we store the 16 bytes *behind* the phrase so `RevealRecoveryKey` + the R2c-1 ceremony can re-derive and word-quiz the user's ACTUAL words. Identity is preserved because the NIP-06 path is deterministic: `deriveSkFromEntropy(entropyFromWords(w)) === skFromWords(w)` (pinned by `nip06Key.test.ts` + `establishOwner.test.ts`). The **nsec** branch stays `'sk'` **forever** — a raw secret key has **no mnemonic**, so there is nothing to re-display and `unwrapRecoveryPayload` correctly falls back to nsec display. The **encrypted (ncryptsec, R2c-7a)** branch inherits the nsec case exactly: NIP-49 decrypts *to* a raw secret key, so no phrase ever existed and none can be shown. ⚠ The words rule **SUPERSEDES the R2b-2 rule** ("imported words wrap the derived sk … do not fix this into entropy storage") — correct then, because no ceremony existed to verify words; R2c-1 shipped one, which is exactly what justifies the reversal. **No migration:** users who imported words *before* R2c-4b still hold an `'sk'` ciphertext (we'd need their phrase to convert) and keep seeing an nsec — the absent⇒`'sk'` compat contract covers them |
| Never auto-strip a handoff token's `:npub` suffix | A pasted `<keyPart>:<ownerNpub>` in the Recovery-key tab is **rejected**, not repaired: the key inside a `SharingPage` token is a **viewer** key (`deriveViewerKeyFromNsec`), so stripping the suffix and importing it would silently authenticate the owner as their own viewer — a category error. Detected by `.includes(':')` (a colon is not in the bech32 alphabet, nor in 12 words), **not** `parseHandoffToken(…) !== null`, which returns null for a malformed token that would then fall through. Guarded in the render **and** in `handleLocal` |
| Malformed payload ≠ wrong passphrase | `nip49.decrypt` runs every structural check (bech32 → prefix → version) **before** scrypt, so only the final AEAD step can fail on the passphrase. Two layers keep them apart: `isWellFormedNcryptsec` gates whether the passphrase field appears at all, and `classifyNcryptsecError` positive-tests `'invalid tag'` for the rest. **Never collapse them back into one `catch`** — that was the R2c-7a bug (it blamed the user for a corrupted paste). ⚠ And never render the caught `e.message`: bech32 echoes the entire ncryptsec into it |
| The encrypted branch's payload MUST be `.slice()`d | `NostrAuthGate.handleLocal`'s encrypted branch reads its sk out of **React state** (`decryptState.sk`, produced by the debounced decrypt effect). `establishLocalOwner` zeros the payload on success and the `finally` zeros it on failure, so passing the state buffer directly means a **failed** establish (Face ID cancelled) zeros it **in place** — and the retry hands `establishLocalOwner` 32 zero bytes, which it **wraps and persists to `writerKeyWrapped` BEFORE deriving the pubkey**, then throws. Net: a corrupted credential on disk for an identity that never existed. The nsec/words branches are immune only because each attempt re-derives a fresh buffer from the input string. **Never "optimize away" the copy** — R2c-7b made this rule executable in `src/lib/__tests__/bufferAliasing.test.ts`, which pins the mechanism (not the UI); deleting a `.slice()` now fails a test instead of shipping silently |
| The ceremony's save aids derive the sk from the STRINGS, never retained bytes | `RecoveryKeyCeremony` zeros the unwrapped payload the instant the display strings exist (`bytes.fill(0); // ⚠ zero NOW`), so its encrypt path re-derives via `skFromWords(words.join(' '))` / `nip19.decode(nsec).data` and zeros THAT buffer in a `finally`. Valid because `skFromWords(w) === deriveSkFromEntropy(entropyFromWords(w))` (pinned in `nip06Key.test.ts`) and the strings are already in state — deriving from them adds no new exposure. **Never retain `bytesRef` past reveal to "avoid the re-derive"**; that is `RevealRecoveryKey`'s deliberate exception (it needs bytes for its on-open Advanced-nsec), not the ceremony's |
| Encrypt is a one-shot on tap; guard the stale result | `nip49.encrypt` is ~1s of SYNCHRONOUS scrypt, so the ceremony yields 30ms for the "Encrypting…" paint — during which the toggle and passphrase field are LIVE. A monotonic `prepRef` token (plus `disabled={encrypting}`) discards a result whose inputs changed mid-flight; without it, an encrypt started under the OLD passphrase lands in the cache and Download writes a file locked with a passphrase **the user never typed**. Same hazard, same fix, as R2c-7a's `clearTimeout` on the stale in-flight decrypt. ⚠ Do NOT debounce it like the decrypt — nothing here reacts to typing, and the 5s `navigator.share` transient-activation window comfortably covers the tap→yield→scrypt path |
| The QR PNG comes from `QRCodeCanvas`, not SVG rasterization | `qrcode.react@4` forwards a real `HTMLCanvasElement` ref and draws purely from props (verified in its source), so a hidden `display:none` canvas + `canvas.toBlob()` needs no `XMLSerializer`, no `Image` load, and carries no WebKit canvas-taint risk. It must pass `marginSize={4}` (the spec quiet zone): the on-screen `QRCodeSVG` can omit it only because the white `.qrPanel` pads it, but a bare PNG would scan unreliably |
| Recovery grid is capture UX only | `recoveryGrid.ts` / `WordGrid` input mode / the checksum gate are all HINTS. `skFromWords` on submit is the sole validity authority (it normalizes + derives). Continue may gate on `phraseStatus==='valid'`, but a green box or a ✓ line never authorizes anything the derivation wouldn't. Same discipline as `classifyRecoveryInput` not owning validity |
| `handleLocal` is one path | The Recovery-phrase / nsec tab only chooses the raw string fed to `classifyRecoveryInput` (words: `gridValues` joined; nsec: the field). Everything from classification onward — decode/`skFromWords` → `'imported'` stamp → `establishLocalOwner` → `sk.fill(0)` — is a single byte-identical sequence. Do not fork it per tab |
| `establishLocalOwner` derives its own sk | The signing sk is DERIVED from the payload it just wrapped (`payloadKind==='nip06-entropy' ? deriveSkFromEntropy(payload) : payload`), NEVER accepted from the caller. This makes the authenticated identity provably equal to the one `unwrapSecretKey` re-derives from that exact ciphertext — a caller-supplied sk could silently disagree and the wrapped key would never unlock the identity. Never pass an sk alongside an entropy payload |
| `classifyRecoveryInput` | SHAPE only, never validity. `nip19.decode` and `skFromWords` own their own verdicts, so 12 nonsense tokens classify as `words` and are rejected downstream with a real message. Adding validation here would duplicate — and could drift from — two separate crypto contracts |
| `remotePlanFound` | Session-transient (in `partializeState`'s omit list), never synced. `recordRemotePlanFound` is **latched** to fire once per session; `setRemotePlanFound(null)` (Dismiss) does NOT unlatch, so the next foreground sync can't resurrect the notice. Dismissal is per-session by design; the first edit ends it permanently |
| The `NoPlanNotice` mount | Owner-only **by construction**: `ViewerHomeView` renders `{ownerNav && notice}`, and AppShell's dashboard arm is the only `notice=` call site. Never add a branch to AppShell's gate ternary — anything there replaces the whole app |
| Backup ladder mutual exclusivity | The dashboard notice slot renders `<><NoPlanNotice /><BackupNagCard /></>` — the two are **mutually exclusive by construction** (`NoPlanNotice` gates `keyProvenance !== 'generated'`, the nag gates `=== 'generated'`), so at most one shows. Both self-gate + are owner-only (`{ownerNav && notice}`). The nag ALSO mounts standalone on both journal surfaces + the Settings menu (4 total) and **fires pre-log** (R2c-5b — no data condition). All three ladder rungs (badge/nag/interstitial) read `isBackupGateSatisfied` — never re-derive it — and self-clear reactively on the ceremony's `backupVerifiedAt` flip; write no imperative cleanup. `backupNagDismissed` has NO module latch (single writer, resets each boot — the reappearance IS the ladder) |
| Ceremony has exactly TWO triggers | The nag's **"Save it now"** and RECOVERY's **"Save your Recovery Key"**. The **Identity & Security row stays NAVIGATION** — never auto-open the ceremony from it when gated. It opens the identity subpage (reveal-key / backup-plan / reset-&-re-sync / decrypt-back), which a gated user still needs; auto-triggering on transient gate state would silently change what the row does once verified. `SettingsRow`'s `alert` prop is **purely visual, never a behavior flag** — the highlight says "the thing you want is in here"; the button inside is the trigger |
| `WrapMeta.payloadKind` | **Absent ⇒ `'sk'`** — the compatibility contract for every key wrapped before R2a-2. Never make it required; never infer the kind from payload byte length. The unwrap branch tests `!== 'nip06-entropy'` (not `=== 'sk'`) so absent / `'sk'` / any future unknown kind all fall through the legacy path and a wrapped key can never become unreadable |
| `unwrapSecretKey` return type | **ALWAYS the 32-byte SECRET KEY**, whatever the stored payload. Its four call sites must never be made payload-aware. To read the payload as stored (entropy, for R2c's words) use `unwrapRecoveryPayload` |
| NIP-06 derivation constants | `m/44'/1237'/0'/0/0`, **account 0**, **no BIP-39 passphrase**, **English wordlist**. Never parameterize them in `nip06Key.ts`. A failure of the published-vector test is DATA LOSS (every written-down phrase would derive a different key), not a stale fixture |
| The words string | A **transient secret** — a JS string cannot be zeroed. Never persist/log it, never put it in an Error message, never hold it in state outliving its screen. The zeroable forms are `entropy` (16B) and `sk` (32B); **callers own zeroing both** |
| Backup gate — no migration | `keyProvenance: null` = a pre-R2 plan = **satisfied**. Grandfathering is STRUCTURAL (the persist `merge` fills the absent key from `current`). **NEVER add a `migrateState` case for `keyProvenance`/`backupVerifiedAt`** — that is the only way to break every existing owner. No store version bump; `exportPlan.ts`'s `storeVersion: 21` stays correct |
| `setKeyProvenance` | **WRITE-ONCE**: a *different* non-null over a non-null is ignored + warns; the SAME value is a silent no-op. `null` is the explicit **identity-teardown CLEAR** (`disconnectNostr`, "Remove local key", `gateHydratedIdentity`'s signed-out branch). `reconnectNostr` + `resetAndResync` RETAIN the identity → must NOT clear. Without the clear, generate→never-verify→disconnect→import-a-different-nsec is a permanent sync lockout |
| Provenance stamp ordering | `setKeyProvenance(...)` is stamped **BEFORE** `establishLocalOwner`/`syncNow` at every establishment call site — both call `syncNow` internally/immediately, so a stamp placed after would let a generated key's first sync publish ungated. `establishLocalOwner` is shared by the generated + imported paths and cannot distinguish them → the CALL SITES own the stamp |
| `setBackupVerifiedAt` | `set()` the field FIRST, then wake via `syncNow` (dynamic-imported, cycle-safe) — the gate must read satisfied inside `doSyncNow`'s guards. Marks `settingsDirty` DIRECTLY (`syncSettingsToNostr` early-returns on `!initialSettingsPullDone`, still false because the gate held sync off). **No second wake mechanism.** `null` = teardown clear (no dirty, no wake) |
| `backupVerifiedAt` hydrate | **ONE-WAY LATCH** — an incoming `null` never clobbers a non-null local (a legacy/unverified peer would otherwise re-gate a verified device). Third member of the whole-object-LWW skip-guard class (`nostrRelays`, `viewers`, this); the class is scheduled for structural deletion at Phase 4e |
| Trusted-snapshot key set | `viewerSnapshot.test.ts` carries an EXHAUSTIVE `Object.keys(snap.settings).sort()` assertion — brittle BY DESIGN. The sibling deep-equal is only DIFFERENTIAL, so a newly-synced field would leak to every trusted viewer and still pass. Adding a synced setting = a conscious choice to EXPOSE (add the key to the literal) or STRIP (add it to `buildViewerSnapshotPayload`'s destructure). Never paste a key in to make the test green |
| Onboarding verifies by default (R2c-6a, SUPERSEDES the retired R2c-4a bridge) | `OwnerKeySetup` K2 now stamps `backupVerifiedAt` — but gated on a **real verification** (a save + a two-word quiz = the ceremony's own semantics), NOT an ack. The stamp is pre-auth field-only (K2), before K3's `establishLocalOwner` `syncNow` wakes it ungated. The **skip** path ("I'll do this later") stamps nothing → generated-UNVERIFIED → the R2c-2/5b ladder. ⚠ The distinction the retired R2c-4a bridge got wrong: **an ack is a promise; a verification is proof.** Never gate the stamp on anything less than the save+quiz. ⚠ `handleGenerate`/`handleStartOver` must `setBackupVerifiedAt(null)` on (re)mint — the field rides partialize `...rest`, so a stale stamp from an abandoned run would falsely verify freshly-minted words. (⚠ `backupGate.test.ts` drives the setters directly, never the component — the K2 wiring is manual/tsc-covered.) |
| Seed-phrase hygiene copy — two variants, don't cross them | **DISPLAY** (we minted the words; `OwnerKeySetup` K2 + `RecoveryKeyCeremony` explain, one identical string): *"These words were generated fresh for this plan. Never use them as a Bitcoin wallet — same format, different job."* **CAPTURE** (the user is typing words IN; `NostrAuthGate`'s word-grid tab only, never the nsec tab): *"Never type your Bitcoin wallet's seed phrase here — a plan uses its own words."* The capture line sits BELOW the live checksum line so it never interrupts the grid→status feedback path |
| `SummaryBar fmtUSD` | Local sign-preserving — NEVER replace with shared version |
| Power Law A constants | Three independent values — never `PL_A_FAIR × scalar`. Ceiling = `2.4e-17` (resistance, 2.07× fair); user-facing label is "Resistance", the `PlBand` key stays `'ceiling'` |
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
| Zustand v20 migration | **Collateral-Truth Consolidation (C-P2)** — Strike collateral becomes reading-anchored. **Strips** `pendingCollateralAdjustment` (added to the destructure so it can't ride `...rest`). **Seeds** `strikeCollateralBtc` = the old-math current position from the RAW blob BEFORE stripping: `(rawLast?.btcHeld ?? advisorActualBtcHeld ?? 0) + pendingCollateralAdjustment` — CACHE-SEED ONLY (no synthetic dayLog event; clean journals). No legacy `balanceReading` carries `strikeCollateral` → `deriveStrikeCollateral` returns the fallback = seed → `getCurrentBtcHeld` is byte-identical pre/post. `advisorActualBtcHeld` STAYS (synced; historical chain + fallback). **Determinism residual:** un-converged `pending` across devices at migrate time seeds divergent caches (not synced) until the first `strikeCollateral`-bearing reading re-anchors both — self-correcting (pending is normally 0). |
| Zustand v21 migration | **Multi-viewer M1** — the sharing roster (`viewers: ViewerSlot[]` + `nextViewerIndex`) REPLACES the 5 single-viewer scalars (`viewerNpub`/`viewerPubkey`/`viewerLabel`/`viewerPrivacyTrusted`/`viewerKeyVersion`). **Clean-cut, NO back-compat** (the only existing viewer was a test key): the migrate destructure STRIPS the 5 old keys so a stale value can't ride `...rest`, and unconditionally seeds `viewers: []` + `nextViewerIndex: 0` (the owner re-adds viewers fresh). `ViewerSlot = { index (stable, monotonic, never reused), pubkeyHex, npub, label, tier: 'safe'|'trusted', keyVersion }`. Setters `addViewerSlot`/`updateViewerSlot`/`removeViewerSlot` (each `syncSettingsToNostr`). Both fields in `buildSettingsPayload` + `SETTINGS_FIELDS` (count 39 → **36**); STRIPPED from the trusted viewer snapshot + the plan backup; `hydrateSettings` skip-guard (empty incoming roster never clobbers a populated local one, mirrors the relay guard). `buildViewerSnapshotPayload` tier now reads `viewers[0]?.tier` (M1 slot-0 single-viewer; M2 = per-viewer d-tag fan-out). Components (SharingPage/DevPanel/ViewerPreview) TEMPORARILY operate on `viewers[0]` until the M3 roster UI. Current store version = 21 |
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
| `disconnectNostr` | Full sign-out — clears all nostr state INCL. `nostrPubkey` (auth auto-clears under the B1 pin) + the R2a-1 backup-gate pair `keyProvenance`/`backupVerifiedAt` (identity-scoped — see § Backup Gate) + removes the standalone GATE_* keys synchronously via the setters, then `window.location.reload()` to rebuild NPool clean; in lib/nostr/disconnect.ts. **Sign-out authority lives in the persist `merge`, not the racy blob:** the blob write isn't guaranteed to land before `reload()`, so a stale un-flushed `nostrPubkey` would (under the pin) resurrect auth — `gateHydratedIdentity` in the store's `merge` gates identity on the SYNCHRONOUS `GATE_PUBKEY_KEY` (removed by disconnect), so a stale blob can't sign you back in. (The fix is in `merge`, which runs on EVERY rehydrate; `migrate` only fires on a version bump, so it can't cover the same-version disconnect→reload.) **`merge`/`gateHydratedIdentity` gate BOTH `nostrPubkey` AND `nostrSigningMethod` on the live GATE keys (`GATE_PUBKEY_KEY` + `GATE_METHOD_KEY`), GATE-first with blob fallback — the racy blob is NEVER authoritative for identity. (A method-only gap once let a local-key login hydrate the stale blob `nip46` → nonexistent bunker signer → nip44 decrypt/probe timeouts → default data; gating method on the live `GATE_METHOD_KEY` fixed it.)** R2a-1: the signed-out branch (`!gatePubkey`) ALSO nulls `keyProvenance`/`backupVerifiedAt` — same authority rule, same reason (a stale `'generated'` in an un-flushed blob would re-gate a device that has since imported a key, and `setKeyProvenance` is write-once). |
| `resetAndResync` (escape hatch) | RELOAD-BASED recovery that can NEVER erase relay data: `clearStoreEncryptionState()` (enc flag + pending-decrypt + on-disk `{ct,iv}` blob + in-memory key) → `window.location.reload()`. Identity retained → the normal boot local-unlock → `syncNow` repopulates from the relay into the clean plaintext slate (no bespoke in-line pull). Imports NO publish symbol (structural) + the boot sync is dirty-gated, so a freshly-pulled clean state can't push over real relay data. Returns void (it reloads — callers drop result handling). In `lib/store/escapeHatch.ts`; buttons in Settings + LocalUnlockGate. (`resetPlanToSeeds` is now app-orphaned — left as a store action.) See `clearStoreEncryptionState` / the teardown-desync fix |
| `reconnectNostr` | Revoke-recovery — clears only the dead SESSION (`nostrSigner`/`nostrLogin`/`nostrBunkerUri`/`isAuthenticated`) but **RETAINS the identity (`nostrPubkey` + `nostrSigningMethod`)** so the B1-pinned `nostrAuthEnabled` stays true → the auth gate (`nostrAuthEnabled && !nostrSigner`) reappears on the NIP-46 login; `nostrLogin` cleared so `restoreSigner` can't revive the dead session. (Pre-B1 it cleared pubkey + relied on an independent `nostrAuthEnabled`; that's gone now — clearing pubkey would clear auth.) The bottom-right `⚠ Reconnect` affordance AND the Settings "Reconnect" button both call it; in lib/nostr/disconnect.ts. NOTE: reconnect reload shows a brief (~1.5s) optimistic-auth flash before the gate (autoRestore early-returns only for `'local'`); a follow-up autoRestore guard is deferred to Step 2/3 |
| nostr-tools pin | EXACT 2.23.5 — verified with Primal NIP-44; do NOT downgrade to 2.13 (breaks @nostrify peer compat) |
| NIP-46 mobile login | Two-step manual launch — relay warms in foreground BEFORE the deep-link; auto-firing breaks the handshake |
| `STRIKE_MAX_DRAW_LTV` | 0.50 in strikeCredit.ts; available = min(creditLine, collateral×price×0.50) − drawn |
| Strike avail-credit invariant | EVERY Strike available-credit surface — the daily-view trio pill, the `SafetyDashboard` capacity subtext, AND the viewer trusted figures (`computeViewerSafety` `figures.credit`) — computes via `strikeAvailableCredit` (the LTV-capped `min(creditLine, collateral×price×0.50) − drawn`). **Naive `creditLine − drawn` is RETIRED** (it overstated drawable credit by the LTV gap — device-observed $901 divergence). `figures.credit.total` = the BINDING limit (`cap.limit`), so `used + avail ≡ total` (holds when not over-drawn); when collateral value exceeds the line the limit naturally equals the credit line again |
