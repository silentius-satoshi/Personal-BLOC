import { describe, it, expect } from 'vitest';
import { paydownBadge, buildNarrative } from '../playbookView';
import { classifyPaydownState, type PaydownReadout } from '../../../simulation/simpleModePlan';
import { runBLOC } from '../../../simulation/runBLOC';
import { fmtUSD, fmtLtvPct } from '../../../utils/format';

// ⚠ SYNTHETIC round figures — this repo is public; never a real position.
const C = 0.15;
const proj = (o: Partial<PaydownReadout>): PaydownReadout =>
  ({ mode: 'projected', ltv: 0.128, peakLtv: 0.128, paydown: 0, paydownDone: 0, state: 'quiet', ...o });

describe('paydownBadge — four projected states', () => {
  it('quiet → just the LTV, plain', () => {
    expect(paydownBadge(proj({}), C)).toMatchObject({ text: 'LTV 12.8%', tone: 'plain' });
  });

  it('defended → the peak and the paydown, MUTED (plan mechanics, not an alarm)', () => {
    expect(paydownBadge(proj({ ltv: 0.147, peakLtv: 0.189, paydown: 3900, state: 'defended' }), C))
      .toMatchObject({ text: 'LTV 14.7% · peaked 18.9% → paid down $3,900', tone: 'muted' });
  });

  it('⭐ partial → says it is STILL above the ceiling, amber — never the defended string', () => {
    const b = paydownBadge(proj({ ltv: 0.18, peakLtv: 0.239, paydown: 500, state: 'partial' }), C);
    expect(b).toMatchObject({ text: 'LTV 18.0% · paid down $500, still above the 15% ceiling', tone: 'amber' });
  });

  it('⭐ undefended → above the ceiling with no income to pay it down, amber', () => {
    expect(paydownBadge(proj({ ltv: 0.192, peakLtv: 0.192, state: 'undefended' }), C))
      .toMatchObject({ text: 'LTV 19.2% · above the 15% ceiling — no income to pay it down', tone: 'amber' });
  });
});

describe('paydownBadge — ledger and in-progress months', () => {
  it('a closed logged month reports the ledger', () => {
    const base: PaydownReadout = { mode: 'actual', ltv: 0.128, peakLtv: 0, paydown: 1000, paydownDone: 1000, state: null };
    expect(paydownBadge(base, C)).toMatchObject({ text: 'LTV 12.8% · paid down $1,000', tone: 'muted' });
    expect(paydownBadge({ ...base, paydown: 0, paydownDone: 0 }, C)).toMatchObject({ text: 'LTV 12.8%', tone: 'plain' });
  });

  it('the in-progress month labels the LTV "now" and the paydown as the plan', () => {
    const ip = (o: Partial<PaydownReadout>): PaydownReadout =>
      ({ mode: 'inProgress', ltv: 0.128, peakLtv: 0.189, paydown: 3900, paydownDone: 0, state: 'defended', ...o });
    expect(paydownBadge(ip({}), C)).toMatchObject({ text: 'LTV 12.8% now · plan: pay down $3,900', tone: 'muted' });
    expect(paydownBadge(ip({ state: 'partial' }), C).text).toBe('LTV 12.8% now · plan: pay down $3,900, still above the 15% ceiling');
    expect(paydownBadge(ip({ state: 'undefended', paydown: 0 }), C).text).toBe('LTV 12.8% now · plan: above the 15% ceiling — no income to pay it down');
    expect(paydownBadge(ip({ state: 'quiet', paydown: 0 }), C)).toMatchObject({ text: 'LTV 12.8% now', tone: 'plain' });
  });

  it('no state ever says "triggered"', () => {
    const all = (['quiet', 'defended', 'partial', 'undefended', 'noCollateral'] as const).flatMap((state) => [
      paydownBadge(proj({ state, paydown: 100 }), C).text,
      paydownBadge({ ...proj({ state, paydown: 100 }), mode: 'inProgress' }, C).text,
    ]);
    expect(all.filter((t) => t.includes('triggered'))).toEqual([]);
  });
});

describe('buildNarrative — narrates the PEAK the paydown answered', () => {
  // The sentence as it was before this change — the quiet branch must still produce it byte for byte.
  const OLD_QUIET = (month: number, ltv: number, income: number, expenses: number, interest: number) =>
    `Month ${month}: LTV is ${fmtLtvPct(ltv).replace('%', '')}% — well below the 15% ceiling. All ${fmtUSD(income)} income goes straight into Bitcoin. ${fmtUSD(expenses)} in expenses drawn from LoC. Interest of ${fmtUSD(interest)} capitalizes onto the balance.`;
  const hitClause = (s: string) => /LTV hit ([\d.]+)% after drawing expenses/.exec(s)?.[1];

  it('⭐ "LTV hit X% after drawing expenses" reports the peak, not the settled figure', () => {
    // Pass ltv where ltvPeak belongs and the clause reads 14.7 → red. (Assert on the extracted clause only.)
    const s = buildNarrative(8, 0.147, 0.189, 6000, 4000, 3900, 150, C);
    expect(hitClause(s)).toBe('18.9');
    expect(s).toContain('reduces the LoC back to 15%');
  });

  it('partial: never claims the paydown brought it back to 15%', () => {
    const s = buildNarrative(8, 0.18, 0.239, 500, 4000, 500, 150, C);
    expect(hitClause(s)).toBe('23.9');
    expect(s).not.toContain('back to 15%');
    expect(s).toContain('still settles at 18.0%, above the 15% ceiling');
  });

  it('undefended: never claims it is "well below" the ceiling', () => {
    const s = buildNarrative(8, 0.192, 0.192, 0, 4000, 0, 150, C);
    expect(s).not.toContain('well below');
    expect(s).toContain('above the 15% ceiling, with no income left to pay it down');
  });

  it('quiet is byte-identical to the original sentence', () => {
    expect(buildNarrative(3, 0.08, 0.09, 6000, 4000, 0, 120, C)).toBe(OLD_QUIET(3, 0.08, 6000, 4000, 120));
  });
});

describe('noCollateral — describes the DRAW, never a 0.0% headline', () => {
  it('⭐ projected: amber, the ∞ peak, "drawn with no collateral behind it" — and no "0.0%"', () => {
    // Mutation: drop the `shown` peak substitution → "LTV 0.0% · …" → red.
    const b = paydownBadge(proj({ ltv: 0, peakLtv: Infinity, paydown: 4043, state: 'noCollateral' }), C);
    expect(b).toMatchObject({ text: 'LTV ∞ · drawn with no collateral behind it', tone: 'amber' });
    expect(b.text).not.toContain('0.0%');
  });

  it('⭐ in progress: keeps the LEDGER figure with "now", and the flag carries "plan:"', () => {
    // Mutation: apply the peak substitution in progress too → "LTV ∞ now" (the plan's peak labelled as now) → red.
    const b = paydownBadge(
      { mode: 'inProgress', ltv: 0.128, peakLtv: Infinity, paydown: 4043, paydownDone: 0, state: 'noCollateral' }, C);
    expect(b).toMatchObject({ text: 'LTV 12.8% now · plan: drawn with no collateral behind it', tone: 'amber' });
  });

  it('⭐ a real runBLOC zero-collateral month is noCollateral, and its narrative claims nothing false', () => {
    // runBLOC never pays down without collateral: the ∞-peak month's income buys BTC, and it used to classify
    // 'undefended' → "with no income left to pay it down" (false — the income bought bitcoin).
    const m1 = runBLOC(0, { income: 1000, expenses: 3500, startPrice: 80000, apr: 0.13, startBTC: 0 })[1];
    expect(classifyPaydownState(m1.ltvPeak, m1.paydown, m1.ltv, C)).toBe('noCollateral');
    const s = buildNarrative(1, m1.ltv, m1.ltvPeak, 1000, 3500, m1.paydown, m1.interest, C);
    for (const bad of ['no income left', 'back to 15%', 'well below', '0.0%', 'Infinity']) expect(s).not.toContain(bad);
    expect(s).toContain('the expense draw landed with NO collateral behind it');
    expect(s).toContain('$1,000 of income buys Bitcoin');
  });

  it('the runAdvisor shape (a paydown fired) names the paydown and prints no percentage', () => {
    const s = buildNarrative(1, 0, Infinity, 6000, 4000, 4043, 43, C);
    expect(s).toContain('$4,043 of income pays it down');
    expect(s).not.toMatch(/\d%/);
  });
});
