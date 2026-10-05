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

/** The ⓘ — what the futures are. It names no count; the title beside it does (R12), so a cut to 300 reads right everywhere. */
export const FUTURES_TIP: readonly string[] = [
  "Random price futures built from the app's own model: the 4-year cycle running early or late, tops and troughs "
    + 'that vary, a 15–45% crash about every five years, and the power law itself wrong — its slope and its level.',
  'Harsher than the last 15 years, on purpose.',
  'Each future runs these settings through the same engine as the path above. The futures stay the same when you change '
    + "a setting, so a change in these numbers is the setting's doing.",
  'A model of a model — not a forecast, and not advice.',
];

/** The ⓘ's accessible name (D-1: a word, so it lives here, not in the face). */
export const FUTURES_TIP_LABEL = 'About the futures';

/** What the readout and the card's line say until the first run lands. */
export const FUTURES_RUNNING = 'Running the futures…';

const fmtBtc = (x: number): string => `${x.toFixed(2)} ₿`;
const fmtCount = (n: number): string => n.toLocaleString('en-US');

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

/** k futures of n as a share — "none" and "all" only when it is exactly none or all, so never a rounded "0%" or "100%". */
export function shareText(k: number, n: number): string {
  if (!(n > 0)) return '—';
  if (k <= 0) return 'none';
  if (k >= n) return 'all';
  const p = (k / n) * 100;
  return `${p < 10 || p > 99 ? p.toFixed(1) : Math.round(p)}%`;
}

/** The readout's title: the count, and the face's own horizon. */
export function futuresTitle(count: number, months: number): string {
  return `Across ${fmtCount(count)} futures · ${horizonText(months)}`;
}

/** The Strategy face's readout. */
export function futuresReadout(s: FuturesSummary): FuturesReadout {
  const seized: FuturesRow = {
    label: 'Coinbase seizes',
    value: shareText(s.seized, s.count),
    sub: s.countsSeizures ? 'of the futures' : 'of the futures, during a month',
  };
  if (!s.countsSeizures) {
    return {
      rows: [seized],
      note: 'The model counts a seizure during the month only under the support policy, so without it these futures show '
        + 'the chance alone.',
    };
  }
  return {
    rows: [
      { label: 'You own', value: rangeText(s.yoursBtc), sub: `in 8 of 10 futures · middle ${fmtBtc(s.yoursBtc.p50)}` },
      { label: 'In your cold storage', value: rangeText(s.coldBtc), sub: `in 8 of 10 futures · middle ${fmtBtc(s.coldBtc.p50)}` },
      { label: 'Beats never borrowing', value: shareText(s.beatsNeverDraw, s.count), sub: 'of the futures, all-in' },
      seized,
    ],
    note: null,
  };
}

/**
 * The Support policy card's last line — what the settings buy and what they risk; FUTURES_RUNNING until a run lands.
 * When every future seizes it names the count ("in all 1,000", W-1); with the policy off it reads "during a month", and
 * the comma before it only when some seize (W-2).
 */
export function futuresCardLine(s: FuturesSummary | null): string {
  if (s === null) return FUTURES_RUNNING;
  const head = `${fmtCount(s.count)} futures to ${horizonText(s.months)}:`;
  const seized = s.seized <= 0 ? 'Coinbase never seizes'
    : s.seized >= s.count ? `Coinbase seizes in all ${fmtCount(s.count)}`
    : `Coinbase seizes in ${shareText(s.seized, s.count)}`;
  if (!s.countsSeizures) return `${head} ${seized}${s.seized <= 0 ? '' : ','} during a month.`;
  return `${head} you own ${rangeText(s.yoursBtc)} in 8 of 10; ${seized}.`;
}
