import { useState, useEffect, useMemo, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { nip19 } from 'nostr-tools';
import * as nip49 from 'nostr-tools/nip49';
import { connectNip07 } from '../../lib/nostr/signers';
import { establishLocalOwner } from '../../lib/nostr/establishOwner';
import { restoreSigner } from '../../lib/nostr/session';
import { syncNow, markSignerFresh } from '../../lib/nostr/syncNow';
import { getDeviceLabel } from '../../lib/nostr/deviceTag';
import { probeKeyVaultCapability, type WrapMethod, type PayloadKind } from '../../lib/nostr/keyVault';
import { entropyFromWords, InvalidSeedWordsError } from '../../lib/nostr/nip06Key';
import { classifyRecoveryInput } from '../../lib/nostr/recoveryInput';
import { isWellFormedNcryptsec, classifyNcryptsecError } from '../../lib/nostr/ncryptsec';
import { phraseStatus } from '../../lib/recoveryGrid';
import { downloadBlob } from '../../lib/backup/downloadFile';
import { buildRecoveryFileText, recoveryFileName } from '../../lib/backup/recoveryFile';
import { todayLocalISO } from '../../utils/format';
import { WordGrid } from '../Onboarding/WordGrid';
import { PassphraseInput } from '../ui/PassphraseInput';
import { biometricLabel } from '../../lib/biometricLabel';
import type { NostrSigner } from '../../lib/nostr/signers';
import { useStore } from '../../store/useStore';
import { useNostr } from '@nostrify/react';
import {
  NLogin,
  NUser,
  generateNostrConnectParams,
  generateNostrConnectURI,
  type NostrConnectParams,
  type NostrConnectStatus,
} from '@nostrify/react/login';
import styles from './NostrAuthGate.module.css';

export function NostrAuthGate({ onSuccess, onBack, backLabel }: { onSuccess: () => void; onBack?: () => void; backLabel?: string }) {
  const setNostrPubkey        = useStore((s) => s.setNostrPubkey);
  const setNostrSigningMethod = useStore((s) => s.setNostrSigningMethod);
  const setIsAuthenticated    = useStore((s) => s.setIsAuthenticated);
  const setNostrBunkerUri     = useStore((s) => s.setNostrBunkerUri);

  const { nostr }     = useNostr();

  const [showBunker, setShowBunker]           = useState(false);
  const [showAdvanced, setShowAdvanced]       = useState(false);   // R2b-2: extension / QR / bunker live behind this, collapsed by default
  const [bunkerUri, setBunkerUri]             = useState('');
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState<string | null>(null);

  const [connectParams, setConnectParams]     = useState<NostrConnectParams | null>(null);
  const [connectUri, setConnectUri]           = useState('');
  const [connectStatus, setConnectStatus]     = useState<NostrConnectStatus | null>(null);
  const [hasOpenedSigner, setHasOpenedSigner] = useState(false);
  const [showStuckHint, setShowStuckHint]     = useState(false);
  const abortRef                              = useRef<AbortController | null>(null);

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const hasNip07 = typeof window !== 'undefined' && !!(window as any).nostr;

  // ── Recovery Key (local-key / Face-ID signer) flow ───────────────────────────
  const [showLocal, setShowLocal]         = useState(false);
  const hasWrappedKey = !!useStore((s) => s.writerKeyWrapped);   // #6: a wrapped key survives a local→nip46→local switch
  const [forceImport, setForceImport]     = useState(false);     // #6: user chose to import a different key
  const [recoveryTab, setRecoveryTab]     = useState<'words' | 'key'>('words');   // R2b-3: default to the word grid
  const [gridValues, setGridValues]       = useState<string[]>(() => Array(12).fill(''));   // R2b-3 words tab — ⚠ transient secret
  const [recoveryInput, setRecoveryInput] = useState('');   // the "Recovery key" tab's field — an nsec OR an ncryptsec (R2c-7a)
  const [reveal, setReveal]               = useState(false);   // proofread a typed key (masked by default)
  const [localMethod, setLocalMethod]     = useState<WrapMethod | null>(null);
  const [pin, setPin]                     = useState('');
  const [pinConfirm, setPinConfirm]       = useState('');
  const [keyLabel, setKeyLabel]           = useState('');   // names the passkey (PRF path only)

  // ── R2c-7a-2 — bare-nsec remediation. A pasted RAW nsec is an unprotected key, so it does not establish on
  // paste: it routes through a download-gated protect step that PRODUCES the encrypted backup the user lacked.
  // ⚠ This gates WHEN the key establishes, never WHAT gets wrapped — a bare nsec still wraps payloadKind 'sk'.
  // The 'encrypted' branch already arrives protected and the 'words' branch is the richer artifact; both skip this.
  //
  // ⚠ The sk lives in a REF, not state: the unmount cleanup below must zero the CURRENT buffer, and an effect
  // closing over a state Uint8Array reads a stale value and zeroes nothing. Same bytesRef+flag shape as
  // RecoveryKeyCeremony. `remediating` is the render flag.
  const pendingSkRef                      = useRef<Uint8Array | null>(null);   // ⚠ transient secret
  const [remediating, setRemediating]     = useState(false);
  const [bareNsecPass, setBareNsecPass]   = useState('');   // ⚠ transient secret (encrypt direction)
  const [bareNsecSaved, setBareNsecSaved] = useState(false);
  const [encrypting, setEncrypting]       = useState(false);
  const [aidError, setAidError]           = useState<string | null>(null);

  // Web Share exists on iOS and on desktop Chrome/Safari; it is absent elsewhere. The "Save…" button RENDERS only
  // where it works — Download is the universal path. Same predicate as RecoveryKeyCeremony's `canShare`.
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const zeroPendingSk = () => { pendingSkRef.current?.fill(0); pendingSkRef.current = null; };
  useEffect(() => () => { pendingSkRef.current?.fill(0); }, []);   // defensive: zero on unmount

  // ── R2c-7a — encrypted-key (NIP-49 ncryptsec) unlock. Mirrors ViewerLoginFlow's PROVEN pattern verbatim. ──
  //
  // ⚠ SCOPE (R2c-7a-fix): this branch is CORRECT-BUT-INPUT-STARVED BY DESIGN, not dead code. Owner-key
  // ncryptsec input arrives with R2c-7b (encrypted backup export) / R2c-7a-2 (bare-nsec remediation). Until one
  // of them ships a producer, the only well-formed ncryptsec a user could obtain is the VIEWER key inside a
  // SharingPage handoff token — which `pastedIsHandoffToken` below rejects outright, because importing a viewer
  // key as the owner identity is a silent category error. So: it awaits its producer.
  //
  // Memoized because classifyRecoveryInput returns a fresh object each render and this is an effect dep.
  const keyInput = useMemo(() => classifyRecoveryInput(recoveryInput), [recoveryInput]);

  // A handoff token is `<keyPart>:<ownerNpub>` (handoffToken.ts). `:` is NOT in the bech32 alphabet, so it can
  // never appear in a legitimate nsec/ncryptsec — nor in 12 words. A colon anywhere therefore means "token".
  // ⚠ We test `.includes(':')` rather than `parseHandoffToken(...) !== null` on purpose: parseHandoffToken
  // returns null for a MALFORMED token (bad npub half), which would fall through and be misreported. This also
  // catches a plaintext `nsec1…:npub1…` token, which classifies as 'nsec' and would otherwise die with a bare
  // "Not a valid nsec". NEVER auto-strip the suffix — the key inside is a viewer key.
  const pastedIsHandoffToken = recoveryInput.trim().includes(':');
  // LAYER 1 — cheap shape gate (no crypto). Only a well-formed ncryptsec earns a passphrase field, so a
  // malformed payload can never be misreported as a wrong passphrase.
  const encryptedShapeOk = keyInput.kind === 'encrypted' && isWellFormedNcryptsec(keyInput.value);
  const showPassphraseField = encryptedShapeOk && !pastedIsHandoffToken;
  // ⚠ NOT the device PIN. This passphrase DECRYPTS the pasted ncryptsec; the PIN below protects the key at rest
  // on this device. Both fields can be on screen at once — the R1.5 passphrase-vs-PIN confusion — so the labels
  // are state-specific, never a generic "Passphrase". (R2c-7a-2 adds the inverse ENCRYPT passphrase here too.)
  const [keyPassphrase, setKeyPassphrase] = useState('');
  const [debouncedPassphrase, setDebouncedPassphrase] = useState('');
  // 3000ms: nip49.decrypt is SYNCHRONOUS scrypt (default logn 16) — decrypting per keystroke would freeze the
  // mobile main thread.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedPassphrase(keyPassphrase), 3000);
    return () => clearTimeout(t);
  }, [keyPassphrase]);
  // The decrypt runs in an EFFECT, not a memo: a memo would block the same render/paint that commits the
  // debounced passphrase, so "Checking passphrase…" would never actually paint before the freeze. The 30ms
  // setTimeout yields exactly one frame so it does.
  // `error` distinguishes the two failures R2c-7a conflated. LAYER 2: after the shape gate, the only structural
  // failure left inside decrypt is a bech32 CHECKSUM (a 1-char typo keeps length + charset) — classify it
  // rather than blaming the passphrase. ⚠ Never render the caught e.message: bech32 echoes the whole ncryptsec.
  const [decryptState, setDecryptState] = useState<{ sk: Uint8Array | null; checking: boolean; error: null | 'malformed' | 'passphrase' }>(
    { sk: null, checking: false, error: null },
  );
  useEffect(() => {
    const trimmed = debouncedPassphrase.trim();   // symmetric with the trim at encrypt time
    if (!showPassphraseField || !trimmed) {
      setDecryptState({ sk: null, checking: false, error: null });
      return;
    }
    setDecryptState({ sk: null, checking: true, error: null });   // never carry a stale key while re-checking
    const t = setTimeout(() => {
      try { setDecryptState({ sk: nip49.decrypt(keyInput.value, trimmed), checking: false, error: null }); }
      catch (e) { setDecryptState({ sk: null, checking: false, error: classifyNcryptsecError(e) }); }
    }, 30);
    return () => clearTimeout(t);   // a stale in-flight decrypt must not land after a newer keystroke
  }, [keyInput, debouncedPassphrase, showPassphraseField]);

  useEffect(() => {
    if (!showLocal) return;
    let cancelled = false;
    probeKeyVaultCapability().then((m) => { if (!cancelled) setLocalMethod(m); });
    return () => { cancelled = true; };
  }, [showLocal]);

  const openLocal = () => {
    setShowLocal(true);
    setForceImport(false);
    setRecoveryTab('words');
    setGridValues(Array(12).fill(''));   // ⚠ transient secret — reset here (the ONLY scrub site; see residual note below)
    setRecoveryInput('');
    setKeyPassphrase('');                // R2c-7a — ⚠ transient secrets, same scrub site
    setDebouncedPassphrase('');
    setDecryptState({ sk: null, checking: false, error: null });
    setReveal(false);
    setLocalMethod(null);
    setPin('');
    setPinConfirm('');
    setKeyLabel('');
    setError(null);
    // R2c-7a-2 — ⚠ transient secrets, same scrub site
    zeroPendingSk();
    setRemediating(false);
    setBareNsecPass('');
    setBareNsecSaved(false);
    setEncrypting(false);
    setAidError(null);
  };

  const handleLocal = async () => {
    setLoading(true);
    setError(null);
    // The bytes we WRAP AT REST. 'sk' → the 32-byte secret key itself; 'nip06-entropy' → the 16 bytes behind
    // the recovery phrase (establishLocalOwner derives the signing sk from them internally).
    let payload: Uint8Array | null = null;
    let payloadKind: PayloadKind = 'sk';
    try {
      // R2b-2 dual-format: classify by SHAPE, then let the format's own crypto own the verdict.
      // R2b-3: the raw string comes from the active tab — the word grid (joined) or the nsec field. handleLocal
      // stays a SINGLE path; the tab only chooses what feeds classifyRecoveryInput.
      const raw = recoveryTab === 'words' ? gridValues.map((v) => v.trim()).join(' ') : recoveryInput;
      // Defense in depth: localCanContinue already blocks this, but a handoff token must NEVER reach
      // establishLocalOwner — the key inside it is a VIEWER key, so importing it would silently authenticate
      // the owner as their own viewer. A clear rejection beats the wrong identity.
      if (recoveryTab === 'key' && raw.trim().includes(':')) {
        setError("That's a viewer share code, not your Recovery Key.");
        setLoading(false);
        return;
      }
      const input = classifyRecoveryInput(raw);
      if (input.kind === 'nsec') {
        let decoded;
        try { decoded = nip19.decode(input.value); }
        catch { setError('Not a valid nsec'); setLoading(false); return; }
        if (decoded.type !== 'nsec') { setError('That key is not an nsec'); setLoading(false); return; }
        // R2c-7a-2 — ⛔ a bare nsec does NOT establish here. It is an unprotected key, so it routes through the
        // remediation step (encrypt → save → Continue), which calls the SAME establish tail. payloadKind stays
        // 'sk' either way — the gate is on WHEN, not WHAT.
        payload = decoded.data as Uint8Array;    // the `finally` zeros this raw decode buffer
        pendingSkRef.current = payload.slice();  // ⚠ defensive copy — never alias the decode buffer into a long-lived ref
        setRemediating(true);
        return;
      } else if (input.kind === 'encrypted') {
        // R2c-7a — the sk came from the DEBOUNCED decrypt effect; never re-decrypt here (blocking scrypt).
        if (!isWellFormedNcryptsec(input.value)) {
          setError("That doesn't look like a valid key — check for a truncated paste.");
          setLoading(false);
          return;
        }
        if (!decryptState.sk) { setError('Enter the passphrase that unlocks this key.'); setLoading(false); return; }
        // ⚠ .slice() IS LOAD-BEARING. establishLocalOwner zeros the payload on success, and the `finally` below
        // zeros it on failure. The nsec/words branches re-derive a FRESH buffer from the input string each
        // attempt, so they're immune — but this one reads a Uint8Array out of React state. Without the copy, a
        // failed establish (Face ID cancelled) would zero decryptState.sk IN PLACE, and the retry would hand
        // establishLocalOwner 32 zero bytes — which it WRAPS AND PERSISTS to writerKeyWrapped *before* deriving
        // the pubkey, then throws. That leaves a corrupted credential on disk for an identity that never existed.
        payload = decryptState.sk.slice();
        // payloadKind stays 'sk': an ncryptsec decrypts to a RAW SECRET KEY. No mnemonic exists behind it, so
        // there's nothing for the ceremony to re-display — no word grid, exactly as for a bare nsec. That's the
        // honest consequence of the source being a key, not a phrase.
      } else if (input.kind === 'words') {
        try { payload = entropyFromWords(input.value); payloadKind = 'nip06-entropy'; }
        catch (e) {
          // InvalidSeedWordsError's message is user-facing prose by contract (nip06Key.ts) — render it verbatim.
          setError(e instanceof InvalidSeedWordsError ? e.message : 'Not a valid Recovery Key');
          setLoading(false);
          return;
        }
      } else {
        setError('Enter your 12-word Recovery Key, an nsec, or an encrypted key.');
        setLoading(false);
        return;
      }

      const method = localMethod ?? await probeKeyVaultCapability();
      // Backup gate (R2a-1): the user holds this key elsewhere already (the hard backup gate above
      // enforces that) → never gated. Stamped BEFORE establishLocalOwner's internal syncNow.
      useStore.getState().setKeyProvenance('imported');
      // ⚠ R2c-4b INVARIANT — SUPERSEDES R2b-2's "imported words wrap 'sk'". The three formats are ASYMMETRIC:
      //   words     → 'nip06-entropy'. We store the 16 bytes BEHIND the phrase, so RevealRecoveryKey and the
      //               R2c-1 ceremony can re-derive and word-quiz the user's ACTUAL words instead of an nsec they
      //               never saw. Identity is preserved: deriveSkFromEntropy(entropyFromWords(w)) === skFromWords(w).
      //   nsec      → 'sk', forever. A raw secret key has NO mnemonic — nothing to re-display, so
      //               unwrapRecoveryPayload reports 'sk' and the reveal/ceremony fall back to nsec display.
      //   encrypted → 'sk' (R2c-7a). An ncryptsec decrypts TO a raw secret key, so it inherits the nsec case
      //               exactly: no phrase existed, none can be shown.
      // (R2b-2 said "do not fix this into entropy storage" — correct then, because no ceremony existed to verify
      // words. R2c-1 shipped it, which is exactly what justifies the reversal.)
      await establishLocalOwner(payload, method, nostr, { pin, keyLabel, payloadKind });   // shared with OwnerKeySetup K3
      onSuccess();
    } catch (err: any) {
      useStore.getState().setKeyProvenance(null);   // R2a-1 rollback: stamped pre-establish; a throw must not freeze it (write-once)
      setError(err?.message ?? 'Could not set up the local key');
    } finally {
      payload?.fill(0);   // best-effort zero of the sk OR the entropy (NSecSigner holds its own copy for the session)
      setLoading(false);
    }
  };

  // ── R2c-7a-2 — the remediation step's handlers ───────────────────────────────

  /**
   * Encrypt the held sk under the user's passphrase and build the artifact.
   *
   * ⚠ `nip49.encrypt` is ~1s of SYNCHRONOUS scrypt (see RecoveryKeyCeremony's ensureArtifact). Setting
   * `encrypting` and calling it in the same tick means React never commits the "Encrypting…" render — the button
   * would just freeze. So yield 30ms first, exactly as the ceremony does. No prepRef stale-guard is needed: this
   * is a one-shot on tap and the passphrase input is disabled while encrypting, so the inputs cannot change
   * mid-encrypt.
   *
   * ⚠ `.trim()` is SYMMETRIC with every decrypt site (ViewerLoginFlow, the key tab above, the ceremony). An
   * untrimmed passphrase here would silently never restore.
   * ⚠ The sk is already in hand — derive nothing, and do NOT zero it here (Continue still needs it).
   */
  const buildEncryptedBackup = async (): Promise<string | null> => {
    const sk = pendingSkRef.current;
    if (!sk) return null;
    setAidError(null);
    setEncrypting(true);
    await new Promise((r) => setTimeout(r, 30));
    try {
      return nip49.encrypt(sk, bareNsecPass.trim());
    } catch {
      setAidError("Couldn't encrypt — try again.");   // ⚠ never e.message (nip49/bech32 errors echo key material)
      return null;
    } finally {
      setEncrypting(false);
    }
  };

  const downloadBackup = async () => {
    const ncryptsec = await buildEncryptedBackup();
    if (!ncryptsec) return;
    const blob = new Blob([buildRecoveryFileText('ncryptsec', ncryptsec)], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, recoveryFileName('ncryptsec', todayLocalISO()));
    setBareNsecSaved(true);
  };

  /** ⚠ savedOnce ONLY on resolve: an iOS share-sheet cancel rejects with AbortError, and a cancelled share is not
   *  a save. And guard `!navigator.share` FIRST — `await navigator.share?.()` resolves undefined and would open
   *  the gate (both lessons from R2c-7b-fix). */
  const shareBackup = async () => {
    if (!navigator.share) return;
    const ncryptsec = await buildEncryptedBackup();
    if (!ncryptsec) return;
    try { await navigator.share({ text: ncryptsec }); setBareNsecSaved(true); } catch { /* cancelled → not a save */ }
  };

  /** The SAME establish tail the inline branches use — method resolve, provenance stamp, rollback, zeroing. */
  const continueAfterBackup = async () => {
    const sk = pendingSkRef.current;
    if (!sk) return;
    setLoading(true);
    setError(null);
    try {
      const method = localMethod ?? await probeKeyVaultCapability();
      useStore.getState().setKeyProvenance('imported');   // R2a-1: stamped BEFORE establishLocalOwner's internal syncNow
      // ⚠ .slice() IS LOAD-BEARING (bufferAliasing.test.ts). establishLocalOwner WRAPS AND PERSISTS the payload to
      // writerKeyWrapped *before* deriving the pubkey, then zeros it in a `finally` — on success AND on failure.
      // Passing the held buffer would let a cancelled Face ID zero it in place, and the RETRY would wrap 32 zero
      // bytes: a corrupted credential for an identity that never existed. The copy absorbs the zeroing, so a
      // failed establish leaves `pendingSkRef` intact and Continue stays retryable.
      await establishLocalOwner(sk.slice(), method, nostr, { pin, keyLabel, payloadKind: 'sk' });
      zeroPendingSk();          // success only — the key is now wrapped at rest
      setBareNsecPass('');
      onSuccess();
    } catch (err: any) {
      useStore.getState().setKeyProvenance(null);   // R2a-1 rollback: write-once, must not freeze on a throw
      setError(err?.message ?? 'Could not set up the local key');
    } finally {
      setLoading(false);
    }
  };

  const cancelRemediation = () => {
    zeroPendingSk();
    setRemediating(false);
    setBareNsecPass('');
    setBareNsecSaved(false);
    setAidError(null);
    setError(null);
  };

  // #6: a wrapped key already exists — unlock it (Face ID) via restoreSigner instead of forcing an nsec re-import.
  const handleUnlockExisting = async () => {
    setLoading(true);
    setError(null);
    try {
      useStore.getState().setNostrSigningMethod('local');   // restore local context (may have flipped on a method switch) so restoreSigner's local branch runs
      const signer = await restoreSigner(nostr);
      if (!signer) throw new Error('Unlock failed');
      setIsAuthenticated(true);
      onSuccess();
    } catch (e: any) {
      if (String(e?.message).includes('pubkey mismatch')) {
        setForceImport(true);   // saved key is a different account → fall back to import
        setError("This device's saved key is for a different account — paste the nsec to switch, or go back.");
      } else {
        setError(e?.message ?? 'Unlock failed — try again');
      }
    } finally {
      setLoading(false);
    }
  };

  // R2b-3: gate on the CHECKSUM in the words tab (entropyFromWords on submit is still the authority — the
  // checksum line is only a hint). R2c-7a: the key tab is now KIND-AWARE — an unresolved shape can't submit,
  // and an ncryptsec can't submit until its passphrase has actually decrypted. (12 words pasted into the key
  // field DO submit: classifyRecoveryInput resolves them to 'words' and handleLocal imports them correctly down
  // the entropy path — we only nudge the user toward the phrase tab.)
  // R2c-7a-fix: a handoff token or a malformed ncryptsec can NEVER submit — both are rejected at the key field.
  const keyTabReady =
    !pastedIsHandoffToken &&
    keyInput.kind !== 'unknown' &&
    (keyInput.kind !== 'encrypted' || (encryptedShapeOk && decryptState.sk != null));
  // The ONLY precondition is a valid, resolved key for the active tab (+ a confirmed PIN when there's no passkey).
  // There is deliberately NO "I backed it up" attestation here: on the IMPORT path the user is pasting a key they
  // already hold, so the paste IS the proof of possession. A checkbox asserting it would gate nothing and would
  // train reflexive ticking — eroding the acks that DO mean something (OwnerKeySetup K2, the ceremony's verify).
  const localCanContinue =
    (recoveryTab === 'words' ? phraseStatus(gridValues) === 'valid' : keyTabReady) &&
    (localMethod !== 'pin' || (pin.length >= 4 && pin === pinConfirm));

  const handleNip07 = async () => {
    setLoading(true);
    setError(null);
    try {
      const { signer, pubkey } = await connectNip07();
      useStore.getState().setNostrSigner(signer);
      markSignerFresh();
      setNostrPubkey(pubkey);
      setNostrSigningMethod('nip07');
      useStore.getState().setKeyProvenance('external');   // R2a-1: key lives in the extension — nothing for us to back up. Stamped BEFORE syncNow.
      syncNow(nostr);
      setIsAuthenticated(true);
      onSuccess();
    } catch (err: any) {
      setError(err.message ?? 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleNip46 = async () => {
    if (!bunkerUri.startsWith('bunker://')) {
      setError('URI must start with bunker://');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const login  = await NLogin.fromBunker(bunkerUri, nostr);
      const user   = NUser.fromBunkerLogin(login, nostr);
      const signer = user.signer as unknown as NostrSigner;
      const pubkey = user.pubkey;
      useStore.getState().setNostrSigner(signer);
      markSignerFresh();
      setNostrPubkey(pubkey);
      setNostrSigningMethod('nip46');
      setNostrBunkerUri(bunkerUri);
      useStore.getState().setNostrLogin(JSON.stringify({ ...login, pubkey }));
      useStore.getState().setKeyProvenance('external');   // R2a-1: key lives in the remote signer — nothing for us to back up. Stamped BEFORE syncNow.
      syncNow(nostr);
      setIsAuthenticated(true);
      onSuccess();
    } catch (err: any) {
      setError(`Connection error: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const generateSession = () => {
    const params = generateNostrConnectParams(['wss://relay.primal.net']);
    const uri = generateNostrConnectURI(params, {
      name: `Personal ₿LOC · ${getDeviceLabel()}`,   // per-device — makes the session prunable in Primal's connected-apps list
      callback: isMobile
        ? `${window.location.origin}/remoteloginsuccess`
        : undefined,
    });
    setConnectParams(params);
    setConnectUri(uri);
    setConnectStatus(null);
    setHasOpenedSigner(false);
    setError(null);
  };

  const handleOpenSignerApp = () => {
    setHasOpenedSigner(true);
    window.location.href = connectUri;
  };

  useEffect(() => {
    if (!connectParams) return;
    const controller = new AbortController();
    abortRef.current = controller;

    const run = async () => {
      try {
        const login = await NLogin.fromNostrConnect(
          connectParams,
          nostr,
          { signal: controller.signal, onStatus: setConnectStatus },
        );
        if (controller.signal.aborted) return;
        const signer = NUser.fromBunkerLogin(login, nostr).signer;
        useStore.getState().setNostrSigner(signer as unknown as NostrSigner);
        markSignerFresh();
        setNostrPubkey(login.pubkey);
        setNostrSigningMethod('nip46');
        useStore.getState().setNostrLogin(JSON.stringify({ ...login, pubkey: login.pubkey }));
        useStore.getState().setKeyProvenance('external');   // R2a-1: key lives in the remote signer — nothing for us to back up. Stamped BEFORE syncNow.
        syncNow(nostr);
        setIsAuthenticated(true);
        onSuccess();
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        setError('Remote signer connection failed — try again');
        setConnectParams(null);
        setConnectUri('');
        setConnectStatus(null);
      }
    };

    run();
  }, [connectParams]);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Primal poison-session legibility: a lingering dead session for the same pubkey wedges new
  // handshakes at "getting public key…" — surface the fix after 15s instead of spinning forever.
  useEffect(() => {
    if (connectStatus !== 'getting-public-key') { setShowStuckHint(false); return; }
    const t = setTimeout(() => setShowStuckHint(true), 15000);
    return () => clearTimeout(t);   // status change / retry / unmount
  }, [connectStatus]);

  const cancelQR = () => {
    abortRef.current?.abort();
    setConnectParams(null);
    setConnectUri('');
    setConnectStatus(null);
    setHasOpenedSigner(false);
    setError(null);
  };

  const showSpinner =
    connectStatus === 'getting-public-key' ||
    (isMobile && hasOpenedSigner);

  const statusText =
    connectStatus === 'getting-public-key' ? 'Getting public key…' : 'Waiting for signer…';

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.logo}>₿</div>
        <h1 className={styles.title}>Personal ₿LOC</h1>
        <p className={styles.subtitle}>Connect your Nostr identity to continue</p>

        {connectUri ? (
          <div className={styles.qrView}>
            {showSpinner ? (
              <>
                <p className={styles.qrWaiting}>{statusText}</p>
                {showStuckHint && (
                  <p className={styles.hint}>
                    Stuck here? In Primal: Settings → Connected apps — remove old Personal ₿LOC sessions, then retry. A lingering dead session blocks new connections.
                  </p>
                )}
                {isMobile && (
                  <button className={styles.primaryBtn} onClick={handleOpenSignerApp}>
                    Open Signer App
                  </button>
                )}
                <button className={styles.ghostBtn} onClick={cancelQR}>
                  ← Cancel
                </button>
              </>
            ) : isMobile ? (
              <>
                <p className={styles.hint}>Connecting to relay… then tap to open your signer</p>
                <button className={styles.primaryBtn} onClick={handleOpenSignerApp}>
                  Open Signer App
                </button>
                <button className={styles.ghostBtn} onClick={cancelQR}>
                  ← Cancel
                </button>
              </>
            ) : (
              <>
                <p className={styles.hint}>Scan with nsec.app or any NIP-46 signer</p>
                <QRCodeSVG value={connectUri} size={200} />
                <p className={styles.qrWaiting}>
                  {connectStatus === 'awaiting-connect' ? 'Waiting for signer…' : 'Connecting…'}
                </p>
                <button className={styles.ghostBtn} onClick={cancelQR}>
                  ← Cancel
                </button>
              </>
            )}
          </div>
        ) : showLocal ? (
          remediating ? (
            /* R2c-7a-2 — a bare nsec is an unprotected key. It does not establish until the user has SAVED an
               encrypted backup of it. The friction produces the artifact they demonstrably lacked. */
            <>
              <h2 className={styles.title}>Protect this key first</h2>
              <p className={styles.hint}>
                You pasted an unprotected key. Set a passphrase and save an encrypted backup — then we'll finish
                setting up this device. Without a protected backup, losing this device means losing your plan.
              </p>

              {/* State-SPECIFIC label (R1.5 rule): this is the ENCRYPT direction, and a device-PIN field was on
                  the previous screen. A generic "Passphrase" would be ambiguous in both directions. */}
              <label className={styles.hint} htmlFor="bare-nsec-pass">Passphrase to encrypt this backup</label>
              <PassphraseInput
                id="bare-nsec-pass"
                className={styles.input}
                placeholder="Passphrase"
                value={bareNsecPass}
                // ⚠ STALENESS: a prior download is locked with the OLD passphrase, so editing it invalidates the
                // save (the ceremony's savedOnce / invalidateArtifact invariant).
                onChange={(v) => { setBareNsecPass(v); setBareNsecSaved(false); setAidError(null); }}
                disabled={encrypting || loading}
              />
              <p className={styles.hint}>
                You'll need this exact passphrase to restore it — it is not your device PIN, and we can't recover it.
              </p>

              <button
                className={styles.primaryBtn}
                onClick={downloadBackup}
                disabled={!bareNsecPass.trim() || encrypting || loading}
              >
                {encrypting ? 'Encrypting…' : 'Download encrypted backup'}
              </button>
              {canShare && (
                <button
                  className={styles.ghostBtn}
                  onClick={shareBackup}
                  disabled={!bareNsecPass.trim() || encrypting || loading}
                >
                  Save…
                </button>
              )}
              {aidError && <p className={styles.hint} style={{ color: 'var(--red)' }}>{aidError}</p>}

              <button
                className={styles.primaryBtn}
                onClick={continueAfterBackup}
                disabled={!bareNsecSaved || loading || encrypting}
              >
                {loading ? 'Setting up…' : 'Continue'}
              </button>
              {!bareNsecSaved && (
                <p className={styles.hint}>Save the encrypted backup first — then continue.</p>
              )}
              <button className={styles.ghostBtn} onClick={cancelRemediation} disabled={loading || encrypting}>
                ← Back
              </button>
            </>
          ) : hasWrappedKey && !forceImport ? (
            <>
              {/* #6: a wrapped key already lives on this device — unlock it (Face ID) instead of re-importing the nsec */}
              <p className={styles.hint}>A saved key is on this device. Unlock it with {biometricLabel()}, or import a different key.</p>
              <button className={styles.primaryBtn} onClick={handleUnlockExisting} disabled={loading}>
                {loading ? 'Unlocking…' : `🔒 Unlock with ${biometricLabel()}`}
              </button>
              <button className={styles.ghostBtn} onClick={() => { setForceImport(true); setError(null); }} disabled={loading}>
                Use a different key
              </button>
              <button className={styles.ghostBtn} onClick={() => { setShowLocal(false); setError(null); }} disabled={loading}>
                ← Back
              </button>
            </>
          ) : (
          <>
            {/* PASSIVE notice — not a checkbox, gates nothing. ⚠ It states ONLY what is true today: the KEY is
                always keyVault-wrapped (passkey/PIN), unconditionally. It deliberately does NOT claim that plan
                DATA is encrypted at rest — store-enc is off by default and default-on is Phase 5. The prior copy
                asserted "all your encrypted data is permanently unrecoverable," which was false. */}
            <p className={styles.hint}>
              The app keeps your key protected on this device, but that's not a backup — keep the key you just
              pasted somewhere safe. If you lose this device without it, your plan can't be recovered.
            </p>
            {/* R2b-3 — Recovery phrase | Recovery key. The word grid is the default; Nostr natives switch to the
                raw field. R2c-7a: the key tab is prefix-aware and takes an nsec OR an encrypted (NIP-49) key.
                The label deliberately never says "ncryptsec" — that token is jargon. */}
            <div className={styles.recoveryTabs} role="tablist" aria-label="Recovery Key format">
              <button
                role="tab" type="button" aria-selected={recoveryTab === 'words'}
                className={`${styles.recoveryTab} ${recoveryTab === 'words' ? styles.recoveryTabActive : ''}`}
                onClick={() => { setRecoveryTab('words'); setError(null); }}
                disabled={loading}
              >Recovery phrase (12 words)</button>
              <button
                role="tab" type="button" aria-selected={recoveryTab === 'key'}
                className={`${styles.recoveryTab} ${recoveryTab === 'key' ? styles.recoveryTabActive : ''}`}
                onClick={() => { setRecoveryTab('key'); setError(null); }}
                disabled={loading}
              >Recovery key</button>
            </div>

            {recoveryTab === 'words' ? (
              <>
                <WordGrid
                  mode="input"
                  values={gridValues}
                  onChange={setGridValues}
                  onKeyPasted={(v) => { setRecoveryTab('key'); setRecoveryInput(v); setError(null); }}
                  onSubmitAttempt={() => { if (localCanContinue) handleLocal(); }}
                />
                {(() => {
                  const status = phraseStatus(gridValues);
                  return (
                    <p className={`${styles.checksumLine} ${status === 'valid' ? styles.checksumValid : status === 'bad-checksum' ? styles.checksumBad : ''}`}>
                      {status === 'incomplete' ? 'phrase incomplete'
                        : status === 'valid' ? '✓ valid recovery phrase'
                        : "checksum doesn't match — check your words"}
                    </p>
                  );
                })()}
                {/* CAPTURE variant of the seed-phrase hygiene line (the user is typing words IN — contrast
                    OwnerKeySetup K2 / the ceremony, which DISPLAY words we minted). Sits BELOW the checksum
                    line so it never interrupts the grid → live-status feedback path. Words tab only. */}
                <p className={styles.hint}>
                  Never type your Bitcoin wallet's seed phrase here — a plan uses its own words.
                </p>
              </>
            ) : (
              <>
                <input
                  className={styles.input}
                  type={reveal ? 'text' : 'password'}
                  placeholder="Paste your recovery key — nsec or encrypted"
                  value={recoveryInput}
                  onChange={(e) => setRecoveryInput(e.target.value)}
                  disabled={loading}
                  // ⚠ LOAD-BEARING: iOS silently autocapitalizes/autocorrects, which would mangle an nsec.
                  // Same discipline as ViewerLoginFlow's passphrase field. autoComplete off keeps the secret
                  // out of browser autofill.
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
                <button
                  className={styles.ghostBtn}
                  onClick={() => setReveal((v) => !v)}
                  disabled={loading}
                >
                  {reveal ? 'Hide' : 'Show'}
                </button>

                {/* R2c-7a-fix — KEY-FIELD errors, in strict precedence. Each is mutually exclusive, and each
                    suppresses the passphrase field: a payload we can't even parse must never be blamed on the
                    passphrase (the R2c-7a bug). ⚠ Never render the caught e.message here — bech32's errors echo
                    the entire ncryptsec, and "Unknown letter" echoes the offending character. */}
                {pastedIsHandoffToken ? (
                  <p className={styles.hint} style={{ color: 'var(--red)' }}>
                    That's a viewer share code, not your Recovery Key.
                  </p>
                ) : (keyInput.kind === 'encrypted' && !encryptedShapeOk) ||
                    decryptState.error === 'malformed' ? (
                  // Shape gate (paste time) OR a bech32 checksum that only surfaced inside decrypt (1-char typo).
                  <p className={styles.hint} style={{ color: 'var(--red)' }}>
                    That doesn't look like a valid key — check for a truncated paste.
                  </p>
                ) : null}

                {/* The UNLOCK passphrase, shown ONLY for a well-formed ncryptsec — so "Wrong passphrase" can
                    finally mean what it says. Debounced 3000ms; the decrypt runs in an effect (see the state
                    block) so "Checking passphrase…" paints before the scrypt freeze. ⚠ The label is
                    state-SPECIFIC on purpose: a device PIN field can be on screen at the same time, and R2c-7a-2
                    will add the inverse ENCRYPT passphrase to this very screen. A generic "Passphrase" would be
                    ambiguous in both directions (the R1.5 confusion). */}
                {showPassphraseField && (
                  <>
                    <PassphraseInput
                      className={styles.input}
                      placeholder="Passphrase to unlock this key"
                      value={keyPassphrase}
                      onChange={(v) => { setKeyPassphrase(v); setError(null); }}
                      disabled={loading}
                    />
                    <p className={styles.hint}>
                      This unlocks the encrypted key you pasted — it is not your device PIN.
                    </p>
                    {/* Three MUTUALLY EXCLUSIVE branches over the existing decryptState — checking / wrong / ✓.
                        Display-only: no new state, no effect, no change to the 3000ms debounce or the decrypt. */}
                    {decryptState.checking && <p className={styles.hint}>Checking passphrase…</p>}
                    {decryptState.error === 'passphrase' && (
                      <p className={styles.hint} style={{ color: 'var(--red)' }}>
                        Wrong passphrase — check and try again.
                      </p>
                    )}
                    {/* Without this, a CORRECT passphrase just makes "Checking…" vanish after ~4s (debounce +
                        scrypt) while Continue quietly enables — which reads as "nothing happened". Mirrors the
                        word grid's own '✓ valid recovery phrase' line (same classes, same voice). */}
                    {!decryptState.checking && decryptState.sk && !decryptState.error && (
                      <p className={`${styles.checksumLine} ${styles.checksumValid}`}>✓ Key unlocked</p>
                    )}
                  </>
                )}

                {/* A disabled Continue must never be mute. Both suppressed for a handoff token, which already
                    has its own (more specific) error above — e.g. `garbage:npub1…` classifies as 'unknown'. */}
                {!pastedIsHandoffToken && keyInput.kind === 'words' && (
                  <p className={styles.hint}>
                    That looks like a recovery phrase — switch to the phrase tab for word-by-word entry.
                  </p>
                )}
                {!pastedIsHandoffToken && keyInput.kind === 'unknown' && recoveryInput.trim() && (
                  <p className={styles.hint}>
                    Not a recognized key. Paste an nsec, an encrypted key, or use the phrase tab.
                  </p>
                )}
              </>
            )}
            {localMethod !== 'pin' && (
              <input
                className={styles.input}
                type="text"
                placeholder="Name this key (e.g. my laptop)"
                value={keyLabel}
                onChange={(e) => setKeyLabel(e.target.value)}
                disabled={loading}
              />
            )}
            {localMethod === 'pin' && (
              <>
                <p className={styles.hint}>{biometricLabel()} unavailable — set a PIN to encrypt the key (min 4 digits).</p>
                <PassphraseInput className={styles.input} inputMode="numeric" placeholder="PIN"
                  value={pin} onChange={setPin} disabled={loading} />
                <PassphraseInput className={styles.input} inputMode="numeric" placeholder="Confirm PIN"
                  value={pinConfirm} onChange={setPinConfirm} disabled={loading} />
              </>
            )}
            <button className={styles.primaryBtn} onClick={handleLocal} disabled={loading || !localCanContinue}>
              {loading ? 'Setting up…' : localMethod === 'pin' ? 'Encrypt & continue' : `Continue with ${biometricLabel()}`}
            </button>
            <button className={styles.ghostBtn} onClick={() => { setShowLocal(false); setError(null); }} disabled={loading}>
              ← Back
            </button>
          </>
          )
        ) : !showBunker ? (
          <>
            {/* R2b-2 IA: the Recovery Key is THE door. The three protocol methods below are for people who
                already know they want them — collapsed by default, order + handlers unchanged. */}
            <button className={styles.methodBtn} onClick={openLocal} disabled={loading}>
              <span className={styles.methodTitle}>Use my Recovery Key</span>
              <span className={styles.methodSub}>12 words or nsec — unlocks or imports on this device</span>
            </button>

            <button
              className={styles.disclosureBtn}
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
              aria-controls="advanced-signin"
              disabled={loading}
            >
              <span>Advanced sign-in</span>
              <span className={styles.chevron} data-open={showAdvanced || undefined} aria-hidden="true">›</span>
            </button>

            {showAdvanced && (
              <div id="advanced-signin" className={styles.disclosurePanel}>
                {hasNip07 && (
                  <button className={styles.primaryBtn} onClick={handleNip07} disabled={loading}>
                    {loading ? 'Connecting…' : '⚡ Sign in with Extension'}
                  </button>
                )}
                {hasNip07 && <div className={styles.divider} />}
                <button
                  className={styles.secondaryBtn}
                  onClick={generateSession}
                  disabled={loading}
                >
                  {isMobile ? 'Open Signer App' : 'Scan QR Code'}
                </button>
                <button
                  className={styles.secondaryBtn}
                  onClick={() => { setShowBunker(true); setError(null); }}
                  disabled={loading}
                >
                  Connect Bunker (iOS / Remote Signer)
                </button>
              </div>
            )}

            {/* #4: a locked-out local user who hit "Use a different login" can return to the Face ID unlock gate.
                backLabel defaults to "← Back" (Settings door + fork login); the unlock escape passes the original. */}
            {onBack && (
              <button className={styles.ghostBtn} onClick={onBack} disabled={loading}>
                {backLabel ?? '← Back'}
              </button>
            )}
          </>
        ) : (
          <>
            <p className={styles.hint}>
              Paste your <code>bunker://</code> URI from nsec.app or your signer
            </p>
            <input
              className={styles.input}
              type="text"
              placeholder="bunker://pubkey?relay=wss://..."
              value={bunkerUri}
              onChange={(e) => setBunkerUri(e.target.value)}
              disabled={loading}
            />
            <button
              className={styles.primaryBtn}
              onClick={handleNip46}
              disabled={loading || !bunkerUri}
            >
              {loading ? 'Connecting… (this can take up to 30s)' : 'Connect'}
            </button>
            <button className={styles.ghostBtn} onClick={() => { setShowBunker(false); setError(null); }}>
              ← Back
            </button>
          </>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
