import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, buildSettingsPayload, migrateState, partializeState } from '../useStore';
import { todayLocalISO, toLocalISO } from '../../utils/format';
import { rollupMonth, priorStocksForMonth } from '../../simulation/logUtils';
import type { DayEvent, MonthlyLogEntry } from '../../simulation/types';

// Real store. advisorStartDate = today → events dated today bucket to strategy month 1 = the CURRENT month (so
// upsertLogEntry graduates pending, exercising the C1 collateral seam). isAuthenticated:false → publishRecordsNow /
// syncSettingsToNostr early-return (no async / timers).
// TODAY must match the store's advisorStartDate default (todayLocalISO()) — use the same helper, not a UTC-derived
// date, so the two stay the same calendar day regardless of the test runner's timezone/time-of-day.
const TODAY = todayLocalISO();
const FUTURE = toLocalISO(new Date(Date.now() + 45 * 86400000));   // ~month 2
const BASELINE = 0.5;

let seq = 0;
const id = () => `t${++seq}`;
const ts = () => ++seq;

const draw    = (amount: number, date = TODAY): DayEvent => ({ id: id(), date, ts: ts(), kind: 'draw', amount });
const buy     = (amount: number, usd: number | undefined, date = TODAY): DayEvent => ({ id: id(), date, ts: ts(), kind: 'buy', amount, usd });
const depo    = (amount: number, target: 'strike' | 'cb', date = TODAY): DayEvent => ({ id: id(), date, ts: ts(), kind: 'deposit', amount, target });
const reading = (r: { strikeBal: number; strikeLtv: number; strikeCollateral?: number; cbCollateral?: number }, date = TODAY): DayEvent => ({ id: id(), date, ts: ts(), kind: 'balanceReading', reading: r });
const cbColl  = (v: number, date = TODAY): DayEvent => ({ id: id(), date, ts: ts(), kind: 'cbCollateralReading', cbCollateral: v });

const month1 = () => useStore.getState().monthlyLog.find((e) => e.month === 1);
const cur = () => useStore.getState().getCurrentBtcHeld();

beforeEach(() => {
  useStore.setState({
    monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {},
    recordsDirty: false,
    advisorActualBtcHeld: BASELINE,
    advisorActualBlocBalance: 0,
    advisorStartDate: TODAY,
    hasCbLoan: false,
    cbCollateralBtc: 1.48,
    strikeCollateralBtc: BASELINE,     // reading-anchored cache seed (fallback when no strikeCollateral reading)
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

describe('C1 — reading-anchored Strike collateral (v20 — reading states the total; post-anchor moves add once)', () => {
  it('reading anchors; a later deposit adds once; edit/delete re-derive from the anchor', () => {
    // The reading states the collateral total directly (the sheet emits it with the post-move amount).
    useStore.getState().addDayEvent(reading({ strikeBal: 1000, strikeLtv: 0.1, strikeCollateral: BASELINE + 0.1 }));
    expect(cur()).toBeCloseTo(BASELINE + 0.1);              // 0.60 (anchor)

    const dep = depo(0.05, 'strike');                       // ts strictly after the reading → +0.05
    useStore.getState().addDayEvent(dep);
    expect(cur()).toBeCloseTo(BASELINE + 0.15);             // 0.65 — summed once, not double

    useStore.getState().updateDayEvent({ ...(dep as any), amount: 0.15 });   // edit the post-anchor deposit
    expect(cur()).toBeCloseTo(BASELINE + 0.25);             // 0.75 (0.60 + 0.15) — still once

    useStore.getState().deleteDayEvent(dep.id);
    expect(cur()).toBeCloseTo(BASELINE + 0.1);              // 0.60 — back to the reading total
  });

  it('a bare deposit with NO strikeCollateral reading does not move current (semantic shift)', () => {
    useStore.getState().addDayEvent(depo(0.1, 'strike'));   // no anchor → fallback cache (BASELINE)
    expect(cur()).toBeCloseTo(BASELINE);
  });
});

describe('P3 — updateDayEvent bumps ts (the merge version clock)', () => {
  it('an edit advances ts so it strictly beats the stale remote copy (higher-ts-wins, tie→local)', () => {
    const ev = draw(100);                                   // seq-based ts (a small integer)
    useStore.getState().addDayEvent(ev);
    useStore.getState().updateDayEvent({ ...(ev as any), amount: 200 });   // preserves ev.ts on the way in; store overrides
    const stored = useStore.getState().dayLog.find((e) => e.id === ev.id)!;
    expect(stored.ts).toBeGreaterThan(ev.ts);               // bumped to Date.now() — no longer ties the stale copy
    expect((stored as Extract<DayEvent, { kind: 'draw' | 'paydown' }>).amount).toBe(200);
  });
});

describe('target:cb is journal-only; cbCollateral feeds the derived clock', () => {
  it('cb deposit does not change current BTC; a cbCollateral reading updates cbCollateralBtc', () => {
    useStore.getState().addDayEvent(depo(0.1, 'cb'));
    expect(cur()).toBeCloseTo(BASELINE);                    // unchanged — target:cb contributes 0

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

  it('v20 — strikeCollateralBtc + pendingCollateralAdjustment are ABSENT from the settings payload', () => {
    const payload = buildSettingsPayload(useStore.getState());
    expect('strikeCollateralBtc' in payload).toBe(false);        // derived cache — never rides settings LWW
    expect('pendingCollateralAdjustment' in payload).toBe(false); // retired
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

describe('migration v19→20 (Collateral-Truth — reading-anchored Strike collateral)', () => {
  it('seeds strikeCollateralBtc from the old-math current position, strips pending, getCurrentBtcHeld unchanged', () => {
    // Old getCurrentBtcHeld = (last entry btcHeld) + pending = 1.038488 + (−0.206442) = 0.832046.
    const out: any = migrateState({
      monthlyLog: [
        { month: 1, btcBought: 0.15, income: 0, paydown: 0, strikeBal: 2927, strikeLtv: 0.06, loggedAt: 1, btcHeld: 0.150221, expensesActual: 100 },
        { month: 2, btcBought: 0.06, income: 0, paydown: 0, strikeBal: 4592, strikeLtv: 0.09, loggedAt: 2, btcHeld: 1.038488, expensesActual: 100 },
      ],
      advisorActualBtcHeld: 0.150221,
      pendingCollateralAdjustment: -0.206442,
      hasCbLoan: false,
    });
    expect(out.strikeCollateralBtc).toBeCloseTo(0.832046, 6);   // seed = last.btcHeld + pending
    expect('pendingCollateralAdjustment' in out).toBe(false);   // stripped from the migrated shape
    // No legacy reading carries strikeCollateral → derive returns the seed → getCurrentBtcHeld identical.
    useStore.setState({ dayLog: out.dayLog ?? [], strikeCollateralBtc: out.strikeCollateralBtc } as never);
    expect(useStore.getState().getCurrentBtcHeld()).toBeCloseTo(0.832046, 6);
  });

  it('empty log → seed = advisorActualBtcHeld + pending', () => {
    const out: any = migrateState({ monthlyLog: [], advisorActualBtcHeld: 0.7, pendingCollateralAdjustment: 0.05, hasCbLoan: false });
    expect(out.strikeCollateralBtc).toBeCloseTo(0.75);
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

  it('v20 — strikeCollateralBtc persists (rides ...rest); pendingCollateralAdjustment is gone', () => {
    const out: any = partializeState(useStore.getState());
    expect('strikeCollateralBtc' in out).toBe(true);              // derived cache persisted (not synced)
    expect('pendingCollateralAdjustment' in out).toBe(false);     // retired field
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

// §5b Readings-Unification — a local reading action re-anchors the live safety anchors (add/update/delete),
// but a sync/merge (setDayLog) does NOT (the anchor travels cross-device via the settings channel instead).
describe('§5b — refreshBalanceAnchors seam', () => {
  const cbReading = (strikeBal: number, cbBal: number, cbLiqPrice?: number, date = TODAY): DayEvent =>
    ({ id: id(), date, ts: ts(), kind: 'balanceReading', reading: { strikeBal, strikeLtv: 0.12, cbBal, cbLtv: 0.5, cbCollateral: 1.4, ...(cbLiqPrice !== undefined ? { cbLiqPrice } : {}) } });

  beforeEach(() => {
    useStore.setState({
      hasCbLoan: true,
      advisorActualBlocBalance: 0, advisorActualBlocBalanceAsOf: null,
      cbLoanBalance: 0, cbLoanBalanceAsOf: null,
      cbLiquidationPrice: 0, cbLiquidationPriceAsOf: null,
    } as never);
  });

  it('addDayEvent(balanceReading) re-anchors advisorActualBlocBalance / cbLoanBalance / cbLiquidationPrice + stamps asOf=today', () => {
    useStore.getState().addDayEvent(cbReading(5000, 40000, 61000));
    const s = useStore.getState();
    expect(s.advisorActualBlocBalance).toBe(5000);
    expect(s.cbLoanBalance).toBe(40000);
    expect(s.cbLiquidationPrice).toBe(61000);
    expect(s.advisorActualBlocBalanceAsOf).toBe(TODAY);
    expect(s.cbLoanBalanceAsOf).toBe(TODAY);
    expect(s.cbLiquidationPriceAsOf).toBe(TODAY);
  });

  it('a reading WITHOUT cbLiqPrice leaves cbLiquidationPrice + its asOf untouched (honest freshness)', () => {
    useStore.setState({ cbLiquidationPrice: 55000, cbLiquidationPriceAsOf: '2025-01-01' } as never);
    useStore.getState().addDayEvent(cbReading(5000, 40000 /* no liq */));
    const s = useStore.getState();
    expect(s.cbLoanBalance).toBe(40000);            // balance still re-anchors
    expect(s.cbLiquidationPrice).toBe(55000);       // liq untouched
    expect(s.cbLiquidationPriceAsOf).toBe('2025-01-01');
  });

  it('setDayLog (merge) folds cbCollateralBtc but does NOT move the balance anchors', () => {
    useStore.setState({ advisorActualBlocBalance: 9000, advisorActualBlocBalanceAsOf: TODAY, cbCollateralBtc: 1.48 } as never);
    // A merged reading arriving via the records channel — balance anchors must stay put (no seam on merge).
    useStore.getState().setDayLog([cbReading(1234, 5678, 61000)]);
    const s = useStore.getState();
    expect(s.cbCollateralBtc).toBeCloseTo(1.4);   // derived from the merged reading's cbCollateral (the fold)
    expect(s.advisorActualBlocBalance).toBe(9000); // anchor NOT jolted by the merge
    expect(s.cbLoanBalance).toBe(0);
  });

  it('deleting the anchor-source reading falls back to the date-latest survivor', () => {
    const older = cbReading(3000, 30000, 60000, TODAY);
    useStore.getState().addDayEvent(older);
    const newer = cbReading(5000, 40000, 61000, FUTURE);   // later date → becomes the source
    useStore.getState().addDayEvent(newer);
    expect(useStore.getState().advisorActualBlocBalance).toBe(5000);
    useStore.getState().deleteDayEvent(newer.id);
    // Falls back to the older (only surviving) reading, not the deleted value.
    expect(useStore.getState().advisorActualBlocBalance).toBe(3000);
    expect(useStore.getState().cbLoanBalance).toBe(30000);
  });
});

// §5b — the Strike-balance freshness stamp is a synced setting.
describe('§5b — advisorActualBlocBalanceAsOf synced setting', () => {
  it('default null; in the settings payload; setAdvisorActualBlocBalance stamps asOf=today', () => {
    useStore.setState({ advisorActualBlocBalanceAsOf: null } as never);
    expect('advisorActualBlocBalanceAsOf' in buildSettingsPayload(useStore.getState())).toBe(true);
    useStore.getState().setAdvisorActualBlocBalance(7777);
    expect(useStore.getState().advisorActualBlocBalance).toBe(7777);
    expect(useStore.getState().advisorActualBlocBalanceAsOf).toBe(TODAY);
  });
});

// Calendar-bucket reconcile — re-roll stored entries under the corrected bucketing. START 2026-06-01 so a
// 2026-07-01 event moves M1 (legacy 30.4375) → M2 (calendar).
describe('reconcileMonthBuckets', () => {
  const START = '2026-06-01';
  const dOn = (date: string): DayEvent => ({ id: id(), date, ts: ts(), kind: 'draw', amount: 1000 });
  const rOn = (strikeBal: number, date: string): DayEvent => ({ id: id(), date, ts: ts(), kind: 'balanceReading', reading: { strikeBal, strikeLtv: 0.1 } });
  const depOn = (amount: number, date: string): DayEvent => ({ id: id(), date, ts: ts(), kind: 'deposit', amount, target: 'strike' });
  const seedEntry = (over: Partial<MonthlyLogEntry>): MonthlyLogEntry => ({
    month: 1, date: START, btcBought: 0, income: 0, paydown: 0, strikeBal: 0, strikeLtv: 0,
    loggedAt: 1, updatedAt: 1, btcHeld: BASELINE, expensesActual: 0, source: 'daily', confirmed: false, ...over,
  });

  it('moves a boundary event M1→M2: empties the stale M1 daily entry, creates M2; second run + flag', () => {
    const dayLog = [dOn('2026-07-01'), rOn(5000, '2026-07-01')];   // both bucket to M2 under the fix
    useStore.setState({
      advisorStartDate: START, dayLog,
      monthlyLog: [seedEntry({ month: 1, expensesActual: 1000, strikeBal: 5000, strikeLtv: 0.1 })],   // stale: rolled into M1 under 30.4375
      deletedMonths: {}, isAuthenticated: false, nostrSigner: null, nostrPubkey: '', monthBucketReconcileDone: false,
    } as never);

    useStore.getState().reconcileMonthBuckets();
    expect(useStore.getState().monthlyLog.find((e) => e.month === 1)).toBeUndefined();   // emptied
    const m2 = useStore.getState().monthlyLog.find((e) => e.month === 2)!;
    expect(m2.expensesActual).toBe(1000);
    expect(m2.strikeBal).toBe(5000);
    expect(useStore.getState().monthBucketReconcileDone).toBe(true);

    const snapshot = JSON.stringify(useStore.getState().monthlyLog);
    useStore.getState().reconcileMonthBuckets();   // idempotent
    expect(JSON.stringify(useStore.getState().monthlyLog)).toBe(snapshot);
  });

  it('Correction 1: a boundary STRIKE deposit re-rolls BOTH neighbor months even when sameRollupFields matches', () => {
    // Draws/readings in Jun & Jul stay put (stable rollup fields); only the Jul-1 deposit moves M1→M2.
    const dayLog = [dOn('2026-06-15'), rOn(3000, '2026-06-15'), dOn('2026-07-20'), rOn(8000, '2026-07-20'), depOn(0.1, '2026-07-01')];
    // Seed BOTH entries to EXACTLY the fresh rollup → sameRollupFields is TRUE, so only the collateral-delta check can fire.
    const fresh1 = rollupMonth(dayLog, 1, START, priorStocksForMonth(dayLog, START, 1)).entry;
    const fresh2 = rollupMonth(dayLog, 2, START, priorStocksForMonth(dayLog, START, 2)).entry;
    useStore.setState({
      advisorStartDate: START, dayLog,
      monthlyLog: [
        seedEntry({ month: 1, date: START, ...fresh1 }),
        seedEntry({ month: 2, date: '2026-07-01', ...fresh2 }),
      ],
      deletedMonths: {}, isAuthenticated: false, nostrSigner: null, nostrPubkey: '', monthBucketReconcileDone: false,
    } as never);

    useStore.getState().reconcileMonthBuckets();
    const m1 = useStore.getState().monthlyLog.find((e) => e.month === 1)!;
    const m2 = useStore.getState().monthlyLog.find((e) => e.month === 2)!;
    expect(m1.updatedAt).not.toBe(1);   // re-rolled despite identical rollup fields — the collateral-delta comparison caught it
    expect(m2.updatedAt).not.toBe(1);
  });

  it('monthBucketReconcileDone: default false, rides partialize, NOT in the settings payload', () => {
    useStore.setState({ monthBucketReconcileDone: false } as never);
    expect('monthBucketReconcileDone' in partializeState(useStore.getState())).toBe(true);
    expect('monthBucketReconcileDone' in buildSettingsPayload(useStore.getState())).toBe(false);
  });
});
