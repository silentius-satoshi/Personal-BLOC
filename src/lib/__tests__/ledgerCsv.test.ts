import { describe, it, expect } from 'vitest';
import { buildLedgerCsv, ledgerFaceAvailable } from '../ledgerCsv';
import type { MonthlyLogEntry } from '../../simulation/types';

// Minimal full entry — only required fields defaulted; overrides layer on top (optional cells stay absent
// unless supplied, so we can test the legacy-missing → empty path).
function mk(over: Partial<MonthlyLogEntry> & { month: number }): MonthlyLogEntry {
  return {
    date: `2026-0${over.month}-01`,
    income: 0, paydown: 0, btcBought: 0,
    strikeBal: 0, strikeLtv: 0,
    loggedAt: 1000, btcHeld: 0, expensesActual: 0,
    ...over,
  };
}

const HEADER_BASE = 'Mo,Date,Income→BTC,Paydown,BTC bought,Strike bal,Strike col,Strike LTV';

describe('buildLedgerCsv — column toggles', () => {
  const full = mk({ month: 1, income: 3750, paydown: 1200, btcBought: 0.012, strikeBal: 5000, btcHeld: 1.5, strikeLtv: 0.1483, cbBal: 60000, cbLtv: 0.4, miningSats: 12345 });

  it('base (no CB, no mining) = 8 columns', () => {
    const header = buildLedgerCsv([full], { hasCbLoan: false, showMining: false }).split('\r\n')[0];
    expect(header).toBe(HEADER_BASE);
    expect(header.split(',')).toHaveLength(8);
  });

  it('hasCbLoan adds CB bal + CB LTV', () => {
    const header = buildLedgerCsv([full], { hasCbLoan: true, showMining: false }).split('\r\n')[0];
    expect(header).toBe(`${HEADER_BASE},CB bal,CB LTV`);
  });

  it('showMining adds Mining sats', () => {
    const header = buildLedgerCsv([full], { hasCbLoan: false, showMining: true }).split('\r\n')[0];
    expect(header).toBe(`${HEADER_BASE},Mining sats`);
  });

  it('both add all optional columns', () => {
    const header = buildLedgerCsv([full], { hasCbLoan: true, showMining: true }).split('\r\n')[0];
    expect(header).toBe(`${HEADER_BASE},CB bal,CB LTV,Mining sats`);
    expect(header.split(',')).toHaveLength(11);
  });
});

describe('buildLedgerCsv — legacy-missing optional cells render empty', () => {
  it('an entry lacking cbBal/cbLtv/miningSats yields empty fields in those positions', () => {
    const legacy = mk({ month: 1, income: 3750, paydown: 1200, btcBought: 0.012, strikeBal: 5000, btcHeld: 1.5, strikeLtv: 0.1483 });
    const row = buildLedgerCsv([legacy], { hasCbLoan: true, showMining: true }).split('\r\n')[1];
    // Mo,Date,Income,Paydown,Bought,Bal,Col,LTV,CBbal,CBltv,Mining → last 3 empty.
    expect(row).toBe('1,2026-01-01,3750,1200,0.012,5000,1.5,0.1483,,,');
    const cells = row.split(',');
    expect(cells[8]).toBe('');  // CB bal
    expect(cells[9]).toBe('');  // CB LTV
    expect(cells[10]).toBe(''); // Mining sats
  });
});

describe('buildLedgerCsv — line endings, no totals, sorting, raw decimals', () => {
  const e1 = mk({ month: 1, income: 3750, paydown: 1200, btcBought: 0.012, strikeBal: 5000, btcHeld: 1.5, strikeLtv: 0.1483 });
  const e2 = mk({ month: 2, income: 3800, paydown: 0, btcBought: 0.02, strikeBal: 4000, btcHeld: 1.6, strikeLtv: 0.12 });

  it('uses CRLF and emits exactly header + N rows (NO totals row)', () => {
    const lines = buildLedgerCsv([e1, e2], { hasCbLoan: false, showMining: false }).split('\r\n');
    expect(lines).toHaveLength(3); // header + 2 entries, no totals
    const csv = buildLedgerCsv([e1, e2], { hasCbLoan: false, showMining: false });
    expect(csv.includes('\r\n')).toBe(true);
    expect(/[^\r]\n|^\n/.test(csv)).toBe(false); // no lone LF
    expect(csv.endsWith('\r\n')).toBe(false);     // no trailing newline
  });

  it('fixture roundtrip: integer Mo + ISO Date front, month-ascending order, raw decimal strikeLtv', () => {
    const csv = buildLedgerCsv([e2, e1], { hasCbLoan: false, showMining: false }); // input out of order
    expect(csv).toBe([
      HEADER_BASE,
      '1,2026-01-01,3750,1200,0.012,5000,1.5,0.1483',
      '2,2026-02-01,3800,0,0.02,4000,1.6,0.12',
    ].join('\r\n'));
  });
});

describe('ledgerFaceAvailable', () => {
  it('false when empty, true with at least one month', () => {
    expect(ledgerFaceAvailable([])).toBe(false);
    expect(ledgerFaceAvailable([mk({ month: 1 })])).toBe(true);
  });
});
