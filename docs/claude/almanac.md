# The Almanac and its faces — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

## Almanac / CycleClock (P1 — pure model + tests + static dial; store unchanged)

The risk-free foundation for an Almanac "CycleClock" — a pure, unit-tested domain model and a static
presentational SVG dial. **No fetch, no lifecycle, no nav wiring, no live data, no settings** (those are
P3/P4). The dial is built but **NOT mounted on any surface** (the surface switch is P4). Prior art for
P3's `useChainTip`: `useMempoolData.ts` (existing tip fetch, consumed by `PowerLawSidebar`) — untouched
in P1, superseded later (both deleted by the Power Law face, spec pbloc-spec-powerlaw-face-v1, D2).

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
no longer renders in full-mode. Since the Power Law face (spec pbloc-spec-powerlaw-face-v1),
`[data-active-tab="powerlaw"]` carries the same two rules: that tab renders `<PowerLawFace />` bare, with no sidebar.
Since sticky controls (spec pbloc-spec-sticky-controls-v1, Δ1) the almanac tab adds a third rule,
`[data-active-tab="almanac"] .main { overflow-x: clip; overflow-y: visible; min-width: 0; padding-bottom: 0; }`.
`.main`'s `overflow-y: auto` made it a scroll container that never scrolls (its grid row grows with the face), so the
Decision face's sticky dock stuck to `.main`, not the window, and scrolled away. `clip` + `visible` make no scroll
container; `min-width: 0` keeps the grid item able to shrink (a scroll container got that for free); and the face's
own bottom padding is the page's end, so `.main`'s 20px would lift the bar there. Measured before and after on all 12
faces at 1440 and 390 px: nothing overflows `.main` sideways. The `powerlaw` rules are untouched (`powerLawWiring`
pins them). Since the Milestones on a phone (spec pbloc-spec-milestones-phone-v1, R3) it adds a fourth rule,
`[data-active-tab="almanac"] .main { --dock-bleed: 20px; }` — `.main`'s own padding, which is 20px at every width. Under
1024 px the control dock's margin is `12px calc(-16px - var(--dock-bleed, 0px)) 0`, so in full mode it also bleeds
across `.main`'s padding. Inside it the dock was inset 20px a side: every tab was 8px narrower ("Flywheel" cut at every
phone width measured) and the page showed beside it (M6). Simple mode's Almanac has no `[data-active-tab]`, so its dock
keeps −16px.
Measured: the full-mode dock spans the window from 320 to 1,000 px; from 1,001 to 1,023 px the 960px face centres and the
dock stops 0.5–11.5 px from each edge (20.5–31.5 at `d7145dd`).

### Hub expansion — Mining / Power Law / Sats / gated defense faces (Almanac becomes a 6-face hub)

`AlmanacView` widened from 2 live faces (Halving/Cycle) + 2 disabled "soon" placeholders to a full **6-face**
hub: **Halving / Cycle / Mining / Power Law / Sats / defense**. Locked design — **EMBED with per-face
width**: the Almanac is only the roof (eyebrow + sub-nav); each tool keeps its own already-shipped container
byte-identical. `face` widened to `'halving' | 'cycle' | 'mining' | 'powerlaw' | 'sats' | 'defense'` (still
local `useState`, default `'halving'`, nothing persisted/synced — unchanged §14.3).

- **§8 toolContainer adoption is now CLOSED** — every tool shares one `src/components/Tools/toolShell.module.css`
  `.toolContainer` (structural tokens: centering, iOS-safe overflow, horizontal/bottom padding + a 600px
  DEFAULT max-width): `EmergencyConsole`/`LiqSimulator` (deleted since — the plan of record's Run 4) adopted it in
  Phase 1; **this change closes the
  deferred follow-up** for `MiningMain.module.css`, `PowerLawMain.module.css` (deleted since — the Power Law face
  composes CyclingFace's `.face`), `ConverterMain.module.css` (each `.main` now `composes: toolContainer from '../Tools/toolShell.module.css'`, dropping its own
  width/margin/base-horizontal-padding — Mining also drops its now-redundant
  `@media (max-width:640px) { .main { padding:16px } }`, since toolContainer's fixed 16px horizontal already
  covers what that query existed for), and for `AlmanacView.module.css`'s own `.container` (now
  composes-only from the same file — **zero visual change**, since `.container` WAS the byte-identical
  reference `toolContainer` was originally extracted from).
- **Desktop width.** Each wider tool overrides toolContainer's 600px default on a DOUBLED class:
  `.main.main { max-width: 960px }` for Mining (and Power Law, until its face redesign), `700px` for the Converter.
  - ⚠ The first fix put the `max-width` in the composing rule itself, believing that "a local declaration
    following `composes:` wins by source order". **That is false.** The declaration ties `.toolContainer`'s
    specificity (0,1,0), so the bundle's rule order decides, and production emits toolShell's CSS after every
    tool's.
  - So all three pages rendered 600px wide on a computer from the adoption until spec v1.2's P10. The e2e couldn't
    see it: it runs 390px wide, and the dev server orders the CSS differently.
  - `composedOverrides.test.ts` pins the rule (§ Critical Constraints).
  - `EmergencyConsole`/`LiqSimulator`/`AlmanacView`'s own `.container` keep the 600px default unmodified (always
    their intended width; the plan of record's Run 4 deleted `LiqSimulator`).
  - Mobile is unaffected either way: every viewport under the relevant max-width hits `width:100%`, whichever value
    is set.
- **Render restructure:** the root wraps in a full-width `.shell` (`width:100%`, no max-width/padding); the
  eyebrow+sub-nav still sit inside `.container`; Halving/Cycle are re-wrapped in a SECOND `.container`
  (unchanged content/props — `useChainTip()` stays the single per-mount data source for those two faces
  only); Mining/Sats (and Power Law, until its face redesign) render each tool's own main content **stacked
  with its input panel** in a new `.faceStack` (mobile: `display:flex; flex-direction:column; gap:16px`, no
  width of its own, since the tool inside already brings its `toolContainer` width); `defense` renders
  `<CbDefenseTool/>` bare (no `.faceStack` — it has no separate input panel).
- **`.faceStack` goes two-column at `≥768px`** (`display:grid; grid-template-columns:280px minmax(0,1fr);
  gap:20px; max-width:1240px; margin:0 auto; padding:0 16px`) — mirrors `AppShell.module.css`'s own `.shell`
  grid (`280px 1fr`) so the Almanac hub gets the same panel-width rhythm as the standalone tabs. A `.facePanel`
  wrapper div (`order:-1; grid-column:1` at `≥768px`, no-op below it) pins the panel to the left column
  regardless of each face's own mobile DOM order.
- **D2 (spec `pbloc-spec-sats-rates-v1`): the Sats panel alone also takes `.facePanelInset`** (`padding: 0 16px`
  below 768px), so on a phone ConverterSidebar's text starts at the converter's 16px gutter instead of x = 0.
  - ConverterSidebar can't pad itself: AppShell's `.sidebar` already pads it in the full-mode tab, so it would
    double there.
  - Mining's panel pads itself (16px), so it doesn't take the class; Power Law has no panel since its face redesign
    (spec pbloc-spec-powerlaw-face-v1, F4 — resolved).
  - From 768px the grid's own 16px padding applies.
  - ⚠ decisionWiring's I21 check finds the Converter fallback in `renderFace` by its literal prefix, so D2 edits only
    the panel wrapper after it: `return <div className={styles.faceStack}><ConverterMain />`.
- **Panel stacking mirrors each tool's own mobile DOM order** (confirmed from `AppShell.tsx`'s sidebar+main
  mount order and `AppShell.module.css`'s `[data-active-tab]` rules): mining = `<MiningInputsPanel/>` then
  `<MiningMain/>`; powerlaw (history — now bare, see below) = `<PowerLawSidebar/>` then `<PowerLawMain/>` (both
  panel-first — AppShell has NO `order` override for either tab, so they fall back to plain DOM order, sidebar
  before main); sats =
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
  UNCHANGED — it still computes the `liqsim` tab's label independently of this component. (The plan of record's Run 4,
  D3: the ONE gate is the Coinbase loan — `hasCbLoan ? <EmergencyConsole/> : null`; `LiqSimulator` and
  `withEmergencyLabel` are deleted, and the tab is always `Emergency`/`Emerg` — § Emergency Console.)
- **Sub-nav:** Mining/Power Law buttons set `face` like Halving/Cycle (no disabled/soon treatment). A new
  **Sats button (`丰 Sats`, mirroring the `converter` tab's own shortLabel/fullLabel) is ALWAYS visible** —
  not gated. A **defense button renders ONLY when `hasCbLoan`**, labeled `🚨 Emergency` / `Liq Sim` by
  `cbPaymentStrategy`, mirroring the `liqsim` tab's own label rule (always `🚨 Emergency` since the plan of record's
  Run 4). A guard `useEffect` falls back to
  `'halving'` if the defense face is showing and `hasCbLoan` flips false mid-session. `.subnav` already had
  `overflow-x:auto` + hidden scrollbar + `flex:none` buttons (pre-existing) — scrolls gracefully at 6 buttons
  with no CSS change needed.
- **ISOLATION WALL restated (unchanged):** `cycleModel`/`HalvingClock`/`CycleClock` import nothing from the
  risk/position core (§2); `emergencyModel` imports nothing from `cycleModel`/power-law (§7). Co-locating
  all six faces under one hub is navigation only — it crosses neither wall.
- **Since the Power Law face (spec `pbloc-spec-powerlaw-face-v1`), Power Law renders BARE**:
  `if (f === 'powerlaw') return <PowerLawFace />;` — the four faces' one 960px column, the same component the full-mode
  Power Law tab mounts (AppShell's sidebar `null` + `[data-active-tab="powerlaw"]`). Mining and Sats keep the
  `.faceStack` / `.facePanel`. `PowerLawSidebar`, `PowerLawMain` (and its toolContainer `.main.main`) and
  `useMempoolData` are deleted, so the Power Law mentions above are history.
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
  {hasCbLoan, showMining, coldByMonth?})`. CSV columns = the visible columns PLUS an ISO `Date` col:
  `Mo, Date, Income→BTC, Paydown, BTC bought, Strike bal, Strike col, [→ Cold iff hasColdColumn], Strike LTV [+ CB bal, CB LTV iff
  hasCbLoan] [+ Mining sats iff showMining]`. `Mo`=`entry.month` (int), `Date`=`entry.date` (ISO). Raw
  decimals (no $/₿/% ornament; `strikeLtv`/`cbLtv` stay the stored 0.1483 decimal). Missing optional cells →
  empty. RFC-4180 `csvCell` escaping. **CRLF**, no trailing newline, **NO totals row**. Sort = single-key
  `a.month - b.month` (the real monthlyLog convention; dayLog's `(ts,id)` two-key sort is unrelated).
- **Spec v3 — "Strike col" is RECORDED + optional; "→ Cold" is COMPUTED.** An unrecorded `btcHeld` renders "—" (never
  0) and exports an empty CSV cell. `coldMovedByMonth(dayLog, advisorStartDate)` (ledgerCsv.ts) = net `target:'cold'`
  deposits − withdrawals per month; `hasColdColumn` shows the column only when a month that HAS a row moved a non-zero
  amount (a viewer's `[]` dayLog → hidden). The column is a FLOW (summed in the totals row). Never stored on the entry.
  **(ledger-cold-total-onboarding-date-spec-v2)** ONE tolerance, `COLD_EPS` (half a satoshi, `5e-9`), is shared by the
  column gate, the totals and the footnote. It exists because a deposit and withdrawals netting to zero leave ~7e-18,
  which `!== 0` passed. `coldTotals(entries, coldByMonth)` → `{ logged, unlogged }`, and ⚠ **the total stays
  ROW-SCOPED** so the column foots (a totals cell that isn't the sum of the cells above can't be checked). Cold
  movement in months with NO row (cold is journal-only, so a cold-only month never gets one) is DISCLOSED by
  `coldFootnote` as a `‡` line below the table, with a `‡` on the total. With no column the line keeps no `‡` and says
  the months have no row. Figures go through `fmtColdBtc`: 5 dp, widening to 8 dp when 5 dp would print a real move as
  zero (never "0.00000" / "-0.00000"), and an exact 0 prints "0.00000". Per-month cells use `coldCell` (residue → "—");
  the TOTAL is always a number. The CSV is unchanged apart from dropping a residue-only column, and still has NO totals
  row or footnote.
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
  paired price/collateral charts → paired cash-flow/strategy cards → rates → constraint notices → milestones (a
  table from 768 px, the switch table under it — § Milestones on a phone) → disclaimer. Paired rows go 2-col at
  ≥768px.
  Recharts restyled to tokens (zero new hex) with a local token-surfaced tooltip; `isAnimationActive={false}`
  throughout.
- **⚠ THE §2 CROSSING LIVES IN THE VIEW, deliberately** — it imports the power law (a BELIEF) AND the risk
  constants (FACTS), builds a plain `number[]`, and hands it to an engine that has heard of neither. Exactly
  the `MonthBreakdown` shape (the Outlook's too, until the plan of record's Run 3). Neither wall moves.
- **⚠ THE CAP DEFAULTS TO A FACE-LOCAL 70%, NOT `cbLtvTriggerPct`.** Still face-local, and still not the
  owner's trigger — that is the PAYDOWN threshold, a different action from stopping the draw, and it stays
  one tap away as a labelled preset chip. **It was 50** (chosen when the seed's opening CB LTV was 50.58%,
  so the cap bound instantly). With both faces now opening ON THE LINE at support, a 50 cap stopped the
  draw at month 1 and the default frame was inert. At 70 the draw runs and the cost is visible: peak CB LTV
  ~69% (Cycling) / ~70% (Ownership), ~16 points under the 86% liquidation line, and worth a meaningful
  fraction of a bitcoin over the horizon. Re-measured on the CURRENT seed: no liquidation on any band out to 240 months at 50,
  70 **or** 75 — the old "75 liquidates at month 83" warning was written against an earlier position and no
  longer holds. The engine tests pass `cbLtvCapPct` explicitly, so they pin the ENGINE, not this default.
  ⚠ The engine's refinance is headroom-capped only when `defendCbLtv` is on: the raw engine default (FALSE)
  still lets a sweep push LTV past the stop, but BOTH faces pass TRUE, so in the projection the stop is a
  real bound (fallback top-up included).
- **Gesture coexistence:** nothing to arbitrate — the Almanac face pager is removed, so a slider drag can no
  longer page the face. The former `data-gesture-exempt` markers on the control cards are deleted. *(This also
  retired the Mining face's latent slider-vs-pager conflict.)*
- **The STRIKE LTV CAP control** (both parents + the Strategy face): a ghost on/off toggle, a face-local
  **44px** range 50–68 step 1 beside the CB stop (⚠ never the shared `ui/SliderInput` — Mining/Living consume
  it and a track change would relayout three surfaces), the effective readout (`66.5% — max` when the engine
  clamps 67/68), and an `InfoTip` carrying the shared copy plus this run's live reading.
  `DEFAULT_STRIKE_CAP_PCT = 60` (between the 50% draw ceiling and the 70% call: 50 thrashes every month, 65
  leaves five points, 60 gives ten either side) and **`DEFAULT_STRIKE_CAP_ON = true`** — safe ONLY because it
  is a measured no-op on the default Support view. The reading is one shared helper, not three copies:
  `strikeCapReading(sim, effectiveCapPct)` → `off | idle | defended | short | yielded | called | cured | sold`,
  precedence **sold > cured > called > yielded > short > defended > idle** (`sold` / `cured` are the support policy's
  MODELLED calls, from the result's call fields — every face reaches them since Run 2b passes the policy), rendered by
  `strikeCapNote` (a modelled call reads the policy card's own call sentence). ⚠ **COPY TRUTH:** the yield
  sentence says "gave way to **keep Coinbase alive**" ONLY when Coinbase survived; otherwise it says Coinbase
  was liquidated anyway — and since a run can be BOTH called and yielded, the liquidated branch must survive
  being appended to the call (four unit cases pin it). `defended` must never read as a margin call.
- **Zone colours** reuse the shared gauge (`cbBarLevel` + `LEVEL_COLOR`) but band against **`CB_LLTV`**, the
  LTV this projection actually liquidates at — NOT the dashboard's `cbLiqFrac`, which comes from the owner's
  entered liq price, a TODAY anchor that says nothing about a position five years out. The trigger boundary
  is still the owner's own setting.
- Connectors: `getCurrentBtcHeld()` (verified Strike-only) · `advisorActualBlocBalance` · `creditLine` ·
  Coinbase's collateral and balance through planRun's `planCbCollateralOf` / `planCbLoanBalanceOf` (the plan of record's
  Run 2, D-R2-4 — none with the loan switched off) · `accruedCbBalance(...)` (the accrual boundary, as
  `EmergencyConsole` crosses it) · `income`/`expenses`/`blocApr`/`cbAprPct`/`btcPrice` · the minimum's source as
  `strikeMinFromIncome` (Run 2, D-R2-7) · `STRIKE_MAX_DRAW_LTV` · `STRIKE_MARGIN_CALL_LTV`.
  The prototype's direct CoinGecko `fetch` is GONE — no new external host. ⚠ **AMENDED:** the Almanac's
  only *background* network call remains the consented `useChainTip`. Both cycling faces now also carry
  **`useMorphoRateOnDemand`** — same-origin `/api/morpho-rate`, **never on mount and never on a timer**,
  fires only when the owner taps "Check live rate" / "Refetch". It writes to the SESSION OVERLAY, never the
  store, so the faces stay zero-store-write. The polling `useMorphoRate` is still confined to Settings and
  the SafetyDashboard.
- Tests: `src/simulation/__tests__/cyclingSim.test.ts` (100) + `powerLaw.test.ts` (18, all RELATIONAL against
  a fixed UTC date — absolute band dollars grow daily and would rot). Suite 968 → **1004**.

#### Inspection layer — month scrubber · price lens · BTC gained · holdings (UI-only, NO engine change)

Display math over rows the engine already emits. `src/simulation/` is UNTOUCHED; all state is ephemeral
component state; no store bump. The pure helpers live in **`src/components/Almanac/cyclingFaceView.ts`**
(React-free, store-free, TYPE-only import of `CyclingRow`) so they are testable without a render harness.

- **`applyPathStress(pricePath, fromMonth, factor)`** → the stress rollout: months from `fromMonth` onward
  are multiplied by `factor`, so the selected band path keeps its SHAPE (support/fair/resistance). Identity
  — SAME reference — at `factor === 1`, and for non-positive/non-finite factors.
- **`debtSplit(row)`** → `{ strikeUsd, coinbaseUsd, combinedUsd, shiftedUsd }`: where the DOLLAR debt sits.
  The refinance/debt-shift moves no coins, so this is the venue card's debt line (`shiftedUsd` = the month's
  `defenseDrawnUsd`).
- **`btcGained(row, base, rowPriceOverride?)`** → `{gross, yours}`. Gross is price-independent (BTC counts);
  net is `btcHeld − debt/price` on both sides. ⚠ **The override re-prices the ROW side ONLY** — `base` keeps
  its own real price (base is *today*).
- **`holdingsSplit(row)`** → Strike / Coinbase / Cold / Combined BTC counts.
- **`clampMonth(selected, rowCount)`** — see the crash note below.
- **`isAnchorHeld(lens, priceMode)`** / **`stressAnchorPrice(livePrice, anchor, held)`** /
  **`anchorDrift(livePrice, anchorPrice, held)`** → the price-stress anchor. See **the anchor split** below.
- **`coldBeyondRecord(price, supportAtMonth, bufferPct)`** → the cold InfoTip's "deeper than any bottom ever
  recorded" warning as a PRICE comparison (`price·(1−buffer) < support·0.55·(1−1e-9)`). See **4-yr cycle price
  path** for the float hazard and why the `1e-9` is a precaution.
- **`mergeMilestoneRows(fixed, turns)`** / **`fmtTurnDate`** / **`nextTurnsText`** / **`fmtPhaseShift`** → the
  4-yr cycle's Milestones rows and copy. ⚠ These take PLAIN arrays/values: this module must never import
  `powerLaw` / `cycleModel` / `cyclePath` (its docblock promises it — the easiest wall in the repo to break).
- **`msYearLabel(month)`** / **`MS_TABLE`** / **`MS_TABLE_OWNERSHIP`** / **`MsView`** / **`MS_VIEWS_CYCLING`** /
  **`MS_VIEWS_STRATEGY`** / **`MS_VIEWS_OWNERSHIP`** → the Milestones on a phone (§ Milestones on a phone): the switch
  table's year with its unit ("1 yr", "1.1 yr" — the table's own number); where the table shows (`'(min-width: 768px)'`;
  Ownership's adds `and (max-width: 919px)`, one under its two-column shell); and each face's views — a partition of its
  table's columns less Year, in the table's order (₿ · $ · LTV; Ownership ₿ · Gain · LTV).
- ⚠ **LTV is recomputed locally, not routed through `cbMetrics`.** Architecture invariant 2 governs the
  user's LIVE position; these are projected hypotheticals on a speculative price path, and `cbMetrics` reads
  store state. Same reasoning as the shared `ltvOf()` in `simulation/ltv.ts`. **This module must never be imported by the
  risk core.**

**⚠ THE CLAMP IS A CRASH FIX, AND IT MUST HAPPEN AT RENDER TIME.** The Horizon slider is `step=1`, so one
leftward tick shrinks `rows` while `selectedMonth` still points past the end → `rows[stale]` is `undefined`
and every `row.*` read blows up. An effect runs *after* that render. So `monthIdx = clampMonth(selectedMonth,
baseRowCount)` is derived during render and used EVERYWHERE — including as the dock's month slider's own `value`
(sticky controls, Run 2 — it was the scrubber card's), or the range input renders pinned past its max.
`rows[selectedMonth]` must never appear in the file. The effect
exists only to write the clamped value back so re-growing the horizon doesn't snap to a stale index. Pinned
by `clampMonth` unit tests.

**The price stress is a PATH ROLLOUT, not a display-only re-price** — range 0.35–2.2 (Cycling) / 0.2–2.2
(Ownership), default 1, label "as modeled" at exactly 1. `stressPath = applyPathStress(pricePath, monthIdx,
lens)` and the WHOLE face switches to `runCyclingSim({ ...engineInputs, pricePath: stressPath })` — the
projection, charts, milestones, venue split, and verdict all move together. `engineInputs` is ONE memoized
object (with `defendCbLtv: true` — the defense is AUTOMATIC) shared by the base and stress runs. ⚠ The lens
reset effect **MIRRORS the engine-inputs memo's dep array** (`pricePath`, `cbDebt`, the four store-derived
position values, the overlay inputs, `mode`) plus `monthIdx` — *if an input is added to `runCyclingSim`, add
it there too*, or a stress scenario silently survives an engine change. `pricePath` subsumes
`btcPrice`/`pathKind`/`phaseShiftMonths`/`months`/`convergeMonths`/`startDate`. ⚠ **The mirror is now a
TEST, not a comment:** `src/components/Almanac/__tests__/resetMirror.test.ts` extracts both dep arrays from
each face and fails if any engine input except `startDate` is missing from the reset list. The comment alone
had let `coldBufferPct` drift out on BOTH faces — a pre-existing bug: moving the cold slider under an engaged
lens kept a stale scenario. The guard was proven red against the unfixed faces before the fix went in.
⚠ `FACES` now covers **all four** engine faces (Cycling, Ownership, **UnifiedFace.tsx**, **DecisionFace.tsx**) — a face outside
that list escapes the mirror entirely, which is the single easiest way to reintroduce the stale-scenario bug.
It was run RED on all three (each naming `strikeCapPct`) before the Strike cap reached the reset arrays.

**⚠ THE ANCHOR SPLIT — the lens freezes the SCENARIO, never the FACE.** `pricePath` is built from
`anchorPrice`, **not** `s.btcPrice`. `useBtcPrice` polls spot every 10s and pushes to the store on a 0.1%
move **or** after 60s, whichever comes first (≈$80 on an $80k coin — seconds, not minutes). Every push
rewrote `btcPrice` → rebuilt `pricePath` → tripped the reset effect above, so **an engaged lens could not
outlive one quote**: it snapped back to "as modeled" within seconds and the owner lost the whole scenario.
The reset effect is CORRECT and is UNCHANGED — a run measured against inputs that have since moved reports
the wrong position. The defect was that a background quote is not an owner input, and a what-if measured
against a drifting anchor is not reproducible anyway.

`useStressLens(livePrice, priceMode)` (**`src/components/Almanac/useStressLens.ts`**, all four engine faces) owns
`lens` and the anchor. Which side each number sits on IS the invariant:

| reads the ANCHOR (`anchorPrice`) | reads SPOT (`livePrice`) |
| --- | --- |
| `plConvergencePath` → `pricePath` → `engineInputs` → both sim runs | the `Anchored $X · spot $Y ±Z%` readout on the stress card |
| the CAGR denominator | `anchorDrift(livePrice, anchorPrice, held)` |
| the "starts at" / "converges from" copy, the `from $X` stat tile | — |

Anything DESCRIBING THE SCENARIO reads the anchor, or it describes a run that never happened; anything
reporting THE MARKET reads spot. **Only the path memo is insulated** — the store quote still re-renders the
face, so the spot readout and its drift keep ticking at the poll's own cadence while the projection holds
still.

- ⚠ **Held only in `'live'` mode.** Nothing polls in `'manual'` (the store push is gated on
  `btcPriceMode === 'live'`), so a price change there IS the owner typing one and must still clear the
  scenario, exactly as before.
- ⚠ **The anchor latches in an EFFECT, not in the drag handler**, and `stressAnchorPrice` falls back to
  `livePrice` while `anchor` is still `null`. That fallback is LOAD-BEARING, not defensive: on the render
  that engages the lens `held` is already true while the effect has not yet run, and falling back reproduces
  the price the PREVIOUS render used — so engaging the lens never itself changes `pricePath` and cannot trip
  the reset effect it is trying to survive. A handler closes over the price of the render that built it, so
  a quote landing between render and drag would latch a STALE anchor, change `pricePath`, and kill the
  scenario at the instant of its birth.
- ⚠ `anchorDrift` guards `Number.isFinite` on BOTH sides, not just `> 0` — `Infinity` passes `> 0` and
  would report a flat −100% drift (`live / Infinity − 1`), painting the readout red on a coin that never
  moved.
- Tests: **`src/components/Almanac/__tests__/stressAnchor.test.ts`** (16) — the truth tables, the
  engage-race case, an end-to-end reproduction of the old defect, and a **mutation-tested grep guard** that
  fails if either face is reverted to `plConvergencePath(s.btcPrice, …)`. Suite → **1170**. ⚠ Its
  expected-callers list now names FIVE faces (Cycling, Ownership, UnifiedFace — the Strategy face —, Decision and FIRE)
  — it caught the new face before the list was updated, which is the guard working.

**BTC gained:** both the tile and the Milestones column read the displayed (base or stressed) run
(`btcGained(selRow, rows[0])` / `btcGained(r, rows[0])`), so they agree by construction. Both show **gross
over net** — gross is accumulation, net is what survives the debt — and on a `postLiquidation` row the net
drops hard, **shown, never clamped**. The switch table's ₿ view (under 768 px — § Milestones on a phone) shows it the
same way: "BTC gained", gross first in `--btc`, "… yours" under it in green / red (R4). Strategy's and Ownership's keep
"Net gain", net first.

**The month-scoped tiles follow the scrubber; `Strike interest` and `Debt shifted` are result-level** —
the former renders `sim.totalStrikeInterest` (CyclingRow carries no per-row cumulative interest; adding one
is an engine change) with a **`full horizon · N yrs`** sub-label, and the latter appears only when the run
actually defended.

⚠ **The month and the stress live in the control dock** on all three parents (sticky controls, Run 2 — § Decision
face → "Sticky controls — Run 2"); the scrubber card is gone, and its notes (the anchored line, the stress note, the
support line, the below-support warning) stay where it was. ⚠ The dock's range inputs are **face-local, 44px-tall**
(Ownership's `.dockScrub` composes Cycling's `.scrub` — its own `.scrub` is a 28px native range, kept for the card's
4-yr timing, Δ11) — the shared `ui/SliderInput` is NOT restyled, since
`MiningInputsPanel`/`MiningProjectionTable`/`LivingInputsPanel` consume it and a track change would relayout all three.

**MODES:** **`mode` (S1) adds four strategies — cycle / hold / clearStrike / clearBoth.** The support-line
"switch" (deploy / retire against the power-law support band) IS now modeled — as the opt-in
**`supportPolicy`** input on top of `cycle` mode, not a mode of its own (see **§ Support-anchored policy**; the
faces are Run 2). ⚠ The cold-storage / unpledged reserve IS modeled too — see **§ Cold-storage sweep** (the third
pool + the Strike→Coinbase→cold cascade).

- Tests: `src/components/Almanac/__tests__/cyclingFaceView.test.ts` (136). ⚠ **The seizure test asserts at
  `liqMonth + 1`, NOT at the first `postLiquidation` row** — `cyclingSim` pushes the BREACHING row and
  applies the seizure afterwards while setting `postLiquidation: true` on that same row, so `rows[liqMonth]`
  still holds the intact pre-seizure position and a naive assertion there passes vacuously. A sibling case
  pins that trap. Suite 1004 → **1023**.

#### LTV defense, BOTH legs: the Coinbase debt shift/top-up AND the Strike LTV cap (engine + all three faces; NO store change)

**The priority, one line:** 🔴 **Coinbase survival > Strike cap > Coinbase cap.** Morpho liquidates INSTANTLY
at 86%; Strike gives 72 hours to cure — so when the two defenses want the same coins, Coinbase wins.

The faces run the strategy WITH its emergency policy: when a fall pushes CB LTV over the stop, the engine
draws from Strike and PAYS THE COINBASE LOAN DOWN to the stop (shifting the dollar debt to Strike — no BTC
bought or pledged), and a due refinance then sweeps ONLY up to the remaining CB headroom so it can never push
LTV back over the stop. When the price recovers, the normal cadence shifts the debt back to Coinbase. If the
line still leaves LTV above the stop, the FALLBACK top-up moves collateral into the CB pool instead.

- **`src/simulation/cbDefense.ts`** (leaf — imports only the zero-import `./ltv`) — the single capacity + paydown + top-up definition:
  `strikeDrawCapacity(collBtc, drawn, price, maxDrawLtv, creditLine = ∞)` =
  `min(creditLine, collateral × price × maxDrawLtv) − drawn`; `defendCbLtv(input)` → required paydown,
  capacity, draw, shortfall, post-defense CB/Strike LTVs, Strike margin-call price, and the recovery price
  at which the post-defense LTV returns to the cap. ⚠ **BOTH LTVs route through the SHARED `ltvOf` (`simulation/ltv.ts`)**,
  so `skLtvAfter` is `∞` for Strike debt with no Strike collateral — it used to carry a `skValue > 0 ? … : 0`
  fallback that reported the worst position in the app as a flat 0%, while its own neighbour `cbLtvAfter`
  reported `∞` for the same shape. Nothing renders it yet; any future consumer MUST use `fmtLtvPct`.
  `topUpToCbLtv(input)` → `requiredBtc` /
  `fromColdBtc` / `fromStrikeBtc` / `topUpBtc` / `shortfallBtc` / `fullyDefended` / `cbLtvAfter` — cold FIRST
  (no lender constraint), then the Strike collateral above **`marginLtv × (1 − TOPUP_MARGIN_BUFFER)`** AT THE
  CURRENT PRICE (the true last resort, which sacrifices the 50% line backing but **stops a buffer SHORT of
  the margin call, never on it**). 🔴 The old bare-`marginLtv` bound left an exhausting top-up EXACTLY on the
  call line, so `cyclingSim`'s `strikeLtv >= strikeMarginLtv` fired in the same month — a second liquidation
  dressed as a last resort. `TOPUP_MARGIN_BUFFER` is 0.05 and EXPORTED, so a future spec can make it an input
  without touching call sites; bounding at `STRIKE_MAX_DRAW_LTV` instead was rejected as gutting the last
  resort in exactly the position that needs one. ⚠ Behavioural consequence: a leg already inside the buffer
  now yields **zero** available collateral where it previously yielded a sliver taken up to the call line —
  that is the correct answer, and it is what the updated `cbDefense.test.ts` shortfall case pins.
- **`runCyclingSim` gains `defendCbLtv?: boolean` — default FALSE (byte-identical engine). BOTH faces pass
  TRUE, AUTOMATICALLY — no UI toggle.** Cycle mode only; never post-liquidation. Sequence per month:
  interest → draw decision → cascade migration → refinance → debt shift → **top-up** (`shortfallUsd > 0`
  only) → cold sweep → LTV/breach. ⚠ The shift runs AFTER the refinance (headroom-capped) and the top-up
  runs AFTER the shift — both BEFORE the cold sweep, so the sweep can never need the collateral either
  needed. New row fields `defenseDrawnUsd` / `cbLtvPreDefense` / `defenseShortfallUsd` / `defended` +
  `topUpBtc` / `topUpFromColdBtc` / `topUpFromStrikeBtc` (+ the cascade's `strikeToCbBtc` and cumulative
  `coldRetrievedBtc`); result telemetry `firstDefenseMonth` / `defenseExhaustedMonth` /
  `totalDefenseDrawnUsd` / `defenseCount` + `firstTopUpMonth` / `topUpExhaustedMonth` / `totalTopUpBtc` /
  `totalTopUpFromColdBtc` / `totalTopUpFromStrikeBtc` + **`openingColdBtc`**. The defense draw is a STRIKE
  draw (no CB origination fee — the fee lands only when the refinance later re-borrows on Coinbase); its
  interest starts the following month. A top-up retrieves from cold, so `totalColdBtc` is NET
  (**`opening` +** gross − totalColdRetrievedBtc === totalColdBtc, gross = fromCb + fromStrike).
- **`runCyclingSim` also gains `openingColdBtc?: number` — default 0, so every pre-existing call site is
  byte-identical.** It SEEDS the cold pool with the owner's REAL unpledged reserve (`getCurrentColdBtc()`),
  because the pool otherwise started at 0 and `topUpToCbLtv`'s documented "cold reserve FIRST" could only
  ever spend coins the simulation itself swept — while `deriveOwnership` was already counting the real
  reserve, so the two disagreed about whether it exists. The seed is REPORTED on the result (the ledger
  must keep footing) and is ALSO added to the never-draw `baselineBtc`: ⚠ the baseline compares against
  "the untouched opening position" and the owner holds that reserve in the never-draw world too, so
  omitting it would credit the strategy with coins it never earned, inflating the verdict by exactly the
  seed. **Wired (real-cold spec v1):** all four engine faces pass `getCurrentColdBtc()` — see **Real cold in
  the projections** under § Cold ledger for what it fixed (the cold split's third origin, the moves sentence, the
  opening figures, `coldShown`, the policy-off slider gate). ⚠ **Under the support policy the emergency Coinbase
  top-up IS doom-gated** (the doom gate, adopted — § "The cold rules below support" below): in a month Coinbase cannot
  survive, the reserve stays out of it. SAME-MONTH by design — cold topped in while Coinbase was still savable can be
  lost to a later liquidation, which is what the cold card's reserve sentence gates on. With the policy OFF the top-up
  is NOT doom-gated (that arm is unchanged, real-cold decision 1).
- **⚠ "LTV stop" is the standard USER-FACING word for the threshold** — Cycling's slider is already
  `CB LTV stop`, the chart reference reads `STOP X%`, Ownership's slider is `Coinbase LTV stop`, and prose
  says "stop"/"LTV-stop defense". Internal identifiers (`cbLtvCapPct`, `cap`, `capPct`) are unchanged; only
  user-facing copy standardizes.
- **Both faces**, minimal chrome: a "Debt shifted" stat + ⇄ milestone flags + a verdict defense note (which
  now appends the top-up split when it fired: `₿X from cold storage, ₿Y from the Strike pledge`); the CB
  LTV tile sub-label reads **`defended from X%`** in a defended month (else `stop X% · liq 86%`) — under the
  support policy also in a month the crash playbook moved collateral (`defendedFromSub`); **the unhedged month is
  `topUpExhaustedMonth` once a top-up fired, else `defenseExhaustedMonth`** — the shift alone running short is no
  longer "unhedged" if the collateral covered it; ⚠ under the policy it is the engine's `firstUnheldMonth` instead
  (`unheldMonth`: a top-up-first step that falls short is normal there, so `topUpExhaustedMonth` would never fire for
  it — § Support policy — Faces → "The crash playbook on the faces"); the venue card gains ONE quiet
  debt line (`Debt · $X Strike · $Y Coinbase [· $Z shifted this month]`, `debtSplit`); the Cycling cold
  split adds a `− X ₿ used to defend the loans` row so the origins still reconcile to the net headline; and
  the selected month's Support marker (`plBandAt`, NEW in `powerLaw.ts`) with an amber "below the support
  line" note when the stress crosses it (range kept, never clamped). No banners, no new cards, no toggle.
- Tests: `cbDefense.test.ts` (incl. the top-up: worked example / cold-first / margin-bounded Strike / both
  dry shortfall / at-stop no-op / zero-price+zero-margin guards) + the `defendCbLtv` + `sweep cascade +
  emergency top-up` blocks in `cyclingSim.test.ts` (OFF ≡ today; restore-to-cap; capacity exhaustion fills
  the line once then stops; headroom-capped round trip on a V-shaped path; cycle-only; no post-liquidation
  defense; migration byte-identical only when BOTH the sweep and the defense are off, and running for the
  defense alone; migrated coins never leave the stressed line+margin keep; cold
  drained before Strike; pools/net-cold invariants; `openingColdBtc` omitted/junk ≡ 0, spent by the top-up,
  ledger foots, and reaching the baseline) + `plBandAt` cases in `powerLaw.test.ts`.

##### The STRIKE side: `strikeLtvCapPct`, its two-part reservation, and the survival guard

Every defense above pointed at Coinbase, and two of them made STRIKE worse: the debt shift adds to
`strikeBal` (numerator up) and the CB top-up takes `strikeColl` (denominator down). Meanwhile the cadence
migration is a one-way ratchet (below). Measured on the 4-yr cycle path: **Strike crossed its 70% margin call
at month 46 with 1.17 ₿ sitting unspent in cold** — holding the line there needed 0.1646 ₿, 14% of the pile.

- **`cbDefense.ts` gains the Strike twin + the guard's risk math, all leaves:** `topUpStrikeLtv(input)`
  (cold → Strike, cold the ONLY source — robbing the Coinbase pool to cure a 72-hour window inverts the
  risk); `strikeCollateralAboveLtv(coll, bal, price, boundLtv)` (the ONE definition of what Strike can
  spare — `topUpToCbLtv`'s last-resort grab and the futility check ask the same question);
  **`CB_SURVIVAL_BUFFER = 0.05`** (⚠ its OWN constant, NOT a second use of `TOPUP_MARGIN_BUFFER`: that one is
  Strike's margin buffer, and one constant serving two unrelated lines means tuning either silently moves the
  other); `cbSurvivalCollateralBtc(debt, coll, price, lltv, buffer = CB_SURVIVAL_BUFFER)`; and
  `cbDoomedThisMonth(input)` — the futility check.
- **`topUpToCbLtv` gains `strikeFloorLtv?`** — `bound = min(marginBound, floor)`. ⚠ **Absent (and 0, and any
  floor looser than the margin bound) is byte-identical to the pre-floor function**, pinned by a deep-equal
  test: every pre-existing call site passes nothing, and a silently tightened bound would change the shipped
  CB defense on every face.
- **`runCyclingSim` gains `strikeLtvCapPct?` — 0/undefined = off → byte-identical engine** (pinned against a
  HEAD golden captured before a line of this feature existed). **`effectiveStrikeCapPct(raw, marginLtv)`** is
  the clamp, exported so a face's "66.5% — max" readout and the run it describes cannot disagree: a cap at or
  above the margin line is a no-op by construction, so it is clamped a `TOPUP_MARGIN_BUFFER` inside it
  (0.70 × 0.95 → 66.5).
- **⭐ THE SEQUENCE IS THE DESIGN** — per month, cycle mode: interest → draw → cascade migration → refinance →
  debt shift → **STRIKE RESERVE (compute)** → **futility check → SURVIVAL GUARD** → **CB top-up** →
  **STRIKE TOP-UP (apply)** → cold sweep → LTV/breach. Both halves of the reserve are load-bearing:
  compute it BEFORE the CB top-up or Coinbase spends the pool first and the floor is decorative; apply it
  AFTER, because the CB top-up's last-resort grab reads `strikeColl` — apply first and that grab can take
  back the very coins just placed, with both row fields still reporting success.
- **⚠ THE RESERVE IS TWO-PART, or it is a fiction.** The CB top-up is handed `coldBtc − reserve` AND
  `strikeFloorLtv` at the cap: reserve only the cold and Coinbase simply takes the COLLATERAL instead.
  ⚠ Deleting either half passes every other test in the suite — fixture B (test A1) exists to catch it.
- **⚠ The Strike top-up is UNGATED on `defenseShortfallUsd`** (unlike the CB top-up, which is a fallback to a
  CB breach): the Strike cap is its own policy and must fire in months where Coinbase is perfectly healthy —
  which, in the reproduction, is every month.
- **THE SURVIVAL GUARD** (in a month the CB top-up actually runs): the reserve may claim only the cold
  Coinbase does not need to sit `CB_SURVIVAL_BUFFER` inside its liquidation, and the floor stands only while
  `coldBtc >= survivalBtc` — the reduced form of "cold alone can keep Coinbase alive", exact where the long
  form could flip on an ulp. A cut reserve or a dropped floor records `firstSurvivalYieldMonth`.
  ⚠ It is gated on `defenseShortfallUsd > 0` so it can never report a yield in a month where nothing was
  handed over (reachable whenever the CB stop sits above the 81.7% survival line).
  ⚠ **The need is the LEAF's, capped at the stop:** `cbSurvivalCollateralBtc(cbDebt, cbColl, price, CB_LLTV,
  CB_SURVIVAL_BUFFER, cap)` — the `stopLtv` param makes the target the looser of the survival line and the stop,
  i.e. min(need(line), need(stop)). The CB top-up only aims at the stop, so above an 81.7% stop (the slider
  reaches 85) a survival-line need claimed coins the top-up never took and reported "Strike gave way" in a month
  Strike still got its whole need. Measured against the pre-fix engine: stops ≤ 81 are byte-identical; at 82–85
  (2,926 stressed runs each) only telemetry moves (`strikeReserveBtc` / `strikeReserveCutBtc` /
  `firstSurvivalYieldMonth`) — no coin, debt, LTV or liquidation figure — and the phantom yields fall 606 → 579,
  595 → 493, 587 → 408, 582 → 326. Never open-code the cap in the engine.
- **THE FUTILITY CHECK (F1)** stands the guard down when `cbDoomedThisMonth` — Coinbase cannot clear its
  ACTUAL 86% line this month even with ALL the cold plus every spare Strike coin. A yield there is futile: it
  feeds the reserved cold into the pool Morpho is about to seize. Two decisions its docblock carries, because
  both look like inconsistencies: **buffer 0** (the actual line, not the buffered one) and **the margin bound,
  not the Strike cap** (what is POSSIBLE, not what policy allows) — either substitution declares savable
  positions doomed.
- **New row fields** `strikeTopUpBtc` / `strikeReserveBtc` / `strikeTopUpShortfallBtc` / `strikeReserveCutBtc`;
  **result** `firstStrikeTopUpMonth` / `strikeTopUpExhaustedMonth` / `totalStrikeTopUpBtc` /
  `firstSurvivalYieldMonth`. 🔴 The Strike top-up MUST join `coldRetrievedBtc` or the cold ledger stops
  footing (`opening + fromCb + fromStrike − retrieved === coldBtc`; a test pins the identity).
- **Two TEST-ONLY inputs, `cbSurvivalGuard` and `cbFutilityCheck`, both DEFAULT ON.** Absent means ENABLED —
  safe because everything they guard also requires `skDefend`, i.e. the opt-in `strikeLtvCapPct`. They exist
  so the grids can pin what each buys; **no face may pass either, and a grep test enforces it.** Do NOT "fix"
  either default to false.
- **📊 THE EVIDENCE — ⚠ every count names its grid** (three denominators appear here; two unlabelled ones read
  as a contradiction). Arms: **unguarded** = the spec-v1 design (`cbSurvivalGuard: false`), **guard**
  (`cbFutilityCheck: false`), **guard + F1** = shipped. Coinbase liquidated EARLIER than the same run with the
  cap off: synthetic single-crash grid (5,760) **526 → 0 → 0**; face-world grid (360) **24 → 14 → 14**;
  reachability grid (2,806) **158 → 94 → 94**. What it costs Strike, in ABSOLUTE counts: face-world grid,
  yields 108 → 59, Strike-worse 29 → 13, **futile 21 → 5**, Strike calls 80 (unguarded) → 97 → 82;
  reachability grid, yields 704 → 395, Strike-worse 96 → 44, **futile 70 → 18**, calls 858 → 968 → 920.
  These Strike figures moved with the terminal-liquidation fix (a post-seizure Strike balance is no longer
  refinanced onto Coinbase, so it stays on Strike and can reach its call); every Coinbase count is unchanged.
  ⚠ **F1 moves no liquidation month at all** — the CB-earlier and CB-survived counts are identical with and
  without it; a doomed month liquidates Coinbase whatever Strike hands over. ⚠ **If a percentage is quoted,
  it carries the clause that the harm-per-doomed-yield RATE rises under F1 (96/455 → 44/146) only because F1
  removes the harmless futile yields from the denominator, while absolute harm falls** — without it a later
  reader reads F1 as a regression and reverts it.
- **⚠ THE RESIDUAL 14 (face-world) / 94 (reachability) ARE INTERTEMPORAL, with two measured mechanisms:**
  (a) the Strike top-up is ungated on `defenseShortfallUsd` by design, so a month where Coinbase is healthy
  still spends cold a later month's CB top-up needs; (b) the floor withholds Strike collateral Coinbase would
  have taken in an earlier month. A same-month rule cannot see either, and the same limit leaves F1's residual
  futility (later-month doom). **The fix is a forward-looking Coinbase reserve — the natural v2**, beside the
  ratchet fix; it changes the shipped projection on every falling path, so it needs its own spec. → **Built, in
  policy mode only:** the support policy's sweep keeps what Coinbase needs AT SUPPORT plus the bear buffer
  (§ Support-anchored policy, step 9). The policy-absent engine is unchanged.
- **⚠ THE ROOT CAUSE THIS DOES NOT FIX: the cadence migration's one-way ratchet.** `keepForMargin =
  strikeBal / (strikeMarginLtv × stressed)` is evaluated during the rise while `strikeBal` is **$0**, so it
  reserves nothing for margin and ships **0.59 ₿** off Strike (1.0000 → 0.4077 on the 4-yr fixture). The debt
  shift then dumps the full line onto the hollowed leg. The cap COVERS for it at 0.05–0.21 ₿ of reserve per
  run; reserving against the debt Strike *could* be asked to absorb would shrink that. Out of scope, by
  decision — the natural v2 beside the forward-looking reserve. → **Built, in policy mode only:** the support
  policy's migration keeps the FULL line's collateral at support (§ Support-anchored policy, step 5).
- **⚠ THE ENGINE DOES NOT MODEL A STRIKE SEIZURE.** `strikeMarginMonth` is a FLAG; nothing is confiscated
  (only Coinbase's `liqMonth` seizes). So avoiding the call is **invisible in equity** — the small ₿/equity
  gain that does appear is entirely MORE BITCOIN BOUGHT (holding Strike's collateral shifts the CB LTV path,
  which flips the `drawing` test in a handful of months, and a drawing month puts the WHOLE income into
  bitcoin). Do not expect a large equity win and do not "fix" its absence. → **Except under the support policy**,
  which MODELS the call — a cure from cash, then cold, else a sale down to 65% (§ Support-anchored policy, step 8).
- **On the Support path — the shipped default view — the cap is a NO-OP**, measured byte-identical with it off
  and at 60 (`btcHeld 5.833640`, `cold 2.027255`, `equity $1,058,936`, no margin call). That is the only
  reason it is safe to default ON. On the 4-yr path at CB 50 it turns a month-46 margin call into a flat 60%
  plateau for ~0.11 ₿ of reserve.
- Tests: `cbDefense.test.ts` (the Strike twin, the floor's bind-and-absence, `strikeCollateralAboveLtv`,
  `cbSurvivalCollateralBtc`, `cbDoomedThisMonth`'s boundary/bound/buffer cases) + the Strike-cap block in
  `cyclingSim.test.ts` — the reproduction both ways (43 / null), the cold ledger, coin conservation, off ≡
  HEAD golden, the 36-combo adversarial grid, the clamp, an empty pool, **A1 fixture B** (both halves of the
  reservation), **A2 fixture C** (the guard), **A3/A5** (the three-arm grids, every count above),
  **A4** (the Support no-op), **A6 fixture D** (the futility pin, run with the flag false vs true), the M1
  floor pin, and the grep test for both flags. Suite 1,434 → **1,489**.

##### The cold rules below support — the doom gate ADOPTED, Strike first after a liquidation ADOPTED, C retired

Three questions about the defense block and the repayment order under the support policy, measured in the env-gated
report (`-t "cold rules"`, `-t "repayment"`) and decided by the owner 2026-09-27 against §4 v1.1 (below). The crash
playbook (the next section, 2026-09-28) extended Strike first to every zone and retired C.

- **POLICY-ONLY BY CONSTRUCTION.** The engine resolves both switches as `policy !== null && …`, so the policy-off engine
  never reaches them and the G1 golden is untouched. No face may pass either — the test-only grep test covers both.
- ⚠ **POLICY V2: under Morpho's seizure on the way down (default on) D, the futility check and Strike-first are inert
  under the policy.** A doomed month opens past 86% at its price and is seized first; a seizure on the way down repays
  Coinbase in full, so Strike-first acts only after a month-0 seizure. The tests of all three run under the month-end
  reading (`MONTH_END`), each beside one line pinning what the default does (§ Support-anchored policy → Policy v2).
- **D — the doom gate, `doomGateCbTopUp`: ADOPTED, default ON under the policy** (absent ⇒ on, the `cbSurvivalGuard`
  pattern; `false` is the TEST-ONLY pre-adoption order, kept so the report and the tests can measure it — never "fix"
  the default to off). In a month `cbDoomedThisMonth` says Coinbase dies whatever it is handed — asked on the POST-shift
  state with exactly the futility check's inputs — the emergency Coinbase top-up is skipped ENTIRELY (no cold, no Strike
  collateral). Since the crash playbook it also gates the TOP-UP-FIRST step (asked before it), and under Strike's
  release rules its doom question counts only the collateral Strike will RELEASE now. One helper,
  `cbDoomedNow(price, m)`, feeds the survival guard, D and the top-up-first gate, so those inputs have one definition.
  - ⚠ **SAME-MONTH BY DESIGN.** Cold topped into a Coinbase that was still savable can be lost to a LATER liquidation.
    F4's line-first fixture shows it at k2 0.5 with 0.5 ₿: cold restores the 70% line in month 1 (savable), then month 2
    opens at 109% and is seized on the way down with that cold inside. The cold card's reserve sentence gates on exactly
    that (§ Support policy — Faces → "Cold card with the owner's reserve").
  - Measured: never worse on ₿ held in any grid cell or row, and no liquidation or Strike sale changes. It holds more ₿
    only where the pool was smaller than the debt — and there it leaves a Coinbase DEFICIENCY (the pool seized whole,
    the rest of the debt surviving) that the old order did not. All-in equity is better on the recovering grids and the
    rows, worse on the no-recovery synthetic grid: the loss §4 v1.1 allows and names. On the fixed repayment order
    (below) it adds no Strike interest.
- **Strike first after a Coinbase liquidation, `strikeFirstAfterLiquidation`: ADOPTED, default ON under the policy**
  (`false` is the TEST-ONLY pre-adoption order). After a liquidation, in a pay-down or broken month, the restore skips
  Coinbase's half, so the pay-down retires Strike first and the Coinbase leftover after it; in a paused, accumulate or
  hold month (**P3**, crash playbook Run 1) the same restore budget, `min(surplus, cbExcess + skExcess)`, goes to Strike
  first, up to its whole balance, then to the Coinbase leftover. The instant-liquidation reason for "Coinbase before
  Strike" is gone once Coinbase has been liquidated — the leftover is unsecured debt at the Coinbase rate, while Strike
  costs 13% and can still be called. At a month-end seizure `liqMonth` is still null DURING the liquidation month, so it
  acts from the month after; on the way down (Policy v2) it acts in the liquidation month itself — though a seizure on
  the way down leaves no leftover, so only a month-0 seizure gives it one. Before a liquidation the restore is unchanged
  (Coinbase before Strike — § Support-anchored policy → Restore).
  - Measured: never worse on ₿; it cuts Strike interest and can avoid a post-liquidation Strike sale; the Coinbase
    leftover is repaid later (a short run can end still owing it). Its only all-in losses are cells where it AVOIDED a
    Strike sale on a no-recovery path — the kept coins are worth only what the sale would have retired, and the interest
    on that debt is the loss. P3 is measured inside the repayment block, whose off arm is Coinbase first in every zone.
- **C — cold before the debt shift: RETIRED (crash playbook Run 1) — the input is deleted.** It topped Coinbase up to
  its line from COLD ONLY, before the shift, below support; measured, not adopted. The crash playbook's top-up-first step
  answers the same question, with Strike's release rules and a depth gate. Two of C's lessons carry over — its tests are
  ported to the playbook:
  - ⚠ **A top-up that restores the line IN FULL skips the shift.** Landing exactly on the line can leave the LTV an ulp
    over it, and the shift's `> cap` test would then book a phantom defense (or a phantom shortfall that wakes the guard
    and the fallback). Pinned grid-wide, not on one cell: which cells hit the ulp moves with the last bit of the
    Math.pow-built support path.
  - ⚠ **With a Strike cap at or above 50% (Strike's own draw line), a pre-shift Strike reserve and debt-shift capacity
    never coexist** — a reserve needs Strike LTV over the cap, capacity needs it under 50% — so the reserve test uses a
    Strike cap of 40.
  - **Why C was not adopted** (§4 v1.1, C + D against D): on P1 × 0.35 from month 12 with a 0.5 ₿ seed it was worse on ₿
    and all-in and put cold into a doomed Coinbase — its pre-shift doom check passed, then the debt shift spent the Strike
    collateral a top-up would have moved (it cuts what Strike can hand over, d / 0.665p, faster than Coinbase's need,
    d / 0.86p). **The shift can turn a savable Coinbase into a doomed one** — the crash playbook's input.
- **§4 v1.1 — the adoption rule (amended by the owner):**
  - ₿ held decides; all-in equity is reported beside it. An all-in loss is allowed only on paths that never recover (the
    synthetic grid), and it is named; a loss on a recovering grid (face-world, reachability) or any row blocks adoption.
  - A cost-only change (like C) may be adopted if it changes no liquidation or Strike sale; is never worse than the
    adopted order on ₿ or all-in, in any cell or row; keeps the cold rule (no ₿ into a doomed Coinbase anywhere); and
    cuts debt shifted or Strike interest.

##### The crash playbook — Strike's release rules, top up first above the liquidation depth (Run 1)

Spec: `pbloc-spec-crash-playbook-v1.md`, Run 1 of 3 (Run 2 = the Emergency Console, Run 3 = the Monthly Playbook's crash
line and the projection labels). Decided by the owner 2026-09-28. Every switch is policy-only (`policy !== null && …`):
the policy-off arm is byte-identical and the G1 golden does not move.

- **STRIKE'S RELEASE RULES (`strikeReleaseRules`, TEST-ONLY, default ON) — a correction, not a §4 decision.** Collateral
  leaves Strike only at or under 40% LTV before, only down to strictly under 50% after (`maxDrawLtv × (1 −
  STRIKE_RELEASE_EPS)`), and never within 60 days of a deposit (`strikeHoldUntil`). `strikeReleasableBtc` (cbDefense) is
  the one definition; the engine's `releasableNow(m, price)` measures it on the CURRENT state and passes it to both
  top-up sites (`strikeReleaseCapBtc`) and to every doom question (`strikeReleasableBtc`). The old last resort was
  bounded only by margin × 0.95 = 66.5% — a move Strike would never allow. Its cost is real, printed by the report as
  `R vs pre` (fewer ₿ held, some survivals turned into liquidations): the honest number, never used to block. `false`
  keeps the old bound so the report can measure it.
  - ⚠ Collateral LEAVING Strike starts no hold — only collateral going IN (the Strike cap's top-up, a cure's cold) does.
  - ⚠ **The policy-OFF Strike leg is unchanged — still margin × 0.95.** A named follow-up.
- **TOP UP FIRST (`topUpBeforeShift`, TEST-ONLY, default ON).** Between the liquidation depth and support —
  `ceilingLiquidationMultiple(cbStop, CB_LLTV) ≤ k < 1 − SUPPORT_EPS`, ≈ 0.698 × support at the engine fixtures' 60% stop
  (≈ 0.52 × at the faces' 45% since Policy v2) — with Coinbase
  over its defense line and not doomed, collateral goes in BEFORE any debt moves onto Strike: cold first (less the
  Strike cap's reserve on the PRE-shift state), then releasable Strike collateral (never below the Strike cap's floor).
  The shift covers only what is left, and a top-up that restores the line in full skips the shift (the ulp lesson).
  It runs after the refinance, where C used to, and books exactly like the emergency top-up (the row's `topUp*`
  fields with `+=`, the totals, `coldRetrievedBtc`, `firstTopUpMonth`) — but never sets `topUpExhaustedMonth` (a short
  top-up is normal here). A top-up-first month's `cbLtvPreDefense` is the LTV before the playbook (`??=`).
  - **Why:** each $d the shift moves onto Strike cuts what Strike can release by d / (0.5·P) but Coinbase's need at 86%
    by only d / (0.86·P) — and past 40% Strike releases nothing — so shifting first spends rescue capacity faster than it
    buys safety, and parks the debt at 13%.
  - **Why the depth gate:** below it, a Coinbase at its support ceiling is already past 86%; spending every coin there
    leaves nothing for a second leg. `topUpFirstAnyDepth` (TEST-ONLY, default OFF) removes the gate — measured and
    REJECTED: it wins on the grids but loses ₿ on double drops, and every loss starts deeper than the gate.
  - Elsewhere (below the depth, at or above support, doomed) the order is unchanged: the shift first, then the fallback
    top-up — doom-gated, with releasable re-measured on the post-shift state.
- **THE DUST DROP (owner decision, 2026-09-28).** A release leaves Strike a relative 1e-9 under its 50% draw line, so
  the shift has about balance × 1e-9 of capacity left. In a month the top-up-first step ran, a shift draw under
  `SHIFT_DUST_USD` ($0.005, the engine's half-cent residual precedent) is float dust: `defenseDrawnUsd` 0, not
  `defended`, and its need stays the shortfall (`paydownNeededUsd`), so the survival guard and the fallback top-up still
  run. R and pre never run top-up-first, so they are untouched.
- **`firstUnheldMonth`** (result, policy-only): the first month the playbook ran (`cbLtvPreDefense !== null`) and
  Coinbase still ended the defense block over its line (`> cap × (1 + 1e-9)`; doomed months count). The faces read it
  under the policy; policy off they keep `topUpExhaustedMonth` / `defenseExhaustedMonth`.
- **`strikeRepaidUsd` / `cbRepaidUsd`** (row, policy-only): the restore plus the pay-down, per leg — what lets the view
  name what spare income repaid. `strikeRepaidUsd + cbRepaidUsd ≡ restoreUsd + payDownUsd` (pinned, `toBeCloseTo`).
- **P3 — Strike first after a liquidation in every zone** (the cold rules above), folded in by rule (§4 v1.1 passes).
- **ONE PLAYBOOK — `crashPlaybook()` (`src/simulation/crashPlaybook.ts`)** is the shared leaf Runs 2 and 3 consume. The
  engine runs the same sequence inline, because it adds the Strike cap's reserve and survival guard, which the live app
  has no setting for. ⚠ **A parity test pins engine ≡ crashPlaybook with the Strike cap off** (zero rates, a 2-point
  path; every order and step kind occurs), and every move books with the engine's exact arithmetic — change one side
  and it fails. Never fork the playbook.
- **Measured** (the env-gated report, `-t "crash playbook"`; fixture-bound — re-run it for every figure): playbook vs R
  PASSES §4 v1.1 — no ₿ worse anywhere, no all-in loss, no liquidation or sale change, less debt shifted and less
  Strike interest; anyDepth vs R FAILS (the reason for the gate). ₿ into a doomed Coinbase and G2 are 0 under the
  playbook on every set — invariants: a non-zero is a bug, and the report prints "STOP — invariant broken". Custody
  falls: collateral that used to sit in cold while debt shifted now defends Coinbase first.

#### Unfunded bills — disclosure only (engine + all three faces; NO store change)

The engine funds only what income and the Strike line can cover. When bills exceed both, no coins are sold and
no debt grows for the gap, so the model used to drop it silently in cycle mode (C1's `deficitMode` notice was
non-cycle only). Now it is disclosed. The funding logic and the baseline math are unchanged.
- **`CyclingRow.unfundedUsd`** covers the bills nothing paid this month:
  - drawing month: `max(0, strikeShortfall − income)` (the credit line ran dry);
  - stopped month: `max(0, expenses − income)` (the stop halted the draw);
  - every non-cycle mode: `max(0, expenses − income)`. Those modes also fund only the surplus, so the field is
    true in every mode;
  - 0 at m = 0. Whenever it is > 0, `btcBoughtUsd` is 0.
- **`CyclingResult.totalUnfundedUsd`** (Σ rows) and **`firstUnfundedMonth`** (null if never).
- **`modeConstraints(mode, firstDrawMonth, income, expenses, totalUnfundedUsd)`**: the 5th arg is REQUIRED, so
  an unthreaded face fails `tsc`. It returns `cycleUnfunded = mode === 'cycle' && totalUnfundedUsd > 0`. It is
  cycle-only on purpose: the no-draw modes keep `deficitMode`, and one gap must never raise two notices.
- **The notice** is `unfundedNote(firstUnfundedMonth, totalUnfundedUsd, baselineUnfundedUsd)` (ownershipFaceView),
  ONE sentence for Cycling, Ownership and Strategy. It sits in each face's existing `.constraints` block (no new
  CSS), and on CyclingFace it sits beside the credit-exhausted notice. ⚠ **CAUSE-NEUTRAL:** "From month N, bills
  exceed what income and the credit line can cover — $X over this run is paid by nothing in the model." "The draw
  has stopped" would be false for the credit-line case. The last sentence is the baseline's MEASURED gap ("The
  never-draw comparison leaves $Y unpaid over the same run." / "…pays every bill over the same run."); the third
  argument is REQUIRED (Run 2b), so a 2-argument call fails `tsc`. ⚠ **Under the support policy** the constraints
  box shows `policyUnpaidNote(reading)` instead — it names the real cause (paused / broken / the limits — or, BL14,
  the goal, when the first unpaid month sat at it: § BL14).
- ⚠ Every face reads it from the SAME `sim` that supplies `firstDrawMonth` (the displayed run), so the stress
  lens moves the notice. CyclingFace destructures `cycleUnfunded` ONLY. It does not render `degenerateCap`,
  which is out of scope there.
- **The never-draw baseline has its own gap — now MEASURED** (`baselineUnfundedUsd`, Run 2a). It buys only
  `max(0, income − expenses)` and pays for nothing else. The verdict counts unpaid bills on BOTH sides
  (`verdictVsNeverDraw` compares `allInEquity` with `baselineAllInEquity`), so a gap is never free on either side.
- ⚠ **Path-dependent** (pinned both ways):
  - $4k income against $6k bills at a 45% stop costs **$46,000** over 24 months on a flat $100k path (the stop
    holds from month 2);
  - on REPRO's own 4-yr path it costs **$2,000**: the month-1 on-the-line step stops the draw for one month,
    then the rising price lets it resume.

#### Support-anchored policy — opt-in `supportPolicy` (ENGINE, Run 1; the faces are Run 2; NO store change)

**The defect it fixes:** every safety rule in the engine was measured at TODAY'S price — the draw test allowed
debt up to `cap × collateral × price`, the sweep kept less collateral as the price rose, the migration freed
Strike collateral as the price rose — so the engine borrowed the MOST at the top. The policy uses ONE stress
price everywhere, **`support(t)`** (the power-law floor every recorded cycle low has sat on): each loan is sized to
sit exactly at its stop when price is AT support, and that ceiling does not move with today's price.
`src/simulation/supportPolicy.ts` is the pure leaf; `runCyclingSim` gains `supportPolicy?: SupportPolicyInputs`.
**Absent or invalid ⇒ byte-identical** (the G1 golden). Cycle mode only (any other mode → ignored, reason `'mode'`).

- **Ceilings (at support):** Coinbase debt ≤ `cbColl × S × cbStop` (the engine fixtures' 60% → liquidated 30.2% below
  support; the faces' 45% since Policy v2 → 47.7% below);
  Strike balance ≤ `strikeColl × S × strikeStop` (default 50% — Strike's own max draw, applied at support).
  🔴 **Clamped to each leg's DEFENSE line** — `cbStop = min(stop, CB cap)`, `strikeStop = min(stop, Strike cap)` when
  the Strike cap is on — or a stop above its defense line would pull cold AT support by construction. Under the
  policy `cbLtvCapPct` / `strikeLtvCapPct` ARE the defense lines (where the debt shift and top-ups fire if price
  breaks below support), and `coldStoreBufferPct` is IGNORED (the policy's sweep replaces it).
- **Zones** by `k = price ÷ support`: **paused** `< 1` (float guard `SUPPORT_EPS` 1e-9 — a price computed ONTO the
  line is never below it) · **accumulate** `≤ accumulateBelow` (1.5 in the engine fixtures; 2.0 on the faces since
  Policy v2) · **hold** `≤ payDownAbove` (2.0; the faces' 3.0) · **payDown** above. No latch on zones — the hold band
  (1.5–2× in the fixtures, 2–3× on the faces) is the hysteresis.
- **Hard breaker:** 2 consecutive month-ends below 0.9 × S → **`broken`, LATCHED for the rest of the run** (the
  simulation cannot re-decide for the owner): no new debt, no refinance, no migration, no sweep; the surplus pays
  down, then buys. Month 0 is the opening and never feeds it.
  - **Opt-in re-arm (v1.3 #14), `breakerRearmMonths` — NO default; the owner picks it from A5's re-arm table.**
    Absent ⇒ latched, byte-identical. N ⇒ the breaker re-arms on the Nth CONSECUTIVE month-end at or above support
    (the `SUPPORT_EPS` guard), and that month acts on its zone — the mirror of the trip, whose 2nd month below is
    itself broken. A month-end below support resets the count; a later break latches again. Not an integer ≥ 1 ⇒ the
    policy is ignored with `'rearm'`. `modelBrokenMonth` stays the FIRST break; `firstRearmMonth` and `breakCount`
    report the rest.
  - ⚠ **Layered, not duplicated:** `nextRearmableBreakerState` WRAPS `nextBreakerState`, so the trip rule lives in
    one place, and `cyclingSim` imports ONLY the wrapper. A guard test enforces both.
- **Pay down to ZERO, keep the buffer as COLLATERAL:** in payDown/broken the surplus retires Strike (13%) then
  Coinbase **to zero** (the 0.005 residual sweep — the clearStrike precedent). The sweep keeps
  `max((cbDebt + bearBufferMonths × expenses) / (S × cbStop), cbDebt / (cap × price))`, so after every sweep Coinbase
  has exactly the buffer of room at support. ⚠ **The buffer is also the flywheel's working room** — 0 starves the draw.
- **Restore (any zone):** a leg over its ceiling at a non-drawing month's decision is repaid first, by exactly its
  excess, **Coinbase before Strike** (Coinbase liquidates instantly; Strike has a cure window).
  - ⚠ **EXCEPT after a Coinbase liquidation, in EVERY zone** (`strikeFirstAfterLiquidation`, adopted, default on): in a
    pay-down or broken month Coinbase's half of the restore is skipped, so the pay-down retires Strike first and the
    leftover Coinbase debt after it; in a paused, accumulate or hold month (P3, crash playbook Run 1) the same budget,
    `min(surplus, cbExcess + skExcess)`, repays Strike first, up to its whole balance, then the leftover. The
    instant-liquidation reason is gone once Coinbase has been liquidated — the leftover is unsecured debt at the Coinbase
    rate, while Strike costs 13% and can still be called. Before a liquidation the restore is unchanged (§ LTV defense →
    "The cold rules below support").
- **Cash reserve** (`openingCashUsd`; the view will pass months × bills): spent on bills first (only what income
  and the line cannot pay), then on a Strike cure; never refilled. `openingCashUsd − totalCashToBillsUsd −
  totalCashToCureUsd === cashLeftUsd`. The faces' verdict must subtract `totalCashToCureUsd` (money from outside the
  loop lowered the debt); `equity` itself is unchanged.
- **The month, in order (each step's reason is the design):**
  1. interest — then **Morpho's seizure on the way down** (Policy v2: the carried loan at or past 86% at this month's
     price is seized at the liquidation price, and the month runs on the survivor); 2. state — breaker (m ≥ 1), then the
     zone;
  3. **draw, accumulate only:** `available = max(0, min(skRoom, skCeil, cbAbsorb))`, `cbAbsorb =
     max(0, cbMaxDrawForHeadroom(cbRoom, cbDebt) − strikeBal)`. ⚠ **Strike is a CONDUIT, not a store:** it draws only
     what Coinbase can take back at the next refinance, so its unused line stays the reservoir the debt-shift defense
     draws on below support. (Pinned by the conduit clause: an accumulate row's month-end Strike balance is at most
     one month's interest on a bill.)
  4. **not drawing:** Strike interest; bills income → cash → unfunded; Strike's minimum from what the bills left when
     the owner pays it from income (`strikeMinFromIncome`, the plan of record's Run 2 — an unpaid part capitalises);
     restore (Coinbase first — except after a liquidation, see Restore above); payDown/broken → pay down; the rest
     buys — except at the goal (BL14), where the pay-down runs in any zone and the rest is kept (`goalHeldUsd`), never
     bought. (In a drawing month income pays the minimum after the bill's unfunded part and before the buy.)
  5. **migration** (the RATCHET FIX): keep `strikeKeepCollateralBtc(line, bal, strikeStop, S)` =
     `max(line, bal) / (strikeStop × S)` — the FULL line at support, not today's
     balance at today's price (the old `keepForMargin` ran while the balance was $0). Strike's retrieval rules:
     all-or-nothing, only at ≤ `STRIKE_RETRIEVE_MAX_LTV` (40%) before and < 50% after, never inside the 60-day hold
     that follows ANY cold → Strike move (`strikeHoldUntil = m + 2`), never while paused/broken — except at the goal's
     STAND-DOWN (BL32): at the goal with both loans repaid (`goalStandsDown`, read here, after step 4's pay-down — the one
     flag step 9 reads too) the keep is 0 (`strikeKeepCollateralBtc(…, standDown)`), no pause, breaker or earlier seizure
     gates it, and the release goes straight to cold (`strikeToColdBtc`), never into Coinbase; the hold, the release
     rules and the cadence still apply (`engines.md` § The plan's goal amount → "The stand-down");
  6. **refinance, accumulate/hold only**, ALWAYS ceiling-capped (fee-inclusive): none in payDown/broken (a 2% fee on
     debt about to be repaid) or paused (the support ceiling can still show room below support, and moving debt
     onto Coinbase there raises its LTV at today's price exactly when it is most exposed);
  7. **the crash playbook** — top up first between the liquidation depth and support, then the debt shift → Strike
     reserve → survival guard → CB top-up (release-aware) → Strike top-up (§ LTV defense → "The crash playbook");
  8. **Strike margin call — MODELLED** (`resolveStrikeCall`): a month-end at/over the call is UNCURED (a monthly engine
     cannot see the 72 hours) → cash, then cold, then a sale down to `STRIKE_CURE_LTV` (65%); at/over the partial
     liquidation LTV (85%) the sale is immediate and cash/cold are untouched. A cure's cold JOINS `coldRetrievedBtc`.
     ⚠ **Why spend a partial cure:** each cold coin moved in saves `0.65/0.35 = 1.857` coins from the sale (a sold
     coin also retires debt). ⚠ **NOT gated on `liqMonth`** (v1.1 #3) — Strike is a separate facility; a Coinbase
     seizure does not end it, and skipping the sale would overstate the survivor coins;
  9. **sweep** (the FORWARD-LOOKING COINBASE RESERVE), keep = `cbKeepCollateralBtc(cbDebt, buffer, S, cbStop, cap,
     price)`: Coinbase keeps what it needs AT SUPPORT plus the buffer, so it
     never enters a drawdown holding less than it needs at the line. Not while paused (the collateral is needed
     where it is) or broken (the premise "safe at support" is suspect) — except at the stand-down (step 5's flag, BL32):
     keep 0 (`cbKeepCollateralBtc(…, standDown)`), in any zone, past a seizure too;
  10. LTV / breach unchanged.
- ⚠ **M1:** `strikeMarginMonth` is read AFTER step 8, and a resolved call ends at ≤ 65%, so under the policy the
  call is reported by `strikeCall` / `firstStrikeCallMonth` and the flag stays null unless a sale leaves a
  deficiency — then it is set in the sale month. `modelStrikeLiquidation: false` restores the HEAD flag-only
  behaviour (TEST-ONLY).
- ⚠ **No phantom sales (v1.3 #13).** A sale that takes Strike's WHOLE collateral leaves unsecured (full-recourse)
  debt at an LTV of ∞, so every later month would land in the immediate-sale branch and "sell" nothing. An immediate
  sale of ≤ `DUST_BTC` is therefore `'none'`: the call counts once, and the restore rule repays the debt left from
  surplus. Every modelled call must MOVE something — cure cash, cure cold or coins sold (G4 asserts it).
- **Draw causes stay separate (v1.1 #1, v1.2 #9):** `creditExhaustedMonth` keeps its HEAD meaning — Strike's OWN
  capacity `min(line, coll × price × 50%) − drawn` < the bill; a draw cut by the policy's ceilings sets
  `firstCeilingThrottleMonth` instead. Both are gated on `liqMonth === null`. `stopMonth` under the policy means
  "the draw stopped for a zone or ceiling reason". ⚠ **Run 2 note (v1.2 #11):** the "Strike credit exhausted" copy
  read `rows[m].strikeShortfall`, which is 0 in a non-drawing policy month — word it from the cause fields.
  → `creditExhaustedNote({ creditExhaustedMonth })` (cyclingFaceView; CyclingFace renders it) names the MONTH only:
  "Strike's own line first falls short of the full bill in month N — in those months your paycheck covers what it
  can." No figure and no "thereafter" (Run 2b.1), because any figure from the first short month is false: with the
  policy off its shortfall is neither what the paycheck paid (a shortfall above the paycheck is partly unpaid) nor a
  constant (the full draw can resume) — pinned on P9 ($4k / $6k), where both happen; with it on, the month is
  recorded at the decision and may not have drawn at all. The unpaid line beside it carries the money. Ownership's
  verdict says the same: "Strike's line first falls short of the full bill in month N. In those months your paycheck
  covers what it can, so fewer sats get bought — self-limiting, not a hard stop."
- 🔴 **§2 wall:** `cyclingSim` imports `./supportPolicy`, a leaf that imports only `./ltv`. `supportPath` is a plain
  `number[]` built by the VIEW (Run 2: `supportPolicyInputs.ts`; in Run 1 only the test helper builds it) —
  **NEVER stressed, NEVER phase-shifted**: the stress lens moves the price, not the line.
- **Decision-face fields (Run A).** FOUR additive `CyclingRow` fields, and TWO optional opening inputs.
  - `sweptToColdBtc` — step 9's Coinbase → cold move THIS month. ⚠ A FLOW beside cumulative neighbours: Σ over the
    run — with BL32's `strikeToColdBtc`, step 5's Strike → cold at the stand-down — = the last row's
    `coldFromCb + coldFromStrike`. ⚠ `sweepToCold` RETURNS what it moved and **both** call
    sites accumulate it — the classic one is reached only by a policy-OFF run, so the footings are pinned on BOTH
    arms (a policy-on-only pin lets a dropped `+=` there survive).
  - `refinancedUsd` / `refinancedFeeUsd` — step 6's cash and its capitalised fee. Σ = `totalRefinancedUsd` /
    `totalCbFees`.
  - `strikeKeepBtc` — step 5's keep when that gated block evaluated it and it is finite, else `null`. Policy-only. 0 at
    the stand-down (BL32), which evaluates it in any zone.
  - `openingBreaker?` / `openingStrikeHoldMonths?` — **THE POLICY'S MEMORY, seeded from PRICES** (D14). Absent or
    JUNK ⇒ byte-identical (`validOpeningBreaker` / `validHold`; junk reads as absent). ⚠ **NOT test-only** — the
    Decision face and THIS MONTH / Daily (`planMonthRun`, Run 2) set them, so they must never join the forbidden-input
    grep; nor may `strikeMinFromIncome` (Run 2 — the owner's minimum, a real input on every face and main screen).
  - **The main screens' memory (Run 2):** the breaker as folded today, else THIS device's cache of the last fold
    (`planBreakerCache`, read through `validOpeningBreaker` — planRun's `planBreakerCacheOf`; offline-first, §4.3);
    Strike's hold from its ONE fact, `strikeDepositOf` (the owner's journal, or a trusted viewer's snapshot date —
    D9) through `strikeHoldAt`.
  - result `openingBroken` — the run OPENED broken. ⚠ `modelBrokenMonth` stays the first IN-RUN trip, so a seeded
    break has `openingBroken: true` and `brokenMonth: null`; every copy reader must test BOTH, through the ONE
    `hadBreak` predicate in `supportPolicyView.ts` (`policyHeadline` AND `policyDetails`).
  - **The memory doctrine:** a run shown as this month's move starts from the real balances — which carry every
    past decision — plus the breaker folded over month-end closes (`breakerFromHistory`) and Strike's hold from
    LOGGED deposits (`holdMonthsFrom`). **Never from a decision log.** Measured: unseeded, a false-recovery crash
    re-borrows, is liquidated, and ends ~1 ₿ behind; seeded, every re-planned crash path reproduces the continuous
    run exactly (`decisionMemory.test.ts`).
- **Fields:** see `SupportPolicyInputs`, `CyclingRow`, `CyclingResult` and `PolicyIgnoredReason` in `cyclingSim.ts`.
  Every policy field is neutral (null / 0 / `'none'`) when the policy is not applied. Month 0 carries the OPENING
  zone and headrooms (no action) — the free over-the-ceiling check. A CB cap ≤ 0 leaves no effective stop →
  `'cbStop'`. Ledgers foot to 1e-8: coins (`opening + Σ bought − sold − seized`; ⚠ a seizure in the LAST month has not
  left `last.btcHeld` yet), cold, cash.
- **TEST-ONLY inputs:** `incomePath` (income[m]; a finite ≥ 0 entry replaces income — 0 is an income shock; the
  baseline uses the same path) and `modelStrikeLiquidation`. The survival-guard grep test covers both — and Policy v2's
  `seizeOnTheWayDown` (`false` = the month-end reading).
- **What it replaced:** the migration-ratchet fix (step 5), the forward-looking Coinbase reserve (step 9) and the
  Strike seizure (step 8) are BUILT here — in policy mode only; the policy-absent engine is unchanged. The defense order
  below support is the crash playbook (§ LTV defense → "The crash playbook", step 7).
- **Measured on SP_REPRO (A5; fixture-bound — re-run the A5 generator for every figure):**
  - on the $8k / $6k budget the Coinbase ceiling NEVER binds (the draw is one month of bills; buys and support
    growth add room faster) — **P9** ($4k / $6k) is the case where it fills;
  - in G3's scope (≥ 0.80 × S) the face-default OFF twin never liquidates either: its defense stack holds, funded by
    cold banked on the rise and pulled back ABOVE support on the P2 family — exactly what G2
    separates. G3's non-vacuity is therefore shown with the OFF twin's defense stack STRIPPED (it liquidates on the
    spec's synthetic 2.8× → 1.0× path) while the policy never fires a defense there;
  - **defense in depth:** the ceiling and the zones EACH keep G2/G3 on these paths, so a single-layer mutation is
    compensated by the other; a full reversion to price-relative rules turns G2 red, and single-layer breaks are
    caught by the mechanism tests (the conduit clause, P9's ceiling fill, the clamps);
  - costs: on the 4-yr cycle the policy holds fewer ₿ than OFF with much less debt; on the support line it holds the
    same ₿ (the coins only sit on Coinbase rather than in cold); after a LATCHED break (P3, P6, P9) it never borrows
    again unless the opt-in re-arm is set, so its long-run numbers after a break are conservative by construction;
    under P7's income shock it leaves far more bills unfunded than OFF without cash (it will not borrow below
    support). ⚠ **Compare the arms on ALL-IN equity** (`allInEquity`: equity − unpaid bills − cash spent on bills and
    cures — the report's column since Run 2a): equity
    alone counts an unpaid bill as free and outside cash as a gain.
- **Risks, in plain words:** the whole policy is a bet on the power-law line, especially its slope (fits run
  b = 5.63–5.96; P8 measures a wrong line — on a 5.63 line P1 is paused the whole run and never borrows); tops are
  compressing, so if the next top stays under 2× pay-down never fires, and if price never returns to ≤ 1.5× buying
  with the line never resumes (the failure mode is buying less, not losing coins); the backtest flatters (support was
  fitted to those bottoms; the Jun-2026 low ~2% under support is the first out-of-sample test); income, not price,
  is the hidden liquidity risk (credit disappears in a crash — P7 and the cash reserve exist for it); monthly steps
  cannot see the 72-hour window or an overnight gap to 85% (hence "uncured at month-end"); re-borrowing after a
  pay-down costs the 2% origination fee (pay-down is a safety and capacity lever, not a return lever).
- **Tests** (no counts here — they rot): `supportPolicy.test.ts` (the leaf: zones + the epsilon pair, headroom,
  sweep keep, sale sizing, ⭐ `resolveStrikeCall` cases a–f (f: an emptied Strike is `'none'`), the breaker latch
  and the opt-in re-arm, pay-down order);
  `cyclingSimPolicy.test.ts` (⭐ G1–G4 plus every behaviour above); `supportPolicyPaths.ts` (the shared fixture +
  P1–P9 builders — NOT a test file; P9's dip is placed at its no-crash twin's measured peak); **the G1 golden**
  `goldens/supportPolicyG1.golden.json` (the policy-absent engine at 2125cc2 on SP_REPRO × P2 (phase 0, −4) and
  P9-OFF ($4k / $6k — REGRESSION COVERAGE of the defense-heavy OFF engine, which sits on its 70% cap at month-end;
  NOT a mutant-killer) — ⚠ regenerate it ONLY deliberately, from the SHA in its meta; a diff to it means
  policy-absent behaviour moved. ⚠ The G1 runs feed the engine the golden's STORED price path, never a recomputed
  one — P2 and P9 are built with `Math.pow`, whose last bit differs
  between Node 22 (CI) and Node 26; see the exact-golden Critical Constraints row); `supportPolicyReport.test.ts`
  (the committed A5 generator — `describe.runIf(SP_REPORT)`, skipped by the normal suite; run
  `SP_REPORT=1 npx vitest run src/simulation/__tests__/supportPolicyReport.test.ts --reporter=verbose` — ⚠ keep
  `--reporter=verbose`, or a non-TTY run drops the output; the output is never committed).

##### Policy v2 (BL6) — Morpho seizes on the way down; the faces' defaults are C1

Spec: `pbloc-spec-policy-v2-safety-v1.md` (through v1.6): Run A (the model) and Run B (the faces — the block at the end of
this section), each its own build.

- **The rule — `seizeOnTheWayDown`: policy-only, ADOPTED, default ON** (absent ⇒ on; `false` is the TEST-ONLY
  month-end reading, kept so the tests and the report can measure the rule — never "fix" the default to off; the
  forbidden-input grep covers it). A month-end reading runs every rescue before it looks at the loan, so a month that
  gaps down past 86% from a month-end that looked fine was a rescue in the model and a seizure in real life. From month 1,
  right after the month's interest and before any monthly action, the Coinbase loan carried from last month-end is read
  at THIS month's price: at or past `CB_LLTV` Morpho seized it on the way down, at the liquidation price
  `cbLiquidationPrice(debt, pool)` (≥ the month's price, by the test).
  - It takes `CB_LIF × CB_LLTV ≈ 0.898` of the pool and repays the loan in full — debt EXACTLY 0, no deficiency.
  - The month then runs on the survivor: it pays bills (income, then cash), repays Strike first and buys; it draws,
    refinances, migrates, defends, tops up and sweeps nothing (every later gate reads `liqMonth`), and the month-end
    breach can't fire again. The Strike call still runs (it was never gated on `liqMonth`).
- **Result fields:** `seizedOnTheWayDown` (false at a month-end seizure and with no liquidation) and `seizurePriceUsd`
  (the liquidation price on the way down; the month's own price at month-end — null at a price ≤ 0; null with no
  liquidation). ⚠ **Which row is the liquidation row:** at month-end it is pushed PRE-seizure (the position that
  breached); on the way down it is the SURVIVOR — it owes nothing, so its CB LTV reads 0.0%.
- **Month 0 keeps the month-end reading** (an opening already past 86%), and so does the policy-off engine. Since the
  rule, a Coinbase LEFTOVER (a deficiency) arises only from a month-0 seizure — reach cell 0 (`reachGrid()[0]`) is the
  tests' fixture for it.
- **F9 — the month-end seizure repays a covered pool in full.** When the pool covered the debt (`need ≤ seized`, `need =
  debt × CB_LIF ÷ price`), the debt becomes exactly 0: the round trip (`need × price ÷ CB_LIF`) left a ≈ 3e-11 residue
  that the faces printed as "$0 of debt survives" (29 grid runs at the commit before it). A short pool still keeps its
  real deficiency.
- **What it retires (F3).** Measured over PV2-2's 15,549 policy-on runs (the report's `-t "policy v2"` block), rule on ·
  month-end reading: flipping the doom gate moves 0 runs · 1,474; the futility check 0 · 968; Strike first after a
  liquidation 7 (all month-0 seizures) · 1,340. A doomed month opens past 86% at its price, so the rule seizes it first;
  a seizure on the way down leaves no leftover, so Strike-first acts only after a month-0 seizure. All three stay in the
  code: the doom gate is reached only with `seizeOnTheWayDown: false`, and the futility check also runs with the policy
  off.
- **The kill criterion** (I1, `seizeOnTheWayDown.test.ts`): a run the rule doesn't fire on deep-equals its month-end
  reading; one it fires on at month L is identical through L − 1, and the month-end reading never liquidated it earlier.
  0 violations over the kill sweep's 15,564 runs per setting.
- **ONE liquidation price — `cbLiquidationPrice` lives in `runCoinbaseLoan.ts`, not cbMetrics.** The engine's import
  graph must stay + − × ÷ (the G1 walk), and cbMetrics accrues with `Math.pow`; runCoinbaseLoan is already in the walk.
  cbMetrics' `liqPriceOf` delegates to it, so `cbMetrics().liqPrice`, `cbSeizurePrice` and the engine's seizure share one
  expression (a source test pins it).
- **`supportPolicyResolution(PolicyRunContext)`** — would this run apply its policy, and if not, why? The run's own
  answer without running it (Run B checks it before a run). The run and it share ONE `resolveRunPolicy` — an empty price
  path runs as `[0]`, so its support path must be one month long — and `resolveSupportPolicy` has no other caller. Its
  answers are pinned, not only compared with the run (F10: a shared function can't catch its own drift).
- **C1 — the faces' defaults** (`DEFAULT_SUPPORT_POLICY_SETTINGS`): Coinbase 45% at support (Morpho's line 47.7% below
  it), Strike 50%, buy to 2.0×, pay down above 3.0×, 12 months of room kept (the owner's pick, D1), no cash reserve.
  Since the plan of record (Run 1) the six numbers live in `lib/planPolicy` (`PLAN_POLICY_DEFAULTS`), and
  `DEFAULT_SUPPORT_POLICY_SETTINGS = { enabled: true, ...PLAN_POLICY_DEFAULTS }`; they are the saved plan's defaults.
  - **D2** widens the sliders: the buy zone to 2.5×, pay down to 5.0×, the room to 48 months.
  - **D3:** the Emergency Console and the Monthly Playbook follow the plan's Coinbase limit — 45% at C1
    (`policyCbStopAtSupportPct`, since the plan of record's Run 1; before it, the policy's default stop). The depth is
    0.45 ÷ 0.86 ≈ 0.52× support at C1 (0.47× at a 40% target).
  - ⚠ **The engine fixtures keep the pre-v2 policy:** `policyFor(support)` is 60 · 1.5 / 2.0 · 12 — every gate and pin
    was measured on it — and the faces' policy is `policyFor(support, V2_DEFAULTS)`. supportPolicyView.test reads its
    fixture runs with `FIXTURE_SETTINGS` (F6), never the defaults.
- **Placement (F8):** at the fixtures' policy acting today is never worse; at C1 it is within 0.025 ₿ on the A5 paths ×
  four positions (worse on 6 of 60) — the 45% ceiling binds in year one, so the earlier draw moves buying earlier rather
  than adding to it.
- **F4 — the defense line is the next month's margin.** A month that opens under 86% survives whatever the month does;
  the top-up only lowers the LTV for the NEXT fall (Coinbase restored to 70% survives a further one-month fall of 18.6%).
  So the reserve saves Coinbase only when nothing else can restore the line and a second drop follows. F4's line-first
  fixture (`lineFirstInputs(k2, cold)`, supportPolicyPaths): month 1 at 0.80× support, Coinbase at 80%, Strike's line full
  at 45%. At k2 0.72 month 2 opens at 86.7% with no reserve (seized) and at 75.9% with 0.5 ₿ (survives); at k2 0.5 it
  opens at 109% and is seized with the cold inside. ⚠ It opens over its Coinbase limit at support — outside G2's scope.
- **The copy the rule made false, fixed:**
  - F5a — `policyReading.afterLiquidation`: on the way down the liquidation month itself is after it (its row is the
    survivor, already repaying Strike first); at month-end, strictly after.
  - F5b — the Decision schedule: `rowActions(row, liqMonth, seizure)` lists "Coinbase liquidates the loan on the way
    down, at $P." FIRST in its month (the price only above the dust floor); a month-end seizure is still last ("Coinbase
    liquidates the loan.").
  - F5c — Ownership's verdict, `liquidationVerdict(sim)` (ownershipFaceView): "Liquidated in month N on the way down, at
    $P." — the row's LTV would read 0.0% — with the "at" clause only above the dust floor (`shownUsd`); a month-end
    seizure still reads "Liquidated in month N at X%." It outranks every other verdict.
  - F5d — the faces' playbook note (`playbookNote`, Cycling and Ownership): a liquidation outranks both "held" and
    "unheld" — "Coinbase was still seized on the way down in month L." / "…liquidated in month L." — since a playbook that
    held its line can still lose the loan to a later drop.

**Run B — the faces** (spec v1.6 §9; its plan is Appendix E, approved with R9–R11). Every surface reads the ONE per-row
seizure price, `cbSeizurePrice`. The counts below are the report's PV2-3 / PV2-4 (`-t "policy v2"`).
- **B1 — the card names where Coinbase seizes.** `PolicyReading.cliff` is `cbSeizurePrice` of the inspected row, set
  only while it sits under that row's price. `policyDetails` puts "Coinbase seizes at $C — N below the price at month M"
  ("…below today's price" at month 0, D2) right after the Coinbase line. There is no line with the policy off or ignored,
  with no loan, on or after a liquidation (`postLiquidation`), or under the dust floor. Measured on the kill sweep's runs
  (rule on): 348,810 + 353,415 rows with a cliff, 0 at or above the price, the closest 0.3442% under it (C1). v1.0's
  563,378 is a subset: it leaves out a5's cash-6 copies and the synthetic cap-off arm.
- **F11 — `fmtBelowPct`** (supportPolicyView, ONE definition; the card and THE MOVE both read it). Under 1% it reads
  "less than 1%"; from 99.5% it reads "more than 99%" (D1: 1,163 grid rows would print "100% below", P6 at C1 among them);
  otherwise a whole percent.
- **R9 — the price floor lives in `cbSeizurePrice`.** A seizure price under $0.50 is no price (60¢ owed on 2 ₿ seizes at
  35¢). So `cliffPath`, the Worst (modeled) cushion, the card and the charts all inherit it. THE MOVE keeps its own
  `shownUsd(m.liqPrice)`, since it reads `cbMetrics`, not a row.
- **B2 — one formula on the three parent charts.** `chartCliffUsd(row)` (cyclingFaceView) only rounds `cbSeizurePrice`.
  `chartOwnershipRows(rows, cbStopEffPct?)` dropped its `cbLiqLtv` parameter and its own formula.
  - Every series is "Coinbase seizes" in the Decision chart's style (`stroke="var(--red)" strokeWidth={1.25}
    strokeDasharray="1 3"`, linear, `connectNulls={false}`): Ownership's and Strategy's "Price & liq" (renamed from "CB
    liquidation", D4) and Cycling's "BTC price path", which gains a Legend (D5).
  - ⚠ **R10:** Cycling draws the series — so its Legend lists it — only when a cliff exists
    (`hasCliff = chartRows.some((r) => r.cliff !== null)`, the Decision chart's rule).
  - The line now ENDS at the seizure. The old formula still drew a point on every row after it: with the policy off,
    32,677 grid rows of leftover debt against newly pledged coins.
  - D7: Ownership's tile and safety line read `cbLiquidationPrice` (byte-identical). The other app copies of the formula
    are logged, not built.
- **B3 — THE MOVE's price alert.** The cliff line takes the dust floor and `fmtBelowPct`. Inside the same block, `alertLine`
  adds at most one line, keyed `'alert'`, right after the cliff:
  - T (`cbMetrics().triggerPrice` at the owner's trigger, on `plan.opening`) under today's price → "Set a price alert at
    $T in your exchange app — Coinbase reaches your t% trigger there." plus the console clause (`consoleTail`, D9). Tone
    plain.
  - T at or above today's price → "Coinbase is at or past your t% trigger at today's price — work from the Emergency
    Console" (+ " (it runs when your Coinbase strategy is LTV-triggered)" when it isn't). "At or past" (D8): at exactly the
    trigger, "past" is false. Tone warn. (The plan of record's Run 4, D3: the console runs with any Coinbase loan, so
    this clause and `consoleTail`'s read " (it runs once your Coinbase loan is switched on)", and the sentence is
    crashPlaybookView's `atTriggerLine(t, consoleRuns)` — one copy with the CB Loan tab's banner.)
  - A trigger counts only when it is finite, above 0, and its price is above the cliff. A 0% trigger puts T at ∞; 86% or
    more puts it at or under the cliff.
  - **R11:** no alert on a sliver of a loan — none when the cliff is 99.5% or more below today.
- **B4 — the Decision face's seeding gate asks the run's own question.** `seedsFromMove(seeded, ctx)` =
  `seeded && supportPolicyResolution(ctx).policyApplied` (decisionView). DecisionFace's `ENGINE_CONTEXT` (since the plan
  of record's Run 2, `PLAN_ENGINE_CONTEXT` in planRun.ts — THIS MONTH's run passes the same gate) — the mode, the
  two caps, the Strike margin and draw lines — is ONE object that `engineInputs` spreads and the gate reads, together
  with `supportPolicy`, `paths[0]` (every path is the support path's length) and the bills. It closes the residual § Decision
  face named: at a Strike liquidation LTV at or under its 70% call (`'strikeLadder'`) the engine ignores the policy, yet the
  run used to start from a move the card never named.
- **B5 (D4) — `firstOpenPastLltvMonth` and the policy-off note.**
  - **The field:** the first month (m ≥ 1) whose loan, carried from last month-end, opens at or past 86% at that month's
    price after its interest — before any liquidation, while Coinbase holds collateral. ONE condition (`opensPastLltv`)
    serves it and the rule.
  - **Under the applied policy** it IS the rule's month, or null — in both readings, on every kill-sweep run.
  - **With the policy off** (15,549 runs) it flags 7,709. The month-end reading then never liquidated 5,447 of them,
    liquidated 1,879 that same month, and 383 later. What rescued month N: the debt shift on 3,603 runs, a top-up alone on
    2,211, buys alone on 16. 579 runs open past 86% in two months or more; the field keeps the first.
  - **The note:** `openPastLltvNote(sim)` (cyclingFaceView) — "In month N the Coinbase loan opened past 86% at that
    month's price — Morpho would seize it on the way down; without the support policy, this projection reads it only at
    month-end, after that month's rescue." It shows only when the run survived month N (never liquidated, or liquidated
    later) — never when it was liquidated that same month, where no rescue happened — and never with the policy applied.
  - **Placement (D13):** Cycling and Ownership put it in an amber note right after the verdict (never inside Cycling's
    verdict box, which a winning run colours green); Strategy puts it in a warn state line after the liquidation line.
- **B6** — the four "$X of debt survives" prints (Cycling, Strategy ×2, `liquidationVerdict`) also need
  `shownUsd(sim.deficiencyUsd)`, so a 30¢ residue is never printed as "$0 of debt survives".

#### Support policy — Faces (Run 2: 2a the pure layer, 2b the card and the wiring — built)

Spec: `pbloc-spec-support-policy-faces-v1.md` (through v1.3). ⚠ **2a and 2b merge to `main` TOGETHER** — 2a alone
moves the verdict to the all-in basis before any copy says so (v1.1 #4).
- **ON by default on all three engine faces** (`DEFAULT_SUPPORT_POLICY_SETTINGS`, frozen, decision 1): Coinbase 45% /
  Strike 50% at support, zones 2.0× / 3.0×, 12 months of room kept, a cash reserve of 0 months — Policy v2's C1 (before it,
  60 · 1.5 / 2.0 · 12, which the engine fixtures' `policyFor` keeps). Since the plan of record (Run 1), every face's
  setting is a SESSION what-if over the owner's SAVED plan (`Overlay.supportPolicy`, patched over `usePlanPolicy()`); no
  face writes the plan — Settings' "Your plan" is its only editor. The sliders' "Back to your plan" drops the what-if;
  "Reset to live" clears the whole overlay. **Re-arm 6**
  (`DEFAULT_BREAKER_REARM_MONTHS`, the owner's pick from Run 1.1's table): a constant, never a control; `undefined`
  would latch. **Cycle mode only** — in any other mode the engine gets no policy and the face reads as before.
- **`effectivePolicySettings`** clamps into `SUPPORT_POLICY_RANGES` (junk → the default), pushes `payDownAbove` to ≥
  `accumulateBelow + 0.1` (`payDownPushed`), and derives the stops the run USES through the engine's
  `effectivePolicyStops` — never a second clamp — plus `cbClamped` / `skClamped`. ⚠ **Every readout shows the
  EFFECTIVE threshold, never a slider value** (v1.3 #17–#18): `settingReadouts` ("65% — held to your 60% defense line:
  liquidated 30% below support"; "2.10× support — held above your 2.00× buy zone"), `policyTileSub` ("limit 60% at
  support · defense 60%"), `defenseLineNote`, `policyTip`.
- **`supportPolicyInputs.ts` is the faces' ONLY §2 crossing for the policy.** `buildSupportPath` is
  `plBandAt('floor', …)`, bit-equal to the on-the-line price path from month 1. `supportPolicyFor` returns `undefined`
  when off or not `cycle`. The cash is months × the face's bills, and the re-arm key is OMITTED when the constant is
  undefined (a latched run is Run 1's object). It never sets a test-only input — a key-set test pins that.
- **`futuresRun.ts` is the faces' ONLY §2 crossing for the futures** (Policy v2 — the lenses), as `supportPolicyInputs`
  is for the support path: `pricePaths` (a belief leaf beside `cyclePath`) draws them, `monteCarlo` (the engine side)
  runs them, and only `futuresRun` imports both.
- 🔴 **The wiring, identical on the three faces — memoised on STABLE identities.** `policyRaw` (defaults ⊕ the saved
  plan ⊕ the overlay key — `{ ...DEFAULT_SUPPORT_POLICY_SETTINGS, ...plan, ...overlay.supportPolicy }`, deps
  `[plan, overlay.supportPolicy]`, since the plan of record's Run 1; `plan` keeps its identity through `useShallow`) →
  `policySettings` → `supportPath` (`buildSupportPath(startDate, months)`) → `supportPolicy`, each a
  `useMemo`. `supportPolicy` goes into BOTH `engineInputs` and the lens-reset deps. ⚠ An object built during render
  has a new identity every render: `engineInputs` would rebuild, both engine runs re-run, and the lens reset fire on
  every render, so an engaged stress dies at once (the `useStressLens` bug class).
  - The stress run spreads the SAME `engineInputs`. `supportPath` is never stressed or phase-shifted: the lens moves
    the price, not the line.
  - `supportAtMonth = supportPath[monthIdx]` — one source; `plBandAt('floor'` appears in no face.
  - Cycling has no mode, so it passes the literal `'cycle'` and selects `strikeLiquidationLtvPct` from the store.
- **`SupportPolicyCard.tsx`** (+ `.module.css`, the FreshnessBadge precedent; tokens only) sits directly after each
  face's Strategy / controls card; on the Strategy face it is one of two additions (the futures readout is the other —
  § Unified Strategy face). States:
  - not cycle → "Applies to the Cycle strategy only."; off → "Off — limits are measured at today's price, the way
    the projection worked before." + **Turn on**;
  - **ignored** → `policyIgnoredNote(sim.policyIgnoredReason)` + Turn policy off. Reachable: a dashboard Strike
    liquidation LTV at or under the 70% margin call is `'strikeLadder'`;
  - on → the headline in its tone, the zone strip, the details, and a native `<details>` **Settings** disclosure,
    **collapsed by default**: six unchanged `SliderInput`s (value + a quiet clause line), Turn policy off, Back to your
    plan (the plan of record, Run 1 — it drops the face's what-if; it read "Reset to defaults" before). No re-arm control.
  - **The futures' line** (Policy v2 — the lenses, R2): the optional `futuresLine` / `futuresRunning` props end the card
    with `futuresCardLine` — after the details list when 'on', inside the state body's section when 'off' or 'notRun',
    never for another strategy ('notCycle': the card already says the policy is for Cycle only). The 'off' line shows
    the chance of a seizure alone — the price of turning the policy off. It dims while a newer run goes (`aria-busy`).
    **Run 2 (the owner's device check, DC1):** it reads in sentences that name what they count, calls the 1,000
    "simulations" (W-4), and says when Coinbase seizes (W-3) — the share of ALL the simulations seized within the first
    year, then the month by which half of the seizures have happened: "Over the next 5 years, in 1,000 simulations: in 8
    of 10, you end owning a–b ₿; Coinbase seizes in x% of them — y% within the first year, half of those seizures by
    <Mon YYYY>." With the policy off: "Over the next 5 years, in 1,000 simulations: Coinbase seizes in x% of them — …".
  - The zone strip: one flex cell per month (`min-width: 0`; the gaps drop to 0 past 96 months, so a 240-month horizon
    never scrolls sideways), a 2px inspected-month marker, `role="img"` named by `zoneStripLabel`, a legend of the
    zones that occur.
  - **`ZONE_COLOR` is ONE map** — strip, legend, the Milestones Zone column and the switch table's Zone (its LTV view;
    § Milestones on a phone) — each ≥ 3:1 on `--surface`:
    accumulate `--green`, hold `--text-muted` (⚠ `--text-faint` fails 3:1), pay down `--btc`, paused `--amber`,
    broken `--red`.
- **`supportPolicyView.ts`** (pure; no belief, store or React; never imports `cyclingFaceView`, which imports it):
  `policyReading` → `policyHeadline` / `policyDetails` / `neverDrawsNote`.
  - Headline precedence: **latched break > sold > re-armed break > over the limit > cold pulled above support > cured
    > paused > zone**. A re-armed break reads `warn`, a latched one `bad`; buy and pay down `good`, hold `quiet`.
  - Detail order: room (Coinbase) · where Coinbase seizes (Policy v2 Run B, B1) · room (Strike) · breaker · call · cash ·
    unpaid · the cold promise or alarm.
  - **After a Coinbase liquidation (crash playbook Run 1).** `PolicyReading.afterLiquidation` = `monthIdx > liqMonth`,
    STRICTLY at a month-end seizure — the liquidation row is pre-seizure, so that month keeps today's words; on the way
    down (Policy v2) the liquidation month itself is after it (`seizedOnTheWayDown` — its row is the survivor). The
    lines name the order spare income repays in, via
    `overSentence(leg, roomUsd, 'first' | 'afterCoinbase' | 'afterStrike')`:
    - Coinbase over its limit: "Coinbase was liquidated in month L and is still $X over its limit at support — spare
      income repays it after Strike" — ⚠ **"after Strike" ONLY while Strike owes** (`PolicyReading.strikeOwes` =
      `shownUsd(row.strikeBalance)` at the inspected month), "…repays it first" once Strike is repaid (spare income then
      goes straight to Coinbase; on reach cell 0 — a month-0 seizure, the one way a leftover arises since Policy v2 —
      Strike reaches $0 in month 6 while Coinbase stays over until month 10);
    - Coinbase not over: "Coinbase was liquidated in month L — the policy borrows nothing more";
    - Strike over its limit: "Strike is $X over its limit at support — spare income repays it first";
    - Strike not over: the line is OMITTED — "room at support" would read as borrowing runway once nothing is borrowed.
    - Before a liquidation, Strike over while Coinbase is over reads "…after Coinbase" (unchanged).
    - The headline's over branches use the same sentences (precedence unchanged), and an accumulate month after a
      liquidation reads "Coinbase was liquidated in month L — the policy borrows nothing more" (tone `quiet`) — never
      "Buy with the line". Every other zone keeps its line. No grid reaches this case (a break or an over line always
      outranks it); a constructed reading pins it.
  - The breaker sentence states the re-arm rule ("It re-arms after 6 months back on the line…"), including when the
    re-arm doesn't happen before the run ends; only a true latch says "stays that way".
  - **`neverDraws` is TOTAL and TRUE** for every applied run that never draws, read only from result fields:
    `'liquidated'` first (month 0 → "Coinbase starts this scenario past its liquidation line…", never "in month 0"),
    then `'ceiling'` (a limit blocked a buy-zone month that had line room) or `'line'` (Strike's own capacity was 0 in
    every buy-zone month), then `'zone'` (never in the buy zone, some month above it), else `'belowSupport'` (paused or
    broken all run). An exhaustive test checks each kind's defining property on every A5 path and grid cell. BL14 adds
    `'goal'` (at the goal in every buy-zone month) and `'goalMixed'`, checked before `'ceiling'` / `'line'` — § BL14.
  - `policyPauseReason` names what spare income repaid, in the post-liquidation, `broken` and (BL14) goal branches,
    through `repaidTail(row)` (from the engine's `strikeRepaidUsd` / `cbRepaidUsd`): " Spare income repaid $A of Strike
    debt and $B of Coinbase debt." / Strike only / Coinbase only / '' (both under the dust floor) — no order word. Every
    other branch keeps the restore tail.
  - Also: `policyPauseReason(row, s, expenses)` (the real reason a month did not borrow; null at bills ≤ 0),
    `policyUnpaidNote` (the card's unpaid line, exported), `policyAlert`, `policyStopSentence`, `billsRemainderTail`,
    `drawPauseClause` (policy off → today's words verbatim), `zoneStrip` (its counts ARE the engine's
    `monthsInZone`), `policyLimitPct` (the dashed limit: stop ÷ multiple), `coldShown`, and `strikeCallSummary` /
    `strikeCallSentence` (shared with `strikeCapNote`).
- **Every sentence is TRUE of its run.** Where the spec's wording would be false for a case it did not cover, the
  case gets its own pinned variant: the zone sentence on a path that also went under support, "below support" as the
  cause of a hold month's unpaid bill, "the limits are full" when Strike's own line bound. **The $0.50 dust floor is
  ONE exported constant** (`DUST_USD` / `shownUsd` — defined in `utils/format.ts` since W1, because Coinbase's
  seizure price in `src/simulation` reads it too, and re-exported by `supportPolicyView`; a source guard pins one
  definition): it stops a ceiling-capped refinance's ~1e-10 overage printing
  "$0 over", and the verdict's `allIn`, `noBillsNote`, the remainder tails and `unfundedNote` all read it.
  `roomMonths` is null when bills are ≤ 0.
- **The verdict is ALL-IN** (v1.4 #21): `verdictVsNeverDraw` compares `allInEquity` with `baselineAllInEquity`, so
  unpaid bills and reserve cash count on BOTH sides; `equityDelta` is all-in and `allIn` flags any adjustment. The
  head gains `verdictBasisClause` (", after unpaid bills" / ", after reserve cash" / both — the same predicate as
  `allIn`). The Net-equity tile keeps RAW equity as its value, and when `allIn` its end sub-line reads `all-in vs
  never-draw: ±$X` (Cycling, Strategy), so the tile's colour and its words agree. Both apply with the policy off too.
  BL14: with a goal, all-in equity also counts the spare income kept at the goal on both sides (the head then adds
  ", counting the spare income kept at your goal"), and a gap under the dust floor is a tie (`kind: 'even'`) — § BL14.
- **Per-face copy** (gated on `sim.policyApplied` unless marked "off too"):
  - `policyAlert` (the headline with `call: null`, shown on warn/bad) — Strategy's state line, Ownership's verdict
    list, first in Cycling's constraints. A Strike call reads only through `strikeCapNote`, never twice.
  - Call tones: `capWarn` / `capTone` / Ownership's cap note map `sold` → red, `cured` → amber. ⚠ **Ownership's verdict
    ENTERS its call branch on the reading** — `strikeCallVerdict(capReading)` for called / sold / cured — never on
    `strikeMarginMonth` alone (v1.3 #16): under the policy a cure or a clean sale leaves that flag null, and the
    verdict fell through to the stop sentence. Its `stopMonth` verdict reads `policyStopSentence`. A liquidation
    outranks all of them through `liquidationVerdict(sim)` (Policy v2, F5c — on the way down it names the price, never
    the survivor row's 0.0%).
  - **Cash flow, in order (off too):** month 0 → `OPENING_CASH_FLOW_NOTE`; cycle mode with bills ≤ $0 → `noBillsNote`
    (checked FIRST — never a fourth `cashFlowAtMonth` mode); a drawing month → `drawingCashFlowNote`; a non-drawing
    month under the policy → `policyPauseReason` + what bought bitcoin; post-liquidation → `liquidatedCashFlowNote`;
    otherwise (a stopped month, policy off) → `stoppedCashFlowNote(row, capPct)`; Strategy's non-cycle modes (`hold`,
    `clearStrike`, `clearBoth`) → `noDrawCashFlowNote(row)`. Every branch is a tested helper (2b.2 moved the last two
    inline sentences). In a stopped month and every non-cycle mode the engine funds only the surplus —
    `btcBoughtUsd` = max(0, income − bills), `unfundedUsd` = max(0, bills − income) — so each helper has three shapes:
    - `stoppedCashFlowNote`: bills unpaid → "Borrowing paused — the loan hit your N% stop. Your paycheck pays what it
      can — $U of bills went unpaid this month. No bitcoin bought this month."; paid in full, nothing bought → "…Your
      paycheck pays the bills again, so no bitcoin is bought until the price recovers."; otherwise the old sentence
      ("…so only $B/mo buys bitcoin until the price recovers."). It says "stop" — "ceiling" means the policy's limit.
      ⚠ Strategy said "the loan is at your N% stop"; it now takes the helper's "hit" (a policy-off change).
    - `noDrawCashFlowNote`: bills unpaid → "No draw in this strategy: your paycheck pays what it can — $U of bills went
      unpaid this month. No bitcoin bought this month."; nothing left → "No draw in this strategy: after the bills and
      any repayments, nothing is left to buy bitcoin this month." (e.g. `clearBoth` while the debt is repaid);
      otherwise the old sentence ("No draw in this strategy: $B/mo buys bitcoin — whatever the surplus leaves after
      its repayments."). The constraints box's deficit notice is unchanged.
    - `liquidatedCashFlowNote` (post-liquidation, policy off — with it on, `policyPauseReason` says the loop has
      ended): bills unpaid → "Coinbase has been liquidated — borrowing has ended. Your paycheck pays what it can — $U
      of bills went unpaid this month."; paid in full, nothing bought (the paycheck exactly equals the bills) → "…Your
      paycheck pays the bills. No bitcoin bought this month." (2b.3); otherwise "…Your paycheck pays the bills, so
      $B/mo buys bitcoin."
    - `noBillsNote` (checked first; policy on and off) has three shapes too, for a different reason: with no bills the
      whole paycheck is spare, and under the policy a pay-down month retires debt before it buys. Something bought →
      "No bills to fund, so $B/mo buys bitcoin." (+ " $R of spare income paid debt down first." when some went to
      debt); nothing bought, debt repaid → "No bills to fund. $R of spare income paid debt down, so no bitcoin bought
      this month."; nothing bought, nothing repaid (a $0 paycheck) → "No bills to fund. No bitcoin bought this
      month." (both 2b.3). ⚠ The debt-repaid shape is reached with the policy ON, the default: on P2 at $0 of bills,
      the first pay-down months send all the spare income to debt. BL14 adds a fourth shape, at the goal — § BL14.
  - ⚠ **`cashFlowAtMonth.incomeCoveredUsd` is what the paycheck actually PAID** — `min(max(0, income),
    strikeShortfall)`, ≤ income — so `buys + incomeCovered === income` in every drawing month (v1.3 #15) — less
    Strike's minimum when income pays it (the plan of record's Run 2, D-R2-7: `buys + incomeCovered + strikeMinPaidUsd
    === income`). Then the sentence drops "all" (the paycheck less the minimum buys, not all of it), the "left over" it
    compares with is net of the minimum, and `minimumPaidNote(row)` — "Your paycheck paid Strike's $M minimum first." —
    ends every month's sentence on Cycling, Ownership and Strategy (null under 50¢, or when the minimum rolls in; with
    it rolled in, the default, every shape is byte-identical). `drawingCashFlowNote` names the cause and the remainder:
    - full draw → today's sentence; with nothing bought → "The line pays your $D of bills. No bitcoin bought this
      month." + the debt sentence (the strong span empty), never "all $0/mo buys bitcoin — not just the $0 left over";
    - ⚠ the closing "— not just the $S left over" clause (BOTH bought arms) is DROPPED when the surplus is under the
      dust floor, so on a deficit budget the sentence ends at "buys bitcoin." — the clause carries the full stop, so
      the else is "."; `shownUsd` is the exact gate, since fmtUSD rounds and the smallest surplus that passes (50¢)
      renders as $1;
    - partial → "The line pays $D of your bills, so all $B/mo buys bitcoin — not just the $S left over." + the cause
      (off: "Your paycheck covers $X the line couldn't reach."; on: "The limits at support (or Strike's own line)
      capped the draw, so your paycheck covers the other $X.") + the remainder tail + the debt sentence. When the
      paycheck paid nothing (`!shownUsd(incomeCoveredUsd)`), the cause drops the figure — off "Your paycheck covers
      none of the rest.", on "…capped the draw, and your paycheck covers none of the rest." — never "covers $0";
    - zero draw → "Strike's line has no room left, so your paycheck pays the bills: $B/mo buys bitcoin." — never
      "the line pays your $0". Under the policy a drawing month always draws something, so a zero draw there is only
      a sub-dollar room left by the limits, and it reads "The limits at support (or Strike's own line) leave no room
      to borrow this month…".

    ⚠ **No cash-flow sentence on any face prints a figure under $0.50 for what bought bitcoin** (policy on and off) —
    it says "No bitcoin bought this month." or the shape's own words ("nothing is left to buy bitcoin", "no bitcoin is
    bought until the price recovers", "paid debt down, so no bitcoin bought"). The floor is the ONE `shownUsd`. The
    rule grew out of "a $0 paycheck is never named as a figure" (the income slider reaches $0), which still holds —
    "covers none of the rest", never "covers $0". The full-draw and partial branches above named a $0 paycheck before
    2b.1 — on P1, in every drawing month of both arms — and the stopped and no-draw sentences before 2b.2 (P2 and P4 at
    a $0 paycheck; `hold` at $4k / $6k in every month). 2b.3 closed the last three: `noBillsNote` with the policy ON
    (P2 at $0 of bills), `liquidatedCashFlowNote` when the paycheck exactly equals the bills, and Ownership's leveraged
    branch, which printed a sub-50¢ buy unguarded (reachable only when income ≤ bills and the line's room lands within
    50¢ of the gap). A face-level pin counts the dust switches (§ Structural guards). ⚠ The rule covers the $0 SURPLUS
    too: `drawingCashFlowNote`'s left-over clause named "the $0 left over" on any deficit budget until the Decision
    face's Appendix A — 2b.1 had closed the $0 PAYCHECK by guarding on `bought`, which a deficit budget passes (at
    $4k / $6k the line pays the bills, so the whole $4,000 buys). It fired on a real A5 path.
    ⚠ **"Pays the bills again" is said only when nothing went unpaid** — the old stopped sentence said it with bills
    above the paycheck (P9 $4k / $6k, policy off).

    `billsRemainderTail` is the ONE remainder tail, shared with `policyPauseReason`. Ownership's paycheck clause reads
    the same fields ("— the line pays $D of the bills." when income covered part), and its last branch takes the
    pause branch's `shownUsd(cf.buysUsd)` switch — "No bitcoin bought this month." instead of "$0/mo is buying
    bitcoin this month." (policy off too). Its leveraged branch fires only above that floor (`cf.leveraged &&
    shownUsd(cf.buysUsd)`, 2b.3), so a sub-50¢ leveraged month falls through to the last branch.
  - Constraints: `policyUnpaidNote` under the policy, else `unfundedNote(…, sim.baselineUnfundedUsd)`. Cycling adds
    `creditExhaustedNote(sim)` (the month only, off too) and the throttle line ("From month N the policy limited
    borrowing…"). The degenerate-cap notice (Ownership, Strategy) → `neverDrawsNote`.
  - **Rates card** (Cycling, Ownership): `rateStopNote(applied)` (cyclingFaceView), one definition. Off → the card's
    two draw-stop sentences verbatim; both figures in them (peak CB LTV moving under a point across 3–16%; an 85%
    stop pulled in 7 months) were measured with the policy off. On → "With the support policy on, the limits at
    support cap the draw, so a higher rate leaves less room to borrow." — raising the defense line past the policy's
    own limit at support never releases the draw. The face supplies the spacing on either side (`{' '}`).
  - **The crash playbook on the faces (Run 1)** — four tested helpers in `cyclingFaceView`, each byte-identical to
    today's rule with the policy off:
    - `playbookNote(sim, capPct)` (Cycling, Ownership; policy on): "Crash playbook: X ₿ of collateral moved into
      Coinbase (a ₿ from cold storage, b ₿ released from Strike); $Y of Coinbase debt shifted to Strike across N months,
      starting month M." + the outcome — a liquidation first (Policy v2, F5d): "Coinbase was still seized on the way down
      in month L." / "…liquidated in month L."; else "From month U the playbook could not hold the C% defense line — the
      residual is unhedged."; else "The C% defense line held; the refinance shifts the debt back to Coinbase as the price
      recovers." — or, BL14, with a goal month after the first shift, "…as the price recovers, except at your goal, where
      spare income repays it instead." (`GOAL_REFINANCE_CLAUSE`, § BL14). Each part only past its dust floor; null when
      nothing moved. The old "LTV stop defense" note renders
      only with the policy off (`{!applied && defenseActive && (`), its ternaries collapsed to the policy-off words.
    - `defendedFromSub(row, applied)` — the CB LTV tile's sub reads "defended from X%" in a month the playbook moved
      collateral too (policy on), not only in a shift month; otherwise each face's fallback.
    - `collateralMovedFlag(row, applied)` — a ` ⇡` on the Milestones row (`title="collateral moved into Coinbase"`,
      all three faces), policy on.
    - `unheldMonth(sim, applied)` — the unhedged month: `firstUnheldMonth` under the policy, else today's
      `topUpExhaustedMonth` / `defenseExhaustedMonth` rule.
  - Relabels: "Coinbase defense line" / "Strike defense line" + `defenseLineNote` (the notes, the sliders, the Strike
    buttons); the chart's STOP → DEFENSE and Strategy's "Strike defense" line; the CB LTV tile sub → `policyTileSub`
    (Cycling, Strategy — Ownership's tile keeps its liquidation price, which never named the stop; "defended from X%"
    outranks either in a defended month); the Strategy
    disclaimer's modelled-call sentence; the Strike range's accessible name follows its visible label
    (`aria-label={applied ? 'Strike defense line' : 'Strike LTV cap'}`, all three faces).
  - **Cold card:** the buffer slider, its fair-value text, Cycling's InfoTip and the sweep toggle hide; the policy's
    rules and the first-coins month show — since BL33 (§ BL33) ONE card on the four engine faces, its rules folded, one
    a line: `policyColdNote` (the rule), `policyColdGoalNote` (the stand-down, with the run's goal), `policyReserveNote`.
    The Cold column and the cold chart series gate on `coldShown`.
  - **Cold card with the owner's reserve (real-cold spec v1)** — every rule a tested helper, every sentence true of its run:
    - `coldShown` also opens for a reserve (`shownBtc(openingColdBtc)`), policy and sweep off included.
    - `shownBtc` / **`DISPLAY_DUST_BTC` (0.0005)** is THE display floor for a BTC figure the cold card prints (3 dp): a
      residue that rounds to 0.000 reads as none. ⚠ Not `DUST_BTC` — supportPolicy.ts has a private `DUST_BTC = 1e-12`.
    - Headline "… ₿ **in** your own custody by {end}" (was "into" — false once cold is there at month 0) — since BL33 the
      four faces' one card's: Strategy's old "… ₿ in custody" value went with its in-card block, and the Decision card
      leaves the total to its outcome strip.
    - The split line is `coldOriginsParts(sim)`: `C ₿ you hold today` (reserve, iff `shownBtc`) · `X ₿ from Coinbase` ·
      `Y ₿ from Strike` · `− R ₿ used to defend the loans` (iff `shownBtc(R)`; every retrieval — CB top-up, Strike
      top-up, Strike cure — so never "retrieved for the top-up"). The signed parts foot with the cold ledger.
    - `coldMovesSentence(label, reserve, noneWithoutReserve)`: with a reserve " New coins first move {label}." / " No new
      coins move to cold on this path."; without one " First coins move {label}." or the caller's sentence — since BL33
      one for the four faces, `NOTHING_MOVES_TO_COLD` (" Nothing moves to cold on this path.", Strategy's; Cycling's
      "… the honest answer for a while" is retired). Its one caller is `coldCardView`.
    - `policyReserveNote(sim)` (policy on — since BL33 its own line in the card's rules, after the rule and the goal's):
      " Your reserve is spent only in a break below support,
      and never on a loan that can't be saved." — the second clause is DROPPED when cold went into Coinbase in ANY
      month up to and including the one it was liquidated in
      (`rows.slice(0, liqMonth + 1).some((r) => r.topUpFromColdBtc > 0)`), and the whole sentence is omitted when
      `coldRetrievedAboveSupportBtc > 0` (the policy card's `coldAlarm` says it). The seizure on the way down keeps the
      reserve out of the month Coinbase dies (the doom gate did, before Policy v2), but only that month: cold topped in
      while Coinbase was still savable can be lost to a later drop (F4's fixture at k2 0.5 — cold in at month 1, seized
      on the way down at month 2 — shows it). It errs one way only: the pool is fungible, so cold swept back out before
      the liquidation still drops the clause.
    - Cycling, policy off: the "Keep me safe down to" slider + its sentence sit behind `coldBufferPct > 0`; with the sweep
      off and a reserve, `sweepOffReserveNote(strikeCapEff > 0)` — "With the sweep off, a defense can still draw on your
      reserve if the Coinbase stop[ or the Strike cap] is hit." (the Strike cap's top-up draws it too). BL33: it no longer
      says "nothing new moves to cold" — the card's moves line right above it ("No new coins move to cold on this path.")
      says that (ONCE). Since BL33 the slider, its sentence, this note and the sweep toggle (now last) are the face's own
      children of the shared card. Strategy is a summary face: no sweep-off line (its slider was already gated).
  - **Charts:** a dashed "Policy limit" series (`policyLimitPct` / `cbLimit`) as a DIRECT recharts child, in the colour
    of the Coinbase line it bounds ON THAT CHART — `--btc` on Cycling (not a venue colour: the Cycling face's lone CB
    line keeps its own), `--venue-coinbase` on Strategy and Ownership (`--coinbase` until BL15) (a comment at each site;
    don't "unify" them). Policy v2 Run B (B2): the red dotted "Coinbase seizes" series on all three
    price charts — `chartCliffUsd`, one formula; Cycling's behind `hasCliff`, with a Legend (§ Policy v2 → Run B).
  - **Milestones:** a Zone column (`ZONE_LETTER`, `ZONE_COLOR`, `title` / `aria-label` = `ZONE_LABEL`), and the ⇡ flag.
    The switch table's LTV view under 768 px carries the same letter, colour and name (§ Milestones on a phone).
- **Helper extensions:** `strikeCapReading` gains `sold` / `cured`; `creditExhaustedNote({ creditExhaustedMonth })`
  (2b.1 narrowed it — no rows, no figure); `rateStopNote(policyApplied)` (2b.1);
  `chartOwnershipRows(rows, cbStopEffPct?)` → `cbLimit` (Policy v2 Run B dropped its `cbLiqLtv`: `liq` is `chartCliffUsd`);
  `unfundedNote`'s third argument is REQUIRED. Run B adds `chartCliffUsd(row)` (`cbSeizurePrice`, rounded) and
  `openPastLltvNote(sim)` (B5's policy-off note) to cyclingFaceView.
- 🔴 **No test-only engine input appears anywhere under `src/components/`, tests and comments included** — `incomePath`,
  `modelStrikeLiquidation`, the doom gate, the repayment order, the crash playbook's three switches and Policy v2's
  `seizeOnTheWayDown` (the forbidden-input grep matches text; the views read the RESULT field `seizedOnTheWayDown`,
  which the grep doesn't match). A component test reaches P7 only through `a5Cases()`.
- **Structural guards:** `resetMirror.test.ts` (`supportPolicy` in the `engineInputs` body and both dep arrays, on
  all three faces) and `supportPolicyWiring.test.ts` (the four memos; `buildSupportPath(startDate, months)`; never
  stressed or phase-shifted; every engine run spreads `engineInputs`; no `plBandAt('floor'`; the card rendered;
  Cycling's literal `'cycle'`; the card imports no belief or store; the disclosure collapsed; the 2b fixes at the
  face — Cycling and Strategy call `drawingCashFlowNote(` while "the line couldn't reach" appears in no face, and
  Ownership calls `strikeCallVerdict(capReading)` with no `if (sim.strikeMarginMonth !== null)`; and 2b.2's — Cycling
  and Strategy call `stoppedCashFlowNote(`, Strategy calls `noDrawCashFlowNote(`, and "pays the bills again" and "No
  draw in this strategy" appear in no face, whitespace-tolerant; and 2b.3's — in every face `shownUsd(cf.buysUsd)`
  appears at least as often as `fmtUSD(cf.buysUsd)`, so each printed buy figure has its dust switch, also
  whitespace-tolerant; and the crash playbook's — every face calls `defendedFromSub(`, Cycling and Ownership call
  `playbookNote(`, no `'Coinbase defense line' : 'LTV stop defense'` or `applied ? 'defense line' : 'stop'` ternary
  survives, and the old note is gated `{!applied && defenseActive && (`). Each proven red by a temporary edit.

#### The plan of record (Run 1 — the support policy's saved settings; store unchanged, NO bump)

Spec: `pbloc-spec-plan-of-record-v1.md` (v1.1 — §4.1, §4.2, §12; the owner's calls are BL9: P1 — Runs 1–4 on one
branch, merged once — and D0–D9 all A). Run 1 makes the support policy's six settings the owner's SAVED plan; Runs 2–4
move the main screens (THIS MONTH, the Playbook, Daily, the Advisor, Safety) onto it. ⚠ Run 2 is built — THIS MONTH and
Daily run the plan (§ The plan of record (Run 2), below).
- **Six synced plan fields** (D1): `policyCbStopAtSupportPct`, `policyStrikeStopAtSupportPct`, `policyAccumulateBelow`,
  `policyPayDownAbove`, `policyBearBufferMonths`, `policyCashReserveMonths` — the C1 defaults (BL6: 45 · 50 · 2.0 / 3.0 ·
  12 · 0), plan events on `plan-events:v1`, in `SETTINGS_FIELDS` (39 → 45), the plan backup and the trusted viewer
  snapshot (D9 — a conscious EXPOSE; `VIEWER_SETTINGS_FIELDS` 34 → 40; a safe snapshot carries none). **No off switch**
  (policy-off stays a face what-if — there is no seventh field) and **no store version bump** (the persist merge keeps
  a new key's default; a bump would make every plan backup unrestorable). Absent from the log = C1.
- **One source — `lib/planPolicy.ts`** (zero imports, PLAN FIELDS pins it): the defaults, the ranges, the field map,
  the seed, `clampPlanPolicy` and `planPolicyOf`. `supportPolicyView` re-exports the defaults (adding `enabled: true`)
  and the ranges (the same object).
- **One editor — Settings' "Your plan"** (D2; `YourPlanSection.tsx`, owner-only, the 🧭 row between Strike Strategy and
  Coinbase Loan). `setPlanPolicy(patch)` clamps each value, drops the unchanged ones and `enabled`, and emits the rest
  in ONE `emitPlanSets` (one ts). `resetPlanPolicy()` — "Back to the defaults (C1)" — emits all six, one ts: an explicit
  default is an event, so a reset beats an older edit from another device, where "only the changed fields" would let
  it survive. No other file outside the store names the setters, and none names `emitPlanSets` (SETTINGS — the only
  editor). The other writers only replay or reset: the fold, the backup restore, the viewer's apply, the two seed
  resets and the persist merge.
- **The faces' what-ifs:** every face builds `policyRaw = { ...DEFAULT_SUPPORT_POLICY_SETTINGS, ...plan,
  ...overlay.supportPolicy }` from `usePlanPolicy()` (read-only; `useShallow`); "Back to your plan" drops the face's
  what-if, and no face writes the plan (FACES, I20).
- **One clamp — `planClamp.ts`** (70 and the Strike cap's defaults): planRun's `PLAN_ENGINE_CONTEXT` and builders (the
  Decision face, and since Run 2 THIS MONTH and Daily) and Settings' "Your plan" read it. A parent face's own cap
  slider stays a what-if on that face.
- **The Coinbase limit on the crash day:** the Emergency Console, THIS MONTH's crash line and the Outlook's legend read
  `policyCbStopAtSupportPct` (`LivePlaybookFigures.planCbStopAtSupportPct`, required; the Outlook's prop from both its
  parents). (Run 3: the console and the plan card's crash line, built in `usePlanCardInputs`; the Outlook is gone.)
  At C1 nothing moves — measured: 17 of 18 main screens and faces byte-identical; Settings gains its row,
  and an open policy card's reset reads "Back to your plan".
- **Read through the clamp** (invariant 11): `planPolicyOf` and the console clamp the saved values, so a junk value
  reads C1 and an out-of-range one its edge, everywhere at once — a restored backup is checked for its keys, never its
  values (`validatePlanBackup.ts`).
- **Mixed versions are safe:** compaction and the fold are field-agnostic (`compact.ts`, `fold.ts`), so an older build
  on another device keeps and republishes the six's events; its `set(folded)` writes the unknown keys harmlessly.
- ⚠ **Per-notch plan events:** each notch a "Your plan" slider crosses is one plan event — like Living's income and
  expense sliders, which have 1,000 notches — and compaction keeps superseded events for 90 days inside the ONE plan
  payload. The plan log's size limit (past 40,960 B of plain JSON, NIP-44 padding sends the event at about 66 KB, over a
  64 KiB relay limit) was queue item 5a — shipped on `main` and taken in (§ Phase 4 → 5a): a drag is one event, and the
  history is trimmed to 32 KiB.
- Tests: § Test Suite → "The plan of record (Run 1)".

#### The plan of record (Run 2 — THIS MONTH and Daily run the plan; store unchanged, NO bump)

Spec: `pbloc-spec-plan-of-record-v1.md` (v1.7.2 — §4.3, §4.5, §4.7, §13; the owner's calls are BL16 — D-R2-1…8 and the
venue colours — and BL17, Δ9–Δ12). THIS MONTH's Monthly Playbook card and Daily's plan card run the plan of record: THE
MOVE plus a flat run at today's price, built through the Decision card's own builders. `runAdvisor` leaves both screens;
THIS MONTH's log overlay kept it until Run 3 (gone since — § The plan of record (Run 3)).
- **ONE builder — `planRun.ts`** (invariant 2). `placementInputOf` / `engineInputsOf` build THE MOVE's input and the
  engine's inputs for the Decision face AND `planMonthRun`, so the face and the card can't disagree: one copy, not two
  compared. THIS MONTH = THE MOVE at today's price and S₀, then months 0..12 on a FLAT path at today's price (D4), from
  the saved plan with no what-if, seeded as the face seeds (from the move only when it is made — D10). The card's month k
  (this month or later) is the run's month k − currentMonth + 1; a past month reads the Ledger (D-R2-3 — the plan keeps no
  history, D14).
  - **What MOVE proves, and what kill criterion 2 rests on.** MOVE's 96 engine cells price S₀ on a 12- and a 60-month
    support path and find it the same, so they prove only that the horizon can't change the move. That the face and the
    hook gather the same facts rests on ONE (one builder) and the wiring's ONE (Δ7: each of THE MOVE's 15 facts —
    `strikeDepositOf(st)` and the minimum's source among them — is read by the same expression in the Decision face's
    selector and the hook's; since BL32 the goal is one of THE MOVE's facts too — both selectors read
    `planGoalOf(st.planGoalNetBtc)`, pinned by the wiring's GOAL rather than ONE's list). Kill criterion 2 itself was
    measured on screen (spec §13.6, four households).
- **The hook — `usePlanMonth`.** The store's live position, the saved plan, today's price and the policy's memory, run
  through `planMonthRun`. Today per render (Δ3): an installed PWA resumes without remounting, and the start date, S₀, the
  hold, the breaker fold and the Coinbase accrual all key on it, so a screen left open re-plans once a day. (The
  Decision face freezes its own today, for the stress lens.)
  - **The breaker, offline (§4.3, invariant 10, D-R2-6).** Today's fold when the price history arrived; else THIS
    device's cache of the last fold (`planBreakerCache` — written only from a fresh fold, in an effect: the hook's one
    write); else loading or none. The cache is read through the engine's own rule (`planBreakerCacheOf` →
    `validOpeningBreaker`, dated `yyyy-mm-dd` — Δ6), so a cache the run would discard can never steer THE MOVE. The cached
    line — "Price history hasn't loaded — the breaker as of …, this device's last reading." — shows only once the fetch
    has FAILED (Δ12: `'cached'` carries `settled`; while the history is still loading the cache runs the month with no
    line, so the card doesn't jump on every open; since the plan of record's Run 4, BL23, a fetch that never answers
    fails at the 15 s limit instead of loading for good). With neither, the card says the month assumes the model isn't
    treated as broken — never silent. Daily's plan card runs the same fold, cache or assumption with no breaker line, by
    design (spec Appendix W §0 item 12).
  - **The offline split (invariant 2's exception).** With no fresh history THIS MONTH runs on the cached breaker, while
    the Decision face assumes "not broken" (it never reads the cache). So a cached BROKEN breaker makes THIS MONTH's move
    inert while the face names one. Recorded, not fixed: the face reading the cache is a Run 4 option (Run 3 left it,
    and so did Run 4).
- **D-R2-4 — the Coinbase switch.** Every plan reader (the four faces, THIS MONTH, Daily) reads Coinbase's collateral
  and balance only through `planCbCollateralOf` / `planCbLoanBalanceOf`. With the loan switched off the plan starts with
  no Coinbase loan — never the fresh install's seed $60,000 on 1.48 ₿. The crash gate (`isCrashDay`, the Emergency
  Console) keeps the store's figures, behind the loan switch (so did Simple Mode's Outlook and THIS MONTH's log
  overlay, `runAdvisor`, until Run 3 removed both). ⚠ The support policy is the cycle by construction: with the
  loan off the plan still pledges its buys to Coinbase, and the after box shows a Coinbase leg the owner doesn't have
  (plans without Coinbase are the deferred "non-cycle modes under the policy").
- **D-R2-7 — Strike's minimum, as the owner pays it** (`blocMinPaymentSource`): `strikeMinFromIncome` on every run, the
  faces' and the main screens'. Income pays the minimum after the bills and before the buy, the restore or the pay-down;
  only an unpaid part capitalises. **The baseline (Δ11):** the never-draw comparison pays its own Strike interest by the
  same rule, so the verdict compares like with like. Measured before the fix, over 900 income-mode face runs it
  understated the plan in every run where income paid a minimum (300) and flipped 45 verdicts; after it, a "hold" run
  equals never-draw in all 27 cells, in both modes. Roll mode (the default) is byte-identical.
- **The cards (D-R2-2, D-R2-8).** `PlanMonthCard` is one card, one month, each fact once: the status, "To do this month"
  and "After this month" (both loans, Coinbase at the month's own support on a meter). Behind a tap sit "To be within it
  today" (the catch-up) and "Why this plan?". The scrubber's track is the year. One status colour per card — no Advisor
  tier border (Δ10; the Advisor tab keeps its tiers — until Run 4: Safety's colour on its Coinbase LTV, the plan's rules
  in its sidebar). **Daily's plan card** reads the same month 1: the status (or the
  crash title), the rows, the minimum and "Why this plan?". Its bars compare the Ledger with the plan in the Ledger's own
  streams (`planLedgerTargets`, Δ4) — since Run 2.1 the month so far in Week and in Month, with no target for a past
  month (F13, below) — and "Interest capitalized" is the interest less the minimum paid, for the current month only
  (Δ5). On a crash day (D13 — `isCrashDay`, still `ltvTriggered` until Run 4, D3 — done in Run 4: the Coinbase loan
  alone) THIS MONTH's status is the Emergency Console's line — `PLAN_CRASH_TITLE` over `monthPlaybookLine`'s items —
  with `crashNote(true)` as a foot under the rows; Daily's status is the title alone. **BL14:** with a goal set, both
  cards print one goal line under the status (THIS MONTH under the breaker line): `planGoalLine` on the run's own month
  and goal — "this month", at today's price once the month's Coinbase interest is added — and "Why this plan?" says how
  the figure is read (`planMonthSummary`'s goal words). With no goal, no line and the summary byte-identical — § BL14.
- **The status (§4.5).** Month 1 reads TODAY's fact — THE MOVE's `cbOverCeilingUsd` at S₀ — with the time back
  (`firstMonthUnderLimit`) and the catch-up as arithmetic on the run's numbers ("Your limit: 45% of what Coinbase's
  collateral is worth at support ($X per ₿ today)."). Later months read their own month-end through ONE rule,
  `cbOverLimitAtMonthEnd` (the engine's headroom at that month's support, past the dust floor); the switch month, the
  track and the after box read it too, so month 1's status and its band can differ.
  - **The three over-limit bodies (Δ9)**, by the run's own figures: Coinbase repaid → "Spare income repays it before the
    plan borrows again"; still over at month-end with nothing repaid → "No spare income repays it this month"; back
    within at month-end → "Back within your plan's limit this month."
  - **The refused policy (Δ8)** — the engine ignores the policy (`policyIgnoredReason`; e.g. a Strike liquidation LTV at
    or under its 70% call). Short of a liquidation, every month's status is the Decision card's own `policyIgnoredNote`,
    the track is never green, the after box has no meter and no over-the-limit tone (`planAfter` takes
    `policyApplied`), and the Why drops its limit sentence.
  - After a liquidation every later month reads "Coinbase has been liquidated — borrowing has ended", in red (N8), and
    never promises a recovery.
- **The words (§4.7, I31).** Every sentence either card shows comes from `planMonthView` (or decisionView,
  crashPlaybookView, supportPolicyView); the cards compose none. planRunWiring's I31 reads both cards' syntax trees: every
  text of three or more words is one of eleven listed labels. Facts, never "should", "need to" or "safe"; never "$0",
  "₿0.000" or "0.000 ₿" (WORDS). The Decision card's first line reads "This is your plan of record's move this month —
  the support policy, with your settings.", and with a what-if on the move (the policy or the line), "A what-if — your
  plan is unchanged." **The one-time note** (D8, `planSwitchNote`) is dismissed once per device (`planNoteDismissed`) and
  never shown to a viewer. **The venue colours** (the owner's add-on): Strike white, Coinbase blue, cold storage orange by
  default — the venue tokens (`--venue-strike`, `--venue-coinbase`, `--venue-cold`; Settings → Customization changes them,
  BL15) — on each row's dot and its venue words; two venues split the dot (to its border's edge —
  `border-box`, Run 2.1, F8); a warning shows in the note and the amount, so a dot never hides it.
- **The hold's one date (D9, invariant 8).** Strike's 60-day hold reads ONE fact — the latest logged Strike deposit's
  date (`latestStrikeDepositISO`) — through ONE rule (`strikeHoldAt`). `strikeDepositOf` picks the fact on this device:
  the owner's journal, or a trusted viewer's `viewerStrikeDepositISO` (the trusted snapshot's `strikeLastDepositISO`,
  raw-set by viewerSync; the safe snapshot never carries it). Every hold reader — the Decision face and
  the Emergency Console (a viewer reaches both), `usePlanMonth` and THIS MONTH's crash line — reads it this way (HOLD: over 4,000 journals × 9 days
  the split rule equals the rule as it stood at `3580f92`). A viewer never sees THIS MONTH or Daily — it has its own
  home — so the Almanac's face and console are where D9's date matters.
- **Not in Run 2** (spec §13.11):
  - The crash gate stays `ltvTriggered` until Run 4 (D3). Done — § The plan of record (Run 4).
  - Run 3: THIS MONTH's log overlay keeps `runAdvisor`, as do the Advisor tab's plan rows and the Outlook's link; the
    `simpleModePlan` helpers Run 2 left with no screen go with them (`deriveForMonth`, `composeMonthSummary`,
    `isOperatingMonth`, `displaySettledLtv`, `isLtvFigureStressed`). Done — § The plan of record (Run 3).
  - Run 4: Safety's at-support line and the safe snapshot's two ratios. Done — § The plan of record (Run 4).
  - The statement minimum's inline editor left THIS MONTH; the figure is entered in Settings → Strike Strategy.
  - The engine's month-0 seizure leaves an unsecured Coinbase balance (the engine's model, unchanged — Policy v2's
    seizure on the way down repays the loan in full): the after box says "no collateral", and the status names what
    survives.
  - The monthly release: the run releases Strike's surplus collateral at each month-end ("Strike → Coinbase ·
    month-end", or "small, can wait" under `MOVE_THRESHOLD_BTC`, 0.01 ₿). In life a release is a request Strike
    honours after its 60-day hold, and the run models the hold only from logged deposits (D14).
  - A finished strategy year: the card stays on month 12 with today's run, with no sign-off pointer and no
    next-month line.
  - Logged (v1.7): the Decision face reading the breaker cache (the offline split); a trusted→safe downgrade keeps the
    trusted figures on the viewer's device (from before Run 2 — `viewerSync`'s safe branch clears nothing, and
    `viewerStrikeDepositISO` joins them); the price history is fetched on every visit to THIS MONTH or Daily (a Run 3
    option: one fetch per session — 5e's F12 since); ~60 unused SimpleModeView CSS rules (swept in Run 3); Daily's month rollup lists
    Strike's paydowns but not Coinbase's, though the bars count both.
  - Queued: the faces' empty state's other zero figures.
- Tests: § Test Suite → "The plan of record (Run 2)".

#### The plan of record (Run 2.1 — the device check's fixes; store unchanged, NO bump)

Spec: `pbloc-spec-plan-of-record-v1.md` (v1.12 — §14; the owner's calls are BL18 — F8, F13, R2-a, R3-B — and BL19, with
"the 1th" folded in on 2026-10-14). Run 2.1 changes how figures print, which month Daily's bars read, and that new
sign-offs and logged minimums keep their cents — never a number the plan computes, and never a record already stored.
- **Every dollar figure THIS MONTH, Daily and Daily's sheets print shows its cents (BL19)**, through `fmtUSDCents` (one
  cached `Intl.NumberFormat`):
  - the Safety card and its price chart;
  - THIS MONTH's NDP card, plan card (planMonthView), crash line (`fmtStepUsdCents`, floored) and the month log it opens;
  - Daily's trio, "+$X stacked", bars, plan card, "Interest capitalized", month rollup and day log;
  - the Log sheet, the stale-balance note, the month review and the month's events list (MonthEventsModal, through
    `describeDayEvent`).
- **Whole dollars stay** on the Almanac faces (the Decision face among them) and in full mode (the Advisor, its month log
  and its NDP) — the owner's call — and, on Simple mode outside THIS MONTH and Daily, on the Dashboard (gauges and chart)
  and the Outlook segment's own content (its re-anchor banner, `OutlookProjection`). The Safety card sits above the This
  Month / Outlook switch, so it prints cents in both segments. (Run 3: the Outlook and its switch are gone, the re-anchor
  banner is on THIS MONTH to the cent, and the Advisor tab shows THIS MONTH's card — to the cent — above its whole-dollar
  month log.) So the Decision face says "Repay $500 of Coinbase…" and
  THIS MONTH's "Why this plan?" says "Repay $500.00 of Coinbase…" — the same words, through one builder (I31).
- **The shared builders take a formatter, whole by default:** decisionView's `UsdFmt` (`ACTION_FIELDS`' texts,
  `rowActions`, `planSchedule`), crashPlaybookView's `listSteps(result, stepUsd)`, and the `money` props of
  MonthlyLogOverlay and PriceChart. THIS MONTH and Daily pass cents; nothing else does.
- **Stored to the cent:** the month review's three sign-off seeds (`toCents`; the NDP's from `planNdpEstimateUsd` on
  `planNdpBalance` — the engine's `getNdpStatus` rounds its estimate to a whole dollar, for full mode) and the Log
  sheet's minimum estimate (`toCents`). A month signed off after Run 2.1 stores cents unless the owner edits the seed.
  Nothing already stored is rewritten — no migration, no re-roll.
  - ⚠ `toCents` (binary: (x + ε) × 100, `Math.round`) and the screen (`Intl.NumberFormat`) can round a half cent a cent
    apart — 2.135 is kept as 2.13 and shown "$2.14". The Log sheet's estimate and the NDP estimate are kept to the cent
    before they're shown, so their figure is what's stored; the review's minimum field (income mode) can start a cent off
    the to-do's "Pay Strike's minimum" in a rare month (C12, logged).
- **F13 — Daily's bars read the month so far** (planMonthView's `planBars`): Week reads the CURRENT month's rollup, under
  "Month N so far"; Month reads the viewed month's. A past month gets no target (D14 — the plan keeps none for a month
  gone) and no fill; a stream with no target shows what was logged, muted, or "—" — never "$0 / $0", and never a full
  bar against nothing.
- **R2-a — a later month's buy is at today's price:** after this month a buy's note reads "$X.XX · at today's price"
  (`PLAN_AT_TODAYS_PRICE` — the run is flat at today's price, D4); next month's line ends its buy with the same words:
  "buy ₿0.0050 at today's price".
- **F8 — the split dot** ends its gradient `border-box`, so it covers THIS MONTH's `.pmDot` 1px border (a class rule
  can't: the inline shorthand resets the origin). Daily's dot has no border.
- **"the 1th" (δ5, the owner's call):** the Log sheet's due day prints through `fmtDayOrdinal` — "due the 1st".
- **Not in Run 2.1** (spec §14.12):
  - The whole-dollar screens above stay whole; a later pass is the owner's call.
  - The month log's edit form shows a value as stored, unrounded (older than Run 2.1).
  - A buy under half a cent reads "+$0.00 stacked" — queued with the faces' zero-state pass (C11).
  - The half-cent rounding above (C12).
  - A buy's "~$X" became its dollars, "· $X.XX", when 5d merged in (BL13).
  - F14, the iPhone's offline white screen, stays parked (BL18).
  - `fmtUSD`'s slowness on Node 26 (`toLocaleString`, in the backlog) is unchanged; `fmtUSDCents` avoids it by
    construction.
  - 5e's counting price prints through the chart's `money` prop (A5): to the cent on THIS MONTH and Daily, whole on
    the Dashboard (batch 1, build 1).
- Tests: § Test Suite → "The plan of record (Run 2.1)".

#### The plan of record (Run 3 — the year: the Advisor tab and the Outlook; store unchanged, NO bump)

Spec: `pbloc-spec-plan-of-record-v1.md` (v1.16 — §4.4, §15; the owner's calls are BL25). `runAdvisor` leaves every
screen (invariant 3): the full-mode Advisor tab shows THIS MONTH's card, the month log plans the plan's month, and the
Outlook became a link to the Decision face.
- **The Advisor tab (D5)** — `AdvisorMain`: the progress bar and the position cards, then `<PlanMonthCard>` — THIS
  MONTH's own card on the tab's one run, its words to the cent (the card is THIS MONTH's own; the tab's other figures
  stay whole) — then the month log and the link. The Advisor's plan rows, their Pay / Skip toggles (`advisorSkip*` —
  read nowhere now; the policy has no skip) and the projection table are gone. The card's Ledger pointer opens Simple
  mode's Daily view (`onOpenLedger`).
- **One run per screen — `usePlanCardInputs`.** THIS MONTH and the Advisor tab each call it once: `usePlanMonth`'s run
  (shared with the screen's month log and overlay — one run, so one fetch of the plan's price history, `usePowerLawData`,
  per screen), the crash line through the
  console's builder on the live figures (D13) and the NDP. `PlanMonthCard` takes the run as a prop (`pm`) and runs
  nothing itself.
- **The month log's planned figures** — `planLogRows(sim, currentMonth)`: strategy month k is the run's month
  k − currentMonth + 1, from the current month to 12; a past month has none (D14). Its Strike paydown is
  `planStrikePaidUsd` — spare income's repayment, a refinance's payment and the cash reserve's cure: the Ledger's
  Strike paydown (with Coinbase's — spare income's and a defense's — it is Daily's "paid" target; a test sums both over
  every month of the sweep). Never the Advisor's income residual. The overlay's form starts from the run's own
  month-end LTVs (`ltvFieldNumber`: ∞ → 0); its tier-collateral prop is gone.
- **The Outlook became a link (D5)** — "Your plan on other price paths — the Almanac's Decision face →"
  (`PLAN_PATHS_LINK`), under THIS MONTH's card and on the Advisor tab, opens the Almanac on the Decision face
  (`AppShell.goPlanPaths` → `<AlmanacView initialFace>`): the plan's own face, open without a Coinbase loan — the
  plan of record's move, then the plan it starts, on the price path the owner picks (one of six; the support floor by
  default). D5 had named the Strategy face, which a Coinbase loan gates — the owner's call, BL25. Every other way in — the nav's Almanac button, full mode's Tools menu
  — still opens the default face:
  leaving the hub forgets the face asked for (one effect on the tab), and `goAlmanac` sets none — it takes no argument
  (HeaderNavCluster passes it as `onClick`, so a click event must never become a face).
  Full mode shows the link only while the Almanac tab isn't hidden (a hidden tab bounces). Simple mode's This Month /
  Outlook switch is gone. Deleted with the Outlook: `OutlookProjection`, `outlookView` and its test, and the
  projection's `CB_PAYDOWN_LABEL` / `IF_YOU_SHIFT_DEBT` and the legend's `playbookDepthFor`.
- **The expenses prompt moved onto THIS MONTH**, under the card and the link, to the cent (`planReanchorLine`); Update
  stores the average to the cent (`setExpenses(toCents(avg))`); owner-only (its Update writes the plan). THIS MONTH has
  no whole-dollar figure left. (The plan of record's Run 4: `planReanchorWords` — BL26's words and buttons — on the
  months before this one, F-R4-1.)
- **Inert, never removed (invariant 6):** `advisorSkip*`; `cbRotateBackPct` (Settings' Rotate-back LTV input left with
  its last reader — the order hint checks target < trigger < 86%); `advisorMonthStartBalance` (the projection's base —
  "Balance at start of this month" left Settings and Quick Setup; the month review's sign-off still carries it, which
  nothing reads). Their keys stay in `SETTINGS_FIELDS`, the payload and the backup whitelist, so an older backup
  restores (a test pins both halves). The Advisor sidebar's "projecting from Mo N" line left with the projection.
- **Deleted:** the five `simpleModePlan` helpers Run 2 left with no screen — `deriveForMonth`, `composeMonthSummary`,
  `isOperatingMonth`, `displaySettledLtv`, `isLtvFigureStressed` — with their tests; and the dead CSS: a selector that
  names a class no importer applies can never match, so SimpleModeView.module.css lost 164 classes' rules and
  AdvisorMain.module.css 70; every surviving rule keeps its selectors and declarations (a script compares them,
  comments and whitespace aside), and the one rule left that named no dead class — `@keyframes fadeIn` — went with
  its only user.
- **`runAdvisor` stays one release as the comparison engine** — its tests, `deriveAdvisorStart` and its helpers stay;
  no screen calls it (a sweep of every non-test source file pins it). *(It left the code in 5e, batch 1 — D5-A; the
  sweep now pins that it is gone.)*
- **Not in Run 3:** the crash gate stays `ltvTriggered` (Run 4, D3); the sidebar's PRIORITY RULES, InputsPanel's
  "Recommended min" and the CB Loan tab's rows (Run 4); `cbMonthlyPayment` and `cbPaymentStrategy` keep their readers
  (the CB Loan tab, the gates); Daily's breaker marker and the Decision face reading the breaker cache (Run 4 options);
  one price-history fetch per screen visit (5e, F12). Done in Run 4 (§ The plan of record (Run 4)): the gate, the
  PRIORITY RULES, "Recommended min", the CB Loan tab's rows and the two fields (retired, inert); neither option was
  taken.
- Tests: § Test Suite → "The plan of record (Run 3)".

#### The plan of record (Run 4 — Safety and the edges; store unchanged, NO bump)

Spec: `pbloc-spec-plan-of-record-v1.md` (v1.20 — §16). The Emergency Console runs with any Coinbase loan, and the screens
that kept their own crash-day answer or typed rules now read the console, Safety or the plan; Safety reads Coinbase at
support, for the owner and the safe viewer; the price history ends as failed past a time limit; the expenses prompt says
what its buttons do.
- **D3 — the console's gate is the Coinbase loan** (§ Emergency Console). `CbDefenseTool` renders `EmergencyConsole`
  with a loan (`hasCbLoan`), nothing without; the Liq Sim (`LiqSimulator`, its `.module.css`, `liqSimulatorView` and
  its test) is deleted — it had no other screen. The `liqsim` tab is always "Emergency" / "Emerg" (`ALL_TABS_META`;
  `withEmergencyLabel` is gone; the key stays `liqsim`) and the Almanac's defense face always "🚨 Emergency"; Settings'
  own tab list (SettingsMain's `ALL_TABS`, kept in step — ui.md) names it "Emergency" too, and its Strike collateral
  hint names what reads the figure now (the plan, the Safety card, the Emergency Console). The crash day, `isCrashDay({ hasCbLoan,
  cbDebt, cbCollateralBtc, price, triggerPct })`, has no `ltvTriggered`: THIS MONTH and the Advisor tab (both through
  `usePlanCardInputs`), Daily and the CB Loan tab read it. The Decision face's `consoleRuns = s.hasCbLoan`;
  `MoveCardContext.ltvTriggered` became `consoleRuns`, and the console's gate words read "(it runs once your Coinbase
  loan is switched on)".
- **D3 — `cbPaymentStrategy` and `cbMonthlyPayment` retire, inert** (invariant 6 now covers seven fields — Run 3's five
  and these two): no component reads or writes them; their keys stay in `SETTINGS_FIELDS`, the backup whitelist and the
  payload, so an older backup restores (the demo seed still writes `cbPaymentStrategy`). Settings' Coinbase page lost
  the payment-strategy pills and "Monthly payment"; its crash-day thresholds (ACTION AT TRIGGER, the trigger, the target,
  the order hint) show whenever a loan is switched on, and its Coinbase Loan row reads "Balance, collateral, APR,
  crash-day trigger". The CB Loan sidebar lost MONTHLY PAYMENT; the Advisor sidebar lost "Min. payment". With the loan
  off, the bar shows neither the CB Loan tab nor the console's, and neither stays open (AppShell's bounce effect).
- **The CB Loan tab (`CoinbaseLoanMain`)** takes `onOpenConsole` and `onOpenPlanPaths` (AppShell passes
  `consoleInFullMode` — none while the Emergency tab is hidden — and `planPathsInFullMode`). Its crash-day banner shows on `isCrashDay`, with
  `atTriggerLine(trigger, true)` and an "Open the Emergency Console →" button. Its price alerts are two rows — "Your
  trigger" (the owner's `cbLtvTriggerPct` at `cbMetrics`' trigger price: "Work from the Emergency Console") and
  "Auto-Liquidation" (86%); the typed 70% "Emergency Protocol", 76% "Critical" and 84% "Danger" rows are gone.
  `LtvSafetyBar` colours today's LTV by Safety's level and marks the trigger ("↑N% your trigger"); the CURRENT LTV card
  wears Safety's colour and words (SAFE / FAIR / POOR). The 12-month projection (it read the retired monthly payment)
  gave way to `PLAN_PATHS_LINK`; Section 6 is "On a crash day" (`cbTabCrashDayLine`) with the console link. A paid-off or
  unbacked loan has no trigger or seizure price: the card names the trigger alone and the two rows read — (`shownUsd`).
  `runCoinbaseLoan()` and `classifyLtv()` have no screen reader now (they left the code in 5e, D5-A); 39 dead CSS rules
  went.
- **The console's words where another screen points to it — `crashPlaybookView`:** `CONSOLE_LINK`,
  `atTriggerLine(triggerPct, consoleRuns)` (the Decision face's at-trigger alert reads it too — one copy) and
  `cbTabCrashDayLine(triggerPct, triggerPriceUsd)`.
- **The Advisor tab (`AdvisorMain`)** — its Coinbase card's Current LTV figure and colour are Safety's
  (`deriveSafetyView(selectSafetyViewInputs)`), no longer `getTier` / `getTierColor` (no screen reads them; they left with
  `runAdvisor` in 5e, D5-A). **Its sidebar's YOUR PLAN** — `planRuleRows(planPolicySettingsOf(usePlanPolicy()),
  expenses)`, always shown — replaced the typed PRIORITY RULES (55 / 65 / 70): the six settings in the sliders' words
  (`PLAN_RULE_LABEL`, supportPolicyView — one copy; `SupportPolicyCard` reads it), each as the plan runs it, a limit held
  to its defense line showing that line. `planPolicySettingsOf(plan)` (planRun) is the saved plan as every plan reader
  runs it (`planMonthRun` uses it).
- **The Smart BLOC sidebar (`InputsPanel`)** — "Your plan's suggested line": `suggestedLineUsd` on the plan's Coinbase
  leg (`planCbLoanBalanceOf` / `planCbCollateralOf`, accrued) at today's price, with `decisionView`'s
  `suggestedLineWords` under it (one copy with THE MOVE's line) — replaced "Recommended min" (`runBlocYearOne`'s peak ×
  1.10 at a typed 0.15 ceiling).
- **D7 — Safety reads Coinbase at support (`safetyView`).** `SafetyViewInputs` gains `cbLimitAtSupport`
  (`selectSafetyViewInputs` sets `planCbLimitOf(s)` — lib/planPolicy: the plan's Coinbase limit at support as the plan
  runs it, held to `PLAN_CB_DEFENSE_PCT` 70, the constant planClamp's `PLAN_CB_LTV_CAP_PCT` reads; a test pins it equal
  to `planPolicySettingsOf(…).cbStopEffPct / 100`) and `supportToday` — a clock read the CALLER passes
  (`supportToday(todayISO)`, the plan's S₀). `SafetyView.cbAtSupport` (`cbAtSupportOf`): accrued debt ÷ (collateral ×
  S₀), the limit, and `over` by the placement's own rule with the dust floor — level watch or safe: amber, never red.
  `SafetyDashboard` (THIS MONTH and Daily) prints `ownerAtSupportLine` under the Coinbase cushion row — `cbAtSupportLine`
  to the cent, amber when over. Its words (Run 4.1, BL29 — the owner found the first ones too complex, F-R4-2) are a
  what-if in the bar's own terms that says which side of the limit it is: "If BTC were at support ($S): X% LTV — over
  the plan's L% limit", or "within" — by the reading's level, never the ratios; "were at" holds above support or below
  it. The figure agrees with the word (over, never at or below the limit; within, never above it), and a limit with a
  decimal prints it. Safety reads the position as it stands and THIS MONTH's card reads it after the
  month's move, so when this month's move tops Coinbase up from Strike and brings it within (planMonthView's
  `planMoveBringsCbWithin(placement)`, which THIS MONTH and Daily pass from their own run as `moveBringsCbWithin`) the
  line adds "; this month's move brings it within" (`CB_MOVE_BRINGS_WITHIN`, D-R4-1), still amber until the coins
  move. Its eyebrow is `ownerSafetyVerdict` — the worse reading wins, and "Watch — Coinbase is over the plan's
  limit at support" (`CB_AT_SUPPORT_WATCH`) when only the at-support reading is amber. `deriveViewerOverall` folds the
  at-support level.
- **D9 — the safe viewer** (§ Viewer V2): the safe snapshot carries Coinbase's LTV at support and the owner's verdict on
  it (`safety.cbLtvAtSupport`, `safety.cbAtSupportLevel`) and the plan's limit (`thresholds.cbLimitAtSupport`) — no new
  top-level key; the viewer home's Coinbase sub-line (the owner's Dashboard too) adds `cbAtSupportLine`. Older snapshots
  carry none and show none.
- **BL23 — the price history's time limit** (`utils/timeLimit.ts`: `HISTORY_TIMEOUT_MS` = 15 s,
  `withTimeLimit(ms, run, outer?)`). `usePowerLawData` and `useBtcHistory` fetch AND read the body inside it; an unmount
  aborts. A stall now ends as failed: THIS MONTH shows its cached breaker's line, the Decision face says the history
  didn't load, the Power Law face and the price chart say it is unavailable. `useBtcHistory` keeps the candles already
  drawn for the same range when a refresh fails (`shownRange`), for as long as the page stays in view, so the chart
  says "unavailable" only when a first load fails — and a page back in view starts with a first load. *(5e, F12,
  superseded the chart's half: it now draws this device's copy of the range's history at once, at any age — muted with
  "as of …" once more than 5 minutes old — keeps whatever it can draw through a failed load, and says "unavailable"
  only with nothing to draw; `shownRange` is gone. The time limit is unchanged.)*
- **BL26 / F-R4-1 — THIS MONTH's expenses prompt.** `planReanchorWords(avg, expenses)` (it replaced `planReanchorLine`):
  "Monthly expenses: your last 3 logged months averaged $X; your plan uses $Y.", with [Update plan to $X] [Keep $Y]. One
  figure: `toCents(avg)` is what the line prints, Update names and Update stores; Keep does what Dismiss did.
  `computeExpenseReanchor(monthlyLog, expenses, dismissedAt, beforeMonth = ∞)` counts only months before `beforeMonth`
  that record expenses (> 0); THIS MONTH passes `currentMonth` — 12 once the year is done, and month 12, which keeps
  every later draw (`bucketEventToMonth` clamps), never counts. The month in progress, which Daily
  rolls draws into as they happen, used to pull the average down, and three empty months averaged $0.
- **Still open (not in Run 4's code):** Daily's breaker marker and the Decision face reading the breaker cache; one
  price-history fetch per screen visit (5e, F12).
- Tests: § Test Suite → "The plan of record (Run 4)".

#### BL14 — the plan's goal amount (batch 1, build 2; store unchanged, NO bump)

Spec `pbloc-spec-batch-1-v1` v0.6 §2.2 (G1-C, G2-A). The rule in the engine: `engines.md` § The plan's goal amount; the
field: `store.md` § BL14; the Dashboard tile: `viewer.md` § BL14.

- **One plan is five readers** (BL9). THIS MONTH's hook (`usePlanMonth` — THIS MONTH, Daily and the Advisor tab's card)
  and the Decision, Cycling, Ownership and Strategy faces each read the saved goal through `planGoalOf(st.planGoalNetBtc)`
  in their selector (a primitive, so `useShallow` stays stable); every engine-inputs memo passes `goalNetBtc` and depends
  on it, and every lens reset lists it (`resetMirror.test.ts`). The stress run, the futures job and the crown read
  `engineInputs`, so they run the goal too. `EngineFacts` and `PlanMonthFacts` (`planRun.ts`) REQUIRE it, so THIS MONTH
  and the Decision card can't drift — and, since BL32, `PlacementFacts` too: THE MOVE's input takes the goal (it stands
  down on it), and the Decision face's placement memo passes it and depends on it.
- **THIS MONTH and Daily — the goal line** (`planGoalLine(row, goal)`, under the status). Under the goal: "Net coins
  this month: ₿0.497 of your ₿2.000 goal, at today's price." At it: "At your goal (net coins this month: ₿0.497 of
  ₿0.400): the plan borrows and buys nothing — spare income repays Coinbase." — naming the legs the month ACTUALLY repaid
  (a loan over its limit is restored first, so the goal's own order isn't always the month's); "— no spare income is
  left this month to repay a loan" when the bills or a minimum took it all; and "the plan holds — it borrows and buys
  nothing, and $X of spare income stays with you" once both loans are repaid (at exactly 0 that month also stands down — § BL32; a balance under the 50¢ dust floor reads as repaid here but is still a loan, so that month doesn't). `goalPair` prints both figures to three
  places, or as many more (to eight) as it takes for a figure under the goal never to print as the goal; `netBtcText`
  puts a sign before the ₿ ("−₿0.200"). "This month", never "today": the run reads the month's decision — today's price
  after a month of Coinbase's interest — so with a Coinbase loan open the figure sits a little under the Dashboard tile's
  "today", and "Why this plan?" (`planMonthSummary`'s goal words) names the interest.
- **The faces' words when the goal was why** — each byte-identical with no goal:
  - the month's sentence: `policyPauseReason`'s goal branch (after the post-liquidation one) — "Net coins are at your
    goal, so the plan borrows and buys nothing. Your paycheck pays the bills." — then what spare income repaid on each
    leg (`repaidTail`) or kept (`goalKeptTail`);
  - the verdict's stop clause and sentence: "(at your goal)" (`stopReason` reads the stop month's row);
  - the never-borrows notice: `'goal'` ("Net coins are at your goal in every buy-zone month on this path, so the plan
    never borrows.") and `'goalMixed'`;
  - the Support policy card's headline: "Buy zone · 1.50× support — at your goal, the plan borrows and buys nothing" in
    the zone's tone — `GOAL_BUY_ZONE_LABEL`, never "Buy with the line" when nothing is borrowed (HEAD's own rule after a
    liquidation; δ-L4);
  - the no-bills sentence's fourth shape: "No bills to fund. Net coins are at your goal, so the plan borrows and buys
    nothing." + the repayment or the kept income;
  - the Decision schedule: ◎ beside a goal month's zone letter, and "at your goal" beside the zone in the printout.
- **A goal month with a crash defense (δ-L2).** The debt shift still runs at the goal, so a month whose defense drew on
  Strike (`goalDefenseOf`: the row's `defenseDrawnUsd` over the dust floor) "buys nothing and borrows only for a crash
  defense" (`goalActs`) — in the goal line, "Why this plan?", the ◎ mark, the month's sentence, the headline and the
  no-bills sentence. A month without a shift keeps "borrows and buys nothing".
- **The sentences a goal month would have made false** (v2 — the build 2 plan's review):
  - the faces' unpaid line, when the first unpaid month sat at the goal: "From month N, $X of bills went unpaid — net
    coins are at your goal, so the plan borrows nothing for them." (`GOAL_UNPAID_CAUSE`; δ1);
  - THIS MONTH's unpaid body at a goal month: "At your goal the plan borrows nothing for the bills, so income and the
    cash reserve fall short at today's price." (`GOAL_UNPAID_BODY`; δ2);
  - an over-limit goal month: "Spare income repays it", without "before the plan borrows again" (δ3 — the N8 rule's goal
    twin);
  - THE MOVE's over-limit line drops "before it borrows again" when THIS MONTH's own figure is at the goal:
    `atGoalThisMonth: sim.policyApplied && atGoalThisMonthOf(placementInput, cbAprPct, goal)` — THE MOVE's coins and debts
    at its price plus a month of Coinbase's interest (`netCoinsThisMonthOf`), so the card is the same on every path and
    agrees with THIS MONTH (δ4 — words only. G3 has since been called B, BL32: THE MOVE's placement reads the goal to
    stand down — § BL32);
  - the crash playbook's note, when a goal month follows the first shift: "…the refinance shifts the debt back to Coinbase
    as the price recovers, except at your goal, where spare income repays it instead." (`GOAL_REFINANCE_CLAUSE`; δ-L7).
- **The never-draw verdict at the goal** (δ-L6, δ-L8). `verdictVsNeverDraw` reads the engine's one rule (`neverDrawTie`):
  with a goal, a gap under the dust floor is `kind: 'even'`. The Cycling face says "Cycling ties — the same equity as
  paying bills from income" (the Strategy face, "Cycle ties — …"; `neverDrawTieHead`), in a neutral box (no good or warn
  class), the Net-equity tile in the plain text colour (its end sub-line, when the comparison is all-in, "all-in vs
  never-draw: even"; otherwise "never-draw: $X" as before), and no signed coin gap under the head (a tie's sign is float
  residue). The Decision face's tile reads "even" in plain. The futures' "Beats never
  borrowing" adds "· N% tie" to its sub-line when any future ties (`tiesNeverDraw`). The kept income counts on both
  sides, and the head names it: ", counting the spare income kept at your goal" (`KEPT_BASIS_CLAUSE`; `allIn` is then
  true). The Ownership face shows no never-draw verdict. With no goal, every verdict's word, colour and count is as before.
- **Still open:** δ-L3 — after a Coinbase liquidation the month's sentence keeps "Coinbase has been liquidated — the
  policy borrows nothing more." and never names the goal (silent, not false); δ-L5 — with the policy refused (a Strike
  liquidation LTV at or under its 70% call), the engine runs no goal, so THIS MONTH prints no goal line; its status names
  the refusal.
- Tests: `goalViews.test.ts` (23), `goalTile.test.tsx` (3), `yourPlanGoal.test.ts` (3), `planRun.test.ts` and
  `planRunWiring.test.ts` (+3 each) — § Test Suite → "BL14 — the plan's goal amount".

#### BL32 — the stand-down (batch 1, build 2b; store unchanged, NO bump)

Spec `pbloc-spec-batch-1-v1` v0.10 §2.2 (G3, called B — BL32). The rule in the engine and THE MOVE: `engines.md` § The
plan's goal amount → "The stand-down". At the goal with both loans repaid — exactly zero — the plan keeps nothing on
Strike or Coinbase: every coin goes to cold storage. ONE phrase says so everywhere, `GOAL_STAND_DOWN_WORDS`
(`supportPolicyView.ts`): "the plan keeps nothing on Strike or Coinbase: every coin goes to cold storage". Every new
sentence but the cold card's reads the stand-down itself — THE MOVE's `standDown` or the row's `goalStandDown`, never
the dollars shown — so with no goal every sentence is as before. The cold card's stand-down line (`policyColdGoalNote`
since BL33) reads the run's goal: with a loan still open it is there too, saying what happens once both loans are repaid.

- **THE MOVE's card at the stand-down** (`moveCard`):
  - the why line — "At your goal with both loans repaid, the plan keeps nothing on Strike or Coinbase: every coin goes to
    cold storage." — in place of what Strike and Coinbase keep; with nothing left to move, the aligned line — "Nothing to
    move — every coin is already in cold storage.";
  - the plan is `'ready'` even below support or with the model treated as broken, so no paused or broken state line;
    the breaker line still reports the breaker ("no new debt");
  - δ2 — the moves line lists only what moves: never "keep X ₿ on Strike" beside "keeps nothing on Strike". Inside
    Strike's hold it reads "Today: move 1.000 ₿ from Coinbase to cold", and the hold line says when Strike's coins go
    ("Strike's 60-day hold runs through … — move then."). With a loan open, "keep X ₿ on Strike" as before;
  - δ1 — no line words: once the plan keeps nothing on Strike nothing backs the line (Strike lends at most half its
    collateral's value), and a bigger line changes nothing (both keeps are 0 at any line) — so no "Your $X line already
    covers two months of bills." and no "A $X line would cover … / Try $X". The what-if pair stays: "Modeling a $X
    line." with "Back to $Y" is the way back;
  - no short line, no over-limit line and no cliff: nothing is owed.
- **The schedule:** a stand-down month's step 5 is `ACTION_FIELDS`' `strikeToCold` — "Release X ₿ of Strike collateral
  to cold storage." (+ " (small — can wait)" under 0.01 ₿) — after step 5's Strike → Coinbase and before the refinance;
  Today's leg is `todayActions`' (no marker — N5). The keep column prints "—" for the zero keep. The Today row's ◎ stays
  the months' (Today places collateral and borrows or buys nothing either way). The printout lists the same actions.
- **THIS MONTH and Daily:** a month's "Strike → cold storage" row carries "month-end" ("small, can wait" under 0.01 ₿),
  like the other placement moves; Today's still reads "today".
- **"Why this plan?"** (`planMonthSummary`), in a month that stood down, adds "With both loans repaid, the plan keeps
  nothing on Strike or Coinbase: every coin goes to cold storage." after the goal sentence — from the row's
  `goalStandDown`, never re-derived from the balances it shows: 30¢ still owed rounds to "$0" and is still a loan, so the
  sentence never prints there.
- **The cold-storage card** (since BL33 the four engine faces' one card — § BL33): with a goal the run applied
  (`sim.goalNetBtc`), `policyColdGoalNote(goal)` — the folded rules' second line, after `policyColdNote`'s rule — reads
  "At your goal with both loans repaid, the plan keeps nothing on Strike or Coinbase: every coin goes to cold storage, at
  any price."; without one, no such line. (Build 2b wrote it as `policyColdNote(s, goal)`'s second sentence, on Cycling
  and Strategy.)
- **δ3 — the Ownership face's limit line** ("Where the position stands"): in a month that stood down with nothing on
  Strike, `strikeLimitTail` (`ownershipFaceView.ts`; the face renders it) reads "Limit is bound by collateral — at your
  goal with both loans repaid, nothing is pledged to Strike." — never "the full line is backed again above $0": no price
  backs a line with nothing pledged. Every other month the face's words byte for byte, a stand-down inside Strike's hold
  (coins still on Strike) included; a fresh install's empty Strike still reads "… above $0" — the zero-state pass's, in
  the backlog, not the stand-down's.
- **No Coinbase loan:** the stand-down's coins never pass through Coinbase, so `coinbaseLoanLine` never says the plan
  opens one.
- **The round trip (logged, accepted):** at the goal with a loan this month's spare income will repay, today's move
  still keeps for it — into Coinbase, perhaps — and month 1, having repaid it, stands down and sweeps those coins to cold.
  THIS MONTH shows both moves, and "Why this plan?" says why the second.
- **Still open** (neither is false):
  - ii — the cold card's rule line keeps "unless the model is treated as broken", and its stand-down line says "at any
    price" but not "broken or not" (it is unconditional);
  - iii — THIS MONTH's goal line, in a month that stands down, reads "the plan holds — it borrows and buys nothing" while
    its rows move coins to cold: "hold" is the app's word for no new debt (the hold zone sweeps to cold too).
- Tests: `goalStandDown.test.ts` (19, new), `goalViews.test.ts` (+11: STAND WORDS ×4, STAND ROWS ×5, STAND LIMIT,
  STAND COLD), `planRunWiring.test.ts` (+1), `planRun.test.ts` (GOAL renamed) — § Test Suite → "BL32 — the stand-down".

#### BL33 — the goal and cold storage sections (batch 1, build 2c; store unchanged, NO bump)

Spec `pbloc-spec-batch-1-v1` v0.13 §2.2c (the owner's ask, BL33). UI and words only: no engine, store, sync or format
change, and every figure shown is one the app already computes. Settings' goal group: `store.md` § BL14 ("Its one
editor") and `viewer.md` § BL14 (`useNetCoinsToday`, `goalNowView`); Settings' cold group: `engines.md` § Cold ledger.

- **ONE cold-storage card on the four engine faces** — `ColdStorageCard` (+ `.module.css`, composing Cycling's shell,
  which Strategy and Decision already compose and Ownership declares identically) from ONE pure view, `coldCardView(sim,
  settings, coldBufferPct, labels)`, null exactly when `!coldShown(coldBufferPct, sim)` — the card then shows only its
  label and what the face adds. In order: the total by the run's end ("2.662 ₿" / "in your own custody by {end}"); where
  it came from (`coldOriginsParts`); when new coins first move (`coldMovesSentence`, `NOTHING_MOVES_TO_COLD` with no
  reserve); and, only while the policy applies, "How the plan uses cold storage ›", folded (`<details>`, THIS MONTH's
  "Why this plan?" pattern) — `policyColdNote`, `policyColdGoalNote` (with the goal the run applied), `policyReserveNote`
  (when non-empty), one a line. Every sentence is an existing one-definition helper's behind its own gates; no face
  composes one (coldCard COLD FACES pins it). The card is `<section aria-label="Cold storage">`, one region per face.
- **Each face, from its own displayed run:**
  - Cycling — where it was, between the venue split and the CB LTV chart, in its date labels
    (`bandDateLabel(rows.length - 1)`, `bandDateLabel(firstColdMonth)`) at the face's buffer; it adds its InfoTip
    (`info`) and, with the policy off, the sweep's controls (`children`: the slider behind `coldBufferPct > 0`,
    `sweepOffReserveNote` with the sweep off and a reserve, the toggle last).
  - Strategy — out of the Strategy card into its own, after it ("month N" / "at month N"), with the origins line it
    lacked; the same policy-off controls.
  - Ownership — new, after "Holdings by venue"; no controls; its buffer is always `DEFAULT_COLD_BUFFER_PCT` (no setter on
    the face).
  - Decision — new, under the outcome strip, `showTotal={false}`: the strip's first tile, "In cold storage", is
    `last.coldBtc`, the run's `totalColdBtc`. Its buffer is the run's, `PLAN_COLD_BUFFER_PCT` (`engineInputsOf`).
- **What renders differently (none false):**
  - i — fixed: on Cycling with the policy and the sweep off and a reserve, the card's moves line ("No new coins move to
    cold on this path.") sits over `sweepOffReserveNote`, which no longer repeats it ("With the sweep off, a defense can
    still draw on your reserve if …"; ONCE);
  - ii — Strategy with the policy off now carries the end month, the origins and the moves line, each true of the run
    (only a sweep or a stand-down sets `firstColdMonth`);
  - iii — Strategy with the policy off, the sweep off and no reserve: "Cold storage · off" became the card's label above
    "Sweep to cold storage", as Cycling has always read;
  - iv — with the policy on the rules are folded, the stand-down line among them (build 2b's look read it open).
- **Settings → Your plan: the goal first** (`YourPlanSection`'s `GoalGroup`; the menu row reads "Your goal, and the
  support policy's limits and zones"): the lead (`GOAL_LEAD`), where you stand (`GoalNow` — net coins today in the
  Dashboard tile's words, `goalNowView` through `useNetCoinsToday` on `useViewerSafety(null)`), the field, and "What
  happens at your goal ›" folded (`GOAL_RULES`: the bills, spare income, the stand-down's phrase, the way back).
- **Settings → Strike Strategy: COLD STORAGE, its own group** after the Strike BLOC's, never behind `hasCbLoan` (the
  menu row adds "cold storage"): "Total in cold storage" (`NumberInput`'s `ariaLabel`) on the LIVE total, written by
  `setColdStorageBtc` at `decimals={8}`; `coldStorageView`'s words — the lead, `coldAsOfLine` ("Entered <day>, plus N
  moves since.", the derive's own count; "Not dated yet — enter your total once to date it." for a stamp the derive
  can't read) and how it changes.
- **Still open (logged, v0.13):** the clock — the tile's and Settings' readings of net coins differ only by Coinbase's
  interest accrued between their renders (`accruedCbBalance`); a stamp beyond Date's range would print an invalid date,
  as before — unreachable, since the one writer stamps `Date.now()`.
- Tests: `coldCard.test.tsx` (14, new), `coldStorageGroup.test.ts` (6, new), `yourPlanGoal.test.ts` (3 → 6),
  `goalTile.test.tsx` (3 → 6), `cyclingFaceView.test.ts` (+1, ONCE), `goalViews.test.ts` (STAND COLD), `planRunWiring`
  (GOAL), `coldWiring`; e2e `coldStorage.spec.ts` (new) and `goal.spec.ts` — § Test Suite → "BL33 — the goal and cold
  storage sections".

### Unified Strategy face (ELEVENTH Almanac face; store unchanged, NO bump)

An ELEVENTH face **Strategy** (`◈ Strategy`, `src/components/Almanac/UnifiedFace.tsx` + `.module.css`) —
**ONE engine run, TWO lenses.** `CyclingFace` and `OwnershipFace` already share an engine (their
`engineInputs` differ by one field, `mode`), so this is a **VIEW merge, not an engine merge**: one
`useStressLens`, one `engineInputs` memo, one base run plus the stress run, and both lenses read the SAME
`sim` — **Position** (the Ownership lens: hero, share bar, the Held·owed / LTV / Price&liq chart trio) and
**Flywheel** (the Cycling lens: the verdict vs never-draw, cash flow at the month, the refinance fee and
break-even, milestones). The ₿ held on Position and the verdict on Flywheel therefore CANNOT disagree — a
mismatch would mean two runs crept in (a hand check pins the two against the parent Cycling face).

- **GATED on `hasCbLoan`** like `cycling` (the strategy is a Strike→Coinbase loop), with the same fallback
  `useEffect`; the pill is appended **after** `ownership` — `halving` must stay first, it is the default.
- **⚠ `renderFace` needs an explicit `if (f === 'unified')` branch ABOVE the final return** — the fallback
  renders the Converter, so a face added to the union without a branch compiles clean and silently shows the
  wrong tool (the C8 trap already recorded in that file).
- **⚠ A SUMMARY, NOT THE UNION OF EVERY CARD.** Nine engine controls (ten with the 4-yr cycle's timing) —
  fewer than either parent. Income, bills and both APRs come from the live plan; the venue split, the safety
  gauges, the rate sliders and the live Morpho check stay on the parents. Do not grow it into a third copy.
  ⚠ **Two additions:** the Support policy card (Run 2b) — the same shared card the parents render, placed after the
  Strategy card — and the futures readout (Policy v2 — the lenses, R3): `<FuturesCard>` under the tiles and above
  `{lensView === 'position' ? (`, so Position and Flywheel both show it, titled with the CURRENT horizon
  (`futuresTitle(FUTURES_COUNT, months)`; the figures under it may be a run behind). One `useFutures` run feeds the
  readout and the card's line. Summary-not-union still holds. BL33: the cold block left the Strategy card for its own
  card after it (`ColdStorageCard`, § BL33) — the Strategy card's own content moved, not an addition; it gained the
  origins line.
- **No fourth copy of any number**: every rule is a tested helper from `cyclingFaceView` / `ownershipFaceView`
  (the B1 rule this repo already paid for once). One convention per behaviour: **Milestone rows jump the
  scrubber** (Ownership's convention) — a dead row on a face that has a scrubber is worse than a live one.
- **Its Milestones carry Debt and Equity after Yours** (Milestones on a phone — the owner's ask): `fmtK(r.debt)` and
  `fmtK(r.equity)`, the latter in `--text-primary` INLINE, as the table's other tinted cells. A module class beside the
  composed `.msTd` would leave the colour to bundle order. Under 768 px the switch table shows it (§ Milestones on a
  phone).
  Its year cells, and Ownership's, now sit left under their left "Year" header (R5, M9). `.msYear { text-align: left }`
  sat one rule above `.msTd { text-align: right }` in OwnershipFace.module.css (Strategy composes both), so on the tie the
  later rule won and the years read right. The rule is DOUBLED there now — `.msYear.msYear` — the house's rule for an
  override a later rule ties (P9 / P10). The composedOverrides audit reads only composing classes' own rules, so it neither
  flags nor lists it — never add it to `DOUBLED`.
- **READ-ONLY, zero store writes** (stricter than `ScenarioFace`, which writes a pin). Defaults mirror the
  Cycling face: Support, on the line, horizon 60, inspect month 24, cadence 1, CB stop 70, sweep 30 on,
  Strike cap 60 on, `cycle`, lens Position.
- **The Lens lives in the control dock** (sticky controls, Run 2, D8): the thumb-sized Position | Flywheel switch left
  the page and is the dock's fifth control — a tab under 1024 px, a chip on the bar, never live (F14). ⚠ **Two different
  "lens"es (F18):** `lens` / `setLens` is the PRICE STRESS (useStressLens); `lensView` / `setLensView` is the view. The
  dock's Stress writes only the first, its Lens only the second, and `lensView` is NOT in the reset effect's list —
  flipping the view resets nothing, so a stress survives it. Only the dock shows which view is on.
- **CSS composes from the parents** (`UnifiedFace.module.css`): chrome/cards/controls/tiles/scrubbers from
  CyclingFace, hero/share bar/chart switch/mode buttons/table from OwnershipFace. The only NEW rules are the
  state line, the control block, the thumb-sized (44px) Position | Flywheel switch and the control dock's (the doubled
  `.faceDocked` pair; `.lensSwitch.dockLens`, the switch under its label in the Lens panel). Zero new hex.
- **`resetMirror.test.ts` and `stressAnchor.test.ts` both cover it** — `'UnifiedFace.tsx'` is in `FACES` and
  in the anchor guard's expected list. ⚠ The mirror was run RED on all three faces (each naming
  `strikeCapPct`) before the reset arrays were wired, exactly as that file's docblock demands.

### Decision face (TWELFTH Almanac face, Run B; store unchanged, NO bump)

A TWELFTH face **Decision** (`◆ Decision`, `src/components/Almanac/DecisionFace.tsx` + `.module.css`) — **the support
policy's move this month, then the MODELED plan it starts.** Spec: `pbloc-spec-decision-face-v1-1.md` (through v1.8);
the pure layer is Run A's (`placement.ts`, `planSearch.ts`, `decisionView.ts`, `decisionChartView.ts`, the memory
helpers in `supportPolicyInputs.ts`). Scope is §7's list — a decision, compact evidence and tap-through: no cash-flow
sentences (D12), no milestone table, no cycle-timing control (the 4-yr path runs at phase shift 0 — G10).

- **Identity.** Key `decision`, **UNGATED** (decision 2: without a Coinbase loan the whole schedule shows, with
  `coinbaseLoanLine` saying when the plan opens one) and **appended LAST** — `halving` stays first, it is the default.
  ⚠ `renderFace` has an explicit `if (f === 'decision')` branch ABOVE the Converter fallback (the C8 trap).
  `onNavigate` is a narrow union (`'cycling' | 'ownership' | 'unified' | 'defense'`), so the face never imports the
  hub's `Face` type back; the hub passes `setFace`.
- **ONE run, many lenses (D8).** One `engineInputs` memo → the base run and the stress run; every card reads the same
  `sim`. `evaluatePaths(engineInputs, paths, …)` only picks the **Worst (modeled)** crown — never a second truth.
- **THE MOVE** = the engine's steps 5 and 9, previewed (`placementPlan`). 🔴 **B1 — ONE `placementInput` memo** feeds
  both the plan and the card: priced at the stress lens's HELD anchor (never `s.btcPrice`) and `supportPath[0]`, with
  `broken` from the same `breakerSeed` the run's `openingBreaker` gets, the run's line, and Strike's hold. The card's
  price, support, debt and stop are read from that object, so it can never price its cliff against a different
  number than the move it shows. States: `'unavailable'` → `'cbPastLiquidation'` → `'broken'` → `'paused'` →
  `'ready'` — at the goal's stand-down (BL32) neither `'broken'` nor `'paused'` applies: the plan is `'ready'`, with
  `standDown` (§ BL32). **Path-invariant by construction** — the card closes with "This move is measured at today's support and
  today's price, so switching paths below doesn't change it." (B3; the owner's copy never says "THE MOVE").
  **Policy v2 Run B (B3):** the cliff line never names a seizure price under the dust floor, and says "less than 1%" /
  "more than 99%" (`fmtBelowPct`, F11). Right after it comes the price alert at the owner's trigger, or "Coinbase is at
  or past your t% trigger at today's price — work from the Emergency Console" (§ Policy v2 → Run B).
- **The seeding rule (D10, v1.6 — amended in Run B and in Policy v2 Run B).**
  `seedFromMove = seedsFromMove(placement.seeded, { ...PLAN_ENGINE_CONTEXT, supportPolicy, pricePath: paths[0], expenses })`
  — the move is worth making AND the engine will APPLY the policy (`supportPolicyResolution`, the run's own answer with
  the run's own inputs). The three collateral balances in `engineInputs` are `seedFromMove ? placement.opening.X : s.X`
  — since the plan of record's Run 2 that ternary lives in planRun's `engineInputsOf`, which the face and THIS MONTH both
  call.
  ⚠ **Run B amendment:** with the policy OFF the card names no move, so the run starts from the store's own balances,
  the schedule's Today row lists nothing (`planSchedule` gates it on `sim.policyApplied`), and `coinbaseLoanLine` never
  says "today". **The residual is CLOSED (Policy v2 Run B, B4):** with the policy ON but IGNORED by the engine (reachable
  only through `'strikeLadder'` — Strike's liquidation LTV at or under its 70% call) the run used to be seeded from a move
  the card never named. `ENGINE_CONTEXT` was the face's ONE copy of the five engine constants, spread by `engineInputs`;
  since Run 2 it is `PLAN_ENGINE_CONTEXT` in planRun.ts, spread by `engineInputsOf` — still ONE copy, shared with THIS
  MONTH.
- **The policy's memory (D14).** One frozen `todayISO` feeds the start date, the hold and the seed. `hold =
  strikeHoldAt(s.strikeDepositISO, todayISO)` — the hold's one fact through its one rule (Run 2, D9: `strikeDepositOf`,
  the journal or a trusted viewer's snapshot date) → `holdMonthsFrom` → `openingStrikeHoldMonths`; `breakerSeed =
  breakerFromHistory(usePowerLawData().historical, startDate, DEFAULT_BREAKER_REARM_MONTHS ?? null)` →
  `openingBreaker: breakerSeed?.state` (undefined reads as absent — `validOpeningBreaker`). The breaker line has FOUR
  readings: a seed (dated through the last month-end, via `fmtTurnDate` — never ICU's "Sept"), **`'loading'`** while
  the fetch is in flight (G5 — `historical` is `[]` until it lands, which is not "didn't load"), and `null` once it
  settled with nothing usable ("Price history didn't load…"). History lands after mount, so the runs re-run once and
  an engaged stress resets once (§7 — expected).
- **The schedule** — `planSchedule(sim, placement)`: Today reads the PLAN; months ≥ 1 read `ACTION_FIELDS` verbatim (a
  stand-down month's Strike → cold among them — BL32).
  Columns Month · Moves (a wrapped list — never a horizontal scroll) · **Strike keep** · Zone (`ZONE_*`; BL14: a goal
  month's ◎ beside the letter, `goalMarkLabel` its title and aria-label — § BL14). **D2:** the
  keep header is `SCHEDULE_KEEP_HEADER` ("Strike keep") on ONE line — `.colKeep` is 88px (11 mono capitals ≈ 73px +
  12px padding; Moves keeps ≥ 121px at a 375px viewport), measured by an e2e at 390px and 375px. The old "Keep ₿ at
  support" wrapped in its 76px column beside "Zone" and read as one phrase. A quiet key under the schedule's header
  line, `SCHEDULE_KEEP_KEY` — "Strike keep: what your full line needs on Strike at support." — says what the column
  is: THE MOVE's phrase for the same formula, `strikeKeepBtc` = max(line, balance) / (skStop × support) (Z12) — 0 at
  the stand-down (BL32), which the column prints as "—", like every keep under the display floor. On
  screen only: the printout has no keep column. **C2:** the
  WHOLE row is the button (`<tr role="button" tabIndex={0}>`, Enter / Space → the inspected month, the dock's Month); a crash row's note
  (`crashNote`, D13 — the SAME sentence the printout carries) and its "→ Emergency Console" link go on a SIBLING row
  beneath, never inside the button; the link appears only when `consoleRuns` (the only time the defense
  face exists and the console runs — `consoleRuns`, which is `hasCbLoan` alone since the plan of record's Run 4, D3)
  and its accessible name carries the month (`consoleLinkLabel`). ⚠ A 60-month plan
  of wrapped moves runs to ~20,000 px on a phone, so the table scrolls in a 460px box of its own (sticky header,
  every row kept) and the outcome and the what-ifs stay within reach.
- **The paths (D2–D4).** Support · Fair · Resistance · 4-yr cycle · **Worst (stitched)** · **Worst (modeled)** — the
  two worst options are face-local (`DecisionPath`), each resolved to a plain `number[]` before the engine; neither
  ever reaches `plBandsAt` / `plBandAt` / `PL_BAND_LABEL[` (I19 — the face uses `.floor` dot access and indexes
  `bandsToday` only with the resolved kind). Worst (stitched) is **disabled while `sameSeries(stitched, paths[0])`**
  (bit for bit, never a tolerance), with the sublabel "identical to Support on these settings" and a fallback to
  Support. ⚠ **The degeneracy is DATED (I10):** from 2026-09-29 the stitched floor IS Support at every window and
  horizon (the modelled cycle sits six days from its trough); from 2028-01-01 it departs at month 31 at a 48-month
  window. The convergence is multiplicative, so this never depends on the anchor. The **Reversion window**
  (`PL_ON_THE_LINE`…120, the "On the line" / "Back to reverting (4 yr)" chip) shapes every path.
- **Worst (modeled) = CLOSEST TO A FORCED SALE (W1, spec v1.9–v1.11).** `evaluatePaths` ranks: (1) any liquidation is
  worse than none, and an earlier one worse than a later one; (2) the smallest **cushion** — the minimum, over months
  1 to the horizon before a liquidation (month 0 is today, the same on every path), of price ÷ Coinbase's seizure
  price (∞ when a path has no Coinbase loan in any of those months); (3) the least all-in equity; (4) the lowest
  index. M4 stands. 🔴 **ONE seizure-price rule:** `cbSeizurePrice`
  (cbMetrics) is the per-row price the chart's cliff draws AND the cushion measures against — null on a
  `postLiquidation` row (so the cushion's cutoff IS the cliff's), under the dust floor, and with no collateral.
  ⚠ Cushions within a RELATIVE `CUSHION_EPS` (1e-9) tie: paths the engine holds on the same line (the 70% defense
  line, the sweep floor) land an ulp apart, and an exact comparison crowned by float noise in 16 of 180 policy-off
  scenarios. `worstBy` is the FIRST rule on which any ranked path differs from the crown — on that rule the crown is
  the extreme of the WHOLE field, so the note's crown sentence ("…that liquidates first" / "…that comes closest to
  Coinbase's seizure price" / "…that ends poorest in dollars" / "The modelled futures tie on these settings") is true
  against every path, where the runner-up's rule could be false. The sublabel stays "currently the {noun}". It
  measures Coinbase's seizure only — a Strike margin-call sale needs a price far under support on the policy's
  sizing, which the modelled paths never reach. ⚠ **Why W1:** v1.8 broke a no-liquidation tie on the FEWEST ₿
  "yours". Modelled paths bottom out at or near support, which the policy sizes its loans to survive, so they almost
  never liquidate — and that tiebreak crowned **Resistance**, the most bullish path, in every policy-on scenario
  measured. With the policy on, Support now comes closest in every scenario measured.
- **The chart (D5, D6).** Recharts `ComposedChart`, log Y with an EXPLICIT domain (`chartDomain`) and an explicit
  time extent (`xExtent`), with explicit ticks from chart zoom's `timeTicks` / `logTicks` — ⚠ with per-series data and
  no chart-level data recharts otherwise ticks every data point (hundreds of overlapping labels, and a duplicate-key
  warning at the seam). It lives in the memoised same-file `DecisionChart` sub-component (so a pan re-renders only the
  chart) and ZOOMS (§ Chart zoom): `chartDomain` / `xExtent` stay the full view (HOME — the opening view, Reset's), and
  the axes read `zoom.view`. Its price axis REACHES $0.01–$10M (`PRICE_REACH`, the reach memo it passes the hook), so −
  and a pan go past the fitted view; the dates' reach is home. Its title row (`ChartHead`: the card label, then the zoom
  toolbar, right-aligned — min-height 32px, because the label beside the toolbar wraps to two 15.75px lines, 31.5px, Z22)
  sits above the box, which is 280px on every device (Z18; it was 316 on touch, the toolbar row inside it). The Tooltip,
  its cursor and every series' active dot stay quiet through a gesture and after it (Z17), and the box snaps to the
  pointer — `isAnimationActive={false}` plus `wrapperStyle={{ transitionProperty: 'none' }}`, so even Reduce Motion's
  global 80ms transition can't slide it (Z23). Its
  tick labels are `--text-muted`, like the Power Law chart's (P6), and `DecisionTip` prices through `fmtTooltipUsd` —
  the ONE tooltip price formatter, so a sub-dollar 2010 price never reads "$0" (Power Law polish P1). History
  is a gradient `Area` whose id comes from `useId()` (PriceChart's `priceFill` is document-global); the displayed
  path is the one `sim` ran (`stressPath` while engaged); the stitched floor is drawn once (not when it IS the
  displayed path, nor on the line while it is Support); the cliff is `cliffPath` — `cbSeizurePrice` per row, the rule
  the Worst (modeled) cushion reads too (dotted red). Manual price mode adds
  `manualPriceNote` (B2). A failed or empty history leaves the forward half and a quiet note. **The legend note:**
  when the displayed path IS the support line after today — `pathOnSupport(displayedPath, supportPath, months)`:
  `sameSeries` over months 1…horizon, bit for bit, never a tolerance (the Worst (stitched) rule; month 0 is spot) — a
  quiet `ON_SUPPORT_NOTE` sits under the legend. On the defaults (Support, on the line) the dashed green path is drawn
  over the solid green support line, so the two read as one and the legend's Support line can't be told apart. A
  stress hides the note (the displayed path is then the stress path).
- **The line doctrine (D11, decision 4).** ONE line per run: `runLine = overlay.creditLine ?? s.creditLine` feeds BOTH
  `engineInputs.strikeCreditLine` and `placementInput.creditLine`. The card's **Try $L / Back to $X** button is
  `MoveLine.action` (the face composes it from nothing). ⚠ The **suggested line** (`suggestedLineUsd`: two months of
  bills or one Coinbase paydown, × 1.25, rounded to $500) is NOT InputsPanel's "Recommended min" — that is a different
  strategy's figure (the year-one BLOC peak × 1.10); unifying them is deferred. (Done in the plan of record's Run 4:
  the Smart BLOC sidebar shows this figure as "Your plan's suggested line", on the plan's Coinbase leg, in THE MOVE's
  words — `suggestedLineWords`.) The slider's "Suggested" chip appears
  only while the run's line is BELOW the suggestion (above it, "Suggested" would read as advice to lower the line).
- **The print doctrine (D7) — execute = print, never act.** ONE text artifact (`scheduleToText`: the header, THE MOVE
  as text, every month's moves — a goal month's zone reading "(accumulate · at your goal)", BL14 — the crash notes, the
  disclaimer) for **Copy** (the reliable iOS-PWA path), **Download
  .txt** (`downloadBlob` — an iOS PWA may open it instead of saving) and **Print**. 🔴 Print sets `body.decision-print`
  and a `<pre>` portal on `<body>` holds the artifact; every print rule in the module is gated on that class, because
  a CSS module loads app-wide and an ungated `@media print` would take over every page's printing (G7). 🔴 **C1:** the
  class clears on `afterprint`, the next `pointerdown`, `keydown` or window `focus`, and on unmount — NEVER
  synchronously after `window.print()` (Safari and mobile browsers return from it at once, before layout).
- **D15 / D16.** The card is "The support policy's move this month" and ALWAYS opens with the plan-of-record line —
  never "THE ANSWER" (I28 greps the four files). Moves under 0.01 ₿ wait for next month's re-plan and the run is not
  seeded. ⚠ Since the plan of record's Run 2 (§4.7) that line reads "This is your plan of record's move this month — the
  support policy, with your settings." (THIS MONTH and Daily show the same move), and "A what-if — your plan is
  unchanged." while a what-if changes the move (`moveWhatIf`: the policy's settings or the line); it used to say the
  Monthly Playbook ran the owner's Coinbase strategy.
- **Copy discipline (I31, Run B).** The face composes NO sentence: every one lives in `decisionView.ts` (see its
  file-list entry). The face holds labels and readouts only; `decisionWiring` scans its string literals and JSX text.
- **Face-local defaults** mirror Cycling: Coinbase defense line 70 · the shared Strike-cap defaults · cold sweep 30 on
  (used only with the policy off) · cadence 1 · on the line (revert preset 48) · horizon 60 · path Support · inspect
  month **1** (so a stress starts now) · the literal `'cycle'`. The defense line, Strike cap, sweep and cadence have
  NO control here — module constants, outside every dependency list. Since the plan of record (Run 1) the defense line
  and the Strike cap are `planClamp.ts`'s; since Run 2 the face's aliases (`CAP_PCT` / `STRIKE_CAP_PCT` /
  `STRIKE_CAP_EFF`) are gone — planRun's `PLAN_ENGINE_CONTEXT` and builders read `PLAN_CB_LTV_CAP_PCT` /
  `PLAN_STRIKE_CAP_PCT`, the cold sweep and the cadence are `PLAN_COLD_BUFFER_PCT` / `PLAN_CYCLE_MONTHS`, and the face
  clamps through `PLAN_CLAMP`; Settings' "Your plan" reads the same clamp. The policy's settings start from the owner's
  saved plan (`usePlanPolicy`). READ-ONLY: zero store writes; "Reset to live".
- **The wiring guard — `decisionWiring.test.ts`** (source-reading; every check proven red): the **PREFIX rule** — every
  `runCyclingSim(` starts `runCyclingSim({ ...engineInputs,` (⚠ NOT `supportPolicyWiring`'s exact regex, which a
  selector call fails); `evaluatePaths(engineInputs,`; `pathNote` gets `worstBy: crown.worstBy` (W1); the four
  policy memos and `buildSupportPath(startDate, months)`,
  never stressed; `placementInput` priced at `anchorPrice` / `supportPath[0]` with the seed's `broken`, and reading no
  path, choice or stress; B1's card context; the seeding rule and its policy gate (Policy v2 Run B: through
  `seedsFromMove`, never `placement.seeded && supportPolicy !== undefined`; since Run 2 `PLAN_ENGINE_CONTEXT` in
  planRun.ts holds exactly the five constants, which `engineInputsOf` spreads and never re-declares, and the face's two
  memos are `placementInputOf(…)` / `engineInputsOf(…)` calls — the pins read both files); the memory reaching the
  engine (the hold through `strikeHoldAt(s.strikeDepositISO, …)`, Run 2);
  `supportAtDates` passed as a FUNCTION; `useId`; the legend note reads `pathOnSupport(displayedPath, supportPath,
  months)`, never `pricePath`; C2's row shape; C1's listeners and the no-synchronous-clear rule; no buffer / stop /
  mode control; I19; I20; the hub (I21); I28; I31 (its non-vacuity anchor is the JSX text 'Moves' since D2 moved the
  keep header into `decisionView`). ⚠ **`resetMirror.test.ts`'s cold regex is
  WIDENED** to `/\b(?:openingColdBtc|coldBtc): (?:[^,\n]*? : )?s\.openingColdBtc\b/` — the bare form or a ternary whose ELSE
  branch is the store's reserve (G1); an inverted ternary and a seed with no fallback both fail it. `coldWiring` and
  `stressAnchor` list the face too; the forbidden-input grep covers it with no change.

**Sticky controls — the control dock (Run 1, spec `pbloc-spec-sticky-controls-v1.md` v1.1; store unchanged).** On a
phone the month slider sat 1,844 px below the chart (F1), so every drag was blind. The face's controls now ride a dock
stuck to the window's bottom edge (`ControlDock` + `controlDockView`, see their file-list entries).
- **The dock is the face's LAST child** — `<ControlDock panels={dockPanels} />` between the disclaimer and the print
  portal. `position: sticky; bottom` holds it on the window's edge until the face ends, where it settles under the
  disclaimer and never covers it. Five controls, in order: **Month · Stress · Path · Line · Policy**
  (`decisionDockTabs`; the face's `dockContent` holds labels and readouts only — I31 holds).
- **Month and Stress live ONLY in the dock.** The Inspect-month / Price-stress card is gone; its three notes (the
  anchored line, `stressNote`, `BELOW_SUPPORT_NOTE`) read under the chart, after the manual-price note. Path, Line and
  Policy are REMOTE controls — they write the same overlay and state as the What-if, Credit-line and Support policy
  cards, which stay. `PathPicker` is ONE path picker for the What-if card and the dock's Path panel (`compact`: one
  sideways-scrolling line, `.dockPaths`, no sublabels); the dock's Policy panel is `SupportPolicyControls`, which reads
  the card's own `policyCardState` and renders its `SupportPolicySliders` (one settings block, one branch).
- **Under 1024 px: tabs. From 1024 px: a bar (R2).** One markup at a time (`useMediaQuery`). Under 1024 (a phone, an
  iPad upright, a phone sideways): five 44 px tabs, label over value, over ONE open panel (Month open at first; a
  second tap folds it; capped at 34vh). From 1024: a bar floating 12 px up — Month and Stress side by side, Path / Line /
  Policy as 32 px chips whose panel opens UPWARD, so the chart at the window's top stays in view. Why 1024: at 768–900 px
  both slider heads wrapped and the bar grew 87 → 106 px, and a touch screen there would get 32 px chips (measured).
  Measured: the dock is 134 px tall at 768–1023 px with the month panel open, 87 px from 1024. A tab's value is
  `font-size: clamp(10px, 3.1vw, 12px)` (Milestones on a phone, R3): at 12px a small phone cut "Flywheel" (340–360 px)
  and "Support" (320 px) — 8 characters need 57.6px in a 48–56px tab. 10px at 320, 12px from 387 px. In full mode the
  dock also bleeds across `.main`'s padding (`--dock-bleed`, § Almanac P4).
- **Clear of the swipe-back zone (Δ2).** The phone panel is inset 14 px, so its controls start at x 30 — right of
  EdgeBackGesture's 20 px zone: a drag from a slider's left end moves the slider, never the page.
- **Under an open InfoTip (Δ3).** The dock is `z-index: 30`; an InfoTip's panel is 40.
- **The keyboard (Δ4).** While the bar's panel is open, Escape is heard on the DOCUMENT (Safari never focuses a clicked
  button, so a listener on the dock would never hear it), except an Escape typed into a value field — that one is
  SliderInput's own cancel, and the next folds the panel. Focus returns to the chip. The panel follows the bar in the
  DOM (Tab goes chip → panel) and shows above it (`order: -1`). `aria-controls` is set only while a panel is open.
  **The tabs (Run 1b, spec v1.3 DC1)** hear Escape only while focus is INSIDE the dock — a React `onKeyDown` on the
  dock, never a document listener. There an open tab is the dock's resting state (Month is open at first), not a pop-up
  the person just opened, so an Escape meant for the page (an ⓘ tip, a chart drag) must never fold it. Escape folds the
  open tab and gives that tab focus (the panel's content unmounts with the fold); a typed value's Escape stays the
  field's. A Chromium browser focuses a clicked tab; in Safari a keyboard user Tabs into the dock.
- **Viewers (R1).** The dock's Line is `disabled={s.viewerMode}`, as the Credit-line card's SliderInput disables itself;
  Month and Stress stay live for a viewer, as they were.
- **The face's end.** `.faceDocked.faceDocked` (doubled — the composed `.face`'s `padding` shorthand would tie a single
  class): bottom padding 0 under 1024 px, where the dock sits flush on the edge, and 12 px from 1024, so the floating
  bar never moves when the page runs out.
- **Full mode (Δ1).** AppShell's `.main` was a scroll container that never scrolls, so a sticky dock stuck to IT, not
  the window — see § Almanac P4.
- ⚠ **Never `position: fixed` (F2).** EdgeBackGesture's `.page { will-change: transform }` makes it the containing block
  for fixed descendants, so a fixed dock scrolls away with the page (measured). Sticky also moves with the page through
  a swipe-back.
- ⚠ **No body `scroll-padding` (F5).** It kept scrolled-to elements above the dock, but focusing the dock itself (Tab
  from the page) then jumped the page by ~400 px: the browser reads a sticky element's own controls as hidden under the
  padding (measured).
- **The cards' markup is unchanged (F9).** The Support policy card on all four faces and the What-if card: outerHTML
  byte-identical to HEAD's in every state (on, Settings closed and open, off, not cycle, not run), production builds,
  class tokens normalised.

**Sticky controls — Run 2: the three parents (spec v1.6, D6–D8; v1.7, R4–R6 and Δ12's measured need; store
unchanged).** On a phone no parent showed its
first chart and its month slider together (F1: 796 px apart on Cycling, 1,019 on Ownership, 840 on Strategy). Cycling,
Ownership and Strategy now carry the same dock — `ControlDock`, `SupportPolicyControls` and the doubled `.faceDocked`
reused, the dock's `.tsx` untouched.
- **The face's last child** — after the disclaimer on Cycling and Strategy; on Ownership after the two-column `.shell`
  (F16), so it spans both columns and settles under both.
- **Cycling and Ownership: Month · Stress · Path · Policy** (`parentDockTabs`, D7 — no Line: the parents don't vary the
  credit line). **Strategy: those four, then Lens** (`strategyDockTabs`, D8). Month and Stress are live on the bar; Path,
  Policy and the Lens are chips.
- **Month and Stress live ONLY in the dock.** Each scrubber card is gone; its notes stay where it was (I3), as bare
  `noteQuiet` paragraphs: Cycling between the stat grid and Holdings by venue; Ownership in its main column above the stat
  grid; Strategy above the tiles (both views share them, so neither hides the notes). Each face keeps its stress range
  (Cycling and Strategy 0.35–2.2, Ownership 0.2–2.2).
- **Ownership reads "Inspect month"** (it read "Month") — one name on all four faces — with the dock's shared words:
  `monthReadout` ("month 24 · 2.0 yr", was "24 · 2.0 yr") and `stressPct` with its colour (Δ10). Its dock sliders are the
  44 px styled range (Δ11: `.dockScrub { composes: scrub from './CyclingFace.module.css'; }` — `composes:` only); the
  card's own 4-yr timing keeps its 28 px native range.
- **Path is each face's own picker** — a face-local `PathPicker` shared by the price-path card and the dock (Cycling and
  Strategy `.bandRow`, Ownership `.segRow` with its "To support…" / "Ride the 4-yr cycle" labels; no `compact` variant —
  four buttons fit one line). Cycling's buttons gained `aria-pressed`, the only card markup change. While the 4-yr path
  is on, the Path panel also holds a copy of the card's timing range (the same min, max, step, value, onChange,
  aria-label and lock); its note stays in the card.
- **Policy** is the card's own `SupportPolicyControls` with the card's props and the face's own `mode` / `expenses`
  (Cycling the literal `'cycle'`); the tab reads `policyCardState(mode, …)`.
- **Strategy's Lens** (D8) — the Position | Flywheel switch left the page (I20) and sits in the Lens panel
  (`.lensSwitch.dockLens`). F18 (`lens` is the stress, `lensView` the view; a flip resets nothing): § Unified Strategy face.
- **Viewers (I19)** — by construction: Month, Stress and Lens only inspect (live for a viewer, as on Decision); the path
  buttons come from the one picker; the Policy panel is the card's own components; the one copied control is pinned.
- **Δ12 — the bar's spacing** (`ControlDock.module.css`): gap 12px and chip padding 6px 8px (were 18 and 11) give each
  live slider +15 px on a three-chip bar (Decision, Strategy) and +12 on a two-chip bar. Without it Strategy's default
  stress head (254 px, beside "Lens Position ▴") wraps and the bar grows (R2's problem).
- **Measured** (a production build, the web font loaded). The phone dock, folded · Month or Stress · Path · Path with the
  4-yr timing · Policy · Lens: Cycling 63 · 134 · 143 · 220 · 350; Ownership 63 · 139 · 139 · 215 · 350; Strategy 63 · 134 ·
  143 · 220 · 350 · 149 (the 34vh cap holds Policy). The bar at 1024 and 1440: Cycling 87 px with 326 px live sliders;
  Ownership 92, 326; Strategy 87, 260; Decision 87, 274. Every default head is one line (Strategy's stress head is 254 px
  in a 260 px slider); a `post-liq` month or a seven-figure price wraps a head on Strategy's bar — an edge state, accepted.
  Ownership at 920–1023 px: the two-column shell over the tabs dock, full bleed.
- **F9:** the Support policy card on all four faces (on, Settings open, off, not cycle, not run) and the three price-path
  cards, at 390 and 1440 — outerHTML byte-identical to HEAD's, except Cycling's approved `aria-pressed`.
- **F17 unmoved** — the "Coinbase seizes" e2e's three targets sit above the dock's top (the BTC price path card ends
  ≈ 170 px above it; each "Price & liq" button ≈ 265 px).

### FIRE face (THIRTEENTH Almanac face, batch 1 build 4; one device-local key, NO bump)

A THIRTEENTH face **FIRE** (`◎ FIRE`, `src/components/Almanac/FireFace.tsx` + `.module.css`) — **how many years of
spending the owner's bitcoin and other assets fund if the owner sells to live, on the Almanac's own price paths.** Spec:
`pbloc-spec-batch-1-v1` v0.33–v0.35 §2.3 and the FIRE plan `pbloc-spec-fire-face-v1` v0.2 §4.5–4.6 (its Appendix D and
the batch spec's §1 answers override its body); the plan `Claude outputs/batch-1/build-4-plan.md`, with the go and the
fix-up (v0.35) appended. Build 4b — the deploy gate and the hover box (v0.39–v0.40 §2.3, BL42 and BL41): the plan
`Claude outputs/batch-1/build-4b-plan.md`, with the go appended.
It reads build 3's engine as built (`docs/claude/engines.md` § The FIRE engine — no engine module changed). The sell lane
only: the borrow lane is its own item after Batch 1 (BL42) — its engine change first, since today's engine drops a bill
income can't pay outside the buy zone (spec v0.38) — and until it ships the face is hidden on the public deploy and the
sandbox (F6; Identity, below). No simulation (D1 A′), no chart zoom, no committed price series. Its inputs are one
device-local key (`docs/claude/store.md` § FIRE's own inputs).

- **Identity.** Key `fire`, **appended LAST**, after Decision's pill (`halving` stays first, the default) — **on the
  owner's deploy and in dev only** (build 4b, BL42): the pill shows only where neither `VITE_LANDING` nor `VITE_DEMO` is
  '1', so never on the public deploy or the sandbox (`commercialization.md`'s table), and dev — so the e2e — keeps it.
  One pure rule, `fireFaceOnDeploy` (`src/lib/fireDeploy.ts`, zero imports); the hub reads the two flags once, at module
  scope, into `FIRE_ON_THIS_DEPLOY`, which the pill's entry is spread on — never `hasCbLoan` — and a fallback effect
  reads, as the loan-gated faces' do, so the face is unreachable where its pill is hidden. The face's code still ships
  in every bundle: hidden, not tree-shaken (the C8 branch below is unconditional). Never lift the gate before the
  borrow lane ships.
  ⚠ `renderFace` has an explicit `if (f === 'fire')` branch ABOVE the Converter fallback (the C8 trap); the hub's
  header counts THIRTEEN faces.
- **The files.** `FireFace.tsx` composes: every word, figure and tone comes from `fireFaceView.ts`, and the face writes
  no sentence (I31). `fireReplays.ts` is the replays' one belief crossing (D-3, as `supportPolicyInputs.ts` is the
  support line's). `FireScale.tsx` is wordless. `FireFace.module.css` composes CyclingFace's classes only; its one
  declaration is the doubled `.faceDocked.faceDocked` pair. The fold and the link it needed (the fix-up), and the line
  marks of its legend and hover box (build 4b — `.lineMark` and `.lineMarkDash`: 14 px, a 2 px top border in
  `currentColor`, dashed for a dashed line, after the Decision face's swatch), are classes in `CyclingFace.module.css`
  that it composes, so the compose-only rule stands.
- **What it reads.**
  - **₿ yours today** — the four faces' reads, as the parents' selector has them (`getCurrentBtcHeld()`,
    `advisorActualBlocBalance`, `planCbCollateralOf`, `getCurrentColdBtc()`, `planCbLoanBalanceOf` and the accrual),
    summed as the parents sum them (`openingBtc = strike + CB + cold`, `openingDebt = cbDebt + strikeBalance`), and
    netted by ONE three-argument `deriveOwnership` call in the view (`yoursAt`) at the displayed path's month 0. At no
    stress that is the held anchor, so it equals the Dashboard goal tile's net coins (`netCoinsBtc`) bit for bit at the
    same instant (POSITION ≡ NET COINS). The accrual is memoised on its inputs, as on the parents, so over a long session
    the face's figure lags by the interest accrued since it mounted.
  - **The plan's `income` and `expenses`**, read and never written: a working month saves `income − expenses`, signed (a
    gap is drawn, never floored at 0), and the retirement spending follows `expenses` until one is typed (D5).
  - **Inflation — one field, two editors.** The store's `inflationRate` (device-local), edited here by a `NumberInput`
    (0–10, `save="leave"`) and on the Living tab by its slider; the field says "The Living tab uses this too." Living
    compounds it monthly and FIRE steps it yearly — the model card says so.
  - **The path** — `plConvergencePath(anchorPrice, …)` or `cycleConvergencePath(anchorPrice, …)` from the stress lens's
    held anchor, never the polled quote, then `.slice(0, months)`: 240 prices, months 0–239, at the default horizon. The
    engine's horizon is the path's length, so "lasts through" names month `months − 1` (Sep 2046 from Oct 2026) —
    never "all 20 years". The stress (`applyPathStress`) runs from the inspected month; the month is clamped at render
    (`clampMonth`). The defaults are Decision's: Support, on the line; the reversion preset 48; the inspected month 1;
    the stress 0.35–2.2; the horizon 240 (12–240). The band's name reaches the view as data: the view imports neither
    `powerLaw` nor `controlDockView`.
  - **The history** — `usePowerLawData()` as it is: one fetch a visit, no copy kept.
- **Top to bottom.**
  - The head ("FIRE" · "How many years of spending your bitcoin covers if you sell it to live, on the price path you
    pick."), the path line ("On Support, on the line · Oct 2026 – Sep 2046") and the position in words — or the
    underwater line.
  - **The chart** — "₿ you own and ₿ you'd need": ₿ owned, selling (`rows[m].btc`) and ₿ needed (`rows[m].needBtc`), a
    point a month on a log axis with an explicit domain (`fireChartDomain`, × 0.8 / × 1.25; nothing to draw → "Nothing to
    draw on this path.") and abbreviated ticks. A point with nothing to draw is a GAP (null), never 0 — the Decision
    chart's rule — with a quiet note when a line breaks. The stop month is an amber reference line. The tooltip gives the
    month, both ₿ figures, and the portfolio and price in today's dollars. Each ₿ row is a line (build 4b, BL41): its
    name in the line's colour, after a short mark drawn like it — ₿ owned, selling: solid `--btc`; ₿ needed: dashed
    `--text-secondary`, the box's own text colour, so its mark is what tells it apart — and the dollar rows, which are no
    line, stay plain. The legend line above the chart takes the same marks. One definition of the two lines, `FIRE_LINES`
    (`fireFaceView.ts`: name, colour, dash), is read by the two `<Line>`s, the legend, `fireTooltipLines` (each row's
    `line`, or null) and the Milestones' ₿ owned cell. Under the chart, the scrubber's notes: the
    inspected month, "Anchored $X · spot $Y ±Z%" while the anchor is held, the stress, and — once on the face — "Dollars
    here are today's: each month's figure ÷ inflation since today (2% a year, stepped yearly)."
  - **Six tiles**: Years of spending funded today · You'd need · FI, on this path · From your stop, on this path ·
    Spending that lasts every replay · Break-even growth.
  - **"Stop working"**: At FI · Now · In years — buttons with `aria-pressed`, `disabled` for a viewer (D-1) — and "Years
    from now" (1–20) while In years is on; the spending field ("Follows your plan's monthly expenses ($3,500) until you
    type one."); a folded "Assumptions" (`<details className={styles.fold}>`: the other assets, retirement income, the
    buffer, the two withdrawal rates, the other assets' return, the tax, your average cost, inflation — nine of the
    eleven fields); "Reset to defaults" — `setFireInputs(null)`, never the shared inflation; and the device line ("These
    inputs stay on this device: they don't sync and aren't in a backup — a restore won't bring them back, and "Reset
    local data & re-sync" clears them."). Eleven literal `NumberInput` tags, every one `save="leave"`. The fold is the
    house's (`ColdStorageCard.module.css`'s `.rules`, THIS MONTH's "Why this plan?"): a pointer, the ' ›' marker (' ‹'
    open) and a focus ring. Without them "Assumptions" read as a static label, cursor auto (the fix-up; e2e PILL checks
    the cursor and the marker).
  - **The scale** — "Years of spending funded": `FireScale`, a bar, a you-are-here dot and the need's marks — one at
    equal rates (`btcAdjustedYears === traditionalYears`, bit for bit), two once a bitcoin rate is typed. Every label and
    the `aria-label` come from the view; no borrowed names (F2).
  - **The replays** — "If a 2013, 2017 or 2021 bear began the day you stopped working": a line a cycle ("2013 bear: runs
    out in Jan 2034." · "2017 bear: lasts through Sep 2046."); a bear the horizon ends before its low says so when it
    lasts ("2021 bear: lasts through Sep 2046 — the horizon ends before its low.") and keeps its line when it runs out
    (the follow-ups' F-1); a cycle that didn't replay is named (`'noPeak'`, `'gap'`), never filled. Then the capacity, the
    break-even line and an ⓘ, whose last words are (b′)'s correction, pinned by WORDS: "…a replay can read a little
    milder or a little harsher than on daily prices, and the month it runs out can move by several months."
  - **The Milestones** — a row every 12 months strictly inside the horizon, its last month, and the stop, FI and run-out
    months, flagged "stop", "FI", "runs out". Year · Price · ₿ owned · Other assets · Portfolio · Years funded · ₿ needed
    — "Other assets" (D-2) shows the draw order. The table from 768 px; under it `MilestoneSwitchTable` with
    `MS_VIEWS_FIRE` (₿ · $ · Years). ⚠ The rows are months 0 … `months − 1`: the parents' `m <= horizon` would read
    `rows[months]` and crash, so the bound is `m < n` over the rows' own count.
  - **"How this works"** — the rules in words, "What it leaves out" (build 3's named limits, and the follow-ups' F-3:
    savings and retirement income rise with inflation, so a pension without cost-of-living raises would cover less each
    year) and the credits: FIRE BTC's Compass (a link to `https://calc.firebtc.io/`, never a fetch) and Santostasi's
    power law. The link is `.link`:
    `--text-secondary`, underlined — 12.2:1 on the card, where the browser's default blue was 2.0:1, and 1.7:1 visited
    (the fix-up; e2e PILL checks its colour).
  - **The disclaimer** (amber): "A pattern, not a forecast. These are figures on a path you pick, never a recommendation.
    Not financial advice."
  - **The dock** — Month · Stress · Path (`fireDockTabs`), the face's LAST child, sticky. Month and Stress are live; Path
    is a chip whose panel holds the face-local `PathPicker` (Support · Fair · Resistance · 4-yr cycle), the "On the line" /
    "Back to reverting (4 yr)" chip, the Horizon slider and the 4-yr timing while that path is on. The face has no
    price-path card.
- **The replays and the capacity run from the face's own stop month, held.** The stop is the one `fireTimeline`
  resolved on the displayed path, passed as that number to every replay (`replayPath(path, startDate, stop, …)`) and to
  its timeline and capacity (`{ ...x, stopMonth: stop }`), as `breakEvenGrowth` holds its own. The capacity shown is the
  LOWEST of the three, only when all three replayed (D-5: a missing cycle could be the harshest — 2013 binds in both
  measured households) and each reached its low inside the horizon (the follow-ups' F-1: a cut bear could be the harshest
  too — measured on a synthetic history, every stop in the default horizon's last 13 months read "at least" with a bear
  cut before its low, all three at In years 19), "at least" when the search's top binds (C7). It reads in the owner's
  own spending: the engine searches the buffered spending, so the face shows its figure ÷ (1 + b ÷ 100), "at least"
  included, and with a buffer says "Your N% buffer is kept on top."
  - **The capacity reads the stop first**, in the replays card's order — `capacityOf(r, runs, state, bufferPct)` takes
    the run's result: invalid inputs; then the stop's own states, whatever the history — no stop month ("No stop month
    to replay from.": At FI with FI past the horizon), a stop at or past the horizon's end ("You stop after this horizon
    ends.": In years at 20 on the default 240 months), a working gap that runs it out before the stop ("It runs out
    before you stop working."); then the history's (loading, failed, offline); then a missing cycle; then a cut bear — its
    low, `troughMonth` months after the stop (the leaf's, handed over by `fireReplays.ts` as a plain number), past the
    horizon's last month: stop + troughMonth > months − 1, the ONE predicate `replayRunsOf` sets as each run's `cut`, which
    the capacity and the card's lines read ("The horizon ends before a bear reaches its low." on the tile, "No capacity:
    the horizon ends before a bear reaches its low." on the card); then the lowest. With no spending and a late stop the
    cut words come before "No spending to test.", as a missing cycle's do (the follow-ups' F-1).
    ⚠ With no stop month inside the horizon the face hands `capacityOf` an EMPTY `runs` (`replayPathsAt` returns none).
    Until the fix-up that read as a missing cycle — "The one bear couldn't be replayed from this history." — while the
    card and the other tiles said the right thing. CAPACITY STATES builds the runs as the face does.
- **The history's states.** Loading: "Loading the price history — the replays and the capacity need it." Failed: "The
  price history didn't load, so there are no replays and no capacity this visit." Offline — only when the browser says
  `navigator.onLine === false`, which iOS standalone apps never do, so there it says "didn't load": "Offline — the
  replays need the price history, which isn't kept on this device." Never a carried figure.
- **Zero is never printed.** A dollar, ₿ or years figure that is zero, or would print as zero, prints "—" in tiles, lines,
  the Milestones (the switch table's too) and the tooltip — never "$0", "$0.00", "₿0", "₿0.000" or "0.0 years". Rates
  print as they are, and inputs show what is typed. With nothing owned the years tile says "No bitcoin of your own and no
  other assets to fund it." and the scale "You: nothing funded yet". A little owned is never "nothing owned": under the
  years floor (0.05 years, about 18 days, so the tile's figure is "—") the tile says "Less than a month of spending
  funded." and the scale "You: less than a month" (TINY; the fix-up — the tile had said nothing was owned beside
  "Today: ₿0.030 held"). Underwater: "Your loans are more than your bitcoin is worth at this price: this starts you
  with no bitcoin of your own, the excess repaid from your other assets." BANNED sweeps every word function over
  households that reach zeros in Other assets, ₿ owned, Portfolio and Years funded.
- **The words** — dates from one fixed month table (`fireMonthYear`, never ICU; pinned equal to `futuresView`'s
  `monthYear`, which the view can't import — NO SIM reads the sources' import lines); dollars nominal ÷ the row's
  `inflationStep`; no sentence says "safe", "you can retire", "guaranteed", "should" or "need to".
- **Viewers.** In simple mode a viewer never reaches the Almanac. ⚠ By reading (not run), a TRUSTED viewer can, when the
  owner's synced `simpleMode` is false: AppShell's viewer branch lets Settings and the Almanac fall through, the
  full-mode shell's tab bar and Tools menu have no viewer check, and `planRunWiring.test.ts` already records that a viewer
  opens the Almanac. Older than build 4, and every face is reachable the same way; logged for the owner's viewer item. A
  viewer demoted from trusted to safe keeps its prefs and the old trusted figures. What build 4 did (D-1): the face's
  own buttons are `disabled={s.viewerMode}`; its number fields are already read-only for a viewer.
- **The lists it joined.** `stressAnchor.test.ts` (all five faces), `coldWiring.test.ts` FACES, `milestones.test.ts`
  FACES (`MS_VIEWS_FIRE`, `MS_TABLE`), `supportPolicyView.test.ts`'s view-module walls (`fireFaceView.ts`; the pattern
  widened to `cycleReplays`, `pricePaths` and `'react'`), `numberInputModel.test.ts` SITES (eleven `'leave'`), build 3's
  `fireWalls.test.ts` BELIEF importers (the view, the replays and `lib/fireInputs.ts` — the face itself imports no FIRE
  module), and `decisionWiring.test.ts`'s last pill (now just before FIRE's). Not joined: `resetMirror.test.ts` and
  `controlDockWiring.test.ts`'s PARENTS (Policy-tab and `runCyclingSim`-specific — FIRE's wiring test carries the dock
  and the mirror); `navigation.spec.ts`'s pill list (no face whose fetch isn't stubbed, as for Decision).
- Tests: § Test Suite → "Batch 1 build 4 — the FIRE face" and "Batch 1's follow-ups".

### Milestones on a phone (the three parents' Milestones; store unchanged, NO bump)

Spec: `pbloc-spec-milestones-phone-v1.md` (v1.5). The owner, 2026-10-03: on a phone Cycling's table scrolled sideways
(Debt, Equity and BTC gained off the screen), Strategy's (Flywheel) and Ownership's wrapped Net gain to 4–5 lines, and
Strategy had no Debt or Equity. The rows stay the milestone years (D1). Run 1 (`c8d7a5b`) made each row a block; on the
phone the owner found the blocks "scattered and messy" — no column to scan, every label repeated, 600–1,100 px tall — and
picked **Run 2, the switch table**: one line a year, with a switch above it showing a few of the table's columns at a time.
- **M-I1 — one markup at a time.** Each face renders its table OR `MilestoneSwitchTable`: `const msTable =
  useMediaQuery(MS_TABLE)` (Ownership `MS_TABLE_OWNERSHIP`), the control dock's pattern — never both, never a CSS
  toggle. Where `matchMedia` is missing the hook says `false`: the switch table.
- **M-I2 — the same figures.** `msRows` is built right after each face's `nextTurns`, from the same row fields and the
  same expressions as its table, whose JSX is unchanged: every figure of the row but the year, under its header, in the
  table's column order. Each face's views (`MS_VIEWS_*`, cyclingFaceView) PARTITION its table's columns less Year — every
  column in exactly one view, in the table's order:
  - Cycling — ₿ BTC · Cold (when its column shows) · BTC gained; $ Price · Debt · Equity; LTV Zone · CB LTV;
  - Strategy — ₿ Held · Yours · Net gain; $ Price · Debt · Equity; LTV Zone · CB LTV · Strike LTV;
  - Ownership — ₿ Held · Owed · Yours; Gain Net gain; LTV Zone · Price · CB LTV. Its table has no dollar figure but the
    price, so its middle view is the gain, and the price sits with the LTV it drives.

  The e2e's SAME reads the table, then every view, off ONE page — row for row, character for character; PARTITION checks
  that the views' headers are the table's less Year, each once.
- **M-I3 — the table from 768 px** (the app's tablet line), the switch table under it, on all three faces (R2). Measured:
  Cycling's table needs 561–583 px (three seeds), and its frame is the window − 62 px (simple) or − 102 px (full): 578 /
  538 at 640, 706 / 666 at 768. It fits from about 645 / 685 px, every seed from 700; 768 leaves ≥ 83 px. **Ownership's
  table shows only at 768–919 px**: from 920 px its two-column shell puts the Milestones in a 364–400 px side column,
  where the table wrapped Net gain (it needs 408–434). The switch table shows there too (R1).
- **M-I4 — the fit.** From 320 px, simple and full mode, every view: every header and figure on one line (a flag may
  drop under its year, and break at its hyphen), no two cells' text closer than 3 px, the table inside its card, no
  sideways page. The figures shrink under 390 px (`clamp(10px, 3.2vw, 12.5px)`). Measured on a production build — 320–767
  px × simple / full × three seeds × the default path, the 4-yr path and a deep stress × every view (1,458 cases), and
  Ownership's side column, 920–1440 px (216): 0 problems. The tightest text gap is 8.3 px (Cycling's ₿ view, 320 px, ×10
  seed); the least headroom 4.3 px — Cycling's ₿ view in full mode at 320 px, ×10, in a 218 px frame. At a fixed 12.5 px
  that view ran 6–14 px past its frame.
- **M-I5 — the tables' interactions.** Strategy's and Ownership's rows jump the month (tap, Enter, Space) and the picked
  row is lit, also while focused (`.on.on`); Cycling's are not buttons, like its rows; post-liquidation rows are dimmed
  (0.55, as `msPost`).
- **M-I6 — layout only.** MilestoneSwitchTable reads no store and no engine and writes no word (WORDLESS) — the face
  names the table ("Milestones"), the switch ("Milestones figures"), the year header ("Year") and every view; tokens only.
- **M-I7 — the computer tables unchanged.** Measured: outerHTML byte-identical to `c8d7a5b`'s, 27 of 27 — three seeds ×
  three faces × the default path, the 4-yr path and a deep stress; CSS-module suffixes normalised. (Run 1 gave Strategy's
  table Debt and Equity and the years R5's alignment — § Unified Strategy face.)
- **M-I8 — no engine or store change;** `resetMirror` untouched.
- **M-I9 — the dock's tabs** (Run 1's R3) unchanged.
- **M-I10 — the switch.** One view at a time, the first on open; `aria-pressed` says which; a picked month keeps the view
  (the component's own state — a remount would reset it). Each button's spoken name is its `aria-label` alone: ₿ "Bitcoin",
  $ "Dollars", LTV "LTV, loan to value", Gain "Net gain". A lettered view's name contains its visible text (WCAG 2.5.3,
  Label in Name — a voice-control "tap LTV" must find the button), and no button has a `title` (R7: one equal to the
  name is also exposed as its description, so a screen reader would read the name twice).
- **Ownership's table follows the stress.** Its rows are `sim`'s, the stressed run whenever a stress is on (D3); SAME
  pins it.
- **The turn rows are date-proof in the e2e (D7).** Ownership's default horizon (24 months) can hold no 4-yr turn: from
  5 Oct 2026 the next is 1,064 days (35 months) out. So SAME types 36 months into its Horizon first. The cadence's longest
  wait is under 36 months, and the non-vacuity check fails loudly if it ever changes.
- **R3, folded in (Run 1):** the dock's tab values shrink (`clamp(10px, 3.1vw, 12px)`), and in full mode the dock bleeds
  across `.main`'s padding (`--dock-bleed`) — § Almanac P4 and the dock's "Under 1024 px: tabs" bullet.
- Tests: § Test Suite → "Milestones on a phone".

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
- **`AlmanacConsentSheet.tsx`** (NEW) — one-time consent on FIRST enable (the shared `DraggableSheet`, as
  `EventSheet`): title + the four hosts as mono pills + a green "block height only — no holdings, no
  identity" reassurance + Stay-offline / Turn-on (`--btc`). Confirm → consent+enable; cancel → stays off.
- **`AlmanacView.tsx`** — dropped the static `height`/`mode` props; calls `useChainTip()` ONCE and feeds
  `tip.height`/`tip.mode` to both faces (face switch never refetches — §14.5). Owns the badge tap + consent
  state.
- **Faces (off-mode precision marker, conditional on the existing `mode` prop, no new prop):** HalvingClock
  `.sub2` prepends `~` when estimated + the block-height stat rsub reads `estimate`/`live`; CycleClock's
  block-height stat rsub same; CycleDial's cycle-branch `aria-valuetext` gains the `(estimated)` suffix
  (halving branch already had it).
- **Settings → Display** (one Customization page since BL15) gains an ALMANAC group "Live block height" toggle (canonical entry, owner-only
  block; viewers use the badge) — ON also sets consent (the inline host disclosure satisfies it).
- Supersedes `useMempoolData`, which the Power Law face deleted (spec pbloc-spec-powerlaw-face-v1, D2): its side panel
  fetched mempool.space on every open, even with live height off (F1). Now only `useChainTip` contacts an explorer, and
  only after consent. Test: `src/hooks/__tests__/useChainTip.test.ts` (PROVIDERS parse per shape + guard range).
  Suite 419 → 425.

### Almanac face navigation — TAP-ONLY (the face swipe pager was REMOVED)

Face switching happens **only** by tapping a sub-nav pill, on desktop and mobile alike. The `<SwipeStrip>`
face pager (Gesture P3/P3.1) is GONE, along with everything that existed to arbitrate against it. No
data/store change; `SwipeStrip` itself stays (Calendar + MonthlyLogOverlay still page).
- **`visibleFaces: { key: Face; label: string }[]`** remains the SINGLE source for the sub-nav pill map — now
  the only face-switching surface. Gated faces (defense iff `hasCbLoan`, ledger iff `ledgerFaceAvailable`,
  cycling and strategy iff `hasCbLoan`, FIRE iff `fireFaceOnDeploy` — the owner's deploy and dev) are simply absent
  from the array. Thirteen faces in all; the last is the FIRE face (batch 1 build 4), off the public deploy and the
  sandbox until its borrow lane ships (build 4b — BL42). `idx`/`onPage`/`canPage`/`renderPane`/
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
- **Chart areas carry a MODE-SCOPED `touch-action` (chart zoom).** The zoomable charts (Decision, Power Law) set it
  on their own gesture surface: `pan-y` in Scroll mode (nothing pressed), `none` while Zoom or Pan is pressed. In
  Scroll mode a vertical stroke still scrolls the page; a stroke that starts on the plot and passes 8px more sideways
  than vertical holds the page still so the tooltip scrubs (Z6). This is per chart, not a hub rule — the hub still has
  no touch-action CSS. See § Chart zoom.
- ⚠ Do NOT re-introduce a face pager without re-deriving the chart/edge exclusions and the axis-ownership CSS
  above; the reason each existed is recorded here.
- Tests: `e2e/navigation.spec.ts` (tap the sub-nav title halving→cycle, asserting `Open Halving Clock` has
  count **1** — ⚠ `Next halving` is NOT Halving-only, CycleClock's demoted halving card carries it too, so the
  Cycle-only string at count 1 is what proves a single mounted face; a committed mid-screen horizontal drag
  does NOT change face; gated-face skip by tapping every pill while `!hasCbLoan`; a chart scrub stays on the
  Power Law face; edge-swipe back still works on Almanac). `faceHostBox` was deleted from `e2e/helpers.ts`.

---

