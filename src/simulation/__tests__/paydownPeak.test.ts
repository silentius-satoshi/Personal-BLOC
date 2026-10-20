import { describe, it, expect } from 'vitest';
import { runBLOC } from '../runBLOC';

// ⚠ SYNTHETIC round figures — this repo is public; never a real position.
const CEILING = 0.15;
const EPS = 1e-9;

// runAdvisor's sweep (blocLtvPeak) and its zero-collateral rows left with the engine in 5e (D5-A); runBLOC's stay.

// The figure rule's helpers (isLtvFigureStressed, displaySettledLtv) left with the old card's last caller (plan of
// record, Run 3).

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
  it('runBLOC: a first-month draw against no collateral peaks at Infinity (and pays nothing down)', () => {
    const m1 = runBLOC(0, { income: 1000, expenses: 3500, startPrice: 80000, apr: 0.13, startBTC: 0 })[1];
    expect(m1.ltvPeak).toBe(Infinity);
    expect(m1.paydown).toBe(0);
  });
});
