import { describe, it, expect } from 'vitest';
import {
  applyPathStress, debtSplit, btcGained, holdingsSplit, clampMonth,
  fmtLtvPct, refinanceFeeFraction, refinanceBreakEvenMonths, cashFlowAtMonth,
  coldBeyondRecord, mergeMilestoneRows, fmtTurnDate, nextTurnsText, fmtPhaseShift,
  cbZoneLevel, strikeLiqLtvOf, strikeZoneLevel, isBelowSupport, MILESTONE_MONTHS, fixedMilestoneMonths,
  verdictVsNeverDraw, coldSurvivePrice, surviveFairMultiple,
  strikeCapReading, strikeCapNote, strikeYieldSentence, DEFAULT_STRIKE_CAP_PCT, DEFAULT_STRIKE_CAP_ON, STRIKE_CAP_RANGE,
  strikeCapReadout, STRIKE_CAP_TIP, creditExhaustedNote,
  verdictBasisClause, drawingCashFlowNote, cashFlowText, noBillsNote, liquidatedCashFlowNote, OPENING_CASH_FLOW_NOTE,
  type StrikeCapReading,
} from '../cyclingFaceView';
import { billsRemainderTail, shownUsd } from '../supportPolicyView';
import { cbBarLevel } from '../../../simulation/cbMetrics';
import {
  runCyclingSim, effectiveStrikeCapPct, allInEquity, baselineAllInEquity, type CyclingRow, type CyclingInputs,
} from '../../../simulation/cyclingSim';
import { fmtUSD } from '../../../utils/format';
import {
  SP_REPRO, CASH_6_USD, CALL_BASE, CALL_PATH, runPolicy, callRun, pathP1, pathP2, pathP3, a5Cases,
} from '../../../simulation/__tests__/supportPolicyPaths';
// Tests may import beliefs; the no-belief-imports rule restricts the cyclingFaceView MODULE, not its tests.
import { plConvergencePath, plBandAt, addMonths } from '../../../simulation/powerLaw';
import { cycleConvergencePath } from '../../../simulation/cyclePath';
import { CYCLE_TURNS } from '../../../simulation/cycleModel';
import { CB_FEE_TIER1_PCT, CB_LLTV } from '../../../simulation/runCoinbaseLoan';
import { STRIKE_MAX_DRAW_LTV } from '../../../simulation/strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../../../simulation/emergencyModel';

/** A plain fixture row — no engine run needed for the display math. */
const mkRow = (o: Partial<CyclingRow> = {}): CyclingRow => ({
  m: 12,
  yearLabel: '2027.0',
  price: 80_000,
  cbDebt: 80_000,
  strikeBalance: 20_000,
  debt: 100_000,
  strikeDrawn: 0,
  strikeShortfall: 0,
  btcBoughtUsd: 0,
  unfundedUsd: 0,
  defenseDrawnUsd: 0,
  cbLtvPreDefense: null,
  defenseShortfallUsd: 0,
  defended: false,
  strikeToCbBtc: 0,
  topUpBtc: 0,
  topUpFromColdBtc: 0,
  topUpFromStrikeBtc: 0,
  coldRetrievedBtc: 0,
  strikeTopUpBtc: 0,
  strikeReserveBtc: 0,
  strikeTopUpShortfallBtc: 0,
  strikeReserveCutBtc: 0,
  strikeCollateralBtc: 1,
  cbCollateralBtc: 2,
  coldBtc: 0,
  coldFromCb: 0,
  coldFromStrike: 0,
  btcHeld: 3,
  cbLtv: 80_000 / (2 * 80_000),
  strikeLtv: 20_000 / (1 * 80_000),
  collateralValue: 3 * 80_000,
  equity: 3 * 80_000 - 100_000,
  postLiquidation: false,
  // The support policy's row fields — neutral, as the engine reports them when no policy is applied.
  policyZone: null,
  multiple: null,
  cbCeilingHeadroomUsd: null,
  strikeCeilingHeadroomUsd: null,
  restoreUsd: 0,
  payDownUsd: 0,
  cashReserveUsd: 0,
  cashToBillsUsd: 0,
  cashToCureUsd: 0,
  strikeCall: 'none',
  strikeCureColdBtc: 0,
  strikeLiquidatedBtc: 0,
  ...o,
});

describe('applyPathStress — the lens rolls the remaining band path forward', () => {
  const path = [78_000, 80_000, 82_000, 84_000, 86_000];

  it('is the identity — SAME reference — at factor 1', () => {
    expect(applyPathStress(path, 2, 1)).toBe(path);
  });

  it('multiplies months from the anchor onward and leaves earlier months untouched', () => {
    expect(applyPathStress(path, 2, 0.5)).toEqual([78_000, 80_000, 41_000, 42_000, 43_000]);
  });

  it('includes the selected month itself — the stress starts where you are looking', () => {
    expect(applyPathStress(path, 0, 2)).toEqual([156_000, 160_000, 164_000, 168_000, 172_000]);
  });

  it('⭐ preserves the band SHAPE — the ratio between two stressed paths is constant from the anchor', () => {
    const fair    = [78_000, 80_000, 90_000, 100_000, 110_000];
    const support = [60_000, 62_000, 68_000, 75_000, 82_000];
    const sFair    = applyPathStress(fair, 2, 0.7);
    const sSupport = applyPathStress(support, 2, 0.7);
    for (let i = 2; i < fair.length; i++) {
      expect(sFair[i] / sSupport[i]).toBeCloseTo(fair[i] / support[i], 12);
    }
    expect(sFair.slice(0, 2)).toEqual(fair.slice(0, 2));   // the unstressed head is the base path
  });

  it('guards non-positive / junk factors and clamps the anchor', () => {
    for (const f of [0, -1, NaN]) expect(applyPathStress(path, 2, f)).toBe(path);
    expect(applyPathStress(path, -5, 0.5)).toEqual(path.map((p) => p * 0.5));   // clamp → month 0
    expect(applyPathStress(path, 99, 0.5)).toEqual(path);                     // beyond the horizon → no change
  });
});

describe('debtSplit — the dollar-debt counterpart of holdingsSplit', () => {
  it('splits Strike vs Coinbase debt and reports the month\'s shift', () => {
    const d = debtSplit(mkRow({ strikeBalance: 13_000, cbDebt: 60_000, defenseDrawnUsd: 4_800 }));
    expect(d.strikeUsd).toBe(13_000);
    expect(d.coinbaseUsd).toBe(60_000);
    expect(d.combinedUsd).toBe(73_000);
    expect(d.shiftedUsd).toBe(4_800);
  });

  it('defaults the shift to 0 on an undefended row', () => {
    expect(debtSplit(mkRow()).shiftedUsd).toBe(0);
  });
});

describe('fmtLtvPct — the Infinity-safe LTV renderer', () => {
  it('formats finite fractions to one decimal', () => {
    expect(fmtLtvPct(0.8612)).toBe('86.1%');
    expect(fmtLtvPct(0)).toBe('0.0%');
  });
  it('positive infinity reads ∞, never "Infinity%"', () => {
    expect(fmtLtvPct(Infinity)).toBe('∞');
  });
  it('NaN / negative infinity degrade to — rather than lying', () => {
    expect(fmtLtvPct(NaN)).toBe('—');
    expect(fmtLtvPct(-Infinity)).toBe('—');
  });
});

describe('refinance fee math — the marginal brackets, not a flat 2%', () => {
  it('fee fraction is fees ÷ cash moved', () => {
    expect(refinanceFeeFraction(1_000, 80_000)).toBeCloseTo(0.0125, 12);
  });
  it('falls back to tier 1 when nothing was refinanced (or the basis is junk)', () => {
    expect(refinanceFeeFraction(0, 0)).toBe(CB_FEE_TIER1_PCT);
    expect(refinanceFeeFraction(10, Infinity)).toBe(CB_FEE_TIER1_PCT);
  });
  it('break-even is fee% ÷ spread% × 12 — and amount-independent', () => {
    // 2% fee against an 8-point spread: 0.02 / 0.08 × 12 = 3 months.
    expect(refinanceBreakEvenMonths(0.02, 13, 5)).toBeCloseTo(3, 12);
    // A realized 1.25% blended fee shortens it: 0.0125 / 0.08 × 12 = 1.875.
    expect(refinanceBreakEvenMonths(0.0125, 13, 5)).toBeCloseTo(1.875, 12);
  });
  it('is null when Coinbase is not cheaper (no saving to break even against)', () => {
    expect(refinanceBreakEvenMonths(0.02, 5, 13)).toBeNull();
    expect(refinanceBreakEvenMonths(0.02, 5, 5)).toBeNull();
    expect(refinanceBreakEvenMonths(0, 13, 5)).toBeNull();
    expect(refinanceBreakEvenMonths(NaN, 13, 5)).toBeNull();
  });
});

describe('btcGained', () => {
  const base = mkRow({ m: 0, price: 60_000, btcHeld: 2, debt: 50_000, cbDebt: 40_000, strikeBalance: 10_000 });

  it('gross is the raw BTC accumulated', () => {
    expect(btcGained(mkRow(), base).gross).toBeCloseTo(1, 12);
  });

  it('yours goes negative when debt grows faster than holdings', () => {
    // +0.05 ₿ but debt triples at a flat price → yours must be under water.
    const row = mkRow({ price: 60_000, btcHeld: 2.05, debt: 150_000 });
    const g = btcGained(row, base);
    expect(g.gross).toBeGreaterThan(0);
    expect(g.yours).toBeLessThan(0);
  });

  it('an override equal to row.price is identical to the two-arg call', () => {
    const row = mkRow();
    const a = btcGained(row, base);
    const b = btcGained(row, base, row.price);
    expect(b.gross).toBeCloseTo(a.gross, 12);
    expect(b.yours).toBeCloseTo(a.yours, 12);
  });

  it('halving the override makes yours STRICTLY smaller whenever the row carries debt', () => {
    const row = mkRow();
    expect(row.debt).toBeGreaterThan(0);
    expect(btcGained(row, base, row.price / 2).yours).toBeLessThan(btcGained(row, base).yours);
  });

  it('the override never moves gross — BTC counts are price-independent', () => {
    const row = mkRow();
    expect(btcGained(row, base, row.price / 3).gross).toBeCloseTo(btcGained(row, base).gross, 12);
  });

  it('lenses the ROW side only — the base keeps its own real price', () => {
    const row = mkRow();
    // Overriding the row to exactly the base's price must NOT collapse yours to a pure count difference,
    // because the base still discounts its own debt at its own price.
    const g = btcGained(row, base, base.price);
    const expected = (row.btcHeld - row.debt / base.price) - (base.btcHeld - base.debt / base.price);
    expect(g.yours).toBeCloseTo(expected, 12);
  });

  it('guards zero prices on either side', () => {
    expect(Number.isFinite(btcGained(mkRow({ price: 0 }), base).yours)).toBe(true);
    expect(Number.isFinite(btcGained(mkRow(), mkRow({ price: 0 })).yours)).toBe(true);
    expect(Number.isFinite(btcGained(mkRow(), base, 0).yours)).toBe(true);
  });
});

describe('btcGained across a liquidation', () => {
  // ⚠ Assert at liqMonth + 1, NOT at the first postLiquidation row. cyclingSim pushes the BREACHING row and
  // applies the seizure afterwards, while setting postLiquidation:true on that same row — so rows[liqMonth]
  // still holds the intact PRE-seizure position and shows no drop. Asserting there passes vacuously.
  const crash: CyclingInputs = {
    // 12 months at 78k, then a hard crash held for a year — plenty of room past liqMonth.
    pricePath: [...new Array(13).fill(78_000), ...new Array(12).fill(9_000)],
    startYear: 2026,
    strikeCollateralBtc: 1.0,
    strikeBalance: 13_000,
    strikeCreditLine: 38_000,
    strikeMaxDrawLtv: 0.5,
    strikeMarginLtv: 0.7,
    cbCollateralBtc: 2.0,
    cbDebt: 72_000,
    income: 6_000,
    expenses: 5_000,
    strikeAprPct: 13,
    cbAprPct: 4.77,
    cycleMonths: 3,
    cbLtvCapPct: 85,
  };

  it('shows the seizure drop one month AFTER the breach', () => {
    const res = runCyclingSim(crash);
    expect(res.liqMonth).not.toBeNull();
    expect(res.liqMonth! + 1).toBeLessThan(res.rows.length);   // the path runs past the breach

    const before = btcGained(res.rows[res.liqMonth!], res.rows[0]);
    const after = btcGained(res.rows[res.liqMonth! + 1], res.rows[0]);
    expect(after.gross).toBeLessThan(before.gross);            // collateral seized
    expect(after.yours).toBeLessThan(before.yours);
  });

  it('pins the off-by-one trap: the breaching row is flagged but still intact', () => {
    const res = runCyclingSim(crash);
    expect(res.rows[res.liqMonth!].postLiquidation).toBe(true);
    expect(res.rows[res.liqMonth!].btcHeld).toBeGreaterThan(res.rows[res.liqMonth! + 1].btcHeld);
  });
});

describe('holdingsSplit', () => {
  it('sums to btcHeld', () => {
    const s = holdingsSplit(mkRow());
    expect(s.strike + s.coinbase).toBeCloseTo(s.combined, 9);
  });

  it('reads the three venues straight off the row', () => {
    const s = holdingsSplit(mkRow({ strikeCollateralBtc: 0.75, cbCollateralBtc: 2.25, coldBtc: 0, btcHeld: 3 }));
    expect(s).toEqual({ strike: 0.75, coinbase: 2.25, cold: 0, combined: 3 });
  });

  it('⭐ cold storage is a THIRD venue, and it is the only unpledged one', () => {
    // Added with the cold-storage sweep. `cold` backs no loan, sits in no LTV denominator and cannot be
    // seized — the split is what makes that visible next to two pools that are both pledged.
    const s = holdingsSplit(mkRow({
      strikeCollateralBtc: 0.75, cbCollateralBtc: 1.25, coldBtc: 1.00, btcHeld: 3,
    }));
    expect(s).toEqual({ strike: 0.75, coinbase: 1.25, cold: 1.00, combined: 3 });
    // The three venues account for the whole stack — a split that does not add up is a display lie.
    expect(s.strike + s.coinbase + s.cold).toBeCloseTo(s.combined, 9);
  });
});

describe('clampMonth — the shrinking-horizon crash trap', () => {
  it('keeps a stale index inside a shrunken row set', () => {
    // Horizon 240 → 239 with the scrubber parked at the old end. Pre-fix this read rows[240] === undefined
    // and every `row.*` read blew up.
    const wide = new Array(241).fill(0).map((_, m) => mkRow({ m }));
    const narrow = new Array(240).fill(0).map((_, m) => mkRow({ m }));
    const selected = wide.length - 1;                 // 240
    expect(clampMonth(selected, wide.length)).toBe(240);

    const idx = clampMonth(selected, narrow.length);
    expect(idx).toBe(239);
    expect(narrow[idx]).toBeDefined();
    expect(narrow[idx].btcHeld).toBeGreaterThan(0);
  });

  it('is the identity while the index is in range', () => {
    expect(clampMonth(0, 61)).toBe(0);
    expect(clampMonth(30, 61)).toBe(30);
    expect(clampMonth(60, 61)).toBe(60);
    expect(clampMonth(0, 1)).toBe(0);
  });

  it('guards empty/negative counts and negative indices', () => {
    expect(clampMonth(5, 0)).toBe(0);
    expect(clampMonth(5, -3)).toBe(0);
    expect(clampMonth(-2, 61)).toBe(0);
  });
});

describe('cashFlowAtMonth — what actually buys bitcoin', () => {
  const row = (o: Partial<CyclingRow> = {}) => mkRow({ ...o });

  it('⭐ THE BUG: while drawing, the WHOLE income buys — not the surplus', () => {
    // ⚠ SYNTHETIC figures (this repo is public — never the owner's real budget). Chosen so the surplus
    // is a quarter of income: the old copy said "Surplus $2,500/mo buys bitcoin" where the engine buys
    // $10,000, because the credit line paid the bill. A 4x understatement of the flywheel.
    const cf = cashFlowAtMonth(
      row({ btcBoughtUsd: 10_000, strikeDrawn: 7_500, strikeShortfall: 0 }), 10_000, 7_500, true);
    expect(cf.mode).toBe('drawing');
    expect(cf.buysUsd).toBe(10_000);
    expect(cf.lineFundedUsd).toBe(7_500);
    expect(cf.incomeCoveredUsd).toBe(0);
    expect(cf.leveraged).toBe(true);
    expect(cf.buysUsd).toBe(4 * (10_000 - 7_500));   // the exact factor the old copy was off by
  });

  it('a partly-funded bill: income covers the remainder, and buys that much less', () => {
    // The line could only fund $4,000 of the $7,500 bill, so income covers $3,500 and buys $6,500.
    const cf = cashFlowAtMonth(
      row({ btcBoughtUsd: 6_500, strikeDrawn: 4_000, strikeShortfall: 3_500 }), 10_000, 7_500, true);
    expect(cf.mode).toBe('drawing');
    expect(cf.buysUsd).toBe(6_500);
    expect(cf.incomeCoveredUsd).toBe(3_500);
    expect(cf.buysUsd + cf.incomeCoveredUsd).toBe(10_000);   // income is fully accounted for
    expect(cf.leveraged).toBe(true);
  });

  it('⭐ once the cap stops the draw, the surplus IS the right number', () => {
    // The old copy was not wrong everywhere — it described this state. That is why the fix is
    // state-dependent rather than a swap.
    const cf = cashFlowAtMonth(
      row({ btcBoughtUsd: 2_500, strikeDrawn: 0, strikeShortfall: 0 }), 10_000, 7_500, true);
    expect(cf.mode).toBe('stopped');
    expect(cf.buysUsd).toBe(2_500);
    expect(cf.buysUsd).toBe(10_000 - 7_500);
    expect(cf.lineFundedUsd).toBe(0);
    expect(cf.leveraged).toBe(false);
  });

  it('no-draw modes never report as drawing, whatever the row holds', () => {
    const cf = cashFlowAtMonth(
      row({ btcBoughtUsd: 2_500, strikeDrawn: 7_500, strikeShortfall: 0 }), 10_000, 7_500, false);
    expect(cf.mode).toBe('noDraw');
    expect(cf.lineFundedUsd).toBe(0);
    expect(cf.incomeCoveredUsd).toBe(0);
  });

  it('a deficit budget is never reported as leveraged just because buys are positive', () => {
    const cf = cashFlowAtMonth(
      row({ btcBoughtUsd: 0, strikeDrawn: 0, strikeShortfall: 0 }), 5_000, 7_500, true);
    expect(cf.buysUsd).toBe(0);
    expect(cf.leveraged).toBe(false);
  });

  it('⭐ the helper reads the ENGINE, so it cannot drift from what was bought', () => {
    // btcBoughtUsd is no longer derivable from a cbColl delta (the cascade and top-up move collateral
    // into that pool too), which is exactly why the engine emits it.
    const r = runCyclingSim({
      startYear: 2026, strikeCollateralBtc: 1.0, strikeBalance: 0, strikeCreditLine: 200_000,
      strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV, strikeMarginLtv: STRIKE_MARGIN_CALL_LTV,
      cbCollateralBtc: 2.0, cbDebt: 72_000, income: 10_000, expenses: 7_500,
      strikeAprPct: 13, cbAprPct: 6.27, cycleMonths: 1,
      pricePath: new Array(13).fill(78_000), cbLtvCapPct: 85, coldStoreBufferPct: 0,
    });
    const m1 = r.rows[1];
    expect(m1.btcBoughtUsd).toBe(10_000);
    expect(cashFlowAtMonth(m1, 10_000, 7_500, true).buysUsd).toBe(10_000);
  });
});

describe('coldBeyondRecord — the "deeper than any recorded bottom" threshold (spec test 9)', () => {
  const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const start = utc('2026-09-12');

  it('⭐ Support, on the line, months 1…240: never fires at 45%, always fires at 46%', () => {
    // At exactly 45, 1 − 45/100 === 0.55, so the test degenerates to price < support — the one value where
    // a float mismatch would flicker. On Support both sides are the SAME value, so it is exact.
    const path = plConvergencePath(100_000, 'floor', start, 240, 1);
    let at45 = 0;
    let at46 = 0;
    for (let m = 1; m <= 240; m++) {
      const support = plBandAt('floor', start, m);
      expect(path[m]).toBe(support);                 // bit-identical — why no tolerance is needed here
      if (coldBeyondRecord(path[m], support, 45)) at45++;
      if (coldBeyondRecord(path[m], support, 46)) at46++;
    }
    expect(at45).toBe(0);
    expect(at46).toBe(240);
  });

  it('⭐ the guard itself, pinned on synthetic values (no real path reaches it today)', () => {
    const s = 70_000;
    // One part in 10^12 under support at 45%: the 1e-9 guard absorbs it. Measured TRUE without the guard,
    // so deleting the guard fails this assertion.
    expect(coldBeyondRecord(s * (1 - 1e-12), s, 45)).toBe(false);
    // …and the guard can never swallow a real crossing.
    expect(coldBeyondRecord(s, s, 46)).toBe(true);
  });

  it('regression check: the 4-yr path at every exact low-turn row does not fire at 45%', () => {
    // ⚠ NOT the guard's test: the helper WITHOUT the guard also fires 0 of 7 here, so this cannot detect
    // the guard's removal. It pins that the real trough rows stay clean.
    const lows = CYCLE_TURNS.filter((t) => t.kind === 'low');
    expect(lows).toHaveLength(7);
    for (const t of lows) {
      const turnStart = addMonths(new Date(t.date), -12);
      expect(addMonths(turnStart, 12).getTime()).toBe(t.date);   // row 12 really lands ON the turn
      const path = cycleConvergencePath(100_000, turnStart, 12, 1);
      expect(coldBeyondRecord(path[12], plBandAt('floor', turnStart, 12), 45)).toBe(false);
    }
  });

  it('⭐ path-aware: on the fair line a 50% buffer is NOT "deeper than any bottom"', () => {
    // The inline rule this replaced was `coldBufferPct > 45` on every path. Half of fair is still
    // ~1.4× the support line, nowhere near a record bottom.
    const fair = plBandAt('fair', start, 24);
    const support = plBandAt('floor', start, 24);
    expect(coldBeyondRecord(fair, support, 50)).toBe(false);
    expect(coldBeyondRecord(support, support, 50)).toBe(true);   // the same buffer on Support does fire
  });
});

describe('mergeMilestoneRows (spec test 10)', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const turns = [
    { month: 1, kind: 'low' as const, date: d('2026-10-05') },
    { month: 36, kind: 'high' as const, date: d('2029-09-03') },
    { month: 48, kind: 'low' as const, date: d('2030-09-02') },
  ];

  it('⭐ the default view: {1 low, 12, 24, 36 high, 48 low, 60} — row 36 keeps its turn label', () => {
    const rows = mergeMilestoneRows([12, 24, 36, 60], turns);
    expect(rows.map((r) => `${r.month}${r.turn ? ` ${r.turn.kind}` : ''}`)).toEqual([
      '1 low', '12', '24', '36 high', '48 low', '60',
    ]);
  });

  it('no row appears twice, and rows come out sorted whatever the input order', () => {
    const rows = mergeMilestoneRows([60, 36, 12], [...turns].reverse());
    const months = rows.map((r) => r.month);
    expect(months).toEqual([...new Set(months)].sort((a, b) => a - b));
  });

  it('with no turns (a band path) it is just the fixed rows', () => {
    expect(mergeMilestoneRows([12, 24], [])).toEqual([
      { month: 12, turn: null }, { month: 24, turn: null },
    ]);
  });
});

describe('turn and timing formatters', () => {
  const d = (iso: string) => new Date(`${iso}Z`);

  it('fmtTurnDate reads the UTC calendar day, even for a shifted turn carrying a time', () => {
    expect(fmtTurnDate(d('2026-10-05T00:00:00'))).toBe('5 Oct 2026');
    expect(fmtTurnDate(d('2029-12-03T07:30:00'))).toBe('3 Dec 2029');
  });

  it('nextTurnsText names the next turns, and is empty with none', () => {
    expect(nextTurnsText([
      { kind: 'low', date: d('2026-10-05T00:00:00') },
      { kind: 'high', date: d('2029-09-03T00:00:00') },
    ])).toBe('Next low 5 Oct 2026, next high 3 Sep 2029');
    expect(nextTurnsText([])).toBe('');
  });

  it('fmtPhaseShift: on schedule / late / early', () => {
    expect(fmtPhaseShift(0)).toBe('on schedule');
    expect(fmtPhaseShift(3)).toBe('+3 mo late');
    expect(fmtPhaseShift(-2)).toBe('−2 mo early');
    expect(fmtPhaseShift(NaN)).toBe('on schedule');
  });
});

describe('shared face rules — extracted from the parent faces (one definition each)', () => {
  it('⭐ cbZoneLevel IS cbBarLevel banded against CB_LLTV — never a dashboard cbLiqFrac', () => {
    for (const ltv of [0, 0.3, 0.57, 0.7499, 0.75, 0.79, 0.7998, 0.8, 0.86, 1.2]) {
      expect(cbZoneLevel(ltv, 75)).toBe(cbBarLevel(ltv, 75, CB_LLTV));
    }
    // Pinned against the band itself, so swapping CB_LLTV for any other liq fraction fails here:
    // red from 0.93 × 0.86 = 0.7998.
    expect(cbZoneLevel(0.57, 75)).toBe('safe');     // a 57% CB LTV under a 75 trigger stays green
    expect(cbZoneLevel(0.76, 75)).toBe('watch');
    expect(cbZoneLevel(0.79, 75)).toBe('watch');
    expect(cbZoneLevel(0.80, 75)).toBe('act');
    expect(cbZoneLevel(0.60, 55)).toBe('watch');    // the trigger boundary is still the owner's setting
  });

  it('strikeLiqLtvOf: the owner\'s setting as a fraction, the published 85% when it is missing', () => {
    expect(strikeLiqLtvOf(85)).toBe(0.85);
    expect(strikeLiqLtvOf(90)).toBe(0.9);
    for (const bad of [0, -5, NaN]) expect(strikeLiqLtvOf(bad)).toBe(0.85);
  });

  it('strikeZoneLevel: watch from the 50% draw ceiling, act at the liquidation LTV', () => {
    expect(STRIKE_MAX_DRAW_LTV).toBe(0.5);
    expect(strikeZoneLevel(0.49, 0.85)).toBe('safe');
    expect(strikeZoneLevel(0.5, 0.85)).toBe('watch');
    expect(strikeZoneLevel(0.84, 0.85)).toBe('watch');
    expect(strikeZoneLevel(0.85, 0.85)).toBe('act');
    expect(strikeZoneLevel(0.85, 0.9)).toBe('watch');   // the act line follows the owner's setting
  });

  it('⭐ isBelowSupport: the 1e-9 guard absorbs a rounding step but never a real crossing', () => {
    const s = 70_000;
    // One part in 10^12 under support: the guard absorbs it. Measured TRUE without the guard.
    expect(isBelowSupport(s * (1 - 1e-12), s)).toBe(false);
    expect(isBelowSupport(s, s)).toBe(false);
    expect(isBelowSupport(s * 0.999, s)).toBe(true);
    expect(isBelowSupport(s * 1.5, s)).toBe(false);
  });

  it('fixedMilestoneMonths: the fixed rows, clipped to the horizon', () => {
    expect([...MILESTONE_MONTHS]).toEqual([12, 24, 36, 60, 120]);
    expect(fixedMilestoneMonths(60)).toEqual([12, 24, 36, 60]);
    expect(fixedMilestoneMonths(24)).toEqual([12, 24]);
    expect(fixedMilestoneMonths(240)).toEqual([12, 24, 36, 60, 120]);
    expect(fixedMilestoneMonths(11)).toEqual([]);
  });

  it('⭐ verdictVsNeverDraw: liquidation outranks, hold IS the baseline, otherwise equity decides', () => {
    const last = mkRow({ equity: 150_000, btcHeld: 3.2 });
    // No unpaid bills and no reserve cash on either side, so the all-in basis equals the raw one here.
    const base = {
      last, baselineEquity: 140_000, baselineBtc: 3.0,
      totalUnfundedUsd: 0, totalCashToBillsUsd: 0, totalCashToCureUsd: 0, baselineUnfundedUsd: 0,
    };
    expect(verdictVsNeverDraw({ ...base, liqMonth: null }, 'cycle')).toEqual({
      kind: 'wins', wins: true, equityDelta: 10_000, btcDelta: last.btcHeld - 3.0, allIn: false,
    });
    expect(verdictVsNeverDraw({ ...base, liqMonth: null, baselineEquity: 160_000 }, 'cycle').kind).toBe('loses');
    // Liquidation outranks the equity comparison — but `wins` stays the equity comparison (all-in), because the
    // Cycling face colours its Net-equity tile on it even in a liquidated run.
    const liq = verdictVsNeverDraw({ ...base, liqMonth: 30 }, 'cycle');
    expect(liq.kind).toBe('liquidated');
    expect(liq.wins).toBe(true);
    // C3: hold IS the never-draw baseline, so there is no second curve to win or lose against.
    expect(verdictVsNeverDraw({ ...base, liqMonth: null }, 'hold').kind).toBe('baseline');
    expect(verdictVsNeverDraw({ ...base, liqMonth: null }, 'clearBoth').kind).toBe('wins');
  });

  it('coldSurvivePrice: the buffer stated as the price it survives down to', () => {
    expect(coldSurvivePrice(100_000, 30)).toBeCloseTo(70_000, 9);
    expect(coldSurvivePrice(100_000, 0)).toBe(100_000);
  });

  it('surviveFairMultiple: the survive-to price as a multiple of fair — 0 without a fair line', () => {
    expect(surviveFairMultiple(50_000, 100_000, 30)).toBeCloseTo(0.35, 12);
    expect(surviveFairMultiple(100_000, 100_000, 0)).toBe(1);
    expect(surviveFairMultiple(50_000, 0, 30)).toBe(0);
    expect(surviveFairMultiple(50_000, -1, 30)).toBe(0);
  });
});

describe('strikeCapReading / strikeCapNote — what the Strike cap did, in plain words', () => {
  /** A synthetic result — only the fields the reading reads. The support policy's call fields are neutral, as the
   *  engine reports them with the policy off. */
  const res = (o: Partial<Parameters<typeof strikeCapReading>[0]> = {}): Parameters<typeof strikeCapReading>[0] => ({
    strikeMarginMonth: null, firstSurvivalYieldMonth: null, strikeTopUpExhaustedMonth: null,
    firstStrikeTopUpMonth: null, totalStrikeTopUpBtc: 0, liqMonth: null,
    firstStrikeCallMonth: null, strikeCallsCured: 0, strikeCallsSold: 0, totalCashToCureUsd: 0,
    totalStrikeCureColdBtc: 0, totalStrikeLiquidatedBtc: 0, ...o,
  });

  it('the shared defaults: 60, on, and a 50–68 slider (67/68 run as the engine\'s 66.5 ceiling)', () => {
    expect(DEFAULT_STRIKE_CAP_PCT).toBe(60);
    expect(DEFAULT_STRIKE_CAP_ON).toBe(true);
    expect(STRIKE_CAP_RANGE).toEqual({ min: 50, max: 68, step: 1 });
    expect(effectiveStrikeCapPct(STRIKE_CAP_RANGE.max, STRIKE_MARGIN_CALL_LTV)).toBeCloseTo(66.5, 9);
    expect(effectiveStrikeCapPct(DEFAULT_STRIKE_CAP_PCT, STRIKE_MARGIN_CALL_LTV)).toBe(60);
  });

  it('the readout: off, the requested cap, or the clamped ceiling marked "max"', () => {
    const eff = (raw: number) => effectiveStrikeCapPct(raw, STRIKE_MARGIN_CALL_LTV);
    expect(strikeCapReadout(0, eff(0))).toBe('off');
    expect(strikeCapReadout(60, eff(60))).toBe('60%');
    expect(strikeCapReadout(66, eff(66))).toBe('66%');
    expect(strikeCapReadout(67, eff(67))).toBe('66.5% — max');
    expect(strikeCapReadout(68, eff(68))).toBe('66.5% — max');
  });

  it('the tip discloses the survival guard — the cap is not promised more than it delivers', () => {
    expect(STRIKE_CAP_TIP[0]).toContain('calls the loan at 70%');
    expect(STRIKE_CAP_TIP.join(' ')).toContain('when Coinbase would otherwise be liquidated, Strike gives way');
  });

  it('⭐ precedence: called > yielded > short > defended > idle', () => {
    const all = { strikeMarginMonth: 40, firstSurvivalYieldMonth: 30, strikeTopUpExhaustedMonth: 20, firstStrikeTopUpMonth: 10 };
    expect(strikeCapReading(res(all), 60).state).toBe('called');
    expect(strikeCapReading(res({ ...all, strikeMarginMonth: null }), 60).state).toBe('yielded');
    expect(strikeCapReading(res({ ...all, strikeMarginMonth: null, firstSurvivalYieldMonth: null }), 60).state).toBe('short');
    expect(strikeCapReading(res({ firstStrikeTopUpMonth: 10, totalStrikeTopUpBtc: 0.1 }), 60).state).toBe('defended');
    expect(strikeCapReading(res(), 60).state).toBe('idle');
  });

  it('off only when the cap is off AND nothing was called — a call is a call either way', () => {
    expect(strikeCapReading(res(), 0).state).toBe('off');
    expect(strikeCapReading(res({ strikeMarginMonth: 46 }), 0).state).toBe('called');
    expect(strikeCapReading(res(), 0).capPct).toBe(0);
  });

  it('⭐ defended NEVER reads as a margin call — holding the line is the success case', () => {
    const note = strikeCapNote(strikeCapReading(res({ firstStrikeTopUpMonth: 44, totalStrikeTopUpBtc: 0.106 }), 60));
    expect(note).toBe('Strike held at 60% by moving 0.1060 ₿ out of cold storage, first at month 44.');
    expect(note).not.toMatch(/margin|call|crosses/i);
  });

  it('short says the cap slipped but the call did not come', () => {
    const note = strikeCapNote(strikeCapReading(res({ strikeTopUpExhaustedMonth: 8, firstStrikeTopUpMonth: 5, totalStrikeTopUpBtc: 0.05 }), 60));
    expect(note).toContain('From month 8 cold storage could not hold Strike at 60%');
    expect(note).toContain('stayed under the 70% call');
    expect(note).toContain('0.0500 ₿ moved out of cold in all');
    // An empty pool moved nothing — no "0.0000 ₿ moved" clause.
    expect(strikeCapNote(strikeCapReading(res({ strikeTopUpExhaustedMonth: 8 }), 60))).not.toContain('moved out of cold');
  });

  it('the effective cap renders as the engine ran it — 66.5, not the slider\'s 68', () => {
    const r = strikeCapReading(res({ firstStrikeTopUpMonth: 3, totalStrikeTopUpBtc: 0.2 }),
      effectiveStrikeCapPct(68, STRIKE_MARGIN_CALL_LTV));
    expect(strikeCapNote(r)).toContain('held at 66.5%');
  });

  describe('⭐ M10 — the yield sentence, including when it is APPENDED to a call', () => {
    const called = { strikeMarginMonth: 1, firstSurvivalYieldMonth: 1 };

    it('called + yielded + Coinbase survived → appends "gave way to keep Coinbase alive"', () => {
      const note = strikeCapNote(strikeCapReading(res({ ...called, liqMonth: null }), 60));
      expect(note).toBe('Strike LTV crosses 70% at month 1 — margin-call territory on the Strike leg. '
        + 'Strike gave way to keep Coinbase alive in month 1.');
    });

    it('called + yielded + Coinbase liquidated → the LIQUIDATED branch, never "keep Coinbase alive"', () => {
      const note = strikeCapNote(strikeCapReading(res({ ...called, liqMonth: 5 }), 60));
      expect(note).toContain('Strike gave way to Coinbase in month 1, but Coinbase was still liquidated in month 5.');
      expect(note).not.toContain('keep Coinbase alive');
    });

    it('yielded only + Coinbase liquidated → the liquidated branch', () => {
      const r = strikeCapReading(res({ firstSurvivalYieldMonth: 8, liqMonth: 12 }), 60);
      expect(r.state).toBe('yielded');
      expect(strikeCapNote(r)).toBe('Strike gave way to Coinbase in month 8, but Coinbase was still liquidated in month 12.');
      expect(strikeCapNote(r)).not.toContain('keep Coinbase alive');
    });

    it('yielded only + Coinbase survived → the plain disclosure', () => {
      const r: StrikeCapReading = strikeCapReading(res({ firstSurvivalYieldMonth: 8 }), 60);
      expect(strikeCapNote(r)).toBe('Strike gave way to keep Coinbase alive in month 8.');
      expect(strikeYieldSentence(strikeCapReading(res(), 60))).toBe('');
    });
  });

  it('⭐ against the REAL engine: the faces\' C6 scenario reads "yielded", and says so truthfully', () => {
    // The faces' exact inputs (the Playwright seed on 2026-09-21): 4-yr path, CB cap 50, cadence 1, sweep 30,
    // Strike cap 60 — scrubbed to month 8, stressed to 0.50. The guard yields and Coinbase lives.
    const base: CyclingInputs = {
      startYear: 2026, strikeCollateralBtc: 1, strikeBalance: 20_000, strikeCreditLine: 60_000,
      strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV, strikeMarginLtv: STRIKE_MARGIN_CALL_LTV,
      cbCollateralBtc: 1, cbDebt: 40_000, income: 8_000, expenses: 6_000, strikeAprPct: 13, cbAprPct: 6.2,
      cycleMonths: 1, cbLtvCapPct: 50, defendCbLtv: true, coldStoreBufferPct: 30, strikeLtvCapPct: 60,
      pricePath: applyPathStress(cycleConvergencePath(100_000, new Date('2026-09-21T00:00:00Z'), 60, 1), 8, 0.5),
    };
    const r = strikeCapReading(runCyclingSim(base), effectiveStrikeCapPct(60, STRIKE_MARGIN_CALL_LTV));
    expect(r.state).toBe('yielded');
    expect(strikeCapNote(r)).toBe('Strike gave way to keep Coinbase alive in month 8.');
    // ...and with the cap OFF the same scenario is a margin call — the reading follows the run, and a call
    // outranks "off".
    const off = strikeCapReading(runCyclingSim({ ...base, strikeLtvCapPct: 0 }), 0);
    expect(off.state).toBe('called');
    expect(strikeCapNote(off)).toMatch(/^Strike LTV crosses 70% at month \d+ — margin-call territory on the Strike leg\.$/);
  });
});

// ── Run 2a · the helper extensions (support policy faces, §A4) ───────────────────────────────────────────────

describe('creditExhaustedNote — extracted from CyclingFace\'s constraints box; never "$0/mo"', () => {
  it('today\'s sentence verbatim when there IS a shortfall; the no-figure sentence when the month did not draw', () => {
    expect(creditExhaustedNote({ creditExhaustedMonth: null, rows: [] })).toBe('');
    const rows = (shortfall: number) => [mkRow(), mkRow(), mkRow({ strikeShortfall: shortfall })];
    expect(creditExhaustedNote({ creditExhaustedMonth: 2, rows: rows(1_000) }))
      .toBe('Strike credit exhausted at month 2 — $1,000/mo of bills funded from income thereafter.');
    expect(creditExhaustedNote({ creditExhaustedMonth: 2, rows: rows(0) }))
      .toBe("Strike's own line can't fund the full bill from month 2 — income covers the rest.");
    expect(creditExhaustedNote({ creditExhaustedMonth: 2, rows: rows(0.3) })).not.toContain('$0/mo');   // dust
  });

  it('⭐ against the engine: a policy month that did not draw never prints $0/mo; a drawing month keeps the figure', () => {
    const noDraw = runPolicy(pathP1(), {}, { strikeBalance: 30_000 });   // Strike opens fully drawn: month 1 cannot draw
    expect(noDraw.creditExhaustedMonth).toBe(1);
    expect(noDraw.rows[1].strikeShortfall).toBe(0);
    expect(creditExhaustedNote(noDraw)).toBe("Strike's own line can't fund the full bill from month 1 — income covers the rest.");
    const short = runPolicy(pathP1(), {}, { strikeCreditLine: 5_000 });   // a $5k line under a $6k bill, drawing
    expect(short.rows[1].strikeShortfall).toBeCloseTo(1_000, 9);
    expect(creditExhaustedNote(short)).toBe('Strike credit exhausted at month 1 — $1,000/mo of bills funded from income thereafter.');
    // Policy off: exactly the face's sentence today (fmtUSD of that month's shortfall).
    const off = runCyclingSim({ ...SP_REPRO, strikeCreditLine: 5_000, pricePath: pathP1() });
    const m = off.creditExhaustedMonth!;
    expect(creditExhaustedNote(off))
      .toBe(`Strike credit exhausted at month ${m} — ${fmtUSD(off.rows[m].strikeShortfall)}/mo of bills funded from income thereafter.`);
  });
});

describe('strikeCapReading — the support policy\'s modelled calls: sold and cured', () => {
  const res = (o: Partial<Parameters<typeof strikeCapReading>[0]> = {}): Parameters<typeof strikeCapReading>[0] => ({
    strikeMarginMonth: null, firstSurvivalYieldMonth: null, strikeTopUpExhaustedMonth: null,
    firstStrikeTopUpMonth: null, totalStrikeTopUpBtc: 0, liqMonth: null,
    firstStrikeCallMonth: null, strikeCallsCured: 0, strikeCallsSold: 0, totalCashToCureUsd: 0,
    totalStrikeCureColdBtc: 0, totalStrikeLiquidatedBtc: 0, ...o,
  });
  const SOLD = { firstStrikeCallMonth: 18, strikeCallsSold: 1, totalStrikeLiquidatedBtc: 0.1429 };
  const CURED = { firstStrikeCallMonth: 18, strikeCallsCured: 1, totalCashToCureUsd: 4_000, totalStrikeCureColdBtc: 0.05 };

  it('⭐ the full precedence: sold > cured > called > yielded > short > defended > idle', () => {
    const all = { strikeMarginMonth: 40, firstSurvivalYieldMonth: 30, strikeTopUpExhaustedMonth: 20, firstStrikeTopUpMonth: 10 };
    expect(strikeCapReading(res({ ...all, ...CURED, ...SOLD, strikeCallsCured: 1 }), 60).state).toBe('sold');
    expect(strikeCapReading(res({ ...all, ...CURED }), 60).state).toBe('cured');
    expect(strikeCapReading(res(all), 60).state).toBe('called');
    expect(strikeCapReading(res({ ...all, strikeMarginMonth: null }), 60).state).toBe('yielded');
    expect(strikeCapReading(res({ firstStrikeTopUpMonth: 10, strikeTopUpExhaustedMonth: 20 }), 60).state).toBe('short');
    expect(strikeCapReading(res({ firstStrikeTopUpMonth: 10, totalStrikeTopUpBtc: 0.1 }), 60).state).toBe('defended');
    expect(strikeCapReading(res(), 60).state).toBe('idle');
    // A modelled call outranks "off" exactly as a flagged one does.
    expect(strikeCapReading(res(CURED), 0).state).toBe('cured');
    expect(strikeCapReading(res(SOLD), 0).state).toBe('sold');
  });

  it('the notes are the policy card\'s call sentences — with the yield appended exactly as for a flagged call', () => {
    expect(strikeCapNote(strikeCapReading(res(SOLD), 60))).toBe('Strike margin call in month 18 — 0.1429 ₿ sold to bring it back to 65%.');
    expect(strikeCapNote(strikeCapReading(res(CURED), 60)))
      .toBe('Strike margin call in month 18 — cured with $4,000 of cash and 0.0500 ₿ from cold; nothing sold.');
    expect(strikeCapNote(strikeCapReading(res({ ...SOLD, firstSurvivalYieldMonth: 12 }), 60)))
      .toBe('Strike margin call in month 18 — 0.1429 ₿ sold to bring it back to 65%. Strike gave way to keep Coinbase alive in month 12.');
  });

  it('against the engine: the call fixture reads sold, with cash cured; with the policy off it never reaches either', () => {
    expect(strikeCapReading(callRun(), 60).state).toBe('sold');
    expect(strikeCapReading(callRun({ openingCashUsd: CASH_6_USD }), 60).state).toBe('cured');
    const off = strikeCapReading(runCyclingSim({ ...CALL_BASE, pricePath: CALL_PATH }), 60);
    expect(off.call).toBeNull();
    expect(['sold', 'cured']).not.toContain(off.state);
  });
});

describe('⭐ verdictVsNeverDraw — the all-in basis (spec v1.4 #21)', () => {
  it('a result with unpaid bills on BOTH sides flips `wins` against the raw-equity answer', () => {
    const last = mkRow({ equity: 100_000, btcHeld: 2 });
    const sim = {
      liqMonth: null, last, baselineEquity: 95_000, baselineBtc: 2,
      totalUnfundedUsd: 10_000, totalCashToBillsUsd: 0, totalCashToCureUsd: 0, baselineUnfundedUsd: 2_000,
    };
    expect(sim.last.equity).toBeGreaterThan(sim.baselineEquity);   // raw: the run wins by $5,000 …
    expect(verdictVsNeverDraw(sim, 'cycle')).toEqual({            // … all-in it loses by $3,000
      kind: 'loses', wins: false, equityDelta: -3_000, btcDelta: 0, allIn: true,
    });
  });

  it('⭐ the engine: policy on, $4k of income against $6k of bills on P3 — loses on raw equity, wins all-in', () => {
    const r = runPolicy(pathP3(), {}, { income: 4_000 });
    expect(r.totalUnfundedUsd).toBeGreaterThan(0);                        // bills unpaid on BOTH sides …
    expect(r.baselineUnfundedUsd).toBeGreaterThan(r.totalUnfundedUsd);    // … more of them on the baseline's
    expect(r.last.equity).toBeLessThan(r.baselineEquity);                 // raw: the run loses
    const v = verdictVsNeverDraw(r, 'cycle');
    expect(v.wins).toBe(true);                                            // all-in: it wins
    expect(v.kind).toBe('wins');
    expect(v.allIn).toBe(true);
    expect(v.equityDelta).toBe(allInEquity(r) - baselineAllInEquity(r));
  });

  it('cash from outside the loop is never a gain — the reserve that paid bills or cured a call counts against the run', () => {
    const last = mkRow({ equity: 100_000, btcHeld: 2 });
    const base = { liqMonth: null, last, baselineEquity: 95_000, baselineBtc: 2, totalUnfundedUsd: 0, baselineUnfundedUsd: 0 };
    const v = verdictVsNeverDraw({ ...base, totalCashToBillsUsd: 4_000, totalCashToCureUsd: 2_000 }, 'cycle');
    expect(v.equityDelta).toBe(-1_000);
    expect(v.allIn).toBe(true);
    expect(v.kind).toBe('loses');
  });
});

// ── Run 2b · v1.2 + the owner's C1 — every cash-flow sentence true of its month ─────────────────────────────────────

describe('⭐ verdictVsNeverDraw.allIn and the head\'s basis clause — through the ONE dust floor (v1.2 #11)', () => {
  const last = mkRow({ equity: 100_000, btcHeld: 2 });
  const sim = (o: Partial<{ totalUnfundedUsd: number; totalCashToBillsUsd: number; totalCashToCureUsd: number; baselineUnfundedUsd: number }>) => ({
    liqMonth: null, last, baselineEquity: 95_000, baselineBtc: 2,
    totalUnfundedUsd: 0, totalCashToBillsUsd: 0, totalCashToCureUsd: 0, baselineUnfundedUsd: 0, ...o,
  });

  it('float residue on every adjustment never flips the basis; a real half-dollar does', () => {
    const dust = sim({ totalUnfundedUsd: 1e-10, totalCashToBillsUsd: 1e-10, totalCashToCureUsd: 1e-10, baselineUnfundedUsd: 1e-10 });
    expect(verdictVsNeverDraw(dust, 'cycle').allIn).toBe(false);
    expect(verdictBasisClause(dust)).toBe('');
    expect(verdictVsNeverDraw(sim({ baselineUnfundedUsd: 0.49 }), 'cycle').allIn).toBe(false);
    expect(verdictVsNeverDraw(sim({ baselineUnfundedUsd: 0.5 }), 'cycle').allIn).toBe(true);
  });

  it('the clause names what was counted — "after unpaid bills" alone is false for a cure paid from the reserve', () => {
    expect(verdictBasisClause(sim({ totalUnfundedUsd: 10_000 }))).toBe(', after unpaid bills');
    expect(verdictBasisClause(sim({ baselineUnfundedUsd: 2_000 }))).toBe(', after unpaid bills');
    expect(verdictBasisClause(sim({ totalCashToCureUsd: 4_000 }))).toBe(', after reserve cash');
    expect(verdictBasisClause(sim({ totalCashToBillsUsd: 4_000, baselineUnfundedUsd: 4_000 }))).toBe(', after unpaid bills and reserve cash');
    expect(verdictBasisClause(sim({}))).toBe('');
    // The engine: the cash cure pays every bill and the baseline has none unpaid — reserve cash is the only adjustment.
    const cured = callRun({ openingCashUsd: CASH_6_USD });
    expect([cured.totalUnfundedUsd, cured.baselineUnfundedUsd, cured.totalCashToBillsUsd]).toEqual([0, 0, 0]);
    expect(cured.totalCashToCureUsd).toBeGreaterThan(0);
    expect(verdictBasisClause(cured)).toBe(', after reserve cash');
    expect(verdictVsNeverDraw(cured, 'cycle').allIn).toBe(true);
  });
});

describe('⭐ noBillsNote — no bills is not a pause (v1.2 #9)', () => {
  it('exact copy; the paid-down suffix shows at $0.50 and not below', () => {
    expect(noBillsNote(mkRow({ btcBoughtUsd: 8_000 }))).toBe('No bills to fund, so $8,000/mo buys bitcoin.');
    expect(noBillsNote(mkRow({ btcBoughtUsd: 6_000, payDownUsd: 1_500, restoreUsd: 500 })))
      .toBe('No bills to fund, so $6,000/mo buys bitcoin. $2,000 of spare income paid debt down first.');
    expect(noBillsNote(mkRow({ btcBoughtUsd: 8_000, payDownUsd: 0.3, restoreUsd: 0.2 }))).toContain('of spare income paid debt down first.');
    expect(noBillsNote(mkRow({ btcBoughtUsd: 8_000, payDownUsd: 0.29, restoreUsd: 0.2 }))).toBe('No bills to fund, so $8,000/mo buys bitcoin.');
  });

  it('against the engine: at $0 of bills the "drawing" month draws $0 — policy on and off read the same true sentence', () => {
    const off = runCyclingSim({ ...SP_REPRO, expenses: 0, pricePath: pathP1() }).rows[1];
    const on = runPolicy(pathP1(), {}, { expenses: 0 }).rows[1];
    for (const r of [off, on]) {
      expect(r.strikeDrawn).toBe(0);
      expect(cashFlowAtMonth(r, SP_REPRO.income, 0, true).mode).toBe('stopped');   // why the old copy lied
      expect(noBillsNote(r)).toBe('No bills to fund, so $8,000/mo buys bitcoin.');
    }
    // Pay down with no bills: spare income retires the opening debt first, and the sentence says so.
    const pd = runPolicy(pathP2(0), {}, { expenses: 0 }).rows.find((r) => r.policyZone === 'payDown' && shownUsd(r.payDownUsd))!;
    expect(pd).toBeDefined();
    expect(noBillsNote(pd)).toBe(`No bills to fund, so ${fmtUSD(pd.btcBoughtUsd)}/mo buys bitcoin. `
      + `${fmtUSD(pd.payDownUsd + pd.restoreUsd)} of spare income paid debt down first.`);
  });
});

describe('the opening and the post-liquidation sentences', () => {
  it('month 0 takes no action — so the opening sentence is the only true one there', () => {
    const r0 = runCyclingSim({ ...SP_REPRO, pricePath: pathP1() }).rows[0];
    expect([r0.strikeDrawn, r0.btcBoughtUsd]).toEqual([0, 0]);
    expect(OPENING_CASH_FLOW_NOTE).toBe("Today's opening position — nothing is drawn or bought until month 1.");
  });

  it('after a liquidation (policy off) borrowing has ended — never "until the price recovers"', () => {
    expect(liquidatedCashFlowNote(mkRow({ btcBoughtUsd: 2_000 })))
      .toBe('Coinbase has been liquidated — borrowing has ended. Your paycheck pays the bills, so $2,000/mo buys bitcoin.');
    expect(liquidatedCashFlowNote(mkRow({ btcBoughtUsd: 0, unfundedUsd: 2_000 })))
      .toBe('Coinbase has been liquidated — borrowing has ended. Your paycheck pays what it can — $2,000 of bills went unpaid this month.');
  });
});

describe('⭐ C1 — the drawing-month sentence names the cause and the remainder', () => {
  const p9 = a5Cases().find((c) => c.name === 'P9 ($4k / $6k)')!;
  const drawingRows = (r: ReturnType<typeof runCyclingSim>, income: number) =>
    r.rows.filter((x) => x.m > 0 && cashFlowAtMonth(x, income, 6_000, true).mode === 'drawing');

  it('⭐ (a) incomeCoveredUsd is what the paycheck paid — capped at income, so buys + covered === income', () => {
    const off = runCyclingSim(p9.off);
    const over = drawingRows(off, 4_000).filter((x) => x.strikeShortfall > 4_000);
    expect(over.length).toBeGreaterThan(0);                  // the defect's row shape exists on this path
    for (const x of over) {
      const cf = cashFlowAtMonth(x, 4_000, 6_000, true);
      expect(cf.incomeCoveredUsd).toBe(4_000);               // never "$4,052 on a $4,000 paycheck"
      expect(cf.buysUsd + cf.incomeCoveredUsd).toBeCloseTo(4_000, 9);
    }
    for (const r of [off, runCyclingSim(p9.on)]) {
      for (const x of drawingRows(r, 4_000)) {
        const cf = cashFlowAtMonth(x, 4_000, 6_000, true);
        expect(cf.buysUsd + cf.incomeCoveredUsd).toBeCloseTo(4_000, 9);
      }
    }
  });

  it('full draw: today\'s sentence, unchanged — the bold span is the figure that buys', () => {
    const c = drawingCashFlowNote(mkRow({ strikeDrawn: 6_000, strikeShortfall: 0, btcBoughtUsd: 8_000 }), 8_000, 6_000, 13, false);
    expect(cashFlowText(c)).toBe('The line pays your $6,000 of bills, so all $8,000/mo buys bitcoin — not just the $2,000 left over. '
      + 'Those bills become 13% debt until they move to Coinbase.');
    expect(c.strong).toBe('$8,000/mo buys bitcoin');
    expect(drawingCashFlowNote(mkRow({ strikeDrawn: 6_000, strikeShortfall: 0, btcBoughtUsd: 8_000 }), 8_000, 6_000, 13, true))
      .toEqual(c);                                          // a full draw reads the same, policy on or off
  });

  it('partial draw: the cause by policy state; with nothing left to buy it says so instead of "all $0/mo"', () => {
    const row = mkRow({ strikeDrawn: 4_000, strikeShortfall: 2_000, btcBoughtUsd: 6_000 });
    expect(cashFlowText(drawingCashFlowNote(row, 8_000, 6_000, 13, false)))
      .toBe('The line pays $4,000 of your bills, so all $6,000/mo buys bitcoin — not just the $2,000 left over. '
        + "Your paycheck covers $2,000 the line couldn't reach. Those bills become 13% debt until they move to Coinbase.");
    expect(cashFlowText(drawingCashFlowNote(row, 8_000, 6_000, 13, true)))
      .toBe('The line pays $4,000 of your bills, so all $6,000/mo buys bitcoin — not just the $2,000 left over. '
        + "The limits at support (or Strike's own line) capped the draw, so your paycheck covers the other $2,000. "
        + 'Those bills become 13% debt until they move to Coinbase.');
    const short = mkRow({ strikeDrawn: 1_500, strikeShortfall: 4_500, btcBoughtUsd: 0, unfundedUsd: 500 });
    const c = drawingCashFlowNote(short, 4_000, 6_000, 13, false);
    expect(cashFlowText(c)).toBe("The line pays $1,500 of your bills. Your paycheck covers $4,000 the line couldn't reach. "
      + '$500 of bills went unpaid. No bitcoin bought this month. Those bills become 13% debt until they move to Coinbase.');
    expect(c.strong).toBe('');
  });

  it('⭐ policy on, P9 ($4k): the limits at support capped the draw — not "credit exhausted", and never more than the paycheck', () => {
    const on = runCyclingSim(p9.on);
    expect(on.creditExhaustedMonth).toBeNull();              // premise: Strike's OWN line never ran short
    expect(on.firstCeilingThrottleMonth).not.toBeNull();
    const partial = drawingRows(on, 4_000).filter((x) => shownUsd(x.strikeDrawn) && shownUsd(x.strikeShortfall));
    expect(partial.length).toBeGreaterThan(0);
    for (const x of partial) {
      const text = cashFlowText(drawingCashFlowNote(x, 4_000, 6_000, 13, true));
      const covered = cashFlowAtMonth(x, 4_000, 6_000, true).incomeCoveredUsd;
      expect(covered).toBeLessThanOrEqual(4_000);
      expect(text).toContain(`The limits at support (or Strike's own line) capped the draw, so your paycheck covers the other ${fmtUSD(covered)}.`);
      expect(text).not.toContain("the line couldn't reach");
    }
  });

  it('⭐ policy off, P2: a full Strike line reads "no room left" — never "the line pays your $0 of bills"', () => {
    const off = runCyclingSim({ ...SP_REPRO, pricePath: pathP2(0) });
    const zero = drawingRows(off, SP_REPRO.income).filter((x) => !shownUsd(x.strikeDrawn));
    expect(zero.length).toBeGreaterThan(0);
    for (const x of zero) {
      const text = cashFlowText(drawingCashFlowNote(x, SP_REPRO.income, SP_REPRO.expenses, 13, false));
      expect(text).toBe(`Strike's line has no room left, so your paycheck pays the bills: ${fmtUSD(x.btcBoughtUsd)}/mo buys bitcoin.`);
      expect(text).not.toMatch(/The line pays your \$0|debt until/);
    }
  });

  it('zero draw with bills unpaid: "pays what it can", no bitcoin bought, then the tail — P9 ($4k) off', () => {
    const off = runCyclingSim(p9.off);
    const x = drawingRows(off, 4_000).find((r) => !shownUsd(r.strikeDrawn) && shownUsd(r.unfundedUsd))!;
    expect(x).toBeDefined();
    expect(cashFlowText(drawingCashFlowNote(x, 4_000, 6_000, 13, false)))
      .toBe(`Strike's line has no room left, so your paycheck pays what it can. No bitcoin bought this month.${billsRemainderTail(x)}`);
  });

  it('⭐ policy on, a sub-dollar draw: the limits at support left no room — never "Strike\'s line has no room left"', () => {
    // Under the policy a drawing month always draws SOMETHING (policyAvailable > 0), so a zero draw there is only a
    // sub-dollar room left by the limits — the cause is the limits, never a full Strike line.
    const dust = mkRow({ strikeDrawn: 1e-10, strikeShortfall: 6_000 - 1e-10, btcBoughtUsd: 2_000 });
    expect(cashFlowText(drawingCashFlowNote(dust, 8_000, 6_000, 13, true)))
      .toBe("The limits at support (or Strike's own line) leave no room to borrow this month, so your paycheck pays the bills: "
        + '$2,000/mo buys bitcoin.');
    expect(cashFlowText(drawingCashFlowNote(dust, 8_000, 6_000, 13, false)))
      .toBe("Strike's line has no room left, so your paycheck pays the bills: $2,000/mo buys bitcoin.");
  });
});
