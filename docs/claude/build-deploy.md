# Build and deploy — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

## Build & Deploy

```bash
npm run lint && npm run build && npx vitest run && git add . && git commit -m "..." && git push   # Vercel auto-deploys on push (local vercel CLI removed)
```

`npm run build` = `tsc -b && vite build` — this is the REAL typecheck gate. Run it (not bare `tsc`) before every commit.

**⚠️ The lint gate:** `eslint.config.js` (flat config, ESLint 9) enables exactly **four rules** —
TS-aware `no-unused-vars` (`_`-prefix ignored — the `persistConfig`/`payloads` strip idiom),
`react-hooks/rules-of-hooks`, `no-constant-condition`, and `eqeqeq` (`smart` — permits the `== null`/
`!= null` idiom used throughout the gate-key slices). Everything else in `recommended` is **off**, and
three of those exclusions carry a written reason in the config rather than being silently absent:
`no-explicit-any` (137 sites, deliberate at the parse/validate boundary — `migrateState`,
`validatePlanBackup`), `no-undef` (TS already resolves identifiers; the core rule only false-positives
in a TS project), and `prefer-const` (one site in `runAdvisor.ts`'s engine — ESLint reports the shape
but cannot autofix it; verified by enabling the rule and running `--fix`: empty diff, error persists).
**`react-hooks/exhaustive-deps` is the named next candidate** — 6 of the repo's `eslint-disable`
comments already suppressed it before this commit, so enabling it is the highest-value next widening
(its own mission: re-enable, then read each surfaced dep array).

**⚠️ Store-version bump discipline:** the store version is now the **single constant `CURRENT_STORE_VERSION`** in `src/lib/storeVersion.ts` (zero-import leaf) — it drives the `useStore` persist `version`, `exportPlan.ts`'s `storeVersion`, `demoSeed.ts`'s `DEMO_SEED_STORE_VERSION`, and `validatePlanBackup.ts`'s version gate. A `migrateState` bump therefore means: **bump `CURRENT_STORE_VERSION` + the standalone `STORE_VERSION` literal in `e2e/helpers.ts`** (Playwright can't resolve `src/` imports, so e2e keeps its own pinned copy). A stale `STORE_VERSION` drops the e2e seed into the migrate/onboarding path and `seedAndGoto`'s landing assertion fails loudly. `validatePlanBackup` lean-rejects any backup whose `storeVersion !== CURRENT_STORE_VERSION`, so a version bump makes older exports un-restorable until 4f schema negotiation.

**E2E gesture harness (Playwright, `npm run e2e`) — the app's first e2e layer, opt-in, NOT in `vitest`.**
`@playwright/test` (chromium only) + `playwright.config.ts` (mobile-emulated 390×844, `hasTouch`/`isMobile`,
`serviceWorkers:'block'`, **`workers:1`/`fullyParallel:false`** — gesture/rAF/spring timing flakes under
parallel CPU contention; run serially. **`retries:1`** (2 in CI) — a safety net for gesture timing under full-suite
load, never a cover for a race: a genuine break fails both attempts. ⚠ It once hid one — the sheet specs did NOT pass
deterministically in isolation until the openers waited for the sheet to rest (the sheet-entry race, below); a spec
that fails in isolation is a bug, not a retry) + `e2e/*.spec.ts` + `e2e/helpers.ts`. `vite.config.ts` `test.exclude:
['e2e/**', …]` keeps `vitest run` from collecting the `.spec.ts` files (vitest's default include globs
`*.spec.ts`). **Reach:** the dev server bypasses every auth/viewer gate via `import.meta.env.DEV`, so a
3-field `addInitScript` localStorage seed (`onboardingComplete/simpleMode/simpleView:'daily'` + the
`personal-bloc-onboarded` GATE key + `window.__APP_BOOTED=true` to suppress index.html's 6s boot-watchdog
overlay) lands on DailyModeView; the FAB (`getByLabel('Log an event')`) opens EventSheet, a seeded `dayLog`
draw event + `data-testid="log-row"` tap opens EDIT mode, `getByLabel('Almanac')` → the live-height badge
opens the consent sheet; each opener returns only once the sheet is at rest (`waitForSheetAtRest`, the sheet-entry
race below). Gestures drive `page.mouse` (real pointer events, capture-capable) from the grabber.
**Covers:** dirty-guard (clean flick-dismiss + `data-dirty`, cap-no-dismiss after a keystroke), keyboard
guard (zero movement while focused), reduced-motion (no continuous transform, still dismisses), P1.2 Bug E (sheet
computed-opacity stays '1' mid-drag while the `sheet-backdrop` fades), P1.2 Bug D (downward drag from a mid-content
field label dismisses), P1.3 focus-then-drag (a focused field + press elsewhere → blur + drag + dismiss; H1) +
keyboard guard (press the focused field itself → no drag), and the sheet openers (**AT-REST**: each returns only once
its sheet is at rest — the sheet-entry race below). NOT covered: the scroll/drag handoff — `scroll coexistence` and
`jitter handoff` are device-gated `test.fixme`, and the rule is unit-tested through `resolveScrollClaim` (CANNOT
cover, below). **P2 `journal.spec.ts`:** calendar month swipe pages (multi-month seed) + boundary rubber-band;
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
stays on the Power Law face — the PowerLaw face's history route (`/blockchain\.info\/charts/`) is `page.route`-fulfilled
with valid data so the chart renders, since PowerLawFace gates it on `!loading && error === null`; edge-swipe back still works on
Almanac. **P3.1 additions:** NESTED edge-back (open a Settings subpage → one edge-back lands on the LIST [subpage
`← Settings` gone, the row back], a second → journal — **run against HEAD first, it FAILS**, proving the repro); the
chart scrub also asserts `document.scrollingElement.scrollTop` is unchanged — ⚠ that half passes TRIVIALLY in
Chromium since synthetic `page.mouse` can't drive native touch-scroll; kept as an intent marker, the real proof is
the device gate. Helper `mouseDragX(...,{release?})` drives raw `page.mouse` from a coordinate. (`faceHostBox` was
deleted with the pager.) **Chart zoom:** that Power Law drag test now also asserts the drag ZOOMS the chart
(`data-zoomed="true"` — a mouse drag draws a box) and a double-click inside `chart-zoom-plot` resets it. ⚠ **Before
chart zoom it was VACUOUS:** on the phone layout the chart's top sits at or below the bottom of the 844px viewport
(measured at y 841–890), so the drag was measured there, started OFF-SCREEN and never touched the chart. It now calls `scrollIntoViewIfNeeded()` first
(Z8); the drag is unchanged — its release 29px off the left edge still registers. Since the Power Law face the box opens
in view (IN VIEW: 309.5–669.5 at 390×844), so Z8 is a no-op guard that keeps a layout which pushes the chart down from
passing vacuously again. **Decision describe:** the zoom smoke
(BOX: `decision-chart-box` is 280px tall — the toolbar left it, Z18; ROW / RIGHT, as below; then drag a box across the
middle 40% × 50% of the plot → zoomed, the "Double-click to zoom back out" note and new tick labels; a double-click → the
full view and the recorded labels; then Z1's HOVER step — the tooltip still rises, so the overlay never takes the
pointer); and the **Z6 synthetic-touch test**, which dispatches `Touch` / `TouchEvent`s at the
plot centre (`dispatchEvent` returns false if and only if a listener cancelled the event): a sideways stroke is free
under 8px and held from the move that passes it, wobble included; a vertical stroke is never held, even when it turns
sideways; a touchstart never is; a second finger hands a held scrub to the pinch, which zooms — its fingers lift in
the SAME task as its last move, so the zoom needs the release itself to land the pinch (Z14). It proves the HOOK's
decisions, not iOS's scroll arbitration. Three more chart-zoom tests:
- **Z17, the pinch** — synthetic touches again, but each `Touch` carries `pageX` / `pageY` (recharts reads pageX, so
  the Z6 test's touches are invisible to it); reads settle 60ms (past recharts' 16ms move throttle). In order: CONTROL
  (one finger, one move → the tooltip shows, so the zeros can't be vacuous); a two-finger pinch moving in turn →
  DOTS- / TIP- / CURSOR-DURING all 0; one finger lifts → TIP- / CURSOR- / DOTS-AFTER all 0; the leftover finger moves
  alone → LEFTOVER no tooltip; a fresh finger down, not moved → FRESH-START no tooltip; PINCHED (`data-zoomed`);
  QUIET (`data-quiet="true"`); then a real `page.touchscreen.tap` → WAKE (the tooltip shows, `data-quiet="false"` — the
  tap's compat mousemove wakes it). ⚠ **Z21:** it reaches the face with `.tap()` and never moves `page.mouse` before
  WAKE — Playwright's mouse stays where a `.click()` leaves it, so after the tap Chromium re-hovers there and sends
  `mouseout` to the chart, and recharts hides the tooltip. A real phone has no second pointer;
- **the price reach** — PREMISE (no "…M" label at home); − ×2 → OUT (zoomed), REACH (`$1.0M` among the labels), NOTE
  ("Double-tap to reset the view"); Reset → HOME (the recorded labels); Pan + a mouse drag down 40% of the plot → PAN
  (zoomed, the labels moved);
- **Z18 on a computer** — the suite's FIRST non-phone context: `browser.newContext({ baseURL, viewport: 1280×900,
  serviceWorkers: 'block', isMobile: false, hasTouch: false })`, closed in a `finally`. ⚠ **Z20:** Playwright Test
  applies the project's `use` to a context made inside a test, so without the two `false`s it is still a touch phone.
  MODE (`data-mode="zoom"` — the premise that this is a fine pointer); ROW / RIGHT; CLEAR (`elementFromPoint` at the
  plot's right − 10, top + 10 is inside `.recharts-wrapper` — the old overlay's buttons sat there, hit-testable even
  at opacity 0).

The first Decision smoke also sees the **legend note** on the defaults
(Support, on the line), and **D2** measures the schedule's `schedule-keep` header at 390px and at 375px
(`setViewportSize`): ONE line — its text Range's client rects share one top — and no overflow. **The Power Law test**
(rewritten for the Power Law face, spec `pbloc-spec-powerlaw-face-v1`) asserts the face and the polished chart. Every
network answer is HELD or aborted:
- the history until STEADY has read the loading box;
- the live price until PRICE — no longer aborted, since nothing above the chart waits on it;
- the four block explorers are aborted (hermetic), while `page.on('request')` records any attempt — Playwright emits
  `request` before routing.

Its checks:
- STEADY (Z22): the loaded `powerlaw-chart-box`'s page top (`rect.top + scrollY`) equals the loading box's. The first
  reading waits for `document.fonts.ready`: IBM Plex Mono swaps in (`display=swap`) and the sub-nav pills above grow
  33 → 34px with it (`line-height: normal`), so a reading taken before the swap was 1px off one taken after — a flake,
  measured, never the layout;
- TOP (R1): `window.scrollY` plus the `scrollTop` of every ancestor of the box is 0. The app scrolls `<body>`, not the
  window, so `window.scrollY` alone stays 0 while the page scrolls. A probe — a 300px spacer above the chart card and the
  body scrolled 300 at open — is red at TOP (300), where IN VIEW alone would pass;
- IN VIEW: the box's bottom is ≤ 844 on open (309.5–669.5 at 390×844 — F2, D1);
- PREMISE "no live price yet"; PRICE: after the price is released and "below / above the fair line" shows, the box's
  page top is unchanged; ORDER: the "2.07× fair" tile sits under the box;
- Z8 (now a no-op guard) and P7: the box is 360px tall at 390 wide — the plot alone, since the toolbar left the box
  (Z18);
- TITLE ("Price and the bands" — so the long title fails in 5 s, tagged) and ROW / RIGHT (the shared
  `expectToolbarInTitleRow`): the toolbar's bottom is at or above the gesture area's top, its centre within half its
  height of the title's, its right edge within 1px of the box's;
- the drag zoom and the double-click reset; after the reset, hovering the plot's centre raises the token tooltip,
  headed by a UTC "D Mon YYYY" date and naming Resistance · Fair · Support;
- the swatch line lists exactly those three bands. The stub prices ONE row, and one point draws no history, so this
  is P3 at runtime;
- OFFLINE (F1, D2): no request to mempool.space, blockstream.info, blockchain.info/q/ or blockchair.com.

**The 360px title-row test** (F6) opens a phone context of its own (`isMobile`, `hasTouch` — Z20) at 360×780, once in
the Almanac (`seedAndGoto`) and once on the full-mode tab (an inline seed with `STORE_VERSION`, then LANDING on the
Tools button). The live price and the explorers are aborted and the history held. Its checks: SIDEBAR (full-mode: the
`aside` is hidden), ROW (the title row — found by PLACE, the box's previous sibling, never by its words — is exactly
32px, loading and loaded) and STEADY. Red with the long title back (ROW almanac, 47.25), with the full-mode hide
dropped (SIDEBAR full) and with the title row at 30px (Z22: ROW almanac loading, 30). At 390 the short title is one line
beside the toolbar, so the 390 test's STEADY no longer sees the 30px mutation. `test.setTimeout(60_000)` covers its two
boots.

**The Sats face test** (spec `pbloc-spec-sats-rates-v1`) answers the spot price with the store's own 82,000, so the
widths can't move with the market. It checks:
- the "Satoshi Rates" region sits right after the converter card, never in a `.facePanel`;
- ONE `tap()` on the 1,000 row fills SATOSHIS and BITCOIN; Tab from US DOLLAR lands on the first row, and Enter fills it;
- the side panel's first text is at x ≥ 16 (D2);
- at 390, 375 and 350, every cell is one line and the table's own scroll box doesn't scroll; at 1280 it doesn't scroll.

The page itself can't scroll sideways (`overflow-x: hidden` on html, body and the tool container), so the scroll box is
the check. **350 stands for the full-mode tab:** the Almanac box there is 316px, the full-mode tab's box at 390.

**The InfoTip test** (spec `pbloc-spec-infotip-fit-v1`) opens the Support policy ⓘ on the Decision face. It runs under
`reducedMotion: 'reduce'`, the harder case for the placement. It checks:
- ONE `tap()` opens it; a second tap, Escape and a tap outside each close it;
- the panel's box sits inside [16, w − 16] at 390, 375 and 481. The tip stays open through `setViewportSize`, so this
  also proves the re-place on resize;
- **COMPAT:** a tap's compat mouse events and a touch pointer entering open nothing, and a mouse pointer entering opens
  it, which is the positive control. The events are dispatched in browser order (the Z6 precedent), so this proves the
  component's decision, not WebKit's hover heuristic;
- with the mouse: hover opens it and leaving closes it; a click keeps it open, even after the mouse leaves; a second
  click closes it.

The note locator is scoped to the card, because `DemoBanner` is the only other `role="note"`. A real phone's tap
arbitration stays a device check.

**The Policy v2 Run B tests** ("Policy v2 Run B — the cliff on screen") seed a Coinbase loan through `seedLoanAndGoto`
(`e2e/helpers.ts`): $50,000 on 1 ₿ at a MANUAL $100,000, with no as-of date. Nothing polls and nothing accrues, and the
pool stays 1 ₿ (its keep at support is larger), so THE MOVE's figures are the same on any day. They check:
- the Decision face: THE MOVE's exact cliff line ("Coinbase seizes this loan at $58,140 — 42% below today.") and price
  alert ("Set a price alert at $66,667 …"), and the policy card's month-1 cliff line, each inside the 390px screen;
- one red dotted "Coinbase seizes" path, with a non-empty `d`, on Cycling's "BTC price path" card and on Ownership's and
  Strategy's "Price & liq" chart.

The coinbase price and blockchain.info requests are aborted or stubbed. Red with the alert line dropped (MOVE-ALERT) and
with Cycling's series removed (CYCLING).

⚠ **The sheet openers wait for the sheet to rest** (the sheet-entry race, spec `pbloc-spec-e2e-sheet-race-v1`).
DraggableSheet slides in over 280 ms, and `toBeVisible()` passes on the slide's first frame, because Playwright counts a
translated element as visible. An opener that returned there handed its test a box read from anywhere on the way in — as
low as the screen's bottom edge (y ≈ 844 against a settled 457) — and a drag from there ran below the screen.
- **The inline style can't tell.** The entry is a layout effect: it writes `translateY(100%)`, forces a reflow, then
  writes `translateY(0)` inline. So the inline style reads `translateY(0px)` the whole way in, and only the COMPUTED
  transform moves.
- **`waitForSheetAtRest(s)`** (`e2e/helpers.ts`) polls until the computed transform is the identity AND the box top is
  equal on two consecutive animation frames (Playwright's own "stable" rule). Keep both: a slide that hasn't started
  yet reads its from-state on every frame. No fixed sleep. The three openers call it before they return.
- **The click-first tests never raced:** `click()` waits for "stable" before it clicks.
- **It hid behind the retry.** On this Mac, with the openers as they were and `--retries=0`, consent's "clean drag past
  threshold dismisses" failed 5 of 20, every one at `toHaveCount(0)`; eventSheet's tests failed 0 of 180. The cloud
  never failed.
- **AT-REST** pins it on any machine (§ Test Suite → "The sheet-entry race"). Its `beforeEach` slows the slide to 1 s (an
  author `!important` beats the inline 280 ms) and aborts the Google Fonts requests: a late `display=swap` swap moves a
  bottom-anchored sheet by a pixel. Never loosen AT-REST to a tolerance — that would also hide an opener that returns a
  frame or two early.
- **The rule:** a new spec that measures or drags a sheet right after opening it goes through the helpers, or calls
  `waitForSheetAtRest` itself.

⚠ The phone project never matches `(pointer: fine)`. The Z18 computer test is the only fine-pointer context, and it
checks placement only — no fine-pointer gesture. ⚠ **A long-running dev server can keep a STALE compiled copy of a
composed CSS module** (PowerLawChart.module.css composes DecisionFace.module.css): HMR logs the edit, yet the page
still reads the old value. A CSS mutation across a `composes:` therefore needs a fresh server — and since the config
reuses any server on port 5173, stop yours first (`lsof -i :5173`). **CANNOT cover** (→ the iOS device gate stays MANDATORY): real WebKit system haptics (iOS
has NO programmatic path — `hapticsSupport()` is `'none'` there); the P1.3 **scroll/drag handoff** (`scroll
coexistence` + `jitter handoff` are `test.fixme` device-gated) — it needs real touch + native scroll +
`pointercancel` coordination, and synthetic touch drives no pointer pipeline / starts no native scroll, so the
claim RULE is unit-tested (`resolveScrollClaim`) instead; the iOS blur-races-pointerdown timing; the
standalone-PWA container; true 60fps; chart zoom's touch arbitration (the pinch, the Z6 scrub lock, `touch-action` by
mode, and Z17's wake on a real tap — § Chart zoom's device gate).

**⚠️ CI runs Node 22.23.2; local is Node 26.** Their `Math.pow` differs in the last bit on about 1 input in 10,
so an exact comparison over a `Math.pow`-built value can pass locally and fail CI. Reproduce CI's runtime with
`npx -y -p node@22.23.2 -- node node_modules/vitest/vitest.mjs run <file>`.

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
the root tsconfig, excluded from `tsconfig.app.json`) so `tsc -b` stays clean. The two module workers sit in the same
project — `src/lib/crypto/crypto.worker.ts` and `src/components/Almanac/futures.worker.ts` (Policy v2 — the lenses):
`tsconfig.worker.json` includes them and `tsconfig.app.json` excludes them; each is a hashed chunk in the precache, which
is **8 entries** since the futures worker (7 before). **Vercel builds it via its
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

**Device-local persisted-but-unsynced fields** (persist via `...rest`, NOT in SETTINGS_FIELDS /
`buildSettingsPayload` / the partialize exclusion destructure — so they survive reloads yet never
publish or clobber across devices): `devMode`, `expenseReanchorDismissedAt` (the expenses re-anchor — the Outlook's until the plan of record's Run 3, THIS MONTH's since —
dismissal watermark, spec §9), `showPlanIncomeBar`/`showPlanStrikeBar`/`showPlanCbBar` (Simple Mode
plan-card status-bar visibility, default true — VESTIGIAL: `showPlanIncomeBar` since its bar was removed before Run 2,
the other two since the plan of record's Run 2: the card has no bars and Settings no toggles; the fields stay, inert), `planNoteDismissed` / `planBreakerCache` / `viewerStrikeDepositISO`
(the plan of record's Run 2 — the one-time note's dismissal, THIS device's breaker cache, and a trusted viewer's copy of
the owner's latest Strike deposit date; plain-`set` setters, no sync, no bump — § Zustand Store Shape), `simpleView` (`'dashboard'|'monthly'|'daily'` consumer-shell view,
default `'dashboard'` — Owner IA dashboard-first; migrate-default only), `pinnedScenario` (Phase 3a Scenario
Diff/Pin — the pinned safety posture `PinnedScenario | null`, default null; plain-`set` setter, no sync;
merge-default so a pin survives reload), `viewerDisplayName` (Viewer V3 — the viewer's greeting name, default
null; cleared on `resetViewerSession`), `planEvents`/`planDirty`/`lastPlanEventsSyncAt`/`prefsDirty`/
`lastPrefsSyncAt` (Phase 4c plan-events channel — the append-only `PlanEvent[]` log + its publish-needed/watermark
flags; default `[]`/`false`/`null`/`false`/`null`; raw setters, merge-default, NO bump; the log is the plan
partition's source of truth, published on `plan-events:v1`, NEVER a synced setting; since 4e `planDirty`/`prefsDirty`
arm the iOS retry via `syncDirty`), `lastV1FallbackApplyAt` (Phase 4d — v1-fallback soak telemetry, unix seconds,
stamped when an EMPTY-log device applied plan fields from `settings:v1`; **RETIRED at 4e** with the v1 fallback, and
`settingsDirty` / `lastSettingsSyncAt` with it — `partializeState` names all three in its omit destructure so a pre-4e
blob's copies are dropped on the first write), `keyProvenance` (R2a-1 backup gate — `'generated'|'imported'|'external'|null`,
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

