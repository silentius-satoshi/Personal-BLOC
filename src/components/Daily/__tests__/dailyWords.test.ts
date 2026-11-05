import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pastBalancesNote, PAST_BALANCES_NOTE, COLLATERAL_FEEDS_MONTH } from '../eventSheetModel';
import { isMonthlyMeaningful } from '../../../store/dailyRouting';
import type { DayEvent } from '../../../simulation/types';

const read = (file: string): string => readFileSync(join(process.cwd(), 'src/components/Daily', file), 'utf8');

/**
 * ⭐ W3 (Sweep 2b) — Daily's month rollup names Coinbase's paydowns. `buildMonthRollup` already sums them
 * (`streams.cbPaydown`) and the bars count both loans' paydowns, but the list showed only Strike's. The row reads its own
 * stream under its own gate, with BLOC paydown's green dot — no venue colour reaches it. Display only.
 */
describe('W3 — Daily\'s month rollup names Coinbase\'s paydowns (Sweep 2b)', () => {
  const src = read('DailyModeView.tsx');
  it('⭐ W3 — the row reads cbPaydown under its own gate, after BLOC paydown, with its green dot', () => {
    const at = src.indexOf('{monthRollup.streams.cbPaydown > 0 && (');
    expect(at, 'W3 its own gate').toBeGreaterThan(-1);
    const row = src.slice(at, at + 520);
    expect(row, 'W3 its words').toContain('/>Coinbase paydown</span>');
    expect(row, 'W3 its figure, to the cent').toContain('{fmtUSDCents(monthRollup.streams.cbPaydown)}');
    expect(row, 'W3 BLOC paydown\'s green dot').toContain('styles.dotG');
    expect(src.indexOf('/>BLOC paydown</span>'), 'W3 after BLOC paydown').toBeLessThan(at);
  });
});

/**
 * ⭐ PAST NOTE (Sweep 2b) — the past-date note says the month is marked provisional only when skipping the balances
 * does that: no reading of its own, and a reading in the month before to carry (`rollupMonth`'s carry-forward,
 * `priorStocksForMonth`). Its old "this month is marked provisional until a reading is logged" was false otherwise.
 * v1.1: and only for a move that feeds the month — a Coinbase or cold collateral move is journal-only, so skipping its
 * balances carries nothing (`COLLATERAL_FEEDS_MONTH`, held here to the store's `isMonthlyMeaningful`).
 */
describe('PAST NOTE — the past-date note promises a provisional month only when there is one (Sweep 2b)', () => {
  const START = '2026-01-01';
  const reading = (id: string, date: string): DayEvent =>
    ({ id, date, ts: Date.parse(date), kind: 'balanceReading', reading: { strikeBal: 1000, strikeLtv: 0.1 } });
  const draw = (id: string, date: string): DayEvent => ({ id, date, ts: Date.parse(date), kind: 'draw', amount: 500 });
  const CARRY = `${PAST_BALANCES_NOTE} This month carries the month before's balances, marked provisional, until a reading is logged.`;

  it('⭐ PAST NOTE — a reading in the month before and none of its own — carried, provisional', () => {
    expect(pastBalancesNote([reading('a', '2026-01-20'), draw('d', '2026-02-02')], START, 2, true), 'PAST NOTE carried').toBe(CARRY);
    expect(pastBalancesNote([reading('a', '2026-01-20')], START, 2, true), 'PAST NOTE a move that feeds the month').toBe(CARRY);
    expect(pastBalancesNote([reading('a', '2026-01-20')], START, 2, false), 'PAST NOTE a move that feeds no month — a Coinbase or cold one')
      .toBe(PAST_BALANCES_NOTE);
  });
  it('⭐ PAST NOTE — a reading of its own — no mark, whatever the month before holds', () => {
    expect(pastBalancesNote([reading('a', '2026-01-20'), reading('b', '2026-02-25')], START, 2, true), 'PAST NOTE its own reading')
      .toBe(PAST_BALANCES_NOTE);
  });
  it('⭐ PAST NOTE — nothing in the month before — nothing to carry, no mark', () => {
    expect(pastBalancesNote([], START, 2, true), 'PAST NOTE an empty journal').toBe(PAST_BALANCES_NOTE);
    expect(pastBalancesNote([reading('a', '2026-01-20')], START, 3, true), 'PAST NOTE two months back carries nothing').toBe(PAST_BALANCES_NOTE);
    expect(pastBalancesNote([reading('a', '2026-01-20')], START, 1, true), 'PAST NOTE the first month has none before it')
      .toBe(PAST_BALANCES_NOTE);
  });
  it('⭐ PAST NOTE WIRED — the sheet shows it for a past date, the old promise gone', () => {
    const src = read('EventSheet.tsx');
    expect(src, 'PAST NOTE WIRED').toContain(
      "{isPast && type !== 'setBalance' && (\n              <div className={styles.note}>{pastBalancesNote(dayLog, advisorStartDate, month, "
      + "type !== 'collateral' || COLLATERAL_FEEDS_MONTH[effectiveTarget])}</div>");
    for (const target of ['strike', 'cb', 'cold'] as const) {
      const move = { id: 'm', date: '2026-02-02', ts: 0, kind: 'deposit', amount: 0.1, target } as DayEvent;
      expect(COLLATERAL_FEEDS_MONTH[target], `PAST NOTE the ${target} move feeds its month as the store says`).toBe(isMonthlyMeaningful(move));
    }
    expect(src, 'PAST NOTE the unconditional promise gone').not.toContain('this month is marked provisional until a reading is logged');
  });
});
