import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock localStorage BEFORE the store import (vi.hoisted runs first) — the module-init GATE_* seeds touch it.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem:    (k: string) => mem.get(k) ?? null,
    setItem:    (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { useStore } from '../useStore';
import { hydrateDeviceFlags, persistOptions } from '../persistConfig';
import { planMissing, recordPlanPull, resetPlanPull } from '../../lib/nostr/planLoad';
import { startNewPlanHere } from '../../hooks/usePlanLoad';
import { publishPlanEventsNow, publishRecordsNowImmediate, publishViewerSnapshotNow, publishRelayListToNip65, heldWithoutPlan } from '../../lib/nostr/syncEngine';
import { getNostrLog, clearNostrLog } from '../../lib/nostr/log';
import { todayLocalISO } from '../../utils/format';
import { rollupMonth, priorStocksForMonth } from '../../simulation/logUtils';
import type { DayEvent, MonthlyLogEntry } from '../../simulation/types';
import type { StoreState } from '../types';

// 5c (spec `pbloc-spec-plan-load-guard-v1`) — a signed-in owner device writes nothing that depends on the plan until it
// holds the plan. Round synthetic figures; every date is computed from today, so the file holds on any run date.

const SEED = useStore.getState();
const reset = () => useStore.setState({
  nostrAuthEnabled: false, viewerMode: false, keyProvenance: null, planLoaded: false, isAuthenticated: false,
  nostrSigner: null, nostrPubkey: null, initialSettingsPullDone: false, planDirty: false, recordsDirty: false,
  dayLog: [], monthlyLog: [], deletedMonths: {}, deletedDayEvents: {}, planEvents: [], viewers: [],
  monthBucketReconcileDone: true, advisorStartDate: SEED.advisorStartDate,
} as never);
beforeEach(() => { reset(); clearNostrLog(); resetPlanPull(); });
afterEach(() => { vi.restoreAllMocks(); reset(); });

/** A signed-in owner device that hasn't loaded the plan — the incident's computer. */
const planless = (extra: Record<string, unknown> = {}) =>
  useStore.setState({ nostrAuthEnabled: true, keyProvenance: 'external', planLoaded: false, ...extra } as never);

// ── Dates: month 1 starts on the 1st, three months before this one, so this month is month 4. ──
const now = new Date(todayLocalISO());
const isoUtc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const START = isoUtc(now.getUTCFullYear(), now.getUTCMonth() - 3, 1);
const inMonth = (n: number, day: number) => isoUtc(now.getUTCFullYear(), now.getUTCMonth() - 4 + n, day);   // n = 1..4
let seq = 0;
const ts = () => 1_700_000_000_000 + ++seq;
const draw = (amount: number, date: string): DayEvent => ({ id: `d${++seq}`, date, ts: ts(), kind: 'draw', amount });
const reading = (strikeBal: number, date: string): DayEvent => ({ id: `r${++seq}`, date, ts: ts(), kind: 'balanceReading', reading: { strikeBal, strikeLtv: 0.1 } });
const DAY_LOG: DayEvent[] = [
  draw(1000, inMonth(1, 10)), reading(5000, inMonth(1, 25)),
  draw(2000, inMonth(2, 10)), reading(6000, inMonth(2, 25)),
  draw(3000, inMonth(3, 10)), reading(7000, inMonth(3, 25)),
  draw(4000, inMonth(4, 1)),  reading(8000, inMonth(4, 1)),
];
const entry = (m: number, confirmed: boolean): MonthlyLogEntry => ({
  month: m, date: inMonth(m, 1), btcBought: 0, income: 0, paydown: 0, strikeBal: 0, strikeLtv: 0, loggedAt: 1, updatedAt: 1, expensesActual: 0,
  ...rollupMonth(DAY_LOG, m, START, priorStocksForMonth(DAY_LOG, START, m)).entry, source: 'daily', confirmed,
});
const JOURNAL = () => [entry(1, true), entry(2, true), entry(3, true), entry(4, false)];
const months = () => useStore.getState().monthlyLog.map((e) => [e.month, e.expensesActual, e.strikeBal, e.confirmed]);

describe('planMissing — who waits', () => {
  const base = { nostrAuthEnabled: true, viewerMode: false, planLoaded: false };
  it('a signed-in owner device without the plan waits — whatever its key (the plan lives in the store, not the key)', () => {
    expect(planMissing(base)).toBe(true);
    expect(planMissing({ ...base, keyProvenance: 'generated' } as never)).toBe(true);   // a key made here, store rebuilt
  });
  it('it stops waiting once the plan is loaded; a device not signed in and a viewer never wait', () => {
    expect(planMissing({ ...base, planLoaded: true })).toBe(false);
    expect(planMissing({ ...base, nostrAuthEnabled: false })).toBe(false);
    expect(planMissing({ ...base, viewerMode: true })).toBe(false);
  });

  it('⭐ MINT — minting a key here starts its plan here: the stamp sets planLoaded; an imported or extension key doesn\'t', () => {
    useStore.setState({ nostrAuthEnabled: true, keyProvenance: null, planLoaded: false } as never);
    useStore.getState().setKeyProvenance('external');
    expect(useStore.getState().planLoaded).toBe(false);
    useStore.setState({ keyProvenance: null } as never);
    useStore.getState().setKeyProvenance('imported');
    expect(useStore.getState().planLoaded).toBe(false);
    useStore.setState({ keyProvenance: null } as never);
    useStore.getState().setKeyProvenance('generated');
    expect(useStore.getState().planLoaded).toBe(true);
    expect(planMissing(useStore.getState())).toBe(false);
    // A mint whose establish failed rolls the stamp back — and the plan with it, so a key signed in next waits.
    useStore.getState().setKeyProvenance(null);
    expect(useStore.getState().planLoaded).toBe(false);
    useStore.getState().setKeyProvenance('imported');
    expect(planMissing(useStore.getState())).toBe(true);
  });
});

describe('⭐ GUARD — the store refuses every plan-dependent journal write while the plan is missing', () => {
  const ev: DayEvent = { id: 'x1', date: todayLocalISO(), ts: 1, kind: 'draw', amount: 100 };

  it('day events: add, update, delete and undo change nothing', () => {
    useStore.setState({ dayLog: [ev] } as never);
    planless();
    const s = useStore.getState();
    s.addDayEvent({ ...ev, id: 'x2' });
    s.updateDayEvent({ ...ev, amount: 999 });
    s.deleteDayEvent('x1');
    s.undoDayEventDeletion({ ...ev, id: 'x3' });
    const after = useStore.getState();
    expect(after.dayLog).toEqual([ev]);
    expect(after.deletedDayEvents).toEqual({});
    expect(after.monthlyLog).toEqual([]);
    expect(after.recordsDirty).toBe(false);
    expect(getNostrLog().filter((e) => e.msg.startsWith('day event write refused'))).toHaveLength(4);
  });

  it('the monthly log: a manual log, a delete, a sign-off and a reopen change nothing', () => {
    useStore.setState({ monthlyLog: JOURNAL(), advisorStartDate: START, dayLog: DAY_LOG } as never);
    planless();
    const before = useStore.getState().monthlyLog;
    const s = useStore.getState();
    s.upsertLogEntry({ ...entry(2, true), expensesActual: 1 });
    s.deleteLogEntry(3);
    s.confirmMonth(4, { expensesActual: 7 });
    s.unconfirmMonth(1);
    const after = useStore.getState();
    expect(after.monthlyLog).toBe(before);   // not even a new array
    expect(after.deletedMonths).toEqual({});
    expect(after.recordsDirty).toBe(false);
  });

  it('⭐ PLAN EDITS — the setup modal\'s save, a viewer added, the Coinbase collateral: no event, no change, nothing dirty', () => {
    planless();
    const before = useStore.getState();
    const s = useStore.getState();
    s.setIncome(4321); s.setExpenses(1234); s.setCreditLine(20000); s.setAdvisorMonthStartBalance(500);   // the modal's four
    s.addViewerSlot({ pubkeyHex: 'cd'.repeat(32), npub: 'npub1x', label: 'V', tier: 'safe', keyVersion: 1 } as never);
    s.setCbCollateralBtc(2);
    const after = useStore.getState();
    expect(after.planEvents).toEqual([]);
    expect(after.planDirty).toBe(false);
    expect([after.income, after.expenses, after.creditLine, after.advisorMonthStartBalance]).toEqual(
      [before.income, before.expenses, before.creditLine, before.advisorMonthStartBalance]);
    expect(after.viewers).toEqual([]);
    expect(after.cbCollateralBtc).toBe(before.cbCollateralBtc);
    expect(after.dayLog).toEqual([]);
    expect(getNostrLog().filter((e) => e.msg.startsWith('plan edit refused'))).toHaveLength(5);
  });

  it('⭐ RELAYS — a relay edit stays on this device (it can look elsewhere for the plan), with no plan event', () => {
    planless();
    useStore.getState().setNostrRelaysAndSync(['wss://elsewhere.example']);
    expect(useStore.getState().nostrRelays).toEqual(['wss://elsewhere.example']);
    expect(useStore.getState().planEvents).toEqual([]);
    expect(useStore.getState().planDirty).toBe(false);
  });

  it('⭐ LATCH — the key-custody stamp still goes through (it opens the gate a generated key\'s pull waits on)', () => {
    planless({ isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk' });
    useStore.getState().setBackupVerifiedAt(1_700_000_000_000);
    expect(useStore.getState().backupVerifiedAt).toBe(1_700_000_000_000);
    expect(useStore.getState().planEvents.map((e) => e.field)).toEqual(['backupVerifiedAt']);
  });

  it('non-vacuity: plan edits and a relay edit emit once the plan is loaded', () => {
    planless({ planLoaded: true });
    useStore.getState().setIncome(4321);
    useStore.getState().setNostrRelaysAndSync(['wss://elsewhere.example']);
    expect(useStore.getState().planEvents.map((e) => e.field).sort()).toEqual(['income', 'nostrRelays']);
    expect(useStore.getState().planDirty).toBe(true);
  });

  it('non-vacuity: the same writes land once the plan is loaded', () => {
    useStore.setState({ monthlyLog: JOURNAL(), advisorStartDate: START, dayLog: DAY_LOG } as never);
    planless({ planLoaded: true });
    useStore.getState().unconfirmMonth(1);
    useStore.getState().addDayEvent({ id: 'x9', date: inMonth(4, 1), ts: ts(), kind: 'draw', amount: 50 });
    const after = useStore.getState();
    expect(after.monthlyLog.find((e) => e.month === 1)?.confirmed).toBe(false);
    expect(after.dayLog.some((e) => e.id === 'x9')).toBe(true);
    expect(after.recordsDirty).toBe(true);
  });
});

describe('⭐ INCIDENT — the one-shot reconcile on a device whose plan did not load (5b spec §16)', () => {
  // The seed plan's start date is today: every past day event clamps to month 1.
  const seedIncident = () => useStore.setState({
    advisorStartDate: todayLocalISO(), dayLog: DAY_LOG, monthlyLog: JOURNAL(), deletedMonths: {}, recordsDirty: false,
    monthBucketReconcileDone: false,
  } as never);

  it('planless: the reconcile does nothing — months 1–4 and their sign-offs stay, no tombstone — and the flag waits', () => {
    seedIncident();
    planless();
    const before = months();
    useStore.getState().reconcileMonthBuckets();
    expect(months()).toEqual(before);
    expect(useStore.getState().deletedMonths).toEqual({});
    expect(useStore.getState().monthBucketReconcileDone).toBe(false);   // it runs once the plan loads
  });

  it('the premise (what the guard prevents): with the plan marked loaded but the seed start date, months 2–4 go', () => {
    seedIncident();
    planless({ planLoaded: true });
    useStore.getState().reconcileMonthBuckets();
    expect(useStore.getState().monthlyLog.map((e) => e.month)).toEqual([1]);
    expect(Object.keys(useStore.getState().deletedMonths).sort()).toEqual(['2', '3', '4']);
  });

  it('once the plan loads (its real start date), the reconcile is a no-op and the sign-offs stand', () => {
    seedIncident();
    planless();
    useStore.getState().reconcileMonthBuckets();                                      // refused
    useStore.setState({ advisorStartDate: START, planLoaded: true } as never);         // the plan arrives
    useStore.getState().reconcileMonthBuckets();
    expect(months()).toEqual(JOURNAL().map((e) => [e.month, e.expensesActual, e.strikeBal, e.confirmed]));
    expect(useStore.getState().monthBucketReconcileDone).toBe(true);
  });
});

describe('⭐ HYDRATE — two device flags settled at every hydration (hydrateDeviceFlags)', () => {
  const merged = (over: Partial<StoreState>) => ({ ...useStore.getState(), ...over }) as StoreState;

  it('a fresh store (nothing persisted) holds no plan, and has no journal to re-bucket', () => {
    const out = hydrateDeviceFlags(merged({ planLoaded: false, monthBucketReconcileDone: false }), undefined);
    expect(out.planLoaded).toBe(false);
    expect(out.monthBucketReconcileDone).toBe(true);
  });

  it('no stored blob: nothing is derived — the escape hatch on a key made here holds no plan; a session\'s own is kept', () => {
    expect(hydrateDeviceFlags(merged({ keyProvenance: 'generated', planEvents: [], planLoaded: false }), undefined).planLoaded).toBe(false);
    const ev = { id: 'income-1-a', ts: 1, device: 'd', kind: 'set', field: 'income', value: 4000 } as never;
    expect(hydrateDeviceFlags(merged({ keyProvenance: 'generated', planEvents: [ev], planLoaded: false }), undefined).planLoaded).toBe(false);
    expect(hydrateDeviceFlags(merged({ planLoaded: true }), undefined).planLoaded).toBe(true);   // a rehydrate that found no blob
  });

  it('a blob from before 5c: it held the plan iff it synced one (a plan log and a plan sync time), or it minted the key', () => {
    const ev = { id: 'income-1-a', ts: 1, device: 'd', kind: 'set', field: 'income', value: 4000 } as never;
    const blob = (over: Partial<StoreState>) => hydrateDeviceFlags(merged(over), { ...over }).planLoaded;
    expect(blob({ planEvents: [ev], lastPlanEventsSyncAt: 1_700_000_000, keyProvenance: 'imported' })).toBe(true);
    expect(blob({ planEvents: [ev], lastPlanEventsSyncAt: null, keyProvenance: 'imported' })).toBe(false);   // edits that never met the relays
    expect(blob({ planEvents: [], lastPlanEventsSyncAt: 1_700_000_000, keyProvenance: 'external' })).toBe(false);
    expect(blob({ planEvents: [], lastPlanEventsSyncAt: null, keyProvenance: 'generated' })).toBe(true);
  });

  it('a blob that carries planLoaded keeps it', () => {
    expect(hydrateDeviceFlags(merged({ planLoaded: true, planEvents: [] }), { planLoaded: true }).planLoaded).toBe(true);
    const ev = { id: 'income-1-a', ts: 1, device: 'd', kind: 'set', field: 'income', value: 4000 } as never;
    expect(hydrateDeviceFlags(merged({ planLoaded: false, planEvents: [ev] }), { planLoaded: false }).planLoaded).toBe(false);
  });

  it('the reconcile flag: false with a stored journal stays false (a store from before the fix); false with none settles', () => {
    const withJournal = merged({ monthBucketReconcileDone: false, monthlyLog: JOURNAL(), dayLog: DAY_LOG });
    expect(hydrateDeviceFlags(withJournal, { monthBucketReconcileDone: false }).monthBucketReconcileDone).toBe(false);
    const dayLogOnly = merged({ monthBucketReconcileDone: false, monthlyLog: [], dayLog: DAY_LOG });
    expect(hydrateDeviceFlags(dayLogOnly, { monthBucketReconcileDone: false }).monthBucketReconcileDone).toBe(false);
    const empty = merged({ monthBucketReconcileDone: false, monthlyLog: [], dayLog: [] });
    expect(hydrateDeviceFlags(empty, { monthBucketReconcileDone: false }).monthBucketReconcileDone).toBe(true);
    expect(hydrateDeviceFlags(merged({ monthBucketReconcileDone: true }), {}).monthBucketReconcileDone).toBe(true);
  });

  it('⭐ MERGE — the persist merge settles both flags (the wiring, not just the helper)', () => {
    const current = { ...useStore.getState(), planLoaded: false, monthBucketReconcileDone: false } as StoreState;
    const fresh = persistOptions.merge!(undefined, current) as StoreState;
    expect(fresh.planLoaded).toBe(false);
    expect(fresh.monthBucketReconcileDone).toBe(true);
    const ev = { id: 'income-1-a', ts: 1, device: 'd', kind: 'set', field: 'income', value: 4000 } as never;
    const old = persistOptions.merge!({ planEvents: [ev], lastPlanEventsSyncAt: 1_700_000_000, monthBucketReconcileDone: true }, current) as StoreState;
    expect(old.planLoaded).toBe(true);
  });

  it('⭐ VIEWER CLEAR — resetting the plan in place leaves a store that holds no plan and nothing to re-bucket', () => {
    useStore.setState({ planLoaded: true, monthBucketReconcileDone: false, monthlyLog: JOURNAL(), dayLog: DAY_LOG } as never);
    useStore.getState().clearViewerData();
    expect(useStore.getState().planLoaded).toBe(false);
    expect(useStore.getState().monthBucketReconcileDone).toBe(true);
    useStore.setState({ planLoaded: true } as never);
    useStore.getState().resetPlanToSeeds();
    expect(useStore.getState().planLoaded).toBe(false);
  });

  it('a restored backup is this device\'s plan: applyPlanBackup sets planLoaded', () => {
    planless();
    useStore.getState().applyPlanBackup({ plan: { settings: {}, records: { monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {} } } } as never);
    expect(useStore.getState().planLoaded).toBe(true);
    expect(planMissing(useStore.getState())).toBe(false);
  });
});

describe('⭐ HELD — a device without the plan publishes no plan, no journal and no viewer snapshot', () => {
  const signedIn = (extra: Record<string, unknown> = {}) => planless({
    isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', initialSettingsPullDone: true, ...extra,
  });

  it('the plan and the journal are held at the gate — before setNostrSyncing, dirty flags kept — and say why', async () => {
    signedIn({ planDirty: true, recordsDirty: true });
    const syncSpy = vi.fn();
    useStore.setState({ setNostrSyncing: syncSpy } as never);
    expect(await publishPlanEventsNow()).toBe(false);
    expect(await publishRecordsNowImmediate()).toBe(false);
    expect(heldWithoutPlan('plan')).toBe(true);
    expect(heldWithoutPlan('records')).toBe(true);
    expect(syncSpy).not.toHaveBeenCalled();
    expect(useStore.getState().planDirty).toBe(true);
    expect(useStore.getState().recordsDirty).toBe(true);
    useStore.setState({ setNostrSyncing: SEED.setNostrSyncing } as never);
  });

  it('non-vacuity: with the plan loaded both pass the gate (they fail downstream on the stub signer, network-free)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    signedIn({ planLoaded: true, planDirty: true, recordsDirty: true });
    const syncSpy = vi.fn();
    useStore.setState({ setNostrSyncing: syncSpy } as never);
    await publishPlanEventsNow();
    await publishRecordsNowImmediate();
    expect(heldWithoutPlan('plan')).toBe(false);
    expect(heldWithoutPlan('records')).toBe(false);
    expect(syncSpy).toHaveBeenCalledWith(true);
    useStore.setState({ setNostrSyncing: SEED.setNostrSyncing } as never);
  });

  it('the public relay list (NIP-65) isn\'t published from a device whose list isn\'t the plan\'s yet', async () => {
    signedIn();
    const syncSpy = vi.fn();
    useStore.setState({ setNostrSyncing: syncSpy } as never);
    expect(await publishRelayListToNip65()).toBe(false);
    expect(syncSpy).not.toHaveBeenCalled();
    expect(getNostrLog().some((e) => e.msg.startsWith('relay list publish held'))).toBe(true);
    useStore.setState({ setNostrSyncing: SEED.setNostrSyncing } as never);
  });

  it('the viewer fan-out never sends a snapshot of the seed plan', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const viewers = [{ pubkeyHex: 'ab'.repeat(32), tier: 'safe', label: 'v' }];
    signedIn({ viewers });
    await publishViewerSnapshotNow();
    expect(getNostrLog().some((e) => e.msg.startsWith('viewer fan-out'))).toBe(false);
    signedIn({ viewers, planLoaded: true });                     // non-vacuity: it attempts (and fails on the stub signer)
    await publishViewerSnapshotNow();
    expect(getNostrLog().some((e) => e.msg.startsWith('viewer fan-out'))).toBe(true);
  });
});

describe('⭐ START — after a pull that found nothing, the owner decides; the device never does', () => {
  it('"Start a new plan" loads the plan only after a confirm, only on \'none\', only while waiting', () => {
    planless();
    expect(startNewPlanHere(() => true)).toBe(false);                    // no pull has said 'none'
    recordPlanPull({ status: 'unreadable', at: 1, reason: 'absent' });
    expect(startNewPlanHere(() => true)).toBe(false);                    // a journal without a plan: never offered
    recordPlanPull({ status: 'none', at: 1 });
    expect(startNewPlanHere(() => false)).toBe(false);                   // declined
    expect(useStore.getState().planLoaded).toBe(false);
    expect(startNewPlanHere(() => true)).toBe(true);
    expect(useStore.getState().planLoaded).toBe(true);
    expect(planMissing(useStore.getState())).toBe(false);
    expect(startNewPlanHere(() => true)).toBe(false);                    // not waiting any more
  });
});
