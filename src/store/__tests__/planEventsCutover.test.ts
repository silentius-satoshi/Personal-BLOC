import { describe, it, expect, beforeEach, vi } from 'vitest';

// Store setters write GATE_*/device-tag localStorage; shim it (mirrors applyPlanBackup.test.ts) BEFORE the store import.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { useStore, partializeState } from '../useStore';
import { foldPlanEvents } from '../../lib/planEvents/fold';
import { DEFAULT_RELAYS } from '../../lib/nostr/relays';

const events = () => useStore.getState().planEvents;

beforeEach(() => {
  useStore.setState({
    planEvents: [], planDirty: false, prefsDirty: false,
    isAuthenticated: false, nostrSigner: null, nostrPubkey: null, initialSettingsPullDone: false,
    income: 4000, expenses: 3500, creditLine: 10000,
    viewers: [], nextViewerIndex: 0, backupVerifiedAt: null, keyProvenance: null,
    nostrRelays: [...DEFAULT_RELAYS], simpleMode: false,
  } as never);
});

describe('4c emitter audit', () => {
  it('setIncome emits ONE plan event + planDirty + the scalar', () => {
    useStore.getState().setIncome(9999);
    expect(useStore.getState().income).toBe(9999);
    expect(useStore.getState().planDirty).toBe(true);
    const inc = events().filter((e) => e.field === 'income');
    expect(inc).toHaveLength(1);
    expect(inc[0].value).toBe(9999);
    expect(inc[0].kind).toBe('set');
  });

  it('the AsOf PAIR (setAdvisorActualBlocBalance) shares ONE ts — can never tear', () => {
    useStore.getState().setAdvisorActualBlocBalance(12345);
    const bal  = events().find((e) => e.field === 'advisorActualBlocBalance');
    const asof = events().find((e) => e.field === 'advisorActualBlocBalanceAsOf');
    expect(bal).toBeDefined();
    expect(asof).toBeDefined();
    expect(bal!.ts).toBe(asof!.ts);
  });

  it('roster add emits a whole-array viewers + nextViewerIndex pair (one ts) + increments the counter', () => {
    useStore.getState().addViewerSlot({ pubkeyHex: 'aa', npub: 'npub1x', label: 'Dad', tier: 'safe', keyVersion: 1 } as never);
    const v = events().find((e) => e.field === 'viewers');
    const n = events().find((e) => e.field === 'nextViewerIndex');
    expect(v!.ts).toBe(n!.ts);
    expect((v!.value as unknown[]).length).toBe(1);
    expect(n!.value).toBe(1);
    expect(useStore.getState().nextViewerIndex).toBe(1);
  });

  it('plain setNostrRelays does NOT emit (boot/discovery stays silent)', () => {
    useStore.getState().setNostrRelays(['wss://x']);
    expect(events()).toHaveLength(0);
    expect(useStore.getState().planDirty).toBe(false);
  });

  it('setNostrRelaysAndSync DOES emit a nostrRelays event + planDirty', () => {
    useStore.getState().setNostrRelaysAndSync(['wss://x']);
    expect(events().some((e) => e.field === 'nostrRelays')).toBe(true);
    expect(useStore.getState().planDirty).toBe(true);
  });

  it('a prefs setter emits NO plan event but marks prefsDirty', () => {
    useStore.getState().setSimpleMode(true);
    expect(events()).toHaveLength(0);
    expect(useStore.getState().planDirty).toBe(false);
    expect(useStore.getState().prefsDirty).toBe(true);
    expect(useStore.getState().simpleMode).toBe(true);
  });

  it('toggleTabVisibility emits a prefs event, NOT a plan event (4c latent-asymmetry fix)', () => {
    useStore.getState().toggleTabVisibility('mining');
    expect(events()).toHaveLength(0);
    expect(useStore.getState().prefsDirty).toBe(true);
    expect(useStore.getState().hiddenTabs).toContain('mining');
  });

  it('setBackupVerifiedAt(null) is a RAW clear — NO event', () => {
    useStore.setState({ backupVerifiedAt: 123 } as never);
    useStore.getState().setBackupVerifiedAt(null);
    expect(useStore.getState().backupVerifiedAt).toBeNull();
    expect(events()).toHaveLength(0);
  });

  it('pre-auth setBackupVerifiedAt is FIELD-ONLY — NO event (4e: no genesis to ride; an authed re-verify heals it)', () => {
    useStore.getState().setBackupVerifiedAt(999);   // isAuthenticated false in beforeEach
    expect(useStore.getState().backupVerifiedAt).toBe(999);
    expect(events()).toHaveLength(0);
    expect(useStore.getState().planDirty).toBe(false);
  });

  it('authed setBackupVerifiedAt emits an event + planDirty', () => {
    useStore.setState({ isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk' } as never);
    useStore.getState().setBackupVerifiedAt(999);
    expect(events().some((e) => e.field === 'backupVerifiedAt' && e.value === 999)).toBe(true);
    expect(useStore.getState().planDirty).toBe(true);
  });
});

describe('4c parity — fold-present keys equal the live scalars', () => {
  const foldMatchesScalars = () => {
    const s = useStore.getState() as unknown as Record<string, unknown>;
    const folded = foldPlanEvents(useStore.getState().planEvents) as Record<string, unknown>;
    return Object.keys(folded).every((k) => JSON.stringify(folded[k]) === JSON.stringify(s[k]));
  };

  it('fresh-key: ONE emit → parity OK (the ~40 absent keys are ignored)', () => {
    useStore.getState().setIncome(4242);
    expect(useStore.getState().planEvents).toHaveLength(1);
    expect(foldMatchesScalars()).toBe(true);
  });

  it('after several emits, fold ≡ scalars', () => {
    useStore.getState().setIncome(1);
    useStore.getState().setExpenses(2);
    useStore.getState().setCreditLine(3);
    expect(foldMatchesScalars()).toBe(true);
  });

  it('corruption: a raw scalar drift from the log → DIVERGED on that field', () => {
    useStore.getState().setIncome(1);
    useStore.setState({ income: 999 } as never);   // scalar drifts away from its event
    const folded = foldPlanEvents(useStore.getState().planEvents) as Record<string, unknown>;
    expect(folded.income).toBe(1);
    expect(useStore.getState().income).toBe(999);
    expect(foldMatchesScalars()).toBe(false);
  });
});

// Phase 4e — the whole-object-LWW guard class (hydrateSettings' relay / roster / latch skip-guards, pickPlanFields at
// the genesis boundary) is retired with settings:v1. These pin the guarantees it gave, as the plan channel gives them.
describe('4e — the retired guard class\'s guarantees, on the plan channel', () => {
  const SLICES = join(__dirname, '..', 'slices');
  const slicesSrc = () => readdirSync(SLICES).filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(join(SLICES, f), 'utf8')).join('\n');

  it('LATCH — no path emits a null backupVerifiedAt event: the clear is RAW, and the one emit sits after the null return', () => {
    useStore.setState({ isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', backupVerifiedAt: 5 } as never);
    useStore.getState().setBackupVerifiedAt(null);   // the authed teardown clear
    expect(events().some((e) => e.field === 'backupVerifiedAt'), 'LATCH authed clear').toBe(false);
    const src = slicesSrc();
    const emits = src.match(/emitPlanSets\(\[\['backupVerifiedAt'/g) ?? [];
    expect(emits.length, 'LATCH one emit site').toBe(1);
    const body = src.slice(src.indexOf('setBackupVerifiedAt: (v, nostr) => {'));
    expect(body.indexOf('if (v == null)'), 'LATCH null returns first').toBeLessThan(body.indexOf("emitPlanSets([['backupVerifiedAt'"));
    expect(body.indexOf('if (v == null)'), 'LATCH null returns first').toBeGreaterThan(-1);
  });

  it('ROSTER — removing the last viewer is an explicit empty roster event (§6), and a peer folding it ends empty', () => {
    useStore.getState().addViewerSlot({ pubkeyHex: 'aa', npub: 'npub1x', label: 'Dad', tier: 'safe', keyVersion: 1 } as never);
    useStore.getState().removeViewerSlot(0);
    const latest = foldPlanEvents(events()) as Record<string, unknown>;
    expect(latest.viewers, 'ROSTER empty is an event').toEqual([]);
    expect(useStore.getState().viewers, 'ROSTER').toEqual([]);
    // a peer still holding the roster folds the log: the empty roster lands (the retired roster guard skipped it)
    useStore.setState({ viewers: [{ index: 0, pubkeyHex: 'aa', npub: 'npub1x', label: 'Dad', tier: 'safe', keyVersion: 1 }], nextViewerIndex: 1 } as never);
    useStore.getState().applyPlanFold(foldPlanEvents(events()) as never);
    expect(useStore.getState().viewers, 'ROSTER peer').toEqual([]);
  });

  // SEED lives in lib/nostr/__tests__/bridgeRetired.test.ts — it needs the relay-layer mock (here, an unguarded publish would
  // fail on the fake signer and return false anyway, so the case passed with the guard deleted).
});

// Phase 4e — the three retired bridge keys. The store stays v21 (no bump), so migrateState never runs on an existing
// blob: partializeState is the path that sheds them (merge spreads a pre-4e blob's copies back into memory).
describe('4e — the retired store keys', () => {
  it('a fresh store carries none of them', () => {
    const s = useStore.getState() as unknown as Record<string, unknown>;
    for (const k of ['settingsDirty', 'lastSettingsSyncAt', 'lastV1FallbackApplyAt']) expect(k in s, `RETIRED ${k}`).toBe(false);
  });

  it('partializeState drops them from a state that still carries a pre-4e blob\'s copies', () => {
    const stale = { ...useStore.getState(), settingsDirty: true, lastSettingsSyncAt: 1_700_000_000, lastV1FallbackApplyAt: 1_700_000_001 };
    const blob = JSON.parse(JSON.stringify(partializeState(stale as never))) as Record<string, unknown>;
    for (const k of ['settingsDirty', 'lastSettingsSyncAt', 'lastV1FallbackApplyAt']) expect(k in blob, `STRIP ${k}`).toBe(false);
    expect('planEvents' in blob, 'STRIP keeps the rest').toBe(true);
  });
});
