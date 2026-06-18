import { describe, it, expect } from 'vitest';
import { deriveAdvisorStart, deriveCurrentPosition, upsertEntry, recomputeBtcHeld, computeExpenseReanchor } from '../logUtils';
import type { MonthlyLogEntry } from '../types';

function makeEntry(month: number, overrides: Partial<MonthlyLogEntry> = {}): MonthlyLogEntry {
  return {
    month,
    date:           `2026-0${month}-01`,
    btcBought:      0.05,
    income:         500,
    paydown:        0,
    strikeBal:      month * 3500,
    strikeLtv:      0.15,
    loggedAt:       Date.now(),
    btcHeld:        0,
    expensesActual: 3500,
    ...overrides,
  };
}

describe('deriveAdvisorStart', () => {
  it('empty log → startingBlocBalance is monthStartBalance (the new param), NOT advisorActualBlocBalance', () => {
    // advisorActualBlocBalance=9999 (live drawn) must be ignored; monthStartBalance=5000 is the projection base.
    const result = deriveAdvisorStart([], 0.70, 9999, 4, 0, 5000);
    expect(result.startingBlocBalance).toBe(5000);
    expect(result.startingBtcHeld).toBe(0.70);
    expect(result.startingMonth).toBe(4);
  });

  it('uses most recent entry strikeBal as startingBlocBalance', () => {
    const log = [makeEntry(1, { strikeBal: 3500 }), makeEntry(2, { strikeBal: 7000 }), makeEntry(3, { strikeBal: 9180 })];
    const result = deriveAdvisorStart(log, 0.70, 0, 4, 0, 0);
    expect(result.startingBlocBalance).toBe(9180);
  });

  it('uses last entry btcHeld as startingBtcHeld', () => {
    const log = [
      makeEntry(1, { btcBought: 0.05, btcHeld: 0.75 }),
      makeEntry(2, { btcBought: 0.03, btcHeld: 0.78 }),
      makeEntry(3, { btcBought: 0.02, btcHeld: 0.80 }),
    ];
    const result = deriveAdvisorStart(log, 0.70, 0, 4, 0, 0);
    expect(result.startingBtcHeld).toBeCloseTo(0.80);
  });

  it('sets startingMonth to last.month + 1', () => {
    const log = [makeEntry(3)];
    const result = deriveAdvisorStart(log, 0, 0, 1, 0, 0);
    expect(result.startingMonth).toBe(4);
  });

  it('clamps startingMonth to 12 when last entry is month 12', () => {
    const log = [makeEntry(12)];
    const result = deriveAdvisorStart(log, 0, 0, 12, 0, 0);
    expect(result.startingMonth).toBe(12);
  });
});

describe('upsertEntry', () => {
  it('appends a new entry when month does not exist', () => {
    const entries = [makeEntry(1), makeEntry(2)];
    const result = upsertEntry(entries, makeEntry(3));
    expect(result).toHaveLength(3);
    expect(result[2].month).toBe(3);
  });

  it('replaces an existing entry with the same month number', () => {
    const entries = [makeEntry(1), makeEntry(2, { btcBought: 0.01 })];
    const updated = makeEntry(2, { btcBought: 0.99 });
    const result = upsertEntry(entries, updated);
    expect(result).toHaveLength(2);
    expect(result.find((e) => e.month === 2)?.btcBought).toBe(0.99);
  });

  it('keeps entries sorted ascending by month', () => {
    const entries = [makeEntry(3), makeEntry(1)];
    const result = upsertEntry(entries, makeEntry(2));
    expect(result.map((e) => e.month)).toEqual([1, 2, 3]);
  });
});

describe('recomputeBtcHeld', () => {
  it('gap-tolerant: months 5 & 7 (skip 6) → startingBtcHeld === month 7 btcHeld', () => {
    const base = 1.0;
    const log = recomputeBtcHeld([
      makeEntry(5, { btcBought: 0.01 }),
      makeEntry(7, { btcBought: 0.02 }),
    ], base);
    const result = deriveAdvisorStart(log, base, 0, 8, 0, 0);
    expect(result.startingBtcHeld).toBeCloseTo(log.find((e) => e.month === 7)!.btcHeld);
    expect(result.startingBtcHeld).toBeCloseTo(1.03);
  });

  it('no double-count: base=1, buys=[0.001, 0.002] → latest.btcHeld === 1.003', () => {
    const log = recomputeBtcHeld([
      makeEntry(1, { btcBought: 0.001 }),
      makeEntry(2, { btcBought: 0.002 }),
    ], 1.0);
    expect(log[1].btcHeld).toBeCloseTo(1.003);
  });

  it('commit trio: strikeBal, btcHeld anchored to prev+buy, expensesActual preserved', () => {
    const base = 1.0;
    const entry = makeEntry(1, { btcBought: 0.005, strikeBal: 12000, btcHeld: 0, expensesActual: 3500 });
    const [committed] = recomputeBtcHeld([entry], base);
    expect(committed.strikeBal).toBe(12000);
    expect(committed.btcHeld).toBeCloseTo(base + 0.005);
    expect(committed.expensesActual).toBe(3500);
  });

  it('edit re-derives: editing an earlier btcBought updates the latest entry btcHeld', () => {
    const base = 1.0;
    const original = recomputeBtcHeld([
      makeEntry(1, { btcBought: 0.001 }),
      makeEntry(2, { btcBought: 0.002 }),
    ], base);
    expect(original[1].btcHeld).toBeCloseTo(1.003);

    const edited = recomputeBtcHeld(
      upsertEntry(original, makeEntry(1, { btcBought: 0.010, btcHeld: 0, expensesActual: 3500 })),
      base,
    );
    expect(edited[0].btcHeld).toBeCloseTo(1.010);
    expect(edited[1].btcHeld).toBeCloseTo(1.012);
  });

  it('migration backfill: latest.btcHeld === pre-migration advisorActualBtcHeld, baseline reset', () => {
    const preMigrationBtcHeld = 1.10;
    const sorted = [
      makeEntry(1, { btcBought: 0.05, btcHeld: undefined as any }),
      makeEntry(2, { btcBought: 0.05, btcHeld: undefined as any }),
    ];
    const cumBought = sorted.reduce((s, e) => s + (e.btcBought ?? 0), 0);
    const month0Baseline = preMigrationBtcHeld - cumBought;

    let running = month0Baseline;
    for (const e of sorted) {
      running += (e.btcBought ?? 0);
      if (e.btcHeld == null) e.btcHeld = running;
    }

    expect(sorted[sorted.length - 1].btcHeld).toBeCloseTo(preMigrationBtcHeld);
    expect(month0Baseline).toBeCloseTo(1.0);
  });
});

describe('badge status logic', () => {
  function getBadgeStatus(
    mn: number,
    currentMonth: number,
    log: { month: number }[],
  ): 'logged' | 'current' | 'unlogged' | 'future' {
    const logged = log.some((e) => e.month === mn);
    if (logged)              return 'logged';
    if (mn === currentMonth) return 'current';
    if (mn < currentMonth)   return 'unlogged';
    return 'future';
  }

  it('logged entry → logged', () => {
    expect(getBadgeStatus(3, 5, [{ month: 3 }])).toBe('logged');
  });

  it('current month with no entry → current', () => {
    expect(getBadgeStatus(5, 5, [])).toBe('current');
  });

  it('past month with no entry → unlogged', () => {
    expect(getBadgeStatus(2, 5, [])).toBe('unlogged');
  });

  it('future month → future', () => {
    expect(getBadgeStatus(8, 5, [])).toBe('future');
  });
});

describe('dated collateral adjustments (spec v4)', () => {
  it('recomputeBtcHeld includes collateralAdjustment in the running chain', () => {
    const log = [
      makeEntry(1, { btcBought: 0.05, collateralAdjustment: 0.10 }),
      makeEntry(2, { btcBought: 0.05 }),
    ];
    const result = recomputeBtcHeld(log, 0.50);
    expect(result[0].btcHeld).toBeCloseTo(0.65);   // 0.50 + 0.05 + 0.10
    expect(result[1].btcHeld).toBeCloseTo(0.70);
  });

  it('entries WITHOUT the field chain identically to pre-v4 (?? 0)', () => {
    const log = [makeEntry(1, { btcBought: 0.05 }), makeEntry(2, { btcBought: 0.03 })];
    const result = recomputeBtcHeld(log, 0.70);
    expect(result[0].btcHeld).toBeCloseTo(0.75);
    expect(result[1].btcHeld).toBeCloseTo(0.78);
  });

  it('deriveCurrentPosition adds pending on top of last.btcHeld', () => {
    const log = [makeEntry(1, { btcHeld: 0.80 })];
    expect(deriveCurrentPosition(log, 0.70, 0, 0.05).btcHeld).toBeCloseTo(0.85);
  });

  it('deriveCurrentPosition empty log → baseline + pending', () => {
    expect(deriveCurrentPosition([], 0.70, 0, -0.10).btcHeld).toBeCloseTo(0.60);
  });

  it('deriveAdvisorStart adds pending to startingBtcHeld (logged and empty)', () => {
    const log = [makeEntry(3, { btcHeld: 0.80 })];
    expect(deriveAdvisorStart(log, 0.70, 0, 4, 0.05, 0).startingBtcHeld).toBeCloseTo(0.85);
    expect(deriveAdvisorStart([], 0.70, 0, 4, 0.05, 0).startingBtcHeld).toBeCloseTo(0.75);
  });
});

describe('computeExpenseReanchor (spec §9)', () => {
  // makeEntry defaults expensesActual: 3500; override per-entry below.
  const threeAt = (a: number, b: number, c: number) => [
    makeEntry(1, { expensesActual: a }),
    makeEntry(2, { expensesActual: b }),
    makeEntry(3, { expensesActual: c }),
  ];

  it('no banner when fewer than 3 logged entries, regardless of drift', () => {
    const log = [makeEntry(1, { expensesActual: 9000 }), makeEntry(2, { expensesActual: 9000 })];
    expect(computeExpenseReanchor(log, 3500, 0).show).toBe(false);
  });

  it('no banner when avg is within 5% of the assumption', () => {
    const r = computeExpenseReanchor(threeAt(3600, 3600, 3600), 3500, 0);   // ~2.9% drift
    expect(r.avg).toBeCloseTo(3600);
    expect(r.show).toBe(false);
  });

  it('fires when avg drifts >5% from the assumption', () => {
    const r = computeExpenseReanchor(threeAt(4000, 4000, 4000), 3500, 0);   // ~14% drift
    expect(r.show).toBe(true);
    expect(r.avg).toBeCloseTo(4000);
  });

  it('averages only the trailing 3 entries (newest by month)', () => {
    const log = [
      makeEntry(1, { expensesActual: 3500 }),
      makeEntry(2, { expensesActual: 4000 }),
      makeEntry(3, { expensesActual: 4000 }),
      makeEntry(4, { expensesActual: 4000 }),
    ];
    expect(computeExpenseReanchor(log, 3500, 0).avg).toBeCloseTo(4000);   // months 4,3,2 — not month 1
  });

  it('dismissal durability: hidden at the dismissed avg, resurfaces when avg moves >5% past it', () => {
    const log = threeAt(4000, 4000, 4000);   // avg 4000, drifts from 3500
    expect(computeExpenseReanchor(log, 3500, 4000).show).toBe(false);     // dismissed at 4000 → hidden
    const moved = threeAt(4200, 4200, 4200);                              // avg 4200; |4200-4000|/3500 ≈ 5.7% > 5%
    expect(computeExpenseReanchor(moved, 3500, 4000).show).toBe(true);
  });
});
