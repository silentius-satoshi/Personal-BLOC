import { priceFutures, FUTURES_COUNT, FUTURES_SEED } from '../../simulation/pricePaths';
import { runFutures, type FuturesInputs, type FuturesSummary } from '../../simulation/monteCarlo';
import { fireLaneFutures, type FireLaneFutures, type FireLaneJobSpec } from './fireLane';

/**
 * The futures run — 🔴 THE §2 CROSSING for the futures, and the only one. It draws the futures from the beliefs
 * (pricePaths) and gives the engine (monteCarlo) nothing but plain price paths — the pattern supportPolicyInputs keeps
 * for the support path. The worker runs it, the in-thread fallback runs the same function, and so do the tests.
 *
 * The drawn futures are cached on what they depend on — the anchor, the start, the horizon, the count and the seed —
 * and NEVER on the engine inputs. So a settings change re-runs the engine on the futures already drawn: its effect is
 * measured on the same dice, and the run skips the draw (at 240 months the worker takes about a fifth less time).
 *
 * Two kinds of request share the one worker and the one client (LATEST ONLY — one face shows at a time): the four
 * plan faces' (`FuturesJob`, the engine's batch runner), and the FIRE face's borrow lane (`FireLaneFuturesJob`, BL57 —
 * the lane on each future from the held stop month: how often it lasts, runs out of credit or is seized). Each face
 * runs ONE.
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

/** The FIRE face's request (BL57, build 2): its lane on each future — plain data too. Its `months` is the face's
 *  horizon; the lane reads each future's months 0 … months − 1, as the face reads its path. */
export interface FireLaneFuturesJob extends FireLaneJobSpec {
  kind: 'fireLane';
  anchorPrice: number;
  count?: number;
  seed?: number;
}

/** Either request, and what it answers. */
export type AnyFuturesJob = FuturesJob | FireLaneFuturesJob;
export type AnyFuturesResult = FuturesSummary | FireLaneFutures;
export type FuturesResultOf<J extends AnyFuturesJob> = J extends FireLaneFuturesJob ? FireLaneFutures : FuturesSummary;

const isFireLaneJob = (job: AnyFuturesJob): job is FireLaneFuturesJob => (job as { kind?: unknown }).kind === 'fireLane';

let cache: { key: string; paths: number[][] } | null = null;

function pathsFor(job: AnyFuturesJob): number[][] {
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

/** One request's futures, run and summed up. The summary carries the job's start: the words' months count from it. The
 *  drawn futures are the same for both kinds of request — a cache hit when only the kind changes. */
export function futuresFor(job: FuturesJob): FuturesSummary;
export function futuresFor(job: FireLaneFuturesJob): FireLaneFutures;
export function futuresFor(job: AnyFuturesJob): AnyFuturesResult;
export function futuresFor(job: AnyFuturesJob): AnyFuturesResult {
  return isFireLaneJob(job) ? fireLaneFutures(job, pathsFor(job)) : runFutures(job.inputs, pathsFor(job), job.startISO);
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
