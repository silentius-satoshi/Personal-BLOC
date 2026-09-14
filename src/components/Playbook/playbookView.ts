// Pure copy for the two Monthly Playbook badges (Simple mode + full mode) and the full-mode narrative. A .ts module on
// purpose — the dailyView / cyclingFaceView precedent — because there is no render harness (zero .test.tsx), so copy
// left inside a .tsx cannot be tested. The NUMBERS come from simpleModePlan (classifyPaydownState / paydownReadout);
// this module only formats them, always through fmtLtvPct.
import { fmtUSD, fmtLtvPct } from '../../utils/format';
import { classifyPaydownState, type PaydownReadout, type PaydownState } from '../../simulation/simpleModePlan';

export type BadgeTone = 'plain' | 'muted' | 'amber';

export interface PaydownBadge {
  ltv:  string;      // the LTV figure (+ " now" for the in-progress month)
  flag: string;      // everything after it, starting " · " — '' when there is nothing to say
  tone: BadgeTone;   // plain = nothing happened · muted = routine plan mechanics · amber = still above the ceiling
  text: string;      // `LTV ${ltv}${flag}`
}

// A routine paydown is the plan WORKING — muted, never orange. Amber only where the LTV is still above the ceiling.
const TONE: Record<PaydownState, BadgeTone> = { quiet: 'plain', defended: 'muted', partial: 'amber', undefended: 'amber' };

function flagFor(state: PaydownState, r: PaydownReadout, ceil: string, inProgress: boolean): string {
  const pd = fmtUSD(r.paydown);
  if (inProgress) {
    switch (state) {
      case 'quiet':      return '';
      case 'defended':   return ` · plan: pay down ${pd}`;
      case 'partial':    return ` · plan: pay down ${pd}, still above the ${ceil} ceiling`;
      case 'undefended': return ` · plan: above the ${ceil} ceiling — no income to pay it down`;
    }
  }
  switch (state) {
    case 'quiet':      return '';
    case 'defended':   return ` · peaked ${fmtLtvPct(r.peakLtv)} → paid down ${pd}`;
    case 'partial':    return ` · paid down ${pd}, still above the ${ceil} ceiling`;
    case 'undefended': return ` · above the ${ceil} ceiling — no income to pay it down`;
  }
}

/** The header badge for one month. Never says "triggered": a paydown is plan mechanics, not a breach. */
export function paydownBadge(r: PaydownReadout, ceiling: number): PaydownBadge {
  const ceil = fmtLtvPct(ceiling, 0);
  const make = (ltv: string, flag: string, tone: BadgeTone): PaydownBadge => ({ ltv, flag, tone, text: `LTV ${ltv}${flag}` });
  const ltv = fmtLtvPct(r.ltv);
  if (r.mode === 'actual') {
    return r.paydown > 0 ? make(ltv, ` · paid down ${fmtUSD(r.paydown)}`, 'muted') : make(ltv, '', 'plain');
  }
  if (r.mode === 'none' || r.state === null) return make(ltv, '', 'plain');
  const inProgress = r.mode === 'inProgress';
  return make(inProgress ? `${ltv} now` : ltv, flagFor(r.state, r, ceil, inProgress), TONE[r.state]);
}

/**
 * The full-mode Playbook narrative (moved out of MonthlyPlaybook.tsx so it can be tested).
 * ⚠ "LTV hit X% after drawing expenses" narrates the PEAK. It used to print the settled, post-paydown LTV — a figure the
 * LTV never "hit" after the draw — so the sentence was false. Each state gets its own sentence: a partial month must
 * not claim the paydown brought it "back to 15%", and an undefended month must not claim it is "well below" the
 * ceiling. The quiet sentence is byte-identical to the original.
 */
export function buildNarrative(
  month: number, ltv: number, ltvPeak: number,
  income: number, expenses: number, paydown: number, interest: number, ceiling: number,
): string {
  const pct = (x: number) => fmtLtvPct(x).replace('%', '');
  const ceil = fmtLtvPct(ceiling, 0);
  const buyAmt = income - paydown;
  switch (classifyPaydownState(ltvPeak, paydown, ltv, ceiling)) {
    case 'defended':
      return `Month ${month}: LTV hit ${pct(ltvPeak)}% after drawing expenses — ${fmtUSD(paydown)} of income reduces the LoC back to ${ceil}, then ${fmtUSD(buyAmt)} buys Bitcoin. Full ${fmtUSD(expenses)} expenses always paid.`;
    case 'partial':
      return `Month ${month}: LTV hit ${pct(ltvPeak)}% after drawing expenses — ${fmtUSD(paydown)} of income pays it down, but it still settles at ${pct(ltv)}%, above the ${ceil} ceiling. Full ${fmtUSD(expenses)} expenses always paid.`;
    case 'undefended':
      return `Month ${month}: LTV is ${pct(ltv)}% — above the ${ceil} ceiling, with no income left to pay it down. ${fmtUSD(expenses)} in expenses drawn from LoC. Interest of ${fmtUSD(interest)} capitalizes onto the balance.`;
    case 'quiet':
      return `Month ${month}: LTV is ${pct(ltv)}% — well below the ${ceil} ceiling. All ${fmtUSD(income)} income goes straight into Bitcoin. ${fmtUSD(expenses)} in expenses drawn from LoC. Interest of ${fmtUSD(interest)} capitalizes onto the balance.`;
  }
}
