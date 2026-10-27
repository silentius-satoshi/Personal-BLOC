import { describe, it, expect } from 'vitest';
import { replayPathsAt, fireReplayReadings } from '../fireReplays';
import type { DatedPrice } from '../../../simulation/cycleReplays';

/**
 * The FIRE face's replays — their one belief crossing (batch 1 build 4, D-3): each cycle spliced into the face's own
 * displayed path at the face's own stop month, at exactly that month's price. Every history here is synthetic — round
 * invented prices on real calendar dates (no price series is committed, D-2). Each assertion carries its tag (SPLICE AT
 * STOP, NO STOP, REASONS, HORIZON).
 */

const DAY = 86_400_000;
const utc = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
/** A daily history: each era flat under its cycle's invented top, then the top mid-window and its fall and recovery. */
function history(): DatedPrice[] {
  const out: DatedPrice[] = [];
  const tops: [string, number, number][] = [['2013-12-04', 1000, 400], ['2017-12-15', 20_000, 6000], ['2021-11-10', 60_000, 20_000]];
  for (let t = utc('2012-01-01'); t <= utc('2025-06-30'); t += DAY) {
    let p = t < utc('2016-01-01') ? 300 : t < utc('2020-01-01') ? 5000 : 15_000;
    for (const [iso, top, low] of tops) {
      const t0 = utc(iso);
      if (t === t0) p = top;
      else if (t > t0 && t < t0 + 900 * DAY) {
        const k = (t - t0) / (900 * DAY);   // down to `low` by a third of the way, back above the top by the end
        p = k < 1 / 3 ? top - (top - low) * k * 3 : low + (top * 1.1 - low) * ((k - 1 / 3) * 1.5);
      }
    }
    out.push({ timestamp: t, price: p });
  }
  return out;
}
const TODAY = new Date('2026-10-12T00:00:00Z');
const START = new Date('2026-10-12T00:00:00Z');
const BASE = Array.from({ length: 240 }, (_, m) => 100_000 + 500 * m);

describe('⭐ the replays\' crossing', () => {
  const readings = fireReplayReadings(history(), TODAY);

  it('⭐ SPLICE AT STOP — the base before the stop, exactly the stop month\'s price at it, then the cycle\'s fall', () => {
    expect(readings.map((r) => [r.id, r.reason]), 'SPLICE AT STOP premise: three replays').toEqual([['2013', null], ['2017', null], ['2021', null]]);
    for (const stop of [0, 30, 100]) {
      for (const r of replayPathsAt(BASE, START, stop, readings)) {
        const p = r.path as number[];
        expect(p.slice(0, stop), `SPLICE AT STOP ${r.id}@${stop}: the base before`).toEqual(BASE.slice(0, stop));
        expect(p[stop], `SPLICE AT STOP ${r.id}@${stop}: the stop month's price`).toBe(BASE[stop]);
        expect(p[stop + 1], `SPLICE AT STOP ${r.id}@${stop}: the fall begins after it`).toBeLessThan(BASE[stop]);
      }
    }
  });

  it('⭐ NO STOP — no stop month, or one at or past the horizon: nothing to replay', () => {
    expect(replayPathsAt(BASE, START, null, readings), 'NO STOP null').toEqual([]);
    expect(replayPathsAt(BASE, START, 240, readings), 'NO STOP at the horizon').toEqual([]);
    expect(replayPathsAt(BASE, START, 300, readings), 'NO STOP past it').toEqual([]);
  });

  it('⭐ REASONS — a cycle with no top in the history is named, never filled', () => {
    const late = history().filter((p) => p.timestamp >= utc('2016-01-01'));   // the 2013 window is gone
    const out = replayPathsAt(BASE, START, 10, fireReplayReadings(late, TODAY));
    expect(out.map((r) => [r.id, r.path === null, r.reason]), 'REASONS').toEqual([['2013', true, 'noPeak'], ['2017', false, null], ['2021', false, null]]);
    expect(replayPathsAt(BASE, START, 10, fireReplayReadings([], TODAY)).every((r) => r.path === null && r.reason === 'noPeak'), 'REASONS no history').toBe(true);
  });

  it('⭐ HORIZON — each replayed path is the face\'s path\'s length', () => {
    for (const n of [240, 120, 30]) {
      for (const r of replayPathsAt(BASE.slice(0, n), START, 5, readings)) expect((r.path as number[]).length, `HORIZON ${r.id} ${n}`).toBe(n);
    }
  });
});
