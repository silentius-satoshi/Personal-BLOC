import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useStore, storeEncEnabled } from '../../store/useStore';
import { haptics, hapticsSupport } from '../../lib/haptics';
import { withTimeout, signerOpTimeout } from '../../lib/nostr/timeout';
import { nostrLog, getNostrLog, clearNostrLog, subscribeNostrLog } from '../../lib/nostr/log';
import { getPublishReports } from '../../lib/nostr/publish';
import { getDeviceLabel } from '../../lib/nostr/deviceTag';
import { blobIsPlaintext, migrateEncryptedToPlaintext } from '../../lib/store/storeMigration';
import { isStoreUnlocked } from '../../lib/store/storeCrypto';
import styles from './DevPanel.module.css';

// PRIVACY RULE: everything rendered or copied here is sync METADATA only —
// never balances, amounts, incomes, expenses, or monthlyLog entry contents.

const fmtTs = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleString() : 'never');   // unix SECONDS

// Collapsible section wrapper — session-only open state (no persistence). Returns a FRAGMENT so the
// header + body stay flex siblings of .panel and the existing gap/margin layout is unchanged when open.
// The header reuses .sectionTitle (flex space-between); an optional action button (Refresh/Clear) sits on
// the right and stopPropagation's so it doesn't toggle the section.
function Section({ title, action, defaultOpen = false, children }:
  { title: string; action?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <div
        className={styles.sectionTitle}
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); } }}
      >
        <span>{open ? '▾' : '▸'} {title}</span>
        {action ? <span onClick={(e) => e.stopPropagation()}>{action}</span> : null}
      </div>
      {open && children}
    </>
  );
}

/**
 * Fires haptics.* DIRECTLY from tap handlers (some browsers gate navigator.vibrate on a user gesture).
 * Useful on Android ('vibrate'); a no-op on iOS/desktop ('none' — no programmatic haptic path). Metadata-only.
 */
function HapticsProbe() {
  const [last, setLast] = useState('—');
  const fire = (name: 'tick' | 'confirm' | 'warn') => { haptics[name](); setLast(`${name} @ ${new Date().toLocaleTimeString()}`); };
  return (
    <>
      <div className={styles.grid}>
        <span className={styles.key}>support</span><span className={styles.val}>{hapticsSupport()}</span>
        <span className={styles.key}>last fired</span><span className={styles.val}>{last}</span>
      </div>
      <div className={styles.probeRow}>
        <button className={styles.btn} onClick={() => fire('tick')}>tick</button>
        <button className={styles.btn} onClick={() => fire('confirm')}>confirm</button>
        <button className={styles.btn} onClick={() => fire('warn')}>warn</button>
      </div>
    </>
  );
}

// btcPriceUpdatedAt is in MILLISECONDS (Date.now()) — fmtTs above is for unix seconds, not reusable here.
const fmtPriceAge = (ts: number | null, now: number) => {
  if (!ts) return 'never';
  const secs = Math.max(0, Math.round((now - ts) / 1000));
  const age  = secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`;
  return secs > 5 * 60 ? `⚠ stale ${age}` : age;
};

export function DevPanel() {
  const nostrSigningMethod   = useStore((s) => s.nostrSigningMethod);
  const nostrPubkey          = useStore((s) => s.nostrPubkey);
  const nostrRelays          = useStore((s) => s.nostrRelays);
  const lastSettingsSyncAt   = useStore((s) => s.lastSettingsSyncAt);
  const lastRecordsSyncAt    = useStore((s) => s.lastRecordsSyncAt);
  const recordsDirty         = useStore((s) => s.recordsDirty);
  const nostrReconnectNeeded = useStore((s) => s.nostrReconnectNeeded);
  const nostrSyncing         = useStore((s) => s.nostrSyncing);
  // BTC price staleness (diagnostic only — public market price; kept OUT of syncState/Copy Diagnostics)
  const btcPrice             = useStore((s) => s.btcPrice);
  const btcPriceUpdatedAt    = useStore((s) => s.btcPriceUpdatedAt);
  const monthlyLogCount      = useStore((s) => s.monthlyLog.length);
  const tombstoneCount       = useStore((s) => Object.keys(s.deletedMonths).length);
  // COLLATERAL figures: position amounts allowed ON-DEVICE only (the panel) —
  // they must NOT enter syncState / Copy Diagnostics (paste-safe rule).
  const baselineBtc          = useStore((s) => s.advisorActualBtcHeld);
  const currentBtcHeld       = useStore((s) => s.getCurrentBtcHeld());   // reading-anchored (v20)
  // Viewer access — handshake metadata (presence/pubkeys only; NEVER the secret key value)
  const viewerMode           = useStore((s) => s.viewerMode);
  const viewerPubkey         = useStore((s) => s.viewers[0]?.pubkeyHex ?? null);   // owner side: who I publish to (M1: slot 0)
  const viewerWriterPubkey   = useStore((s) => s.viewerWriterPubkey);   // viewer side: who I read from
  const viewerSecretKey      = useStore((s) => s.viewerSecretKey);      // viewer side (presence only — plaintext migrant)
  const viewerKeyWrapped     = useStore((s) => s.viewerKeyWrapped);     // Phase 3 (presence only — never the value)
  const viewerUnlocked       = useStore((s) => s.viewerUnlocked);       // in-memory holder populated?
  const viewerDataLoaded     = useStore((s) => s.viewerDataLoaded);     // flips false when a tombstone processes

  const log = useSyncExternalStore(subscribeNostrLog, getNostrLog);

  const [probing, setProbing]         = useState(false);
  const [probeStatus, setProbeStatus] = useState('');
  const [copied, setCopied]           = useState(false);
  const [vProbing, setVProbing]         = useState(false);
  const [vProbeStatus, setVProbeStatus] = useState('');
  const [vRefetching, setVRefetching]   = useState(false);
  // PUBLISH ACKS — reports are mutated in place after being pushed, so Refresh re-snapshots live state.
  const [publishReports, setPublishReports] = useState(() => [...getPublishReports()]);
  const [swStatus, setSwStatus] = useState<{
    controller: string;
    registration: string[];
    cacheKeys: string;
    precacheDetails: string[];
    scriptMatches: string[];
    updateResult: string;
  } | null>(null);
  const [swLoading, setSwLoading] = useState(false);

  // 5s tick so the btc-price age below climbs visibly — a frozen price (dead poll) shows the age growing
  // past 60s/2m, which is the whole point of the diagnostic (a render-only age could look static).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  // Container-local SW diagnostics — the index.html ?swdebug probe can't be reached from inside an
  // installed PWA (and on iOS a Safari-tab probe can't see the PWA's isolated storage/SW registration at
  // all), so this is the one surface reachable from WITHIN the running container itself.
  const refreshSwStatus = async () => {
    setSwLoading(true);
    try {
      const controller = ('serviceWorker' in navigator) && navigator.serviceWorker.controller
        ? navigator.serviceWorker.controller.scriptURL
        : 'NO CONTROLLER';

      const registration: string[] = [];
      let updateResult = 'no registration';
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          if (reg.installing) registration.push(`installing: ${reg.installing.scriptURL} [${reg.installing.state}]`);
          if (reg.waiting)    registration.push(`waiting: ${reg.waiting.scriptURL} [${reg.waiting.state}]`);
          if (reg.active)     registration.push(`active: ${reg.active.scriptURL} [${reg.active.state}]`);
          if (registration.length === 0) registration.push('registration exists, no workers');
          try {
            await reg.update();
            updateResult = 'update() resolved';
          } catch (e) {
            updateResult = `update() rejected: ${e instanceof Error ? e.message : String(e)}`;
          }
        } else {
          registration.push('no registration');
        }
      } else {
        registration.push('serviceWorker not supported');
      }

      let cacheKeysList: string[] = [];
      const precacheDetails: string[] = [];
      const scriptMatches: string[] = [];
      if ('caches' in window) {
        cacheKeysList = await caches.keys();
        const workboxCaches = cacheKeysList.filter((k) => k.indexOf('workbox-precache') === 0);
        for (const name of workboxCaches) {
          const cache = await caches.open(name);
          const entries = await cache.keys();
          // ignoreSearch required — precached URLs carry a __WB_REVISION__ query param.
          const hasIndex = !!(await cache.match('/index.html', { ignoreSearch: true }));
          precacheDetails.push(`${name}: ${entries.length} entries, /index.html ${hasIndex ? 'OK' : 'MISS'}`);
        }
        for (const s of Array.from(document.scripts)) {
          if (!s.src) continue;
          let sameOrigin = false;
          try { sameOrigin = new URL(s.src, location.href).origin === location.origin; } catch { /* noop */ }
          if (!sameOrigin) continue;
          const match = await caches.match(s.src);
          scriptMatches.push(`${s.src}: ${match ? 'OK' : 'MISS'}`);
        }
      }

      setSwStatus({
        controller,
        registration,
        cacheKeys: cacheKeysList.length ? cacheKeysList.join(', ') : '(none)',
        precacheDetails: precacheDetails.length ? precacheDetails : ['no workbox-precache-* cache found'],
        scriptMatches,
        updateResult,
      });
    } finally {
      setSwLoading(false);
    }
  };

  useEffect(() => { void refreshSwStatus(); }, []);

  const displayMode = window.matchMedia('(display-mode: standalone)').matches
    ? 'standalone (PWA container)'
    : 'browser tab';

  // Repair for a stuck/absent registration — nukes everything SW-related then re-registers + reloads.
  const repairSw = async () => {
    if (!('serviceWorker' in navigator)) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm('This unregisters the service worker, clears all caches, and reloads. You must be ONLINE afterward for the app to re-download. Continue?')) return;
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await navigator.serviceWorker.register('/sw.js');
    } catch (e) {
      nostrLog('warn', `SW repair failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      window.location.reload();
    }
  };

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
      const { viewerDTag } = await import('../../lib/nostr/publish');
      const { getViewerPubkeyHex } = await import('../../lib/nostr/viewerSync');
      const pool = new SimplePool();
      if (s.viewerMode) {
        // VIEWER side: fetch + decrypt (via the in-memory holder — works for a wrapped Phase-3 viewer, no plaintext)
        if (!s.viewerWriterPubkey) {
          setVProbeStatus('viewer not provisioned (missing writerPubkey)'); pool.close(s.nostrRelays); setVProbing(false); return;
        }
        const myHex = getViewerPubkeyHex();   // M2 — this viewer's own d-tag
        if (!myHex) { setVProbeStatus('viewer key not unlocked — unlock first'); pool.close(s.nostrRelays); setVProbing(false); return; }
        const events = await pool.querySync(s.nostrRelays, { kinds: [30078], authors: [s.viewerWriterPubkey], '#d': [viewerDTag(myHex)] });
        pool.close(s.nostrRelays);
        if (!events.length) {
          setVProbeStatus(`NO viewer:v1 event on relays from ${s.viewerWriterPubkey.slice(0, 8)}… — owner hasn't published (did they change a setting AFTER adding your npub?) or wrong owner npub/relays`); setVProbing(false); return;
        }
        const latest = events.reduce((a, b) => (b.created_at > a.created_at ? b : a));
        try {
          // Prefer the in-memory holder (wrapped, now-unlocked key); fall back to plaintext only for a v17 migrant.
          const { viewerDecryptForProbe } = await import('../../lib/nostr/viewerSync');
          let json = await viewerDecryptForProbe(s.viewerWriterPubkey, latest.content);
          if (json === null && s.viewerSecretKey) {
            const { NSecSigner } = await import('@nostrify/nostrify');
            const { hexToBytes } = await import('nostr-tools/utils');
            json = await new NSecSigner(hexToBytes(s.viewerSecretKey).slice()).nip44.decrypt(s.viewerWriterPubkey, latest.content);
          }
          if (json === null) { setVProbeStatus('viewer key not unlocked — unlock first'); setVProbing(false); return; }
          const snap = JSON.parse(json);
          if (snap?.revoked) {
            setVProbeStatus(`REVOKED tombstone on relay — owner revoked this viewer (age ${Math.round(Date.now() / 1000 - latest.created_at)}s). The viewer should wipe on next fetch.`);
            setVProbing(false); return;
          }
          const entries = snap?.records?.entries?.length ?? 0;
          setVProbeStatus(`OK — decrypted ✓ · ${entries} log entries · settings:${!!snap?.settings} · strike:${!!snap?.strike} · age ${Math.round(Date.now() / 1000 - latest.created_at)}s`);
        } catch (e) {
          setVProbeStatus(`event found but DECRYPT FAILED — key/pubkey mismatch: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else {
        // OWNER side: confirm my published viewer:v2 exists (can't decrypt — sealed to the viewer)
        if (!s.nostrPubkey) { setVProbeStatus('not logged in'); pool.close(s.nostrRelays); setVProbing(false); return; }
        const ownerViewerPubkey = s.viewers[0]?.pubkeyHex;   // M2: slot 0's d-tag (roster UI is M3)
        if (!ownerViewerPubkey) { setVProbeStatus('no viewer configured'); pool.close(s.nostrRelays); setVProbing(false); return; }
        const events = await pool.querySync(s.nostrRelays, { kinds: [30078], authors: [s.nostrPubkey], '#d': [viewerDTag(ownerViewerPubkey)] });
        pool.close(s.nostrRelays);
        if (!events.length) { setVProbeStatus('NO viewer:v2 event published yet — change a setting/month to publish one (saving the npub alone does NOT publish)'); }
        else { const latest = events.reduce((a, b) => (b.created_at > a.created_at ? b : a)); setVProbeStatus(`published ✓ — ${events.length} event(s), latest ${Math.round(Date.now() / 1000 - latest.created_at)}s ago, sealed to ${ownerViewerPubkey.slice(0, 8)}…`); }
      }
    } catch (e) {
      setVProbeStatus(`probe error: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setVProbing(false); }
  };

  // Re-fetch now — run the REAL fetchViewerSnapshot so the tombstone-processing path executes (log shows
  // "viewer access revoked by owner", data wipes, viewerDataLoaded flips). The key revoke-persistence diagnostic.
  const runViewerRefetch = async () => {
    setVRefetching(true);
    try {
      const { fetchViewerSnapshot } = await import('../../lib/nostr/viewerSync');
      await fetchViewerSnapshot();
    } catch (e) {
      nostrLog('warn', `viewer re-fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setVRefetching(false); }
  };

  const copyDiagnostics = async () => {
    const diag = {
      build:   __BUILD_SHA__,
      builtAt: __BUILD_TIME__,
      now:     new Date().toISOString(),
      state:   { ...syncState },   // amounts stay out (paste-safe)
      lastPublish: getPublishReports().at(-1) ?? null,               // per-relay ack metadata (no amounts)
      log:     getNostrLog(),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { setProbeStatus('clipboard unavailable'); }
  };

  // AT-REST ENCRYPTION readout (3a.5) — live localStorage + holder reads, computed on render. The flag is a
  // module-load constant (storeEncEnabled), so a mid-session toggle only applies after a reload.
  const ENC_FLAG = 'personal-bloc-store-enc-enabled';
  const flagOn = (() => { try { return localStorage.getItem(ENC_FLAG) === '1'; } catch { return false; } })();
  const blobState = (() => {
    try {
      const raw = localStorage.getItem('personal-bloc-store');
      if (raw == null) return 'none';
      return blobIsPlaintext() ? 'plaintext' : 'encrypted {ct,iv}';
    } catch { return 'none'; }
  })();
  const keyInMemory = isStoreUnlocked();
  const gateKeysSummary = (() => {
    const g = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
    return `onboarded:${g('personal-bloc-onboarded') === '1'} auth:${g('personal-bloc-nostr-auth') === '1'} `
         + `method:${g('personal-bloc-nostr-method') ?? '—'} pubkey:${!!g('personal-bloc-nostr-pubkey')}`;
  })();
  const toggleFlag = async () => {
    if (flagOn) {
      // DISABLE (encrypted → plaintext): decrypt FIRST so we land on clean plaintext (no {ct,iv} blob the plain
      // adapter can't read → no seed-flash/half-state). Mirrors the user opt-out's safe order. Needs the key in
      // memory (post-unlock); a locked state or failed decrypt leaves the flag ON (nothing lost).
      if (!isStoreUnlocked()) {
        // eslint-disable-next-line no-alert
        alert('Unlock first (the store key must be in memory to decrypt). Leaving encryption on.');
        return;
      }
      const ok = await migrateEncryptedToPlaintext();
      if (!ok) {
        // eslint-disable-next-line no-alert
        alert('Could not decrypt — leaving encryption ON, your data is unchanged.');
        return;
      }
      try { localStorage.removeItem(ENC_FLAG); } catch { /* noop */ }
    } else {
      // ENABLE (plaintext → encrypted): RAW — migration happens at unlock (3a.3), not here.
      try { localStorage.setItem(ENC_FLAG, '1'); } catch { /* noop */ }
    }
    window.location.reload();   // flag is a module-load constant — reload to swap the persist adapter
  };

  return (
    <div className={styles.panel}>
      <Section title="SYNC STATE" defaultOpen>
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
          <span className={styles.key}>btc price</span>
          <span className={styles.val}>
            {btcPrice ? `$${Math.round(btcPrice).toLocaleString()}` : '—'} · {fmtPriceAge(btcPriceUpdatedAt, now)}
          </span>
        </div>
      </Section>

      <Section
        title="PUBLISH ACKS"
        action={<button className={styles.btnGhost} onClick={() => setPublishReports([...getPublishReports()])}>Refresh</button>}
      >
        <div className={styles.logList}>
          {publishReports.length === 0 && <div className={styles.logEmpty}>no publishes yet</div>}
          {[...publishReports].reverse().map((r, i) => (
            <div key={`${r.label}-${r.createdAt}-${i}`} className={styles.grid}>
              <span className={styles.key}>{r.label}</span>
              <span
                className={styles.val}
                style={{ color: r.outcome === 'ok' ? 'var(--green)' : 'var(--red)' }}
              >
                {r.outcome} · {Math.max(0, Math.round(now / 1000 - r.createdAt))}s ago
              </span>
              {r.perRelay.map((p) => (
                <span key={p.url} className={styles.val} style={{ gridColumn: '1 / -1' }}>
                  {p.url} · {p.status}{p.ms != null ? ` · ${p.ms}ms` : ''}{p.err ? ` · ${p.err}` : ''}
                </span>
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="SERVICE WORKER"
        action={<button className={styles.btnGhost} onClick={refreshSwStatus} disabled={swLoading}>Refresh</button>}
      >
        <div className={styles.grid}>
          <span className={styles.key}>display mode</span><span className={styles.val}>{displayMode}</span>
          <span className={styles.key}>controller</span><span className={styles.val}>{swStatus?.controller ?? '…'}</span>
          <span className={styles.key}>registration</span>
          <span className={styles.val}>
            {swStatus ? swStatus.registration.map((l, i) => <div key={i}>{l}</div>) : '…'}
          </span>
          <span className={styles.key}>update()</span><span className={styles.val}>{swStatus?.updateResult ?? '…'}</span>
          <span className={styles.key}>caches.keys()</span><span className={styles.val}>{swStatus?.cacheKeys ?? '…'}</span>
          <span className={styles.key}>precache detail</span>
          <span className={styles.val}>
            {swStatus ? swStatus.precacheDetails.map((l, i) => <div key={i}>{l}</div>) : '…'}
          </span>
          <span className={styles.key}>script cache match</span>
          <span className={styles.val}>
            {swStatus ? swStatus.scriptMatches.map((l, i) => <div key={i}>{l}</div>) : '…'}
          </span>
        </div>
        <button className={styles.btn} style={{ borderColor: 'var(--red)', color: 'var(--red)' }} onClick={repairSw}>
          Re-register SW + reload
        </button>
      </Section>

      <Section title="COLLATERAL">
        <div className={styles.grid}>
          <span className={styles.key}>baseline</span><span className={styles.val}>{baselineBtc.toFixed(5)} ₿</span>
          <span className={styles.key}>current (reading-anchored)</span><span className={styles.val}>{currentBtcHeld.toFixed(5)} ₿</span>
        </div>
      </Section>

      <Section title="VIEWER ACCESS">
        <div className={styles.grid}>
          <span className={styles.key}>role</span><span className={styles.val}>{viewerMode ? 'viewer' : 'owner/writer'}</span>
          <span className={styles.key}>publishes to (viewerPubkey)</span><span className={styles.val}>{viewerPubkey ? `${viewerPubkey.slice(0, 8)}…${viewerPubkey.slice(-8)}` : '— (no viewer set)'}</span>
          <span className={styles.key}>reads from (writerPubkey)</span><span className={styles.val}>{viewerWriterPubkey ? `${viewerWriterPubkey.slice(0, 8)}…${viewerWriterPubkey.slice(-8)}` : '—'}</span>
          <span className={styles.key}>plaintext key present</span><span className={styles.val}>{String(!!viewerSecretKey)}</span>
          <span className={styles.key}>key wrapped</span><span className={styles.val}>{String(!!viewerKeyWrapped)}</span>
          <span className={styles.key}>unlocked</span><span className={styles.val}>{String(viewerUnlocked)}</span>
          <span className={styles.key}>data loaded</span><span className={styles.val}>{String(viewerDataLoaded)}</span>
          <span className={styles.key}>my pubkey</span><span className={styles.val}>{nostrPubkey ? `${nostrPubkey.slice(0, 8)}…${nostrPubkey.slice(-8)}` : '—'}</span>
        </div>
        <div className={styles.probeRow}>
          <button className={styles.btn} onClick={runViewerProbe} disabled={vProbing}>Test viewer link</button>
          {viewerMode && <button className={styles.btn} onClick={runViewerRefetch} disabled={vRefetching}>Re-fetch now</button>}
          <span className={styles.probeStatus}>{vProbeStatus}</span>
        </div>
      </Section>

      <Section title="AT-REST ENCRYPTION">
        <div className={styles.grid}>
          <span className={styles.key}>flag (storeEncEnabled)</span>
          <span className={styles.val}>{flagOn ? 'ON' : 'off'}{flagOn !== storeEncEnabled ? ' (reload to apply)' : ''}</span>
          <span className={styles.key}>blob state</span><span className={styles.val}>{blobState}</span>
          <span className={styles.key}>store key in memory</span><span className={styles.val}>{String(keyInMemory)}</span>
          <span className={styles.key}>GATE_* keys</span><span className={styles.val}>{gateKeysSummary}</span>
        </div>
        <button className={styles.btn} onClick={toggleFlag}>
          {flagOn ? 'Disable' : 'Enable'} at-rest encryption flag (reloads)
        </button>
      </Section>

      <Section title="SIGNER PROBE">
        <div className={styles.probeRow}>
          <button className={styles.btn} onClick={runProbe} disabled={probing}>Test signer</button>
          <span className={styles.probeStatus}>{probeStatus}</span>
        </div>
      </Section>

      <Section title="HAPTICS PROBE">
        <HapticsProbe />
      </Section>

      <Section title="LOG" action={<button className={styles.btnGhost} onClick={clearNostrLog}>Clear</button>}>
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
      </Section>

      <button className={styles.btn} onClick={copyDiagnostics}>
        {copied ? 'Copied ✓' : 'Copy diagnostics'}
      </button>
    </div>
  );
}
