import { describe, it, expect } from 'vitest';
import type { DayEvent, MonthlyLogEntry } from '../types';
import { bucketEventToMonth, strategyMonthIndex, rollupMonth, deriveCbCollateral,
  strikeCollateralDelta, sameRollupFields, legacyBucketEventToMonth } from '../logUtils';

// Fixed absolute dates so bucketing is deterministic (bucketEventToMonth uses the event date, never Date.now()).
const START = '2025-01-01';
const M1 = '2025-01-05';   // ~4 days in → strategy month 1
const M2 = '2025-02-15';   // ~45 days in → strategy month 2

let seq = 0;
const id = () => `e${++seq}`;

const draw     = (amount: number, date = M1, ts = ++seq): DayEvent => ({ id: id(), date, ts, kind: 'draw', amount });
const paydown  = (amount: number, date = M1, ts = ++seq): DayEvent => ({ id: id(), date, ts, kind: 'paydown', amount });
const buy      = (amount: number, usd?: number, date = M1, ts = ++seq): DayEvent => ({ id: id(), date, ts, kind: 'buy', amount, usd });
const move     = (kind: 'deposit' | 'withdraw', amount: number, target: 'strike' | 'cb', date = M1, ts = ++seq): DayEvent =>
  ({ id: id(), date, ts, kind, amount, target });
const reading  = (r: { strikeBal: number; strikeLtv: number; cbBal?: number; cbLtv?: number; cbCollateral?: number; price?: number }, date = M1, ts = ++seq): DayEvent =>
  ({ id: id(), date, ts, kind: 'balanceReading', reading: r });
const cbColl   = (cbCollateral: number, date = M1, ts = ++seq): DayEvent => ({ id: id(), date, ts, kind: 'cbCollateralReading', cbCollateral });

describe('bucketEventToMonth', () => {
  it('(20) a date at the start of month 1 → 1; a date in month 2 → 2', () => {
    expect(bucketEventToMonth(START, START)).toBe(1);
    expect(bucketEventToMonth(M1, START)).toBe(1);
    expect(bucketEventToMonth(M2, START)).toBe(2);
  });

  it('clamps to 1–12', () => {
    expect(bucketEventToMonth('2020-01-01', START)).toBe(1);   // before start → clamped up to 1
    expect(bucketEventToMonth('2030-01-01', START)).toBe(12);  // far future → clamped to 12
  });
});

// Calendar-anniversary bucketing — the fix. Month N = [start+(N−1) months, start+N months). The old
// 30.4375-day arithmetic pulled boundary days into the wrong month (Jun-1 start → Jul 1 = 30 days = Month 1).
describe('bucketEventToMonth — calendar anniversary (the fix)', () => {
  const JUN = '2026-06-01';
  it('a Jun-1 start: Jun 30 = M1, Jul 1 = M2, Jul 31 = M2, Aug 1 = M3', () => {
    expect(bucketEventToMonth('2026-06-01', JUN)).toBe(1);
    expect(bucketEventToMonth('2026-06-30', JUN)).toBe(1);   // last day before the Jul anniversary
    expect(bucketEventToMonth('2026-07-01', JUN)).toBe(2);   // ← the bug: was Month 1 under 30.4375
    expect(bucketEventToMonth('2026-07-31', JUN)).toBe(2);
    expect(bucketEventToMonth('2026-08-01', JUN)).toBe(3);
  });

  it('short-month clamp — a Jan-31 start: Feb 28 = M2, Mar 1 = M2, Mar 31 = M3', () => {
    const JAN31 = '2026-01-31';
    expect(bucketEventToMonth('2026-02-28', JAN31)).toBe(2);   // Feb has no 31st → anniversary clamps to Feb 28
    expect(bucketEventToMonth('2026-03-01', JAN31)).toBe(2);   // still before the Mar 31 anniversary
    expect(bucketEventToMonth('2026-03-31', JAN31)).toBe(3);
  });

  it('strategyMonthIndex is UNclamped (the completion signal): pre-start <1, past-end >12', () => {
    expect(strategyMonthIndex('2026-05-01', JUN)).toBeLessThan(1);       // before start
    expect(strategyMonthIndex('2027-06-01', JUN)).toBe(13);              // exactly start + 12 calendar months → complete
    expect(strategyMonthIndex('2027-05-31', JUN)).toBe(12);              // still Month 12 (last day)
    expect(bucketEventToMonth('2027-06-01', JUN)).toBe(12);              // the bucket clamps the same date to 12
  });
});

describe('strikeCollateralDelta', () => {
  const dep = (amount: number, target: 'strike' | 'cb', date: string): DayEvent => ({ id: id(), date, ts: ++seq, kind: 'deposit', amount, target });
  const wd  = (amount: number, target: 'strike' | 'cb', date: string): DayEvent => ({ id: id(), date, ts: ++seq, kind: 'withdraw', amount, target });
  it('sums strike deposit(+)/withdraw(−) in the month; ignores target:cb + non-collateral; honors the bucket fn', () => {
    const log = [dep(0.2, 'strike', M1), wd(0.05, 'strike', M1), dep(1, 'cb', M1), draw(500, M1)];
    expect(strikeCollateralDelta(log, START, 1)).toBeCloseTo(0.15);
    expect(strikeCollateralDelta(log, START, 2)).toBe(0);
    // a boundary strike deposit that the two bucket fns place in different months
    const boundary = [dep(0.3, 'strike', '2026-07-01')];
    expect(strikeCollateralDelta(boundary, '2026-06-01', 2, bucketEventToMonth)).toBeCloseTo(0.3);   // calendar → M2
    expect(strikeCollateralDelta(boundary, '2026-06-01', 2, legacyBucketEventToMonth)).toBe(0);      // legacy → M1
  });
});

describe('sameRollupFields', () => {
  const base = (over: Partial<MonthlyLogEntry> = {}): MonthlyLogEntry => ({
    month: 1, date: START, btcBought: 0, income: 0, paydown: 0, strikeBal: 5000, strikeLtv: 0.1,
    loggedAt: 1, btcHeld: 1, expensesActual: 1000, ...over,
  });
  it('equal when rollup fields match (0 ≡ absent); undefined entry ↔ empty fresh', () => {
    expect(sameRollupFields(base(), { expensesActual: 1000, strikeBal: 5000, strikeLtv: 0.1 })).toBe(true);
    expect(sameRollupFields(base({ btcBought: 0 }), { expensesActual: 1000, strikeBal: 5000, strikeLtv: 0.1 })).toBe(true);   // btcBought 0 ≡ absent
    expect(sameRollupFields(undefined, {})).toBe(true);
    expect(sameRollupFields(undefined, { expensesActual: 5 })).toBe(false);
  });
  it('differs on a changed amount / stock / provisional', () => {
    expect(sameRollupFields(base(), { expensesActual: 999, strikeBal: 5000, strikeLtv: 0.1 })).toBe(false);
    expect(sameRollupFields(base(), { expensesActual: 1000, strikeBal: 4000, strikeLtv: 0.1 })).toBe(false);
    expect(sameRollupFields(base(), { expensesActual: 1000, strikeBal: 5000, strikeLtv: 0.1, provisional: true })).toBe(false);
  });
});

describe('rollupMonth — flows', () => {
  it('(1) draw → expensesActual summed; other flows zero', () => {
    const { entry, collateralDelta } = rollupMonth([draw(1000), draw(250)], 1, START);
    expect(entry.expensesActual).toBe(1250);
    expect(entry.btcBought ?? 0).toBe(0);
    expect(entry.income ?? 0).toBe(0);
    expect(entry.paydown ?? 0).toBe(0);
    expect(collateralDelta).toBe(0);
  });

  it('(2) buy with usd → btcBought AND income both set', () => {
    const { entry } = rollupMonth([buy(0.02, 1500)], 1, START);
    expect(entry.btcBought).toBeCloseTo(0.02);
    expect(entry.income).toBe(1500);
  });

  it('(3) buy without usd → btcBought set, income absent', () => {
    const { entry } = rollupMonth([buy(0.02)], 1, START);
    expect(entry.btcBought).toBeCloseTo(0.02);
    expect(entry.income).toBeUndefined();
  });

  it('(4) paydown → paydown summed; other flows zero', () => {
    const { entry } = rollupMonth([paydown(500)], 1, START);
    expect(entry.paydown).toBe(500);
    expect(entry.expensesActual ?? 0).toBe(0);
    expect(entry.btcBought ?? 0).toBe(0);
  });

  it('Logging Consolidation §2b — minPayment is balance-neutral: sums to strikeMinPaid, NOT paydown', () => {
    const minPay = (amount: number): DayEvent => ({ id: id(), date: M1, ts: ++seq, kind: 'minPayment', amount });
    const { entry } = rollupMonth([minPay(120), minPay(80), paydown(500)], 1, START);
    expect(entry.strikeMinPaid).toBe(200);
    expect(entry.strikeMinSource).toBe('income');
    expect(entry.paydown).toBe(500);          // untouched by minPayment
    expect(entry.expensesActual ?? 0).toBe(0);
  });
});

describe('rollupMonth — collateral (target:strike) and journal-only (target:cb)', () => {
  it('(5) target:strike deposit → collateralDelta positive; NOT in entry', () => {
    const { entry, collateralDelta } = rollupMonth([move('deposit', 0.1, 'strike')], 1, START);
    expect(collateralDelta).toBeCloseTo(0.1);
    expect(Object.keys(entry)).toHaveLength(0);
  });

  it('(6) target:strike withdraw → collateralDelta negative', () => {
    const { collateralDelta } = rollupMonth([move('withdraw', 0.1, 'strike')], 1, START);
    expect(collateralDelta).toBeCloseTo(-0.1);
  });

  it('(7) two target:strike deposits → collateralDelta is their sum', () => {
    const { collateralDelta } = rollupMonth([move('deposit', 0.1, 'strike'), move('deposit', 0.05, 'strike')], 1, START);
    expect(collateralDelta).toBeCloseTo(0.15);
  });

  it('(8) target:cb deposit → collateralDelta 0; NOT in entry (journal-only)', () => {
    const { entry, collateralDelta } = rollupMonth([move('deposit', 0.1, 'cb')], 1, START);
    expect(collateralDelta).toBe(0);
    expect(Object.keys(entry)).toHaveLength(0);
  });

  it('(9) target:cb withdraw → collateralDelta 0; NOT in entry (journal-only)', () => {
    const { entry, collateralDelta } = rollupMonth([move('withdraw', 0.1, 'cb')], 1, START);
    expect(collateralDelta).toBe(0);
    expect(Object.keys(entry)).toHaveLength(0);
  });
});

describe('rollupMonth — stocks (balanceReading)', () => {
  it('(10) balanceReading → strikeBal/strikeLtv set; flows zero; collateralDelta 0', () => {
    const { entry, collateralDelta } = rollupMonth([reading({ strikeBal: 5000, strikeLtv: 0.12 })], 1, START);
    expect(entry.strikeBal).toBe(5000);
    expect(entry.strikeLtv).toBeCloseTo(0.12);
    expect(entry.expensesActual ?? 0).toBe(0);
    expect(collateralDelta).toBe(0);
  });

  it('(11) balanceReading with cbBal/cbLtv/cbCollateral → cbBal+cbLtv in entry; cbCollateral NOT in entry', () => {
    const { entry } = rollupMonth([reading({ strikeBal: 5000, strikeLtv: 0.12, cbBal: 60000, cbLtv: 0.5, cbCollateral: 1.48 })], 1, START);
    expect(entry.cbBal).toBe(60000);
    expect(entry.cbLtv).toBeCloseTo(0.5);
    expect('cbCollateral' in entry).toBe(false);
  });

  it('(12) cbCollateralReading → entry empty ({}); collateralDelta 0 (ignored by rollupMonth)', () => {
    const { entry, collateralDelta } = rollupMonth([cbColl(1.5)], 1, START);
    expect(Object.keys(entry)).toHaveLength(0);
    expect(collateralDelta).toBe(0);
  });

  it('(13) latest balanceReading by ts wins', () => {
    const early = reading({ strikeBal: 1000, strikeLtv: 0.10 }, M1, 1000);
    const late  = reading({ strikeBal: 9000, strikeLtv: 0.20 }, M1, 2000);
    const { entry } = rollupMonth([late, early], 1, START);   // order in array reversed on purpose
    expect(entry.strikeBal).toBe(9000);
    expect(entry.strikeLtv).toBeCloseTo(0.20);
  });

  it('(14) flows + reading in same month → both populated', () => {
    const { entry } = rollupMonth([draw(800), buy(0.01, 700), reading({ strikeBal: 4200, strikeLtv: 0.11 })], 1, START);
    expect(entry.expensesActual).toBe(800);
    expect(entry.btcBought).toBeCloseTo(0.01);
    expect(entry.income).toBe(700);
    expect(entry.strikeBal).toBe(4200);
    expect(entry.strikeLtv).toBeCloseTo(0.11);
  });
});

describe('rollupMonth — empty + carry-forward', () => {
  it('(15) empty dayLog → entry {} + collateralDelta 0', () => {
    const { entry, collateralDelta } = rollupMonth([], 1, START);
    expect(entry).toEqual({});
    expect(collateralDelta).toBe(0);
  });

  it('(16) carry-forward: flows, no reading, priorStocks given → priorStocks values + provisional:true', () => {
    const prior = { strikeBal: 3333, strikeLtv: 0.09, cbBal: 50000, cbLtv: 0.45 };
    const { entry } = rollupMonth([draw(600)], 1, START, prior);
    expect(entry.expensesActual).toBe(600);
    expect(entry.strikeBal).toBe(3333);
    expect(entry.strikeLtv).toBeCloseTo(0.09);
    expect(entry.cbBal).toBe(50000);
    expect(entry.cbLtv).toBeCloseTo(0.45);
    expect(entry.provisional).toBe(true);
  });

  it('(17) carry-forward: flows, no reading, NO priorStocks → flows only, no stocks, no provisional', () => {
    const { entry } = rollupMonth([draw(600)], 1, START);
    expect(entry.expensesActual).toBe(600);
    expect(entry.strikeBal).toBeUndefined();
    expect(entry.provisional).toBeUndefined();
  });
});

describe('rollupMonth — invariants & boundaries', () => {
  it('(18) entry never contains collateralAdjustment / btcHeld / cbCollateral / source / confirmed', () => {
    const { entry } = rollupMonth(
      [buy(0.01, 700), move('deposit', 0.1, 'strike'), reading({ strikeBal: 4200, strikeLtv: 0.11, cbBal: 60000, cbLtv: 0.5, cbCollateral: 1.48 })],
      1, START,
    );
    for (const k of ['collateralAdjustment', 'btcHeld', 'cbCollateral', 'source', 'confirmed']) {
      expect(k in entry).toBe(false);
    }
  });

  it('(19) an event dated to month 1 does NOT appear in the month 2 rollup', () => {
    const { entry } = rollupMonth([draw(1000, M1)], 2, START);
    expect(entry.expensesActual).toBeUndefined();
    expect(entry).toEqual({});
  });
});

describe('deriveCbCollateral (P2a Seam 2)', () => {
  it('empty dayLog → falls back to the cache (never undefined)', () => {
    expect(deriveCbCollateral([], 1.2)).toBe(1.2);
    expect(deriveCbCollateral([])).toBe(0);   // no cache → 0, never undefined
  });

  it('reads a cbCollateralReading', () => {
    expect(deriveCbCollateral([cbColl(1.6, M1, 1000)], 0)).toBeCloseTo(1.6);
  });

  it('reads a balanceReading.cbCollateral', () => {
    expect(deriveCbCollateral([reading({ strikeBal: 1, strikeLtv: 0.1, cbCollateral: 1.48 }, M1, 1000)], 0)).toBeCloseTo(1.48);
  });

  it('picks the latest by ts ACROSS both kinds', () => {
    const log = [
      cbColl(1.5, M1, 1000),
      reading({ strikeBal: 1, strikeLtv: 0.1, cbCollateral: 2.0 }, M1, 3000),   // newest cbCollateral-bearer
      cbColl(1.9, M1, 2000),
    ];
    expect(deriveCbCollateral(log, 0)).toBeCloseTo(2.0);
  });

  it('ignores a balanceReading with no cbCollateral; falls back to cache when none carry one', () => {
    expect(deriveCbCollateral([reading({ strikeBal: 1, strikeLtv: 0.1 }, M1, 1000)], 1.3)).toBe(1.3);
  });
});
