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

/**
 * ⭐ F2 (Sweep 2b) — the CSV's dollars to the cent and coins to the satoshi, as a spreadsheet reads them: a "." whatever
 * the language, no grouping, no exponent, no trailing zeros, half-up as the screen rounds; −0 prints 0. LTVs, Mo and
 * Mining sats as stored; an empty cell stays empty; a cold residue month empty, as the face's "—".
 */
describe('F2 — the cells\' decimals (Sweep 2b)', () => {
  const cells = (e: MonthlyLogEntry, cold?: Record<number, number>): Record<string, string> => {
    const [h, r] = buildLedgerCsv([e], { hasCbLoan: true, showMining: true, coldByMonth: cold }).split('\r\n');
    const hs = h.split(','); const rs = r.split(',');
    return Object.fromEntries(hs.map((k, i) => [k, rs[i]]));
  };

  it('⭐ F2 — dollars to the cent: a sum of cents reads as the screen rounds, never a float tail', () => {
    const c = cells(mk({ month: 1, income: 1000.01 + 334.65, paydown: 1200, strikeBal: 2.675, cbBal: 60_000.5 }));
    expect(String(1000.01 + 334.65), 'F2 premise — the float tail').toBe('1334.6599999999999');
    expect([c['Income→BTC'], c['Paydown'], c['Strike bal'], c['CB bal']], 'F2 dollars').toEqual(['1334.66', '1200', '2.68', '60000.5']);
  });

  it('⭐ F2 — coins to the satoshi: no exponent, no float residue, no trailing zeros', () => {
    const c = cells(mk({ month: 1, btcBought: 0.1 + 0.2, btcHeld: 5e-7 }));
    expect(String(5e-7), 'F2 premise — the exponent').toBe('5e-7');
    expect([c['BTC bought'], c['Strike col']], 'F2 coins').toEqual(['0.3', '0.0000005']);
  });

  it('⭐ F2 — −0, and a tiny negative rounded away, print 0', () => {
    const c = cells(mk({ month: 1, paydown: -0, strikeBal: -1e-12, btcHeld: -3e-9 }));
    expect([c['Paydown'], c['Strike bal'], c['Strike col']], 'F2 no −0').toEqual(['0', '0', '0']);
  });

  it('⭐ F2 — → Cold: a real move to the satoshi, a residue month empty as the face\'s "—", a quiet month empty', () => {
    expect(cells(mk({ month: 1 }), { 1: -0.25 })['→ Cold'], 'F2 cold out').toBe('-0.25');
    expect(cells(mk({ month: 1 }), { 1: 3e-7 })['→ Cold'], 'F2 cold, 30 sats').toBe('0.0000003');
    expect(cells(mk({ month: 1 }), { 1: 0.1 - 0.04 - 0.06 })['→ Cold'], 'F2 cold residue').toBe('');
    expect(cells(mk({ month: 1 }), { 2: 0.5 })['→ Cold'], 'F2 a quiet month').toBe('');
  });

  it('⭐ F2 — as before: LTVs, Mo and Mining sats as stored; an unrecorded cell empty; a non-finite figure as String prints it', () => {
    const c = cells(mk({ month: 3, strikeLtv: 0.14830000000000002, cbLtv: 0.4, miningSats: 12345, btcHeld: undefined }));
    expect([c['Mo'], c['Strike LTV'], c['CB LTV'], c['Mining sats'], c['Strike col']], 'F2 unchanged cells')
      .toEqual(['3', '0.14830000000000002', '0.4', '12345', '']);
    expect(cells(mk({ month: 1, income: NaN, paydown: Infinity }))['Income→BTC'], 'F2 broken data, as before').toBe('NaN');
  });

  it('⭐ F2 — a sweep: every dollar cell at most 2 decimals, every coin cell at most 8, no exponent anywhere', () => {
    let x = 7;
    const rnd = (): number => { x = (x * 1103515245 + 12345) % 2 ** 31; return x / 2 ** 31; };
    const fig = (): number => (rnd() < 0.5 ? rnd() * 10 ** Math.floor(rnd() * 9) : rnd() * 10 ** -Math.floor(rnd() * 9)) * (rnd() < 0.1 ? -1 : 1);
    const entries = Array.from({ length: 400 }, (_, i) => mk({
      month: i + 1, income: fig(), paydown: fig(), btcBought: fig(), strikeBal: fig(), btcHeld: fig(), cbBal: fig(), cbLtv: rnd(),
    }));
    const cold = Object.fromEntries(entries.map((e) => [e.month, fig()]));
    const [h, ...rows] = buildLedgerCsv(entries, { hasCbLoan: true, showMining: false, coldByMonth: cold }).split('\r\n');
    const hs = h.split(',');
    const USD = ['Income→BTC', 'Paydown', 'Strike bal', 'CB bal'].map((k) => hs.indexOf(k));
    const BTC = ['BTC bought', 'Strike col', '→ Cold'].map((k) => hs.indexOf(k));
    const places = (s: string): number => (s.includes('.') ? s.length - s.indexOf('.') - 1 : 0);
    let checked = 0;
    for (const r of rows) {
      const cs = r.split(',');
      for (const i of USD) { expect(places(cs[i]) <= 2 && !/e/i.test(cs[i]), `F2 SWEEP dollars ${cs[i]}`).toBe(true); checked += 1; }
      for (const i of BTC) { expect(places(cs[i]) <= 8 && !/e/i.test(cs[i]), `F2 SWEEP coins ${cs[i]}`).toBe(true); checked += 1; }
    }
    expect(checked, 'F2 SWEEP premise').toBe(400 * 7);
    expect(rows.some((r) => r.split(',')[BTC[0]].length > 8), 'F2 SWEEP premise — small coin figures reached').toBe(true);
  });
});
