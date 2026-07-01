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
import type { MonthlyLogEntry } from '../../simulation/types';

const monthsAgo = (n: number) =>
  new Date(Date.now() - n * 30.4375 * 86400000).toISOString().split('T')[0];

const CURRENT = 5;   // advisorStartDate = monthsAgo(4.5) → getCurrentStrategyMonth = 5

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
    pendingCollateralAdjustment: 0,
    sandboxCollateralBtc: null,
    advisorActualBtcHeld: 0.50,      // the month-0 baseline
    advisorActualBlocBalance: 0,
    advisorStartDate: monthsAgo(4.5),
    isAuthenticated: false,           // publishRecordsNow + syncSettingsToNostr early-return
    settingsDirty: false,
    recordsDirty: false,
    nostrSigner: null,
    nostrPubkey: '',
    ...overrides,
  } as never);
}

describe('dated collateral — store actions (spec v4)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    resetStore();
  });

  it('adjustCurrentCollateral: pending updates, current === target, prior entries untouched', () => {
    useStore.getState().upsertLogEntry(makeEntry(1));
    useStore.getState().upsertLogEntry(makeEntry(2));
    expect(useStore.getState().getCurrentBtcHeld()).toBeCloseTo(0.60);   // 0.50 + 0.05 + 0.05

    useStore.getState().adjustCurrentCollateral(0.70);

    expect(useStore.getState().pendingCollateralAdjustment).toBeCloseTo(0.10);
    expect(useStore.getState().getCurrentBtcHeld()).toBeCloseTo(0.70);
    const log = useStore.getState().monthlyLog;
    expect(log[0].btcHeld).toBeCloseTo(0.55);   // entries do NOT move until graduation
    expect(log[1].btcHeld).toBeCloseTo(0.60);
  });

  it('Strike LTV tracks current position (getCurrentBtcHeld), not the frozen baseline', () => {
    // baseline 0.50; log a buy + a pending adjustment so current diverges from the baseline.
    useStore.getState().upsertLogEntry(makeEntry(1, { btcBought: 0.10 }));   // → 0.60
    useStore.getState().adjustCurrentCollateral(0.80);                       // +0.20 pending → 0.80
    const s = useStore.getState();
    const bloc = 30_000, price = 100_000;

    expect(s.getCurrentBtcHeld()).toBeCloseTo(0.80);
    expect(s.getCurrentBtcHeld()).not.toBeCloseTo(s.advisorActualBtcHeld);   // current ≠ baseline

    const ltvCurrent  = computeStrikeLtv(bloc, s.getCurrentBtcHeld(), price);     // 30k / 80k
    const ltvBaseline = computeStrikeLtv(bloc, s.advisorActualBtcHeld, price);    // 30k / 50k (stale)
    expect(ltvCurrent).toBeCloseTo(0.375);
    expect(ltvBaseline).toBeCloseTo(0.60);
    expect(ltvCurrent).toBeLessThan(ltvBaseline);   // more BTC (current) → lower, healthier LTV
  });

  it('graduation: current-month upsert folds pending into the entry, pending → 0', () => {
    useStore.getState().upsertLogEntry(makeEntry(1));
    useStore.getState().upsertLogEntry(makeEntry(2));
    useStore.getState().adjustCurrentCollateral(0.70);   // pending 0.10

    useStore.getState().upsertLogEntry(makeEntry(CURRENT));   // same API both commit paths use

    const s = useStore.getState();
    const cur = s.monthlyLog.find((e) => e.month === CURRENT)!;
    expect(cur.collateralAdjustment).toBeCloseTo(0.10);
    expect(cur.btcHeld).toBeCloseTo(0.75);                    // 0.60 + 0.05 buy + 0.10 adj
    expect(s.pendingCollateralAdjustment).toBe(0);
    expect(s.monthlyLog[0].btcHeld).toBeCloseTo(0.55);        // prior months unchanged
    expect(s.getCurrentBtcHeld()).toBeCloseTo(0.75);
  });

  it('preservation: re-upserting the logged current month with pending=0 keeps the stored adjustment', () => {
    useStore.getState().adjustCurrentCollateral(0.60);        // pending 0.10 (empty log: current=0.50)
    useStore.getState().upsertLogEntry(makeEntry(CURRENT));   // graduates
    useStore.getState().upsertLogEntry(makeEntry(CURRENT, { expensesActual: 4000 }));   // re-edit, pending 0

    const cur = useStore.getState().monthlyLog.find((e) => e.month === CURRENT)!;
    expect(cur.collateralAdjustment).toBeCloseTo(0.10);       // NOT wiped
    expect(cur.expensesActual).toBe(4000);
  });

  it('past-month upsert never graduates; pending untouched', () => {
    useStore.getState().adjustCurrentCollateral(0.60);   // pending 0.10
    useStore.getState().upsertLogEntry(makeEntry(2));    // past month

    const s = useStore.getState();
    expect(s.pendingCollateralAdjustment).toBeCloseTo(0.10);
    expect(s.monthlyLog.find((e) => e.month === 2)!.collateralAdjustment ?? 0).toBe(0);
  });

  it('withdrawal: negative pending graduates negative', () => {
    useStore.getState().adjustCurrentCollateral(0.30);   // current 0.50 → pending −0.20
    expect(useStore.getState().pendingCollateralAdjustment).toBeCloseTo(-0.20);

    useStore.getState().upsertLogEntry(makeEntry(CURRENT));
    const cur = useStore.getState().monthlyLog.find((e) => e.month === CURRENT)!;
    expect(cur.collateralAdjustment).toBeCloseTo(-0.20);
    expect(cur.btcHeld).toBeCloseTo(0.35);   // 0.50 + 0.05 − 0.20
  });

  it('baseline stability: advisorActualBtcHeld never moves through adjust/graduation/delete', () => {
    useStore.getState().adjustCurrentCollateral(0.70);
    useStore.getState().upsertLogEntry(makeEntry(CURRENT));
    useStore.getState().deleteLogEntry(CURRENT);
    expect(useStore.getState().advisorActualBtcHeld).toBe(0.50);
  });

  it('sandbox isolation: setSandboxCollateralBtc touches nothing real', () => {
    useStore.getState().setSandboxCollateralBtc(2.0);
    const s = useStore.getState();
    expect(s.sandboxCollateralBtc).toBe(2.0);
    expect(s.pendingCollateralAdjustment).toBe(0);
    expect(s.advisorActualBtcHeld).toBe(0.50);
    expect(s.getCurrentBtcHeld()).toBeCloseTo(0.50);
  });

  it('delete mid-log month re-chains later entries and writes the tombstone', () => {
    useStore.getState().upsertLogEntry(makeEntry(1));
    useStore.getState().upsertLogEntry(makeEntry(2));
    useStore.getState().upsertLogEntry(makeEntry(3));
    expect(useStore.getState().monthlyLog[2].btcHeld).toBeCloseTo(0.65);

    useStore.getState().deleteLogEntry(2);

    const s = useStore.getState();
    expect(s.monthlyLog.map((e) => e.month)).toEqual([1, 3]);
    expect(s.monthlyLog[1].btcHeld).toBeCloseTo(0.60);   // re-chained: 0.50 + 0.05 + 0.05
    expect(s.deletedMonths[2]).toBeTruthy();
  });

  it('delete current month after graduation → pending restored, entry gone, tombstone written', () => {
    useStore.getState().adjustCurrentCollateral(0.60);        // pending 0.10
    useStore.getState().upsertLogEntry(makeEntry(CURRENT));   // graduates, pending 0
    expect(useStore.getState().pendingCollateralAdjustment).toBe(0);

    useStore.getState().deleteLogEntry(CURRENT);

    const s = useStore.getState();
    expect(s.pendingCollateralAdjustment).toBeCloseTo(0.10);  // deposit survives un-logging
    expect(s.monthlyLog.find((e) => e.month === CURRENT)).toBeUndefined();
    expect(s.deletedMonths[CURRENT]).toBeTruthy();
  });

  it('past-month delete does NOT restore pending', () => {
    resetStore({ monthlyLog: [makeEntry(2, { collateralAdjustment: 0.10, btcHeld: 0.65 })] });
    useStore.getState().deleteLogEntry(2);
    expect(useStore.getState().pendingCollateralAdjustment).toBe(0);
  });

  it('adjustCurrentCollateral AND a graduating upsert both mark settingsDirty (pending is synced)', async () => {
    resetStore({ isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', initialSettingsPullDone: true });
    vi.useFakeTimers();

    useStore.getState().adjustCurrentCollateral(0.60);
    expect(useStore.getState().settingsDirty).toBe(true);

    useStore.setState({ settingsDirty: false } as never);
    useStore.getState().upsertLogEntry(makeEntry(CURRENT));   // graduates pending 0.10
    expect(useStore.getState().settingsDirty).toBe(true);

    vi.clearAllTimers();   // drop the 2s debounce before it fires publishSettingsNow
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 10));   // flush publishRecordsNow's rejected publish chain
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
