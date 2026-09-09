import { describe, it, expect } from 'vitest';
import { chartOwnershipRows } from '../ownershipFaceView';
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
  strikeCollateralBtc: 1,
  cbCollateralBtc: 2,
  coldBtc: 0,
  btcHeld: 3,
  cbLtv: 0.5,
  strikeLtv: 0.25,
  collateralValue: 240_000,
  equity: 140_000,
  postLiquidation: false,
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
