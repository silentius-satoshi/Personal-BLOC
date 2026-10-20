import type { CyclingResult, CyclingRow } from '../../simulation/cyclingSim';
import type { PlacementPlan } from '../../simulation/placement';
import { MOVE_THRESHOLD_BTC } from '../../simulation/placement';
import { cbSeizurePrice } from '../../simulation/cbMetrics';
import { CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { fmtBelowPct, shownBtc, shownUsd, policyIgnoredNote, goalActs, goalDefenseOf } from './supportPolicyView';
import { fmtUSDCents, fmtLtvPct, toCents } from '../../utils/format';
import { planSchedule, type Action, type ActionKind } from './decisionView';
import { fmtTurnDate } from './cyclingFaceView';
import type { BreakerSeed } from './supportPolicyInputs';
import type { MonthlyLogEntry } from '../../simulation/types';
import type { NdpInfo } from '../../simulation/runAdvisor';
import { cbOverLimitAtMonthEnd } from './planRun';

/**
 * The plan of record's month, as words (Run 2 — §4.3, §4.5). PURE: every sentence the main screens show for the
 * plan is built here, where a test reaches it (I31). The screens render these and compose nothing.
 *
 * One card, one month, each fact once: a STATUS (is the month within the plan's limits?), the month's TO DO (THE MOVE
 * first, then the month's actions — exactly the Decision face's schedule rows), and AFTER (where the month leaves both
 * loans). The details — the catch-up, the why — sit behind a tap.
 *
 * 🔴 Facts, never "should" (D6, the not-advice line): the catch-up options are arithmetic on the run's own numbers.
 */

export type PlanTone = 'plain' | 'good' | 'warn' | 'bad';

const btc3 = (n: number): string => n.toFixed(3);
const btc4 = (n: number): string => n.toFixed(4);
/** A buy's ₿ at 4 dp — never "₿0.0000": a buy too small to show at 4 dp says so. */
const buyBtc = (n: number): string => (n >= 0.00005 ? `₿${btc4(n)}` : 'under ₿0.0001');

// ── the venues — the app's venue palette (the Ownership and Cycling faces' dots, the viewer's venue bar) ─────────

export type Venue = 'strike' | 'coinbase' | 'cold';
/** Strike white, Coinbase blue, cold storage orange — the faces' own venue colours. */
export const VENUE_COLOR: Readonly<Record<Venue, string>> = Object.freeze({
  strike: 'var(--text-primary)', coinbase: 'var(--coinbase)', cold: 'var(--btc)',
});
const VENUE_WORD = /(Strike|Coinbase|[Cc]old storage)/;
const venueOfWord = (w: string): Venue | null =>
  (w === 'Strike' ? 'strike' : w === 'Coinbase' ? 'coinbase' : /^[Cc]old storage$/.test(w) ? 'cold' : null);

/** A label's text cut at its venue words, each word carrying its venue — the screens colour those words. ONE rule for
 *  the dot and the words: a row's venues are the venue words its label names, in order. */
export function venueSegments(text: string): { text: string; venue: Venue | null }[] {
  return text.split(VENUE_WORD).filter((t) => t !== '').map((t) => ({ text: t, venue: venueOfWord(t) }));
}
export function venuesOf(label: string): Venue[] {
  return venueSegments(label).flatMap((sg) => (sg.venue !== null ? [sg.venue] : []));
}

// ── TO DO — the month's actions, in words ──────────────────────────────────────────────────────────────────────

interface RowWords {
  label: string;
  tone: PlanTone;
  note?: (a: Action, r: CyclingRow) => string | null;
  amount: (a: Action, r: CyclingRow) => string;
}
/** A to-do amount, to the cent — like every dollar figure on THIS MONTH and Daily (Run 2.1, BL19). */
const usdOf = (a: Action): string => fmtUSDCents(a.usd ?? 0);
/** Run 2.1, R2-a — the run is flat at today's price (D4), so a later month's buy is its dollars at today's price. */
export const PLAN_AT_TODAYS_PRICE = "at today's price";
/** A buy's dollars; in a month after this one, with the price the ₿ is reckoned at (the run's month m > 1). */
const buyNote = (usd: number, m: number): string =>
  (m > 1 ? `${fmtUSDCents(usd)} · ${PLAN_AT_TODAYS_PRICE}` : fmtUSDCents(usd));
const btcOf = (a: Action): string => `₿${btc3(a.btc ?? 0)}`;
const monthEnd = (a: Action): string => ((a.btc ?? 0) < MOVE_THRESHOLD_BTC ? 'small, can wait' : 'month-end');

/** The words for every action kind — a `Record`, so a kind added to the Decision face's ONE table cannot reach the
 *  main screens without its words (the compiler forces it). Amounts are the action's own (`Action.usd` / `.btc`);
 *  dollars to the cent (Run 2.1).
 *  Coins read "A → B" with a ₿ amount; debt says "debt" with a $ amount. A row's venues come from its label. */
const WORDS: Record<ActionKind, RowWords> = {
  draw:                    { label: 'Draw on Strike', tone: 'plain', note: () => 'for bills', amount: usdOf },
  cashToBills:             { label: 'Bills from cash', tone: 'warn', note: () => 'your reserve', amount: usdOf },
  unpaid:                  { label: 'Bills go unpaid', tone: 'warn', amount: usdOf },
  payMinimum:              { label: "Pay Strike's minimum", tone: 'plain', note: () => 'from income', amount: usdOf },
  repayStrike:             { label: 'Repay Strike', tone: 'plain', note: () => 'spare income', amount: usdOf },
  repayCoinbase:           { label: 'Repay Coinbase', tone: 'plain', note: () => 'spare income', amount: usdOf },
  buy: {
    label: 'Buy bitcoin', tone: 'good', note: (a, r) => buyNote(a.usd ?? 0, r.m),
    amount: (a, r) => buyBtc(r.price > 0 ? (a.usd ?? 0) / r.price : 0),
  },
  strikeToCoinbase:        { label: 'Strike → Coinbase', tone: 'plain', note: monthEnd, amount: btcOf },
  strikeToCold:            { label: 'Strike → cold storage', tone: 'plain', amount: btcOf },
  refinance: {
    label: 'Strike debt → Coinbase', tone: 'plain',
    note: (_a, r) => (shownUsd(r.refinancedFeeUsd) ? `fee ${fmtUSDCents(r.refinancedFeeUsd)}` : null), amount: usdOf,
  },
  coldToCoinbase:          { label: 'Cold storage → Coinbase', tone: 'warn', note: () => 'defends it', amount: btcOf },
  strikeReleaseToCoinbase: { label: 'Strike → Coinbase', tone: 'warn', note: () => 'defends it', amount: btcOf },
  debtShift:               { label: 'Pay Coinbase from Strike', tone: 'warn', note: () => 'defends it', amount: usdOf },
  coldToStrike:            { label: 'Cold storage → Strike', tone: 'warn', note: () => 'holds its line', amount: btcOf },
  defenseShort:            { label: 'Coinbase defense falls short', tone: 'bad', amount: usdOf },
  cashCure:                { label: 'Cash → Strike', tone: 'bad', note: () => 'margin call', amount: usdOf },
  coldCure:                { label: 'Cold storage → Strike', tone: 'bad', note: () => 'margin call', amount: btcOf },
  strikeSale:              { label: 'Strike sells coins', tone: 'bad', note: () => 'margin call', amount: btcOf },
  coinbaseToCold:          { label: 'Coinbase → cold storage', tone: 'plain', note: monthEnd, amount: btcOf },
  liquidation:             { label: 'Coinbase liquidates', tone: 'bad', amount: () => '' },
};

/** For the venue sweep (a test): every kind's label. */
export const PLAN_ROW_LABELS: Readonly<Record<ActionKind, string>> = Object.freeze(Object.fromEntries(
  (Object.keys(WORDS) as ActionKind[]).map((k) => [k, WORDS[k].label]),
) as Record<ActionKind, string>);

export interface PlanRow {
  key: string;
  /** `null` for the muted "—" anchors (a month with no buy or no draw). */
  kind: ActionKind | null;
  tone: PlanTone;
  /** The venue words the label names, in order (`venuesOf`). */
  venues: Venue[];
  label: string;
  note: string | null;
  amount: string;
  muted: boolean;
}

const TONE_FILL: Record<PlanTone, string> = { plain: 'var(--text-muted)', good: 'var(--green)', warn: 'var(--amber)', bad: 'var(--red)' };

/** A row's dot, as a CSS background: its venue's colour; two venues split it down the middle, in the label's order
 *  (Strike → Coinbase: white | blue); a row naming no venue keeps its tone's colour (the buy green). A muted "—" anchor
 *  is a ring. Both screens (THIS MONTH, Daily) draw it from here.
 *  ⚠ Run 2.1 (F8) — the split ends `border-box`. Set as the `background` shorthand, the gradient otherwise starts inside
 *  the dot's border (THIS MONTH's `.pmDot` has a 1px transparent one) and repeats under it: a 1px sliver of the other
 *  colour at each edge. A class rule can't fix it — the inline shorthand resets `background-origin` (measured). */
export function planRowDot(r: PlanRow): { background: string; ring: string | null } {
  if (r.muted) return { background: 'transparent', ring: 'var(--text-muted)' };
  const [a, b] = r.venues;
  if (a !== undefined && b !== undefined && a !== b) {
    return { background: `linear-gradient(90deg, ${VENUE_COLOR[a]} 0 50%, ${VENUE_COLOR[b]} 50% 100%) border-box`, ring: null };
  }
  return { background: a !== undefined ? VENUE_COLOR[a] : TONE_FILL[r.tone], ring: null };
}

/** A warning shows in the row's note and amount, so a venue-coloured dot never hides it; today's move is in the accent.
 *  `undefined` = the screen's default. */
export function planRowNoteColor(r: PlanRow): string | undefined {
  if (r.tone === 'warn' || r.tone === 'bad') return TONE_FILL[r.tone];
  if (r.note === 'today') return 'var(--orange)';
  return undefined;
}
export function planRowAmountColor(r: PlanRow): string | undefined {
  return r.tone === 'warn' || r.tone === 'bad' ? TONE_FILL[r.tone] : undefined;
}

function rowOf(a: Action, r: CyclingRow, i: number, today: boolean): PlanRow {
  const w = WORDS[a.kind];
  // ⚠ N5 — today's legs are never "small, can wait": when today's total is worth moving, every leg moves today.
  return {
    key: `${today ? 'today' : 'month'}-${a.kind}-${i}`, kind: a.kind, tone: w.tone, venues: venuesOf(w.label), label: w.label,
    note: today ? 'today' : (w.note ? w.note(a, r) : null), amount: w.amount(a, r), muted: false,
  };
}

const anchor = (key: string, label: string): PlanRow => ({
  key, kind: null, tone: 'plain', venues: venuesOf(label), label, note: null, amount: '—', muted: true,
});

/**
 * The plan's month m as rows — EXACTLY the Decision face's schedule (`planSchedule`, the ONE field → action table and
 * its completeness sweep, I13): this month (m = 1) starts with Today's row (THE MOVE), then the month's own actions in
 * the engine's order. The buy and the draw always show — a muted "—" when the month has none, so a paused buy is
 * visible, not missing.
 */
export function planMonthActions(sim: CyclingResult, plan: PlacementPlan, m: number): PlanRow[] {
  const sched = planSchedule(sim, plan);
  const row = sim.rows.find((r) => r.m === m);
  const month = sched.find((s) => s.m === m);
  if (!row || !month) return [];
  const opening = sim.rows.find((r) => r.m === 0) ?? row;
  const today = m === 1 ? (sched.find((s) => s.m === 0)?.actions ?? []) : [];
  const out: PlanRow[] = [
    ...today.map((a, i) => rowOf(a, opening, i, true)),
    ...month.actions.map((a, i) => rowOf(a, row, i, false)),
  ];
  const monthHas = (k: ActionKind): boolean => month.actions.some((a) => a.kind === k);
  if (!monthHas('buy')) out.push(anchor('none-buy', 'Buy bitcoin'));
  if (!monthHas('draw')) out.push(anchor('none-draw', 'Draw on Strike'));
  return out;
}

// ── STATUS — one line: is the month within the plan's limits? ─────────────────────────────────────────────────

export interface PlanStatus {
  tone: PlanTone;
  title: string;
  body: string | null;
  /** Behind a tap ("To be within it today"): the catch-up as facts (D6). Empty when there is none. */
  fixes: string[];
}

export interface PlanStatusFacts {
  /** The run's first month back within Coinbase's limit (`firstMonthUnderLimit`), or null. */
  monthsBackUnder: number | null;
  cbStop: number;
  /** S₀ — today's support (THE MOVE's). */
  support0: number;
  coldBtc: number;
}

/** Over Coinbase's limit at month-end — planRun's ONE rule (the switch month reads it too). */
const overAtMonthEnd = cbOverLimitAtMonthEnd;

/** What spare income does about an over-limit month — the engine's own figures, never a promise: the restore takes
 *  spare income FIRST (after the bills and a minimum paid from income), so a month still over at month-end that repays
 *  Coinbase nothing had none to spare (STATUS sweeps it). */
const SPARE_REPAYS = 'Spare income repays it before the plan borrows again';
/** BL14 (δ3) — at a goal month the plan does not borrow again while it stays there: the N8 rule drops the promise. */
const GOAL_SPARE_REPAYS = 'Spare income repays it';
const spareRepays = (row: Pick<CyclingRow, 'atGoal'>): string => (row.atGoal === true ? GOAL_SPARE_REPAYS : SPARE_REPAYS);
/** BL14 (δ2) — the unpaid body at a goal month: the line had room; the goal skipped the draw. */
export const GOAL_UNPAID_BODY = "At your goal the plan borrows nothing for the bills, so income and the cash reserve fall short at today's price.";
const NO_SPARE = 'No spare income repays it this month';
const BACK_WITHIN = "Back within your plan's limit this month";

/**
 * §4.5 / D6 — the month's one status. This month (m = 1) reads TODAY's fact (THE MOVE's `cbOverCeilingUsd` at S₀: the
 * switch month); a later month reads its own month-end (`cbCeilingHeadroomUsd` at that month's support), so scrubbing
 * the year tells the cure month by month. Amber, never red, for over the limit (D7); red only for a seizure. When the
 * engine refuses the policy (`policyIgnoredReason`), every month says so in the Decision card's own sentence — no limit
 * at support is in force, so none is claimed.
 */
export function planStatus(sim: CyclingResult, plan: PlacementPlan, m: number, f: PlanStatusFacts): PlanStatus {
  const row = sim.rows.find((r) => r.m === m);
  if (!row) return { tone: 'plain', title: '', body: null, fixes: [] };
  const pct = Math.round(f.cbStop * 100);
  if (m === 1 && plan.state === 'cbPastLiquidation') {
    // The Decision card's own state line, in two parts.
    return {
      tone: 'bad', title: `Coinbase is at or past its ${Math.round(CB_LLTV * 100)}% liquidation line`,
      body: 'The policy moves nothing today.', fixes: [],
    };
  }
  if (sim.liqMonth === m) {
    return { tone: 'bad', title: "Coinbase liquidates the loan this month at today's price", body: null, fixes: [] };
  }
  // ⚠ N8 — after a liquidation the plan never borrows again, so "repays it before the plan borrows again" (and a green
  // "within your limits" on a loan that is gone) would be false. The engine marks every month after it.
  if (row.postLiquidation) {
    return {
      tone: 'bad', title: 'Coinbase has been liquidated — borrowing has ended',
      body: shownUsd(row.cbDebt) ? `${fmtUSDCents(row.cbDebt)} of Coinbase debt survives it.` : null, fixes: [],
    };
  }
  // The engine refused the policy (a Strike liquidation LTV at or under its 70% call — the Safety dashboard allows
  // 0–100): its limits are measured at today's price, so no status below (all of them about the limit at support) holds.
  if (sim.policyIgnoredReason !== null) {
    return { tone: 'warn', title: policyIgnoredNote(sim.policyIgnoredReason), body: null, fixes: [] };
  }
  if (m === 1 && plan.state !== 'unavailable' && shownUsd(plan.cbOverCeilingUsd)) {
    const X = plan.cbOverCeilingUsd;
    const A = f.cbStop > 0 && f.support0 > 0 ? X / (f.cbStop * f.support0) : Infinity;
    const when = f.monthsBackUnder !== null
      ? `back within it in about ${f.monthsBackUnder} month${f.monthsBackUnder === 1 ? '' : 's'} at today's price`
      : "not back within it in the next 12 months at today's price";
    const fixes: string[] = [];
    if (Number.isFinite(A)) {
      fixes.push(f.coldBtc >= A
        ? `Move ₿${btc3(A)} from cold storage to Coinbase, or repay ${fmtUSDCents(X)}.`
        : `Add ₿${btc3(A)} of collateral to Coinbase, or repay ${fmtUSDCents(X)}.`);
    }
    fixes.push(`Your limit: ${pct}% of what Coinbase's collateral is worth at support (${fmtUSDCents(f.support0)} per ₿ today).`);
    // Month 1's run: spare income repays it; or there is none to spare; or — over today by less than the month's rise in
    // support — the run is back within it at month-end without a repayment (the band reads that month-end).
    const body = shownUsd(row.cbRepaidUsd) ? `${spareRepays(row)} — ${when}.`
      : overAtMonthEnd(row) ? `${NO_SPARE} — ${when}.`
        : `${BACK_WITHIN}.`;
    return { tone: 'warn', title: `Coinbase is ${fmtUSDCents(X)} over your plan's limit`, body, fixes };
  }
  if (m > 1 && overAtMonthEnd(row)) {
    return {
      tone: 'warn',
      title: `Still ${fmtUSDCents(-(row.cbCeilingHeadroomUsd ?? 0))} over your plan's limit at month-end`,
      body: shownUsd(row.cbRepaidUsd) ? `${spareRepays(row)}.` : `${NO_SPARE}.`,
      fixes: [],
    };
  }
  if (shownUsd(row.unfundedUsd)) {
    return {
      tone: 'warn', title: `Bills ${fmtUSDCents(row.unfundedUsd)} short this month`,
      body: row.atGoal === true ? GOAL_UNPAID_BODY : 'Income, the line and the cash reserve fall short at today\'s price.', fixes: [],
    };
  }
  const prev = sim.rows.find((r) => r.m === m - 1);
  if (m > 1 && prev && overAtMonthEnd(prev)) {
    return { tone: 'good', title: BACK_WITHIN, body: null, fixes: [] };
  }
  return { tone: 'good', title: "Within your plan's limits", body: null, fixes: [] };
}

// ── THE GOAL (BL14) — one line beneath the status: net coins against the owner's goal ─────────────────────────────

/** Net coins and the goal, to the same number of places: three, or as many more (up to eight) as it takes for a figure
 *  below the goal never to print as the goal. `reached` is the engine's own verdict (`atGoalOf`, which forgives float
 *  dust): a figure at the goal by that rule prints to three places, never as eight digits of dust. */
export function goalPair(net: number, goal: number, reached: boolean = net >= goal): { net: string; goal: string } {
  for (let d = 3; d <= 8; d++) {
    const a = net.toFixed(d);
    const b = goal.toFixed(d);
    if (reached || a !== b || d === 8) return { net: a, goal: b };
  }
  return { net: net.toFixed(8), goal: goal.toFixed(8) };
}

/** A net-coins figure from `goalPair`, with its sign before the ₿ — owing more than every coin is worth reads "−₿0.200",
 *  never "₿-0.200". */
export function netBtcText(figure: string): string {
  return figure.startsWith('-') ? `−₿${figure.slice(1)}` : `₿${figure}`;
}

/**
 * BL14 (G1-C) — THIS MONTH's and Daily's goal line: the plan's own figure for the month — net coins at its decision, at
 * today's price (the run is flat, D4) once the month's Coinbase interest is added — against the owner's goal; at it, what
 * the month does instead. "This month", never "today": the Dashboard's tile reads today's position at the live price, so
 * with a Coinbase loan open the two differ by a month's interest as well as by the price ("Why this plan?" says so).
 * `null` with no goal. It never takes the status's place (the limits keep it) and names no move of its own: the rows
 * above it say what is repaid. Facts, never "should" (D6).
 */
export function planGoalLine(row: CyclingRow, goal: number | null): string | null {
  if (goal === null || row.atGoal === null || row.netCoinsBtc === null) return null;
  const p = goalPair(row.netCoinsBtc, goal, row.atGoal);
  if (!row.atGoal) return `Net coins this month: ${netBtcText(p.net)} of your ₿${p.goal} goal, at today's price.`;
  const at = `At your goal (net coins this month: ${netBtcText(p.net)} of ₿${p.goal})`;
  const acts = goalActs(goalDefenseOf(row));   // δ-L2 — a month whose crash defense drew on Strike says so
  // The legs the month ACTUALLY repaid — no order word, as `repaidTail`: a loan over its limit is restored first (Coinbase
  // before Strike), so the goal's own order (Strike, then Coinbase) is not always the month's. The rows above name the sums.
  const sk = shownUsd(row.strikeRepaidUsd);
  const cb = shownUsd(row.cbRepaidUsd);
  const kept = shownUsd(row.goalHeldUsd) ? `${fmtUSDCents(row.goalHeldUsd)} of spare income stays with you` : null;
  if (sk || cb) {
    const legs = sk && cb ? 'Strike and Coinbase' : sk ? 'Strike' : 'Coinbase';
    return `${at}: the plan ${acts} — spare income repays ${legs}${kept !== null ? `, and ${kept}` : ''}.`;
  }
  // A loan still open and nothing repaid: the bills (or a minimum paid from income) took all of it — say so.
  if (shownUsd(row.strikeBalance) || shownUsd(row.cbDebt)) {
    return `${at}: the plan ${acts} — no spare income is left this month to repay a loan.`;
  }
  return `${at}: the plan holds — it ${acts}${kept !== null ? `, and ${kept}` : ''}.`;
}

// ── AFTER — where the month leaves both loans ─────────────────────────────────────────────────────────────────

export interface PlanAfterRow { key: string; label: string; value: string; tone: PlanTone; venue: Venue | null }
/** A leg with nothing owed: the coins it holds — never "₿0.000 held". */
const heldOrNothing = (btc: number): string => (shownBtc(btc) ? `nothing owed · ₿${btc3(btc)} held` : 'nothing owed');
export interface PlanMeter {
  /** Coinbase's debt ÷ its collateral's value at the row's support. */
  atSupport: number;
  /** The plan's limit (the Coinbase stop, a fraction). */
  limit: number;
  /** Coinbase's seizure line, `CB_LLTV`. */
  seize: number;
  /** The engine's own verdict for the month (`cbCeilingHeadroomUsd`). */
  over: boolean;
}

/** The meter, read aloud (its `aria-label`). A sentence, so it lives here, not in the card (I31). */
export function planMeterAria(m: PlanMeter): string {
  const pct = (x: number): number => Math.round(x * 100);
  return `Coinbase is at ${pct(m.atSupport)}% of its collateral's value at support; your limit is ${pct(m.limit)}%, `
    + `and it seizes at ${pct(m.seize)}%.`;
}

/** Box 3, as rows: Strike, Coinbase at THE ROW'S support (the support the engine judged that month by), the price at
 *  which Coinbase seizes (the one per-row rule, `cbSeizurePrice`) and how far below today that is, and cold. With the
 *  policy refused (`policyApplied` false) no limit at support is in force, so there is no meter and no over-the-limit
 *  tone — the legs' figures stay. */
export function planAfter(
  row: CyclingRow, supportAtRow: number, cbStop: number, policyApplied: boolean,
): { rows: PlanAfterRow[]; meter: PlanMeter | null } {
  const rows: PlanAfterRow[] = [];
  rows.push({
    key: 'strike', label: 'Strike', tone: 'plain', venue: 'strike',
    value: shownUsd(row.strikeBalance)
      ? `${fmtUSDCents(row.strikeBalance)} · ${fmtLtvPct(row.strikeLtv)} LTV`
      : heldOrNothing(row.strikeCollateralBtc),
  });
  let meter: PlanMeter | null = null;
  if (shownUsd(row.cbDebt) || shownBtc(row.cbCollateralBtc)) {
    const atSupport = row.cbCollateralBtc > 0 && supportAtRow > 0 ? row.cbDebt / (row.cbCollateralBtc * supportAtRow) : Infinity;
    const over = !policyApplied ? false
      : row.cbCeilingHeadroomUsd !== null ? overAtMonthEnd(row) : atSupport > cbStop + 1e-9;
    rows.push({
      key: 'cb', label: 'Coinbase', tone: over ? 'warn' : 'plain', venue: 'coinbase',
      value: !shownUsd(row.cbDebt) ? heldOrNothing(row.cbCollateralBtc)
        : Number.isFinite(atSupport) ? `${fmtUSDCents(row.cbDebt)} · ${fmtLtvPct(atSupport)} at support`
          : `${fmtUSDCents(row.cbDebt)} · no collateral`,
    });
    if (policyApplied && Number.isFinite(atSupport)) meter = { atSupport, limit: cbStop, seize: CB_LLTV, over };
    // THE one per-row seizure rule (`cbSeizurePrice` — the Decision face's cliff and its ranking read it): none on a
    // liquidation month or after, under the dust floor, or with no collateral. F11's words for the distance.
    const liq = cbSeizurePrice(row);
    if (liq !== null && row.price > 0 && liq < row.price) {
      rows.push({
        key: 'seize', label: 'Seizes at', tone: 'plain', venue: null,
        value: `${fmtUSDCents(liq)} · ${fmtBelowPct(1 - liq / row.price)} below today`,
      });
    }
  }
  if (shownBtc(row.coldBtc)) rows.push({ key: 'cold', label: 'Cold storage', tone: 'plain', venue: 'cold', value: `₿${btc3(row.coldBtc)}` });
  return { rows, meter };
}

// ── the year's track — the scrubber, month by month ───────────────────────────────────────────────────────────

/** The scrubber's track as a gradient: past months faint; each plan month green (within the limits at month-end),
 *  amber (over Coinbase's limit, or bills unpaid) or red (Coinbase liquidated that month or before) — and never green
 *  when the engine refused the policy (no limit at support is in force to be within). Month k sits at (k − 1)/(N − 1)
 *  of the track and its band runs halfway to each neighbour, so the thumb always sits in its own month's colour. */
export function monthTrack(sim: CyclingResult, currentMonth: number, months = 12): string {
  const colour = (k: number): string => {
    if (k < currentMonth) return 'var(--text-faint)';
    const r = sim.rows.find((x) => x.m === k - currentMonth + 1);
    if (!r) return 'var(--text-faint)';
    if (r.postLiquidation) return 'var(--red)';
    if (overAtMonthEnd(r) || shownUsd(r.unfundedUsd)) return 'var(--amber)';
    return sim.policyApplied ? 'var(--green)' : 'var(--text-faint)';
  };
  const at = (x: number): string => `${Math.max(0, Math.min(100, (x / (months - 1)) * 100)).toFixed(2)}%`;
  const stops: string[] = [];
  for (let k = 1; k <= months; k++) stops.push(`${colour(k)} ${at(k - 1.5)} ${at(k - 0.5)}`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

// ── a past month — what the Ledger recorded (the plan is rebuilt each month and keeps no history, D14) ──────────

/** D13 — a crash day's status title: the Emergency Console is the authority on the day; the card shows its line. */
export const PLAN_CRASH_TITLE = 'Crash day — work from the Emergency Console';

const logged = (key: string, label: string, amount: string, tone: PlanTone = 'plain'): PlanRow => ({
  key, kind: null, tone, venues: venuesOf(label), label, note: null, amount, muted: false,
});

/** A logged month's rows — what was recorded, in the past tense; payments to the cent (Run 2.1). Never "$0": an amount
 *  under its floor is left out. */
export function loggedMonthRows(e: MonthlyLogEntry): PlanRow[] {
  const out: PlanRow[] = [];
  if (shownUsd(e.expensesActual)) out.push(logged('drew', 'Drew on Strike', fmtUSDCents(e.expensesActual)));
  if (shownBtc(e.btcBought)) out.push(logged('bought', 'Bought bitcoin', `₿${btc4(e.btcBought)}`, 'good'));
  if (shownUsd(e.paydown)) out.push(logged('paid', 'Paid down Strike', fmtUSDCents(e.paydown)));
  if (shownUsd(e.strikeMinPaid ?? 0)) out.push(logged('min', "Paid Strike's minimum", fmtUSDCents(e.strikeMinPaid ?? 0)));
  if (shownUsd(e.ndpPaid ?? 0)) out.push(logged('ndp', "Paid Strike's yearly payment", fmtUSDCents(e.ndpPaid ?? 0)));
  return out;
}

/** A logged month's end: the balances and LTVs the Ledger recorded (at that month's price). */
export function loggedMonthAfter(e: MonthlyLogEntry): PlanAfterRow[] {
  const out: PlanAfterRow[] = [
    { key: 'strike', label: 'Strike', tone: 'plain', venue: 'strike', value: `${fmtUSDCents(e.strikeBal)} · ${fmtLtvPct(e.strikeLtv)} LTV` },
  ];
  if (e.cbBal !== undefined) {
    out.push({
      key: 'cb', label: 'Coinbase', tone: 'plain', venue: 'coinbase',
      value: `${fmtUSDCents(e.cbBal)}${e.cbLtv !== undefined ? ` · ${fmtLtvPct(e.cbLtv)} LTV` : ''}`,
    });
  }
  return out;
}

/** The month that waits for the Ledger — THIS MONTH's sign-off pointer and a past month's status, in one wording. */
export function planSignoffLine(month: number): string {
  return `Month ${month} awaits sign-off in the Ledger`;
}

/** Under the sign-off pointer: the Ledger's month so far (`planLedgerParts`), or that nothing is logged yet. */
export function planSignoffSub(ledger: string | null): string {
  return ledger !== null ? `So far: ${ledger}` : 'Nothing logged yet this month';
}

/** A past month's one status: logged, awaiting sign-off, or nothing logged. */
export function loggedMonthStatus(e: MonthlyLogEntry | undefined, month: number): PlanStatus {
  if (e === undefined) return { tone: 'plain', title: `Nothing logged for month ${month}`, body: null, fixes: [] };
  if (e.confirmed === false) return { tone: 'warn', title: planSignoffLine(month), body: null, fixes: [] };
  return { tone: 'good', title: `Month ${month} is logged`, body: null, fixes: [] };
}

// ── the breaker, offline (§4.3, invariant 10) ────────────────────────────────────────────────────────────────

export type PlanBreakerSource =
  | { kind: 'fresh'; seed: BreakerSeed }
  /** `settled` — the history's fetch has finished (and failed); false while it is still loading. */
  | { kind: 'cached'; seed: BreakerSeed; settled: boolean }
  | { kind: 'loading' }
  | { kind: 'none' };

/** Today's fold when the price history arrived; else this device's cache of the last one; else nothing yet. */
export function planBreakerSource(fresh: BreakerSeed | null, cache: BreakerSeed | null, loading: boolean): PlanBreakerSource {
  if (fresh !== null) return { kind: 'fresh', seed: fresh };
  if (cache !== null) return { kind: 'cached', seed: cache, settled: !loading };
  return loading ? { kind: 'loading' } : { kind: 'none' };
}

/** What THIS MONTH says about the breaker — nothing when today's fold ran; the cache's date once the fetch has failed
 *  and the cache stands in; and with neither, that the month assumes the model isn't treated as broken (invariant 10).
 *  While the history is still loading the cache runs the month WITHOUT a line: the history is fetched on every visit,
 *  and a line that shows for the fetch's duration and then vanishes would jump the card on every open. */
export function planBreakerLine(b: PlanBreakerSource): string | null {
  switch (b.kind) {
  case 'fresh': return null;
  case 'cached': {
    if (!b.settled) return null;
    const d = new Date(b.seed.lastMonthEndISO);
    const when = Number.isFinite(d.getTime()) ? fmtTurnDate(d) : b.seed.lastMonthEndISO;
    return `Price history hasn't loaded — the breaker as of ${when}, this device's last reading.`;
  }
  case 'loading': return "Loading price history — until it arrives, this month assumes the model isn't treated as broken.";
  case 'none': return "Price history didn't load — this month assumes the model isn't treated as broken.";
  default: {
    const never: never = b;
    throw new Error(`unhandled breaker source: ${String(never)}`);
  }
  }
}

// ── the card's foot — the minimum, the Ledger, the year (Run 2: composed here, never in a screen) ──────────────

/** The due day's English ordinal — "1st", "2nd", "3rd", "4th" … "11th", "12th", "13th" … "21st", "22nd", "23rd". */
export function fmtDayOrdinal(n: number): string {
  const d = Math.trunc(n);
  const teen = d % 100 >= 11 && d % 100 <= 13;
  const suffix = teen ? 'th' : d % 10 === 1 ? 'st' : d % 10 === 2 ? 'nd' : d % 10 === 3 ? 'rd' : 'th';
  return `${d}${suffix}`;
}

/** §2b — what Strike's minimum is this month: the statement's figure when the owner entered it, else the plan's month-1
 *  interest — what Strike bills (the estimate the screens always used), never the part the plan could pay from income. */
export function planMinimumOwed(statementMin: number | null, interestUsd: number): number {
  return statementMin ?? interestUsd;
}

/** The minimum's line, income mode: null with nothing owed — no minimum, so no chip and never a "MISSED". The screen
 *  appends the status chip. */
export function planMinimumLine(owed: number, dueDay: number): string | null {
  return shownUsd(owed) ? `Strike's minimum is due the ${fmtDayOrdinal(dueDay)}` : null;
}

/** The minimum, roll mode: the interest that rolls into the line (null when there is none to roll). */
export function planInterestRollsLine(interestUsd: number, dueDay: number): string | null {
  return shownUsd(interestUsd) ? `Strike's interest, ${fmtUSDCents(interestUsd)}, rolls into the line on the ${fmtDayOrdinal(dueDay)}.` : null;
}
/** Daily's row note for the same fact. */
export function planInterestRollsNote(dueDay: number): string {
  return `rolls in the ${fmtDayOrdinal(dueDay)}`;
}

/** Strike's yearly payment (NDP) — the card's line while it is due (the screen shows it only then). */
export function planNdpLine(ndp: Pick<NdpInfo, 'status' | 'daysRemaining'>): string {
  if (ndp.status === 'never') return "Strike's yearly payment (NDP) isn't recorded yet.";
  if (ndp.status === 'overdue') return "Strike's yearly payment (NDP) is overdue.";
  if (ndp.daysRemaining === null) return "Strike's yearly payment (NDP) is due soon.";
  const n = Math.max(0, Math.round(ndp.daysRemaining));
  return n === 0 ? "Strike's yearly payment (NDP) is due today." : `Strike's yearly payment (NDP) is due in ${n} day${n === 1 ? '' : 's'}.`;
}

/** The month so far, from the Ledger — only what was logged ("$0 drawn" is not a fact worth a line); null when nothing.
 *  "paid" is both loans' paydowns: the plan repays Coinbase as well as Strike, and the journal keeps the two apart
 *  (`paydown` is Strike's, `cbPaydown` Coinbase's). */
export function planLedgerParts(streams: { draw: number; buyBtc: number; paydown: number; cbPaydown: number }): string | null {
  const paid = streams.paydown + streams.cbPaydown;
  const parts = [
    shownUsd(streams.draw) ? `${fmtUSDCents(streams.draw)} drawn` : null,
    shownBtc(streams.buyBtc) ? `₿${btc3(streams.buyBtc)} bought` : null,
    shownUsd(paid) ? `${fmtUSDCents(paid)} paid` : null,
  ].filter((x): x is string => x !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Daily's progress bars: the plan's month in the Ledger's OWN streams, so each bar compares like with like. Drawn is
 *  every Strike draw the month asks for — the bills', and a defense's that pays Coinbase down. Paid is every paydown
 *  the owner logs for it, on either loan: spare income's, a refinance's payment to Strike (borrowed on Coinbase), a
 *  defense's payment to Coinbase (drawn on Strike) and the cash reserve's margin cure. Bought is the buy's ₿. */
export function planLedgerTargets(r: CyclingRow): { draw: number; paid: number; buyBtc: number } {
  return {
    draw: r.strikeDrawn + r.defenseDrawnUsd,
    paid: r.strikeRepaidUsd + r.cbRepaidUsd + r.refinancedUsd + r.defenseDrawnUsd + r.cashToCureUsd,
    buyBtc: r.price > 0 ? r.btcBoughtUsd / r.price : 0,
  };
}

// ── the month log's planned figures (Run 3) ─────────────────────────────────────────────────────────────────────

/** The month's payments to Strike, as the Ledger logs them (a Strike paydown): spare income's, a refinance's (borrowed on
 *  Coinbase) and the cash reserve's margin cure. With Coinbase's — spare income's and a defense's — it is Daily's "paid"
 *  target (`planLedgerTargets`). Strike's minimum is not in it: the Ledger logs that as its own event. */
export function planStrikePaidUsd(r: CyclingRow): number {
  return r.strikeRepaidUsd + r.refinancedUsd + r.cashToCureUsd;
}

/** A strategy month's planned figures in the month log (Run 3): the "(proj)" values of the full-mode log and the month
 *  overlay, and the figures their forms start from — the plan of record's own run (D4: flat at today's price), never the
 *  Advisor's. Every figure is the run's month-end, at the run's price. */
export interface PlanLogRow {
  /** The strategy month, 1–12. */
  month: number;
  /** ₿ the month buys, at today's price. */
  btcBought: number;
  /** $ into bitcoin. */
  incomeToBtc: number;
  /** $ paid to Strike — `planStrikePaidUsd`, the Ledger's Strike paydown. */
  paydown: number;
  blocBalance: number;
  blocLtv: number;
  cbBalance: number;
  cbLtv: number;
}

/** The month log's planned rows. Strategy month k is the run's month k − currentMonth + 1 — one run for the month and
 *  the year, as THIS MONTH's card reads it — from the current month to 12. A past month has none: the plan is rebuilt
 *  each month and keeps no history (D14). */
export function planLogRows(sim: CyclingResult, currentMonth: number): PlanLogRow[] {
  const out: PlanLogRow[] = [];
  for (let k = Math.max(1, currentMonth); k <= 12; k++) {
    const r = sim.rows.find((x) => x.m === k - currentMonth + 1);
    if (!r) continue;
    out.push({
      month: k,
      btcBought: r.price > 0 ? r.btcBoughtUsd / r.price : 0,
      incomeToBtc: r.btcBoughtUsd,
      paydown: planStrikePaidUsd(r),
      blocBalance: r.strikeBalance,
      blocLtv: r.strikeLtv,
      cbBalance: r.cbDebt,
      cbLtv: r.cbLtv,
    });
  }
  return out;
}

/** One of Daily's progress bars, as words and a fill. */
export interface PlanBar {
  key: 'draw' | 'paid' | 'buy';
  label: string;
  /** "logged / planned"; the logged figure alone where the plan sets no target; "—" with neither. */
  value: string;
  /** 0–100 — 0 where there is no target: a bar can't fill toward nothing. */
  fillPct: number;
  /** No target this month (a past month, or a stream the plan doesn't plan): the value shows muted. */
  muted: boolean;
}

/** A buy's target only counts once it shows at 4 dp (`buyBtc`'s floor). */
const BAR_BTC_FLOOR = 0.00005;

/**
 * Daily's progress bars (Run 2.1, F13) — the month so far against the plan's month, in BOTH scopes: the plan is
 * monthly, so a day's slice against a month's target read "$0" most days. `logged` is the month's rollup — the current
 * month's in Week, the viewed month's in Month; `target` is `planLedgerTargets(pr1)`, or null for a past month (the
 * plan is rebuilt each month and keeps no target for one gone, D14). A stream with no target shows what was logged and
 * no fill — never "$0 / $0", never a full bar against nothing. To the cent (BL19).
 */
export function planBars(
  logged: { draw: number; paid: number; buyBtc: number },
  target: { draw: number; paid: number; buyBtc: number } | null,
): PlanBar[] {
  const fill = (a: number, b: number): number => Math.max(0, Math.min(100, (a / b) * 100));
  const usd = (key: 'draw' | 'paid', label: string, a: number, b: number | null): PlanBar => {
    if (b !== null && shownUsd(b)) {
      return { key, label, value: `${fmtUSDCents(a)} / ${fmtUSDCents(b)}`, fillPct: fill(a, b), muted: false };
    }
    return { key, label, value: shownUsd(a) ? fmtUSDCents(a) : '—', fillPct: 0, muted: true };
  };
  const tb = target === null ? null : target.buyBtc;
  const buy: PlanBar = tb !== null && tb >= BAR_BTC_FLOOR
    ? { key: 'buy', label: 'Buy ₿', value: `₿${btc4(logged.buyBtc)} / ${btc4(tb)}`, fillPct: fill(logged.buyBtc, tb), muted: false }
    : { key: 'buy', label: 'Buy ₿', value: logged.buyBtc >= BAR_BTC_FLOOR ? `₿${btc4(logged.buyBtc)}` : '—', fillPct: 0, muted: true };
  return [
    usd('draw', 'Draw', logged.draw, target === null ? null : target.draw),
    usd('paid', 'Paydown', logged.paid, target === null ? null : target.paid),
    buy,
  ];
}

/** Week's caption over the bars — they read the month so far, while the card's head is the day (Run 2.1, F13). */
export function planBarsCaption(month: number): string {
  return `Month ${month} so far`;
}

/** THIS MONTH's and Daily's NDP estimate — a month of interest on the Strike balance — kept to the cent (BL19). The
 *  engine's `getNdpStatus` rounds it to a whole dollar for full mode; the NDP card and the month review's seed read this,
 *  so they never print or store a rounded "$217.00". */
export function planNdpEstimateUsd(balance: number, aprPct: number): number {
  return toCents(balance * (aprPct / 100 / 12));
}

/** The balance the NDP is estimated on — the Strike balance read, else 15% of the line. ONE place, so THIS MONTH's card,
 *  Daily's NDP check and the month review's NDP seed can never estimate on different balances. */
export function planNdpBalance(actualBalance: number, creditLine: number): number {
  return actualBalance > 0 ? actualBalance : creditLine * 0.15;
}

/** The scrubber's price line: today's price, and where it sits against the month's support (the run is flat at today's
 *  price, so a later month reads the same price against that month's support). */
export function planPriceLine(price: number, support: number): string {
  return support > 0 && price > 0 ? `BTC ${fmtUSDCents(price)} · ${(price / support).toFixed(2)}× support` : `BTC ${fmtUSDCents(price)}`;
}

/** "Next month" — the plan's next month at a glance: what it draws, buys and repays (null when it does none of them);
 *  payments to the cent, and the buy at today's price (Run 2.1). */
export function planNextMonthLine(sim: CyclingResult): string | null {
  const next = sim.rows.find((r) => r.m === 2);
  if (!next) return null;
  const parts = [
    shownUsd(next.strikeDrawn) ? `draw ${fmtUSDCents(next.strikeDrawn)}` : null,
    shownUsd(next.btcBoughtUsd) ? `buy ${buyBtc(next.price > 0 ? next.btcBoughtUsd / next.price : 0)} ${PLAN_AT_TODAYS_PRICE}` : null,
    shownUsd(next.cbRepaidUsd) ? `repay Coinbase ${fmtUSDCents(next.cbRepaidUsd)}` : null,
    shownUsd(next.strikeRepaidUsd) ? `repay Strike ${fmtUSDCents(next.strikeRepaidUsd)}` : null,
  ].filter((x): x is string => x !== null);
  return parts.length > 0 ? `Next month: ${parts.join(' · ')}` : null;
}

/** Bills nothing in the plan pays, over the strategy year's months left (run months 1…monthsLeft) — the savings need. */
export function planSavingsLine(sim: CyclingResult, monthsLeft: number): string | null {
  const months = sim.rows.filter((r) => r.m >= 1 && r.m <= monthsLeft && shownUsd(r.unfundedUsd));
  const need = months.reduce((sum, r) => sum + r.unfundedUsd, 0);
  if (!shownUsd(need)) return null;
  return `Needs ~${fmtUSDCents(need)} from savings over the next ${months.length} month${months.length === 1 ? '' : 's'}`;
}

// ── the words around the card ─────────────────────────────────────────────────────────────────────────────────

/** Where the year beyond today's price lives (Run 3, D5): THIS MONTH and the Advisor tab link to the Decision face, which
 *  runs this plan through the same engine on the price paths — the Outlook's place, not a second projection. */
export const PLAN_PATHS_LINK = "Your plan on other price paths — the Almanac's Decision face";

/** THIS MONTH's expenses prompt (on the Outlook until Run 3) — its words BL26's: the subject named, and buttons that say
 *  what they do. The last three logged months before this one (`computeExpenseReanchor`) against the plan's monthly
 *  expenses, to the cent like every figure on THIS MONTH (BL19). ONE figure for the average: `toCents(avg)` is what the
 *  line prints, what Update's button names and what Update stores. */
export interface PlanReanchorWords { line: string; update: string; keep: string }
export function planReanchorWords(avg: number, expenses: number): PlanReanchorWords {
  const a = fmtUSDCents(toCents(avg));
  const e = fmtUSDCents(expenses);
  return {
    line: `Monthly expenses: your last 3 logged months averaged ${a}; your plan uses ${e}.`,
    update: `Update plan to ${a}`,
    keep: `Keep ${e}`,
  };
}

/** Run 4 (D-R4-1) — this month's move happens (`seeded`) and leaves Coinbase within its limit at support (the placement's
 *  own over-limit fact on the opening, past the dust floor). Safety's at-support line reads the position as it stands, so
 *  when it reads "over" and this holds, the move is the fix — it tops Coinbase up from Strike (the sweep in
 *  safetyAtSupport.test pins that this is the only way the two differ) — and the line says so. */
export function planMoveBringsCbWithin(plan: PlacementPlan): boolean {
  return plan.seeded && !shownUsd(plan.cbOverCeilingUsd);
}

/** D8 — the one-time note, once per device (dismissed is device-local). */
export function planSwitchNote(cbStop: number): string {
  return `New: your plan follows the support policy. Coinbase's limit is ${Math.round(cbStop * 100)}% of its value at `
    + "support, not at today's price.";
}

/** "Why this plan?" — the zone, then the Decision face's OWN sentences for that month's actions (`planSchedule`'s row:
 *  the same words the face prints), then what the limit is for — only while the engine applies the policy (refused,
 *  the limits are measured at today's price, as the status says). */
export function planMonthSummary(
  sim: CyclingResult, plan: PlacementPlan, m: number, supportAtRow: number, goal: number | null = null,
): string {
  const row = sim.rows.find((r) => r.m === m);
  const sched = planSchedule(sim, plan, fmtUSDCents).find((r) => r.m === m);   // the face's words, to the cent (BL19)
  if (!row || !sched) return '';
  const r = supportAtRow > 0 ? row.price / supportAtRow : NaN;
  // BL14 — with a goal set, the month's figure and how it is read (today's price, plus the month's Coinbase interest when a
  // loan carries into it — why it can sit under the Dashboard tile's "today"); at the goal, why the month buys nothing.
  let goalWords = '';
  if (goal !== null && row.atGoal !== null && row.netCoinsBtc !== null) {
    const prev = sim.rows.find((x) => x.m === m - 1);
    const read = prev !== undefined && shownUsd(prev.cbDebt)
      ? "at today's price once this month's Coinbase interest is added" : "at today's price";
    const p = goalPair(row.netCoinsBtc, goal, row.atGoal);
    goalWords = row.atGoal
      ? `Net coins this month, ${read}, are ${netBtcText(p.net)} — at or above your ₿${p.goal} goal, so the plan ${goalActs(goalDefenseOf(row))}. `
      : `Net coins this month, ${read}, are ${netBtcText(p.net)} — under your ₿${p.goal} goal. `;
  }
  const zone = `${Number.isFinite(r) ? `Price is ${r.toFixed(2)}× support. ` : ''}${goalWords}`;
  const doing = sched.actions.length > 0
    ? `This month the plan would: ${sched.actions.map((a) => a.text).join(' ')}`
    : 'This month the plan does nothing.';
  const over = overAtMonthEnd(row) && !shownUsd(row.btcBoughtUsd) && !row.postLiquidation
    ? ' Nothing buys bitcoin while Coinbase is over its limit at support.' : '';
  const limit = sim.policyApplied
    ? ' The limit is measured at support so that, within it, a fall to support stays short of '
      + `the line where Coinbase seizes (${Math.round(CB_LLTV * 100)}%).`
    : '';
  return `${zone}${doing}${over}${limit}`;
}
