import { describe, it, expect } from 'vitest';
import {
  orderTs, ownReadingAfterEdit, deriveCbCollateral, deriveStrikeCollateral, rollupMonth, priorStocksForMonth,
  unreconciledCbFlows, deriveColdStorage, deriveReadingAnchors, coldMovesSinceAnchor, type ReadingAnchorState,
} from '../logUtils';
import { correctionDurability } from '../../components/Advisor/monthlyLogForm';
import { latestReadingForPrefill } from '../../components/Daily/eventSheetModel';
import { toLocalISO } from '../../utils/format';
import type { DayEvent } from '../types';

// Hotfix 1 — the journal's order. A day event's `ts` is the merge version clock: every edit and every Undo moves it.
// Where an event falls is its `date`, then — within the day — when it was first logged: `orderTs(e)` = `e.at ?? e.ts`,
// `at` being stamped by an edit or an Undo with the ts the event had. Every rule that picks a "latest" reading or counts
// what came "after" one reads that order; the merge alone reads ts.

type Reading = Extract<DayEvent, { kind: 'balanceReading' }>;
type Move = Extract<DayEvent, { kind: 'deposit' | 'withdraw' }>;
const START = '2026-01-01';
const rd = (id: string, date: string, ts: number, r: Partial<Reading['reading']>, at?: number): Reading =>
  ({ id, date, ts, ...(at !== undefined ? { at } : {}), kind: 'balanceReading', reading: { strikeBal: 0, strikeLtv: 0, ...r } });
const mv = (id: string, date: string, ts: number, kind: 'deposit' | 'withdraw', amount: number, target: Move['target'], at?: number): Move =>
  ({ id, date, ts, ...(at !== undefined ? { at } : {}), kind, amount, target });

describe('orderTs — where an event falls in its day', () => {
  it('is the ts an event was first logged with: `at` once an edit or Undo has moved ts, else ts', () => {
    expect(orderTs({ ts: 5 })).toBe(5);
    expect(orderTs({ ts: 9, at: 5 })).toBe(5);
    expect(orderTs({ ts: 9, at: 0 })).toBe(0);                  // 0 is a time, not "absent"
  });
});

describe('A2-1 — the current Coinbase collateral is the latest reading by date, then by when it was logged', () => {
  const mar5 = rd('a', '2026-03-05', 1000, { cbCollateral: 1 });
  const mar25 = rd('b', '2026-03-25', 2000, { cbCollateral: 2 });
  it('a reading edited, restored or backfilled later (a higher ts) on an earlier date does not become current', () => {
    expect(deriveCbCollateral([mar5, mar25])).toBe(2);
    expect(deriveCbCollateral([{ ...mar5, ts: 9000, at: 1000 }, mar25])).toBe(2);   // edited / restored
    expect(deriveCbCollateral([mar25, rd('c', '2026-03-05', 9000, { cbCollateral: 1 })])).toBe(2);   // backfilled
    expect(deriveCbCollateral([mar25, { id: 'k', date: '2026-03-10', ts: 9000, kind: 'cbCollateralReading', cbCollateral: 1.5 }])).toBe(2);
  });
  it('on the same day the later-logged one is current, whichever was edited last', () => {
    const am = rd('am', '2026-03-25', 1000, { cbCollateral: 1.5 });
    const pm = rd('pm', '2026-03-25', 2000, { cbCollateral: 2 });
    expect(deriveCbCollateral([am, pm])).toBe(2);
    expect(deriveCbCollateral([{ ...am, ts: 9000, at: 1000 }, pm])).toBe(2);
    expect(deriveCbCollateral([am, { ...pm, ts: 500 }])).toBe(1.5);          // logged earlier → earlier in its day
  });
  it('an exact tie (same date, same place) goes to the later in the list, as the ts rule did', () => {
    const x = rd('x', '2026-03-25', 1000, { cbCollateral: 1 });
    const y: DayEvent = { id: 'y', date: '2026-03-25', ts: 1000, kind: 'cbCollateralReading', cbCollateral: 3 };
    expect(deriveCbCollateral([x, y])).toBe(3);
    expect(deriveCbCollateral([y, x])).toBe(1);
  });
  it('no Coinbase-bearing event → the stored cache, never undefined', () => {
    expect(deriveCbCollateral([rd('s', '2026-03-25', 1, { strikeCollateral: 1 })], 1.48)).toBe(1.48);
    expect(deriveCbCollateral([])).toBe(0);
  });
});

describe('A2-4 — a month closes on its latest reading by date, and the next month carries that one forward', () => {
  const mar5 = rd('a', '2026-03-05', 9000, { strikeBal: 10_000, strikeLtv: 0.1, cbBal: 4_000, cbLtv: 0.4 });   // backfilled last
  const mar25 = rd('b', '2026-03-25', 2000, { strikeBal: 12_000, strikeLtv: 0.12, cbBal: 40_000, cbLtv: 0.2, strikeCollateral: 1 });
  const log: DayEvent[] = [mar25, mar5];
  it('rollupMonth takes the Mar 25 stocks, whatever was logged or edited after', () => {
    const { entry } = rollupMonth(log, 3, START);
    expect([entry.strikeBal, entry.strikeLtv, entry.cbBal, entry.cbLtv, entry.btcHeld]).toEqual([12_000, 0.12, 40_000, 0.2, 1]);
    const edited = rollupMonth([{ ...mar25, ts: 1 }, rd('a2', '2026-03-05', 9999, { strikeBal: 10_500 }, 1000)], 3, START).entry;
    expect(edited.strikeBal).toBe(12_000);
  });
  it('priorStocksForMonth carries Mar 25 into April', () => {
    expect(priorStocksForMonth(log, START, 4)).toMatchObject({ strikeBal: 12_000, strikeLtv: 0.12, cbBal: 40_000, strikeCollateral: 1 });
  });
  it('correctionDurability reads the same reading as the next re-roll: Mar 25 states collateral → stated', () => {
    expect(rollupMonth(log, 3, START).entry.btcHeld).toBe(1);
    expect(correctionDurability(log, START, 3)).toBe('stated');
  });
  it('same day: the later-logged reading closes the month even after the earlier one is edited', () => {
    const am = rd('am', '2026-03-25', 1000, { strikeBal: 10_000 });
    const pm = rd('pm', '2026-03-25', 2000, { strikeBal: 12_000 });
    expect(rollupMonth([{ ...am, ts: 9000, at: 1000 }, pm], 3, START).entry.strikeBal).toBe(12_000);
    expect(priorStocksForMonth([{ ...am, ts: 9000, at: 1000 }, pm], START, 4)?.strikeBal).toBe(12_000);
  });
});

describe('A2-3 — a Strike move counts after its anchor by where it falls, not by its version', () => {
  const R0 = rd('r0', '2026-06-10', 1000, { strikeCollateral: 1 });
  it('the LD6 pair: a move sharing its reading\'s place is inside the total, edited or restored', () => {
    const d = mv('d', '2026-06-10', 2000, 'deposit', 0.1, 'strike');
    const r = rd('r', '2026-06-10', 2000, { strikeCollateral: 1.1 });
    expect(deriveStrikeCollateral([R0, d, r])).toBeCloseTo(1.1, 12);
    expect(deriveStrikeCollateral([R0, { ...d, ts: 9000, at: 2000 }, r])).toBeCloseTo(1.1, 12);
    expect(deriveStrikeCollateral([R0, r, { ...d, ts: 9000, at: 2000 }])).toBeCloseTo(1.1, 12);   // Undo re-appends
  });
  it('the anchor is the latest reading by place too: an edited earlier reading on the day does not take over', () => {
    const am = rd('am', '2026-06-10', 1000, { strikeCollateral: 0.5 });
    const pm = rd('pm', '2026-06-10', 2000, { strikeCollateral: 0.6 });
    expect(deriveStrikeCollateral([{ ...am, ts: 9000, at: 1000, reading: { ...am.reading, strikeCollateral: 0.9 } }, pm])).toBe(0.6);
  });
  it('HJ-04 · a deposit backfilled to a date before the anchor reading is not re-summed (date first, not ts)', () => {
    const log: DayEvent[] = [rd('a', '2026-01-20', 10, { strikeCollateral: 1 }), mv('d', '2026-01-05', 20, 'deposit', 0.3, 'strike')];
    expect(deriveStrikeCollateral(log, 0)).toBe(1);
  });
  it('a move logged after its day\'s reading still counts once, edited or not', () => {
    const d = mv('d', '2026-06-10', 3000, 'deposit', 0.1, 'strike');
    expect(deriveStrikeCollateral([R0, d])).toBeCloseTo(1.1, 12);
    expect(deriveStrikeCollateral([R0, { ...d, amount: 0.15, ts: 9000, at: 3000 }])).toBeCloseTo(1.15, 12);
  });
});

describe('the other "after the anchor" rules read the same place', () => {
  it('unreconciledCbFlows · a Coinbase borrow logged before the day\'s Coinbase reading stays inside it when edited', () => {
    const draw: DayEvent = { id: 'b', date: '2026-06-10', ts: 1000, kind: 'draw', target: 'cb', amount: 10_000 };
    const r = rd('r', '2026-06-10', 2000, { cbBal: 70_000 });
    expect(unreconciledCbFlows([draw, r]).events).toHaveLength(0);
    expect(unreconciledCbFlows([{ ...draw, amount: 12_000, ts: 9000, at: 1000 } as DayEvent, r]).events).toHaveLength(0);
    expect(unreconciledCbFlows([r, { ...draw, ts: 3000 }]).events).toHaveLength(1);   // logged after it: unreconciled
  });
  it('deriveColdStorage · a cold move logged before the total was typed stays inside it when edited or restored', () => {
    const anchorMs = 50_000;
    const day = toLocalISO(new Date(anchorMs));
    const c = mv('c', day, 40_000, 'deposit', 0.2, 'cold');
    expect(deriveColdStorage([c], 1, anchorMs)).toBe(1);
    expect(deriveColdStorage([{ ...c, ts: 90_000, at: 40_000 }], 1, anchorMs)).toBe(1);
    expect(coldMovesSinceAnchor([{ ...c, ts: 90_000, at: 40_000 }], anchorMs)).toBe(0);
    expect(deriveColdStorage([{ ...c, ts: 60_000 }], 1, anchorMs)).toBeCloseTo(1.2, 12);   // logged after: counts
  });
  it('deriveReadingAnchors · an edited morning reading does not re-anchor the balances over the evening one', () => {
    const cur: ReadingAnchorState = {
      advisorActualBlocBalance: 12_000, advisorActualBlocBalanceAsOf: '2026-06-10',
      cbLoanBalance: 52_000, cbLoanBalanceAsOf: '2026-06-10', cbLiquidationPrice: 0, cbLiquidationPriceAsOf: null,
    };
    const am = rd('am', '2026-06-10', 9000, { strikeBal: 10_500, cbBal: 50_500 }, 1000);
    const pm = rd('pm', '2026-06-10', 2000, { strikeBal: 12_000, cbBal: 52_000 });
    expect(deriveReadingAnchors([am, pm], cur)).toEqual({});
  });
  it('the today sheet prefills from the latest reading by date, then by when it was logged', () => {
    const older = rd('o', '2026-06-01', 9000, { strikeBal: 1 });            // backfilled (or edited) last
    const newer = rd('n', '2026-06-10', 2000, { strikeBal: 2 });
    expect(latestReadingForPrefill([newer, older])?.id).toBe('n');
    const am = rd('am', '2026-06-10', 9000, { strikeBal: 3 }, 1000);
    expect(latestReadingForPrefill([am, newer])?.id).toBe('n');
    expect(latestReadingForPrefill([mv('d', '2026-06-10', 1, 'deposit', 1, 'strike')])).toBeNull();
  });
});

describe('an exact tie (same date, same place) resolves as each rule\'s ts form did', () => {
  // ≥ rules (a tie to the later in the list): the CB collateral, a month's close, the carry-forward, the durability, the
  // balance anchors. > rules (a tie to the first): the Strike anchor, the CB-flows anchor, the prefill.
  const a = rd('a', '2026-03-10', 1000, { strikeBal: 1, strikeCollateral: 1, cbBal: 1, cbCollateral: 1 });
  const b = rd('b', '2026-03-10', 1000, { strikeBal: 2, cbBal: 2, cbCollateral: 2 });
  const log: DayEvent[] = [a, b];
  it('≥ — the later in the list', () => {
    expect(deriveCbCollateral(log)).toBe(2);
    expect(rollupMonth(log, 3, START).entry.strikeBal).toBe(2);
    expect(priorStocksForMonth(log, START, 4)?.strikeBal).toBe(2);
    expect(correctionDurability(log, START, 3)).toBe('stable');            // b states no collateral
    expect(deriveReadingAnchors(log, {
      advisorActualBlocBalance: 0, advisorActualBlocBalanceAsOf: null, cbLoanBalance: 0, cbLoanBalanceAsOf: null,
      cbLiquidationPrice: 0, cbLiquidationPriceAsOf: null,
    })).toMatchObject({ advisorActualBlocBalance: 2, cbLoanBalance: 2 });
  });
  it('> — the first in the list', () => {
    const c = rd('c', '2026-03-10', 1000, { strikeBal: 3, strikeCollateral: 3, cbBal: 3 });
    expect(deriveStrikeCollateral([a, c])).toBe(1);
    expect(unreconciledCbFlows([a, c]).anchorCbBal).toBe(1);
    expect(latestReadingForPrefill([a, c])?.id).toBe('a');
  });
});

describe('ownReadingAfterEdit — an edited Strike move carries its own reading (the one its Save wrote: same date, same place)', () => {
  const d = mv('d', '2026-06-10', 2000, 'deposit', 0.1, 'strike');
  const r = rd('r', '2026-06-10', 2000, { strikeBal: 1_000, strikeLtv: 0.01, strikeCollateral: 1.1, price: 100_000 });
  const log: DayEvent[] = [rd('r0', '2026-06-10', 1000, { strikeCollateral: 1 }), d, r];
  const edit = (after: Partial<Move>) => ({ ...d, ...after } as DayEvent);

  it('moves the reading\'s total by the change, in whole sats, at the edit\'s ts, keeping its place and every other figure', () => {
    const out = ownReadingAfterEdit(log, d, edit({ amount: 0.12 }), 7777)!;
    expect(out.reading).toEqual({ ...r.reading, strikeCollateral: 1.12 });
    expect(out.ts).toBe(7777);
    expect(out.at).toBe(2000);
    expect(out.id).toBe('r');
  });
  it('a withdrawal moves it the other way', () => {
    const w = mv('w', '2026-06-10', 2000, 'withdraw', 0.1, 'strike');
    const rw = rd('rw', '2026-06-10', 2000, { strikeCollateral: 0.9 });
    expect(ownReadingAfterEdit([w, rw], w, { ...w, amount: 0.05 }, 1)!.reading.strikeCollateral).toBe(0.95);
  });
  it('finds the reading by place after earlier edits moved both versions (at)', () => {
    const d2 = { ...d, ts: 5000, at: 2000 };
    const r2 = { ...r, ts: 5000, at: 2000 };
    expect(ownReadingAfterEdit([d2, r2], d2, { ...d2, amount: 0.2 }, 1)!.reading.strikeCollateral).toBe(1.2);
  });
  it('is null when nothing should move', () => {
    expect(ownReadingAfterEdit(log, d, edit({ amount: 0.1 }), 1)).toBeNull();                            // no change in size
    expect(ownReadingAfterEdit(log, d, edit({ date: '2026-06-11', amount: 0.2 }), 1)).toBeNull();        // a new date
    expect(ownReadingAfterEdit(log, d, edit({ kind: 'withdraw', amount: 0.2 }), 1)).toBeNull();          // a new kind
    expect(ownReadingAfterEdit(log, d, edit({ target: 'cold', amount: 0.2 }), 1)).toBeNull();            // a new target
    const cb = mv('c', '2026-06-10', 2000, 'deposit', 0.1, 'cb');
    expect(ownReadingAfterEdit([cb, r], cb, { ...cb, amount: 0.2 }, 1)).toBeNull();                       // a Coinbase move
    const past = rd('p', '2026-06-10', 2000, { strikeBal: 1 });                                           // states no collateral
    expect(ownReadingAfterEdit([d, past], d, edit({ amount: 0.2 }), 1)).toBeNull();
    expect(ownReadingAfterEdit([d], d, edit({ amount: 0.2 }), 1)).toBeNull();                             // logged alone
    expect(ownReadingAfterEdit([d, r, { ...r, id: 'r2' }], d, edit({ amount: 0.2 }), 1)).toBeNull();      // two candidates
    const other = rd('o', '2026-06-10', 2001, { strikeCollateral: 1.1 });                                 // not its place
    expect(ownReadingAfterEdit([d, other], d, edit({ amount: 0.2 }), 1)).toBeNull();
  });
});

// ── The property the fix is for: an edit that changes nothing, and a delete then Undo, change no figure ─────────────
// Random journals — Strike, Coinbase and cold moves with and without their readings, Coinbase borrows, buys (some
// pledged), Coinbase collateral readings, backfills to an earlier date, several saves a day — then a random third of the
// events re-saved unchanged (ts moved on, `at` stamped as updateDayEvent stamps it) and the list re-ordered by ts as a
// merge leaves it. Every figure must be what it was. Amounts are multiples of 1/1024 ₿ and whole dollars, so sums are
// exact in any order.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomJournal(rng: () => number): { log: DayEvent[]; coldAt: number } {
  const log: DayEvent[] = [];
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
  const btc = () => Math.floor(rng() * 400 + 1) / 1024;
  const usd = () => Math.floor(rng() * 50_000 + 1);
  let day = 0;
  let seq = 0;
  let coldAt = 0;
  const groups = 30 + Math.floor(rng() * 30);
  for (let g = 0; g < groups; g++) {
    if (rng() < 0.35) day += Math.floor(rng() * 9);             // several saves a day, or a jump
    const logDay = new Date(2026, 0, 1 + Math.min(day, 360));
    const logged = toLocalISO(logDay);
    const backfill = rng() < 0.25 && day > 5;
    const date = backfill ? toLocalISO(new Date(2026, 0, 1 + Math.floor(rng() * day))) : logged;
    const ts = logDay.getTime() + 3_600_000 + (++seq) * 60_000;   // within its logging day, increasing
    if (g === 15) coldAt = ts + 30_000;                          // the cold total typed between two saves
    const id = () => `e${g}-${++seq}`;
    const readingOf = (stateCollateral: boolean): Reading => ({
      id: id(), date, ts, kind: 'balanceReading', reading: {
        strikeBal: usd(), strikeLtv: usd() / 1e6,
        ...(stateCollateral && !backfill ? { strikeCollateral: btc() * 8 } : {}),
        ...(rng() < 0.6 ? { cbBal: usd(), cbLtv: usd() / 1e6, cbCollateral: btc() * 8 } : {}),
        ...(rng() < 0.2 ? { cbLiqPrice: usd() } : {}),
      },
    });
    switch (pick(['strike', 'strike', 'cb', 'cold', 'reading', 'borrow', 'buy', 'cbColl', 'draw'])) {
      case 'strike': log.push(mv(id(), date, ts, rng() < 0.7 ? 'deposit' : 'withdraw', btc(), 'strike'));
        if (rng() < 0.85) log.push(readingOf(true)); break;
      case 'cb': log.push(mv(id(), date, ts, rng() < 0.7 ? 'deposit' : 'withdraw', btc(), 'cb'), readingOf(true)); break;
      case 'cold': log.push(mv(id(), date, ts, rng() < 0.7 ? 'deposit' : 'withdraw', btc(), 'cold')); break;
      case 'reading': log.push(readingOf(rng() < 0.8)); break;
      case 'borrow': log.push({ id: id(), date, ts, kind: rng() < 0.6 ? 'draw' : 'paydown', target: 'cb', amount: usd() } as DayEvent); break;
      case 'draw': log.push({ id: id(), date, ts, kind: 'draw', amount: usd() }, readingOf(true)); break;
      case 'buy': {
        const amount = btc();
        log.push({ id: id(), date, ts, kind: 'buy', amount, usd: usd() });
        if (rng() < 0.4) log.push(mv(id(), date, ts, 'deposit', amount, 'strike'));
        log.push(readingOf(true)); break;
      }
      case 'cbColl': log.push({ id: id(), date, ts, kind: 'cbCollateralReading', cbCollateral: btc() * 8 }); break;
    }
  }
  return { log, coldAt };
}

const ANCHORS: ReadingAnchorState = {
  advisorActualBlocBalance: 1, advisorActualBlocBalanceAsOf: null, cbLoanBalance: 1, cbLoanBalanceAsOf: null,
  cbLiquidationPrice: 1, cbLiquidationPriceAsOf: null,
};

function figures(log: DayEvent[], coldAt: number) {
  const flows = unreconciledCbFlows(log);
  return {
    strike: deriveStrikeCollateral(log, 0.5),
    cb: deriveCbCollateral(log, 0.7),
    months: Array.from({ length: 12 }, (_, i) => rollupMonth(log, i + 1, START, priorStocksForMonth(log, START, i + 1)).entry),
    durability: Array.from({ length: 12 }, (_, i) => correctionDurability(log, START, i + 1)),
    cbFlows: { ids: flows.events.map((e) => e.id).sort(), drawn: flows.drawn, fees: flows.fees, paid: flows.paid, anchor: flows.anchorCbBal },
    cold: [deriveColdStorage(log, 1, coldAt), coldMovesSinceAnchor(log, coldAt)],
    anchors: deriveReadingAnchors(log, ANCHORS),
    prefill: latestReadingForPrefill(log)?.id ?? null,
  };
}

// What updateDayEvent does to an unchanged re-save, and what a delete then Undo does: ts moves on, `at` keeps the place.
const resave = (e: DayEvent, ts: number): DayEvent => ({ ...e, at: orderTs(e), ts });

describe('an edit that changes nothing, or a delete then Undo, changes no figure — random journals', () => {
  it('every figure is unchanged across 400 journals, a third of each re-saved and the list re-ordered by ts', () => {
    const rng = mulberry32(20261026);
    let resaved = 0, backfills = 0, sameDayPairs = 0, coldBoth = 0;
    for (let n = 0; n < 400; n++) {
      const { log, coldAt } = randomJournal(rng);
      const before = figures(log, coldAt);
      let t = Math.max(...log.map((e) => e.ts));
      const after = log.map((e) => (rng() < 0.33 ? (resaved++, resave(e, (t += 1000))) : e))
        .sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
      expect(figures(after, coldAt)).toEqual(before);
      // non-vacuity: the sweep reaches the cases the fix is for
      const day = toLocalISO(new Date(coldAt));
      backfills += log.filter((e) => e.date < toLocalISO(new Date(e.ts))).length;
      sameDayPairs += log.filter((e) => e.kind === 'deposit' && e.target === 'strike'
        && log.some((r) => r.kind === 'balanceReading' && r.date === e.date && r.ts === e.ts)).length;
      coldBoth += log.some((e) => e.kind !== 'balanceReading' && e.date === day && e.ts < coldAt) && log.some((e) => e.date === day && e.ts > coldAt) ? 1 : 0;
    }
    expect(resaved).toBeGreaterThan(4_000);
    expect(backfills).toBeGreaterThan(1_000);
    expect(sameDayPairs).toBeGreaterThan(1_000);
    expect(coldBoth).toBeGreaterThan(0);
  }, 60_000);
});
