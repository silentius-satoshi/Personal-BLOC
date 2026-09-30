import { PL_BAND_LABEL } from '../../simulation/powerLaw';
import { fmtTurnDate } from '../Almanac/cyclingFaceView';
import { fmtTooltipUsd } from '../../utils/format';

/**
 * The Power Law chart's view model — PURE: no React, no store. ONE series table that the chart's series, the tooltip
 * rows and the legend all read, so the three can never disagree; the tooltip, dated in UTC; the legend rule.
 * Tested in `__tests__/powerLawView.test.ts`.
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
