import { describe, it, expect } from 'vitest';
import { migrateState } from '../persistConfig';

// store.md: a migrate step fills only what is ABSENT (`?? default`, "only where undefined") and never overwrites a
// stored value — so a later store-version bump changes nothing the owner has. Every blob below ALREADY carries the field.
// (Synthetic round numbers. The v21 viewer-roster wipe is NOT pinned here: audit A5-2.)

function blob(): any {
  return {
    advisorActualBtcHeld: 1.0,
    expenses: 3500,
    hasCbLoan: true,
    cbCollateralBtc: 1.48,
    strikeCollateralBtc: 0.8,
    monthlyLog: [{
      month: 1, date: '2026-01-01', btcBought: 0.1, income: 0, paydown: 0, strikeBal: 0, strikeLtv: 0, loggedAt: 1,
      btcHeld: 0.62, expensesActual: 2500, source: 'daily', confirmed: false,
    }],
    dayLog: [{ id: 'd1', date: '2026-01-05', ts: 5, kind: 'draw', amount: 1000 }],
  };
}

describe('persistConfig migrateState — a migrate fills only what is absent', () => {
  it('HJ-08 · store.md Zustand v11 migration — a recorded btcHeld survives a later migration', () => {
    expect(migrateState(blob()).monthlyLog[0].btcHeld).toBe(0.62);
  });

  it('HJ-09 · store.md Zustand v11 migration — a recorded expensesActual survives a later migration', () => {
    expect(migrateState(blob()).monthlyLog[0].expensesActual).toBe(2500);
  });

  it('HJ-10 · store.md Zustand v19 migration — confirmed backfills only where undefined: an open month stays unconfirmed', () => {
    expect(migrateState(blob()).monthlyLog[0].confirmed).toBe(false);
  });

  it("HJ-11 · store.md Zustand v19 migration — source backfills only where undefined: a daily-owned month keeps 'daily'", () => {
    expect(migrateState(blob()).monthlyLog[0].source).toBe('daily');
  });

  it('HJ-12 · store.md Zustand v19 migration — the C2 cbCollateralReading seed goes only into an EMPTY journal', () => {
    expect(migrateState(blob()).dayLog.map((e: any) => e.kind)).toEqual(['draw']);
    // and the seed itself still happens for an empty journal
    const empty = blob(); empty.dayLog = [];
    const out = migrateState(empty).dayLog;
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('cbCollateralReading');
    expect(out[0].cbCollateral).toBe(1.48);
  });

  it('HJ-13 · store.md Zustand v20 migration — a stored strikeCollateralBtc cache is kept, not re-seeded from the log', () => {
    expect(migrateState(blob()).strikeCollateralBtc).toBe(0.8);
  });

  it('HY-17 · store.md Zustand v7 migration — the default fills only an absent cbLtvTriggerPct', () => {
    expect(migrateState({ monthlyLog: [], cbLtvTriggerPct: 80 }).cbLtvTriggerPct).toBe(80);
    expect(migrateState({ monthlyLog: [] }).cbLtvTriggerPct).toBe(75);
  });

  it('HY-18 · store.md Zustand v8 migration — a stored btcPriceMode survives', () => {
    expect(migrateState({ monthlyLog: [], btcPriceMode: 'manual' }).btcPriceMode).toBe('manual');
    expect(migrateState({ monthlyLog: [] }).btcPriceMode).toBe('live');
  });

  it('HY-19 · store.md Zustand v10 migration — a stored nostrLogin survives', () => {
    expect(migrateState({ monthlyLog: [], nostrLogin: 'bunker://x' }).nostrLogin).toBe('bunker://x');
  });

  it('HY-20 · store.md Zustand v13 migration — a stored cbLoanBalanceAsOf survives', () => {
    expect(migrateState({ monthlyLog: [], cbLoanBalanceAsOf: '2026-01-01' }).cbLoanBalanceAsOf).toBe('2026-01-01');
  });

  it('HK-13 · store.md Zustand v17 migration — viewerMode default is `?? false`: a stored true is carried through', () => {
    expect(migrateState({ monthlyLog: [], viewerMode: true }).viewerMode).toBe(true);
    expect(migrateState({ monthlyLog: [] }).viewerMode).toBe(false);
  });

  it('HK-14 · store.md Zustand v18 migration — LEAVES an existing plaintext viewerSecretKey in place', () => {
    const key = 'aa'.repeat(32);
    expect(migrateState({ monthlyLog: [], viewerSecretKey: key }).viewerSecretKey).toBe(key);
  });
});
