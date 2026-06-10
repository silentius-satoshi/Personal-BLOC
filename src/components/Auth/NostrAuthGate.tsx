import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { connectNip07 } from '../../lib/nostr/signers';
import { syncNow } from '../../lib/nostr/syncNow';
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

export function NostrAuthGate({ onSuccess }: { onSuccess: () => void }) {
  const setNostrPubkey        = useStore((s) => s.setNostrPubkey);
  const setNostrSigningMethod = useStore((s) => s.setNostrSigningMethod);
  const setIsAuthenticated    = useStore((s) => s.setIsAuthenticated);
  const setNostrBunkerUri     = useStore((s) => s.setNostrBunkerUri);

  const { nostr }     = useNostr();

  const [showBunker, setShowBunker]           = useState(false);
  const [bunkerUri, setBunkerUri]             = useState('');
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState<string | null>(null);

  const [connectParams, setConnectParams]     = useState<NostrConnectParams | null>(null);
  const [connectUri, setConnectUri]           = useState('');
  const [connectStatus, setConnectStatus]     = useState<NostrConnectStatus | null>(null);
  const [hasOpenedSigner, setHasOpenedSigner] = useState(false);
  const abortRef                              = useRef<AbortController | null>(null);

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const hasNip07 = typeof window !== 'undefined' && !!(window as any).nostr;

  const handleNip07 = async () => {
    setLoading(true);
    setError(null);
    try {
      const { signer, pubkey } = await connectNip07();
      useStore.getState().setNostrSigner(signer);
      setNostrPubkey(pubkey);
      setNostrSigningMethod('nip07');
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
      setNostrPubkey(pubkey);
      setNostrSigningMethod('nip46');
      setNostrBunkerUri(bunkerUri);
      useStore.getState().setNostrLogin(JSON.stringify({ ...login, pubkey }));
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
      name: 'Personal ₿LOC',
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
        setNostrPubkey(login.pubkey);
        setNostrSigningMethod('nip46');
        useStore.getState().setNostrLogin(JSON.stringify({ ...login, pubkey: login.pubkey }));
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
        ) : !showBunker ? (
          <>
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
