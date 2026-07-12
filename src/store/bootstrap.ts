// Store bootstrap (Phase 1c) — module-init plumbing moved verbatim out of useStore.ts: the at-rest-encryption flag,
// the standalone WK_*/GATE_* credential+gate keys and their seed IIFEs (order-sensitive localStorage side-effects
// that MUST run before create()), gateHydratedIdentity, defaultMiningInputs, and kickRecordsPublish. Consts/seeds
// are EXPORTED for the slices (identity/mining setters) + persistConfig (merge/migrate). References no store singleton.
import type { WrapMeta } from '../lib/nostr/keyVault';
import type { MiningInputs } from '../simulation/types';

// At-rest store encryption — standalone localStorage flag, read once at module load. Lives OUTSIDE the persisted
// store blob (you can't read a setting stored inside the thing it gates). Persist is FLAG-CONDITIONAL since 3a.2:
// flag on → the encrypted `encryptedStorage` adapter; flag off (default) → plain `window.localStorage` (see the
// `storage` config below). Manual flag only until the 3a.5 opt-in.
export const storeEncEnabled = (() => {
  try { return localStorage.getItem('personal-bloc-store-enc-enabled') === '1'; } catch { return false; }
})();

// The wrap credential (writerKeyWrapped/writerKeyWrapMeta) is the KEY THAT UNLOCKS the encrypted store blob, so it
// must persist OUTSIDE that blob (else it's locked inside the box it opens — the circular-dependency bug). Persist
// it in standalone localStorage keys; the store fields below are seeded from / written through to these.
export const WK_WRAPPED_KEY = 'personal-bloc-writer-key-wrapped';
export const WK_META_KEY    = 'personal-bloc-writer-key-meta';

// Seed from the standalone keys. ONE-TIME back-fill from the legacy in-blob location for existing users (their blob
// is plaintext — the bug blocked enabling encryption; an already-encrypted blob can't be read here, but then the
// standalone key would already exist). Runs at module init (before persist hydration), unconditionally — NOT in
// migrate(), which only runs on a version change and so would never fire for existing version-18 users.
export const { wkWrapped: seedWriterKeyWrapped, wkMeta: seedWriterKeyWrapMeta } = (() => {
  let wrapped: string | null = null;
  let meta: WrapMeta | null = null;
  try {
    wrapped = localStorage.getItem(WK_WRAPPED_KEY);
    const ms = localStorage.getItem(WK_META_KEY);
    meta = ms ? (JSON.parse(ms) as WrapMeta) : null;
    if (wrapped == null && meta == null) {
      const raw = localStorage.getItem('personal-bloc-store');
      if (raw) {
        const o = JSON.parse(raw);
        if (o && o.ct == null && o.iv == null) {   // plaintext blob ONLY
          const st = o.state ?? {};
          if (st.writerKeyWrapped) { wrapped = String(st.writerKeyWrapped); localStorage.setItem(WK_WRAPPED_KEY, wrapped); }
          if (st.writerKeyWrapMeta) { meta = st.writerKeyWrapMeta as WrapMeta; localStorage.setItem(WK_META_KEY, JSON.stringify(meta)); }
        }
      }
    }
  } catch { /* noop */ }
  return { wkWrapped: wrapped, wkMeta: meta };
})();

// Gate-condition fields needed to render the unlock gate on an ENCRYPTED cold start — they decide whether to show
// LocalUnlockGate, so (like the wrap credential above) they must live OUTSIDE the encrypted blob, else they're
// locked inside the box the gate would open (the 3a.4 cold-start deadlock: encrypted blob → getItem null → seeds →
// onboarding shows instead of the gate). Standalone localStorage; the store fields are seeded from / written through
// to these. KEPT in the blob too (redundant — serves the plaintext/flag-off path); the standalone copy bootstraps
// the gate on encrypted cold start.
export const GATE_ONBOARDED_KEY = 'personal-bloc-onboarded';
export const GATE_AUTH_KEY      = 'personal-bloc-nostr-auth';       // 'nostrAuthEnabled'
export const GATE_METHOD_KEY    = 'personal-bloc-nostr-method';     // 'nostrSigningMethod'
export const GATE_PUBKEY_KEY    = 'personal-bloc-nostr-pubkey';     // 'nostrPubkey'
export const GATE_PROVENANCE_KEY = 'personal-bloc-provenance';      // 'keyProvenance' — standalone so it survives the escape hatch (bypass 1)

export const {
  gOnboarded: seedOnboardingComplete,
  gAuth:      seedNostrAuthEnabled,
  gMethod:    seedNostrSigningMethod,
  gPubkey:    seedNostrPubkey,
  gProvenance: seedKeyProvenance,
} = (() => {
  let onboarded = false;
  let method: 'nip07' | 'nip46' | 'local' | null = null;
  let pubkey: string | null = null;
  let provenance: 'generated' | 'imported' | 'external' | null = null;
  try {
    onboarded = localStorage.getItem(GATE_ONBOARDED_KEY) === '1';
    const m   = localStorage.getItem(GATE_METHOD_KEY);
    method    = (m === 'nip07' || m === 'nip46' || m === 'local') ? m : null;
    pubkey    = localStorage.getItem(GATE_PUBKEY_KEY);
    // ONE-TIME back-fill from a PLAINTEXT blob for existing users (same approach as the WK_* back-fill). An
    // already-encrypted blob can't be read here — but then these standalone keys were written on a prior run.
    if (!onboarded && method == null && pubkey == null) {
      const raw = localStorage.getItem('personal-bloc-store');
      if (raw) {
        const o = JSON.parse(raw);
        if (o && o.ct == null && o.iv == null) {   // plaintext blob ONLY
          const st = o.state ?? {};
          if (st.onboardingComplete) { onboarded = true; localStorage.setItem(GATE_ONBOARDED_KEY, '1'); }
          if (st.nostrSigningMethod) { method = st.nostrSigningMethod; localStorage.setItem(GATE_METHOD_KEY, String(st.nostrSigningMethod)); }
          if (st.nostrPubkey)        { pubkey = String(st.nostrPubkey); localStorage.setItem(GATE_PUBKEY_KEY, pubkey); }
        }
      }
    }
    // R2c-6-final (bypass 1): keyProvenance must survive the escape hatch (which nukes the blob but keeps GATE
    // keys), so it gets its own standalone key. ⚠ Its back-fill is gated on PROVENANCE ALONE — the combined
    // all-absent gate above is skipped on every post-3a.4 install (GATE keys present), which is exactly the
    // population the escape-hatch bypass threatens.
    const p = localStorage.getItem(GATE_PROVENANCE_KEY);
    provenance = (p === 'generated' || p === 'imported' || p === 'external') ? p : null;
    if (provenance == null) {
      const raw = localStorage.getItem('personal-bloc-store');
      if (raw) {
        const o = JSON.parse(raw);
        if (o && o.ct == null && o.iv == null) {   // plaintext blob ONLY
          const kp = (o.state ?? {}).keyProvenance;
          if (kp === 'generated' || kp === 'imported' || kp === 'external') {
            provenance = kp;
            localStorage.setItem(GATE_PROVENANCE_KEY, kp);
          }
        }
      }
    }
    // B1: nostrAuthEnabled is DERIVED from pubkey presence — mirror GATE_AUTH_KEY to GATE_PUBKEY_KEY so the 3a.4
    // encrypted-cold-start gate still fires (GATE_AUTH_KEY present whenever GATE_PUBKEY_KEY is) AND any legacy
    // desync (the half-state: auth flag out of step with pubkey) self-heals on launch.
    if (pubkey) localStorage.setItem(GATE_AUTH_KEY, '1'); else localStorage.removeItem(GATE_AUTH_KEY);
  } catch { /* noop */ }
  return { gOnboarded: onboarded, gAuth: !!pubkey, gMethod: method, gPubkey: pubkey, gProvenance: provenance };
})();

/**
 * Gate hydrated identity on the standalone GATE_PUBKEY_KEY — the SYNCHRONOUS source of truth that disconnect clears
 * before reload(). The persisted blob is racy: disconnect's setters clear it but the persist write may not land
 * before the synchronous reload, leaving a stale `nostrPubkey` that (under the B1 pin) resurrects auth. Gating the
 * hydrate on the GATE key makes sign-out authoritative. Applied in the persist `merge` so it runs on EVERY rehydrate
 * (unlike migrate(), which fires only on a version bump — useStore.ts module note above). Pure (gatePubkey passed in)
 * so it's unit-testable without localStorage. Only the identity fields are touched; all other persisted data passes
 * through untouched. BOTH identity fields (pubkey AND method) are gated on the live GATE keys — the racy blob is
 * never authoritative for identity (a stale blob `nostrSigningMethod` would point at the wrong signer → timeouts).
 * R2a-1: the backup-gate fields are identity-scoped too, so the signed-out branch nulls them for the same reason —
 * disconnect clears them, but its blob write may not land, and a stale 'generated' + null would re-gate a device
 * that has since imported a key (setKeyProvenance is write-once).
 * R2c-6-final (bypass 1): keyProvenance is gated on its own live GATE_PROVENANCE_KEY (standalone-authoritative),
 * because the escape hatch nukes the blob but keeps the GATE keys — without this, a reset would refill provenance
 * to null (= legacy grandfather = satisfied) and a generated-unverified key would ungate itself. ⚠ ASYMMETRY:
 * backupVerifiedAt needs NO standalone key — it's a SYNCED plan field, so a VERIFIED key re-hydrates it from the
 * relay on the post-reset pull; an unverified key's null (empty relay) is correct. It passes through ...persisted.
 */
export function gateHydratedIdentity(persisted: any, gatePubkey: string | null, gateMethod: string | null, gateProvenance: string | null) {
  if (!gatePubkey) {
    return { ...persisted, nostrPubkey: null, nostrSigningMethod: null, nostrAuthEnabled: false, keyProvenance: null, backupVerifiedAt: null };
  }
  return {
    ...persisted,
    nostrPubkey: persisted?.nostrPubkey ?? gatePubkey,
    nostrSigningMethod: gateMethod ?? persisted?.nostrSigningMethod ?? null,   // LIVE GATE_METHOD_KEY authoritative; blob fallback (fixes local-login hydrating stale nip46)
    keyProvenance: gateProvenance ?? persisted?.keyProvenance ?? null,          // LIVE GATE_PROVENANCE_KEY authoritative — survives the escape hatch (bypass 1)
    nostrAuthEnabled: true,   // pin: GATE affirms identity
  };
}

export const defaultMiningInputs: MiningInputs = {
  devices: [
    { name: 'Gamma 601', hashrateTH: 1.07, powerW: 22.3, efficiencyJTH: 20.23, enabled: true, soloMining: true,  poolName: '', poolFee: 0.5 },
    { name: 'Gamma 602', hashrateTH: 1.20, powerW: 18.0, efficiencyJTH: 15.0,  enabled: true, soloMining: false, poolName: '', poolFee: 2.0 },
  ],
  electricityRateCents: 12,
  btcPriceOverride: null,
  networkHashrateEH: 1000,
  selectedStrategy: 'split',
  currency: 'usd',
  projectionYears: 5,
  btcPriceScenarios: [76000, 150000, 300000, 1000000],
};

// kickRecordsPublish — the store reaches the engine's debounced records publish via DYNAMIC import (no static
// back-edge; the syncNow precedent). Used at the 7 dayLog-mutator sites in place of the former local publishRecordsNow().
export const kickRecordsPublish = () => { void import('../lib/nostr/syncEngine').then((m) => m.publishRecordsNow()); };
