import { describe, it, expect } from 'vitest';
import { readingComplete, buildEventsFromSheet, autoStrikeCollateral, readingCollateralPolicy, roundUsdCents, buyUsdGuess, impliedBtcPrice, rebuildEditedBuy, rebuildEditedReading, type SheetState } from '../eventSheetModel';
import type { DayEvent } from '../../../simulation/types';

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
  debtTarget: 'strike',
  strikeBal: 5000,
  strikeLtv: 11.2,
  strikeCollateral: 0.5,     // v20 — required on every reading-bearing sheet
  pledgeToStrike: false,
  cbBal: 60000,
  cbLtv: 50,
  cbCollateral: 1.5,
  cbLiqPriceReading: null,   // §5b — default no liq on the reading (omitted from the event)
  buyUsd: null,              // 5d — untyped → the app's guess
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
    const out = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null }, true, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('balanceReading');
  });

  it('reading carries price; CB fields present iff hasCbLoan', () => {
    const withCb = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null }, true, PRICE, TODAY, TS, idFactory(), CUR, 0);
    const r = (withCb[0] as Extract<typeof withCb[number], { kind: 'balanceReading' }>).reading;
    expect(r.price).toBe(PRICE);
    expect(r.cbBal).toBe(60000);
    expect(r.cbLtv).toBeCloseTo(0.5, 10);
    expect(r.cbCollateral).toBe(1.5);

    const noCb = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null }, false, PRICE, TODAY, TS, idFactory(), CUR, 0);
    const r2 = (noCb[0] as Extract<typeof noCb[number], { kind: 'balanceReading' }>).reading;
    expect(r2.cbBal).toBeUndefined();
    expect(r2.cbLtv).toBeUndefined();
    expect(r2.cbCollateral).toBeUndefined();
  });

  it('converts the strike LTV percent → fraction (11.2 → 0.112)', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null }, false, PRICE, TODAY, TS, idFactory(), CUR, 0);
    const r = (out[0] as Extract<typeof out[number], { kind: 'balanceReading' }>).reading;
    expect(r.strikeLtv).toBeCloseTo(0.112, 10);
  });

  it('§5b — reading.cbLiqPrice: omitted when blank/0, present when a positive value is entered', () => {
    const blank = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null, cbLiqPriceReading: null }, true, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect((blank[0] as Extract<typeof blank[number], { kind: 'balanceReading' }>).reading.cbLiqPrice).toBeUndefined();

    const zero = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null, cbLiqPriceReading: 0 }, true, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect((zero[0] as Extract<typeof zero[number], { kind: 'balanceReading' }>).reading.cbLiqPrice).toBeUndefined();

    const set = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null, cbLiqPriceReading: 61000 }, true, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect((set[0] as Extract<typeof set[number], { kind: 'balanceReading' }>).reading.cbLiqPrice).toBe(61000);

    // Never on a collateral move (that path keeps its own liq field) even if the state carries one.
    const coll = buildEventsFromSheet({ ...FULL, type: 'collateral', amount: 0.1, collateralTarget: 'cb', cbLiqPriceReading: 61000 }, true, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect((coll[1] as Extract<typeof coll[number], { kind: 'balanceReading' }>).reading.cbLiqPrice).toBeUndefined();
  });
});

describe('buildEventsFromSheet — flow types (LD6 atomic flow + reading)', () => {
  it('draw → [draw, balanceReading], same date/ts, distinct ids, USD amount', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'draw', amount: 1200 }, false, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect(out.map((e) => e.kind)).toEqual(['draw', 'balanceReading']);
    expect(out[0]).toMatchObject({ kind: 'draw', amount: 1200, date: TODAY, ts: TS });
    expect(out[1]).toMatchObject({ kind: 'balanceReading', date: TODAY, ts: TS });
    expect(out[0].id).not.toBe(out[1].id);
  });

  it('paydown → [paydown, balanceReading]', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'paydown', amount: 500 }, false, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect(out.map((e) => e.kind)).toEqual(['paydown', 'balanceReading']);
    expect(out[0]).toMatchObject({ kind: 'paydown', amount: 500 });
  });

  it('buy → [buy with usd = amount*price, balanceReading], amount in BTC (untyped dollars → the guess)', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'buy', amount: 0.05 }, false, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect(out.map((e) => e.kind)).toEqual(['buy', 'balanceReading']);
    expect(out[0]).toMatchObject({ kind: 'buy', amount: 0.05, usd: 0.05 * PRICE });
  });
});

describe('buildEventsFromSheet — collateral (D2)', () => {
  it('collateral + target:cb → [deposit target:cb, balanceReading], amount in BTC', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'collateral', amount: 0.1, collateralTarget: 'cb' }, true, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect(out.map((e) => e.kind)).toEqual(['deposit', 'balanceReading']);
    expect(out[0]).toMatchObject({ kind: 'deposit', amount: 0.1, target: 'cb' });
    const r = (out[1] as Extract<typeof out[number], { kind: 'balanceReading' }>).reading;
    expect(r.cbCollateral).toBe(1.5);
  });

  it('collateral + target:strike → [deposit target:strike, balanceReading]', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'collateral', amount: 0.1, collateralTarget: 'strike' }, true, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect(out[0]).toMatchObject({ kind: 'deposit', amount: 0.1, target: 'strike' });
  });

  it('collateral defaults to target:strike when !hasCbLoan (no toggle)', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'collateral', amount: 0.1, collateralTarget: 'cb' }, false, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect(out[0]).toMatchObject({ kind: 'deposit', amount: 0.1, target: 'strike' });
  });
});

describe('buildEventsFromSheet — collateral WITHDRAW (P4c-3a)', () => {
  it('collateral + collateralDir:withdraw + target:strike → [withdraw target:strike, balanceReading]', () => {
    const out = buildEventsFromSheet(
      { ...FULL, type: 'collateral', amount: 0.05, collateralDir: 'withdraw', collateralTarget: 'strike' },
      true, PRICE, TODAY, TS, idFactory(), CUR, 0,
    );
    expect(out.map((e) => e.kind)).toEqual(['withdraw', 'balanceReading']);
    expect(out[0]).toMatchObject({ kind: 'withdraw', amount: 0.05, target: 'strike' });
    expect(out[0].id).not.toBe(out[1].id);            // distinct ids
    expect(out[0].date).toBe(TODAY); expect(out[0].ts).toBe(TS);   // flow + reading share date/ts
  });

  it('collateral + collateralDir:withdraw + target:cb → [withdraw target:cb, balanceReading]', () => {
    const out = buildEventsFromSheet(
      { ...FULL, type: 'collateral', amount: 0.1, collateralDir: 'withdraw', collateralTarget: 'cb' },
      true, PRICE, TODAY, TS, idFactory(), CUR, 0,
    );
    expect(out[0]).toMatchObject({ kind: 'withdraw', amount: 0.1, target: 'cb' });
  });

  it('withdraw amount stays POSITIVE (the store signs it negative in collateralDelta)', () => {
    const out = buildEventsFromSheet(
      { ...FULL, type: 'collateral', amount: 0.2, collateralDir: 'withdraw', collateralTarget: 'strike' },
      false, PRICE, TODAY, TS, idFactory(), CUR, 0,
    );
    expect(out[0]).toMatchObject({ kind: 'withdraw', amount: 0.2 });   // magnitude, not −0.2
  });

  it('withdraw defaults to target:strike when !hasCbLoan (no toggle)', () => {
    const out = buildEventsFromSheet(
      { ...FULL, type: 'collateral', amount: 0.05, collateralDir: 'withdraw', collateralTarget: 'cb' },
      false, PRICE, TODAY, TS, idFactory(), CUR, 0,
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
    const out = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null, strikeCollateral: 0.73 }, false, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect(readingOf(out).strikeCollateral).toBe(0.73);
  });

  it('falls back to currentStrikeCollateral when s.strikeCollateral is null', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null, strikeCollateral: null }, false, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect(readingOf(out).strikeCollateral).toBe(CUR);   // 0.5
  });

  it('manual override (s.strikeCollateral) wins over the fallback', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'collateral', amount: 0.1, collateralTarget: 'strike', strikeCollateral: 0.9 }, false, PRICE, TODAY, TS, idFactory(), CUR, 0);
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
    const out = buildEventsFromSheet({ ...FULL, type: 'buy', amount: 0.05, pledgeToStrike: true }, false, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect(out.map((e) => e.kind)).toEqual(['buy', 'deposit', 'balanceReading']);
    expect(out[1]).toMatchObject({ kind: 'deposit', amount: 0.05, target: 'strike' });
    expect(out[0].date).toBe(TODAY); expect(out[1].date).toBe(TODAY); expect(out[2].date).toBe(TODAY);
    expect(out[0].ts).toBe(TS); expect(out[1].ts).toBe(TS); expect(out[2].ts).toBe(TS);
    expect(new Set(out.map((e) => e.id)).size).toBe(3);   // all distinct
  });

  it('pledge OFF → [buy, reading] (no deposit)', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'buy', amount: 0.05, pledgeToStrike: false }, false, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect(out.map((e) => e.kind)).toEqual(['buy', 'balanceReading']);
  });
});

// provisional-clears-on-reading-spec-v1, change 3b — a PAST-dated add never states Strike collateral. The only figure
// the sheet knows is TODAY's; on a past date that is the app inferring history (and a double-count risk — see the
// store test in dailyModeStore.test.ts).
describe('readingCollateralPolicy — past-dated adds never state Strike collateral', () => {
  const readingOf = (evs: ReturnType<typeof buildEventsFromSheet>) =>
    (evs.find((e) => e.kind === 'balanceReading') as Extract<typeof evs[number], { kind: 'balanceReading' }>).reading;
  it('⭐ today: required, falls back to the current total; past add: not required, NO fallback', () => {
    expect(readingCollateralPolicy(false, 0.6)).toEqual({ required: true, fallback: 0.6 });
    expect(readingCollateralPolicy(true, 0.6)).toEqual({ required: false, fallback: null });
  });
  it('readingComplete can waive the collateral field — and only when asked', () => {
    const noColl = { ...FULL, strikeCollateral: null };
    expect(readingComplete(noColl, false)).toBe(false);          // default: still required (today's add; an edit passes its own, N1)
    expect(readingComplete(noColl, false, false)).toBe(true);
    expect(readingComplete({ ...noColl, strikeBal: null }, false, false)).toBe(false);   // the balances still gate it
  });
  it('⭐ a null field + a null fallback OMITS strikeCollateral — never 0, never today\'s figure', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'setBalance', amount: null, strikeCollateral: null }, false, PRICE, TODAY, TS, idFactory(), null, 0);
    expect('strikeCollateral' in readingOf(out)).toBe(false);
    expect(readingOf(out).strikeBal).toBe(5000);
  });
});

// 5d (BL13) — a buy's dollars: "Dollars spent (incl. fee)", prefilled with the app's guess, saved as typed, kept on edit.
describe('5d — a buy\'s dollars (BL13)', () => {
  const buyOf = (evs: DayEvent[]) => evs.find((e) => e.kind === 'buy') as Extract<DayEvent, { kind: 'buy' }>;

  it('DOLLARS typed: the buy stores what was typed, to the cent — not the BTC at today\'s price', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'buy', amount: 0.012, buyUsd: 1234.567 }, false, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect(buyOf(out).usd).toBe(1234.57);
    expect(buyOf(out).usd).not.toBe(0.012 * PRICE);   // premise: the typed figure differs from the guess
    expect(out.map((e) => e.kind)).toEqual(['buy', 'balanceReading']);   // still the flow + its reading (LD6)
  });

  it('DOLLARS guess: untyped (null), zero or not a number → the BTC at today\'s price, to the cent', () => {
    for (const buyUsd of [null, 0, Number.NaN]) {
      const out = buildEventsFromSheet({ ...FULL, type: 'buy', amount: 0.012, buyUsd }, false, 61_234.5, TODAY, TS, idFactory(), CUR, 0);
      expect(buyOf(out).usd).toBe(734.81);   // 0.012 × 61,234.50 = 734.814 → 734.81
    }
  });

  it('DOLLARS cents: one rounding for the typed figure and the guess', () => {
    expect(roundUsdCents(734.814)).toBe(734.81);
    expect(roundUsdCents(1234.565 + 1e-9)).toBe(1234.57);
    expect(roundUsdCents(1000)).toBe(1000);
    expect(roundUsdCents(Number.NaN)).toBe(0);
    expect(buyUsdGuess(0.012, 61_234.5)).toBe(734.81);
    expect(buyUsdGuess(0.05, PRICE)).toBe(5000);
  });

  it('DOLLARS pledge: a pledged buy carries the typed dollars; its Strike deposit carries none', () => {
    const out = buildEventsFromSheet({ ...FULL, type: 'buy', amount: 0.05, pledgeToStrike: true, buyUsd: 4100 }, false, PRICE, TODAY, TS, idFactory(), CUR, 0);
    expect(out.map((e) => e.kind)).toEqual(['buy', 'deposit', 'balanceReading']);
    expect(buyOf(out).usd).toBe(4100);
    expect('usd' in out[1]).toBe(false);
  });

  it('DOLLARS edit kept: an edited buy keeps its id, date, ts and the dollars given — never re-priced', () => {
    const ev: Extract<DayEvent, { kind: 'buy' }> = { id: 'b1', date: '2026-06-02', ts: 7, kind: 'buy', amount: 0.01, usd: 650 };
    expect(rebuildEditedBuy(ev, 0.012, 650)).toEqual({ id: 'b1', date: '2026-06-02', ts: 7, kind: 'buy', amount: 0.012, usd: 650 });
    expect(rebuildEditedBuy(ev, 0.01, 655.555)).toEqual({ id: 'b1', date: '2026-06-02', ts: 7, kind: 'buy', amount: 0.01, usd: 655.56 });
  });

  it('DOLLARS old figure: a buy logged before 5d (its dollars unrounded) is stored to the cent at its first save', () => {
    const old: Extract<DayEvent, { kind: 'buy' }> = { id: 'b0', date: '2026-06-02', ts: 7, kind: 'buy', amount: 0.012, usd: 0.012 * 61_234.5 };
    expect(old.usd).not.toBe(734.81);                              // premise: `main` stored the guess unrounded (734.814)
    expect(rebuildEditedBuy(old, 0.012, old.usd!)).toMatchObject({ usd: 734.81 });   // re-saved unchanged → to the cent
  });

  it('DOLLARS implied: the price per ₿ the dollars imply; null until both are positive', () => {
    expect(impliedBtcPrice(650, 0.01)).toBeCloseTo(65_000);
    expect(impliedBtcPrice(null, 0.01)).toBeNull();
    expect(impliedBtcPrice(650, null)).toBeNull();
    expect(impliedBtcPrice(0, 0.01)).toBeNull();
    expect(impliedBtcPrice(650, 0)).toBeNull();
  });
});

// N1 (BL39) — an edit keeps a reading's Strike collateral as recorded. The old edit prefilled and saved
// `strikeCollateral ?? currentBtcHeld`: a reading that records none — a past-dated add's (3b), a balance saved from the
// Safety card or Quick Setup, any reading from before v20 — took today's total at its own date, and once it was the
// latest-dated reading to state collateral every Strike move dated after it counted twice (₿1.5 for ₿1.3 — the store's
// own figures are in editedReadingStore.test.ts, the sheet's in e2e/editedReading.spec.ts).
describe('N1 — an edit keeps a reading\'s Strike collateral as recorded', () => {
  type Reading = Extract<DayEvent, { kind: 'balanceReading' }>;
  const ev = (reading: Reading['reading']): Reading => ({ id: 'r1', date: '2026-06-02', ts: 7, kind: 'balanceReading', reading });
  const NONE = ev({ strikeBal: 5000, strikeLtv: 0.1 });
  const FIGURE = ev({ strikeBal: 5000, strikeLtv: 0.1, strikeCollateral: 0.5 });
  const ZERO = ev({ strikeBal: 0, strikeLtv: 0, strikeCollateral: 0 });
  const TODAY_TOTAL = 0.6;   // getCurrentBtcHeld() — no reading's figure here
  // The sheet's fields on an edit. Round percents, so every figure below is exact.
  const EDIT: SheetState = { ...FULL, strikeBal: 5500, strikeLtv: 25, strikeCollateral: null, cbBal: 62_000, cbLtv: 50, cbCollateral: 1.5, cbLiqPriceReading: null };
  const readingOf = (e: DayEvent) => (e as Reading).reading;

  it('⭐ N1 POLICY none: an edit of a reading that records none — not required, no fallback (the field hidden)', () => {
    expect('strikeCollateral' in NONE.reading).toBe(false);   // premise: it records none
    expect(readingCollateralPolicy(false, TODAY_TOTAL, NONE)).toEqual({ required: false, fallback: null });
  });

  it('⭐ N1 POLICY figure: an edit of a reading that records a figure — required, falling back to that figure, never today\'s total', () => {
    expect(readingCollateralPolicy(false, TODAY_TOTAL, FIGURE)).toEqual({ required: true, fallback: 0.5 });
    expect(readingCollateralPolicy(false, TODAY_TOTAL, ZERO)).toEqual({ required: true, fallback: 0 });   // 0 is a figure
  });

  it('N1 POLICY adds: today\'s add and a past-dated add as before, with no edited reading', () => {
    expect(readingCollateralPolicy(false, TODAY_TOTAL)).toEqual({ required: true, fallback: TODAY_TOTAL });
    expect(readingCollateralPolicy(true, TODAY_TOTAL)).toEqual({ required: false, fallback: null });
    expect(readingCollateralPolicy(false, TODAY_TOTAL, undefined)).toEqual({ required: true, fallback: TODAY_TOTAL });
  });

  it('⭐ N1 SAVE none: a reading that records none keeps none, whatever the field holds', () => {
    for (const held of [TODAY_TOTAL, 0, null]) {
      const r = readingOf(rebuildEditedReading(NONE, { ...EDIT, strikeCollateral: held }, PRICE));
      expect('strikeCollateral' in r).toBe(false);
      expect(r.strikeBal).toBe(5500);   // the edit itself lands
    }
  });

  it('⭐ N1 SAVE figure: a reading that records a figure stores the field\'s figure, else its own — never today\'s total', () => {
    expect(readingOf(rebuildEditedReading(FIGURE, { ...EDIT, strikeCollateral: 0.73 }, PRICE)).strikeCollateral).toBe(0.73);
    expect(readingOf(rebuildEditedReading(FIGURE, EDIT, PRICE)).strikeCollateral).toBe(0.5);   // an empty field
    expect(readingOf(rebuildEditedReading(ZERO, EDIT, PRICE)).strikeCollateral).toBe(0);       // 0 stays 0
  });

  it('N1 SAVE as before: id, date and ts kept, the LTVs ÷100, today\'s price, the Coinbase fields only on a reading that has them', () => {
    // Byte for byte the old inline rebuild, key order included. A Strike-only reading takes no Coinbase field even with
    // the sheet's filled: the block keys on the reading, not the loan switch.
    expect(JSON.stringify(rebuildEditedReading(FIGURE, { ...EDIT, strikeCollateral: 0.5 }, PRICE))).toBe(JSON.stringify(
      { id: 'r1', date: '2026-06-02', ts: 7, kind: 'balanceReading', reading: { strikeBal: 5500, strikeLtv: 0.25, strikeCollateral: 0.5, price: PRICE } }));
    const cb = ev({ strikeBal: 5000, strikeLtv: 0.1, strikeCollateral: 0.5, cbBal: 60_000, cbLtv: 0.4, cbCollateral: 1.5, cbLiqPrice: 61_000 });
    expect(JSON.stringify(rebuildEditedReading(cb, { ...EDIT, strikeCollateral: 0.5, cbLiqPriceReading: 61_000 }, PRICE))).toBe(JSON.stringify(
      { id: 'r1', date: '2026-06-02', ts: 7, kind: 'balanceReading',
        reading: { strikeBal: 5500, strikeLtv: 0.25, strikeCollateral: 0.5, price: PRICE, cbBal: 62_000, cbLtv: 0.5, cbCollateral: 1.5, cbLiqPrice: 61_000 } }));
    for (const cbLiqPriceReading of [null, 0]) {   // a blank liquidation price keeps none
      expect('cbLiqPrice' in readingOf(rebuildEditedReading(cb, { ...EDIT, strikeCollateral: 0.5, cbLiqPriceReading }, PRICE))).toBe(false);
    }
  });
});
