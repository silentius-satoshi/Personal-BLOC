---
paths:
  - "src/lib/nostr/**"
  - "src/lib/planEvents/**"
  - "src/store/**"
  - "src/hooks/useNostr*.ts"
  - "src/hooks/useViewerSync.ts"
  - "src/hooks/usePlanLoad.ts"
  - "src/hooks/useSyncBlocked.ts"
  - "src/simulation/mergeRecords.ts"
  - "src/components/Settings/**"
  - "src/components/Layout/**"
---

# Rules — sync: the plan log, the journal pages, records and the channels

Read first, for what you touch: `docs/claude/nostr.md`, `docs/claude/phase-4.md`.

Each rule's full text — its mechanism, measures and history — is in `docs/claude/rules-in-full.md` § `sync.md`.

| Constraint | Rule |
|---|---|
| `fetchAndSync` return shape | `{ ok, planFound }`, not a boolean. `planFound` is computed from `latestByDTag` BEFORE the decrypt loop and is INDEPENDENT of `ok` — a decrypt failure with events present must stay `planFound: true` |
| The plan log stays inside one publishable event | Compaction keeps the latest event per field FOREVER; a burst (the same field set again within 10 s — `BURST_WINDOW_MS`) keeps only its last event; the history is trimmed OLDEST FIRST until the payload `{"events":[…]}` fits 32 KiB (`PLAN_LOG_BUDGET_BYTES`); the emit compacts (`emitPlanSets`). Never drop a latest; never key compaction on `device` (diagnostics only, never a merge input). Pins: `planLogSize.test` (FOLD-SAFE, CONVERGE), `planLogEmit.test`, the DRAG e2e |
| The journal syncs as pages, and nothing is published past NIP-44's step | Every journal event stays within one padding step of 40,960 B: a page ≤ 32,768 B plain; the manifest and the bridge checked by the guard (`publishEncrypted` refuses past 40,960 B before encrypting — never raise Reconnect for it). The manifest goes out AFTER the pages and lists only the copies the relays hold, plus every listed page this device couldn't read (never drop what you never saw). Every journal event goes out newer than every journal event the device has seen (the `minCreatedAt` floor — never dated by the local clock alone). A pull merges the relays' parts ONCE, into the journal as it is AFTER the fetch (never merge a pre-await copy; never apply or GC a tombstone before that merge). Every pull reads `records:v1`; past the step it carries the stub, never a frozen copy. Pins: `journalSweep.test`, `journalSync.test`, `journalPages.test` |
| Trusted-snapshot key set | `viewerSnapshot.test.ts` carries an EXHAUSTIVE `Object.keys(snap.settings).sort()` assertion — brittle BY DESIGN. Adding a synced setting = a conscious choice to EXPOSE (add the key to the literal) or STRIP (add it to `buildViewerSnapshotPayload`'s destructure). Never paste a key in to make the test green. The trusted snapshot's TOP-LEVEL key set is exhaustive too. Conscious exposes the safe snapshot never carries: top-level `strikeLastDepositISO` and `coldMovedByMonth`; settings' `planGoalNetBtc` and `venueColors` (undefined until the owner chooses, so it travels only then). The viewer raw-sets `viewerColdMovedByMonth` through `coldMovesFromSnapshot` (a month ≥ 1, a finite number, or dropped) |
| A safe snapshot wipes first (BL48 — the downgrade item) | `applyViewerSnapshot`'s safe branch runs `clearViewerData()` BEFORE it sets the safe block: a viewer demoted from trusted keeps nothing of the owner's — figures, journal-derived values, goal, cold moves, colours. `clearViewerData` keeps only the layout prefs. `applyViewerSnapshot` is exported for the e2e and is a no-op off `viewerMode` — an owner device never takes a viewer snapshot over its own plan. It fails closed: a payload that isn't an object, or a trusted one without the plan (`trustedSnapshotOk` — the settings' four figures, start date and loan flag, the records' entries; what an older owner's may lack, the right kind when there), is refused — wiped, then thrown — before any of it applies; one that still throws part-way wipes and rethrows: never a loaded device with its safe block cleared. A figure beyond the plan that a snapshot lacks keeps the device's own; a revocation is checked first and never refused. Pins: `viewerSync.test.ts` (DEMOTE, COLD, OWNER), `clearViewerData.test.ts` (WIPE, CLOSED, SHAPE), `e2e/viewerAlmanac.spec.ts` (DEMOTE, SAFE) |
| `publishRecords` cadence | Immediate via `publishRecordsNow` (no debounce); NOT triggered by `setMonthlyLog` |
| Records merge | Records receive is MERGE-based and unconditionally safe (`mergeRecords`); `recordsDirty` = publish-needed marker + merge tie-breaker ONLY (not a receive gate); `lastRecordsSyncAt` = observability only |
| The plan is event-sourced; only the prefs are LWW | The plan syncs as events on `plan-events:v1` (union-by-id + fold; absent = seed, empty = an event). Only the 5 prefs (`prefs:v1` — `venueColors` the fifth, undefined until a device chooses, so it never travels) are whole-object last-write-wins, so only single-writer device-taste belongs there |
| `settings:v1` is retired (4e) | Never publish or read it: no app code names it (RETIRED's code-only grep — `persistConfig.ts`'s strip of the three retired keys is the one allowed hit). A trusted viewer's snapshot applies through `applyViewerSettings` (`VIEWER_SETTINGS_FIELDS` — never narrow it to the prefs); a `prefs:v1` through `hydratePrefs` (PREFS_FIELDS). Never re-add a skip-guard in `applyPlanFold` or in `sync.ts`'s plan branch — an empty roster and `DEFAULT_RELAYS` are legitimate events. Pins: ROSTER peer, ROSTER pull, RELAYS defaults |
| The dirty-gated retry never starts an unlock | `scheduleDirtyRetry` arms on `syncDirty({ recordsDirty, planDirty, prefsDirty, pendingRevocations })` AND needs `authenticated` (the hook's `isAuthenticated`, in the effect's deps). Pins: RETRY locked, "RETRY waits for the unlock" |
| Nostr reliability fix | Foreground/launch NIP-46 signer rebuild (`restoreSigner`, throttled ~20s inside `syncNow`) + merge-based receive + immediate records publish + decrypt-failure `nostrReconnectNeeded`; no migration (`updatedAt?` optional, `deletedMonths` defaults `{}`) |
