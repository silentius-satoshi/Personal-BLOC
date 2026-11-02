// Viewer-side read-only sync (Phase 2). The MIRROR of liveSync.ts, but it reads the OWNER's snapshot
// (authors:[viewerWriterPubkey], #d:[viewerDTag(myPubkey)] — M2 per-viewer addressing) and decrypts it with
// the VIEWER's own key.
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
import { viewerDTag, type ViewerSnapshot } from './publish';
import type { MonthlyLogEntry } from '../../simulation/types';
import { coldMovesFromSnapshot } from '../ledgerCsv';
import { signerOpTimeout } from './timeout';
import { withTimeout } from './timeout';
import { nostrLog } from './log';
import type { RemoteEvent } from './sync';

// The unwrapped viewer key (in-memory only) + a signer built lazily from it.
let unwrappedViewerKey: Uint8Array | null = null;
let cachedSigner: NSecSigner | null = null;
let cachedSignerKey: Uint8Array | null = null;
let lastAppliedViewerEventAt = 0;

/** Set (or clear) the in-memory viewer key. Rebuilds/clears the cached signer and mirrors viewerUnlocked
 *  so React (AppShell) can reactively gate on "holder populated". */
export function setUnwrappedViewerKey(sk: Uint8Array | null): void {
  unwrappedViewerKey?.fill(0);
  cachedSignerKey?.fill(0);
  unwrappedViewerKey = sk ? sk.slice() : null;   // own copy — caller may zero/reuse its buffer
  cachedSigner = null;
  cachedSignerKey = null;
  lastAppliedViewerEventAt = 0;
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

/** The viewer's OWN hex pubkey (M2 — the viewer's snapshot is addressed to viewerDTag(thisPubkey)). null
 *  pre-unlock. Used to build the subscription/fetch #d filter from the in-memory holder. */
export function getViewerPubkeyHex(): string | null {
  if (!unwrappedViewerKey) return null;
  try { return getPublicKey(unwrappedViewerKey.slice()); } catch { return null; }
}

function getViewerSigner(): NSecSigner | null {
  if (!unwrappedViewerKey) return null;
  if (cachedSigner) return cachedSigner;
  // .slice() — NSecSigner holds a REFERENCE to the bytes; hand it its own copy (the writer-signer bug).
  cachedSignerKey = unwrappedViewerKey.slice();
  cachedSigner = new NSecSigner(cachedSignerKey);
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

const filter = (writerPubkey: string, viewerPubkeyHex: string) => ({
  kinds:   [30078],
  authors: [writerPubkey],
  '#d':    [viewerDTag(viewerPubkeyHex)],   // M2 — this viewer's own d-tag
});

// Decrypt the owner's snapshot with the viewer key and hydrate the store READ-ONLY. Shared by the batch
// fetch and the live sub.
async function applyViewerEvent(event: RemoteEvent): Promise<void> {
  const s = useStore.getState();
  const { viewerMode, viewerWriterPubkey, viewerSecretKey, nostrSigningMethod } = s;
  backfillFromPlaintext(viewerSecretKey);
  if (!viewerMode || !viewerWriterPubkey || !unwrappedViewerKey) return;
  if (event.created_at <= lastAppliedViewerEventAt) return;
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
    if (event.created_at <= lastAppliedViewerEventAt) return;
    s.clearViewerData();
    return;
  }
  try {
    const snap = JSON.parse(plaintext) as ViewerSnapshot;
    // Decryption is asynchronous. A newer event may have hydrated while this one was in flight;
    // never let the older result regress the viewer or clear the newer snapshot on an error.
    if (event.created_at <= lastAppliedViewerEventAt) return;
    applyViewerSnapshot(snap);
    lastAppliedViewerEventAt = event.created_at;
  } catch { nostrLog('warn', 'viewer payload parse failed (skipped)'); }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * BL48 (the independent check) — what a TRUSTED snapshot must carry before any of it applies: the plan itself. `settings`
 * an object with the plan's four figures (income, expenses, the line and its rate) numbers, its start date a string and
 * `hasCbLoan` a boolean; `records` an object with `entries` a list; `privacyMode` 'trusted' (or none — a pre-V2 owner's).
 * Every owner build since the per-viewer addresses (M2) has sent them. Without the plan the device would load, without its
 * safe block, on the seed's figures — the tier reads that as trusted. What an older owner's snapshot may lack still falls
 * back as before (the apply's `??`: the deletions, the Strike block, the collateral and cold figures, the deposit date), but
 * what's there must be what the apply takes — a map of numbers, three balances each a number or null, numbers, a string.
 * Not checked: `snapshotVersion` (a newer owner's additions are ignored, as before), the other settings (they apply as
 * sent, as before), each month's own fields (the owner's own Ledger reads the same months) and the cold moves
 * (`coldMovesFromSnapshot` checks them on the way in).
 */
function trustedSnapshotOk(snap: ViewerSnapshot): boolean {
  const o: Record<string, unknown> = { ...snap };   // decrypted JSON: unknown until checked, whatever its declared type
  if (o.privacyMode !== undefined && o.privacyMode !== 'trusted') return false;
  const { settings, records, strike } = o;
  if (!isObject(settings) || !['income', 'expenses', 'creditLine', 'blocApr'].every((k) => isNum(settings[k]))) return false;
  if (typeof settings.advisorStartDate !== 'string' || typeof settings.hasCbLoan !== 'boolean') return false;
  if (!isObject(records) || !Array.isArray(records.entries)) return false;
  const { deletions } = records;
  if (deletions != null && !(isObject(deletions) && Object.values(deletions).every(isNum))) return false;
  if (strike != null && !(isObject(strike) && [strike.usd, strike.btcAvail, strike.rate].every((v) => v === null || isNum(v)))) return false;
  if (![o.cbCollateralBtc, o.strikeCollateralBtc, o.coldStorageBtc].every((v) => v == null || isNum(v))) return false;
  return o.strikeLastDepositISO == null || typeof o.strikeLastDepositISO === 'string';
}

/**
 * Apply one DECRYPTED owner snapshot to this viewer's store — the relay path's one apply (applyViewerEvent calls it
 * after the decrypt and the ordering check). Exported for the e2e (BL48): the dev server skips the viewer gates
 * (e2e/helpers.ts), so a viewer page there is handed the REAL payload an owner page builds, through this same apply.
 * A no-op off viewerMode — an owner device never takes a viewer snapshot over its own plan.
 */
export function applyViewerSnapshot(snap: ViewerSnapshot): void {
  const s = useStore.getState();
  if (!s.viewerMode) return;
  // BL48 (the independent check) — FAIL CLOSED before anything applies: a payload that isn't an object (JSON's null, 42 or
  // []) is no tombstone and no mode. It wipes, as a trusted snapshot that isn't well-formed does below. (`as unknown`: the
  // decrypted JSON may be anything — the declared type is what a well-formed one is.)
  if (!isObject(snap as unknown)) {
    s.clearViewerData();
    throw new Error('viewer snapshot is not an object');
  }
  if (snap.revoked) {
    // Owner revoked this viewer — wipe hydrated data (viewerDataLoaded → false → ViewerWaitingGate). No hydrate.
    nostrLog('info', 'viewer access revoked by owner');
    s.clearViewerData();
    return;
  }
  // Viewer V2 — C-SAFE mode: store only the ratio/config/at-snapshot-price block (ViewerHomeView scales it to
  // the live price). Do NOT applyViewerSettings/records/strike — none exist in a safe payload (no absolutes).
  // BL48 (V6 A) — WIPE FIRST: a viewer demoted from trusted kept every trusted figure the last trusted snapshot
  // wrote (the downgrade item — and, while the Almanac was open, it went on showing them). clearViewerData resets
  // them to the seed before the safe block lands — it also clears the safe block, so the order is load-bearing.
  if (snap.privacyMode === 'safe') {
    s.clearViewerData();
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
  // BL48 — FAIL CLOSED: a trusted snapshot that can't apply leaves nothing — never a loaded device with its safe block
  // cleared, which the tier reads as trusted (Layout/viewerAccess.ts): the Almanac opened for a safe viewer on the seed's
  // figures. Twice: one that isn't well-formed (trustedSnapshotOk) wipes before any of it applies — the independent check's
  // `settings: null` threw nothing and got through; and whatever still throws part-way wipes in the catch. Either throw
  // goes on to the event's catch, which skips the event.
  if (!trustedSnapshotOk(snap)) {
    s.clearViewerData();
    throw new Error('trusted viewer snapshot is not well-formed');
  }
  try {
    s.setViewerSafeSnapshot(null);
    const settings = snap.settings ?? {};
    s.applyViewerSettings(settings);
    // Verbatim: the owner's rolled-up entries already carry the RECORDED btcHeld, and the viewer has no dayLog to derive
    // from. Recomputing here would overwrite recorded values with a chain off a deprecated baseline.
    s.setMonthlyLog((snap.records?.entries ?? []) as MonthlyLogEntry[]);
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
    // + cold: the owner's LIVE cold total arrives pre-derived (the viewer has no journal). It overrides the anchor that
    // applyViewerSettings just wrote; coldStorageBtcAsOf stays null (stripped), so getCurrentColdBtc returns exactly this.
    useStore.setState({
      cbCollateralBtc:     snap.cbCollateralBtc     ?? useStore.getState().cbCollateralBtc,
      strikeCollateralBtc: snap.strikeCollateralBtc ?? useStore.getState().strikeCollateralBtc,
      coldStorageBtc:      snap.coldStorageBtc      ?? useStore.getState().coldStorageBtc,
      // Run 2 (D9) — the owner's latest Strike deposit date (the hold's one fact). A pre-Run-2 owner snapshot has none.
      viewerStrikeDepositISO: snap.strikeLastDepositISO ?? null,
      // BL48 (V2 A) — the owner's month-by-month cold moves (the Ledger's "→ Cold"), checked on the way in; an older
      // owner's snapshot has none → null → no column, as before.
      viewerColdMovedByMonth: coldMovesFromSnapshot(snap.coldMovedByMonth),
    });
  } catch (e) {
    s.clearViewerData();
    throw e;
  }
  s.setViewerDataLoaded(true);   // a VALID decrypt populated the store — the viewer render may now show
  s.setViewerLastSyncAt(Date.now());   // freshness clock for the viewer home pill (Viewer Revamp V1)
  nostrLog('info', 'viewer snapshot hydrated');
}

// Batch pull — latest snapshot by created_at. Called on foreground.
export async function fetchViewerSnapshot(): Promise<void> {
  const { viewerMode, viewerWriterPubkey, viewerSecretKey, nostrRelays } = useStore.getState();
  backfillFromPlaintext(viewerSecretKey);
  if (!viewerMode || !viewerWriterPubkey || !unwrappedViewerKey) return;
  const myHex = getViewerPubkeyHex();   // holder is non-null past the guard above
  if (!myHex) return;
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(nostrRelays, filter(viewerWriterPubkey, myHex));
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
  const myHex = getViewerPubkeyHex();   // holder is non-null past the guard above
  if (!myHex) return;
  pool = new SimplePool();
  subRelays = nostrRelays;
  sub = pool.subscribeMany(
    nostrRelays,
    { ...filter(viewerWriterPubkey, myHex), since: Math.floor(Date.now() / 1000) - 60 },
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
