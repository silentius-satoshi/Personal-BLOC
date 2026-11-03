import { describe, it, expect } from 'vitest';
import { coldMovedByMonth, hasColdColumn, buildLedgerCsv, coldTotals, coldFootnote, fmtColdBtc, COLD_EPS } from '../ledgerCsv';
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

// BL49 (the owner's call A, 2026-11-01) — "→ Cold" always shown: whenever this device knows the cold moves. It was shown
// only when a month that HAS a ledger row moved a non-zero amount, so an owner with no cold move had no column at all.
describe('hasColdColumn', () => {
  it('⭐ ALWAYS — BL49: the column whenever this device knows the cold moves — a map it can place, an empty one too; never without one, nor for moves it can\'t place (v1.1)', () => {
    expect(hasColdColumn({ 1: 0.06 }), 'ALWAYS a month that moved').toBe(true);
    expect(hasColdColumn({}), 'ALWAYS the owner with no cold move: the column, at zero').toBe(true);
    expect(hasColdColumn({ 2: 0.05 }), 'ALWAYS cold only in a month with no row').toBe(true);
    expect(hasColdColumn({ 1: 0 }), 'ALWAYS a month that nets to zero').toBe(true);
    expect(hasColdColumn(null), 'ALWAYS not for a viewer whose snapshot carried none').toBe(false);
    expect(hasColdColumn(undefined), 'ALWAYS not for a caller that omits it').toBe(false);
    // v1.1 (Claude Code's plan review): a blank start date or an unreadable date buckets to NaN; a move with no amount
    // sums to NaN — moves the device can't place, which the viewer's copy drops.
    expect(hasColdColumn({ NaN: 0.1 } as Record<number, number>), 'ALWAYS not for a month it can\'t place').toBe(false);
    expect(hasColdColumn({ 2: NaN }), 'ALWAYS not for a figure it can\'t place').toBe(false);
    expect(hasColdColumn({ NaN: 0.1, 2: 0.05 } as Record<number, number>), 'ALWAYS one month it can place: the column')
      .toBe(true);
    // v1.2 (Claude Code's second review): an infinite figure (a sum past ~1.8e308, a backup's 1e999) is one JSON can't
    // carry, so no viewer's copy holds it — the owner's call: no column, on both devices alike.
    expect(hasColdColumn({ 1: Infinity }), 'ALWAYS not for an infinite figure').toBe(false);
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

  it('⭐ CSV KEEPS — BL49: an owner with no cold move keeps → Cold, every cell empty; a viewer without the moves, none', () => {
    const [header, r1, r2] = buildLedgerCsv([entry(1), entry(2)], { hasCbLoan: false, showMining: false, coldByMonth: {} })
      .split('\r\n').map((l) => l.split(','));
    expect(header, 'CSV KEEPS the column').toEqual(
      ['Mo', 'Date', 'Income→BTC', 'Paydown', 'BTC bought', 'Strike bal', 'Strike col', '→ Cold', 'Strike LTV']);
    expect([r1[7], r2[7]], 'CSV KEEPS a quiet month empty, never 0').toEqual(['', '']);
    expect(buildLedgerCsv([entry(1)], { hasCbLoan: false, showMining: false, coldByMonth: null }).split('\r\n')[0],
      'CSV KEEPS none without the moves').toBe('Mo,Date,Income→BTC,Paydown,BTC bought,Strike bal,Strike col,Strike LTV');
  });

  it('an entry that never recorded btcHeld emits an EMPTY Strike col cell, never 0', () => {
    const { btcHeld: _omit, ...noCol } = entry(1);
    const [header, row] = buildLedgerCsv([noCol], { hasCbLoan: false, showMining: false })
      .split('\r\n').map((l) => l.split(','));
    expect(row[header.indexOf('Strike col')]).toBe('');
  });
});

// ledger-cold-total-onboarding-date-spec-v2 §1 — the → Cold total foots (row-scoped), the remainder is disclosed, and
// ONE tolerance governs every gate.
describe('coldTotals / coldFootnote / COLD_EPS', () => {
  it('⭐ coldTotals separates months WITH a row (logged) from months without one (unlogged)', () => {
    const by = coldMovedByMonth([move('deposit', 0.1, 'cold', '2026-01-05'), move('deposit', 0.3, 'cold', '2026-03-05')], START);
    const t = coldTotals([entry(1)], by);
    expect(t.logged).toBeCloseTo(0.1, 12);
    expect(t.unlogged).toBeCloseTo(0.3, 12);
  });

  it('⭐ the footing invariant: logged + unlogged = every coldByMonth value', () => {
    const by = { 1: 0.1, 2: -0.03, 3: 0.25, 5: -0.07 };
    const t = coldTotals([entry(1), entry(2)], by);
    const sum = Object.values(by).reduce((a, b) => a + b, 0);
    expect(t.logged + t.unlogged).toBeCloseTo(sum, 10);
    expect(t.logged).toBeCloseTo(0.07, 12);
    expect(t.unlogged).toBeCloseTo(0.18, 12);
  });

  it('no unlogged cold → unlogged 0, and logged = the old inline reduce (the visible total did not move)', () => {
    const rows = [entry(1), entry(2)];
    const by = { 1: 0.1, 2: 0.05 };
    const t = coldTotals(rows, by);
    expect(t.unlogged).toBe(0);
    expect(t.logged).toBe(rows.reduce((s, e) => s + (by[e.month as 1 | 2] ?? 0), 0));
    expect(coldTotals(rows, undefined)).toEqual({ logged: 0, unlogged: 0 });
  });

  it('coldFootnote wording — all four rows; unsigned figure; no ‡ without a column; null at 0', () => {
    expect(coldFootnote(0.2, true)).toBe('‡ 0.20000 ₿ moved to cold in months with no logged activity — not in the total above.');
    expect(coldFootnote(-0.2, true)).toBe('‡ 0.20000 ₿ moved out of cold in months with no logged activity — not in the total above.');
    expect(coldFootnote(0.2, false)).toBe('0.20000 ₿ moved to cold in months with no logged activity — those months have no row here.');
    expect(coldFootnote(-0.2, false)).toBe('0.20000 ₿ moved out of cold in months with no logged activity — those months have no row here.');
    expect(coldFootnote(-0.2, true)).not.toContain('-');
    expect(coldFootnote(0.2, false)).not.toContain('‡');
    expect(coldFootnote(0.2, false)).not.toContain('total above');
    expect(coldFootnote(0, true)).toBeNull();
  });

  it('⭐ one residue, three sites, one answer', () => {
    const log = [move('deposit', 0.1, 'cold', '2026-01-05'), move('withdraw', 0.04, 'cold', '2026-01-06'), move('withdraw', 0.06, 'cold', '2026-01-07')];
    const by = coldMovedByMonth(log, START);
    expect(by[1]).not.toBe(0);   // the premise: the fixture really produces float residue
    // logged — BL49: the column shows (the device knows the moves); the residue's total snaps to 0 → ₿0.00000, never -0
    expect(hasColdColumn(by)).toBe(true);
    expect(coldTotals([entry(1)], by).logged).toBe(0);
    expect(fmtColdBtc(coldTotals([entry(1)], by).logged)).toBe('0.00000');
    // unlogged
    expect(coldTotals([entry(2)], by).unlogged).toBe(0);
    expect(coldFootnote(by[1], false)).toBeNull();
  });

  it('⭐ the tolerance hides no real satoshi, and neither does the display', () => {
    expect(COLD_EPS).toBe(5e-9);
    const oneSat = { 1: 1e-8 };
    expect(hasColdColumn(oneSat)).toBe(true);
    expect(coldTotals([entry(1)], oneSat).logged).not.toBe(0);
    expect(coldFootnote(coldTotals([entry(2)], oneSat).unlogged, false)).not.toBeNull();
    expect(fmtColdBtc(3e-6)).toBe('0.00000300');
    expect(fmtColdBtc(-3e-6)).toBe('-0.00000300');
    expect(fmtColdBtc(1e-8)).toBe('0.00000001');
    expect(fmtColdBtc(0.12345)).toBe('0.12345');
    expect(fmtColdBtc(0)).toBe('0.00000');     // a total that nets out (or a snapped residue) — never "0.00000000"
    expect(fmtColdBtc(-0)).toBe('0.00000');    // and never a signed zero
    expect(coldFootnote(3e-6, true)).toContain('0.00000300');
    expect(coldFootnote(3e-6, true)).not.toContain('0.00000 ₿');
  });
});
