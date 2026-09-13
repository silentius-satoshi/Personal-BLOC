import { describe, it, expect } from 'vitest';
import { deriveColdStorage, coldMovesSinceAnchor, deriveStrikeCollateral, deriveCbCollateral } from '../logUtils';
import type { DayEvent } from '../types';

// ⚠ SYNTHETIC round figures — this repo is public; never a real position.
let seq = 0;
const mv = (
  kind: 'deposit' | 'withdraw', amount: number, target: 'strike' | 'cb' | 'cold', date: string, ts = ++seq,
): DayEvent => ({ id: `e${++seq}`, date, ts, kind, amount, target });

// The anchor: 2026-09-12 12:00 LOCAL. Built with the local Date constructor so toLocalISO yields '2026-09-12' in any
// timezone the suite runs in.
const ANCHOR_MS = new Date(2026, 8, 12, 12).getTime();

describe('deriveColdStorage', () => {
  it('⭐ no cold events → the anchor exactly, dated or not (today\'s owners see no change)', () => {
    const log = [mv('deposit', 0.3, 'strike', '2026-09-13'), mv('deposit', 0.2, 'cb', '2026-09-13')];
    expect(deriveColdStorage([], 0.75, null)).toBe(0.75);
    expect(deriveColdStorage(log, 0.75, null)).toBe(0.75);
    expect(deriveColdStorage(log, 0.75, ANCHOR_MS)).toBe(0.75);
  });

  it('⭐ the (date, ts) boundary — before the anchor is absorbed, after it counts, the anchor\'s own day splits on ts', () => {
    const before    = mv('deposit', 0.01, 'cold', '2026-09-11', ANCHOR_MS + 99);   // earlier DATE, even with a later ts
    const after     = mv('deposit', 0.02, 'cold', '2026-09-13', ANCHOR_MS - 99);   // later DATE, even with an earlier ts
    const sameEarly = mv('deposit', 0.04, 'cold', '2026-09-12', ANCHOR_MS - 1);    // logged before the total was typed
    const sameLate  = mv('deposit', 0.08, 'cold', '2026-09-12', ANCHOR_MS + 1);    // logged AFTER re-typing the total
    expect(deriveColdStorage([before], 1, ANCHOR_MS)).toBe(1);
    expect(deriveColdStorage([after], 1, ANCHOR_MS)).toBeCloseTo(1.02, 12);
    expect(deriveColdStorage([sameEarly], 1, ANCHOR_MS)).toBe(1);                // `>=` on date would re-sum this
    expect(deriveColdStorage([sameLate], 1, ANCHOR_MS)).toBeCloseTo(1.08, 12);   // a date-only `>` would LOSE this
  });

  it('with no anchor, every cold move counts on top of the scalar', () => {
    const log = [mv('deposit', 0.1, 'cold', '2020-01-01'), mv('deposit', 0.2, 'cold', '2030-01-01')];
    expect(deriveColdStorage(log, 1, null)).toBeCloseTo(1.3, 12);
  });

  it('deposits add, withdraws subtract — amount is a magnitude, the sign comes from the kind', () => {
    const log = [mv('deposit', 0.5, 'cold', '2026-09-13'), mv('withdraw', 0.2, 'cold', '2026-09-14')];
    expect(deriveColdStorage(log, 1, ANCHOR_MS)).toBeCloseTo(1.3, 12);
  });

  it('other targets are ignored', () => {
    const log = [
      mv('deposit', 0.5, 'strike', '2026-09-13'), mv('withdraw', 0.2, 'cb', '2026-09-14'),
      mv('deposit', 0.1, 'cold', '2026-09-14'),
    ];
    expect(deriveColdStorage(log, 1, ANCHOR_MS)).toBeCloseTo(1.1, 12);
  });

  it('degenerate input never yields NaN or a negative balance', () => {
    expect(deriveColdStorage([], NaN, null)).toBe(0);
    expect(deriveColdStorage([], -1, null)).toBe(0);
    expect(deriveColdStorage([mv('deposit', NaN, 'cold', '2026-09-13')], 1, ANCHOR_MS)).toBe(1);
    expect(deriveColdStorage([mv('withdraw', 5, 'cold', '2026-09-13')], 1, ANCHOR_MS)).toBe(0);
  });

  it('coldMovesSinceAnchor counts exactly the moves the derive adds (one rule, two readers)', () => {
    const log = [
      mv('deposit', 0.01, 'cold', '2026-09-11'), mv('deposit', 0.02, 'cold', '2026-09-13'),
      mv('deposit', 0.04, 'cold', '2026-09-12', ANCHOR_MS - 1), mv('deposit', 0.08, 'cold', '2026-09-12', ANCHOR_MS + 1),
      mv('deposit', 0.5, 'strike', '2026-09-13'),
    ];
    expect(coldMovesSinceAnchor(log, ANCHOR_MS)).toBe(2);
    expect(coldMovesSinceAnchor(log, null)).toBe(4);
  });
});

describe('⭐ the other two derives are unaffected by cold moves', () => {
  it('deriveStrikeCollateral and deriveCbCollateral are identical with and without cold events in the log', () => {
    const base: DayEvent[] = [
      { id: 'r1', date: '2026-09-10', ts: 1, kind: 'balanceReading',
        reading: { strikeBal: 5_000, strikeLtv: 0.1, strikeCollateral: 0.5, cbCollateral: 1.2 } },
      mv('deposit', 0.1, 'strike', '2026-09-11'),
      { id: 'c1', date: '2026-09-11', ts: 5, kind: 'cbCollateralReading', cbCollateral: 1.3 },
    ];
    const withCold = [...base, mv('deposit', 0.4, 'cold', '2026-09-12'), mv('withdraw', 0.1, 'cold', '2026-09-13')];
    expect(deriveStrikeCollateral(withCold, 0)).toBe(deriveStrikeCollateral(base, 0));
    expect(deriveCbCollateral(withCold, 0)).toBe(deriveCbCollateral(base, 0));
  });
});
