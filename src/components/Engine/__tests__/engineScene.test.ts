import { describe, it, expect } from 'vitest';
import { computeViewerSafety, deriveSafetyView, type SafetyViewInputs } from '../../../simulation/safetyView';
import { CB_ACT_LTV_FACTOR, cbMonthlyInterest } from '../../../simulation/cbMetrics';
import { computeLiquidationAnalysis } from '../../../simulation/runCoinbaseLoan';
import { cycleLegAt } from '../../../simulation/cycleModel';
import { cycleLegView } from '../../Almanac/cycleClockView';
import {
  ENGINE_MAX_W, ENGINE_MIN_W, RING_IDS, TAPE_MS, bayOf, cardPlace, cycleAngleOf, engineFlows, engineLayout, engineScene, priceOfY,
  priceScale, regionAt, tagHeights, tapeOf, yOfPrice, type EngineFacts, type EngineMonthRow, type RegionId,
} from '../engineScene';

/**
 * ⚠ The Engine · Micro's scene (BL61, step 1). Every figure it shows is pinned here to its source — the Dashboard's view
 * (`deriveSafetyView` on the Dashboard's inputs, at the price drawn), Strike's liquidation price (`computeViewerSafety`),
 * THIS MONTH's month row, the CB Loan tab's monthly interest and its liquidation math — and a tried price moves exactly
 * what a price moves on the Dashboard, and nothing else. Its picture is pinned to the owner's prototypes: their phone
 * layout, their price scale and their tap areas, by the prototype's own numbers (PROTOTYPE). Synthetic, round figures
 * (this repo is public). Each assertion carries its tag.
 */

/** $50,000 on 1 ₿ at Coinbase (10% APR, no as-of date, so nothing accrues), $10,000 on 0.5 ₿ at Strike, $100,000. */
const INPUTS: SafetyViewInputs = {
  advisorActualBlocBalance: 10_000, creditLine: 25_000, currentBtcHeld: 0.5, btcPrice: 100_000,
  strikeLiquidationLtvPct: 85, hasCbLoan: true, cbLoanBalance: 50_000, cbAprPct: 10, cbLoanBalanceAsOf: null,
  cbCollateralBtc: 1, cbLtvTriggerPct: 75, cbLiquidationPrice: 0, cbLiquidationPriceAsOf: null,
  cbLimitAtSupport: 0.45, supportToday: 60_000,
};
const ROW: EngineMonthRow = {
  strikeInterestUsd: 100, strikeDrawn: 3_000, strikeRepaidUsd: 200, cbRepaidUsd: 300, strikeMinPaidUsd: 40, cashToCureUsd: 0,
  refinancedFeeUsd: 0,
};
const NOW = Date.UTC(2026, 10, 23);   // 23 Nov 2026
const at = (ms: number): EngineFacts['cycle'] => {
  const leg = cycleLegAt(ms);
  const view = cycleLegView(ms);
  return leg !== null && view !== null ? { leg, view } : null;
};
/** Sixty-one one-minute candles, each `t` its minute's start: the last starts at NOW, so its close stands at NOW + 1 min. */
const CANDLES = Array.from({ length: 61 }, (_, i) => ({ t: NOW - (60 - i) * 60_000, price: 99_000 + i * 20 }));
const facts = (o: Partial<EngineFacts> = {}, s: Partial<SafetyViewInputs> = {}): EngineFacts => ({
  safety: { ...INPUTS, ...s }, month: ROW, moveBringsCbWithin: false, cycle: at(NOW), candles: CANDLES, feed: 'manual',
  livePrice: null, liveAt: null, ...o,
});
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

describe('⭐ the figures are the Dashboard\'s', () => {
  it('⭐ DASHBOARD — at today\'s price every figure is the Dashboard\'s own', () => {
    const sc = engineScene(facts(), 390, null);
    const v = deriveSafetyView(INPUTS);
    expect(sc.price, 'DASHBOARD the price').toBe(100_000);
    expect(sc.tried, 'DASHBOARD not tried').toBe(false);
    expect(sc.cb.ltv, 'DASHBOARD Coinbase\'s level').toBe(v.cbLtv);
    expect(sc.cb.level, 'DASHBOARD Coinbase\'s word').toBe(v.cbLevel);
    expect(sc.cb.liq, 'DASHBOARD the liquidation price').toBe(v.cbLiqPrice);
    expect(sc.cb.liqFrac, 'DASHBOARD the line\'s loan level').toBe(v.cbLiqFrac);
    expect(sc.cb.debt, 'DASHBOARD the accrued debt').toBe(v.accruedBalance);
    expect(sc.sk.ltv, 'DASHBOARD Strike\'s level').toBe(v.strikeLtv);
    expect(sc.sk.level, 'DASHBOARD Strike\'s word').toBe(v.strikeLevel);
    expect(sc.sk.liq, 'DASHBOARD Strike\'s liquidation price').toBe(computeViewerSafety(null, 100_000, INPUTS).figures!.strike.liqPrice);
    expect(sc.drop, 'DASHBOARD the drop: SafetyDashboard\'s liqDropPct').toBe((100_000 - v.cbLiqPrice) / 100_000);
    expect(sc.gaugeFig, 'DASHBOARD the gauge\'s bands are cbBarLevel\'s').toEqual({
      loan: true, ltv: v.cbLtv, level: v.cbLevel, warnAt: 0.75, actAt: v.cbLiqFrac * CB_ACT_LTV_FACTOR, liqAt: v.cbLiqFrac,
      needle: v.cbLtv,
    });
    // the needle rests on the dial, which ends at 100%: past it, or with no coins behind the debt (an infinite level), at
    // the end — its spring never runs to infinity (v1.4). Mutation: the needle on the level itself → red
    const deep = engineScene(facts({}, { cbLoanBalance: 140_000 }), 390, null);
    const bare = engineScene(facts({}, { cbCollateralBtc: 0 }), 390, null);
    expect([deep.gaugeFig.ltv, bare.gaugeFig.ltv], 'DASHBOARD premise: past the dial, and infinite').toEqual([1.4, Number.POSITIVE_INFINITY]);
    expect([sc.gaugeFig.needle, deep.gaugeFig.needle, bare.gaugeFig.needle], 'DASHBOARD the needle on the dial').toEqual([0.5, 1, 1]);
    expect(sc.atSupportOver, 'DASHBOARD the at-support reading').toBe(v.cbAtSupport!.over);
    // the premise: round figures, as worked out by hand
    expect([v.cbLtv, Math.round(v.cbLiqPrice), sc.sk.ltv, Math.round(sc.sk.liq), v.cbAtSupport!.over], 'DASHBOARD premise')
      .toEqual([0.5, 58_140, 0.2, 23_529, true]);
  });

  it('⭐ LIVE — live, the whole picture rides the live price: the Dashboard\'s call at it, the month unmoved; manual, stale or off, the saved price; a tried price over both (BL64)', () => {
    // mutations: the picture on the saved price while live → red; the live price taken in manual mode → red
    const base = engineScene(facts(), 390, null);
    const live = engineScene(facts({ feed: 'live', livePrice: 90_000, liveAt: NOW }), 390, null);
    const v = deriveSafetyView({ ...INPUTS, btcPrice: 90_000 });
    expect([live.price, live.realPrice, live.tried], 'LIVE the price').toEqual([90_000, 90_000, false]);
    expect([live.cb.ltv, live.cb.level, live.cb.liq], 'LIVE the Dashboard\'s call at it').toEqual([v.cbLtv, v.cbLevel, v.cbLiqPrice]);
    expect(live.drop, 'LIVE the buffer').toBe((90_000 - v.cbLiqPrice) / 90_000);
    expect(live.labels.priceText, 'LIVE the tag').toBe('$90,000');
    expect(live.flows, 'LIVE the month stays the plan\'s, at the saved price').toEqual(base.flows);
    for (const feed of ['manual', 'stale', 'off'] as const) {
      expect(engineScene(facts({ feed, livePrice: 90_000, liveAt: NOW }), 390, null).price, `LIVE ${feed}: the saved price`).toBe(100_000);
    }
    expect(engineScene(facts({ feed: 'live', livePrice: 90_000, liveAt: NOW }), 390, 70_000).price, 'LIVE a tried price over it').toBe(70_000);
  });

  it('⭐ TRIED — a tried price is the Dashboard\'s call with the price swapped: the levels move, the lines and the month stay, the facts are untouched', () => {
    const f = facts();
    const before = JSON.stringify(f);
    const base = engineScene(f, 390, null);
    for (const p of [70_000, 58_139, 40_000, 150_000]) {
      const sc = engineScene(f, 390, p);
      const v = deriveSafetyView({ ...INPUTS, btcPrice: p });
      expect(sc.tried, `TRIED ${p} is tried`).toBe(true);
      expect(sc.price, `TRIED ${p} the price drawn`).toBe(p);
      expect(sc.realPrice, `TRIED ${p} today's price kept`).toBe(100_000);
      expect([sc.cb.ltv, sc.cb.level, sc.sk.ltv, sc.sk.level], `TRIED ${p} the levels`).toEqual([v.cbLtv, v.cbLevel, v.strikeLtv, v.strikeLevel]);
      expect(sc.drop, `TRIED ${p} the drop`).toBe((p - v.cbLiqPrice) / p);
      expect([sc.cb.liq, sc.sk.liq], `TRIED ${p} the lines don't move with the price`).toEqual([base.cb.liq, base.sk.liq]);
      expect(sc.flows, `TRIED ${p} the month doesn't move`).toEqual(base.flows);
      expect(sc.chargeUsd, `TRIED ${p} the charge is today's price's`).toBe(base.chargeUsd);
      expect([sc.motorOn, sc.lamp], `TRIED ${p} the motor rests`).toEqual([false, 'tried']);
    }
    const live = facts({ feed: 'live', livePrice: 100_000, liveAt: NOW });
    expect([engineScene(live, 390, null).motorOn, engineScene(live, 390, null).lamp], 'TRIED premise: live, the motor runs').toEqual([true, 'live']);
    expect([engineScene(live, 390, 80_000).motorOn, engineScene(live, 390, 80_000).lamp], 'TRIED live, a price tried: the motor rests').toEqual([false, 'tried']);
    expect(JSON.stringify(f), 'TRIED the facts untouched').toBe(before);
    expect(engineScene(f, 390, 0).tried, 'TRIED a zero price is no price').toBe(false);
    expect(engineScene(f, 390, Number.NaN).tried, 'TRIED NaN is no price').toBe(false);
  });

  it('⭐ SELLS — at or under Coinbase\'s liquidation price Coinbase would sell, at most the CB Loan tab\'s full-repayment case; a cent above, nothing', () => {
    const liq = deriveSafetyView(INPUTS).cbLiqPrice;
    expect(engineScene(facts(), 390, liq).sells, 'SELLS at the line').toBe(true);
    const under = engineScene(facts(), 390, liq - 1);
    const seized = computeLiquidationAnalysis(50_000, 1, liq - 1, liq).scenarios[3];
    expect(seized.repayPct, 'SELLS premise: the fourth case repays it all').toBe(1);
    expect([under.labels.bannerTitle, under.labels.bannerCoins], 'SELLS the banner').toEqual(['Coinbase would sell', `up to ₿${seized.collateralSeizedBtc.toFixed(2)}`]);
    expect(under.labels.bannerCoins, 'SELLS premise: $50,000 × the incentive ÷ $58,139, worked out by hand').toBe('up to ₿0.90');
    const above = engineScene(facts(), 390, liq + 0.01);
    expect([above.sells, above.labels.bannerTitle, above.labels.bannerCoins], 'SELLS a cent above: none').toEqual([false, null, null]);
  });

  it('⭐ NO LOAN — with the Coinbase loan off: no Coinbase coins (never the store\'s seed collateral), no line, no drop, no gauge', () => {
    const sc = engineScene(facts({}, { hasCbLoan: false }), 390, null);
    expect([sc.cb.coins, sc.cb.debt, sc.cb.liq, sc.cb.yF, sc.drop, sc.sells], 'NO LOAN nothing of Coinbase').toEqual([0, 0, 0, null, null, false]);
    expect([sc.cb.owes, sc.gaugeFig.loan], 'NO LOAN no gauge').toEqual([false, false]);
    expect([sc.labels.gaugeText, sc.labels.cbOwe], 'NO LOAN its words').toEqual(['—', 'no loan']);
    expect(sc.flows!.cbInterestUsd, 'NO LOAN no Coinbase interest').toBe(0);
    expect(sc.bay.showS, 'NO LOAN Strike still drawn').toBe(true);
  });
});

describe('⭐ the month is THIS MONTH\'s', () => {
  it('⭐ MONTH — in: Coinbase\'s monthly interest (the CB Loan tab\'s), Strike\'s interest and the bills\' draw; out: spare income\'s repayments, the minimum from income, the cure', () => {
    const sc = engineScene(facts(), 390, null);
    const v = deriveSafetyView(INPUTS);
    expect(sc.flows, 'MONTH the flows').toEqual({
      cbInterestUsd: cbMonthlyInterest(v.accruedBalance, 10), strikeInterestUsd: 100, drawnUsd: 3_000, feeUsd: 0, repaidUsd: 500,
      minPaidUsd: 40, cureUsd: 0,
      inUsd: cbMonthlyInterest(v.accruedBalance, 10) + 100 + 3_000, outUsd: 500 + 40 + 0,
    });
    expect(cbMonthlyInterest(50_000, 10), 'MONTH the CB Loan tab\'s expression').toBe(50_000 * (10 / 100 / 12));
    expect(engineScene(facts({ month: null }), 390, null).flows, 'MONTH no run yet: no flows').toBe(null);
  });

  it('⭐ MOVES BETWEEN — a refinance or a defense moves debt between the loans: neither in nor out; a refinance\'s fee is new debt, in (v1.4)', () => {
    // mutation: the fee left out of in → red
    const moved = { ...ROW, refinancedUsd: 9_000, defenseDrawnUsd: 7_000 } as EngineMonthRow;
    const base = engineFlows(ROW, 50_000, 10);
    expect(engineFlows(moved, 50_000, 10), 'MOVES BETWEEN the moves: unchanged').toEqual(base);
    const fee = engineFlows({ ...moved, refinancedFeeUsd: 90 }, 50_000, 10);
    expect([fee.feeUsd, fee.inUsd, fee.outUsd], 'MOVES BETWEEN the fee: in').toEqual([90, base.inUsd + 90, base.outUsd]);
  });

  it('⭐ SHARES — each pipe runs at its share of the larger flow; nothing under the dust floor runs', () => {
    const sc = engineScene(facts(), 390, null);
    const big = Math.max(sc.flows!.inUsd, sc.flows!.outUsd);
    expect(sc.flowShares, 'SHARES').toEqual({ in: sc.flows!.inUsd / big, out: sc.flows!.outUsd / big });
    const still = engineScene(facts({ month: { ...ROW, strikeRepaidUsd: 0, cbRepaidUsd: 0, strikeMinPaidUsd: 0, cashToCureUsd: 0.4 } }), 390, null);
    expect(still.flowShares.out, 'SHARES dust is still').toBe(0);
  });
});

describe('⭐ the picture', () => {
  it('⭐ PROTOTYPE — the phone layout, the bay, the flywheel, the worm, the motor and every tap area, by the prototype\'s own numbers', () => {
    // personal-bloc-engine-prototype-v2.html's Micro view at a 372 px canvas (a 390 px phone), 2 ₿ at Coinbase and 1.2 ₿ at
    // Strike (a stack the prototype's bay and this one size alike), its regions as it registers them
    const sc = engineScene(facts({}, { cbCollateralBtc: 2, cbLoanBalance: 100_000, currentBtcHeld: 1.2, advisorActualBlocBalance: 24_000 }), 372, null);
    const PROTO: Partial<Record<RegionId, [number, number, number, number]>> = {
      tape: [8, 118, 149.18464, 260],
      strike: [254.40633811322022, 110, 35.533018867911856, 268],
      dots: [189.18464, 110, 59.22169811322023, 268],
      wheel: [180.33464, 14.149999999999999, 87.7, 87.7],
      worm: [261.03464, 39, 27, 38],
      motor: [279.03464, 29, 58, 58],
      gauge: [14.100000000000001, 9.100000000000001, 79.8, 79.8],
    };
    for (const [id, [x, y, w, h]] of Object.entries(PROTO)) {
      const r = sc.regions.find((q) => q.id === id)!;
      for (const [k, a, b] of [['x', r.x, x], ['y', r.y, y], ['w', r.w, w], ['h', r.h, h]] as const) {
        expect(a, `PROTOTYPE ${id}.${k}`).toBeCloseTo(b, 9);
      }
    }
    const price = sc.regions.find((q) => q.id === 'price')!;
    expect([price.x, price.w], 'PROTOTYPE the price\'s tag').toEqual([302, 62]);
    expect([sc.top, sc.bot, sc.under, sc.flowY, sc.H], 'PROTOTYPE Micro\'s heights').toEqual([118, 378, 404, 472, 516]);
    expect(sc.motorAt.x, 'PROTOTYPE the motor beside the worm').toBeCloseTo(308.03464, 9);
  });

  it('⭐ SCALE — the prototype\'s live rule: 12% over the price, a fifth under a line in reach, else 16% under the price; never under 0.5 in logs', () => {
    const s = priceScale(100_000, 58_140);
    expect(rel(s.lo, 58_140 * 0.8), 'SCALE a fifth under the line').toBeLessThan(1e-12);
    expect(rel(s.hi, 100_000 * 1.12), 'SCALE 12% over the price').toBeLessThan(1e-12);
    const far = priceScale(100_000, 20_000);   // a line under 30% of the price is out of reach: framed on the price alone
    expect(Math.log(far.hi / far.lo), 'SCALE never flatter than 0.5').toBeCloseTo(0.5, 12);
    expect(rel(Math.sqrt(far.hi * far.lo), Math.sqrt(100_000 * 0.84 * 100_000 * 1.12)), 'SCALE widened about its middle').toBeLessThan(1e-12);
    const none = priceScale(100_000, 0);
    expect(rel(none.lo, far.lo) + rel(none.hi, far.hi), 'SCALE no line: the same').toBeLessThan(1e-12);
    const moving = priceScale(100_000, 58_140, 130_000);   // on its way up: the frame already holds where it is going
    expect(rel(moving.hi, 130_000 * 1.12), 'SCALE the target in the frame').toBeLessThan(1e-12);
    for (const p of [100_000, 61_000, 58_140, 30_000, 400_000]) {
      const sc = engineScene(facts(), 390, p);
      expect(sc.yP, `SCALE ${p} the piston in the frame`).toBeGreaterThanOrEqual(sc.top + 2);
      expect(sc.yP, `SCALE ${p} the piston in the frame`).toBeLessThanOrEqual(sc.bot - 2);
      if (sc.cb.yF !== null && p > sc.cb.liq) expect(sc.yP, `SCALE ${p} the piston above the line`).toBeLessThan(sc.cb.yF);
      const y = yOfPrice(p, sc.scale, sc.top, sc.bot);
      expect(priceOfY(y, sc.scale, sc.top, sc.bot) / p, `SCALE ${p} the drag inverts`).toBeCloseTo(1, 12);
    }
  });

  it('⭐ BAY — each tube as wide as its coins, the two filling the bay the layout keeps; no floor of anyone\'s coins', () => {
    const L = engineLayout(390);
    for (const [cb, sk] of [[1, 0.5], [0.1, 0.05], [2.28, 0.6], [5, 1]] as const) {
      const b = bayOf(L, cb, sk);
      expect(rel(b.cW + b.sW, L.area / 1.06), `BAY ${cb}+${sk} the two fill the bay`).toBeLessThan(1e-12);
      expect(rel(b.cW / b.sW, cb / sk), `BAY ${cb}+${sk} in proportion`).toBeLessThan(1e-12);
      expect(b.right, `BAY ${cb}+${sk} clear of the tags`).toBeLessThan(L.tagX);
    }
    expect(bayOf(L, 0, 0.5).cW, 'BAY no Coinbase coins: a sliver').toBeGreaterThan(0);
    expect(bayOf(L, 1, 0.01).showS, 'BAY a speck of Strike: not drawn').toBe(false);
  });

  it('⭐ WIDTH — the phone layout from 300 to 700 px: everything inside the canvas', () => {
    for (const w of [200, 300, 320, 372, 390, 430, 700, 1200]) {
      const sc = engineScene(facts(), w, null);
      expect(sc.W, `WIDTH ${w}`).toBe(Math.min(ENGINE_MAX_W, Math.max(ENGINE_MIN_W, w)));
      expect(sc.tape.w, `WIDTH ${w} the tape has room`).toBeGreaterThan(100);
      expect(sc.bay.right, `WIDTH ${w} the bay clears the tags`).toBeLessThan(sc.tagX);
      expect(sc.tagX + sc.tagW, `WIDTH ${w} the tags inside`).toBeLessThanOrEqual(sc.W);
      expect(sc.motorAt.x + sc.motorAt.tr, `WIDTH ${w} the motor inside`).toBeLessThanOrEqual(sc.W);
      for (const r of sc.regions) expect(r.x + r.w, `WIDTH ${w} ${r.id} inside`).toBeLessThanOrEqual(sc.W + 1);
    }
  });

  it('⭐ CYCLE — the flywheel: a peak at the top, a floor at the bottom, from the Cycle Clock\'s own leg', () => {
    expect(cycleAngleOf({ rising: false, fraction: 0 }), 'CYCLE a peak').toBe(0);
    expect(cycleAngleOf({ rising: true, fraction: 0 }), 'CYCLE a floor').toBe(Math.PI);
    const justAfterLow = Date.UTC(2026, 9, 5, 1);   // an hour after the 5 Oct 2026 low
    const sc = engineScene(facts({ cycle: at(justAfterLow) }), 390, null);
    expect(sc.cycle!.rising, 'CYCLE rising after the low').toBe(true);
    expect(sc.cycle!.angle, 'CYCLE at the bottom').toBeCloseTo(Math.PI, 3);
    const leg = cycleLegAt(NOW)!;
    expect(engineScene(facts(), 390, null).cycle!.angle, 'CYCLE today').toBe(Math.PI + leg.fraction * Math.PI);
    expect(engineScene(facts({ cycle: null }), 390, null).cycle, 'CYCLE none outside the projection').toBe(null);
  });

  it('⭐ TAPE — each minute\'s close at its minute\'s end, oldest first, the half hour and three minutes before the newest; the live price while the feed has one', () => {
    const t = tapeOf(facts());
    expect(t.closes.length, 'TAPE the half hour and a little more').toBe(34);
    expect(t.closes[t.closes.length - 1], 'TAPE the newest close, at its minute\'s end').toEqual({ t: NOW + 60_000, p: 100_200 });
    expect(t.closes[0].t, 'TAPE the oldest kept').toBe(NOW + 60_000 - TAPE_MS - 3 * 60_000);
    expect(t.closes.every((q, i) => i === 0 || q.t > t.closes[i - 1].t), 'TAPE oldest first').toBe(true);
    expect(t.live, 'TAPE manual: no live price').toBe(null);
    expect(tapeOf(facts({ feed: 'live', livePrice: 100_500, liveAt: NOW + 10_000 })).live, 'TAPE a live price inside the newest minute joins')
      .toEqual({ t: NOW + 10_000, p: 100_500 });
    expect(tapeOf(facts({ feed: 'stale', livePrice: 100_500, liveAt: NOW + 10_000 })).live, 'TAPE stale: still shown').toEqual({ t: NOW + 10_000, p: 100_500 });
    expect(tapeOf(facts({ feed: 'live', livePrice: 100_500, liveAt: NOW - 120_000 })).live, 'TAPE an older one doesn\'t').toBe(null);
    expect(tapeOf(facts({ feed: 'off', livePrice: 100_500, liveAt: NOW + 10_000 })).live, 'TAPE off: none').toBe(null);
    expect(tapeOf(facts({ candles: [], feed: 'live', livePrice: 100_500, liveAt: NOW })), 'TAPE no closes yet: the live price alone')
      .toEqual({ closes: [], live: { t: NOW, p: 100_500 } });
    expect(engineScene(facts(), 390, null).tapePrices, 'TAPE the scene\'s').toEqual(t);
  });

  it('⭐ CHARGE — one particle for each slice of debt worth today\'s price × 3 ÷ 260 (the prototype\'s U at today), whatever price is tried', () => {
    expect(engineScene(facts(), 390, null).chargeUsd, 'CHARGE').toBe(100_000 * 3 / 260);
    expect(engineScene(facts({}, { btcPrice: 0 }), 390, null).chargeUsd, 'CHARGE no price: none').toBe(0);
  });

  it('⭐ TAGS — one rule for the scene at rest and the canvas in motion', () => {
    const sc = engineScene(facts(), 390, null);
    expect(sc.tags, 'TAGS the scene\'s').toEqual(tagHeights(sc.yP, sc.cb.yF, sc.top, sc.bot));
    expect(tagHeights(200, null, 118, 378).ry, 'TAGS no line, no tag').toBe(null);
    expect(tagHeights(370, 376, 118, 378).py, 'TAGS kept above the bed plate, where the pipes run').toBe(378 - 52);
  });

  it('⭐ REGIONS — the prototype\'s order, the last drawn winning; each part where it is drawn; a fingertip finds a small one; nothing outside', () => {
    const sc = engineScene(facts(), 390, null);
    expect(sc.regions.map((r) => r.id), 'REGIONS the prototype\'s order').toEqual(
      ['month', 'tape', 'strike', 'dots', 'redline', 'piston', 'wheel', 'worm', 'motor', 'gauge', 'price', 'redtag']);
    const centre = (id: RegionId): [number, number] => { const r = sc.regions.find((q) => q.id === id)!; return [r.x + r.w / 2, r.y + r.h / 2]; };
    const b = sc.bay;
    expect(regionAt(sc, b.cX + b.cW / 2, sc.yP - 6)?.part, 'REGIONS the piston').toBe('price');
    expect(regionAt(sc, b.cX + b.cW / 2, sc.yP - 6)?.drag, 'REGIONS a drag').toBe(true);
    expect(regionAt(sc, b.cX + b.cW / 2, sc.cb.yF!)?.part, 'REGIONS the line').toBe('sale');
    expect(regionAt(sc, b.cX + b.cW / 2, (sc.bot + sc.cb.yF!) / 2 + 20)?.part, 'REGIONS Coinbase').toBe('coinbase');
    expect(regionAt(sc, b.sX + b.sW / 2, sc.bot - 4)?.part, 'REGIONS Strike').toBe('strike');
    const parts: [RegionId, string][] = [['gauge', 'gauge'], ['wheel', 'cycle'], ['motor', 'tape'], ['worm', 'tape'], ['price', 'price'], ['redtag', 'sale'], ['month', 'month'], ['tape', 'tape']];
    for (const [id, part] of parts) expect(regionAt(sc, ...centre(id))?.part, `REGIONS ${id}`).toBe(part);
    expect(regionAt(sc, -5, -5), 'REGIONS nothing outside').toBe(null);
    // a fingertip: beside the red line, outside every region, but within 44 px of the line's thin one
    const off: [number, number] = [b.cX - 8, sc.cb.yF! + 12];
    expect([regionAt(sc, ...off), regionAt(sc, ...off, true)?.id], 'REGIONS a fingertip finds the line').toEqual([null, 'redline']);
    const tried = engineScene(facts(), 390, 80_000);
    const back = tried.regions.find((r) => r.id === 'untest')!;
    expect([back.part, regionAt(tried, back.x + 4, back.y + 4)?.id], 'REGIONS a tried price: the way back, over its tag').toEqual([null, 'untest']);
    expect(sc.regions.some((r) => r.id === 'untest'), 'REGIONS no way back at today\'s price').toBe(false);
    expect([...RING_IDS].sort(), 'REGIONS the ringed ones').toEqual(['dots', 'gauge', 'motor', 'price', 'redtag', 'strike', 'wheel']);
  });

  it('⭐ PLACE — a card on a computer goes where the prototypes put theirs: beside its part, or above its button; always on the screen (2026-11-25)', () => {
    const at = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
    // a part on the picture: 12 px to its right, level with it. Mutation: under it, or over it → red
    expect(cardPlace(at(400, 200, 80, 80), 'canvas', 330, 280, 1280, 800), 'PLACE beside the part').toEqual({ x: 492, y: 100 });
    // the screen ends: to its left. Mutation: no flip → red (it would run off the screen, clamped over the part)
    expect(cardPlace(at(1100, 300, 60, 30), 'canvas', 330, 200, 1280, 800), 'PLACE left where the screen ends').toEqual({ x: 758, y: 215 });
    // neither side fits: centred over it, inside the screen
    expect(cardPlace(at(200, 300, 300, 40), 'canvas', 330, 200, 640, 800), 'PLACE centred where neither fits').toEqual({ x: 185, y: 220 });
    // a button: above it, beside it; with no room above, under it, from its left edge
    expect(cardPlace(at(500, 700, 90, 36), 'button', 330, 200, 1280, 800), 'PLACE above a button').toEqual({ x: 602, y: 490 });
    expect(cardPlace(at(500, 150, 90, 36), 'button', 330, 200, 1280, 800), 'PLACE under it, with no room above').toEqual({ x: 500, y: 196 });
    // always 8 px inside the screen. Mutation: no clamp → red
    expect(cardPlace(at(400, 760, 80, 30), 'canvas', 330, 300, 1280, 800), 'PLACE on the screen, low down').toEqual({ x: 492, y: 492 });
    expect(cardPlace(at(10, 10, 20, 20), 'canvas', 330, 300, 1280, 800), 'PLACE on the screen, up top').toEqual({ x: 42, y: 8 });
  });
});
