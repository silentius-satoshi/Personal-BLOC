# The viewer, sharing and the owner's IA — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

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
    recoverable (2 unknowns, 1 equation). (The plan of record's Run 4, D9: `thresholds` gains `cbLimitAtSupport` — the
    plan's Coinbase limit at support — and `safety` gains `cbLtvAtSupport`, Coinbase's LTV at the snapshot day's
    support or null, and `cbAtSupportLevel`, the owner's verdict on it; no new top-level key. Together the two Coinbase
    ratios give price ÷ support, never the debt or the collateral — `safetyAtSupport.test.ts`, VIEWER — except one bit:
    the verdict, and whether a ratio is sealed at all, follow the 50¢ dust floor, so within 50¢ of the limit, or on a
    debt under 50¢, they say which side of 50¢ the position is — spec v1.20 §16.3.)
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
  gauge.) (Run 4, D9: `cbLtvAtSupport` passes unscaled — it is the snapshot day's reading — and `cbAtSupportLevel`
  folds into `overall'`; with no ratio it reads `'safe'`.)
- **Owner control — the C-safe/C-trusted tier.** ⚠ **SUPERSEDED at Multi-viewer M1:** the global
  `viewerPrivacyTrusted` boolean is GONE — the tier is now **per-viewer** (`ViewerSlot.tier: 'safe'|'trusted'`,
  default `'safe'`, part of the synced `viewers` roster). `buildViewerSnapshotPayload(s, tier)` branches on the
  explicit `tier` param (M2 — the fan-out passes each `slot.tier`; M1's `viewers[0]` read was removed). The roster is STRIPPED from the snapshot in BOTH
  branches (safe has no settings; trusted's strip is now `viewers`/`nextViewerIndex`/`nostrRelays`) AND from the
  **plan backup** (`exportPlan.ts`). SharingPage's tier `<Toggle>` calls `updateViewerSlot(index,{tier})` +
  `publishViewerSnapshotNow()` so a mode flip reaches the viewer at once.
- **Viewer hydrate (`viewerSync.ts` `applyViewerEvent`, after the `revoked` check):** `privacyMode==='safe'`
  → `setViewerSafeSnapshot({safety, thresholds, btcPriceAtSnapshot, hasCbLoan})` + `viewerDataLoaded` +
  `viewerLastSyncAt`, **NO applyViewerSettings/records/strike** (4e; was hydrateSettings); trusted/absent → clear the safe snapshot, then
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
  injectedSafeSnap : storeSnap` pick. (Run 4, D7 / D9: the hook adds today's support to the trusted inputs —
  `supportToday(todayLocalISO())`, the clock read kept out of the pure core — and `computeViewerSafety` returns
  `cbAtSupport`: live, with the support price, on the trusted path; the snapshot's ratio, with no price, on the safe
  path; null with none. The CB card's sub-line — here and on the owner's Dashboard — adds `cbAtSupportLine`: whole
  dollars on the trusted path, no price on the safe one, nothing from an older snapshot — and, since Run 4.1 (BL29),
  "over" or "within" in words, by the level: the snapshot's `cbAtSupportLevel`, the owner's verdict, on the safe path.)
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

