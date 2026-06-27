import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, buildSettingsPayload, migrateState, partializeState } from '../useStore';
import type { DayEvent } from '../../simulation/types';

// Real store. advisorStartDate = today → events dated today bucket to strategy month 1 = the CURRENT month (so
// upsertLogEntry graduates pending, exercising the C1 collateral seam). isAuthenticated:false → publishRecordsNow /
// syncSettingsToNostr early-return (no async / timers).
const TODAY = new Date().toISOString().split('T')[0];
const FUTURE = new Date(Date.now() + 45 * 86400000).toISOString().split('T')[0];   // ~month 2
const BASELINE = 0.5;

let seq = 0;
const id = () => `t${++seq}`;
const ts = () => ++seq;

const draw    = (amount: number, date = TODAY): DayEvent => ({ id: id(), date, ts: ts(), kind: 'draw', amount });
const buy     = (amount: number, usd: number | undefined, date = TODAY): DayEvent => ({ id: id(), date, ts: ts(), kind: 'buy', amount, usd });
const depo    = (amount: number, target: 'strike' | 'cb', date = TODAY): DayEvent => ({ id: id(), date, ts: ts(), kind: 'deposit', amount, target });
const reading = (r: { strikeBal: number; strikeLtv: number; cbCollateral?: number }, date = TODAY): DayEvent => ({ id: id(), date, ts: ts(), kind: 'balanceReading', reading: r });
const cbColl  = (v: number, date = TODAY): DayEvent => ({ id: id(), date, ts: ts(), kind: 'cbCollateralReading', cbCollateral: v });

const month1 = () => useStore.getState().monthlyLog.find((e) => e.month === 1);
const cur = () => useStore.getState().getCurrentBtcHeld();

beforeEach(() => {
  useStore.setState({
    monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {},
    recordsDirty: false,
    pendingCollateralAdjustment: 0,
    advisorActualBtcHeld: BASELINE,
    advisorActualBlocBalance: 0,
    advisorStartDate: TODAY,
    hasCbLoan: false,
    cbCollateralBtc: 1.48,
    cbLtvAction: 'paydown',
    isAuthenticated: false, nostrSigner: null, nostrPubkey: '',
  } as never);
});

describe('addDayEvent — Route 2 rollup', () => {
  it('draw + balanceReading → entry flows + read stocks, source:daily, btcHeld intact', () => {
    useStore.getState().addDayEvent(draw(1000));
    useStore.getState().addDayEvent(reading({ strikeBal: 5000, strikeLtv: 0.12 }));
    const e = month1()!;
    expect(e.expensesActual).toBe(1000);
    expect(e.strikeBal).toBe(5000);
    expect(e.strikeLtv).toBeCloseTo(0.12);
    expect(e.source).toBe('daily');
    expect(e.confirmed).toBe(false);
    expect(e.btcHeld).toBeCloseTo(BASELINE);   // no collateral move → baseline, not corrupted
  });

  it('buy with usd → btcBought + income; btcHeld reflects the buy', () => {
    useStore.getState().addDayEvent(buy(0.02, 1500));
    const e = month1()!;
    expect(e.btcBought).toBeCloseTo(0.02);
    expect(e.income).toBe(1500);
    expect(e.btcHeld).toBeCloseTo(BASELINE + 0.02);
  });
});

describe('C1 — collateral seam nets each target:strike move exactly once (double-count guard)', () => {
  it('two deposits, then edit-one and delete-one, each netting once', () => {
    useStore.getState().addDayEvent(depo(0.1, 'strike'));
    expect(cur()).toBeCloseTo(BASELINE + 0.1);              // 0.60

    const second = depo(0.05, 'strike');
    useStore.getState().addDayEvent(second);
    expect(cur()).toBeCloseTo(BASELINE + 0.15);             // 0.65 — NOT 0.65-on-top-of-0.6

    // grab the first deposit's id to edit it
    const first = useStore.getState().dayLog.find((e) => e.kind === 'deposit' && (e as any).amount === 0.1)!;
    useStore.getState().updateDayEvent({ ...(first as any), amount: 0.2 });
    expect(cur()).toBeCloseTo(BASELINE + 0.25);             // 0.75 (0.2 + 0.05)

    useStore.getState().deleteDayEvent(second.id);
    expect(cur()).toBeCloseTo(BASELINE + 0.2);              // 0.70 (0.2 only) — still nets once
  });
});

describe('target:cb is journal-only; cbCollateral feeds the derived clock', () => {
  it('cb deposit does not change current BTC; a cbCollateral reading updates cbCollateralBtc', () => {
    useStore.getState().addDayEvent(depo(0.1, 'cb'));
    expect(cur()).toBeCloseTo(BASELINE);                    // unchanged — target:cb contributes 0
    expect(useStore.getState().pendingCollateralAdjustment).toBe(0);

    useStore.getState().addDayEvent(cbColl(1.6));
    expect(useStore.getState().cbCollateralBtc).toBeCloseTo(1.6);
  });

  it('a target:cb deposit ALONE on a NEW month creates NO monthlyLog entry (no source:daily flip)', () => {
    useStore.getState().addDayEvent(depo(0.1, 'cb'));
    expect(useStore.getState().monthlyLog).toHaveLength(0);
  });

  it('a target:cb deposit into a previously source:manual month leaves it source:manual (Monthly editing stays allowed)', () => {
    useStore.getState().setMonthlyLog([{
      month: 1, date: TODAY, btcBought: 0, income: 0, paydown: 0, strikeBal: 200, strikeLtv: 0.1,
      loggedAt: 7, btcHeld: BASELINE, expensesActual: 50, source: 'manual', confirmed: true,
    } as any]);
    useStore.getState().addDayEvent(depo(0.1, 'cb'));
    expect(month1()!.source).toBe('manual');               // NOT flipped to daily
    // M2 guard still allows a Monthly (non-daily) upsert against it.
    useStore.getState().upsertLogEntry({ ...month1()!, expensesActual: 999, source: 'manual' });
    expect(month1()!.expensesActual).toBe(999);
  });

  it('a target:cb deposit in a month that also has a draw → month is daily (draw triggers), cb deposit unaffects current BTC', () => {
    useStore.getState().addDayEvent(draw(400));
    useStore.getState().addDayEvent(depo(0.1, 'cb'));
    const e = month1()!;
    expect(e.source).toBe('daily');                        // the draw made it daily
    expect(e.expensesActual).toBe(400);                    // rollup reflects the draw
    expect(cur()).toBeCloseTo(BASELINE);                   // cb deposit contributed no collateral
  });
});

describe('BUG1 — cbCollateralReading never touches monthlyLog', () => {
  it('a cbCollateralReading on an event-less month creates/flips NO monthlyLog entry', () => {
    useStore.getState().addDayEvent(cbColl(1.7));
    expect(useStore.getState().monthlyLog).toHaveLength(0);
    expect(useStore.getState().cbCollateralBtc).toBeCloseTo(1.7);
  });
});

describe('Partial→Full bridge preserves existing month fields', () => {
  it('a daily draw onto an existing month keeps miningSats/ndpPaid/loggedAt', () => {
    useStore.getState().setMonthlyLog([{
      month: 1, date: TODAY, btcBought: 0, income: 0, paydown: 0, strikeBal: 100, strikeLtv: 0.1,
      loggedAt: 4242, btcHeld: BASELINE, expensesActual: 0, miningSats: 5000, ndpPaid: 250,
    } as any]);
    useStore.getState().addDayEvent(draw(800));
    const e = month1()!;
    expect(e.expensesActual).toBe(800);   // daily flow applied
    expect(e.miningSats).toBe(5000);      // preserved (not blanked)
    expect(e.ndpPaid).toBe(250);          // preserved
    expect(e.loggedAt).toBe(4242);        // preserved (rollup has no loggedAt)
    expect(e.source).toBe('daily');
  });
});

describe('C2 — Seam 2 (cbCollateralBtc is a derived cache, not synced)', () => {
  it('setCbCollateralBtc emits a cbCollateralReading (not a balanceReading) and updates the cache', () => {
    useStore.getState().setCbCollateralBtc(1.9);
    const events = useStore.getState().dayLog.filter((e) => e.kind === 'cbCollateralReading');
    expect(events).toHaveLength(1);
    expect((events[0] as any).cbCollateral).toBeCloseTo(1.9);
    expect(useStore.getState().monthlyLog).toHaveLength(0);   // clock-only — no monthly entry
    expect(useStore.getState().cbCollateralBtc).toBeCloseTo(1.9);
  });

  it('cbCollateralBtc is ABSENT from the settings payload (no longer synced)', () => {
    const payload = buildSettingsPayload(useStore.getState());
    expect('cbCollateralBtc' in payload).toBe(false);
  });
});

describe('M2 — Monthly write guard', () => {
  it('a non-daily upsert against a daily-owned month is blocked', () => {
    useStore.getState().addDayEvent(draw(500));
    const before = month1()!;
    expect(before.source).toBe('daily');
    // Simulate a Monthly direct-edit path (source undefined) trying to overwrite.
    useStore.getState().upsertLogEntry({ ...before, expensesActual: 99999, source: undefined });
    expect(month1()!.expensesActual).toBe(500);   // unchanged — blocked
    expect(month1()!.source).toBe('daily');
  });
});

describe('confirmMonth + reopen-on-edit', () => {
  it('confirmMonth sets confirmed:true; a later daily edit reopens it to false', () => {
    useStore.getState().addDayEvent(draw(500));
    useStore.getState().confirmMonth(1);
    expect(month1()!.confirmed).toBe(true);
    useStore.getState().addDayEvent(draw(200));
    expect(month1()!.confirmed).toBe(false);   // reopened
    expect(month1()!.expensesActual).toBe(700);
  });
});

describe('date change across a month boundary re-rolls both months', () => {
  it('moving an event from month 1 to month 2 empties month 1 and populates month 2', () => {
    const ev = draw(900);   // month 1 (today)
    useStore.getState().addDayEvent(ev);
    expect(month1()!.expensesActual).toBe(900);

    useStore.getState().updateDayEvent({ ...(ev as any), date: FUTURE });   // → month 2
    expect(useStore.getState().monthlyLog.find((e) => e.month === 1)).toBeUndefined();   // emptied daily month removed
    expect(useStore.getState().monthlyLog.find((e) => e.month === 2)?.expensesActual).toBe(900);
  });
});

describe('migration v18→19', () => {
  it('backfills source/confirmed, seeds a cbCollateralReading for hasCbLoan, defaults cbLtvAction, reproduces cbCollateralBtc', () => {
    const out: any = migrateState({
      monthlyLog: [{ month: 1, btcBought: 0.1, income: 0, paydown: 0, strikeBal: 1000, strikeLtv: 0.1, loggedAt: 1, btcHeld: 0.6, expensesActual: 100 }],
      hasCbLoan: true,
      cbCollateralBtc: 1.48,
      advisorActualBtcHeld: 0.5,
      expenses: 3500,
    });

    expect(out.monthlyLog[0].source).toBe('manual');
    expect(out.monthlyLog[0].confirmed).toBe(true);
    expect(out.cbLtvAction).toBe('paydown');
    expect(out.dayLog.some((e: any) => e.kind === 'cbCollateralReading' && e.cbCollateral === 1.48)).toBe(true);
    expect(out.cbCollateralBtc).toBeCloseTo(1.48);   // reproduced from the seeded reading
  });

  it('no cbCollateralReading seed when !hasCbLoan', () => {
    const out: any = migrateState({ monthlyLog: [], hasCbLoan: false, cbCollateralBtc: 1.48 });
    expect(out.dayLog).toHaveLength(0);
  });
});

describe('persistence', () => {
  it('partialize output includes dayLog + cbLtvAction', () => {
    useStore.getState().addDayEvent(draw(100));
    const out: any = partializeState(useStore.getState());
    expect('dayLog' in out).toBe(true);
    expect('cbLtvAction' in out).toBe(true);
  });

  it('partialize output includes deletedDayEvents (persists via rest like deletedMonths)', () => {
    const out: any = partializeState(useStore.getState());
    expect('deletedDayEvents' in out).toBe(true);
  });
});

describe('P3 — dayLog rides records sync', () => {
  it('deleteDayEvent removes the event AND writes a deletedDayEvents[id] tombstone', () => {
    const ev = draw(300);
    useStore.getState().addDayEvent(ev);
    expect(useStore.getState().dayLog.some((e) => e.id === ev.id)).toBe(true);

    useStore.getState().deleteDayEvent(ev.id);
    expect(useStore.getState().dayLog.some((e) => e.id === ev.id)).toBe(false);
    expect(typeof useStore.getState().deletedDayEvents[ev.id]).toBe('number');
  });

  it('a journal-only addDayEvent (cbCollateralReading) marks recordsDirty (publish trigger) and creates NO monthly entry', () => {
    useStore.getState().addDayEvent(cbColl(1.55));
    expect(useStore.getState().recordsDirty).toBe(true);   // monthOf===null would skip reroll → explicit publish path is what propagates it
    expect(useStore.getState().monthlyLog).toHaveLength(0);
  });

  it('raw setDayLog replaces the journal AND folds the cbCollateralBtc derive once (newest reading), no monthly reroll', () => {
    // Seed an existing manual month — setDayLog must NOT touch it (it is not a rollup path).
    useStore.getState().setMonthlyLog([{
      month: 1, date: TODAY, btcBought: 0, income: 0, paydown: 0, strikeBal: 100, strikeLtv: 0.1,
      loggedAt: 9, btcHeld: BASELINE, expensesActual: 10, source: 'manual', confirmed: true,
    } as never]);

    const e1 = cbColl(1.1);      // ts smaller (created first)
    const e2 = cbColl(2.2);      // ts larger → newest cbCollateral
    useStore.getState().setDayLog([e1, e2]);

    expect(useStore.getState().dayLog.map((e) => e.id)).toEqual([e1.id, e2.id]);
    expect(useStore.getState().cbCollateralBtc).toBeCloseTo(2.2);    // derived once from the merged array
    expect(month1()!.expensesActual).toBe(10);                       // manual month untouched (no reroll)
  });

  it('setDeletedDayEvents raw-sets the tombstone map', () => {
    useStore.getState().setDeletedDayEvents({ z: 12345 });
    expect(useStore.getState().deletedDayEvents.z).toBe(12345);
  });
});
