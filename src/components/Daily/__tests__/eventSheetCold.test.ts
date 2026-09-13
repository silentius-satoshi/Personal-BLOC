import { describe, it, expect } from 'vitest';
import {
  buildEventsFromSheet, autoStrikeCollateral, COLLATERAL_TARGET_RULES, collateralAvailableFor, totalHoldingsAfter,
  type SheetState,
} from '../eventSheetModel';
import { describeDayEvent } from '../dailyView';

// ⚠ SYNTHETIC round figures — this repo is public; never a real position.
const TODAY = '2026-06-28';
const TS = 1_700_000_000_000;
const PRICE = 100_000;
const CUR = 0.5;
const ids = () => { let n = 0; return () => `id-${n++}`; };

const FULL: SheetState = {
  type: 'collateral', amount: 0.1, collateralDir: 'deposit', collateralTarget: 'cold',
  strikeBal: 5000, strikeLtv: 11.2, strikeCollateral: 0.5, pledgeToStrike: false,
  cbBal: 60000, cbLtv: 50, cbCollateral: 1.5, cbLiqPriceReading: null,
};

describe('cold collateral moves — buildEventsFromSheet', () => {
  it('⭐ a NO-LOAN cold deposit stays cold, and is written ALONE (no Strike collapse, no reading)', () => {
    const out = buildEventsFromSheet(FULL, /* hasCbLoan */ false, PRICE, TODAY, TS, ids(), CUR);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'deposit', amount: 0.1, target: 'cold' });
  });

  it('a cold withdraw with a CB loan is also written alone', () => {
    const out = buildEventsFromSheet({ ...FULL, collateralDir: 'withdraw' }, true, PRICE, TODAY, TS, ids(), CUR);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'withdraw', amount: 0.1, target: 'cold' });
  });

  it("'cb' still collapses to 'strike' without a loan — and keeps its reading", () => {
    const out = buildEventsFromSheet({ ...FULL, collateralTarget: 'cb' }, false, PRICE, TODAY, TS, ids(), CUR);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: 'deposit', target: 'strike' });
    expect(out[1].kind).toBe('balanceReading');
  });

  it('autoStrikeCollateral leaves Strike collateral unchanged for a cold move', () => {
    expect(autoStrikeCollateral(0.5, { type: 'collateral', collateralDir: 'deposit', effectiveTarget: 'cold', amount: 0.1, pledgeToStrike: false })).toBe(0.5);
  });
});

describe('⭐ the per-target rules are three-way', () => {
  it('cold needs no reading, no liq price, and has no LTV to warn about; strike/cb are unchanged', () => {
    expect(COLLATERAL_TARGET_RULES.cold).toEqual({ needsReading: false, needsLiqPrice: false, ltvWarnVenue: null });
    expect(COLLATERAL_TARGET_RULES.strike).toEqual({ needsReading: true, needsLiqPrice: false, ltvWarnVenue: 'strike' });
    expect(COLLATERAL_TARGET_RULES.cb).toEqual({ needsReading: true, needsLiqPrice: true, ltvWarnVenue: 'cb' });
  });

  it('the withdraw cap reads the TARGET venue — a cold withdraw is capped at the cold balance, not Strike', () => {
    const bal = { strike: 1, cb: 0.5, cold: 0.2 };
    expect(collateralAvailableFor('cold', bal, 0)).toBe(0.2);
    expect(collateralAvailableFor('cold', bal, 0.1)).toBeCloseTo(0.3, 12);   // edit: the replaced withdraw adds back
    expect(collateralAvailableFor('strike', bal, 0)).toBe(1);
    expect(collateralAvailableFor('cb', bal, 0)).toBe(0.5);
  });
});

describe('⭐ totalHoldingsAfter — the transfer double-count is a DECISION, shown before save', () => {
  it('a lone cold deposit raises total holdings by the amount', () => {
    // A transfer is TWO entries; until the source withdrawal is logged, total holdings count the coins twice —
    // the sheet shows this total before save so it can't be missed.
    expect(totalHoldingsAfter(1, 0.5, 0.2, 'deposit', 0.3)).toBe(2);
  });

  it('a withdraw subtracts, cold clamps at 0, and non-finite inputs count as 0', () => {
    expect(totalHoldingsAfter(1, 0.5, 0.2, 'withdraw', 0.1)).toBeCloseTo(1.6, 12);
    expect(totalHoldingsAfter(1, 0.5, 0.2, 'withdraw', 5)).toBe(1.5);
    expect(totalHoldingsAfter(1, 0.5, NaN, 'deposit', null)).toBe(1.5);
  });
});

describe('describeDayEvent — cold moves', () => {
  it('labels cold deposits and withdrawals as cold storage', () => {
    expect(describeDayEvent({ id: 'a', date: TODAY, ts: 1, kind: 'deposit', amount: 0.1, target: 'cold' }).label)
      .toBe('Deposit to cold storage');
    expect(describeDayEvent({ id: 'b', date: TODAY, ts: 2, kind: 'withdraw', amount: 0.1, target: 'cold' }).label)
      .toBe('Withdraw from cold storage');
  });
});
