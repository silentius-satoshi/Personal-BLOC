import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock localStorage BEFORE the store import (vi.hoisted runs first) — partializeState + the module-init
// GATE_*/WK_* seeds touch it. Mirrors simpleView.test.ts.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem:    (k: string) => mem.get(k) ?? null,
    setItem:    (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { useStore, partializeState, gateHydratedIdentity } from '../useStore';
import { buildSettingsPayload } from '../payloads';
import { isBackupGateSatisfied } from '../../lib/backupGate';

// R2a-1 — backup-gate store plumbing. keyProvenance is device-local-persisted-never-synced (write-once,
// null = clear). backupVerifiedAt is persisted AND synced (an authed stamp is a plan event), and a ONE-WAY LATCH by
// construction: no path emits a null event (Phase 4e retired the hydrate skip-guard that used to hold it).

const T  = 1_700_000_000_000;
const T2 = 1_800_000_000_000;

const reset = () => useStore.setState({ keyProvenance: null, backupVerifiedAt: null } as never);

beforeEach(reset);
afterEach(() => { reset(); vi.restoreAllMocks(); });

describe('field posture', () => {
  it('both default to null (fresh install AND, via the persist merge, every pre-R2 plan)', () => {
    expect(useStore.getState().keyProvenance).toBeNull();
    expect(useStore.getState().backupVerifiedAt).toBeNull();
  });

  it('backupVerifiedAt is SYNCED — present in the settings payload', () => {
    useStore.getState().setBackupVerifiedAt(T);
    expect(buildSettingsPayload(useStore.getState()).backupVerifiedAt).toBe(T);
  });

  it('keyProvenance is DEVICE-LOCAL — absent from the settings payload (and thus from both snapshots + the plan backup)', () => {
    useStore.getState().setKeyProvenance('generated');
    expect('keyProvenance' in buildSettingsPayload(useStore.getState())).toBe(false);
  });

  it('both ride partializeState (persisted — not in the omit destructure)', () => {
    useStore.getState().setKeyProvenance('imported');
    useStore.getState().setBackupVerifiedAt(T);
    const p = partializeState(useStore.getState());
    expect(p.keyProvenance).toBe('imported');
    expect(p.backupVerifiedAt).toBe(T);
  });
});

describe('setKeyProvenance — write-once, null is an explicit clear', () => {
  it('a second, DIFFERENT non-null write is ignored + warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useStore.getState().setKeyProvenance('generated');
    useStore.getState().setKeyProvenance('imported');
    expect(useStore.getState().keyProvenance).toBe('generated');
    expect(warn.mock.calls.flat().join(' ')).toContain('already set');
  });

  it('re-writing the SAME value is a silent no-op (an establish retry must not warn)', () => {
    // NB: assert on CONTENT, not call count — zustand's persist middleware warns on every set under node
    // ("the given storage is currently unavailable"), so `not.toHaveBeenCalled()` would always fail.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useStore.getState().setKeyProvenance('generated');
    useStore.getState().setKeyProvenance('generated');
    expect(useStore.getState().keyProvenance).toBe('generated');
    expect(warn.mock.calls.flat().join(' ')).not.toContain('already set');
  });

  it('null CLEARS (identity teardown) — and a subsequent provenance then sticks', () => {
    useStore.getState().setKeyProvenance('generated');
    useStore.getState().setKeyProvenance(null);
    expect(useStore.getState().keyProvenance).toBeNull();
    useStore.getState().setKeyProvenance('imported');
    expect(useStore.getState().keyProvenance).toBe('imported');
  });

  // R2c-6-final (bypass 1): keyProvenance writes through to a STANDALONE localStorage key so it survives the escape
  // hatch (which nukes the blob but keeps the GATE keys).
  it('writes through to the standalone GATE_PROVENANCE_KEY (stamp writes, null clears)', () => {
    useStore.getState().setKeyProvenance('generated');
    expect(localStorage.getItem('personal-bloc-provenance')).toBe('generated');
    useStore.getState().setKeyProvenance(null);
    expect(localStorage.getItem('personal-bloc-provenance')).toBeNull();
  });

  it('an ignored write-once conflict does NOT touch the standalone key', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useStore.getState().setKeyProvenance('generated');
    useStore.getState().setKeyProvenance('imported');   // ignored (write-once)
    expect(localStorage.getItem('personal-bloc-provenance')).toBe('generated');
  });
});

describe('setBackupVerifiedAt', () => {
  const authed = () => useStore.setState({ isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk' } as never);
  const unauth = () => useStore.setState({ isAuthenticated: false, nostrSigner: null, nostrPubkey: '' } as never);
  afterEach(unauth);

  it('an AUTHENTICATED stamp sets the field AND marks planDirty (4c: emits a plan event; was settingsDirty)', () => {
    authed();
    useStore.getState().setBackupVerifiedAt(T);
    expect(useStore.getState().backupVerifiedAt).toBe(T);
    expect(useStore.getState().planDirty).toBe(true);
    expect(useStore.getState().planEvents.some((e) => e.field === 'backupVerifiedAt' && e.value === T)).toBe(true);
  });

  // ⚠ THE PRE-AUTH BRANCH IS LOAD-BEARING (identitySlice). Onboarding's quiz-pass (R2c-6a — OwnerKeySetup) stamps
  // here on an unauthenticated store, BEFORE K3's establish, which can still throw (Face ID cancelled). Its rollback
  // clears the field RAW and cannot retract an event, so an event emitted here would outlive a failed establish in
  // the persisted log. So pre-auth only the field is set: nothing dirty, no event. (Until 4e this line also kept Fix
  // C's rule — no settingsDirty before the first pull; both retired with the settings:v1 bridge.)
  it('a PRE-AUTH stamp (onboarding\'s quiz-pass, before K3) sets the field but marks nothing dirty and emits nothing', () => {
    unauth();
    useStore.setState({ planDirty: false, planEvents: [] } as never);
    useStore.getState().setBackupVerifiedAt(T);
    expect(useStore.getState().backupVerifiedAt).toBe(T);   // gate opens locally
    expect(useStore.getState().planDirty).toBe(false);      // …but the seed store stays clean
    expect(useStore.getState().planEvents).toHaveLength(0);
  });

  it('a pre-auth stamp rides no channel (4e retired the settings:v1 bridge) — it still travels in a plan backup', () => {
    unauth();
    useStore.getState().setBackupVerifiedAt(T);
    expect(buildSettingsPayload(useStore.getState()).backupVerifiedAt).toBe(T);   // the export's settings partition
  });

  it('the null teardown clear marks nothing dirty and emits nothing', () => {
    useStore.setState({ backupVerifiedAt: T, planDirty: false, prefsDirty: false, planEvents: [] } as never);
    useStore.getState().setBackupVerifiedAt(null);
    expect(useStore.getState().backupVerifiedAt).toBeNull();
    expect(useStore.getState().planDirty).toBe(false);
    expect(useStore.getState().prefsDirty).toBe(false);
    expect(useStore.getState().planEvents).toHaveLength(0);
  });
});

// Phase 4e — the latch on the apply paths that remain. hydrateSettings' skip-guard retired with settings:v1: no emit path
// writes a null stamp (planEventsCutover LATCH), the two whitelist appliers can't write it at all, and a real stamp from
// a peer arrives as a plan event through the fold.
describe('4e — backupVerifiedAt on the remaining apply paths', () => {
  it('neither whitelist applier can write it — not a null, not a stamp', () => {
    useStore.setState({ backupVerifiedAt: T } as never);
    useStore.getState().hydratePrefs({ backupVerifiedAt: null, simpleMode: true });
    useStore.getState().applyViewerSettings({ backupVerifiedAt: null, income: 1234 });
    expect(useStore.getState().backupVerifiedAt).toBe(T);
    useStore.getState().hydratePrefs({ backupVerifiedAt: T2 });
    useStore.getState().applyViewerSettings({ backupVerifiedAt: T2 });
    expect(useStore.getState().backupVerifiedAt).toBe(T);
    expect(useStore.getState().income).toBe(1234);   // the sibling field still lands
  });

  it('a peer\'s real stamp arrives through the fold (verifying on one owner device reaches the others)', () => {
    useStore.setState({ backupVerifiedAt: null } as never);
    useStore.getState().applyPlanFold({ backupVerifiedAt: T2 });
    expect(useStore.getState().backupVerifiedAt).toBe(T2);
  });
});

describe('gate integration', () => {
  // R2c-4a: OwnerKeySetup stamps ONLY provenance; the R2c-1 ceremony is the sole writer of backupVerifiedAt.
  // This is the post-ceremony state. (⚠ This test drives the store setters directly — it never reads
  // OwnerKeySetup's source, so it can NOT detect whether the retired K2 bridge comes back. The pre-R2c-4a
  // comment here claimed it would; that was never true.)
  it('the ceremony stamp pair (generated + verifiedAt) leaves the gate SATISFIED', () => {
    useStore.getState().setKeyProvenance('generated');
    useStore.getState().setBackupVerifiedAt(T);
    expect(isBackupGateSatisfied(useStore.getState())).toBe(true);
  });

  // R2c-4a made this PRODUCTION REALITY, not a hypothetical: it is the state of every freshly generated key
  // between finishing onboarding and completing the ceremony.
  it('a generated key WITHOUT verification is gated', () => {
    useStore.getState().setKeyProvenance('generated');
    expect(isBackupGateSatisfied(useStore.getState())).toBe(false);
  });

  it('a legacy store (both null, i.e. the pre-R2 persist-merge outcome) is satisfied', () => {
    expect(isBackupGateSatisfied(useStore.getState())).toBe(true);
  });

  // Identity teardown: disconnect clears both, but its persist-blob write may not land before reload().
  // gateHydratedIdentity re-nulls them whenever GATE_PUBKEY_KEY is absent — same authority rule as identity.
  it('gateHydratedIdentity nulls both on the signed-out branch (a stale blob cannot re-gate)', () => {
    const out = gateHydratedIdentity({ keyProvenance: 'generated', backupVerifiedAt: null, income: 4000 }, null, null, null);
    expect(out.keyProvenance).toBeNull();
    expect(out.backupVerifiedAt).toBeNull();
    expect(out.income).toBe(4000);   // non-identity data passes through untouched
  });

  it('gateHydratedIdentity leaves both alone when signed in (blob fallback when no standalone provenance)', () => {
    const out = gateHydratedIdentity({ keyProvenance: 'generated', backupVerifiedAt: T }, 'pk', 'local', null);
    expect(out.keyProvenance).toBe('generated');
    expect(out.backupVerifiedAt).toBe(T);
  });

  // R2c-6-final (bypass 1): the standalone GATE_PROVENANCE_KEY is authoritative over the blob. The escape hatch
  // nukes the blob (persisted.keyProvenance absent) but keeps the standalone key → provenance survives → a
  // generated-unverified key stays gated instead of ungating itself to null=grandfathered.
  it('gateHydratedIdentity prefers the standalone provenance over the blob (escape-hatch survival)', () => {
    const out = gateHydratedIdentity({ backupVerifiedAt: null }, 'pk', 'local', 'generated');   // blob has NO keyProvenance
    expect(out.keyProvenance).toBe('generated');
    expect(isBackupGateSatisfied({ keyProvenance: out.keyProvenance, backupVerifiedAt: out.backupVerifiedAt ?? null })).toBe(false);
  });

  it('gateHydratedIdentity: standalone wins even when the blob disagrees', () => {
    const out = gateHydratedIdentity({ keyProvenance: 'imported' }, 'pk', 'local', 'generated');
    expect(out.keyProvenance).toBe('generated');
  });
});

describe('publish guards consult the gate', () => {
  afterEach(() => {
    useStore.setState({ isAuthenticated: false, nostrSigner: null, nostrPubkey: '', initialSettingsPullDone: false } as never);
  });

  it('publishPlanEventsNow refuses a generated-but-unverified key (bails at the gate, before setNostrSyncing)', async () => {
    const { publishPlanEventsNow } = await import('../../lib/nostr/syncEngine');
    useStore.setState({
      isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk',
      initialSettingsPullDone: true, keyProvenance: 'generated', backupVerifiedAt: null, planDirty: true,
    } as never);
    expect(await publishPlanEventsNow()).toBe(false);
    expect(useStore.getState().nostrSyncing).toBe(false);
    expect(useStore.getState().planDirty).toBe(true);   // the edit waits for the ceremony
  });

  it('publishPrefsNow refuses a generated-but-unverified key', async () => {
    const { publishPrefsNow } = await import('../../lib/nostr/syncEngine');
    useStore.setState({
      isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk',
      initialSettingsPullDone: true, keyProvenance: 'generated', backupVerifiedAt: null, prefsDirty: true,
    } as never);
    expect(await publishPrefsNow()).toBe(false);
    expect(useStore.getState().nostrSyncing).toBe(false);
  });
});
