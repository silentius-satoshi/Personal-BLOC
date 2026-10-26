import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  deriveReplays, monthEndCloses, replayPath, REPLAY_CYCLES, MONTH_END_MAX_GAP_DAYS, type DatedPrice, type Replay,
} from '../cycleReplays';
import { plBandAt } from '../powerLaw';
import { breakerFromHistory } from '../../components/Almanac/supportPolicyInputs';

/**
 * The bear-market replays (FIRE plan §4.3; D1 A′, F9 — batch 1 build 3): a belief leaf beside cyclePath.ts. Dated prices
 * in, replays out — derived, never typed. Month 0 is each cycle's top in the finest data given; month k is the k-th
 * month-end close strictly after it (breakerFromHistory's rule) ÷ the top, through the reclaim; then the trend tail; spliced
 * in at the stop month at exactly that month's price. No price series is committed (D-2): every history here is a
 * synthetic one — round invented prices on real calendar dates. Every assertion carries a tag; each planted bug in
 * `build-3-mutations.json` turns its own tag red.
 */

const DAY = 86_400_000;
const utc = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const rng = (seed: number) => () => { seed = (seed * 1_664_525 + 1_013_904_223) >>> 0; return seed / 4_294_967_296; };

/** A daily history from `fromISO` to `toISO` (inclusive) at UTC midnights, priced by `priceAt`. */
function daily(fromISO: string, toISO: string, priceAt: (ms: number) => number): DatedPrice[] {
  const out: DatedPrice[] = [];
  for (let t = utc(fromISO); t <= utc(toISO); t += DAY) out.push({ timestamp: t, price: priceAt(t) });
  return out;
}

/** The 2017 cycle, invented: flat at $50,000, a one-day top of $100,000 on 15 Dec 2017 — mid-month, above every
 *  month-end — then a level a month: Dec's close $80,000, a trough of $20,000 at March's, the top taken back at August's. */
const LEVELS: [string, number][] = [
  ['2017-12-16', 80_000], ['2018-01-01', 60_000], ['2018-02-01', 40_000], ['2018-03-01', 20_000], ['2018-04-01', 30_000],
  ['2018-05-01', 50_000], ['2018-06-01', 70_000], ['2018-07-01', 90_000], ['2018-08-01', 110_000], ['2018-09-01', 120_000],
];
const priceOf2017 = (t: number): number => {
  if (t < utc('2017-12-15')) return 50_000;
  if (t === utc('2017-12-15')) return 100_000;
  let p = 0;
  for (const [iso, level] of LEVELS) if (t >= utc(iso)) p = level;
  return p;
};
const HISTORY = daily('2013-06-01', '2025-06-30', (t) => (t >= utc('2017-06-01') && t <= utc('2019-06-30') ? priceOf2017(t) : 30_000));
const TODAY = new Date('2026-10-05T00:00:00Z');
const replayOf = (id: string, history: DatedPrice[] = HISTORY, today: Date = TODAY): Replay => {
  const r = deriveReplays(history, today).find((x) => x.id === id)!;
  expect(r.reason, `premise: the ${id} replay reads`).toBeNull();
  return r.replay!;
};

describe('⭐ PEAK — month 0 is the cycle\'s top in the finest data given, never a month-end', () => {
  it('a top on the 15th, above every month-end, is month 0', () => {
    const r = replayOf('2017');
    expect(r.peakUsd, 'PEAK the top, not December\'s close').toBe(100_000);
    expect(r.peakTimestamp, 'PEAK its day').toBe(utc('2017-12-15'));
    expect(r.mult[0], 'PEAK month 0 = ×1').toBe(1);
    expect(r.mult[1], 'PEAK December\'s close ÷ the top').toBe(80_000 / 100_000);
  });

  it('a top on its month\'s last point: that month\'s close is the top itself, so month 1 is the next month\'s close', () => {
    const h = daily('2021-09-01', '2023-12-31', (t) => (t === utc('2021-11-30') ? 90_000 : t < utc('2021-11-30') ? 40_000 : t < utc('2022-01-01') ? 30_000 : 100_000));
    const r = replayOf('2021', h);
    expect([r.peakUsd, r.monthEndISO[0], r.mult[1]], 'PEAK month 1 is December\'s').toEqual([90_000, '2021-12-31', 30_000 / 90_000]);
  });
});

describe('⭐ MONTH-END — breakerFromHistory\'s rule: the last point strictly before the next month\'s first UTC midnight, < 7 days before it', () => {
  it('exactly 7 days is junk; 7 days − 1 ms is a close; a point at the next month\'s first midnight is the next month\'s', () => {
    const end = utc('2030-02-01');
    const at = (ms: number): DatedPrice[] => [{ timestamp: utc('2030-01-03'), price: 5 }, { timestamp: ms, price: 7 }, { timestamp: end, price: 9 }];
    const jan = (h: DatedPrice[]) => monthEndCloses(h, new Date('2030-03-15T00:00:00Z'))[0];
    expect(MONTH_END_MAX_GAP_DAYS, 'MONTH-END the breaker\'s 7 days').toBe(7);
    expect(jan(at(end - 7 * DAY)).price, 'MONTH-END exactly 7 days: junk').toBeNull();
    expect(jan(at(end - 7 * DAY + 1)).price, 'MONTH-END 7 days − 1 ms: the close').toBe(7);
    expect(jan(at(end - DAY)).endISO, 'MONTH-END dated the month\'s last day').toBe('2030-01-31');
    expect(jan(at(end - DAY)).price, 'MONTH-END the 1 Feb midnight point is never January\'s close').toBe(7);
    expect(monthEndCloses(at(end - DAY), new Date('2030-02-20T00:00:00Z')).length, 'MONTH-END only months closed before today').toBe(1);
  });

  it('⭐ MONTH-END ≡ BREAKER — over seeded histories the leaf\'s last month-end is the breaker\'s, or both are null', () => {
    const r = rng(2009);
    let compared = 0, boundaries = 0;
    for (let i = 0; i < 1_500; i++) {
      // Whole days at UTC midnight, 1–9 apart, so exact 7-day gaps — the rule's boundary — occur; all after Feb 2009,
      // where the support line the breaker also checks is above 0.
      const h: DatedPrice[] = [];
      let t = utc('2015-01-01') + Math.floor(r() * 3_000) * DAY;
      const n = 1 + Math.floor(r() * 90);
      for (let k = 0; k < n; k++) { t += (1 + Math.floor(r() * 9)) * DAY; h.push({ timestamp: t, price: 1_000 + Math.floor(r() * 90_000) }); }
      const today = new Date(t + Math.floor(r() * 60 - 25) * DAY);
      const ends = monthEndCloses(h, today);
      boundaries += ends.filter((e) => e.price === null).length;
      const mine = [...ends].reverse().find((e) => e.price !== null)?.endISO ?? null;
      expect(mine, `MONTH-END ≡ BREAKER #${i}`).toBe(breakerFromHistory(h, today, null)?.lastMonthEndISO ?? null);
      compared += 1;
    }
    // Crafted: a close 7 days − 1 ms before its month's end, and a today inside the first point's own month.
    const tight: DatedPrice[] = [{ timestamp: utc('2031-05-25') + 1, price: 3 }, { timestamp: utc('2031-06-10'), price: 4 }];
    expect(monthEndCloses(tight, new Date('2031-07-02T00:00:00Z'))[0].endISO, 'MONTH-END ≡ BREAKER tight').toBe(breakerFromHistory(tight, new Date('2031-07-02T00:00:00Z'), null)!.lastMonthEndISO);
    const early: DatedPrice[] = [{ timestamp: utc('2031-05-03'), price: 3 }];
    expect(breakerFromHistory(early, new Date('2031-05-20T00:00:00Z'), null), 'MONTH-END ≡ BREAKER none closed').toBeNull();
    expect(monthEndCloses(early, new Date('2031-05-20T00:00:00Z')), 'MONTH-END ≡ BREAKER none closed').toEqual([]);
    expect(compared, 'MONTH-END ≡ BREAKER non-vacuous').toBe(1_500);
    expect(boundaries, 'MONTH-END ≡ BREAKER non-vacuous: junk months occur').toBeGreaterThan(100);
  });
});

describe('⭐ TROUGH and RECLAIM — the trough in its range; the replay ends at the first close at or above the top', () => {
  it('the invented 2017 cycle: ×0.2 in month 4 (March 2018), the top taken back in month 9 (August 2018)', () => {
    const r = replayOf('2017');
    expect(r.mult, 'TROUGH every month-end ÷ the top').toEqual([1, 0.8, 0.6, 0.4, 0.2, 0.3, 0.5, 0.7, 0.9, 1.1]);
    expect([r.troughMult, r.troughMonth], 'TROUGH in its range').toEqual([0.2, 4]);
    expect(r.monthEndISO[r.troughMonth - 1], 'TROUGH its close').toBe('2018-03-31');
    expect(r.reclaimMonth, 'RECLAIM found').toBe(9);
    expect(r.monthEndISO[8], 'RECLAIM its close').toBe('2018-08-31');
  });

  it('a history that ends before the reclaim runs through its last close, unreclaimed', () => {
    const cut = HISTORY.filter((p) => p.timestamp <= utc('2018-05-31'));
    const r = replayOf('2017', cut, new Date('2018-06-10T00:00:00Z'));
    expect([r.reclaimMonth, r.mult.length], 'RECLAIM not found').toEqual([null, 7]);
  });
});

describe('⭐ SPLICE — the replay starts at exactly the stop month\'s price, wherever the cycle is', () => {
  it('the base path before the stop; the stop price exactly; then stop price × each multiple', () => {
    const start = new Date('2026-10-05T00:00:00Z');
    const base = Array.from({ length: 120 }, (_, m) => 1.5 * plBandAt('floor', start, m));
    const r = replayOf('2017');
    for (const stop of [0, 17, 60]) {
      const path = replayPath(base, start, stop, r);
      expect(path.length, `SPLICE ${stop} the horizon`).toBe(120);
      expect(path.slice(0, stop + 1), `SPLICE ${stop} the base up to the stop price, exactly`).toEqual(base.slice(0, stop + 1));
      for (let k = 1; k < r.mult.length; k++) expect(path[stop + k], `SPLICE ${stop} +${k}`).toBe(base[stop] * r.mult[k]);
    }
  });
});

describe('⭐ TAIL — after the replay, the trend: plConvergencePath at Infinity (w = 1, the band\'s coefficient cancels)', () => {
  for (const iso of ['2026-10-05', '2026-01-31']) {
    it(`the tail grows as every band grows, to 1e-12, on the face's own calendar (from ${iso})`, () => {
      const start = new Date(`${iso}T00:00:00Z`);
      const base = Array.from({ length: 200 }, (_, m) => 1.5 * plBandAt('floor', start, m));   // a path off the band
      const r = replayOf('2017');
      const stop = 25, after = stop + r.mult.length - 1;
      const path = replayPath(base, start, stop, r);
      for (let m = after + 1; m < 200; m++) {
        for (const band of ['floor', 'fair', 'ceiling'] as const) {
          const growth = plBandAt(band, start, m) / plBandAt(band, start, m - 1);
          expect(Math.abs(path[m] / path[m - 1] / growth - 1), `TAIL ${band} m${m}`).toBeLessThan(1e-12);
        }
      }
      expect(path[after], 'TAIL starts where the replay ended').toBe(base[stop] * r.mult[r.mult.length - 1]);
    });
  }
});

describe('⭐ EDGES — the replays never invent a figure', () => {
  it('a stop past the horizon leaves the base; a replay longer than the horizon is cut, with no tail', () => {
    const start = new Date('2026-10-05T00:00:00Z');
    const base = Array.from({ length: 12 }, (_, m) => 50_000 + m);
    const r = replayOf('2017');
    expect(replayPath(base, start, 12, r), 'EDGES stop at the horizon').toEqual(base);
    expect(replayPath(base, start, Number.NaN, r), 'EDGES a junk stop').toEqual(base);
    const cut = replayPath(base, start, 8, r);
    expect(cut.length, 'EDGES cut at the horizon').toBe(12);
    expect(cut.slice(9), 'EDGES the replay to the horizon').toEqual([1, 2, 3].map((k) => base[8] * r.mult[k]));
  });

  it('no point in the window, a junk month inside, nothing after the top → no replay, and why', () => {
    const none = deriveReplays(HISTORY.filter((p) => p.timestamp < utc('2013-11-01') || p.timestamp >= utc('2014-01-01')), TODAY);
    expect(none.find((x) => x.id === '2013')!.reason, 'EDGES no peak').toBe('noPeak');
    const holed = HISTORY.filter((p) => p.timestamp < utc('2018-02-20') || p.timestamp >= utc('2018-03-02'));
    expect(deriveReplays(holed, TODAY).find((x) => x.id === '2017')!.reason, 'EDGES a junk month inside').toBe('gap');
    const ends = HISTORY.filter((p) => p.timestamp <= utc('2017-12-15'));
    expect(deriveReplays(ends, new Date('2017-12-20T00:00:00Z')).find((x) => x.id === '2017')!.reason, 'EDGES nothing after the top').toBe('gap');
  });

  it('junk and unsorted points change nothing', () => {
    const r = rng(5);
    const shuffled = [...HISTORY].sort(() => r() - 0.5);
    shuffled.push({ timestamp: utc('2018-01-31'), price: Number.NaN }, { timestamp: utc('2018-01-30'), price: -5 }, { timestamp: Number.NaN, price: 9e9 });
    expect(deriveReplays(shuffled, TODAY), 'EDGES the same replays').toEqual(deriveReplays(HISTORY, TODAY));
  });
});

describe('⭐ WINDOWS — each cycle is named by its top\'s window: dates, never multipliers', () => {
  it('late 2013, Dec 2017, Nov 2021 — and the module types no multiplier', () => {
    expect(REPLAY_CYCLES, 'WINDOWS the three').toEqual([
      { id: '2013', topFromISO: '2013-11-01', topToISO: '2013-12-31' },
      { id: '2017', topFromISO: '2017-12-01', topToISO: '2017-12-31' },
      { id: '2021', topFromISO: '2021-11-01', topToISO: '2021-11-30' },
    ]);
    const src = readFileSync(join(process.cwd(), 'src/simulation/cycleReplays.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // An array literal of two or more numbers — a typed series or a typed set of multipliers — never appears.
    expect(src, 'WINDOWS no typed numbers').not.toMatch(/\[\s*-?\d[\d_.]*(?:e-?\d+)?\s*,\s*-?\.?\d/);
    expect('const m = [0.25, 0.3]', 'WINDOWS the regex bites').toMatch(/\[\s*-?\d[\d_.]*(?:e-?\d+)?\s*,\s*-?\.?\d/);
  });
});
