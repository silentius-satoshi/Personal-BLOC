import { describe, it, expect } from 'vitest';
import { deriveCurrentPosition, upsertEntry, computeExpenseReanchor } from '../logUtils';
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

// (deriveAdvisorStart's tests left with it in 5e, D5-A — it fed the Advisor's projection, gone with runAdvisor.)

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

// The recomputeBtcHeld chain tests were DELETED with the function (strike-collateral-recorded spec v3): monthly btcHeld
// is now RECORDED from each month's reading, never chained off a baseline. This one survives — it replicates the
// persistConfig v20 backfill loop, which is deliberately untouched (it only runs on a version bump).
describe('migration backfill (persistConfig v20 loop — untouched)', () => {
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
  it('deriveCurrentPosition btcHeld = the passed currentStrikeCollateral (logged)', () => {
    const log = [makeEntry(1, { btcHeld: 0.80, strikeBal: 3000 })];
    const pos = deriveCurrentPosition(log, 0.85, 0);
    expect(pos.btcHeld).toBeCloseTo(0.85);   // reading-anchored — the passed value, not last.btcHeld
    expect(pos.blocBalance).toBe(3000);      // still the last entry's strikeBal
    expect(pos.lastLoggedMonth).toBe(1);
  });

  it('deriveCurrentPosition empty log → btcHeld = the passed collateral', () => {
    expect(deriveCurrentPosition([], 0.60, 0).btcHeld).toBeCloseTo(0.60);
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

  it('⭐ F-R4-1 — the month in progress stays out of the average; a bound of 13 counts all twelve', () => {
    // Months 1–3 are done at $4,000; month 4 is in progress, $500 drawn so far (Daily rolls each draw in as it happens).
    const log = [
      makeEntry(1, { expensesActual: 4000 }),
      makeEntry(2, { expensesActual: 4000 }),
      makeEntry(3, { expensesActual: 4000 }),
      makeEntry(4, { expensesActual: 500 }),
    ];
    const r = computeExpenseReanchor(log, 3500, 0, 4);
    expect(r.avg, 'F-R4-1 months 1–3 only').toBeCloseTo(4000);
    expect(r.show, 'F-R4-1 the prompt').toBe(true);
    // Without the bound — the rule as it stood — month 4 pulls the average to $2,833.33.
    expect(computeExpenseReanchor(log, 3500, 0).avg, 'F-R4-1 premise: the partial month counted before').toBeCloseTo(8500 / 3);
    // At a $4,000 plan the done months match it — no prompt — while the partial month would have raised one.
    expect(computeExpenseReanchor(log, 4000, 0, 4).show, 'F-R4-1 no false prompt mid-month').toBe(false);
    expect(computeExpenseReanchor(log, 4000, 0).show, 'F-R4-1 premise: the false prompt').toBe(true);
    // A bound of 13 counts every month before it, month 4 too. (THIS MONTH passes 12 once the year is done: month 12
    // keeps every later draw, so it never finishes.)
    expect(computeExpenseReanchor(log, 3500, 0, 13).avg, 'F-R4-1 the year done').toBeCloseTo(8500 / 3);
    // Fewer than three months before this one → no prompt.
    expect(computeExpenseReanchor(log, 3500, 0, 3).show, 'F-R4-1 two months only').toBe(false);
  });

  it('⭐ F-R4-1 — a month that records no expenses stays out: never "averaged $0.00"', () => {
    // Daily starts a month's entry at 0 and leaves it there when nothing is drawn on Strike.
    const zeros = [makeEntry(1, { expensesActual: 0 }), makeEntry(2, { expensesActual: 0 }), makeEntry(3, { expensesActual: 0 })];
    expect(computeExpenseReanchor(zeros, 3500, 0, 4).show, 'F-R4-1 three empty months — no prompt').toBe(false);
    const mixed = [
      makeEntry(1, { expensesActual: 3600 }),
      makeEntry(2, { expensesActual: 4100 }),
      makeEntry(3, { expensesActual: 0 }),
      makeEntry(4, { expensesActual: 4100 }),
    ];
    // Months 4, 2 and 1 — month 3 recorded nothing.
    expect(computeExpenseReanchor(mixed, 3500, 0, 5).avg, 'F-R4-1 the empty month skipped').toBeCloseTo((3600 + 4100 + 4100) / 3);
  });

  it('dismissal durability: hidden at the dismissed avg, resurfaces when avg moves >5% past it', () => {
    const log = threeAt(4000, 4000, 4000);   // avg 4000, drifts from 3500
    expect(computeExpenseReanchor(log, 3500, 4000).show).toBe(false);     // dismissed at 4000 → hidden
    const moved = threeAt(4200, 4200, 4200);                              // avg 4200; |4200-4000|/3500 ≈ 5.7% > 5%
    expect(computeExpenseReanchor(moved, 3500, 4000).show).toBe(true);
  });
});
