// Pure, React-free seams for OutlookProjection — the `cyclingFaceView.ts` precedent. There is no render
// harness, so logic that would otherwise live in JSX lives here, where it can be unit-tested.

export type GrowthScenario = 'bear' | 'flat' | 'powerlaw' | 'bull' | 'fourYear';

/**
 * The projection subtitle's scenario label. A Record, not a ternary chain: the old chain fell through to
 * '+80%/yr bull' for any scenario it didn't list, so adding one silently mislabelled it. Here a missing key
 * is a compile error.
 */
export function scenarioSubtitle(s: GrowthScenario, plGrowthPct: number): string {
  const labels: Record<GrowthScenario, string> = {
    bear:     '−30%/yr bear',
    flat:     'Flat BTC',
    powerlaw: `Power Law ~${plGrowthPct}%/yr`,
    bull:     '+80%/yr bull',
    fourYear: '4-yr cycle',
  };
  return labels[s];
}

/**
 * The month-1 step of an on-the-line path, SIGNED and computed — the Almanac's formula (CyclingFace,
 * OwnershipFace). ⚠ NAMED TRAP: its sign depends on where the live price sits relative to the modelled
 * curve (−18.4% from $80k, +8.8% from $60k on 2026-09-13), so copy must print this value and never word a
 * direction. Degenerate path → a zero step.
 */
export function lineStep(path: readonly number[]): { step: number; stepPct: string } {
  const step = path.length > 1 && path[0] > 0 && Number.isFinite(path[1]) ? path[1] / path[0] - 1 : 0;
  const stepPct = `${step >= 0 ? '+' : '−'}${Math.abs(step * 100).toFixed(1)}%`;
  return { step, stepPct };
}

/**
 * The footer's end-of-horizon CB LTV: the LAST ROW's own cbLtv, priced at the price that row was computed
 * at. The footer used to re-price the final balance at the LIVE price, which was wrong for every non-flat
 * scenario.
 */
export function footerCbLtv(rows: readonly { cbLtv: number }[]): number {
  return rows.length > 0 ? rows[rows.length - 1].cbLtv : 0;
}
