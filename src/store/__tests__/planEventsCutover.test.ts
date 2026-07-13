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

import { useStore } from '../useStore';
import { foldPlanEvents } from '../../lib/planEvents/fold';
import { synthesizeGenesisEvents, nextPlanEventTs } from '../../lib/planEvents/genesis';
import { pickPlanFields } from '../../lib/nostr/syncNow';
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

  it('pre-auth setBackupVerifiedAt is FIELD-ONLY — NO event (rides genesis)', () => {
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

  it('fresh-key: ONE emit → parity OK (the ~32 absent keys are ignored)', () => {
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

describe('4c genesis seed — pickPlanFields guards (RISK-2) + round-trip', () => {
  it('drops a null backupVerifiedAt (never un-verify a peer)', () => {
    useStore.setState({ backupVerifiedAt: null } as never);
    expect('backupVerifiedAt' in pickPlanFields(useStore.getState())).toBe(false);
  });

  it('keeps a real backupVerifiedAt', () => {
    useStore.setState({ backupVerifiedAt: 777 } as never);
    expect(pickPlanFields(useStore.getState()).backupVerifiedAt).toBe(777);
  });

  it('drops empty viewers AND nextViewerIndex together', () => {
    useStore.setState({ viewers: [], nextViewerIndex: 0 } as never);
    const p = pickPlanFields(useStore.getState());
    expect('viewers' in p).toBe(false);
    expect('nextViewerIndex' in p).toBe(false);
  });

  it('keeps a populated roster', () => {
    useStore.setState({ viewers: [{ index: 0, pubkeyHex: 'aa', npub: 'n', label: 'D', tier: 'safe', keyVersion: 1 }], nextViewerIndex: 1 } as never);
    const p = pickPlanFields(useStore.getState());
    expect((p.viewers as unknown[]).length).toBe(1);
    expect(p.nextViewerIndex).toBe(1);
  });

  it('drops default-looking nostrRelays', () => {
    useStore.setState({ nostrRelays: [...DEFAULT_RELAYS] } as never);
    expect('nostrRelays' in pickPlanFields(useStore.getState())).toBe(false);
  });

  it('keeps a real custom relay list', () => {
    useStore.setState({ nostrRelays: ['wss://my-custom'] } as never);
    expect(pickPlanFields(useStore.getState()).nostrRelays).toEqual(['wss://my-custom']);
  });

  it('fold(synthesizeGenesisEvents(pickPlanFields)) ≡ pickPlanFields (the load-bearing round-trip)', () => {
    useStore.setState({ income: 7, expenses: 8, viewers: [], nostrRelays: [...DEFAULT_RELAYS], backupVerifiedAt: null } as never);
    const partition = pickPlanFields(useStore.getState());
    const genesis = synthesizeGenesisEvents(partition, nextPlanEventTs(0), 'dev');
    expect(foldPlanEvents(genesis)).toEqual(partition);
  });
});
