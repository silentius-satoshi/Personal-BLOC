# Nostr — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

## Nostr Integration (Steps 1–3 ✅ Complete)

### Status

| Step | Description | Status |
|---|---|---|
| Step 1 | Auth gate — Nostr identity login | ✅ Complete |
| Step 2 | Encrypted relay publishing | ✅ Complete |
| Step 3 | Cross-device sync | ✅ Complete |
| Step 4 | publishRecords (monthlyLog) | ✅ Complete |

---

### Login Paths

| Method | Function | Notes |
|---|---|---|
| NIP-07 browser extension | NLogin.fromExtension() | Desktop; auto-restores on reload |
| Remote signer QR | NLogin.fromNostrConnect() | Desktop QR scanned with Primal iOS; persists across reload (nostrLogin) |
| Remote signer deep link | NLogin.fromNostrConnect() | Mobile two-step: warm relay → tap Open Signer App → approve → callback; persists across reload |
| Local key (biometric) | `NSecSigner` + `keyVault` | **All platforms** (Step 4; the iOS-only gate was removed in R1). Encrypted local nsec, WebAuthn-PRF/PIN unlock; label is PLATFORM-HONEST via `src/lib/biometricLabel.ts` — "Face ID" on iOS, "passkey" elsewhere (Touch ID / Windows Hello / QR-to-phone). Import gates ONLY on a valid resolved key per tab (the backup-attestation checkbox was retired as tautological — the paste proves possession); on relaunch an "authenticated-but-locked" `LocalUnlockGate` (gesture-driven unlock), NOT the full login. nip07/nip46 keep optimistic auto-restore |

### Writer local-key signer (Nostr Step 4) — `keyVault` + `'local'` method

Third auth option (additive; NIP-07/46 untouched): an **encrypted local nsec, biometric-unlocked, on ALL
platforms** (R1 removed the original iOS-only gate + made the labels platform-honest via `biometricLabel` —
"Face ID" on iOS, "passkey" elsewhere; **R1.5** completed the sweep across the viewer surfaces
`ViewerLoginFlow`/`ViewerUnlockGate` + `StoreMigrationGate`, so `src/lib/biometricLabel.ts` is now the SINGLE
source for that label — never re-inline the UA check), giving one-tap reliability without the NIP-46 deeplink/QR race. Built on a NEW **identity-agnostic
`src/lib/nostr/keyVault.ts`** (PRF primary / PIN fallback, client-side, no server: PBKDF2→HKDF→AES-GCM via
WebCrypto; `wrapSecretKey`/`unwrapSecretKey`/`probeKeyVaultCapability`; unwrapped key in MEMORY ONLY,
never persisted) — shared infra the queued viewer-access phase reuses.
- **✅ RETIRED (copy-truth fix) — the import-path "hard backup gate" attestation checkbox.** `NostrAuthGate`'s
  Recovery-key import used to gate the whole form on `backupConfirmed` ("I have my nsec backed up outside this
  device"). **That attestation was TAUTOLOGICAL: on the IMPORT path the user is pasting a key they already hold,
  so the paste IS the proof of possession.** It gated nothing real and trained reflexive ticking, eroding the acks
  that DO mean something (`OwnerKeySetup` K2, the ceremony's verify). Import now gates ONLY on the real
  precondition — a valid RESOLVED key for the active tab (`localCanContinue`: words checksum via `phraseStatus` /
  `keyTabReady` = not-a-handoff-token + kind resolved + an ncryptsec actually decrypted) plus a confirmed PIN when
  there is no passkey. **Never re-add an attestation checkbox to the import path.**
  ⚠ The `OwnerKeySetup` **K2 ack is INDEPENDENT state (`ack`) and stays** — a freshly MINTED key exists nowhere
  else, so there the attestation is real (it gates Continue only; it has not stamped `backupVerifiedAt` since R2c-4a).
- **On-device notice — state only what is TRUE.** The import path shows a PASSIVE (non-gating) hint: *"The app
  keeps your key protected on this device, but that's not a backup — keep the key you just pasted somewhere safe.
  If you lose this device without it, your plan can't be recovered."* ⚠ It deliberately does **NOT** claim that
  plan DATA is encrypted at rest. The **KEY** is always keyVault-wrapped (passkey/PIN) — unconditionally true —
  but plan data is **plaintext at rest today** (`storeEncEnabled` is off by default; default-on is Phase 5). The
  prior copy asserted "this stores an encrypted copy on this device… all your encrypted data is permanently
  unrecoverable," which was FALSE. Do not restore that claim before Phase 5 actually ships.
- The device copy is convenience, never the only copy. Losing the only copy = permanent data loss.
- **Launch-unlock gate (the wrinkle):** `useNostrAutoRestore` does NOT optimistically auth for `'local'`
  (Face ID needs a user gesture); `AppShell` renders `LocalUnlockGate` (a NEW branch BEFORE `NostrAuthGate`,
  gated `nostrSigningMethod==='local' && nostrPubkey && !nostrSigner && !isAuthenticated`) — tap to unlock →
  `restoreSigner` (`unwrapSecretKey` → Face ID) → signer set → `isAuthenticated`. Escape ("Use a different
  login") sets a local `unlockEscape` → falls through to `NostrAuthGate`. nip07/nip46 keep optimistic auth.
- `restoreSigner` gains a `'local'` branch (unwrap → `new NSecSigner(sk)` → pubkey-match → `sk.fill(0)`);
  `NSecSigner` is a drop-in `NostrSigner` so the whole publish/sync path is unchanged. `signerOpTimeout`
  treats `'local'` like nip07 (60s — human-in-the-loop). Settings shows a "Local · Face ID" badge +
  "Remove local key" (clears the wrapped key + signs out; reinforces backup). Switch semantics: setting up
  local makes `'local'` the singular method (a prior NIP-46 session is simply unused, no silent fallback).

### Owner-pubkey gate — app render + Strike fetch locked to the owner

The auth gate isn't just "authenticated" — it's **authenticated AS the owner**. `isOwnerPubkey(nostrPubkey,
import.meta.env.VITE_OWNER_PUBKEY)` (`src/lib/nostr/ownerGate.ts`, pure) gates both:
- **App render** (`AppShell`): the ternary is LocalUnlockGate → `<NostrAuthGate>` (`!isAuthenticated`) →
  **`<PrivateAppNotice>`** (`isAuthenticated && !isOwner`) → app. A foreign valid nsec sees "This app is
  private to its owner." + a "Use a different key" button (`reconnectNostr` — clears session, keeps the lock,
  reloads to the login). `!import.meta.env.DEV` preserved on the gate branches (dev bypass intact).
- **Strike fetch** (`useStrikeData(enabled)`): the effect early-returns unless `enabled` — AppShell passes
  `isAuthenticated && isOwner`, so `/api/strike-balances`/`/api/strike-rates` NEVER fire for an
  un-authenticated visitor or a non-owner key (closes a prior unconditional-fetch leak where the proxy
  response landed in any visitor's devtools).
- **`VITE_OWNER_PUBKEY`** = the owner's **hex** pubkey (matches stored `nostrPubkey`; not the npub), a
  build-time client env var (set in Vercel, never committed). **Unset-env fallback
  (load-bearing):** when unset (local dev / fork / misconfigured deploy) `isOwnerPubkey` returns true →
  degrades to "any authenticated key" (no lockout — a forgotten env var can't brick the app). Lockdown is
  active only when the var is set. Store v15 (no bump — env var, not state).
- **Viewer carve-out (DOCUMENTED, not built):** the queued viewer-access spec will change the non-owner
  branch to `isAuthenticated && !isOwner && !viewerMode` so a provisioned `viewerMode` viewer (a different
  pubkey) passes into the **read-only** render. The viewer's live Strike balances arrive via the encrypted
  `viewer:v1` snapshot (Option B — owner's device seals `strikeUsdBalance`/`strikeBtcAvailable` to the
  viewer's pubkey); the viewer renders them read-only with `useStrikeData(false)` and **never fetches**. The
  owner-only fetch gate is correct as-is for the viewer — do NOT add a viewer Strike-fetch path (and per
  NIP-98 the proxy 403s any non-owner key anyway).

---

### NIP-98 Proxy Auth — Strike proxies gated by owner-signed requests (the bundle holds NO secret)

The owner-gate controls *when the client fetches*; **NIP-98 is the server-side enforcement beneath it** — it
closes the deeper gap that `VITE_APP_PROXY_SECRET` used to be **embedded in the deployed bundle** (extractable
from devtools → anyone could `curl /api/strike-balances` with the secret and read the owner's balances; the
`STRIKE_API_KEY` itself never left the server). **`VITE_APP_PROXY_SECRET` / `APP_PROXY_SECRET` are REMOVED.**
- **Client** signs every Strike request with the authenticated Nostr key: `getProxyAuthHeader(url, 'GET',
  signer)` (`src/lib/nostr/proxyAuth.ts`) → `nip98.getToken` builds + signs a kind-27235 event →
  `Authorization: Nostr <base64>`. `useStrikeData.fetchAll` reads `useStore.getState().nostrSigner` (bails if
  null), builds **absolute** URLs from `window.location.origin` (the NIP-98 `u` tag must equal the request URL
  exactly), and sends the header. **Short-lived token cache (~50s, per url+method, in-memory):** NIP-98 events
  are valid ±60s and `useStrikeData` polls every 60s — on **NIP-46** signing is a remote round-trip, so the
  cache makes it ~1 sign per ~50s per URL instead of per-fetch prompt-spam (local/NIP-07 sign instantly).
- **Server** (`api/_lib/ownerAuth.js` → `validateOwnerRequest(authHeader, url, method, OWNER_PUBKEY)`, shared
  by all three Strike proxies — balances, rates, invoices): `validateToken` (kind/ts/url/method + `verifyEvent`
  schnorr sig) — handles BOTH the
  false-return AND the throw — then `unpackEventFromToken` → `pubkey === OWNER_PUBKEY` else **403**; missing/
  expired/bad-sig/url-mismatch → **401**. The `STRIKE_API_KEY` 503-guard stays first; the Strike fetch is
  unchanged. `_lib/` is `_`-prefixed so Vercel does NOT route it (bundled into each function's import graph);
  plain ESM `.js` so it imports in both the Vercel node runtime AND vitest.
- **The `u`-tag gotcha (get right on first deploy):** server validates against **`PUBLIC_ORIGIN` + req.url**
  (a configured env, robust over header reconstruction behind Vercel's edge). `PUBLIC_ORIGIN` must equal the
  deployment origin **exactly** (trailing-slash-sensitive) — a mismatch → 401 on every fetch. Client uses
  `window.location.origin`, which equals `PUBLIC_ORIGIN` on the real deploy.
- **Server env (new):** `OWNER_PUBKEY` (hex — the proxy's owner gate) + `PUBLIC_ORIGIN` (exact deploy origin).
  `OWNER_PUBKEY` (server proxy gate) and `VITE_OWNER_PUBKEY` (client UI gate) hold the **same** hex pubkey,
  two scopes. Store v15 (no bump — env + in-memory cache, no state).

---

### Known NIP-46/Primal Properties

- **SESSION DEATH ON NETWORK DROP** (proven via dev-panel diagnostics): a network drop kills the existing
  NIP-46 session on Primal's side; foregrounding Primal does NOT revive it; only a fresh NostrConnect
  handshake (the ⚠ Re-authorize stage of the affordance) restores service. Routine recovery cost:
  retry tap (~20s, fails) → Re-authorize → approve in Primal.
- **POISON-ENTRY WEDGE** (refined): the DETERMINISTIC blocker is a metadata-less (bunker-style) session
  in Primal (blank name / "unknown url") — it reliably hangs NEW nostrconnect handshakes for the same
  pubkey at "getting public key…" until removed. Dead but WELL-FORMED labeled sessions are at worst an
  INTERMITTENT blocker (re-auth observed succeeding with two lingering labeled iOS sessions; Primal is
  also actively patching nostrconnect). Per-device connect names make pruning confident; the auth gate
  shows a stuck-hint after ~15s on 'getting-public-key'. Primal-side (worth an upstream report).
- **DESKTOP SIGNER**: desktop uses a LOCAL-key NIP-07 extension (Alby) — out of Primal's session table
  entirely; signer probe ~27ms local vs ~2s over NIP-46. Only iOS uses NIP-46.
- **Connect identity**: nostrconnect name = `Personal ₿LOC · <platform>-<tag>` (e.g. `iOS-a3f2`) via
  `src/lib/nostr/deviceTag.ts` (`'bloc-device-tag'` in localStorage, never synced) — each device's
  session is distinguishable in Primal's connected-apps list.

---

### Dependency Stack (version pins are hard requirements)

nostr-tools: 2.23.5    ← pinned exact; NIP-44 + Primal decrypt verified working at this version
@nostrify/nostrify: ^0.52.2
@nostrify/react: ^0.6.2
websocket-ts: 2.3.0    ← pinned exact as a DIRECT dep at the tree-resolved version (no dupe copy);
                         used to cap NRelay1's reconnect backoff (see NostrProvider)
@scure/bip39: 2.0.1    ← pinned exact as a DIRECT dep at nostr-tools 2.23.5's ALREADY-RESOLVED transitive
                         version (same discipline as websocket-ts). Adding it must NOT change the tree:
                         verify `npm ls @scure/bip39` still shows one 2.0.1 (deduped) and that the lockfile
                         diff is ONLY the added key under packages[""].dependencies. Needed directly because
                         nostr-tools/nip06 exposes no entropy→mnemonic function (see nip06Key.ts).
                         ⚠ The wordlist subpath needs the LITERAL `.js`: '@scure/bip39/wordlists/english.js'
                         — the package's exports map has no extensionless key (ERR_PACKAGE_PATH_NOT_EXPORTED).

---

### Key Files

```
src/
  providers/
    NostrProvider.tsx               # NPool + NRelay1 context; wrap root in main.tsx. Reconnect backoff capped
                                    # via ExponentialBackoff(1000, 4) → max 16s between attempts (nostrify
                                    # default is UNBOUNDED doubling — strands NIP-46 after an offline period)
  pages/
    RemoteLoginSuccessPage.tsx      # Callback page Primal opens after approval
    LandingPage.tsx                 # C0 — commercial marketing page (+ .module.css), served at '/' on the PUBLIC
                                    # deploy (VITE_LANDING=1) via App.tsx. Self-contained (no store/sim/NostrProvider);
                                    # hero + interactive LtvDemo widget (drags BTC price → LTV → Safe/Watch/Act via the
                                    # REAL band constants barLevel/CB_WARN_LTV 0.65/CB_LLTV + LEVEL_COLOR — can't drift)
                                    # + features + steps + pricing (self-host free · hosted over Lightning) + FAQ +
                                    # footer. Reads only VITE_REPO_URL (env + fallback); all demo CTAs → internal '/app'
  components/Auth/
    NostrAuthGate.tsx               # Auth gate; NLogin.fromNostrConnect() wiring; calls markSignerFresh()
                                    # after setting the signer so syncNow doesn't rebuild a duplicate
                                    # NConnectSigner session post-login. + the all-platform "Use a local key"
                                    # flow (R1 removed the iOS-only entry gate; label is platform-honest via
                                    # `src/lib/biometricLabel.ts` — "Face ID" on iOS / "passkey" elsewhere)
                                    # (valid-key gate → nsec decode → keyVault wrap → NSecSigner; the old backup-
                                    # attestation checkbox is RETIRED — see § the local-key signer. The form's only
                                    # precondition is localCanContinue, and a PASSIVE hint states the true posture:
                                    # the KEY is wrapped, that is not a backup. It must NOT claim plan-data
                                    # encryption-at-rest — that is plaintext today, Phase 5 flips it).
                                    # #4: optional onBack prop renders a back button in the main options view; its label
                                    # is the Phase-2 `backLabel?` prop (default "← Back"). AppShell's locked-out-unlock
                                    # escape passes backLabel="← Back to Face ID unlock" (+ onBack=()=>setUnlockEscape(false)
                                    # → falls back to LocalUnlockGate); the Settings access door + onboarding fork login use
                                    # the default. Absent in first-time onboarding which passes no onBack. #6: when a
                                    # writerKeyWrapped already exists (e.g. after a local→nip46→local switch) the local
                                    # section shows "Unlock with Face ID" (handleUnlockExisting → setNostrSigningMethod
                                    # ('local') → restoreSigner) instead of forcing an nsec re-import; a "Use a different
                                    # key" ghost sets forceImport to reveal the import form, and a 'pubkey mismatch' throw
                                    # (different account) catch-and-falls-back to import with a message.
                                    # R2b-2 IA: the options view leads with a STACKED "Use my Recovery Key" row
                                    # (.methodBtn/.methodTitle/.methodSub — the card is align-items/text-align CENTER, so
                                    # the stacked row must opt out of both) subtitled "12 words or nsec — unlocks or imports
                                    # on this device" → openLocal (unchanged). The three PROTOCOL methods (nip07 extension,
                                    # its divider, QR remote-signer, bunker) collapse under an "Advanced sign-in" disclosure
                                    # (.disclosureBtn + aria-expanded/aria-controls + a [data-open] chevron; .disclosurePanel),
                                    # COLLAPSED BY DEFAULT, order + handlers byte-identical. onBack sits outside the panel;
                                    # the #6 unlock-existing branch, the QR/bunker sub-views, and the viewer path
                                    # (ViewerLoginFlow — a different component) are untouched.
                                    # R2b-2 DUAL-FORMAT IMPORT: the paste field takes an nsec OR 12 words (state renamed
                                    # nsecInput → recoveryInput; placeholder "nsec1… or your 12 words"). handleLocal calls
                                    # classifyRecoveryInput → 'nsec' runs the existing nip19.decode path VERBATIM; 'words'
                                    # runs entropyFromWords (R2c-4b — was skFromWords), rendering InvalidSeedWordsError.message
                                    # verbatim (it is user-facing prose by contract); 'unknown' errors naming BOTH forms.
                                    # R2c-4b PAYLOAD ASYMMETRY: ONE `payload` local + a `payloadKind` local feed ONE
                                    # establishLocalOwner call — words → the 16-byte entropy as 'nip06-entropy' (so the
                                    # ceremony/RevealRecoveryKey show the user's REAL words); nsec → the raw sk as 'sk'
                                    # FOREVER (a raw key has no mnemonic; nothing to re-display). Provenance stays 'imported'
                                    # for both, stamped in the same place; the finally's payload.fill(0) zeroes either result.
                                    # R2c-7a-2 BARE-NSEC REMEDIATION: the `nsec` branch NO LONGER falls through to
                                    # establishLocalOwner. A raw nsec is an UNPROTECTED key, so after the (unchanged)
                                    # decode+validate it captures `pendingSkRef.current = decoded.data.slice()` (a
                                    # defensive copy — the raw decode buffer, still assigned to `payload`, is zeroed by the
                                    # existing finally) + `setRemediating(true)` and RETURNS. The remediating branch renders
                                    # FIRST inside `showLocal` (before the hasWrappedKey/#6 ternary): "Protect this key
                                    # first" → an ENCRYPT-direction passphrase field (R1.5 state-specific label: "Passphrase
                                    # to encrypt this backup"; a device-PIN field was on the previous screen) → **Download
                                    # encrypted backup** (nip49.encrypt(sk, pass.trim()) → buildRecoveryFileText('ncryptsec')
                                    # + recoveryFileName('ncryptsec', todayLocalISO()) → downloadBlob) → **Continue**
                                    # (disabled until `bareNsecSaved`) → the SAME establish tail (method resolve →
                                    # setKeyProvenance('imported') → establishLocalOwner(…, payloadKind:'sk') → onSuccess;
                                    # catch → provenance rollback). ⚠ THE GATE IS ON **WHEN**, NOT **WHAT** — a bare nsec
                                    # still wraps 'sk' (a raw key has no mnemonic); the three-way payloadKind asymmetry is
                                    # untouched. The 'encrypted' + 'words' branches SKIP remediation entirely (an ncryptsec
                                    # already arrives protected; words are the richer artifact) and still fall through to
                                    # `establishLocalOwner(payload, method, nostr, {pin,keyLabel,payloadKind})` unchanged.
                                    # FOUR DISCIPLINES, each mirroring the ceremony: (1) ⚠ `establishLocalOwner(sk.slice())`
                                    # — NOT the held ref, and the ref is zeroed on SUCCESS/Back/openLocal/unmount but NEVER
                                    # in a finally: establishLocalOwner wraps+persists BEFORE deriving the pubkey and zeros
                                    # its arg either way, so zeroing the held buffer would make a cancelled-Face-ID RETRY
                                    # wrap 32 zero bytes (the bufferAliasing.test.ts hazard). A failed establish therefore
                                    # leaves Continue retryable. (2) ⚠ nip49.encrypt is ~1s of SYNCHRONOUS scrypt → yield 30ms
                                    # so "Encrypting…" paints before the freeze; no prepRef needed (one-shot on tap + the
                                    # passphrase input is disabled while encrypting, so inputs can't change mid-encrypt).
                                    # (3) STALENESS: editing the passphrase resets `bareNsecSaved` (the prior download is
                                    # locked with the OLD passphrase). (4) Save… sets saved ONLY on a RESOLVED
                                    # navigator.share (an iOS cancel rejects AbortError), guarded by `if (!navigator.share)
                                    # return` first. Errors → generic "Couldn't encrypt — try again." (⚠ never e.message).
                                    # pendingSkRef is a REF not state so the unmount cleanup zeroes the CURRENT buffer.
                                    # R2c-7a-fix KEY-FIELD ERROR PRECEDENCE (strict, mutually exclusive; each suppresses
                                    # the passphrase field — a payload we can't parse must never be blamed on the
                                    # passphrase): (1) pastedIsHandoffToken = recoveryInput.trim().includes(':') →
                                    # "That's a viewer share code, not your Recovery Key." ⚠ NEVER auto-strip the suffix:
                                    # the key inside a SharingPage token is a VIEWER key, so importing it as the owner is
                                    # a silent CATEGORY ERROR. `:` isn't in the bech32 alphabet (nor in 12 words), so a
                                    # colon anywhere means "token" — we test .includes(':') and NOT parseHandoffToken(…)
                                    # !== null, because that returns null for a MALFORMED token which would then fall
                                    # through and be misreported; it also catches a plaintext `nsec1…:npub1…` token that
                                    # classifies as 'nsec'. Guarded again in handleLocal (defense in depth) so a token can
                                    # never reach establishLocalOwner. (2) kind==='encrypted' && !isWellFormedNcryptsec →
                                    # "That doesn't look like a valid key — check for a truncated paste." (also shown when
                                    # decryptState.error==='malformed', i.e. a checksum typo that only surfaced inside
                                    # decrypt). (3) only a WELL-FORMED ncryptsec shows the passphrase field, so "Wrong
                                    # passphrase" finally means what it says (decryptState.error==='passphrase'). The
                                    # words/unknown hints are suppressed for a token (`garbage:npub1…` classifies as
                                    # R2c-7a-2-polish: the passphrase field's three feedback branches are MUTUALLY
                                    # EXCLUSIVE over the existing decryptState — `checking` → "Checking passphrase…",
                                    # `error==='passphrase'` → "Wrong passphrase…", and (NEW) `!checking && sk &&
                                    # !error` → a green "✓ Key unlocked" (styles.checksumLine + .checksumValid, the
                                    # same classes the word grid's "✓ valid recovery phrase" uses). Without the
                                    # success branch a CORRECT passphrase merely made "Checking…" vanish after ~4s
                                    # (3000ms debounce + ~1s scrypt) while Continue quietly enabled — which reads as
                                    # "nothing happened". Display-only: no new state, no effect, no decrypt/debounce/
                                    # trim change. (ViewerLoginFlow's token passphrase has the same shape and was
                                    # deliberately left alone — it already surfaces the decoded viewer npub.)
                                    # 'unknown' and would otherwise double-error). ⚠ SCOPE — ✅ NO LONGER INPUT-STARVED:
                                    # **R2c-7b's encrypted backup export is this branch's producer** (RecoveryKeyCeremony →
                                    # encrypt toggle → Download → a `-encrypted-<date>.txt` holding an owner-key ncryptsec),
                                    # so the ROUND-TRIP is the real acceptance test — export → sign out → paste → passphrase →
                                    # establishes to the SAME pubkey. **R2c-7a-2 (bare-nsec remediation) is the SECOND
                                    # producer** — a pasted raw nsec must now save an encrypted backup before it establishes,
                                    # and that backup pastes straight back into this branch. It
                                    # was starved at 7a/7a-fix: the only well-formed ncryptsec then obtainable was the VIEWER
                                    # key inside a share token, which (1) rejects — so R2c-7a's manual gate "mint a viewer
                                    # token to get a real ncryptsec" was never a valid acceptance test. ⚠ An imported
                                    # ncryptsec wraps payloadKind 'sk' (it decrypts TO a raw key), so a user who exported an
                                    # ENCRYPTED backup of an entropy key and restores from it gets an nsec, not their 12
                                    # words — the asymmetry the ceremony's helper line warns about, and why plaintext is the
                                    # export default.
                                    # R2c-7a ENCRYPTED KEY: the key tab is PREFIX-AWARE and takes an nsec OR a NIP-49
                                    # ncryptsec. A memoized keyInput = classifyRecoveryInput(recoveryInput) (stable effect
                                    # dep) drives everything. kind==='encrypted' reveals an UNLOCK-passphrase field whose
                                    # copy is STATE-SPECIFIC by requirement ("Passphrase to unlock this key" + "…it is not
                                    # your device PIN") — a device-PIN field can be on screen simultaneously, and R2c-7a-2
                                    # adds the inverse ENCRYPT passphrase here, so a generic "Passphrase" would be
                                    # ambiguous in BOTH directions (the R1.5 confusion). Mechanism MIRRORS ViewerLoginFlow
                                    # verbatim: 3000ms debounce → decrypt in an EFFECT not a memo (nip49.decrypt is
                                    # SYNCHRONOUS scrypt; a memo blocks the paint that would show "Checking passphrase…")
                                    # → 30ms setTimeout yields one frame so it paints → clearTimeout cleanup so a stale
                                    # in-flight decrypt can't land after a newer keystroke → {sk:null,checking:true} first
                                    # so a stale key is never carried. handleLocal's encrypted branch takes the sk from
                                    # that state (never re-decrypts) and MUST .slice() it (see the Critical Constraints
                                    # row — zeroing the state buffer corrupts writerKeyWrapped on a retry). payloadKind
                                    # 'sk' (an ncryptsec decrypts TO a raw key; no phrase to re-display). localCanContinue
                                    # is kind-aware: unknown can't submit, and an ncryptsec can't submit until it decrypts.
                                    # Hints keep a disabled Continue from being mute (unknown → accepted forms; 12 words in
                                    # the key field → "switch to the phrase tab", NOT blocked — handleLocal imports them
                                    # correctly via the entropy path). openLocal also scrubs keyPassphrase/debounced/decryptState.
                                    # R2b-3 TAB SPLIT: a "Recovery phrase (12 words) | Recovery key" segmented toggle (recoveryTab,
                                    # 'words' | 'key' — R2c-7a renamed the value from 'nsec', which would now be a lie;
                                    # default 'words', reset in openLocal; .recoveryTabs/.recoveryTab/.recoveryTabActive, this
                                    # file's own tokens). WORDS tab = <WordGrid mode="input"> over gridValues (12 boxes, reset
                                    # in openLocal) + a single parent-owned CHECKSUM line (phraseStatus → "phrase incomplete" /
                                    # "✓ valid recovery phrase" / "checksum doesn't match — check your words") + (R2c-4a) the
                                    # CAPTURE-variant hygiene hint BELOW the checksum line, words tab only, reusing .hint:
                                    # "Never type your Bitcoin wallet's seed phrase here — a plan uses its own words."
                                    # (below, not above, so it never interrupts the grid→live-status feedback path); a pasted KEY
                                    # (onKeyPasted — nsec OR ncryptsec since R2c-7a) flips to the key tab with the field filled;
                                    # onSubmitAttempt (Enter on box
                                    # 12) submits if valid. KEY tab = the SAME single field (password + Show/Hide +
                                    # the 4 iOS suppressions), placeholder "Paste your recovery key — nsec or encrypted"
                                    # (never the token "ncryptsec" — jargon). handleLocal is STILL ONE PATH —
                                    # only the raw source is tab-selected (words: gridValues joined; key: the field) → the same
                                    # classifyRecoveryInput → decode/skFromWords → 'imported' stamp → establishLocalOwner, all
                                    # byte-identical from classification onward. localCanContinue is tab-aware (words:
                                    # phraseStatus==='valid'; nsec: !!recoveryInput.trim()) — but skFromWords on submit is still
                                    # the authority (the checksum gate is a hint). ⚠ RESIDUAL (pre-existing, NOT introduced
                                    # here): openLocal is the ONLY scrub site — gridValues/recoveryInput/pin/pinConfirm survive a
                                    # successful handleLocal + the ← Back buttons in React state until re-entry (flagged for the
                                    # R2c scrub pass, not fixed). [Superseded R2b-2 note: the field was once a single dual-format
                                    # box "nsec1… or your 12 words"; the words half is now its own grid tab.]
    LocalUnlockGate.tsx             # "Authenticated-but-locked" relaunch screen for the 'local' method —
                                    # gesture-driven "Unlock with Face ID" (restoreSigner→unwrap) + Retry +
                                    # "Use a different login" escape; reuses NostrAuthGate.module.css
    ViewerLoginFlow.tsx             # Access Layer Phase 1 — the viewer-login flow EXTRACTED VERBATIM from
                                    # OnboardingModal (byte-identical crypto: wrapSecretKey→setUnwrappedViewerKey
                                    # →clearViewerData→setViewerWriterPubkey→setViewerMode(true); only the final
                                    # onComplete(true) became an onDone() prop). Self-contained overlay (own
                                    # .overlay/.modal) → reusable from BOTH onboarding AND Settings. Props {onDone,onBack}.
                                    # R1.5 PROGRESSIVE DISCLOSURE: the wrap-step field groups (the viewerMethod!=='pin'
                                    # "Name this viewer" group AND the viewerMethod==='pin' PIN/confirm groups) are gated
                                    # on `activeKey` — token + passphrase resolve FIRST, device protection appears after.
                                    # Safe because viewerCanDone already requires !!activeKey (probe/wrapSecretKey/
                                    # handleViewerDone byte-identical). R1.5 LAYER-HONEST COPY: the PIN label reads
                                    # "Create a PIN for this device" + a hint naming the two layers ("it is not the
                                    # owner's passphrase, and the owner never needs it") — the viewer's DEVICE PIN and the
                                    # owner's HANDOFF PASSPHRASE ("Passphrase (from the owner)") must never be conflated
    SecretKeyCard.tsx               # Phase 1.5 — SHARED blurred-nsec recovery-key card: bech32 nsec in --mono
                                    # (word-break), blurred by default (tap-to-reveal pill) + one-tap Copy
                                    # (flash "Copied ✓") + "Best kept in a password manager." Props {nsec,onCopied?}.
                                    # Presentational, never logs the key; reused by Access P2's Reveal-recovery-key
    ViewerUnlockGate.tsx            # Phase 3 viewer-key gate — unlock (wrapped) / one-time wrap-setup (v17 migrant);
                                    # populates viewerSync's in-memory holder. Reuses NostrAuthGate.module.css
    PlanLoadingGate.tsx            # 5e (F1) — the owner's twin of ViewerWaitingGate: "Loading your plan…" in place of the
                                    # red flash while the session's first pull brings the plan and then the journal (AppShell's
                                    # branch between gates F and G, `signedInApp && planLoading.up`). At 15 s (`slow`) it adds
                                    # "Still loading — your relays or signer are slow." and "Open the app" (openTheApp —
                                    # the screen goes for the session; the pull carries on). Display only: 5c refuses the
                                    # writes. Reuses NostrAuthGate.module.css. Tested in firstPull.test.ts (ESCAPE, GATE)
    ViewerWaitingGate.tsx          # Data-remanence guard — "Waiting for the owner's data…" until viewerDataLoaded
                                    # (valid decrypt) + "Reset viewing key" escape (a revoked/rotated-out viewer
                                    # isn't trapped → reset re-enters the onboarding fork → reconnect with a new
                                    # token). Handoff v4 PASTE-ONLY: the send-your-npub/"Copy my npub" affordance is
                                    # RETIRED (owner mints the key; viewer only pastes a token) — no getViewerNpub here
    AppUnlockGate.tsx              # ⚠ UNRENDERED (user-facing encryption reverted) — retained for Option-3a. Was:
                                    # Face ID / PIN → deriveStoreKey (keyed on writerKeyWrapMeta.scheme) → setStoreKey
                                    # + useStore.persist.rehydrate() → decrypt the blob. NOT imported by AppShell now
    StoreMigrationGate.tsx         # ⚠ UNRENDERED (user-facing encryption reverted) — retained for Option-3a. Was:
                                    # mode='encrypt'|'decrypt' migration gate (encrypt→migratePlaintextToEncrypted;
                                    # decrypt→migrateEncryptedToPlaintext→clear flag+marker→reload). NOT imported now
  hooks/
    useNostrAutoRestore.ts          # Optimistic session restore on reload — NIP-07 AND NIP-46 (via nostrLogin).
                                    # 'local' is SKIPPED here (no optimistic auth — LocalUnlockGate drives unlock).
                                    # RETRIES the syncNow restore ONCE (1.5s gap) before flipping isAuthenticated(false)
                                    # — defense-in-depth for the async window.nostr injection race (a slow extension
                                    # inject can outlast restoreSigner's own 3s wait). Only a genuinely-null signer
                                    # flips auth off; a failed sync with a live signer does not
  lib/crypto/
    crypto.worker.ts                # Phase 2a — the codebase's FIRST dedicated module Web Worker. Runs nip49's ~1s of
                                    # SYNCHRONOUS scrypt OFF the main thread so unlocking an encrypted key / producing an
                                    # encrypted backup never freezes the UI. `declare const self: DedicatedWorkerGlobalScope`
                                    # (mirrors sw.ts); imports ONLY nostr-tools/nip49 + classifyNcryptsecError (small chunk).
                                    # Two ops: nip49encrypt (payload = TRANSFERRED sk copy → result string) / nip49decrypt
                                    # (ncryptsec+pass → TRANSFERRED sk copy). ⚠ Zeroes every received/derived key buffer in
                                    # `finally`; classifies decrypt errors INSIDE the worker and posts only the STRING
                                    # ('malformed'|'passphrase'|'generic') — NEVER e.message (bech32 echoes key material).
                                    # Compiled by tsconfig.worker.json (WebWorker lib), excluded from tsconfig.app.json (the
                                    # sw.ts pattern). Vercel builds it via vite build (worker chunk, precache-manifested)
    cryptoClient.ts                 # Phase 2a — the client for crypto.worker.ts. Feature-detects module-worker support once
                                    # (typeof Worker); spawns `new Worker(new URL('./crypto.worker.ts', import.meta.url),
                                    # {type:'module'})` — the precache-safe form ONLY. On no support / worker error /
                                    # onmessageerror / 30s op timeout → terminate + mark unavailable for the SESSION + re-run
                                    # the op via the SYNCHRONOUS in-thread nip49 FALLBACK (identical I/O — worst case = pre-2a
                                    # status quo). API cryptoClient.nip49Encrypt(sk,pass,logn?)→Promise<string> /
                                    # nip49Decrypt(ncryptsec,pass)→Promise<Uint8Array>. ⚠ INTERNAL-COPY CONTRACT: .slice()s
                                    # `sk` and transfers/uses THE COPY, so the caller's buffer is never neutered → every
                                    # caller-side `finally { sk.fill(0) }` keeps working verbatim. Both paths surface failures
                                    # as a `CryptoError` carrying `.kind` (classification centralized here + in the worker), so
                                    # call sites read one shape. Pure node-testable exports (CryptoError / classifyWorkerFailure
                                    # / encode{Encrypt,Decrypt}Request / the message types) — the worker itself is device-gated,
                                    # not unit-tested (tests force the fallback since node has no Worker). ⚠ ONLY nip49 crosses
                                    # the boundary — NIP-07/NIP-46 signers can't; sync.ts/viewerSync.ts nip44 (single-op, no
                                    # freeze) + keyVault WebAuthn-PRF (gesture-bound) stay on the main thread by design.
                                    # ⚠ Phase 2 CLOSED at 2a — 2b (worker NIP-44 fan-out batching) DESCOPED on grounded
                                    # evidence: nip44 is µs-scale symmetric crypto and batching would require resident raw-sk
                                    # (a key-hygiene regression); NSecSigner remains the sole key holder
  lib/nostr/
    syncEngine.ts                   # Phase 1b — the publish/orchestration ENGINE, extracted VERBATIM (move-only, zero
                                    # behavior change) from useStore.ts. Owns: publishRecordsNow (400ms trailing debounce) ·
                                    # publishRecordsNowImmediate · publishPlanEventsNow + schedulePlanPublish (4c, 2s) ·
                                    # publishPrefsNow + schedulePrefsPublish (4c, 2s) · checkPlanParity / getPlanParity ·
                                    # importRelaysFromNip65 · publishRelayListToNip65 · publishViewerSnapshotNow (fan-out) ·
                                    # flushViewerRevocations · publishViewerRevocationNow, plus the module debounce timers.
                                    # Phase 4e RETIRED publishSettingsNow + scheduleSettingsPublish + its timer (the
                                    # settings:v1 bridge); the plan publish's success now chains publishViewerSnapshotNow +
                                    # flushViewerRevocations directly, then checkPlanParity() — pinned at the relay layer by
                                    # lib/nostr/__tests__/bridgeRetired.test.ts (RETIRED · CHAIN · SEED · RETRY · PLAN
                                    # SYNCED). STATICALLY imports
                                    # useStore + ./publish (the store's 5 former DYNAMIC publish imports are now ordinary static
                                    # imports here) + ../../store/payloads + ./relays + ./log + ./timeout + ../backupGate.
                                    # ⚠ useStore MUST NOT statically import this (store→engine is dynamic-only; the :syncNow
                                    # precedent) — a static back-edge is an instant cycle. remotePlanFoundResolved latch does
                                    # NOT live here (stays in useStore with recordRemotePlanFound)
                                    # 5b: publishRecordsNowImmediate runs in the journal lane (journalState) — before the
                                    # session's journal pull, records:v1 only (recordsDirty stays); after it, publishJournal:
                                    # the changed pages one at a time, then the manifest (the relays' copies + carried
                                    # listings), then the records:v1 bridge (whole while ≤ 40,960 B plain, else the stub;
                                    # best-effort) — every one newer than every journal event the device has seen
                                    # (known.seenAt + 1: a device whose clock runs behind still lands). recordsDirty clears
                                    # only if the journal is unchanged (reference test). refusedForSize(channel): a
                                    # PayloadTooLargeError clears the channel's dirty flag and never raises Reconnect
                                    # 5c: while planLoad.planMissing — a signed-in owner device that hasn't loaded the
                                    # plan — publishPlanEventsNow and publishRecordsOnce return false with lastRefusal
                                    # 'held' (heldWithoutPlan(channel)) before setNostrSyncing, the dirty flags kept (the
                                    # sync after the plan loads sends them); publishViewerSnapshotNow returns; and
                                    # publishRelayListToNip65 holds (this device's list isn't the plan's yet)
    publish.ts                      # publishEncrypted (→ Promise<number>), publishRecords (RecordsPayload
                                    # v2 — P3 += dayLog + dayLogDeletions, REQUIRED). The d-tags: RECORDS_DTAG /
                                    # PLAN_EVENTS_DTAG / PREFS_DTAG + viewerDTag(pubkeyHex) — Phase 4e DELETED
                                    # SETTINGS_DTAG and publishSettings (settings:v1 is retired). ViewerSnapshot += optional cbCollateralBtc (P3 BUG2 scalar) + strikeCollateralBtc (C-P4 scalar, trusted-only) + coldStorageBtc (the cold ledger's derived total, trusted-only) + strikeLastDepositISO (the plan of record's Run 2, D9 — the latest logged Strike deposit date, trusted-only).
                                    # P2: publishRelayListNip65(signer,_pubkey,relays,publishTo?,opTimeoutMs?) — a PLAIN
                                    # (unencrypted) kind-10002 relay list (flat r tags, no read/write markers); MUST NOT
                                    # route through publishEncrypted/signer.nip44 (10002 is public). Both share the
                                    # private publishSignedToRelays tail (now QUORUM-ACK min(2,pubs.length) via the pure
                                    # exported awaitAckQuorum, was first-ack; gains a `label` param + records a PublishReport;
                                    # 12s-timeout, pool close after allSettled) — extracted from publishEncrypted, whose
                                    # signature is unchanged. Exports awaitAckQuorum + PublishReport + getPublishReports (ring
                                    # buffer, last 30 — 5b: one journal publish can be several) for DevPanel PUBLISH ACKS + Copy Diagnostics (metadata only).
                                    # Phase 4a-inst: PublishReport += eventBytes/plainBytes (real byte lengths via a
                                    # TextEncoder byteLen helper, NOT String.length — additive-only, no publish/quorum
                                    # logic change)
                                    # 5b: publishEncrypted calls guardPayload(dTag, plainBytes) first — past 40,960 B plain
                                    # it throws PayloadTooLargeError before any encrypt or sign; an optional minCreatedAt
                                    # floor (publishRecords passes it through). ownLatestEventId(dTag): the id this device
                                    # last signed per d-tag (the live sub skips its own echo)
    payloadSize.ts                  # 5a — PURE (imports only PLAN_LOG_BUDGET_BYTES from ../planEvents/compact): a relay
                                    # payload judged where NIP-44's padding steps sit. PLAIN_STEP_BYTES 40,960 (the largest
                                    # plain JSON whose padded event stays under 64 KiB; 40,961 B pads to 49,152 → ~66 KB on
                                    # the wire) · WIRE_WARN_BYTES 60,000 (the old wire budget, for a report with no plain size —
                                    # the public kind-10002 list) · payloadSizeLevel({ eventBytes?, plainBytes? }) → 'over'
                                    # past the step / 'near' past the plan log's 32,768 B budget / 'ok' (takes a PublishReport
                                    # as is). Read by DevPanel's size rows. Pinned by __tests__/payloadSize.test.ts (PADDING —
                                    # the step, against nostr-tools' own NIP-44 · TINT · DEVPANEL)
    journalPages.ts                 # 5b — PURE (+ WebCrypto SHA-256): the journal's v2 layout. One page per calendar month
                                    # (records:v2:<YYYY-MM>, '.2'… past JOURNAL_PAGE_BUDGET_BYTES 32,768; 'undated' for a
                                    # date that isn't YYYY-MM or YYYY-MM-…), items in a fixed order; the manifest (records:v2:manifest — every
                                    # page's {n, h} + the tombstones); fingerprint = 16 hex of SHA-256 over canonicalJson;
                                    # the readers (parseV1Records — every v1 form, parseManifest, parsePage); unionParts
                                    # (the relays' parts as ONE state, tombstones not applied: the pull's single merge
                                    # applies them and the TTL once, as before 5b);
                                    # pagesToFetch / pagesToPublish / relayListing; the records:v1 bridge (V1_STUB,
                                    # v1BridgeTarget); journalSizes (DevPanel). Pinned by __tests__/journalPages.test.ts
    journalState.ts                 # 5b — store-free session state: what this device knows the relays hold (page
                                    # listings, the manifest's fingerprint, unreadable listings, the bridge, seenAt — the
                                    # newest created_at seen, the publishes' floor), keyed by pubkey, never persisted; the
                                    # last relay check (DevPanel); inJournalLane — every journal pull and publish runs in
                                    # one lane; journalIdle (tests)
    syncGuard.ts                    # 5b — store-free: guardPayload (refuse past PLAIN_STEP_BYTES, record the d-tag; a
                                    # payload that fits clears it) · PayloadTooLargeError · channelOf · the blocked-channel
                                    # registry (getBlockedChannels — stable for useSyncExternalStore, subscribeBlocked,
                                    # pruneBlocked, getBlockedDTags)
    firstPull.ts                    # 5e (F1) — store-free: the session's first plan pull for the "Loading your plan…"
                                    # screen. 'idle' → 'running' (firstPullStarts(s), only when planMissing(s) holds at the
                                    # pull) → 'settled' (firstPullLands — the pull returned, with a plan, nothing or failed,
                                    # or threw), one way, once a session. Its own state, not 5c's: planLoaded and the pull's
                                    # status settle when the PLAN applies, before the journal — and the red flash lived in
                                    # between. The screen is up while 'running' && !released && !appOnScreen; a 15 s timer
                                    # adds `slow` ("Open the app" → openTheApp releases it); markAppOnScreen (AppShell) keeps
                                    # a first pull that starts later (an unlock path that doesn't sync, Reconnect, the
                                    # ceremony's wake) from ever raising it. getPlanScreen / subscribePlanScreen for
                                    # usePlanLoading; resetFirstPull for tests. Writes nothing; 5c untouched. Tested in
                                    # firstPull.test.ts (SHOWN, LANDS, ONCE, HOLDS, LATE, ESCAPE, GATE) and
                                    # firstPullFresh.test.ts (5c FRESH)
    planLoad.ts                     # 5c — store-free. THE RULE: a signed-in owner device writes nothing that depends on
                                    # the plan — no day event, no monthly-log write, no plan edit, no plan, journal, viewer
                                    # or relay-list publish — until it holds the plan: it applied the relays' plan, a
                                    # backup was restored on it, it minted the key, or its owner chose "Start a new plan"
                                    # after a pull found nothing. Never inferred from an empty pull. planMissing(s) =
                                    # nostrAuthEnabled && !viewerMode && !planLoaded; refuseWithoutPlan(s, what) — the store
                                    # guard ("<what> refused — this device hasn't loaded the plan", metadata only); the
                                    # last plan pull (PlanPull: pending · applied · none · unreachable · unreadable — decrypt
                                    # / parse / shape / apply / not-reached / absent), session state with listeners
                                    # (usePlanPull); errorName — a log names an error, never quotes its message (a
                                    # JSON.parse message can quote the payload). Pinned by store/__tests__/
                                    # planLoadGuard.test.ts and __tests__/planLoadPull.test.ts
    relayLimits.ts                  # 5b — the DevPanel probe: nip44PaddedLen / nip44PayloadLen (pinned against nostr-tools'
                                    # NIP-44), fetchRelayInfo (NIP-11), probeRelaySizes (a one-time key, the probe d-tag,
                                    # three sizes, every relay's answer). Pinned by __tests__/relayLimits.test.ts
    keyVault.ts                     # identity-agnostic encrypted-key vault (PRF/Face-ID primary, PIN fallback;
                                    # PBKDF2→HKDF→AES-GCM via WebCrypto; wrap/unwrap/probe; key in MEMORY only,
                                    # never persisted). Shared infra: writer local-key now, viewer key later.
                                    # Phase A at-rest store enc (primitives only, NO store wiring): deriveStoreKey
                                    # derives an INDEPENDENT AES key from the SAME unlock via a distinct HKDF info
                                    # (STORE_ENC_INFO='personal-bloc/store-enc/v1') — one Face ID/PIN, two keys;
                                    # + encryptBlob/decryptBlob (AES-GCM string blob, random IV). deriveAesKey
                                    # gained a defaulted `info` param (nsec-wrap path byte-identical). Phase B wires
                                    # these into the persist adapter (lib/store/storeCrypto.ts) behind a flag.
                                    # 3a.1: deriveStoreKeyFromNsec(sk, pubkeyHex) — derives the store key from the
                                    # NSEC ITSELF (HKDF: salt=SHA256(pubkeyHex), info=STORE_ENC_INFO), no separate
                                    # credential. Deterministic + stable across reinstalls; independent from the
                                    # nsec-WRAP key (distinct info); copies sk (never mutates caller). In memory only.
                                    # R2a-2: WrapMeta gains `payloadKind?: 'sk' | 'nip06-entropy'` — ⚠ ABSENT MEANS
                                    # 'sk' (see § Recovery-key payload kinds). wrapSecretKey's first param is renamed
                                    # `payload` + gains a DEFAULTED 5th positional `payloadKind` (recorded on every
                                    # wrap; 5th-positional, not an options object, so the 4-arg call sites + their
                                    # arity-exact toHaveBeenCalledWith assertions in establishOwner.test.ts stay valid).
                                    # The old unwrap body is extracted VERBATIM into a private decryptWrapped() so both
                                    # readers share ONE auth flow (one Face ID prompt / one PBKDF2 run). unwrapSecretKey
                                    # KEEPS its return contract (ALWAYS the 32-byte secret key; derives via
                                    # deriveSkFromEntropy + zeroes the intermediate entropy when the payload is entropy).
                                    # unwrapRecoveryPayload → {payloadKind, bytes} returns the payload AS STORED (caller
                                    # zeroes) — R2c-1 gave it its FIRST TWO consumers: RecoveryKeyCeremony (reveal) +
                                    # RevealRecoveryKey (both branch on payloadKind to show words vs nsec). Imports nip06Key
                                    # (one-way; nip06Key never imports keyVault). Entropy adoption at keygen shipped in R2b-1
    nip06Key.ts                     # R2a-2 — NIP-06 plan-key derivation, the BIP-39 foundation for R2c's word-quiz
                                    # backup ceremony. PURE, node-testable, imports NOTHING from keyVault (keyVault
                                    # imports THIS — one-way, no cycle). PATH m/44'/1237'/0'/0/0, ACCOUNT 0, NO BIP-39
                                    # passphrase (nostr-tools privateKeyFromSeedWords defaults) — both pinned by the
                                    # published-vector test; ⚠ changing either silently derives a DIFFERENT key from the
                                    # same words = undetectable permanent data loss. ENGLISH WORDLIST ONLY (v1) — the
                                    # words are a written-down recovery artifact, so the language is part of the contract;
                                    # widening it later is additive to skFromWords, never a re-derivation.
                                    # ENTROPY_BYTES 16 (128-bit → 12 words); wordsFromEntropy / deriveSkFromEntropy /
                                    # skFromWords (normalizes trim+collapse-whitespace+lowercase, then validateWords —
                                    # which RETURNS FALSE rather than throwing, so the check must be explicit) /
                                    # entropyFromWords (R2c-4b — the exact INVERSE of wordsFromEntropy; what the words-IMPORT
                                    # path wraps. Shares ONE private normalizeWords+assertValidWords contract with skFromWords
                                    # so the two doors can't drift. IDENTITY-SAFE: deriveSkFromEntropy(entropyFromWords(w)) ===
                                    # skFromWords(w) — the property the whole import flip rests on, pinned by test. ⚠ Validates
                                    # BEFORE decoding and rethrows ANY decode failure as InvalidSeedWordsError, because
                                    # mnemonicToEntropy bottoms out in @scure/base's alphabet decoder which throws
                                    # `Unknown letter: "<word>"` — it INTERPOLATES THE SEED WORD, which this module forbids;
                                    # the try/catch makes that leak structurally impossible. Caller zeroes the buffer) /
                                    # generatePlanKey() → {entropy, words, sk, pubkeyHex}. skFromWords is NO LONGER app-orphaned
                                    # (R2c-7b: RecoveryKeyCeremony's encrypt path calls it to re-derive the sk FROM THE DISPLAYED
                                    # WORDS rather than retain the entropy bytes) — and it remains the published-vector-pinned
                                    # canonical derivation + the LHS of the identity equality.
                                    # InvalidSeedWordsError is the
                                    # repo's FIRST Error subclass (everything else throws bare `new Error`); the UI catch
                                    # blocks render e.message verbatim, so the message is user-facing prose and must NEVER
                                    # interpolate the words. ⚠ THE WORDS STRING IS A TRANSIENT SECRET — a JS string cannot
                                    # be zeroed; never persist/log it or hold it in state outliving its screen. The
                                    # ZEROABLE forms are entropy (16B) + sk (32B): CALLERS OWN ZEROING BOTH
    establishOwner.ts               # Phase 1.5 — establishLocalOwner(payload, method, nostr, opts?): the SINGLE local-owner
                                    # establish path (wrap→persist writerKey→NSecSigner+setNostrSigner→markSignerFresh→
                                    # setNostrPubkey(getPublicKey(sk))→setNostrSigningMethod('local')→fire-and-forget
                                    # syncNow→setIsAuthenticated(true)→zero). Extracted VERBATIM from NostrAuthGate's
                                    # import body → BOTH the import path AND OwnerKeySetup K3 call it (zero drift).
                                    # R2b-1: opts gains payloadKind?:PayloadKind (default 'sk' → nsec-import/legacy path);
                                    # it is forwarded as wrapSecretKey's 5th arg. R2c-4b: NostrAuthGate now PASSES it —
                                    # 'nip06-entropy' on the words branch, 'sk' on the nsec branch. establishOwner itself
                                    # needed NO change (it already derived the sk from an entropy payload internally).
                                    # ⚠ The signing sk is DERIVED from the payload it just WRAPPED (payload for 'sk';
                                    # deriveSkFromEntropy(payload) for 'nip06-entropy'), NEVER accepted from the caller — so
                                    # the identity we authenticate as is provably the one unwrapSecretKey later re-derives
                                    # from this exact ciphertext (a caller-supplied sk could silently disagree → the wrapped
                                    # key would never unlock the identity). Zeroes BOTH the caller's payload AND the derived
                                    # sk. ⚠ NEVER logs key material. NostrSigner from './signers' (sibling re-export)
    viewerKey.ts                    # Viewer-key derivation — deriveViewerKeyFromNsec(sk, ownerPubkeyHex, keyVersion, index)
                                    # → deterministic 32-byte viewer secret key. M2: 4-ARG, PER-SLOT-INDEXED. WebCrypto
                                    # DIRECTLY (crypto.subtle), NOT keyVault's helpers/info labels (own crypto domain).
                                    # HKDF-SHA256: ikm=owner sk, salt=SHA-256(utf8(ownerPubkeyHex)),
                                    # info=`personal-bloc/viewer-key/v${keyVersion}/i${index}`, deriveBits 256; if
                                    # out-of-range (~2^-128) append `/${counter}` to info + re-derive (validity gate =
                                    # getPublicKey try/catch, no extra deps). Deterministic in (ownerSk, ownerPubkeyHex,
                                    # keyVersion, index) → the owner regenerates the SAME viewer nsec for that slot anytime
                                    # (no separate backup). The index makes every roster slot's key distinct at the same
                                    # keyVersion; keyVersion is per-slot (rotation bumps it). Does NOT mutate sk; returns a
                                    # fresh array the caller zeroes. ⚠ Never logs/persists key material
    handoffToken.ts                 # Viewer handoff v3 — buildHandoffToken(keyPart, ownerNpub) → `<keyPart>:<ownerNpub>`
                                    # + parseHandoffToken → {kind:'nsec'|'ncryptsec', keyPart, ownerNpub} (ownerNpub NON-NULL).
                                    # PURE (nip19 bech32 only, NO crypto): trim, split on ':' (EXACTLY 2 parts required — bare
                                    # nsec / anything not 2-part → null, bare-nsec back-compat RETIRED), classify keyPart by
                                    # prefix, validate the npub half decodes as npub. Owner builds it in SharingPage (keyPart =
                                    # nip49.encrypt(derived,passphrase) or nip19.nsecEncode); viewer parses + nip49.decrypts it
                                    # in ViewerLoginFlow
    session.ts                      # restoreSigner(nostr, pin?) — rebuild signer from persisted login (no fetch/sync);
                                    # exports NostrParam. P0: `pin` is supplied ONLY by the unlock UI for a
                                    # scheme:'pin' key (LocalUnlockGate / NostrAuthGate #6) and forwarded to
                                    # unwrapSecretKey(wrapped, meta, pin) — which already accepted it, and ignores it
                                    # for a PRF key, so the passkey path is byte-identical. Without it keyVault threw
                                    # 'PIN required' and a PIN-fallback user was locked out after every reload.
                                    # SINGLE-FLIGHT (Bug 2 fix): the public restoreSigner wraps doRestoreSigner in a
                                    # module-level in-flight promise (mirrors syncNow) — concurrent callers (gate escape
                                    # + reactive syncNow) share ONE WebAuthn ceremony + the SAME signer; two ceremonies
                                    # at once aborted one (AbortError) + looped the other (NotAllowedError).
                                    # ⚠ THE GUARD IS PIN-AWARE: a pin-bearing call NEVER joins a pinless in-flight
                                    # restore (that one is doomed for a pin-scheme key → a correct PIN would report
                                    # failure); every other combination shares as before. PRF never passes a pin, so
                                    # two PRF callers always match and always share → WebAuthn single-flight intact.
                                    # The `.finally` has an ownership check so a superseded promise can't null its
                                    # replacement's slot. A boolean is held at module scope, never the pin.
                                    # 'local' branch: [#5: re-read LIVE nostrSigningMethod right BEFORE unwrap — if it
                                    # flipped off 'local' (a nip46 login racing auto-restore on a device with a leftover
                                    # wrapped key) RETURN the current signer, no WebAuthn, no spurious passkey prompt] →
                                    # unwrapSecretKey (→ Face ID) → new NSecSigner(sk) → pubkey-match →
                                    # [3a.1: storeEncEnabled ? deriveStoreKeyFromNsec(sk,pubkey)→setStoreKey, AFTER the
                                    # pubkey check, BEFORE sk.fill(0); + 3a.3: await migratePlaintextToEncrypted()
                                    # (verify-before-delete, idempotent) then + 3a.2: await useStore.persist.rehydrate()
                                    # (key now available → migrate plaintext→envelope, then decrypt + load real data);
                                    # flag-gated (OFF=no-op, byte-identical login) + try/catch NON-FATAL so login never
                                    # breaks] → sk.fill(0).
                                    # nip07 branch AWAITS waitForNostrExtension() (exported; polls window.nostr every
                                    # 100ms up to 3s) before throwing 'no extension' — extensions inject window.nostr
                                    # ASYNCHRONOUSLY on load, so a refresh that runs the restore effect first must wait,
                                    # else it silently logs the user out (fixed). Fails fast if genuinely absent
    log.ts                          # nostrLog ring buffer — pure; console mirror + sessionStorage 'bloc-nostr-log'
                                    # (50 entries, survives reloads, dies with the PWA); the STANDARD for
                                    # Nostr-layer logging — use it instead of bare console.warn
    timeout.ts                      # withTimeout + signerOpTimeout — pure (store-free); method-aware signer-op
                                    # timeouts: nip46 20s / nip07 + local 60s (human approval popup / Face ID)
    deviceTag.ts                    # getDeviceTag/getDeviceLabel — pure; stable per-device 4-hex tag
                                    # (localStorage 'bloc-device-tag', NEVER synced) → 'iOS-a3f2' etc.;
                                    # used in the nostrconnect name + DevPanel/diagnostics
    proxyAuth.ts                    # NIP-98 client token cache for the Strike proxies — getProxyAuthHeader(url,
                                    # method, signer) → nip98.getToken (kind-27235, Authorization: Nostr <base64>),
                                    # cached ~50s per (url,method) in-memory so NIP-46 doesn't round-trip per 60s
                                    # poll. resetProxyAuthCache() is test-only. See NIP-98 Proxy Auth
    recoveryInput.ts                # R2b-2 + R2c-7a — PURE, zero imports. classifyRecoveryInput(raw) →
                                    # {kind:'nsec'|'encrypted'|'words'|'unknown'}. SHAPE ONLY, never validity:
                                    # `ncryptsec1` prefix → encrypted (NIP-49; the caller collects a passphrase and
                                    # decrypts); `nsec1` prefix → nsec; else exactly RECOVERY_WORD_COUNT (12) whitespace
                                    # tokens → words (collapsed to single spaces); else unknown. All prefixes are
                                    # case-sensitive (bech32 is lowercase). ⚠ ncryptsec1 is checked first for
                                    # READABILITY, not because the prefixes collide — they diverge at char 2 (`ns` vs
                                    # `nc`) so `'ncryptsec1'.startsWith('nsec1') === false`; a test pins that so a future
                                    # prefix edit can't quietly introduce a collision. nip19.decode / nip49.decrypt /
                                    # nip06Key own their own verdicts, so 12 nonsense tokens classify as `words` and are
                                    # rejected downstream with a real message. ⚠ Do NOT add validation here — it would
                                    # duplicate (and drift from) three separate crypto contracts. ⚠ It also has NO ':'
                                    # logic and NO ncryptsec shape check — those live in ncryptsec.ts + NostrAuthGate
    ncryptsec.ts                    # R2c-7a-fix — PURE, zero imports. The two layers that let the Recovery-key tab
                                    # fail HONESTLY. Exists because nip49 exports only encrypt/decrypt (no shape check)
                                    # and decrypt runs ~1s of SYNCHRONOUS scrypt before it can tell you anything.
                                    # LAYER 1 isWellFormedNcryptsec(s) — prefix + exact NCRYPTSEC_LENGTH (162) + bech32
                                    # charset. No crypto → safe per keystroke. Gates whether the passphrase field even
                                    # appears, so a malformed payload is never blamed on the passphrase. Rejects a
                                    # `:npub` handoff-token suffix, truncation, a bare nsec, newline damage. ⚠ Does NOT
                                    # verify the CHECKSUM (that would need bech32 from @scure/base — NOT a direct dep),
                                    # so a 1-char typo passes → LAYER 2. 162 is deterministic: the payload is fixed-width
                                    # (1+1+16+24+1+48 = 91 bytes → 146 words → 9+1+146+6), and `logn` is one byte OF it.
                                    # LAYER 2 classifyNcryptsecError(e) → 'malformed' | 'passphrase'. nip49.decrypt runs
                                    # every structural check (bech32 → prefix → version) BEFORE scrypt, so only the final
                                    # AEAD step can fail on the passphrase: 'invalid tag' ⇒ passphrase, everything else
                                    # ('Invalid checksum in …', 'Unknown letter: …', 'invalid prefix …', 'invalid
                                    # version …') ⇒ malformed. ⚠ POSITIVE TEST on 'invalid tag' DELIBERATELY — if a dep
                                    # renames it we degrade to calling a wrong passphrase "malformed" (confusing, never
                                    # imports a key); the inverse default IS the R2c-7a bug. ⚠ NEVER render e.message:
                                    # bech32 echoes the ENTIRE ncryptsec into it (and 'Unknown letter' the offending
                                    # char) — same leak class as entropyFromWords
    sync.ts                         # applyRemoteEvent — THE single apply path for a remote plan or prefs event (both transports);
                                    # fetchAndSync → { ok, planFound } (R2b-2; was a bare boolean). `ok` = decrypt health
                                    # (breaks loop on first decrypt fail). `planFound` = latestByDTag.size > 0 — computed
                                    # BEFORE the decrypt loop from a map whose keys can only be the four owner d-tags (5b: + the manifest) (the
                                    # query filters authors+#d — records, plan-events, prefs since 4e, the v2 manifest since 5b — and the build loop
                                    # `continue`s on a missing d-tag), so it means "an owner plan exists on the relays" and
                                    # stays TRUE when ok=false. ⚠ An unreachable signer must NEVER be reported as "no plan
                                    # found"; 4e: a key whose relays hold only a pre-4c settings:v1 reads "no plan found";
                                    # the plan-events branch (union + fold → applyPlanFold, RAW, unfiltered) · the prefs
                                    # branch (hydratePrefs, prefs watermark). 5b: the journal is read as ONE unit by
                                    # pullJournal (records:v1 + the v2 manifest → the changed pages, every page on the
                                    # session's first pull, one retry → mergeRecords into the journal as it is NOW → the known
                                    # state → behind? dirty + repair; lazy migration with no manifest); pullJournalNow +
                                    # scheduleJournalPull (1.5 s) for the live sub. Does NOT manage the reconnect flag
                                    # 5c: applyRemoteEvent records the plan's outcome (planLoad.recordPlanPull) — applied
                                    # (+ setPlanLoaded(true)), or unreadable and why: decrypt (still returns false — a
                                    # signer failure; the loop breaks, Reconnect as before), parse (not JSON), shape (no
                                    # events array), apply (the union or the fold threw). Those logs carry errorName +
                                    # plainBytes, never the payload ("payload parse failed (skipped)" is retired here). An
                                    # applied plan past PLAIN_STEP_BYTES (only a build before 5a sends one) → planDirty +
                                    # publishPlanEventsNow: republished trimmed. fetchAndSync settles the rest when no plan
                                    # event came back: no relay answered (pool.listConnectionStatus — a relay that failed to
                                    # connect leaves the map) → unreachable; a journal (records:v1 or the manifest) →
                                    # unreadable · absent (the device waits; one that holds the plan sets planDirty — it
                                    # puts the plan back, an empty log included); nothing of this key's → none, and the
                                    # device still waits — its owner decides ("Start a new plan"). A plan event the loop
                                    # never reached (a decrypt failure on prefs first) → unreadable · not-reached
    liveSync.ts                     # foreground-only live relay subscription — module singleton (openLiveSync/
                                    # closeLiveSync); transport only — plan and prefs events → applyRemoteEvent; a journal
                                    # event (records:v1 or the v2 manifest, 5b) → scheduleJournalPull, its own echo skipped by
                                    # id; opened on visible, torn down on hidden, fresh since−60s each open; four d-tags
    viewerSync.ts                   # Viewer Access Phase 2 (READ-ONLY) — the mirror of liveSync, but reads the
                                    # OWNER's snapshot (authors:[viewerWriterPubkey], #d:[viewerDTag(myPubkey)] — M2
                                    # per-viewer addressing; getViewerPubkeyHex() computes the viewer's own pubkey from
                                    # the in-memory holder) and decrypts with the VIEWER's key (NSecSigner(...)).
                                    # fetchViewerSnapshot (batch) + open/closeViewerSync (singleton live sub) →
                                    # applyViewerEvent → read-only hydrate (applyViewerSettings — VIEWER_SETTINGS_FIELDS,
                                    # 4e; was hydrateSettings/setMonthlyLog/
                                    # setDeletedMonths/setStrike*); NEVER publishes/dirties. P3/C-P4 (BUG3): raw-sets
                                    # cbCollateralBtc + strikeCollateralBtc (+ the cold total, and — the plan of record's
                                    # Run 2, D9 — viewerStrikeDepositISO = snap.strikeLastDepositISO ?? null, so a
                                    # pre-Run-2 snapshot reads no hold) from snap via ONE useStore.setState — NEVER
                                    # setCbCollateralBtc/emitBalanceReading (they'd inject a reading into the viewer's OWN dayLog);
                                    # the viewer's dayLog stays []. useViewerSync (hook) mounts it on foreground; gated on viewerMode
    syncNow.ts                      # THE single unified sync sequence — all entry points call this (restore-if-needed → relays-if-empty → fetch+merge → initialSettingsPullDone → publish-if-dirty: records, plan, prefs, revocations); honest result (true only if pull AND push-if-dirty succeeded); concurrent calls deduped to one in-flight run. Phase 4e RETIRED genesis (pickPlanFields + the synthesize block) and the settings push. 5b: a channel refused for its size (`refusedForSize`) doesn't raise Reconnect. 5c: nor does a publish HELD because this device hasn't loaded the plan (`heldWithoutPlan`) — the log says "held until the plan loads here, not a signer problem". 5e (F1): it marks the session's first pull for the loading screen — `firstPullStarts` first in the `try`, `firstPullLands` right after `fetchAndSync` returns (before any publish) and in the `finally` — and nothing else changed.
    relays.ts                       # fetchUserRelays; NIP-65 kind:10002 discovery. DEFAULT_RELAYS = the SINGLE
                                    # source for the default relay list (store nostrRelays default + Network "Restore
                                    # defaults" + publish.ts FALLBACK_RELAYS + BOOTSTRAP_RELAYS all reference it — no
                                    # drift). normalizeRelayUrl (trim → prepend wss:// if no scheme → require wss:/
                                    # ws:-localhost → lowercase host → strip trailing slash → null on malformed) +
                                    # addRelay (pure normalize+dedupe+append → {list,error}) for the Network subpage.
                                    # P2: importNip65RelayList(pubkey) — reads the user's kind-10002 and returns a
                                    # DISCRIMINATED {found:true,relays} | {found:false}; UNLIKE fetchUserRelays it does
                                    # NOT fall back to defaults on no-event/empty/error (the caller must distinguish a
                                    # real list from nothing, else Import silently clobbers with the default 3). Flat:
                                    # ALL r tags (no write/read filter), normalize+dedupe, newest event wins; a 10002
                                    # with no usable r tags → {found:true,relays:[]} (distinct from not-found).
                                    # fetchUserRelays is LEFT UNTOUCHED (its sync-bootstrap caller wants the fallback)
    disconnect.ts                   # THREE teardowns + a METHOD-AWARE dispatch (see disconnect.test.ts):
                                    # signOut(method) — the user-facing "get me out of this session" action,
                                    # surfaced as the LAST item of the Settings menu (the conventional, discoverable
                                    # spot) and in the full-mode BrandingDropdown. Dispatch:
                                    #   'local' → signOutLocal()    (key stays on device → LocalUnlockGate)
                                    #   'nip46' → reconnectNostr()  (nostrLogin cleared → NostrAuthGate)
                                    #   'nip07' → disconnectNostr() ⚠ NOT reconnectNostr
                                    #   null    → no-op (viewer / not signed in)
                                    # ⚠ WHY nip07 → disconnectNostr, twice over. (1) reconnectNostr RETAINS
                                    # nostrPubkey, and after its reload useNostrAutoRestore early-returns ONLY for
                                    # 'local' and for (nip46 && !nostrLogin) — a nip07 session falls through to
                                    # setIsAuthenticated(true) → restoreSigner → NLogin.fromExtension(), which an
                                    # authorized extension answers SILENTLY. The user would tap Sign out, the page
                                    # would reload, and they'd still be signed in. It is the ONLY teardown
                                    # auto-restore cannot undo. (2) DESTRUCTIVENESS IS A PROPERTY OF WHAT'S AT
                                    # STAKE, NOT OF THE FUNCTION: a nip07 user has no on-device key (it lives in the
                                    # extension), and disconnectNostr's cleared fields all re-stamp on the next
                                    # login (keyProvenance → 'external' ⇒ isBackupGateSatisfied true by
                                    # construction; backupVerifiedAt is irrelevant to that predicate). Re-login is
                                    # one approval. ACCEPTED DUPLICATION: for nip07 the bottom Sign out ≡ THIS
                                    # DEVICE's "Disconnect" — one act, two framings.
                                    # signOutConfirmMessage(method, scheme) — the copy must match the MECHANISM: a
                                    # PIN-scheme local key is never promised a biometric (the P0 lesson), and the
                                    # nip07 string makes NO identity-retention claim (disconnectNostr clears the
                                    # app-side record; the KEY is safe in the extension).
                                    # The Identity & Security "Sign out" row stays LOCAL-ONLY (it is the in-context
                                    # entry beside its destructive sibling "Remove local key") and calls signOutLocal
                                    # directly. Viewers are excluded structurally (SettingsMain early-returns
                                    # <ViewerSettings/>; a viewer's nostrSigningMethod is null).
                                    # identityForgetConfirmMessage(kind:'disconnect'|'remove-key', neverSynced) —
                                    # PURE copy for the two Settings identity-forget confirms. Both wipe (they route
                                    # through disconnectNostr) so both say so + warn "changes not yet synced will be
                                    # lost". ⚠ neverSynced = !isBackupGateSatisfied(...) (imported, never re-derived):
                                    # a generated + unverified key has had sync gated off since minute one, so the
                                    # relay holds NOTHING and the copy must NOT promise a relay copy — it warns of
                                    # permanent deletion instead. See § Remanence
                                    # signOutLocal (R2c-6b) — NON-DESTRUCTIVE local sign out. Sets
                                    # setNostrAuthEnabled(true) then DELEGATES to reconnectNostr (no duplicated
                                    # clears; reconnectNostr's body is untouched). ⚠ The setter runs BEFORE the
                                    # delegate because reconnectNostr's reload() is its LAST statement and
                                    # navigation ends execution. ⚠ It is an INVARIANT PIN, not dead code: today
                                    # nostrAuthEnabled DERIVES from the retained pubkey (setNostrPubkey sets both in
                                    # lockstep; gateHydratedIdentity pins it true), so it's a no-op — but if that
                                    # derivation ever changes, the line visibly contradicts a regression instead of
                                    # letting sign-out silently become a full logout. Retains identity + wrapped key
                                    # + keyProvenance/backupVerifiedAt → lands on LocalUnlockGate, unlock returns to
                                    # the SAME plan, still verified. Surfaced as "Sign out" in Settings → THIS
                                    # DEVICE (above "Remove local key") and in the full-mode BrandingDropdown, both
                                    # gated nostrSigningMethod === 'local'. ⚠ NOT for nip07/46 — their existing
                                    # "Disconnect" IS their sign-out (the key lives in the extension/bunker); a
                                    # second control would be two words for one action.
                                    # disconnectNostr — the ONE identity-FORGET: clears state, then calls
                                    # wipeLocalPlanData() as its LAST mutation (⚠ a store set() after it re-persists
                                    # the blob), then window.location.reload() to flush NPool. Lands on the fresh
                                    # entry fork. reconnectNostr/signOutLocal deliberately do NOT wipe (§ Remanence)
    signers.ts                      # connectNip07 only (connectNip46/connectNip46QR + SignerContext deleted)
  lib/store/
    storeCrypto.ts                  # At-rest store encryption (Phase B) — in-memory storeKey holder (getStoreKey/
                                    # setStoreKey/isStoreUnlocked, never persisted) + encryptedStorage adapter:
                                    # getItem decrypts the {ct,iv} envelope (locked→null, non-envelope→passthrough),
                                    # setItem encrypts (LOCKED→drops the write, NEVER plaintext). 3a.2: WIRED into
                                    # persist as the `storage` adapter WHEN storeEncEnabled (else plain
                                    # window.localStorage). The held key is the nsec-derived 3a.1 key (set at unlock).
                                    # clearStoreEncryptionState() — TEARDOWN SAFETY: clears ALL FOUR (enc flag +
                                    # pending-decrypt marker + on-disk `personal-bloc-store` blob + in-memory key) so a
                                    # later plaintext-adapter load can't misread a stale {ct,iv} envelope → seeds (the
                                    # "settings revert to defaults" desync). FIRST action of BOTH teardown paths
                                    # (escapeHatch.resetAndResync + wipeLocalPlanData), which reload after
    wipeLocalPlanData.ts            # R2c-6b — wipeLocalPlanData(): void. The plan-data wipe for the IDENTITY-FORGET
                                    # paths (disconnectNostr, which "Remove local key" delegates to). Reuses
                                    # clearStoreEncryptionState() (blob + enc flag + pending-decrypt + in-memory key),
                                    # then removes WK_* + personal-bloc-onboarded + the 3 GATE_* identity keys +
                                    # personal-bloc-provenance (R2c-6-final) + sessionStorage 'bloc-nostr-log'.
                                    # RETAINS the two device-level keys, 'bloc-device-tag' and 'bloc-btc-candles'
                                    # (the price chart's public prices, 5e). ⚠ THE CLASSIFIED KEY INVENTORY IN ITS DOC COMMENT IS THE CONTRACT — a new
                                    # storage key must be classified there; wipeLocalPlanData.test.ts asserts it
                                    # exhaustively. ⚠ personal-bloc-onboarded is standalone, NOT blob-resident: wiping
                                    # only the blob leaves onboardingComplete true → the fresh entry fork never renders
                                    # (the same bug, half-fixed). ⚠ NEVER sweep by 'personal-bloc-' prefix (bloc-device-
                                    # tag / bloc-nostr-log don't carry it). NO reload() inside — callers own ordering.
                                    # NOT called by signOutLocal / reconnectNostr / resetAndResync. See § Remanence
    storeMigration.ts               # migratePlaintextToEncrypted (3a.3: WIRED — restoreSigner calls it inline at
                                    # unlock, between setStoreKey + rehydrate) / migrateEncryptedToPlaintext (still
                                    # unused until 3a.5 opt-OUT). VERIFY-BEFORE-DELETE: never overwrite the source
                                    # until the new blob decrypts back === original; idempotent; use getStoreKey. +
                                    # blobIsPlaintext. Tested (incl. the critical verify-mismatch-keeps-plaintext)
    escapeHatch.ts                  # ESCAPE HATCH — resetAndResync(_nostr?): void. Now RELOAD-BASED (teardown-desync
                                    # fix): clearStoreEncryptionState() (enc flag + pending-decrypt + on-disk {ct,iv}
                                    # blob + in-memory key) → window.location.reload(). The identity (nostrPubkey/
                                    # nostrSigningMethod) is retained, so the NORMAL boot path repopulates: local unlock
                                    # gate → restoreSigner (3a no-op, flag off) → LocalUnlockGate.unlock → syncNow pulls
                                    # from the relay into the clean plaintext slate. Nuking the blob → boot hydrates to
                                    # seeds with an empty plan log → the pull's union + fold applies the relay's plan (no
                                    # watermark gate) and the records merge applies its records (so the bespoke in-line
                                    # pull — resetPlanToSeeds + dirty-clear + watermark-zero + restoreSigner +
                                    # fetchAndSync, and the 'ok'/'no-relays'/'no-auth' returns — was REMOVED; the boot
                                    # path replaces it). Still imports NO publish symbol (structural no-publish
                                    # guarantee preserved); the post-reload boot sync is dirty-gated, so a freshly-pulled
                                    # clean state can't push over real relay data. The `_nostr` param is retained for
                                    # call-site stability (unused). Wired into Settings (RECOVERY button) + LocalUnlockGate
                                    # ("Can't unlock — reset & re-sync"). resetAndResyncConfirmMessage(neverSynced)
                                    # (R2c-6-final, PURE string-only — keeps the no-publish guarantee) backs BOTH confirms:
                                    # a generated-unverified key has no relay copy, so the neverSynced branch warns of
                                    # PERMANENT loss instead of promising "reloads from the relays" (bypass 1 honesty).
                                    # resetPlanToSeeds is now app-orphaned (left as a
                                    # store action). KNOWN FOLLOW-ON: the persist adapter is chosen at MODULE LOAD from
                                    # the enc flag — a mid-session flag change doesn't swap the live adapter; the teardown
                                    # paths nuke+reload to stay coherent, but a structural fix (adapter re-reads the flag
                                    # per op) is deferred

vercel.json                         # Catch-all rewrite → index.html (required for SPA)
```

---

### Publishing Architecture

- `publishEncrypted()` — NIP-44 self-encrypt → kind:30078 → returns the published `created_at` once an
  **ACK QUORUM of `min(2, pubs.length)`** confirms (pubs = the per-relay publish promises, === relays
  normally; deriving from pubs guards the URL-dedup case so quorum can't exceed the actual attempts) (was
  FIRST relay ACK — a single lying/dying relay
  could ACK an event retrievable from NO relay, clearing a dirty flag (`recordsDirty`, `planDirty`, …) and defeating the
  dirty-gated retry; device-confirmed Jul 2026). The shared tail `publishSignedToRelays(signed, relays,
  createdAt, label)` computes the quorum + awaits the pure exported **`awaitAckQuorum(pubs, quorum,
  timeoutMs, onOutcome?)`** (resolves at `acks >= quorum`; rejects the moment the quorum is unreachable
  [`pubs.length - rejections < quorum`, AggregateError of the reasons] or on the 12s timeout ["publish
  timeout — quorum not reached"]; `onOutcome` fires per settle regardless of resolve/reject state, feeding
  instrumentation). ⚠ **nostr-tools 2.23.5 footgun:** `SimplePool.publish` **RESOLVES** a connection
  failure as the STRING `"connection failure: …"` (`pool.js` `ensureRelay` catch → `return String(...)`,
  not a rejection; `maxWaitForConnection` 3000ms), so an offline publish would count as N fake acks at
  ~3001ms and clear the dirty flags. `publishSignedToRelays` NORMALIZES these to rejections via the
  exported `isConnectionFailure` (maps each `pub` to `throw` on the prefix) **before** the quorum — an ack
  counts only a genuine relay OK frame; the normalized rejection flows into `onOutcome`/the PUBLISH ACKS
  panel as a reject row. Genuine relay rejections (inside `r.publish`) already rethrow. Other relays
  continue in the background; pool closes after ALL settle; the watermark isn't stamped for a lost event. Per attempt it records a **`PublishReport`** into a module-level ring
  buffer (last 30 — 5b: one journal publish can be several, `getPublishReports()` — `{label (dTag/kind), createdAt, startedAt, perRelay:[{url,
  status:ack|reject|pending, ms?, err?}], outcome:ok|fail}`; metadata only — no amounts, safe for Copy
  Diagnostics), filled via `onOutcome`, and `nostrLog('warn', …)` when the quorum is met but a relay
  rejected (names the relay). **Phase 4a-inst** adds two optional fields — `eventBytes` (real byte length
  of `JSON.stringify(signed)`, the wire size of the final signed event) and `plainBytes` (real byte length
  of the pre-encryption JSON, set only by `publishEncrypted`; stays absent on the plain `kind:10002` path).
  Both are computed via a `byteLen` helper (`new TextEncoder().encode(s).length`) — deliberately NOT
  `String.length` (UTF-16 code units), since NIP-44's plaintext ceiling is 65,535 real BYTES and this
  instrumentation exists to confirm that budget. Surfaced in DevPanel's PUBLISH ACKS rows (a size suffix)
  and a new PAYLOAD SIZES block in SYNC STATE (newest report per records / plan events / prefs / viewer channel).
  `publishRelayListNip65` (kind-10002) shares the tail → inherits the quorum.
  **`created_at` is PER-D-TAG MONOTONIC** (module-level `lastCreatedAtByDtag`): `createdAt =
  max(floor(Date.now()/1000), last[dTag]+1)`. Second-granularity stamps would let two publishes of the
  same **replaceable** d-tag within one second TIE on `created_at` → NIP-01 tie-break (lowest id) can
  randomly keep the OLDER (incomplete) payload; the monotonic bump makes ties impossible within a session.
  Per-tag counter → records/plan-events/prefs/viewer never interfere (covered for free; `publishRelayListNip65` is a
  separate kind-10002 path, untouched)
- `publishSettingsNow()` / `syncSettingsToNostr()` — **RETIRED at 4e** with the `settings:v1` bridge (§ Phase 4).
  The plan publishes through `publishPlanEventsNow` (plan setters emit via `emitPlanSets`, which marks `planDirty`
  SYNCHRONOUSLY then kicks a 2s debounce — an app close mid-debounce still retries next launch), the prefs through
  `publishPrefsNow` (`emitPrefs`). `publishPlanEventsNow`'s success chains the viewer fan-out + the revocation flush,
  then `checkPlanParity()`
- `publishRecordsNow()` / `publishRecordsNowImmediate()` — exported from the store; publish the v2
  `RecordsPayload` `{ entries: monthlyLog, deletions: deletedMonths, dayLog, dayLogDeletions }`.
  **`publishRecordsNow()` is now a fire-and-forget TRAILING DEBOUNCE (~400ms, module-level
  `recordsDebounceTimer`, like the plan / prefs debounces)** — the log mutators call it standalone (outside
  syncNow), and EventSheet's flow+reading saves as two back-to-back `addDayEvent` calls, so coalescing them
  into ONE publish prevents two same-second publishes of the replaceable records d-tag (the created_at-tie
  bug; belt-and-suspenders with the monotonic `created_at`). State is snapshotted at FIRE time (getState
  inside the immediate fn); `recordsDirty` stays true until the debounced publish succeeds, so an app kill
  mid-debounce self-heals on the next pull (`syncNow` publishes-if-dirty). **`publishRecordsNowImmediate()`
  is the un-debounced variant** (returns the awaited boolean; manages the flags — clears `recordsDirty` +
  `nostrReconnectNeeded` on success, sets `nostrReconnectNeeded` on failure) used by `syncNow` (honest push
  reporting), the sync-repair path, and the viewerMode-gate test; calling it clears any pending debounce
  (an immediate publish supersedes it → no redundant NIP-46 signer op). **Gated on `viewerMode`**
  (`!isAuthenticated || !nostrSigner || !nostrPubkey || viewerMode → return false`, on the immediate fn):
  a read-only viewer IS authenticated with its own nsec, so the auth gate alone wouldn't stop it — the
  `viewerMode` term is the relay-side backstop for the read-only-viewer invariant. The owner has
  `viewerMode===false` so it's unaffected; the owner→viewer snapshot publish (`publishViewerSnapshotNow`,
  gated on `viewerPubkey`) is a SEPARATE path, untouched
- **Repair-on-detect (`sync.ts`):** when a records pull detects the relay is behind
  (`norm(merged) !== norm(remote)` → `setRecordsDirty(true)`), it also fires `void
  publishRecordsNowImmediate()` right there — the gap self-heals immediately instead of lingering until the
  next user action. No loop: a successful publish clears `recordsDirty`, and the next pull's
  `norm(merged) === norm(remote)`
- `FALLBACK_RELAYS`: = `DEFAULT_RELAYS` (damus, primal, nos.lol — relays.ts; used if NIP-65 discovery fails)
- NIP-65 relay discovery: `syncNow` fetches the user's kind:10002 when `nostrRelays` is empty and
  stores it; subsequent publishes go to the user's own relays
- `importRelaysFromNip65()` / `publishRelayListToNip65()` (Network P2) — exported from the store; the manual
  Network-subpage NIP-65 sync. Import calls `importNip65RelayList(nostrPubkey)` and `setNostrRelays` ONLY on a
  real found list (returns `{found,count,empty}` so the UI toasts the right message; absent/empty never overwrites).
  Publish guards `isAuthenticated && nostrSigner && nostrPubkey` and calls `publishRelayListNip65` (PLAIN kind-10002)
  to `[...nostrRelays, ...DEFAULT_RELAYS]` for reach. Both are out-of-band one-offs: they toggle only `nostrSyncing`
  (the orange dot) and DELIBERATELY do NOT touch the dirty flags or `nostrReconnectNeeded` (flipping the
  reconnect flag would mis-fire the ⚠ Reconnect affordance)
- **Network feature COMPLETE** — P1 (local list add/remove/restore), P2 (NIP-65 import/publish), P3 (live status dots
  via `useRelayStatus` — owned NRelay1 probes, `idleTimeout:false`, NOT the NPool; see hooks/useRelayStatus.ts)

---

### Sync Architecture

- **All entry points call the single `syncNow(nostr)`** (lib/nostr/syncNow.ts): restore-signer-if-needed
  (NIP-46 rebuild throttled ~20s, also covers cold-mount restore) → relays-if-empty → fetch+merge →
  publish-if-dirty. Pull-merge-THEN-push — with merge-based receive this is safe and publishes the
  merged superset. The push step covers dirty records (`publishRecordsNowImmediate`), the dirty plan
  (`publishPlanEventsNow`), dirty prefs (`publishPrefsNow`) and pending viewer revocations
  (`flushViewerRevocations`). **Honest result**: returns true ONLY when the pull and every attempted push
  succeeded; `nostrReconnectNeeded` is cleared only on full success and set on any
  signer-attributable failure; logs `'sync ok'` only on true success,
  `'sync incomplete (pull ok|FAILED, records ok|FAILED|skipped, plan ok|FAILED|skipped, prefs ok|FAILED|skipped, revocations ok|FAILED)'`
  otherwise (`skipped` = not dirty — never reported `ok` when nothing was pushed). Concurrent calls are **deduped to a single in-flight run** (AppShell + SettingsMain
  double-mount races share one promise). Auto-restore reverts optimistic auth only if it failed with no signer.
- **INVARIANT — a freshly-authenticated session must complete an initial PULL before it may PUBLISH the
  plan or the prefs; seed/un-established state must NEVER (a) block hydration of real remote data nor
  (b) be published over it.** (Fixes the fresh-install→login data-loss incident + closes parked backlog
  #6 — a seed-default store published defaults over the owner's real relay data.) The gate is the
  session-transient **`initialSettingsPullDone`** (name historical; in-memory, NOT persisted — in the
  `partializeState` exclusion, reset each boot + in `clearViewerData`; never in `SETTINGS_FIELDS`). It is set
  `true` in `syncNow` right after `fetchAndSync` returns (the pull query resolved — whether it applied real
  data or the relay was empty; NOT set if `fetchAndSync` threw).
  - **Fix A — KEPT:** `publishPlanEventsNow` and `publishPrefsNow` refuse before the pull (their own first-line
    gate, and `syncNow`'s `planDirty && initialSettingsPullDone` / `prefsDirty && …`). On the plan channel a fresh
    device's seed is ABSENT from its log (§6), so there is nothing seed-valued to publish anyway; the gate keeps a
    pre-pull edit local until the pull has run (SEED, `bridgeRetired.test.ts`).
  - **Fix B / Fix C / Fix D — RETIRED at 4e** with the `settings:v1` bridge they defended: Fix B relaxed the
    settings hydrate on the first pull (`(!settingsDirty || !initialSettingsPullDone) && remoteTs >
    lastSettingsSyncAt`); Fix C kept `syncSettingsToNostr` from dirtying the seed store before the pull (the
    root fix); Fix D made `publishSettingsNow` refuse a seed-identical payload before the pull (the sentinel).
    Not to be confused with Option C, the relay guard in the retired `hydrateSettings`.
- Deduplicates relay events: takes highest `created_at` per d-tag before
  decrypting (prevents stale relay copies from overwriting fresh data)
- **The journal is read as ONE unit** (5b, `pullJournal`): `records:v1` and the v2 manifest, then the pages whose
  fingerprint differs (every listed page on the session's first pull — the full check). The parts become ONE state
  (`unionParts`: each id's newest copy, each tombstone at its newest, none applied) and merge ONCE through
  `mergeRecords`, as `records:v1` did, into the journal as it is NOW (read again after the fetch; no await before the
  apply): per month, the newest `updatedAt` (fallback `loggedAt`) wins, an exact tie → local iff
  `recordsDirty`; per day event (by id), the higher `ts` wins, an exact tie → local; a tombstone strictly newer than the
  surviving copy deletes it, and a copy at or after its tombstone survives (re-log, edit-after-delete) and drops it;
  90-day tombstone GC. Applied verbatim (`btcHeld` is recorded per entry, never re-chained). If the next publish would
  write anything, `recordsDirty` + the repair. With no journal on the relays, nothing merges. NO receive gates.
- **The plan** applies by union-by-id + fold — order-independent, NO watermark gate (§ Phase 4); **the prefs**
  (`prefs:v1`) apply whole-object via `hydratePrefs` when newer than `lastPrefsSyncAt`. The pull asks for
  `records:v1`, `records:v2:manifest`, `plan-events:v1` and `prefs:v1` (the pages by a second query); a stale
  `settings:v1` that still arrives matches no branch and changes nothing (4e)
- Decrypt-failure surfacing: `fetchAndSync` returns `{ ok: false, planFound }` when an event fails to decrypt
  (signer unreachable) and no longer touches the flag itself — `syncNow` (its sole caller) sets
  `nostrReconnectNeeded` from `ok`; the flag clears only on a fully successful sync.
  Parse failures are data-level skips (logged, no effect on the result)
- Signer-op timeouts are METHOD-AWARE via `signerOpTimeout()` (`src/lib/nostr/timeout.ts`, pure/store-free):
  nip46 20s (automated — rides out one capped relay-backoff window) / nip07 60s (human approval popup per op;
  a short timeout races the user's click). Wraps `nip44` decrypt/encrypt + `signEvent`; the decrypt loop
  **breaks on the first decrypt failure** (remaining events would fail identically). The nip07 RESTORE race
  in session.ts is also 60s. The 12s relay-publish timeout in publishEncrypted is separate and unchanged.
- Orange dot (`nostrSyncing`) shows during both publish and sync operations — hidden while
  `nostrReconnectNeeded` (the reconnect/re-authorize button replaces it at bottom-right)

---

### Live Sync (`liveSync.ts`)

Foreground-only relay subscription so the other device's publishes apply in ~seconds. Principles:
- **Durable state, ephemeral connections** — the sub is disposable: created on foreground, torn down on
  hidden, recreated with a fresh `since` every time. No keepalives, no reconnect state machines.
- **One apply path, two feeds** — every event goes through `applyRemoteEvent` (sync.ts), same as the
  batch pull; batch and live are transports only, zero new semantics. 5b: a journal event (`records:v1` or the
  manifest) schedules the journal pull instead (debounced 1.5 s; the device's own echo skipped by id).
- **Overlap is free, gaps are expensive** — `since = now − 60s` deliberately overlaps the batch path;
  appliers are idempotent/monotonic, and self-echo of our own publishes no-ops naturally (plan-events echo
  unions to identity, prefs echo fails the watermark, the journal's echo is skipped by id).
- **Don't ring a dead phone** — the live handler skips decrypt attempts while `nostrReconnectNeeded` is
  set; the post-re-auth batch sync catches up.

Module singleton (`openLiveSync` idempotent / `closeLiveSync`); opt-in via `useNostrSync({ live: true })`
— ONLY AppShell mounts it live (SettingsMain stays batch-only). EOSE ignored (batch path owns history).
NOTE: at nostr-tools 2.23.5 `SimplePool.subscribeMany(relays, filter, params)` takes a SINGLE Filter,
not an array. It asks for the same four d-tags as the pull — `RECORDS_DTAG` / `JOURNAL_MANIFEST_DTAG` /
`PLAN_EVENTS_DTAG` / `PREFS_DTAG`, exported from publish.ts and journalPages.ts (`SETTINGS_DTAG` was deleted at 4e;
LIVE four pins the filter).

---

### Sync Triggers
Seven entry points — all funnel into `syncNow()` — plus a receive-only live subscription:

| Trigger | Path |
|---|---|
| Login | NostrAuthGate ×3 (NIP-07, bunker URI, NostrConnect QR/deep link) → fire-and-forget `syncNow(nostr)` |
| Cold launch | `useNostrAutoRestore` (optimistic auth, reverts only if restore failed with no signer) |
| Tab visibility | `useNostrSync` visibilitychange → visible |
| Window focus | `useNostrSync` window `'focus'` → triggerSync — a visible desktop tab never fires visibilitychange; focus covers app/window switches |
| Network reconnect | `useNostrSync` window `'online'` → triggerSync (+ openLiveSync when live) — catches an OS-level reconnect that fires neither visibilitychange nor focus. **DESKTOP-ONLY in practice: iOS standalone PWAs NEVER fire `online`** (`navigator.onLine` stays true through an airplane-mode cycle, device-verified Jul 2026) → the dirty-gated retry below is the iOS self-heal |
| Dirty-gated retry | `useNostrSync` second effect (`scheduleDirtyRetry`) — while `syncDirty({ recordsDirty, planDirty, prefsDirty, pendingRevocations })` (any unpublished channel or a pending viewer revocation; 4e — until then it watched `settingsDirty`, which nothing had set since 4c, so an offline plan edit had no retry, F2), a self-rescheduling backoff (5s→10s→20s→40s→60s, cap 60s) re-invokes `triggerSync`. **live instance only** (AppShell's `{live:true}` mount — a bare SettingsMain mount must not double-publish) + viewerMode-off + backup gate satisfied + **authenticated** (4e, G1: `isAuthenticated` stays false behind the LocalUnlockGate until the tap, and a tick there would reach `restoreSigner` → Face ID with no gesture, which iOS 17.4+ allows; the unlock flips it, re-arms the chain and runs `syncNow` itself). `triggerSync` itself is not gated (the focus / visibility / online handlers on a locked device are a separate queued item). Visible ticks call triggerSync + advance backoff; hidden ticks skip the call and hold the current delay (iOS freezes hidden timers anyway). A flag transition restarts at 5s; a successful publish clears the flags → the chain tears down. The ONLY self-heal on iOS for a publish that failed offline (see Network reconnect) |
| Live subscription | `liveSync.ts` while visible — receive-only transport (no syncNow); applies the other device's publishes in ≈1s desktop / 2–3s iOS (NIP-46 decrypt); 5b: a journal change lands after a 1.5 s debounce and a pull of the changed pages |
| Manual button | "↻ Sync now" in Settings (via `useNostrSync().triggerSync`) |

- Reconnect affordance is **two-stage**: first tap retries (`triggerSync`); only if the retry still
  fails does the button escalate to "⚠ Re-authorize" (`reconnectNostr`) — transient failures recover
  without burning a NIP-46 session
- (Pull-to-refresh was removed — gesture + usePullToRefresh.ts deleted)

---

### Published Event Types

| d-tag | Contents | Trigger |
|---|---|---|
| `personal-bloc:settings:v1` | (was: the settings fields) | **RETIRED at 4e** — nothing publishes or reads it; stale copies stay on the relays, inert (the pull and the live sub ask only for records / the journal manifest / plan-events / prefs). It was 4c's one-way write-through BRIDGE (published from current state in `publishPlanEventsNow`'s success; read as authority only on an empty-log device) |
| `personal-bloc:plan-events:v1` | **4c** `{ events: PlanEvent[] }` — the append-only plan log, NIP-44 self-encrypted — **the only plan channel since 4e** | Any plan-field setter via `emitPlanSets` (marks `planDirty`, 2s debounce → `publishPlanEventsNow` → compact → publish → viewer fan-out + revocation flush → parity); retried by `syncNow` and the iOS retry while dirty. Pull = union-by-id + fold-to-state, order-independent (NO watermark) |
| `personal-bloc:prefs:v1` | **4c** `{ tabOrder, hiddenTabs, simpleMode, btcBuyingUnit }` + **BL15** `venueColors` (absent until a device chooses colours — JSON drops the undefined) | The 5 prefs' setters (BL15's `setVenueColor` / `resetVenueColors` among them) via `emitPrefs` (marks `prefsDirty`, 2s debounce → `publishPrefsNow`); tiny whole-object LWW; pull applies via `hydratePrefs` (PREFS_FIELDS — only the 5 prefs can land; `venueColors` only as a plain object, and a key the object lacks is left as it is, so an older build's object never resets the colours) |
| `personal-bloc:records:v1` | **5b: the bridge.** `{ entries, deletions, dayLog, dayLogDeletions }` — the whole journal while its JSON is ≤ 40,960 B; past it the stub `{ …empty, movedTo: 'personal-bloc:records:v2:manifest' }`, written once (a frozen copy would bring back a deleted entry once its tombstone aged out). Every pull still reads it (a pre-5b app writes only this); legacy forms readable | After the v2 publish, best-effort; before the session's journal pull, alone (recordsDirty stays) |
| `personal-bloc:records:v2:<YYYY-MM>[.N]` | **5b — a page:** `{ v: 2, key, entries, dayLog }` — the month's items, ≤ 32,768 B plain (`.2`… past it; `undated` for a date that isn't `YYYY-MM` or `YYYY-MM-…`) | `publishJournal`: only the pages whose fingerprint differs from the relays' copy, one at a time |
| `personal-bloc:records:v2:manifest` | **5b — the manifest:** `{ v: 2, pages: { key: { n, h } }, deletions, dayLogDeletions }` — every page the relays hold (+ carried listings) and the tombstones; the commit marker and the completeness oracle | After the pages, if it changed |
| `personal-bloc:viewer:v2:<pubkeyHex>` | **Viewer Access — MODE-SHAPED (Viewer V2) + PER-VIEWER (M2).** `ViewerSnapshot` NIP-44-encrypted to EACH roster viewer's pubkey (`slot.pubkeyHex`), addressed to that viewer's own d-tag `viewerDTag(pubkeyHex)` = `personal-bloc:viewer:v2:<pubkeyHex>` — one live event per viewer (kind-30078 is per-author-per-d-tag, so a shared d-tag would overwrite). **CLEAN-CUT: the old `personal-bloc:viewer:v1` d-tag is deleted** (owner rotates + re-provisions after deploy). Default **C-safe**: `{ snapshotVersion:2, privacyMode:'safe', asOf, hasCbLoan, btcPriceAtSnapshot, thresholds, safety }` — health ratios/config/public price only, NO absolutes by construction. **C-trusted** (per-slot `tier:'trusted'`): the full `{ settings, records:{entries,deletions}, strike:{usd,btcAvail,rate}, cbCollateralBtc, strikeCollateralBtc, coldStorageBtc, strikeLastDepositISO }` + common (`strikeLastDepositISO` — the plan of record's Run 2, D9: the latest logged Strike deposit date, the viewer's 60-day hold) — the viewer applies `settings` through `applyViewerSettings` (`VIEWER_SETTINGS_FIELDS`, 4e). Pre-V2 (no `privacyMode`) reads as trusted | Fire-and-forget `void publishViewerSnapshotNow()` (M2 FAN-OUT: one publish per roster slot, `Promise.allSettled` isolation, payload built once per tier) in the success path of BOTH `publishRecordsNow` + `publishPlanEventsNow` (4e: until then, the settings bridge's success), AND on a tier toggle / adding a viewer; gated on the roster being non-empty; **log-only** on failure — NEVER touches the dirty flags/`nostrReconnectNeeded`/`nostrSyncing`. **Revoke** (`publishViewerRevocationNow(pubkeyHex)`, PER-SLOT) publishes THAT viewer's d-tag with an empty payload + `revoked: true` (tombstone) → the viewer wipes + exits (checked before the mode branch; replaceable, supersedes the old snapshot) |

### Viewer-key derivation v1 + handoff v4 — deterministic owner-minted viewer key + combined token + rotation (store stays v19, NO bump)

The owner is the SOLE MINTER of the viewer key: the owner **deterministically derives** the viewer's
keypair from the owner's OWN nsec (so the owner can regenerate the exact same viewer key at any time — no
separate backup) and hands off a token. **Handoff v4 is TOKEN-PASTE-ONLY on BOTH sides** — the old
"viewer generates its own key + sends the owner its npub" model is RETIRED (`ViewerLoginFlow` has no
generate mode + `ViewerWaitingGate` has no send-your-npub affordance; a self-generated key could never be
authorized since `SharingPage` has no field to receive a viewer npub). **The token** (`<keyPart>:<ownerNpub>`)
carries the owner's npub and supports an encrypted (NIP-49) key part for remote transport (see the Handoff
bullet). `parseHandoffToken` requires exactly 2 parts (`ownerNpub` non-null; bare-nsec retired at v3). Plus
an owner-side **key-rotation** affordance (honors the handoff passphrase).
- **`src/lib/nostr/viewerKey.ts`** — `deriveViewerKeyFromNsec(ownerSk, ownerPubkeyHex, keyVersion, index)` (M2:
  4-arg, per-slot-indexed — label `personal-bloc/viewer-key/v${keyVersion}/i${index}`; see the Key Files entry
  for the HKDF formula + counter-bump). Deterministic in (ownerSk, ownerPubkeyHex, keyVersion, index).
- **Key version** — ⚠ **SUPERSEDED at Multi-viewer M1 (store v21):** the global `viewerKeyVersion` scalar is
  GONE — the version byte is now **per-slot** (`ViewerSlot.keyVersion`, part of the synced `viewers` roster;
  rotation bumps a single slot's version). Historically (v1→handoff-v4) it was a standalone synced setting
  stripped from the viewer snapshot; it's absorbed into the roster, which is stripped wholesale.
- **Owner affordance** — ⚠ **the `GenerateViewerKeyBlock` component + its replace-guard/rotation described in
  the next three bullets are SUPERSEDED by Multi-viewer M3** (`ViewerRoster`, per-slot add/rotate/remove,
  replace-guard deleted — see the M3 section). The historical single-slot design (kept for context):
  **`GenerateViewerKeyBlock`** — LOCAL-SIGNER-ONLY (gated
  `nostrSigningMethod === 'local'`; nip07/nip46 never expose the raw sk → the block is hidden). Unwrap the owner
  key (Face ID / PIN, mirrors `RevealRecoveryKey`) → derive → `hex = getPublicKey(derived)` → **replace-guard**
  (`window.confirm` when `viewerPubkey` exists and differs — re-deriving the SAME key skips the confirm, keeping
  the determinism/recovery path friction-free; **rotation suppresses it** via a `doGenerate({skipReplaceGuard})`
  option arg) → `setViewerPubkey(hex)`/`setViewerNpub` →
  `publishViewerSnapshotNow()` → reveal the viewer nsec via `<SecretKeyCard>` (auto-clear ~30s, unmount discards
  it). Both owner sk + derived key zeroed in `finally`; ⚠ never logs key material.
- **Rotation (`GenerateViewerKeyBlock` `onRotateTap`)** — a "↻ Rotate viewer key" button rendered when
  `viewerPubkey` is set (the block is already local-signer-gated). `window.confirm` ("Rotating invalidates the
  current viewer key…") → `setViewerKeyVersion(getState().viewerKeyVersion + 1)` (sync `set` → `getState()`
  reads the bumped value → the setter's own `syncSettingsToNostr` publishes it; NO new sync wiring) → regenerate
  with the new version and the replace-guard SUPPRESSED (rotation is already confirmed — one dialog, not two). A
  `skipGuard` state bridges the intent across the PIN-collection step (the PIN-row Generate passes it). **No
  rollback if derive fails after the bump** — the version stays bumped/synced but no key was handed out;
  re-running uses the new version and determinism is preserved (acceptable, intentional). **Rotation HONORS the
  handoff passphrase** — the single `handoffPassphrase` input renders unconditionally above BOTH the Generate
  and Rotate buttons (not generate-gated) and `doGenerate` reads it at emit time regardless of entry, so a
  passphrase set before tapping Rotate produces an encrypted `ncryptsec` token (same as initial generate).
- **Handoff v3 — combined token (`src/lib/nostr/handoffToken.ts`).** The owner hands the viewer ONE string:
  `<keyPart>:<ownerNpub>` (bech32 excludes `:` → unambiguous). `keyPart` = a bare `nsec1…` (in-person) OR a
  passphrase-encrypted `ncryptsec1…` (NIP-49, safe for remote transport); the `ownerNpub` half means the viewer
  no longer needs the owner's npub via a second channel. `buildHandoffToken`/`parseHandoffToken` (PURE — `nip19`
  bech32 only, NO crypto): parse trims, splits on `:` (EXACTLY 2 parts required → else null; bare-nsec back-compat
  RETIRED), classifies `keyPart` by prefix, and validates the npub half decodes as an npub. `ownerNpub` is
  NON-NULL on the returned `ParsedHandoff`.
- **Owner path (`SharingPage.tsx` `GenerateViewerKeyBlock`)** — an optional **passphrase** input above the
  generate button; after derive + replace-guard, `keyPart = pass ? nip49.encrypt(derived, pass) :
  nip19.nsecEncode(derived)` (encode/encrypt BEFORE `derived.fill(0)`), then `buildHandoffToken(keyPart,
  npubEncode(ownerPubkey))` → revealed via `<SecretKeyCard hint=…>` (same ~30s auto-clear/Hide/unmount). All v1
  semantics (derive, replace-guard, publish, zeroing) unchanged.
- **Viewer path (`ViewerLoginFlow.tsx` — PASTE-ONLY, v4)** — the generate mode + its viewer-npub readout/Copy
  are GONE; the page is unconditionally the token-paste flow. The input is the **token**; `parseHandoffToken` →
  `parsed`. `nsec` → `nip19.decode`; `ncryptsec` → a **passphrase field** + `nip49.decrypt(keyPart, passphrase)`
  in try/catch (wrong passphrase → null → friendly "Wrong passphrase"). Both passphrase inputs (owner's in
  `SharingPage` + viewer's here) carry `autoCapitalize="none" autoCorrect="off" spellCheck={false}
  autoComplete="off"` — iOS silently autocapitalizes/autocorrects an un-suppressed field, which would make the
  encrypted and decrypted strings permanently disagree. ⚠ The passphrase is **DEBOUNCED 3000ms**
  (`tokenPassphrase` → `debouncedPassphrase`) — `nip49.decrypt` is SYNCHRONOUS scrypt (default logn 16), so
  decrypting per keystroke would freeze the mobile main thread. The decrypt itself runs in a **`useEffect`, NOT a
  memo** (`decryptState: {key, checking}`): the effect trims `debouncedPassphrase` (**symmetric** with the
  owner's `handoffPassphrase.trim()` at encrypt time — an untrimmed viewer-side passphrase would silently
  mismatch a trimmed owner-side one), sets `{key:null, checking:true}` (never carries a stale key from a prior
  passphrase while re-checking), then a 30ms `setTimeout` yields one frame so **"Checking passphrase…"** actually
  paints before the blocking `nip49.decrypt` call runs (cleaned up on re-fire so a stale in-flight decrypt can't
  land after a newer keystroke); success → `{key,checking:false}`, throw → `{key:null,checking:false}`. The
  `pastedKey` memo's `ncryptsec` branch is just `decryptState.key` (no crypto in the memo). "Wrong passphrase"
  renders only `!checking && trimmed && !key`. **The owner-npub field is ALWAYS token-sourced + read-only**
  (`tokenOwnerNpub = parsed?.ownerNpub ?? null` → value `tokenOwnerNpub ?? ''`, empty until a valid 2-part token
  is pasted; a bare nsec → `parsed` null → "Not a valid token"). `activeKey = pastedKey`; `handleViewerDone`
  decodes `tokenOwnerNpub` / `wrapSecretKey(activeKey.sk)` UNCHANGED; `viewerCanDone`'s `!!activeKey` already
  gates a failed/in-flight decrypt.
- **`SecretKeyCard`** — one optional additive `hint?` prop (default password-manager copy); RevealRecoveryKey +
  OwnerKeySetup omit it (byte-identical), SharingPage passes a token hint.
- Tests: `src/lib/nostr/__tests__/viewerKey.test.ts` (determinism; domain separation by version/pubkey/sk — the
  version case ALSO covers rotation's version-bump; valid secp key; input-not-mutated + distinct-output zeroing
  contract); `handoffToken.test.ts` (build/parse roundtrip for both kinds; bare-nsec → null + 2-part-required;
  garbage/>1-colon/trailing-colon/bad-npub → null; whitespace trim; a full
  NIP-49 encrypt→token→parse→decrypt byte-equal roundtrip + wrong-passphrase throw); `viewerSnapshot.test.ts`
  (rewritten at M1 — the roster `viewers`/`nextViewerIndex` IN `buildSettingsPayload`, OUT of the trusted snapshot
  settings + plan backup, per-tier build). SETTINGS_FIELDS count 39 → **36** at Multi-viewer M1 (−5 scalars +2 roster).

### Multi-Viewer M1 — sharing roster replaces the single-viewer scalars (store v20→v21)

The first milestone of multi-viewer support. **Store-only** — indexed key derivation, per-viewer d-tag publish
fan-out, and the SharingPage roster UI are later milestones (M2/M3). The 5 single-viewer scalars
(`viewerNpub`/`viewerPubkey`/`viewerLabel`/`viewerPrivacyTrusted`/`viewerKeyVersion`) become a
`viewers: ViewerSlot[]` roster + a monotonic `nextViewerIndex`, both synced settings. **Clean-cut, NO
back-compat** (the only existing viewer was a test key): migration DROPS the old scalars and starts the roster
EMPTY; the owner re-adds viewers fresh.

- **`ViewerSlot`** (`useStore.ts`, exported) `= { index, pubkeyHex, npub, label, tier: 'safe'|'trusted', keyVersion }`.
  `index` is stable + monotonic (never reused after removal — `nextViewerIndex` never regresses). `pubkeyHex` is
  the NIP-44 encrypt target; `tier`/`keyVersion` are per-viewer.
- **Setters** `addViewerSlot(Omit<ViewerSlot,'index'>)` (assigns `index = nextViewerIndex`, increments),
  `updateViewerSlot(index, patch)` (merge by index), `removeViewerSlot(index)` (filter by index) — each
  `syncSettingsToNostr()` (existing convention; since 4c each emits a plan event instead).
- **Payload/strip:** `viewers` + `nextViewerIndex` join `buildSettingsPayload` + `SETTINGS_FIELDS` (count 39→**36**),
  and are STRIPPED from the trusted `buildViewerSnapshotPayload` settings (the roster invariant — a viewer never
  sees who else the owner shares with, tiers, or key versions) AND from `exportPlan.ts`'s plan backup. The safe
  snapshot branch carries no settings block at all.
- **Tier source (M1 slot-0 — ⚠ SUPERSEDED by M2):** M1 read `s.viewers[0]?.tier` inside
  `buildViewerSnapshotPayload` and targeted `s.viewers[0]?.pubkeyHex`. M2 replaced this: the tier is an explicit
  param `buildViewerSnapshotPayload(s, tier)` and `publishViewerSnapshotNow` FANS OUT one encrypted publish per
  slot on `viewerDTag(pubkeyHex)`; `publishViewerRevocationNow(pubkeyHex)` is per-slot. (See the M2 section.)
- **Skip-guard (`hydrateSettings`, mirrors the relay guard):** an EMPTY incoming `viewers` never clobbers a
  populated local roster — skips BOTH `viewers` + `nextViewerIndex` (so the counter can't regress); a populated
  incoming roster hydrates. Publish-side is already covered by `initialSettingsPullDone` (Fix C/D). **RETIRED at
  4e** with `hydrateSettings`: the roster syncs only as plan events, and removing the last viewer is an explicit
  empty-roster event (§6) that a peer folds to empty (ROSTER peer).
- **Component slot-0 adapters (⚠ SUPERSEDED by M3 for SharingPage — the roster UI shipped):** `SharingPage`'s
  slot-0 grant card + `GenerateViewerKeyBlock` are gone (→ `ViewerRoster`, see the M3 section); `DevPanel`
  (`viewers[0]?.pubkeyHex`) + `ViewerPreview` (tier/label from `viewers[0]`) stay slot-0 reads. `clearViewerData`
  resets `viewers: []`/`nextViewerIndex: 0`.
- **Migration v21** (`migrateState`): strip the 5 old keys from the `...rest` destructure; seed `viewers: []` +
  `nextViewerIndex: 0` unconditionally; `version: 20 → 21`. Tests: `viewerRoster.test.ts` (migration drop/empty,
  setter monotonic-index/no-reuse/merge, skip-guard) + the rewritten `viewerSnapshot.test.ts` (per-tier build +
  roster strip). Suite 592 → 601.

### Multi-Viewer M2 — indexed derivation + per-viewer d-tag publish fan-out (store stays v21)

The PLUMBING for N viewers (the roster UI stays slot-0 until M3). Kind-30078 is parameterized-replaceable (one
live event per author+d-tag), so N viewers on one d-tag would overwrite each other. M2 makes derivation
per-slot-indexed and publishing per-viewer-addressed. **CLEAN-CUT: no old-label / no old-d-tag compat** — after
deploy the owner rotates slot 0 and re-provisions the (test) viewer device.

- **Derivation (`viewerKey.ts`):** `deriveViewerKeyFromNsec(sk, ownerPubkeyHex, keyVersion, index)` — 4-ARG,
  index required; info `personal-bloc/viewer-key/v${keyVersion}/i${index}` (counter-bump unchanged). Each roster
  slot derives a distinct key at the same keyVersion; keyVersion is per-slot (rotation bumps it). Regression pin:
  the new label is NOT reproducible by the old index-less `…/v${version}` label (tested with a local HKDF helper;
  the old code path is gone).
- **Addressing (`publish.ts`):** `viewerDTag(pubkeyHex) = 'personal-bloc:viewer:v2:' + pubkeyHex`. `VIEWER_DTAG`
  (v1) is DELETED. `publishViewerSnapshot` computes `viewerDTag(viewerPubkey)` internally (covers snapshots +
  revocation tombstones).
- **Fan-out (`publishViewerSnapshotNow`, useStore):** iterates `s.viewers` (empty ⇒ no-op, same gate shape);
  builds the payload **once per distinct tier** (`Map<tier, ViewerSnapshot>`, at most 2 builds) via
  `buildViewerSnapshotPayload(s, tier)` — the tier is now an **explicit required param** (the M1 slot-0 read is
  removed; it moved into the loop). Encrypts N times: `Promise.allSettled(viewers.map(slot =>
  publishViewerSnapshot(signer, slot.pubkeyHex, payloadFor(slot.tier), …)))` — **failure isolation**, one slot's
  relay failure never aborts the rest. Per-slot reporting is automatic: each publish pushes its OWN
  `PublishReport` labeled by `viewerDTag(slot.pubkeyHex)` (distinct per viewer); a final `nostrLog('info',
  'viewer fan-out: N ok / M failed')`.
- **Revocation (`publishViewerRevocationNow(viewerPubkeyHex)`, useStore):** PER-SLOT — takes the target pubkey
  (was slot-0), tombstones only that viewer's d-tag. `SharingPage.revoke` captures `slot0.pubkeyHex` before
  `removeViewerSlot`.
- **Viewer side (`viewerSync.ts`):** new `getViewerPubkeyHex()` (the viewer's own pubkey from the in-memory
  holder); the subscription/fetch filter uses `'#d': [viewerDTag(myPubkeyHex)]`. `DevPanel`'s two probes moved to
  `viewerDTag` (owner probe → `viewers[0].pubkeyHex`; viewer probe → `getViewerPubkeyHex()`).
- **SharingPage derive:** add-path derives with `index = nextViewerIndex` (the value `addViewerSlot` WILL assign
  — coupling commented); rotate-path with `slot.index` + the bumped `slot.keyVersion`.
- **`ViewerPreview` safe-force:** now `buildViewerSnapshotPayload(state, 'safe')` (the required tier param
  replaced the `{ ...state, viewers: [] }` spread — fidelity preserved).
- Tests: `viewerKey.test.ts` (index domain separation + regression pin), `viewerFanout.test.ts` (NEW — 2-tier
  fan-out to the right pubkeys, once-per-tier reference-equal build, `allSettled` isolation, per-slot revocation),
  `viewerSync.test.ts` (`#d` = `viewerDTag(myPubkey)` + v2 shape), and the tier-param call-site updates in
  `viewerSnapshot.test.ts`/`relaySync.test.ts`. Suite 601 → 610.

### Multi-Viewer M3 — SharingPage roster UI (owner-mints-only; store unchanged v21)

The UI catches up to the M1/M2 plumbing: the slot-0 grant card + `GenerateViewerKeyBlock` are replaced by a
`ViewerRoster` that lists N viewers. **The owner MINTS every viewer key — there is no other add path** (the
legacy npub-paste "Add" form is DELETED; a viewer-supplied npub can't occur since Handoff v4).

- **`ViewerRoster`** (`SharingPage.tsx`, LOCAL-SIGNER-gated — the whole block, since every action derives from
  the raw owner sk; a non-local device shows a note, share-code + preview stay ungated) — one `.grantCard` per
  `viewers` slot: label · truncated npub · tier chip · a per-row "Show real figures" `<Toggle>`
  (`updateViewerSlot(slot.index,{tier})` + `publishViewerSnapshotNow()`) · **↻ Rotate** · **Remove** (inline
  `confirmRemoveIndex` → `publishViewerRevocationNow(slot.pubkeyHex)` + `removeViewerSlot`). Below it an ADD block
  (label + Safe|Trusted picker + optional passphrase + "🔑 Add viewer").
- **ONE shared derive engine (`doDerive`)** for add + rotate. `rotatingIndex: number | null` (null ⇒ ADD)
  carries the intent through the PIN step. ADD: `index = nextViewerIndex` (the same value `addViewerSlot` will
  assign — M2 coupling), `keyVersion = 1` → `addViewerSlot({…,tier:addTier,keyVersion:1})`. ROTATE(slot) is ATOMIC
  (derive-at-target, commit-on-success — NO pre-bump): confirm → `doDerive` derives at the TARGET version
  (stored kv + 1) → ONE atomic `updateViewerSlot(slot.index,{pubkeyHex,npub,keyVersion})` on success (preserves
  tier) → `publishViewerRevocationNow(oldPubkeyHex)` (revoke the OLD d-tag so the old viewer device wipes + exits
  to the waiting gate on its next live event / reconnect — the Remove mechanism); cancel/failure = true no-op
  (slot untouched, old key keeps working). `keyVersion` always means "version of the key currently issued," never
  "next." Both: unwrap → `deriveViewerKeyFromNsec(pk, keyVersion, index)` → `publishViewerSnapshotNow()` (fan-out)
  → `SecretKeyCard` token reveal (~30s, keys zeroed). **Handoff tokens are ALWAYS ncryptsec** — a passphrase is
  REQUIRED for BOTH add and rotate (empty → inline error BEFORE the unwrap, nothing derived/published; the
  R2c-7a-2 no-unprotected-key-artifacts doctrine); there is NO plaintext-nsec branch.
- **REPLACE-GUARD + `skipGuard` DELETED** — ADD always uses a fresh index (nothing to overwrite); ROTATE is the
  only intentional overwrite and is confirmed by its own dialog. (Supersedes the handoff-v4
  `GenerateViewerKeyBlock` replace-guard.)
- **Preview trigger UNCHANGED** — `ViewerPreview` already carries its own Safe|Trusted override toggle, so it
  renders either tier on demand; no tier selector at the trigger, ViewerPreview untouched. (Residual: its
  "actual" baseline reads `viewers[0]?.tier` — a generic tier lens, not per-specific-viewer; acceptable.)
- **CSS:** reuses all existing classes; only new rule `.rowActions` (flex row for Rotate+Remove + the tier
  picker). **Tests:** none (UI; store logic unchanged) — suite stays 610.

### Viewer Access (Phase 1 writer-side + Phase 2 read client)

The owner can provision a **viewer** (e.g. a family member) who gets a continuously-updated, **read-only**
encrypted copy of the full model + live Strike balances. **The viewer arc (Phases 1–3) is complete.** The
viewer key is now **wrapped at rest** (Phase 3) — see below; the plaintext `viewerSecretKey` survives only as
a v17-migrant holder until the one-time wrap.

**Phase 1 (writer-side):**
- **`buildSettingsPayload(s)`** (`store/payloads.ts`, exported) is THE single source of the settings object —
  consumed by the trusted viewer snapshot AND the plan backup (until 4e also by `publishSettingsNow`, the retired
  `settings:v1` bridge). **It INCLUDES the owner's writer-side viewer config
  `viewerNpub`/`viewerPubkey`/`viewerLabel`** (so the owner's sharing config + nickname sync across the owner's own
  devices), but **EXCLUDES the viewer-SIDE fields** (`viewerMode`/`viewerWriterPubkey`/`viewerSecretKey`/
  `viewerKeyWrapped` — device-local). **`buildViewerSnapshotPayload` then STRIPS `viewerNpub`/`viewerPubkey`/
  `viewerLabel`** — AND `nostrRelays` (Option C — the owner's transport config) — from its `settings` (rest-omit
  destructure) so the viewer never learns who else the owner shares with, the owner's nickname for them, nor the
  owner's relay set — the **load-bearing boundary**, guarded by `viewerSnapshot.test.ts` + `relaySync.test.ts`
  (payload HAS them; snapshot.settings does NOT).
- **`buildViewerSnapshotPayload(s, tier)`** (M2 — required tier param) = the mode-shaped payload (see Viewer V2).
  `publishViewerSnapshotNow()` FANS OUT (M2): one `publishViewerSnapshot` per roster slot, each sealed to
  `slot.pubkeyHex` on `viewerDTag(slot.pubkeyHex)` = `personal-bloc:viewer:v2:<pubkeyHex>` (the v1 d-tag is
  deleted), payload built once per tier, `Promise.allSettled` isolation. Fire-and-forget, log-only — see the
  Published Event Types table.
- **`viewerNpub` / `viewerPubkey` / `viewerLabel`** (writer-side, the provisioned viewer + the owner's nickname for
  them): **SYNCED in the owner's own settings:v1** (public npubs — NIP-44 to self, no secret leak; viewer
  set/removed on one owner device propagates to all, and editing on any device publishes the snapshot because it
  has the synced `viewerPubkey`). Set/removed in Settings → NOSTR IDENTITY → VIEWER ACCESS (npub `nip19.decode`
  validated; optional nickname input above the npub; **Revoke** publishes a real-time tombstone then clears all
  three — see Revocation below). The
  VIEWER ACCESS row shows `viewerLabel` primary with the npub as ghost subtext — "Dad's iPhone (npub1abc…)" — or
  the npub alone when no nickname. (`viewerLabel` is the OWNER's private label — NOT the viewer's passkey name,
  which is authenticator-held and never transmitted.) The setters call `syncSettingsToNostr()`. **Saving a viewer
  npub fires `publishViewerSnapshotNow()` immediately**
  (`void`, fire-and-forget) so the viewer hydrates right away — without it the snapshot would only publish on the
  next settings/records edit (the "viewer sees no data until the owner makes an edit" gap).

**Phase 2 (viewer read client) — store v17:**
- A fresh install picks **"Connect to a shared plan"** in onboarding (`OnboardingModal` step-1 fork) → the
  PASTE-ONLY `ViewerLoginFlow` (Handoff v4). It pastes the owner's handoff token (`<keyPart>:<ownerNpub>`) —
  the owner MINTED the key + owner npub travel INSIDE the token (no viewer-generated key, no npub-to-send) —
  wraps the key at rest (`viewerKeyWrapped`), sets `viewerMode=true` + `viewerWriterPubkey`, and lands in the
  simple-mode dashboard. (Historically Phase 2 had the viewer `generateSecretKey` its own key + show its npub
  for the owner to add — RETIRED at Handoff v4.)
- **`viewerSync.ts`** (mirrors `liveSync.ts`): batch `fetchViewerSnapshot()` + a singleton live sub, both
  filtered `{ kinds:[30078], authors:[viewerWriterPubkey], '#d':[viewerDTag(getViewerPubkeyHex())] }` (M2 —
  the viewer's OWN d-tag; SINGLE filter at 2.23.5).
  Builds one `NSecSigner(hexToBytes(viewerSecretKey).slice())` (**`.slice()` — the writer-signer ref bug**),
  `nip44.decrypt(viewerWriterPubkey, …)` → `{ settings, records, strike }` → **read-only hydrate**
  (`applyViewerSettings` [`VIEWER_SETTINGS_FIELDS` — 4e; was `hydrateSettings`]/`setMonthlyLog` (verbatim — never recomputed)/`setDeletedMonths`/`setStrike*`). NEVER sets dirty
  flags, NEVER publishes. `useViewerSync` (hook) wires it on foreground; AppShell mounts it (no-op unless
  viewerMode).
- **READ-ONLY is two layers; structural is load-bearing.** (1) **No writer publish/sync path is reachable in
  viewerMode by construction:** AppShell passes `useNostrSync({ live: !viewerMode })`, and `useNostrSync`
  early-returns its whole effect + no-ops `triggerSync` when viewerMode → no `syncNow`/`openLiveSync`/`publish*`
  wired; the viewer's only data source is the owner's snapshot (re-hydrated live, overwriting any stray local
  edit). `useStrikeData(isAuthenticated && isOwner)` → the viewer is never `isOwner` so it **never fetches
  Strike** (Strike comes from the snapshot). (2) **UX:** the shared inputs (`NumberInput`/`Toggle`/`SliderInput`
  + the pill components) read `viewerMode` → disabled (covers all tabs' numeric/toggle/slider/pill inputs in one
  place; programmatic hydration is unaffected); the SimpleMode bespoke mutation controls (Pay/Skip pills, Log,
  Quick Setup, Edit-this-month) + SafetyDashboard inline editors are gated on `viewerMode`. The month scrubber
  stays enabled (view-only). Exhaustive per-control hardening of every tab is deferred — backstopped by the
  structural guarantee.
- **Owner-gate amendment:** all three auth-gate branches (LocalUnlockGate/NostrAuthGate/PrivateAppNotice) gain
  `&& !viewerMode` so a viewer install short-circuits straight to the app render (the spec's `|| viewerMode`
  carve-out). The slim amber **"👁 Viewing … · read-only"** banner that used to sit atop the app body in
  viewerMode was REMOVED (redundant — the viewer experience is inherently read-only by construction;
  reclaims headspace). Its copy-my-npub affordance moved into `ViewerSettings` ("Your viewing key" row,
  YOU group) so a connected viewer can still retrieve/share their npub; `ViewerWaitingGate`'s own
  copy-npub button (the pending/revoked-case affordance, shown BEFORE a viewer reaches Settings) is
  unaffected.
- **Data-remanence guard (decrypted data must not outlive the viewer key).** A viewer's hydrated financial data
  lives in the persisted Zustand store; clearing the viewer *key* alone left it rendering after revoke/reset (a
  revoked viewer correctly got "invalid MAC" — encryption held — but the OLD numbers still showed). Two parts:
  (1) **`clearViewerData()`** (store action) resets every viewer-hydrated field to its seed (financial
  `SETTINGS_FIELDS` + `monthlyLog` + `deletedMonths` + `strike*` + owner-config nulls, and — the plan of record's Run 2 —
  `viewerStrikeDepositISO` → null, so the owner's Strike deposit date leaves with the rest); pure local `set`, **no
  emit** (no plan event, no publish). Called from **VIEWER paths only** (audited): `resetViewer` (before `setViewerMode(false)`),
  `applyViewerEvent` decrypt-failure, `fetchViewerSnapshot` zero-events, onboarding viewer-provision (before
  `setViewerMode(true)`) — NEVER the owner's Remove or any owner edit (it would wipe the owner's real data; it has
  **no internal `viewerMode` guard** by design, because the onboarding call precedes `setViewerMode(true)`).
  (2) **`viewerDataLoaded`** (transient, non-persisted, in the partialize exclusion) is set true ONLY after a VALID
  `applyViewerEvent` hydrate; AppShell gates the viewer render on it — `viewerMode && !viewerDataLoaded` →
  **`ViewerWaitingGate`** ("Waiting for the owner's data…" + a **Reset viewing key** escape, essential because a
  revoked viewer unlocks fine yet never decrypts the re-sealed snapshot). So stale store data never renders for a
  key that hasn't validly decrypted a snapshot; the gate sits AFTER the unlock branches.
- **Real-time revocation (tombstone — Option A).** Settings → VIEWER ACCESS **Revoke** (was "Remove") calls
  `publishViewerRevocationNow()` (store, mirrors `publishViewerSnapshotNow`) BEFORE clearing the viewer fields —
  it seals an EMPTY payload + `revoked: true` (a `ViewerSnapshot` field) to the still-set `viewerPubkey`. The
  viewer's `applyViewerEvent` detects `snap.revoked` right after JSON.parse → `clearViewerData()` + return (no
  hydrate) → `viewerDataLoaded` false → `ViewerWaitingGate`. So the viewer EXITS the data in real-time (online via
  the live sub) or on reconnect (offline). `viewer:v1` is replaceable, so the tombstone supersedes the old
  snapshot (no NIP-09 needed). Fire-and-forget, log-only — never touches the owner's own sync.
- **Owner-only Settings hidden in viewerMode.** `SettingsMain` reads `viewerMode` and wraps the NOSTR IDENTITY +
  VIEWER ACCESS section, the SETUP section, the TAB VISIBILITY & ORDER section, and the DevPanel render in
  `{!viewerMode && …}` — a viewer sees none of the owner's identity/setup/layout/diagnostics (just a small
  "viewing a shared plan, read-only" note + the build row). The owner (viewerMode=false) sees everything unchanged.
- **`viewerMode` / `viewerWriterPubkey` / `viewerSecretKey`** are **device-local, NEVER synced** (not in
  `SETTINGS_FIELDS` / the payload / the partialize exclusion → persist via `...rest`; setters plain `set()`) —
  same discipline as `writerKeyWrapped`.

**Phase 3 (viewer key wrapped at rest) — store v18:**
- The viewer key is **wrapped at rest** with the EXISTING `keyVault.ts` (AES-GCM via Face-ID-PRF / PIN), mirroring
  the writer's local-key pattern (`NostrAuthGate` wraps → `LocalUnlockGate` unwraps). New device-local persisted
  fields `viewerKeyWrapped` (base64 AES-GCM ciphertext) + `viewerKeyWrapMeta` (`WrapMeta`) — **NEVER synced**
  (not in `SETTINGS_FIELDS`/payload/partialize-exclusion, persist via `...rest`), same discipline as
  `writerKeyWrapped`. `viewerSecretKey` is now ONLY a transient v17-migrant plaintext holder.
- **The unwrapped key NEVER touches serializable store state.** It lives in an **in-memory holder inside
  `viewerSync.ts`** (`unwrappedViewerKey`); `setUnwrappedViewerKey(sk)` (exported) sets/clears it, rebuilds the
  cached `NSecSigner`, and mirrors the **transient store boolean `viewerUnlocked`** (excluded from persistence)
  so AppShell can reactively gate. `getViewerSigner()` is arg-less (builds from the holder). The 3 read sites
  (`applyViewerEvent`/`fetchViewerSnapshot`/`openViewerSync`) guard on `!unwrappedViewerKey` and **back-fill the
  holder from a surviving plaintext `viewerSecretKey`** (v17 migrant keeps syncing pre-wrap).
- **`ViewerUnlockGate.tsx`** (mirrors `LocalUnlockGate`, reuses `NostrAuthGate.module.css`) — two modes off store
  state: **unlock** (`viewerKeyWrapped` set → `unwrapSecretKey` → holder) and **setup** (v17 migrant: `!wrapped`
  but plaintext present → one-time `wrapSecretKey` → store the pair, populate holder, `setViewerSecretKey(null)`).
  Ghost **"Reset viewing key"** → `onReset`.
- **AppShell gate** (before the writer branches, `!import.meta.env.DEV`): `viewerMode && viewerKeyWrapped &&
  !viewerUnlocked` → `<ViewerUnlockGate>` (must unlock before render); `viewerMode && !viewerKeyWrapped &&
  viewerSecretKey` → `<ViewerUnlockGate>` (migrant one-time wrap, then falls through). `resetViewer` clears the
  wrapped pair + holder + plaintext + viewerMode/writerPubkey and re-opens onboarding (lossless — the snapshot
  stays on the owner's relay). **Recovery = re-provision** (fresh key + new npub).
- **Onboarding** (`OnboardingModal` viewer flow) wraps on provision: probe capability (+ PIN field if `'pin'`) →
  `wrapSecretKey(sk)` → `setViewerKeyWrapped`/`setViewerKeyWrapMeta` → `setUnwrappedViewerKey(sk)` (session
  unlocked, no re-prompt) → **NO plaintext stored**.
- **DevPanel** VIEWER ACCESS adds `key wrapped` + `unlocked` boolean rows (booleans only, never the key). (The
  `runViewerProbe` viewer-side decrypt still reads plaintext `viewerSecretKey`, so for a wrapped viewer it reports
  "no viewer key" rather than decrypting — event-presence query unaffected; decrypt-verify covers migrant + owner.)

### All 47 Synced Settings Fields
(`cbCollateralBtc` AND `strikeCollateralBtc` are LOCAL derived caches, NOT synced settings scalars — Daily Mode P3 / Collateral-Truth v20 CONVERGE them cross-device by carrying `dayLog`/`dayLogDeletions` on the journal channels (5b: monthly pages + manifest, records:v1 the bridge) (NOT as plan fields); each device re-derives them from the merged `dayLog`. `pendingCollateralAdjustment` was RETIRED at v20 — dropped from this list.)
**How they sync (since 4e):** the 42 PLAN_EVENT_FIELDS as plan events on `plan-events:v1`, the 5 prefs (`tabOrder`,
`hiddenTabs`, `simpleMode`, `btcBuyingUnit`, BL15's `venueColors`) whole-object on `prefs:v1`. `SETTINGS_FIELDS` / `buildSettingsPayload`
still list all 47: the trusted viewer snapshot (minus `VIEWER_SNAPSHOT_STRIP`) and the plan backup read them.
`settings:v1`, the channel the list was named for, is retired.
`income`, `expenses`, `blocApr`, `creditLine`, `advisorStartDate`,
`advisorActualBlocBalance`, `advisorActualBlocBalanceAsOf`, `advisorMonthStartBalance`, `advisorActualBtcHeld`, `cbLoanBalance`,
`cbAprPct`, `hasCbLoan`, `ndpLastPaidDate`,
`tabOrder`, `hiddenTabs`, `simpleMode`, `btcBuyingUnit`,
`venueColors` (BL15 — the venue colours, a pref; undefined = never chosen, never sent),
`cbLiquidationPrice`, `cbMonthlyPayment`, `cbPaymentStrategy`,
`cbLtvTriggerPct`, `cbLtvTargetPct`, `cbRotateBackPct`, `cbEmergencyCeilingPct`,
`cbLoanBalanceAsOf`, `cbLiquidationPriceAsOf`, `strikeLiquidationLtvPct`,
`blocMinPaymentSource`, `blocStatementMinimum`, `blocMinPaymentDueDay`,
`coldStorageBtc`, `coldStorageBtcAsOf`,
`advisorSkipBlocDraw`, `advisorSkipCbPayment`, `advisorSkipBtcBuying`,
`policyCbStopAtSupportPct`, `policyStrikeStopAtSupportPct`, `policyAccumulateBelow`, `policyPayDownAbove`,
`policyBearBufferMonths`, `policyCashReserveMonths`,
`planGoalNetBtc` (BL14 — the plan's goal; null = no goal),
`nostrRelays`, `backupVerifiedAt`, `viewers`, `nextViewerIndex`
(`backupVerifiedAt` (R2a-1) is synced so the backup attestation travels with the plan (an imported/external peer
device sees it). ⚠ It does NOT un-gate a gated peer — a gated device runs no sync at all, not even a pull, and
needn't, since only the sole GENERATING device is ever gated. It is a **ONE-WAY LATCH by construction** (since 4e:
no path emits a null event — the teardown clear is RAW — and the fold writes only fields present in the log; until 4e
a hydrate skip-guard held it, the third member of the whole-object-LWW skip-guard class alongside
`nostrRelays`/`viewers`, all deleted at 4e), STRIPPED from the
trusted viewer snapshot (the owner's key-custody state is not the viewer's business), and RETAINED in the plan
backup (a restore lands on a device whose `keyProvenance` is null → satisfied → harmless). Its partner
`keyProvenance` is device-local and NEVER synced — see § Backup Gate.
`viewers` + `nextViewerIndex` (Multi-viewer M1, store v21) are the sharing roster — they REPLACE the 5 old
single-viewer scalars (`viewerNpub`/`viewerPubkey`/`viewerLabel`/`viewerPrivacyTrusted`/`viewerKeyVersion`), which
were dropped clean-cut. Each `ViewerSlot` = `{ index, pubkeyHex, npub, label, tier: 'safe'|'trusted', keyVersion }`;
`nextViewerIndex` is monotonic (an index is NEVER reused). Both sync across the owner's devices so the roster +
removals propagate, but are STRIPPED from EVERY viewer snapshot (a viewer must never learn who else the owner shares
with, their tiers, or key versions) AND from the plan backup. Until 4e `hydrateSettings` GUARDED them (an EMPTY
incoming `viewers` never clobbered a populated local roster); since 4e the roster syncs only as plan events —
removing the last viewer is an explicit empty-roster event (§6), and a peer folding it ends empty. Per-tier snapshot: `buildViewerSnapshotPayload` reads `viewers[0]?.tier` (M1
single-viewer / slot-0; M2 fans out per-viewer on their own d-tags). The two CB `asOf` markers sync so freshness travels atomically with `cbLoanBalance`/`cbLiquidationPrice`.
`nostrRelays` (Option C) syncs across the OWNER's devices — identical lists (add + remove both propagate). User
edits emit a plan event via `setNostrRelaysAndSync`; the plain `setNostrRelays` stays RAW for boot discovery, so
discovered or default relays never become an event. Until 4e `hydrateSettings` GUARDED it (a default-looking incoming
list — empty OR exactly `DEFAULT_RELAYS` — never overwrote a custom local list, so Restore defaults didn't propagate);
since 4e a folded list always applies, and Restore defaults on one owner device reaches the others.
STRIPPED from `buildViewerSnapshotPayload` (owner transport config — a viewer reads via its own relay set).
The three skips are STANDING plan-shaping state — plan events like income or APR (`pendingCollateralAdjustment` was
retired at v20). `advisorChecklist` was REMOVED — per-month ritual ticking is multi-writer ephemeral state,
incompatible with a single-writer synced field; that's why the skips sync and the checklist was deleted. The two
appliers that remain whitelist their input: `hydratePrefs` to PREFS_FIELDS, `applyViewerSettings` to
VIEWER_SETTINGS_FIELDS — an absent key is skipped, an unknown one ignored.)

---

### Zustand Store Fields (Nostr)

| Field | Type | Persisted | Notes |
|---|---|---|---|
| `nostrAuthEnabled` | boolean | ✅ | **B1: DERIVED from `!!nostrPubkey` (signed-in), not an independent toggle.** `setNostrPubkey` sets it in lockstep + mirrors `GATE_AUTH_KEY` to `GATE_PUBKEY_KEY`; seed returns `!!pubkey`; migrate derives `!!(persistedState.nostrPubkey ?? seedNostrPubkey)`. Can't desync → kills the signed-in-but-auth-disabled half-state (the "unlock failed, no prompt" bug). `setNostrAuthEnabled` setter kept (disconnect calls it `false`); its true-path is dead. The "Enable Nostr Lock" toggle is now inert pending removal in Step 2 |
| `nostrPubkey` | string | ✅ | Hex pubkey |
| `nostrSigningMethod` | `'nip07' \| 'nip46' \| 'local' \| null` | ✅ | Login path used (`'local'` = iOS Face-ID signer) |
| `writerKeyWrapped` / `writerKeyWrapMeta` | `string \| null` / `WrapMeta \| null` | ✅ (device-local) | Encrypted writer nsec + wrap meta — **NEVER synced** (not in SETTINGS_FIELDS) |
| `keyProvenance` | `'generated' \| 'imported' \| 'external' \| null` | ✅ (device-local; **standalone-backed** via `GATE_PROVENANCE_KEY`) | R2a-1 backup gate. **WRITE-ONCE** (`null` = identity-teardown clear). **NEVER synced.** `null` = legacy plan = gate satisfied (structural, no migration). R2c-6-final: also written through to standalone localStorage (`personal-bloc-provenance`) + read by `gateHydratedIdentity` so it survives the escape hatch (bypass 1); wiped by `wipeLocalPlanData`. See § Backup Gate / § Remanence |
| `backupVerifiedAt` | `number \| null` | ✅ | R2a-1 backup gate. **SYNCED** — an authed stamp is a plan event (also in SETTINGS_FIELDS/payload, so every plan backup carries it); **ONE-WAY LATCH** by construction (no null event exists, 4e); STRIPPED from the trusted viewer snapshot. Authed, the setter emits (`planDirty`) + wakes `syncNow`; pre-auth it sets the field only |
| `viewerKeyWrapped` / `viewerKeyWrapMeta` | `string \| null` / `WrapMeta \| null` | ✅ (device-local) | Phase 3 — wrapped-at-rest viewer nsec + wrap meta — **NEVER synced**. Unwrapped bytes live only in viewerSync's in-memory holder |
| `viewerUnlocked` | boolean | ❌ | In-memory; true once viewerSync's key holder is populated (post-unlock/provision) — AppShell gates the ViewerUnlockGate on it |
| `nostrBunkerUri` | string | ✅ | NIP-46 reconnect |
| `nostrRelays` | string[] | ✅ | From NIP-65 discovery. **Option C: SYNCED** across the owner's devices as a plan event (also in `SETTINGS_FIELDS`/`buildSettingsPayload`); a folded list always applies (4e retired the receive guard); stripped from the viewer snapshot. **User edits go through `setNostrRelaysAndSync`** (set + a plan event → `planDirty` → publishes on its own); the plain `setNostrRelays` is retained RAW for the `syncNow` boot bootstrap (`fetchUserRelays` discovery) so fetched/default relays don't spuriously publish |
| `lastRecordsSyncAt` | number | ✅ | Unix SECONDS (event.created_at) of the newest `records:v1` / v2 manifest seen (5b) — or of this device's last journal publish — observability ONLY, not a gate |
| `recordsDirty` | boolean | ✅ | Publish-needed marker + merge tie-breaker ONLY (NOT a receive gate); set on local edit or when the relay is behind; cleared on successful publish |
| `planDirty` / `prefsDirty` | boolean | ✅ (device-local) | Phase 4c — the plan / prefs publish-needed markers (set by `emitPlanSets` / `emitPrefs`; cleared on a successful publish). With `recordsDirty` and a pending revocation they arm the iOS retry (`syncDirty`). `lastPlanEventsSyncAt` (unix seconds) is observability only — Settings → SYNC's "Plan synced" reads it; `lastPrefsSyncAt` (unix seconds) is also the prefs pull's watermark — a `prefs:v1` applies only when newer. ⚠ `settingsDirty` / `lastSettingsSyncAt` (and 4d's `lastV1FallbackApplyAt`) were RETIRED at 4e — `partializeState` drops a pre-4e blob's copies |
| `planLoaded` | boolean | ✅ (device-local) | 5c — does this device hold the owner's plan? Set when it applies the relays' plan (an empty log included), by `applyPlanBackup`, when it mints the key (`setKeyProvenance('generated')`), and by the owner's "Start a new plan" after a pull found nothing (`startNewPlanHere`) — **never inferred from an empty pull**. Cleared by a fresh store (Disconnect, the escape hatch), `clearViewerData` / `resetPlanToSeeds`, and the key stamp's `null` clear (a failed mint or import, Disconnect). A blob from before 5c derives it at hydration — a plan log and a plan sync time, or a minted key (`hydrateDeviceFlags`); with no blob nothing is derived. **NEVER synced.** While a signed-in owner device lacks it, `planMissing` (`lib/nostr/planLoad`) refuses every journal write and plan edit (but the `backupVerifiedAt` stamp), keeps relay edits local, and holds the plan, journal, viewer and relay-list publishes |
| `deletedMonths` | Record<number, number> | ✅ | month → deletedAt (Unix ms) tombstones for synced deletes; cleared per-month on re-log; 90-day GC in merge |
| `nostrLogin` | string | ✅ | JSON NIP-46 login (bunkerPubkey/clientNsec/relays/pubkey) — reconnect-free restore |
| `nostrSigner` | NostrSigner | ❌ | In-memory; recreated on restore |
| `isAuthenticated` | boolean | ❌ | In-memory; reset on reload |
| `nostrSyncing` | boolean | ❌ | In-memory; UI loading state |
| `nostrReconnectNeeded` | boolean | ❌ | In-memory; set on decrypt/publish failure → shows ⚠ Reconnect affordance (AppShell) |

---

