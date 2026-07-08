import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { nip19 } from 'nostr-tools';
import { connectNip07 } from '../../lib/nostr/signers';
import { establishLocalOwner } from '../../lib/nostr/establishOwner';
import { restoreSigner } from '../../lib/nostr/session';
import { syncNow, markSignerFresh } from '../../lib/nostr/syncNow';
import { getDeviceLabel } from '../../lib/nostr/deviceTag';
import { probeKeyVaultCapability, type WrapMethod } from '../../lib/nostr/keyVault';
import { skFromWords, InvalidSeedWordsError } from '../../lib/nostr/nip06Key';
import { classifyRecoveryInput } from '../../lib/nostr/recoveryInput';
import { phraseStatus } from '../../lib/recoveryGrid';
import { WordGrid } from '../Onboarding/WordGrid';
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
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [recoveryTab, setRecoveryTab]     = useState<'words' | 'nsec'>('words');   // R2b-3: default to the word grid
  const [gridValues, setGridValues]       = useState<string[]>(() => Array(12).fill(''));   // R2b-3 words tab — ⚠ transient secret
  const [recoveryInput, setRecoveryInput] = useState('');   // the nsec tab's field (R2b-2 was dual-format; now nsec-only)
  const [reveal, setReveal]               = useState(false);   // proofread a typed nsec (masked by default)
  const [localMethod, setLocalMethod]     = useState<WrapMethod | null>(null);
  const [pin, setPin]                     = useState('');
  const [pinConfirm, setPinConfirm]       = useState('');
  const [keyLabel, setKeyLabel]           = useState('');   // names the passkey (PRF path only)

  useEffect(() => {
    if (!showLocal) return;
    let cancelled = false;
    probeKeyVaultCapability().then((m) => { if (!cancelled) setLocalMethod(m); });
    return () => { cancelled = true; };
  }, [showLocal]);

  const openLocal = () => {
    setShowLocal(true);
    setForceImport(false);
    setBackupConfirmed(false);
    setRecoveryTab('words');
    setGridValues(Array(12).fill(''));   // ⚠ transient secret — reset here (the ONLY scrub site; see residual note below)
    setRecoveryInput('');
    setReveal(false);
    setLocalMethod(null);
    setPin('');
    setPinConfirm('');
    setKeyLabel('');
    setError(null);
  };

  const handleLocal = async () => {
    setLoading(true);
    setError(null);
    let sk: Uint8Array | null = null;
    try {
      // R2b-2 dual-format: classify by SHAPE, then let the format's own crypto own the verdict.
      // R2b-3: the raw string comes from the active tab — the word grid (joined) or the nsec field. handleLocal
      // stays a SINGLE path; the tab only chooses what feeds classifyRecoveryInput.
      const raw = recoveryTab === 'words' ? gridValues.map((v) => v.trim()).join(' ') : recoveryInput;
      const input = classifyRecoveryInput(raw);
      if (input.kind === 'nsec') {
        let decoded;
        try { decoded = nip19.decode(input.value); }
        catch { setError('Not a valid nsec'); setLoading(false); return; }
        if (decoded.type !== 'nsec') { setError('That key is not an nsec'); setLoading(false); return; }
        sk = decoded.data as Uint8Array;
      } else if (input.kind === 'words') {
        try { sk = skFromWords(input.value); }
        catch (e) {
          // InvalidSeedWordsError's message is user-facing prose by contract (nip06Key.ts) — render it verbatim.
          setError(e instanceof InvalidSeedWordsError ? e.message : 'Not a valid Recovery Key');
          setLoading(false);
          return;
        }
      } else {
        setError('Enter your 12-word Recovery Key, or an nsec.');
        setLoading(false);
        return;
      }

      const method = localMethod ?? await probeKeyVaultCapability();
      // Backup gate (R2a-1): the user holds this key elsewhere already (the hard backup gate above
      // enforces that) → never gated. Stamped BEFORE establishLocalOwner's internal syncNow.
      useStore.getState().setKeyProvenance('imported');
      // ⚠ R2b-2 INVARIANT — an IMPORTED phrase wraps the DERIVED SK (payloadKind 'sk'), never the entropy.
      // NostrAuthGate passes no payloadKind, so establishLocalOwner defaults it to 'sk'; do not "fix" this into
      // entropy storage. R2c's word-quiz re-display exists for keys BORN IN-APP ('nip06-entropy'); an
      // imported-words plan's Recovery Key is the phrase the user already holds, so unwrapRecoveryPayload
      // correctly reports 'sk' and RevealRecoveryKey falls back to nsec display.
      await establishLocalOwner(sk, method, nostr, { pin, keyLabel });   // shared with OwnerKeySetup K3
      onSuccess();
    } catch (err: any) {
      useStore.getState().setKeyProvenance(null);   // R2a-1 rollback: stamped pre-establish; a throw must not freeze it (write-once)
      setError(err?.message ?? 'Could not set up the local key');
    } finally {
      sk?.fill(0);   // best-effort zero (the NSecSigner holds its own copy for the session)
      setLoading(false);
    }
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

  // R2b-3: gate on the CHECKSUM in the words tab (skFromWords on submit is still the authority); the nsec tab
  // keeps the original non-empty check.
  const localCanContinue =
    backupConfirmed &&
    (recoveryTab === 'words' ? phraseStatus(gridValues) === 'valid' : !!recoveryInput.trim()) &&
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
          hasWrappedKey && !forceImport ? (
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
            <label className={styles.hint} style={{ display: 'flex', gap: 8, textAlign: 'left', alignItems: 'flex-start' }}>
              <input type="checkbox" checked={backupConfirmed} onChange={(e) => setBackupConfirmed(e.target.checked)} style={{ marginTop: 3, flexShrink: 0 }} />
              <span>
                <strong>⚠ Back up your Recovery Key first — this is not a backup.</strong> This stores an <em>encrypted copy</em>
                on this device, unlocked by {biometricLabel()}, for convenience. If this device is lost, reset, or {biometricLabel()}
                enrollment changes, this copy can be gone — and without your Recovery Key saved elsewhere, all your
                encrypted data is permanently unrecoverable. I have my Recovery Key (12 words or nsec) backed up
                somewhere safe outside this device.
              </span>
            </label>
            {/* R2b-3 — Recovery phrase | nsec. The word grid is the default; Nostr natives switch to the raw field. */}
            <div className={styles.recoveryTabs} role="tablist" aria-label="Recovery Key format">
              <button
                role="tab" type="button" aria-selected={recoveryTab === 'words'}
                className={`${styles.recoveryTab} ${recoveryTab === 'words' ? styles.recoveryTabActive : ''}`}
                onClick={() => { setRecoveryTab('words'); setError(null); }}
                disabled={loading || !backupConfirmed}
              >Recovery phrase (12 words)</button>
              <button
                role="tab" type="button" aria-selected={recoveryTab === 'nsec'}
                className={`${styles.recoveryTab} ${recoveryTab === 'nsec' ? styles.recoveryTabActive : ''}`}
                onClick={() => { setRecoveryTab('nsec'); setError(null); }}
                disabled={loading || !backupConfirmed}
              >nsec</button>
            </div>

            {recoveryTab === 'words' ? (
              <>
                <WordGrid
                  mode="input"
                  values={gridValues}
                  onChange={setGridValues}
                  onNsecPasted={(v) => { setRecoveryTab('nsec'); setRecoveryInput(v); setError(null); }}
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
              </>
            ) : (
              <>
                <input
                  className={styles.input}
                  type={reveal ? 'text' : 'password'}
                  placeholder="nsec1…"
                  value={recoveryInput}
                  onChange={(e) => setRecoveryInput(e.target.value)}
                  disabled={loading || !backupConfirmed}
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
                  disabled={loading || !backupConfirmed}
                >
                  {reveal ? 'Hide' : 'Show'}
                </button>
              </>
            )}
            {localMethod !== 'pin' && (
              <input
                className={styles.input}
                type="text"
                placeholder="Name this key (e.g. my laptop)"
                value={keyLabel}
                onChange={(e) => setKeyLabel(e.target.value)}
                disabled={loading || !backupConfirmed}
              />
            )}
            {localMethod === 'pin' && (
              <>
                <p className={styles.hint}>{biometricLabel()} unavailable — set a PIN to encrypt the key (min 4 digits).</p>
                <input className={styles.input} type="password" inputMode="numeric" placeholder="PIN"
                  value={pin} onChange={(e) => setPin(e.target.value)} disabled={loading || !backupConfirmed} />
                <input className={styles.input} type="password" inputMode="numeric" placeholder="Confirm PIN"
                  value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value)} disabled={loading || !backupConfirmed} />
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
