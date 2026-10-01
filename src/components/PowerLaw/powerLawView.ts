import {
  PL_BAND_LABEL, PL_A_FAIR, PL_A_FLOOR, PL_A_CEILING, PL_B, GENESIS, plDateAtPrice, type PlBand,
} from '../../simulation/powerLaw';
import { fmtTurnDate } from '../Almanac/cyclingFaceView';
import { fmtTooltipUsd, fmtUSD } from '../../utils/format';

/**
 * The Power Law view model — PURE: no React, no store. Tested in `__tests__/powerLawView.test.ts`.
 *
 * The chart's: ONE series table that the chart's series, the tooltip rows and the legend all read, so the three can
 * never disagree; the tooltip, dated in UTC; the legend rule.
 *
 * The face's (spec `pbloc-spec-powerlaw-face-v1.md`): every piece of copy that carries a figure or a band name — the
 * title, the framing, the chart's title, today's tiles, the model card and the disclaimer (I8). The face types no figure
 * and no band name; it types only "The model" and the two chart states, as DecisionFace does.
 *
 * Colours (D1) — one colour per concept across faces: Support `--green` and Resistance `--amber` (the faces'
 * PATH_META), History `--btc` (the Decision chart's history area). Fair is the one exception. It is `--btc` on every
 * other face, but there it is a path choice; here it is a line drawn beside a `--btc` history in the same months, and
 * `--btc` sits only ΔE 10.8 from `--amber`. So here it takes the neutral `--text-secondary`, which is what this chart
 * always drew it in. Dashes (P5): Resistance only — Support is solid on both zoom charts.
 */

export type PlSeriesKey = 'price' | 'ceiling' | 'fair' | 'floor';
export interface PlSeries { key: PlSeriesKey; label: string; color: string; dash: 'solid' | 'dashed' }

/** Drawing order: History first (an area under the bands), then the bands top to bottom. */
export const PL_SERIES: readonly PlSeries[] = [
  { key: 'price',   label: 'History',             color: 'var(--btc)',            dash: 'solid' },
  { key: 'ceiling', label: PL_BAND_LABEL.ceiling, color: 'var(--amber)',          dash: 'dashed' },
  { key: 'fair',    label: PL_BAND_LABEL.fair,    color: 'var(--text-secondary)', dash: 'solid' },
  { key: 'floor',   label: PL_BAND_LABEL.floor,   color: 'var(--green)',          dash: 'solid' },
];

export interface PlTooltipRow { key: PlSeriesKey; label: string; color: string; text: string }

/**
 * The tooltip for the weekly row at `t`. The head is the row's date in UTC, "D Mon YYYY": the rows are UTC midnights a
 * week apart, so a month alone would repeat across four or five rows, and a zone behind UTC would read every row a day
 * early. Rows follow the table, keep only finite values > 0, and price through `fmtTooltipUsd` (never "$0").
 */
export function powerLawTooltip(
  t: number, values: Partial<Record<PlSeriesKey, number>>,
): { head: string; rows: PlTooltipRow[] } | null {
  if (!Number.isFinite(t)) return null;
  const rows: PlTooltipRow[] = [];
  for (const s of PL_SERIES) {
    const v = values[s.key];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      rows.push({ key: s.key, label: s.label, color: s.color, text: fmtTooltipUsd(v) });
    }
  }
  return rows.length === 0 ? null : { head: fmtTurnDate(new Date(t)), rows };
}

/**
 * P3 — the history is DRAWN once at least two rows carry a positive price: the log axis drops $0 (blockchain.info's
 * series is $0 until 2010-08-18), and a lone point draws nothing. The Decision chart's `history.length > 1`.
 */
export function historyDrawn(rows: readonly { price?: number }[]): boolean {
  let priced = 0;
  for (const r of rows) if (typeof r.price === 'number' && Number.isFinite(r.price) && r.price > 0) priced++;
  return priced >= 2;
}

/** The legend (D5) lists only what is drawn: History first when it is, then the three bands. */
export function legendEntries(drawn: boolean): readonly PlSeries[] {
  return drawn ? PL_SERIES : PL_SERIES.filter((s) => s.key !== 'price');
}

// ── The face (spec pbloc-spec-powerlaw-face-v1) ───────────────────────────────────────────────────────────────────

export const PL_FACE_TITLE = 'Power Law';
export const PL_FRAMING = "Bitcoin's price against time since the genesis block — a pattern, not a forecast.";
/**
 * The chart card's title (D4). In the card (2 × 15px of inset) the old "Price · history and the power-law bands" wrapped
 * to three or four lines beside the zoom toolbar on a phone, past the 32px title row, so the box dropped when the chart
 * arrived (F6). This one takes at most two lines at 360, 375 and 390, on both surfaces.
 */
export const PL_CHART_TITLE = 'Price and the bands';

export interface PlTile { key: 'price' | 'vsFair' | PlBand; label: string; value: string; sub: string; color: string }

const timesFair = (a: number): string => `${(a / PL_A_FAIR).toFixed(2)}× fair`;

/**
 * Today's tiles (I5): Price · vs Fair · Resistance · Fair · Support. With no live price (null, ≤ 0 or not finite) the
 * price reads "—" and vs Fair is left out — never NaN. (Stricter than the old side panel, which showed vs Fair for any
 * non-null price, so a price of 0 read −100.0%.) vs Fair prints a true minus and no sign at 0.0; its colour and its
 * words follow the TRUE side of the line, so a price 0.01% under fair reads "0.0%" in red, "below the fair line".
 */
export function todayTiles(livePrice: number | null, bands: Record<PlBand, number>): PlTile[] {
  const priced = livePrice !== null && Number.isFinite(livePrice) && livePrice > 0;
  const tiles: PlTile[] = [{
    key: 'price', label: 'Price', value: priced ? fmtUSD(livePrice) : '—',
    sub: priced ? 'live' : 'no live price yet', color: 'var(--text-primary)',
  }];
  if (priced && bands.fair > 0) {
    const dev = ((livePrice - bands.fair) / bands.fair) * 100;
    // ONE predicate for the sign, the words and the colour — three copies of it could drift apart.
    const above = dev >= 0;
    const shown = Math.abs(dev).toFixed(1);
    tiles.push({
      key: 'vsFair', label: `vs ${PL_BAND_LABEL.fair}`,
      value: `${shown === '0.0' ? '' : above ? '+' : '−'}${shown}%`,
      sub: above ? 'above the fair line' : 'below the fair line',
      color: above ? 'var(--green)' : 'var(--red)',
    });
  }
  tiles.push(
    { key: 'ceiling', label: PL_BAND_LABEL.ceiling, value: fmtUSD(bands.ceiling), sub: timesFair(PL_A_CEILING), color: 'var(--amber)' },
    { key: 'fair', label: PL_BAND_LABEL.fair, value: fmtUSD(bands.fair), sub: 'the trend line', color: 'var(--text-primary)' },
    { key: 'floor', label: PL_BAND_LABEL.floor, value: fmtUSD(bands.floor), sub: timesFair(PL_A_FLOOR), color: 'var(--green)' },
  );
  return tiles;
}

const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
};
/** A model coefficient in scientific form: 1.16e-17 → "1.16 × 10⁻¹⁷". A mantissa that rounds up to 10 carries, so
 *  9.999e-18 reads "1 × 10⁻¹⁷", never "10 × 10⁻¹⁸". */
export function fmtCoef(a: number): string {
  let e = Math.floor(Math.log10(a));
  let m = Number((a / 10 ** e).toFixed(2));
  if (m >= 10) { m = Number((m / 10).toFixed(2)); e += 1; }
  return `${m} × 10${[...String(e)].map((c) => SUPERSCRIPT[c]).join('')}`;
}

/** "Feb 2028", in UTC — fmtTurnDate's fixed month table without the day. Never ICU, which prints en-GB September as
 *  "Sept" (the rule in cyclingFaceView and chartZoom's fmtTimeTick). */
export const fmtMonthYear = (d: Date): string => fmtTurnDate(d).replace(/^\d{1,2} /, '');

/**
 * The model card (D3) — every figure read off the model's own constants, so the card can never drift from the lines the
 * chart draws. (The side panel's typed note put Fair at $1M in "~2033–2035"; the line the chart draws gets there in
 * Nov 2032.) ⚠ The calibration sentence names the 2021 and 2025 tops: revisit it whenever PL_A_CEILING moves.
 */
export function modelLines(): string[] {
  const { floor, fair, ceiling } = PL_BAND_LABEL;
  return [
    `${fair} = ${fmtCoef(PL_A_FAIR)} × days^${PL_B}, counting days from the genesis block (${fmtTurnDate(GENESIS)}) — `
      + `Giovanni Santostasi's log-log model. ${floor} and ${ceiling} share the exponent.`,
    `On the model, ${floor} reaches $100k in ${fmtMonthYear(plDateAtPrice('floor', 100_000))} and ${fair} reaches $1M in `
      + `${fmtMonthYear(plDateAtPrice('fair', 1_000_000))}.`,
    `${ceiling} is a calibration, not an envelope: ${timesFair(PL_A_CEILING)}, set between the 2021 and 2025 cycle tops, `
      + 'and revisited each cycle.',
  ];
}

export const PL_DISCLAIMER = {
  lead: 'A pattern, not a forecast.',
  body: 'The power law is a historical regression, not a guarantee. Read the bands as scenarios to stress-test '
    + 'against, never as expected outcomes. Not financial advice.',
} as const;
