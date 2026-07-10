import { useState } from 'react';
import { useNostr } from '@nostrify/react';
import { restoreSigner } from '../../lib/nostr/session';
import { syncNow } from '../../lib/nostr/syncNow';
import { resetAndResync, resetAndResyncConfirmMessage } from '../../lib/store/escapeHatch';
import { biometricLabel } from '../../lib/biometricLabel';
import { isBackupGateSatisfied } from '../../lib/backupGate';
import { useStore } from '../../store/useStore';
import { PassphraseInput } from '../ui/PassphraseInput';
import styles from './NostrAuthGate.module.css';

/**
 * "Authenticated-but-locked" launch screen for the 'local' signing method. A returning local user is past
 * login — they need to UNLOCK (Face ID / PIN), not re-auth. WebAuthn needs a user gesture, so unlock is
 * tap-driven here (not auto-fired in useNostrAutoRestore). On success → signer set → isAuthenticated true.
 *
 * ⚠ A scheme:'pin' key needs a PIN FIELD here. Without one, `restoreSigner` passed no pin, keyVault threw
 * 'PIN required', and the user was locked out permanently with only the (destructive) escape hatch — the P0
 * lockout. The PRF path below is unchanged: it passes no pin, and keyVault ignores it for a passkey.
 */
export function LocalUnlockGate({ onReauth }: { onReauth: () => void }) {
  const { nostr } = useNostr();
  const wrapMeta = useStore((s) => s.writerKeyWrapMeta);
  const keyProvenance    = useStore((s) => s.keyProvenance);
  const backupVerifiedAt = useStore((s) => s.backupVerifiedAt);
  const [pin, setPin]         = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const pinMode = wrapMeta?.scheme === 'pin';

  const unlock = async () => {
    setLoading(true);
    setError(null);
    try {
      const signer = await restoreSigner(nostr, pinMode ? pin : undefined);   // → unwrapSecretKey → Face ID / PIN
      // ⚠ `doRestoreSigner` catches every failure and returns null, so we cannot tell a wrong PIN from a corrupt
      // blob or a pubkey mismatch. In pinMode, name the likely cause without asserting it (the ceremony's string).
      if (!signer) throw new Error(pinMode ? 'Could not unlock — check your PIN and try again.' : 'Unlock failed');
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
    // R2c-6-final: a generated-unverified key has no relay copy → the confirm warns of permanent loss. ⚠ On an
    // ENCRYPTED cold start (flag-on, locked blob) backupVerifiedAt reads null, so this branch may show for an
    // actually-verified key — accepted (the enc flag is dev-only, off by default).
    const neverSynced = !isBackupGateSatisfied({ keyProvenance, backupVerifiedAt });
    if (!window.confirm(resetAndResyncConfirmMessage(neverSynced))) return;
    setLoading(true);
    resetAndResync(nostr);   // clears encryption state + reloads
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.logo}>₿</div>
        <h1 className={styles.title}>Personal ₿LOC</h1>
        <p className={styles.subtitle}>
          {pinMode ? 'Enter your PIN to continue' : `Unlock with ${biometricLabel()} to continue`}
        </p>

        {/* Unlock, not setup — so no confirm field and a bare length gate (mirrors ViewerUnlockGate). */}
        {pinMode && (
          <PassphraseInput
            className={styles.input}
            inputMode="numeric"
            placeholder="PIN"
            value={pin}
            onChange={(v) => { setPin(v); setError(null); }}
            disabled={loading}
            aria-label="PIN"
          />
        )}

        <button
          className={styles.primaryBtn}
          onClick={unlock}
          disabled={loading || (pinMode && pin.length < 4)}
        >
          {loading ? 'Unlocking…' : pinMode ? '🔒 Unlock' : `🔒 Unlock with ${biometricLabel()}`}
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
