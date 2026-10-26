import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  deriveSafetyView, computeViewerSafety, scaleSafetyView,
  type SafetyViewInputs, type SafeSnapshot,
} from '../safetyView';

const SV: SafetyViewInputs = {
  advisorActualBlocBalance: 50_000, creditLine: 100_000, currentBtcHeld: 1, btcPrice: 100_000,
  strikeLiquidationLtvPct: 85, hasCbLoan: true, cbLoanBalance: 100_000, cbAprPct: 10,
  cbLoanBalanceAsOf: '2026-01-01', cbCollateralBtc: 2, cbLtvTriggerPct: 70,
  cbLiquidationPrice: 50_000, cbLiquidationPriceAsOf: null,
};

const SNAP: SafeSnapshot = {
  safety: { capacityUsed: 0.5, strikeLtv: 0.70, cbLtv: 0.80, cbLtvAtSupport: null, cbAtSupportLevel: 'safe' } as SafeSnapshot['safety'],
  thresholds: { strikeLiqLtv: 0.85, cbLtvTriggerPct: 70, cbLiqFrac: 1.0 },
  btcPriceAtSnapshot: 100_000,
  hasCbLoan: true,
};

function clock() { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T12:00:00Z')); }
afterEach(() => { vi.useRealTimers(); });

describe('safetyView hardening', () => {
  it('HS-04 · cbMetrics.ts — an entered liquidation price with a null as-of is left alone (never aged from the balance date)', () => {
    clock();
    expect(deriveSafetyView(SV).cbLiqPrice).toBe(50_000);
  });

  it('HS-05 · Viewer V2 — the trusted viewer\'s Coinbase balance is the owner\'s accrued balance', () => {
    clock();
    const days = (Date.parse('2026-10-26T12:00:00Z') - Date.parse('2026-01-01')) / 86_400_000;
    const accrued = 100_000 * Math.pow(1 + 10 / 100 / 365, days);
    const bal = computeViewerSafety(null, 0, SV).figures!.cb.balance;
    expect(bal).toBeGreaterThan(100_000);
    expect(bal).toBeCloseTo(accrued, 6);
    expect(bal).toBe(deriveSafetyView(SV).accruedBalance);
  });

  it('HS-06 · Viewer V2 — the trusted Strike liq price is bloc / (btcHeld × liq LTV as a fraction)', () => {
    clock();
    expect(computeViewerSafety(null, 0, SV).figures!.strike.liqPrice).toBe(50_000 / (1 * 0.85));
  });

  it('HS-07 · Viewer V2 — the trusted drop% floors at 0 past the liquidation LTV', () => {
    clock();
    // Strike LTV 100_000 / (1 × 100_000) = 1.0 > 0.85
    expect(computeViewerSafety(null, 0, { ...SV, advisorActualBlocBalance: 100_000 }).strikeDropPct).toBe(0);
  });

  it('HS-08 · Viewer V2 — the safe viewer\'s Strike level bands at 0.76/0.82 × the liquidation LTV, as the owner\'s', () => {
    // 0.70 >= 0.85 × 0.82 = 0.697 → act (the credit thresholds 0.75/0.90 would say safe)
    expect(scaleSafetyView(SNAP, 100_000).strikeLevel).toBe('act');
  });

  it('HS-09 · Viewer V2 — scaleSafetyView: a snapshot with no price keeps factor 1 (the at-snapshot levels)', () => {
    const v = scaleSafetyView({ ...SNAP, btcPriceAtSnapshot: 0 }, 100_000);
    expect(v.strikeLtv).toBe(0.70);
    expect(v.cbLtv).toBe(0.80);
    expect(v.strikeLevel).toBe('act');
  });

  it('HS-10 · cbMetrics.ts — Safety\'s CB bar reds at the entered liq price\'s fraction × 0.93, not Morpho\'s 86%', () => {
    clock();
    // debt 100_000 / (2 BTC × 60_000) = 0.8333; entered liq price 50_000 → cbLiqFrac 100_000 / (2 × 50_000) = 1
    const v = deriveSafetyView({ ...SV, btcPrice: 60_000, cbLoanBalanceAsOf: null });
    expect(v.cbLiqFrac).toBe(1);
    expect(v.cbLevel).toBe('watch'); // 0.833 < 1.0 × 0.93, >= 0.70
  });

  it('HS-11 · Viewer V2 — the safe viewer\'s CB level bands at the sealed cbLiqFrac × 0.93', () => {
    const snap = { ...SNAP, safety: { ...SNAP.safety, strikeLtv: 0.5 } };
    expect(scaleSafetyView(snap, 100_000).cbLevel).toBe('watch'); // 0.80 < 1.0 × 0.93, >= 0.70
  });
});
