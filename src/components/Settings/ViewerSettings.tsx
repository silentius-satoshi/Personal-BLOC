import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { fetchViewerSnapshot, resetViewerSession, getViewerNpub } from '../../lib/nostr/viewerSync';
import { relativeAge } from '../../utils/format';
import styles from './ViewerSettings.module.css';

/**
 * Viewer V4 — the purpose-built FLAT viewer Settings (no subpages), rendered by SettingsMain in place
 * of the owner menu when viewerMode. AppShell's .simpleModeSettings wrapper already supplies the
 * ← Back header, so this is sections only. Deliberate scope cut: NO theme toggle (dark-only app).
 *
 * NOTE: the shared ui/Toggle self-disables in viewerMode (read-only-viewer hardening), so the
 * Live-block-height switch here is a local role="switch" button — the same reason Almanac's
 * FreshnessBadge is a plain button.
 */
export function ViewerSettings() {
  const viewerDisplayName    = useStore((s) => s.viewerDisplayName);
  const setViewerDisplayName = useStore((s) => s.setViewerDisplayName);
  const almanacLiveEnabled   = useStore((s) => s.almanacLiveEnabled);
  const setAlmanacLiveEnabled   = useStore((s) => s.setAlmanacLiveEnabled);
  const setAlmanacLiveConsented = useStore((s) => s.setAlmanacLiveConsented);
  const lastSync             = useStore((s) => s.viewerLastSyncAt);
  const npub                 = getViewerNpub();   // available — a viewer reaches Settings only after unlocking (holder populated)

  // Inline name edit — tap the row → field + Save/Cancel; empty Save clears to null (nameless greeting).
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft]     = useState('');
  const [npubCopied, setNpubCopied]   = useState(false);

  // Refresh feedback — success/failure via a before/after viewerLastSyncAt compare (a successful fetch
  // always re-stamps it; fetchViewerSnapshot swallows network errors internally, so no rejection to await).
  const [refreshing, setRefreshing]     = useState(false);
  const [refreshError, setRefreshError] = useState(false);

  const startNameEdit = () => { setNameDraft(viewerDisplayName ?? ''); setEditingName(true); };
  const saveName = () => { setViewerDisplayName(nameDraft.trim() || null); setEditingName(false); };

  const doRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError(false);
    const before = useStore.getState().viewerLastSyncAt;
    await fetchViewerSnapshot();
    const after = useStore.getState().viewerLastSyncAt;
    if (!after || after === before) setRefreshError(true);   // unchanged watermark = nothing arrived
    setRefreshing(false);
  };

  const signOut = () => {
    if (window.confirm('Sign out of viewing? This clears the shared plan from this device.')) {
      resetViewerSession();   // COMPLETE teardown → the device becomes undecided → the fork renders
    }
  };

  // Freshness dot: green when recently synced (<10 min), amber otherwise/never.
  const fresh = lastSync !== null && Date.now() - lastSync < 10 * 60_000;

  return (
    <div className={styles.root}>
      {/* YOU */}
      <div className={styles.groupLabel}>YOU</div>
      {editingName ? (
        <div className={styles.row}>
          <input
            className={styles.nameInput}
            type="text"
            placeholder="Your name"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
            autoFocus
          />
          <button className={styles.saveBtn} onClick={saveName}>Save</button>
          <button className={styles.cancelBtn} onClick={() => setEditingName(false)}>Cancel</button>
        </div>
      ) : (
        <div
          className={`${styles.row} ${styles.rowTappable}`}
          role="button"
          tabIndex={0}
          onClick={startNameEdit}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startNameEdit(); } }}
        >
          <span className={styles.rowTitle}>Your name</span>
          <span className={styles.rowValue}>{viewerDisplayName ?? 'Not set'}</span>
          <span className={styles.chevron}>›</span>
        </div>
      )}

      {npub && (
        <div className={styles.row}>
          <span className={styles.rowTitle}>Your viewing key</span>
          <span className={styles.rowValue}>
            {`${npub.slice(0, 10)}…${npub.slice(-6)}`}
            <button
              className={styles.copyBtn}
              onClick={() => { navigator.clipboard?.writeText(npub); setNpubCopied(true); setTimeout(() => setNpubCopied(false), 1500); }}
            >
              {npubCopied ? 'Copied ✓' : 'Copy'}
            </button>
          </span>
        </div>
      )}

      {/* DEVICE */}
      <div className={styles.groupLabel}>DEVICE</div>
      <div className={styles.row}>
        <div className={styles.rowBody}>
          <span className={styles.rowTitle}>Live block height</span>
          <span className={styles.rowHint}>
            Fetches the current block from public explorers — block height only, no identity. Off = local estimate.
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={almanacLiveEnabled}
          className={`${styles.switch} ${almanacLiveEnabled ? styles.switchOn : ''}`}
          onClick={() => {
            if (!almanacLiveEnabled) {
              setAlmanacLiveConsented(true);   // the inline host disclosure satisfies the one-time consent
              setAlmanacLiveEnabled(true);
            } else {
              setAlmanacLiveEnabled(false);
            }
          }}
        >
          <span className={styles.switchThumb} />
        </button>
      </div>

      {/* CONNECTION */}
      <div className={styles.groupLabel}>CONNECTION</div>
      <div className={styles.row}>
        <span className={styles.rowTitle}>Sync status</span>
        <span className={styles.rowValue}>
          <span className={`${styles.dot} ${fresh ? styles.dotOn : styles.dotWarn}`} />
          {lastSync ? `Connected · ${relativeAge(lastSync).replace('updated ', '')}` : 'Waiting for data…'}
        </span>
      </div>
      <div
        className={`${styles.row} ${refreshing ? styles.rowBusy : styles.rowTappable}`}
        role="button"
        tabIndex={refreshing ? -1 : 0}
        aria-disabled={refreshing}
        onClick={() => void doRefresh()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void doRefresh(); } }}
      >
        <span className={styles.rowTitle}>Refresh now</span>
        <span className={`${styles.refreshIcon} ${refreshing ? styles.spinning : ''}`}>↻</span>
      </div>
      {refreshError && <p className={styles.errorLine}>Couldn't reach the relays — check your connection and try again.</p>}

      {/* ABOUT */}
      <div className={styles.groupLabel}>ABOUT</div>
      <div className={styles.row}>
        <span className={styles.rowTitle}>Version</span>
        <span className={styles.rowValue}>
          {__BUILD_SHA__} · {new Date(__BUILD_TIME__).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Sign out */}
      <button className={styles.signOutBtn} onClick={signOut}>Sign out</button>
    </div>
  );
}
