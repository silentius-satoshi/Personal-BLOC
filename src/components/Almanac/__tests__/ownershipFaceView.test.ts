import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chartOwnershipRows, ownershipHero, modeConstraints, MODE_NOTE, unfundedNote, strikeCallVerdict, liquidationVerdict,
  shownDefense, shiftShown, btcAxisDecimals,
} from '../ownershipFaceView';
import { SHIFT_DUST_USD } from '../../../simulation/cbDefense';
import { strikeCapReading, strikeCapNote, chartCliffUsd } from '../cyclingFaceView';
import { deriveOwnership } from '../../../simulation/ownership';
import { CB_LLTV, CB_LIF } from '../../../simulation/runCoinbaseLoan';
import {
  effectiveStrikeCapPct, runCyclingSim, CB_LIQUIDATION_PENALTY, type CyclingRow,
} from '../../../simulation/cyclingSim';
import { STRIKE_MARGIN_CALL_LTV } from '../../../simulation/emergencyModel';
import {
  runPolicy, pathP1, callRun, CASH_6_USD, stressFrom12, reachGrid, policyFor, faceWorldGrid, SP_REPRO,
} from '../../../simulation/__tests__/supportPolicyPaths';
import { fmtUSD, fmtLtvPct } from '../../../utils/format';

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
  strikeInterestUsd: 0,
  strikeMinPaidUsd: 0,
  defenseDrawnUsd: 0,
  cbLtvPreDefense: null,
  defenseShortfallUsd: 0,
  defended: false,
  strikeToCbBtc: 0,
  strikeToColdBtc: 0,
  sweptToColdBtc: 0,
  refinancedUsd: 0,
  refinancedFeeUsd: 0,
  strikeKeepBtc: null,
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
  strikeRepaidUsd: 0,
  cbRepaidUsd: 0,
  cashReserveUsd: 0,
  cashToBillsUsd: 0,
  cashToCureUsd: 0,
  strikeCall: 'none',
  strikeCureColdBtc: 0,
  strikeLiquidatedBtc: 0,
  netCoinsBtc: null,
  atGoal: null,
  goalHeldUsd: 0,
  goalStandDown: false,
  ...o,
});

describe('chartOwnershipRows — the cold series', () => {
  it('⭐ cold is a SUBSET of held, never an addition to it', () => {
    // btcHeld is all three pools, so the Held line ALREADY contains the cold coins. Plotting cold makes
    // visible a share Held was otherwise hiding; adding them would double-count the same bitcoin.
    const [r] = chartOwnershipRows([mkRow({ strikeCollateralBtc: 1, cbCollateralBtc: 1, coldBtc: 1, btcHeld: 3 })]);
    expect(r.cold).toBe(1);
    expect(r.held).toBe(3);
    expect(r.cold).toBeLessThanOrEqual(r.held);
  });

  it('cold is 0 when the sweep is off, and the other series are untouched', () => {
    const off = chartOwnershipRows([mkRow({ coldBtc: 0 })])[0];
    const on  = chartOwnershipRows([mkRow({ coldBtc: 0.5 })])[0];
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
    })])[0];
    expect(r.yours).toBeGreaterThanOrEqual(r.cold);
  });

  it('rounds to 4dp like every other series, so the tooltip never shows float noise', () => {
    const r = chartOwnershipRows([mkRow({ coldBtc: 1 / 3 })])[0];
    expect(r.cold).toBe(0.3333);
  });
});

describe('chartOwnershipRows — no fake liquidation line', () => {
  it('⭐ a debt-free leg or a zero-collateral leg produces a null liq, never a $0 line', () => {
    // $0 would read as "never liquidates". Debt-free, the price is undefined; unbacked, it is unbounded.
    expect(chartOwnershipRows([mkRow({ cbDebt: 0, debt: 20_000 })])[0].liq).toBeNull();
    expect(chartOwnershipRows([mkRow({ cbCollateralBtc: 0 })])[0].liq).toBeNull();
    expect(chartOwnershipRows([mkRow()])[0].liq).toBe(Math.round(80_000 / (CB_LLTV * 2)));
  });

  it('non-finite LTVs become null chart gaps, not NaN', () => {
    const r = chartOwnershipRows([mkRow({ cbLtv: Infinity, strikeLtv: Infinity })])[0];
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
    expect(chartOwnershipRows([r])[0].cbLimit).toBeNull();                 // policy off: no series
    expect(chartOwnershipRows([r], 60)[0].cbLimit).toBe(+(60 / 1.35).toFixed(1));
    expect(chartOwnershipRows([mkRow({ multiple: 2 })], 60)[0].cbLimit).toBe(30);   // half at 2× support
    expect(chartOwnershipRows([mkRow({ multiple: null })], 60)[0].cbLimit).toBeNull();
  });

  it('on the support line it is a flat line at the stop — the whole idea of the policy in one series', () => {
    const rows = chartOwnershipRows(runPolicy(pathP1()).rows, 60);
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

describe('⭐ liquidationVerdict — where the loan was seized (Policy v2, F5c)', () => {
  it('⭐ on the way down: the month and the liquidation price — never the survivor row\'s "0.0%"; at month-end, as before', () => {
    // P1 × 0.35 from month 12 with 0.5 ₿: the default engine seizes it on the way down in month 12, so row 12 is the
    // survivor — it owes nothing, and its LTV reads 0.0%.
    const r = runPolicy(stressFrom12(pathP1(), 0.35), {}, { openingColdBtc: 0.5 });
    const v = liquidationVerdict(r)!;
    expect(v.text).not.toContain('at 0.0%');
    expect([r.liqMonth, r.seizedOnTheWayDown]).toEqual([12, true]);
    const penalty = `${(CB_LIQUIDATION_PENALTY * 100).toFixed(2)}% penalty`;
    const tail = `Morpho seizes ${r.seizedBtc!.toFixed(4)} ₿ at a ${penalty}, leaving ${r.survivorBtc!.toFixed(4)} ₿.`;
    expect(v).toEqual({ color: 'var(--red)', text: `Liquidated in month 12 on the way down, at ${fmtUSD(r.seizurePriceUsd!)}. ${tail}` });
    // R1 — a seizure price under the dust floor is never named: no "at" clause.
    expect(liquidationVerdict({ ...r, seizurePriceUsd: 0.3 })!.text).toBe(`Liquidated in month 12 on the way down. ${tail}`);
    // A month-end seizure (reach cell 0, at the opening) keeps the breaching row's LTV — and its real deficiency.
    const cell = reachGrid()[0];
    const m0 = runCyclingSim({ ...cell.off, supportPolicy: policyFor(cell.support) });
    expect([m0.liqMonth, m0.seizedOnTheWayDown]).toEqual([0, false]);
    expect(liquidationVerdict(m0)).toEqual({
      color: 'var(--red)',
      text: `Liquidated in month 0 at ${fmtLtvPct(m0.rows[0].cbLtv)}. Morpho seizes ${m0.seizedBtc!.toFixed(4)} ₿ at a `
        + `${penalty}, leaving ${m0.survivorBtc!.toFixed(4)} ₿. ${fmtUSD(m0.deficiencyUsd!)} of debt survives — both `
        + 'facilities are full recourse.',
    });
    expect(liquidationVerdict(runPolicy(pathP1()))).toBeNull();
  });
});

// ── Policy v2, Run B ─────────────────────────────────────────────────────────────────────────────────────────────

describe('⭐ chartOwnershipRows — the cliff is cbSeizurePrice, the one per-row formula (Run B, B2)', () => {
  it('⭐ liq is chartCliffUsd on every row — and null from the liquidation month on, where the old formula still drew', () => {
    const p1 = runPolicy(pathP1());
    expect(chartOwnershipRows(p1.rows).map((x) => x.liq)).toEqual(p1.rows.map((x) => chartCliffUsd(x)));
    // Policy off: the first face-world cell with a month-end liquidation that leaves a deficiency (found by predicate).
    let hit: ReturnType<typeof runCyclingSim> | undefined;
    for (const c of faceWorldGrid()) {
      const r = runCyclingSim(c.off);
      if (r.liqMonth !== null && r.deficiencyUsd !== null) { hit = r; break; }
    }
    const L = hit!.liqMonth!;
    // Premise: after the seizure the leftover debt sits against newly pledged coins — the old formula drew a cliff there.
    expect(hit!.rows.slice(L + 1).some((x) => x.cbDebt > 0 && x.cbCollateralBtc > 0)).toBe(true);
    const rows = chartOwnershipRows(hit!.rows);
    expect(rows.map((x) => x.liq)).toEqual(hit!.rows.map((x) => chartCliffUsd(x)));
    expect(rows.slice(L).every((x) => x.liq === null)).toBe(true);
    expect(rows.slice(0, L).some((x) => x.liq !== null)).toBe(true);
  });
});

describe('⭐ liquidationVerdict — a deficiency under the dust floor is never printed (Run B, B6)', () => {
  it('⭐ a 30¢ leftover reads as no deficiency — never "$0 of debt survives"', () => {
    const r = runCyclingSim({ ...SP_REPRO, cbCollateralBtc: 1, cbDebt: 50_000 / CB_LIF + 0.3, pricePath: [50_000, 50_000] });
    expect(r.liqMonth).toBe(0);                                      // premise: seized at the opening …
    expect(r.deficiencyUsd!).toBeCloseTo(0.3, 6);                   // … leaving 30¢ owed
    const v = liquidationVerdict(r)!;
    expect(v.text).not.toContain('of debt survives');
    expect(v.text).not.toMatch(/\$0(?![\d,])/);
    expect(v).toEqual(liquidationVerdict({ ...r, deficiencyUsd: null }));
  });
});

// ── Sweep 3 — the shifts a face shows (A1-10) and the ₿ axis's decimals (A4-9) ───────────────────────────────────────
// (Hardening 2's HS-26 sits in ownershipFaceViewHardening2.test.ts.)

const faceSrc = (f: string): string => readFileSync(join(process.cwd(), 'src/components/Almanac', f), 'utf8');

describe('⭐ Sweep 3 — a float overage is no defense on any face (A1-10)', () => {
  it('⭐ DUST — the policy-off defense of a refinance capped at the line: the engine books it, no face shows it', () => {
    // The audit's case: flat $30,000, Coinbase 1 ₿ owing $20,000, a $100,000 line, $8k in, $6k out, the 70% stop.
    const sim = runCyclingSim({
      ...SP_REPRO, strikeCreditLine: 100_000, cbDebt: 20_000, cbAprPct: 6, strikeLtvCapPct: undefined,
      coldStoreBufferPct: undefined, pricePath: new Array(13).fill(30_000),
    });
    expect(sim.defenseCount, 'DUST premise: the engine books a defense').toBeGreaterThan(0);
    expect(sim.rows.every((r) => r.defenseDrawnUsd < SHIFT_DUST_USD), 'DUST premise: every shift is a float overage').toBe(true);
    expect(shownDefense(sim.rows), 'DUST no note, no tile').toEqual({ count: 0, totalUsd: 0, firstMonth: null });
    expect(sim.rows.filter(shiftShown), 'DUST no ⇄').toEqual([]);
  });

  it('⭐ REAL — a real defense reads as before: the engine\'s count, total and first month', () => {
    const sim = runCyclingSim({ ...SP_REPRO, pricePath: stressFrom12(pathP1(), 0.35) });
    expect(sim.defenseCount, 'REAL premise: a defense').toBeGreaterThan(0);
    expect(sim.rows.filter((r) => r.defenseDrawnUsd > 0).every(shiftShown), 'REAL premise: no dust row').toBe(true);
    const shown = shownDefense(sim.rows);
    expect([shown.count, shown.firstMonth]).toEqual([sim.defenseCount, sim.firstDefenseMonth]);
    expect(shown.totalUsd).toBeCloseTo(sim.totalDefenseDrawnUsd, 6);
  });

  it('⭐ WIRED — the three faces read the rule, never the engine\'s count or `defended`', () => {
    for (const f of ['CyclingFace.tsx', 'OwnershipFace.tsx', 'UnifiedFace.tsx']) {
      const src = faceSrc(f);
      expect(src, `WIRED ${f}: no engine count`).not.toMatch(/defenseCount|totalDefenseDrawnUsd|firstDefenseMonth|\.defended\b/);
      expect(src.match(/shiftShown\(r\)/g)?.length, `WIRED ${f}: both ⇄ through shiftShown`).toBe(2);
    }
    for (const f of ['CyclingFace.tsx', 'OwnershipFace.tsx']) {
      const src = faceSrc(f);
      expect(src, `WIRED ${f}: the note and the tile gate on the shown count`).toContain('const defenseActive = defense.count > 0;');
      expect(src, `WIRED ${f}`).toContain('const defense = shownDefense(rows);');
    }
  });
});

describe('⭐ Sweep 3 — the ₿ axis never repeats a label (A4-9)', () => {
  it('⭐ AXIS — the decimals come from the span the chart plots; a stack from 1 ₿ keeps one', () => {
    const rows = (held: number) => [{ held: 0, yours: 0, owed: 0, cold: 0 }, { held, yours: held * 0.5, owed: held * 0.5, cold: 0 }];
    expect([rows(0.05), rows(0.12), rows(0.6), rows(1), rows(24)].map(btcAxisDecimals)).toEqual([3, 2, 2, 1, 1]);
    // The reported axis: Recharts' ticks over [0, 0.12].
    const ticks = [0, 0.03, 0.06, 0.09, 0.12];
    const at = (d: number) => ticks.map((x) => `${x.toFixed(d)}₿`);
    expect(at(1), 'AXIS the bug, as reported').toEqual(['0.0₿', '0.0₿', '0.1₿', '0.1₿', '0.1₿']);
    expect(at(btcAxisDecimals(rows(0.12)))).toEqual(['0.00₿', '0.03₿', '0.06₿', '0.09₿', '0.12₿']);
    // An underwater stack (yours below zero) widens the span.
    expect(btcAxisDecimals([{ held: 0.5, yours: -0.6, owed: 1.1, cold: 0 }])).toBe(1);
    for (const f of ['OwnershipFace.tsx', 'UnifiedFace.tsx']) {
      const src = faceSrc(f);
      expect(src, `AXIS ${f}`).toContain('const btcDecimals = btcAxisDecimals(chartRows);');
      expect(src, `AXIS ${f}`).toContain('tickFormatter={(x) => `${x.toFixed(btcDecimals)}₿`}');
      expect(src, `AXIS ${f}: no fixed one decimal`).not.toContain('tickFormatter={(x) => `${x.toFixed(1)}₿`}');
    }
  });
});
