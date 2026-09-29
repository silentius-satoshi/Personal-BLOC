import { describe, it, expect } from 'vitest';
import {
  placementPlan, suggestedLineUsd, MOVE_THRESHOLD_BTC, LINE_BILL_MONTHS, LINE_HEADROOM,
  type PlacementInput,
} from '../placement';
import {
  strikeKeepCollateralBtc, cbKeepCollateralBtc, ceilingHeadroomUsd, policyZone,
} from '../supportPolicy';
import { strikeReleasableBtc } from '../cbDefense';
import {
  STRIKE_MAX_DRAW_LTV, STRIKE_RETRIEVE_MAX_LTV, STRIKE_LINE_MIN_USD, STRIKE_LINE_MAX_USD,
} from '../strikeCredit';
import { CB_LLTV } from '../runCoinbaseLoan';
import { ltvOf } from '../ltv';
import { runCyclingSim, allInEquity, type CyclingInputs } from '../cyclingSim';
import { deriveOwnership } from '../ownership';
import { SP_REPRO, SUPPORT, S0, policyFor, a5Cases } from './supportPolicyPaths';

/**
 * THE MOVE (`placement.ts`) — the support policy's collateral placement for this month, previewed at today's
 * inputs. Round synthetic figures only: this repo is public.
 *
 * 🔴 The binding test is I3: the preview must reach the SAME end state the engine's own steps 5 and 9 reach.
 */

const CB_CAP = 0.70;
const BASE: PlacementInput = {
  creditLine: 40_000,
  strikeBalance: 0,
  strikeCollateralBtc: 2,
  cbDebt: 60_000,
  cbCollateralBtc: 2,
  coldBtc: 0.5,
  price: 100_000,
  support: 100_000,
  skStop: 0.50,
  cbStop: 0.60,
  cbDefenseLtv: CB_CAP,
  bufferUsd: 72_000,
  accumulateBelow: 1.5,
  payDownAbove: 2.0,
  inHold: false,
  broken: false,
};
const plan = (o: Partial<PlacementInput> = {}) => placementPlan({ ...BASE, ...o });

// ── I1 · the keep is the engine's own leaf ───────────────────────────────────────────────────────────────────

describe('⭐ I1 — the Strike keep is `strikeKeepCollateralBtc`, with no buffer and no second stop', () => {
  it('⭐ equals the leaf across a sweep of lines, balances and stops', () => {
    for (const creditLine of [0, 3_500, 40_000, 250_000]) {
      for (const strikeBalance of [0, 5_000, 40_000]) {
        for (const skStop of [0.3, 0.5]) {
          const p = plan({ creditLine, strikeBalance, skStop });
          expect(p.strikeKeepBtc, `${creditLine}/${strikeBalance}/${skStop}`)
            .toBeCloseTo(strikeKeepCollateralBtc(creditLine, strikeBalance, skStop, BASE.support), 12);
        }
      }
    }
  });

  it('the Coinbase keep is `cbKeepCollateralBtc`', () => {
    for (const cbDebt of [0, 20_000, 60_000, 150_000]) {
      for (const bufferUsd of [0, 72_000]) {
        const p = plan({ cbDebt, bufferUsd });
        expect(p.cbKeepBtc).toBeCloseTo(
          cbKeepCollateralBtc(cbDebt, bufferUsd, BASE.support, BASE.cbStop, CB_CAP, BASE.price), 12,
        );
      }
    }
  });
});

// ── I2 · conservation ────────────────────────────────────────────────────────────────────────────────────────

describe('⭐ I2 — coins are conserved and every move is non-negative', () => {
  const CASES: Partial<PlacementInput>[] = [
    {}, { strikeCollateralBtc: 10 }, { cbDebt: 0 }, { cbCollateralBtc: 8 }, { coldBtc: 0 },
    { creditLine: 250_000 }, { cbDebt: 150_000 }, { bufferUsd: 0 }, { support: 60_000 }, { support: 40_000 },
  ];
  it.each(CASES.map((c, i) => [i, c] as const))('case %i', (_i, o) => {
    const p = plan(o);
    const before = (o.strikeCollateralBtc ?? BASE.strikeCollateralBtc)
      + (o.cbCollateralBtc ?? BASE.cbCollateralBtc) + (o.coldBtc ?? BASE.coldBtc);
    const after = p.after.strikeCollateralBtc + p.after.cbCollateralBtc + p.after.coldBtc;
    expect(after).toBeCloseTo(before, 12);
    for (const v of [p.strikeToCbBtc, p.strikeToColdBtc, p.cbToColdBtc]) expect(v).toBeGreaterThanOrEqual(0);
    // A Strike release splits between Coinbase and cold, and nothing else.
    const moved = (o.strikeCollateralBtc ?? BASE.strikeCollateralBtc) - p.after.strikeCollateralBtc;
    expect(p.strikeToCbBtc + p.strikeToColdBtc).toBeCloseTo(moved, 12);
    // Coinbase is either being filled or drained, never both.
    if (p.cbToColdBtc > 0) expect(p.strikeToCbBtc).toBe(0);
  });
});

// ── I3 · ENGINE EQUIVALENCE (the binding one) ────────────────────────────────────────────────────────────────

describe('⭐ I3 — the preview reaches the engine\'s own month-1 end state', () => {
  /** A deterministic PRNG, so a failure is reproducible. */
  const rng = (seed: number) => () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 4_294_967_296;
  };
  const P = 100_000;
  /** k chooses the zone: 1 → accumulate, 1.75 → hold, 2.5 → payDown. */
  const ZONES: [string, number][] = [['accumulate', 1], ['hold', 1.75], ['payDown', 2.5]];

  it('⭐ 20,001 random positions across all three zones: month 1 ≡ plan.after', () => {
    const rand = rng(20_260_929);
    let checked = 0;
    const branches = { toCbOnly: 0, split: 0, cbToCold: 0 };
    for (let i = 0; i <= 20_000; i++) {
      const [, k] = ZONES[i % ZONES.length];
      const S = P / k;
      // Bills are 0 in the buy zone (nothing draws or buys) and random elsewhere (the buffer term is exercised
      // and the unpaid bills touch NO collateral). Income is 0 throughout, so no surplus ever restores or repays.
      const expenses = k <= 1.5 ? 0 : Math.round(rand() * 6_000);
      const strikeCollateralBtc = 0.2 + rand() * 6;
      const cbCollateralBtc = 0.2 + rand() * 6;
      const coldBtc = rand() * 3;
      const creditLine = 3_500 + Math.round(rand() * 200_000);
      // Bounded so the DEFENSE never fires — this run must exercise steps 5 and 9 only.
      const cbDebt = Math.round(rand() * cbCollateralBtc * P * CB_CAP * 0.9);
      const bearBufferMonths = 12;

      const inputs: CyclingInputs = {
        ...SP_REPRO,
        income: 0,
        expenses,
        strikeAprPct: 0,
        cbAprPct: 0,
        strikeBalance: 0,
        strikeCollateralBtc,
        cbDebt,
        cbCollateralBtc,
        openingColdBtc: coldBtc,
        strikeCreditLine: creditLine,
        cycleMonths: 1,
        cbLtvCapPct: CB_CAP * 100,
        strikeLtvCapPct: 0,
        coldStoreBufferPct: 0,
        pricePath: [P, P],
        supportPolicy: policyFor([S, S], { bearBufferMonths, openingCashUsd: 0 }),
      };
      const r = runCyclingSim(inputs);
      if (!r.policyApplied || r.liqMonth !== null) continue;

      const p = placementPlan({
        creditLine, strikeBalance: 0, strikeCollateralBtc, cbDebt, cbCollateralBtc, coldBtc,
        price: P, support: S, skStop: 0.50, cbStop: 0.60, cbDefenseLtv: CB_CAP,
        bufferUsd: bearBufferMonths * expenses,
        accumulateBelow: 1.5, payDownAbove: 2.0, inHold: false, broken: false,
      });
      const row = r.rows[1];
      expect(row.strikeCollateralBtc, `i${i} strike`).toBeCloseTo(p.after.strikeCollateralBtc, 12);
      expect(row.cbCollateralBtc, `i${i} cb`).toBeCloseTo(p.after.cbCollateralBtc, 12);
      expect(row.coldBtc, `i${i} cold`).toBeCloseTo(p.after.coldBtc, 12);
      checked += 1;
      if (p.strikeToCbBtc > 0 && p.strikeToColdBtc === 0) branches.toCbOnly += 1;
      if (p.strikeToCbBtc > 0 && p.strikeToColdBtc > 0) branches.split += 1;
      if (p.cbToColdBtc > 0) branches.cbToCold += 1;
    }
    expect(checked).toBeGreaterThan(20_000 * 0.5);
    // Non-vacuous: every routing branch occurs.
    expect(branches.toCbOnly).toBeGreaterThan(0);
    expect(branches.split).toBeGreaterThan(0);
    expect(branches.cbToCold).toBeGreaterThan(0);
  });
});

// ── I4 · the gates ───────────────────────────────────────────────────────────────────────────────────────────

describe('⭐ I4 — every gate moves nothing off Strike', () => {
  const nothingMoved = (p: ReturnType<typeof plan>, from: PlacementInput) => {
    expect(p.strikeToCbBtc).toBe(0);
    expect(p.strikeToColdBtc).toBe(0);
    expect(p.cbToColdBtc).toBe(0);
    expect(p.after.strikeCollateralBtc).toBe(from.strikeCollateralBtc);
    expect(p.after.cbCollateralBtc).toBe(from.cbCollateralBtc);
    expect(p.after.coldBtc).toBe(from.coldBtc);
    expect(p.worthMoving).toBe(false);
    expect(p.seeded).toBe(false);
  };

  it('paused (below support) ⇒ nothing', () => {
    const from = { ...BASE, support: 200_000 };            // k = 0.5
    const p = placementPlan(from);
    expect(p.state).toBe('paused');
    expect(p.zone).toBe('paused');
    nothingMoved(p, from);
  });

  it('in hold ⇒ strikeLeg "hold", nothing moves off Strike', () => {
    const p = plan({ inHold: true, strikeCollateralBtc: 10 });
    expect(p.strikeLeg).toBe('hold');
    expect(p.strikeToCbBtc + p.strikeToColdBtc).toBe(0);
  });

  it('Strike LTV above the retrieve line ⇒ "ltv", nothing moves off Strike', () => {
    // 45% LTV: above STRIKE_RETRIEVE_MAX_LTV, so Strike releases nothing at all.
    const p = plan({ strikeCollateralBtc: 10, strikeBalance: 0.45 * 10 * BASE.price });
    expect(p.releasableBtc).toBe(0);
    expect(p.strikeLeg).toBe('ltv');
    expect(p.strikeToCbBtc + p.strikeToColdBtc).toBe(0);
  });

  it('⭐ excess > releasable (the "under 50% after" rule binds) ⇒ "ltv", all-or-nothing', () => {
    // At exactly 40% LTV Strike may release, but only down to strictly under 50% — so a big excess is refused.
    const coll = 10;
    const bal = STRIKE_RETRIEVE_MAX_LTV * coll * BASE.price;
    const p = plan({ strikeCollateralBtc: coll, strikeBalance: bal, creditLine: 0 });
    expect(p.releasableBtc).toBeGreaterThan(0);              // it CAN release something
    expect(p.releasableBtc).toBeLessThan(coll - (p.strikeKeepBtc ?? 0));   // but not the whole excess
    expect(p.strikeLeg).toBe('ltv');
    expect(p.strikeToCbBtc + p.strikeToColdBtc).toBe(0);
  });

  it('Coinbase at or past 86% ⇒ cbPastLiquidation, nothing moves', () => {
    const from = { ...BASE, cbDebt: CB_LLTV * BASE.cbCollateralBtc * BASE.price, strikeCollateralBtc: 10 };
    const p = placementPlan(from);
    expect(p.state).toBe('cbPastLiquidation');
    nothingMoved(p, from);
  });

  it('⭐ cbToCold is independent of the Strike leg — a blocked Strike never blocks the Coinbase sweep', () => {
    // Nothing owed on Coinbase and no buffer ⇒ its whole balance is surplus, even while Strike is in hold.
    const held = plan({ inHold: true, cbDebt: 0, bufferUsd: 0 });
    expect(held.strikeLeg).toBe('hold');
    expect(held.cbToColdBtc).toBeCloseTo(BASE.cbCollateralBtc, 12);
  });
});

// ── I5 · seeding ─────────────────────────────────────────────────────────────────────────────────────────────

describe('⭐ I5 — seeded ⇔ ready and worth moving', () => {
  it('a real move seeds', () => {
    const p = plan({ strikeCollateralBtc: 10 });
    expect(p.state).toBe('ready');
    expect(p.worthMoving).toBe(true);
    expect(p.seeded).toBe(true);
  });
  it('every non-ready state refuses to seed', () => {
    expect(plan({ support: 200_000, strikeCollateralBtc: 10 }).seeded).toBe(false);
    expect(placementPlan({ ...BASE, price: Number.NaN }).seeded).toBe(false);
  });
});

// ── I6 / I7 · acting today, against the engine ───────────────────────────────────────────────────────────────

describe('⭐ I6 / I7 — acting today is never worse, and month 1 has only the trickle left', () => {
  // ⚠ FIXTURE-BOUND: re-measure if the engine changes. Round synthetic positions only.
  const FIXTURES: [string, Partial<CyclingInputs>][] = [
    ['SP_REPRO', {}],
    ['Strike 2 ₿', { strikeCollateralBtc: 2 }],
    ['no Coinbase loan, Strike 2 ₿', { strikeCollateralBtc: 2, cbDebt: 0, cbCollateralBtc: 0 }],
    ['$50k on 1 ₿, Strike 2 ₿', { strikeCollateralBtc: 2, cbDebt: 50_000, cbCollateralBtc: 1 }],
  ];
  const SETTINGS = {
    skStop: 0.50, cbStop: 0.60, cbDefenseLtv: 0.70,
    accumulateBelow: 1.5, payDownAbove: 2.0, inHold: false, broken: false,
  };

  it('⭐ seeded ≥ unseeded on yours and all-in, with the same liqMonth', () => {
    let seededBetter = 0;
    for (const c of a5Cases()) {
      for (const [, over] of FIXTURES) {
        const inputs: CyclingInputs = { ...c.on, ...over, cycleMonths: 1 };
        const unseeded = runCyclingSim(inputs);
        if (!unseeded.policyApplied) continue;
        const p = placementPlan({
          creditLine: inputs.strikeCreditLine,
          strikeBalance: inputs.strikeBalance,
          strikeCollateralBtc: inputs.strikeCollateralBtc,
          cbDebt: inputs.cbDebt,
          cbCollateralBtc: inputs.cbCollateralBtc,
          coldBtc: inputs.openingColdBtc ?? 0,
          price: inputs.pricePath[0],
          support: SUPPORT[0],
          bufferUsd: 12 * inputs.expenses,
          ...SETTINGS,
        });
        if (!p.seeded) continue;
        const seeded = runCyclingSim({
          ...inputs,
          strikeCollateralBtc: p.after.strikeCollateralBtc,
          cbCollateralBtc: p.after.cbCollateralBtc,
          openingColdBtc: p.after.coldBtc,
        });
        const yours = (r: typeof seeded) => deriveOwnership(r.last.btcHeld, r.last.debt, r.last.price).yoursBtc;
        expect(seeded.liqMonth).toBe(unseeded.liqMonth);
        expect(yours(seeded)).toBeGreaterThanOrEqual(yours(unseeded) - 1e-9);
        expect(allInEquity(seeded)).toBeGreaterThanOrEqual(allInEquity(unseeded) - 1e-6);
        if (yours(seeded) > yours(unseeded) + 1e-9) seededBetter += 1;
      }
    }
    expect(seededBetter).toBeGreaterThanOrEqual(0);   // never worse is the claim; better is a bonus
  });

  it('⭐ I7 — a seeded run only has the month-to-month trickle left to migrate', () => {
    for (const c of a5Cases()) {
      const inputs: CyclingInputs = { ...c.on, strikeCollateralBtc: 2, cycleMonths: 1 };
      const unseeded = runCyclingSim(inputs);
      if (!unseeded.policyApplied) continue;
      const p = placementPlan({
        creditLine: inputs.strikeCreditLine, strikeBalance: inputs.strikeBalance,
        strikeCollateralBtc: inputs.strikeCollateralBtc, cbDebt: inputs.cbDebt,
        cbCollateralBtc: inputs.cbCollateralBtc, coldBtc: inputs.openingColdBtc ?? 0,
        price: inputs.pricePath[0], support: SUPPORT[0], bufferUsd: 12 * inputs.expenses, ...SETTINGS,
      });
      if (!p.seeded) continue;
      const seeded = runCyclingSim({
        ...inputs,
        strikeCollateralBtc: p.after.strikeCollateralBtc,
        cbCollateralBtc: p.after.cbCollateralBtc,
        openingColdBtc: p.after.coldBtc,
      });
      const keep0 = strikeKeepCollateralBtc(inputs.strikeCreditLine, inputs.strikeBalance, 0.5, SUPPORT[0]);
      const keep1 = strikeKeepCollateralBtc(inputs.strikeCreditLine, seeded.rows[0].strikeBalance, 0.5, SUPPORT[1]);
      expect(seeded.rows[1].strikeToCbBtc, c.name).toBeLessThanOrEqual(Math.max(0, keep0 - keep1) + 1e-12);
    }
  });
});

// ── I8 · the suggested line ──────────────────────────────────────────────────────────────────────────────────

describe('⭐ I8 — the suggested line', () => {
  const SUG = { expenses: 6_000, cbDebt: 60_000, cbCollateralBtc: 2, price: 100_000, cbLtvTriggerPct: 75, cbLtvTargetPct: 65 };
  const sug = (o: Partial<typeof SUG> = {}) => suggestedLineUsd({ ...SUG, ...o });

  it('⭐ a multiple of 500, inside Strike\'s own range, and at least the requirement × 1.25', () => {
    for (const expenses of [0, 2_000, 6_000, 40_000, 400_000]) {
      for (const cbDebt of [0, 20_000, 60_000, 400_000]) {
        const line = sug({ expenses, cbDebt });
        expect(line % 500, `${expenses}/${cbDebt}`).toBe(0);
        expect(line).toBeGreaterThanOrEqual(STRIKE_LINE_MIN_USD);
        expect(line).toBeLessThanOrEqual(STRIKE_LINE_MAX_USD);
        const defense = cbDebt > 0 ? cbDebt * (1 - SUG.cbLtvTargetPct / SUG.cbLtvTriggerPct) : 0;
        const need = Math.max(LINE_BILL_MONTHS * expenses, defense) * LINE_HEADROOM;
        if (line < STRIKE_LINE_MAX_USD) expect(line).toBeGreaterThanOrEqual(need - 1e-6);
      }
    }
  });

  it('⭐ the defense term is the owner\'s own thresholds — cbDebt × (1 − target/trigger)', () => {
    // Bills 0, so the defense alone sizes the line.
    const line = sug({ expenses: 0 });
    const defense = 60_000 * (1 - 65 / 75);
    expect(line).toBe(Math.ceil((defense * LINE_HEADROOM) / 500) * 500);
  });

  it('no loan ⇒ no defense term, so bills alone size it', () => {
    expect(sug({ cbDebt: 0, cbCollateralBtc: 0 })).toBe(Math.ceil((2 * 6_000 * 1.25) / 500) * 500);
  });

  it('target ≥ trigger ⇒ no defense term', () => {
    expect(sug({ expenses: 0, cbLtvTargetPct: 75 })).toBe(STRIKE_LINE_MIN_USD);
  });

  it('clamps at both ends', () => {
    expect(sug({ expenses: 0, cbDebt: 0, cbCollateralBtc: 0 })).toBe(STRIKE_LINE_MIN_USD);
    expect(sug({ expenses: 10_000_000 })).toBe(STRIKE_LINE_MAX_USD);
  });

  it('junk ⇒ the minimum, never NaN', () => {
    for (const bad of [{ expenses: Number.NaN }, { price: Number.NaN }, { cbDebt: Number.POSITIVE_INFINITY }]) {
      expect(sug(bad)).toBe(STRIKE_LINE_MIN_USD);
    }
  });
});

// ── I16 · junk in, no junk out ───────────────────────────────────────────────────────────────────────────────

describe('⭐ I16 — NaN or ∞ in ⇒ no NaN or ∞ out', () => {
  const KEYS: (keyof PlacementInput)[] = [
    'creditLine', 'strikeBalance', 'strikeCollateralBtc', 'cbDebt', 'cbCollateralBtc', 'coldBtc',
    'price', 'support', 'skStop', 'cbStop', 'cbDefenseLtv', 'bufferUsd', 'accumulateBelow', 'payDownAbove',
  ];
  it.each(KEYS)('%s', (k) => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const p = placementPlan({ ...BASE, [k]: bad });
      expect(p.state).toBe('unavailable');
      for (const v of [p.strikeToCbBtc, p.strikeToColdBtc, p.cbToColdBtc, p.strikeShortBtc,
        p.strikeRoomUsd, p.releasableBtc, p.cbOverCeilingUsd,
        p.after.strikeCollateralBtc, p.after.cbCollateralBtc, p.after.coldBtc]) {
        expect(Number.isFinite(v), `${k}=${bad}`).toBe(true);
      }
    }
  });

  it('a non-positive price or support is unavailable too', () => {
    expect(placementPlan({ ...BASE, price: 0 }).state).toBe('unavailable');
    expect(placementPlan({ ...BASE, support: 0 }).state).toBe('unavailable');
    expect(placementPlan({ ...BASE, price: -1 }).state).toBe('unavailable');
  });
});

// ── I27 · the move threshold ─────────────────────────────────────────────────────────────────────────────────

describe('⭐ I27 — small moves wait for next month', () => {
  it('⭐ worthMoving ⇔ the moves total at least 0.01 ₿', () => {
    expect(MOVE_THRESHOLD_BTC).toBe(0.01);
    const keep = strikeKeepCollateralBtc(BASE.creditLine, 0, BASE.skStop, BASE.support);
    for (const extra of [0.002, 0.00999, 0.01, 0.05]) {
      const p = plan({ strikeCollateralBtc: keep + extra, cbDebt: 0, bufferUsd: 0, cbCollateralBtc: 0 });
      const moved = p.strikeToCbBtc + p.strikeToColdBtc + p.cbToColdBtc;
      expect(p.worthMoving, `extra ${extra}`).toBe(moved >= MOVE_THRESHOLD_BTC);
      expect(p.seeded).toBe(p.worthMoving);
    }
  });

  it('a Coinbase-only surplus counts toward the threshold too', () => {
    const p = plan({ strikeCollateralBtc: 0.0001, creditLine: 250_000, cbDebt: 0, bufferUsd: 0 });
    expect(p.cbToColdBtc).toBeGreaterThan(MOVE_THRESHOLD_BTC);
    expect(p.worthMoving).toBe(true);
  });
});

// ── I30 · over the limit at support ──────────────────────────────────────────────────────────────────────────

describe('⭐ I30 — cbOverCeilingUsd', () => {
  const overOf = (p: ReturnType<typeof plan>, cbDebt: number) =>
    Math.max(0, -ceilingHeadroomUsd(cbDebt, p.after.cbCollateralBtc, BASE.support, BASE.cbStop));

  it("⭐ equals the headroom's negative, measured AFTER the move", () => {
    for (const cbDebt of [0, 40_000, 60_000, 120_000, 200_000]) {
      const p = plan({ cbDebt });
      expect(p.cbOverCeilingUsd).toBeCloseTo(overOf(p, cbDebt), 9);
    }
  });

  it('⭐ SP_REPRO with cbDebt 50,000 is over its limit; SP_REPRO as it is, is not', () => {
    const at = (cbDebt: number) => placementPlan({
      creditLine: SP_REPRO.strikeCreditLine,
      strikeBalance: SP_REPRO.strikeBalance,
      strikeCollateralBtc: SP_REPRO.strikeCollateralBtc,
      cbDebt,
      cbCollateralBtc: SP_REPRO.cbCollateralBtc,
      coldBtc: 0,
      price: SUPPORT[0],
      support: S0,
      skStop: 0.50, cbStop: 0.60, cbDefenseLtv: 0.70,
      bufferUsd: 12 * SP_REPRO.expenses,
      accumulateBelow: 1.5, payDownAbove: 2.0, inHold: false, broken: false,
    });
    expect(at(50_000).cbOverCeilingUsd).toBeGreaterThan(0);
    expect(at(SP_REPRO.cbDebt).cbOverCeilingUsd).toBe(0);
  });

  it('⭐ reported in every state but unavailable — paused, broken and past-liquidation alike', () => {
    // Over its limit is a FACT about the position, reported whether or not anything moves today.
    // ⚠ F1: a PAUSED case that is over WITHOUT being past liquidation needs support just above price —
    // S₀ 110,000 against a 100,000 price, 2 ₿, $140,000 owed: k = 0.909 (paused), 70% LTV, $8,000 over.
    const paused = plan({ support: 110_000, cbDebt: 140_000, strikeCollateralBtc: 0.01 });
    expect(paused.state).toBe('paused');
    expect(paused.cbOverCeilingUsd).toBeCloseTo(140_000 - 2 * 110_000 * 0.6, 9);

    const broken = plan({ broken: true, cbDebt: 140_000, strikeCollateralBtc: 0.01 });
    expect(broken.state).toBe('broken');
    expect(broken.cbOverCeilingUsd).toBeCloseTo(140_000 - 2 * 100_000 * 0.6, 9);

    // The 150% fixture is past liquidation under the new order — the FIELD is still reported here; the card's
    // over-the-limit LINE is not (N8: a seized loan isn't repaid from income).
    const pastLiq = plan({ cbDebt: 1.5 * 2 * 100_000 });
    expect(pastLiq.state).toBe('cbPastLiquidation');
    expect(pastLiq.cbOverCeilingUsd).toBeGreaterThan(0);

    expect(placementPlan({ ...BASE, price: Number.NaN }).cbOverCeilingUsd).toBe(0);
  });
});

// ── the zone, and the released figure, come from the shared leaves ───────────────────────────────────────────

describe('the plan reports the shared leaves verbatim', () => {
  it('zone is `policyZone`', () => {
    for (const support of [200_000, 100_000, 60_000, 40_000]) {
      expect(plan({ support }).zone).toBe(policyZone(BASE.price, support, 1.5, 2.0));
    }
  });
  it('releasableBtc is `strikeReleasableBtc`', () => {
    for (const strikeBalance of [0, 100_000, 400_000]) {
      const p = plan({ strikeCollateralBtc: 10, strikeBalance });
      expect(p.releasableBtc).toBeCloseTo(strikeReleasableBtc({
        strikeCollateralBtc: 10, strikeBalance, price: BASE.price,
        retrieveMaxLtv: STRIKE_RETRIEVE_MAX_LTV, maxAfterLtv: STRIKE_MAX_DRAW_LTV, inHold: false,
      }), 12);
    }
  });
  it('strikeShortBtc is what the line needs beyond what Strike holds', () => {
    const p = plan({ strikeCollateralBtc: 0.05, creditLine: 100_000 });
    expect(p.strikeShortBtc).toBeCloseTo((p.strikeKeepBtc ?? 0) - 0.05, 12);
    expect(plan({ strikeCollateralBtc: 10 }).strikeShortBtc).toBe(0);
  });
});

// ── N1 · the breaker ─────────────────────────────────────────────────────────────────────────────────────────

describe("⭐ N1 / I4 — a broken model moves nothing, in every price zone", () => {
  const MULTIPLES = [0.8, 1.0, 1.35, 2.5];

  it.each(MULTIPLES)('⭐ broken at %s× support ⇒ state "broken", zero moves', (k) => {
    const from = { ...BASE, broken: true, support: BASE.price / k, strikeCollateralBtc: 10 };
    const p = placementPlan(from);
    expect(p.state).toBe('broken');
    expect(p.strikeToCbBtc).toBe(0);
    expect(p.strikeToColdBtc).toBe(0);
    expect(p.cbToColdBtc).toBe(0);
    expect(p.worthMoving).toBe(false);
    expect(p.seeded).toBe(false);
    expect(p.opening).toEqual({
      strikeCollateralBtc: from.strikeCollateralBtc,
      cbCollateralBtc: from.cbCollateralBtc,
      coldBtc: from.coldBtc,
    });
  });

  it('⭐ NON-VACUITY — the same position UNBROKEN at 1.35× support moves', () => {
    const at = (broken: boolean) => placementPlan({
      ...BASE, broken, support: BASE.price / 1.35, strikeCollateralBtc: 10,
    });
    expect(at(false).state).toBe('ready');
    expect(at(false).strikeToCbBtc + at(false).strikeToColdBtc).toBeGreaterThan(0);
    expect(at(true).strikeToCbBtc + at(true).strikeToColdBtc).toBe(0);
  });

  it('⭐ the ENGINE agrees: the same inputs and seed give a broken month 1 that moves nothing', () => {
    const P = 100_000;
    const S = P / 1.35;
    const inputs: CyclingInputs = {
      ...SP_REPRO,
      income: 0, expenses: 0, strikeAprPct: 0, cbAprPct: 0,
      strikeBalance: 0, strikeCollateralBtc: 10, cbDebt: 60_000, cbCollateralBtc: 2,
      openingColdBtc: 0.5, strikeCreditLine: 40_000, cycleMonths: 1,
      cbLtvCapPct: 70, strikeLtvCapPct: 0, coldStoreBufferPct: 0,
      pricePath: [P, P],
      supportPolicy: policyFor([S, S]),
    };
    const seeded = runCyclingSim({
      ...inputs,
      openingBreaker: { broken: true, monthsBelow: 0, monthsAtOrAbove: 2, brokenMonth: null },
    });
    expect(seeded.policyApplied).toBe(true);
    expect(seeded.rows[1].policyZone).toBe('broken');
    expect(seeded.rows[1].strikeToCbBtc).toBe(0);
    expect(seeded.rows[1].sweptToColdBtc).toBe(0);
    // Non-vacuous: unseeded, the engine's own month 1 DOES move.
    const plain = runCyclingSim(inputs);
    expect(plain.rows[1].policyZone).not.toBe('broken');
    expect(plain.rows[1].strikeToCbBtc + plain.rows[1].sweptToColdBtc).toBeGreaterThan(0);
  });
});

// ── N8 · the state order ─────────────────────────────────────────────────────────────────────────────────────

describe('⭐ N8 — a seizure is never hidden behind a pause or a break', () => {
  // 0.80× support, $54,000 owed on 0.5 ₿ at $100,000: 108% LTV. Paused AND past liquidation at once — which
  // is the ONLY shape that can tell the two orders apart.
  const SEIZED = { ...BASE, support: BASE.price / 0.8, cbDebt: 54_000, cbCollateralBtc: 0.5 };

  it('⭐ below support and past 86% ⇒ cbPastLiquidation, not paused', () => {
    const p = placementPlan(SEIZED);
    expect(ltvOf(SEIZED.cbDebt, SEIZED.cbCollateralBtc, SEIZED.price)).toBeGreaterThan(CB_LLTV);  // premise
    expect(p.zone).toBe('paused');                    // the PRICE zone is still reported
    expect(p.state).toBe('cbPastLiquidation');        // but the seizure is the state
  });

  it('⭐ a seizure wins over a BREAK too', () => {
    expect(placementPlan({ ...SEIZED, broken: true }).state).toBe('cbPastLiquidation');
  });

  it('broken wins over a pause', () => {
    expect(placementPlan({ ...BASE, broken: true, support: BASE.price / 0.8 }).state).toBe('broken');
  });

  it('unavailable still wins over everything', () => {
    expect(placementPlan({ ...SEIZED, broken: true, price: Number.NaN }).state).toBe('unavailable');
  });
});

// ── N5 / F1 · opening, and sub-threshold moves ───────────────────────────────────────────────────────────────

describe('⭐ N5 — `opening` is the position the owner actually ends up holding', () => {
  /** Strike at its keep + 0.004 ₿, Coinbase at its keep − 0.002 ₿: 0.004 ₿ in all, under the threshold. */
  const trickle = () => {
    const keepS = strikeKeepCollateralBtc(BASE.creditLine, 0, BASE.skStop, BASE.support);
    const probe = plan({ strikeCollateralBtc: keepS + 0.004 });
    const keepC = probe.cbKeepBtc!;
    return placementPlan({ ...BASE, strikeCollateralBtc: keepS + 0.004, cbCollateralBtc: keepC - 0.002 });
  };

  it('⭐ under the threshold: nothing moves, so `opening` is TODAY\'s holdings — not `after`', () => {
    const p = trickle();
    expect(p.state).toBe('ready');
    expect(p.worthMoving).toBe(false);
    expect(p.seeded).toBe(false);
    // `after` keeps its I3 meaning: the end state the engine's steps 5 and 9 would reach.
    expect(p.after.strikeCollateralBtc).toBeLessThan(p.opening.strikeCollateralBtc);
    // `opening` is what the owner holds when the move is deferred.
    expect(p.opening.strikeCollateralBtc).toBeCloseTo(
      strikeKeepCollateralBtc(BASE.creditLine, 0, BASE.skStop, BASE.support) + 0.004, 12);
    expect(p.opening.cbCollateralBtc).toBeCloseTo(p.cbKeepBtc! - 0.002, 12);
    expect(p.opening.coldBtc).toBe(BASE.coldBtc);
  });

  it('⭐ worth moving ⇒ `opening` IS `after` (D10: the run seeds from the move)', () => {
    const p = plan({ strikeCollateralBtc: 10 });
    expect(p.seeded).toBe(true);
    expect(p.opening).toEqual(p.after);
  });

  it('every inert state reports `opening` as today\'s holdings', () => {
    const today = { strikeCollateralBtc: BASE.strikeCollateralBtc, cbCollateralBtc: BASE.cbCollateralBtc, coldBtc: BASE.coldBtc };
    for (const o of [
      { support: 200_000 }, { broken: true }, { cbDebt: CB_LLTV * 2 * 100_000 }, { price: Number.NaN },
    ]) {
      expect(placementPlan({ ...BASE, ...o, strikeCollateralBtc: 10 }).opening, JSON.stringify(o))
        .toEqual({ ...today, strikeCollateralBtc: 10 });
    }
  });

  it('⭐ I30 — cbOverCeilingUsd reads `opening`, so a deferred move can\'t hide it', () => {
    const p = trickle();
    expect(p.cbOverCeilingUsd).toBeCloseTo(
      Math.max(0, -ceilingHeadroomUsd(BASE.cbDebt, p.opening.cbCollateralBtc, BASE.support, BASE.cbStop)), 9);
  });
});
