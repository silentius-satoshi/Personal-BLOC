import { describe, it, expect } from 'vitest';
import { readingComplete, buildEventsFromSheet, autoStrikeCollateral, type SheetState } from '../eventSheetModel';

const TODAY = '2026-06-28';
const TS = 1_700_000_000_000;
const PRICE = 100_000;
const CUR = 0.5;   // currentStrikeCollateral fallback passed to buildEventsFromSheet (v20)

// A monotonically-incrementing id factory so distinct events get distinct ids.
function idFactory() {
  let n = 0;
  return () => `id-${n++}`;
}

// A complete reading (both Strike + CB fields filled), percent LTVs.
const FULL: SheetState = {
  type: 'draw',
  amount: 1000,
  collateralDir: 'deposit',
  collateralTarget: 'strike',
  strikeBal: 5000,
  strikeLtv: 11.2,
  strikeCollateral: 0.5,     // v20 — required on every reading-bearing sheet
  pledgeToStrike: false,
  cbBal: 60000,
  cbLtv: 50,
  cbCollateral: 1.5,
  cbLiqPriceReading: null,   // §5b — default no liq on the reading (omitted from the event)
};

describe('readingComplete', () => {
  it('Strike-only: needs strikeBal + strikeLtv when !hasCbLoan', () => {
    expect(readingComplete({ ...FULL, cbBal: null, cbLtv: null, cbCollateral: null }, false)).toBe(true);
    expect(readingComplete({ ...FULL, strikeBal: null }, false)).toBe(false);
    expect(readingComplete({ ...FULL, strikeLtv: null }, false)).toBe(false);
  });

  it('with hasCbLoan: also needs cbBal + cbLtv + cbCollateral', () => {
    expect(readingComplete(FULL, true)).toBe(true);
    expect(readingComplete({ ...FULL, cbBal: null }, true)).toBe(false);
    expect(readingComplete({ ...FULL, cbLtv: null }, true)).toBe(false);
    expect(readingComplete({ ...FULL, cbCollateral: null }, true)).toBe(false);
  });

  it('CB fields being null does NOT block when !hasCbLoan', () => {
    expect(readingComplete({ ...FULL, cbBal: null, cbLtv: null, cbCollateral: null }, false)).toBe(true);
  });
});

describe('buildEventsFromSheet — Set balance', () => {
  it('writes exactly one balanceReading (no flow)', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null }, true, PRICE, TODAY, TS, idFactory(), CUR);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('balanceReading');
  });

  it('reading carries price; CB fields present iff hasCbLoan', () => {
    const withCb = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null }, true, PRICE, TODAY, TS, idFactory(), CUR);
    const r = (withCb[0] as Extract<typeof withCb[number], { kind: 'balanceReading' }>).reading;
    expect(r.price).toBe(PRICE);
    expect(r.cbBal).toBe(60000);
    expect(r.cbLtv).toBeCloseTo(0.5, 10);
    expect(r.cbCollateral).toBe(1.5);

    const noCb = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null }, false, PRICE, TODAY, TS, idFactory(), CUR);
    const r2 = (noCb[0] as Extract<typeof noCb[number], { kind: 'balanceReading' }>).reading;
    expect(r2.cbBal).toBeUndefined();
    expect(r2.cbLtv).toBeUndefined();
    expect(r2.cbCollateral).toBeUndefined();
  });

  it('converts the strike LTV percent → fraction (11.2 → 0.112)', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null }, false, PRICE, TODAY, TS, idFactory(), CUR);
    const r = (out[0] as Extract<typeof out[number], { kind: 'balanceReading' }>).reading;
    expect(r.strikeLtv).toBeCloseTo(0.112, 10);
  });

  it('§5b — reading.cbLiqPrice: omitted when blank/0, present when a positive value is entered', () => {
    const blank = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null, cbLiqPriceReading: null }, true, PRICE, TODAY, TS, idFactory(), CUR);
    expect((blank[0] as Extract<typeof blank[number], { kind: 'balanceReading' }>).reading.cbLiqPrice).toBeUndefined();

    const zero = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null, cbLiqPriceReading: 0 }, true, PRICE, TODAY, TS, idFactory(), CUR);
    expect((zero[0] as Extract<typeof zero[number], { kind: 'balanceReading' }>).reading.cbLiqPrice).toBeUndefined();

    const set = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null, cbLiqPriceReading: 61000 }, true, PRICE, TODAY, TS, idFactory(), CUR);
    expect((set[0] as Extract<typeof set[number], { kind: 'balanceReading' }>).reading.cbLiqPrice).toBe(61000);

    // Never on a collateral move (that path keeps its own liq field) even if the state carries one.
    const coll = buildEventsFromSheet({ ...FULL, type: 'collateral', amount: 0.1, collateralTarget: 'cb', cbLiqPriceReading: 61000 }, true, PRICE, TODAY, TS, idFactory(), CUR);
    expect((coll[1] as Extract<typeof coll[number], { kind: 'balanceReading' }>).reading.cbLiqPrice).toBeUndefined();
  });
});

describe('buildEventsFromSheet — flow types (LD6 atomic flow + reading)', () => {
  it('draw → [draw, balanceReading], same date/ts, distinct ids, USD amount', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'draw', amount: 1200 }, false, PRICE, TODAY, TS, idFactory(), CUR);
    expect(out.map((e) => e.kind)).toEqual(['draw', 'balanceReading']);
    expect(out[0]).toMatchObject({ kind: 'draw', amount: 1200, date: TODAY, ts: TS });
    expect(out[1]).toMatchObject({ kind: 'balanceReading', date: TODAY, ts: TS });
    expect(out[0].id).not.toBe(out[1].id);
  });

  it('paydown → [paydown, balanceReading]', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'paydown', amount: 500 }, false, PRICE, TODAY, TS, idFactory(), CUR);
    expect(out.map((e) => e.kind)).toEqual(['paydown', 'balanceReading']);
    expect(out[0]).toMatchObject({ kind: 'paydown', amount: 500 });
  });

  it('buy → [buy with usd = amount*price, balanceReading], amount in BTC', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'buy', amount: 0.05 }, false, PRICE, TODAY, TS, idFactory(), CUR);
    expect(out.map((e) => e.kind)).toEqual(['buy', 'balanceReading']);
    expect(out[0]).toMatchObject({ kind: 'buy', amount: 0.05, usd: 0.05 * PRICE });
  });
});

describe('buildEventsFromSheet — collateral (D2)', () => {
  it('collateral + target:cb → [deposit target:cb, balanceReading], amount in BTC', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'collateral', amount: 0.1, collateralTarget: 'cb' }, true, PRICE, TODAY, TS, idFactory(), CUR);
    expect(out.map((e) => e.kind)).toEqual(['deposit', 'balanceReading']);
    expect(out[0]).toMatchObject({ kind: 'deposit', amount: 0.1, target: 'cb' });
    const r = (out[1] as Extract<typeof out[number], { kind: 'balanceReading' }>).reading;
    expect(r.cbCollateral).toBe(1.5);
  });

  it('collateral + target:strike → [deposit target:strike, balanceReading]', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'collateral', amount: 0.1, collateralTarget: 'strike' }, true, PRICE, TODAY, TS, idFactory(), CUR);
    expect(out[0]).toMatchObject({ kind: 'deposit', amount: 0.1, target: 'strike' });
  });

  it('collateral defaults to target:strike when !hasCbLoan (no toggle)', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'collateral', amount: 0.1, collateralTarget: 'cb' }, false, PRICE, TODAY, TS, idFactory(), CUR);
    expect(out[0]).toMatchObject({ kind: 'deposit', amount: 0.1, target: 'strike' });
  });
});

describe('buildEventsFromSheet — collateral WITHDRAW (P4c-3a)', () => {
  it('collateral + collateralDir:withdraw + target:strike → [withdraw target:strike, balanceReading]', () => {
    const out = buildEventsFromSheet(
      { ...FULL, type: 'collateral', amount: 0.05, collateralDir: 'withdraw', collateralTarget: 'strike' },
      true, PRICE, TODAY, TS, idFactory(), CUR,
    );
    expect(out.map((e) => e.kind)).toEqual(['withdraw', 'balanceReading']);
    expect(out[0]).toMatchObject({ kind: 'withdraw', amount: 0.05, target: 'strike' });
    expect(out[0].id).not.toBe(out[1].id);            // distinct ids
    expect(out[0].date).toBe(TODAY); expect(out[0].ts).toBe(TS);   // flow + reading share date/ts
  });

  it('collateral + collateralDir:withdraw + target:cb → [withdraw target:cb, balanceReading]', () => {
    const out = buildEventsFromSheet(
      { ...FULL, type: 'collateral', amount: 0.1, collateralDir: 'withdraw', collateralTarget: 'cb' },
      true, PRICE, TODAY, TS, idFactory(), CUR,
    );
    expect(out[0]).toMatchObject({ kind: 'withdraw', amount: 0.1, target: 'cb' });
  });

  it('withdraw amount stays POSITIVE (the store signs it negative in collateralDelta)', () => {
    const out = buildEventsFromSheet(
      { ...FULL, type: 'collateral', amount: 0.2, collateralDir: 'withdraw', collateralTarget: 'strike' },
      false, PRICE, TODAY, TS, idFactory(), CUR,
    );
    expect(out[0]).toMatchObject({ kind: 'withdraw', amount: 0.2 });   // magnitude, not −0.2
  });

  it('withdraw defaults to target:strike when !hasCbLoan (no toggle)', () => {
    const out = buildEventsFromSheet(
      { ...FULL, type: 'collateral', amount: 0.05, collateralDir: 'withdraw', collateralTarget: 'cb' },
      false, PRICE, TODAY, TS, idFactory(), CUR,
    );
    expect(out[0]).toMatchObject({ kind: 'withdraw', amount: 0.05, target: 'strike' });
  });
});

describe('v20 — reading.strikeCollateral + autoStrikeCollateral + pledge', () => {
  const readingOf = (evs: ReturnType<typeof buildEventsFromSheet>) =>
    (evs.find((e) => e.kind === 'balanceReading') as Extract<typeof evs[number], { kind: 'balanceReading' }>).reading;

  it('readingComplete is false when strikeCollateral is null', () => {
    expect(readingComplete({ ...FULL, strikeCollateral: null }, false)).toBe(false);
    expect(readingComplete({ ...FULL, strikeCollateral: 0.5 }, false)).toBe(true);
  });

  it('the reading carries strikeCollateral from s.strikeCollateral', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null, strikeCollateral: 0.73 }, false, PRICE, TODAY, TS, idFactory(), CUR);
    expect(readingOf(out).strikeCollateral).toBe(0.73);
  });

  it('falls back to currentStrikeCollateral when s.strikeCollateral is null', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null, strikeCollateral: null }, false, PRICE, TODAY, TS, idFactory(), CUR);
    expect(readingOf(out).strikeCollateral).toBe(CUR);   // 0.5
  });

  it('manual override (s.strikeCollateral) wins over the fallback', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'collateral', amount: 0.1, collateralTarget: 'strike', strikeCollateral: 0.9 }, false, PRICE, TODAY, TS, idFactory(), CUR);
    expect(readingOf(out).strikeCollateral).toBe(0.9);
  });

  it('autoStrikeCollateral: post-move total (deposit +, withdraw −, pledged buy +, else current)', () => {
    expect(autoStrikeCollateral(0.5, { type: 'collateral', effectiveTarget: 'strike', collateralDir: 'deposit', amount: 0.1, pledgeToStrike: false })).toBeCloseTo(0.6);
    expect(autoStrikeCollateral(0.5, { type: 'collateral', effectiveTarget: 'strike', collateralDir: 'withdraw', amount: 0.1, pledgeToStrike: false })).toBeCloseTo(0.4);
    expect(autoStrikeCollateral(0.5, { type: 'collateral', effectiveTarget: 'cb', collateralDir: 'deposit', amount: 0.1, pledgeToStrike: false })).toBeCloseTo(0.5);   // cb move → unchanged
    expect(autoStrikeCollateral(0.5, { type: 'buy', effectiveTarget: 'strike', collateralDir: 'deposit', amount: 0.05, pledgeToStrike: true })).toBeCloseTo(0.55);
    expect(autoStrikeCollateral(0.5, { type: 'buy', effectiveTarget: 'strike', collateralDir: 'deposit', amount: 0.05, pledgeToStrike: false })).toBeCloseTo(0.5);   // unpledged → unchanged
    expect(autoStrikeCollateral(0.5, { type: 'draw', effectiveTarget: 'strike', collateralDir: 'deposit', amount: 1000, pledgeToStrike: false })).toBeCloseTo(0.5);
  });

  it('pledge ON → [buy, deposit target:strike amount=buy, reading], shared date+ts, distinct ids', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'buy', amount: 0.05, pledgeToStrike: true }, false, PRICE, TODAY, TS, idFactory(), CUR);
    expect(out.map((e) => e.kind)).toEqual(['buy', 'deposit', 'balanceReading']);
    expect(out[1]).toMatchObject({ kind: 'deposit', amount: 0.05, target: 'strike' });
    expect(out[0].date).toBe(TODAY); expect(out[1].date).toBe(TODAY); expect(out[2].date).toBe(TODAY);
    expect(out[0].ts).toBe(TS); expect(out[1].ts).toBe(TS); expect(out[2].ts).toBe(TS);
    expect(new Set(out.map((e) => e.id)).size).toBe(3);   // all distinct
  });

  it('pledge OFF → [buy, reading] (no deposit)', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'buy', amount: 0.05, pledgeToStrike: false }, false, PRICE, TODAY, TS, idFactory(), CUR);
    expect(out.map((e) => e.kind)).toEqual(['buy', 'balanceReading']);
  });
});
