import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 5a — the plan log's size on the REAL store (spec `pbloc-spec-plan-log-size-v1`): the emit compacts as the log grows,
// so a slider drag leaves one event per field on every device, and the publish sends a log inside the budget even when
// the stored one isn't (a log grown by an older build). Every ⭐ is proven red by a named mutation (the spec's
// Appendix P). Round synthetic figures only — this repo is public.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { useStore } from '../useStore';
import { publishPlanEventsNow } from '../../lib/nostr/syncEngine';
import { foldPlanEvents } from '../../lib/planEvents/fold';
import { BURST_WINDOW_MS, PLAN_LOG_BUDGET_BYTES } from '../../lib/planEvents/compact';
import type { PlanEvent } from '../../lib/planEvents/types';

const T0 = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
const events = (field: string) => useStore.getState().planEvents.filter((e) => e.field === field);
const signedOut = {
  isAuthenticated: false, nostrSigner: null, nostrPubkey: '', keyProvenance: null, initialSettingsPullDone: false,
};

beforeEach(() => {
  vi.useFakeTimers();   // the emit's 2s publish kick never fires; Date.now() moves only when the test moves it
  vi.setSystemTime(T0);
  useStore.setState({ ...signedOut, planEvents: [], planDirty: false, viewerMode: false } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  useStore.setState({ ...signedOut, planEvents: [], planDirty: false } as never);
});

describe('5a — the emit compacts as the log grows', () => {
  it('⭐ EMIT drag — 173 notches of the income slider, 17 ms apart, leave ONE income event: the last value, in the fold and the scalar', () => {
    const { setIncome } = useStore.getState();
    for (let i = 0; i < 173; i++) { setIncome(1000 + i * 500); vi.advanceTimersByTime(17); }
    const inc = events('income');
    expect(inc.length, 'EMIT drag one event').toBe(1);
    expect(inc[0].value, 'EMIT drag last value').toBe(1000 + 172 * 500);
    expect(useStore.getState().income, 'EMIT drag scalar').toBe(1000 + 172 * 500);
    expect(foldPlanEvents(useStore.getState().planEvents).income, 'EMIT drag fold').toBe(1000 + 172 * 500);
    expect(useStore.getState().planDirty, 'EMIT drag dirty').toBe(true);
  });

  it('⭐ EMIT pause — a drag with a 5-second rest in the middle (a finger held still) is still one burst', () => {
    const { setIncome } = useStore.getState();
    for (let i = 0; i < 20; i++) { setIncome(1000 + i * 100); vi.advanceTimersByTime(17); }
    vi.advanceTimersByTime(5_000);
    for (let i = 20; i < 40; i++) { setIncome(1000 + i * 100); vi.advanceTimersByTime(17); }
    expect(events('income').map((e) => e.value), 'EMIT pause').toEqual([1000 + 39 * 100]);
  });

  it('⭐ EMIT history — two edits 15 seconds apart (a deliberate re-edit) stay two events, and the next emit\'s ts still advances', () => {
    const { setIncome, setExpenses } = useStore.getState();
    setIncome(4000);
    vi.advanceTimersByTime(15_000);
    setIncome(5000);
    expect(events('income').map((e) => e.value), 'EMIT history').toEqual([4000, 5000]);
    const lastTs = Math.max(...useStore.getState().planEvents.map((e) => e.ts));
    setExpenses(3000);
    expect(events('expenses')[0].ts, 'EMIT ts advances').toBeGreaterThan(lastTs);
  });

  it('⭐ EMIT pairs — dragging the paired-AsOf setter leaves one balance and one AsOf event, at one ts', () => {
    const { setAdvisorActualBlocBalance } = useStore.getState();
    for (let i = 0; i < 40; i++) { setAdvisorActualBlocBalance(10_000 + i * 100); vi.advanceTimersByTime(20); }
    const bal = events('advisorActualBlocBalance');
    const asOf = events('advisorActualBlocBalanceAsOf');
    expect([bal.length, asOf.length], 'EMIT pairs').toEqual([1, 1]);
    expect(bal[0].ts, 'EMIT pairs one ts').toBe(asOf[0].ts);
    expect(bal[0].value, 'EMIT pairs last value').toBe(10_000 + 39 * 100);
  });

  it('⭐ EMIT other fields — a drag of one field never drops another field\'s events', () => {
    const { setIncome, setExpenses } = useStore.getState();
    setExpenses(3000);
    vi.advanceTimersByTime(BURST_WINDOW_MS + 1);
    setExpenses(3500);
    for (let i = 0; i < 50; i++) { setIncome(1000 + i * 100); vi.advanceTimersByTime(17); }
    expect(events('expenses').map((e) => e.value), 'EMIT other fields').toEqual([3000, 3500]);
    expect(events('income').length, 'EMIT other fields drag').toBe(1);
  });
});

describe('5a — the publish sends a log inside the budget', () => {
  it('⭐ PUBLISH — a stored log grown by an older build (a drag, and history past the budget) is compacted before it goes out', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ev = (id: string, ts: number, field: string, value: number): PlanEvent =>
      ({ id, ts, device: 'old', kind: 'set', field: field as PlanEvent['field'], value });
    const history = Array.from({ length: 600 }, (_, i) => ev(`income-old-${i}`, T0 - 10 * DAY + i * 60_000, 'income', 1000 + i));
    const dragged = Array.from({ length: 173 }, (_, i) => ev(`expenses-drag-${i}`, T0 - DAY + i * 17, 'expenses', 2000 + i));
    const stored = [...history, ...dragged];
    expect(bytes({ events: stored }), 'PUBLISH premise: past the 40,960 B step').toBeGreaterThan(40_960);
    useStore.setState({
      planEvents: stored, isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', keyProvenance: 'imported',
      initialSettingsPullDone: true, planDirty: true,
    } as never);
    // The stub signer has no nip44: the publish compacts and persists the log, then fails downstream (network-free).
    expect(await publishPlanEventsNow(), 'PUBLISH reaches the encrypt').toBe(false);
    const log = useStore.getState().planEvents;
    expect(bytes({ events: log }), 'PUBLISH inside the budget — the payload it sends').toBeLessThanOrEqual(PLAN_LOG_BUDGET_BYTES);
    expect(foldPlanEvents(log), 'PUBLISH fold unchanged').toEqual(foldPlanEvents(stored));
    expect(log.filter((e) => e.field === 'expenses').map((e) => e.id), 'PUBLISH the drag').toEqual(['expenses-drag-172']);
    const ids = new Set(log.map((e) => e.id));
    expect([ids.has('income-old-599'), ids.has('income-old-0')], 'PUBLISH oldest first').toEqual([true, false]);
  });
});
