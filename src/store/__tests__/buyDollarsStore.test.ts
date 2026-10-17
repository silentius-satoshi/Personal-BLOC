import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../useStore';
import { buyDollarsOnlyEdit } from '../dailyRouting';
import { collateralCorrection } from '../../components/Advisor/monthlyLogForm';
import { bucketEventToMonth, deriveReadingAnchors } from '../../simulation/logUtils';
import { todayLocalISO, toLocalISO } from '../../utils/format';
import type { DayEvent, MonthlyLogEntry } from '../../simulation/types';

// 5d (BL13) — a buy's dollars, through the real store. advisorStartDate = today → events dated today (or a few days on)
// bucket to strategy month 1. isAuthenticated:false → publishing early-returns (no async).
const TODAY = todayLocalISO();
const LATER = toLocalISO(new Date(Date.now() + 3 * 86_400_000));   // still month 1 (a month is ≥ 28 days)

let seq = 0;
const id = () => `d5-${++seq}`;
const ts = () => ++seq;

type Buy = Extract<DayEvent, { kind: 'buy' }>;
const buy = (amount: number, usd: number | undefined, date = TODAY): Buy =>
  (usd === undefined ? { id: id(), date, ts: ts(), kind: 'buy', amount } : { id: id(), date, ts: ts(), kind: 'buy', amount, usd });
const reading = (strikeBal: number, strikeCollateral: number, extra: Record<string, number> = {}, date = TODAY): DayEvent =>
  ({ id: id(), date, ts: ts(), kind: 'balanceReading', reading: { strikeBal, strikeLtv: 0.1, strikeCollateral, ...extra } });
const draw = (amount: number, date = TODAY): DayEvent => ({ id: id(), date, ts: ts(), kind: 'draw', amount });
const minimum = (amount: number, date = TODAY): DayEvent => ({ id: id(), date, ts: ts(), kind: 'minPayment', amount });

const st = () => useStore.getState();
const entry = (m: number) => st().monthlyLog.find((e) => e.month === m);
const month1 = () => entry(1);
const edit = (ev: DayEvent) => st().updateDayEvent(ev);
const stored = (evId: string) => st().dayLog.find((e) => e.id === evId) as Buy;

beforeEach(() => {
  useStore.setState({
    monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {},
    recordsDirty: false,
    advisorActualBtcHeld: 0.5,
    advisorActualBlocBalance: 0,
    advisorStartDate: TODAY,
    hasCbLoan: false,
    cbCollateralBtc: 1.48,
    strikeCollateralBtc: 0.5,
    cbLtvAction: 'paydown',
    isAuthenticated: false, nostrSigner: null, nostrPubkey: '',
  } as never);
});

/** A signed month 1 holding one buy (and its reading). */
function signedMonthWithBuy(usd: number | undefined = 650): Buy {
  const b = buy(0.01, usd);
  st().addDayEvent(b);
  st().addDayEvent(reading(5000, 0.5));
  st().confirmMonth(1);
  return b;
}

/** A signed month 1 whose sign-off recorded its own figures: $2,500 of expenses for $3,000 drawn, a $210 minimum for the
 *  $200 logged, an NDP of $120 — what an owner who covered some expenses from savings would sign. */
function signedMonthWithOwnFigures(): Buy {
  const b = buy(0.01, 650);
  st().addDayEvent(draw(3000));
  st().addDayEvent(minimum(200));
  st().addDayEvent(b);
  st().addDayEvent(reading(8000, 0.5));
  st().confirmMonth(1, { expensesActual: 2500, strikeMinPaid: 210, strikeMinSource: 'income', ndpPaid: 120 });
  return b;
}

/** The live balance anchors — what §5b's re-anchor reads besides the readings. */
const anchors = () => {
  const s = st();
  return {
    advisorActualBlocBalance: s.advisorActualBlocBalance, advisorActualBlocBalanceAsOf: s.advisorActualBlocBalanceAsOf,
    cbLoanBalance: s.cbLoanBalance, cbLoanBalanceAsOf: s.cbLoanBalanceAsOf,
    cbLiquidationPrice: s.cbLiquidationPrice, cbLiquidationPriceAsOf: s.cbLiquidationPriceAsOf,
  };
};

/** A signed month 1 with a Coinbase loan, whose same-day reading says $5,000 (Strike), $40,000 and a $39,000 liquidation
 *  price (Coinbase); then the owner types $6,000, $45,000 and $42,000 in Settings — knob-set anchors (asOf today, no
 *  reading), out of step with the reading. */
function signedMonthWithTypedBalances(): Buy {
  useStore.setState({ hasCbLoan: true } as never);
  const b = buy(0.01, 650);
  st().addDayEvent(b);
  st().addDayEvent(reading(5000, 0.5, { cbBal: 40000, cbLtv: 0.4, cbCollateral: 1.2, cbLiqPrice: 39000 }));
  st().confirmMonth(1);
  st().setAdvisorActualBlocBalance(6000);   // Settings → Strike → "Amount Drawn"
  st().setCbLoanBalance(45000);             // Settings → Coinbase → "Loan balance"
  st().setCbLiquidationPrice(42000);        // Settings → Coinbase → "Liquidation price"
  // premise: a re-anchor would put the reading's three figures back over the typed ones
  expect(deriveReadingAnchors(st().dayLog, anchors())).toEqual({
    advisorActualBlocBalance: 5000, advisorActualBlocBalanceAsOf: TODAY,
    cbLoanBalance: 40000, cbLoanBalanceAsOf: TODAY,
    cbLiquidationPrice: 39000, cbLiquidationPriceAsOf: TODAY,
  });
  return b;
}

describe('5d — a dollars-only edit keeps a signed month signed (BL13)', () => {
  it('SIGNOFF dollars-only keeps: the month stays signed, and Income → BTC follows the typed dollars', () => {
    const b = signedMonthWithBuy(650);
    expect(month1()!.confirmed).toBe(true);    // premise: signed
    expect(month1()!.income).toBe(650);        // premise: the rollup reads the buy's dollars
    edit({ ...b, usd: 702.15 });
    expect(month1()!.confirmed).toBe(true);    // Mutation: the edit path drops the rule → reopened (false) → red
    expect(month1()!.income).toBe(702.15);
    expect(month1()!.btcBought).toBe(0.01);
    expect(stored(b.id).usd).toBe(702.15);
  });

  it('SIGNOFF figures kept: a dollars-only edit keeps what the sign-off recorded; a BTC edit re-rolls the month and reopens it', () => {
    const b = signedMonthWithOwnFigures();
    // premise: the sign-off's own figures, not the rollup's ($3,000 drawn, a $200 minimum)
    expect(month1()).toMatchObject({ confirmed: true, expensesActual: 2500, strikeMinPaid: 210, ndpPaid: 120, income: 650 });
    edit({ ...b, usd: 702.15 });
    // Mutation: the full spread on the dollars-only path (the first cut) → 3,000 and 200, still signed → red
    expect(month1()).toMatchObject({ confirmed: true, expensesActual: 2500, strikeMinPaid: 210, ndpPaid: 120, income: 702.15 });
    edit({ ...stored(b.id), amount: 0.012 });
    // every other edit: the month re-rolls from its events and reopens (LD4), as before 5d
    expect(month1()).toMatchObject({ confirmed: false, expensesActual: 3000, strikeMinPaid: 200, btcBought: 0.012, income: 702.15 });
  });

  it('SIGNOFF btc reopens: changing the buy\'s BTC still reopens the month (LD4)', () => {
    const b = signedMonthWithBuy(650);
    edit({ ...b, amount: 0.012 });
    expect(month1()!.confirmed).toBe(false);
    expect(month1()!.btcBought).toBe(0.012);
    expect(month1()!.income).toBe(650);        // the dollars stay as they were
  });

  it('SIGNOFF date reopens: moving the buy to another day — even inside the month — still reopens it (LD4)', () => {
    const b = signedMonthWithBuy(650);
    edit({ ...b, date: LATER });
    expect(st().monthlyLog.filter((e) => e.month === 1)).toHaveLength(1);   // premise: the same month
    expect(month1()!.confirmed).toBe(false);
  });

  it('SIGNOFF unsigned stays unsigned: a dollars-only edit never signs a month', () => {
    const b = buy(0.01, 650);
    st().addDayEvent(b);
    expect(month1()!.confirmed).toBe(false);   // premise: a living, unsigned month
    edit({ ...b, usd: 700 });
    expect(month1()!.confirmed).toBe(false);   // Mutation: the dollars-only path writes confirmed:true → red
    expect(month1()!.income).toBe(700);
  });

  it('SIGNOFF legacy: a month signed before sign-offs were stamped (confirmed absent) stays signed', () => {
    const b = buy(0.01, 650);
    st().addDayEvent(b);
    const { confirmed: _c, ...legacy } = month1()!;
    useStore.setState({ monthlyLog: [legacy] } as never);
    expect(month1()!.confirmed).toBeUndefined();   // premise: absent ⇒ treated as signed everywhere
    edit({ ...b, usd: 700 });
    expect(month1()!.confirmed).toBeUndefined();   // Mutation: `?? false` on the dollars-only path → false → red
    expect(month1()!.income).toBe(700);
  });

  it('SIGNOFF manual month: a month not yet daily-owned takes the full path, as before — re-rolled, daily, reopened', () => {
    const b = buy(0.01, 650);
    st().addDayEvent(b);
    st().addDayEvent(reading(5000, 0.5));
    // A manual entry for the same month (source absent — older data), signed, with an income of its own. Its BTC bought
    // matches the events, so only its source keeps it off the dollars-only path.
    const { source: _s, ...manual } = { ...month1()!, income: 9000, confirmed: true };
    useStore.setState({ monthlyLog: [manual as MonthlyLogEntry] } as never);
    expect(month1()).toMatchObject({ btcBought: 0.01, confirmed: true });   // premise: in step with its events, signed
    expect(month1()!.source).toBeUndefined();                              // premise: not daily-owned
    edit({ ...b, usd: 700 });
    // Mutation: the current-check ignores the source → Income → BTC alone, still manual and signed → red
    expect(month1()).toMatchObject({ source: 'daily', btcBought: 0.01, income: 700, confirmed: false });
  });

  it('SIGNOFF lagging entry — a newer event: a draw pulled without its month\'s entry, then a dollars-only edit → the full path, rebuilt and reopened', () => {
    const b = signedMonthWithBuy(650);
    // The pull's raw setter (sync.ts — no re-roll): a draw logged on another device after the sign-off lands; the month
    // entry that device re-rolled (and reopened) hasn't arrived.
    const lateDraw: DayEvent = { id: id(), date: TODAY, ts: Date.now() + 60_000, kind: 'draw', amount: 3000 };
    st().setDayLog([...st().dayLog, lateDraw]);
    expect(month1()).toMatchObject({ confirmed: true, expensesActual: 0 });   // premise: the stored entry lags its events
    edit({ ...b, usd: 700 });
    // Mutation: the current-check ignores event times → Income → BTC alone onto the stale entry, still signed → red
    expect(month1()).toMatchObject({ confirmed: false, expensesActual: 3000, income: 700 });
  });

  it('SIGNOFF lagging entry — BTC bought: a buy pulled without its month\'s entry, its time no help, then a dollars-only edit → the full path', () => {
    const x = signedMonthWithBuy(650);
    // A buy whose time is older than the entry's last save (clocks apart) — only its BTC tells the entry lags.
    const y: Buy = { id: id(), date: TODAY, ts: ts(), kind: 'buy', amount: 0.02, usd: 1300 };
    st().setDayLog([...st().dayLog, y]);
    expect(y.ts).toBeLessThan(month1()!.updatedAt!);                           // premise: the time check can't see it
    expect(month1()).toMatchObject({ confirmed: true, btcBought: 0.01 });     // premise: the stored entry lags
    edit({ ...x, usd: 700 });
    // Mutation: the current-check ignores BTC bought → 0.01 ₿ with $2,000 of buys, still signed → red
    expect(month1()).toMatchObject({ confirmed: false, income: 2000 });
    expect(month1()!.btcBought).toBeCloseTo(0.03, 12);
  });

  it('SIGNOFF lagging entry — the balances stay: on the full path too, a dollars-only edit never re-anchors the balances', () => {
    const b = signedMonthWithTypedBalances();   // premise inside: a re-anchor would put the reading's three figures back
    const typed = anchors();
    const lateDraw: DayEvent = { id: id(), date: TODAY, ts: Date.now() + 60_000, kind: 'draw', amount: 1000 };
    st().setDayLog([...st().dayLog, lateDraw]);   // the pull's raw setter: a draw without its month's entry
    expect(month1()).toMatchObject({ confirmed: true, expensesActual: 0 });   // premise: the stored entry lags
    edit({ ...b, usd: 700 });
    expect(month1()).toMatchObject({ confirmed: false, expensesActual: 1000, income: 700 });   // the full path, as before
    // Mutation: the skip tied to the lag check (round 4's line) → the re-anchor runs on this path → 5,000 / 40,000 / 39,000 → red
    expect(anchors()).toEqual(typed);
    expect([st().advisorActualBlocBalance, st().cbLoanBalance, st().cbLiquidationPrice]).toEqual([6000, 45000, 42000]);
  });

  it('SIGNOFF rule: only a buy whose BTC and date are unchanged is a dollars-only edit', () => {
    const b: Buy = { id: 'x', date: TODAY, ts: 1, kind: 'buy', amount: 0.01, usd: 650 };
    expect(buyDollarsOnlyEdit(b, { ...b, usd: 700, ts: 2 })).toBe(true);
    expect(buyDollarsOnlyEdit(b, { ...b, ts: 2 })).toBe(true);                       // a re-save with nothing changed
    expect(buyDollarsOnlyEdit(b, { ...b, amount: 0.011, ts: 2 })).toBe(false);
    expect(buyDollarsOnlyEdit(b, { ...b, date: LATER, ts: 2 })).toBe(false);
    expect(buyDollarsOnlyEdit(b, { ...b, id: 'y', ts: 2 })).toBe(false);
    expect(buyDollarsOnlyEdit(undefined, b)).toBe(false);
    const d: DayEvent = { id: 'x', date: TODAY, ts: 1, kind: 'draw', amount: 500 };
    expect(buyDollarsOnlyEdit(d, { ...d, ts: 2 })).toBe(false);
    const r: DayEvent = { id: 'r', date: TODAY, ts: 1, kind: 'balanceReading', reading: { strikeBal: 5000, strikeLtv: 0.1, strikeCollateral: 0.5 } };
    expect(buyDollarsOnlyEdit(r, { ...r, ts: 2, reading: { ...r.reading, strikeBal: 6000 } })).toBe(false);   // no BTC amount on a reading
  });
});

// 5d skips §5b's re-anchor on a dollars-only edit (`if (!dollarsRule)`); every other edit still runs it, as on `main`.
// The add, delete and merge paths are pinned in dailyModeStore.test; this pins the edit path's run side. (Whether a BTC
// or date edit of a buy re-anchors is left as on `main` and unpinned: pinning it would pin §12's older same-day bug.)
describe('5d — every other edit still re-anchors the balances', () => {
  it('ANCHOR other edits: editing today\'s reading still moves the balance to it', () => {
    const r = reading(5000, 0.5) as Extract<DayEvent, { kind: 'balanceReading' }>;
    st().addDayEvent(r);
    expect(st().advisorActualBlocBalance).toBe(5000);   // premise: the add anchored it
    edit({ ...r, reading: { ...r.reading, strikeBal: 5500 } });
    // Mutation: the call removed from updateDayEvent → the balance stays 5,000 → red
    expect(st().advisorActualBlocBalance).toBe(5500);
  });
});

// BL13's second kill criterion: typing a buy's dollars must move no safety figure. Every safety figure derives from the
// store, so the check is the whole store: a dollars-only edit may change the edited buy (its usd, and its ts — the merge
// clock), its month's Income → BTC and that entry's updatedAt stamp, and the records-dirty flag. Nothing else, in any
// month — the figures a sign-off recorded included.
describe('5d — KILL2: a dollars-only edit changes nothing else in the store', () => {
  const data = () => Object.fromEntries(Object.entries(st()).filter(([, v]) => typeof v !== 'function')) as Record<string, unknown>;
  const derived = () => ({ btcHeld: st().getCurrentBtcHeld(), cold: st().getCurrentColdBtc(), cb: st().cbCollateralBtc, strike: st().strikeCollateralBtc });

  type Fixture = { name: string; setup: () => { b: Buy; month: number }; usd: number };
  const FIXTURES: Fixture[] = [
    { name: 'an unsigned month, no loan', usd: 700, setup: () => { const b = buy(0.01, 650); st().addDayEvent(b); st().addDayEvent(reading(5000, 0.5)); return { b, month: 1 }; } },
    { name: 'a signed month', usd: 702.15, setup: () => ({ b: signedMonthWithBuy(650), month: 1 }) },
    {
      name: 'a pledged buy, a Coinbase loan and a cold move, signed', usd: 1999.99,
      setup: () => {
        useStore.setState({ hasCbLoan: true } as never);
        const t = ts();
        const b: Buy = { id: id(), date: TODAY, ts: t, kind: 'buy', amount: 0.02, usd: 1300 };
        st().addDayEvent(b);
        st().addDayEvent({ id: id(), date: TODAY, ts: t, kind: 'deposit', amount: 0.02, target: 'strike' });
        st().addDayEvent({ id: id(), date: TODAY, ts: t, kind: 'balanceReading', reading: { strikeBal: 5000, strikeLtv: 0.1, strikeCollateral: 0.52, cbBal: 40000, cbLtv: 0.4, cbCollateral: 1.2, cbLiqPrice: 39000 } });
        st().addDayEvent({ id: id(), date: TODAY, ts: ts(), kind: 'deposit', amount: 0.05, target: 'cold' });
        st().confirmMonth(1);
        return { b, month: 1 };
      },
    },
    { name: 'a buy with no dollars yet (older data), signed', usd: 640, setup: () => { const b = buy(0.01, undefined); st().addDayEvent(b); st().addDayEvent(reading(5000, 0.5)); st().confirmMonth(1); return { b, month: 1 }; } },
    { name: 'a sign-off that recorded its own figures (expenses, the minimum, the NDP)', usd: 702.15, setup: () => ({ b: signedMonthWithOwnFigures(), month: 1 }) },
    {
      name: 'a sign-off at the review\'s rounded seeds (1,235 and 217 for 1,234.56 and 216.67)', usd: 702.15,
      setup: () => {
        const b = buy(0.01, 650);
        st().addDayEvent(draw(1234.56));
        st().addDayEvent(minimum(216.67));
        st().addDayEvent(b);
        st().addDayEvent(reading(8000, 0.5));
        st().confirmMonth(1, { expensesActual: Math.round(1234.56), strikeMinPaid: Math.round(216.67), strikeMinSource: 'income' });   // the review's seeds, untouched
        expect([month1()!.expensesActual, month1()!.strikeMinPaid]).toEqual([1235, 217]);   // premise: not the rollup's 1,234.56 and 216.67
        return { b, month: 1 };
      },
    },
    {
      name: 'a hand-entered Strike collateral on a signed month', usd: 700,
      setup: () => {
        const b = signedMonthWithBuy(650);
        st().upsertLogEntry(collateralCorrection(month1()!, 0.48));   // the reading says 0.5; the owner's record says 0.48
        expect(month1()).toMatchObject({ btcHeld: 0.48, confirmed: true });   // premise: the record, not the reading's 0.5
        return { b, month: 1 };
      },
    },
    {
      name: 'balances typed in Settings on the day of a reading (Strike\'s, and Coinbase\'s balance and liquidation price)', usd: 700,
      setup: () => ({ b: signedMonthWithTypedBalances(), month: 1 }),   // premise inside: a re-anchor would move all three
    },
    {
      name: 'two signed months, the edit in the second', usd: 1350.55,
      setup: () => {
        const start = toLocalISO(new Date(Date.now() - 45 * 86_400_000));
        const early = toLocalISO(new Date(Date.now() - 43 * 86_400_000));
        useStore.setState({ advisorStartDate: start } as never);
        expect([bucketEventToMonth(early, start), bucketEventToMonth(TODAY, start)]).toEqual([1, 2]);   // premise: two months
        st().addDayEvent(draw(2000, early));
        st().addDayEvent(buy(0.01, 500, early));
        st().addDayEvent(reading(6000, 0.5, {}, early));
        st().confirmMonth(1, { expensesActual: 1800 });
        expect(entry(1)!.expensesActual).toBe(1800);   // premise: month 1's own figure, not its $2,000 drawn
        const b = buy(0.02, 1300);
        st().addDayEvent(b);
        st().addDayEvent(reading(6000, 0.52));
        st().confirmMonth(2);
        return { b, month: 2 };
      },
    },
  ];

  for (const f of FIXTURES) {
    it(`KILL2 nothing else moves — ${f.name}`, () => {
      const { b, month } = f.setup();
      const before = structuredClone(data());   // a deep copy: a write in place can't hide (fact-check 2)
      const derivedBefore = derived();
      const buyBefore = (before.dayLog as DayEvent[]).find((e) => e.id === b.id) as Buy;
      edit({ ...b, usd: f.usd });
      const after = data();

      const buyAfter = stored(b.id);
      const monthAfter = entry(month)!;
      expect(buyAfter.usd).toBe(f.usd);
      expect(buyAfter.ts).toBeGreaterThan(buyBefore.ts);   // the merge clock moved
      expect(monthAfter.income).toBe(f.usd);               // the month's only buy
      // The whole store, before → after: only the buy's usd and ts, the month's income and updatedAt, and the records flag.
      expect(after).toEqual({
        ...before,
        dayLog: (before.dayLog as DayEvent[]).map((e) => (e.id === b.id ? { ...e, usd: f.usd, ts: buyAfter.ts } : e)),
        monthlyLog: (before.monthlyLog as MonthlyLogEntry[]).map((e) => (e.month === month ? { ...e, income: f.usd, updatedAt: monthAfter.updatedAt } : e)),
        recordsDirty: true,
      });
      expect(derived()).toEqual(derivedBefore);
    });
  }
});
