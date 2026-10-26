import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../useStore';
import { todayLocalISO } from '../../utils/format';
import { buildEventsFromSheet, readingCollateralPolicy, rebuildEditedReading, type SheetState } from '../../components/Daily/eventSheetModel';
import type { DayEvent } from '../../simulation/types';

// N1 (BL39) — an edit keeps a reading's Strike collateral as recorded, on the real store: the spec's probe (§1) with its
// own figures, a reading that records a figure, and the Safety card's road. The sheet's adds go through the real builder,
// its edit through the real rebuild (EventSheet's handleSave, EDIT branch), then updateDayEvent. Round synthetic figures.

type Reading = Extract<DayEvent, { kind: 'balanceReading' }>;

const S = () => useStore.getState();
const held = () => S().getCurrentBtcHeld();
const readingOf = (id: string) => (S().dayLog.find((e) => e.id === id) as Reading).reading;
const month = (m: number) => S().monthlyLog.find((e) => e.month === m);

const reset = (over: Record<string, unknown> = {}) => useStore.setState({
  monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {}, recordsDirty: false,
  advisorStartDate: '2026-03-01', advisorActualBlocBalance: 0, advisorActualBlocBalanceAsOf: null,
  cbLoanBalance: 0, cbLoanBalanceAsOf: null, cbLiquidationPrice: 0, cbLiquidationPriceAsOf: null,
  hasCbLoan: false, btcPrice: 100_000, cbCollateralBtc: 0, strikeCollateralBtc: 0,
  coldStorageBtc: 0, coldStorageBtcAsOf: null,
  isAuthenticated: false, nostrSigner: null, nostrPubkey: '', planEvents: [],
  ...over,
} as never);
beforeEach(() => reset());

const log = (...evs: DayEvent[]) => evs.forEach((e) => S().addDayEvent(e));
const r1: Reading = { id: 'r1', date: '2026-03-01', ts: 1000, kind: 'balanceReading', reading: { strikeBal: 10_000, strikeLtv: 0.1, strikeCollateral: 1 } };

// The sheet's add of a Strike deposit for an earlier day (3b): [deposit, its reading], one ts; the reading states no
// collateral (the policy's fallback is null and the field is hidden).
let n = 0;
const id = () => `n1-${n++}`;
const SHEET: SheetState = {
  type: 'collateral', amount: null, collateralDir: 'deposit', collateralTarget: 'strike', debtTarget: 'strike',
  strikeBal: 10_000, strikeLtv: 10, strikeCollateral: null, pledgeToStrike: false,
  cbBal: null, cbLtv: null, cbCollateral: null, cbLiqPriceReading: null, buyUsd: null,
};
const pastDeposit = (date: string, ts: number, amount: number): DayEvent[] =>
  buildEventsFromSheet({ ...SHEET, amount }, false, 100_000, date, ts, id, readingCollateralPolicy(true, held()).fallback, 0);

// The sheet's edit of a reading: its balance corrected, `collateral` what the collateral field holds — then the real
// rebuild.
const sheetEdit = (ev: Reading, strikeBal: number, collateral: number | null): DayEvent => rebuildEditedReading(ev, {
  strikeBal, strikeLtv: ev.reading.strikeLtv * 100, strikeCollateral: collateral,
  cbBal: null, cbLtv: null, cbCollateral: null, cbLiqPriceReading: null,
}, 100_000);

describe('N1 — an edit keeps a reading\'s Strike collateral as recorded (the real store)', () => {
  it('⭐ N1 PROBE: fixing the Mar 10 reading\'s Strike balance leaves ₿1.3 — not ₿1.5 (spec §1)', () => {
    const [d10, r10] = pastDeposit('2026-03-10', 2000, 0.1);
    const [d12, r12] = pastDeposit('2026-03-12', 3000, 0.2);
    log(r1, d10, r10, d12, r12);
    expect(held()).toBeCloseTo(1.3, 12);
    expect('strikeCollateral' in readingOf(r10.id)).toBe(false);   // premise: the Mar 10 reading records none
    // The field as HEAD seeded it — today's total — so the rebuild alone must keep none.
    S().updateDayEvent(sheetEdit(r10 as Reading, 10_500, held()));
    expect(readingOf(r10.id).strikeBal).toBe(10_500);              // the edit landed
    expect('strikeCollateral' in readingOf(r10.id)).toBe(false);
    expect(held()).toBeCloseTo(1.3, 12);
  });

  it('⭐ N1 FIGURE: a reading that records ₿1 keeps it when its balance is fixed — today\'s ₿1.2 on it would read ₿1.4', () => {
    const [d12] = pastDeposit('2026-03-12', 3000, 0.2);            // added for an earlier day, its reading skipped
    log(r1, d12);
    expect(held()).toBeCloseTo(1.2, 12);                           // premise: today's total is not the reading's ₿1
    expect(month(1)!.btcHeld).toBe(1);
    S().updateDayEvent(sheetEdit(r1, 10_500, readingCollateralPolicy(false, held(), r1).fallback));   // seeded as the sheet does
    expect(readingOf('r1')).toMatchObject({ strikeBal: 10_500, strikeCollateral: 1 });
    expect(held()).toBeCloseTo(1.2, 12);
    expect(month(1)!.btcHeld).toBe(1);
  });

  it('⭐ N1 SAFETY: a balance saved from the Safety card records none, and an edit keeps none', () => {
    const TODAY = todayLocalISO();
    reset({ advisorStartDate: TODAY });
    log({ ...r1, date: TODAY });
    S().emitBalanceReading({ strikeBal: 12_000 });                 // the Safety card's Strike box (SafetyDashboard)
    const safety = S().dayLog.find((e) => e.kind === 'balanceReading' && e.id !== 'r1') as Reading;
    expect(safety.reading.strikeBal).toBe(12_000);
    expect('strikeCollateral' in safety.reading).toBe(false);      // premise: a debt re-anchor records none
    log({ id: 'd', date: TODAY, ts: safety.ts + 1, kind: 'deposit', amount: 0.2, target: 'strike' });   // logged after it, alone
    expect(held()).toBeCloseTo(1.2, 12);
    expect(month(1)!.btcHeld).toBe(1);
    S().updateDayEvent(sheetEdit(safety, 12_500, held()));         // the field as HEAD seeded it
    expect(readingOf(safety.id).strikeBal).toBe(12_500);
    expect('strikeCollateral' in readingOf(safety.id)).toBe(false);
    expect(held()).toBeCloseTo(1.2, 12);
    expect(month(1)!.btcHeld).toBe(1);                             // the month records no figure the reading didn't
  });
});
