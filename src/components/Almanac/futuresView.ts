import type { FuturesSummary } from '../../simulation/monteCarlo';

/**
 * The futures' words — every sentence and figure the Strategy readout and the Support policy card's line show is built
 * here, and the components only place them (I31: the faces compose no sentence). Pure.
 *
 * The owner's four numbers (D1): the coins you own at the end (the range 8 futures in 10 end inside, and the middle),
 * the coins in your own cold storage at the end, how often the plan beats never borrowing, and how often Coinbase
 * seizes. All four show only under the applied support policy (R1). Without it — the policy off or not run, or another
 * strategy — the model's month-end reading rescues loans Morpho takes during the month, so the coin figures would count
 * coins that are gone; the readout then shows the chance of a seizure alone, counted on the way down
 * (`FuturesSummary.countsSeizures`).
 *
 * On screen the 1,000 are "simulations" (the owner's W-4): no word built here says "future"; the code's names keep
 * it. When some simulations seize, the words say when (W-3): the share of ALL the simulations seized within the first
 * year, and the month by which half of the seizures have happened.
 */

/** How long a face's inputs must hold still before the futures run again — a slider drag changes them every step. */
export const FUTURES_DEBOUNCE_MS = 300;

export interface FuturesRow {
  label: string;
  value: string;
  sub: string;
}

export interface FuturesReadout {
  rows: FuturesRow[];
  /** Why the chance shows alone (the policy did not apply); null when all four numbers show. */
  note: string | null;
}

/** The ⓘ — what the simulations are, and that they are not the Price path card's four paths (the owner's question;
 *  R14). It names no count; the title beside it does (R12). */
export const FUTURES_TIP: readonly string[] = [
  "Random simulations of the price, drawn from the app's own model — "
    + 'not the four Price paths (Support, Fair, Resistance, 4-yr cycle). Each gets its own luck: the 4-year cycle '
    + 'running early or late, tops and bottoms that vary, a 15–45% crash about every five years, and the power law '
    + 'itself a little wrong — its slope and its level.',
  "They all start at today's price. Harsher than the last 15 years, on purpose.",
  'Each runs your settings through the same engine as the Price path above. The simulations stay the same when you '
    + "change a setting, so a change in these numbers is the setting's doing.",
  'A model of a model — not a forecast, and not advice.',
];

/** The ⓘ's accessible name (D-1: a word, so it lives here, not in the face). */
export const FUTURES_TIP_LABEL = 'About the simulations';

/** What the readout and the card's line say until the first run lands. */
export const FUTURES_RUNNING = 'Running the simulations…';

/** A coin figure in a sub: a no-break space holds the ₿ to its figure, so a wrapping sub never leaves it alone on a
 *  line (W-5; measured on phones: alone in 22 of 56 subs with a plain space, 0 with this one). */
const fmtBtc = (x: number): string => `${x.toFixed(2)}\u00a0₿`;
const fmtCount = (n: number): string => n.toLocaleString('en-US');
/** A fixed month table, never toLocaleDateString — locale abbreviations vary by runtime (fmtTurnDate's rule). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The 10th to the 90th percentile as printed: one figure when both print the same, "none" when that figure is 0.00. */
export function rangeText(s: { p10: number; p90: number }): string {
  const lo = s.p10.toFixed(2), hi = s.p90.toFixed(2);
  if (lo === hi) return hi === '0.00' ? 'none' : `${hi} ₿`;
  return `${lo}–${hi} ₿`;
}

/** The horizon in the faces' unit: "20 yr", "5 yr", "1.5 yr". */
export function horizonText(months: number): string {
  const y = months / 12;
  return `${Number.isInteger(y) ? y : y.toFixed(1)} yr`;
}

/** The horizon in a sentence: "the next year", "the next 5 years", "the next 1.5 years". */
export function horizonWords(months: number): string {
  const y = months / 12;
  return y === 1 ? 'the next year' : `the next ${Number.isInteger(y) ? y : y.toFixed(1)} years`;
}

/** Month `m` after a `yyyy-mm-dd` start, as "Nov 2029" — calendar arithmetic, no time zone. */
export function monthYear(startISO: string, m: number): string {
  const y = Number(startISO.slice(0, 4)), m0 = Number(startISO.slice(5, 7)) - 1;
  const k = m0 + m;
  return `${MONTHS[((k % 12) + 12) % 12]} ${y + Math.floor(k / 12)}`;
}

/** k simulations of n as a share — "none" and "all" only when it is exactly none or all, so never a rounded "0%" or
 *  "100%". */
export function shareText(k: number, n: number): string {
  if (!(n > 0)) return '—';
  if (k <= 0) return 'none';
  if (k >= n) return 'all';
  const p = (k / n) * 100;
  return `${p < 10 || p > 99 ? p.toFixed(1) : Math.round(p)}%`;
}

/** The readout's title: the count, and the face's own horizon. */
export function futuresTitle(count: number, months: number): string {
  return `Across ${fmtCount(count)} simulations · ${horizonText(months)}`;
}

/**
 * The two seizure shares as printed, one decision for the card's line and the readout (the owner's W-3): `total`, the
 * share of ALL the simulations seized; `early`, the share of them seized within the first year — "all" when every
 * seizure falls in it, "none" when none does, null at a horizon of a year or less, where "within the first year" would
 * say nothing. Read only when some seize (whenText's guard).
 *
 * "all" is decided FIRST, so a whole year never reads "100.0%". Then, when the two would print alike while the counts
 * differ — "19% of them — 19% within the first year" reads as "all" — BOTH print to one decimal (O-3, R16): "19.1% of
 * them — 19.0% within …", never "19% … 19.0%". One decimal tells any two counts apart at 1,000 simulations or fewer.
 */
export function seizedShares(s: FuturesSummary): { total: string; early: string | null } {
  const total = shareText(s.seized, s.count);
  if (s.months <= 12) return { total, early: null };
  if (s.seizedWithinYear >= s.seized) return { total, early: 'all' };
  const early = shareText(s.seizedWithinYear, s.count);
  if (early !== total) return { total, early };
  const tenth = (k: number): string => `${((k / s.count) * 100).toFixed(1)}%`;
  return { total: tenth(s.seized), early: tenth(s.seizedWithinYear) };
}

/**
 * WHEN Coinbase seizes (the owner's W-3): the first year's share (seizedShares' `early`; left out at a horizon of a
 * year or less), then the month by which half of the seizures have happened. '' when none seizes. `long` is the card's
 * sentence; short, the readout's sub.
 */
export function whenText(s: FuturesSummary, long: boolean): string {
  if (s.seized <= 0 || s.seizedHalfByMonth === null) return '';
  // "half of those SEIZURES", so it can never read as half of all the simulations
  const half = `half of ${long ? 'those' : 'the'} seizures by ${monthYear(s.startISO, s.seizedHalfByMonth)}`;
  const { early } = seizedShares(s);
  return early === null ? half : `${early} within ${long ? 'the first' : 'a'} year, ${half}`;
}

/** The Strategy face's readout. */
export function futuresReadout(s: FuturesSummary): FuturesReadout {
  const when = whenText(s, false);
  const seized: FuturesRow = {
    label: 'Coinbase seizes',
    value: seizedShares(s).total,
    sub: when === '' ? 'of the simulations' : `of the simulations — ${when}`,
  };
  if (!s.countsSeizures) {
    return {
      rows: [seized],
      note: "Without the support policy the model checks the loan only at each month's end, and can miss a seizure in "
        + 'between — so the coin figures would be wrong. These simulations show just the chance of a seizure, counted at '
        + "the first dip past Coinbase's line.",
    };
  }
  // A range that prints "none" has nothing in its middle either (p10 = p90 = 0.00 forces p50 = 0.00), so its sub
  // names no 0.00 ₿.
  const end = (x: { p10: number; p50: number; p90: number }) => (rangeText(x) === 'none'
    ? 'where 8 of 10 simulations end'
    : `where 8 of 10 simulations end · half end above ${fmtBtc(x.p50)}`);
  return {
    rows: [
      { label: 'You own', value: rangeText(s.yoursBtc), sub: end(s.yoursBtc) },
      { label: 'In your cold storage', value: rangeText(s.coldBtc), sub: end(s.coldBtc) },
      { label: 'Beats never borrowing', value: shareText(s.beatsNeverDraw, s.count), sub: 'of the simulations, all-in' },
      seized,
    ],
    note: null,
  };
}

/**
 * The Support policy card's last line, in sentences that name what they count (the owner's device check asked "8 of 10
 * what?" and "which month or year?"); FUTURES_RUNNING until a run lands. Its shapes:
 *   on:  "Over the next 5 years, in 1,000 simulations: in 8 of 10, you end owning a–b ₿; Coinbase seizes in x% of
 *         them — y% within the first year, half of those seizures by <Mon YYYY>."
 *   off: "Over the next 5 years, in 1,000 simulations: Coinbase seizes in x% of them — y% within the first year, …"
 * and "Coinbase seizes in none of them." when none does. x and y are seizedShares'.
 */
export function futuresCardLine(s: FuturesSummary | null): string {
  if (s === null) return FUTURES_RUNNING;
  const head = `Over ${horizonWords(s.months)}, in ${fmtCount(s.count)} simulations:`;
  const when = whenText(s, true);
  const seized = s.seized <= 0 ? 'Coinbase seizes in none of them'
    : `Coinbase seizes in ${seizedShares(s).total} of them${when === '' ? '' : ` — ${when}`}`;
  if (!s.countsSeizures) return `${head} ${seized}.`;
  return `${head} in 8 of 10, you end owning ${rangeText(s.yoursBtc)}; ${seized}.`;
}
