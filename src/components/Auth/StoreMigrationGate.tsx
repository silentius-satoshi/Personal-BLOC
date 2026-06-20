import { useState } from 'react';
import { deriveStoreKey } from '../../lib/nostr/keyVault';
import { setStoreKey } from '../../lib/store/storeCrypto';
import { migratePlaintextToEncrypted, migrateEncryptedToPlaintext } from '../../lib/store/storeMigration';
import { useStore } from '../../store/useStore';
import styles from './NostrAuthGate.module.css';

/**
 * Phase C migration gate — both directions are GATE-based + Face-ID/PIN re-derive (no in-memory-key assumption).
 *  • mode='encrypt': flag on + blob still plaintext → derive key → migratePlaintextToEncrypted (verify-before-
 *    delete) → setStoreUnlocked + rehydrate (data populates, now encrypted).
 *  • mode='decrypt': OFF requested (pending-decrypt marker) → derive key → migrateEncryptedToPlaintext → clear the
 *    flag + marker → reload with the flag OFF (default storage, plaintext loads normally).
 * On ANY failure the source blob is untouched (recoverable); the gate shows the error and stays. Mirrors
 * AppUnlockGate; reuses NostrAuthGate.module.css.
 */
export function StoreMigrationGate({ mode }: { mode: 'encrypt' | 'decrypt' }) {
  const meta = useStore((s) => s.writerKeyWrapMeta);
  const scheme = meta?.scheme;
  const [pin, setPin]         = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const m = useStore.getState().writerKeyWrapMeta;
      if (!m) throw new Error('No key available');
      const key = await deriveStoreKey(
        m.scheme,
        { salt: m.salt, credentialId: m.credentialId },
        m.scheme === 'pin' ? pin : undefined,
      );
      setStoreKey(key);
      if (mode === 'encrypt') {
        const ok = await migratePlaintextToEncrypted();
        if (!ok) { setError('Migration failed — your data is unchanged. Try again.'); setStoreKey(null); return; }
        useStore.getState().setStoreUnlocked(true);
        await useStore.persist.rehydrate();   // re-run getItem → decrypt → populate real data
      } else {
        const ok = await migrateEncryptedToPlaintext();
        if (!ok) { setError('Could not decrypt — your data is unchanged.'); setStoreKey(null); return; }
        localStorage.removeItem('personal-bloc-store-enc-enabled');
        localStorage.removeItem('personal-bloc-store-enc-pending-decrypt');
        setStoreKey(null);
        window.location.reload();   // reload with the flag OFF → default storage → plaintext loads normally
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed — try again');
      setStoreKey(null);   // source blob intact
    } finally {
      setLoading(false);
    }
  };

  const pinMode = scheme === 'pin';
  const canRun = !loading && (!pinMode || pin.length >= 4);
  const subtitle = mode === 'encrypt' ? 'Encrypt your local data' : 'Unlock to turn off encryption';
  const action = loading
    ? (mode === 'encrypt' ? 'Encrypting…' : 'Decrypting…')
    : pinMode ? (mode === 'encrypt' ? 'Encrypt' : 'Decrypt') : '🔒 Continue with Face ID';

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.logo}>₿</div>
        <h1 className={styles.title}>Personal ₿LOC</h1>
        <p className={styles.subtitle}>{subtitle}</p>

        {pinMode && (
          <input
            className={styles.input}
            type="password"
            inputMode="numeric"
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            disabled={loading}
          />
        )}

        <button className={styles.primaryBtn} onClick={run} disabled={!canRun}>
          {action}
        </button>

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
