import { describe, it, expect } from 'vitest';
import { applyPriceLens, btcGained, holdingsSplit, clampMonth } from '../cyclingFaceView';
import { runCyclingSim, type CyclingRow, type CyclingInputs } from '../../../simulation/cyclingSim';

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
  strikeCollateralBtc: 1,
  cbCollateralBtc: 2,
  btcHeld: 3,
  cbLtv: 80_000 / (2 * 80_000),
  strikeLtv: 20_000 / (1 * 80_000),
  collateralValue: 3 * 80_000,
  equity: 3 * 80_000 - 100_000,
  postLiquidation: false,
  ...o,
});

describe('applyPriceLens', () => {
  it('is the identity at multiplier 1', () => {
    const r = mkRow();
    const l = applyPriceLens(r, 1);
    expect(l.price).toBeCloseTo(r.price, 9);
    expect(l.cbLtv).toBeCloseTo(r.cbLtv, 12);
    expect(l.strikeLtv).toBeCloseTo(r.strikeLtv, 12);
    expect(l.collateralValue).toBeCloseTo(r.collateralValue, 6);
    expect(l.equity).toBeCloseTo(r.equity, 6);
  });

  it('halving the price doubles BOTH LTVs', () => {
    const r = mkRow();
    const l = applyPriceLens(r, 0.5);
    expect(l.cbLtv).toBeCloseTo(r.cbLtv * 2, 12);
    expect(l.strikeLtv).toBeCloseTo(r.strikeLtv * 2, 12);
    expect(l.price).toBeCloseTo(40_000, 9);
  });

  it('leaves the row itself untouched — debt and BTC counts are held fixed', () => {
    const r = mkRow();
    const before = { debt: r.debt, btcHeld: r.btcHeld, cbDebt: r.cbDebt };
    applyPriceLens(r, 0.4);
    expect(r.debt).toBe(before.debt);
    expect(r.btcHeld).toBe(before.btcHeld);
    expect(r.cbDebt).toBe(before.cbDebt);
  });

  it('yoursBtc is btcHeld minus the debt repriced at the lensed price', () => {
    const r = mkRow();
    expect(applyPriceLens(r, 2).yoursBtc).toBeCloseTo(3 - 100_000 / 160_000, 12);
  });

  it('guards a non-positive multiplier or price — no NaN, yoursBtc falls back to btcHeld', () => {
    const r = mkRow();
    for (const l of [applyPriceLens(r, 0), applyPriceLens(r, -1), applyPriceLens(mkRow({ price: 0 }), 1.5)]) {
      expect(Number.isFinite(l.price)).toBe(true);
      expect(Number.isFinite(l.cbLtv)).toBe(true);
      expect(l.yoursBtc).toBe(r.btcHeld);
    }
    expect(applyPriceLens(r, 0).price).toBe(r.price);   // the row's OWN price, unchanged
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
    strikeCollateralBtc: 0.96589757,
    strikeBalance: 12_793.51,
    strikeCreditLine: 37_499.90,
    strikeMaxDrawLtv: 0.5,
    strikeMarginLtv: 0.7,
    cbCollateralBtc: 1.72572674,
    cbDebt: 62_292.59,
    income: 4_500,
    expenses: 4_000,
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

  it('reads the two venues straight off the row', () => {
    const s = holdingsSplit(mkRow({ strikeCollateralBtc: 0.75, cbCollateralBtc: 2.25, btcHeld: 3 }));
    expect(s).toEqual({ strike: 0.75, coinbase: 2.25, combined: 3 });
  });
});

describe('clampMonth — the shrinking-horizon crash trap', () => {
  it('keeps a stale index inside a shrunken row set', () => {
    // Horizon 240 → 239 with the scrubber parked at the old end. Pre-fix this read rows[240] === undefined
    // and applyPriceLens threw on row.price.
    const wide = new Array(241).fill(0).map((_, m) => mkRow({ m }));
    const narrow = new Array(240).fill(0).map((_, m) => mkRow({ m }));
    const selected = wide.length - 1;                 // 240
    expect(clampMonth(selected, wide.length)).toBe(240);

    const idx = clampMonth(selected, narrow.length);
    expect(idx).toBe(239);
    expect(narrow[idx]).toBeDefined();
    expect(() => applyPriceLens(narrow[idx], 1)).not.toThrow();
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
