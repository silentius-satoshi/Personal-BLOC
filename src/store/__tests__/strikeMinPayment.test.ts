import { describe, it, expect, afterEach } from 'vitest';
import { useStore, buildSettingsPayload } from '../useStore';

// Simple Mode Corrections A — the two new SYNCED settings (blocMinPaymentSource / blocStatementMinimum)
// travel in the settings payload and hydrate cleanly. Both default to the migration-free 'roll' / null.

const reset = () => useStore.setState({ blocMinPaymentSource: 'roll', blocStatementMinimum: null });

describe('Strike minimum payment source — synced settings', () => {
  afterEach(reset);

  it('defaults are roll / null (migration-free, byte-identical to today)', () => {
    const s = useStore.getState();
    expect(s.blocMinPaymentSource).toBe('roll');
    expect(s.blocStatementMinimum).toBe(null);
  });

  it('buildSettingsPayload carries both fields', () => {
    useStore.getState().setBlocMinPaymentSource('income');
    useStore.getState().setBlocStatementMinimum(142);
    const payload = buildSettingsPayload(useStore.getState());
    expect(payload.blocMinPaymentSource).toBe('income');
    expect(payload.blocStatementMinimum).toBe(142);
  });

  it('hydrateSettings applies both fields (cross-device sync)', () => {
    reset();
    useStore.getState().hydrateSettings({ blocMinPaymentSource: 'income', blocStatementMinimum: 200 });
    expect(useStore.getState().blocMinPaymentSource).toBe('income');
    expect(useStore.getState().blocStatementMinimum).toBe(200);
  });

  it('a remote event lacking the fields does not clobber local values (whitelist skips absent)', () => {
    useStore.getState().setBlocMinPaymentSource('income');
    useStore.getState().setBlocStatementMinimum(90);
    useStore.getState().hydrateSettings({ income: 5000 });   // no min-payment fields
    expect(useStore.getState().blocMinPaymentSource).toBe('income');
    expect(useStore.getState().blocStatementMinimum).toBe(90);
  });
});

// Logging Consolidation §2b — blocMinPaymentDueDay setting.
describe('blocMinPaymentDueDay — synced setting', () => {
  afterEach(() => useStore.setState({ blocMinPaymentDueDay: 15 }));
  it('defaults to 15, clamps to 1–28, and rides the payload', () => {
    expect(useStore.getState().blocMinPaymentDueDay).toBe(15);
    useStore.getState().setBlocMinPaymentDueDay(31);
    expect(useStore.getState().blocMinPaymentDueDay).toBe(28);   // clamped
    useStore.getState().setBlocMinPaymentDueDay(0);
    expect(useStore.getState().blocMinPaymentDueDay).toBe(1);    // clamped
    useStore.getState().setBlocMinPaymentDueDay(10);
    expect(buildSettingsPayload(useStore.getState()).blocMinPaymentDueDay).toBe(10);
  });
});

// Logging Consolidation §2 + §4 — confirmMonth(extras) is one atomic write; unconfirmMonth reopens.
describe('confirmMonth(extras) / unconfirmMonth', () => {
  const seed = (over: Partial<import('../../simulation/types').MonthlyLogEntry> = {}) =>
    useStore.setState({
      advisorStartDate: '2025-01-01',
      monthlyLog: [{
        month: 1, date: '2025-01-01', btcBought: 0.01, income: 1000, paydown: 0,
        strikeBal: 5000, strikeLtv: 0.1, loggedAt: 1, btcHeld: 1, expensesActual: 2000,
        source: 'daily', confirmed: false, ...over,
      }],
      deletedMonths: {},
    });
  afterEach(() => useStore.setState({ monthlyLog: [], deletedMonths: {} }));

  it('confirmMonth folds extras + confirmed:true in ONE upsert, source stays daily', () => {
    seed();
    useStore.getState().confirmMonth(1, { expensesActual: 2222, strikeMinPaid: 120, strikeMinSource: 'income' });
    const e = useStore.getState().monthlyLog.find((m) => m.month === 1)!;
    expect(e.confirmed).toBe(true);
    expect(e.expensesActual).toBe(2222);
    expect(e.strikeMinPaid).toBe(120);
    expect(e.strikeMinSource).toBe('income');
    expect(e.source).toBe('daily');   // M2 guard passes (spread preserves source)
  });

  it('unconfirmMonth flips confirmed→false, entry preserved, no tombstone', () => {
    seed({ confirmed: true });
    useStore.getState().unconfirmMonth(1);
    const e = useStore.getState().monthlyLog.find((m) => m.month === 1)!;
    expect(e.confirmed).toBe(false);
    expect(e.strikeBal).toBe(5000);                       // rollup preserved
    expect(useStore.getState().deletedMonths[1]).toBeUndefined();   // never tombstoned
  });
});
