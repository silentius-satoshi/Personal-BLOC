// Viewer-side read-only sync (Phase 2). The MIRROR of liveSync.ts, but it reads the OWNER's snapshot
// (authors:[viewerWriterPubkey], #d:[VIEWER_DTAG]) and decrypts it with the VIEWER's own key.
//
// READ-ONLY by construction: this module ONLY hydrates the store from the owner's viewer:v1 snapshot. It NEVER
// publishes, NEVER sets dirty flags. The writer publish/sync path (useNostrSync/syncNow/openLiveSync) is gated
// OFF in viewerMode (see useNostrSync), so nothing here can leak a write back to any relay.
//
// Phase 3: the at-rest viewer key is now keyVault-WRAPPED (viewerKeyWrapped). The unwrapped bytes live ONLY
// in this module's in-memory holder (unwrappedViewerKey) — never in serializable store state. The
// ViewerUnlockGate (unlock) and OnboardingModal (provision) populate it via setUnwrappedViewerKey. A v17
// migrant that still has a plaintext store viewerSecretKey is back-filled lazily so it keeps working.

import { SimplePool } from 'nostr-tools/pool';
import { hexToBytes } from 'nostr-tools/utils';
import { getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { NSecSigner } from '@nostrify/nostrify';
import { useStore } from '../../store/useStore';
import { VIEWER_DTAG, type ViewerSnapshot } from './publish';
import { recomputeBtcHeld } from '../../simulation/logUtils';
import type { MonthlyLogEntry } from '../../simulation/types';
import { signerOpTimeout } from './timeout';
import { withTimeout } from './timeout';
import { nostrLog } from './log';
import type { RemoteEvent } from './sync';

// The unwrapped viewer key (in-memory only) + a signer built lazily from it.
let unwrappedViewerKey: Uint8Array | null = null;
let cachedSigner: NSecSigner | null = null;

/** Set (or clear) the in-memory viewer key. Rebuilds/clears the cached signer and mirrors viewerUnlocked
 *  so React (AppShell) can reactively gate on "holder populated". */
export function setUnwrappedViewerKey(sk: Uint8Array | null): void {
  unwrappedViewerKey = sk ? sk.slice() : null;   // own copy — caller may zero/reuse its buffer
  cachedSigner = null;
  useStore.getState().setViewerUnlocked(!!sk);
}

/**
 * Viewer V4 — the SINGLE, COMPLETE viewer sign-out/reset teardown. Clears everything the connect created:
 * hydrated data (clearViewerData), the wrapped key pair + any plaintext migrant, the display name (a
 * signed-out device retains no name), the in-memory key holder + cached signer (setUnwrappedViewerKey(null)
 * — the key-clear is explicit here), viewerMode + writer pubkey, then re-arms onboarding so the device
 * becomes UNDECIDED → the fork renders (the clean exit door; never the empty owner shell). Shared by the
 * Settings "Sign out" AND the gate escapes (ViewerUnlockGate/ViewerWaitingGate via AppShell's resetViewer).
 * Lossless: the owner's snapshot stays on the relay.
 */
export function resetViewerSession(): void {
  const st = useStore.getState();
  st.clearViewerData();              // wipe the hydrated financial residue BEFORE leaving viewerMode (data-remanence fix)
  st.setViewerKeyWrapped(null);
  st.setViewerKeyWrapMeta(null);
  st.setViewerSecretKey(null);
  st.setViewerDisplayName(null);     // V3 name — sign-out retains no name (privacy + clean re-onboard)
  setUnwrappedViewerKey(null);       // in-memory holder + cached signer cleared, viewerUnlocked → false
  st.setViewerMode(false);
  st.setViewerWriterPubkey(null);
  st.setOnboardingComplete(false);   // undecided device → the fork renders
}

/** The viewer's OWN npub, derived from the in-memory holder (never exposes raw bytes). null pre-unlock.
 *  Lets a pending/revoked viewer copy their npub to (re-)send the owner — the key isn't in the store. */
export function getViewerNpub(): string | null {
  if (!unwrappedViewerKey) return null;
  try { return nip19.npubEncode(getPublicKey(unwrappedViewerKey.slice())); } catch { return null; }
}

function getViewerSigner(): NSecSigner | null {
  if (!unwrappedViewerKey) return null;
  if (cachedSigner) return cachedSigner;
  // .slice() — NSecSigner holds a REFERENCE to the bytes; hand it its own copy (the writer-signer bug).
  cachedSigner = new NSecSigner(unwrappedViewerKey.slice());
  return cachedSigner;
}

/** DevPanel probe helper — decrypt an owner snapshot with the in-memory holder (works for a wrapped Phase-3
 *  viewer; never exposes raw bytes). Returns null when the holder is empty (key not unlocked). */
export async function viewerDecryptForProbe(writerPubkey: string, content: string): Promise<string | null> {
  const signer = getViewerSigner();
  if (!signer || !signer.nip44) return null;
  return signer.nip44.decrypt(writerPubkey, content);
}

// v17 back-compat: if the holder is empty but a plaintext store key survives (pre-wrap migrant), populate
// the holder from it so syncing keeps working until the one-time wrap clears the plaintext.
function backfillFromPlaintext(viewerSecretKey: string | null): void {
  if (!unwrappedViewerKey && viewerSecretKey) setUnwrappedViewerKey(hexToBytes(viewerSecretKey).slice());
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
  backfillFromPlaintext(viewerSecretKey);
  if (!viewerMode || !viewerWriterPubkey || !unwrappedViewerKey) return;
  const signer = getViewerSigner();
  if (!signer || !signer.nip44) return;
  let plaintext: string;
  try {
    plaintext = await withTimeout(
      signer.nip44.decrypt(viewerWriterPubkey, event.content),
      signerOpTimeout(nostrSigningMethod),
      'viewer nip44 decrypt',
    );
  } catch (e) {
    // Invalid MAC / wrong key (revoked or wrong owner) — WIPE any stale hydrated data so a key that can't decrypt
    // the snapshot never leaves the previous viewer's numbers on screen. (Past the viewerMode guard → viewer-only.)
    nostrLog('warn', 'viewer decrypt failed', e);
    s.clearViewerData();
    return;
  }
  try {
    const snap = JSON.parse(plaintext) as ViewerSnapshot;
    if (snap.revoked) {
      // Owner revoked this viewer — wipe hydrated data (viewerDataLoaded → false → ViewerWaitingGate). No hydrate.
      nostrLog('info', 'viewer access revoked by owner');
      s.clearViewerData();
      return;
    }
    // Viewer V2 — C-SAFE mode: store only the ratio/config/at-snapshot-price block (ViewerHomeView scales it to
    // the live price). Do NOT hydrateSettings/records/strike — none exist in a safe payload (no absolutes).
    if (snap.privacyMode === 'safe') {
      s.setViewerSafeSnapshot({
        safety:             snap.safety!,
        thresholds:         snap.thresholds!,
        btcPriceAtSnapshot: snap.btcPriceAtSnapshot!,
        hasCbLoan:          snap.hasCbLoan ?? false,
      });
      s.setViewerDataLoaded(true);
      s.setViewerLastSyncAt(Date.now());
      nostrLog('info', 'viewer safe snapshot hydrated');
      return;
    }
    // C-TRUSTED (or a pre-V2 snapshot with no privacyMode) — the full hydrate. Clear any prior safe snapshot first
    // so a trusted→ nothing-stale mix can't linger (ViewerHomeView reads viewerSafeSnapshot to pick its mode).
    s.setViewerSafeSnapshot(null);
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
    // P3/C-P4 (BUG2 + BUG3) — receive the owner's derived collateral scalars (CB + reading-anchored Strike). RAW
    // set, NEVER the emitting setters (setCbCollateralBtc emits a cbCollateralReading; emitBalanceReading emits a
    // balanceReading) → either would inject a spurious event into the VIEWER's own dayLog. The viewer's dayLog stays
    // []. Fallbacks keep the current values for a legacy/pre-P3 (cb) or pre-C-P4 (strike) owner snapshot.
    useStore.setState({
      cbCollateralBtc:     snap.cbCollateralBtc     ?? useStore.getState().cbCollateralBtc,
      strikeCollateralBtc: snap.strikeCollateralBtc ?? useStore.getState().strikeCollateralBtc,
    });
    s.setViewerDataLoaded(true);   // a VALID decrypt populated the store — the viewer render may now show
    s.setViewerLastSyncAt(Date.now());   // freshness clock for the viewer home pill (Viewer Revamp V1)
    nostrLog('info', 'viewer snapshot hydrated');
  } catch { nostrLog('warn', 'viewer payload parse failed (skipped)'); }
}

// Batch pull — latest snapshot by created_at. Called on foreground.
export async function fetchViewerSnapshot(): Promise<void> {
  const { viewerMode, viewerWriterPubkey, viewerSecretKey, nostrRelays } = useStore.getState();
  backfillFromPlaintext(viewerSecretKey);
  if (!viewerMode || !viewerWriterPubkey || !unwrappedViewerKey) return;
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(nostrRelays, filter(viewerWriterPubkey));
    pool.close(nostrRelays);
    // Nothing shared (wrong writerPubkey / revoked) — no authorized data to show, so wipe stale residue.
    if (!events.length) { useStore.getState().clearViewerData(); return; }
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
  backfillFromPlaintext(viewerSecretKey);
  if (!viewerMode || !viewerWriterPubkey || !unwrappedViewerKey || !nostrRelays.length) return;
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
