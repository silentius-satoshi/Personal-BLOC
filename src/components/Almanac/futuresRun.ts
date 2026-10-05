import { priceFutures, FUTURES_COUNT, FUTURES_SEED } from '../../simulation/pricePaths';
import { runFutures, type FuturesInputs, type FuturesSummary } from '../../simulation/monteCarlo';

/**
 * The futures run — 🔴 THE §2 CROSSING for the futures, and the only one. It draws the futures from the beliefs
 * (pricePaths) and gives the engine (monteCarlo) nothing but plain price paths — the pattern supportPolicyInputs keeps
 * for the support path. The worker runs it, the in-thread fallback runs the same function, and so do the tests.
 *
 * The drawn futures are cached on what they depend on — the anchor, the start, the horizon, the count and the seed —
 * and NEVER on the engine inputs. So a settings change re-runs the engine on the futures already drawn: its effect is
 * measured on the same dice, and the run skips the draw (at 240 months the worker takes about a fifth less time).
 */

/** One request — plain data, so it can cross postMessage untouched. */
export interface FuturesJob {
  /** The face's own engine inputs, minus the price path. */
  inputs: FuturesInputs;
  /** Month 0 of the futures — `futuresAnchor` of the face's anchor. */
  anchorPrice: number;
  /** Month 0's LOCAL date, `yyyy-mm-dd` — the faces' `new Date(todayLocalISO())`, held as UTC midnight. */
  startISO: string;
  months: number;
  count?: number;
  seed?: number;
}

let cache: { key: string; paths: number[][] } | null = null;

function pathsFor(job: FuturesJob): number[][] {
  const count = job.count ?? FUTURES_COUNT;
  const seed = job.seed ?? FUTURES_SEED;
  const key = `${job.anchorPrice}|${job.startISO}|${job.months}|${count}|${seed}`;
  if (cache?.key === key) return cache.paths;
  const paths = priceFutures({
    anchorPrice: job.anchorPrice, startDate: new Date(`${job.startISO}T00:00:00Z`), months: job.months, count, seed,
  }).map((f) => f.prices);
  cache = { key, paths };
  return paths;
}

/** One request's futures, run and summed up. The summary carries the job's start: the words' months count from it. */
export function futuresFor(job: FuturesJob): FuturesSummary {
  return runFutures(job.inputs, pathsFor(job), job.startISO);
}

/**
 * Month 0 of the futures: the face's anchor rounded to a 1% grid in log price (at most 0.501% away). A live quote
 * lands every 10 s; on the grid the futures move only when the price crosses a line, so the readout neither re-runs
 * nor wobbles on every tick — measured over nine quotes 0.15% apart: one run on the grid, eight off it. Anything that is
 * not a positive number passes through untouched.
 */
export function futuresAnchor(price: number): number {
  if (!(Number.isFinite(price) && price > 0)) return price;
  return Math.exp(Math.round(Math.log(price) * 100) / 100);
}
