import { capitalGainsTax, sellToNet } from './taxes';

/**
 * THE FIRE ENGINE — the sell lane (FIRE plan v0.2's Run 1; batch 1 build 3, spec pbloc-spec-batch-1-v1 §2.3). How many
 * years of spending a portfolio funds, and when it funds enough: the Compass's free engine (E1–E9) re-derived from the
 * plan's own formulas — never its code, arrays or copy (R0) — on the Almanac's own price paths.
 *
 * 🔴 + − × ÷ and Math.max / min / floor / abs only, and its ONE import is ./taxes, itself zero-import (D-1 A): no belief
 * (powerLaw, cycleModel, cyclePath, pricePaths, cycleReplays) and no engine. Prices arrive as a plain number[] the view
 * builds, and the horizon is that array's length — no cap. `fireWalls.test.ts` walks the import graph for
 * implementation-approximated Math, so the exact golden (G-FIRE) holds on every runtime; the break-even's Math.pow lives
 * in fireBreakEven.ts, which this module never imports.
 *
 * ONE monthly loop for both phases (C1, C7) — the plan's point 3, one rule each:
 *  a. inflation steps every 12 months counted from month 0, a running factor; every dollar flow and the need is today's
 *     figure × that step (nominal), so shown dollars are nominal ÷ the row's step (F8);
 *  b. a working month's savings buy bitcoin at its price; a negative figure is a gap, drawn like a withdrawal — never
 *     floored at 0; the other assets grow every month, working or retired;
 *  c. from the stop month, each month draws (spending − retirement income, never below 0) × the step;
 *  d. a month that draws grows the other assets, pays from them first, then sells bitcoin for the rest (E8's order);
 *  e. each sale is taxed by Living's formula on its gain over the pool's average cost, and sized to net its share;
 *  f. the BTC-adjusted need re-reads the share each month (C4); FI is the first whole month whose start-of-month
 *     after-tax value meets it, on the keep-working path; 'atFi' makes that month the first retired month;
 *  g. a month that draws runs out when its after-tax value — the other assets + the coins' after-tax net — less the
 *     draw is ≤ 0, tested before its growth, and then pays nothing; or when, after the growth, the rest exceeds that same
 *     net. ONE value, read in dollars, so no rounding tie can end a plan early (the go, change 2);
 *  h. the capacity: the largest monthly spending that lasts from the owner's own stop month, held fixed;
 *  i. the scale: years of funded spending, the after-tax value ÷ a year's funded spending (F2);
 *  j. the lowest point: the lowest start-of-month market value through the run-out month.
 *
 * ⚠ What it leaves out — named, not built: the tax is on bitcoin sold only (the other assets are drawn untaxed); the loans
 * deriveOwnership nets at month 0 are repaid untaxed (exact at the default basis; with the owner's own basis that tax is
 * left out); retirement income counts from the stop month; a surplus of it isn't invested; an underwater position's
 * debt beyond the other assets (`uncoveredDebtUsd`). D1 A′: no simulation sets or shows a sell-lane figure.
 */

/** When work stops: a month index (0 = now), or 'atFi' — the first month whose start meets the BTC-adjusted need. */
export type FireStop = number | 'atFi';

export interface FireInputs {
  /** ₿ yours at month 0 — `deriveOwnership(strike + CB + cold, debt, price).yoursBtc`, no 4th argument. < 0 = underwater. */
  btc: number;
  /** Other investable assets at month 0, dollars. */
  otherUsd: number;
  /** A working month's income − expenses, today's dollars; negative is a gap, drawn like a withdrawal (3b). */
  savingsUsd: number;
  /** A retired month's spending, today's dollars. The view folds any buffer in — the engine has none. */
  spendUsd: number;
  /** A month's retirement income, today's dollars — counted from the stop month only (3c). */
  retirementIncomeUsd: number;
  stopMonth: FireStop;
  /** A year's inflation, a decimal (the store's `inflationRate` ÷ 100). */
  inflation: number;
  /** 1 + the other assets' return a month, computed in the view; below 1 is a loss (3g). */
  otherMonthlyFactor: number;
  /** The withdrawal rates a year, decimals — 4% and 4% by default (D13, the face's). */
  wBtc: number;
  wOther: number;
  /** The capital-gains rate on what is sold, a decimal in [0, 1) — `CAPITAL_GAINS_TAX_RATE` by default (the view's). */
  taxRate: number;
  /** The owner's own average cost, dollars a coin; null = the month-0 price (Living's convention, F7). */
  basisUsdPerBtc: number | null;
}

/** `runsOut` is the month the plan runs out (it pays nothing); `depleted`, every month after it. */
export type FirePhase = 'working' | 'retired' | 'runsOut' | 'depleted';

export interface FireRow {
  m: number;
  phase: FirePhase;
  priceUsd: number;
  /** The running inflation factor (3a): today's dollars = nominal ÷ this. */
  inflationStep: number;
  /** ₿ at the month's start, before its buy or sale — never negative. */
  btc: number;
  /** The other assets at the month's start, before its growth — nominal. */
  otherUsd: number;
  /** ₿ × price + other: market value, nominal — the lowest point's figure and the need's share. */
  portfolioUsd: number;
  /** The other assets + the coins' net after the tax selling all of them would owe — the run-out test's value, and FI's
   *  and the scale's (the go, change 1). Bit for bit `portfolioUsd` at a tax of 0. */
  afterTaxUsd: number;
  /** The BTC-adjusted need at this month's share, nominal. */
  needUsd: number;
  /** The traditional need, nominal — the same multiplier form, so equal rates give equal bits. */
  needTraditionalUsd: number;
  /** The coins whose after-tax sale, beside the other assets, meets the need; 0 when the other assets alone do. */
  needBtc: number;
  otherCoverNeed: boolean;
  /** The scale (3i): `afterTaxUsd` ÷ a year's funded spending; null when nothing is funded. */
  yearsFunded: number | null;
  /** The BTC-adjusted need in years — its mark on the scale (25 at 4% / 4%); null when nothing is funded. */
  needYears: number | null;
  /** The savings that bought ₿ this month, nominal (0 when none). */
  savingsUsd: number;
  /** This month's draw, nominal — retired: funded spending × step; working: the gap. Unpaid on runsOut / depleted rows. */
  withdrawalUsd: number;
  otherPaidUsd: number;
  btcBought: number;
  btcSold: number;
  /** What this month's sale owed, nominal. */
  taxUsd: number;
}

export interface FireResult {
  valid: boolean;
  invalidReason: 'path' | 'price' | 'input' | null;
  /** The horizon: the path's length (the face passes 240 prices for 240 months — `plConvergencePath(…, 240, …)` returns 241). */
  months: number;
  /** The stop month used: the one given, or 'atFi' resolved; null when 'atFi' isn't met within the horizon. */
  stopMonth: number | null;
  /** There are retired months to read: `stopMonth !== null && stopMonth < months`. */
  stopInHorizon: boolean;
  /** The first month meeting the BTC-adjusted need, on the keep-working path (3f). */
  fiMonth: number | null;
  /** The same against the traditional need — the same month at equal rates. */
  fiMonthTraditional: number | null;
  runOutMonth: number | null;
  /** It runs out before its stop month, or with none — a working gap (3b). */
  runsOutWhileWorking: boolean;
  lasts: boolean;
  /** The lowest start-of-month market value, nominal, through the run-out month inclusive (3j). */
  lowestUsd: number | null;
  lowestMonth: number | null;
  /** A month's funded spending, today's dollars (E3), and whether retirement income covers the spending. */
  fundedUsd: number;
  covered: boolean;
  underwater: boolean;
  /** The excess debt the other assets couldn't repay at month 0 — left out of every figure (0 unless underwater). */
  uncoveredDebtUsd: number;
  rows: FireRow[];
}

export interface FireTargets { traditionalUsd: number; btcAdjustedUsd: number; traditionalYears: number; btcAdjustedYears: number }

export interface FireCapacity {
  /** A month's spending, today's dollars (the withdrawal + the retirement income). */
  capacityUsd: number | null;
  hiUsd: number;
  hiBinds: boolean;
  /** The owner's own stop month the search ran from, held fixed. */
  stopMonth: number | null;
  reason: null | 'invalid' | 'runsOutWhileWorking' | 'noStopMonth' | 'stopBeyondHorizon' | 'noSpending';
}

/** The capacity search's gap, dollars a month — the reference model's. */
export const FIRE_CAPACITY_TOL_USD = 10;
/** A belt for both searches: at adjacent doubles a midpoint lands back on an end, so a tolerance of 0 would never exit. */
export const FIRE_SEARCH_MAX_STEPS = 200;

const finite = (v: number): number => (Number.isFinite(v) ? v : 0);
const positive = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);
const okRate = (v: number): boolean => Number.isFinite(v) && v > 0;

/** E3 — the spending the portfolio funds: max(0, spending − retirement income); covered when the income meets it. */
export function fundedSpending(spendUsd: number, retirementIncomeUsd: number): { fundedUsd: number; covered: boolean } {
  const spend = positive(spendUsd), income = positive(retirementIncomeUsd);
  return { fundedUsd: Math.max(0, spend - income), covered: income >= spend };
}

/** The BTC-adjusted need's multiple of a year's funded spending: 1/wOther + share × (1/wBtc − 1/wOther). At equal rates
 *  the spread is exactly 0, so the multiple IS 1/wOther, bit for bit — the traditional one (D13). */
const needMultipleOf = (kTrad: number, kSpread: number, share: number): number => kTrad + share * kSpread;

/** E4 — the two needs for a year's funded spending at a bitcoin share, and their marks in years. Junk → null. */
export function fireTargets(fundedYearUsd: number, btcShare: number, wBtc: number, wOther: number): FireTargets | null {
  if (!(Number.isFinite(fundedYearUsd) && fundedYearUsd >= 0) || !(Number.isFinite(btcShare) && btcShare >= 0 && btcShare <= 1)
    || !okRate(wBtc) || !okRate(wOther)) return null;
  const kTrad = 1 / wOther;
  const k = needMultipleOf(kTrad, 1 / wBtc - 1 / wOther, btcShare);
  return { traditionalUsd: fundedYearUsd * kTrad, btcAdjustedUsd: fundedYearUsd * k, traditionalYears: kTrad, btcAdjustedYears: k };
}

/** The scale (F2): a value ÷ a year's funded spending; null when nothing is funded or the value is junk. */
export function yearsOfFundedSpending(valueUsd: number, fundedYearUsd: number): number | null {
  return Number.isFinite(valueUsd) && Number.isFinite(fundedYearUsd) && fundedYearUsd > 0 ? valueUsd / fundedYearUsd : null;
}

/** The inputs, checked once: junk rates refuse the plan; junk amounts read as 0; an underwater position is netted. */
interface Plan {
  btc0: number; other0: number; cost0: number; savings: number; spend: number; income: number;
  inflation: number; factor: number; kTrad: number; kSpread: number; tax: number;
  underwater: boolean; uncoveredDebtUsd: number;
}

function planOf(x: FireInputs, prices: readonly number[]): Plan | 'path' | 'price' | 'input' {
  if (prices.length === 0) return 'path';
  for (const p of prices) if (!(Number.isFinite(p) && p > 0)) return 'price';
  if (!okRate(x.wBtc) || !okRate(x.wOther)) return 'input';
  if (!(Number.isFinite(x.taxRate) && x.taxRate >= 0 && x.taxRate < 1)) return 'input';
  if (!(Number.isFinite(x.inflation) && x.inflation > -1)) return 'input';
  if (!(Number.isFinite(x.otherMonthlyFactor) && x.otherMonthlyFactor >= 0)) return 'input';
  if (x.stopMonth !== 'atFi' && !Number.isFinite(x.stopMonth)) return 'input';
  const btcIn = finite(x.btc);
  const otherIn = positive(x.otherUsd);
  // Underwater (yoursBtc < 0): the loans exceed the coins. The excess is repaid from the other assets at month 0, untaxed —
  // deriveOwnership's own netting, carried through (C3) — and what they can't cover is named, never carried as a figure.
  const excess = btcIn < 0 ? -btcIn * prices[0] : 0;
  const btc0 = btcIn < 0 ? 0 : btcIn;
  const own = x.basisUsdPerBtc;
  const basis0 = own !== null && Number.isFinite(own) && own > 0 ? own : prices[0];
  return {
    btc0, other0: Math.max(0, otherIn - excess), cost0: btc0 * basis0,
    savings: finite(x.savingsUsd), spend: positive(x.spendUsd), income: positive(x.retirementIncomeUsd),
    inflation: x.inflation, factor: x.otherMonthlyFactor, kTrad: 1 / x.wOther, kSpread: 1 / x.wBtc - 1 / x.wOther, tax: x.taxRate,
    underwater: btcIn < 0, uncoveredDebtUsd: Math.max(0, excess - otherIn),
  };
}

interface Run {
  rows: FireRow[]; runOutMonth: number | null; lowestUsd: number; lowestMonth: number;
  fiMonth: number | null; fiMonthTraditional: number | null;
}

/** One pass of the month loop, work stopping at `stopAt` (Infinity: keep working). `funded` is a month's funded spending in
 *  today's dollars — the capacity search varies it, and nothing else. */
function runMonths(c: Plan, prices: readonly number[], stopAt: number, funded: number): Run {
  let b = c.btc0, s = c.other0, cost = c.cost0, step = 1;
  let dead = false, runOutMonth: number | null = null, lowestUsd = Number.POSITIVE_INFINITY, lowestMonth = 0;
  let fiMonth: number | null = null, fiMonthTraditional: number | null = null;
  const rows: FireRow[] = [];
  for (let m = 0; m < prices.length; m++) {
    if (m > 0 && m % 12 === 0) step = step * (1 + c.inflation);   // (3a) a running factor, counted from month 0
    const p = prices[m];
    const working = m < stopAt;
    const fundedYear = funded * 12 * step;
    const coinsUsd = b * p;
    const portfolioUsd = coinsUsd + s;
    const basis = b > 0 ? cost / b : 0;   // the pool's average cost — at 0 ₿ no basis is read (never 0 ÷ 0)
    const allCoinsTaxUsd = capitalGainsTax(coinsUsd, b, basis, c.tax);
    const coinsNetUsd = coinsUsd - allCoinsTaxUsd;
    const afterTaxUsd = s + coinsNetUsd;   // ONE value: the start test's, FI's and the scale's (the go, changes 1 and 2)
    const share = portfolioUsd > 0 ? coinsUsd / portfolioUsd : 0;
    const needMultiple = needMultipleOf(c.kTrad, c.kSpread, share);   // (3f) this month's share, not month 0's (C4)
    const needUsd = fundedYear * needMultiple;
    const needTraditionalUsd = fundedYear * c.kTrad;
    // ₿ needed: the coins whose after-tax sale meets the need beside the other assets — at the pool's cost, or at the
    // month's price with no coins (coins bought now carry no gain), so ₿ owned meets ₿ needed where FI is.
    const needSale = sellToNet(Math.max(0, needUsd - s), p, b > 0 ? basis : p, c.tax);
    const savingsUsd = working ? c.savings * step : 0;   // (3b) income less expenses, stepped; negative is a gap
    if (fiMonth === null && afterTaxUsd >= needUsd) fiMonth = m;   // (3f) the month's start, before its savings and growth
    if (fiMonthTraditional === null && afterTaxUsd >= needTraditionalUsd) fiMonthTraditional = m;
    const w = working ? (savingsUsd < 0 ? -savingsUsd : 0) : funded * step;   // (3c) the draw, from the stop month
    const row: FireRow = {
      m, phase: working ? 'working' : 'retired', priceUsd: p, inflationStep: step, btc: b, otherUsd: s, portfolioUsd, afterTaxUsd,
      needUsd, needTraditionalUsd, needBtc: needSale.btc, otherCoverNeed: needUsd <= s,
      yearsFunded: yearsOfFundedSpending(afterTaxUsd, fundedYear), needYears: fundedYear > 0 ? needMultiple : null,
      savingsUsd: 0, withdrawalUsd: w, otherPaidUsd: 0, btcBought: 0, btcSold: 0, taxUsd: 0,
    };
    rows.push(row);
    if (dead) { row.phase = 'depleted'; continue; }
    if (portfolioUsd < lowestUsd) { lowestUsd = portfolioUsd; lowestMonth = m; }   // (3j) through the run-out month
    if (w > 0 && afterTaxUsd - w <= 0) {   // (3g) before the growth; an exact zero runs out; the month pays nothing
      row.phase = 'runsOut'; dead = true; runOutMonth = m; b = 0; s = 0; cost = 0;
      continue;
    }
    s = s * c.factor;   // (3b) the other assets grow every month, working or retired
    if (w > 0) {
      const otherPaidUsd = Math.min(w, s);   // (3d) they pay first
      const restUsd = w - otherPaidUsd;
      if (restUsd > coinsNetUsd) {   // (3g) can't pay in full after a loss — in dollars, against the same net
        row.phase = 'runsOut'; dead = true; runOutMonth = m; b = 0; s = 0; cost = 0;
        continue;
      }
      s = s - otherPaidUsd;
      row.otherPaidUsd = otherPaidUsd;
      if (restUsd > 0) {
        const sold = Math.min(b, sellToNet(restUsd, p, basis, c.tax).btc);   // (3e) nets the rest; clamped to the coins held
        row.btcSold = sold;
        row.taxUsd = capitalGainsTax(sold * p, sold, basis, c.tax);
        cost = Math.max(0, cost - sold * basis);   // a sale takes its cost pro rata
        b = b - sold;
      }
    } else if (savingsUsd > 0) {
      const bought = savingsUsd / p;   // (3b) the month's savings buy at its price
      row.savingsUsd = savingsUsd;
      row.btcBought = bought;
      b = b + bought;
      cost = cost + savingsUsd;
    }
  }
  return { rows, runOutMonth, lowestUsd, lowestMonth, fiMonth, fiMonthTraditional };
}

const stopIndex = (s: number): number => Math.max(0, Math.floor(s));

function refused(reason: 'path' | 'price' | 'input', months: number): FireResult {
  return {
    valid: false, invalidReason: reason, months, stopMonth: null, stopInHorizon: false, fiMonth: null, fiMonthTraditional: null,
    runOutMonth: null, runsOutWhileWorking: false, lasts: false, lowestUsd: null, lowestMonth: null, fundedUsd: 0, covered: false,
    underwater: false, uncoveredDebtUsd: 0, rows: [],
  };
}

/** The sell lane's monthly timeline on one price path (one price a month, month 0 first). */
export function fireTimeline(x: FireInputs, prices: readonly number[]): FireResult {
  const c = planOf(x, prices);
  if (typeof c === 'string') return refused(c, prices.length);
  const { fundedUsd, covered } = fundedSpending(c.spend, c.income);
  const keep = runMonths(c, prices, Number.POSITIVE_INFINITY, fundedUsd);   // FI is read on the keep-working path (3f)
  const stopMonth = x.stopMonth === 'atFi' ? keep.fiMonth : stopIndex(x.stopMonth);
  const run = stopMonth === null || stopMonth >= prices.length ? keep : runMonths(c, prices, stopMonth, fundedUsd);
  return {
    valid: true, invalidReason: null, months: prices.length, stopMonth,
    stopInHorizon: stopMonth !== null && stopMonth < prices.length,
    fiMonth: keep.fiMonth, fiMonthTraditional: keep.fiMonthTraditional,
    runOutMonth: run.runOutMonth,
    runsOutWhileWorking: run.runOutMonth !== null && run.runOutMonth < (stopMonth ?? Number.POSITIVE_INFINITY),
    lasts: run.runOutMonth === null,
    lowestUsd: run.lowestUsd, lowestMonth: run.lowestMonth,
    fundedUsd, covered, underwater: c.underwater, uncoveredDebtUsd: c.uncoveredDebtUsd,
    rows: run.rows,
  };
}

/**
 * (3h) The capacity: the largest monthly spending, today's dollars, that lasts the horizon from the owner's own stop month
 * — the one `fireTimeline` shows for the owner's spending — HELD FIXED, so the search can't move it. The reference model's
 * search: lo = 0, hi = 2 × the spending unless given; lasting at hi returns hi and says hi binds (C7); otherwise, while
 * hi − lo > $10, the midpoint either raises lo (it lasts) or lowers hi, and the answer is lo. With retirement income it
 * is in spending terms (the withdrawal + the income) — the Compass's E9 figure is the withdrawal.
 */
export function withdrawalCapacity(x: FireInputs, prices: readonly number[], opts: { hiUsd?: number; tolUsd?: number } = {}): FireCapacity {
  const none = (reason: FireCapacity['reason'], stopMonth: number | null = null): FireCapacity =>
    ({ capacityUsd: null, hiUsd: 0, hiBinds: false, stopMonth, reason });
  const okOpt = (v: number | undefined): boolean => v === undefined || (Number.isFinite(v) && v > 0);
  if (!okOpt(opts.hiUsd) || !okOpt(opts.tolUsd)) return none('invalid');
  const c = planOf(x, prices);
  if (typeof c === 'string') return none('invalid');
  const own = fireTimeline(x, prices);
  const stop = own.stopMonth;
  if (own.runsOutWhileWorking) return none('runsOutWhileWorking', stop);
  if (stop === null) return none('noStopMonth');
  if (stop >= own.months) return none('stopBeyondHorizon', stop);
  const hiUsd = opts.hiUsd ?? 2 * c.spend;
  if (!(hiUsd > 0)) return none('noSpending', stop);
  const tol = opts.tolUsd ?? FIRE_CAPACITY_TOL_USD;
  const lastsAt = (spendUsd: number): boolean =>
    runMonths(c, prices, stop, fundedSpending(spendUsd, c.income).fundedUsd).runOutMonth === null;
  if (lastsAt(hiUsd)) return { capacityUsd: hiUsd, hiUsd, hiBinds: true, stopMonth: stop, reason: null };
  let lo = 0, hi = hiUsd;
  for (let i = 0; i < FIRE_SEARCH_MAX_STEPS && hi - lo > tol; i++) {
    const mid = (lo + hi) / 2;
    if (lastsAt(mid)) lo = mid; else hi = mid;
  }
  return { capacityUsd: lo, hiUsd, hiBinds: false, stopMonth: stop, reason: null };
}
