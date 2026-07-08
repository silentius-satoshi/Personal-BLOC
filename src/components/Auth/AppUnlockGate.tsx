import { useState } from 'react';
import { deriveStoreKey } from '../../lib/nostr/keyVault';
import { setStoreKey } from '../../lib/store/storeCrypto';
import { biometricLabel } from '../../lib/biometricLabel';
import { useStore } from '../../store/useStore';
import styles from './NostrAuthGate.module.css';

/**
 * At-rest store-encryption unlock (Phase B). Shown on cold start when encryption is enabled and the store key
 * holder is empty (storeUnlocked false). Derives the STORE key from the SAME credential as the nsec wrap — keyed
 * on writerKeyWrapMeta.scheme (NOT nostrSigningMethod) — then rehydrates so the encrypted blob decrypts into real
 * data. Mirrors LocalUnlockGate; reuses NostrAuthGate.module.css.
 */
export function AppUnlockGate() {
  const meta = useStore((s) => s.writerKeyWrapMeta);
  const scheme = meta?.scheme;
  const [pin, setPin]         = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const unlock = async () => {
    setLoading(true);
    setError(null);
    try {
      const m = useStore.getState().writerKeyWrapMeta;
      if (!m) throw new Error('No key to unlock');
      const key = await deriveStoreKey(
        m.scheme,
        { salt: m.salt, credentialId: m.credentialId },
        m.scheme === 'pin' ? pin : undefined,
      );
      setStoreKey(key);
      useStore.getState().setStoreUnlocked(true);
      await useStore.persist.rehydrate();   // re-run getItem → decrypt → populate real data
    } catch (e: any) {
      setError(e?.message ?? 'Unlock failed — try again');
    } finally {
      setLoading(false);
    }
  };

  const pinMode = scheme === 'pin';
  const canUnlock = !loading && (!pinMode || pin.length >= 4);

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.logo}>₿</div>
        <h1 className={styles.title}>Personal ₿LOC</h1>
        <p className={styles.subtitle}>Unlock to continue</p>

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

        <button className={styles.primaryBtn} onClick={unlock} disabled={!canUnlock}>
          {loading ? 'Unlocking…' : pinMode ? 'Unlock' : `🔒 Unlock with ${biometricLabel()}`}
        </button>

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
