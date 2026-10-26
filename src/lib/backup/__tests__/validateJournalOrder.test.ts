import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage BEFORE the store import (buildPlanBackup pulls useStore, whose module-init seeds touch it).
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { validatePlanBackup } from '../validatePlanBackup';
import { buildPlanBackup } from '../exportPlan';
import { useStore } from '../../../store/useStore';
import { todayLocalISO } from '../../../utils/format';

// Hotfix 1 — the backup accepts what the app itself writes. A file is what JSON makes of the store, and JSON writes a
// non-finite number as null.
const fileOf = () => JSON.parse(JSON.stringify(buildPlanBackup(useStore.getState())));

beforeEach(() => {
  useStore.setState({
    monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {}, recordsDirty: false,
    advisorStartDate: todayLocalISO(), advisorActualBlocBalance: 0, advisorActualBlocBalanceAsOf: null,
    hasCbLoan: false, btcPrice: 100_000, strikeCollateralBtc: 0, cbCollateralBtc: 0,
    isAuthenticated: false, nostrSigner: null, nostrPubkey: '', planEvents: [],
  } as never);
});

describe('A2-2 — a Strike balance with no Strike collateral leaves a backup that restores', () => {
  it('A2-2 P4 · emitBalanceReading({ strikeBal: 5000 }) with no collateral: the month\'s LTV is ∞, the file says null, and it validates', () => {
    useStore.getState().emitBalanceReading({ strikeBal: 5_000 });
    const m1 = useStore.getState().monthlyLog.find((e) => e.month === 1)!;
    expect(m1.strikeLtv).toBe(Number.POSITIVE_INFINITY);       // premise: Strike's own figure — debt with nothing behind it
    const file = fileOf();
    expect(file.plan.records.monthlyLog[0].strikeLtv).toBeNull();
    const r = validatePlanBackup(file);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary.months).toBe(1);
  });

  it('a month entry\'s strikeLtv may be null, but never missing or another type', () => {
    useStore.getState().emitBalanceReading({ strikeBal: 5_000, strikeCollateral: 1 });
    const ok = fileOf();
    expect(validatePlanBackup(ok).ok).toBe(true);
    for (const bad of [undefined, '0.05', true, {}]) {
      const f = fileOf();
      if (bad === undefined) delete f.plan.records.monthlyLog[0].strikeLtv;
      else f.plan.records.monthlyLog[0].strikeLtv = bad;
      const r = validatePlanBackup(f);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.code).toBe('bad-records');
    }
  });

  it('the other required month figures still refuse a null', () => {
    useStore.getState().emitBalanceReading({ strikeBal: 5_000, strikeCollateral: 1 });
    for (const k of ['btcBought', 'income', 'paydown', 'strikeBal', 'expensesActual']) {
      const f = fileOf();
      f.plan.records.monthlyLog[0][k] = null;
      expect(validatePlanBackup(f).ok).toBe(false);
    }
  });
});

describe('Hotfix 1 — a day event\'s `at` (its place in the day) rides the backup', () => {
  it('an edited event keeps its `at` through the file, and the file validates', () => {
    useStore.getState().addDayEvent({ id: 'd', date: todayLocalISO(), ts: 1000, kind: 'deposit', amount: 0.1, target: 'strike' });
    useStore.getState().updateDayEvent({ id: 'd', date: todayLocalISO(), ts: 1000, kind: 'deposit', amount: 0.2, target: 'strike' });
    const f = fileOf();
    expect(f.plan.records.dayLog[0].at).toBe(1000);
    expect(validatePlanBackup(f).ok).toBe(true);
  });

  it('an `at` that is not a finite number is a malformed day event', () => {
    useStore.getState().addDayEvent({ id: 'd', date: todayLocalISO(), ts: 1000, kind: 'deposit', amount: 0.1, target: 'strike' });
    for (const bad of ['1000', null, true]) {
      const f = fileOf();
      f.plan.records.dayLog[0].at = bad;
      const r = validatePlanBackup(f);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.message).toBe('This backup contains a malformed day event.');
    }
  });
});
