import { describe, it, expect } from 'vitest';
import { monthDateRange, weekDates, buildDayCells, readingTargetDate,
  buildDayActivity, buildMonthRollup, groupEventsByDay, formatMoves } from '../calendarModel';
import { bucketEventToMonth } from '../../../simulation/logUtils';
import type { DayEvent } from '../../../simulation/types';

const START = '2025-01-01';
const DAY_MS = 86_400_000;

describe('monthDateRange', () => {
  it('every returned date buckets back to the requested month', () => {
    for (const m of [1, 2, 6, 12]) {
      for (const d of monthDateRange(START, m)) {
        expect(bucketEventToMonth(d, START)).toBe(m);
      }
    }
  });

  it('is ascending and contiguous (one calendar day apart)', () => {
    const dates = monthDateRange(START, 4);
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]).getTime();
      const cur = new Date(dates[i]).getTime();
      expect(cur).toBe(prev + DAY_MS);   // contiguous + ascending
    }
    // a strategy month is ~30–31 calendar days
    expect(dates.length).toBeGreaterThanOrEqual(30);
    expect(dates.length).toBeLessThanOrEqual(31);
  });

  it('month 1 starts at advisorStartDate', () => {
    expect(monthDateRange(START, 1)[0]).toBe(START);
  });

  it('boundary: last date of month N and first of month N+1 bucket correctly + are adjacent', () => {
    const m3 = monthDateRange(START, 3);
    const m4 = monthDateRange(START, 4);
    const lastM3 = m3[m3.length - 1];
    const firstM4 = m4[0];
    expect(bucketEventToMonth(lastM3, START)).toBe(3);
    expect(bucketEventToMonth(firstM4, START)).toBe(4);
    expect(new Date(firstM4).getTime()).toBe(new Date(lastM3).getTime() + DAY_MS);
  });
});

describe('weekDates', () => {
  it('returns 7 dates Monday→Sunday containing the input', () => {
    // 2025-01-08 is a Wednesday
    const wk = weekDates('2025-01-08');
    expect(wk).toHaveLength(7);
    expect(wk).toContain('2025-01-08');
    expect(wk[0]).toBe('2025-01-06');   // Monday
    expect(wk[6]).toBe('2025-01-12');   // Sunday
  });

  it('Monday input → Monday is first', () => {
    expect(weekDates('2025-01-06')[0]).toBe('2025-01-06');
  });

  it('Sunday input → still Monday-first (Sunday is last)', () => {
    const wk = weekDates('2025-01-12');   // Sunday
    expect(wk[0]).toBe('2025-01-06');
    expect(wk[6]).toBe('2025-01-12');
  });
});

describe('buildDayCells', () => {
  const draw:    DayEvent = { id: 'a', date: '2025-01-05', ts: 1, kind: 'draw', amount: 1000 };
  const reading: DayEvent = { id: 'b', date: '2025-01-06', ts: 2, kind: 'balanceReading', reading: { strikeBal: 5000, strikeLtv: 0.12 } };
  const cbDep:   DayEvent = { id: 'c', date: '2025-01-07', ts: 3, kind: 'deposit', amount: 0.1, target: 'cb' };
  const strikeDep: DayEvent = { id: 'd', date: '2025-01-08', ts: 4, kind: 'deposit', amount: 0.2, target: 'strike' };

  it('a draw day → [logged]', () => {
    const cells = buildDayCells([draw], ['2025-01-05']);
    expect(cells[0].pips).toEqual(['logged']);
    expect(cells[0].day).toBe(5);
  });

  it('a balanceReading day → [reading]', () => {
    expect(buildDayCells([reading], ['2025-01-06'])[0].pips).toEqual(['reading']);
  });

  it('a day with both flow and reading → both', () => {
    const both: DayEvent = { ...reading, date: '2025-01-05', id: 'e' };
    expect(buildDayCells([draw, both], ['2025-01-05'])[0].pips).toEqual(['logged', 'reading']);
  });

  it('a CB-target deposit → [logged, cbCollateral]', () => {
    expect(buildDayCells([cbDep], ['2025-01-07'])[0].pips).toEqual(['logged', 'cbCollateral']);
  });

  it('a Strike-target deposit → [logged] only (no cbCollateral)', () => {
    expect(buildDayCells([strikeDep], ['2025-01-08'])[0].pips).toEqual(['logged']);
  });

  it('an empty day → []', () => {
    expect(buildDayCells([draw], ['2025-01-09'])[0].pips).toEqual([]);
  });

  it('weekday is Monday-anchored (Mon=0 … Sun=6)', () => {
    // 2025-01-06 = Monday → 0; 2025-01-12 = Sunday → 6
    expect(buildDayCells([], ['2025-01-06'])[0].weekday).toBe(0);
    expect(buildDayCells([], ['2025-01-12'])[0].weekday).toBe(6);
  });
});

describe('buildDayActivity / buildMonthRollup / groupEventsByDay (P4c-1b)', () => {
  const drawA:     DayEvent = { id: 'a', date: '2025-01-05', ts: 1, kind: 'draw', amount: 1000 };
  const buyA:      DayEvent = { id: 'b', date: '2025-01-05', ts: 2, kind: 'buy', amount: 0.01, usd: 800 };
  const paydownA:  DayEvent = { id: 'c', date: '2025-01-06', ts: 3, kind: 'paydown', amount: 500 };
  const strikeDep: DayEvent = { id: 'd', date: '2025-01-07', ts: 4, kind: 'deposit', amount: 0.2, target: 'strike' };
  const strikeWd:  DayEvent = { id: 'e', date: '2025-01-08', ts: 5, kind: 'withdraw', amount: 0.05, target: 'strike' };
  const cbDep:     DayEvent = { id: 'f', date: '2025-01-09', ts: 6, kind: 'deposit', amount: 0.1, target: 'cb' };
  const reading:   DayEvent = { id: 'g', date: '2025-01-06', ts: 7, kind: 'balanceReading', reading: { strikeBal: 5000, strikeLtv: 0.12 } };
  const LOG = [drawA, buyA, paydownA, strikeDep, strikeWd, cbDep, reading];

  it('buildDayActivity filters by date, sums streams, moves, isEmpty', () => {
    const day = buildDayActivity(LOG, '2025-01-05');
    expect(day.events.map((e) => e.id)).toEqual(['a', 'b']);   // asc by ts, only that date
    expect(day.streams).toEqual({ draw: 1000, paydown: 0, buyBtc: 0.01, minPayment: 0, cbDraw: 0, cbFee: 0, cbPaydown: 0 });
    expect(day.moves).toEqual({ strike: 0, cb: 0, cold: 0 });   // a buy is not a move
    expect(day.isEmpty).toBe(false);
    expect(buildDayActivity(LOG, '2025-01-30').isEmpty).toBe(true);
  });

  it('buildDayActivity moves: per place, signed — a Coinbase deposit is a Coinbase move (5c)', () => {
    expect(buildDayActivity(LOG, '2025-01-07').moves).toEqual({ strike: 0.2, cb: 0, cold: 0 });     // strike deposit
    expect(buildDayActivity(LOG, '2025-01-08').moves).toEqual({ strike: -0.05, cb: 0, cold: 0 });   // strike withdraw
    expect(buildDayActivity(LOG, '2025-01-09').moves).toEqual({ strike: 0, cb: 0.1, cold: 0 });     // CB deposit
  });

  it('buildMonthRollup totals + entryCount (distinct dates)', () => {
    const m = buildMonthRollup(LOG, '2025-01-01', 1);
    expect(m.streams).toEqual({ draw: 1000, paydown: 500, buyBtc: 0.01, minPayment: 0, cbDraw: 0, cbFee: 0, cbPaydown: 0 });
    expect(m.moves.strike).toBeCloseTo(0.2 - 0.05, 8);
    expect(m.moves.cb).toBeCloseTo(0.1, 8);
    expect(m.moves.cold).toBe(0);
    expect(m.entryCount).toBe(5);   // 05,06,07,08,09
    expect(m.month).toBe(1);
  });

  it('buildMonthRollup reproduces the old inline agg exactly', () => {
    const month = 1, start = '2025-01-01';
    // old DailyModeView agg over selectMonthEvents-equivalent
    let totalDraw = 0, totalPaydown = 0, totalBuyBtc = 0;   // 5c — the old netBtc retired with the headline it fed
    for (const ev of LOG.filter((e) => bucketEventToMonth(e.date, start) === month)) {
      if      (ev.kind === 'draw')    totalDraw += ev.amount;
      else if (ev.kind === 'paydown') totalPaydown += ev.amount;
      else if (ev.kind === 'buy')     totalBuyBtc += ev.amount;
    }
    const m = buildMonthRollup(LOG, start, month);
    // Whole-object, not field-by-field: a per-field .toBe would keep passing on a wrong total once draw is split by venue.
    expect(m.streams).toEqual({
      draw: totalDraw, paydown: totalPaydown, buyBtc: totalBuyBtc, minPayment: 0, cbDraw: 0, cbFee: 0, cbPaydown: 0,
    });
  });

  // 5c rider (spec `pbloc-spec-plan-load-guard-v1`) — the owner's September: more bought than planned, and collateral
  // moved from Strike to Coinbase. Round synthetic figures. The card used to print buys + Strike moves (−0.0100 ₿) over
  // "no Bitcoin bought yet"; the stored month (rollupMonth) always said 0.04 bought.
  it('⭐ HEADLINE — buys and a Strike → Coinbase move: bought 0.04; the move shows on both places', () => {
    const START5 = '2026-06-01';   // Month 4 = September
    const pledgedBuy: DayEvent = { id: 's1', date: '2026-09-05', ts: 10, kind: 'buy', amount: 0.02, usd: 2000 };
    const pledgeDep:  DayEvent = { id: 's2', date: '2026-09-05', ts: 10, kind: 'deposit', amount: 0.02, target: 'strike' };
    const plainBuy:   DayEvent = { id: 's3', date: '2026-09-20', ts: 20, kind: 'buy', amount: 0.02, usd: 2000 };
    const offStrike:  DayEvent = { id: 's4', date: '2026-09-25', ts: 30, kind: 'withdraw', amount: 0.05, target: 'strike' };
    const ontoCb:     DayEvent = { id: 's5', date: '2026-09-25', ts: 31, kind: 'deposit', amount: 0.05, target: 'cb' };
    const m = buildMonthRollup([pledgedBuy, pledgeDep, plainBuy, offStrike, ontoCb], START5, 4);
    expect(m.streams.buyBtc).toBeCloseTo(0.04, 10);
    expect(m.moves.strike).toBeCloseTo(-0.05, 10);   // the pledged buy's deposit is the buy's, not a move
    expect(m.moves.cb).toBeCloseTo(0.05, 10);
    expect(m.moves.cold).toBe(0);
    expect(formatMoves(m.moves)).toBe('Strike −0.0500 ₿ · Coinbase +0.0500 ₿');
  });

  it('⭐ PLEDGE — only the buy\'s own same-ts deposit is consumed; a standalone Strike deposit is a move', () => {
    const buy:  DayEvent = { id: 'p1', date: '2025-01-05', ts: 50, kind: 'buy', amount: 0.03, usd: 3000 };
    const dep:  DayEvent = { id: 'p2', date: '2025-01-05', ts: 50, kind: 'deposit', amount: 0.03, target: 'strike' };
    const own:  DayEvent = { id: 'p3', date: '2025-01-05', ts: 51, kind: 'deposit', amount: 0.03, target: 'strike' };   // from cold, say
    const cold: DayEvent = { id: 'p4', date: '2025-01-05', ts: 51, kind: 'withdraw', amount: 0.03, target: 'cold' };
    expect(buildDayActivity([buy, dep], '2025-01-05').moves).toEqual({ strike: 0, cb: 0, cold: 0 });
    const day = buildDayActivity([buy, dep, own, cold], '2025-01-05');
    expect(day.streams.buyBtc).toBeCloseTo(0.03, 10);
    expect(day.moves).toEqual({ strike: 0.03, cb: 0, cold: -0.03 });
    expect(formatMoves(day.moves)).toBe('Strike +0.0300 ₿ · Cold −0.0300 ₿');
  });

  it('formatMoves: null with no move (or float dust); fixed order Strike · Coinbase · Cold', () => {
    expect(formatMoves({ strike: 0, cb: 0, cold: 0 })).toBeNull();
    expect(formatMoves({ strike: 0.1 + 0.2 - 0.3, cb: -1e-12, cold: 0 })).toBeNull();
    expect(formatMoves({ strike: 0, cb: -0.25, cold: 0.25 })).toBe('Coinbase −0.2500 ₿ · Cold +0.2500 ₿');
  });

  it('formatMoves: a move too small for four places shows in full (eight), never as 0.0000', () => {
    expect(formatMoves({ strike: -0.00001, cb: 0.00001, cold: 0 })).toBe('Strike −0.00001000 ₿ · Coinbase +0.00001000 ₿');
    expect(formatMoves({ strike: 0.00005, cb: 0, cold: 0 })).toBe('Strike +0.0001 ₿');   // the edge rounds up, as the headline does
  });

  it('⭐ buildMonthRollup counts STRIKE flows only — a Coinbase borrow/paydown gets its own streams (the sign-off leak)', () => {
    // streams.draw prefills the ReviewSheet's "Expenses actually paid", which confirmMonth writes to expensesActual —
    // so a CB borrow counted here would bypass the rollup guard at sign-off. CB events first, on purpose.
    const cbDraw: DayEvent = { id: 'h', date: '2025-01-10', ts: 8, kind: 'draw', amount: 5000, target: 'cb', fee: 100 };
    const cbPay:  DayEvent = { id: 'i', date: '2025-01-11', ts: 9, kind: 'paydown', amount: 2000, target: 'cb' };
    const m = buildMonthRollup([cbDraw, cbPay, ...LOG], '2025-01-01', 1);
    expect(m.streams).toEqual({ draw: 1000, paydown: 500, buyBtc: 0.01, minPayment: 0, cbDraw: 5000, cbFee: 100, cbPaydown: 2000 });
  });

  it('groupEventsByDay groups, sorts groups DESC, events ASC by ts', () => {
    const groups = groupEventsByDay([buyA, drawA, paydownA, reading]);
    expect(groups.map((g) => g.date)).toEqual(['2025-01-06', '2025-01-05']);   // DESC
    expect(groups[1].events.map((e) => e.id)).toEqual(['a', 'b']);             // 05: ts 1,2 asc
    expect(groups[0].events.map((e) => e.id)).toEqual(['c', 'g']);             // 06: ts 3,7 asc
  });
});

describe('timezone safety', () => {
  it('month-boundary dates produce the exact expected yyyy-mm-dd strings (no drift)', () => {
    // Start on a date where naive local-tz math could slip a day.
    const start = '2025-03-31';
    const m1 = monthDateRange(start, 1);
    expect(m1[0]).toBe('2025-03-31');
    // every date is a well-formed yyyy-mm-dd and buckets to 1
    for (const d of m1) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(bucketEventToMonth(d, start)).toBe(1);
    }
  });
});

// provisional-clears-on-reading-spec-v1, change 3 — the Review sheet's "Add balance reading" must land in the month
// under review, not wherever selectedDay happens to be (the Month-scope ‹ › nav never moves selectedDay).
describe('readingTargetDate', () => {
  const S = '2026-06-01';
  const TODAY = '2026-08-10';   // month 3
  it('⭐ a selectedDay outside the reviewed month → that month\'s last day, which buckets back to it', () => {
    const d = readingTargetDate('2026-08-05', S, 1, TODAY);
    expect(d).toBe('2026-06-30');
    expect(bucketEventToMonth(d!, S)).toBe(1);
  });
  it('keeps the owner\'s selectedDay when it is already inside the month', () => {
    expect(readingTargetDate('2026-06-12', S, 1, TODAY)).toBe('2026-06-12');
  });
  it('never a future day: the current month resolves to today', () => {
    expect(readingTargetDate('2026-06-12', S, 3, TODAY)).toBe(TODAY);
  });
  it('a month entirely after today → null', () => {
    expect(readingTargetDate('2026-06-12', S, 4, TODAY)).toBeNull();
  });
});
