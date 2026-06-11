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
  const advisorChecklist     = useStore((s) => s.advisorChecklist);

  const log = useSyncExternalStore(subscribeNostrLog, getNostrLog);

  const [probing, setProbing]         = useState(false);
  const [probeStatus, setProbeStatus] = useState('');
  const [copied, setCopied]           = useState(false);

  const checklistFlags = (['blocDraw', 'cbPayment', 'btcBuying', 'fiatCoverage', 'ndpPayment'] as const)
    .filter((k) => advisorChecklist[k]);
  const checklistSummary = `month ${advisorChecklist.month} · ${checklistFlags.length ? checklistFlags.join(', ') : 'none'}`;

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
    checklist:     checklistSummary,
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

  const copyDiagnostics = async () => {
    const diag = {
      build:   __BUILD_SHA__,
      builtAt: __BUILD_TIME__,
      now:     new Date().toISOString(),
      state:   syncState,
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
        <span className={styles.key}>checklist</span><span className={styles.val}>{checklistSummary}</span>
        <span className={styles.key}>device</span><span className={styles.val}>{syncState.device}</span>
        <span className={styles.key}>build</span><span className={styles.val}>{__BUILD_SHA__}</span>
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
