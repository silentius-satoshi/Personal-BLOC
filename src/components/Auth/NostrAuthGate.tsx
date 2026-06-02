import { useState } from 'react';
import { connectNip07, connectNip46 } from '../../lib/nostr/signers';
import { useSigner } from '../../lib/nostr/SignerContext';
import { useStore } from '../../store/useStore';
import styles from './NostrAuthGate.module.css';

export function NostrAuthGate({ onSuccess }: { onSuccess: () => void }) {
  const setNostrPubkey        = useStore((s) => s.setNostrPubkey);
  const setNostrSigningMethod = useStore((s) => s.setNostrSigningMethod);
  const setIsAuthenticated    = useStore((s) => s.setIsAuthenticated);
  const setNostrBunkerUri     = useStore((s) => s.setNostrBunkerUri);

  const { setSigner } = useSigner();

  const [showBunker, setShowBunker] = useState(false);
  const [bunkerUri, setBunkerUri]   = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const hasNip07 = typeof window !== 'undefined' && !!(window as any).nostr;

  const handleNip07 = async () => {
    setLoading(true);
    setError(null);
    try {
      const { signer, pubkey } = await connectNip07();
      setSigner(signer);
      setNostrPubkey(pubkey);
      setNostrSigningMethod('nip07');
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
      const { signer, pubkey } = await connectNip46(bunkerUri);
      setSigner(signer);
      setNostrPubkey(pubkey);
      setNostrSigningMethod('nip46');
      setNostrBunkerUri(bunkerUri);
      setIsAuthenticated(true);
      onSuccess();
    } catch {
      setError('Bunker connection failed — check URI and try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.logo}>₿</div>
        <h1 className={styles.title}>Personal ₿LOC</h1>
        <p className={styles.subtitle}>Connect your Nostr identity to continue</p>

        {!showBunker ? (
          <>
            {hasNip07 && (
              <button className={styles.primaryBtn} onClick={handleNip07} disabled={loading}>
                {loading ? 'Connecting…' : '⚡ Sign in with Extension'}
              </button>
            )}
            {hasNip07 && <div className={styles.divider} />}
            <button
              className={styles.secondaryBtn}
              onClick={() => { setShowBunker(true); setError(null); }}
              disabled={loading}
            >
              Connect Bunker (iOS / Remote Signer)
            </button>
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
