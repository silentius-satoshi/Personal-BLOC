---
paths:
  - "src/store/**"
  - "src/lib/storeVersion.ts"
  - "src/lib/backup/**"
  - "src/lib/store/**"
  - "src/lib/planEvents/**"
  - "src/hooks/useBtcPrice.ts"
  - "src/components/Inputs/InputsPanel.tsx"
  - "src/components/CoinbaseLoan/CoinbaseLoanSidebar.tsx"
  - "src/components/LivingOnBitcoin/LivingInputsPanel.tsx"
  - "src/components/Advisor/AdvisorSidebar.tsx"
  - "src/components/Settings/**"
---

# Rules — the store's migrations

Read first, for what you touch: `docs/claude/store.md`, `docs/claude/build-deploy.md` (its store-version bump discipline).

| Constraint | Rule |
|---|---|
| Zustand v7 migration | Removes `customCollateral`; seeds `advisorActualBtcHeld` from it as fallback; adds `cbPaymentStrategy/TriggerPct/TargetPct` with defaults |
| Zustand v8 migration | Adds `btcPriceMode: 'live' \| 'manual'` (default `'live'`); typing a BTC price flips to `'manual'`; LIVE/SYNC button restores `'live'` |
| Zustand v9 migration | Adds `lastRecordsSyncAt` (seeded from old shared `lastSettingsSyncAt`) + `lastLocalChangedAt`; independent per-d-tag watermarks |
| Zustand v10 migration | Adds `nostrLogin` (JSON NIP-46 login) for session restore across reload |
| Zustand v11 migration | Adds `MonthlyLogEntry.btcHeld` (absolute) + `expensesActual`; resets `advisorActualBtcHeld` to month-0 baseline. The dated-collateral change (spec v4) ships WITHOUT a bump: `collateralAdjustment?` is optional and `pendingCollateralAdjustment` defaults via shallow merge |
| Zustand v15 migration | Adds `writerKeyWrapped`/`writerKeyWrapMeta` (writer local-key signer — AES-GCM ciphertext + WrapMeta, default `?? null`); additive shallow-merge, no transform. **Device-local, NEVER synced** (not in `SETTINGS_FIELDS`/payload). `nostrSigningMethod` gains `'local'`. **(Later moved OUT of the persist blob into STANDALONE localStorage** `personal-bloc-writer-key-wrapped`/`-meta` — they unlock the encrypted store, so can't live inside it; seeded at module init + back-filled once from the legacy in-blob location; partialize-excluded. The migrate row falls back to the standalone seed, not null.) |
| Zustand v16 migration | Adds `advisorMonthStartBalance` (start-of-month BLOC balance — projection base, distinct from live-drawn `advisorActualBlocBalance`); default `persistedState.advisorMonthStartBalance ?? persistedState.advisorActualBlocBalance ?? 0` (mid-month installs seed from the current live balance; fresh = 0). SYNCED (in `SETTINGS_FIELDS`/payload — real strategy state). Inert since the plan of record's Run 3 (no screen runs the projection; the key stays) |
| Zustand v17 migration | Adds Viewer Access Phase-2 fields `viewerMode` (default `?? false`), `viewerWriterPubkey`/`viewerSecretKey` (default `?? null`) — additive shallow-merge, no transform. **Device-local, NEVER synced** (not in `SETTINGS_FIELDS`/payload/partialize-exclusion). `viewerSecretKey` was plaintext (wrapped at rest in v18) |
| Zustand v18 migration | Viewer Access **Phase 3** — adds `viewerKeyWrapped`/`viewerKeyWrapMeta` (wrapped-at-rest viewer key: AES-GCM ciphertext + `WrapMeta`, default `?? null`) — additive shallow-merge, no transform. **Device-local, NEVER synced.** **Back-compat: LEAVES any existing plaintext `viewerSecretKey` in place** (wrapping needs a Face ID gesture, impossible in migrate — the one-time wrap-setup screen clears it). Transient `viewerUnlocked` (not persisted). |
| Zustand v20 migration | **Collateral-Truth Consolidation (C-P2)** — Strike collateral becomes reading-anchored. **Strips** `pendingCollateralAdjustment` (added to the destructure so it can't ride `...rest`). **Seeds** `strikeCollateralBtc` = the old-math current position from the RAW blob BEFORE stripping: `(rawLast?.btcHeld ?? advisorActualBtcHeld ?? 0) + pendingCollateralAdjustment` — CACHE-SEED ONLY (no synthetic dayLog event; clean journals). No legacy `balanceReading` carries `strikeCollateral` → `deriveStrikeCollateral` returns the fallback = seed → `getCurrentBtcHeld` is byte-identical pre/post. `advisorActualBtcHeld` STAYS (synced; historical chain + fallback). **Determinism residual:** un-converged `pending` across devices at migrate time seeds divergent caches (not synced) until the first `strikeCollateral`-bearing reading re-anchors both — self-correcting (pending is normally 0). |
| Zustand v21 migration | **Multi-viewer M1** — the sharing roster (`viewers: ViewerSlot[]` + `nextViewerIndex`) REPLACES the 5 single-viewer scalars (`viewerNpub`/`viewerPubkey`/`viewerLabel`/`viewerPrivacyTrusted`/`viewerKeyVersion`). **Clean-cut, NO back-compat** (the only existing viewer was a test key): the migrate destructure STRIPS the 5 old keys so a stale value can't ride `...rest`, and unconditionally seeds `viewers: []` + `nextViewerIndex: 0` (the owner re-adds viewers fresh). `ViewerSlot = { index (stable, monotonic, never reused), pubkeyHex, npub, label, tier: 'safe'|'trusted', keyVersion }`. Setters `addViewerSlot`/`updateViewerSlot`/`removeViewerSlot` (each `syncSettingsToNostr`). Both fields in `buildSettingsPayload` + `SETTINGS_FIELDS` (count 39 → **36**); STRIPPED from the trusted viewer snapshot + the plan backup; `hydrateSettings` skip-guard (empty incoming roster never clobbers a populated local one, mirrors the relay guard — retired at 4e: an empty roster is a plan event). `buildViewerSnapshotPayload` tier now reads `viewers[0]?.tier` (M1 slot-0 single-viewer; M2 = per-viewer d-tag fan-out). Components (SharingPage/DevPanel/ViewerPreview) TEMPORARILY operate on `viewers[0]` until the M3 roster UI. Current store version = 21 |
| Zustand v19 migration | **Daily Mode P2a** — backfills legacy `monthlyLog` entries with `source:'manual'`/`confirmed:true` (only where undefined); adds `dayLog` (`?? []`, LOCAL-only) + `cbLtvAction` (`?? 'paydown'`). **C2 seed:** a `hasCbLoan` user with a `cbCollateralBtc` gets ONE seeded `cbCollateralReading` into dayLog so `deriveCbCollateral` reproduces the pre-migration value; then `cbCollateralBtc = deriveCbCollateral(dayLog, persisted)`. `migrate`/`partialize` were EXTRACTED to exported `migrateState`/`partializeState` (unit-testable — the persist API is unavailable under Node) |
| Zustand v14 migration | Adds `showPlanIncomeBar`/`showPlanStrikeBar`/`showPlanCbBar` (Simple Mode plan-card bar toggles, default `?? true`); additive shallow-merge, no transform. Device-local (NOT synced). (Intervening v12/v13 bumps preceded this.) |
| Zustand v12 migration | Adds `cbRotateBackPct` (default 55, reverse-rotation gate) — additive optional-default (`?? 55`), `...rest` carries everything else; in `SETTINGS_FIELDS`/settings payload (synced like trigger/target). Inert since the plan of record's Run 3 (no reader; the key stays) |
| Zustand v13 migration | Adds `cbLoanBalanceAsOf`/`cbLiquidationPriceAsOf` (ISO date, default null) + `strikeLiquidationLtvPct` (default 85) — additive shallow-merge defaults (`?? null` / `?? 85`), no transform; all three SYNCED (in `SETTINGS_FIELDS`/payload — the `asOf` markers must travel atomically with their already-synced values). Current store version = 13 |
