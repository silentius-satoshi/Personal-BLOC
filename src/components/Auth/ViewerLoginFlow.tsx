import { useState, useEffect, useMemo } from 'react';
import { getPublicKey, nip19 } from 'nostr-tools';
import * as nip49 from 'nostr-tools/nip49';
import { probeKeyVaultCapability, wrapSecretKey, type WrapMethod } from '../../lib/nostr/keyVault';
import { setUnwrappedViewerKey } from '../../lib/nostr/viewerSync';
import { parseHandoffToken } from '../../lib/nostr/handoffToken';
import { biometricLabel } from '../../lib/biometricLabel';
import { useStore } from '../../store/useStore';
import { PassphraseInput } from '../ui/PassphraseInput';
import styles from './ViewerLoginFlow.module.css';

/**
 * Access Layer Redesign — Phase 1. Reusable viewer-login flow, EXTRACTED VERBATIM from
 * OnboardingModal (the crypto/key sequence is byte-identical — only the completion callback became a
 * prop). Self-contained full-screen overlay (own .overlay/.modal chrome, mirroring NostrAuthGate) so
 * it can launch from BOTH first-run onboarding AND Settings.
 *
 * Props: onDone (caller decides completion — onboarding: onComplete(true); Settings: setSimpleMode(true)
 * + close), onBack (caller's back handler).
 */
export interface ViewerLoginFlowProps {
  onDone: () => void;
  onBack: () => void;
}

export function ViewerLoginFlow({ onDone, onBack }: ViewerLoginFlowProps) {
  const setViewerMode         = useStore((s) => s.setViewerMode);
  const setViewerWriterPubkey = useStore((s) => s.setViewerWriterPubkey);
  const setViewerKeyWrapped   = useStore((s) => s.setViewerKeyWrapped);
  const setViewerKeyWrapMeta  = useStore((s) => s.setViewerKeyWrapMeta);
  const setViewerDisplayName  = useStore((s) => s.setViewerDisplayName);
  const clearViewerData       = useStore((s) => s.clearViewerData);

  // Viewer V3 — the name step runs AFTER the handshake succeeds ('connect' → 'name' → onDone). Name
  // AFTER: don't collect a name for a connection that might fail. Runs for BOTH entry points (the
  // onboarding fork + the Settings access door) since it's internal to this flow.
  const [step, setStep]               = useState<'connect' | 'name'>('connect');
  const [displayName, setDisplayName] = useState('');

  // PASTE-ONLY (Handoff v4) — the owner MINTS the viewer key (deriveViewerKeyFromNsec) and hands over a
  // token; the viewer only pastes it here. The old viewer-generates-its-own-key model is retired (SharingPage
  // has no field to receive a viewer-supplied npub, so a self-generated key could never be authorized).
  const [pastedToken, setPastedToken] = useState('');
  // Passphrase for an ncryptsec token. DEBOUNCED (3000ms) before it feeds the decrypt effect below — nip49.decrypt
  // is SYNCHRONOUS scrypt (default logn 16), so decrypting per keystroke would freeze the mobile main thread.
  const [tokenPassphrase, setTokenPassphrase] = useState('');
  const [debouncedPassphrase, setDebouncedPassphrase] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedPassphrase(tokenPassphrase), 3000);
    return () => clearTimeout(t);
  }, [tokenPassphrase]);
  // Parse the token (structure only — cheap; no crypto). Feeds the passphrase-field gate + the owner-npub lock.
  const parsed = useMemo(() => parseHandoffToken(pastedToken), [pastedToken]);
  // ncryptsec decrypt runs in an EFFECT, not a memo — nip49.decrypt is SYNCHRONOUS scrypt, and running it inside
  // a memo blocks the same render/paint that commits the debounced passphrase, so "Checking passphrase…" would
  // never actually paint before the freeze. The 30ms setTimeout yields one frame so it does.
  const [decryptState, setDecryptState] = useState<{ key: { sk: Uint8Array; npub: string } | null; checking: boolean }>(
    { key: null, checking: false },
  );
  useEffect(() => {
    const trimmed = debouncedPassphrase.trim();   // symmetric with the owner's handoffPassphrase.trim() at encrypt time
    if (parsed?.kind !== 'ncryptsec' || !trimmed) {
      setDecryptState({ key: null, checking: false });
      return;
    }
    setDecryptState({ key: null, checking: true });   // never carry a stale key while re-checking a new passphrase
    const t = setTimeout(() => {
      try {
        const sk = nip49.decrypt(parsed.keyPart, trimmed);   // sync scrypt — runs AFTER the checking state paints
        setDecryptState({ key: { sk, npub: nip19.npubEncode(getPublicKey(sk)) }, checking: false });
      } catch {
        setDecryptState({ key: null, checking: false });
      }
    }, 30);
    return () => clearTimeout(t);   // a stale in-flight decrypt must not land after a newer keystroke
  }, [parsed, debouncedPassphrase]);
  // Decode the key part → { sk, npub } (null while empty/invalid/wrong-passphrase → gates Done + shows confirmation).
  const pastedKey = useMemo(() => {
    if (!parsed) return null;
    if (parsed.kind === 'ncryptsec') return decryptState.key;
    try {
      const d = nip19.decode(parsed.keyPart);
      if (d.type !== 'nsec') return null;
      const sk = d.data as Uint8Array;
      return { sk, npub: nip19.npubEncode(getPublicKey(sk)) };
    } catch { return null; }
  }, [parsed, decryptState]);
  const activeKey = pastedKey;
  // Owner npub is ALWAYS carried by the token → prefill + lock the field (shown for confirmation); null until
  // a valid 2-part token is pasted.
  const tokenOwnerNpub = parsed?.ownerNpub ?? null;
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [viewerBusy, setViewerBusy]   = useState(false);
  const [viewerMethod, setViewerMethod] = useState<WrapMethod | null>(null);   // probed wrap capability
  const [viewerPin, setViewerPin]         = useState('');
  const [viewerPinConfirm, setViewerPinConfirm] = useState('');
  const [viewerLabel, setViewerLabel]     = useState('');   // names the viewer passkey (PRF path only)

  // Probe Face-ID/PIN capability on mount (so the step can show a PIN field if needed).
  useEffect(() => {
    let cancelled = false;
    probeKeyVaultCapability().then((m) => { if (!cancelled) setViewerMethod(m); });
    return () => { cancelled = true; };
  }, []);

  const handleViewerDone = async () => {
    if (!activeKey) { setViewerError('Enter the key the owner gave you'); return; }
    const input = (tokenOwnerNpub ?? '').trim();
    let decoded;
    try { decoded = nip19.decode(input); }
    catch { setViewerError('Not a valid npub'); return; }
    if (decoded.type !== 'npub') { setViewerError('Not a valid npub'); return; }
    setViewerBusy(true);
    setViewerError(null);
    try {
      const method = viewerMethod ?? await probeKeyVaultCapability();
      const { ciphertext, meta } = await wrapSecretKey(
        activeKey.sk, method, method === 'pin' ? viewerPin : undefined, method !== 'pin' ? viewerLabel : undefined,
      );
      setViewerKeyWrapped(ciphertext);
      setViewerKeyWrapMeta(meta);
      setUnwrappedViewerKey(activeKey.sk);   // unlock this session immediately (no re-prompt) — NO plaintext stored
      clearViewerData();   // start clean — wipe any residual owner/prior-viewer data BEFORE viewerMode triggers the first fetch
      setViewerWriterPubkey(decoded.data as string);
      setViewerMode(true);
      setStep('name');   // V3 — the handshake succeeded; collect the greeting name, THEN onDone()
    } catch (e: any) {
      setViewerError(e?.message ?? 'Could not protect the viewing key');
    } finally {
      setViewerBusy(false);
    }
  };

  const viewerCanDone =
    !!tokenOwnerNpub && !viewerBusy && !!activeKey &&
    (viewerMethod !== 'pin' || (viewerPin.length >= 4 && viewerPin === viewerPinConfirm));

  // V3 name step — empty = skip (null → the nameless greeting). Always callable; Continue never disables.
  const finishWithName = (name: string) => {
    setViewerDisplayName(name.trim() || null);
    onDone();   // caller decides completion (onboarding: onComplete(true); Settings: setSimpleMode(true) + close)
  };

  if (step === 'name') {
    return (
      <div className={styles.overlay}>
        <div className={styles.modal}>
          <div className={styles.step}>
            <div className={styles.welcomeIcon}>₿</div>
            <h2 className={styles.title}>What should we call you?</h2>
            <p className={styles.subtitle}>
              Just for your greeting — this stays on your device and is never shared.
            </p>
            <div className={styles.fields}>
              <div className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>Your name (optional)</span>
                <div className={styles.fieldInput}>
                  <input
                    className={styles.dateInput}
                    type="text"
                    placeholder="e.g. Dad"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') finishWithName(displayName); }}
                    autoFocus
                  />
                </div>
              </div>
            </div>
            {/* No Back — the handshake already succeeded; the only way is forward. */}
            <div className={styles.nav}>
              <button className={styles.back} onClick={() => finishWithName('')}>Skip</button>
              <button className={styles.primary} onClick={() => finishWithName(displayName)}>
                Continue →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.step}>
          <div className={styles.welcomeIcon}>👁</div>
          <h2 className={styles.title}>View a plan (read-only)</h2>
          <p className={styles.subtitle}>
            Paste the viewing token the plan's owner gave you. You'll see a live, read-only copy of their
            plan and balances — you can never change their inputs.
          </p>
          <div className={styles.fields}>
            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>The handoff token from the owner</span>
              <div className={styles.fieldInput}>
                <input
                  className={styles.dateInput}
                  type="text"
                  placeholder="nsec1…:npub1…  or  ncryptsec1…:npub1…"
                  value={pastedToken}
                  onChange={(e) => { setPastedToken(e.target.value); setViewerError(null); }}
                />
              </div>
              {pastedToken.trim() && !parsed && (
                <span className={styles.skip} style={{ fontStyle: 'normal', cursor: 'default', color: 'var(--red)' }}>
                  Not a valid token
                </span>
              )}
              {pastedKey && (
                <span className={styles.skip} style={{ fontStyle: 'normal', cursor: 'default', color: 'var(--green)' }}>
                  ✓ {pastedKey.npub.slice(0, 14)}…{pastedKey.npub.slice(-6)}
                </span>
              )}
            </div>
            {parsed?.kind === 'ncryptsec' && (
              <div className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>Passphrase (from the owner)</span>
                <div className={styles.fieldInput}>
                  <PassphraseInput
                    className={styles.dateInput}
                    placeholder="Passphrase"
                    value={tokenPassphrase}
                    onChange={(v) => { setTokenPassphrase(v); setViewerError(null); }}
                  />
                </div>
                {decryptState.checking && (
                  <span className={styles.skip} style={{ fontStyle: 'normal', cursor: 'default' }}>
                    Checking passphrase…
                  </span>
                )}
                {!decryptState.checking && debouncedPassphrase.trim() && !pastedKey && (
                  <span className={styles.skip} style={{ fontStyle: 'normal', cursor: 'default', color: 'var(--red)' }}>
                    Wrong passphrase
                  </span>
                )}
              </div>
            )}
            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>The owner's npub (from the token)</span>
              <div className={styles.fieldInput}>
                {/* Always read-only, sourced purely from the token (empty until a valid 2-part token is pasted). */}
                <input
                  className={styles.dateInput}
                  type="text"
                  placeholder="npub1…"
                  value={tokenOwnerNpub ?? ''}
                  readOnly
                />
              </div>
            </div>
            {/* Progressive disclosure: the wrap step (device protection) appears only once the token +
                passphrase have resolved a real key. viewerCanDone already requires activeKey, so gating the
                fields here can never make an un-enterable state submittable. */}
            {activeKey && viewerMethod !== 'pin' && (
              <div className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>Name this viewer (optional)</span>
                <div className={styles.fieldInput}>
                  <input
                    className={styles.dateInput}
                    type="text"
                    placeholder="e.g. Dad's iPhone"
                    value={viewerLabel}
                    onChange={(e) => setViewerLabel(e.target.value)}
                  />
                </div>
              </div>
            )}
            {activeKey && viewerMethod === 'pin' && (
              <>
                <div className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>Create a PIN for this device (min 4 digits)</span>
                  <span className={styles.skip} style={{ fontStyle: 'normal', cursor: 'default', textAlign: 'left' }}>
                    This protects your viewing key on this device. You choose it — it is not the owner's passphrase, and the owner never needs it.
                  </span>
                  <div className={styles.fieldInput}>
                    <PassphraseInput className={styles.dateInput} inputMode="numeric" placeholder="PIN"
                      value={viewerPin} onChange={(v) => { setViewerPin(v); setViewerError(null); }} />
                  </div>
                </div>
                <div className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>Confirm PIN</span>
                  <div className={styles.fieldInput}>
                    <PassphraseInput className={styles.dateInput} inputMode="numeric" placeholder="Confirm PIN"
                      value={viewerPinConfirm} onChange={(v) => { setViewerPinConfirm(v); setViewerError(null); }} />
                  </div>
                </div>
              </>
            )}
          </div>
          <p className={styles.subtitle} style={{ fontSize: 12 }}>
            🔒 Your viewing key is protected on this device by {viewerMethod === 'pin' ? 'a PIN you set' : biometricLabel()} and never stored unencrypted.
            You can reset it anytime without losing data.
          </p>
          {viewerError && <p className={styles.subtitle} style={{ color: 'var(--red)' }}>{viewerError}</p>}
          <div className={styles.nav}>
            <button className={styles.back} onClick={onBack}>← Back</button>
            <button className={styles.primary} disabled={!viewerCanDone} onClick={handleViewerDone}>
              {viewerBusy ? 'Protecting…' : 'Start viewing →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
