import { runCyclingSim, type CyclingInputs, type CyclingResult, type CyclingRow } from '../../simulation/cyclingSim';
import { fireTimeline, type FireInputs, type FireResult } from '../../simulation/fire';
import { deriveOwnership } from '../../simulation/ownership';
import { placementPlan } from '../../simulation/placement';
import { sellToNet } from '../../simulation/taxes';
import type { RearmableBreakerState } from '../../simulation/supportPolicy';
import type { PlanPolicySettings } from '../../lib/planPolicy';
import { PLAN_ENGINE_CONTEXT, engineInputsOf, placementInputOf, planPolicySettingsOf, seedsFromMove } from './planRun';
import { buildSupportPath, supportPolicyFor } from './supportPolicyInputs';
import { shownBtc } from './supportPolicyView';

/**
 * The FIRE face's borrow lane — living on credit instead of selling, from the stop month (BL42, BL55, BL57; spec
 * pbloc-spec-borrow-lane-v1 §11 and §13 — build 2). Pure: no React, no store, no clock, no belief but the support path
 * (`buildSupportPath`, the faces' one crossing for it). The face hands it the sell lane's own run on a path; the futures
 * job (futuresRun) hands it each simulated path.
 *
 * 🔴 ONE RUN OF THE PLAN'S ENGINE, composed as the plan composes it — THE MOVE and the engine's inputs through planRun's
 *    two builders (`placementInputOf`, `engineInputsOf`), the policy through `supportPolicyFor`, the seeding gate through
 *    `seedsFromMove` — with `livingOnCredit` on. The engine's rule is build 1's; nothing here re-derives it.
 * 🔴 The lanes split at the stop month holding the SAME coins (L5): the sell lane's ₿ at that month's start (already
 *    net of today's loans — `deriveOwnership` at month 0, F4), all of them placed by THE MOVE at the stop month's price
 *    and support, with fresh loans and no debt. The sell lane's other assets at that month's start are the lane's
 *    reserve (L6 A), growing at the face's return.
 * 🔴 B1 (BL57) — the first bill lined up: the lane's month 0 opens the loans at the stop month's price with no bill, and
 *    its month k pays face month stop + k − 1's bill. So its price and support paths repeat the stop month at the front,
 *    and its base bill is the bill of the month BEFORE the stop month (one inflation step lower when the stop month opens
 *    a year), stepped on the face's calendar (`stepOffsetMonths`) — the sell lane's bill, month for month.
 * 🔴 It reads from the engine ONLY `livingOnCredit` (the end month and what ended it), each row's holdings and debt (₿
 *    yours, `deriveOwnership` — the one definition, no 4th argument), its cold and its state — never
 *    `firstUnfundedMonth` (dust), never the rows' ceiling headrooms (read at support, not the lane's room below it).
 * ⚠ D1 A′ forbids simulation odds on SELLING; on the futures the face shows only the lane's outcomes — how often it lasts,
 *    runs out of credit, or is seized, side by side (`FireLaneFutures`). Measured (spec §13): the lane lasts on the face's
 *    own Support path where most simulations run out of credit — the simulations read harsher, never rosier.
 */

// ── what the lane reads ────────────────────────────────────────────────────────────────────────────────────────────

/** The plan and the loans' terms, as the plan's run reads them — plain data, so the futures job carries it untouched. */
export interface FireLanePlan {
  /** The owner's saved plan — the six (`usePlanPolicy`). The lane runs under it, as THIS MONTH does (L1 A, L3 B). */
  plan: PlanPolicySettings;
  /** Strike's line, the owner's. The lane borrows through it, as the plan does (F4). */
  creditLine: number;
  /** Strike's APR and Coinbase's, percent a year. */
  blocApr: number;
  cbAprPct: number;
  strikeLiquidationLtvPct: number;
  /** The breaker as of today (`breakerFromHistory`) — the lane's opening when work stops now; null when none was read.
   *  A lane that opens later opens with a fresh one: the face can't know the breaker years from now. */
  breakerToday: RearmableBreakerState | null;
}

/** Why there's no lane to show. */
export type FireLaneNone =
  | 'invalid'        // the sell lane's run refused its inputs, or the engine couldn't host the lane
  | 'noStop'         // no stop month inside the horizon (FI isn't reached on this path)
  | 'noSpending'     // no spending to fund
  | 'covered'        // retirement income covers the spending — nothing to borrow
  | 'nothingOwned'   // no bitcoin of your own at the stop month
  | 'noLine';        // no Strike line to borrow through

export interface FireLaneRan {
  ran: true;
  /** The face's stop month — where the lane opens. */
  stop: number;
  /** The engine's run of the lane: its month 0 opens the loans at the stop month's price (no bill); its month k pays face
   *  month stop + k − 1's bill; its last month is the face's last. */
  sim: CyclingResult;
  /** The engine's own end (`sim.livingOnCredit`): its lane month, and what ended it; null — it lasts the horizon. */
  endLaneMonth: number | null;
  endReason: 'unpaid' | 'seized' | null;
}
export type FireLaneOutcome = FireLaneRan | { ran: false; why: FireLaneNone };

/** Lane month k ↔ face month stop + k − 1 (B1): the face month a lane month pays, and back. */
export const faceMonthOfLane = (stop: number, k: number): number => stop + k - 1;

// ── the lane on one path ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The engine's inputs for the lane on one path, at the sell lane's stop month — or why there's none. `sell` is
 * `fireTimeline(x, path)` (the face's own run, or a future's); `support` is `buildSupportPath(start, months)` for the
 * face's start, at least as long as `path`.
 */
export function fireLaneInputs(
  sell: FireResult, x: FireInputs, path: readonly number[], support: readonly number[], lp: FireLanePlan, startISO: string,
): { stop: number; inputs: CyclingInputs } | FireLaneNone {
  if (!sell.valid || path.length !== sell.rows.length || support.length < path.length) return 'invalid';
  const stop = sell.stopMonth;
  if (stop === null || !sell.stopInHorizon) return 'noStop';
  if (!(Number.isFinite(x.spendUsd) && x.spendUsd > 0)) return 'noSpending';
  if (sell.covered || !(sell.fundedUsd > 0)) return 'covered';
  const at = sell.rows[stop];
  if (at.phase === 'runsOut' || at.phase === 'depleted' || !shownBtc(at.btc)) return 'nothingOwned';
  if (!(Number.isFinite(lp.creditLine) && lp.creditLine > 0)) return 'noLine';

  // B1 — the opening month at the stop month's price and support, then the face's months from the stop month on.
  const pricePath = [path[stop], ...path.slice(stop)];
  const supportPath = [support[stop], ...support.slice(stop, path.length)];
  // The base bill: the bill of the month before the stop month — the engine steps it from its opening month on the
  // face's calendar, so its month 1 pays the stop month's bill exactly as the sell lane draws it.
  const expenses = (sell.fundedUsd * at.inflationStep) / (stop % 12 === 0 ? 1 + x.inflation : 1);
  const stepOffsetMonths = (((stop - 1) % 12) + 12) % 12;

  const policySettings = planPolicySettingsOf(lp.plan);
  const policy = supportPolicyFor(policySettings, supportPath, expenses, lp.strikeLiquidationLtvPct, 'cycle');
  if (policy === undefined) return 'invalid';
  const supportPolicy = { ...policy, openingCashUsd: at.otherUsd };   // L6 A — the other assets are the reserve
  const breaker = stop === 0 ? lp.breakerToday : null;
  const btc = at.btc;
  const placement = placementPlan(placementInputOf({
    runLine: lp.creditLine, strikeBalance: 0, strikeCollateralBtc: btc, cbDebt: 0, cbCollateralBtc: 0, coldBtc: 0,
    price: pricePath[0], support: supportPath[0], policySettings, expenses,
    inHold: false, broken: breaker?.broken ?? false, goalNetBtc: null,
  }));
  const seedFromMove = seedsFromMove(placement.seeded, { ...PLAN_ENGINE_CONTEXT, supportPolicy, pricePath, expenses });
  const y = Number(startISO.slice(0, 4)), m0 = Number(startISO.slice(5, 7)) - 1;
  const engine = engineInputsOf({
    startDate: new Date(Date.UTC(y, m0 + stop, 1)), seedFromMove, placement,
    strikeCollateralBtc: btc, strikeBalance: 0, runLine: lp.creditLine, cbCollateralBtc: 0, cbDebt: 0, coldBtc: 0,
    income: 0, expenses, blocApr: lp.blocApr, cbAprPct: lp.cbAprPct, supportPolicy,
    openingBreaker: breaker ?? undefined, holdMonths: 0, strikeMinFromIncome: false, goalNetBtc: null,
  });
  return {
    stop,
    inputs: {
      ...engine, pricePath,
      livingOnCredit: { spendingInflation: x.inflation, reserveMonthlyFactor: x.otherMonthlyFactor, stepOffsetMonths },
    },
  };
}

/** The lane on one path: its inputs, the engine's run, and the engine's own end. */
export function fireLaneOn(
  sell: FireResult, x: FireInputs, path: readonly number[], support: readonly number[], lp: FireLanePlan, startISO: string,
): FireLaneOutcome {
  const li = fireLaneInputs(sell, x, path, support, lp, startISO);
  if (typeof li === 'string') return { ran: false, why: li };
  const sim = runCyclingSim(li.inputs);
  const lane = sim.livingOnCredit;
  if (lane === undefined) return { ran: false, why: 'invalid' };   // the engine didn't host it — junk in, nothing shown
  return { ran: true, stop: li.stop, sim, endLaneMonth: lane.endMonth, endReason: lane.endReason };
}

// ── the face's figures ─────────────────────────────────────────────────────────────────────────────────────────────

export interface FireLaneFigures {
  stop: number;
  /** The face month the lane ends in — its first unpaid bill, or Coinbase's seizure; null — it lasts the horizon. */
  endMonth: number | null;
  endReason: 'unpaid' | 'seized' | null;
  /** An unpaid end while the plan's breaker held new borrowing off — the end month's own row says so. */
  endInBreaker: boolean;
  /** ₿ owned, borrowing, at the START of each face month, as the sell line's ₿ is: the lane's holdings and debt carried
   *  into the month (the engine's row the month before), at the month's price — `deriveOwnership`. null before the stop
   *  month, and after the month the lane ends in (B2: the line stops there). */
  owned: (number | null)[];
  /** At the horizon's last month (its start, as the chart's last point), when the lane lasts. */
  last: {
    m: number;
    yoursBtc: number;
    /** The sell lane's ₿ at the same month's start; null when it has run out by then. */
    sellBtc: number | null;
    debtUsd: number;
    /** That debt in ₿ at that month's price. */
    debtBtc: number;
    /** The tax a repayment of that debt by selling coins would owe there, in ₿ — the sell lane's sale (`sellToNet`, sized
     *  to net the debt), at that month's price, on its gain over the coins' month-0 cost — your own, or the path's month-0
     *  price — not the sell lane's pool, which savings while working move (B3; MODEL_LIMITS names it). */
    repayTaxBtc: number;
  } | null;
  /** Cold storage at the lane's opening (after THE MOVE) and at the last month, when the lane lasts — the net. */
  cold: { openBtc: number; lastBtc: number } | null;
}

/** The engine's row carried into face month m (the end of the lane month before), m ≥ stop. */
const carriedInto = (r: FireLaneRan, m: number): CyclingRow | undefined => r.sim.rows[m - r.stop];

/** The face's figures from the lane's run on the displayed path. `sell` and `path` are the ones the run was built on. */
export function fireLaneFigures(r: FireLaneRan, sell: FireResult, x: FireInputs, path: readonly number[]): FireLaneFigures {
  const months = path.length;
  const endMonth = r.endLaneMonth === null ? null
    : Math.max(r.stop, Math.min(months - 1, faceMonthOfLane(r.stop, r.endLaneMonth)));
  const lastShown = endMonth ?? months - 1;
  const owned: (number | null)[] = path.map((p, m) => {
    if (m < r.stop || m > lastShown) return null;
    const row = carriedInto(r, m);
    return row === undefined ? null : deriveOwnership(row.btcHeld, row.debt, p).yoursBtc;
  });
  const endRow = r.endLaneMonth === null ? undefined : r.sim.rows[r.endLaneMonth];
  const endInBreaker = r.endReason === 'unpaid' && endRow?.policyZone === 'broken';
  let last: FireLaneFigures['last'] = null;
  let cold: FireLaneFigures['cold'] = null;
  if (endMonth === null) {
    const m = months - 1;
    const row = carriedInto(r, m);
    const sellRow = sell.rows[m];
    if (row !== undefined && sellRow !== undefined) {
      const p = path[m];
      const own = x.basisUsdPerBtc;
      const basis = own !== null && Number.isFinite(own) && own > 0 ? own : path[0];
      const sale = sellToNet(row.debt, p, basis, x.taxRate);
      last = {
        m,
        yoursBtc: deriveOwnership(row.btcHeld, row.debt, p).yoursBtc,
        sellBtc: sellRow.phase === 'runsOut' || sellRow.phase === 'depleted' ? null : sellRow.btc,
        debtUsd: row.debt,
        debtBtc: row.debt / p,
        repayTaxBtc: sale.taxUsd / p,
      };
      cold = { openBtc: r.sim.rows[0].coldBtc, lastBtc: row.coldBtc };
    }
  }
  return { stop: r.stop, endMonth, endReason: r.endReason, endInBreaker, owned, last, cold };
}

// ── the futures (BL57: lasts, runs out, seized; D1 A′: no odds on selling) ─────────────────────────────────────────

/** What the futures job carries for the lane — plain data. `sell` is the face's `FireEngine.base` with its stop month
 *  HELD at the one the displayed path gives (a number), so the share answers one question: stopping then. */
export interface FireLaneJobSpec {
  sell: Omit<FireInputs, 'btc'> & { stopMonth: number };
  /** The position, netted at each future's month 0 as the face nets it on its path (`yoursAt`). */
  facts: { openingBtc: number; openingDebtUsd: number };
  lane: FireLanePlan;
  /** Month 0 of the futures, `yyyy-mm-dd` (the face's start), and the face's horizon — the futures' months 0 … months − 1. */
  startISO: string;
  months: number;
}

export interface FireLaneFutures {
  /** The simulations run. */
  count: number;
  /** How each lane ended: it lasted the horizon, its credit ran out (a month's spending unpaid), or Coinbase seized it. */
  lasts: number;
  unpaid: number;
  seized: number;
  /** In how many a lane ran at all (the sell lane still held coins at the stop month); lasts + unpaid + seized = ran. */
  ran: number;
  startISO: string;
  months: number;
  stop: number;
}

/** The lane on each simulated path, from the held stop month. The paths are futuresRun's — the futures' one crossing. */
export function fireLaneFutures(spec: FireLaneJobSpec, paths: readonly (readonly number[])[]): FireLaneFutures {
  const support = buildSupportPath(new Date(`${spec.startISO}T00:00:00Z`), spec.months);
  let lasts = 0, unpaid = 0, seized = 0, ran = 0;
  for (const full of paths) {
    const path = full.slice(0, spec.months);
    const x: FireInputs = { ...spec.sell, btc: deriveOwnership(spec.facts.openingBtc, spec.facts.openingDebtUsd, path[0] ?? 0).yoursBtc };
    const o = fireLaneOn(fireTimeline(x, path), x, path, support, spec.lane, spec.startISO);
    if (!o.ran) continue;
    ran += 1;
    if (o.endReason === 'seized') seized += 1;
    else if (o.endReason === 'unpaid') unpaid += 1;
    else lasts += 1;
  }
  return {
    count: paths.length, lasts, unpaid, seized, ran, startISO: spec.startISO, months: spec.months, stop: spec.sell.stopMonth,
  };
}
