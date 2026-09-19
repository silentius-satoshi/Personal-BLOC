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
import { bucketEventToMonth } from '../../simulation/logUtils';
import { collateralCorrection, correctionDurability, DURABILITY_HINT, type CorrectionDurability } from '../../components/Advisor/monthlyLogForm';
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

// ledger-cold-total-onboarding-date-spec-v2 §2 — the onboarding reading is dated TODAY, by design.
// The 1st of the month `monthsBack` calendar months before today (copied from collateral.test.ts — deterministic).
const startMonthsBack = (monthsBack: number): string => {
  const d = new Date();
  const norm = new Date(d.getFullYear(), d.getMonth() - monthsBack, 1);
  return `${norm.getFullYear()}-${String(norm.getMonth() + 1).padStart(2, '0')}-01`;
};

describe('onboarding with a BACKDATED strategy start', () => {
  it('⭐ records the collateral in the month containing TODAY; earlier months have no row', () => {
    // The INTENDED contract, not a defect: the owner typed their CURRENT collateral, and the app does not infer a
    // historical position. (The §9 test above only covers startDate === TODAY, so this was never pinned.)
    // Mutation: date the reading at advisorStartDate → month 1 exists with 0.75 → red.
    const start = startMonthsBack(3);
    resetStore({ advisorStartDate: start });
    useStore.getState().setAdvisorStartDate(start);
    useStore.getState().emitBalanceReading({ strikeCollateral: 0.75 });
    expect(useStore.getState().getCurrentBtcHeld()).toBe(0.75);
    expect(month1()).toBeUndefined();   // no row at all — not a row with an undefined btcHeld
    const m = bucketEventToMonth(TODAY, start);
    expect(m).toBe(4);
    expect(useStore.getState().monthlyLog.find((e) => e.month === m)!.btcHeld).toBe(0.75);
  });
});

// daily-month-collateral-edit-spec-v2 — correcting a daily month's RECORDED Strike collateral, through the real store.
describe('daily-month collateral correction', () => {
  const START = '2026-06-01';   // month 1 = June, month 2 = July
  let k = 0;
  const rd = (date: string, strikeCollateral?: number): DayEvent => ({
    id: `cr${++k}`, date, ts: 1_000 + k, kind: 'balanceReading',
    reading: { strikeBal: 1000, strikeLtv: 0.1, ...(strikeCollateral !== undefined ? { strikeCollateral } : {}) },
  });
  const dr = (date: string): DayEvent => ({ id: `cd${++k}`, date, ts: 1_000 + k, kind: 'draw', amount: 500 });
  const add = (...evs: DayEvent[]) => evs.forEach((e) => useStore.getState().addDayEvent(e));
  const entry = (m: number) => useStore.getState().monthlyLog.find((e) => e.month === m)!;
  const correct = (m: number, v: number | null) => useStore.getState().upsertLogEntry(collateralCorrection(entry(m), v));
  const classify = (m: number) => correctionDurability(useStore.getState().dayLog, START, m);
  beforeEach(() => resetStore({ advisorStartDate: START }));

  it('⭐ the write lands on a SIGNED daily month — the M2 guard is satisfied, not bypassed', () => {
    add(dr('2026-06-10'), rd('2026-06-12'));
    useStore.getState().confirmMonth(1);
    correct(1, 0.42);
    // Mutation: strip `source` inside collateralCorrection → the M2 guard drops the write → btcHeld stays absent → red.
    expect(entry(1).btcHeld).toBe(0.42);
    expect(entry(1).confirmed).toBe(true);   // a record correction doesn't un-sign the month
    expect(entry(1).source).toBe('daily');
  });

  it('⭐ a `stable` correction survives a re-roll (and the re-roll reopens the month — LD4)', () => {
    add(dr('2026-07-10'), rd('2026-07-12'));   // in-month reading, no collateral stated
    useStore.getState().confirmMonth(2);
    expect(entry(2).confirmed).toBe(true);   // a re-roll always writes false — start SIGNED or the reopen check is vacuous
    expect(classify(2)).toBe('stable');
    correct(2, 0.42);
    expect(entry(2).confirmed).toBe(true);
    add(dr('2026-07-20'));
    // Mutation: strip btcHeld from `base` in rerollMonth's bridge → red. (Also the stale-field-defect-2 guard.)
    expect(entry(2).btcHeld).toBe(0.42);
    expect(entry(2).confirmed).toBe(false);   // A8 — LD4 reopen-on-edit, pinned so it isn't reported later
  });

  it('a `fragile` correction is overwritten by the carry-forward (the documented inversion)', () => {
    add(rd('2026-06-12', 0.5), dr('2026-07-10'));
    expect(entry(2).btcHeld).toBe(0.5);   // carried from June
    expect(classify(2)).toBe('fragile');
    correct(2, 0.4);
    expect(entry(2).btcHeld).toBe(0.4);
    add(dr('2026-07-20'));
    expect(entry(2).btcHeld).toBe(0.5);
  });

  it('⭐ a carry-forward RE-TRACKS the prior month\'s latest reading (what the rejected bridge guard would break)', () => {
    add(rd('2026-06-12', 0.5), dr('2026-07-10'));
    expect(entry(2).btcHeld).toBe(0.5);
    add(rd('2026-06-20', 0.55));   // re-rolls June only
    expect(entry(2).btcHeld).toBe(0.5);
    add(dr('2026-07-20'));
    // Mutation: keep base.btcHeld when rollupEntry.provisional → still 0.50 forever (SE1) → red.
    expect(entry(2).btcHeld).toBe(0.55);
  });

  it('a reading wins: an in-month reading stating collateral replaces the correction', () => {
    add(dr('2026-07-10'), rd('2026-07-12'));
    correct(2, 0.42);
    add(rd('2026-07-15', 0.6));
    expect(entry(2).btcHeld).toBe(0.6);
    expect(classify(2)).toBe('stated');
  });

  it('Clear record un-records (the Ledger shows "—")', () => {
    add(dr('2026-07-10'), rd('2026-07-12'));
    correct(2, 0.42);
    correct(2, null);
    expect('btcHeld' in entry(2)).toBe(false);
  });

  it('⭐ the classifier matches reality — every durability class, against a real re-roll', () => {
    const fixtures: { name: string; events: () => DayEvent[]; after: number }[] = [
      { name: 'stated',                 events: () => [dr('2026-07-10'), rd('2026-07-12', 0.6)],                    after: 0.6 },
      { name: 'stable (reading)',       events: () => [dr('2026-07-10'), rd('2026-07-12')],                         after: 0.42 },
      { name: 'fragile',                events: () => [rd('2026-06-12', 0.5), dr('2026-07-10')],                    after: 0.5 },
      { name: 'stable (no reading)',    events: () => [rd('2026-06-12'), dr('2026-07-10')],                         after: 0.42 },
      { name: 'earlier states, later doesn\'t', events: () => [rd('2026-07-05', 0.6), dr('2026-07-10'), rd('2026-07-12')], after: 0.42 },
    ];
    for (const f of fixtures) {
      resetStore({ advisorStartDate: START });
      add(...f.events());
      const c: CorrectionDurability = classify(2);
      correct(2, 0.42);
      add(dr('2026-07-25'));   // an in-month event → a real re-roll
      const held = entry(2).btcHeld;
      // The correction survives exactly when the classifier said `stable`. Mutation: classify from the EARLIEST
      // reading → the last fixture says `stated`, yet its correction survives → red.
      expect({ name: f.name, survived: held === 0.42 }).toEqual({ name: f.name, survived: c === 'stable' });
      expect({ name: f.name, held }).toEqual({ name: f.name, held: f.after });
    }
  });

  it('⭐ the `stable` hint\'s second clause is real: last month\'s reading, while this month has none', () => {
    // (a) Delete the month's only reading → it re-rolls at once, and the carry-forward stamps June's figure.
    add(rd('2026-06-12', 0.5), dr('2026-07-10'));
    const july = rd('2026-07-12');
    add(july);
    expect(classify(2)).toBe('stable');
    correct(2, 0.42);
    useStore.getState().deleteDayEvent(july.id);
    expect(entry(2).btcHeld).toBe(0.5);
    expect(classify(2)).toBe('fragile');

    // (b) Backfill a June reading that states collateral → the month turns fragile; its next event replaces the entry.
    resetStore({ advisorStartDate: START });
    add(rd('2026-06-12'), dr('2026-07-10'));
    expect(classify(2)).toBe('stable');
    correct(2, 0.42);
    add(rd('2026-06-20', 0.5));
    expect(entry(2).btcHeld).toBe(0.42);
    expect(classify(2)).toBe('fragile');
    add(dr('2026-07-20'));
    expect(entry(2).btcHeld).toBe(0.5);

    // So the hint must name both ways out. Mutation: revert it to the in-month-only copy → red.
    expect(DURABILITY_HINT.stable).toContain('last month');
  });
});
