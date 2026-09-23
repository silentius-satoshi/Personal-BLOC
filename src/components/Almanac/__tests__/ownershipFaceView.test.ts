import { describe, it, expect } from 'vitest';
import { chartOwnershipRows, ownershipHero, modeConstraints, MODE_NOTE, unfundedNote } from '../ownershipFaceView';
import { deriveOwnership } from '../../../simulation/ownership';
import { CB_LLTV } from '../../../simulation/runCoinbaseLoan';
import type { CyclingRow } from '../../../simulation/cyclingSim';

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
    expect(unfundedNote(2, 46_000)).toBe(
      'From month 2, bills exceed what income and the credit line can cover — $46,000 over this run is paid by '
      + 'nothing in the model. The never-draw comparison has the same gap.',
    );
    expect(unfundedNote(7, 2_499.6)).toContain('$2,500 over this run');   // rounded to the dollar
    expect(unfundedNote(null, 0)).toBe('');
  });

  it('MODE_NOTE: hold says it IS the baseline (C3), and every strategy has a note', () => {
    expect(MODE_NOTE.hold).toContain('IS the never-draw baseline');
    expect(Object.keys(MODE_NOTE).sort()).toEqual(['clearBoth', 'clearStrike', 'cycle', 'hold']);
  });
});
