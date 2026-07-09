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

import { useStore, buildSettingsPayload, partializeState, gateHydratedIdentity } from '../useStore';
import { isBackupGateSatisfied } from '../../lib/backupGate';

// R2a-1 — backup-gate store plumbing. keyProvenance is device-local-persisted-never-synced (write-once,
// null = clear). backupVerifiedAt is persisted AND synced, a ONE-WAY LATCH on hydrate.

const T  = 1_700_000_000_000;
const T2 = 1_800_000_000_000;

const reset = () => useStore.setState({ keyProvenance: null, backupVerifiedAt: null, settingsDirty: false } as never);

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
});

describe('setBackupVerifiedAt', () => {
  const authed = () => useStore.setState({ isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk' } as never);
  const unauth = () => useStore.setState({ isAuthenticated: false, nostrSigner: null, nostrPubkey: '' } as never);
  afterEach(unauth);

  it('an AUTHENTICATED stamp sets the field AND marks settingsDirty (syncSettingsToNostr is gated pre-pull, so it cannot)', () => {
    authed();
    useStore.getState().setBackupVerifiedAt(T);
    expect(useStore.getState().backupVerifiedAt).toBe(T);
    expect(useStore.getState().settingsDirty).toBe(true);
  });

  // ⚠ SEED-CLOBBER (Fix C). settingsDirty is PERSISTED, and doSyncNow flips initialSettingsPullDone(true)
  // BEFORE its publish step — so Fix D's seed-guard can never fire there and Fix C is the only protection.
  // A pre-auth stamp would land on an unauthenticated SEED store: dirtying there would publish seed defaults as
  // the owner's first settings event, and — if an establish then throws — persist a dirty seed store into a later
  // REAL login, publishing seeds over the owner's real relay settings under whole-object LWW.
  // R2c-4a retired the K2 bridge, so nothing stamps pre-auth today — this guard is now DEFENSIVE (it keeps any
  // future pre-auth caller from re-opening the seed-clobber hole). The ceremony stamps post-auth.
  it('a PRE-AUTH stamp sets the field but must NOT mark settingsDirty (defensive — no caller does this now)', () => {
    unauth();
    useStore.setState({ settingsDirty: false } as never);
    useStore.getState().setBackupVerifiedAt(T);
    expect(useStore.getState().backupVerifiedAt).toBe(T);   // gate opens locally
    expect(useStore.getState().settingsDirty).toBe(false);  // …but the seed store stays clean
  });

  it('a pre-auth stamp still rides the next genuine settings publish (it is in buildSettingsPayload)', () => {
    unauth();
    useStore.getState().setBackupVerifiedAt(T);
    expect(buildSettingsPayload(useStore.getState()).backupVerifiedAt).toBe(T);
  });

  it('the null teardown clear touches neither settingsDirty nor anything else', () => {
    useStore.setState({ backupVerifiedAt: T, settingsDirty: false } as never);
    useStore.getState().setBackupVerifiedAt(null);
    expect(useStore.getState().backupVerifiedAt).toBeNull();
    expect(useStore.getState().settingsDirty).toBe(false);
  });
});

describe('hydrateSettings — backupVerifiedAt is a ONE-WAY LATCH', () => {
  it('an incoming null does NOT clobber a latched local value — and a sibling field still applies (skip-FIELD)', () => {
    useStore.setState({ backupVerifiedAt: T } as never);
    useStore.getState().hydrateSettings({ backupVerifiedAt: null, income: 1234 });
    expect(useStore.getState().backupVerifiedAt).toBe(T);   // held
    expect(useStore.getState().income).toBe(1234);          // skip-FIELD, not skip-all
  });

  it('a real incoming timestamp hydrates (verifying on one owner device un-gates the others)', () => {
    useStore.setState({ backupVerifiedAt: null } as never);
    useStore.getState().hydrateSettings({ backupVerifiedAt: T2 });
    expect(useStore.getState().backupVerifiedAt).toBe(T2);
  });

  it('an incoming null over an unlatched local applies (nothing to protect)', () => {
    useStore.setState({ backupVerifiedAt: null } as never);
    useStore.getState().hydrateSettings({ backupVerifiedAt: null });
    expect(useStore.getState().backupVerifiedAt).toBeNull();
  });

  it('a stale pre-R2 bundle OMITS the field entirely → the whitelist skips it, latch untouched', () => {
    useStore.setState({ backupVerifiedAt: T } as never);
    useStore.getState().hydrateSettings({ income: 4321 });   // no backupVerifiedAt key at all
    expect(useStore.getState().backupVerifiedAt).toBe(T);
  });

  it('a later timestamp overwrites an earlier one (plain LWW within the latch)', () => {
    useStore.setState({ backupVerifiedAt: T } as never);
    useStore.getState().hydrateSettings({ backupVerifiedAt: T2 });
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
    const out = gateHydratedIdentity({ keyProvenance: 'generated', backupVerifiedAt: null, income: 4000 }, null, null);
    expect(out.keyProvenance).toBeNull();
    expect(out.backupVerifiedAt).toBeNull();
    expect(out.income).toBe(4000);   // non-identity data passes through untouched
  });

  it('gateHydratedIdentity leaves both alone when signed in', () => {
    const out = gateHydratedIdentity({ keyProvenance: 'generated', backupVerifiedAt: T }, 'pk', 'local');
    expect(out.keyProvenance).toBe('generated');
    expect(out.backupVerifiedAt).toBe(T);
  });
});

describe('publish guards consult the gate', () => {
  afterEach(() => {
    useStore.setState({ isAuthenticated: false, nostrSigner: null, nostrPubkey: '', settingsDirty: false, initialSettingsPullDone: false } as never);
  });

  it('publishSettingsNow refuses a generated-but-unverified key (never reaches the seed-guard warn)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { publishSettingsNow } = await import('../useStore');
    useStore.setState({
      isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk',
      initialSettingsPullDone: true, keyProvenance: 'generated', backupVerifiedAt: null,
    } as never);

    expect(await publishSettingsNow()).toBe(false);
    // bailed at the gate, before setNostrSyncing / the seed-guard warn
    expect(warn.mock.calls.flat().join(' ')).not.toContain('refused');
    expect(useStore.getState().nostrSyncing).toBe(false);
  });

  it('syncSettingsToNostr does not mark dirty while gated', () => {
    vi.useFakeTimers();
    useStore.setState({
      isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk',
      initialSettingsPullDone: true, settingsDirty: false,
      keyProvenance: 'generated', backupVerifiedAt: null,
    } as never);

    useStore.getState().syncSettingsToNostr();

    expect(useStore.getState().settingsDirty).toBe(false);
    vi.clearAllTimers();
    vi.useRealTimers();
  });
});
