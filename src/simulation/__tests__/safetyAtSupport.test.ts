import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cbAtSupportOf, cbAtSupportLine, deriveSafetyView, ownerSafetyVerdict, deriveViewerOverall,
  buildSafeSafety, scaleSafetyView, computeViewerSafety, CB_AT_SUPPORT_WATCH, ownerAtSupportLine, CB_MOVE_BRINGS_WITHIN,
  type SafetyViewInputs, type SafeSnapshot,
} from '../safetyView';
import { supportToday } from '../powerLaw';
import { placementPlan } from '../placement';
import { ceilingHeadroomUsd } from '../supportPolicy';
import { DUST_USD, fmtUSD, fmtUSDCents } from '../../utils/format';
import { PLAN_POLICY_DEFAULTS, PLAN_POLICY_FIELD, PLAN_POLICY_KEYS, planCbLimitOf, planPolicyOf, type PlanPolicyField } from '../../lib/planPolicy';
import { planPolicySettingsOf, placementInputOf } from '../../components/Almanac/planRun';
import { buildSupportPath } from '../../components/Almanac/supportPolicyInputs';
import { planMoveBringsCbWithin } from '../../components/Almanac/planMonthView';

/**
 * ⭐ The plan of record's Run 4 — Safety's at-support line (D7-A) and the safe viewer's two ratios (D9-A).
 *
 *  - ATS — the reading: Coinbase's accrued debt against its collateral's value at TODAY's support (the plan's S₀), beside
 *    the plan's limit (as the plan runs it); "over" by THIS MONTH's own rule (`placement`'s over-limit fact, the dust
 *    floor included); amber at most, never red;
 *  - VERDICT — the owner's eyebrow takes the worse reading, and says when only the at-support one is amber;
 *  - VIEWER — the safe snapshot carries the two ratios and the owner's verdict on them, unscaled; the trusted path reads
 *    it live, with the support price; an older snapshot without them shows none and changes nothing.
 *
 * Round synthetic figures throughout.
 */

const BANNED = /\b(?:should|need to|needs to|safe|safely|safer)\b/i;

const BASE: SafetyViewInputs = {
  advisorActualBlocBalance: 0, creditLine: 10_000, currentBtcHeld: 1, btcPrice: 100_000, strikeLiquidationLtvPct: 85,
  hasCbLoan: true, cbLoanBalance: 50_000, cbAprPct: 6, cbLoanBalanceAsOf: null, cbCollateralBtc: 1,
  cbLtvTriggerPct: 75, cbLiquidationPrice: 0, cbLiquidationPriceAsOf: null,
  cbLimitAtSupport: 0.45, supportToday: 64_000,
};

describe('⭐ ATS — Coinbase at today\'s support, against the plan\'s limit', () => {
  it('⭐ ATS — the figures: debt ÷ (collateral × support), the plan\'s limit, today\'s support', () => {
    const r = cbAtSupportOf({ hasCbLoan: true, debt: 100_000, collateralBtc: 2, support: 64_000, limit: 0.45 })!;
    expect(r.support, 'ATS support').toBe(64_000);
    expect(r.ltv, 'ATS LTV at support').toBeCloseTo(100_000 / (2 * 64_000), 12);
    expect(r.limit, 'ATS limit').toBe(0.45);
    expect([r.over, r.level], 'ATS over → amber').toEqual([true, 'watch']);
    const under = cbAtSupportOf({ hasCbLoan: true, debt: 20_000, collateralBtc: 1, support: 64_000, limit: 0.45 })!;
    expect([under.over, under.level], 'ATS within → no tone').toEqual([false, 'safe']);
  });

  it('⭐ ATS — none without a reading: no loan, no debt past the dust floor, no collateral, no support, no limit, junk', () => {
    const ok = { hasCbLoan: true, debt: 50_000, collateralBtc: 1, support: 64_000, limit: 0.45 };
    expect(cbAtSupportOf(ok), 'ATS premise').not.toBeNull();
    for (const [tag, f] of [
      ['no loan', { ...ok, hasCbLoan: false }],
      ['dust', { ...ok, debt: DUST_USD / 2 }],
      ['no collateral', { ...ok, collateralBtc: 0 }],
      ['no support', { ...ok, support: undefined }],
      ['zero support', { ...ok, support: 0 }],
      ['no limit', { ...ok, limit: undefined }],
      ['NaN debt', { ...ok, debt: Number.NaN }],
      ['∞ collateral', { ...ok, collateralBtc: Number.POSITIVE_INFINITY }],
    ] as const) {
      expect(cbAtSupportOf(f), `ATS ${tag}`).toBeNull();
    }
  });

  it('⭐ ATS — "over" is THIS MONTH\'s rule: the placement\'s over-limit fact, dust floor included (a sweep)', () => {
    // A broken model moves nothing, so the placement measures today's collateral — the same position Safety reads.
    const policySettings = planPolicySettingsOf({ ...PLAN_POLICY_DEFAULTS });
    let n = 0;
    let overs = 0;
    let unders = 0;
    let edges = 0;
    let floors = 0;
    for (const coll of [0.25, 1, 3.7]) {
      for (const support of [41_000, 64_000.5, 97_123]) {
        const limit = policySettings.cbStopEffPct / 100;
        const atLimit = limit * coll * support;
        // Both sides of the limit, the half-cent around it, and the 50¢ dust floor (DUST_USD) from both sides.
        for (const d of [-5_000, -1, -0.006, -0.004, 0, 0.004, 0.006, 0.01, 0.49, 0.5, 0.51, 1, 5_000]) {
          const debt = atLimit + d;
          if (!(debt > DUST_USD)) continue;
          const plan = placementPlan(placementInputOf({
            runLine: 10_000, strikeBalance: 0, strikeCollateralBtc: 0, cbDebt: debt, cbCollateralBtc: coll, coldBtc: 0,
            price: support * 1.5, support, policySettings, expenses: 3_000, inHold: false, broken: true,
          }));
          expect(plan.state, 'ATS premise: nothing moves').toBe('broken');
          const r = cbAtSupportOf({ hasCbLoan: true, debt, collateralBtc: coll, support, limit })!;
          expect(r.over, `ATS over ${coll} ${support} ${d}`).toBe(plan.cbOverCeilingUsd >= DUST_USD);
          if (r.over) overs++; else unders++;
          if (Math.abs(d) < 0.01) edges++;
          if ([DUST_USD - 0.01, DUST_USD, DUST_USD + 0.01].some((f) => Math.abs(d - f) < 1e-9)) floors++;
          n++;
        }
      }
    }
    // 3 × 3 × 13 cells, less the one whose debt would be negative (0.25 ₿ at $41,000, $5,000 under the limit).
    expect([n, overs > 0, unders > 0, edges > 0, floors], 'ATS the sweep reaches both sides, the half cent and the 50¢ floor')
      .toEqual([116, true, true, true, 27]);
  });

  it('⭐ ATS — amber at most: however far over, the at-support level is never red', () => {
    for (const debt of [30_000, 60_000, 100_000, 1e9]) {
      const r = cbAtSupportOf({ hasCbLoan: true, debt, collateralBtc: 1, support: 64_000, limit: 0.45 })!;
      expect(r.level, `ATS ${debt}`).toBe('watch');
    }
  });

  it('⭐ ATS — the plan\'s limit outside the faces equals the plan\'s own run, over its range and past both ends, and on junk', () => {
    const vals: unknown[] = [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 39, 'x', null, undefined, 1e6];
    for (let v = 30; v <= 80; v += 0.5) vals.push(v);
    const store = (cb: unknown): Record<PlanPolicyField, unknown> => ({
      ...Object.fromEntries(PLAN_POLICY_KEYS.map((k) => [PLAN_POLICY_FIELD[k], PLAN_POLICY_DEFAULTS[k]])) as Record<PlanPolicyField, unknown>,
      policyCbStopAtSupportPct: cb,
    });
    for (const v of vals) {
      const s = store(v);
      expect(planCbLimitOf(s), `ATS limit ${String(v)}`).toBe(planPolicySettingsOf(planPolicyOf(s)).cbStopEffPct / 100);
    }
  });

  it('⭐ ATS — today\'s support is the plan\'s S₀, on five dates; the caller supplies it, so Safety\'s view imports no belief', () => {
    for (const iso of ['2026-01-01', '2026-02-28', '2026-10-12', '2027-03-31', '2030-12-31']) {
      expect(supportToday(iso), `ATS ${iso}`).toBe(buildSupportPath(new Date(iso), 0)[0]);
    }
    // The Scenario face (scenarioDiff) imports only safetyView, behind its §2/§7 walls. Today's support is the power law's,
    // so it lives there (powerLaw.supportToday) and arrives as an input: the view module stays belief-free.
    for (const f of ['safetyView.ts', 'scenarioDiff.ts']) {
      const lines = readFileSync(join(process.cwd(), 'src/simulation', f), 'utf8').split('\n')
        .filter((l) => /^import\b/.test(l) || /^\} from /.test(l));
      expect(lines.length, `ATS ${f} imports`).toBeGreaterThan(0);
      for (const l of lines) expect(l, `ATS ${f} imports no belief`).not.toMatch(/powerLaw|cyclePath|cycleModel|cyclingSim|emergencyModel/);
    }
  });

  it('⭐ ATS — the words: the price to the cent or whole, the reading, the limit; no price on the safe path; never "safe"', () => {
    const r = { support: 64_699.79, ltv: 50_000 / 64_699.79, limit: 0.45 };
    expect(cbAtSupportLine(r, fmtUSDCents), 'ATS cents (Safety)')
      .toBe("At support ($64,699.79): Coinbase 77.3% of its collateral's value — the plan's limit is 45%");
    expect(cbAtSupportLine(r), 'ATS whole (the Dashboard)')
      .toBe("At support ($64,700): Coinbase 77.3% of its collateral's value — the plan's limit is 45%");
    expect(cbAtSupportLine({ ...r, support: null }), 'ATS the safe viewer')
      .toBe("At support: Coinbase 77.3% of its collateral's value — the plan's limit is 45%");
    for (const w of [cbAtSupportLine(r, fmtUSD), cbAtSupportLine({ ...r, support: null }), CB_AT_SUPPORT_WATCH]) {
      expect(w, 'ATS banned').not.toMatch(BANNED);
    }
  });
});

describe('⭐ MOVE — Safety reads the position as it stands; when this month\'s move is the fix, its line says so', () => {
  it('⭐ MOVE — Safety over and the card within happen only when the move tops Coinbase up from Strike (a sweep)', () => {
    const ps = planPolicySettingsOf({ ...PLAN_POLICY_DEFAULTS });
    const S = 64_000;
    let n = 0;
    let fixes = 0;
    let stillOver = 0;
    let withins = 0;
    for (const mult of [1.05, 1.5, 2.2, 3.5]) {
      for (const cbDebt of [10_000, 30_000, 50_000, 90_000]) {
        for (const cbColl of [0.5, 1, 2, 4]) {
          for (const skColl of [0, 0.5, 1, 3]) {
            for (const [skBal, inHold] of [[0, false], [5_000, false], [20_000, false], [0, true]] as const) {
              const price = S * mult;
              if (cbDebt / (cbColl * price) >= 0.86) continue;
              const plan = placementPlan(placementInputOf({
                runLine: 50_000, strikeBalance: skBal, strikeCollateralBtc: skColl, cbDebt, cbCollateralBtc: cbColl, coldBtc: 0,
                price, support: S, policySettings: ps, expenses: 3_500, inHold, broken: false,
              }));
              const r = cbAtSupportOf({ hasCbLoan: true, debt: cbDebt, collateralBtc: cbColl, support: S, limit: ps.cbStopEffPct / 100 });
              const cardOver = plan.cbOverCeilingUsd >= DUST_USD;
              const at = `${mult} ${cbDebt} ${cbColl} ${skColl} ${skBal} ${inHold}`;
              if (!r?.over) {
                // Within at support, within after the move: the move never takes Coinbase over its limit.
                expect(cardOver, `MOVE within stays within ${at}`).toBe(false);
                withins++;
                continue;
              }
              expect(planMoveBringsCbWithin(plan), `MOVE ${at}`).toBe(!cardOver);
              // …and when the card reads within, it's because the move tops Coinbase up from Strike.
              if (!cardOver) expect(plan.strikeToCbBtc, `MOVE the fix is a Strike top-up ${at}`).toBeGreaterThan(0);
              n++;
              if (cardOver) stillOver++; else fixes++;
            }
          }
        }
      }
    }
    expect([n > 100, fixes > 0, stillOver > 0, withins > 100], 'MOVE the sweep reaches all three: fixed, still over, within')
      .toEqual([true, true, true, true]);
    // An inert plan moves nothing — its zero over-limit figure never reads as a fix (unavailable: no price).
    const inert = placementPlan(placementInputOf({
      runLine: 50_000, strikeBalance: 0, strikeCollateralBtc: 3, cbDebt: 50_000, cbCollateralBtc: 1, coldBtc: 0,
      price: 0, support: S, policySettings: ps, expenses: 3_500, inHold: false, broken: false,
    }));
    expect([inert.state, inert.cbOverCeilingUsd], 'MOVE premise: inert, nothing over').toEqual(['unavailable', 0]);
    expect(planMoveBringsCbWithin(inert), 'MOVE an inert plan fixes nothing').toBe(false);
  });

  it('⭐ MOVE — the owner\'s line: the reading, then the move only when it is the fix', () => {
    const over = cbAtSupportOf({ hasCbLoan: true, debt: 50_000, collateralBtc: 1, support: 64_699.79, limit: 0.45 })!;
    expect(ownerAtSupportLine(over, true), 'MOVE named')
      .toBe("At support ($64,699.79): Coinbase 77.3% of its collateral's value — the plan's limit is 45% — this month's move brings it within");
    expect(ownerAtSupportLine(over, false), 'MOVE not the fix').toBe("At support ($64,699.79): Coinbase 77.3% of its collateral's value — the plan's limit is 45%");
    const within = cbAtSupportOf({ hasCbLoan: true, debt: 20_000, collateralBtc: 1, support: 64_699.79, limit: 0.45 })!;
    expect(ownerAtSupportLine(within, true), 'MOVE never when within').not.toContain(CB_MOVE_BRINGS_WITHIN);
    expect(CB_MOVE_BRINGS_WITHIN, 'MOVE banned').not.toMatch(BANNED);
  });
});

describe('⭐ VERDICT — the owner\'s eyebrow takes the worse reading', () => {
  it('⭐ VERDICT — over at support with today\'s bars green → amber, in its own words', () => {
    const v = deriveSafetyView(BASE);
    expect([v.cbLevel, v.strikeLevel], 'VERDICT premise: today green').toEqual(['safe', 'safe']);
    expect(v.cbAtSupport?.over, 'VERDICT premise: over at support').toBe(true);
    expect(ownerSafetyVerdict(v, true), 'VERDICT amber').toEqual({ state: 'watch', copy: CB_AT_SUPPORT_WATCH });
  });

  it('⭐ VERDICT — within the limit, today\'s words stand; today amber keeps its own words; red stays red', () => {
    const within = deriveSafetyView({ ...BASE, cbLoanBalance: 20_000 });
    expect(ownerSafetyVerdict(within, true), 'VERDICT within').toEqual({ state: 'safe', copy: 'Safe — nothing to do today' });
    const tight = deriveSafetyView({ ...BASE, btcPrice: 64_000 });   // 78% today: past the 75% trigger, amber
    expect(tight.cbLevel, 'VERDICT premise: today amber').toBe('watch');
    expect(ownerSafetyVerdict(tight, true).copy, 'VERDICT today\'s words').toBe('Watch — your CB cushion is tightening');
    const red = deriveSafetyView({ ...BASE, btcPrice: 60_000 });   // 83% today
    expect(red.cbLevel, 'VERDICT premise: today red').toBe('act');
    expect(ownerSafetyVerdict(red, true).state, 'VERDICT red stays red').toBe('act');
  });

  it('⭐ VERDICT — with no Coinbase loan nothing at support counts (the bar isn\'t shown)', () => {
    const v = deriveSafetyView({ ...BASE, hasCbLoan: false });
    expect(v.cbAtSupport, 'VERDICT no reading').toBeNull();
    expect(ownerSafetyVerdict(v, false).state, 'VERDICT no loan').toBe('safe');
  });

  it('⭐ VERDICT — without today\'s support (no caller supplied it) there is no reading, and nothing changes', () => {
    const v = deriveSafetyView({ ...BASE, supportToday: undefined });
    expect(v.cbAtSupport, 'VERDICT no support').toBeNull();
    expect(ownerSafetyVerdict(v, true).state, 'VERDICT today only').toBe('safe');
  });
});

describe('⭐ VIEWER — the safe snapshot\'s two ratios; the trusted path reads it live', () => {
  const snapOf = (inputs: SafetyViewInputs): SafeSnapshot => {
    const view = deriveSafetyView(inputs);
    return {
      safety: buildSafeSafety(view, inputs.hasCbLoan),
      thresholds: { strikeLiqLtv: 0.85, cbLtvTriggerPct: 75, cbLiqFrac: view.cbLiqFrac, cbLimitAtSupport: 0.45 },
      btcPriceAtSnapshot: inputs.btcPrice,
      hasCbLoan: inputs.hasCbLoan,
    };
  };

  it('⭐ VIEWER — the owner seals the ratio and its verdict; the viewer folds the verdict and never scales the ratio', () => {
    const snap = snapOf(BASE);
    expect(snap.safety.cbLtvAtSupport, 'VIEWER the ratio').toBeCloseTo(50_000 / 64_000, 12);
    expect(snap.safety.cbAtSupportLevel, 'VIEWER the verdict').toBe('watch');
    expect(snap.safety.overall, 'VIEWER the owner\'s overall folds it').toBe('watch');
    for (const live of [100_000, 150_000, 40_000]) {
      const s = scaleSafetyView(snap, live);
      expect(s.cbLtvAtSupport, `VIEWER unscaled at ${live}`).toBe(snap.safety.cbLtvAtSupport);
      expect(s.overall === 'watch' || s.overall === 'act', `VIEWER folded at ${live}`).toBe(true);
    }
    const r = computeViewerSafety(snap, 150_000, BASE);
    expect(r.cbAtSupport, 'VIEWER the safe line: no price').toEqual({ support: null, ltv: snap.safety.cbLtvAtSupport, limit: 0.45, level: 'watch' });
  });

  it('⭐ VIEWER — an older snapshot (no ratios) shows no reading and leaves the overall as it was', () => {
    const { cbLtvAtSupport: _a, cbAtSupportLevel: _b, ...old } = snapOf(BASE).safety;
    const oldSnap: SafeSnapshot = {
      ...snapOf(BASE), safety: { ...old, overall: 'safe' }, thresholds: { strikeLiqLtv: 0.85, cbLtvTriggerPct: 75, cbLiqFrac: 0.86 },
    };
    const s = scaleSafetyView(oldSnap, 100_000);
    expect([s.cbLtvAtSupport, s.cbAtSupportLevel, s.overall], 'VIEWER old').toEqual([null, 'safe', 'safe']);
    expect(computeViewerSafety(oldSnap, 100_000, BASE).cbAtSupport, 'VIEWER old: no line').toBeNull();
  });

  it('⭐ VIEWER — the trusted path (the trusted viewer, the owner\'s Dashboard): live, with the support price', () => {
    const r = computeViewerSafety(null, 100_000, BASE);
    expect(r.cbAtSupport, 'VIEWER trusted').toEqual({ support: 64_000, ltv: 50_000 / 64_000, limit: 0.45, level: 'watch' });
    expect(r.overall, 'VIEWER trusted overall folds it').toBe('watch');
    expect(deriveViewerOverall(deriveSafetyView({ ...BASE, cbLoanBalance: 20_000 }), true), 'VIEWER within').toBe('safe');
  });

  it('⭐ VIEWER — no absolute: the ratio pair gives price ÷ support, never the debt or the collateral (two unknowns)', () => {
    // Two positions with different debts and collateral but the same ratios seal the same safe block.
    const a = buildSafeSafety(deriveSafetyView({ ...BASE, cbLoanBalance: 50_000, cbCollateralBtc: 1 }), true);
    const b = buildSafeSafety(deriveSafetyView({ ...BASE, cbLoanBalance: 100_000, cbCollateralBtc: 2 }), true);
    expect(b.cbLtvAtSupport, 'VIEWER no absolute').toBeCloseTo(a.cbLtvAtSupport!, 12);
    expect(b.cbLtv, 'VIEWER no absolute (today)').toBeCloseTo(a.cbLtv, 12);
    // The headroom the owner's rule measures is an absolute — it never rides the block.
    expect(ceilingHeadroomUsd(50_000, 1, 64_000, 0.45), 'VIEWER premise: an absolute exists owner-side').toBeLessThan(0);
    expect(Object.keys(a).sort(), 'VIEWER the block\'s keys').toEqual([
      'capacityUsed', 'cbAtSupportLevel', 'cbLevel', 'cbLiqFrac', 'cbLtv', 'cbLtvAtSupport', 'crashLtv', 'creditLevel',
      'overall', 'strikeLevel', 'strikeLtv',
    ]);
  });
});
