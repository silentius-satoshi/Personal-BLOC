import { describe, it, expect } from 'vitest';
import { runAdvisor, type AdvisorInputs } from '../runAdvisor';
import { runBLOC } from '../runBLOC';
import { classifyPaydownState, isLtvFigureStressed, displaySettledLtv } from '../simpleModePlan';

// ⚠ SYNTHETIC round figures — this repo is public; never a real position.
const CEILING = 0.15;
const EPS = 1e-9;

const ADVISOR_BASE = {
  blocApr: 13, creditLine: 100000, blocLtvCeiling: CEILING, cbAprPct: 6,
  cbLtvTriggerPct: 75, cbLtvTargetPct: 65, cbRotateBackPct: 55, startingMonth: 1,
};

// Every combination below has collateral (startingBtcHeld ≥ 0.5). Zero-collateral rows are deliberately NOT in this
// sweep — see the dedicated describe at the bottom (A3).
function advisorRows() {
  const out: { inp: AdvisorInputs; row: ReturnType<typeof runAdvisor>['rows'][number] }[] = [];
  for (const btcPrice of [50000, 100000])
  for (const startingBtcHeld of [0.5, 1, 2])
  for (const startingBlocBalance of [0, 15000, 60000])
  for (const income of [0, 500, 6000])
  for (const expenses of [1000, 8000])
  for (const cbPaymentStrategy of ['monthly', 'ltvTriggered'] as const)
  for (const blocMinPaymentSource of ['roll', 'income'] as const)
  for (const btcGrowthRate of [-0.5, 0, 0.5])
  for (const cb of [false, true]) {
    const inp: AdvisorInputs = {
      ...ADVISOR_BASE, btcPrice, startingBtcHeld, startingBlocBalance, income, expenses, cbPaymentStrategy,
      blocMinPaymentSource, btcGrowthRate,
      // The app's own coupling: no CB loan ⇒ no CB balance, collateral or payment.
      cbBalance: cb ? 30000 : 0, cbCollateralBtc: cb ? 1 : 0, cbMonthlyPayment: cb ? 500 : 0,
    };
    for (const row of runAdvisor(inp).rows) out.push({ inp, row });
  }
  return out;
}

describe('runAdvisor — blocLtvPeak across a parameter sweep', () => {
  const rows = advisorRows();
  const incomeBudget = ({ inp, row }: (typeof rows)[number]) =>
    inp.blocMinPaymentSource === 'income' ? Math.max(0, inp.income - row.blocMinPayment) : inp.income;

  it('the sweep reaches every state it tests (so no property below passes vacuously)', () => {
    const paid       = rows.filter(({ row }) => row.blocPaydown > 0);
    const partial    = paid.filter(({ row }) => row.blocLtv > CEILING + EPS);
    const undefended = rows.filter(({ row }) => row.blocPaydown === 0 && row.blocLtvPeak > CEILING + EPS);
    expect(paid.length).toBeGreaterThan(100);
    expect(partial.length).toBeGreaterThan(100);
    expect(undefended.length).toBeGreaterThan(100);
  });

  it('⭐ the peak is ≥ the settled LTV on every row, and STRICTLY greater whenever a paydown fires', () => {
    // Capture the peak below `btcHeld += btcBought` (i.e. peak = blocLtv) and the strict half goes red.
    expect(rows.filter(({ row }) => row.blocLtvPeak < row.blocLtv - 1e-12)).toEqual([]);
    expect(rows.filter(({ row }) => row.blocPaydown > 0 && !(row.blocLtvPeak > row.blocLtv))).toEqual([]);
  });

  it('⭐ a paydown fires only when the peak is above the ceiling', () => {
    // Capture the peak below `blocBalance -= blocPaydown` and a defended month's "peak" lands on the ceiling → red.
    expect(rows.filter(({ row }) => row.blocPaydown > 0 && !(row.blocLtvPeak > CEILING))).toEqual([]);
  });

  it('a peak above the ceiling WITH income left to spend always gets a paydown', () => {
    // NOT a biconditional: with no income budget the LTV can sit above the ceiling while no paydown fires — that is
    // the "undefended" state, and it is real (income 0, or a minimum payment that eats all of it).
    expect(rows.filter((r) => r.row.blocLtvPeak > CEILING + EPS && incomeBudget(r) > 0 && !(r.row.blocPaydown > 0))).toEqual([]);
  });
});

describe('the figure rule ≡ the old AFTER-box colour on every collateralised row', () => {
  // ⚠ BLOCKS deleting SimpleModeView's `eomStressed = eomState === 'partial' || eomState === 'undefended'`. The argument
  // for the replacement (partial settles above by definition; undefended ⇒ no income budget ⇒ no buy ⇒ settled = peak;
  // defended/quiet settle at or below) is exactly the shape of a claim that has been wrong before — so it is RUN here,
  // over the same sweep whose non-vacuity check (above) proves it reaches paid, partial and undefended months.
  const rows = advisorRows();

  it('⭐ isLtvFigureStressed(settled) === state ∈ {partial, undefended}, on every row', () => {
    const mismatches = rows.filter(({ row }) =>
      isLtvFigureStressed(row.blocLtv, CEILING) !==
      ['partial', 'undefended'].includes(classifyPaydownState(row.blocLtvPeak, row.blocPaydown, row.blocLtv, CEILING)));
    expect(rows.length).toBeGreaterThan(1000);
    expect(mismatches.map(({ inp, row }) => `${inp.startingBtcHeld}/${inp.income}/${inp.expenses} m${row.month}`)).toEqual([]);
  });

  it('displaySettledLtv is the identity on every collateralised row (it only changes the zero-collateral case)', () => {
    expect(rows.filter(({ row }) => displaySettledLtv(row) !== row.blocLtv)).toEqual([]);
  });
});

describe('runBLOC — ltvPeak across a parameter sweep', () => {
  const rows: { income: number; m: ReturnType<typeof runBLOC>[number] }[] = [];
  const seeds: number[] = [];
  for (const rate of [-0.5, 0, 0.5])
  for (const income of [0, 1000, 4000])
  for (const expenses of [1000, 3500, 8000])
  for (const startBTC of [0.2, 1]) {
    const data = runBLOC(rate, { income, expenses, startPrice: 80000, apr: 0.13, startBTC });
    seeds.push(data[0].ltvPeak);
    rows.push(...data.slice(1).map((m) => ({ income, m })));
  }

  it('the month-0 seed row carries ltvPeak 0', () => {
    expect(seeds.every((p) => p === 0)).toBe(true);
  });

  it('reaches paid, partial and undefended months', () => {
    expect(rows.some(({ m }) => m.paydown > 0 && m.ltv <= CEILING + EPS)).toBe(true);
    expect(rows.some(({ m }) => m.paydown > 0 && m.ltv > CEILING + EPS)).toBe(true);
    expect(rows.some(({ m }) => m.paydown === 0 && m.ltvPeak > CEILING + EPS)).toBe(true);
  });

  it('⭐ the same three properties hold against the 15% ceiling', () => {
    expect(rows.filter(({ m }) => m.ltvPeak < m.ltv - 1e-12)).toEqual([]);
    expect(rows.filter(({ m }) => m.paydown > 0 && !(m.ltvPeak > m.ltv))).toEqual([]);
    expect(rows.filter(({ m }) => m.paydown > 0 && !(m.ltvPeak > CEILING))).toEqual([]);
    expect(rows.filter(({ income, m }) => m.ltvPeak > CEILING + EPS && income > 0 && !(m.paydown > 0))).toEqual([]);
  });
});

describe('zero collateral — the peak is ∞, never 0', () => {
  const zero: AdvisorInputs = {
    ...ADVISOR_BASE, btcPrice: 100000, startingBtcHeld: 0, startingBlocBalance: 10000, income: 6000, expenses: 4000,
    cbPaymentStrategy: 'monthly', btcGrowthRate: 0, cbBalance: 0, cbCollateralBtc: 0, cbMonthlyPayment: 0,
  };

  it('⭐ debt with no collateral peaks at Infinity (0 would read the worst state as perfectly safe)', () => {
    const row = runAdvisor(zero).rows[0];
    expect(row.blocPaydown).toBeGreaterThan(0);
    expect(row.blocLtvPeak).toBe(Infinity);
    // ⚠ A3 — a silent dependency, written down: runAdvisor's SETTLED blocLtv is still 0 here. That is a PRE-EXISTING
    // defect (it should be ∞ too), left alone on purpose. It is why zero-collateral rows are kept OUT of the sweep's
    // strict "peak > settled" assertion: if someone fixes blocLtv to ∞, ∞ > ∞ is false — for the right reason. Don't
    // "fix" that by loosening the sweep; this row is pinned here instead.
    expect(row.blocLtv).toBe(0);
  });

  it('no debt and no collateral peaks at 0', () => {
    const row = runAdvisor({ ...zero, startingBlocBalance: 0, expenses: 0, income: 0 }).rows[0];
    expect(row.blocLtvPeak).toBe(0);
  });

  it('runBLOC: a first-month draw against no collateral peaks at Infinity (and pays nothing down)', () => {
    const m1 = runBLOC(0, { income: 1000, expenses: 3500, startPrice: 80000, apr: 0.13, startBTC: 0 })[1];
    expect(m1.ltvPeak).toBe(Infinity);
    expect(m1.paydown).toBe(0);
  });
});
