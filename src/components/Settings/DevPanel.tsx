import { useState, useSyncExternalStore } from 'react';
import { useStore } from '../../store/useStore';
import { withTimeout, signerOpTimeout } from '../../lib/nostr/timeout';
import { nostrLog, getNostrLog, clearNostrLog, subscribeNostrLog } from '../../lib/nostr/log';
import { getDeviceLabel } from '../../lib/nostr/deviceTag';
import styles from './DevPanel.module.css';

// PRIVACY RULE: everything rendered or copied here is sync METADATA only —
// never balances, amounts, incomes, expenses, or monthlyLog entry contents.

const fmtTs = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleString() : 'never');   // unix SECONDS

export function DevPanel() {
  const nostrSigningMethod   = useStore((s) => s.nostrSigningMethod);
  const nostrPubkey          = useStore((s) => s.nostrPubkey);
  const nostrRelays          = useStore((s) => s.nostrRelays);
  const lastSettingsSyncAt   = useStore((s) => s.lastSettingsSyncAt);
  const lastRecordsSyncAt    = useStore((s) => s.lastRecordsSyncAt);
  const recordsDirty         = useStore((s) => s.recordsDirty);
  const nostrReconnectNeeded = useStore((s) => s.nostrReconnectNeeded);
  const nostrSyncing         = useStore((s) => s.nostrSyncing);
  const monthlyLogCount      = useStore((s) => s.monthlyLog.length);
  const tombstoneCount       = useStore((s) => Object.keys(s.deletedMonths).length);
  // COLLATERAL figures: position amounts allowed ON-DEVICE only (the panel) —
  // they must NOT enter syncState / Copy Diagnostics (paste-safe rule).
  const baselineBtc          = useStore((s) => s.advisorActualBtcHeld);
  const pendingAdj           = useStore((s) => s.pendingCollateralAdjustment);
  const currentBtcHeld       = useStore((s) => s.getCurrentBtcHeld());
  // Viewer access — handshake metadata (presence/pubkeys only; NEVER the secret key value)
  const viewerMode           = useStore((s) => s.viewerMode);
  const viewerPubkey         = useStore((s) => s.viewerPubkey);         // owner side: who I publish to
  const viewerWriterPubkey   = useStore((s) => s.viewerWriterPubkey);   // viewer side: who I read from
  const viewerSecretKey      = useStore((s) => s.viewerSecretKey);      // viewer side (presence only — plaintext migrant)
  const viewerKeyWrapped     = useStore((s) => s.viewerKeyWrapped);     // Phase 3 (presence only — never the value)
  const viewerUnlocked       = useStore((s) => s.viewerUnlocked);       // in-memory holder populated?

  const log = useSyncExternalStore(subscribeNostrLog, getNostrLog);

  const [probing, setProbing]         = useState(false);
  const [probeStatus, setProbeStatus] = useState('');
  const [copied, setCopied]           = useState(false);
  const [vProbing, setVProbing]         = useState(false);
  const [vProbeStatus, setVProbeStatus] = useState('');

  const syncState = {
    method:        nostrSigningMethod ?? '—',
    pubkey:        nostrPubkey ? `${nostrPubkey.slice(0, 8)}…${nostrPubkey.slice(-8)}` : '—',
    relays:        nostrRelays,
    settingsSync:  fmtTs(lastSettingsSyncAt),
    recordsSync:   fmtTs(lastRecordsSyncAt),
    recordsDirty,
    reconnectNeeded: nostrReconnectNeeded,
    syncing:       nostrSyncing,
    logEntries:    monthlyLogCount,
    tombstones:    tombstoneCount,
    device:        getDeviceLabel(),
    build:         __BUILD_SHA__,
  };

  const runProbe = async () => {
    // nip46: this round-trip may surface a Primal approval prompt — intentional (that IS the test).
    const { nostrSigner, nostrPubkey: pk, nostrSigningMethod: method } = useStore.getState();
    if (!nostrSigner?.nip44 || !pk) { setProbeStatus('no signer'); return; }
    setProbing(true);
    setProbeStatus('probing…');
    try {
      const t0 = performance.now();
      const plaintext = `probe-${Date.now()}`;
      const ct = await withTimeout(nostrSigner.nip44.encrypt(pk, plaintext), signerOpTimeout(method), 'probe encrypt');
      const pt = await withTimeout(nostrSigner.nip44.decrypt(pk, ct), signerOpTimeout(method), 'probe decrypt');
      const result = pt === plaintext ? `OK ${Math.round(performance.now() - t0)}ms` : 'MISMATCH';
      setProbeStatus(result);
      nostrLog(result.startsWith('OK') ? 'info' : 'warn', `signer probe: ${result}`);
    } catch (e) {
      const result = e instanceof Error ? e.message : String(e);
      setProbeStatus(result);
      nostrLog('warn', `signer probe: ${result}`);
    } finally {
      setProbing(false);
    }
  };

  // Test viewer link — query the relays for the viewer:v1 event and report WHERE the chain breaks.
  // PRIVACY: status carries counts/booleans/ages/truncated-pubkeys only — NEVER decrypted amounts.
  const runViewerProbe = async () => {
    const s = useStore.getState();
    setVProbing(true); setVProbeStatus('querying relays…');
    try {
      const { SimplePool } = await import('nostr-tools/pool');
      const { VIEWER_DTAG } = await import('../../lib/nostr/publish');
      const pool = new SimplePool();
      if (s.viewerMode) {
        // VIEWER side: fetch + decrypt
        if (!s.viewerWriterPubkey || !s.viewerSecretKey) {
          setVProbeStatus('viewer not provisioned (missing writerPubkey/key)'); pool.close(s.nostrRelays); setVProbing(false); return;
        }
        const events = await pool.querySync(s.nostrRelays, { kinds: [30078], authors: [s.viewerWriterPubkey], '#d': [VIEWER_DTAG] });
        pool.close(s.nostrRelays);
        if (!events.length) {
          setVProbeStatus(`NO viewer:v1 event on relays from ${s.viewerWriterPubkey.slice(0, 8)}… — owner hasn't published (did they change a setting AFTER adding your npub?) or wrong owner npub/relays`); setVProbing(false); return;
        }
        const latest = events.reduce((a, b) => (b.created_at > a.created_at ? b : a));
        try {
          const { NSecSigner } = await import('@nostrify/nostrify');
          const { hexToBytes } = await import('nostr-tools/utils');
          const signer = new NSecSigner(hexToBytes(s.viewerSecretKey).slice());   // .slice() — NSecSigner holds a ref
          const json = await signer.nip44.decrypt(s.viewerWriterPubkey, latest.content);
          const snap = JSON.parse(json);
          const entries = snap?.records?.entries?.length ?? 0;
          setVProbeStatus(`OK — decrypted ✓ · ${entries} log entries · settings:${!!snap?.settings} · strike:${!!snap?.strike} · age ${Math.round(Date.now() / 1000 - latest.created_at)}s`);
        } catch (e) {
          setVProbeStatus(`event found but DECRYPT FAILED — key/pubkey mismatch: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else {
        // OWNER side: confirm my published viewer:v1 exists (can't decrypt — sealed to the viewer)
        if (!s.nostrPubkey) { setVProbeStatus('not logged in'); pool.close(s.nostrRelays); setVProbing(false); return; }
        const events = await pool.querySync(s.nostrRelays, { kinds: [30078], authors: [s.nostrPubkey], '#d': [VIEWER_DTAG] });
        pool.close(s.nostrRelays);
        if (!s.viewerPubkey) { setVProbeStatus(`no viewer configured — ${events.length} viewer:v1 events on relays`); }
        else if (!events.length) { setVProbeStatus('NO viewer:v1 event published yet — change a setting/month to publish one (saving the npub alone does NOT publish)'); }
        else { const latest = events.reduce((a, b) => (b.created_at > a.created_at ? b : a)); setVProbeStatus(`published ✓ — ${events.length} event(s), latest ${Math.round(Date.now() / 1000 - latest.created_at)}s ago, sealed to ${s.viewerPubkey.slice(0, 8)}…`); }
      }
    } catch (e) {
      setVProbeStatus(`probe error: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setVProbing(false); }
  };

  const copyDiagnostics = async () => {
    const diag = {
      build:   __BUILD_SHA__,
      builtAt: __BUILD_TIME__,
      now:     new Date().toISOString(),
      state:   { ...syncState, pendingNonZero: pendingAdj !== 0 },   // boolean only — amounts stay out
      log:     getNostrLog(),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { setProbeStatus('clipboard unavailable'); }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.sectionTitle}>SYNC STATE</div>
      <div className={styles.grid}>
        <span className={styles.key}>method</span><span className={styles.val}>{syncState.method}</span>
        <span className={styles.key}>pubkey</span><span className={styles.val}>{syncState.pubkey}</span>
        <span className={styles.key}>relays</span>
        <span className={styles.val}>
          {nostrRelays.length ? nostrRelays.map((r) => <div key={r}>{r}</div>) : '—'}
        </span>
        <span className={styles.key}>settings sync</span><span className={styles.val}>{syncState.settingsSync}</span>
        <span className={styles.key}>records sync</span><span className={styles.val}>{syncState.recordsSync}</span>
        <span className={styles.key}>recordsDirty</span><span className={styles.val}>{String(recordsDirty)}</span>
        <span className={styles.key}>reconnectNeeded</span><span className={styles.val}>{String(nostrReconnectNeeded)}</span>
        <span className={styles.key}>syncing</span><span className={styles.val}>{String(nostrSyncing)}</span>
        <span className={styles.key}>log entries</span><span className={styles.val}>{monthlyLogCount}</span>
        <span className={styles.key}>tombstones</span><span className={styles.val}>{tombstoneCount}</span>
        <span className={styles.key}>device</span><span className={styles.val}>{syncState.device}</span>
        <span className={styles.key}>build</span><span className={styles.val}>{__BUILD_SHA__}</span>
      </div>

      <div className={styles.sectionTitle}>COLLATERAL</div>
      <div className={styles.grid}>
        <span className={styles.key}>baseline</span><span className={styles.val}>{baselineBtc.toFixed(5)} ₿</span>
        <span className={styles.key}>pending</span>
        <span className={styles.val} style={pendingAdj !== 0 ? { color: 'var(--orange)' } : undefined}>
          {pendingAdj === 0 ? '0' : `${pendingAdj > 0 ? '+' : ''}${pendingAdj.toFixed(5)}`} ₿
        </span>
        <span className={styles.key}>current</span><span className={styles.val}>{currentBtcHeld.toFixed(5)} ₿</span>
      </div>

      <div className={styles.sectionTitle}>VIEWER ACCESS</div>
      <div className={styles.grid}>
        <span className={styles.key}>role</span><span className={styles.val}>{viewerMode ? 'viewer' : 'owner/writer'}</span>
        <span className={styles.key}>publishes to (viewerPubkey)</span><span className={styles.val}>{viewerPubkey ? `${viewerPubkey.slice(0, 8)}…${viewerPubkey.slice(-8)}` : '— (no viewer set)'}</span>
        <span className={styles.key}>reads from (writerPubkey)</span><span className={styles.val}>{viewerWriterPubkey ? `${viewerWriterPubkey.slice(0, 8)}…${viewerWriterPubkey.slice(-8)}` : '—'}</span>
        <span className={styles.key}>plaintext key present</span><span className={styles.val}>{String(!!viewerSecretKey)}</span>
        <span className={styles.key}>key wrapped</span><span className={styles.val}>{String(!!viewerKeyWrapped)}</span>
        <span className={styles.key}>unlocked</span><span className={styles.val}>{String(viewerUnlocked)}</span>
        <span className={styles.key}>my pubkey</span><span className={styles.val}>{nostrPubkey ? `${nostrPubkey.slice(0, 8)}…${nostrPubkey.slice(-8)}` : '—'}</span>
      </div>
      <div className={styles.probeRow}>
        <button className={styles.btn} onClick={runViewerProbe} disabled={vProbing}>Test viewer link</button>
        <span className={styles.probeStatus}>{vProbeStatus}</span>
      </div>

      <div className={styles.sectionTitle}>SIGNER PROBE</div>
      <div className={styles.probeRow}>
        <button className={styles.btn} onClick={runProbe} disabled={probing}>Test signer</button>
        <span className={styles.probeStatus}>{probeStatus}</span>
      </div>

      <div className={styles.sectionTitle}>
        LOG
        <button className={styles.btnGhost} onClick={clearNostrLog}>Clear</button>
      </div>
      <div className={styles.logList}>
        {log.length === 0 && <div className={styles.logEmpty}>no entries</div>}
        {[...log].reverse().map((e, i) => (
          <div key={`${e.ts}-${i}`} className={styles.logRow}>
            <span className={styles.logTime}>
              {new Date(e.ts).toLocaleTimeString(undefined, { hour12: false })}
            </span>
            <span className={e.level === 'error' ? styles.logError : e.level === 'warn' ? styles.logWarn : styles.logInfo}>
              {e.level}
            </span>
            <span className={styles.logMsg}>{e.msg}</span>
            {e.data && <div className={styles.logData}>{e.data}</div>}
          </div>
        ))}
      </div>

      <button className={styles.btn} onClick={copyDiagnostics}>
        {copied ? 'Copied ✓' : 'Copy diagnostics'}
      </button>
    </div>
  );
}
