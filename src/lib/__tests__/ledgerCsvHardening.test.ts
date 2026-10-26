import { describe, it, expect } from 'vitest';
import { buildLedgerCsv } from '../ledgerCsv';
import type { MonthlyLogEntry } from '../../simulation/types';

const mk = (over: Partial<MonthlyLogEntry>): MonthlyLogEntry => ({
  month: 1, date: '2026-06-01', income: 0, paydown: 0, btcBought: 0, strikeBal: 0, strikeLtv: 0,
  loggedAt: 1000, btcHeld: 0, expensesActual: 0, ...over,
});

describe('ledgerCsv hardening', () => {
  it('HJ-23 · almanac.md § M-L1 Ledger CSV — the CB bal and CB LTV cells sit under their own headers', () => {
    const csv = buildLedgerCsv([mk({ cbBal: 60000, cbLtv: 0.4 })], { hasCbLoan: true, showMining: false });
    const [header, row] = csv.split('\r\n').map((l) => l.split(','));
    expect(row[header.indexOf('CB bal')]).toBe('60000');
    expect(row[header.indexOf('CB LTV')]).toBe('0.4');
  });

  it('HJ-24 · almanac.md § M-L1 Ledger CSV — RFC 4180: a quote inside a quoted cell is doubled', () => {
    const csv = buildLedgerCsv([mk({ date: '2026-01-01"x' })], { hasCbLoan: false, showMining: false });
    // Mo, then the Date cell: wrapped in quotes with the embedded quote doubled, and the row's other cells unshifted
    expect(csv.split('\r\n')[1]).toBe('1,"2026-01-01""x",0,0,0,0,0,0');
  });
});
