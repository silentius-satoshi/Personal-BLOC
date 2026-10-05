/**
 * The price futures — a BELIEF leaf, beside cyclePath. It reads the two belief modules (powerLaw, cycleModel), nothing
 * else, and returns plain `number[]` price paths. 🔴 §2 WALL: nothing in the risk core imports this file. The one module
 * that hands these prices to the engine is components/Almanac/futuresRun.ts.
 *
 * Each future is built month by month:
 *   price[m] = trueFair[m] × cycle[m] × exp(noise[m] + shock[m]),   and price[0] IS the anchor.
 *
 *   • The model itself can be wrong. Every future draws its own fair line, pivoting on today's model value: slope
 *     PL_B + 0.15·z, level today × exp(0.08·z′). The engine keeps the MODEL's support line (buildSupportPath), so over
 *     the years the line the policy trusts and the line prices follow drift apart — which is exactly the test.
 *   • The cycle keeps loose time. It starts at the Oct 2025 high and steps with the model's own cadence (the first fall
 *     and rise in CYCLE_TURNS: 364 and 1,064 days), each leg stretched or squeezed by U(0.75, 1.25).
 *   • Turns land at varying depths. A trough sits at LogU(0.85, 1.8) × support's share of fair (derived as cyclePath
 *     derives it, never typed); the first top after today at LogU(0.6, 2.3) × fair; every top after that keeps 40–70% of
 *     the previous top's log distance from the trend. Between turns the curve is log-linear in time, cycleMultAt's rule.
 *     A trough never ends up within 15% of the tops on either side of it.
 *   • Regimes: 70% ordinary; 15% a lost decade (the next two tops at LogU(0.5, 0.75) × fair); 10% a support break (one
 *     of the next five troughs at U(0.16, 0.30) × fair, i.e. 0.44–0.83 × support); 5% a supercycle (the next top at
 *     LogU(2.3, 3.5) × fair).
 *   • Noise: an AR(1) wander in log price, φ 0.85, with σ drawn per future from U(0.04, 0.10). It starts at today's
 *     distance from the curve and decays, so month 0 can be the anchor without a jump into month 1.
 *   • Shocks: any month starts one with probability 1/60 (about one every five years) — a fall of 15–45% over one or two
 *     months, then a straight climb back in log price over 3–18 months.
 *
 * CALIBRATION — the memo's harsh-on-purpose targets (pbloc-memo-strategy-architecture-v1 §3). Over 1,000 futures ×
 * 240 months from 2026-10-04: the ordinary futures' deepest month-end under the MODEL's support sits at 0.80 × at the
 * median and 0.59 × at the 10th percentile (memo: 0.82 / 0.61), their worst single month at −34% at the median (memo:
 * −35%), and 67% of the faces' default runs trip the hard breaker at least once (memo: 64%). futures.test.ts holds the
 * bounds (L-I3); never move them to fit the code.
 *
 * DETERMINISTIC AND PREFIX-STABLE. Future i draws from its OWN mulberry32 generator, seeded from (seed, i), so a smaller
 * count is the head of a larger one — the 300 futures §9's kill switch would keep are the first 300 of the 1,000. And
 * every future is drawn all the way to FUTURES_MAX_MONTHS before it is cut, so a shorter horizon is the start of a
 * longer one. Normals come from Box–Muller.
 */
import { PL_B, PL_A_FAIR, PL_A_FLOOR, addMonths, daysSinceGenesis, plFairValue } from './powerLaw';
import { CYCLE_TURNS } from './cycleModel';

export type FutureRegime = 'ordinary' | 'lostDecade' | 'supportBreak' | 'supercycle';

export interface PriceFuture {
  regime: FutureRegime;
  /** One price per month, m = 0..months; prices[0] is the anchor itself. */
  prices: number[];
}

export interface FuturesRequest {
  anchorPrice: number;
  /** Month 0 at UTC midnight — a face's startDate. */
  startDate: Date;
  months: number;
  count: number;
  seed: number;
}

/** What the faces run: one fixed seed — so the same settings on the same day always read the same — and 1,000 futures. */
export const FUTURES_SEED = 2026;
export const FUTURES_COUNT = 1000;
/** How far every future is drawn before it is cut to the horizon — the faces' Horizon slider tops out at 240. */
export const FUTURES_MAX_MONTHS = 240;

/** Where support sits as a share of fair — the same ratio cyclePath derives as CYCLE_LOW_MULT, never typed in. */
const SUPPORT_OF_FAIR = PL_A_FLOOR / PL_A_FAIR;
const DAY_MS = 86_400_000;
const AR_PHI = 0.85;
const SHOCK_START_P = 1 / 60;

/** mulberry32: a small, fast 32-bit generator — enough for price futures, and identical on every engine. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed of future i: (seed, i) hashed into 32 bits, so neighbouring futures share no stream. */
export function futureSeed(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function normal(rng: () => number): number {
  let u = rng();
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

const uniform = (rng: () => number, lo: number, hi: number): number => lo + (hi - lo) * rng();
const logUniform = (rng: () => number, lo: number, hi: number): number =>
  Math.exp(uniform(rng, Math.log(lo), Math.log(hi)));

interface Turn { t: number; logMult: number }

/** A future's highs and lows, from the Oct 2025 high to past `endMs` — each one's level is a LOG multiple of fair. */
function futureTurns(rng: () => number, regime: FutureRegime, startMs: number, endMs: number): Turn[] {
  const fall = CYCLE_TURNS[1].date - CYCLE_TURNS[0].date;
  const rise = CYCLE_TURNS[2].date - CYCLE_TURNS[1].date;
  const brokenLow = 1 + Math.floor(rng() * 5);   // a support break lands on one of the next five troughs
  const turns: Turn[] = [{ t: CYCLE_TURNS[0].date, logMult: 0 }];   // the Oct 2025 high, sitting on fair
  let t = CYCLE_TURNS[0].date;
  let isLow = false;
  let lastTop = 0;
  let futureTops = 0;
  let futureLows = 0;
  while (t <= endMs || turns.length < 3) {
    isLow = !isLow;
    t += (isLow ? fall : rise) * uniform(rng, 0.75, 1.25);
    const future = t > startMs;
    let logMult: number;
    if (isLow) {
      if (future) futureLows += 1;
      const trough = Math.log(SUPPORT_OF_FAIR * logUniform(rng, 0.85, 1.8));
      logMult = future && regime === 'supportBreak' && futureLows === brokenLow
        ? Math.log(uniform(rng, 0.16, 0.30)) : trough;
    } else {
      if (future && regime === 'lostDecade' && futureTops < 2) logMult = Math.log(logUniform(rng, 0.5, 0.75));
      else if (future && regime === 'supercycle' && futureTops === 0) logMult = Math.log(logUniform(rng, 2.3, 3.5));
      else if (future && futureTops === 0) logMult = Math.log(logUniform(rng, 0.6, 2.3));
      else logMult = lastTop * uniform(rng, 0.4, 0.7);   // each later top closes 30–60% of the gap to the trend
      lastTop = logMult;
      if (future) futureTops += 1;
    }
    turns.push({ t, logMult });
  }
  // Keep every trough at least 15% under the tops beside it — a lost-decade top can otherwise land below a normal trough.
  for (let k = 1; k < turns.length; k += 2) {
    const prev = turns[k - 1].logMult;
    const next = k + 1 < turns.length ? turns[k + 1].logMult : prev;
    turns[k].logMult = Math.min(turns[k].logMult, Math.min(prev, next) + Math.log(0.85));
  }
  return turns;
}

/**
 * `count` futures, each `months + 1` monthly prices long, from `anchorPrice` at `startDate`. Junk in — an anchor that is
 * not positive, a date that is not a date — gives flat futures at the anchor, as the other path builders do.
 */
export function priceFutures(req: FuturesRequest): PriceFuture[] {
  const n = Number.isFinite(req.months) ? Math.max(0, Math.floor(req.months)) : 0;
  const N = Math.max(n, FUTURES_MAX_MONTHS);   // draw every future to N, keep months 0..n
  const count = Number.isFinite(req.count) ? Math.max(0, Math.floor(req.count)) : 0;
  const startMs = req.startDate.getTime();
  const fair0 = Number.isFinite(startMs) ? plFairValue(req.startDate) : NaN;
  if (!(req.anchorPrice > 0) || !(fair0 > 0)) {
    return Array.from({ length: count }, () => ({ regime: 'ordinary' as const, prices: new Array(n + 1).fill(req.anchorPrice) }));
  }
  // The calendar, shared by every future: each month's date, and the log of its days since genesis.
  const dateMs: number[] = [];
  const logDays: number[] = [];
  for (let m = 0; m <= N; m++) {
    const d = addMonths(req.startDate, m);
    dateMs.push(d.getTime());
    logDays.push(Math.log(daysSinceGenesis(d)));
  }
  const endMs = dateMs[N] + 400 * DAY_MS;
  const logFair0 = Math.log(fair0);
  const out: PriceFuture[] = [];
  for (let i = 0; i < count; i++) {
    const rng = mulberry32(futureSeed(req.seed, i));
    const r = rng();
    const regime: FutureRegime = r < 0.70 ? 'ordinary' : r < 0.85 ? 'lostDecade' : r < 0.95 ? 'supportBreak' : 'supercycle';
    const b = PL_B + 0.15 * normal(rng);
    const logLevel = 0.08 * normal(rng);
    const sigma = uniform(rng, 0.04, 0.10);
    const turns = futureTurns(rng, regime, startMs, endMs);

    // The curve, in log price: this future's fair line plus the cycle's multiple, interpolated between the turns.
    const logCurve: number[] = [];
    let k = 1;
    for (let m = 0; m <= N; m++) {
      const t = dateMs[m];
      while (k < turns.length - 1 && turns[k].t <= t) k += 1;
      const a = turns[k - 1], c = turns[k];
      const w = Math.min(1, Math.max(0, (t - a.t) / (c.t - a.t)));
      logCurve.push(logFair0 + logLevel + b * (logDays[m] - logDays[0]) + a.logMult + w * (c.logMult - a.logMult));
    }

    // The shocks, added in log price: down in one or two months, back up in a straight line.
    const shock = new Array<number>(N + 1).fill(0);
    for (let m = 1; m <= N; m++) {
      if (rng() >= SHOCK_START_P) continue;
      const depth = Math.log(1 - uniform(rng, 0.15, 0.45));
      const down = rng() < 0.5 ? 1 : 2;
      const recover = 3 + Math.floor(rng() * 16);   // 3 to 18 months back
      for (let j = 1; j <= down && m + j - 1 <= N; j++) shock[m + j - 1] += depth * (j / down);
      for (let j = 1; j <= recover && m + down - 1 + j <= N; j++) shock[m + down - 1 + j] += depth * (1 - j / recover);
    }

    // The noise starts at today's gap from the curve. Month 0 is set to the anchor, never computed back from the curve.
    const prices: number[] = [req.anchorPrice];
    let x = Math.log(req.anchorPrice) - logCurve[0];
    for (let m = 1; m <= N; m++) {
      x = AR_PHI * x + sigma * normal(rng);
      if (m <= n) prices.push(Math.exp(logCurve[m] + x + shock[m]));
    }
    out.push({ regime, prices });
  }
  return out;
}
