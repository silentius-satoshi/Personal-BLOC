import { useState } from 'react';
import { useNostr } from '@nostrify/react';
import { restoreSigner } from '../../lib/nostr/session';
import { syncNow } from '../../lib/nostr/syncNow';
import { resetAndResync } from '../../lib/store/escapeHatch';
import { biometricLabel } from '../../lib/biometricLabel';
import { useStore } from '../../store/useStore';
import styles from './NostrAuthGate.module.css';

/**
 * "Authenticated-but-locked" launch screen for the 'local' signing method. A returning local user is past
 * login — they need to UNLOCK (Face ID / PIN), not re-auth. WebAuthn needs a user gesture, so unlock is
 * tap-driven here (not auto-fired in useNostrAutoRestore). On success → signer set → isAuthenticated true.
 */
export function LocalUnlockGate({ onReauth }: { onReauth: () => void }) {
  const { nostr } = useNostr();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const unlock = async () => {
    setLoading(true);
    setError(null);
    try {
      const signer = await restoreSigner(nostr);   // → unwrapSecretKey → Face ID / PIN
      if (!signer) throw new Error('Unlock failed');
      await useStore.persist.rehydrate();   // Bug 1: ensure async hydration lands BEFORE the gate dismisses (fixes
                                            // the plaintext seed-flash; harmless on the encrypted path — restoreSigner already rehydrated)
      useStore.getState().setIsAuthenticated(true);
      syncNow(nostr);   // fire-and-forget pull/merge once unlocked
    } catch (e: any) {
      setError(e?.message ?? 'Unlock failed — try again');
    } finally {
      setLoading(false);
    }
  };

  // Last-resort recovery so a stuck unlock can never strand the user: clear local encryption state (flag + {ct,iv}
  // blob + in-memory key) and reload. The identity is retained, so the normal boot unlock → syncNow repopulates from
  // the relay into a clean plaintext slate (resetAndResync is reload-based now — see escapeHatch).
  const resetAndResyncFromGate = () => {
    if (!window.confirm('This clears local data on this device and reloads it from the relays. Your Nostr key and relay data are safe. Any local changes not yet synced will be lost. Continue?')) return;
    setLoading(true);
    resetAndResync(nostr);   // clears encryption state + reloads
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.logo}>₿</div>
        <h1 className={styles.title}>Personal ₿LOC</h1>
        <p className={styles.subtitle}>Unlock with {biometricLabel()} to continue</p>

        <button className={styles.primaryBtn} onClick={unlock} disabled={loading}>
          {loading ? 'Unlocking…' : `🔒 Unlock with ${biometricLabel()}`}
        </button>
        <button className={styles.ghostBtn} onClick={onReauth} disabled={loading}>
          Use a different login
        </button>
        <button className={styles.ghostBtn} onClick={resetAndResyncFromGate} disabled={loading}>
          Can't unlock — reset &amp; re-sync
        </button>

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
