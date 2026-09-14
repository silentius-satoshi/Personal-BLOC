import { describe, it, expect } from 'vitest';
import {
  buildEventsFromSheet, rebuildEditedFlow, staleCbBalanceNote, DEBT_TARGET_RULES, type SheetState,
} from '../eventSheetModel';
import { cbBorrowFee } from '../../../simulation/runCoinbaseLoan';
import { unreconciledCbFlows } from '../../../simulation/logUtils';
import { describeDayEvent } from '../dailyView';
import type { DayEvent } from '../../../simulation/types';

// ⚠ SYNTHETIC round figures — this repo is public; never a real position.
const TODAY = '2026-06-28';
const TS = 1_700_000_000_000;
const PRICE = 100_000;
const CUR = 0.5;
const CB_BAL = 60_000;
const ids = () => { let n = 0; return () => `id-${n++}`; };

const FULL: SheetState = {
  type: 'draw', amount: 1000, collateralDir: 'deposit', collateralTarget: 'strike', debtTarget: 'strike',
  strikeBal: 5000, strikeLtv: 11.2, strikeCollateral: 0.5, pledgeToStrike: false,
  cbBal: 60000, cbLtv: 50, cbCollateral: 1.5, cbLiqPriceReading: null,
};
const build = (s: Partial<SheetState>, hasCbLoan = true, cbBalance = CB_BAL) =>
  buildEventsFromSheet({ ...FULL, ...s }, hasCbLoan, PRICE, TODAY, TS, ids(), CUR, cbBalance);

describe('buildEventsFromSheet — the debt venue', () => {
  it('⭐ a Strike draw/paydown serialises with NO target and NO fee key (byte-identical to every existing row)', () => {
    expect(Object.keys(build({ debtTarget: 'strike' })[0]).sort()).toEqual(['amount', 'date', 'id', 'kind', 'ts']);
    expect(Object.keys(build({ type: 'paydown', debtTarget: 'strike' })[0]).sort()).toEqual(['amount', 'date', 'id', 'kind', 'ts']);
  });

  it('⭐ a Coinbase borrow carries target:"cb" and its fee', () => {
    const [ev] = build({ debtTarget: 'cb' });
    expect(ev).toMatchObject({ kind: 'draw', amount: 1000, target: 'cb' });
    expect('fee' in ev).toBe(true);
  });

  it('⭐ without a CB loan the venue collapses to Strike — the OPPOSITE of the cold rule, so don\'t "fix" it to match', () => {
    const out = build({ debtTarget: 'cb' }, /* hasCbLoan */ false);
    expect(out.map((e) => e.kind)).toEqual(['draw', 'balanceReading']);
    expect('target' in out[0]).toBe(false);
  });

  it('the fee is cbBorrowFee(amount, balance) — never a literal — including across the $250k bracket break', () => {
    expect(build({ debtTarget: 'cb', amount: 1000 })[0]).toMatchObject({ fee: cbBorrowFee(1000, CB_BAL) });
    const crossing = build({ debtTarget: 'cb', amount: 1000 }, true, 249_500)[0] as Extract<DayEvent, { kind: 'draw' | 'paydown' }>;
    expect(crossing.fee).toBe(cbBorrowFee(1000, 249_500));
    expect(crossing.fee).not.toBe(1000 * 0.02);   // half the draw lands in the 1% bracket
  });

  it('a Coinbase paydown never carries a fee', () => {
    const [ev] = build({ type: 'paydown', debtTarget: 'cb' });
    expect(ev).toMatchObject({ kind: 'paydown', target: 'cb' });
    expect('fee' in ev).toBe(false);
  });

  it('⭐ a Coinbase flow is written ALONE; a Strike flow still carries its balanceReading', () => {
    expect(DEBT_TARGET_RULES).toEqual({ strike: { needsReading: true }, cb: { needsReading: false } });
    expect(build({ debtTarget: 'cb' }).map((e) => e.kind)).toEqual(['draw']);
    expect(build({ type: 'paydown', debtTarget: 'cb' }).map((e) => e.kind)).toEqual(['paydown']);
    expect(build({ debtTarget: 'strike' }).map((e) => e.kind)).toEqual(['draw', 'balanceReading']);
  });
});

describe('rebuildEditedFlow — the edit path keeps the venue', () => {
  // A stored fee deliberately unequal to the computed one, so "kept" is distinguishable from "recomputed".
  const cbDraw: Extract<DayEvent, { kind: 'draw' | 'paydown' }> = { id: 'x', date: TODAY, ts: 1, kind: 'draw', amount: 1000, target: 'cb', fee: 123 };

  it('⭐ a Coinbase borrow stays target:"cb"; its stored fee is KEPT when the amount is unchanged', () => {
    expect(rebuildEditedFlow(cbDraw, 1000, CB_BAL)).toEqual(cbDraw);
  });

  it('a changed amount recomputes the fee from the brackets', () => {
    expect(rebuildEditedFlow(cbDraw, 2000, CB_BAL)).toEqual({ ...cbDraw, amount: 2000, fee: cbBorrowFee(2000, CB_BAL) });
  });

  it('a Coinbase paydown keeps its target and gets no fee', () => {
    const cbPay: DayEvent = { id: 'y', date: TODAY, ts: 1, kind: 'paydown', amount: 500, target: 'cb' };
    expect(rebuildEditedFlow(cbPay, 700, CB_BAL)).toEqual({ id: 'y', date: TODAY, ts: 1, kind: 'paydown', amount: 700, target: 'cb' });
  });

  it('a Strike flow rebuilds with no target/fee key', () => {
    const s: DayEvent = { id: 'z', date: TODAY, ts: 1, kind: 'draw', amount: 1000 };
    expect(rebuildEditedFlow(s, 1500, CB_BAL)).toEqual({ id: 'z', date: TODAY, ts: 1, kind: 'draw', amount: 1500 });
  });
});

describe('staleCbBalanceNote — the stale Coinbase-balance warning', () => {
  const r: DayEvent = { id: 'r', date: '2026-06-01', ts: 1, kind: 'balanceReading', reading: { strikeBal: 5000, strikeLtv: 0.1, cbBal: 60000 } };

  it('is null when nothing was borrowed or paid on Coinbase since the last CB reading', () => {
    expect(staleCbBalanceNote(unreconciledCbFlows([r]))).toBeNull();
  });

  it('names the borrow, its fee, and the suggested balance (before interest)', () => {
    const note = staleCbBalanceNote(unreconciledCbFlows([
      r, { id: 'c', date: '2026-06-10', ts: 2, kind: 'draw', amount: 10000, target: 'cb', fee: 200 },
    ]));
    expect(note).toContain('$10,000 Coinbase borrow');
    expect(note).toContain('(+$200 fee)');
    expect(note).toContain('about $70,200 before interest');
  });
});

describe('log-row labels', () => {
  it('Coinbase rows read venue-first, the borrow with its fee', () => {
    expect(describeDayEvent({ id: 'c', date: TODAY, ts: 1, kind: 'draw', amount: 5000, target: 'cb', fee: 100 }))
      .toEqual({ icon: '↓', label: 'Coinbase borrow', detail: '$5,000 · fee $100' });
    expect(describeDayEvent({ id: 'p', date: TODAY, ts: 1, kind: 'paydown', amount: 2000, target: 'cb' }))
      .toEqual({ icon: '↘', label: 'Coinbase paydown', detail: '$2,000' });
  });

  it('a Strike row is byte-identical to before', () => {
    expect(describeDayEvent({ id: 's', date: TODAY, ts: 1, kind: 'draw', amount: 1200 }))
      .toEqual({ icon: '↓', label: 'Credit-line draw', detail: '$1,200' });
    expect(describeDayEvent({ id: 'q', date: TODAY, ts: 1, kind: 'paydown', amount: 500 }))
      .toEqual({ icon: '↘', label: 'BLOC paydown', detail: '$500' });
  });
});
