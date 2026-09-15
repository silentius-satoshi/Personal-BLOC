import { describe, it, expect } from 'vitest';
import { classifyPaydownState, paydownReadout, deriveForMonth, displaySettledLtv, isLtvFigureStressed } from '../simpleModePlan';
import { runAdvisor, type AdvisorInputs } from '../runAdvisor';

// ⚠ SYNTHETIC round figures — this repo is public; never a real position.
const C = 0.15;

// $100k BTC, 1 ₿ collateral, $15k Strike balance, $4k expenses — the spec's headline fixture. Income varies per state.
const BASE: AdvisorInputs = {
  btcPrice: 100000, income: 6000, expenses: 4000, blocApr: 13, creditLine: 100000, blocLtvCeiling: C,
  cbBalance: 0, cbCollateralBtc: 0, cbAprPct: 0, cbMonthlyPayment: 0, cbPaymentStrategy: 'monthly',
  cbLtvTriggerPct: 75, cbLtvTargetPct: 65, cbRotateBackPct: 55,
  startingBlocBalance: 15000, startingBtcHeld: 1, startingMonth: 1, btcGrowthRate: 0,
};
const stateOf = (inp: AdvisorInputs) =>
  runAdvisor(inp).rows.map((r) => classifyPaydownState(r.blocLtvPeak, r.blocPaydown, r.blocLtv, C));

describe('classifyPaydownState — four states, each reachable through the real engine', () => {
  it('quiet — no paydown, peak never crossed', () => {
    expect(classifyPaydownState(0.128, 0, 0.128, C)).toBe('quiet');
    expect(stateOf({ ...BASE, startingBlocBalance: 0, expenses: 1000 })[0]).toBe('quiet');
  });

  it('defended — a paydown settled the LTV at or below the ceiling (routine: the headline fixture, every month)', () => {
    expect(classifyPaydownState(0.189, 3900, 0.147, C)).toBe('defended');
    expect(stateOf(BASE).every((s) => s === 'defended')).toBe(true);
  });

  it('⭐ partial — a paydown fired but the income ran out, and the LTV SETTLED ABOVE the ceiling', () => {
    // Collapse partial into defended and this goes red — the state most likely to be "simplified" away.
    expect(classifyPaydownState(0.239, 500, 0.18, C)).toBe('partial');
    const row = runAdvisor({ ...BASE, income: 500 }).rows[0];
    expect(row.blocPaydown).toBe(500);   // the WHOLE income budget
    expect(classifyPaydownState(row.blocLtvPeak, row.blocPaydown, row.blocLtv, C)).toBe('partial');
  });

  it('⭐ undefended — above the ceiling with NO paydown (no income left to fund one)', () => {
    // Drop the undefended branch and this reads "quiet" → red.
    expect(classifyPaydownState(0.192, 0, 0.192, C)).toBe('undefended');
    expect(stateOf({ ...BASE, income: 0 }).every((s) => s === 'undefended')).toBe(true);
  });

  it('a paydown sized exactly to the gap lands ON the ceiling as a float — that is defended, not partial', () => {
    expect(classifyPaydownState(0.2, 1000, C + 1e-12, C)).toBe('defended');
    expect(classifyPaydownState(0.2, 1000, C + 1e-6, C)).toBe('partial');
    expect(classifyPaydownState(C, 0, C, C)).toBe('quiet');
  });
});

describe('paydownReadout — one source for the header', () => {
  const plan = { paydown: 3900, blocLtv: 0.147, blocLtvPeak: 0.189 };

  it('⭐ a CLOSED logged month reports the ledger — even when it logged no paydown and the plan projected one', () => {
    // The reported bug: a real 12.8% reading wearing the plan's projected paydown flag. Swap the order and this is red.
    expect(paydownReadout(plan, { paydown: 0, strikeLtv: 0.128 }, false, C))
      .toEqual({ mode: 'actual', ltv: 0.128, peakLtv: 0, paydown: 0, paydownDone: 0, state: null });
  });

  it('a logged month with a real paydown reports the ledger\'s amount', () => {
    expect(paydownReadout(plan, { paydown: 1200, strikeLtv: 0.13 }, false, C)).toMatchObject({ mode: 'actual', paydown: 1200 });
  });

  it('⭐ the CURRENT month in progress keeps the PLANNED paydown as the instruction, with the ledger\'s progress', () => {
    // The owner journals daily, so the current month has an entry from its first event. Drop the in-progress branch
    // and the plan's paydown vanishes from his primary screen for the whole month → red.
    expect(paydownReadout(plan, { paydown: 1000, strikeLtv: 0.128 }, true, C))
      .toEqual({ mode: 'inProgress', ltv: 0.128, peakLtv: 0.189, paydown: 3900, paydownDone: 1000, state: 'defended' });
  });

  it('no entry → the plan, with its peak and state', () => {
    expect(paydownReadout(plan, null, false, C))
      .toEqual({ mode: 'projected', ltv: 0.147, peakLtv: 0.189, paydown: 3900, paydownDone: 0, state: 'defended' });
  });

  it('neither → all zeros, no throw', () => {
    expect(paydownReadout(null, null, true, C))
      .toEqual({ mode: 'none', ltv: 0, peakLtv: 0, paydown: 0, paydownDone: 0, state: null });
  });
});

describe('deriveForMonth reads the engine\'s paydown', () => {
  it('⭐ paydown === row.blocPaydown and the allocation still sums to income, across a sweep', () => {
    const bad: string[] = [];
    for (const hasCbLoan of [false, true])
    for (const cbPaymentStrategy of ['monthly', 'ltvTriggered'] as const)
    for (const blocMinPaymentSource of ['roll', 'income'] as const)
    for (const income of [500, 6000])
    for (const expenses of [1000, 8000])
    for (const startingBlocBalance of [0, 15000, 60000])
    for (const btcGrowthRate of [-0.5, 0.5]) {
      // Mirror the app's coupling: no CB loan ⇒ no CB balance/collateral/payment reaches the engine.
      const inp: AdvisorInputs = {
        ...BASE, cbPaymentStrategy, blocMinPaymentSource, income, expenses, startingBlocBalance, btcGrowthRate,
        cbBalance: hasCbLoan ? 30000 : 0, cbCollateralBtc: hasCbLoan ? 1 : 0, cbMonthlyPayment: hasCbLoan ? 500 : 0,
      };
      for (const row of runAdvisor(inp).rows) {
        const p = deriveForMonth(row, income, hasCbLoan, cbPaymentStrategy);
        if (p.paydown !== row.blocPaydown || Math.abs(p.allocatedFromIncome - income) >= 1 || !p.isFullyAllocated) {
          bad.push(`${hasCbLoan}/${cbPaymentStrategy}/${blocMinPaymentSource}/${income}/${expenses}/${startingBlocBalance} m${row.month}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('⭐ the decoupled case: a row carrying a CB payment met with hasCbLoan:false must not INVENT a paydown', () => {
    // Unreachable through the app today (hasCbLoan gates every CB input), and this test exists to keep it harmless.
    // It is the ONLY test that can tell the old income-residual from the engine's figure: restore the residual and it
    // reports 6000 − 1000 = 5000 of paydown the engine never made → red.
    const row = { ...runAdvisor(BASE).rows[0], cbPayment: 2000, blocPaydown: 0, incomeToBtc: 1000, blocMinPayment: 0 };
    expect(deriveForMonth(row, 6000, false, 'monthly').paydown).toBe(0);
  });
});

describe('noCollateral — the fifth state (the draw landed with nothing behind it)', () => {
  // A2 fixture — month 1 of a fresh install (synthetic): $100k BTC, 13% APR, roll, balance $0, Strike collateral 0,
  // $4k expenses, $6k income.
  const FRESH: AdvisorInputs = { ...BASE, startingBlocBalance: 0, startingBtcHeld: 0, income: 6000, expenses: 4000 };
  const stateOfRow = (r: ReturnType<typeof runAdvisor>['rows'][number]) =>
    classifyPaydownState(r.blocLtvPeak, r.blocPaydown, r.blocLtv, C);

  it('⭐ the guard runs FIRST — a paydown against zero collateral is noCollateral, not defended', () => {
    // Mutation: move the !isFinite(peak) guard below `paydown > 0` → 'defended' → red.
    expect(classifyPaydownState(Infinity, 6000, 0, C)).toBe('noCollateral');
  });

  it('⭐ A2 through the real engine: month 1 draws unbacked and pays the balance OFF; month 2 is routine', () => {
    const rows = runAdvisor(FRESH).rows;
    expect(stateOfRow(rows[0])).toBe('noCollateral');
    expect(rows[0].blocPaydown).toBeCloseTo(4043.33, 1);
    expect(rows[0].btcHeld).toBeCloseTo(0.0196, 3);
    expect(displaySettledLtv(rows[0])).toBe(0);   // paid off — 0 is TRUE here, not the "0 reads as safe" lie
    expect(stateOfRow(rows[1])).toBe('defended');
    expect(rows[1].blocBalance).toBeCloseTo(293.5, 0);
  });

  it('⭐ the stuck case through the engine: debt remains with no collateral → displaySettledLtv is ∞', () => {
    // Mutation: make displaySettledLtv return row.blocLtv → the pre-existing 0 → red.
    const row = runAdvisor({ ...FRESH, startingBlocBalance: 20000 }).rows[0];
    expect(stateOfRow(row)).toBe('noCollateral');
    expect(row.blocBalance).toBeGreaterThan(0);
    expect(row.blocLtv).toBe(0);                    // the engine value stays put (DO NOT TOUCH)
    expect(displaySettledLtv(row)).toBe(Infinity);  // the display value tells the truth
  });

  it('peak === 0 stays quiet — no debt and no collateral is not the alarm', () => {
    expect(classifyPaydownState(0, 0, 0, C)).toBe('quiet');
  });

  it('isLtvFigureStressed — one figure on its own merits; the ceiling itself is not a breach', () => {
    expect(isLtvFigureStressed(Infinity, C)).toBe(true);
    expect(isLtvFigureStressed(0.30, C)).toBe(true);
    expect(isLtvFigureStressed(0.15, C)).toBe(false);
    expect(isLtvFigureStressed(0.128, C)).toBe(false);
    expect(isLtvFigureStressed(0, C)).toBe(false);
  });

  it('displaySettledLtv on a collateralised row is just blocLtv', () => {
    const row = runAdvisor(BASE).rows[0];
    expect(displaySettledLtv(row)).toBe(row.blocLtv);
  });
});
