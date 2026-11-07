import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as engine from '../cyclingSim';
import type { CyclingInputs, CyclingResult } from '../cyclingSim';
import { plConvergencePath, PL_ON_THE_LINE } from '../powerLaw';
import { cycleConvergencePath } from '../cyclePath';
import { priceFutures, FUTURES_SEED } from '../pricePaths';
import { CB_APR_SEED_PCT } from '../runCoinbaseLoan';
import { buildSupportPath, supportPolicyFor } from '../../components/Almanac/supportPolicyInputs';
import { PLAN_POLICY_DEFAULTS } from '../../lib/planPolicy';
import { PLAN_ENGINE_CONTEXT, PLAN_COLD_BUFFER_PCT, PLAN_CYCLE_MONTHS, planPolicySettingsOf } from '../../components/Almanac/planRun';

/**
 * BL42/BL55 — the FIRE face's borrow lane: `CyclingInputs.livingOnCredit` (spec `pbloc-spec-borrow-lane-v1.md`).
 *   ⭐ LANE OFF — absent, every run byte for byte the shipped engine's: a golden over 309 runs (paths × households ×
 *     the policy's switches, and a path that opens in pay-down with a balance on Strike) on STORED paths, and junk
 *     reads as absent.
 *   ⭐ EVERY ZONE — the line pays the bill in hold, pay-down and below support too (BL42), where today's run doesn't —
 *     through two-year stretches on the plan's $40k line, Strike a conduit throughout.
 *   ⭐ STOPS — within the plan's stops (L1): at support, and below support at today's price; Strike a conduit; tighter
 *     stops end the lane sooner.
 *   ⭐ BREAKER — no new debt while the hard breaker is tripped; the reserve pays; then the lane ends (L3); the
 *     owner's re-arm lets it draw again.
 *   ⭐ FROM COLD — coins come back from cold only as the line needs room, the refinance's fee included, and the cold
 *     ledger still foots (L2); no lane ends unpaid outside the breaker with coins left in cold.
 *   ⭐ RESERVE — the reserve pays after the line, never before, and grows by its factor (L6).
 *   ⭐ INFLATION — the bill steps every 12 months on the stop month's calendar (BL42).
 *   ⭐ NEVER DROPPED — every month the line, the reserve and the unpaid part add up to the bill, and the lane ends at
 *     its first unpaid bill or Coinbase's seizure (BL42, L4).
 */
// Read through the module, so the file loads on the shipped engine too (red first) and LANE OFF's golden comes from it.
const { runCyclingSim } = engine;
const EPS = (engine as { LANE_UNPAID_EPS_USD?: number }).LANE_UNPAID_EPS_USD ?? 0.005;
const START = new Date('2026-11-07');
const MONTHS = 240;
const S_PATH = buildSupportPath(START, MONTHS);
/** ⚠ LANE OFF's inputs, stored: its paths are built with Math.pow, whose last bit differs between Node 22 (CI) and Node 26
 *  (rules-in-full.md:16). The engine is pure + − × ÷, so stored inputs reproduce bit for bit anywhere. */
const golden = JSON.parse(
  readFileSync(new URL('./goldens/livingOnCreditLaneOff.golden.json', import.meta.url), 'utf8'),
) as { meta: Record<string, unknown>; supportPath: number[]; paths: number[][] };

type House = { sk: number; cb: number; cold: number; cbDebt: number; line: number; income: number; spend: number };
function inputs(h: House, path: number[], o: { stops?: [number, number]; cash?: number; rearm?: number | null; goal?: number | null;
  policy?: boolean; mode?: CyclingInputs['mode']; incomePath?: number[]; buffer?: number; support?: number[] } = {}): CyclingInputs {
  const [cb, sk] = o.stops ?? [PLAN_POLICY_DEFAULTS.cbStopAtSupportPct, PLAN_POLICY_DEFAULTS.strikeStopAtSupportPct];
  const settings = planPolicySettingsOf({ ...PLAN_POLICY_DEFAULTS, cbStopAtSupportPct: cb, strikeStopAtSupportPct: sk,
    ...(o.buffer !== undefined ? { bearBufferMonths: o.buffer } : {}) });
  const sp = supportPolicyFor(settings, (o.support ?? S_PATH).slice(0, path.length), h.spend, 85, 'cycle');
  // `rearm`: absent ⇒ the plan's own default; null ⇒ none, the breaker latches; a number ⇒ that re-arm.
  const sp2 = o.policy === false || sp === undefined ? undefined
    : { ...sp, openingCashUsd: o.cash ?? sp.openingCashUsd, ...(typeof o.rearm === 'number' ? { breakerRearmMonths: o.rearm } : {}) };
  if (sp2 !== undefined && o.rearm === null) delete sp2.breakerRearmMonths;
  const supportPolicy = sp2;
  return {
    ...PLAN_ENGINE_CONTEXT, startYear: START.getUTCFullYear(),
    strikeCollateralBtc: h.sk, strikeBalance: 0, strikeCreditLine: h.line, cbCollateralBtc: h.cb, cbDebt: h.cbDebt,
    openingColdBtc: h.cold, income: h.income, expenses: h.spend, strikeAprPct: 13, cbAprPct: CB_APR_SEED_PCT,
    cycleMonths: PLAN_CYCLE_MONTHS, coldStoreBufferPct: PLAN_COLD_BUFFER_PCT, defendCbLtv: true,
    supportPolicy, openingStrikeHoldMonths: 0, strikeMinFromIncome: false, goalNetBtc: o.goal ?? null,
    ...(o.mode !== undefined ? { mode: o.mode } : {}), ...(o.incomePath !== undefined ? { incomePath: o.incomePath } : {}),
    pricePath: path,
  };
}
const LANE = { spendingInflation: 0.02, reserveMonthlyFactor: 1 };
const lane = (i: CyclingInputs, l: CyclingInputs['livingOnCredit'] = LANE) => runCyclingSim({ ...i, livingOnCredit: l });
/** A path as multiples of support, by month ranges: [[fromMonth, multiple], …]. */
const shaped = (steps: [number, number][], months = MONTHS) =>
  S_PATH.slice(0, months + 1).map((s, m) => s * steps.filter(([from]) => from <= m).at(-1)![1]);
const billOf = (r: CyclingResult, m: number) => r.rows[m].strikeDrawn + r.rows[m].cashToBillsUsd + r.rows[m].unfundedUsd;
const months = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const NO_INCOME: House = { sk: 2, cb: 1, cold: 2, cbDebt: 0, line: 40_000, income: 0, spend: 5_000 };

describe('BL42/BL55 — the borrow lane', () => {
  it('⭐ LANE OFF — absent, a golden over 309 runs on stored paths; junk reads as absent', () => {
    // The stored paths are what the builders give — each held to its builder within a relative 1e-12 (G1's rule).
    const built: number[][] = [
      plConvergencePath(100_000, 'floor', START, MONTHS, PL_ON_THE_LINE),
      plConvergencePath(100_000, 'fair', START, MONTHS, PL_ON_THE_LINE),
      cycleConvergencePath(100_000, START, MONTHS, PL_ON_THE_LINE, 0),
      shaped([[0, 1.5], [6, 2.5], [12, 3.5], [18, 0.95], [24, 0.8], [30, 1.2]]),
      ...priceFutures({ anchorPrice: 100_000, startDate: START, months: MONTHS, count: 5, seed: FUTURES_SEED }).map((f) => f.prices),
      shaped([[0, 1.1]], 12),
    ];
    const near = (got: number[], stored: number[], what: string): void => {
      expect(got, what).toHaveLength(stored.length);
      got.forEach((x, m) => expect(Math.abs(x / stored[m] - 1), `${what}, m${m}`).toBeLessThan(1e-12));
    };
    near(S_PATH, golden.supportPath, 'LANE OFF the stored support path');
    expect(golden.paths, 'LANE OFF the stored paths').toHaveLength(built.length);
    built.forEach((p, i) => near(p, golden.paths[i], `LANE OFF stored path ${i}`));
    // The runs read the STORED support path and paths only.
    const support = golden.supportPath;
    const houses: House[] = [
      NO_INCOME,
      { sk: 1, cb: 0.5, cold: 1, cbDebt: 20_000, line: 40_000, income: 8_000, spend: 5_000 },
      { sk: 5, cb: 0, cold: 0, cbDebt: 0, line: 60_000, income: 6_000, spend: 6_000 },
    ];
    const hash = createHash('sha256');
    let runs = 0;
    for (const p of golden.paths) for (const h of houses) {
      const at = (o: Parameters<typeof inputs>[2] = {}) => inputs(h, p, { support, ...o });
      const incomePath = p.map((_, m) => h.income * (m % 7 === 0 ? 0.5 : 1));
      const variants: CyclingInputs[] = [
        at({ policy: false }), at({ policy: false, mode: 'hold' }), at({ policy: false, mode: 'clearBoth' }),
        at(), at({ stops: [70, 60] }), at({ goal: 3 }), at({ cash: 24_000 }),
        at({ rearm: 3 }), at({ incomePath }), at({ cash: 12_000, rearm: 2, stops: [60, 55] }),
      ];
      for (const v of variants) { hash.update(JSON.stringify(runCyclingSim(v))); runs++; }
    }
    expect(runs, 'LANE OFF the sweep reaches 300 runs').toBe(300);
    expect(hash.digest('hex'), 'LANE OFF the golden — the shipped engine\'s bytes')
      .toBe('d98105ed204319f0e6982ff0ce745761f893a6862c961991e24030708e47dfed');
    // …and a path that opens in pay-down and falls below support, opening with a balance on Strike: the 300 runs never
    // hold one there, where the plan never refinances and the lane does (the refinance's gate). It is the STORED support
    // path times two multiples — × alone, so exact on any Node.
    const steep = support.slice(0, 25).map((s, m) => s * (m < 12 ? 3.5 : 0.95));
    const owed = createHash('sha256');
    let held = 0;
    for (const h of houses) for (const o of [{}, { rearm: 3 }, { cash: 24_000 }]) {
      const r = runCyclingSim({ ...inputs(h, steep, { support, ...o }), strikeBalance: 15_000 });
      held += r.rows.filter((x) => (x.policyZone === 'payDown' || x.policyZone === 'paused') && x.strikeBalance > 0).length;
      owed.update(JSON.stringify(r));
    }
    expect(held, 'LANE OFF the runs hold a Strike balance in pay-down and below support').toBeGreaterThan(24);
    expect(owed.digest('hex'), 'LANE OFF the golden with a Strike balance — the shipped engine\'s bytes')
      .toBe('ea484febd0c937d4369fdcb4a3eac2be66d0180de80eb3256bc6d15e2588e034');
    // Junk, or a run that can't host the lane, reads as absent: no key, the same bytes.
    const p = golden.paths[0];
    const base = inputs(NO_INCOME, p, { support });
    const off = JSON.stringify(runCyclingSim(base));
    for (const junk of [{ spendingInflation: NaN, reserveMonthlyFactor: 1 }, { spendingInflation: -0.01, reserveMonthlyFactor: 1 },
      { spendingInflation: 0.02, reserveMonthlyFactor: 0 }, { spendingInflation: 0.02, reserveMonthlyFactor: 1, stepOffsetMonths: 12 },
      { spendingInflation: 0.02, reserveMonthlyFactor: 1, stepOffsetMonths: 1.5 }] as CyclingInputs['livingOnCredit'][]) {
      expect(JSON.stringify(lane(base, junk)), `LANE OFF junk ${JSON.stringify(junk)}`).toBe(off);
    }
    for (const [why, i] of [['the policy off', inputs(NO_INCOME, p, { support, policy: false })],
      ['a goal', inputs(NO_INCOME, p, { support, goal: 3 })], ['mode hold', inputs(NO_INCOME, p, { support, mode: 'hold' })]] as const) {
      const r = lane(i);
      expect(r.livingOnCredit, `LANE OFF ${why}: no lane`).toBeUndefined();
      expect(JSON.stringify(r), `LANE OFF ${why}: the same bytes`).toBe(JSON.stringify(runCyclingSim(i)));
    }
  }, 60_000);

  it('⭐ EVERY ZONE — the line pays the bill in hold, pay-down and below support, through long stretches', () => {
    // Two years in pay-down and two below support, on the plan's $40k line. With no income nothing retires Strike, so
    // the lane's balance moves to Coinbase in every zone it draws in — kept on Strike, it would fill the line in 8 months.
    const p = shaped([[0, 1.5], [6, 2.5], [12, 3.5], [36, 0.95], [60, 1.5]], 72);
    const h: House = { ...NO_INCOME, cb: 4, cold: 4 };
    const off = runCyclingSim(inputs(h, p));
    const on = lane(inputs(h, p));
    for (const [zone, from, to] of [['hold', 6, 11], ['payDown', 12, 35], ['paused', 36, 59]] as const) {
      const ms = months(from, to);
      expect(ms.map((m) => on.rows[m].policyZone), `EVERY ZONE the path stays in ${zone}`).toEqual(ms.map(() => zone));
      expect(ms.map((m) => off.rows[m].strikeDrawn), `EVERY ZONE today's run draws nothing in ${zone}`).toEqual(ms.map(() => 0));
      for (const m of ms) {
        expect(on.rows[m].strikeDrawn, `EVERY ZONE the line pays month ${m} (${zone})`).toBeCloseTo(billOf(on, m), 6);
        expect(on.rows[m].unfundedUsd, `EVERY ZONE nothing unpaid in month ${m}`).toBe(0);
      }
    }
    for (const m of months(1, 72)) expect(on.rows[m].strikeBalance, `EVERY ZONE Strike a conduit, month ${m}`).toBeLessThanOrEqual(0.01);
    expect(on.livingOnCredit?.endMonth, 'EVERY ZONE it lasts the path').toBeNull();
  });

  it('⭐ STOPS — within the plan\'s stops, at support and below it at today\'s price, Strike a conduit; tighter stops end it sooner', () => {
    // Above support (1.8×, the buy zone). The line borrows only what Coinbase can take at its stop at support: each
    // month's draw passes through Strike into Coinbase, so Strike holds no lane debt at a month's end.
    const p = shaped([[0, 1.8]], 120);
    const h: House = { sk: 2, cb: 1, cold: 0, cbDebt: 0, line: 200_000, income: 0, spend: 5_000 };
    const tight = lane(inputs(h, p, { stops: [45, 50] }));
    const loose = lane(inputs(h, p, { stops: [70, 60] }));
    expect(tight.livingOnCredit?.endReason, 'STOPS it ends unpaid').toBe('unpaid');
    expect(loose.livingOnCredit!.endMonth ?? Infinity, 'STOPS looser stops last longer').toBeGreaterThan(tight.livingOnCredit!.endMonth!);
    for (const [r, cbStop] of [[tight, 0.45], [loose, 0.70]] as const) {
      for (let m = 1; m < (r.livingOnCredit!.endMonth ?? r.rows.length); m++) {
        const x = r.rows[m]; const s = S_PATH[m];
        expect(x.cbDebt / (x.cbCollateralBtc * s), `STOPS Coinbase at support, month ${m}`).toBeLessThanOrEqual(cbStop + 0.01);
        expect(x.strikeBalance, `STOPS Strike a conduit, month ${m}`).toBeLessThanOrEqual(0.01);
      }
    }
    // Below support (0.92×, paused all the way) the stop is read at today's price: moving the lane's debt onto Coinbase
    // never leaves its LTV at today's price past the stop, and the line still draws only what Coinbase takes.
    const below = lane(inputs({ sk: 2, cb: 2, cold: 0, cbDebt: 0, line: 40_000, income: 0, spend: 5_000 }, shaped([[0, 0.92]], 36),
      { stops: [45, 50] }));
    expect(below.livingOnCredit?.endReason, 'STOPS below support it ends unpaid').toBe('unpaid');
    const life = below.rows.slice(1, below.livingOnCredit!.endMonth!);
    expect(life.map((x) => x.policyZone), 'STOPS below support all the way').toEqual(life.map(() => 'paused'));
    const moved = life.filter((x) => x.refinancedUsd > 0);
    expect(moved.length, 'STOPS below support the lane moves its debt onto Coinbase').toBeGreaterThanOrEqual(12);
    for (const x of moved) {
      expect(x.cbDebt / (x.cbCollateralBtc * x.price), `STOPS below support, Coinbase at today's price, month ${x.m}`)
        .toBeLessThanOrEqual(0.45 + 0.01);
    }
    for (const x of life) expect(x.strikeBalance, `STOPS below support, Strike a conduit, month ${x.m}`).toBeLessThanOrEqual(0.01);
  });

  it('⭐ BREAKER — no new debt while it is tripped; the reserve pays; then the lane ends; a re-arm draws again', () => {
    const p = shaped([[0, 1.5], [6, 0.8], [12, 1.2]], 60);
    const h: House = { ...NO_INCOME, sk: 6, cb: 4, cold: 8, line: 200_000 };
    const r = lane(inputs(h, p, { cash: 50_000, rearm: null }));   // no re-arm: the breaker latches
    expect(r.modelBrokenMonth, 'BREAKER the path trips it').not.toBeNull();
    const b = r.modelBrokenMonth!;
    for (let m = b; m <= 60; m++) expect(r.rows[m].strikeDrawn, `BREAKER no draw in month ${m}`).toBe(0);
    expect(r.rows[b].cashToBillsUsd, 'BREAKER the reserve pays the tripped month').toBeGreaterThan(0);
    expect(r.livingOnCredit?.endReason, 'BREAKER then the lane ends unpaid').toBe('unpaid');
    expect(r.livingOnCredit!.endMonth!, 'BREAKER it ends after the reserve, not at the trip').toBeGreaterThan(b);
    const re = lane(inputs(h, p, { cash: 50_000, rearm: 3 }));
    expect(re.firstRearmMonth, 'BREAKER the re-arm comes back').not.toBeNull();
    expect(re.rows[re.firstRearmMonth!].strikeDrawn, 'BREAKER the re-armed month draws').toBeGreaterThan(0);
    expect(re.livingOnCredit?.endMonth, 'BREAKER with the re-arm it lasts the path').toBeNull();
  });

  it('⭐ FROM COLD — coins come back only as the line needs room, the fee included, and the cold ledger foots', () => {
    const p = plConvergencePath(100_000, 'floor', START, MONTHS, PL_ON_THE_LINE);
    const withCold = lane(inputs({ sk: 2, cb: 0.5, cold: 6, cbDebt: 0, line: 40_000, income: 0, spend: 5_000 }, p));
    expect(withCold.livingOnCredit?.endMonth, 'FROM COLD the coins in cold carry it through').toBeNull();
    expect(withCold.livingOnCredit!.coldBackBtc, 'FROM COLD some came back').toBeGreaterThan(0);
    expect(withCold.livingOnCredit!.coldBackBtc, 'FROM COLD never more than cold held').toBeLessThanOrEqual(6 + withCold.totalColdFromCb + withCold.totalColdFromStrike);
    expect(withCold.openingColdBtc + withCold.totalColdFromCb + withCold.totalColdFromStrike - withCold.totalColdRetrievedBtc, 'FROM COLD the ledger')
      .toBeCloseTo(withCold.totalColdBtc, 9);
    const noCold = lane(inputs({ sk: 2, cb: 0.5, cold: 0, cbDebt: 0, line: 40_000, income: 0, spend: 5_000 }, p));
    expect(noCold.livingOnCredit?.endReason, 'FROM COLD without cold it ends').toBe('unpaid');
    // Only as the line needs room: no bill, nothing back; a bigger bill, more back.
    const at = (spend: number) => lane(inputs({ sk: 2, cb: 3, cold: 4, cbDebt: 0, line: 40_000, income: 0, spend }, shaped([[0, 1.5]], 24)));
    expect(at(0).livingOnCredit!.coldBackBtc, 'FROM COLD no bill, nothing back').toBe(0);
    expect(at(1_000).livingOnCredit!.coldBackBtc, 'FROM COLD a bill brings some back').toBeGreaterThan(0);
    expect(at(3_000).livingOnCredit!.coldBackBtc, 'FROM COLD a bigger bill, more').toBeGreaterThan(at(1_000).livingOnCredit!.coldBackBtc);
    // With no bear buffer (legal: 0–48) the keep binds exactly, so the coins back must cover the bill AND the
    // refinance's fee — at 1.5× support, and below it (0.95×), where the keep is read at today's price.
    const rich: House = { sk: 2, cb: 1, cold: 4, cbDebt: 0, line: 40_000, income: 0, spend: 5_000 };
    for (const [where, q] of [['at 1.5×', shaped([[0, 1.5]], 24)], ['below support', shaped([[0, 0.95]], 24)]] as const) {
      const r = lane(inputs(rich, q, { buffer: 0 }));
      expect(r.livingOnCredit?.endMonth, `FROM COLD no buffer, ${where}: it lasts`).toBeNull();
      expect(Math.max(...r.rows.map((x) => x.unfundedUsd)), `FROM COLD no buffer, ${where}: no bill short`).toBeLessThan(EPS);
      expect(r.livingOnCredit!.coldBackBtc, `FROM COLD no buffer, ${where}: coins came back`).toBeGreaterThan(0);
    }
    // Across 40 futures, with the plan's buffer and with none: no lane ends unpaid outside the breaker while coins were
    // left in cold after its cold step — the line ran out of room, or the breaker ended it.
    const futures = priceFutures({ anchorPrice: 100_000, startDate: START, months: MONTHS, count: 40, seed: FUTURES_SEED });
    let inBreaker = 0;
    let lasts = 0;
    for (const buffer of [12, 0]) for (const f of futures) {
      const r = lane(inputs(rich, f.prices, { buffer }));
      const l = r.livingOnCredit!;
      if (l.endReason === null) { lasts++; continue; }
      if (l.endReason !== 'unpaid') continue;
      const x = r.rows[l.endMonth!];
      if (x.policyZone === 'broken') { inBreaker++; continue; }
      expect(r.rows[l.endMonth! - 1].coldBtc - x.coldRetrievedBtc, `FROM COLD buffer ${buffer}: unpaid at month ${l.endMonth} with coins left in cold`)
        .toBeLessThanOrEqual(1e-9);
    }
    expect(inBreaker, 'FROM COLD the sweep reaches lanes the breaker ends').toBeGreaterThanOrEqual(10);
    expect(lasts, 'FROM COLD …and lanes that last').toBeGreaterThanOrEqual(10);
  }, 60_000);

  it('⭐ RESERVE — after the line, never before, and it grows by its factor', () => {
    const p = shaped([[0, 1.5], [6, 0.8], [12, 1.2]], 30);
    const h: House = { ...NO_INCOME, sk: 6, cb: 4, cold: 8, line: 200_000 };
    const r = lane(inputs(h, p, { cash: 30_000 }), { spendingInflation: 0, reserveMonthlyFactor: 1.01 });
    const b = r.modelBrokenMonth!;
    for (let m = 1; m < b; m++) {
      expect(r.rows[m].cashToBillsUsd, `RESERVE the line pays first, month ${m}`).toBe(0);
      expect(r.rows[m].cashReserveUsd, `RESERVE it grows, month ${m}`).toBeCloseTo(r.rows[m - 1].cashReserveUsd * 1.01, 6);
    }
    expect(r.rows[b].cashToBillsUsd, 'RESERVE pays once the line can\'t').toBeGreaterThan(0);
  });

  it('⭐ INFLATION — the bill steps every 12 months, on the stop month\'s calendar', () => {
    const p = shaped([[0, 1.5]], 40);
    const h: House = { ...NO_INCOME, sk: 10, line: 400_000, spend: 1_000 };
    const r = lane(inputs(h, p), { spendingInflation: 0.1, reserveMonthlyFactor: 1 });
    expect(billOf(r, 0), 'INFLATION month 0 is the opening — no bill').toBe(0);
    expect([1, 11, 12, 23, 24, 36].map((m) => +billOf(r, m).toFixed(6)), 'INFLATION steps at 12, 24, 36').toEqual([1000, 1000, 1100, 1100, 1210, 1331]);
    const o = lane(inputs(h, p), { spendingInflation: 0.1, reserveMonthlyFactor: 1, stepOffsetMonths: 6 });
    expect([1, 5, 6, 17, 18].map((m) => +billOf(o, m).toFixed(6)), 'INFLATION a stop month 6 off the year').toEqual([1000, 1000, 1100, 1100, 1210]);
  });

  it('⭐ NEVER DROPPED — the line, the reserve and the unpaid part add up to the bill; the end is the first unpaid bill', () => {
    const futures = priceFutures({ anchorPrice: 100_000, startDate: START, months: MONTHS, count: 40, seed: FUTURES_SEED });
    let ended = 0;
    for (const f of futures) {
      const r = lane(inputs(NO_INCOME, f.prices, { cash: 60_000 }));
      let bill = NO_INCOME.spend;
      expect(billOf(r, 0), 'NEVER DROPPED month 0 is the opening — no bill').toBe(0);
      for (let m = 1; m <= MONTHS; m++) {
        if (m > 0 && m % 12 === 0) bill *= 1.02;
        expect(billOf(r, m), `NEVER DROPPED month ${m}`).toBeCloseTo(bill, 6);
      }
      const unpaid = r.rows.find((x) => x.unfundedUsd >= EPS)?.m ?? null;
      const end = unpaid === null ? r.liqMonth : r.liqMonth === null ? unpaid : Math.min(unpaid, r.liqMonth);
      expect(r.livingOnCredit?.endMonth, 'NEVER DROPPED the end').toBe(end);
      expect(r.livingOnCredit?.endReason, 'NEVER DROPPED its reason')
        .toBe(end === null ? null : r.liqMonth !== null && r.liqMonth === end ? 'seized' : 'unpaid');
      if (end !== null) ended++;
    }
    expect(ended, 'NEVER DROPPED the sweep reaches lanes that end').toBeGreaterThan(5);
    expect(ended, 'NEVER DROPPED …and lanes that last').toBeLessThan(40);
  }, 60_000);
});
