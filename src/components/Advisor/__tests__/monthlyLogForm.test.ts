import { describe, it, expect } from 'vitest';
import { strikeColFragment, collateralCorrection, parseCollateralInput, correctionDurability, DURABILITY_HINT } from '../monthlyLogForm';
import type { DayEvent, MonthlyLogEntry } from '../../../simulation/types';

// The monthly editors' "Strike collateral" field. A blank field must OMIT btcHeld — never write 0: 0 is a real
// position, and nothing recomputes the column any more to overwrite a placeholder.
describe('strikeColFragment', () => {
  it('blank, whitespace or unparseable → {} (btcHeld omitted)', () => {
    expect(strikeColFragment('')).toEqual({});
    expect(strikeColFragment('   ')).toEqual({});
    expect(strikeColFragment('abc')).toEqual({});
  });

  it('a typed value records it — including a stated 0', () => {
    expect(strikeColFragment('0')).toEqual({ btcHeld: 0 });
    expect(strikeColFragment('0.12345678')).toEqual({ btcHeld: 0.12345678 });
  });
});

// ── daily-month-collateral-edit-spec-v2 — the daily-month collateral correction ─────────────────────────────────────
// ⚠ SYNTHETIC round figures — this repo is public; never a real position.

const dailyEntry = (over: Partial<MonthlyLogEntry> = {}): MonthlyLogEntry => ({
  month: 2, date: '2026-07-01', btcBought: 0.01, income: 1000, paydown: 200, strikeBal: 3000, strikeLtv: 0.1,
  loggedAt: 5, updatedAt: 6, btcHeld: 0.42, expensesActual: 2500, source: 'daily', confirmed: true, provisional: false,
  strikeMinPaid: 30, ...over,
});

describe('collateralCorrection', () => {
  it('⭐ preserves `source`, never forces it', () => {
    expect(collateralCorrection(dailyEntry(), 0.5).source).toBe('daily');
    const { source: _s, ...manual } = dailyEntry();
    void _s;
    expect('source' in collateralCorrection(manual, 0.5)).toBe(false);   // a manual month is never flipped to daily
  });

  it('⭐ only an explicit null REMOVES btcHeld; a stated 0 records 0', () => {
    expect('btcHeld' in collateralCorrection(dailyEntry(), null)).toBe(false);
    expect(collateralCorrection(dailyEntry(), 0).btcHeld).toBe(0);
    expect(collateralCorrection(dailyEntry({ btcHeld: undefined }), 0.3).btcHeld).toBe(0.3);
  });

  it('everything else is carried through byte-identically', () => {
    const e = dailyEntry();
    const { btcHeld: _b, ...rest } = e;
    void _b;
    const { btcHeld: _c, ...out } = collateralCorrection(e, 0.9);
    void _c;
    expect(out).toEqual(rest);   // rolled fields, stocks, confirmed, loggedAt, provisional, source
    expect(e.btcHeld).toBe(0.42);   // the input is not mutated
  });
});

describe('parseCollateralInput — strict: a typo is never a clear', () => {
  it('reads real amounts, including a comma-decimal "0,42"', () => {
    expect(parseCollateralInput('0.42')).toBe(0.42);
    expect(parseCollateralInput('0,42')).toBe(0.42);
    expect(parseCollateralInput('.5')).toBe(0.5);
    expect(parseCollateralInput('0')).toBe(0);
    expect(parseCollateralInput(' 0.42 ')).toBe(0.42);
    expect(parseCollateralInput('0.00000001')).toBe(1e-8);
  });
  it('⭐ rejects everything else — blank, junk, signs, exponents, two separators, sub-satoshi, > 21M', () => {
    for (const bad of ['', '   ', 'abc', '0.42abc', '-1', '1,000.5', '1e-3', '0..4', '0.123456789', '21000001']) {
      expect(parseCollateralInput(bad)).toBeNull();
    }
  });
});

describe('correctionDurability — mirrors rollupMonth', () => {
  const S = '2026-06-01';   // month 1 = June, month 2 = July
  let n = 0;
  const rd = (date: string, strikeCollateral?: number, ts = ++n): DayEvent =>
    ({ id: `r${ts}`, date, ts, kind: 'balanceReading', reading: { strikeBal: 1000, strikeLtv: 0.1, ...(strikeCollateral !== undefined ? { strikeCollateral } : {}) } });
  const dr = (date: string): DayEvent => ({ id: `d${++n}`, date, ts: n, kind: 'draw', amount: 500 });

  it('⭐ the truth table', () => {
    expect(correctionDurability([dr('2026-07-10'), rd('2026-07-12', 0.5)], S, 2)).toBe('stated');
    expect(correctionDurability([dr('2026-07-10'), rd('2026-07-12')], S, 2)).toBe('stable');
    expect(correctionDurability([rd('2026-06-12', 0.5), dr('2026-07-10')], S, 2)).toBe('fragile');
    expect(correctionDurability([rd('2026-06-12'), dr('2026-07-10')], S, 2)).toBe('stable');
    expect(correctionDurability([dr('2026-07-10')], S, 2)).toBe('stable');   // no prior reading at all
    // The LATEST in-month reading decides (by ts): an earlier one stating it doesn't make the month `stated`.
    // Mutation: pick the earliest reading → 'stated' → red.
    expect(correctionDurability([rd('2026-07-05', 0.5, 100), dr('2026-07-10'), rd('2026-07-20', undefined, 200)], S, 2)).toBe('stable');
  });

  it('DURABILITY_HINT: three distinct lines; fragile names the missing reading; stable names BOTH ways out', () => {
    expect(new Set(Object.values(DURABILITY_HINT)).size).toBe(3);
    expect(DURABILITY_HINT.fragile).toContain('no balance reading');
    expect(DURABILITY_HINT.stable).toContain('in this month');
    expect(DURABILITY_HINT.stable).toContain('last month');   // the second clause — pinned by the store's test 12 too
  });
});
