import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../useStore';
import { todayLocalISO, toLocalISO } from '../../utils/format';
import { mergeRecords } from '../../simulation/mergeRecords';
import { unreconciledCbFlows } from '../../simulation/logUtils';
import { isCrashDay } from '../../components/Tools/crashPlaybookView';
import type { DayEvent } from '../../simulation/types';

// Hotfix 1 — the journal's order, on the real store. The audit's own probes (Hardening 1, audit A2: A2-1, A2-3, A2-4)
// with their own figures, then the cases the fix's design adds. ts values are small integers, so Date.now() — the
// store's edit and Undo stamp — is always later than every event a test logs by hand.

type Reading = Extract<DayEvent, { kind: 'balanceReading' }>;
type Move = Extract<DayEvent, { kind: 'deposit' | 'withdraw' }>;

const S = () => useStore.getState();
const month = (m: number) => S().monthlyLog.find((e) => e.month === m);
const held = () => S().getCurrentBtcHeld();
const byId = (id: string) => S().dayLog.find((e) => e.id === id);

const reading = (id: string, date: string, ts: number, r: Reading['reading']): Reading =>
  ({ id, date, ts, kind: 'balanceReading', reading: r });
const move = (id: string, date: string, ts: number, kind: 'deposit' | 'withdraw', amount: number, target: Move['target']): Move =>
  ({ id, date, ts, kind, amount, target });

// The edit the sheet makes (EventSheet's handleSave, EDIT branch): the event rebuilt from scratch with its id, date and
// ts, and nothing else of the stored copy. updateDayEvent receives exactly this — never the stored object.
const sheetEditMove = (ev: Move, amount: number): DayEvent =>
  ({ id: ev.id, date: ev.date, ts: ev.ts, kind: ev.kind, amount, target: ev.target });
const sheetEditReading = (ev: Reading, r: Reading['reading']): DayEvent =>
  ({ id: ev.id, date: ev.date, ts: ev.ts, kind: 'balanceReading', reading: r });

// The sheet's own "Strike held after" readout for an edit (EventSheet: currentBtcHeld − origEffect + new).
const sheetReadout = (ev: Move, amount: number) => {
  const sign = ev.kind === 'withdraw' ? -1 : 1;
  return held() - sign * ev.amount + sign * amount;
};

const reset = (over: Record<string, unknown> = {}) => useStore.setState({
  monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {}, recordsDirty: false,
  advisorStartDate: '2026-01-01', advisorActualBlocBalance: 0, advisorActualBlocBalanceAsOf: null,
  cbLoanBalance: 0, cbLoanBalanceAsOf: null, cbLiquidationPrice: 0, cbLiquidationPriceAsOf: null,
  hasCbLoan: true, btcPrice: 100_000, cbCollateralBtc: 0, strikeCollateralBtc: 0,
  coldStorageBtc: 0, coldStorageBtcAsOf: null,
  isAuthenticated: false, nostrSigner: null, nostrPubkey: '', planEvents: [],
  ...over,
} as never);

beforeEach(() => reset());

// ── A2-1 / A2-4 — the audit's P1, P2 and P12 ────────────────────────────────────────────────────────────────────────
const A = reading('A', '2026-03-05', 1000, { strikeBal: 10_000, strikeLtv: 0.10, strikeCollateral: 1, cbBal: 4_000, cbLtv: 0.40, cbCollateral: 1 });
const B = reading('B', '2026-03-25', 2000, { strikeBal: 12_000, strikeLtv: 0.12, strikeCollateral: 1, cbBal: 40_000, cbLtv: 0.20, cbCollateral: 2 });

describe('Hotfix 1 · A2-1 — an older reading never becomes the current Coinbase collateral', () => {
  beforeEach(() => { S().addDayEvent(A); S().addDayEvent(B); });

  it('A2-1 P1 · editing the Mar 5 reading (a typo in its Strike balance) leaves the Mar 25 collateral current', () => {
    expect(S().cbCollateralBtc).toBe(2);                         // premise: the later-dated reading is current
    S().updateDayEvent(sheetEditReading(A, { ...A.reading, strikeBal: 10_500 }));
    expect((byId('A') as Reading).reading.strikeBal).toBe(10_500);   // the edit landed
    expect(S().cbCollateralBtc).toBe(2);
    expect(S().advisorActualBlocBalance).toBe(12_000);
    expect(S().advisorActualBlocBalanceAsOf).toBe('2026-03-25');
  });

  it('A2-1 P12 · the edit does not open the crash day (Coinbase $80,000, trigger 75%)', () => {
    const crash = () => isCrashDay({ hasCbLoan: true, cbDebt: 80_000, cbCollateralBtc: S().cbCollateralBtc, price: 100_000, triggerPct: 75 });
    expect(crash()).toBe(false);
    S().updateDayEvent(sheetEditReading(A, { ...A.reading, strikeBal: 10_500 }));
    expect(crash()).toBe(false);
  });

  it('A2-1 · deleting the Mar 5 reading and tapping Undo leaves the Mar 25 collateral current', () => {
    S().deleteDayEvent('A');
    expect(S().cbCollateralBtc).toBe(2);
    S().undoDayEventDeletion(A);
    expect(byId('A')).toBeDefined();
    expect(S().cbCollateralBtc).toBe(2);
  });

  it('A2-1 · a reading backfilled to Mar 10 after the Mar 25 one does not become current', () => {
    S().addDayEvent(reading('C', '2026-03-10', 3000, { strikeBal: 11_000, strikeLtv: 0.11, cbBal: 30_000, cbLtv: 0.2, cbCollateral: 1.5 }));
    expect(S().cbCollateralBtc).toBe(2);
  });

  it('A2-1 · a Coinbase collateral reading backfilled to Mar 10 does not become current', () => {
    S().addDayEvent({ id: 'K', date: '2026-03-10', ts: 3000, kind: 'cbCollateralReading', cbCollateral: 1.5 });
    expect(S().cbCollateralBtc).toBe(2);
  });

  it('setCbCollateralBtc still sets the current figure: its reading is today\'s, the latest date', () => {
    S().setCbCollateralBtc(2.5);
    expect(S().cbCollateralBtc).toBe(2.5);
  });
});

describe('Hotfix 1 · A2-4 — a month closes on its latest reading by date', () => {
  it('A2-4 P1 · editing the Mar 5 reading leaves month 3 on the Mar 25 figures', () => {
    S().addDayEvent(A); S().addDayEvent(B);
    const before = month(3)!;
    expect([before.strikeBal, before.strikeLtv, before.cbLtv]).toEqual([12_000, 0.12, 0.20]);   // premise
    S().updateDayEvent(sheetEditReading(A, { ...A.reading, strikeBal: 10_500 }));
    const after = month(3)!;
    expect([after.strikeBal, after.strikeLtv, after.cbBal, after.cbLtv]).toEqual([12_000, 0.12, 40_000, 0.20]);
  });

  it('A2-4 P2 · a backfilled Mar 5 buy and reading change neither month 3\'s close nor month 4\'s carry-forward', () => {
    S().addDayEvent(B);
    S().confirmMonth(3);
    expect(month(3)!.confirmed).toBe(true);
    S().addDayEvent({ id: 'buy', date: '2026-03-05', ts: 3000, kind: 'buy', amount: 0.01, usd: 1_000 });
    S().addDayEvent(reading('R5', '2026-03-05', 3000, { strikeBal: 10_000, strikeLtv: 0.10, cbBal: 4_000, cbLtv: 0.40, cbCollateral: 1 }));
    S().addDayEvent({ id: 'draw', date: '2026-04-10', ts: 4000, kind: 'draw', amount: 500 });
    expect(month(3)!.strikeBal).toBe(12_000);
    expect(month(3)!.btcBought).toBeCloseTo(0.01, 12);           // the backfill itself still lands in month 3
    expect(month(4)!.strikeBal).toBe(12_000);
    expect(month(4)!.provisional).toBe(true);
  });
});

// ── A2-3 — the audit's P5 and P7, then the design's cases ─────────────────────────────────────────────────────────────
const TODAY = todayLocalISO();
// The today sheet's Save for a Strike move: the move and a reading stating the post-move total, one ts (LD6).
const pair = (n: string, ts: number, kind: 'deposit' | 'withdraw', amount: number, total: number): [Move, Reading] => [
  move(`d${n}`, TODAY, ts, kind, amount, 'strike'),
  reading(`r${n}`, TODAY, ts, { strikeBal: 1_000, strikeLtv: 0.01, strikeCollateral: total }),
];
const logAll = (...evs: DayEvent[]) => evs.forEach((e) => S().addDayEvent(e));

describe('Hotfix 1 · A2-3 — an edited or restored Strike move is counted once', () => {
  beforeEach(() => reset({ advisorStartDate: TODAY, hasCbLoan: false }));

  it('A2-3 P5 · correcting a just-logged 0.1 deposit to 0.12 gives the sheet\'s own ₿1.12, not ₿1.22', () => {
    const [d, r] = pair('1', 2000, 'deposit', 0.1, 1.1);
    logAll(reading('r0', TODAY, 1000, { strikeBal: 1_000, strikeLtv: 0.01, strikeCollateral: 1 }), d, r);
    expect(held()).toBeCloseTo(1.1, 12);
    const promised = sheetReadout(d, 0.12);
    expect(promised).toBeCloseTo(1.12, 12);
    S().updateDayEvent(sheetEditMove(d, 0.12));
    expect(held()).toBeCloseTo(promised, 12);
    expect((byId('r1') as Reading).reading.strikeCollateral).toBe(1.12);   // its own reading moved with it, in whole sats
  });

  it('A2-3 P7 · deleting the deposit keeps ₿1.1 (its reading still states it) and Undo restores exactly ₿1.1', () => {
    const [d, r] = pair('1', 2000, 'deposit', 0.1, 1.1);
    logAll(reading('r0', TODAY, 1000, { strikeBal: 1_000, strikeLtv: 0.01, strikeCollateral: 1 }), d, r);
    S().deleteDayEvent('d1');
    expect(held()).toBeCloseTo(1.1, 12);
    expect((byId('r1') as Reading).reading.strikeCollateral).toBe(1.1);   // a delete moves no reading
    S().undoDayEventDeletion(d);
    expect(byId('d1')).toBeDefined();
    expect(held()).toBe(1.1);
  });

  it('a second correction counts once too (the sheet rebuilds the move from its stored copy, whose ts the first edit moved)', () => {
    const [d, r] = pair('1', 2000, 'deposit', 0.1, 1.1);
    logAll(reading('r0', TODAY, 1000, { strikeBal: 1_000, strikeLtv: 0.01, strikeCollateral: 1 }), d, r);
    S().updateDayEvent(sheetEditMove(d, 0.12));
    const stored = byId('d1') as Move;
    expect(stored.ts).toBeGreaterThan(2000);                    // premise: the version clock moved
    S().updateDayEvent(sheetEditMove(stored, 0.15));
    expect(held()).toBeCloseTo(1.15, 12);
    expect((byId('r1') as Reading).reading.strikeCollateral).toBe(1.15);
  });

  it('a corrected withdrawal moves its reading the other way: 0.1 → 0.05 out of ₿1 leaves ₿0.95', () => {
    const [w, r] = pair('1', 2000, 'withdraw', 0.1, 0.9);
    logAll(reading('r0', TODAY, 1000, { strikeBal: 1_000, strikeLtv: 0.01, strikeCollateral: 1 }), w, r);
    expect(held()).toBeCloseTo(0.9, 12);
    const promised = sheetReadout(w, 0.05);
    S().updateDayEvent(sheetEditMove(w, 0.05));
    expect(held()).toBeCloseTo(promised, 12);
    expect(held()).toBeCloseTo(0.95, 12);
  });

  it('with two Strike moves the same day, correcting the first counts nothing twice: the later reading stands', () => {
    const [d1, r1] = pair('1', 2000, 'deposit', 0.1, 1.1);
    const [d2, r2] = pair('2', 3000, 'deposit', 0.2, 1.3);
    logAll(reading('r0', TODAY, 1000, { strikeBal: 1_000, strikeLtv: 0.01, strikeCollateral: 1 }), d1, r1, d2, r2);
    expect(held()).toBeCloseTo(1.3, 12);
    S().updateDayEvent(sheetEditMove(d1, 0.12));
    expect(held()).toBeCloseTo(1.3, 12);                        // the 3000 reading is still the day's last statement
    expect((byId('r1') as Reading).reading.strikeCollateral).toBe(1.12);
    expect((byId('r2') as Reading).reading.strikeCollateral).toBe(1.3);
  });

  it('an unchanged re-save moves nothing, and leaves its reading\'s version as it was', () => {
    const [d, r] = pair('1', 2000, 'deposit', 0.1, 1.1);
    logAll(reading('r0', TODAY, 1000, { strikeBal: 1_000, strikeLtv: 0.01, strikeCollateral: 1 }), d, r);
    S().updateDayEvent(sheetEditMove(d, 0.1));
    expect(held()).toBeCloseTo(1.1, 12);
    expect(byId('r1')).toEqual(r);
  });

  it('a Strike move logged on its own, after its day\'s reading, still adds its corrected size once', () => {
    logAll(reading('r0', TODAY, 1000, { strikeBal: 1_000, strikeLtv: 0.01, strikeCollateral: 1 }), move('d', TODAY, 2000, 'deposit', 0.1, 'strike'));
    expect(held()).toBeCloseTo(1.1, 12);
    S().updateDayEvent(sheetEditMove(byId('d') as Move, 0.15));
    expect(held()).toBeCloseTo(1.15, 12);
    expect((byId('r0') as Reading).reading.strikeCollateral).toBe(1);   // not its reading: untouched
  });

  it('a Coinbase move\'s reading keeps its Strike total when the move is corrected', () => {
    reset({ advisorStartDate: TODAY, hasCbLoan: true });
    const d = move('dc', TODAY, 2000, 'deposit', 0.1, 'cb');
    const r = reading('rc', TODAY, 2000, { strikeBal: 1_000, strikeLtv: 0.01, strikeCollateral: 1, cbBal: 10_000, cbLtv: 0.05, cbCollateral: 2.1 });
    logAll(d, r);
    S().updateDayEvent(sheetEditMove(d, 0.2));
    expect((byId('rc') as Reading).reading).toEqual(r.reading);
    expect(held()).toBe(1);
  });

  it('a past-dated Strike move\'s reading states no collateral, and a correction gives it none', () => {
    const past = toLocalISO(new Date(Date.now() - 3 * 86_400_000));
    reset({ advisorStartDate: past, hasCbLoan: false });
    const d = move('dp', past, 2000, 'deposit', 0.1, 'strike');
    const r = reading('rp', past, 2000, { strikeBal: 1_000, strikeLtv: 0.01 });
    logAll(reading('r0', TODAY, 1000, { strikeBal: 1_000, strikeLtv: 0.01, strikeCollateral: 1 }), d, r);
    S().updateDayEvent(sheetEditMove(d, 0.3));
    expect('strikeCollateral' in (byId('rp') as Reading).reading).toBe(false);
    expect(held()).toBe(1);                                    // dated before today's reading: inside its total
  });

  it('the corrected pair wins a merge against the copies another device still holds', () => {
    const [d, r] = pair('1', 2000, 'deposit', 0.1, 1.1);
    logAll(reading('r0', TODAY, 1000, { strikeBal: 1_000, strikeLtv: 0.01, strikeCollateral: 1 }), d, r);
    const stale = { entries: [], deletions: {}, dayLog: [...S().dayLog], dayLogDeletions: {} };
    S().updateDayEvent(sheetEditMove(d, 0.12));
    const local = { entries: [], deletions: {}, dayLog: S().dayLog, dayLogDeletions: S().deletedDayEvents };
    for (const [a, b] of [[local, stale], [stale, local]] as const) {
      const merged = mergeRecords(a, b, { preferLocalOnTie: true });
      expect((merged.dayLog.find((e) => e.id === 'd1') as Move).amount).toBe(0.12);
      expect((merged.dayLog.find((e) => e.id === 'r1') as Reading).reading.strikeCollateral).toBe(1.12);
    }
  });
});

// ── The same order everywhere a day's "latest" or "after" is read ────────────────────────────────────────────────────
describe('Hotfix 1 · an edit or Undo keeps an event\'s place in its day', () => {
  beforeEach(() => reset({ advisorStartDate: TODAY, hasCbLoan: true }));

  it('editing the morning reading leaves the evening one as the Strike and Coinbase balance anchors', () => {
    const am = reading('am', TODAY, 1000, { strikeBal: 10_000, strikeLtv: 0.1, strikeCollateral: 1, cbBal: 50_000, cbLtv: 0.25, cbCollateral: 2 });
    const pm = reading('pm', TODAY, 2000, { strikeBal: 12_000, strikeLtv: 0.12, strikeCollateral: 1, cbBal: 52_000, cbLtv: 0.26, cbCollateral: 2 });
    logAll(am, pm);
    expect([S().advisorActualBlocBalance, S().cbLoanBalance]).toEqual([12_000, 52_000]);
    S().updateDayEvent(sheetEditReading(am, { ...am.reading, strikeBal: 10_500, cbBal: 50_500 }));
    expect([S().advisorActualBlocBalance, S().cbLoanBalance]).toEqual([12_000, 52_000]);
  });

  it('deleting the morning reading and tapping Undo leaves the evening one as the balance anchors and the collateral', () => {
    const am = reading('am', TODAY, 1000, { strikeBal: 10_000, strikeLtv: 0.1, strikeCollateral: 0.5, cbBal: 50_000, cbLtv: 0.25, cbCollateral: 1.5 });
    const pm = reading('pm', TODAY, 2000, { strikeBal: 12_000, strikeLtv: 0.12, strikeCollateral: 0.6, cbBal: 52_000, cbLtv: 0.26, cbCollateral: 2 });
    logAll(am, pm);
    S().deleteDayEvent('am');
    S().undoDayEventDeletion(am);                                // never edited: Undo alone must keep its place
    expect(byId('am')).toBeDefined();
    expect([S().advisorActualBlocBalance, S().cbLoanBalance, held(), S().cbCollateralBtc]).toEqual([12_000, 52_000, 0.6, 2]);
  });

  it('editing the morning reading\'s collateral leaves the evening one\'s Strike and Coinbase collateral current', () => {
    const am = reading('am', TODAY, 1000, { strikeBal: 10_000, strikeLtv: 0.1, strikeCollateral: 0.5, cbBal: 50_000, cbLtv: 0.25, cbCollateral: 1.5 });
    const pm = reading('pm', TODAY, 2000, { strikeBal: 10_000, strikeLtv: 0.1, strikeCollateral: 0.6, cbBal: 50_000, cbLtv: 0.25, cbCollateral: 2 });
    logAll(am, pm);
    S().updateDayEvent(sheetEditReading(am, { ...am.reading, strikeCollateral: 0.9, cbCollateral: 1.9 }));
    expect(held()).toBe(0.6);
    expect(S().cbCollateralBtc).toBe(2);
    expect(month(1)!.btcHeld).toBe(0.6);
  });

  it('a Coinbase borrow logged before the day\'s Coinbase reading stays inside it when corrected', () => {
    logAll({ id: 'cbd', date: TODAY, ts: 1000, kind: 'draw', target: 'cb', amount: 10_000 },
      reading('cr', TODAY, 2000, { strikeBal: 0, strikeLtv: 0, cbBal: 70_000, cbLtv: 0.35, cbCollateral: 2 }));
    expect(unreconciledCbFlows(S().dayLog).events).toHaveLength(0);
    S().updateDayEvent({ id: 'cbd', date: TODAY, ts: 1000, kind: 'draw', target: 'cb', amount: 12_000 });
    expect(unreconciledCbFlows(S().dayLog).events).toHaveLength(0);
  });

  it('a cold move logged before the cold total was typed stays inside it when corrected, deleted and restored', () => {
    const at = 50_000;                                           // the cold total typed at this moment
    const day = toLocalISO(new Date(at));
    reset({ advisorStartDate: day, coldStorageBtc: 1, coldStorageBtcAsOf: at });
    const c = move('cold', day, 40_000, 'deposit', 0.2, 'cold');
    S().addDayEvent(c);
    expect(S().getCurrentColdBtc()).toBe(1);
    S().updateDayEvent(sheetEditMove(c, 0.25));
    expect(S().getCurrentColdBtc()).toBe(1);
    const kept = byId('cold')!;                                  // what the Undo snackbar holds: the stored copy
    S().deleteDayEvent('cold');
    S().undoDayEventDeletion(kept);
    expect(byId('cold')).toBeDefined();
    expect(S().getCurrentColdBtc()).toBe(1);
  });
});
