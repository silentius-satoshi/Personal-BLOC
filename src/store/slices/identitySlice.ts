// identitySlice (Phase 1c) — persisted nostr identity credentials + backup-gate fields + their setters (GATE_*/WK_*
// write-throughs). getState()→get(); the setBackupVerifiedAt dynamic import path deepened one level.
import type { StoreState, StoreSet, StoreGet } from '../types';
import { DEFAULT_RELAYS } from '../../lib/nostr/relays';
import { nostrLog } from '../../lib/nostr/log';
import {
  GATE_AUTH_KEY, GATE_PUBKEY_KEY, GATE_METHOD_KEY, GATE_PROVENANCE_KEY, WK_WRAPPED_KEY, WK_META_KEY,
  seedNostrAuthEnabled, seedNostrPubkey, seedNostrSigningMethod, seedKeyProvenance, seedWriterKeyWrapped, seedWriterKeyWrapMeta,
} from '../bootstrap';

type IdentitySlice = Pick<StoreState,
  | 'nostrAuthEnabled' | 'nostrPubkey' | 'nostrSigningMethod' | 'nostrBunkerUri' | 'nostrRelays' | 'nostrLogin'
  | 'writerKeyWrapped' | 'writerKeyWrapMeta' | 'keyProvenance' | 'backupVerifiedAt' | 'setNostrAuthEnabled'
  | 'setNostrPubkey' | 'setNostrSigningMethod' | 'setNostrBunkerUri' | 'setNostrRelays' | 'setNostrRelaysAndSync'
  | 'setNostrLogin' | 'setWriterKeyWrapped' | 'setWriterKeyWrapMeta' | 'setKeyProvenance' | 'setBackupVerifiedAt'
>;

export const createIdentitySlice = (set: StoreSet, get: StoreGet): IdentitySlice => ({
  nostrAuthEnabled:   seedNostrAuthEnabled,      // 3a.4: standalone-seeded (false/null on fresh install = today's default)
  nostrPubkey:        seedNostrPubkey,
  nostrSigningMethod: seedNostrSigningMethod,
  nostrBunkerUri:     null,
  nostrRelays:        [...DEFAULT_RELAYS],
  nostrLogin:         null,
  writerKeyWrapped:   seedWriterKeyWrapped,
  writerKeyWrapMeta:  seedWriterKeyWrapMeta,
  // Backup gate (R2a-1). Null on a fresh install AND — via the custom persist `merge`, which fills absent keys
  // from `current` — for every plan established before R2. That is the STRUCTURAL grandfathering: a legacy owner
  // has keyProvenance null → isBackupGateSatisfied() → true → never gated. Deliberately NO migration.
  // R2c-6-final: standalone-seeded from GATE_PROVENANCE_KEY (survives the escape hatch — bypass 1); the `merge`
  // still overrides authoritatively on rehydrate.
  keyProvenance:      seedKeyProvenance,
  backupVerifiedAt:   null,
  // 3a.4: write through to the standalone GATE_* keys (outside the encrypted blob) — every mutation of these gate
  // fields keeps the cold-start bootstrap copy in sync; logout/disconnect call these with false/null → removeItem.
  setNostrAuthEnabled:   (v) => { try { v ? localStorage.setItem(GATE_AUTH_KEY, '1') : localStorage.removeItem(GATE_AUTH_KEY); } catch { /* noop */ } set({ nostrAuthEnabled: v }); },
  // B1: nostrAuthEnabled is DERIVED from pubkey presence (signed-in) — set in LOCKSTEP here + mirror GATE_AUTH_KEY
  // to GATE_PUBKEY_KEY so the two can never desync (that desync was the unlock half-state bug). Auth is active iff
  // signed in; the local key always Face-ID-gates on launch.
  setNostrPubkey:        (v) => { try { if (v == null) { localStorage.removeItem(GATE_PUBKEY_KEY); localStorage.removeItem(GATE_AUTH_KEY); } else { localStorage.setItem(GATE_PUBKEY_KEY, v); localStorage.setItem(GATE_AUTH_KEY, '1'); } } catch { /* noop */ } set({ nostrPubkey: v, nostrAuthEnabled: !!v }); },
  setNostrSigningMethod: (v) => { try { v == null ? localStorage.removeItem(GATE_METHOD_KEY) : localStorage.setItem(GATE_METHOD_KEY, v); } catch { /* noop */ } set({ nostrSigningMethod: v }); },
  setNostrBunkerUri:     (v) => set({ nostrBunkerUri: v }),
  setNostrRelays:        (v) => set({ nostrRelays: v }),                                                  // bootstrap/internal: NO publish (syncNow's fetchUserRelays discovery uses this)
  setNostrRelaysAndSync: (v) => get().emitPlanSets([['nostrRelays', v]]),  // 4c: user edit → plan event → publish on its own (plain setNostrRelays above stays RAW — boot/NIP-65 discovery must NEVER emit)
  setNostrLogin:         (v) => set({ nostrLogin: v }),
  // Write through to the standalone localStorage keys (persisted OUTSIDE the encrypted blob — see WK_*_KEY).
  setWriterKeyWrapped:   (v) => { try { v == null ? localStorage.removeItem(WK_WRAPPED_KEY) : localStorage.setItem(WK_WRAPPED_KEY, v); } catch { /* noop */ } set({ writerKeyWrapped: v }); },
  setWriterKeyWrapMeta:  (v) => { try { v == null ? localStorage.removeItem(WK_META_KEY) : localStorage.setItem(WK_META_KEY, JSON.stringify(v)); } catch { /* noop */ } set({ writerKeyWrapMeta: v }); },

  // Backup gate (R2a-1). WRITE-ONCE: provenance is a property of the identity, stamped once at establishment
  // (always BEFORE the establishing syncNow, or a generated key's first sync publishes ungated). A null write
  // is the explicit identity-teardown CLEAR (disconnectNostr / "Remove local key"); resetAndResync RETAINS the
  // identity and must NOT clear. Overwriting one non-null with a different non-null is a bug → warn + ignore
  // (otherwise generate→disconnect→import would leave 'generated' frozen with no verification UI to un-gate it).
  setKeyProvenance: (v) => {
    const cur = get().keyProvenance;
    if (v !== null && cur !== null) {
      if (cur !== v) console.warn(`keyProvenance already set (${cur}) — ignoring ${v}`);
      return;
    }
    // R2c-6-final: write through to the standalone GATE_PROVENANCE_KEY (outside the blob) so provenance survives
    // the escape hatch. AFTER the write-once guard so an ignored write never touches storage. The null clear-branch
    // (disconnectNostr / "Remove local key") removeItem's it — provenance dies with the identity.
    try { v == null ? localStorage.removeItem(GATE_PROVENANCE_KEY) : localStorage.setItem(GATE_PROVENANCE_KEY, v); } catch { /* noop */ }
    set({ keyProvenance: v });
  },
  // Stamping verification OPENS the gate, so it must also WAKE the engine. Authed, it (a) emits the stamp as a plan
  // event (emitPlanSets: field + event + planDirty + the debounced kick, whose publish early-returns on
  // !initialSettingsPullDone — still false precisely because the gate held syncNow off all session) and (b) runs the
  // SAME initial-pull-then-publish sequence a fresh authentication runs: syncNow (cf. establishOwner.ts), whose
  // publish step carries the event. No second wake mechanism.
  // ⚠ ORDER: the emit's set() lands FIRST, so the gate reads satisfied inside doSyncNow's guards + the publish guards.
  // `nostr` is optional (tests assert state without a signer; OwnerKeySetup relies on establishLocalOwner's
  // own internal syncNow as the wake). v === null is the teardown clear: no event, no wake.
  // syncNow is DYNAMIC-imported to avoid the store ↔ syncNow cycle (same as publish.ts below).
  //
  // ⚠ THE PRE-AUTH BRANCH IS LOAD-BEARING. Onboarding's quiz-pass (R2c-6a) stamps here BEFORE the establish (K3),
  // which can still throw (Face ID cancelled). Its rollback clears the field RAW — it cannot retract an event — so an
  // event emitted here would outlive a failed establish in the persisted log. So: pre-auth, only the field is set.
  setBackupVerifiedAt: (v, nostr) => {
    if (v == null) { set({ backupVerifiedAt: null }); return; }   // teardown clear — RAW, NO event
    const s = get();
    // Pre-auth (onboarding quiz-pass) — FIELD ONLY, NO event. Residual: the stamp rides no channel until an authed
    // re-verify (a ceremony re-run) emits it, so a second owner device shows no "Backed up ✓" chip until then. (Before
    // 4e a newly joined device could still get it through the bridge's settings:v1 when that applied on an empty log.)
    // Gate semantics unaffected (only the generating device is ever gated; peers satisfy via provenance).
    if (!s.isAuthenticated || !s.nostrSigner || !s.nostrPubkey) { set({ backupVerifiedAt: v }); return; }
    get().emitPlanSets([['backupVerifiedAt', v]]);   // authed: field + plan event + planDirty + kick
    if (nostr) void import('../../lib/nostr/syncNow').then((m) => m.syncNow(nostr)).catch((e) => nostrLog('warn', 'backup-verify wake failed', e));
  },
});
