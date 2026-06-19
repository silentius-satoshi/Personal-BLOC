// Viewer-side read-only sync (Phase 2). The MIRROR of liveSync.ts, but it reads the OWNER's snapshot
// (authors:[viewerWriterPubkey], #d:[VIEWER_DTAG]) and decrypts it with the VIEWER's own key.
//
// READ-ONLY by construction: this module ONLY hydrates the store from the owner's viewer:v1 snapshot. It NEVER
// publishes, NEVER sets dirty flags. The writer publish/sync path (useNostrSync/syncNow/openLiveSync) is gated
// OFF in viewerMode (see useNostrSync), so nothing here can leak a write back to any relay.
//
// ⚠ Phase 2 holds viewerSecretKey as PLAINTEXT hex in the store — Phase 3 will passkey/keyVault-wrap it.

import { SimplePool } from 'nostr-tools/pool';
import { hexToBytes } from 'nostr-tools/utils';
import { NSecSigner } from '@nostrify/nostrify';
import { useStore } from '../../store/useStore';
import { VIEWER_DTAG, type ViewerSnapshot } from './publish';
import { recomputeBtcHeld } from '../../simulation/logUtils';
import type { MonthlyLogEntry } from '../../simulation/types';
import { signerOpTimeout } from './timeout';
import { withTimeout } from './timeout';
import { nostrLog } from './log';
import type { RemoteEvent } from './sync';

// Signer is built once from the viewer secret key and cached (rebuilt only if the key changes).
let cachedSigner: NSecSigner | null = null;
let cachedKey: string | null = null;
function getViewerSigner(secretKeyHex: string): NSecSigner {
  if (cachedSigner && cachedKey === secretKeyHex) return cachedSigner;
  // .slice() — NSecSigner holds a REFERENCE to the bytes; hand it its own copy (the writer-signer bug).
  cachedSigner = new NSecSigner(hexToBytes(secretKeyHex).slice());
  cachedKey = secretKeyHex;
  return cachedSigner;
}

const filter = (writerPubkey: string) => ({
  kinds:   [30078],
  authors: [writerPubkey],
  '#d':    [VIEWER_DTAG],
});

// Decrypt the owner's snapshot with the viewer key and hydrate the store READ-ONLY. Shared by the batch
// fetch and the live sub.
async function applyViewerEvent(event: RemoteEvent): Promise<void> {
  const s = useStore.getState();
  const { viewerMode, viewerWriterPubkey, viewerSecretKey, nostrSigningMethod } = s;
  if (!viewerMode || !viewerWriterPubkey || !viewerSecretKey) return;
  const signer = getViewerSigner(viewerSecretKey);
  if (!signer.nip44) return;
  let plaintext: string;
  try {
    plaintext = await withTimeout(
      signer.nip44.decrypt(viewerWriterPubkey, event.content),
      signerOpTimeout(nostrSigningMethod),
      'viewer nip44 decrypt',
    );
  } catch (e) { nostrLog('warn', 'viewer decrypt failed', e); return; }
  try {
    const snap = JSON.parse(plaintext) as ViewerSnapshot;
    const settings = snap.settings ?? {};
    s.hydrateSettings(settings);
    const baseBtc = typeof settings.advisorActualBtcHeld === 'number' ? settings.advisorActualBtcHeld : 0;
    s.setMonthlyLog(recomputeBtcHeld((snap.records?.entries ?? []) as MonthlyLogEntry[], baseBtc));
    s.setDeletedMonths(snap.records?.deletions ?? {});
    if (snap.strike) {
      s.setStrikeUsdBalance(snap.strike.usd);
      s.setStrikeBtcAvailable(snap.strike.btcAvail);
      s.setStrikeRate(snap.strike.rate);
    }
    nostrLog('info', 'viewer snapshot hydrated');
  } catch { nostrLog('warn', 'viewer payload parse failed (skipped)'); }
}

// Batch pull — latest snapshot by created_at. Called on foreground.
export async function fetchViewerSnapshot(): Promise<void> {
  const { viewerMode, viewerWriterPubkey, viewerSecretKey, nostrRelays } = useStore.getState();
  if (!viewerMode || !viewerWriterPubkey || !viewerSecretKey) return;
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(nostrRelays, filter(viewerWriterPubkey));
    pool.close(nostrRelays);
    if (!events.length) return;
    const latest = events.reduce((a, b) => (b.created_at > a.created_at ? b : a));
    await applyViewerEvent(latest);
  } catch (e) { nostrLog('warn', 'viewer fetch failed', e); try { pool.close(nostrRelays); } catch { /* noop */ } }
}

// Live sub — module singleton, mirrors openLiveSync (disposable; opened on visible, torn down on hidden).
let sub: ReturnType<SimplePool['subscribeMany']> | null = null;
let pool: SimplePool | null = null;
let subRelays: string[] = [];

export function openViewerSync(): void {
  if (sub) return;   // singleton, idempotent
  const { viewerMode, viewerWriterPubkey, viewerSecretKey, nostrRelays } = useStore.getState();
  if (!viewerMode || !viewerWriterPubkey || !viewerSecretKey || !nostrRelays.length) return;
  pool = new SimplePool();
  subRelays = nostrRelays;
  sub = pool.subscribeMany(
    nostrRelays,
    { ...filter(viewerWriterPubkey), since: Math.floor(Date.now() / 1000) - 60 },
    { onevent: (event) => { void applyViewerEvent(event); } },
  );
  nostrLog('info', `viewer sub open (${nostrRelays.length} relays)`);
}

export function closeViewerSync(): void {
  if (!sub) { pool?.close(subRelays); pool = null; subRelays = []; return; }
  sub.close();
  pool?.close(subRelays);
  sub = null; pool = null; subRelays = [];
  nostrLog('info', 'viewer sub closed');
}
