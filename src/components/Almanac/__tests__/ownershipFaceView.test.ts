import { describe, it, expect } from 'vitest';
import {
  chartOwnershipRows, ownershipHero, modeConstraints, MODE_NOTE, unfundedNote, strikeCallVerdict,
} from '../ownershipFaceView';
import { strikeCapReading, strikeCapNote } from '../cyclingFaceView';
import { deriveOwnership } from '../../../simulation/ownership';
import { CB_LLTV } from '../../../simulation/runCoinbaseLoan';
import { effectiveStrikeCapPct, type CyclingRow } from '../../../simulation/cyclingSim';
import { STRIKE_MARGIN_CALL_LTV } from '../../../simulation/emergencyModel';
import { runPolicy, pathP1, callRun, CASH_6_USD } from '../../../simulation/__tests__/supportPolicyPaths';

/** A plain fixture row — no engine run needed for display math. */
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
  cbLtv: 0.5,
  strikeLtv: 0.25,
  collateralValue: 240_000,
  equity: 140_000,
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

describe('chartOwnershipRows — the cold series', () => {
  it('⭐ cold is a SUBSET of held, never an addition to it', () => {
    // btcHeld is all three pools, so the Held line ALREADY contains the cold coins. Plotting cold makes
    // visible a share Held was otherwise hiding; adding them would double-count the same bitcoin.
    const [r] = chartOwnershipRows([mkRow({ strikeCollateralBtc: 1, cbCollateralBtc: 1, coldBtc: 1, btcHeld: 3 })], CB_LLTV);
    expect(r.cold).toBe(1);
    expect(r.held).toBe(3);
    expect(r.cold).toBeLessThanOrEqual(r.held);
  });

  it('cold is 0 when the sweep is off, and the other series are untouched', () => {
    const off = chartOwnershipRows([mkRow({ coldBtc: 0 })], CB_LLTV)[0];
    const on  = chartOwnershipRows([mkRow({ coldBtc: 0.5 })], CB_LLTV)[0];
    expect(off.cold).toBe(0);
    // held/yours/owed read btcHeld and debt, which the fixture holds constant — only `cold` moves.
    expect(on.held).toBe(off.held);
    expect(on.yours).toBe(off.yours);
    expect(on.owed).toBe(off.owed);
    expect(on.cold).toBe(0.5);
  });

  it('cold is a floor under yours — coins no lender can reach', () => {
    // With cold at 1 ₿ and the debt fully coverable, `yours` must never dip below the cold holding:
    // the lender's claim reaches only the pledged pools.
    const r = chartOwnershipRows([mkRow({
      strikeCollateralBtc: 1, cbCollateralBtc: 1, coldBtc: 1, btcHeld: 3,
      debt: 80_000, price: 80_000,   // 1 ₿ of debt against 2 ₿ pledged
    })], CB_LLTV)[0];
    expect(r.yours).toBeGreaterThanOrEqual(r.cold);
  });

  it('rounds to 4dp like every other series, so the tooltip never shows float noise', () => {
    const r = chartOwnershipRows([mkRow({ coldBtc: 1 / 3 })], CB_LLTV)[0];
    expect(r.cold).toBe(0.3333);
  });
});

describe('chartOwnershipRows — no fake liquidation line', () => {
  it('⭐ a debt-free leg or a zero-collateral leg produces a null liq, never a $0 line', () => {
    // $0 would read as "never liquidates". Debt-free, the price is undefined; unbacked, it is unbounded.
    expect(chartOwnershipRows([mkRow({ cbDebt: 0, debt: 20_000 })], CB_LLTV)[0].liq).toBeNull();
    expect(chartOwnershipRows([mkRow({ cbCollateralBtc: 0 })], CB_LLTV)[0].liq).toBeNull();
    expect(chartOwnershipRows([mkRow()], CB_LLTV)[0].liq).toBe(Math.round(80_000 / (CB_LLTV * 2)));
  });

  it('non-finite LTVs become null chart gaps, not NaN', () => {
    const r = chartOwnershipRows([mkRow({ cbLtv: Infinity, strikeLtv: Infinity })], CB_LLTV)[0];
    expect(r.cbLtv).toBeNull();
    expect(r.strikeLtv).toBeNull();
  });
});

describe('shared ownership rules — extracted from OwnershipFace (one definition each)', () => {
  it('⭐ ownershipHero reads deriveOwnership, the definition — never an open-coded subtraction', () => {
    const base = mkRow({ m: 0, btcHeld: 3, debt: 100_000, price: 80_000 });
    const row = mkRow({ btcHeld: 3.5, debt: 120_000, price: 100_000 });
    const o = deriveOwnership(3.5, 120_000, 100_000);
    const today = deriveOwnership(3, 100_000, 80_000).yoursBtc;
    expect(ownershipHero(row, base)).toEqual({
      heldBtc: 3.5, owedBtc: o.lendersBtc, yoursBtc: o.yoursBtc, yoursDisplayBtc: o.yoursBtc,
      netToday: today, deltaVsToday: o.yoursBtc - today, yoursShare: o.yoursShare, lendersShare: o.lendersShare,
    });
    expect(o.yoursShare + o.lendersShare).toBeCloseTo(1, 12);
  });

  it('⭐ the hero clamp is DISPLAY ONLY — an underwater row shows 0 while the raw figure stays negative', () => {
    const base = mkRow({ m: 0 });
    const underwater = mkRow({ btcHeld: 1, debt: 200_000, price: 80_000 });   // the debt buys 2.5 ₿ of 1 held
    const h = ownershipHero(underwater, base);
    expect(h.yoursBtc).toBeLessThan(0);
    expect(h.yoursDisplayBtc).toBe(0);
    // The "vs today" delta reads the RAW figure — a clamped delta would hide how far under water it is.
    expect(h.deltaVsToday).toBeCloseTo(h.yoursBtc - h.netToday, 12);
    expect(h.deltaVsToday).toBeLessThan(-h.netToday);
  });

  it('modeConstraints: C2 only in cycle mode on the engine\'s ground truth, C1 only for a no-draw deficit', () => {
    expect(modeConstraints('cycle', null, 8_000, 6_000, 0)).toEqual({ degenerateCap: true, deficitMode: false, cycleUnfunded: false });
    expect(modeConstraints('cycle', 1, 8_000, 6_000, 0)).toEqual({ degenerateCap: false, deficitMode: false, cycleUnfunded: false });
    expect(modeConstraints('cycle', null, 5_000, 6_000, 0).deficitMode).toBe(false);   // cycle draws — never C1
    expect(modeConstraints('hold', null, 5_000, 6_000, 0)).toEqual({ degenerateCap: false, deficitMode: true, cycleUnfunded: false });
    expect(modeConstraints('clearBoth', 3, 6_000, 6_000, 0).deficitMode).toBe(false);  // equal is not a deficit
  });

  it('⭐ modeConstraints: cycleUnfunded only in cycle mode, only when the engine found an unpaid gap', () => {
    expect(modeConstraints('cycle', 1, 4_000, 6_000, 46_000).cycleUnfunded).toBe(true);
    expect(modeConstraints('cycle', 1, 4_000, 6_000, 0).cycleUnfunded).toBe(false);
    // Non-cycle modes keep C1 (deficitMode) — never a second notice for the same gap.
    for (const mode of ['hold', 'clearStrike', 'clearBoth'] as const) {
      const c = modeConstraints(mode, null, 4_000, 6_000, 48_000);
      expect(c.cycleUnfunded).toBe(false);
      expect(c.deficitMode).toBe(true);
    }
  });

  it('⭐ unfundedNote: cause-neutral — true whether the stop halted the draw or the credit line ran out', () => {
    // Moved pin (v1.2 #8): the baseline's gap is now REQUIRED and measured — "has the same gap" was an assumption.
    expect(unfundedNote(2, 46_000, 48_000)).toBe(
      'From month 2, bills exceed what income and the credit line can cover — $46,000 over this run is paid by '
      + 'nothing in the model. The never-draw comparison leaves $48,000 unpaid over the same run.',
    );
    expect(unfundedNote(7, 2_499.6, 0)).toContain('$2,500 over this run');   // rounded to the dollar
    expect(unfundedNote(null, 0, 0)).toBe('');
  });

  it('MODE_NOTE: hold says it IS the baseline (C3), and every strategy has a note', () => {
    expect(MODE_NOTE.hold).toContain('IS the never-draw baseline');
    expect(Object.keys(MODE_NOTE).sort()).toEqual(['clearBoth', 'clearStrike', 'cycle', 'hold']);
  });
});

// ── Run 2a · the support policy's extensions (support policy faces, §A4) ─────────────────────────────────────────

describe('chartOwnershipRows — the policy limit series (cbLimit)', () => {
  it('is policyLimitPct, rounded to 1 dp like the other LTV series, when the stop is given; null without it', () => {
    const r = mkRow({ multiple: 1.35 });
    expect(chartOwnershipRows([r], CB_LLTV)[0].cbLimit).toBeNull();                 // policy off: no series
    expect(chartOwnershipRows([r], CB_LLTV, 60)[0].cbLimit).toBe(+(60 / 1.35).toFixed(1));
    expect(chartOwnershipRows([mkRow({ multiple: 2 })], CB_LLTV, 60)[0].cbLimit).toBe(30);   // half at 2× support
    expect(chartOwnershipRows([mkRow({ multiple: null })], CB_LLTV, 60)[0].cbLimit).toBeNull();
  });

  it('on the support line it is a flat line at the stop — the whole idea of the policy in one series', () => {
    const rows = chartOwnershipRows(runPolicy(pathP1()).rows, CB_LLTV, 60);
    expect(rows.slice(1).every((x) => x.cbLimit === 60)).toBe(true);
  });
});

describe('unfundedNote — the baseline\'s own gap', () => {
  it('⭐ three arguments: the never-draw comparison\'s measured gap replaces the fixed sentence', () => {
    expect(unfundedNote(12, 72_000, 144_000)).toBe(
      'From month 12, bills exceed what income and the credit line can cover — $72,000 over this run is paid by '
      + 'nothing in the model. The never-draw comparison leaves $144,000 unpaid over the same run.',
    );
    expect(unfundedNote(12, 72_000, 0)).toBe(
      'From month 12, bills exceed what income and the credit line can cover — $72,000 over this run is paid by '
      + 'nothing in the model. The never-draw comparison pays every bill over the same run.',
    );
    expect(unfundedNote(null, 0, 5_000)).toBe('');
    expect(unfundedNote(12, 72_000, 0.3)).toContain('pays every bill');   // the one dust floor
  });
});

describe('⭐ strikeCallVerdict — Ownership enters its Strike-call branch on the READING (C2)', () => {
  const cap = (r: ReturnType<typeof callRun>) => strikeCapReading(r, effectiveStrikeCapPct(60, STRIKE_MARGIN_CALL_LTV));

  it('the support policy\'s sale and cash cure: the flag is null, yet the verdict names the call', () => {
    const sold = callRun();
    const cured = callRun({ openingCashUsd: CASH_6_USD });
    // Premise — M1: under the policy a resolved call ends at ≤ 65%, so the old branch key never fired.
    expect(sold.strikeMarginMonth).toBeNull();
    expect(cured.strikeMarginMonth).toBeNull();
    expect(cap(sold).state).toBe('sold');
    expect(cap(cured).state).toBe('cured');
    expect(strikeCallVerdict(cap(sold))).toEqual({ color: 'var(--red)', text: strikeCapNote(cap(sold)) });
    expect(strikeCallVerdict(cap(sold))!.text).toMatch(/^Strike margin call in month 1 — .+ sold to bring it back to 65%\.$/);
    expect(strikeCallVerdict(cap(cured))).toEqual({ color: 'var(--amber)', text: strikeCapNote(cap(cured)) });
    expect(strikeCallVerdict(cap(cured))!.text).toContain('cured with');
  });

  it('a flagged call keeps today\'s sentence (policy off, byte-identical) — with the yield appended; nothing else enters', () => {
    const res = (o: Partial<Parameters<typeof strikeCapReading>[0]>): Parameters<typeof strikeCapReading>[0] => ({
      strikeMarginMonth: null, firstSurvivalYieldMonth: null, strikeTopUpExhaustedMonth: null,
      firstStrikeTopUpMonth: null, totalStrikeTopUpBtc: 0, liqMonth: null,
      firstStrikeCallMonth: null, strikeCallsCured: 0, strikeCallsSold: 0, totalCashToCureUsd: 0,
      totalStrikeCureColdBtc: 0, totalStrikeLiquidatedBtc: 0, ...o,
    });
    expect(strikeCallVerdict(strikeCapReading(res({ strikeMarginMonth: 46 }), 60)))
      .toEqual({ color: 'var(--red)', text: 'Strike margin call in month 46. 72-hour cure window, unlike Coinbase.' });
    expect(strikeCallVerdict(strikeCapReading(res({ strikeMarginMonth: 46, firstSurvivalYieldMonth: 40 }), 60))!.text)
      .toBe('Strike margin call in month 46. 72-hour cure window, unlike Coinbase. Strike gave way to keep Coinbase alive in month 40.');
    for (const o of [{}, { firstStrikeTopUpMonth: 10, totalStrikeTopUpBtc: 0.1 }, { strikeTopUpExhaustedMonth: 8 }, { firstSurvivalYieldMonth: 8 }]) {
      expect(strikeCallVerdict(strikeCapReading(res(o), 60))).toBeNull();
    }
  });
});
