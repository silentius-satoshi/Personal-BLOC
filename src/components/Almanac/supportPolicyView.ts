import { effectivePolicyStops, type CyclingResult, type CyclingRow } from '../../simulation/cyclingSim';
import { HARD_BREAKER_DEPTH, HARD_BREAKER_MONTHS, type PolicyState } from '../../simulation/supportPolicy';
import { STRIKE_CURE_LTV } from '../../simulation/strikeCredit';
import { fmtUSD } from '../../utils/format';

/**
 * Support-anchored policy — the faces' pure display math (Run 2a). No React, no store, and NOTHING from
 * powerLaw / cycleModel: it reads the engine's result and writes the copy. The support path is built in ONE place,
 * `supportPolicyInputs.ts` (the faces' only §2 crossing), so this module never sees a belief.
 *
 * Imports: the engine's types and `effectivePolicyStops` (the ONE stop clamp), the policy leaf's `PolicyState` and
 * breaker constants (so the broken sentence cannot drift from the rule), `STRIKE_CURE_LTV` (the 65% a sale restores)
 * and `fmtUSD`. ⚠ It must never import `cyclingFaceView` — that module imports this one (`strikeCallSentence`).
 * 🔴 Must never be imported by anything in the risk core (the cyclingFaceView discipline).
 *
 * Every sentence must be TRUE of the run it describes. Where the spec's wording would be false for a case it did not
 * cover, the case gets its own true variant — pinned in supportPolicyView.test.ts.
 */

// ── settings, defaults, ranges, the clamp ────────────────────────────────────────────────────────────────────

export interface SupportPolicySettings {
  enabled: boolean;
  cbStopAtSupportPct: number;      // 60
  strikeStopAtSupportPct: number;  // 50
  accumulateBelow: number;         // 1.5
  payDownAbove: number;            // 2.0
  bearBufferMonths: number;        // 12
  cashReserveMonths: number;       // 0
}

/** The locked defaults: ON, Coinbase 60% and Strike 50% at support, zones 1.5× / 2.0×, a 12-month bear buffer, no
 *  cash reserve (a session setting — no store field). */
export const DEFAULT_SUPPORT_POLICY_SETTINGS: Readonly<SupportPolicySettings> = Object.freeze({
  enabled: true,
  cbStopAtSupportPct: 60,
  strikeStopAtSupportPct: 50,
  accumulateBelow: 1.5,
  payDownAbove: 2.0,
  bearBufferMonths: 12,
  cashReserveMonths: 0,
});

/** The hard breaker's re-arm — the owner's pick from Run 1.1's re-arm table: after a break, N CONSECUTIVE month-ends
 *  at or above support re-arm it. `undefined` = latched for the run. A constant, never a face control. */
export const DEFAULT_BREAKER_REARM_MONTHS: number | undefined = 6;

export const SUPPORT_POLICY_RANGES = {
  cbStopAtSupportPct:     { min: 40,  max: 70,  step: 1 },
  strikeStopAtSupportPct: { min: 30,  max: 60,  step: 1 },
  accumulateBelow:        { min: 1.0, max: 2.0, step: 0.05 },
  payDownAbove:           { min: 1.5, max: 3.0, step: 0.05 },
  bearBufferMonths:       { min: 0,   max: 24,  step: 1 },
  cashReserveMonths:      { min: 0,   max: 12,  step: 1 },
} as const;

/** `payDownAbove` sits at least this far above `accumulateBelow`, so the hold band never vanishes (the engine needs
 *  accumulateBelow < payDownAbove, strictly). */
export const PAY_DOWN_MIN_GAP = 0.1;

export interface EffectivePolicySettings extends SupportPolicySettings {
  /** The stops the run USES, as percentages — effectivePolicyStops × 100. */
  cbStopEffPct: number;
  skStopEffPct: number;
  cbClamped: boolean;   // the Coinbase stop was held to the CB defense line
  skClamped: boolean;
}

const inRange = (v: number, r: { readonly min: number; readonly max: number }, fallback: number): number =>
  Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, v)) : fallback;
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Clamps every value into its range (junk → the default); pushes payDownAbove up to ≥ accumulateBelow + 0.1; derives
 *  the effective stops through the ENGINE's effectivePolicyStops (never a second copy of the clamp). */
export function effectivePolicySettings(
  raw: SupportPolicySettings, ctx: { cbLtvCapPct: number; strikeCapEffPct: number },
): EffectivePolicySettings {
  const R = SUPPORT_POLICY_RANGES;
  const D = DEFAULT_SUPPORT_POLICY_SETTINGS;
  const cbStopAtSupportPct = inRange(raw.cbStopAtSupportPct, R.cbStopAtSupportPct, D.cbStopAtSupportPct);
  const strikeStopAtSupportPct = inRange(raw.strikeStopAtSupportPct, R.strikeStopAtSupportPct, D.strikeStopAtSupportPct);
  const accumulateBelow = inRange(raw.accumulateBelow, R.accumulateBelow, D.accumulateBelow);
  const payDownAbove = Math.max(
    inRange(raw.payDownAbove, R.payDownAbove, D.payDownAbove), round2(accumulateBelow + PAY_DOWN_MIN_GAP));
  const bearBufferMonths = inRange(raw.bearBufferMonths, R.bearBufferMonths, D.bearBufferMonths);
  const cashReserveMonths = inRange(raw.cashReserveMonths, R.cashReserveMonths, D.cashReserveMonths);
  const { cbStop, skStop } = effectivePolicyStops(
    cbStopAtSupportPct, strikeStopAtSupportPct, ctx.cbLtvCapPct, ctx.strikeCapEffPct);
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : D.enabled,
    cbStopAtSupportPct, strikeStopAtSupportPct, accumulateBelow, payDownAbove, bearBufferMonths, cashReserveMonths,
    cbStopEffPct: cbStop * 100,
    skStopEffPct: skStop * 100,
    cbClamped: cbStop < cbStopAtSupportPct / 100,
    skClamped: skStop < strikeStopAtSupportPct / 100,
  };
}

// ── labels ───────────────────────────────────────────────────────────────────────────────────────────────────

export const ZONE_LABEL: Record<PolicyState, string> = {
  accumulate: 'Buy with the line',
  hold: 'Hold — no new debt',
  payDown: 'Pay down',
  paused: 'Paused — below support',
  broken: 'Model broken — decide again',
};

export const ZONE_LETTER: Record<PolicyState, 'A' | 'H' | 'D' | 'P' | 'B'> = {
  accumulate: 'A', hold: 'H', payDown: 'D', paused: 'P', broken: 'B',
};

// ── formatting (the view writes the numbers) ─────────────────────────────────────────────────────────────────

/** A live multiple of support, 2 dp — "1.35". */
const fmtK = (k: number): string => k.toFixed(2);
/** A threshold (a setting), trailing zeros trimmed — "1.5", "2". */
const fmtThreshold = (x: number): string => String(Number(x.toFixed(2)));
/** 4 dp + ₿ (the strikeCapNote convention), widening to 8 dp when 4 dp would print a real amount as zero. */
const fmtBtc = (x: number): string => `${x >= 5e-5 ? x.toFixed(4) : x.toFixed(8)} ₿`;
/** A dollar amount below this prints as "$0" — float dust (a ceiling-capped refinance can leave ~1e-10 over the
 *  limit), never a statement worth a sentence. */
const DUST_USD = 0.5;
const shownUsd = (x: number): boolean => Number.isFinite(x) && x >= DUST_USD;
const COUNT_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const countWord = (n: number): string => COUNT_WORD[n] ?? String(n);

// ── the modelled Strike call — ONE sentence for the card and for strikeCapNote ────────────────────────────────

export interface StrikeCallSummary {
  firstMonth: number;
  /** Months whose call was cured (nothing sold) / ended in a sale. */
  cured: number;
  sold: number;
  /** Run totals: cure cash spent, cold moved in to cure, Strike collateral sold. */
  cashUsd: number;
  coldBtc: number;
  soldBtc: number;
}

/** The run's modelled Strike margin calls (support policy), or null when there were none — always null with the
 *  policy off, where a call is only flagged (`strikeMarginMonth`). */
export function strikeCallSummary(sim: Pick<CyclingResult,
  'firstStrikeCallMonth' | 'strikeCallsCured' | 'strikeCallsSold' | 'totalCashToCureUsd' | 'totalStrikeCureColdBtc'
  | 'totalStrikeLiquidatedBtc'>): StrikeCallSummary | null {
  if (sim.firstStrikeCallMonth === null) return null;
  return {
    firstMonth: sim.firstStrikeCallMonth,
    cured: sim.strikeCallsCured,
    sold: sim.strikeCallsSold,
    cashUsd: sim.totalCashToCureUsd,
    coldBtc: sim.totalStrikeCureColdBtc,
    soldBtc: sim.totalStrikeLiquidatedBtc,
  };
}

/**
 * cured → "Strike margin call in month 18 — cured with $4,000 of cash and 0.0500 ₿ from cold; nothing sold."
 * sold  → "Strike margin call in month 18 — 0.1429 ₿ sold to bring it back to 65%."
 * Calls in several months → "Strike margin calls in 3 months, the first in month 18 — …" (the amounts are run totals,
 * so a single-month head would pin them all on the first call). A cure names only the sources it actually used.
 */
export function strikeCallSentence(c: StrikeCallSummary): string {
  const months = c.cured + c.sold;
  const head = months > 1
    ? `Strike margin calls in ${months} months, the first in month ${c.firstMonth}`
    : `Strike margin call in month ${c.firstMonth}`;
  if (c.sold > 0) return `${head} — ${fmtBtc(c.soldBtc)} sold to bring it back to ${Math.round(STRIKE_CURE_LTV * 100)}%.`;
  const sources = [
    ...(shownUsd(c.cashUsd) ? [`${fmtUSD(c.cashUsd)} of cash`] : []),
    ...(c.coldBtc > 0 ? [`${fmtBtc(c.coldBtc)} from cold`] : []),
  ];
  return sources.length > 0 ? `${head} — cured with ${sources.join(' and ')}; nothing sold.` : `${head} — cured; nothing sold.`;
}

// ── the reading — one structured object, then plain-words renderers ───────────────────────────────────────────

/**
 * Why a run that applied the policy never drew. TOTAL: whenever `policyApplied && firstDrawMonth === null` there is
 * exactly one, and it is TRUE — read only from the result:
 *   liquidated   — Coinbase was liquidated first; the loop ended before any draw. Checked FIRST.
 *   ceiling      — the buy zone came, and in some buy-zone month Strike had room but the limits at support did not
 *                  (`firstCeilingThrottleMonth` — with no draw at all, the limits cut it to zero there). Other buy-zone
 *                  months may have been blocked by Strike's own line instead, so the sentence names both.
 *   line         — the buy zone came and no limit ever cut the draw, so Strike's OWN capacity was 0 in every buy-zone
 *                  month (any month with capacity and no cut would have drawn).
 *   zone         — the buy zone never came, and at least one month sat above it (hold / pay down).
 *   belowSupport — every month was paused (under support) or broken.
 */
export type NeverDraws = 'zone' | 'ceiling' | 'belowSupport' | 'line' | 'liquidated';

export interface PolicyRoom {
  /** Room under the limit at support, in dollars; negative only when `over`. */
  roomUsd: number;
  /** Months of bills the room covers (rounded); null when bills are ≤ 0 — never "Infinity months". */
  roomMonths: number | null;
  over: boolean;
}

export interface PolicyReading {
  applied: boolean;
  zone: PolicyState | null; multiple: number | null;            // at the inspected month
  cb: PolicyRoom | null;
  sk: PolicyRoom | null;
  brokenMonth: number | null; rearmMonth: number | null; breakCount: number;
  /** The run ENDS broken (a latched break, or a later one that never re-armed). Decides the break's tone. */
  brokenAtEnd: boolean;
  call: StrikeCallSummary | null;
  cash: { openingUsd: number; leftUsd: number; toBillsUsd: number; toCureUsd: number };
  /** `zone` is the state of the FIRST unpaid month — the cause the unpaid line names. */
  unpaid: { firstMonth: number; totalUsd: number; zone: PolicyState | null } | null;
  coldAboveSupportBtc: number;
  firstThrottleMonth: number | null;
  /** Months (m ≥ 1) in each state — the engine's own count. */
  monthsInZone: Record<PolicyState, number>;
  liqMonth: number | null;
  neverDraws: NeverDraws | null;
}

const zeroZones = (): Record<PolicyState, number> => ({ paused: 0, accumulate: 0, hold: 0, payDown: 0, broken: 0 });

function room(headroomUsd: number | null, expenses: number): PolicyRoom | null {
  if (headroomUsd === null || !Number.isFinite(headroomUsd)) return null;
  const over = headroomUsd <= -DUST_USD;
  const roomUsd = over ? headroomUsd : Math.max(0, headroomUsd);   // dust under the line reads as "at the limit"
  return {
    roomUsd,
    roomMonths: Number.isFinite(expenses) && expenses > 0 ? Math.max(0, Math.round(roomUsd / expenses)) : null,
    over,
  };
}

function neverDrawsOf(sim: CyclingResult): NeverDraws | null {
  if (!sim.policyApplied || sim.firstDrawMonth !== null) return null;
  if (sim.liqMonth !== null) return 'liquidated';
  const z = sim.monthsInZone;
  if (z.accumulate > 0) return sim.firstCeilingThrottleMonth !== null ? 'ceiling' : 'line';
  if (z.hold + z.payDown > 0) return 'zone';
  // A zero-month run has nothing to explain (unreachable from a face — the horizon is never 0).
  return z.paused + z.broken > 0 ? 'belowSupport' : null;
}

/** The face passes its render-time `clampMonth` index; an index outside the rows reads as no row (zone null). */
export function policyReading(sim: CyclingResult, monthIdx: number, expenses: number): PolicyReading {
  if (!sim.policyApplied) {
    return {
      applied: false, zone: null, multiple: null, cb: null, sk: null,
      brokenMonth: null, rearmMonth: null, breakCount: 0, brokenAtEnd: false, call: null,
      cash: { openingUsd: 0, leftUsd: 0, toBillsUsd: 0, toCureUsd: 0 }, unpaid: null, coldAboveSupportBtc: 0,
      firstThrottleMonth: null, monthsInZone: zeroZones(), liqMonth: null, neverDraws: null,
    };
  }
  const row: CyclingRow | undefined = sim.rows[monthIdx];
  const first = sim.firstUnfundedMonth;
  return {
    applied: true,
    zone: row?.policyZone ?? null,
    multiple: row?.multiple ?? null,
    cb: row ? room(row.cbCeilingHeadroomUsd, expenses) : null,
    sk: row ? room(row.strikeCeilingHeadroomUsd, expenses) : null,
    brokenMonth: sim.modelBrokenMonth,
    rearmMonth: sim.firstRearmMonth,
    breakCount: sim.breakCount,
    brokenAtEnd: sim.last.policyZone === 'broken',
    call: strikeCallSummary(sim),
    cash: {
      openingUsd: sim.openingCashUsd, leftUsd: sim.cashLeftUsd,
      toBillsUsd: sim.totalCashToBillsUsd, toCureUsd: sim.totalCashToCureUsd,
    },
    unpaid: first === null ? null
      : { firstMonth: first, totalUsd: sim.totalUnfundedUsd, zone: sim.rows[first]?.policyZone ?? null },
    coldAboveSupportBtc: sim.coldRetrievedAboveSupportBtc,
    firstThrottleMonth: sim.firstCeilingThrottleMonth,
    monthsInZone: { ...sim.monthsInZone },
    liqMonth: sim.liqMonth,
    neverDraws: neverDrawsOf(sim),
  };
}

export type PolicyTone = 'good' | 'quiet' | 'warn' | 'bad';

const ZONE_TONE: Record<PolicyState, PolicyTone> = {
  accumulate: 'good', payDown: 'good', hold: 'quiet', paused: 'warn', broken: 'bad',
};

function zoneLine(r: PolicyReading): string {
  if (r.zone === null) return '';
  const k = r.multiple !== null && Number.isFinite(r.multiple) ? ` · ${fmtK(r.multiple)}× support` : '';
  return `${ZONE_LABEL[r.zone]}${k}`;
}

function brokenSentence(r: PolicyReading): string {
  const head = `Price spent ${countWord(HARD_BREAKER_MONTHS)} month-ends more than ${Math.round(HARD_BREAKER_DEPTH * 100)}% `
    + `under support in month ${r.brokenMonth} — the model is treated as broken: no new debt.`;
  if (r.rearmMonth === null) return `${head} It stays that way for the rest of this run.`;
  const n = DEFAULT_BREAKER_REARM_MONTHS;
  const rearm = n !== undefined
    ? ` It re-arms after ${n} months back on the line (month ${r.rearmMonth}).`
    : ` It re-armed in month ${r.rearmMonth}.`;
  const again = r.breakCount > 1
    ? ` It broke ${r.breakCount} times in all${r.brokenAtEnd ? ' and stays broken to the end of this run' : ''}.`
    : '';
  return `${head}${rearm}${again}`;
}

function overSentence(leg: 'Coinbase' | 'Strike', roomUsd: number, afterCoinbase: boolean): string {
  return `${leg} is ${fmtUSD(-roomUsd)} over its limit at support — spare income repays it `
    + `${afterCoinbase ? 'after Coinbase' : 'first'}`;
}

function roomSentence(leg: 'Coinbase' | 'Strike', rm: PolicyRoom, withMonths: boolean): string {
  if (!shownUsd(rm.roomUsd)) return `${leg}: at its limit at support`;
  const months = !withMonths || rm.roomMonths === null ? ''
    : rm.roomMonths === 0 ? ' — under a month of bills'
    : rm.roomMonths === 1 ? ' — 1 month of bills'
    : ` — ${rm.roomMonths} months of bills`;
  return `${leg}: ${fmtUSD(rm.roomUsd)} of room at support${months}`;
}

const cbLine = (r: PolicyReading): string | null =>
  r.cb === null ? null : r.cb.over ? overSentence('Coinbase', r.cb.roomUsd, false) : roomSentence('Coinbase', r.cb, true);
const skLine = (r: PolicyReading): string | null =>
  r.sk === null ? null : r.sk.over ? overSentence('Strike', r.sk.roomUsd, r.cb?.over === true) : roomSentence('Strike', r.sk, false);

const coldAlarm = (r: PolicyReading): string =>
  `${fmtBtc(r.coldAboveSupportBtc)} came out of cold while price was above support — the position opened over its limits.`;
const COLD_PROMISE = 'Cold is never touched while price is at or above support.';

function cashLine(r: PolicyReading): string | null {
  if (!shownUsd(r.cash.openingUsd)) return null;
  const uses = [
    ...(shownUsd(r.cash.toBillsUsd) ? [`${fmtUSD(r.cash.toBillsUsd)} paid bills`] : []),
    ...(shownUsd(r.cash.toCureUsd) ? [`${fmtUSD(r.cash.toCureUsd)} cured a Strike call`] : []),
  ];
  return `Cash reserve: ${fmtUSD(r.cash.leftUsd)} left of ${fmtUSD(r.cash.openingUsd)}`
    + `${uses.length > 0 ? ` (${uses.join(', ')})` : ''}.`;
}

/** Why the FIRST unpaid month went unpaid — the spec's "won't borrow below support" is true only of a paused month. */
const UNPAID_CAUSE: Record<PolicyState, string> = {
  paused: "the policy won't borrow below support",
  broken: "the policy won't borrow while the model is treated as broken",
  hold: 'the policy takes on no new debt above the buy zone',
  payDown: 'the policy takes on no new debt above the buy zone',
  accumulate: "the credit line and the limits at support couldn't cover them",
};

function unpaidLine(r: PolicyReading): string | null {
  if (r.unpaid === null || !shownUsd(r.unpaid.totalUsd)) return null;
  const cause = r.unpaid.zone === null ? 'nothing in the model paid them' : UNPAID_CAUSE[r.unpaid.zone];
  const act = shownUsd(r.cash.openingUsd) ? 'A larger cash reserve would cover them.' : 'Set a cash reserve to cover them.';
  return `From month ${r.unpaid.firstMonth}, ${fmtUSD(r.unpaid.totalUsd)} of bills went unpaid — ${cause}. ${act}`;
}

/**
 * ONE line for the face's state area. Precedence — the bad tone first (each adjacent pair is tested):
 *   latched break > call sold > re-armed break > over the limit > cold pulled above support > call cured > paused > zone
 * Run-level events (the breaker, calls, cold) read the result; over / paused / zone read the inspected month.
 */
export function policyHeadline(r: PolicyReading, _s: EffectivePolicySettings): { tone: PolicyTone; text: string } {
  if (!r.applied) return { tone: 'quiet', text: '' };
  const broken = r.brokenMonth !== null;
  if (broken && r.brokenAtEnd) return { tone: 'bad', text: brokenSentence(r) };
  if (r.call !== null && r.call.sold > 0) return { tone: 'bad', text: strikeCallSentence(r.call) };
  if (broken) return { tone: 'warn', text: brokenSentence(r) };
  if (r.cb?.over) return { tone: 'warn', text: overSentence('Coinbase', r.cb.roomUsd, false) };
  if (r.sk?.over) return { tone: 'warn', text: overSentence('Strike', r.sk.roomUsd, false) };
  if (r.coldAboveSupportBtc > 0) return { tone: 'warn', text: coldAlarm(r) };
  if (r.call !== null) return { tone: 'warn', text: strikeCallSentence(r.call) };
  if (r.zone === null) return { tone: 'quiet', text: '' };
  return { tone: ZONE_TONE[r.zone], text: zoneLine(r) };
}

/** The card's detail lines, in a fixed order: room (CB, Strike), breaker, call, cash, unpaid, cold promise or alarm. */
export function policyDetails(r: PolicyReading, _s: EffectivePolicySettings): string[] {
  if (!r.applied) return [];
  const lines = [
    cbLine(r),
    skLine(r),
    r.brokenMonth !== null ? brokenSentence(r) : null,
    r.call !== null ? strikeCallSentence(r.call) : null,
    cashLine(r),
    unpaidLine(r),
    r.coldAboveSupportBtc > 0 ? coldAlarm(r) : COLD_PROMISE,
  ];
  return lines.filter((l): l is string => l !== null);
}

/** The sentence for `neverDraws` — '' when there is none. Each is TRUE of every run its kind covers. */
export function neverDrawsNote(r: PolicyReading, s: EffectivePolicySettings): string {
  const buy = `${fmtThreshold(s.accumulateBelow)}×`;
  switch (r.neverDraws) {
    case null:
      return '';
    case 'liquidated':
      return r.liqMonth === null || r.liqMonth === 0
        ? 'Coinbase starts this scenario past its liquidation line, so the policy never borrows.'
        : `Coinbase is liquidated in month ${r.liqMonth}, before the policy ever borrows.`;
    case 'ceiling':
      // "(or Strike's own line)": in some such runs the line, not a limit, blocked a few buy-zone months — the limits
      // blocked at least one month where the line had room, but a row cannot say which bound in every month.
      return "The buy zone comes, but the limits at support (or Strike's own line) never leave room to borrow on this path, "
        + 'so the policy never borrows.';
    case 'line':
      return "Strike's line has no room to draw, so the bills come from income.";
    case 'zone':
      return r.monthsInZone.paused + r.monthsInZone.broken === 0
        ? `Price never comes back to ${buy} support or below on this path, so the policy never borrows.`
        : `The policy's buy zone — support to ${buy} support — never opens on this path, so the policy never borrows.`;
    case 'belowSupport':
      return r.monthsInZone.broken === 0
        ? 'Price stays under support on this path, so the policy never borrows.'
        : 'Price stays under support, or the model stays broken, for this whole path, so the policy never borrows.';
  }
}

// ── why a month did not borrow ───────────────────────────────────────────────────────────────────────────────

/** Null when the month drew, the policy is off, or it is the opening (month 0 takes no action). Else ONE sentence
 *  naming the real reason, plus what spare income, the cash reserve and unpaid bills did that month. */
export function policyPauseReason(row: CyclingRow, s: EffectivePolicySettings): string | null {
  if (row.policyZone === null || row.m === 0 || row.strikeDrawn > 0) return null;
  const k = row.multiple !== null && Number.isFinite(row.multiple) ? fmtK(row.multiple) : '—';
  // "pays the bills" is true only when nothing else paid them and none went unpaid.
  const paycheck = shownUsd(row.cashToBillsUsd) || shownUsd(row.unfundedUsd)
    ? 'your paycheck pays what it can' : 'your paycheck pays the bills';
  const payDownAt = `${fmtThreshold(s.payDownAbove)}×`;
  let head: string;
  if (row.postLiquidation) {
    head = 'Coinbase has been liquidated — the policy borrows nothing more.';
  } else {
    switch (row.policyZone) {
      case 'hold':
        head = `Price is ${k}× support — above the ${fmtThreshold(s.accumulateBelow)}× buy zone, so no new debt: ${paycheck}.`;
        break;
      case 'payDown':
        head = shownUsd(row.payDownUsd)
          ? `Price is ${k}× support — above ${payDownAt}, so spare income pays debt down (${fmtUSD(row.payDownUsd)} this month) before buying.`
          : row.debt > 0
            ? `Price is ${k}× support — above ${payDownAt}, so spare income pays debt down before buying (there was none this month).`
            : `Price is ${k}× support — above ${payDownAt}, and there's no debt left to pay down, so spare income buys.`;
        break;
      case 'paused':
        head = `Price is under support (${k}×) — the policy borrows nothing until it is back on the line.`;
        break;
      case 'broken':
        head = 'The model is treated as broken — no new debt.';
        break;
      case 'accumulate':
        // The draw is capped by the limits at support AND by Strike's own line; a row cannot say which one bound.
        head = `The limits at support (or Strike's own line) leave no room to borrow this month, so ${paycheck}.`;
        break;
    }
  }
  return head
    + (shownUsd(row.restoreUsd) ? ` ${fmtUSD(row.restoreUsd)} of spare income repaid a loan over its limit first.` : '')
    + (shownUsd(row.cashToBillsUsd) ? ` Your cash reserve paid ${fmtUSD(row.cashToBillsUsd)} of bills.` : '')
    + (shownUsd(row.unfundedUsd) ? ` ${fmtUSD(row.unfundedUsd)} of bills went unpaid.` : '');
}

/** The pause clause's reason at the stop month, under the policy. */
function stopReason(zone: PolicyState | null, s: EffectivePolicySettings): string {
  switch (zone) {
    case 'hold':
    case 'payDown':
      return `price above ${fmtThreshold(s.accumulateBelow)}× support`;
    case 'paused':
      return 'price under support';
    case 'broken':
      return 'model treated as broken';
    case 'accumulate':
      return 'no room to borrow';
    case null:
      return '';
  }
}

/** The verdict's pause clause. Policy off → today's words exactly (' · drawing stopped at month N' /
 *  ' · drawing paused at month N, resumed at M'). Policy on → the zone:
 *  ' · borrowing paused at month 12 (price above 1.5× support), resumed at 40'. */
export function drawPauseClause(
  sim: Pick<CyclingResult, 'stopMonth' | 'drawingResumedMonth' | 'policyApplied'>
    & { rows: ReadonlyArray<Pick<CyclingRow, 'policyZone'>> },
  s: EffectivePolicySettings | null,
): string {
  if (sim.stopMonth === null) return '';
  if (!sim.policyApplied || s === null) {
    return sim.drawingResumedMonth === null
      ? ` · drawing stopped at month ${sim.stopMonth}`
      : ` · drawing paused at month ${sim.stopMonth}, resumed at ${sim.drawingResumedMonth}`;
  }
  const why = stopReason(sim.rows[sim.stopMonth]?.policyZone ?? null, s);
  const reason = why === '' ? '' : ` (${why})`;
  return sim.drawingResumedMonth === null
    ? ` · borrowing stopped at month ${sim.stopMonth}${reason}`
    : ` · borrowing paused at month ${sim.stopMonth}${reason}, resumed at ${sim.drawingResumedMonth}`;
}

// ── the strip, the chart line, the cold gate ─────────────────────────────────────────────────────────────────

/** Month-by-month zones for the strip (one cell per month, m0..N) plus the counts its aria-label reads — over m ≥ 1,
 *  so they are the engine's own `monthsInZone` and sum to the horizon. Empty when the policy was not applied. */
export function zoneStrip(rows: ReadonlyArray<Pick<CyclingRow, 'm' | 'policyZone'>>):
  { zones: PolicyState[]; counts: Record<PolicyState, number> } {
  const counts = zeroZones();
  const zones: PolicyState[] = [];
  for (const r of rows) {
    if (r.policyZone === null) return { zones: [], counts: zeroZones() };
    zones.push(r.policyZone);
    if (r.m >= 1) counts[r.policyZone] += 1;
  }
  return { zones, counts };
}

/** The policy's Coinbase limit expressed at TODAY'S price, as a percentage: cbStopEffPct ÷ multiple. On the support
 *  line it is a flat 60; at 2× support it is 30. Null when the row has no multiple. Drawn as a dashed series on the
 *  LTV charts — the whole idea of the policy in one line. */
export function policyLimitPct(row: Pick<CyclingRow, 'multiple'>, cbStopEffPct: number): number | null {
  const k = row.multiple;
  return k !== null && Number.isFinite(k) && k > 0 && Number.isFinite(cbStopEffPct) ? cbStopEffPct / k : null;
}

/** Whether cold can be non-zero, so the Cold column and the cold chart series show: the classic sweep is on, or the
 *  policy's own sweep runs (it replaces the buffer while the policy applies). */
export function coldShown(coldBufferPct: number, sim: Pick<CyclingResult, 'policyApplied'>): boolean {
  return sim.policyApplied || coldBufferPct > 0;
}
