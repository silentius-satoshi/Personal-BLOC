# The event-sourced plan (Phase 4) — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

## Event-Sourcing Migration — Phase 4 (plan-events campaign; store unchanged, NO bump through 4e — Phase 4 COMPLETE)

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
  | `personal-bloc:settings:v1` | write-through BRIDGE (fold output) | published-not-read-as-authority on a migrated device; **RETIRED at 4e** — nothing publishes or reads it |
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
    (NO event; **residual: a fresh key verified pre-auth never syncs the attestation as an event — healed by any
    authed re-verify; gate semantics unaffected** — 4e widens it, F14, below), its authed stamp emits. **5a:** the
    set stores `compactPlanEvents([...log, ...newEvents], Date.now())` — the log is compacted as it grows, so a drag
    leaves one event per field on every device (5a, below).
  - **Engine (`syncEngine.ts`):** `publishPlanEventsNow` (gate + Fix A → compact → `setPlanEvents` → publish →
    success: THE BRIDGE `void publishSettingsNow()` [chains the viewer fan-out] + `checkPlanParity` — at 4e the
    chains run here directly);
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
  - ⚠ **NOTHING deleted at 4c:** `syncSettingsToNostr` (caller-less), `settingsDirty`, Fix C/D, the three
    hydrateSettings skip-guards, `lastSettingsSyncAt` + its apply-gate all stayed as rollback insurance — all
    retired at 4e (below).
- **4d** (SHIPPED): the read path was already v2-first structurally at 4c (plan-events branch first + the
  settings:v1 strip). 4d INSTRUMENTS the v1 fallback: `lastV1FallbackApplyAt` (device-local, unix seconds) is
  stamped ONLY in the settings:v1 branch's empty-log `else` (the un-stripped apply — the genuine fallback); the
  strip path / prefs branch / plan-events branch stamp nothing. A device stamps ONCE while its log is empty (its
  migration/join pull; genesis then fills the log in the same syncNow), then never again (the strip fires). The
  4e soak clock STARTS at this release: fence only after `lastV1FallbackApplyAt` shows no post-migration stamps
  for ≥1 week AND parity stays OK. DevPanel PLAN EVENTS gains a `v1 fallback` row (never=green / stamped=amber);
  the fallback + guard class are deleted together at 4e (done — below). No behavior change, no store bump.
- **4e** (SHIPPED — the bridge stops; **Phase 4 COMPLETE**; spec `bitbloc-spec-4e-bridge-stop-v1` v1.3):
  `plan-events:v1` is the only plan channel. Nothing publishes or reads `settings:v1`; its stale copies stay on the
  relays, inert (no tombstone). Store unchanged (v21, NO bump).
  - **Deleted** — the 4c "NOTHING deleted" list:
    - the bridge: `publishSettingsNow` + `scheduleSettingsPublish` + its debounce + **Fix D** (the publisher's seed
      sentinel); `SETTINGS_DTAG` + `publishSettings`;
    - `syncSettingsToNostr` + **Fix C** (no dirty before the pull);
    - `settingsDirty`, `lastSettingsSyncAt`, `lastV1FallbackApplyAt` + their setters. ⚠ `partializeState` names the
      three in its omit destructure: with no bump `migrateState` never runs, and `merge` spreads a pre-4e blob's copies
      back into memory, so the first write after the upgrade sheds them (the one allowed hit of RETIRED's grep);
    - `hydrateSettings` and its three skip-guards: **Option C**'s relay guard, the roster guard, the backupVerifiedAt
      latch;
    - `sync.ts`'s settings branch: **Fix B** (the first-pull relaxation), the DUAL-READ STRIP, the 4d stamp;
    - genesis: `synthesizeGenesisEvents`, `pickPlanFields`, syncNow's block, `sawPlanEvents` / `sawSettingsV1`
      (`fetchAndSync` returns `{ ok, planFound }`).

    The names are apart: Fix A (no publish before the first pull) · Fix B (the first-pull hydrate relaxation) · Fix C
    (no dirty before the pull) · Option C (the relay guard) · Fix D (the seed sentinel). Only **Fix A** remains —
    `initialSettingsPullDone` (name historical) gates the plan and prefs publishes.
  - **Kept:** `buildSettingsPayload` / `SETTINGS_FIELDS` (45 keys since the plan of record's Run 1 added six plan fields
    on `plan-events:v1` with no bump — the trusted viewer snapshot and the plan backup);
    `checkPlanParity` (the emit layer's tripwire) + DevPanel's parity row; `nextPlanEventTs` / `makePlanEventId`
    (`genesis.ts` keeps its name).
  - **The bridge's two chains moved:** `publishPlanEventsNow`'s success runs `void publishViewerSnapshotNow(); void
    flushViewerRevocations();` then `checkPlanParity()`.
  - **Two RAW appliers replace `hydrateSettings`** (no event, no dirty): `hydratePrefs` (PREFS_FIELDS — the
    `prefs:v1` apply) and `applyViewerSettings` (`VIEWER_SETTINGS_FIELDS` = SETTINGS_FIELDS − `VIEWER_SNAPSHOT_STRIP`
    [viewers, nextViewerIndex, nostrRelays, backupVerifiedAt, coldStorageBtcAsOf] = 40 keys (34 at 4e; the plan of
    record's six joined — a conscious EXPOSE, D9) — the trusted viewer
    snapshot). ⚠ Never narrow the viewer's apply to the prefs (F1): every trusted viewer would show the seed, or frozen
    figures, while the mocked viewer tests stay green — `viewerSettingsApply.test.ts` pins it on the REAL store.
  - **The retry** (`useNostrSync`) arms on `syncDirty({ recordsDirty, planDirty, prefsDirty, pendingRevocations })`
    (F2: since 4c it watched `settingsDirty`, which nothing set, so an offline plan edit had no retry), and **never on
    a locked device** (G1): `scheduleDirtyRetry` takes `authenticated` (the hook's `isAuthenticated` — subscribed, in
    the effect's deps), so a tick can't reach `restoreSigner` → Face ID with no tap behind the LocalUnlockGate (iOS
    17.4+ runs WebAuthn without a gesture). `triggerSync` is NOT gated — the focus / visibility / online triggers on a
    locked device are a separate queued item.
  - **The latch, the roster and the relays flow only as plan events:** no path emits a null `backupVerifiedAt` (the
    teardown clear is RAW; the one emit sits after the null return); an empty roster is an event (§6) and a peer
    folding it ends empty; a folded `DEFAULT_RELAYS` (Restore defaults) replaces a custom list. ⚠ Never re-add a
    skip-guard in `applyPlanFold` or in `sync.ts`'s plan branch.
  - **Settings → SYNC reads "Plan synced"** (`lastPlanEventsSyncAt`, unix seconds). DevPanel's "settings sync" and
    "v1 fallback" rows are gone; Copy Diagnostics carries `planSync`.
  - **DevPanel → PLAN EVENTS → "log gaps"** (G2 — `lib/planEvents/coverage.ts` `planLogGaps(events, live, seed)`): the
    PLAN_EVENT_FIELDS absent from the fold whose live value differs from the seed (`useStore.getInitialState()` —
    zustand 5.0.13's persist returns the pre-hydration state). "none" in green, the names in amber, "n/a (viewer)" in
    viewerMode; names only. Parity can't see such a field (fold-present keys only), and after 4e a new device or an
    escape-hatch reset rebuilds the plan from the fold alone, so the field would come back as its seed. **Read it on
    each existing owner device right after the deploy, before any new device or escape hatch** (smoke step 0).
    Expected: none, or `backupVerifiedAt` (F14) / `nostrRelays` (discovered relays stay device-local). Any other name:
    re-save that field once so it emits — for `nextViewerIndex`, add a viewer slot and remove it. A name a re-save
    doesn't clear → stop (no new device, no escape hatch) until it's understood.
  - **Residuals (accepted, documented):**
    - restore from words: an account whose relays hold only pre-4c state (`settings:v1`, no plan events) gets its
      records back but neither its plan nor its prefs, and if its relays hold only that one event it reads "no plan
      found" (F6; the window: C1 2026-07-11 → 4c 2026-07-12);
    - prefs come back only where a `prefs:v1` exists: genesis never emitted prefs, so an account migrated at 4c whose
      prefs were never edited since gets seed prefs on a new device or after an escape hatch (G7);
    - the pre-auth backup stamp (onboarding's quiz-pass) rides no channel until an authed re-verify, so a peer shows no
      "Backed up ✓" chip (F14 — before 4e a joining device could still get it through `settings:v1`); a peer's gate is
      satisfied by its provenance, so the cost is the chip;
    - a sparse plan log (a skipped genesis — RISK-4 — or `nextViewerIndex` from the M1 07-06 → 4c 07-12 window):
      visible as DevPanel's log gaps (above).
  - **Tests:** `bridgeRetired.test.ts` (the relay layer mocked — G3), `viewerSettingsApply.test.ts`,
    `coverage.test.ts`, plus LIVE three, IGNORED, ROSTER pull and RETRY locked; 32 mutations + X-PARITY-ORDER
    (§ Test Suite). The 4a lock document is in neither the repo nor the project (F12) — this section is the
    authority. Tag `v4e-fence` on the merge (the rollback anchor; BitBooks' PB-0 fork point when it restarts, BL7).
- **5a — the plan log's size** (spec `pbloc-spec-plan-log-size-v1` v1.1, BL10 — option A of the plan-of-record spec's R5;
  store unchanged, NO bump). The problem: every slider notch was a plan event and compaction kept superseded events 90
  days, so two 3-second drags (45,188 B) pushed the ONE plan event past NIP-44's 40,960 B padding step — out at ~66 KB,
  over a 64 KiB relay limit, failing every retry until the history aged out.
  - **The burst rule** (`compact.ts`, `BURST_WINDOW_MS` 10,000): a superseded event whose field's NEXT event, in (ts, id)
    order, follows within 10 s is a burst's middle and is dropped (exactly 10 s is a burst, 10,001 ms two edits). A drag
    keeps its last value; a 5-second rest is still one burst; a same-ts tie keeps the (ts, id) winner; an AsOf pair keeps
    one event per field at one ts. ⚠ Device-blind: `device` is never a merge input.
  - **The budget** (`PLAN_LOG_BUDGET_BYTES` 32,768): after the burst and 90-day rules the history is trimmed OLDEST FIRST
    until the payload `{"events":[…]}` (the log + 11 bytes) fits — a full padding step under 40,960 B, so the plan goes
    out near 44 KB at most. A latest is never trimmed; if the latests alone are over (hundreds of viewers), every latest
    stays and all the history goes.
  - **The emit compacts** (`syncSlice.ts`): `emitPlanSets` stores `compactPlanEvents([...log, ...newEvents], Date.now())`
    in its one atomic set — a drag never grows the stored log, on every device, including one that never publishes. The
    max-ts event is a latest, so the next emit's ts still advances. The pull (union) and the restore (`applyPlanBackup`)
    are unchanged; the next emit or publish compacts.
  - **DevPanel:** sizes are judged by the plain bytes (`lib/nostr/payloadSize.ts` — `--orange` past 32,768 B plain,
    `--red` past 40,960 B; the 60,000 B wire budget only without a plain size); PLAN EVENTS gains a live "log size" row.
  - **Mixed versions:** a device on an older build keeps bursts and can republish them (the pull's repair) until it loads
    the new build — it can only do what it did before; an updated device's next emit or publish compacts. No step moves a
    fold.
  - **5b** — fixed: the journal syncs as monthly pages (§ Phase 4 → 5b).
  - **Tests:** `planLogSize.test.ts` (13), `planLogEmit.test.ts` (6), `payloadSize.test.ts` (3), the DRAG e2e; 19
    mutations (§ Test Suite → 5a).
- **5b — the journal's size** (spec `pbloc-spec-journal-pages-v1` v1.1, BL11 — option A; store unchanged, NO bump). The
  problem: `records:v1` sent the whole journal as ONE NIP-44 event, and the journal only grows — past 40,960 B of plain
  JSON the event goes out at ~66 KB, which a stock strfry relay (every default relay runs strfry) refuses; the owner's
  journal read 30,896 B on 2026-10-07, about 25 days of headroom at a log a day.
  - **Pages** (`journalPages.ts`): one replaceable event per calendar month, `records:v2:<YYYY-MM>` (`.2`, `.3` … past
    32,768 B plain — greedy, the commas counted; `undated` for a date that isn't `YYYY-MM` or `YYYY-MM-…`), its items in
    a fixed order. The **manifest** (`records:v2:manifest`) lists every page — its item count and a fingerprint (16 hex
    of SHA-256 over its canonical JSON) — and carries both tombstone maps: the completeness oracle and the commit marker.
  - **The publish** (`publishRecordsNowImmediate`, in ONE lane with the pull — `journalState.ts`): before the session's
    journal pull, `records:v1` only, and `recordsDirty` stays set; after it, `publishJournal` — the pages whose
    fingerprint differs from the relays' copy, one at a time (a relay or signer failure stops the run before the
    manifest: Reconnect, dirty kept), then the manifest if it changed (the relays' copies, plus every listed page this
    device couldn't read — never drop what you never saw), then the bridge. Every journal event goes out newer than
    every journal event the device has seen (`minCreatedAt` = `known.seenAt + 1`), so a device whose clock runs behind
    still lands. `recordsDirty` clears only if the four collections are still the published references.
  - **The pull** (`pullJournal`): `fetchAndSync` asks for four d-tags; `records:v1` and the manifest skip
    `applyRemoteEvent` and are read as ONE unit — then the listed pages whose fingerprint differs (every listed page on
    the session's first pull: the full check), one query and ONE retry. The parts become one state (`unionParts` —
    tombstones not applied) and merge ONCE through `mergeRecords`, unchanged, into the journal as it is NOW (read again
    after the fetch; no await before the apply). A listed page the relays didn't return is republished from this
    device's copy, or carried in its manifests. If the next publish would write anything: `recordsDirty` + the repair,
    queued behind the pull. With no manifest (a pre-5b journal), v2 is first written when `records:v1` no longer
    carries this device's journal, or at the next journal write — a pull alone never writes a dozen pages.
  - **The bridge:** `records:v1` carries the whole journal while its JSON is ≤ 40,960 B, else the stub
    `{ …empty, movedTo }`, written once (a frozen copy would bring back a deleted entry once its tombstone aged out).
    Every pull still reads it: a pre-5b app writes only there. Retiring it is a later item (4e's pattern).
  - **Live:** the sub gains the manifest's d-tag (pages aren't subscribed); a journal event schedules one journal pull,
    debounced 1.5 s; this device's own echo is skipped by id (`ownLatestEventId`).
  - **The guard** (`syncGuard.ts`): `publishEncrypted` refuses a payload past 40,960 B plain before it encrypts or
    signs (`PayloadTooLargeError`), on every channel. It is not a signer problem: no Reconnect (`refusedForSize`,
    syncNow's "TOO LARGE"), the channel's dirty flag clears, and the app says it in plain words — "⚠ Too large to sync"
    (AppShell) and Settings › SYNC's notice (`useSyncBlocked`, `SyncTooLargeNotice`).
  - **DevPanel:** JOURNAL (pages · the largest page · the manifest · the v1 bridge · the last relay check · carried ·
    too large), RELAY LIMITS → Probe (`relayLimits.ts`), the size rows "records v1" / "journal page" / "journal
    manifest", Copy Diagnostics += `journal`; PUBLISH ACKS keeps 30.
  - **Mixed versions:** the pre-5b app reads and writes `records:v1` — the whole journal while it fits; past the step it
    reads the stub (merges nothing, keeps its own) and a stock relay refuses its own publish, as before. Its first pull
    on the new build is a full check.
  - **Residuals:** a page another device publishes just before this device's manifest stays unlisted until that device
    syncs again; a page every relay drops comes back at the next session of a device that holds it. Neither loses
    anything. The relays now see which months have entries and each month's size.
  - **Tests:** `journalPages.test.ts` (17), `journalSync.test.ts` (17), `journalSweep.test.ts` (⭐ SWEEP — the kill
    criterion), `relayLimits.test.ts` (3), `syncTooLargeNotice.test.tsx` (1), and the two d-tag pins; 26 mutations
    (§ Test Suite → 5b).
- **5c — the plan-load guard** (spec `pbloc-spec-plan-load-guard-v1` v1.1, BL12; store unchanged, NO bump — `planLoaded`
  is a new device-local field, derived for an older blob at hydration). The incident (5b's spec §16): a plan event sent
  by a build older than 5a was past NIP-44 v2's 65,535 B cap, so the computer's signer (Alby) couldn't decrypt it; the
  early failures were logged only as "payload parse failed (skipped)", the later ones as decrypt errors; the device kept
  its seed plan (its start date today), and its one-shot month reconcile deleted months 2–4 and rewrote month 1 — and
  the sync carried that to the phone.
  - **THE RULE** (`planLoad.ts`): a signed-in owner device writes nothing that depends on the plan until it holds the
    plan. `planLoaded` (device-local, persisted, never synced) is set when the device applies the relays' plan, by a
    restored backup, when it mints the key, or by its owner's "Start a new plan" after a pull found no plan and no
    journal — **never inferred from a pull**: relays that return nothing (slow, refusing the query, or not the ones
    that hold the plan) look exactly like a new key. A store saved before 5c derives it once, from its history. A device
    not signed in and a viewer never wait; signing in later unions a signed-out device's own work with the key's plan,
    as before 5c.
  - **Refused in the store** (`refuseWithoutPlan`, logged): the four day-event mutators, `upsertLogEntry` and
    `deleteLogEntry` (every monthly write funnels through them — a sign-off, a reopen, a re-roll, a manual log, the
    collateral correction), `reconcileMonthBuckets` (its flag left unset, so it runs once the plan loads),
    `setCbCollateralBtc`, and every plan edit (`emitPlanSets` — but the `backupVerifiedAt` stamp, which opens the gate a
    generated key's pull waits on). Several editors save fields nobody touched (a form prefilled from the seed, a whole
    roster or relay list), and an edit over the seed is the newest event for its field, so it would win over the plan
    once that loads. A relay edit stays local (no event) so the device can look elsewhere for its plan. The journal
    pull's raw setters aren't guarded — a pull still lands.
  - **Held at the publish** (`syncEngine`): the plan, the journal, the viewer fan-out and the NIP-65 relay list —
    `lastRefusal` `'held'`, syncNow's "HELD", no Reconnect.
  - **The store resets hold no plan:** `clearViewerData` and `resetPlanToSeeds` clear `planLoaded` (an owner who comes
    back to a device it used as a viewer waits for the plan); the key stamp's `null` clear — a failed mint or import,
    and Disconnect — clears it too, so the next key doesn't look as if it held a plan.
  - **The one-shot reconcile is a migration now:** `hydrateDeviceFlags` settles its flag at every hydration of a store
    that holds no journal (a new device or browser, a preview origin, a wiped store), so only a journal stored on a
    device before the bucketing fix (33f9ca0) is re-rolled — never one that arrives by sync.
  - **Loud:** the plan's outcome is recorded (`PlanPull`); "⚠ Plan not loaded" (AppShell, → Settings) and Settings ›
    SYNC's notice say why in plain words; after a pull that found nothing, both readings and "Start a new plan" (a
    confirm first; `NoPlanNotice` offers it on the dashboard too); the EventSheet says "Logging is paused until your
    plan loads on this device." with Save and Delete off; the Ledger hides the sign-off banner; DevPanel "plan pull" /
    "plan here"; Copy Diagnostics `planLoad`. The apply's logs name the error and the plain size, never the payload.
    The entry fork's sign-in card no longer promises a fresh start (`ChoosePathView`).
  - **Trimmed republish:** a device that applies a plan past 40,960 B plain republishes it (5a compacts it), so a signer
    that caps NIP-44 at 65,535 B, or a 64 KiB relay, can take it.
  - **The rider — the activity card's headline is what was bought:** `aggregateEvents` returns `moves` (`VenueMoves`:
    Strike, Coinbase, cold; a pledged buy's paired Strike deposit isn't a move) instead of `netBtc`; the card reads
    `+buyBtc ₿` and "+$X stacked" (keyed on buys), with "Moved: …" on its own line (eight places for a move too small
    for four); the review sheet's "Net collateral" row is a "Moved" row, shown only when something moved. Display only.
  - **Residuals:** a device from before 5c that synced a plan once, or minted its key, derives "loaded" — so does a
    store the escape hatch rebuilt around a minted key on an older build (spec §7.4); the planless screens' other
    editors stay visible while the store refuses them; an owner can still choose "Start a new plan" wrongly (warned
    twice); a put-back replaces a plan only a relay that didn't answer held; work done signed out unions into a key's
    plan at sign-in, as before 5c.
  - **Tests:** `planLoadGuard.test.ts` (26), `planLoadPull.test.ts` (15), `syncNowHeld.test.ts` (1),
    `planNotLoadedNotice.test.tsx` (4), `noPlanNotice.test.tsx` (5), `calendarModel.test.ts` (+4), the e2e
    `planLoadGuard.spec.ts` (4); 65 mutations (§ Test Suite → 5c).
- **5d — a buy's dollars** (spec `pbloc-spec-buy-dollars-v1` v1.1, BL13 option B; store unchanged, NO bump). The
  problem: the app priced a buy itself — its BTC × the app's price when it was logged, and again at every edit — and the
  owner often logs a buy days after making it, so a month's Income → BTC was off by the price move in between; and an
  edit re-priced it, and reopened the month if signed.
  - **The field:** "Dollars spent (incl. fee)" under "Bitcoin bought" — $0.00 until a BTC amount is typed, then the
    app's guess (`buyUsdGuess`: the BTC at today's price, to the cent, with "at today's price — change it to what you
    paid"), following the BTC until the owner changes the figure; saved as typed, to the cent; Save needs dollars above
    zero. A past-dated add gets the same guess (the device keeps no historical price).
  - **No re-pricing:** an edit shows the stored dollars and keeps them (`rebuildEditedBuy`); a BTC correction leaves them
    as they are (D2-A). A figure logged before 5d is stored to the cent at its first save.
  - **The dollars-only path (D1-A):** an edit that changes only a buy's dollars (`buyDollarsOnlyEdit` — the same id, date
    and BTC) on a current entry (`monthEntryCurrent`) writes Income → BTC alone (`rerollMonth`'s `dollarsOnly`), keeping
    the month's sign-off and every figure it recorded. Never the full re-roll there: its spread rewrites a signed month's
    own figures (expenses actually paid, the minimum, a hand-entered collateral) while the month stays signed. Only on a
    current entry: a partial pull can leave an entry lagging its events, and then the edit takes the full path and
    reopens (LD4). The lag check can't see a deletion of a non-buy, an entry-only change such as an un-sign, or an event
    other than a buy older than the entry's last save (spec §7) — the month's next other edit puts it right. No
    dollars-only edit re-anchors the balances (a buy feeds no reading); every other edit still does.
  - **Display (D3-A):** the implied price under the field ("≈ $102,880.00 per ₿ · today $100,000.00"); Daily's log row reads
    "₿ 0.012 · $1,234.56", without the "~" (to the cent since the plan of record's Run 2.1).
  - **What doesn't change:** no stored field, no store bump, no sync change; the backup; every engine and safety figure;
    "+$X stacked" (today's value of the month's buys, by design).
  - **The pledged pair (older than 5d, spec §12):** editing a pledged buy bumps its ts, so its Strike deposit shows as a
    "Strike +X ₿" move in Daily's activity line and the review's "Moved" row; Strike collateral doesn't move.
  - **Tests:** `buyDollarsStore.test.ts` (21), `eventSheet.test.ts` (+7), `dailyView.test.ts` (the row), the e2e
    `buyDollars.spec.ts` (3); 33 mutations (§ Test Suite → 5d).

---

