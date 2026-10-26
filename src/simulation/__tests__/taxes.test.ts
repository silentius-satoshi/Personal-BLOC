import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPITAL_GAINS_TAX_RATE, capitalGainsTax, sellToNet } from '../taxes';
import { runSellToLive } from '../runSellToLive';
import type { LivingInputs } from '../types';

/**
 * The capital-gains rule — ONE formula (FIRE plan R1(d); batch 1 build 3, spec pbloc-spec-batch-1-v1 §2.3). Living's own
 * formula, lifted out of `runSellToLive` into `taxes.ts` with the Living tab bit for bit what it was, its one default rate,
 * and the FIRE sell lane's closed form for a sale that nets a given amount after that tax. Every assertion carries a tag;
 * each planted bug in `build-3-mutations.json` turns its own tag red. ⚠ SYNTHETIC round figures — this repo is public.
 */

const ROOT = process.cwd();
const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8');
const rng = (seed: number) => () => { seed = (seed * 1_664_525 + 1_013_904_223) >>> 0; return seed / 4_294_967_296; };

/** The pre-lift expression, written out — `runSellToLive.ts` :51–52 and :71–72 at c7f709e, in their own order. */
const preLift = (dollarSold: number, btcSold: number, startPrice: number, rate: number): number =>
  Math.max(0, dollarSold - btcSold * startPrice) * rate;

describe('⭐ TAX RATE — Living\'s 0.30 is the one default, and the Living tab passes the constant', () => {
  it('CAPITAL_GAINS_TAX_RATE is 0.30, and useLivingSimulation reads it instead of a literal', () => {
    expect(CAPITAL_GAINS_TAX_RATE, 'TAX RATE the constant').toBe(0.30);
    const hook = read('src/hooks/useLivingSimulation.ts');
    expect(hook, 'TAX RATE the import').toMatch(/import \{ CAPITAL_GAINS_TAX_RATE \} from '\.\.\/simulation\/taxes';/);
    expect(hook, 'TAX RATE the input').toMatch(/capitalGainsTaxRate: CAPITAL_GAINS_TAX_RATE,/);
    expect(hook, 'TAX RATE no literal left').not.toMatch(/capitalGainsTaxRate:\s*0?\.\d/);
  });
});

describe('⭐ TAX FORMULA — capitalGainsTax is Living\'s expression, bit for bit; a loss owes nothing', () => {
  it('equals the pre-lift expression on every input of a sweep — gains, losses, zeros, fractions', () => {
    const r = rng(2026);
    let losses = 0;
    for (let i = 0; i < 20_000; i++) {
      const proceeds = r() < 0.05 ? 0 : r() * 2_000_000;
      const coins = r() < 0.05 ? 0 : r() * 20;
      const basis = r() < 0.05 ? 0 : r() * 150_000;
      const rate = [0.30, 0.15, 0, 0.45, r()][i % 5];
      if (proceeds - coins * basis < 0) losses += 1;
      expect(Object.is(capitalGainsTax(proceeds, coins, basis, rate), preLift(proceeds, coins, basis, rate)),
        `TAX FORMULA #${i}`).toBe(true);
    }
    expect(losses, 'TAX FORMULA non-vacuous: the sweep holds losses').toBeGreaterThan(1_000);
  });

  it('a sale at or below its cost owes nothing — never a negative tax; above it, rate × the gain', () => {
    expect(capitalGainsTax(5_000, 0.1, 60_000, 0.30), 'TAX FORMULA a loss').toBe(0);
    expect(Object.is(capitalGainsTax(5_000, 0.1, 60_000, 0.30), 0), 'TAX FORMULA +0, never −0').toBe(true);
    expect(capitalGainsTax(6_000, 0.1, 60_000, 0.30), 'TAX FORMULA at the basis').toBe(0);
    expect(capitalGainsTax(10_000, 0.1, 60_000, 0.30), 'TAX FORMULA a gain of $4,000').toBeCloseTo(1_200, 9);
    expect(capitalGainsTax(10_000, 0.1, 60_000, 0), 'TAX FORMULA a rate of 0').toBe(0);
  });
});

describe('⭐ TAX NET — sellToNet nets exactly its share after the tax (the FIRE sell lane\'s closed form)', () => {
  it('proceeds − tax = the net, to 1e-12, over a sweep; the tax is capitalGainsTax on that sale', () => {
    const r = rng(7);
    for (let i = 0; i < 20_000; i++) {
      const net = 1 + r() * 50_000;
      const price = 1_000 + r() * 200_000;
      const basis = r() < 0.1 ? 0 : r() * 250_000;
      const rate = [0.30, 0, 0.15, r() * 0.9][i % 4];
      const s = sellToNet(net, price, basis, rate);
      expect(Math.abs((s.proceedsUsd - s.taxUsd) / net - 1), `TAX NET #${i} nets the share`).toBeLessThan(1e-12);
      expect(Object.is(s.proceedsUsd, s.btc * price), `TAX NET #${i} proceeds`).toBe(true);
      expect(Object.is(s.taxUsd, capitalGainsTax(s.proceedsUsd, s.btc, basis, rate)), `TAX NET #${i} the formula`).toBe(true);
      expect(s.btc > 0 && s.taxUsd >= 0, `TAX NET #${i} signs`).toBe(true);
    }
  });

  it('at or below the basis nothing is owed and q = net ÷ price exactly; above it, net ÷ (p − rate × (p − basis))', () => {
    const below = sellToNet(4_000, 50_000, 60_000, 0.30);
    expect(below.btc, 'TAX NET below the basis').toBe(4_000 / 50_000);
    expect(below.taxUsd, 'TAX NET below the basis owes nothing').toBe(0);
    const at = sellToNet(4_000, 50_000, 50_000, 0.30);
    expect([at.btc, at.taxUsd], 'TAX NET at the basis').toEqual([4_000 / 50_000, 0]);
    const zeroRate = sellToNet(4_000, 50_000, 10_000, 0);
    expect(zeroRate.btc, 'TAX NET a rate of 0 is net ÷ price, bit for bit (the parity case)').toBe(4_000 / 50_000);
    // $100,000 a coin against $40,000 of cost at 30%: each coin nets 100,000 − 0.3 × 60,000 = $82,000.
    const above = sellToNet(8_200, 100_000, 40_000, 0.30);
    expect(above.btc, 'TAX NET above the basis').toBeCloseTo(0.1, 14);
    expect(above.taxUsd, 'TAX NET the tax on that sale').toBeCloseTo(1_800, 9);
  });
});

describe('⭐ TAX LIVING — the Living tab is bit for bit what it was: every row\'s tax is the pre-lift expression', () => {
  const base: LivingInputs = {
    btcHoldings: 0.7, startPrice: 80_000, income: 4_000, expenses: 3_500, annualBtcGrowth: 0.5, apr: 0.13,
    inflationRate: 0.02, timeHorizonMonths: 12, ltvCeiling: 0.02, capitalGainsTaxRate: CAPITAL_GAINS_TAX_RATE,
    bearMarket: false, bearPeriodMonths: 24, annualDecline: -0.5,
  };

  it('over a sweep, each month\'s taxesPaid and the final tax equal Math.max(0, Σ$ − Σ₿ × start) × the literal rate', () => {
    const r = rng(1);
    let gains = 0, losses = 0, rows = 0;
    for (let i = 0; i < 500; i++) {
      const otherRate = i % 5 === 4;   // a second rate, for the formula's sake; else the Living tab's own constant
      const inputs: LivingInputs = {
        ...base,
        btcHoldings: [0, 0.7, 3][i % 3],
        startPrice: [30_000, 80_000, 100_000][i % 3 === 0 ? 2 : i % 2],
        income: [0, 2_000, 4_000, 10_000][i % 4],
        expenses: [1_000, 3_500, 5_000][i % 3],
        annualBtcGrowth: [-0.6, -0.2, 0, 0.25, 0.5, 1.2][i % 6] + (r() - 0.5) / 10,
        inflationRate: [0, 0.02, 0.07][i % 3],
        timeHorizonMonths: [12, 60, 240, 360][i % 4],
        bearMarket: i % 2 === 1,
        bearPeriodMonths: [12, 24, 36][i % 3],
        capitalGainsTaxRate: otherRate ? 0.15 : CAPITAL_GAINS_TAX_RATE,
      };
      const literal = otherRate ? 0.15 : 0.30;   // the pre-lift rate, written out — a changed constant fails here too
      const res = runSellToLive(inputs, 50_000);
      let cumBtc = 0, cumUsd = 0;
      for (const row of res.monthlyData.slice(1)) {
        cumBtc += inputs.expenses / row.btcPrice;   // the engine's own division, on the price it recorded
        cumUsd += inputs.expenses;
        const gain = cumUsd - cumBtc * inputs.startPrice;
        if (gain > 0) gains += 1; else losses += 1;
        rows += 1;
        expect(Object.is(row.taxesPaid, preLift(cumUsd, cumBtc, inputs.startPrice, literal)), `TAX LIVING #${i} m${row.month}`).toBe(true);
      }
      expect(Object.is(res.finalTaxesPaid, preLift(cumUsd, cumBtc, inputs.startPrice, literal)), `TAX LIVING #${i} final`).toBe(true);
    }
    expect(rows, 'TAX LIVING the sweep ran').toBeGreaterThan(50_000);
    expect(gains, 'TAX LIVING non-vacuous: months with a gain').toBeGreaterThan(1_000);
    expect(losses, 'TAX LIVING non-vacuous: months with a cumulative loss (the max matters)').toBeGreaterThan(1_000);
  });

  it('both of runSellToLive\'s sites call capitalGainsTax, and no copy of the formula is left there', () => {
    const src = read('src/simulation/runSellToLive.ts');
    expect(src, 'TAX LIVING the import').toMatch(/import \{ capitalGainsTax \} from '\.\/taxes';/);
    const calls = src.match(/capitalGainsTax\(cumulativeDollarSold, cumulativeBtcSold, startPrice, capitalGainsTaxRate\)/g) ?? [];
    expect(calls.length, 'TAX LIVING both sites').toBe(2);
    expect(src, 'TAX LIVING no second copy').not.toMatch(/Math\.max\(0, cumulativeDollarSold/);
  });
});

describe('TAX JUNK — sellToNet never answers NaN, ∞ or a negative coin', () => {
  it('a junk net, price, basis or rate sells nothing', () => {
    const none = { btc: 0, proceedsUsd: 0, taxUsd: 0 };
    for (const [net, price, basis, rate] of [
      [0, 50_000, 10_000, 0.3], [-5, 50_000, 10_000, 0.3], [Number.NaN, 50_000, 10_000, 0.3], [Number.POSITIVE_INFINITY, 50_000, 10_000, 0.3],
      [100, 0, 10_000, 0.3], [100, -1, 10_000, 0.3], [100, Number.NaN, 10_000, 0.3], [100, Number.POSITIVE_INFINITY, 10_000, 0.3],
      [100, 50_000, Number.NaN, 0.3], [100, 50_000, -1, 0.3], [100, 50_000, Number.POSITIVE_INFINITY, 0.3],
      [100, 50_000, 10_000, Number.NaN], [100, 50_000, 10_000, -0.1], [100, 50_000, 10_000, 1], [100, 50_000, 0, 1.5],
    ] as const) {
      expect(sellToNet(net, price, basis, rate), `TAX JUNK ${net}/${price}/${basis}/${rate}`).toEqual(none);
    }
  });
});
