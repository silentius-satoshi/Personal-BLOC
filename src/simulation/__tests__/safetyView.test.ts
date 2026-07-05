import { describe, it, expect } from 'vitest';
import {
  deriveSafetyView,
  deriveViewerOverall,
  selectSafetyViewInputs,
  buildSafeSafety,
  scaleSafetyView,
  computeViewerSafety,
  CREDIT_WARN_USED,
  CREDIT_ACT_USED,
  type SafetyViewInputs,
  type SafeSnapshot,
} from '../safetyView';
import { cbMetrics, accruedCbBalance } from '../cbMetrics';
import { strikeAvailableCredit } from '../strikeCredit';
import { CB_LLTV } from '../runCoinbaseLoan';
import type { StoreState } from '../../store/useStore';

// Base: no CB loan, healthy Strike. strikeLiquidationLtvPct 85 → warn 0.646, act 0.697.
// asOf null keeps CB accrual deterministic (no Date.now dependence).
const base: SafetyViewInputs = {
  advisorActualBlocBalance: 0,
  creditLine: 10_000,
  currentBtcHeld: 1,
  btcPrice: 100_000,
  strikeLiquidationLtvPct: 85,
  hasCbLoan: false,
  cbLoanBalance: 0,
  cbAprPct: 5,
  cbLoanBalanceAsOf: null,
  cbCollateralBtc: 0,
  cbLtvTriggerPct: 75,
  cbLiquidationPrice: 0,
};

describe('deriveSafetyView — credit (capacity) bands', () => {
  it('green below 75% used', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 7_000 });
    expect(v.capacityUsed).toBeCloseTo(0.7);
    expect(v.creditLevel).toBe('safe');
  });
  it('amber at 75-90% used', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 8_000 });
    expect(v.creditLevel).toBe('watch');
  });
  it('red at/above 90% used', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 9_500 });
    expect(v.creditLevel).toBe('act');
  });
  it('exactly at the band edges classifies up', () => {
    expect(deriveSafetyView({ ...base, advisorActualBlocBalance: CREDIT_WARN_USED * 10_000 }).creditLevel).toBe('watch');
    expect(deriveSafetyView({ ...base, advisorActualBlocBalance: CREDIT_ACT_USED * 10_000 }).creditLevel).toBe('act');
  });
  it('creditLine 0 → capacityUsed 0, safe (guard)', () => {
    const v = deriveSafetyView({ ...base, creditLine: 0, advisorActualBlocBalance: 5_000 });
    expect(v.capacityUsed).toBe(0);
    expect(v.creditLevel).toBe('safe');
  });
});

describe('deriveSafetyView — Strike LTV bands (warn 0.646 / act 0.697 at 85% liq)', () => {
  it('safe', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 50_000 }); // 50000/100000 = 0.5
    expect(v.strikeLtv).toBeCloseTo(0.5);
    expect(v.strikeLevel).toBe('safe');
  });
  it('watch', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 66_000 }); // 0.66
    expect(v.strikeLevel).toBe('watch');
  });
  it('act', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 71_000 }); // 0.71
    expect(v.strikeLevel).toBe('act');
  });
  it('crashLtv = LTV at 20% of price (80% drop)', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 10_000 }); // 10000/(1*20000) = 0.5
    expect(v.crashLtv).toBeCloseTo(0.5);
  });
  it('zero collateral value → LTV 0 (guard)', () => {
    const v = deriveSafetyView({ ...base, currentBtcHeld: 0, advisorActualBlocBalance: 10_000 });
    expect(v.strikeLtv).toBe(0);
  });
});

describe('deriveSafetyView — Coinbase LTV gating', () => {
  it('no CB loan → cbLtv 0, cbLevel safe', () => {
    const v = deriveSafetyView({ ...base, hasCbLoan: false, cbLoanBalance: 999_999, cbCollateralBtc: 1 });
    expect(v.cbLtv).toBe(0);
    expect(v.cbLevel).toBe('safe');
  });
  it('CB loan, collateral 2 @ 100k: 0.5 → safe', () => {
    const v = deriveSafetyView({ ...base, hasCbLoan: true, cbCollateralBtc: 2, cbLoanBalance: 100_000 });
    expect(v.cbLtv).toBeCloseTo(0.5);
    expect(v.cbLevel).toBe('safe');
  });
  it('0.76 → watch (>= trigger 0.75, < act ~0.80)', () => {
    const v = deriveSafetyView({ ...base, hasCbLoan: true, cbCollateralBtc: 2, cbLoanBalance: 152_000 });
    expect(v.cbLtv).toBeCloseTo(0.76);
    expect(v.cbLevel).toBe('watch');
  });
  it('0.85 → act', () => {
    const v = deriveSafetyView({ ...base, hasCbLoan: true, cbCollateralBtc: 2, cbLoanBalance: 170_000 });
    expect(v.cbLevel).toBe('act');
  });
  it('cbCollateralBtc 0 → cbLtv 0 (guard, no divide-by-zero)', () => {
    const v = deriveSafetyView({ ...base, hasCbLoan: true, cbCollateralBtc: 0, cbLoanBalance: 100_000 });
    expect(v.cbLtv).toBe(0);
    expect(v.cbLevel).toBe('safe');
  });
});

describe('deriveSafetyView — CB display intermediates (accruedBalance / cbLiqPrice / cbLiqFrac)', () => {
  it('!hasCbLoan → defaults (0 / 0 / CB_LLTV)', () => {
    const v = deriveSafetyView({ ...base, hasCbLoan: false, cbCollateralBtc: 2, cbLoanBalance: 100_000 });
    expect(v.accruedBalance).toBe(0);
    expect(v.cbLiqPrice).toBe(0);
    expect(v.cbLiqFrac).toBe(CB_LLTV);
  });
  it('hasCbLoan, no entered liq price → accruedBalance = accruedCbBalance, cbLiqPrice = m.liqPrice, cbLiqFrac = CB_LLTV', () => {
    const cbInputs = { ...base, hasCbLoan: true, cbCollateralBtc: 2, cbLoanBalance: 100_000, cbAprPct: 5, cbLoanBalanceAsOf: null, cbLiquidationPrice: 0 };
    const v = deriveSafetyView(cbInputs);
    const accrued = accruedCbBalance(cbInputs.cbLoanBalance, cbInputs.cbAprPct, cbInputs.cbLoanBalanceAsOf);
    const m = cbMetrics(accrued, cbInputs.cbCollateralBtc, cbInputs.btcPrice, cbInputs.cbLtvTriggerPct);
    expect(v.accruedBalance).toBeCloseTo(accrued);        // asOf null → unchanged 100_000
    expect(v.cbLiqPrice).toBeCloseTo(m.liqPrice);         // computed fallback
    expect(v.cbLiqFrac).toBeCloseTo(CB_LLTV);             // no-entered-price case resolves to exactly CB_LLTV
  });
  it('hasCbLoan, entered liq price wins and moves cbLiqFrac', () => {
    const v = deriveSafetyView({ ...base, hasCbLoan: true, cbCollateralBtc: 2, cbLoanBalance: 100_000, cbLoanBalanceAsOf: null, cbLiquidationPrice: 50_000 });
    expect(v.cbLiqPrice).toBe(50_000);
    expect(v.cbLiqFrac).toBeCloseTo(100_000 / (2 * 50_000)); // 1.0 — authoritative price drives the denominator
  });
});

describe('selectSafetyViewInputs — the single store→inputs mapping', () => {
  it('maps the 12 store fields (getCurrentBtcHeld invoked)', () => {
    const fake = {
      advisorActualBlocBalance: 5_000,
      creditLine: 10_000,
      getCurrentBtcHeld: () => 1.5,
      btcPrice: 100_000,
      strikeLiquidationLtvPct: 85,
      hasCbLoan: true,
      cbLoanBalance: 60_000,
      cbAprPct: 4.77,
      cbLoanBalanceAsOf: '2026-01-01',
      cbCollateralBtc: 1.48,
      cbLtvTriggerPct: 75,
      cbLiquidationPrice: 42_000,
    } as unknown as StoreState;
    expect(selectSafetyViewInputs(fake)).toEqual({
      advisorActualBlocBalance: 5_000,
      creditLine: 10_000,
      currentBtcHeld: 1.5,
      btcPrice: 100_000,
      strikeLiquidationLtvPct: 85,
      hasCbLoan: true,
      cbLoanBalance: 60_000,
      cbAprPct: 4.77,
      cbLoanBalanceAsOf: '2026-01-01',
      cbCollateralBtc: 1.48,
      cbLtvTriggerPct: 75,
      cbLiquidationPrice: 42_000,
    });
  });
});

describe('deriveViewerOverall — worst of the gauges shown (credit included)', () => {
  it('all safe → safe', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 5_000 });
    expect(deriveViewerOverall(v, false)).toBe('safe');
  });
  it('red credit alone drives overall to act (credit IS included)', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 9_800 }); // 0.98 used → act credit, safe strike
    expect(v.creditLevel).toBe('act');
    expect(v.strikeLevel).toBe('safe');
    expect(deriveViewerOverall(v, false)).toBe('act');
  });
  it('CB level ignored when !hasCbLoan even if cb inputs present', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 5_000, cbCollateralBtc: 2, cbLoanBalance: 170_000 });
    expect(deriveViewerOverall(v, false)).toBe('safe');
  });
  it('CB act folds into overall when hasCbLoan', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 5_000, hasCbLoan: true, cbCollateralBtc: 2, cbLoanBalance: 170_000 });
    expect(deriveViewerOverall(v, true)).toBe('act');
  });
});

describe('Viewer V2 — buildSafeSafety (ratio/level-only projection, drops the $ absolutes)', () => {
  it('drops accruedBalance + cbLiqPrice; keeps ratios/levels + overall', () => {
    const view = deriveSafetyView({ ...base, hasCbLoan: true, cbCollateralBtc: 2, cbLoanBalance: 100_000 });
    const safe = buildSafeSafety(view, true);
    expect('accruedBalance' in safe).toBe(false);   // $ absolute — must NOT leak
    expect('cbLiqPrice' in safe).toBe(false);        // $ absolute — must NOT leak
    expect(safe.cbLiqFrac).toBeCloseTo(view.cbLiqFrac);   // ratio — kept
    expect(safe.strikeLtv).toBeCloseTo(view.strikeLtv);
    expect(safe.overall).toBe(deriveViewerOverall(view, true));
  });
});

describe('Viewer V2 — scaleSafetyView (live price-scaling; exact between publishes)', () => {
  // snapshot @ $100k: strikeLtv 0.50, cbLtv 0.50, capacity 0.70. strikeLiqLtv 0.85.
  const snap: SafeSnapshot = {
    safety: {
      capacityUsed: 0.70, creditLevel: 'safe',
      strikeLtv: 0.50, strikeLevel: 'safe', crashLtv: 2.5,
      cbLtv: 0.50, cbLevel: 'safe', cbLiqFrac: CB_LLTV,
      overall: 'safe',
    },
    thresholds: { strikeLiqLtv: 0.85, cbLtvTriggerPct: 75, cbLiqFrac: CB_LLTV },
    btcPriceAtSnapshot: 100_000,
    hasCbLoan: true,
  };

  it('price unchanged → factor 1 → identity on the LTVs', () => {
    const v = scaleSafetyView(snap, 100_000);
    expect(v.strikeLtv).toBeCloseTo(0.50);
    expect(v.cbLtv).toBeCloseTo(0.50);
    expect(v.capacityUsed).toBe(0.70);          // price-free
    expect(v.crashLtv).toBeCloseTo(2.5);        // strikeLtv' × 5
  });

  it('price HALVED → LTVs double (LTV ∝ 1/price); levels re-classify', () => {
    const v = scaleSafetyView(snap, 50_000);    // f = 100k/50k = 2
    expect(v.strikeLtv).toBeCloseTo(1.0);
    expect(v.cbLtv).toBeCloseTo(1.0);
    expect(v.capacityUsed).toBe(0.70);          // unchanged
    expect(v.strikeLevel).toBe('act');          // 1.0 >> 0.85×0.82
    expect(v.cbLevel).toBe('act');
    expect(v.overall).toBe('act');
  });

  it('price UP → LTVs shrink, strikeDropPct grows', () => {
    const v = scaleSafetyView(snap, 200_000);   // f = 0.5
    expect(v.strikeLtv).toBeCloseTo(0.25);
    expect(v.strikeDropPct).toBeCloseTo(1 - 0.25 / 0.85);   // ~0.706
  });

  it('livePrice 0 (offline / feed down) → factor 1 fallback = the at-snapshot levels', () => {
    const v = scaleSafetyView(snap, 0);
    expect(v.strikeLtv).toBeCloseTo(0.50);
    expect(v.cbLtv).toBeCloseTo(0.50);
    expect(v.strikeLevel).toBe('safe');
  });

  it('!hasCbLoan → cbLevel forced safe regardless of scaled cbLtv', () => {
    const v = scaleSafetyView({ ...snap, hasCbLoan: false }, 50_000);
    expect(v.cbLevel).toBe('safe');
  });
});

// Owner "Preview as viewer" — the pure seam ViewerHomeView's useViewerSafety delegates to. A SafeSnapshot
// forces the C-safe scaled path (figures null); null forces the C-trusted live-derive (real figures).
describe('computeViewerSafety (viewer render seam)', () => {
  const snap: SafeSnapshot = {
    safety: buildSafeSafety(deriveSafetyView({ ...base, advisorActualBlocBalance: 5_000 }), false),
    thresholds: { strikeLiqLtv: 0.85, cbLtvTriggerPct: 75, cbLiqFrac: 0.86 },
    btcPriceAtSnapshot: 100_000,
    hasCbLoan: false,
  };

  it('injected SafeSnapshot → mode safe, figures null, values == scaleSafetyView', () => {
    const r = computeViewerSafety(snap, 90_000, base);
    const scaled = scaleSafetyView(snap, 90_000);
    expect(r.mode).toBe('safe');
    expect(r.figures).toBeNull();
    expect(r.strikeLtv).toBeCloseTo(scaled.strikeLtv);
    expect(r.cbLtv).toBeCloseTo(scaled.cbLtv);
    expect(r.overall).toBe(scaled.overall);
    expect(r.strikeDropPct).toBeCloseTo(scaled.strikeDropPct);
    expect(r.hasCbLoan).toBe(false);   // from the snap, not the inputs
  });

  it('null snap → mode trusted, live-derive from inputs (figures populated)', () => {
    const inputs = { ...base, advisorActualBlocBalance: 5_000 };
    const r = computeViewerSafety(null, 100_000, inputs);
    const view = deriveSafetyView(inputs);
    expect(r.mode).toBe('trusted');
    expect(r.figures).not.toBeNull();
    expect(r.strikeLtv).toBeCloseTo(view.strikeLtv);
    expect(r.overall).toBe(deriveViewerOverall(view, inputs.hasCbLoan));
    expect(r.figures!.credit.used).toBe(5_000);
    expect(r.figures!.credit.total).toBe(inputs.creditLine);
    expect(r.figures!.credit.avail).toBe(inputs.creditLine - 5_000);
  });

  // Decision A — figures.credit uses the LTV-capped truth (strikeAvailableCredit), NOT naive creditLine − drawn.
  it('LTV-bound fixture (collateral cap < creditLine): total = binding limit, not the credit line', () => {
    const inputs = { ...base, creditLine: 100_000, advisorActualBlocBalance: 5_000 }; // ltvCap = 1×100k×0.5 = 50k < 100k
    const r = computeViewerSafety(null, 100_000, inputs);
    const cap = strikeAvailableCredit(inputs.creditLine, inputs.currentBtcHeld, inputs.btcPrice, inputs.advisorActualBlocBalance);
    expect(cap.limit).toBe(50_000);           // collateral-bound, below the 100k line
    expect(r.figures!.credit.used).toBe(5_000);
    expect(r.figures!.credit.total).toBe(cap.limit);        // 50_000, NOT creditLine 100_000
    expect(r.figures!.credit.total).toBe(50_000);
    expect(r.figures!.credit.avail).toBe(cap.available);    // 45_000
    expect(r.figures!.credit.avail).toBe(45_000);
  });

  it('line-bound fixture (cap > line): total = creditLine', () => {
    const inputs = { ...base, advisorActualBlocBalance: 5_000 }; // ltvCap 50k > line 10k → limit = line
    const r = computeViewerSafety(null, 100_000, inputs);
    const cap = strikeAvailableCredit(inputs.creditLine, inputs.currentBtcHeld, inputs.btcPrice, inputs.advisorActualBlocBalance);
    expect(cap.limit).toBe(inputs.creditLine);   // 10_000 — line-bound
    expect(r.figures!.credit.used).toBe(5_000);
    expect(r.figures!.credit.total).toBe(cap.limit);       // === creditLine
    expect(r.figures!.credit.avail).toBe(cap.available);   // 5_000
    expect(r.figures!.credit.avail).toBe(5_000);
  });
});
