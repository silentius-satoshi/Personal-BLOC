---
paths:
  - "src/store/**"
  - "src/lib/storeVersion.ts"
  - "src/lib/fireInputs.ts"
  - "src/lib/backup/**"
  - "src/lib/store/**"
  - "src/lib/planEvents/**"
  - "src/hooks/useBtcPrice.ts"
  - "src/hooks/useLivePrice.ts"
  - "src/hooks/useClock.ts"
  - "src/lib/liveFeed.ts"
  - "src/lib/liveBtc.ts"
  - "src/components/Inputs/InputsPanel.tsx"
  - "src/components/CoinbaseLoan/CoinbaseLoanSidebar.tsx"
  - "src/components/LivingOnBitcoin/LivingInputsPanel.tsx"
  - "src/components/Advisor/AdvisorSidebar.tsx"
  - "src/components/Settings/**"
---

# Rules — the store's migrations

Read first, for what you touch: `docs/claude/store.md`, `docs/claude/build-deploy.md` (its store-version bump discipline).

Each rule's full text — its mechanism, measures and history — is in `docs/claude/rules-in-full.md` § `store.md`.

| Constraint | Rule |
|---|---|
| Zustand v7 migration | Removes `customCollateral`; seeds `advisorActualBtcHeld` from it as fallback; adds `cbPaymentStrategy/TriggerPct/TargetPct` with defaults. `cbPaymentStrategy` is inert (no component reads or writes it); the key stays |
| Zustand v8 migration | Adds `btcPriceMode: 'live' \| 'manual'` (default `'live'`); typing a BTC price flips to `'manual'`; LIVE/SYNC button restores `'live'` |
| The live price (BL64) | ONE feed for the app (`lib/liveFeed.ts`, wired in `lib/liveBtc.ts`): one Coinbase socket — the batch feed while the app is on screen, the per-second feed only while held (`holdPerSecond`) — at most one price a second on screen, the REST price when it is silent, closed while hidden. The saved `btcPrice` is written only there, by the old rule (a 0.1% move or 60 s, live mode only), weighed on the slow snapshot alone — at most once in ~10 s (v1.1); `useBtcPrice` keeps its ~10 s cadence; AppShell holds the feed with `useLiveFeedHold()` and reads nothing, and holds `useLocalDay()` — the open screen re-drawn when the local day turns, and only then; a screen that ages a figure as it draws keeps its own clock (`useNow`: the Emergency Console's stale banner) (v1.1); the socket sends only its subscribe/unsubscribe for BTC-USD. Pins: `liveFeed.test.ts`, `liveWiring.test.ts`, `useClock.test.ts`, `e2e/livePrice.spec.ts` |
| Zustand v9 migration | Adds `lastRecordsSyncAt`; independent per-d-tag watermarks |
| Zustand v10 migration | Adds `nostrLogin` (JSON NIP-46 login) for session restore across reload |
| Zustand v11 migration | Adds `MonthlyLogEntry.btcHeld` (absolute) + `expensesActual`; resets `advisorActualBtcHeld` to month-0 baseline. `collateralAdjustment?` is optional (no bump) |
| Zustand v15 migration | Adds `writerKeyWrapped`/`writerKeyWrapMeta`: device-local, NEVER synced (not in `SETTINGS_FIELDS`/payload). `nostrSigningMethod` gains `'local'`. Both live OUT of the persist blob, in STANDALONE localStorage `personal-bloc-writer-key-wrapped`/`-meta`: seeded at module init, back-filled once from the legacy in-blob location, partialize-excluded; migrate falls back to the standalone seed, not null |
| Zustand v16 migration | Adds `advisorMonthStartBalance` (start-of-month BLOC balance, not the live `advisorActualBlocBalance`), default `advisorMonthStartBalance ?? advisorActualBlocBalance ?? 0`. SYNCED (in `SETTINGS_FIELDS`/payload). Inert (no screen runs the projection); the key stays |
| Zustand v17 migration | Adds `viewerMode` (`?? false`), `viewerWriterPubkey`/`viewerSecretKey` (`?? null`): device-local, NEVER synced (not in `SETTINGS_FIELDS`/payload/partialize-exclusion) |
| Zustand v18 migration | Adds `viewerKeyWrapped`/`viewerKeyWrapMeta` (the viewer key wrapped at rest, `?? null`): device-local, NEVER synced. LEAVES any plaintext `viewerSecretKey` in place (the one-time wrap-setup screen clears it). `viewerUnlocked` is transient (not persisted) |
| Zustand v20 migration | STRIPS `pendingCollateralAdjustment` (in the destructure, so it can't ride `...rest`). SEEDS `strikeCollateralBtc` from the RAW blob BEFORE stripping: `(rawLast?.btcHeld ?? advisorActualBtcHeld ?? 0) + pendingCollateralAdjustment` — a cache seed ONLY (no synthetic dayLog event); `getCurrentBtcHeld` is byte-identical pre/post. `advisorActualBtcHeld` STAYS (synced) |
| Zustand v21 migration | The roster (`viewers: ViewerSlot[]` + `nextViewerIndex`) REPLACES the 5 single-viewer scalars (`viewerNpub`/`viewerPubkey`/`viewerLabel`/`viewerPrivacyTrusted`/`viewerKeyVersion`). Clean-cut, NO back-compat: the migrate destructure STRIPS the 5 (so a stale value can't ride `...rest`) and unconditionally seeds `viewers: []` + `nextViewerIndex: 0`. `ViewerSlot = { index (stable, monotonic, never reused), pubkeyHex, npub, label, tier: 'safe'|'trusted', keyVersion }`. Setters `addViewerSlot`/`updateViewerSlot`/`removeViewerSlot`. Both fields in `buildSettingsPayload` + `SETTINGS_FIELDS`; STRIPPED from the trusted viewer snapshot + the plan backup. Current store version = 21 |
| Zustand v19 migration | Backfills legacy `monthlyLog` entries with `source:'manual'`/`confirmed:true` (only where undefined); adds `dayLog` (`?? []`) + `cbLtvAction` (`?? 'paydown'`). A `hasCbLoan` user with a `cbCollateralBtc` gets ONE seeded `cbCollateralReading` in dayLog so `deriveCbCollateral` reproduces the pre-migration value; then `cbCollateralBtc = deriveCbCollateral(dayLog, persisted)`. `migrate`/`partialize` are the exported `migrateState`/`partializeState` (unit-testable) |
| Zustand v14 migration | Adds `showPlanIncomeBar`/`showPlanStrikeBar`/`showPlanCbBar` (`?? true`): device-local (NOT synced) |
| Zustand v12 migration | Adds `cbRotateBackPct` (`?? 55`), synced (in `SETTINGS_FIELDS`/settings payload). Inert (no reader); the key stays |
| Zustand v13 migration | Adds `cbLoanBalanceAsOf`/`cbLiquidationPriceAsOf` (ISO date, `?? null`) + `strikeLiquidationLtvPct` (`?? 85`); all three SYNCED (in `SETTINGS_FIELDS`/payload — each `asOf` must travel atomically with its value) |
| `fireInputs` is device-local — in no sync, backup or viewer field list | The FIRE face's inputs: ONE store key, plain `set`, in the blob via `partializeState`'s `...rest` (so encrypted at rest with it when that is on, removed by `wipeLocalPlanData` on an identity forget, reset to defaults by "Reset local data & re-sync"). In none of `SETTINGS_FIELDS`, `VIEWER_SETTINGS_FIELDS`, `PREFS_FIELDS`, `PLAN_EVENT_FIELDS`, nor any payload (`buildSettingsPayload`, the backup, either snapshot tier): never syncs, untouched by a restore, never reaches a viewer. Every reader goes through ONE rule, `fireInputsOf` (`lib/fireInputs`), memoised on the stored object — never once a render (the lens reset would fire every render); a missing, junk or out-of-range field reads its default; no default leans hopeful. No store version bump. Pins: `fireInputsStore.test.ts` (LEAK, LISTS, SETTER, RESTORE, WIPE), `fireInputs.test.ts` (READ RULE, DEFAULTS), `fireWiring.test.ts` (STABLE), the characterization |
