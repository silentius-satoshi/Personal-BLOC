import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  fireTimeline, withdrawalCapacity, fundedSpending, fireTargets, yearsOfFundedSpending,
  FIRE_CAPACITY_TOL_USD, type FireInputs, type FireResult, type FireRow,
} from '../fire';
import { capitalGainsTax, sellToNet } from '../taxes';

/**
 * The FIRE engine — the sell lane (FIRE plan v0.2's Run 1; batch 1 build 3, spec pbloc-spec-batch-1-v1 §2.3, the plan
 * `Claude outputs/batch-1/build-3-plan.md` and its go). Each convention of the plan's point 3 has its tag; PARITY runs
 * the reference model's golden (R0, F10); every assertion carries a tag, and each planted bug in
 * `build-3-mutations.json` turns its own tag red. Expected values come from arithmetic written here — never from
 * `fire.ts`. ⚠ SYNTHETIC round figures — this repo is public; Appendix A's household is the FIRE plan's own invention.
 */

const rng = (seed: number) => () => { seed = (seed * 1_664_525 + 1_013_904_223) >>> 0; return seed / 4_294_967_296; };
const rel = (a: number, b: number): number => (a === b ? 0 : Math.abs(a - b) / Math.abs(b));
const BASE: FireInputs = {
  btc: 1, otherUsd: 100_000, savingsUsd: 0, spendUsd: 4_000, retirementIncomeUsd: 0, stopMonth: 0,
  inflation: 0, otherMonthlyFactor: 1, wBtc: 0.04, wOther: 0.04, taxRate: 0, basisUsdPerBtc: null,
};
const flat = (p: number, n: number): number[] => new Array<number>(n).fill(p);
const line = (p0: number, dp: number, n: number): number[] => Array.from({ length: n }, (_, m) => p0 + dp * m);
const run = (x: Partial<FireInputs>, prices: number[]): FireResult => fireTimeline({ ...BASE, ...x }, prices);
/** The first month a row predicate holds, or null. */
const firstRow = (rows: FireRow[], ok: (r: FireRow) => boolean): number | null => {
  const r = rows.find(ok);
  return r === undefined ? null : r.m;
};

// ── E3, E4 and the scale ─────────────────────────────────────────────────────────────────────────────────────────

describe('⭐ E4 TARGETS — the two needs; Appendix A to the cent; equal rates give equal bits (D13)', () => {
  it('Appendix A: traditional $1,641,176.47, BTC-adjusted $1,263,546.06 at 8% / 4%', () => {
    // Appendix A's household (FIRE plan §1.3): a $60,000 base, a 10% buffer and its 15% gross-up — E7, used here only to
    // reproduce the appendix's spending — less a $12,000 pension; 2 ₿ at $85,252 beside $200,000 of other assets.
    const spending = (60_000 + 6_000) / (1 - 0.15);
    const funded = spending - 12_000;
    const share = (2 * 85_252) / (2 * 85_252 + 200_000);
    const t = fireTargets(funded, share, 0.08, 0.04)!;
    expect(t.traditionalUsd, 'E4 traditional').toBeCloseTo(1_641_176.47, 2);
    expect(t.btcAdjustedUsd, 'E4 BTC-adjusted').toBeCloseTo(1_263_546.06, 2);
  });

  it('the harmonic need at a share of 0, ½ and 1; at equal rates the BTC-adjusted need IS the traditional one', () => {
    expect(fireTargets(40_000, 0, 0.08, 0.04)!.btcAdjustedYears, 'E4 s = 0').toBe(25);
    expect(fireTargets(40_000, 0.5, 0.08, 0.04)!.btcAdjustedYears, 'E4 s = ½').toBeCloseTo(18.75, 12);
    expect(fireTargets(40_000, 1, 0.08, 0.04)!.btcAdjustedYears, 'E4 s = 1').toBe(12.5);
    const r = rng(4);
    for (let i = 0; i < 5_000; i++) {
      const w = 0.01 + r() * 0.1, t = fireTargets(1_000 + r() * 200_000, r(), w, w)!;
      expect(Object.is(t.btcAdjustedUsd, t.traditionalUsd), `E4 equal rates #${i}`).toBe(true);
      expect(Object.is(t.btcAdjustedYears, t.traditionalYears), `E4 equal marks #${i}`).toBe(true);
    }
    expect(fireTargets(40_000, 0.5, 0, 0.04), 'E4 junk rate').toBeNull();
    expect(fireTargets(Number.NaN, 0.5, 0.04, 0.04), 'E4 junk spending').toBeNull();
  });
});

describe('⭐ E3 FUNDED — the spending the portfolio funds is spending less retirement income, never below 0', () => {
  it('funded = max(0, spending − income); covered when the income meets the spending', () => {
    expect(fundedSpending(5_000, 1_200), 'E3 funded').toEqual({ fundedUsd: 3_800, covered: false });
    expect(fundedSpending(1_000, 1_200), 'E3 covered').toEqual({ fundedUsd: 0, covered: true });
    expect(fundedSpending(1_000, 1_000), 'E3 exactly covered').toEqual({ fundedUsd: 0, covered: true });
    expect(fundedSpending(0, 0), 'E3 no spending').toEqual({ fundedUsd: 0, covered: true });
    expect(fundedSpending(Number.NaN, -5), 'E3 junk reads as 0').toEqual({ fundedUsd: 0, covered: true });
  });
});

describe('⭐ SCALE — years of funded spending read the after-tax value; the marks are the two needs in years', () => {
  it('yearsOfFundedSpending is value ÷ a year\'s funded spending; null when nothing is funded', () => {
    expect(yearsOfFundedSpending(1_000_000, 40_000), 'SCALE 25 years').toBe(25);
    expect(yearsOfFundedSpending(1_000_000, 0), 'SCALE nothing funded').toBeNull();
    expect(yearsOfFundedSpending(Number.NaN, 40_000), 'SCALE junk').toBeNull();
  });

  it('each row: yearsFunded = afterTaxUsd ÷ (a year\'s funded spending × step); the mark 25 at 4% / 4%, 12.5 all-bitcoin at 8%', () => {
    const r = run({ btc: 2, otherUsd: 0, spendUsd: 2_000, taxRate: 0.3, basisUsdPerBtc: 20_000, stopMonth: 0, inflation: 0.03 }, line(50_000, 100, 36));
    for (const row of r.rows.filter((x) => x.phase === 'retired')) {
      const year = 2_000 * 12 * row.inflationStep;
      expect(rel(row.yearsFunded!, row.afterTaxUsd / year), `SCALE m${row.m}`).toBeLessThan(1e-12);
      expect(row.afterTaxUsd, `SCALE m${row.m} the tax counts`).toBeLessThan(row.portfolioUsd);
      expect(row.needYears, `SCALE m${row.m} the mark`).toBe(25);
    }
    const allBtc = run({ btc: 2, otherUsd: 0, wBtc: 0.08 }, flat(50_000, 3));
    expect(allBtc.rows[0].needYears, 'SCALE all-bitcoin at 8% / 4%').toBe(12.5);
    expect(run({ spendUsd: 1_000, retirementIncomeUsd: 1_000 }, flat(50_000, 3)).rows[0].yearsFunded, 'SCALE covered: no figure').toBeNull();
  });

  it('on a keep-working sweep with the tax, away from ties, the scale first meets its mark in the FI month', () => {
    let checked = 0;
    for (const f of keepWorkingSweep()) {
      const r = fireTimeline(f.x, f.prices);
      if (r.fiMonth === null || nearTie(r)) continue;
      checked += 1;
      expect(firstRow(r.rows, (x) => x.yearsFunded! >= x.needYears!), `SCALE meets its mark at FI (${f.name})`).toBe(r.fiMonth);
    }
    expect(checked, 'SCALE non-vacuous').toBeGreaterThan(20);
  });
});

// ── the month loop's conventions (the plan's point 3) ────────────────────────────────────────────────────────────

describe('⭐ INFLATION — a running factor, stepped every 12 months from month 0; every flow and the need step with it', () => {
  it('1 through month 11, then × (1 + i) at 12, 24, … — never from the stop month, never Math.pow', () => {
    const r = run({ btc: 0, otherUsd: 1_000_000, spendUsd: 1_000, savingsUsd: 500, stopMonth: 6, inflation: 0.1 }, flat(50_000, 40));
    const steps = r.rows.map((x) => x.inflationStep);
    expect(steps.slice(0, 12), 'INFLATION months 0–11').toEqual(new Array(12).fill(1));
    expect(steps.slice(12, 24), 'INFLATION months 12–23').toEqual(new Array(12).fill(1 * (1 + 0.1)));
    expect(Object.is(steps[24], 1 * (1 + 0.1) * (1 + 0.1)), 'INFLATION month 24: the running product').toBe(true);
    expect(r.rows[3].savingsUsd, 'INFLATION a working month\'s savings, today\'s figure').toBe(500);
    expect(r.rows[12].withdrawalUsd, 'INFLATION the draw × the step').toBe(1_000 * (1 + 0.1));
    expect(r.rows[12].needUsd, 'INFLATION the need × the step').toBe(1_000 * 12 * (1 + 0.1) * (1 / 0.04));
    expect(r.rows[11].needUsd, 'INFLATION the need before the step').toBe(1_000 * 12 * 1 * (1 / 0.04));
  });
});

describe('⭐ WORKING — savings buy bitcoin at the month\'s price; the other assets grow every month', () => {
  it('₿ += savings ÷ price each working month, the savings stepped; the other assets × the factor, working or retired', () => {
    const r = run({ btc: 0.5, otherUsd: 10_000, otherMonthlyFactor: 1.01, savingsUsd: 1_000, stopMonth: 24, inflation: 0.05, spendUsd: 100 }, line(40_000, 250, 36));
    for (let m = 0; m < 30; m++) {
      const a = r.rows[m], b = r.rows[m + 1];
      if (a.phase === 'working') {
        expect(a.savingsUsd, `WORKING m${m} savings`).toBe(1_000 * a.inflationStep);
        expect(a.btcBought, `WORKING m${m} bought`).toBe(a.savingsUsd / a.priceUsd);
        expect(b.btc, `WORKING m${m} ₿ carried`).toBe(a.btc + a.savingsUsd / a.priceUsd);
        expect(b.otherUsd, `WORKING m${m} the other assets grow while working`).toBe(a.otherUsd * 1.01);
      } else {
        expect(a.btcBought, `WORKING m${m} nothing bought once retired`).toBe(0);
        expect(b.otherUsd, `WORKING m${m} they grow then pay once retired`).toBe(a.otherUsd * 1.01 - a.otherPaidUsd);
      }
    }
  });
});

describe('⭐ GAP — a working month that spends more than it earns draws the gap; never floored at 0 (3b)', () => {
  it('the other assets pay the gap first, then the coins; the plan can run out before it stops', () => {
    // $500 a month short; $2,000 of other assets pay months 0–3; 0.125 ₿ at $32,000 sells 1/64 ₿ ($500) a month from
    // month 4; month 11 starts with 1/64 ₿ — exactly the draw — and an exact zero runs out (3g). All exact in binary.
    const r = run({ btc: 0.125, otherUsd: 2_000, savingsUsd: -500, stopMonth: 24 }, flat(32_000, 30));
    expect(r.rows.slice(0, 4).map((x) => x.otherPaidUsd), 'GAP the other assets first').toEqual([500, 500, 500, 500]);
    expect(r.rows.slice(4, 11).map((x) => x.btcSold), 'GAP then the coins').toEqual(new Array(7).fill(1 / 64));
    expect(r.rows[5].phase, 'GAP a working month').toBe('working');
    expect(r.rows[5].withdrawalUsd, 'GAP drawn like a withdrawal').toBe(500);
    expect(r.runOutMonth, 'GAP runs out in month 11').toBe(11);
    expect(r.runsOutWhileWorking, 'GAP before its stop month').toBe(true);
    expect(r.rows[11].phase, 'GAP the run-out month').toBe('runsOut');
    const cap = withdrawalCapacity({ ...BASE, btc: 0.125, otherUsd: 2_000, savingsUsd: -500, stopMonth: 24 }, flat(32_000, 30));
    expect([cap.capacityUsd, cap.reason], 'GAP no retirement spending can last').toEqual([null, 'runsOutWhileWorking']);
  });
});

describe('⭐ RETIRED — the draw from the stop month; retirement income counts from then only, never below 0', () => {
  it('working months ignore the retirement income; retired months draw spending − income', () => {
    const r = run({ btc: 1, otherUsd: 50_000, savingsUsd: 1_000, spendUsd: 1_000, retirementIncomeUsd: 300, stopMonth: 12 }, flat(50_000, 24));
    expect(r.rows[5].savingsUsd, 'RETIRED working: the savings alone').toBe(1_000);
    expect(r.rows[5].withdrawalUsd, 'RETIRED working: no draw').toBe(0);
    expect(r.rows[12].phase, 'RETIRED the stop month is the first retired month').toBe('retired');
    expect(r.rows[12].withdrawalUsd, 'RETIRED spending − income').toBe(700);
  });

  it('a surplus of retirement income is never invested', () => {
    const r = run({ btc: 1, otherUsd: 50_000, otherMonthlyFactor: 1.002, spendUsd: 1_000, retirementIncomeUsd: 1_500, stopMonth: 0 }, flat(50_000, 12));
    expect(r.covered, 'RETIRED covered').toBe(true);
    for (let m = 0; m < 11; m++) {
      expect(r.rows[m].withdrawalUsd, `RETIRED m${m} no draw`).toBe(0);
      expect(r.rows[m + 1].otherUsd, `RETIRED m${m} the surplus isn't invested`).toBe(r.rows[m].otherUsd * 1.002);
      expect(r.rows[m + 1].btc, `RETIRED m${m} nor buys`).toBe(1);
    }
  });
});

describe('⭐ ORDER — a month that draws grows the other assets, pays from them first, then sells bitcoin (E8)', () => {
  it('$1,000 × 1.01 pays first; the coins sell the rest at the month\'s price', () => {
    const r = run({ btc: 1, otherUsd: 1_000, otherMonthlyFactor: 1.01, spendUsd: 2_000 }, flat(40_000, 3));
    expect(r.rows[0].otherPaidUsd, 'ORDER grown, then paid first').toBe(1_000 * 1.01);
    expect(r.rows[0].btcSold, 'ORDER the coins sell the rest').toBe((2_000 - 1_000 * 1.01) / 40_000);
    expect(r.rows[1].otherUsd, 'ORDER nothing left').toBe(0);
  });
});

describe('⭐ POOL — each sale is taxed on its gain over the pool\'s average cost (F7, Living\'s formula)', () => {
  it('the owner\'s basis: a gain taxed, a loss untaxed, the average kept pro rata through each sale', () => {
    // $50,000 a coin of cost; month 0 sells at $60,000 (a gain), month 1 at $40,000 (a loss), month 2 at $70,000.
    const r = run({ btc: 1, otherUsd: 0, spendUsd: 6_000, taxRate: 0.3, basisUsdPerBtc: 50_000 }, [60_000, 40_000, 70_000, 70_000]);
    const q0 = 6_000 / (60_000 - 0.3 * (60_000 - 50_000));
    expect(rel(r.rows[0].btcSold, q0), 'POOL month 0 nets $6,000 after the tax').toBeLessThan(1e-12);
    expect(r.rows[0].taxUsd, 'POOL month 0 the tax on the gain').toBeCloseTo(0.3 * q0 * 10_000, 6);
    expect(r.rows[1].taxUsd, 'POOL a sale below the pool\'s cost owes nothing — never a negative tax').toBe(0);
    expect(r.rows[1].btcSold, 'POOL month 1: net ÷ price').toBeCloseTo(6_000 / 40_000, 12);
    const q2 = 6_000 / (70_000 - 0.3 * (70_000 - 50_000));   // the average is still $50,000: sales take cost pro rata
    expect(rel(r.rows[2].btcSold, q2), 'POOL month 2 at the same average cost').toBeLessThan(1e-9);
    expect(r.rows[2].taxUsd, 'POOL month 2 the tax').toBeCloseTo(0.3 * q2 * 20_000, 5);
  });

  it('the default basis is the month-0 price; coins bought later carry their own cost', () => {
    const r = run({ btc: 1, otherUsd: 0, savingsUsd: 10_000, stopMonth: 1, spendUsd: 10_000, taxRate: 0.3 }, [50_000, 100_000, 100_000]);
    // 1 ₿ at $50,000 + $10,000 bought at $50,000 (0.2 ₿): an average of $50,000; month 1 sells at $100,000.
    const q = 10_000 / (100_000 - 0.3 * 50_000);
    expect(rel(r.rows[1].btcSold, q), 'POOL the pool at $50,000 a coin').toBeLessThan(1e-12);
    expect(r.rows[0].taxUsd, 'POOL no sale, no tax').toBe(0);
  });
});

describe('⭐ NEED — re-read each month at that month\'s share (C4); ₿ needed is the after-tax sale that meets it', () => {
  it('at 8% / 4% the BTC-adjusted need follows each month\'s share; at equal rates it equals the traditional need', () => {
    const r = run({ btc: 2, otherUsd: 100_000, spendUsd: 3_000, wBtc: 0.08, stopMonth: 0, inflation: 0.03 }, line(30_000, 1_500, 30));
    for (const row of r.rows.filter((x) => x.phase === 'retired')) {
      const share = (row.btc * row.priceUsd) / row.portfolioUsd;
      const year = 3_000 * 12 * row.inflationStep;
      expect(Object.is(row.needUsd, year * (1 / 0.04 + share * (1 / 0.08 - 1 / 0.04))), `NEED m${row.m} this month's share`).toBe(true);
    }
    expect(new Set(r.rows.slice(0, 20).map((x) => x.needYears)).size, 'NEED non-vacuous: the share moves').toBeGreaterThan(10);
    const equal = run({ btc: 2, otherUsd: 100_000, spendUsd: 3_000, stopMonth: 0, inflation: 0.03 }, line(30_000, 1_500, 30));
    for (const row of equal.rows) expect(Object.is(row.needUsd, row.needTraditionalUsd), `NEED m${row.m} equal rates, equal bits`).toBe(true);
  });

  it('₿ needed = sellToNet(need − other) at the pool\'s cost (the month\'s price at 0 ₿); 0 when the other assets cover it', () => {
    const r = run({ btc: 1, otherUsd: 50_000, spendUsd: 2_000, taxRate: 0.3, basisUsdPerBtc: 20_000 }, flat(80_000, 2));
    const row = r.rows[0];
    expect(row.needBtc, 'NEED the after-tax coins').toBe(sellToNet(row.needUsd - 50_000, 80_000, 20_000, 0.3).btc);
    expect(row.needBtc, 'NEED more coins than the pre-tax reading').toBeGreaterThan((row.needUsd - 50_000) / 80_000);
    const none = run({ btc: 0, otherUsd: 100_000, spendUsd: 2_000, taxRate: 0.3 }, flat(80_000, 2)).rows[0];
    expect(none.needBtc, 'NEED at 0 ₿, coins bought now carry no gain').toBe((none.needUsd - 100_000) / 80_000);
    const covered = run({ btc: 1, otherUsd: 1_000_000, spendUsd: 2_000 }, flat(80_000, 2)).rows[0];
    expect([covered.needBtc, covered.otherCoverNeed], 'NEED the other assets alone cover it').toEqual([0, true]);
  });

  it('on a keep-working sweep with the tax, away from ties, ₿ owned first meets ₿ needed in the FI month', () => {
    let checked = 0;
    for (const f of keepWorkingSweep()) {
      const r = fireTimeline(f.x, f.prices);
      if (r.fiMonth === null || nearTie(r)) continue;
      checked += 1;
      expect(firstRow(r.rows, (x) => x.btc >= x.needBtc), `NEED ₿ owned meets ₿ needed at FI (${f.name})`).toBe(r.fiMonth);
    }
    expect(checked, 'NEED non-vacuous').toBeGreaterThan(20);
  });
});

describe('⭐ FI — the first whole month whose start meets the need, before its savings and growth (M4)', () => {
  it('month 30, not 29: month 29\'s own savings would cross the need, but FI reads its start', () => {
    // 1/32 ₿ bought each month at $32,000 ($1,000), from nothing; the need is $1,200 × 25 = $30,000 — exact in binary.
    const r = run({ btc: 0, otherUsd: 0, savingsUsd: 1_000, spendUsd: 100, stopMonth: 'atFi' }, flat(32_000, 60));
    expect(r.fiMonth, 'FI month 30').toBe(30);
    expect(r.fiMonthTraditional, 'FI one month for both needs at 4% / 4%').toBe(30);
    expect(r.stopMonth, 'FI at FI: the stop month').toBe(30);
    expect(r.rows[29].phase, 'FI working until then').toBe('working');
    expect(r.rows[30].phase, 'FI the first retired month').toBe('retired');
  });

  it('a fixed stop before FI still reports the keep-working FI month (M4\'s reading)', () => {
    const r = run({ btc: 0, otherUsd: 0, savingsUsd: 1_000, spendUsd: 100, stopMonth: 10 }, flat(32_000, 60));
    expect(r.stopMonth, 'FI the given stop').toBe(10);
    expect(r.fiMonth, 'FI on the keep-working path').toBe(30);
  });

  it('beyond the horizon: no FI, no stop month, every row working', () => {
    const r = run({ btc: 0, otherUsd: 0, savingsUsd: 1_000, spendUsd: 100, stopMonth: 'atFi' }, flat(32_000, 30));
    expect([r.fiMonth, r.stopMonth, r.stopInHorizon], 'FI not met in the horizon').toEqual([null, null, false]);
    expect(r.rows.every((x) => x.phase === 'working'), 'FI every row working').toBe(true);
    expect(withdrawalCapacity({ ...BASE, btc: 0, otherUsd: 0, savingsUsd: 1_000, spendUsd: 100, stopMonth: 'atFi' }, flat(32_000, 30)).reason,
      'FI no stop month to read').toBe('noStopMonth');
  });
});

describe('⭐ FI AFTER TAX — FI, the scale and ₿ needed read the after-tax value, the run-out test\'s (the go, change 1)', () => {
  // The review's household on a round rising path: 2 ₿ from $85,000, $200,000 of other assets at ×1.004, $3,000 saved.
  const household = (basis: number | null): FireInputs => ({
    ...BASE, btc: 2, otherUsd: 200_000, otherMonthlyFactor: 1.004, savingsUsd: 3_000, spendUsd: 4_000, inflation: 0.025,
    stopMonth: 'atFi', taxRate: 0.3, basisUsdPerBtc: basis,
  });
  for (const basis of [null, 30_000] as const) {
    it(`FI is the first month whose afterTaxUsd meets the need; the pre-tax reading comes earlier (basis ${basis ?? 'month 0'})`, () => {
      const r = fireTimeline(household(basis), line(85_000, 1_500, 240));
      expect(r.fiMonth, 'FI AFTER TAX reached').not.toBeNull();
      expect(r.fiMonth, 'FI AFTER TAX on the after-tax value').toBe(firstRow(r.rows, (x) => x.afterTaxUsd >= x.needUsd));
      const preTax = firstRow(r.rows, (x) => x.portfolioUsd >= x.needUsd);
      expect(preTax, 'FI AFTER TAX non-vacuous: the pre-tax reading is earlier').not.toBeNull();
      expect(preTax!, 'FI AFTER TAX non-vacuous: the pre-tax reading is earlier').toBeLessThan(r.fiMonth!);
    });
  }

  it('at tax 0 the after-tax value is the portfolio, bit for bit, on every row of a sweep', () => {
    const r0 = rng(31);
    for (let i = 0; i < 300; i++) {
      const r = run({
        btc: r0() * 4, otherUsd: r0() * 300_000, savingsUsd: (r0() - 0.3) * 3_000, spendUsd: r0() * 6_000,
        stopMonth: Math.floor(r0() * 30), otherMonthlyFactor: 1 + (r0() - 0.3) / 100, inflation: r0() * 0.05,
        basisUsdPerBtc: r0() < 0.5 ? null : 10_000 + r0() * 90_000,
      }, line(20_000 + r0() * 50_000, (r0() - 0.4) * 800, 48));
      for (const row of r.rows) expect(Object.is(row.afterTaxUsd, row.portfolioUsd), `FI AFTER TAX tax 0 #${i} m${row.m}`).toBe(true);
    }
  });
});

describe('⭐ RUN OUT — the start-of-month value after tax, less the draw, ≤ 0; before the growth; then nothing (3g)', () => {
  it('the value is after the tax on selling every coin: a draw the market value covers but the after-tax value doesn\'t', () => {
    // 1 ₿ at $100,000 with a basis of 0 nets $70,000; $9,000 of other assets at ×1.2 make $79,000 — short of $80,000.
    const r = run({ btc: 1, otherUsd: 9_000, otherMonthlyFactor: 1.2, spendUsd: 80_000, taxRate: 0.3, basisUsdPerBtc: 1e-9 }, flat(100_000, 3));
    expect(r.rows[0].portfolioUsd - 80_000, 'RUN OUT premise: the market value covers it').toBeGreaterThan(0);
    expect(r.runOutMonth, 'RUN OUT on the after-tax value').toBe(0);
    expect(r.rows[0].phase, 'RUN OUT the month pays nothing').toBe('runsOut');
    expect([r.rows[0].otherPaidUsd, r.rows[0].btcSold, r.rows[0].taxUsd], 'RUN OUT nothing paid').toEqual([0, 0, 0]);
    expect(r.rows.slice(1).every((x) => x.phase === 'depleted' && x.btc === 0 && x.otherUsd === 0), 'RUN OUT later months hold nothing').toBe(true);
  });

  it('a return below 0: a month that passes the start test but can\'t pay in full runs out too', () => {
    // $10,000 of other assets halve; 0.1 ₿ at $50,000 nets $5,000; the draw is $12,000: $15,000 − $12,000 passes the start
    // test, then $5,000 pays and the $7,000 left is more than the coins net.
    const r = run({ btc: 0.1, otherUsd: 10_000, otherMonthlyFactor: 0.5, spendUsd: 12_000 }, flat(50_000, 3));
    expect(r.rows[0].afterTaxUsd - 12_000, 'RUN OUT premise: the start test passes').toBeGreaterThan(0);
    expect(r.runOutMonth, 'RUN OUT the shortfall').toBe(0);
    expect(r.rows[0].phase, 'RUN OUT the shortfall month pays nothing').toBe('runsOut');
  });

  it('a month that draws nothing never runs out, whatever it holds', () => {
    const r = run({ btc: 0, otherUsd: 0, spendUsd: 0 }, flat(50_000, 12));
    expect([r.lasts, r.runOutMonth], 'RUN OUT no draw').toEqual([true, null]);
  });
});

describe('⭐ NO TIE — one value, read in dollars: a draw that passes the start test always pays in full (the go, change 2)', () => {
  const DOWN = new DataView(new ArrayBuffer(8));
  /** The double k steps from x (x > 0): bits + k. */
  const stepDouble = (x: number, k: number): number => { DOWN.setFloat64(0, x); DOWN.setBigUint64(0, DOWN.getBigUint64(0) + BigInt(k)); return DOWN.getFloat64(0); };

  it('over seeded fixtures and the 68 doubles around the start test\'s boundary, no passing draw runs out — and both wrong forms would', () => {
    const r = rng(68);
    let engineRuns = 0, wrongLeftToRight = 0, wrongInCoins = 0, passing = 0, inDollars = 0;
    const failures: string[] = [];
    for (let i = 0; i < 40_000; i++) {
      const tax = i % 2 === 0 ? 0 : 0.3;
      const factor = i % 4 < 2 ? 1 : 1.004;
      const b = 0.01 + r() * 9.99;
      const p = 1_000 + Math.floor(r() * 199_000) + r();
      const s = r() < 0.2 ? 0 : r() * 400_000;
      const basisIn = tax > 0 ? p * (0.1 + r() * 1.2) : null;
      // The engine's own arithmetic, mirrored: the pool, its average, the coins' after-tax net and the start value.
      const cost = b * (basisIn ?? p);
      const basis = cost / b;
      const coinsUsd = b * p;
      const coinsNet = coinsUsd - capitalGainsTax(coinsUsd, b, basis, tax);
      const A = s + coinsNet;
      const leftToRight = s + coinsUsd - capitalGainsTax(coinsUsd, b, basis, tax);
      // The last 64 doubles below the boundary (they pass) and the boundary with the 3 above it (they don't).
      for (let k = -64; k <= 3; k++) {
        const w = stepDouble(A, k);
        if (!(A - w > 0)) continue;   // the start test fails: the plan runs out, as it should
        passing += 1;
        const rest = w - Math.min(w, s * factor);
        if (rest > coinsNet) inDollars += 1;                                    // in dollars it can't tie — counted, never seen
        const wrong1 = !(leftToRight - w > 0);                                 // the start value left to right refuses a payable draw
        const wrong2 = rest > 0 && sellToNet(rest, p, basis, tax).btc > b;      // the shortfall read in coins
        if (wrong1) wrongLeftToRight += 1;
        if (wrong2) wrongInCoins += 1;
        if (!wrong1 && !wrong2 && (i * 68 + k) % 997 !== 0) continue;          // the engine on every tie, plus a sample
        engineRuns += 1;
        const res = fireTimeline({ ...BASE, btc: b, otherUsd: s, spendUsd: w, otherMonthlyFactor: factor, taxRate: tax, basisUsdPerBtc: basisIn }, [p]);
        const row = res.rows[0];
        const paid = row.otherPaidUsd + (row.btcSold * p - row.taxUsd);
        if (row.phase !== 'retired' || !(paid >= w * (1 - 1e-12)) || !(row.btcSold <= b)) {
          failures.push(`#${i} k${k}: ${row.phase}, paid ${paid} of ${w}, sold ${row.btcSold} of ${b}`);
        }
      }
    }
    expect(passing, 'NO TIE the draws ran').toBeGreaterThan(1_000_000);
    expect(inDollars, 'NO TIE in dollars, a passing draw never exceeds the coins\' net').toBe(0);
    expect(failures.slice(0, 5), 'NO TIE every passing draw pays in full, never more coins than held').toEqual([]);
    expect(wrongLeftToRight, 'NO TIE non-vacuous: the left-to-right start value would refuse a payable draw').toBeGreaterThan(0);
    expect(wrongInCoins, 'NO TIE non-vacuous: the shortfall in coins would run out').toBeGreaterThan(0);
    expect(engineRuns, 'NO TIE the engine ran on the ties and a sample').toBeGreaterThan(1_000);
  }, 60_000);
});

describe('⭐ CAPACITY — the largest spending that lasts from the owner\'s stop month, held fixed; $10; hi binds said (C7)', () => {
  // A path that rises to month 60, then crashes: retiring at month 58 meets the crash, retiring later misses it.
  const crash = Array.from({ length: 240 }, (_, m) => (m < 60 ? 50_000 + 2_000 * m : m < 84 ? 170_000 - 4_000 * (m - 60) : 74_000 + 500 * (m - 84)));
  // FI (after tax) comes in month 57, before the crash; a stop after it reads far more (measured: $1,464.84 against $2,525.39).
  const atFi: FireInputs = { ...BASE, btc: 1, otherUsd: 20_000, otherMonthlyFactor: 1.004, inflation: 0.03, spendUsd: 1_500, savingsUsd: 4_000, taxRate: 0.3, stopMonth: 'atFi' };

  it('the stop month is the one shown for the owner\'s own spending — a search that moved it would read another plan', () => {
    const own = fireTimeline(atFi, crash);
    const cap = withdrawalCapacity(atFi, crash);
    expect(cap.stopMonth, 'CAPACITY the owner\'s stop month').toBe(own.stopMonth);
    expect(cap.capacityUsd, 'CAPACITY held fixed').toBe(withdrawalCapacity({ ...atFi, stopMonth: own.stopMonth! }, crash).capacityUsd);
    expect(cap.hiBinds, 'CAPACITY premise: hi doesn\'t bind').toBe(false);
    // Non-vacuous: a later stop — past the crash — would allow far more, so a moving stop changes the answer.
    expect(withdrawalCapacity({ ...atFi, stopMonth: 90 }, crash).capacityUsd!, 'CAPACITY a later stop reads more').toBeGreaterThan(cap.capacityUsd! + 100);
  });

  it('within $10: the capacity lasts and $10 more runs out; lasting is monotone in spending', () => {
    const x: FireInputs = { ...BASE, btc: 3, otherUsd: 100_000, otherMonthlyFactor: 1.005, inflation: 0.03, spendUsd: 4_000 };
    const prices = golden().paths.crashFlatRecovery as number[];
    const cap = withdrawalCapacity(x, prices);
    expect(fireTimeline({ ...x, spendUsd: cap.capacityUsd! }, prices).lasts, 'CAPACITY lasts').toBe(true);
    expect(fireTimeline({ ...x, spendUsd: cap.capacityUsd! + FIRE_CAPACITY_TOL_USD }, prices).lasts, 'CAPACITY $10 more runs out').toBe(false);
    let lastsBefore = true;
    for (let sp = 0; sp <= 8_000; sp += 50) {
      const lasts = fireTimeline({ ...x, spendUsd: sp }, prices).lasts;
      if (!lastsBefore) expect(lasts, `CAPACITY monotone at $${sp}`).toBe(false);
      lastsBefore = lasts;
    }
  });

  it('nothing to read: no stop month, a stop past the horizon, no spending, junk options', () => {
    const p = flat(50_000, 24);
    expect(withdrawalCapacity({ ...BASE, stopMonth: 24 }, p).reason, 'CAPACITY stop at the horizon').toBe('stopBeyondHorizon');
    expect(withdrawalCapacity({ ...BASE, spendUsd: 0 }, p).reason, 'CAPACITY no spending').toBe('noSpending');
    const given = withdrawalCapacity({ ...BASE, spendUsd: 0 }, p, { hiUsd: 5_000 });   // $150,000 lasts 24 months at $5,000
    expect([given.capacityUsd, given.hiBinds], 'CAPACITY a given hi').toEqual([5_000, true]);
    for (const opts of [{ hiUsd: Number.NaN }, { hiUsd: Number.POSITIVE_INFINITY }, { hiUsd: 0 }, { tolUsd: 0 }, { tolUsd: -1 }, { tolUsd: Number.NaN }]) {
      const c = withdrawalCapacity(BASE, p, opts);
      expect([c.capacityUsd, c.reason], `CAPACITY junk options ${JSON.stringify(opts)}`).toEqual([null, 'invalid']);
    }
  });
});

describe('⭐ LOWEST — the lowest start-of-month market value, nominal, through the run-out month inclusive (3j)', () => {
  it('the lowest point is market value, before the tax a sale would owe, and can fall in a working month', () => {
    const r = run({ btc: 1, otherUsd: 10_000, savingsUsd: 100, stopMonth: 6, spendUsd: 500, taxRate: 0.3, basisUsdPerBtc: 10_000 }, [50_000, 40_000, 20_000, 30_000, 60_000, 70_000, 80_000, 90_000]);
    expect(r.lowestMonth, 'LOWEST in the working months').toBe(2);
    expect(r.lowestUsd, 'LOWEST market value').toBe(r.rows[2].portfolioUsd);
    expect(r.lowestUsd!, 'LOWEST not the after-tax value').toBeGreaterThan(r.rows[2].afterTaxUsd);
  });
});

// ── the reference model's golden ─────────────────────────────────────────────────────────────────────────────────

const golden = (): any => JSON.parse(readFileSync(new URL('./goldens/fireParity.golden.json', import.meta.url), 'utf8'));

describe('⭐ PARITY — the reference model behind FIRE plan §1.3, on its golden: retire now, no tax (R0, F10)', () => {
  it('the golden is the reviewer\'s, byte for byte (never regenerated from fire.ts)', () => {
    const bytes = readFileSync(new URL('./goldens/fireParity.golden.json', import.meta.url));
    expect(createHash('md5').update(bytes).digest('hex'), 'PARITY md5').toBe('2b17c3ae4ab8c043898f385c490c00f9');
    expect(golden().cases.map((c: any) => c.id), 'PARITY its five cases').toEqual(['P1', 'P2', 'P3', 'E1', 'E2']);
  });

  for (const id of ['P1', 'P2', 'P3', 'E1', 'E2']) {
    it(`${id} — every row to 1e-12; the months, lasts, hiBinds and the capacity exactly`, () => {
      const g = golden(), c = g.cases.find((k: any) => k.id === id), e = c.expect, prices: number[] = g.paths[c.path];
      // The golden's meta.inputs: retireMonth → stopMonth, monthlyWithdrawal → spendUsd, otherFactor → otherMonthlyFactor.
      const x: FireInputs = {
        ...BASE, btc: c.inputs.btc, otherUsd: c.inputs.other, otherMonthlyFactor: c.inputs.otherFactor, inflation: c.inputs.inflation,
        spendUsd: c.inputs.monthlyWithdrawal, stopMonth: c.inputs.retireMonth, taxRate: c.inputs.taxRate,
        retirementIncomeUsd: c.inputs.retirementIncomeUsd, savingsUsd: c.inputs.savingsUsd,
      };
      const r = fireTimeline(x, prices);
      expect(r.valid, `PARITY ${id} valid`).toBe(true);
      expect(r.lasts, `PARITY ${id} lasts`).toBe(e.lasts);
      expect(r.runOutMonth, `PARITY ${id} run-out month`).toBe(e.runOutMonth);
      expect(r.lowestMonth, `PARITY ${id} lowest month`).toBe(e.lowestMonth);
      expect(rel(r.lowestUsd!, e.lowest), `PARITY ${id} lowest`).toBeLessThan(1e-12);
      if (e.rows) {
        expect(r.rows.length, `PARITY ${id} the path's months`).toBe(prices.length);
        e.rows.forEach((g6: number[], i: number) => {
          const row = r.rows[i];
          expect(row.m, `PARITY ${id} m${i}`).toBe(g6[0]);
          const mine = [row.btc, row.otherUsd, row.portfolioUsd, row.withdrawalUsd, row.btcSold];
          mine.forEach((v, k) => expect(rel(v, g6[k + 1]), `PARITY ${id} m${i} field ${k + 1}`).toBeLessThan(1e-12));
        });
      }
      if (e.capacity !== undefined) {
        const cap = withdrawalCapacity(x, prices);
        expect(cap.capacityUsd, `PARITY ${id} capacity`).toBe(e.capacity);
        expect(cap.hiBinds, `PARITY ${id} hiBinds`).toBe(e.hiBinds);
        expect(cap.hiUsd, `PARITY ${id} hi`).toBe(e.capacityHi);
      }
    });
  }
});

// ── the edges (the plan's point 2) ───────────────────────────────────────────────────────────────────────────────

describe('⭐ EDGES — every edge state reads as the plan names it', () => {
  it('underwater: 0 ₿, the excess debt repaid from the other assets, what they can\'t cover named', () => {
    const r = run({ btc: -0.5, otherUsd: 50_000 }, flat(40_000, 3));
    expect([r.underwater, r.uncoveredDebtUsd, r.rows[0].btc, r.rows[0].otherUsd], 'EDGES underwater, covered').toEqual([true, 0, 0, 30_000]);
    const short = run({ btc: -0.5, otherUsd: 5_000 }, flat(40_000, 3));
    expect([short.uncoveredDebtUsd, short.rows[0].otherUsd], 'EDGES underwater, uncovered').toEqual([15_000, 0]);
    expect(run({ btc: 0 }, flat(40_000, 3)).underwater, 'EDGES 0 ₿ is not underwater').toBe(false);
  });

  it('₿ owned at 0 and a covered plan worth $0 — the two 0 ÷ 0 reads give 0, never NaN', () => {
    const zero = run({ btc: 0, otherUsd: 10_000, spendUsd: 1_000, taxRate: 0.3 }, flat(40_000, 12));
    expect(zero.rows[0].needUsd, 'EDGES 0 ₿: the traditional need').toBe(zero.rows[0].needTraditionalUsd);
    expect(zero.runOutMonth, 'EDGES 0 ₿: $10,000 pays nine months; the tenth starts with exactly the draw, and an exact zero runs out').toBe(9);
    const nothing = run({ btc: 0, otherUsd: 0, spendUsd: 1_000, retirementIncomeUsd: 1_000, stopMonth: 'atFi' }, flat(40_000, 6));
    expect([nothing.covered, nothing.fiMonth, nothing.stopMonth, nothing.lasts], 'EDGES covered, worth $0: FI now, never runs out').toEqual([true, 0, 0, true]);
    for (const row of nothing.rows) expect([row.needUsd, row.yearsFunded, row.needYears], `EDGES $0 m${row.m}`).toEqual([0, null, null]);
  });

  it('a stop month at or past the horizon: every row working, no retirement to read', () => {
    const r = run({ savingsUsd: 100, stopMonth: 30 }, flat(40_000, 24));
    expect([r.stopMonth, r.stopInHorizon], 'EDGES the stop as given').toEqual([30, false]);
    expect(r.rows.every((x) => x.phase === 'working'), 'EDGES every row working').toBe(true);
  });

  it('junk is refused or read as 0 — never a partial reading', () => {
    expect(run({}, []).invalidReason, 'EDGES an empty path').toBe('path');
    expect(run({}, [50_000, Number.NaN, 50_000]).invalidReason, 'EDGES a junk price').toBe('price');
    expect(run({}, [50_000, 0]).invalidReason, 'EDGES a zero price').toBe('price');
    for (const bad of [{ wBtc: 0 }, { wOther: Number.NaN }, { taxRate: 1 }, { taxRate: -0.1 }, { inflation: -1 }, { otherMonthlyFactor: -0.1 },
      { stopMonth: Number.NaN }, { stopMonth: Number.POSITIVE_INFINITY }] as Partial<FireInputs>[]) {
      const r = run(bad, flat(50_000, 6));
      expect([r.valid, r.invalidReason, r.rows.length, r.stopMonth, r.lowestUsd], `EDGES junk ${JSON.stringify(bad)}`).toEqual([false, 'input', 0, null, null]);
    }
    const j = run({ btc: Number.NaN, otherUsd: Number.NEGATIVE_INFINITY, spendUsd: Number.NaN, retirementIncomeUsd: -50, basisUsdPerBtc: -1, stopMonth: 2.7 }, flat(50_000, 6));
    expect([j.valid, j.rows[0].btc, j.rows[0].otherUsd, j.fundedUsd, j.stopMonth], 'EDGES junk amounts read as 0').toEqual([true, 0, 0, 0, 2]);
    expect(run({ stopMonth: -3 }, flat(50_000, 2)).stopMonth, 'EDGES a negative stop reads as now').toBe(0);
    expect(run({}, flat(50_000, 7)).months, 'EDGES the horizon is the path').toBe(7);
  });
});

describe('⭐ NEVER NaN — junk in, every number finite or null, every ₿ and dollar flow ≥ 0, every search ends', () => {
  it('a seeded junk sweep through the timeline and the capacity', () => {
    const r = rng(404);
    const junk = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0, -0];
    const pick = (v: number): number => (r() < 0.15 ? junk[Math.floor(r() * junk.length)] : v);
    for (let i = 0; i < 400; i++) {
      const x: FireInputs = {
        btc: pick(r() * 5 - 1), otherUsd: pick(r() * 200_000), savingsUsd: pick((r() - 0.5) * 4_000), spendUsd: pick(r() * 8_000),
        retirementIncomeUsd: pick(r() * 2_000), stopMonth: r() < 0.3 ? 'atFi' : pick(Math.floor(r() * 40)), inflation: pick(r() * 0.08),
        otherMonthlyFactor: pick(0.98 + r() * 0.04), wBtc: pick(0.02 + r() * 0.1), wOther: pick(0.02 + r() * 0.06),
        taxRate: pick(r() * 0.5), basisUsdPerBtc: r() < 0.5 ? null : pick(r() * 100_000),
      };
      const prices = line(10_000 + r() * 90_000, (r() - 0.5) * 1_000, 1 + Math.floor(r() * 48)).map((p) => (r() < 0.01 ? Number.NaN : Math.max(1, p)));
      const res = fireTimeline(x, prices);
      const scan = (v: unknown, path: string): void => {
        if (typeof v === 'number') expect(Number.isFinite(v), `NEVER NaN #${i} ${path}`).toBe(true);
        else if (Array.isArray(v)) v.forEach((e, k) => scan(e, `${path}[${k}]`));
        else if (v && typeof v === 'object') for (const [k, e] of Object.entries(v)) scan(e, `${path}.${k}`);
      };
      scan(res, 'result');
      for (const row of res.rows) {
        for (const k of ['btc', 'otherUsd', 'portfolioUsd', 'afterTaxUsd', 'needUsd', 'needBtc', 'savingsUsd', 'withdrawalUsd', 'otherPaidUsd', 'btcBought', 'btcSold', 'taxUsd'] as const) {
          expect(row[k] >= 0, `NEVER NaN #${i} m${row.m} ${k} ≥ 0`).toBe(true);
        }
      }
      scan(withdrawalCapacity(x, prices, r() < 0.2 ? { tolUsd: pick(5), hiUsd: pick(5_000) } : {}), 'capacity');
    }
  });
});

describe('⭐ G-FIRE — fire.ts\'s own rows and results, exact (deep-equal) on two stored round paths', () => {
  it('equals the stored golden through a JSON round trip (−0 normalized on both sides), on Node 22 and 26 alike', () => {
    const g = JSON.parse(readFileSync(new URL('./goldens/fireTimeline.golden.json', import.meta.url), 'utf8'));
    const json = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
    expect(g.runs.length, 'G-FIRE two runs').toBe(2);
    for (const stored of g.runs) {
      const res = fireTimeline(stored.inputs, stored.prices);
      const { rows, ...rest } = res;
      expect(stored.rowKeys, `G-FIRE ${stored.name} every row field`).toEqual(Object.keys(rows[0]));
      expect(json(rows.map((x) => stored.rowKeys.map((k: keyof FireRow) => x[k]))), `G-FIRE ${stored.name} rows`).toEqual(stored.rows);
      expect(json(rest), `G-FIRE ${stored.name} result`).toEqual(stored.result);
    }
  });
});

// ── the keep-working sweep that SCALE and NEED share (the go, change 1) ──────────────────────────────────────────

interface Fixture { name: string; x: FireInputs; prices: number[] }
/** Keep-working fixtures with a 30% tax and a gain (the default basis and an owner's), on rising round paths. */
function keepWorkingSweep(): Fixture[] {
  const out: Fixture[] = [];
  const r = rng(12);
  for (let i = 0; i < 60; i++) {
    const basis = i % 2 === 0 ? null : 5_000 + Math.floor(r() * 30_000);
    out.push({
      name: `#${i}`,
      x: {
        ...BASE, btc: 0.5 + Math.floor(r() * 8) / 4, otherUsd: Math.floor(r() * 20) * 10_000, savingsUsd: 500 + Math.floor(r() * 10) * 500,
        spendUsd: 2_000 + Math.floor(r() * 6) * 500, stopMonth: 400, taxRate: 0.3, basisUsdPerBtc: basis, inflation: [0, 0.02][i % 2],
        otherMonthlyFactor: [1, 1.003][i % 3 === 0 ? 1 : 0],
      },
      prices: line(30_000 + Math.floor(r() * 40) * 1_000, 200 + Math.floor(r() * 10) * 100, 360),
    });
  }
  return out;
}
/** A fixture whose FI test sits within 1e-9 of a tie in any month — skipped, so the comparisons stay away from ties. */
function nearTie(r: FireResult): boolean {
  return r.rows.some((x) => x.needUsd > 0 && Math.abs(x.afterTaxUsd / x.needUsd - 1) < 1e-9);
}
