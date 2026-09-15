import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory localStorage BEFORE the store import (vi.hoisted runs first) — zustand persist touches storage at load.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem:    (k: string) => mem.get(k) ?? null,
    setItem:    (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { useStore } from '../useStore';
import { todayLocalISO } from '../../utils/format';
import { buildLedgerCsv } from '../../lib/ledgerCsv';
import { buildPlanBackup } from '../../lib/backup/exportPlan';
import { validatePlanBackup } from '../../lib/backup/validatePlanBackup';
import type { DayEvent, MonthlyLogEntry } from '../../simulation/types';

// ⚠ SYNTHETIC round figures — this repo is public; never a real position.
// Store-level pins for strike-collateral-recorded-spec-v3: MonthlyLogEntry.btcHeld is RECORDED, optional, never 0 by
// default, and never recomputed — through the real store, sync-free (isAuthenticated false → publishes no-op).

const TODAY = todayLocalISO();
let seq = 0;
const reading = (r: { strikeBal: number; strikeLtv: number; strikeCollateral?: number }): DayEvent =>
  ({ id: `r${++seq}`, date: TODAY, ts: ++seq, kind: 'balanceReading', reading: r });
const buy = (amount: number): DayEvent => ({ id: `b${++seq}`, date: TODAY, ts: ++seq, kind: 'buy', amount, usd: amount * 100000 });
const coldDeposit = (amount: number): DayEvent =>
  ({ id: `c${++seq}`, date: TODAY, ts: ++seq, kind: 'deposit', amount, target: 'cold' });

const month1 = () => useStore.getState().monthlyLog.find((e) => e.month === 1);

function resetStore(overrides: Record<string, unknown> = {}) {
  useStore.setState({
    monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {},
    strikeCollateralBtc: 0,           // a FRESH install's slice default — the S3/§9 condition
    advisorActualBtcHeld: 0.50,       // deprecated baseline — nothing may compute from it
    advisorActualBlocBalance: 0,
    advisorActualBlocBalanceAsOf: null,
    advisorStartDate: TODAY,
    btcPrice: 100000,
    hasCbLoan: false,
    monthBucketReconcileDone: false,
    isAuthenticated: false, nostrSigner: null, nostrPubkey: '',
    settingsDirty: false, recordsDirty: false,
    ...overrides,
  } as never);
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  resetStore();
});

describe('recorded Strike collateral — through the real store', () => {
  it('⭐ a cold-destined buy does not move the month\'s btcHeld', () => {
    useStore.getState().addDayEvent(reading({ strikeBal: 1000, strikeLtv: 0.02, strikeCollateral: 0.50 }));
    useStore.getState().addDayEvent(buy(0.05));
    useStore.getState().addDayEvent(coldDeposit(0.05));
    const e = month1()!;
    expect(e.btcBought).toBeCloseTo(0.05);
    expect(e.btcHeld).toBe(0.50);   // the reading — the old chain read baseline + Σ bought = 0.55
  });

  it('⭐ B1 — a Strike-only re-anchor into an empty month records NOTHING, not 0', () => {
    // emitBalanceReading without a strikeCollateral override emits a debt-only reading (dayLogSlice.ts:105).
    // Mutation: restore `btcHeld: 0` in rerollMonth's new-month seed → 0 → red.
    useStore.getState().emitBalanceReading({ strikeBal: 2000 });
    const e = month1()!;
    expect(e).toBeDefined();
    expect(e.btcHeld).toBeUndefined();
  });

  it('§9 — the onboarding anchor: a collateral reading sets current collateral AND records the month', () => {
    // A fresh install (strikeCollateralBtc 0). OnboardingModal.handleDone calls exactly this after setAdvisorStartDate.
    expect(useStore.getState().getCurrentBtcHeld()).toBe(0);
    useStore.getState().setAdvisorStartDate(TODAY);
    useStore.getState().emitBalanceReading({ strikeCollateral: 0.75 });
    expect(useStore.getState().getCurrentBtcHeld()).toBe(0.75);
    expect(month1()!.btcHeld).toBe(0.75);
    expect(useStore.getState().advisorActualBtcHeld).toBe(0.50);   // the deprecated baseline is LEFT ALONE
  });
});

describe('B2 — a joining device\'s one-shot reconcile reopens nothing', () => {
  it('⭐ confirmed daily months with a stored btcHeld and no in-month strikeCollateral reading stay confirmed', () => {
    // A new device (monthBucketReconcileDone false) that pulled an existing plan. Mutation: add btcHeld to
    // ROLLUP_NUM_KEYS → sameRollupFields sees 0.61 vs absent → rerollMonth → confirmed:false + a publish → red.
    const signed: MonthlyLogEntry = {
      month: 1, date: TODAY, btcBought: 0, income: 0, paydown: 0, strikeBal: 5000, strikeLtv: 0.12,
      loggedAt: 1, btcHeld: 0.61, expensesActual: 0, source: 'daily', confirmed: true,
    };
    resetStore({ monthlyLog: [signed], dayLog: [reading({ strikeBal: 5000, strikeLtv: 0.12 })] });
    useStore.getState().reconcileMonthBuckets();
    const s = useStore.getState();
    expect(s.monthlyLog[0].confirmed).toBe(true);
    expect(s.monthlyLog[0].btcHeld).toBe(0.61);
    expect(s.recordsDirty).toBe(false);          // nothing re-rolled, nothing to publish
    expect(s.monthBucketReconcileDone).toBe(true);
  });
});

describe('A4 — an entry with no btcHeld survives every reader end to end', () => {
  it('⭐ rerollMonth → buildLedgerCsv → buildPlanBackup → validatePlanBackup → applyPlanBackup: no throw, no 0', () => {
    // Mutation: put btcHeld back in validatePlanBackup's REQUIRED list → the new build rejects its own backup → red.
    useStore.getState().addDayEvent(reading({ strikeBal: 1000, strikeLtv: 0.01 }));   // no strikeCollateral
    expect('btcHeld' in month1()!).toBe(false);

    const [header, row] = buildLedgerCsv(useStore.getState().monthlyLog, { hasCbLoan: false, showMining: false })
      .split('\r\n').map((l) => l.split(','));
    expect(row[header.indexOf('Strike col')]).toBe('');

    const raw = JSON.parse(JSON.stringify(buildPlanBackup(useStore.getState())));
    const v = validatePlanBackup(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;

    resetStore();
    useStore.getState().applyPlanBackup(v.backup);
    const restored = useStore.getState().monthlyLog.find((e) => e.month === 1)!;
    expect(restored).toBeDefined();
    expect('btcHeld' in restored).toBe(false);   // restored as unrecorded — never a fabricated 0
  });

  it('the validator in both directions: a non-number btcHeld rejects; a recorded number (an old backup) validates', () => {
    useStore.getState().addDayEvent(reading({ strikeBal: 1000, strikeLtv: 0.01, strikeCollateral: 0.42 }));
    const raw = JSON.parse(JSON.stringify(buildPlanBackup(useStore.getState())));
    expect(raw.plan.records.monthlyLog[0].btcHeld).toBe(0.42);
    expect(validatePlanBackup(raw).ok).toBe(true);
    raw.plan.records.monthlyLog[0].btcHeld = 'x';
    expect(validatePlanBackup(raw).ok).toBe(false);
  });
});
