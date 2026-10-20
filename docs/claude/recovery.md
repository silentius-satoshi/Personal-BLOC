# Recovery and the backup gate — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

## "No plan found on this key" — `remotePlanFound` (R2b-2; no store version bump)

Sign in with a key that has nothing published under it and the app used to render a **seed-default dashboard
with no explanation** — the user could not tell "my plan failed to load" from "this key has no plan yet." The
entry fork promised "we'll load your plan, or start fresh on your key"; this is the code that kept the second half
of that promise honest. **5c:** the card now says "we'll load your plan; if your key has none yet, you can start
one" — an empty answer is also what relays that don't show the plan give, so the owner starts a new plan by hand
("Start a new plan"), never the device.

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
  (no ✕-dismiss precedent exists). **5c:** only while the last plan pull is `'none'` (a relay answered with nothing)
  AND the device waits for its plan — not on `'unreachable'`, not once a plan is loaded. It no longer says "starting
  fresh": an empty answer is also what relays that don't show the plan give, so it offers "Start a new plan"
  (`startNewPlanHere`, confirmed) and says not to if a plan was expected. The `'generated'` clause stays as it was:
  a key minted on the device holds its plan, and a store rebuilt around one (or an owner → viewer → owner device) that
  reaches `'none'` once its key is verified gets Start from Settings and the pill. Under 5c the nag's exclusivity
  would also hold with its exact complement (`!isBackupGateSatisfied`) — logged, not changed in a safety release.
- **⚠ OWNER-ONLY BY CONSTRUCTION.** `ViewerHomeView` gains `notice?: ReactNode`, rendered `{ownerNav && notice}`
  after `</header>`. `AppShell`'s `simpleView === 'dashboard'` arm of `renderOwnerJournal()` is the **only** call
  site that passes it, and it sits after gates D/E/F (`isAuthenticated && isOwner` guaranteed). The real viewer,
  the edge-back under-layer, and `ViewerPreview` pass neither `ownerNav` nor `notice` → the notice cannot leak
  into a viewer surface or corrupt Preview-as-viewer fidelity. **Never add a branch to AppShell's gate ternary**
  — anything there replaces the whole app — except F1's 'Loading your plan…' (5e): a whole-app screen by design that ends with the first pull and offers 'Open the app' after 15 s. Accepted scope: an owner on Journal or in full mode sees it on their
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
| `backupVerifiedAt: number \| null` | ✅ | ✅ — an authed stamp is a plan event (also in `buildSettingsPayload` + `SETTINGS_FIELDS`, so every plan backup carries it) | The attestation travels with the plan. **ONE-WAY LATCH** by construction (4e — see below). STRIPPED from the trusted viewer snapshot (`VIEWER_SNAPSHOT_STRIP`). ⚠ It does NOT un-gate a gated peer — see below. |

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
  (a) **if authenticated**, emit the stamp as a plan event — `emitPlanSets([['backupVerifiedAt', ts]])`: the field +
  the event + `planDirty` + the debounced kick, whose publish waits for the first pull (Fix A —
  `initialSettingsPullDone` is still `false` *precisely because the gate held `syncNow` off all session*) — and
  (b) run the SAME initial-pull-then-publish sequence a fresh authentication runs: `syncNow` (cf.
  `establishOwner.ts`), whose publish step carries the event. **No second wake mechanism.** ⚠ **ORDER: the emit's
  `set()` FIRST**, so the gate reads satisfied inside `doSyncNow`'s and the publish guards' `useStore.getState()`
  reads. `syncNow` is **dynamic-imported** (cycle-safe) and `.catch`-logged. `nostr` is optional (tests assert
  state without a signer; `OwnerKeySetup` relies on `establishLocalOwner`'s own internal `syncNow` as the wake).
  `ts === null` is the teardown clear: RAW — no event, no wake.
- **⚠ THE PRE-AUTH BRANCH IS LOAD-BEARING.** Onboarding's quiz-pass (R2c-6a, `OwnerKeySetup`) stamps on an
  **unauthenticated** store, BEFORE K3's establish — which can still **throw** (Face ID cancelled). Its rollback
  clears the field RAW and cannot retract an event, so an event emitted pre-auth would outlive a failed establish
  in the persisted log. So pre-auth only the field is set. It then rides no channel until an authed re-verify
  (F14 — until 4e a newly joined device could still get it through the `settings:v1` bridge); the cost is a peer's
  missing "Backed up ✓" chip. (The old reason for this branch — Fix C, nothing may mark `settingsDirty` before the
  pull, with Fix D's seed sentinel unreachable from inside `syncNow` — retired with the bridge at 4e.)
- **Establish-failure ROLLBACK.** Every stamp lands *before* the establish (which owns the wake), and
  `setKeyProvenance` is write-once — so a throw would freeze `'generated'` for a key that never existed,
  silently rejecting the later correct `'imported'`/`'external'` stamp, and leave a false backup attestation.
  `OwnerKeySetup.handleProtect`'s catch clears **both**; `NostrAuthGate.handleLocal`'s catch clears provenance.
- **Edits made while gated are NOT lost.** `emitPlanSets` / `emitPrefs` are auth- and gate-UNGATED: a gated key's
  plan edits accumulate as events in the local log (and the prefs as `prefsDirty`), while the publishes hold them.
  On verification the plan and prefs publishes ship everything. A generated-unverified key is by definition a
  brand-new plan with no peer device.
  5c: that holds on the device that minted the key (the stamp sets `planLoaded`). On 5c, a store rebuilt around it —
  the escape hatch keeps the provenance, not the store — refuses plan edits (all but this stamp) until its plan loads.
  A store an older build rebuilt that way counts as holding its plan at the update: the derive can't tell it from the
  minting device (spec §7.4).
- **`backupVerifiedAt` does NOT un-gate a peer.** A gated device runs **no sync at all, not even a pull**, so it
  can never *receive* the field. It needn't: only the sole **generating** device is ever gated, and no other
  device can hold `'generated'` for the same key (importing that nsec yields `'imported'`). The field is synced
  so the attestation travels with the plan and imported/external peers can see it — not as an un-gate channel.

### The one-way latch — by construction since 4e

Until 4e, `hydrateSettings`' whitelist applied any value `!== undefined`, so a `null` from a legacy or
not-yet-verified peer's `settings:v1` would have un-verified a device — and a hydrate skip-guard (an incoming
`null` never overwrote a non-null local value) held the latch: the **third member of the whole-object-LWW
skip-guard class** (`nostrRelays`, `viewers`, this). **4e deleted the class with `hydrateSettings`**, as planned,
because on the plan channel absent vs null vs set are first-class in the fold: the stamp flows only as plan events,
no path emits a null one (the teardown clear is RAW; the one emit sits after the null return — LATCH,
`planEventsCutover.test.ts`), the fold writes only fields present in the log, and neither whitelist applier can
write it (`hydratePrefs` takes PREFS_FIELDS; `applyViewerSettings` strips it).

### Gated engine entry points (the predicate is added to the EXISTING guard, never deeper)

`isBackupGateSatisfied(...)` is consulted at exactly the layer `isAuthenticated` already is. One predicate,
11 sites:

| File | Guard |
|---|---|
| `syncEngine.ts` | `publishRecordsNowImmediate` (also the `viewerMode` backstop) |
| `syncEngine.ts` | `publishPlanEventsNow` (bails BEFORE `setNostrSyncing`; 4e — replaces the retired `publishSettingsNow`) |
| `syncEngine.ts` | `publishPrefsNow` (4e — replaces the retired `syncSettingsToNostr` mark-dirty trigger in the count: the emit layer is ungated, so the gate sits on both publishes) |
| `syncEngine.ts` | `publishRelayListToNip65` |
| `syncEngine.ts` | `publishViewerSnapshotNow` |
| `syncEngine.ts` | `publishViewerRevocationNow` |
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
| `bloc-device-tag` | local | **DEVICE — RETAIN** (one of the two retained keys) |
| `bloc-btc-candles` | local | **DEVICE — RETAIN** — the price chart's history (5e, F12): public prices, the same for every identity, never synced, never in a backup |

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

