# The access layer — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

## Access Layer Redesign (Phase 1 — the shippable lockout fix; store unchanged, AppShell ladder UNTOUCHED)

Fixes two front-door reachability defects WITHOUT touching the Bug-3-guarded AppShell auth/viewer
render ladder (that ladder refactor is deferred Phase 3):
- **D1 (viewer lockout):** viewer login was reachable ONLY via OnboardingModal's button, gated on
  `!onboardingComplete`. "Skip for now" flipped `onboardingComplete=true` permanently → the trigger
  vanished forever.
- **D2 (returning owner buried):** no front-door login — the owner had to toggle "Enable Nostr Lock"
  in Settings → Identity to trip NostrAuthGate.

**The real fix = always-present Settings doors.** The first-run fork is just the welcome replacement.

- **`src/components/Entry/ChoosePathView.tsx`** (+ `.module.css`) — the sovereign 3-path first-run
  fork that REPLACES OnboardingModal's step-1 welcome. Pure presentational, renders as the step-1
  content inside the modal. Props `{onStartNew, onLogIn, onConnectShared}` (prop names unchanged).
  Brand ring + tagline + 3 cards + footer. **R2b-2 — the copy is IDENTITY-FRAMED, not protocol-framed:
  the fork asks what the user HAS, never what technology they hold, and the word "Nostr" appears nowhere
  (it now lives behind Advanced sign-in in NostrAuthGate).** Card 1 (accented `--btc`, `onStartNew`) =
  **"Get started"** / "Free, on this device — we'll create a key for you" → OwnerKeySetup, then the
  numbers wizard. Card 2 (`onLogIn`) = **"I have a plan or a key"** / "Sign in with your Recovery Key,
  extension, or signer — we'll load your plan; if your key has none yet, you can start one" (5c: it used to promise
  "or start fresh on your key", which primes the wrong tap on a device whose plan hasn't loaded; a key whose relays
  hold nothing is started by its owner, "Start a new plan"; pinned in `noPlanNotice.test`). Card 3 (`onConnectShared`)
  unchanged.
- **`src/components/Auth/ViewerLoginFlow.tsx`** (+ `.module.css`) — the viewer-login flow EXTRACTED
  VERBATIM from OnboardingModal (byte-identical crypto/key sequence: `wrapSecretKey` →
  `setUnwrappedViewerKey` → `clearViewerData` → `setViewerWriterPubkey` → `setViewerMode(true)`).
  Self-contained full-screen overlay (own `.overlay`/`.modal`, mirroring NostrAuthGate) so it launches
  from BOTH onboarding AND Settings. The ONLY behavioral change: the final `onComplete(true)` became a
  `onDone()` prop. Props `{onDone, onBack}`.
- **`OnboardingModal.tsx`** — step 1 = `<ChoosePathView>`; the extracted viewer state/effect/handlers
  are GONE (live in ViewerLoginFlow). Two flow flags `viewerFlow`/`loginFlow`; the component
  early-returns the sub-flow overlays before its own modal: `viewerFlow` → `<ViewerLoginFlow
  onDone={() => onComplete(true)} …/>`, `loginFlow` → `<NostrAuthGate onSuccess={() => onComplete(false)}
  …/>`. The numbers wizard (steps 2-4 + `handleDone`) is INTACT; dots moved under the `step>=2` branch.
- **Completion-wiring principle (load-bearing):** `handleDone` (which writes the DRAFT plan numbers)
  belongs ONLY to the numbers-wizard path where the user actually entered them. Viewer + login use
  **flag-only** `onComplete` so they never clobber synced/incoming data with defaults — viewer onDone →
  `onComplete(true)` (today's behavior); login onSuccess → `onComplete(false)` (marks onboarding done,
  NO plan write). (This corrects the build prompt's literal §3 which said `handleDone(...)`.)
- **`SettingsMain.tsx` — persistent "Access" group** (the real D1/D2 fix): a labeled `.settingsGroupLabel`
  "ACCESS" + two `SettingsRow`s at the TOP of `.settingsMenu` (gated `!viewerMode`, no drill-down so
  they're found the moment Settings opens). Local `accessFlow: null|'login'|'viewer'`. "Connect Nostr
  identity" → `setAccessFlow('login')` → `<NostrAuthGate onSuccess/onBack={()=>setAccessFlow(null)}/>`
  (gate sets auth → owner gates take over). "Connect to a shared plan" → `window.confirm(...)` →
  `setAccessFlow('viewer')` → `<ViewerLoginFlow onDone={()=>{setSimpleMode(true);setAccessFlow(null);}}
  …/>` (sets viewerMode → viewer gates take over). Both overlays render at the end of SettingsMain.
- **Deferred / untouched:** the AppShell render ladder (Phase 3); `nostrAuthEnabled` + the "Enable
  Nostr Lock" toggle (Phase 2 removal); owner key-gen on "Start new" (Phase 1.5 — now SHIPPED, see
  below). Almanac, BLOC math, risk core, the V1 viewer home, the viewer snapshot/sync — all untouched.
  No store version bump.

---

## Access Layer — Phase 1.5 (owner key generation + recovery-key backup; store unchanged, NO bump)

"Start a new plan" now MINTS a real owner identity (nsec/npub generated + keyVault-wrapped on-device)
with a mandatory recovery-key backup **before** the numbers wizard — eliminating the
local-owner-without-identity limbo (device model is now cleanly `undecided | owner | viewer`) and
closing the clobber-fix's empty-baseline tradeoff (the new owner is authenticated before the wizard, so
the wizard's plan publishes as the legitimate first settings event). Out of scope: import/restore,
Log-in/Connect-shared, the AppShell render ladder, toggle retirement. Introduces two SHARED pieces later
specs reuse: `SecretKeyCard` (Access P2's Reveal-recovery-key) + `establishLocalOwner` (shared with
NostrAuthGate's import path so the two identity-establish paths can't drift).

- **Flow:** fork → "Start a new plan" → **K1** Create key → **K2** Save recovery key → **K3** Protect it
  → numbers wizard (existing steps 2–4) → `handleDone(true)` → app (owner, authed, synced). Key-first,
  then numbers.
- **`src/lib/nostr/establishOwner.ts`** — `establishLocalOwner(sk, method, nostr, opts?)`: the SINGLE
  local-owner establish path, extracted VERBATIM from NostrAuthGate's import body (wrap at rest → persist
  the wrapped credential via `setWriterKeyWrapped`/`setWriterKeyWrapMeta` → `new NSecSigner(sk.slice())`
  + `setNostrSigner` → `markSignerFresh` → `setNostrPubkey(getPublicKey(sk))` → `setNostrSigningMethod
  ('local')` → fire-and-forget `syncNow(nostr)` → `setIsAuthenticated(true)` → `sk.fill(0)`). `NostrAuthGate`'s
  `handleLocal` now calls it (behavior-identical; `wrapSecretKey`/`NSecSigner`/`getPublicKey` imports pruned
  there). ⚠ **Never logs the nsec** (no `nostrLog` of key material anywhere in the feature). `NostrSigner`
  imported from `./signers` (the sibling re-export, matching `session.ts`).
- **`src/components/Auth/SecretKeyCard.tsx`** (+ css) — shared presentational card: bech32 nsec in `--mono`
  `word-break: break-all`, **blurred by default** (`filter: blur(6px)` + "Tap to reveal" pill, local toggle),
  one-tap Copy (flashes "Copied ✓" 2s, fires `onCopied?`), "Best kept in a password manager." sub-line.
  Props `{ nsec, onCopied? }`. `--surface-2` bg / btc-tinted border.
- **`src/components/Onboarding/OwnerKeySetup.tsx`** (+ css) — the K1→K2→K3 sequence; own `.overlay`/`.modal`
  chrome mirroring `ViewerLoginFlow`, `--btc` primaries. Internal `step: 'intro'|'save'|'protect'`, props
  `{ onComplete, onBack, onLogIn }`. **R2b-1 — K1 mints a NIP-06 plan key** via `generatePlanKey()` (was
  `generateSecretKey()`): 128-bit WebCrypto entropy → 12 words → sk. **TWO refs**, both generated on the K1 tap
  (NOT mount) and zeroed on Start-over / unmount / successful establish: **`entropyRef`** (16 bytes — THE WRAPPED
  PAYLOAD) and **`skRef`** (32 bytes — display-only, feeds the Advanced-nsec). `words: string[]` lives in React
  state *because K2 renders it* — ⚠ a transient secret (a JS string can't be zeroed), never in the store / logs /
  Error messages, cleared at the same three points; it joins the documented pre-existing residual (`nsec` has had
  this property since Phase 1.5). **K1** intro + "Generate my key" + **existing-key guard** (if
  `writerKeyWrapped || nostrPubkey` present → "This device already has a key" + [Log in]→`onLogIn` /
  [← Back]; never regenerate over an identity).
  ⚠ **HOOK-ORDER (React #311 — fixed; do not regress):** `hasExistingKey` MUST be computed from **two separate,
  unconditional `useStore` calls**. It was once written `!!useStore((s) => s.writerKeyWrapped) || !!useStore((s) =>
  s.nostrPubkey)` — the `||` **short-circuits**: while `writerKeyWrapped` is null the second `useStore` runs, but
  the instant K3's `establishLocalOwner` calls `setWriterKeyWrapped` the left side turns truthy and the second
  `useStore` is **never called**. The hook count drops mid-flow and React throws #311 ("rendered more hooks than
  during the previous render") at the exact moment onboarding completes — crashing into the ErrorBoundary instead
  of rendering the fresh plan. Dev hook table: slot 6 `useCallback` (the 2nd store subscription) → `useState`. **K2** `<WordGrid words={words}/>` (blurred 12 words) + a
  seed-phrase **hygiene line** — the DISPLAY variant, mirroring RecoveryKeyCeremony verbatim ("These words were
  generated fresh for this plan. Never use them as a Bitcoin wallet — same format, different job.")
  + an **"Advanced: show as nsec"** disclosure (`.advBtn`/`.advChevron`/`.advPanel`)
  rendering the existing `<SecretKeyCard nsec={nip19.nsecEncode(sk)}/>` for Nostr natives.
  **R2c-6a — the ack checkbox is GONE; K2 merges the ceremony's semantics:** save aids (Download / Save… / QR,
  reusing `buildRecoveryFileText`/`recoveryFileName`/`downloadBlob` + `QRCodeSVG`/`QRCodeCanvas` — plaintext
  `kind='words'`, no encrypt toggle) gate a **word quiz** (`pickQuizIndices`/`checkQuizAnswers`); Continue needs
  `savedOnce` (require-save) + two correct words → `setBackupVerifiedAt(Date.now())` (pre-auth field-only, the K2
  bridge's spot) → K3 → VERIFIED. A ghost **"I'll do this later"** skips quiz+stamp → generated-UNVERIFIED → the
  R2c-2/5b ladder. ⚠ `handleGenerate`/`handleStartOver` `setBackupVerifiedAt(null)` on (re)mint (the field rides
  partialize `...rest` → a stale stamp would falsely verify fresh words). + "Start over" (no Back). **K3**
  `probeKeyVaultCapability` → single "Enable Face ID" (biometric) or the ViewerLoginFlow PIN+confirm UI (PIN);
  Success → `establishLocalOwner(entropyRef.current, m, nostr, { pin, payloadKind: 'nip06-entropy' })` (wraps the
  ENTROPY; the sk is derived internally) → `onComplete`. `setKeyProvenance('generated')` precedes the establish;
  the catch-block clears BOTH provenance + `backupVerifiedAt` (a K3 failure rolls back a real K2 verification).
  `onLogIn` is a small justified extension of the spec's
  `{onComplete,onBack}` (the guard's [Log in] needs to reach the loginFlow).
- **`src/components/Onboarding/WordGrid.tsx`** (+ css) — the 12-word recovery grid, **dual-mode** (a `WordGrid`
  dispatcher over two internal components so hooks stay unconditional). Props are a discriminated union on `mode`.
  **`mode: 'reveal'`** (R2b-1 — `<RevealGrid>`, OwnerKeySetup K2): the R2b-1 body relocated verbatim (output
  byte-identical) — mirrors `SecretKeyCard`'s blur/reveal + Copy (btc-tinted `--surface-2` card, `--mono`,
  `filter: blur(6px)` + `user-select:none`, "Tap to reveal" pill, `Copy → Copied ✓` over `words.join(' ')`);
  numbered 1–12 `<ol>`; **NOT a `<button>` wrapper** (a grid is flow content, invalid inside `<button>`) → the
  repo's `role="button" tabIndex={0}` + Enter/Space `keydown` idiom. **`mode: 'input'`** (R2b-3 — `<InputGrid>`,
  NostrAuthGate's Recovery-phrase tab): 12 controlled `<input>` boxes (`{ values, onChange, onKeyPasted,
  onSubmitAttempt? }`), each with the 4 iOS suppressions. **⚠ CLEAR TEXT by deliberate decision** — a masked
  12-box grid is unusable (no proofread, no autocomplete) and clear-text seed entry is the wallet convention;
  accepted shoulder-surf tradeoff. **The three LOCKED interaction decisions:** (1) **commit keys** — Space/Enter
  commit + advance (`preventDefault` + focus box i+1, or blur+`onSubmitAttempt` at box 12); **Tab is left native**
  (DOM order already advances box→box; suggestion buttons are `tabIndex={-1}` so Tab from box 12 reaches Continue);
  NO auto-jump on 4 letters. (2) **paste** (per-box, `classifyRecoveryInput(clipboard)` first) — `nsec` **or
  `encrypted`** (R2c-7a) → `onKeyPasted` (routes to the parent's Recovery-key tab); exactly 12 → fill all from box 1; 2–11 → distribute from the
  focused box, truncate at box 12; single → native. (3) **validity surface** — per-box tint neutral until first
  blur, then green (`isWord`) / amber; a paste does NOT mark touched (LOCKED "until first blur" is literal). One
  suggestion strip below the grid bound to the focused box (≤4 `suggestWords`); **buttons use `onPointerDown` +
  `preventDefault`** so the tap never blurs the box first (focus + selection survive → the suggestion commits and
  advances). ⚠ **That focus-preservation is a NEW pattern for this repo** — no prior precedent; the standard
  toolbar-button-beside-input technique. `DraggableSheet`'s `activeElement`-aware pointerdown is the nearest
  *conceptual* cousin (it reads `activeElement`), NOT the same mechanism (it force-`blur()`s). ⚠ Never logs. **The
  grid is capture UX only — `skFromWords` on submit is the validity authority; green/checksum are hints.**
- **`OnboardingModal`** gains a `keySetup` sub-state mirroring `viewerFlow`/`loginFlow` (early-return
  `<OwnerKeySetup onComplete={→setStep(2)} onBack={→fork} onLogIn={→setLoginFlow(true)}/>`); `onStartNew` →
  `setKeySetup(true)` (was `setStep(2)`). The numbers wizard + `handleDone` are untouched.
  **`ChoosePathView`** card-1 sub-line → "Create your own — keys generated on this device".
- **AppShell is SAFE with no edits** (verified): `AppShell.tsx:284` renders `<OnboardingModal>` while
  `!onboardingComplete`; every auth gate is `onboardingComplete && …`-gated, so `establishLocalOwner`
  flipping auth/pubkey/method mid-onboarding cannot unmount the modal or trip a gate. On final
  `onComplete → setOnboardingComplete(true)` the ladder re-evaluates and lands on the app (LocalUnlockGate/
  NostrAuthGate skip because `isAuthenticated` is already true).
- **Sync safety (tradeoff closure):** K3's `syncNow` hits an empty relay for the brand-new key → pulls
  nothing → `initialSettingsPullDone=true`, nothing publishes (not dirty; Fix D refuses seed defaults). The
  wizard's `handleDone(true)` then writes real numbers → the debounced publish ships the actual plan as the
  first settings event. **No store version bump** (wrapped key reuses existing keyVault storage). Suite 454
  → 456.

---

## Access Phase 2 — Identity, Access & Recovery cleanup (store unchanged, NO bump)

Makes the identity/access surface coherent after 1.5 (every owner is now authed from minute one). UI-only —
every store field is unchanged; `nostrAuthEnabled` + its `!!nostrPubkey` derivation are KEPT (load-bearing for
the Bug-3 render ladder + sync banners), only the dead toggle UI is removed. **Consumes 1.5's `SecretKeyCard`.**

- **NostrAuthGate `backLabel?: string` prop** (default `'← Back'`): the back button (was hardcoded
  "← Back to Face ID unlock") now reads `{backLabel ?? '← Back'}`. Only **AppShell:326** (the locked-out
  local-unlock escape) passes the original string; the **SettingsMain access door** + **OnboardingModal fork
  login** use the default. Label-only.
- **autoRestore nip46 guard** (`useNostrAutoRestore.ts`): after the `local` guard, `if (nostrSigningMethod ===
  'nip46' && !nostrLogin) return;` — a nip46 session with no persisted `nostrLogin` can't be silently rebuilt,
  so skipping optimistic auth kills the ~1.5s authed-app flash before the gate.
- **ACCESS group — state-aware login door** (SettingsMain menu): "Connect Nostr identity" is now gated
  `!viewerMode && !isAuthenticated` (an authed owner sees no duplicate sign-in door — Identity & Security is the
  connected-identity home; the "Identity & Security" drill-in row stays `!viewerMode`). "Connect to a shared
  plan" unchanged.
- **Toggle retired (UI only)**: the "Enable Nostr Lock" row + the orphaned `setNostrAuthEnabled`/`nostrAuthEnabled`
  selectors + the **dead** `nostrAuthEnabled && !nostrPubkey` warning (dead because `nostrAuthEnabled ≡
  !!nostrPubkey`) are removed. The rebuilt connected sections key off `nostrPubkey`.
- **Identity & Security page rebuilt** into grouped sections (all reusing existing handlers): **IDENTITY CARD**
  (hero `.identityCard`, `--surface-2` + orange-ring ₿: truncated npub tap-to-copy · method chip `Face ID · local
  key`/`Extension (NIP-07)`/`Remote signer (NIP-46)` · status dot `.identityDotOn` green Connected / `.identityDotWarn`
  amber "Reconnect needed" via `nostrReconnectNeeded`) → **SYNC** ("Plan synced · {relativeSync(lastPlanEventsSyncAt)}" — 4e; it read "Settings synced" from `lastSettingsSyncAt`, the retired channel's clock
  / "Records synced · {relativeSync(lastRecordsSyncAt)}" [relative TIME, "never" when null — `relativeSync` mirrors
  ViewerHomeView's m/h/d convention; NOT relay hosts] + Sync now) → **THIS DEVICE** (signing-method row + exactly ONE
  exit per method: local → Remove local key; nip07/46 → **Disconnect** now with a confirm "…Your plan stays on the
  relay." → `disconnectNostr()`) → **RECOVERY** (`<RevealRecoveryKey/>` local-only · **Backup plan** →
  `setSettingsPage('backup')` · retained Reset-&-re-sync escape hatch · conditional decrypt-back) → footer "Your key
  is encrypted at rest and never stored in plain text." `!nostrPubkey` → a calm "No identity connected" hint.
- **`RevealRecoveryKey.tsx`** (+ css, NEW `components/Settings/`) — the lost-my-backup escape hatch. Rendered ONLY
  when `settingsPage === 'identity' && nostrSigningMethod === 'local'`, so leaving the page **unmounts it →
  discards the revealed nsec**. Tap "Reveal recovery key" → PRF: Face ID directly / PIN: an inline PIN field →
  `unwrapSecretKey(writerKeyWrapped, writerKeyWrapMeta, pin?)` (**unwrap required on EVERY reveal**) →
  `nip19.nsecEncode(sk)` → `sk.fill(0)` immediately → `<SecretKeyCard/>` → **auto-re-blur/clear after ~30s** (or
  Hide, or unmount). ⚠ Never logs the key.
- **No store version bump.** Suite unchanged at 456 (UI-only; flow is device territory).
- **Settings Phase 2 Step 2 — COMPLETE (gap audit against HEAD confirmed everything above is shipped; no
  further code):** the Identity & Security page ships the 5-group structure — **IDENTITY CARD → SYNC → THIS
  DEVICE → RECOVERY → security-note footer** (+ the `!nostrPubkey` "No identity connected" fallback), rows
  already organized into those labeled groups. The **"Enable Nostr Lock" inert toggle is already removed** (no
  `nostrAuthEnabled`/`setNostrAuthEnabled` control anywhere in `SettingsMain.tsx`; every remaining `Toggle` is
  wired to a real action). **RECOVERY** already carries `<RevealRecoveryKey/>` (local-only — the "prove the
  wrapped key still unwraps" decrypt path: `unwrapSecretKey → nsecEncode → SecretKeyCard`, auto-clear ~30s) +
  the **conditional decrypt-back** ("Turn off at-rest encryption", `showDecryptBack`/`handleDecryptBack`) +
  Backup plan + Reset-&-re-sync. The **nip46 reconnect-flash guard** is live at `useNostrAutoRestore.ts:21`
  (`if (nostrSigningMethod === 'nip46' && !nostrLogin) return;`, before the optimistic auth), with redundant
  lower-layer defense at `session.ts` (the nip46 restore worker throws on missing login). **Deliberate scope
  call:** **at-rest encryption STATE stays DevPanel-only** — no user-facing "On/Off" row on the Identity page
  (encryption is OFF-by-default, dev-gated maturation; the only user-facing surface is the conditional RECOVERY
  decrypt-back + the footer note).

---

