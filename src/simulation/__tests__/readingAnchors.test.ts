import { describe, it, expect } from 'vitest';
import type { DayEvent } from '../types';
import { deriveReadingAnchors, type ReadingAnchorState } from '../logUtils';

// §5b Readings-Unification — the PURE anchor selector. Selection is by the reading's DATE (not ts); a per-anchor
// asOf guard protects manual/knob edits; delete/date-move of the source falls back via a date+value proxy.

let seq = 0;
const reading = (
  date: string,
  r: { strikeBal: number; strikeLtv?: number; cbBal?: number; cbLtv?: number; cbLiqPrice?: number },
  ts = ++seq,
): DayEvent => ({ id: `r${++seq}`, date, ts, kind: 'balanceReading', reading: { strikeLtv: 0.1, ...r } });

// A baseline "never anchored" state (null asOfs → the guard always applies the first reading).
const FRESH: ReadingAnchorState = {
  advisorActualBlocBalance: 0,      advisorActualBlocBalanceAsOf: null,
  cbLoanBalance:            0,      cbLoanBalanceAsOf:            null,
  cbLiquidationPrice:       0,      cbLiquidationPriceAsOf:       null,
};

describe('deriveReadingAnchors — guard (date ≥ asOf)', () => {
  it('a reading dated ≥ asOf writes the anchor + asOf ← reading.date', () => {
    const cur = { ...FRESH, advisorActualBlocBalance: 4000, advisorActualBlocBalanceAsOf: '2025-01-01' };
    const patch = deriveReadingAnchors([reading('2025-01-10', { strikeBal: 5000 })], cur);
    expect(patch.advisorActualBlocBalance).toBe(5000);
    expect(patch.advisorActualBlocBalanceAsOf).toBe('2025-01-10');
  });

  it('a reading dated < asOf does NOT clobber (manual freshness protected)', () => {
    const cur = { ...FRESH, advisorActualBlocBalance: 4000, advisorActualBlocBalanceAsOf: '2025-01-15' };
    const patch = deriveReadingAnchors([reading('2025-01-10', { strikeBal: 5000 })], cur);
    expect(patch.advisorActualBlocBalance).toBeUndefined();
    expect(patch.advisorActualBlocBalanceAsOf).toBeUndefined();
  });

  it('null asOf (never anchored) → always applies', () => {
    const patch = deriveReadingAnchors([reading('2025-01-10', { strikeBal: 5000 })], FRESH);
    expect(patch.advisorActualBlocBalance).toBe(5000);
    expect(patch.advisorActualBlocBalanceAsOf).toBe('2025-01-10');
  });

  it('idempotent — already anchored to this exact reading → empty patch (no redundant publish)', () => {
    const cur = { ...FRESH, advisorActualBlocBalance: 5000, advisorActualBlocBalanceAsOf: '2025-01-10' };
    const patch = deriveReadingAnchors([reading('2025-01-10', { strikeBal: 5000 })], cur);
    expect(Object.keys(patch)).toHaveLength(0);
  });
});

describe('deriveReadingAnchors — select by DATE, not ts', () => {
  it('an older-dated reading with a NEWER ts (edited) does NOT win', () => {
    const older = reading('2025-01-01', { strikeBal: 1000 }, 9999);   // edited → high ts
    const newer = reading('2025-01-05', { strikeBal: 5000 }, 100);    // low ts, later DATE
    const patch = deriveReadingAnchors([older, newer], FRESH);
    expect(patch.advisorActualBlocBalance).toBe(5000);   // date-latest, ignoring ts
  });

  it('same date → latest ts breaks the tie', () => {
    const a = reading('2025-01-05', { strikeBal: 1000 }, 100);
    const b = reading('2025-01-05', { strikeBal: 7000 }, 200);
    const patch = deriveReadingAnchors([a, b], FRESH);
    expect(patch.advisorActualBlocBalance).toBe(7000);
  });
});

describe('deriveReadingAnchors — delete/date-move fallback (date + value proxy)', () => {
  it('deleting the reading that WAS the source re-points to the date-latest survivor unconditionally', () => {
    // Anchor sourced from the deleted 2025-01-10 reading (asOf=01-10, value=5000). Survivor is older (01-05).
    const cur = { ...FRESH, advisorActualBlocBalance: 5000, advisorActualBlocBalanceAsOf: '2025-01-10' };
    const survivor = reading('2025-01-05', { strikeBal: 3000 });
    const patch = deriveReadingAnchors([survivor], cur, { oldDate: '2025-01-10', strikeBal: 5000 });
    expect(patch.advisorActualBlocBalance).toBe(3000);   // fell back off the deleted value (guard bypassed by orphan)
    expect(patch.advisorActualBlocBalanceAsOf).toBe('2025-01-05');
  });

  it('no surviving reading → anchor left unchanged (never nulled)', () => {
    const cur = { ...FRESH, advisorActualBlocBalance: 5000, advisorActualBlocBalanceAsOf: '2025-01-10' };
    const patch = deriveReadingAnchors([], cur, { oldDate: '2025-01-10', strikeBal: 5000 });
    expect(Object.keys(patch)).toHaveLength(0);
  });

  it('KNOB-SET IMMUNITY — deleting an unrelated same-day reading whose value ≠ a knob-set anchor does NOT clobber', () => {
    // A knob set advisorActualBlocBalance=8000 asOf=today. An UNRELATED same-day reading (value 5000) is deleted.
    // date matches (oldDate==asOf) but value 5000 ≠ 8000 → NOT the source → the guard blocks the older survivor.
    const cur = { ...FRESH, advisorActualBlocBalance: 8000, advisorActualBlocBalanceAsOf: '2025-01-10' };
    const survivor = reading('2025-01-05', { strikeBal: 3000 });
    const patch = deriveReadingAnchors([survivor], cur, { oldDate: '2025-01-10', strikeBal: 5000 });
    expect(patch.advisorActualBlocBalance).toBeUndefined();   // knob value survives
  });
});

describe('deriveReadingAnchors — CB fields', () => {
  it('cbLiqPrice omitted → liq anchor + asOf untouched', () => {
    const cur = { ...FRESH, cbLiquidationPrice: 60000, cbLiquidationPriceAsOf: '2025-01-01' };
    const patch = deriveReadingAnchors([reading('2025-01-10', { strikeBal: 5000, cbBal: 40000 })], cur);
    expect(patch.cbLoanBalance).toBe(40000);          // cbBal still re-anchors
    expect(patch.cbLiquidationPrice).toBeUndefined(); // no cbLiqPrice on the reading → untouched
    expect(patch.cbLiquidationPriceAsOf).toBeUndefined();
  });

  it('cbLiqPrice present → liq anchor + asOf written', () => {
    const patch = deriveReadingAnchors([reading('2025-01-10', { strikeBal: 5000, cbBal: 40000, cbLiqPrice: 61000 })], FRESH);
    expect(patch.cbLiquidationPrice).toBe(61000);
    expect(patch.cbLiquidationPriceAsOf).toBe('2025-01-10');
  });

  it('a Strike-only reading (no cbBal) → CB anchors untouched, Strike still re-anchors', () => {
    const cur = { ...FRESH, cbLoanBalance: 40000, cbLoanBalanceAsOf: '2025-01-01' };
    const patch = deriveReadingAnchors([reading('2025-01-10', { strikeBal: 5000 })], cur);
    expect(patch.advisorActualBlocBalance).toBe(5000);
    expect(patch.cbLoanBalance).toBeUndefined();
    expect(patch.cbLoanBalanceAsOf).toBeUndefined();
  });

  it('no balanceReading at all → empty patch', () => {
    const draw: DayEvent = { id: 'd', date: '2025-01-10', ts: 1, kind: 'draw', amount: 500 };
    expect(Object.keys(deriveReadingAnchors([draw], FRESH))).toHaveLength(0);
  });
});
