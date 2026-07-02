import { useState } from 'react';
import { nip19 } from 'nostr-tools';
import { useStore, publishViewerSnapshotNow, publishViewerRevocationNow } from '../../store/useStore';
import { Toggle } from '../ui/Toggle';
import styles from './SharingPage.module.css';

/**
 * Sharing subpage (Viewer V2) — the owner's viewer-access home, extracted from SettingsMain.
 * Owner-only (SettingsMain gates it `!viewerMode`). Two sections:
 *  - YOUR SHARE CODE: the owner's npub to hand out.
 *  - YOUR VIEWER: the single grant card (list-ready for multi-viewer) with the C-safe/C-trusted
 *    privacy toggle + revoke, or the add-a-viewer form when empty.
 * Reads the store directly; owns its own draft/error/copied local state (verbatim handlers).
 */
export function SharingPage() {
  const nostrPubkey         = useStore((s) => s.nostrPubkey);
  const viewerNpub          = useStore((s) => s.viewerNpub);
  const viewerLabel         = useStore((s) => s.viewerLabel);
  const viewerPrivacyTrusted = useStore((s) => s.viewerPrivacyTrusted);
  const setViewerNpub       = useStore((s) => s.setViewerNpub);
  const setViewerPubkey     = useStore((s) => s.setViewerPubkey);
  const setViewerLabel      = useStore((s) => s.setViewerLabel);
  const setViewerPrivacyTrusted = useStore((s) => s.setViewerPrivacyTrusted);

  const [draft, setDraft]           = useState('');
  const [labelDraft, setLabelDraft] = useState('');
  const [error, setError]           = useState<string | null>(null);
  const [npubCopied, setNpubCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  if (!nostrPubkey) {
    return (
      <div className={styles.section}>
        <p className={styles.desc}>Connect a Nostr identity first to share viewer access.</p>
      </div>
    );
  }

  const ownerNpub = (() => { try { return nip19.npubEncode(nostrPubkey); } catch { return ''; } })();

  const copyOwnerNpub = () => {
    if (!ownerNpub) return;
    navigator.clipboard?.writeText(ownerNpub);
    setNpubCopied(true);
    setTimeout(() => setNpubCopied(false), 1500);
  };

  const addViewer = () => {
    const input = draft.trim();
    try {
      const decoded = nip19.decode(input);
      if (decoded.type !== 'npub') { setError('Not a valid npub'); return; }
      setViewerNpub(input);
      setViewerPubkey(decoded.data as string);
      const label = labelDraft.trim();
      if (label) setViewerLabel(label);
      setError(null);
      void publishViewerSnapshotNow();   // seal + publish NOW so the viewer hydrates without waiting for an owner edit
    } catch { setError('Not a valid npub'); }
  };

  const revoke = () => {
    void publishViewerRevocationNow();   // tombstone WHILE viewerPubkey is still set
    setViewerNpub(null); setViewerPubkey(null); setViewerLabel(null);
    setDraft(''); setLabelDraft(''); setError(null); setConfirmRevoke(false);
  };

  return (
    <div className={styles.section}>
      {/* YOUR SHARE CODE */}
      <div className={styles.groupTitle}>YOUR SHARE CODE</div>
      <p className={styles.desc}>Give this to the person you're sharing with — they'll enter it when connecting.</p>
      <div className={styles.npubRow}>
        <span className={styles.npub}>{ownerNpub ? `${ownerNpub.slice(0, 14)}…${ownerNpub.slice(-8)}` : nostrPubkey.slice(0, 12)}</span>
        <button className={styles.actionBtn} onClick={copyOwnerNpub}>{npubCopied ? 'Copied ✓' : 'Copy'}</button>
      </div>

      {/* YOUR VIEWER */}
      <div className={styles.groupTitle} style={{ marginTop: 20 }}>YOUR VIEWER</div>
      {viewerNpub ? (
        <div className={styles.grantCard}>
          <div className={styles.grantHead}>
            <span className={styles.grantDot} />
            <span className={styles.grantName}>
              {viewerLabel || 'Viewer'}{' '}
              <span className={styles.grantNpub}>({viewerNpub.slice(0, 12)}…{viewerNpub.slice(-6)})</span>
            </span>
            <span className={styles.grantActive}>Active</span>
          </div>
          <div className={styles.toggleRow}>
            <div className={styles.toggleLabel}>
              <span className={styles.toggleTitle}>Show real figures</span>
              <span className={styles.toggleHint}>Off: health only · On: balances + liquidation prices</span>
            </div>
            <Toggle value={viewerPrivacyTrusted} onChange={setViewerPrivacyTrusted} />
          </div>
          {confirmRevoke ? (
            <div className={styles.confirmRow}>
              <span className={styles.confirmText}>Stop sharing with this viewer?</span>
              <button className={styles.revokeBtn} onClick={revoke}>Revoke</button>
              <button className={styles.actionBtn} onClick={() => setConfirmRevoke(false)}>Cancel</button>
            </div>
          ) : (
            <button className={styles.revokeBtn} onClick={() => setConfirmRevoke(true)}>Revoke</button>
          )}
        </div>
      ) : (
        <div className={styles.addBlock}>
          <p className={styles.desc}>Add someone to follow your plan, read-only.</p>
          <input
            className={styles.input}
            type="text"
            placeholder="Nickname (e.g. Dad's iPhone)"
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
          />
          <input
            className={styles.input}
            type="text"
            placeholder="Their npub1…"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
          />
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.addBtn} onClick={addViewer}>Add</button>
        </div>
      )}
    </div>
  );
}
