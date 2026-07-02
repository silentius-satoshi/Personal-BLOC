import { useState, useEffect } from 'react';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { probeKeyVaultCapability, wrapSecretKey, type WrapMethod } from '../../lib/nostr/keyVault';
import { setUnwrappedViewerKey } from '../../lib/nostr/viewerSync';
import { useStore } from '../../store/useStore';
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

  // Generate this viewer's own key ONCE on mount (lazy initializer → stable across re-renders).
  // Keep the raw sk bytes (NOT plaintext in the store) so we can keyVault-wrap them on Done.
  const [viewerKey] = useState(() => {
    const sk = generateSecretKey();
    return { sk, npub: nip19.npubEncode(getPublicKey(sk)) };
  });
  const [ownerNpub, setOwnerNpub]     = useState('');
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [copied, setCopied]           = useState(false);
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
    const input = ownerNpub.trim();
    let decoded;
    try { decoded = nip19.decode(input); }
    catch { setViewerError('Not a valid npub'); return; }
    if (decoded.type !== 'npub') { setViewerError('Not a valid npub'); return; }
    setViewerBusy(true);
    setViewerError(null);
    try {
      const method = viewerMethod ?? await probeKeyVaultCapability();
      const { ciphertext, meta } = await wrapSecretKey(
        viewerKey.sk, method, method === 'pin' ? viewerPin : undefined, method !== 'pin' ? viewerLabel : undefined,
      );
      setViewerKeyWrapped(ciphertext);
      setViewerKeyWrapMeta(meta);
      setUnwrappedViewerKey(viewerKey.sk);   // unlock this session immediately (no re-prompt) — NO plaintext stored
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
    !!ownerNpub.trim() && !viewerBusy &&
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
            Send your viewer key to the plan's owner. Once they add it, you'll see a live, read-only copy of
            their plan and balances — you can never change their inputs.
          </p>
          <div className={styles.fields}>
            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>Your viewer key (send to the owner)</span>
              <div className={styles.fieldInput}>
                <input className={styles.dateInput} type="text" readOnly value={viewerKey.npub} onFocus={(e) => e.target.select()} />
              </div>
              <button
                className={styles.skip}
                onClick={() => { navigator.clipboard?.writeText(viewerKey.npub); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              >
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>The owner's npub</span>
              <div className={styles.fieldInput}>
                <input
                  className={styles.dateInput}
                  type="text"
                  placeholder="npub1…"
                  value={ownerNpub}
                  onChange={(e) => { setOwnerNpub(e.target.value); setViewerError(null); }}
                />
              </div>
            </div>
            {viewerMethod !== 'pin' && (
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
            {viewerMethod === 'pin' && (
              <>
                <div className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>Set a PIN to protect the key (min 4 digits)</span>
                  <div className={styles.fieldInput}>
                    <input className={styles.dateInput} type="password" inputMode="numeric" placeholder="PIN"
                      value={viewerPin} onChange={(e) => { setViewerPin(e.target.value); setViewerError(null); }} />
                  </div>
                </div>
                <div className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>Confirm PIN</span>
                  <div className={styles.fieldInput}>
                    <input className={styles.dateInput} type="password" inputMode="numeric" placeholder="Confirm PIN"
                      value={viewerPinConfirm} onChange={(e) => { setViewerPinConfirm(e.target.value); setViewerError(null); }} />
                  </div>
                </div>
              </>
            )}
          </div>
          <p className={styles.subtitle} style={{ fontSize: 12 }}>
            🔒 Your viewing key is protected by {viewerMethod === 'pin' ? 'a PIN' : 'Face ID'} and never stored unencrypted.
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
