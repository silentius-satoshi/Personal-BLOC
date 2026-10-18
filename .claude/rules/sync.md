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

| Constraint | Rule |
|---|---|
| `fetchAndSync` return shape | `{ ok, planFound }`, not a boolean. `planFound` is computed from `latestByDTag` **before** the decrypt loop and is INDEPENDENT of `ok` — a decrypt failure with events present must stay `planFound: true`, or an unreachable signer fires the "no plan found on this key" notice at a user whose plan is sitting right there |
| The plan log stays inside one publishable event | Compaction keeps the latest event per field FOREVER; a burst (the same field set again within 10 s — `BURST_WINDOW_MS`) keeps only its last event; the history is trimmed OLDEST FIRST until the payload `{"events":[…]}` fits 32 KiB (`PLAN_LOG_BUDGET_BYTES`, a full NIP-44 padding step under 40,960 B — past it the event goes out over a 64 KiB relay limit); the emit compacts (`emitPlanSets`), so the stored log stays small on every device. Never drop a latest (the fold reads only the latest per field), and never key compaction on `device` (diagnostics only, never a merge input). Pinned by `planLogSize.test` (FOLD-SAFE, CONVERGE), `planLogEmit.test` and the DRAG e2e |
| The journal syncs as pages, and nothing is published past NIP-44's step | Every journal event stays within one padding step of 40,960 B: a page ≤ 32,768 B plain, the manifest and the bridge checked by the guard (`publishEncrypted` refuses past 40,960 B before encrypting — never raise Reconnect for it). The manifest goes out AFTER the pages and lists only the copies the relays hold, plus every listed page this device couldn't read (never drop what you never saw). Every journal event goes out newer than every journal event the device has seen (the `minCreatedAt` floor — never publish a replaceable journal event dated by the local clock alone). A pull merges the relays' parts ONCE, into the journal as it is AFTER the fetch (never merge a pre-await copy; never apply or GC a tombstone before that merge). Every pull reads `records:v1`; past the step it carries the stub, never a frozen copy. Pinned by `journalSweep.test` (the kill criterion), `journalSync.test`, `journalPages.test` |
| Trusted-snapshot key set | `viewerSnapshot.test.ts` carries an EXHAUSTIVE `Object.keys(snap.settings).sort()` assertion — brittle BY DESIGN. The sibling deep-equal is only DIFFERENTIAL, so a newly-synced field would leak to every trusted viewer and still pass. Adding a synced setting = a conscious choice to EXPOSE (add the key to the literal) or STRIP (add it to `buildViewerSnapshotPayload`'s destructure). Never paste a key in to make the test green. The trusted snapshot's TOP-LEVEL key set is exhaustive too (`strikeLastDepositISO` joined it in the plan of record's Run 2 — a conscious expose of one date, D9); the safe snapshot never carries it |
| `publishRecords` cadence | Immediate via `publishRecordsNow` (no debounce); NOT triggered by `setMonthlyLog` |
| Records merge | Records receive is MERGE-based and unconditionally safe (`mergeRecords`); `recordsDirty` = publish-needed marker + merge tie-breaker ONLY (not a receive gate); `lastRecordsSyncAt` = observability only |
| The plan is event-sourced; only the prefs are LWW | The plan syncs as events on `plan-events:v1` (union-by-id + fold; §6 — absent = seed, empty = an event). Only the 4 prefs (`prefs:v1`) are whole-object last-write-wins — the last publisher wins the whole object, so only single-writer device-taste belongs there (the checklist died for this) |
| `settings:v1` is retired (4e) | Never publish or read it: no app code names it (RETIRED's code-only grep — `persistConfig.ts`'s strip of the three retired keys is the one allowed hit). A trusted viewer's snapshot applies through `applyViewerSettings` (`VIEWER_SETTINGS_FIELDS` — never narrow it to the prefs, F1); a `prefs:v1` through `hydratePrefs` (PREFS_FIELDS). Never re-add a skip-guard in `applyPlanFold` or in `sync.ts`'s plan branch — an empty roster and `DEFAULT_RELAYS` are legitimate events (ROSTER peer / ROSTER pull / RELAYS defaults pin it) |
| The dirty-gated retry never starts an unlock | `scheduleDirtyRetry` arms on `syncDirty({ recordsDirty, planDirty, prefsDirty, pendingRevocations })` AND needs `authenticated` (the hook's `isAuthenticated`, in the effect's deps). Behind the LocalUnlockGate a tick would run `syncNow` → `restoreSigner` → WebAuthn with no tap — since iOS 17.4 Safari allows that, so a Face ID sheet would rise on its own. Pinned by RETRY locked + "RETRY waits for the unlock" |
| Nostr reliability fix | Foreground/launch NIP-46 signer rebuild (`restoreSigner`, throttled ~20s inside `syncNow`) + merge-based receive + immediate records publish + decrypt-failure `nostrReconnectNeeded`; store stays v11 (no migration — `updatedAt?` optional, `deletedMonths` defaults `{}`) |
