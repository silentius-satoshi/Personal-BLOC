import { useState } from 'react';
import { useNostr } from '@nostrify/react';
import { restoreSigner } from '../../lib/nostr/session';
import { syncNow } from '../../lib/nostr/syncNow';
import { resetAndResync } from '../../lib/store/escapeHatch';
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
      console.log('[flashB] before rehydrate', Date.now(), useStore.getState().advisorActualBtcHeld, useStore.getState().onboardingComplete);   // TEMP [flashB] — remove after diagnosis
      await useStore.persist.rehydrate();   // Bug 1: ensure async hydration lands BEFORE the gate dismisses (fixes
                                            // the plaintext seed-flash; harmless on the encrypted path — restoreSigner already rehydrated)
      console.log('[flashB] after rehydrate', Date.now(), useStore.getState().advisorActualBtcHeld, useStore.getState().onboardingComplete);   // TEMP [flashB] — remove after diagnosis
      useStore.getState().setIsAuthenticated(true);
      console.log('[flashB] after setIsAuthenticated', Date.now(), useStore.getState().advisorActualBtcHeld, useStore.getState().onboardingComplete);   // TEMP [flashB] — remove after diagnosis
      syncNow(nostr);   // fire-and-forget pull/merge once unlocked
    } catch (e: any) {
      setError(e?.message ?? 'Unlock failed — try again');
    } finally {
      setLoading(false);
    }
  };

  // Last-resort recovery so a stuck unlock can never strand the user: clear local + pull the plan back from the
  // relays. Operates on raw localStorage + restoreSigner (not a hydrated store), so it works from this gate.
  const resetAndResyncFromGate = async () => {
    if (!window.confirm('This clears local data on this device and reloads it from the relays. Your Nostr key and relay data are safe. Any local changes not yet synced will be lost. Continue?')) return;
    setLoading(true);
    setError(null);
    try {
      const result = await resetAndResync(nostr);
      // No reload: the 'ok' path means the signer is live (restoreSigner set it) AND the pull populated the store.
      // Flip auth true so this gate dismisses straight into the app with the pulled data (mirrors unlock() above).
      if (result === 'ok') { await useStore.persist.rehydrate(); useStore.getState().setIsAuthenticated(true); return; }   // Bug 1: hydration lands before dismiss (belt-and-suspenders — data already in memory from the pull)
      setError(result === 'no-relays'
        ? "Couldn't reach the relays. Your data is safe — nothing was published. Check your connection and try again."
        : "Couldn't unlock your key — use a different login.");
    } catch {
      setError('Reset failed — please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.logo}>₿</div>
        <h1 className={styles.title}>Personal ₿LOC</h1>
        <p className={styles.subtitle}>Unlock with Face ID to continue</p>

        <button className={styles.primaryBtn} onClick={unlock} disabled={loading}>
          {loading ? 'Unlocking…' : '🔒 Unlock with Face ID'}
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
