import { useState, useEffect } from 'react';
import { hexToBytes } from 'nostr-tools/utils';
import {
  probeKeyVaultCapability,
  wrapSecretKey,
  unwrapSecretKey,
  type WrapMethod,
} from '../../lib/nostr/keyVault';
import { setUnwrappedViewerKey, fetchViewerSnapshot } from '../../lib/nostr/viewerSync';
import { biometricLabel } from '../../lib/biometricLabel';
import { useStore } from '../../store/useStore';
import styles from './NostrAuthGate.module.css';

/**
 * Phase 3 viewer-key gate. Two modes, chosen from store state:
 *  • UNLOCK — a wrapped viewer key exists (`viewerKeyWrapped`). Tap → unwrapSecretKey (Face ID / PIN) →
 *    populate viewerSync's in-memory holder → the app renders.
 *  • SETUP  — a v17 migrant still has a PLAINTEXT `viewerSecretKey`. One-time wrap (keyVault) → store the
 *    wrapped pair, populate the holder, clear the plaintext → falls through to the app.
 * Mirrors LocalUnlockGate (writer) and reuses NostrAuthGate.module.css.
 */
export function ViewerUnlockGate({ onReset }: { onReset: () => void }) {
  const viewerKeyWrapped  = useStore((s) => s.viewerKeyWrapped);
  const viewerKeyWrapMeta = useStore((s) => s.viewerKeyWrapMeta);
  const viewerSecretKey   = useStore((s) => s.viewerSecretKey);

  const isSetup = !viewerKeyWrapped && !!viewerSecretKey;   // migrant one-time wrap

  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [pin, setPin]           = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [method, setMethod]     = useState<WrapMethod | null>(null);   // SETUP: probed capability

  // SETUP probes the device capability (PRF vs PIN); UNLOCK reads the scheme off the stored meta.
  useEffect(() => {
    if (!isSetup) return;
    let cancelled = false;
    probeKeyVaultCapability().then((m) => { if (!cancelled) setMethod(m); });
    return () => { cancelled = true; };
  }, [isSetup]);

  const unlockScheme = viewerKeyWrapMeta?.scheme;
  const pinMode = isSetup ? method === 'pin' : unlockScheme === 'pin';

  const canContinue = isSetup
    ? (method !== 'pin' || (pin.length >= 4 && pin === pinConfirm))
    : (unlockScheme !== 'pin' || pin.length >= 4);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      if (isSetup) {
        const m = method ?? await probeKeyVaultCapability();
        const skBytes = hexToBytes(viewerSecretKey!);
        const { ciphertext, meta } = await wrapSecretKey(skBytes, m, m === 'pin' ? pin : undefined);
        useStore.getState().setViewerKeyWrapped(ciphertext);
        useStore.getState().setViewerKeyWrapMeta(meta);
        setUnwrappedViewerKey(skBytes);            // holder populated → AppShell falls through
        useStore.getState().setViewerSecretKey(null);   // drop the plaintext copy
      } else {
        const sk = await unwrapSecretKey(viewerKeyWrapped!, viewerKeyWrapMeta!, unlockScheme === 'pin' ? pin : undefined);
        setUnwrappedViewerKey(sk);
        void fetchViewerSnapshot();                // pull the latest owner snapshot immediately
      }
    } catch (e: any) {
      setError(e?.message ?? (isSetup ? 'Could not protect the key' : 'Unlock failed — try again'));
    } finally {
      setLoading(false);
    }
  };

  const title    = 'Personal ₿LOC';
  // Method-aware (mirrors the hint below): a PIN-only device must not read "…with passkey" above "Lock it behind a PIN".
  const subtitle = isSetup ? `Protect your viewing key with ${method === 'pin' ? 'a PIN' : biometricLabel()}` : 'Unlock to view';
  const btnLabel = loading
    ? (isSetup ? 'Protecting…' : 'Unlocking…')
    : pinMode
      ? (isSetup ? 'Encrypt & continue' : 'Unlock')
      : (isSetup ? `Protect with ${biometricLabel()}` : `🔒 Unlock with ${biometricLabel()}`);

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.logo}>👁</div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>

        {isSetup && (
          <p className={styles.hint}>
            Your viewing key is currently stored unprotected. Lock it behind {method === 'pin' ? 'a PIN' : biometricLabel()} —
            this changes nothing you can see; the owner's plan stays read-only.
          </p>
        )}

        {pinMode && (
          <>
            {isSetup && method === 'pin' && (
              <p className={styles.hint}>{biometricLabel()} unavailable — set a PIN to encrypt the key (min 4 digits).</p>
            )}
            <input
              className={styles.input}
              type="password"
              inputMode="numeric"
              placeholder="PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              disabled={loading}
            />
            {isSetup && (
              <input
                className={styles.input}
                type="password"
                inputMode="numeric"
                placeholder="Confirm PIN"
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value)}
                disabled={loading}
              />
            )}
          </>
        )}

        <button className={styles.primaryBtn} onClick={run} disabled={loading || !canContinue}>
          {btnLabel}
        </button>
        <button className={styles.ghostBtn} onClick={onReset} disabled={loading}>
          Reset viewing key
        </button>

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
