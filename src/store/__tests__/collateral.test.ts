import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory localStorage BEFORE the store import (vi.hoisted runs first) — zustand persist
// touches storage at module load; this keeps the suite warning-free and deterministic.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem:    (k: string) => mem.get(k) ?? null,
    setItem:    (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { useStore } from '../useStore';
import { computeStrikeLtv } from '../../simulation/strikeCredit';
import { todayLocalISO } from '../../utils/format';
import type { MonthlyLogEntry, DayEvent } from '../../simulation/types';

// The 1st of the month `monthsBack` calendar months before today (deterministic bucketing).
const startMonthsBack = (monthsBack: number): string => {
  const d = new Date();
  const norm = new Date(d.getFullYear(), d.getMonth() - monthsBack, 1);
  return `${norm.getFullYear()}-${String(norm.getMonth() + 1).padStart(2, '0')}-01`;
};

const TODAY = todayLocalISO();
let seq = 0;
const eid = () => `ev${++seq}`;
// A balanceReading carrying strikeCollateral — the reading-anchored Strike collateral source (v20).
const reading = (strikeCollateral: number, ts: number, date = TODAY): DayEvent =>
  ({ id: eid(), date, ts, kind: 'balanceReading', reading: { strikeBal: 1000, strikeLtv: 0.1, strikeCollateral } });
const deposit = (amount: number, target: 'strike' | 'cb', ts: number, date = TODAY): DayEvent =>
  ({ id: eid(), date, ts, kind: 'deposit', amount, target });

function makeEntry(month: number, overrides: Partial<MonthlyLogEntry> = {}): MonthlyLogEntry {
  return {
    month,
    date:           `2026-0${month}-01`,
    btcBought:      0.05,
    income:         500,
    paydown:        0,
    strikeBal:      1000,
    strikeLtv:      0.1,
    loggedAt:       1000 + month,
    btcHeld:        0,
    expensesActual: 3500,
    ...overrides,
  };
}

function resetStore(overrides: Record<string, unknown> = {}) {
  useStore.setState({
    monthlyLog: [],
    deletedMonths: {},
    dayLog: [],
    deletedDayEvents: {},
    strikeCollateralBtc: 0.50,        // reading-anchored cache seed (fallback when no reading)
    sandboxCollateralBtc: null,
    advisorActualBtcHeld: 0.50,       // the month-0 baseline (historical only)
    advisorActualBlocBalance: 0,
    advisorStartDate: startMonthsBack(4),
    isAuthenticated: false,           // publishRecordsNow + syncSettingsToNostr early-return
    settingsDirty: false,
    recordsDirty: false,
    nostrSigner: null,
    nostrPubkey: '',
    ...overrides,
  } as never);
}

describe('reading-anchored Strike collateral — store (Collateral-Truth v20)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    resetStore();
  });

  it('a balanceReading with strikeCollateral anchors getCurrentBtcHeld', () => {
    expect(useStore.getState().getCurrentBtcHeld()).toBeCloseTo(0.50);   // fallback = seeded cache, no reading yet
    useStore.getState().addDayEvent(reading(0.70, 100));
    expect(useStore.getState().getCurrentBtcHeld()).toBeCloseTo(0.70);   // anchored to the reading
    expect(useStore.getState().strikeCollateralBtc).toBeCloseTo(0.70);   // cache folded
  });

  it('a post-anchor deposit target:strike adjusts current forward', () => {
    useStore.getState().addDayEvent(reading(0.70, 100));
    useStore.getState().addDayEvent(deposit(0.10, 'strike', 200));       // strictly after → +0.10
    expect(useStore.getState().getCurrentBtcHeld()).toBeCloseTo(0.80);
  });

  it('SEMANTIC SHIFT — a bare deposit target:strike with NO reading does NOT move current', () => {
    useStore.getState().addDayEvent(deposit(0.10, 'strike', 100));       // no anchor → returns the fallback cache
    expect(useStore.getState().getCurrentBtcHeld()).toBeCloseTo(0.50);   // unchanged (0.50 seed)
  });

  it('target:cb deposit never touches Strike collateral', () => {
    useStore.getState().addDayEvent(reading(0.70, 100));
    useStore.getState().addDayEvent(deposit(0.40, 'cb', 200));
    expect(useStore.getState().getCurrentBtcHeld()).toBeCloseTo(0.70);   // unchanged
  });

  it('latest strikeCollateral reading wins (re-anchor)', () => {
    useStore.getState().addDayEvent(reading(0.70, 100, '2026-05-10'));
    useStore.getState().addDayEvent(reading(0.90, 200, '2026-05-20'));   // later date → new anchor
    expect(useStore.getState().getCurrentBtcHeld()).toBeCloseTo(0.90);
  });

  it('Strike LTV tracks getCurrentBtcHeld (current position), not the frozen baseline', () => {
    useStore.getState().addDayEvent(reading(0.80, 100));
    const s = useStore.getState();
    const bloc = 30_000, price = 100_000;
    expect(s.getCurrentBtcHeld()).toBeCloseTo(0.80);
    expect(s.getCurrentBtcHeld()).not.toBeCloseTo(s.advisorActualBtcHeld);   // current ≠ baseline
    const ltvCurrent  = computeStrikeLtv(bloc, s.getCurrentBtcHeld(), price);     // 30k / 80k
    const ltvBaseline = computeStrikeLtv(bloc, s.advisorActualBtcHeld, price);    // 30k / 50k (stale)
    expect(ltvCurrent).toBeCloseTo(0.375);
    expect(ltvBaseline).toBeCloseTo(0.60);
    expect(ltvCurrent).toBeLessThan(ltvBaseline);
  });

  it('baseline stability: advisorActualBtcHeld never moves through readings/deposits', () => {
    useStore.getState().addDayEvent(reading(0.70, 100));
    useStore.getState().addDayEvent(deposit(0.10, 'strike', 200));
    expect(useStore.getState().advisorActualBtcHeld).toBe(0.50);
  });

  it('setDayLog folds the strike derive (sync/merge apply path)', () => {
    useStore.getState().setDayLog([reading(1.10, 100)]);
    expect(useStore.getState().strikeCollateralBtc).toBeCloseTo(1.10);
    expect(useStore.getState().getCurrentBtcHeld()).toBeCloseTo(1.10);
  });

  it('sandbox isolation: setSandboxCollateralBtc touches nothing real', () => {
    useStore.getState().setSandboxCollateralBtc(2.0);
    const s = useStore.getState();
    expect(s.sandboxCollateralBtc).toBe(2.0);
    expect(s.advisorActualBtcHeld).toBe(0.50);
    expect(s.getCurrentBtcHeld()).toBeCloseTo(0.50);   // still the fallback (no reading)
  });

  it('delete mid-log month re-chains later entries (historical chain) + writes the tombstone', () => {
    useStore.getState().upsertLogEntry(makeEntry(1));
    useStore.getState().upsertLogEntry(makeEntry(2));
    useStore.getState().upsertLogEntry(makeEntry(3));
    expect(useStore.getState().monthlyLog[2].btcHeld).toBeCloseTo(0.65);   // recomputeBtcHeld: 0.50 baseline + 3×0.05

    useStore.getState().deleteLogEntry(2);

    const s = useStore.getState();
    expect(s.monthlyLog.map((e) => e.month)).toEqual([1, 3]);
    expect(s.monthlyLog[1].btcHeld).toBeCloseTo(0.60);   // re-chained: 0.50 + 0.05 + 0.05
    expect(s.deletedMonths[2]).toBeTruthy();
  });
});

describe('expense re-anchor reset hook (spec §9)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    resetStore();
  });

  it('setExpenses re-anchors AND clears expenseReanchorDismissedAt (covers Update + manual edits)', () => {
    useStore.setState({ expenseReanchorDismissedAt: 4000 } as never);
    useStore.getState().setExpenses(4200);   // the Update button calls this with Math.round(avg)
    expect(useStore.getState().expenses).toBe(4200);
    expect(useStore.getState().expenseReanchorDismissedAt).toBe(0);
  });
});
