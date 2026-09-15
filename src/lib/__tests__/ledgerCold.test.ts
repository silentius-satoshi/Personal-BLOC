import { describe, it, expect } from 'vitest';
import { coldMovedByMonth, hasColdColumn, buildLedgerCsv } from '../ledgerCsv';
import type { DayEvent, MonthlyLogEntry } from '../../simulation/types';

// ⚠ SYNTHETIC round figures — this repo is public; never a real position.
// The "→ Cold" column is COMPUTED from the dayLog at render — never stored on MonthlyLogEntry (cold moves are
// journal-only, so a stored figure would go stale, and re-rolling on them would reopen signed months).

const START = '2026-01-01';
let seq = 0;
const move = (kind: 'deposit' | 'withdraw', amount: number, target: 'strike' | 'cb' | 'cold', date: string): DayEvent =>
  ({ id: `m${++seq}`, date, ts: ++seq, kind, amount, target });

const entry = (month: number, o: Partial<MonthlyLogEntry> = {}): MonthlyLogEntry => ({
  month, date: `2026-0${month}-01`, btcBought: 0.05, income: 500, paydown: 0, strikeBal: 1000, strikeLtv: 0.1,
  loggedAt: month, btcHeld: 0.5, expensesActual: 3000, ...o,
});

describe('coldMovedByMonth', () => {
  it('sums deposits minus withdrawals for target:\'cold\' ONLY, per strategy month', () => {
    const log = [
      move('deposit', 0.10, 'cold', '2026-01-05'),
      move('withdraw', 0.04, 'cold', '2026-01-20'),
      move('deposit', 0.20, 'strike', '2026-01-06'),   // ignored — Strike collateral
      move('deposit', 0.30, 'cb', '2026-01-07'),       // ignored — Coinbase collateral
      move('deposit', 0.05, 'cold', '2026-02-05'),
    ];
    const byMonth = coldMovedByMonth(log, START);
    expect(byMonth[1]).toBeCloseTo(0.06);
    expect(byMonth[2]).toBeCloseTo(0.05);
    expect(3 in byMonth).toBe(false);   // a month with no cold activity is ABSENT
  });

  it('a dayLog with no cold moves yields an empty map', () => {
    expect(coldMovedByMonth([move('deposit', 0.2, 'strike', '2026-01-06')], START)).toEqual({});
  });
});

describe('hasColdColumn', () => {
  it('shows only when a month that HAS a ledger row moved a non-zero amount', () => {
    const rows = [entry(1)];
    expect(hasColdColumn(rows, { 1: 0.06 })).toBe(true);
    expect(hasColdColumn(rows, { 2: 0.05 })).toBe(false);   // cold activity only in a month with no row
    expect(hasColdColumn(rows, { 1: 0 })).toBe(false);
    expect(hasColdColumn(rows, undefined)).toBe(false);     // a viewer (dayLog []) / a caller that omits it
  });
});

describe('buildLedgerCsv — → Cold column + an unrecorded Strike col', () => {
  it('adds → Cold between Strike col and Strike LTV when a row moved cold', () => {
    const csv = buildLedgerCsv([entry(1), entry(2)], { hasCbLoan: false, showMining: false, coldByMonth: { 1: 0.06 } });
    const [header, r1, r2] = csv.split('\r\n').map((l) => l.split(','));
    const col = header.indexOf('→ Cold');
    expect(header[col - 1]).toBe('Strike col');
    expect(header[col + 1]).toBe('Strike LTV');
    expect(r1[col]).toBe('0.06');
    expect(r2[col]).toBe('');   // month 2 had no cold activity
  });

  it('no coldByMonth → the header is exactly the pre-existing one', () => {
    const csv = buildLedgerCsv([entry(1)], { hasCbLoan: false, showMining: false });
    expect(csv.split('\r\n')[0]).toBe('Mo,Date,Income→BTC,Paydown,BTC bought,Strike bal,Strike col,Strike LTV');
  });

  it('an entry that never recorded btcHeld emits an EMPTY Strike col cell, never 0', () => {
    const { btcHeld: _omit, ...noCol } = entry(1);
    const [header, row] = buildLedgerCsv([noCol], { hasCbLoan: false, showMining: false })
      .split('\r\n').map((l) => l.split(','));
    expect(row[header.indexOf('Strike col')]).toBe('');
  });
});
