# Formatting, inputs, tokens, motion, chart zoom, mobile — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

## Dollar Formatting

```typescript
// Shared — exact, no sign
export const fmtUSD = (n) => '$' + Math.round(Math.abs(n)).toLocaleString();

// SummaryBar LOCAL — sign-preserving (NEVER replace with shared fmtUSD)
function fmtUSD(n) { return (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString(); }

// Chart Y-axis — abbreviated (exact causes label overlap)
(v) => v >= 1e6 ? '$' + (v/1e6).toFixed(1) + 'M' : v >= 1000 ? '$' + Math.round(v/1000) + 'k' : '$' + v

// THIS MONTH, Daily and Daily's sheets — to the cent, through ONE cached formatter (the plan of record's Run 2.1, BL19)
const USD_CENTS = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtUSDCents = (n) => '$' + USD_CENTS.format(Math.abs(n));

// A dollar VALUE kept to the cent — for a figure that seeds what gets stored (sign-off seeds, the minimum's estimate)
export const toCents = (n) => (Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0);
```

Which screen prints through which formatter: § Critical Constraints ("THIS MONTH, Daily and Daily's sheets print dollars
to the cent").

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

`prefix` (e.g. `'$'` or `'₿'`) renders before the number. `suffix` renders inside the input — **avoid suffix for BTC amounts** (cursor issues). Omit `decimals` to let user type freely. Use an external label or hint for units instead. Suppresses the `value → raw` re-sync while focused (fixes mid-type clobber on high-decimal fields like BTC amounts). **Every field says how it saves — `save`, a required prop (BL35; `ui/numberInputModel.ts`):**

- `'button'` — a figure read off Strike or Coinbase (the four dated setters, Coinbase's collateral reading, Strike's collateral reading). Typing saves nothing; once a readable figure is typed, "Save — dated today" and Cancel appear under the field. Save, or Enter, saves it once — even unchanged, since its save dates it (the reconciliation); Cancel restores it. Leaving the field keeps the typing and its buttons; leaving the page drops it.
- `'leave'` — a plan setting: a field of the synced plan, or the manual BTC price. Typing saves nothing; leaving the field, or Enter, saves it once — and the app going away with the field focused saves what was typed, the edit going on (F-2d-1).
- `'live'` — a draft or a what-if (the Log sheet's and the Safety card's fields, each with its own Save; the Scenario levers; the what-if collateral; the mining override), and the read-only dry-powder field: each keystroke hands a readable, non-negative figure on.

Leaving, Enter and Save go through ONE rule, `numberCommit`: nothing unless the owner typed since the field took focus (a `'button'` field holding typing: since its last Save or Cancel), never the figure it already shows (a `'button'` field aside), clamped to `[min, max]`; untouched or unreadable, the field shows its current value again — a value synced in while it had focus is shown, never overwritten, and a held figure keeps its text. Before BL34–BL35 every blur re-saved the shown figure and every keystroke saved its partial: a click in and out re-dated a dated figure (F-2c-1 — Coinbase's balance and liquidation price dropped their interest since entry); writers that do more than save (a price switches the app to a manual price, Coinbase's collateral logs a journal reading, the Log sheet's Strike collateral marks itself touched) fired on a mere focus-and-leave; and Coinbase's collateral logged a journal reading per keystroke. `numberInputModel.test.ts`'s SITES pins each field's mode.

**Leaving the page (F1, BL34–BL35):** React runs no `onBlur` for a field it unmounts, so a page closed from code must blur the focused field first, as a tap on "← Back" does — or a typed `'leave'` field (and the goal field, which also saves on leaving) goes unsaved. `EdgeBackGesture` blurs before a committed swipe's `onBack()` and before its forwarded tap's click: neither a touch swipe nor that click moves focus (measured with a real touch stream — a mouse drag's mousedown blurs the field itself). A held `'button'` figure is dropped with the page, as designed. Pinned by `numberInputModel.test.ts` (GESTURE) and `e2e/numberFieldSwipe.spec.ts`.

**Leaving the app (F-2d-1, build 2e):** going away isn't leaving the field. On the owner's iPhone, a plan setting typed and then left by a switch to another app was lost once iOS closed the app: no React `onBlur` ran — React listens for `focusout`, and the app going away sends the field none (WebKit's loss of page focus sends it a bare `blur`, by its source; the phone showed only that no save ran). So a focused `'leave'` field saves what was typed, by `numberCommit` (`awaySaves`), when the window loses focus (the app switcher) or the page turns hidden (`visibilitychange`: the Home Screen, another app) — and the edit goes on: the field keeps its text and its typed mark, so the owner comes back to it as he left it, and leaving it afterwards saves only a figure typed since (`numberCommit` never re-saves the figure the field shows). Ending the edit there instead — rewriting the field's text, as leaving does — put an emptied field's old figure back under the caret: cleared, away and back, then 4200 typed, it read "40004200" and saved $40,004,200 (measured on build 2e's first prototype; its plan review's finding B). The two signals, should they come together, save once. With the default plain storage the write reaches `localStorage` in the same task; with at-rest encryption on (the DevPanel's flag, off by default) it follows an encrypt. A partial figure is saved as typed so far: the app going away is leaving, as a desktop tab switch already is. A typed `'button'` figure keeps its typing and its Save — dropped if iOS closes the app, as leaving the page drops it. The goal field and `SliderInput`'s edit box also save only on leaving, and not when the app goes away (older; logged). Pinned by `numberInputModel.test.ts` (MODES, WIRING, AWAY) and `e2e/numberFieldAway.spec.ts`, which plays the app's side as WebKit does and counts saves by their events' ids.

---

## Design Tokens

```css
--orange: #E8836A  --green: #4ECB82  --red: #E8504A  --amber: #F0A030
--bg-app / --bg-base (both #09090E, darkest)  --bg-card #111318 (slightly lighter)  --bg-input  --bg-hover
--text-primary / secondary / ghost / muted / faint  --border
/* Daily Mode P4a (mode-toggle-preview.html) — layered surfaces + accents, additive: */
--surface #0e1219 / --surface-2 #151b25 / --surface-3 #1c2431  --line / --line-2 (translucent white borders)
--btc #f7931a (bitcoin accent, distinct from --orange)  --mono (mono font stack)
--coinbase #0052FF (the Coinbase venue's default, read through --venue-coinbase — the design system's only brand-colour token)  --maroon #8B3A3A (CycleClock low/floor marker)
--maroon-lift #AE7575 (the Almanac 4-yr cycle path — --maroon lifted 30% toward white: 5.00:1 on --surface; raw --maroon is 2.47:1)
/* BL15 (Customization) — the venue tokens every venue mark reads; Settings → Customization sets a chosen colour on :root: */
--venue-strike var(--text-primary) / --venue-coinbase var(--coinbase) / --venue-cold var(--btc)
/* Gesture & Motion System P0 — springs as duration+easing pairs (CSS transitions AND WAAPI): */
--motion-fast 120ms / --motion-standard 200ms / --motion-settle 320ms
--ease-standard / --ease-decelerate (cubic-beziers)  --ease-spring / --ease-spring-soft (linear() spring curves)
```
`--bg-base: #09090E` (= `--bg-app`) is defined in `tokens.css` — it had been referenced in 25 places across
15 files but never defined (resolved transparent: 23 `background:` uses masked by the dark app bg, 2
`color:` uses = invisible dark-on-bright button text in SafetyDashboard, both fixed by the one definition).

**Venue palette — ONE convention: the venue tokens (BL15).** Every mark that stands for a venue reads
`--venue-strike`, `--venue-coinbase` or `--venue-cold` — the venue bars and dots in
`src/components/Viewer/VenueBar.module.css`, `src/components/Almanac/OwnershipFace.module.css` and
`src/components/Almanac/CyclingFace.module.css`, the faces' Strike, Coinbase and Cold lines with the limits drawn in their
venue's colour, the plan's venue map (`planMonthView`'s `VENUE_COLOR` — THIS MONTH's and Daily's dots and venue words), the
cold totals and the rows of the charts' shared hover box — never `--text-primary`, `--coinbase` or `--btc` directly (what
keeps its own colour: `.claude/rules/ui.md`, the venue colours). **One change reaches all of them** — they read the same
three tokens. They default to Strike white (`--text-primary`), Coinbase blue (`--coinbase`) and cold storage orange
(`--btc`); Settings → Customization changes them (`lib/venueColors` — the swatches and THE rule: at least 3:1 on the four
surfaces a venue mark sits on — `--bg-app`, `--bg-card`, `--surface`, `--surface-2`, the hover box moved there from
`--surface-3`, where Coinbase's blue reads 2.7:1 — at least CIEDE2000 20 from another venue's colour and 10 from green,
amber and red, a venue's own default exempt from that last test; it runs in the picker, the store's setter and at the
sink). `--coinbase` is still the design system's only brand-colour token; the bar for adding a second is the same argument
made for it (a venue read, not a level colour — no lender rule defines a venue threshold, so a green/amber/red on a
composition bar reads as a risk verdict it doesn't have).

**Chart colours — one colour per concept across faces** (Power Law polish D1, P5, P6):
- **The concepts:** Support `--green`, Fair `--btc` and Resistance `--amber` (the faces' PATH_META), and History
  `--btc` (the Decision chart's history area).
- ⚠ **The one exception — Fair on the Power Law chart is `--text-secondary`.** There all four are drawn at once, over
  the same months. Fair would collide with History outright, and `--btc` and `--amber` are only ΔE 10.8 apart. Every
  other pair is ≥ 41 apart. Neutral is also what this chart always drew Fair in.
- **Every series line clears 3:1** on `--surface` (green 9.1 · btc 8.2 · amber 8.7 · text-secondary 12.2).
- **Dashes (P5):** dashed means Resistance on the Power Law chart, and a modeled path on the Decision chart. History,
  Fair and Support are solid on both.
- **Quiet text (P6):** both zoom charts' tick labels and the chart empty state are `--text-muted` (5.3:1). The other
  eight charts, the Power Law subtitle and its disclaimer (`--text-ghost`, 2.0:1) wait for the queued cross-chart
  contrast pass.

**Motion vocabulary (Gesture & Motion System P0):** springs (`--ease-spring`/`--ease-spring-soft`, `linear()`
approximations, Safari 17.2+) belong on anything that *moved under a finger* (sheets, swiped rows); beziers
(`--ease-standard`/`--ease-decelerate`) on anything that merely *appears* (fades, scrim). `transform`/`opacity`
only — no layout property is animated. A global `@media (prefers-reduced-motion: reduce)` block in `global.css`
collapses all CSS transitions to 80ms cross-fades (was 1-of-78 modules; now one global policy); the JS side reads
`useReducedMotion` to snap finger-tracking motion between rest states. Gestures still FUNCTION under reduced motion.

**The web font — IBM Plex Mono, self-hosted (5e, E1, called A):** `src/styles/fonts.css`, imported by `global.css`, holds
six `@font-face` rules of our own — extended Latin and Latin, each at 400, 600 and 700, woff2 only, `font-display: swap` —
pointing at `@fontsource/ibm-plex-mono`'s files (pinned at exactly 5.3.0; SIL OFL 1.1). Each face carries its subset's
`unicode-range`, copied from the package's `unicode.json`, so a face is fetched only for what it draws: the app's only
extended-Latin character is ₿ (U+20BF). Never the package's ready-made CSS (its per-subset files carry no range; its
per-weight files bring every subset, about 65 KiB more). The build emits the six files with hashed names and the
precache takes them (`vite.config.ts`' woff2 glob), so the font works offline; no request goes to Google, and Google's
hosts left `vercel.json`'s CSP. Characters in no subset (→ ⚠ ∞ Σ Δ) fall back to the system font, as they did with
Google. Pinned by `src/styles/__tests__/fonts.test.ts` and e2e `startup.spec.ts` (E1 FONTS).

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
  FRESH `ts=Date.now()` — and `at`, the ts it was first logged with, so it keeps its place in its day (Hotfix 1, A2-3) —
  and strips the `deletedDayEvents` tombstone (mirrors add/delete's cache/reroll/publish tail).
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

## Chart zoom (shared, view-only — the Decision chart + PowerLawChart; store unchanged, NO bump)

bitbo's Plotly zoom on the two dates × log-price charts — the Decision face chart and `PowerLawChart` (a full-mode tab
and an Almanac face) — through ONE shared piece: the pure helpers `lib/chartZoom.ts`, the thin hook
`hooks/useChartZoom.ts` and the frame `ui/ChartZoomFrame.tsx`. Spec `pbloc-spec-chart-zoom-v1.md` (through v1.11). It stays on
Recharts: Plotly's smallest build is ~1.2 MB against a ~2 MB offline precache, and it would look like no other chart.
**VIEW ONLY** — no store, engine or sync change, and no number shown anywhere changes. Per mount, session only: a face
or tab switch resets it.

**The model.**
- The view is two domains `{ x, y }`. Each axis is AUTO (`null` — it follows the chart's own full extent, HOME: `xExtent`
  / `chartDomain` on Decision; the first and last row × `[0.01, 1e8]` on PowerLaw) or PINNED. Reset = both auto. A
  dates-only box pins x and leaves y alone (Plotly's behaviour).
- **The reach** — how far zoom-out and pan may go — is separate from home. A chart passes it to the hook (a memo); it
  defaults to home. The Decision chart's price reaches $0.01–$10M (bitbo's), its dates' reach is home; PowerLaw passes
  none (its home is already $0.01–$100M).
- All the math runs in SCALED space (identity on a linear axis, `ln` on a log one), so +/−, pan, pinch and the clamp are
  one code path on both axes, and the price axis works in log space by construction.
- **The clamp (`normalizePins`), every render:** the reach always contains home (the union, axis by axis). Raise a pin's
  span to the minimum (90 days, ×1.1 on price); a span at or above the reach's IS the reach — AUTO when the reach is home
  (so data shorter than the minimum is auto, never a pin wider than the data — Z3a); then SHIFT the pin inside the reach
  — never clip it, so it keeps its zoom level; a pin back at home (home's span, at home's place, within FULL_EPS) is
  AUTO. With the reach equal to home this is the old clamp bit for bit — the cap line is the old one, and everything
  under it is the old arithmetic (a frozen-oracle sweep pins it, ⭐26). The hook derives the
  clamped view at render and writes it back in an effect with a TOLERANT compare (the `clampMonth` pattern — a log→exp
  round trip moves the last bit, and an exact compare would write back forever).
- **When the data changes under a zoom:** a pinned axis stays put and is clamped into the new reach (which contains the
  new home); an auto axis follows the data. A path, reversion-window, horizon, stress or live-price change keeps the window (so paths compare in one
  frame); Reset or a double-click brings the full view back.

**Gestures — computer.** Zoom is the default mode on `(pointer: fine)`, and a mouse drag always draws a box unless Pan
is pressed (a mouse can't scroll by dragging).

| Input | Zoom (default) | Pan |
|---|---|---|
| Drag inside the plot | A box, shaded outside; release zooms. Plotly's dragbox rule: `dy < min(max(0.6·dx, 8), 20)` → dates only (nothing under 8px); `dx < min(0.6·dy, 20)` → price only; else both. The tooltip, its cursor and the active dots hide from the arm until the next mouse move (Z17) | Pans both axes, clamped to the reach |
| Drag starting on an axis label | nothing | nothing |
| Esc during a drag | cancels it | cancels; the view snaps back |
| Double-click | reset | reset |
| Wheel / trackpad scroll | scrolls the page (no wheel listener) | same |
| Toolbar — Zoom · Pan · + · − · Reset (Z9, pinned) | in the chart card's title row, right-aligned, always visible — one layout on every device, never over the plot (Z18; the old fine-pointer overlay covered the end of the modeled path). Zoom is the resting mode, and **Pan is a toggle — click it again to go back to Zoom** (Z15; clicking the pressed Zoom keeps Zoom). + and − scale ×2 about the centre (log space on price) — − goes past home to the reach; Reset (home) is disabled until zoomed | |

**Gestures — phone (the iOS PWA).** Nothing is pressed by default ("Scroll"); the toolbar sits in the card's title row,
as on a computer (Z18), so the chart box no longer grows for it (Decision 280px, Power Law 360px; the title wraps to two
lines beside it — three or four below about 375px, Z25), and Zoom / Pan are toggles.

| Input | Scroll (default) | Zoom pressed | Pan pressed |
|---|---|---|---|
| One-finger vertical drag | scrolls the page, as before. A stroke that starts more vertical than sideways is never held, even if it turns sideways | draws the box | pans |
| One-finger sideways drag | moves the tooltip. **Z6:** once a stroke that started on the plot passes 8px more sideways than vertical, the page holds still until the finger lifts, even with a wobble | draws the box | pans |
| Tap | the tooltip at that date | same | same |
| Double-tap | reset | same | same |
| Two-finger pinch | zooms about the fingers. An axis scales only if the fingers started ≥ 40px apart along it (a sideways pinch zooms dates only); moving both fingers pans. A second finger hands a scrub over to the pinch. No tooltip, cursor or marker during it, and none after the lift until a fresh touch moves or a tap (Z17) | same | same |
| After a box | — | Zoom un-presses itself (one-shot), so the next drag scrolls | Pan stays until tapped again |
| Swipe from the left edge | back — the 20px zone sits above the page and the plot starts ~80px in | same | same |

**How it's done.**
- `touch-action` follows the mode on the gesture surface (`div.area`): `pan-y` in Scroll (the page scrolls, horizontal
  strokes still reach recharts' tooltip, and there is no native pinch or double-tap zoom), `none` in Zoom / Pan.
- One-finger box and pan: pointer events, window listeners once a gesture starts, capture on ARM (never at
  pointerdown), rAF-batched; the box is drawn by direct style writes, never a React render per frame.
- 🔴 **The `touchmove` is the ONE non-passive listener** (the DraggableSheet precedent), scoped to the chart area. It
  calls `preventDefault()` only while two fingers that started on the chart (`targetTouches`) pinch, or under a Z6
  sideways scrub — and only while `e.cancelable` (once the page has taken a touch it is let go). `touchstart` /
  `touchend` / `touchcancel` are passive: **a touchstart is NEVER cancelled**, so taps always reach the tooltip and the
  double-tap reset. A `gesturestart` preventDefault guards against WebKit's own page pinch.
- **Z6 — the scrub lock.** The decision is the pure `lockAxis(dx, dy)`: `null` under 8px (it may still be a tap — the
  tap rule's and the drag's arm threshold), `'x'` when more sideways than vertical, else `'y'` (a perfect diagonal
  scrolls). Only a Scroll-mode stroke that starts on the plot, with one finger on the screen, is tracked. `'y'` lets go
  (the page scrolls, as before); `'x'` cancels every remaining cancelable touchmove. A scrub is not `dragging`, so the
  tooltip shows throughout. **Why it exists (Z13):** the owner's device check — made on the chart BEFORE chart zoom,
  which set no `touch-action` at all — found a sideways scrub's vertical drift scrolling the page, so the chart slid
  away. `pan-y` arrived with chart zoom, and whether WebKit's `pan-y` alone holds the page is untested: the lock exists
  because `pan-y` alone isn't guaranteed. The stroke, like `drag` and `pinch`, lives in the gesture effect's closure —
  one per chart (Z11).
- **The pinch lands its last move at release (Z14)**, as the drag does: each move records the fingers, and the release
  applies them itself — a lift before the next frame would otherwise drop the final move with the queued frame.
- **The toolbar's mode rule (Z15)** is the pure `nextMode(cur, pressed, fine)`: an unpressed button selects its mode;
  pressing the pressed one returns a computer to Zoom, its resting mode (so Pan is a toggle and the pressed Zoom
  stays), and a touch device to Scroll (`null`). `pressMode` only calls it — a wiring check pins that.
- Double-tap is detected on `pointerup` (each tap < 250 ms and < 8px; two within 300 ms and 30px); a mouse uses the
  native `dblclick`.
- 🔴 **Z1:** `.plot`, `.box` and `.note` are `pointer-events: none`. They paint above the SVG, so without it recharts
  gets no hover and no tap and the tooltip dies on both charts (the Decision smoke's hover step proves it).
- **Z17 — quiet gestures.** recharts draws its active dots off its OWN `isTooltipActive` (never the Tooltip's `active`)
  and follows `changedTouches[0]`, so a pinch drew two markers jumping between the fingers, and the tooltip popped back
  under the last finger when `dragging` cleared. Now the hook's `quiet` is set at a drag's arm and a pinch's start and
  NEVER cleared by the gesture's end; the chart passes `active={zoom.quiet ? false : undefined}` to its Tooltip (box and
  cursor) and `activeDot={!zoom.quiet}` to every series. It wakes only on the first `touchmove` of a touch that started
  ALONE (a second finger clears `wake`, so a pinch's leftover finger can't) or on a `mousemove` — a computer's mouse,
  and the compat mousemove a TAP sends after touchend, which is how a tap shows the tooltip at all. Never at touchstart:
  recharts still holds the old finger's place until the tap's mousemove, so a wake there would flash the old tooltip.
  Both wake events are Continuous-priority in React 18, so `setQuiet(false)` and recharts' own update land in ONE render
  — the tooltip's first frame is at the finger.
- **No slide (Z23):** each Tooltip carries `isAnimationActive={false}` (recharts' default glides the box 400ms from its
  last place) AND `wrapperStyle={{ transitionProperty: 'none' }}` — under Reduce Motion the global rule gives every
  element an 80ms transition on `all`, which would still slide it.
- "Double-click to zoom back out" / "Double-tap…" shows ONCE per app session (a module flag), then fades. Once the view
  leaves home (a zoom out or a pan past it — `leavesHome`) it says "…to reset the view" instead: a double-tap then zooms
  back IN.

**The axis labels re-flow.**
- Dates — `timeTicks(domain, tickDensity(plotWidth))`: the finest of 1 mo · 3 mo · 6 mo · 1 y · 2 y · 4 y · 8 y with
  `span / step ≤ density`, where `density = max(6, ⌊plotWidth / 100⌋)`. At density 6 it IS the old `yearTicks` for every
  span over 6 years (a frozen-oracle sweep pins it). Ticks sit on UTC month / 1-January starts; `fmtTimeTick` formats
  from a fixed month table (Node's ICU prints "Sept"), and the first visible tick carries its year.
- Price — `logTicks` is d3-scale's `log.ticks` ported (a differential test against recharts' own vendored d3 proves the
  unzoomed axis unchanged). `priceTickFormatter` keeps each chart's own formatter unless its labels would repeat, or a
  positive tick would read as zero (Z3b — never "$0.00" for $0.004); then it adds decimals.
- Deliberate unzoomed differences: Decision shows 1-year labels for spans ≤ 6 years, and on a desktop the next-finer
  step just past a `yearTicks` threshold; PowerLaw's dates are UTC 1-January starts (they were arbitrary weeks, labelled
  in local time); both X axes gain `allowDataOverflow`, which recharts needs to narrow a domain.

**⚠ Known limit (Z4, Z5).** Zoom shows only the points each chart already carries — Decision's history is
stride-downsampled to ≤ 800 points (about weekly) and PowerLaw's rows are weekly — so a 3-month window is coarse: about
a dozen points. Per-view resampling is a possible follow-up, and it must keep zoom out of the data memos. But the source
itself is 4-day (blockchain.info returns one point every 4 days), so per-view resampling could at most double today's
detail; daily detail would need another source.

**Adoption recipe (for the other eight Recharts charts).** A numeric X axis; `useChartZoom(full, scales[, reach])` called
once, with a memoised NON-NULL full extent (and, optionally, a memoised reach); `domain={zoom.view.x}` /
`domain={zoom.view.y}` plus `allowDataOverflow` on BOTH axes; explicit `ticks`; `<Customized component={zoom.probe}/>`;
the Tooltip's `active={zoom.quiet ? false : undefined} isAnimationActive={false} wrapperStyle={{ transitionProperty:
'none' }}`; `activeDot={!zoom.quiet}` on EVERY series; the chart wrapped in `ChartZoomFrame`, inside its own memoised
component, and `<ChartZoomToolbar zoom={zoom}/>` in the card's title row (a 32px-min-height row: the label, then the
toolbar); recharts' rule — no fragments around conditional children. Then add the file to `ADOPTERS` in
`chartZoomWiring.test.ts`.

**Tests.** `src/lib/__tests__/chartZoom.test.ts` (each ⭐ names the mutation that turns it red) and the source-reading
`src/components/ui/__tests__/chartZoomWiring.test.ts` (the recipe per adopter — the quiet, no-slide Tooltip, every
series' `activeDot`, the toolbar in the title row; VIEW ONLY — `zoom` reaches no data memo, and the eight
`buildChartSeries` arguments stand; zero imports in `chartZoom.ts`; exactly ONE `passive: false`, on the touchmove; every
touch listener states its `passive:`, touchstart's `true`; the lock goes through `lockAxis(`; `pressMode` goes through
`nextMode(`; quiet outlives the gesture; one toolbar layout; every clamp passes the reach; Z1's three rules; Z9's
order), plus five e2e — the Decision zoom smoke (with Z18's box and title row), the Z6 synthetic-touch test (its pinch
lifts in the same task as its last move, so it proves Z14 too), the Z17 pinch test, the price-reach test and the Z18
computer test — and the Power Law drag test's zoom, STEADY and title-row assertions (see § Build & Deploy → E2E).
**The iOS device gate stays mandatory** — Chromium can't
prove the arbitration: (1) a vertical scroll that starts on each chart is smooth (if not, pinch moves to Zoom/Pan-only —
decision 1's fallback); (2) a sideways drag moves the tooltip and the page stays still, even with a wobble, while a
vertical start still scrolls; (3) a pinch zooms the chart, never the page; (4) a double-tap resets and a tap shows the
tooltip; (5) Zoom is one-shot after a box; (6) Pan pans and toggles off; (7) the edge swipe goes back in every mode;
(8) the toolbar in each card's title row is tappable; (9) a pan at full history stays smooth; (10) the seam and
inspected-month hairlines behave after a zoom; (11) a pinch shows no markers, and no tooltip after the lift — a fresh
tap shows it at the tap, with no slide; (12) on the Decision chart, − and a vertical pinch-out reach $0.01–$10M, Pan
plus a drag moves the price up to $10M, the note reads "Double-tap to reset the view", and Reset returns the fitted
view; (13) the chart box doesn't jump when the history loads.

---

## Mobile Responsive

- Tab bar: `overflow-x: auto`, short labels ≤640px
- All tables: wrapped in `overflow-x: auto; -webkit-overflow-scrolling: touch`. The three parents' Milestones are a
  switch table under 768 px — one line a year, a few columns at a time (§ Milestones on a phone)
- 4-col grids (Tier, Strategy): `overflow-x: auto` container, keep 4 cols
- 3-col grids (Mining): same
- CB Loan stat grid: 2-col at ≤640px
- AppShell's `.main`: `padding: 20px` at every width (≤640px adds only `overflow-x: hidden; min-width: 0`); the tools'
  own `.main` compose toolContainer's 16px sides
- `[data-active-tab="bloc"] .sidebar`: `overflow: hidden; padding: 0` (InputsPanel handles internally)

---

