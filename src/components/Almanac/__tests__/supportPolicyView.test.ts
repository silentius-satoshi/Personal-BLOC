import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_SUPPORT_POLICY_SETTINGS, DEFAULT_BREAKER_REARM_MONTHS, SUPPORT_POLICY_RANGES, PAY_DOWN_MIN_GAP,
  effectivePolicySettings, ZONE_LABEL, ZONE_LETTER, ZONE_ORDER, ZONE_COLOR, policyReading, policyHeadline,
  policyDetails, neverDrawsNote, policyPauseReason, drawPauseClause, zoneStrip, policyLimitPct, coldShown,
  strikeCallSummary, strikeCallSentence, billsRemainderTail, policyUnpaidNote, policyAlert, policyStopSentence,
  policyIgnoredNote, zoneStripLabel, settingReadouts, defenseLineNote, policyTileSub, policyColdNote, policyTip,
  fmtPolicyPct, DUST_USD, shownUsd,
  type PolicyReading, type PolicyTone, type SupportPolicySettings, type NeverDraws,
} from '../supportPolicyView';
import { supportPolicyFor } from '../supportPolicyInputs';
import {
  runCyclingSim, effectiveStrikeCapPct, type CyclingInputs, type CyclingResult, type CyclingRow,
  type PolicyIgnoredReason,
} from '../../../simulation/cyclingSim';
import type { PolicyState } from '../../../simulation/supportPolicy';
import { STRIKE_MARGIN_CALL_LTV } from '../../../simulation/emergencyModel';
import { fmtUSD } from '../../../utils/format';
import {
  SP_START, SP_MONTHS, SUPPORT, SP_REPRO, CASH_6_USD, policyFor, supportPathFor, pathP1, pathP2, pathP4, pathP6,
  multiplePath, a5Cases, runPolicy, callRun, RESTORE_OPENING, OVER_CEILING_COLD_OPENING,
  faceWorldGrid, syntheticGrid, reachGrid,
} from '../../../simulation/__tests__/supportPolicyPaths';

/**
 * Run 2a — the support policy's display math (supportPolicyView.ts). Round synthetic figures only — this repo is
 * public. Engine-derived dollar figures are formatted with the app's own fmtUSD in the expectation, so a pin never
 * depends on the last bit of a power-law value; exact literals are used where the figure is exact (P7) or synthetic.
 */

/** The settings a face with SP_REPRO's defense lines (CB 70, Strike cap 60) builds from the defaults. */
const S = effectivePolicySettings(DEFAULT_SUPPORT_POLICY_SETTINGS, {
  cbLtvCapPct: SP_REPRO.cbLtvCapPct,
  strikeCapEffPct: effectiveStrikeCapPct(SP_REPRO.strikeLtvCapPct, STRIKE_MARGIN_CALL_LTV),
});
const BILLS = SP_REPRO.expenses;
const read = (r: CyclingResult, m: number): PolicyReading => policyReading(r, m, BILLS);
const firstRow = (r: CyclingResult, zone: PolicyState): CyclingRow => r.rows.find((x) => x.m > 0 && x.policyZone === zone)!;

// ── NEW fixtures — the smallest that make each never-draws kind happen (no Run 1 fixture or grid cell ever stops
//    drawing by the zone or by Strike's own line). Inputs, so the exhaustive test can check each one too. ─────────
const SIX = supportPathFor(SP_START, 6);
const NEVER = {
  /** Opens at 1.8× support and stays: every month is hold. */
  zone: { ...SP_REPRO, pricePath: multiplePath([[0, 1.8], [72, 1.8]]), supportPolicy: policyFor(SUPPORT) },
  /** 1.8× support for a year, then straight to 0.8×: hold, paused, broken — the buy zone never opens. */
  zoneMixed: { ...SP_REPRO, pricePath: multiplePath([[0, 1.8], [12, 1.8], [13, 0.8], [72, 0.8]]), supportPolicy: policyFor(SUPPORT) },
  /** On the line with Strike's line FULL ($30k drawn on a $30k line) and no refinance in the horizon to free it. */
  line: { ...SP_REPRO, strikeBalance: 30_000, cycleMonths: 999, pricePath: pathP1(), supportPolicy: policyFor(SUPPORT) },
  /** Six months at 1.3× support, BOTH legs over their limits at support, and no spare income to restore them. */
  ceiling: {
    ...SP_REPRO, income: 6_000, cbDebt: 50_000, strikeCollateralBtc: 0.5, strikeBalance: 20_000,
    pricePath: multiplePath([[0, 1.3], [6, 1.3]], SIX), supportPolicy: policyFor(SIX),
  },
} satisfies Record<string, CyclingInputs>;
const never = (k: keyof typeof NEVER): CyclingResult => runCyclingSim(NEVER[k]);

// ── synthetic readings (the headline's precedence is a rule over a reading, so it is pinned on readings) ──────────
const zones0 = (): Record<PolicyState, number> => ({ paused: 0, accumulate: 0, hold: 0, payDown: 0, broken: 0 });
const reading = (o: Partial<PolicyReading> = {}): PolicyReading => ({
  applied: true, zone: 'accumulate', multiple: 1.35,
  cb: { roomUsd: 41_700, roomMonths: 7, over: false }, sk: { roomUsd: 30_000, roomMonths: 5, over: false },
  brokenMonth: null, rearmMonth: null, breakCount: 0, rearmRule: DEFAULT_BREAKER_REARM_MONTHS ?? null,
  brokenAtEnd: false, call: null,
  cash: { openingUsd: 0, leftUsd: 0, toBillsUsd: 0, toCureUsd: 0 }, unpaid: null, coldAboveSupportBtc: 0,
  firstThrottleMonth: null, monthsInZone: zones0(), liqMonth: null, neverDraws: null, ...o,
});

const BROKEN_HEAD = 'Price spent two month-ends more than 10% under support in month 11 — the model is treated as broken: no new debt.';

// ── 7 · defaults ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('the settings — defaults, ranges, the re-arm', () => {
  it('the defaults are the locked decisions (frozen), the re-arm is the owner\'s 6, every range holds its default', () => {
    expect(DEFAULT_SUPPORT_POLICY_SETTINGS).toEqual({
      enabled: true, cbStopAtSupportPct: 60, strikeStopAtSupportPct: 50, accumulateBelow: 1.5, payDownAbove: 2.0,
      bearBufferMonths: 12, cashReserveMonths: 0,
    });
    expect(Object.isFrozen(DEFAULT_SUPPORT_POLICY_SETTINGS)).toBe(true);
    expect(DEFAULT_BREAKER_REARM_MONTHS).toBe(6);
    const keys = Object.keys(SUPPORT_POLICY_RANGES) as (keyof typeof SUPPORT_POLICY_RANGES)[];
    expect([...keys].sort()).toEqual(Object.keys(DEFAULT_SUPPORT_POLICY_SETTINGS).filter((k) => k !== 'enabled').sort());
    for (const k of keys) {
      expect(DEFAULT_SUPPORT_POLICY_SETTINGS[k], k).toBeGreaterThanOrEqual(SUPPORT_POLICY_RANGES[k].min);
      expect(DEFAULT_SUPPORT_POLICY_SETTINGS[k], k).toBeLessThanOrEqual(SUPPORT_POLICY_RANGES[k].max);
    }
  });

  it('…and they ARE Run 1\'s default policy — the numbers the engine gates were measured on', () => {
    const p = policyFor(SUPPORT);
    expect([p.cbStopAtSupportPct, p.strikeStopAtSupportPct, p.accumulateBelow, p.payDownAbove, p.bearBufferMonths, p.openingCashUsd])
      .toEqual([60, 50, 1.5, 2.0, 12, 0]);
  });
});

// ── 8 · effectivePolicySettings ──────────────────────────────────────────────────────────────────────────────────

describe('effectivePolicySettings — the clamp, the push, and the stops the run USES', () => {
  const ctx = { cbLtvCapPct: 70, strikeCapEffPct: 60 };
  const raw = (o: Partial<SupportPolicySettings>): SupportPolicySettings => ({ ...DEFAULT_SUPPORT_POLICY_SETTINGS, ...o });

  it('the defaults pass through unclamped', () => {
    const s = effectivePolicySettings(DEFAULT_SUPPORT_POLICY_SETTINGS, ctx);
    expect(s).toMatchObject({ ...DEFAULT_SUPPORT_POLICY_SETTINGS, cbClamped: false, skClamped: false, payDownPushed: false });
    expect(s.cbStopEffPct).toBeCloseTo(60, 12);
    expect(s.skStopEffPct).toBeCloseTo(50, 12);
  });

  it('clamps each value into its range; junk falls back to the default', () => {
    const lo = effectivePolicySettings(raw({
      cbStopAtSupportPct: 10, strikeStopAtSupportPct: 5, accumulateBelow: 0.5, payDownAbove: 0.5, bearBufferMonths: -3,
      cashReserveMonths: -1,
    }), ctx);
    expect([lo.cbStopAtSupportPct, lo.strikeStopAtSupportPct, lo.accumulateBelow, lo.payDownAbove, lo.bearBufferMonths, lo.cashReserveMonths])
      .toEqual([40, 30, 1.0, 1.5, 0, 0]);
    const hi = effectivePolicySettings(raw({
      cbStopAtSupportPct: 90, strikeStopAtSupportPct: 90, accumulateBelow: 9, payDownAbove: 9, bearBufferMonths: 99,
      cashReserveMonths: 99,
    }), ctx);
    expect([hi.cbStopAtSupportPct, hi.strikeStopAtSupportPct, hi.accumulateBelow, hi.payDownAbove, hi.bearBufferMonths, hi.cashReserveMonths])
      .toEqual([70, 60, 2.0, 3.0, 24, 12]);
    const junk = effectivePolicySettings(raw({
      cbStopAtSupportPct: Number.NaN, strikeStopAtSupportPct: Number.POSITIVE_INFINITY, accumulateBelow: Number.NaN,
      payDownAbove: Number.NaN, bearBufferMonths: Number.NaN, cashReserveMonths: Number.NaN,
    }), ctx);
    expect(junk).toMatchObject({ cbStopAtSupportPct: 60, strikeStopAtSupportPct: 50, accumulateBelow: 1.5, payDownAbove: 2.0, bearBufferMonths: 12, cashReserveMonths: 0 });
    expect(effectivePolicySettings({ ...DEFAULT_SUPPORT_POLICY_SETTINGS, enabled: false }, ctx).enabled).toBe(false);
  });

  it('pushes payDownAbove to at least accumulateBelow + 0.1, and leaves a wider gap alone', () => {
    expect(effectivePolicySettings(raw({ accumulateBelow: 1.9, payDownAbove: 1.6 }), ctx).payDownAbove).toBeCloseTo(2.0, 12);
    const edge = effectivePolicySettings(raw({ accumulateBelow: 2.0, payDownAbove: 1.5 }), ctx);
    expect(edge.payDownAbove).toBeCloseTo(2.1, 12);
    expect(edge.payDownAbove - edge.accumulateBelow).toBeGreaterThanOrEqual(PAY_DOWN_MIN_GAP - 1e-9);
    expect(effectivePolicySettings(raw({ accumulateBelow: 1.2, payDownAbove: 2.5 }), ctx).payDownAbove).toBe(2.5);
  });

  it('⭐ C3: payDownPushed is set exactly when the push moved the line — so a readout never re-derives it', () => {
    expect(effectivePolicySettings(raw({ accumulateBelow: 2.0, payDownAbove: 1.5 }), ctx).payDownPushed).toBe(true);
    expect(effectivePolicySettings(raw({ accumulateBelow: 1.9, payDownAbove: 1.6 }), ctx).payDownPushed).toBe(true);
    expect(effectivePolicySettings(raw({ accumulateBelow: 1.9, payDownAbove: 2.0 }), ctx).payDownPushed).toBe(false);   // exactly the gap
    expect(effectivePolicySettings(raw({ accumulateBelow: 1.2, payDownAbove: 2.5 }), ctx).payDownPushed).toBe(false);
  });

  it('cbClamped / skClamped are true exactly when the engine clamps — and the effective stop is the smaller one', () => {
    for (const cb of [55, 60, 65, 70]) for (const cap of [60, 70]) for (const sk of [40, 50, 55]) for (const skCap of [0, 45, 50, 66.5]) {
      const s = effectivePolicySettings(raw({ cbStopAtSupportPct: cb, strikeStopAtSupportPct: sk }), { cbLtvCapPct: cap, strikeCapEffPct: skCap });
      expect(s.cbClamped, `cb ${cb}/${cap}`).toBe(cb > cap);
      expect(s.skClamped, `sk ${sk}/${skCap}`).toBe(skCap > 0 && sk > skCap);
      expect(s.cbStopEffPct).toBeCloseTo(Math.min(cb, cap), 9);
      expect(s.skStopEffPct).toBeCloseTo(skCap > 0 ? Math.min(sk, skCap) : sk, 9);
    }
  });

  it('⭐ the readout\'s stops are the ones the engine ran — rows[1]\'s headrooms recomputed by hand', () => {
    for (const [cbStop, cap, skStop, skCap] of [[65, 60, 50, 60], [60, 70, 58, 55], [50, 70, 40, 0]] as const) {
      const s = effectivePolicySettings(raw({ cbStopAtSupportPct: cbStop, strikeStopAtSupportPct: skStop }),
        { cbLtvCapPct: cap, strikeCapEffPct: effectiveStrikeCapPct(skCap, STRIKE_MARGIN_CALL_LTV) });
      const r = runCyclingSim({
        ...SP_REPRO, cbLtvCapPct: cap, strikeLtvCapPct: skCap, pricePath: pathP2(0),
        supportPolicy: supportPolicyFor(s, SUPPORT, BILLS, 85, 'cycle'),
      });
      const x = r.rows[1];
      const cbAt = (stopPct: number): number => x.cbCollateralBtc * SUPPORT[1] * (stopPct / 100) - x.cbDebt;
      const skAt = (stopPct: number): number => x.strikeCollateralBtc * SUPPORT[1] * (stopPct / 100) - x.strikeBalance;
      expect(x.cbCeilingHeadroomUsd!).toBeCloseTo(cbAt(s.cbStopEffPct), 6);
      expect(x.strikeCeilingHeadroomUsd!).toBeCloseTo(skAt(s.skStopEffPct), 6);
      // Non-vacuous: where a stop is clamped, the REQUESTED stop describes a different run.
      if (s.cbClamped) expect(x.cbCeilingHeadroomUsd!).not.toBeCloseTo(cbAt(cbStop), 0);
      if (s.skClamped) expect(x.strikeCeilingHeadroomUsd!).not.toBeCloseTo(skAt(skStop), 0);
    }
  });
});

// ── 9 · labels ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('ZONE_LABEL / ZONE_LETTER', () => {
  it('cover every PolicyState — exhaustive over the union — with distinct letters and the spec\'s words', () => {
    const EVERY = { paused: true, accumulate: true, hold: true, payDown: true, broken: true } satisfies Record<PolicyState, true>;
    const states = Object.keys(EVERY).sort();
    expect(Object.keys(ZONE_LABEL).sort()).toEqual(states);
    expect(Object.keys(ZONE_LETTER).sort()).toEqual(states);
    expect(new Set(Object.values(ZONE_LETTER)).size).toBe(states.length);
    expect(ZONE_LABEL).toEqual({
      accumulate: 'Buy with the line', hold: 'Hold — no new debt', payDown: 'Pay down',
      paused: 'Paused — below support', broken: 'Model broken — decide again',
    });
    expect(ZONE_LETTER).toEqual({ accumulate: 'A', hold: 'H', payDown: 'D', paused: 'P', broken: 'B' });
  });
});

// ── 10 · the reading, the headline, the details ──────────────────────────────────────────────────────────────────

describe('strikeCallSummary / strikeCallSentence — one sentence for the card and the state line', () => {
  const c = { firstMonth: 18, cured: 1, sold: 0, cashUsd: 4_000, coldBtc: 0.05, soldBtc: 0 };
  it('the spec\'s two sentences', () => {
    expect(strikeCallSentence(c)).toBe('Strike margin call in month 18 — cured with $4,000 of cash and 0.0500 ₿ from cold; nothing sold.');
    expect(strikeCallSentence({ ...c, cured: 0, sold: 1, cashUsd: 0, coldBtc: 0, soldBtc: 0.1429 }))
      .toBe('Strike margin call in month 18 — 0.1429 ₿ sold to bring it back to 65%.');
  });

  it('a cure names only the sources it used; calls in several months say so; a tiny amount is never "0.0000"', () => {
    expect(strikeCallSentence({ ...c, coldBtc: 0 })).toBe('Strike margin call in month 18 — cured with $4,000 of cash; nothing sold.');
    expect(strikeCallSentence({ ...c, cashUsd: 0 })).toBe('Strike margin call in month 18 — cured with 0.0500 ₿ from cold; nothing sold.');
    expect(strikeCallSentence({ ...c, cashUsd: 0, coldBtc: 0 })).toBe('Strike margin call in month 18 — cured; nothing sold.');
    expect(strikeCallSentence({ ...c, cured: 2, sold: 1, soldBtc: 0.4 }))
      .toBe('Strike margin calls in 3 months, the first in month 18 — 0.4000 ₿ sold to bring it back to 65%.');
    expect(strikeCallSentence({ ...c, cashUsd: 0, coldBtc: 0.000002 })).toContain('0.00000200 ₿ from cold');
  });

  it('the summary reads the run\'s totals, and is null without a modelled call', () => {
    const r = callRun({ openingCashUsd: CASH_6_USD });
    expect(strikeCallSummary(r)).toEqual({
      firstMonth: 1, cured: 1, sold: 0, cashUsd: r.totalCashToCureUsd, coldBtc: 0, soldBtc: 0,
    });
    expect(strikeCallSummary(runPolicy(pathP1()))).toBeNull();
  });
});

describe('policyHeadline — ONE line, the bad tone first', () => {
  const LATCHED: Partial<PolicyReading> = { brokenMonth: 11, breakCount: 1, brokenAtEnd: true };
  const SOLD: Partial<PolicyReading> = { call: { firstMonth: 18, cured: 0, sold: 1, cashUsd: 0, coldBtc: 0, soldBtc: 0.1429 } };
  const REARMED: Partial<PolicyReading> = { brokenMonth: 11, rearmMonth: 36, breakCount: 1, brokenAtEnd: false };
  const OVER: Partial<PolicyReading> = { cb: { roomUsd: -6_300, roomMonths: 0, over: true } };
  const COLD: Partial<PolicyReading> = { coldAboveSupportBtc: 0.31 };
  const CURED: Partial<PolicyReading> = { call: { firstMonth: 18, cured: 1, sold: 0, cashUsd: 4_000, coldBtc: 0.05, soldBtc: 0 } };
  const PAUSED: Partial<PolicyReading> = { zone: 'paused', multiple: 0.94 };
  /** The order, top to bottom: latched break > sold > re-armed break > over > cold > cured > paused > zone. */
  // v1.2 #12 (a moved pin): with the faces' re-arm rule (6) a break that never re-arms in-run still STATES the rule —
  // it is not "for the rest of this run" just because this run ends first. The true-latch sentence is pinned below.
  const ORDER: [string, Partial<PolicyReading>, PolicyTone, string][] = [
    ['latched break', LATCHED, 'bad', `${BROKEN_HEAD} It re-arms after 6 months back on the line — that doesn't happen before this run ends.`],
    ['sold', SOLD, 'bad', 'Strike margin call in month 18 — 0.1429 ₿ sold to bring it back to 65%.'],
    ['re-armed break', REARMED, 'warn', `${BROKEN_HEAD} It re-arms after 6 months back on the line (month 36).`],
    ['over the limit', OVER, 'warn', 'Coinbase is $6,300 over its limit at support — spare income repays it first'],
    ['cold above support', COLD, 'warn', '0.3100 ₿ came out of cold while price was above support — the position opened over its limits.'],
    ['cured', CURED, 'warn', 'Strike margin call in month 18 — cured with $4,000 of cash and 0.0500 ₿ from cold; nothing sold.'],
    ['paused', PAUSED, 'warn', 'Paused — below support · 0.94× support'],
    ['zone', {}, 'good', 'Buy with the line · 1.35× support'],
  ];

  it('each level alone reads its own line and tone', () => {
    for (const [name, o, tone, text] of ORDER) expect(policyHeadline(reading(o), S), name).toEqual({ tone, text });
  });

  it('⭐ every adjacent pair: with both true, the higher one shows', () => {
    for (let i = 0; i < ORDER.length - 1; i++) {
      const [hi, hiO, tone, text] = ORDER[i];
      const [lo, loO] = ORDER[i + 1];
      expect(policyHeadline(reading({ ...loO, ...hiO }), S), `${hi} > ${lo}`).toEqual({ tone, text });
    }
  });

  it('⭐ the swapped pair (v1.1 #7): a sale outranks a break that later re-armed — coins actually lost come first', () => {
    expect(policyHeadline(reading({ ...REARMED, ...SOLD }), S).text).toBe(ORDER[1][3]);
    expect(policyHeadline(reading({ ...REARMED, ...SOLD }), S).tone).toBe('bad');
  });

  it('a TRUE latch (no re-arm rule) keeps "stays that way"; with one, the re-arm reads as it did', () => {
    expect(policyHeadline(reading({ ...LATCHED, rearmRule: null }), S))
      .toEqual({ tone: 'bad', text: `${BROKEN_HEAD} It stays that way for the rest of this run.` });
    expect(policyHeadline(reading({ ...REARMED, rearmRule: null }), S).text)
      .toBe(`${BROKEN_HEAD} It re-armed in month 36.`);
  });

  it('the zone tones: buy and pay down good, hold quiet; not applied (or no row) → a quiet empty line', () => {
    expect(policyHeadline(reading({ zone: 'hold', multiple: 1.62 }), S)).toEqual({ tone: 'quiet', text: 'Hold — no new debt · 1.62× support' });
    expect(policyHeadline(reading({ zone: 'payDown', multiple: 2.31 }), S)).toEqual({ tone: 'good', text: 'Pay down · 2.31× support' });
    expect(policyHeadline(reading({ applied: false }), S)).toEqual({ tone: 'quiet', text: '' });
    expect(policyHeadline(reading({ zone: null, multiple: null }), S)).toEqual({ tone: 'quiet', text: '' });
  });

  it('a break that later broke again says so — and whether it ends broken', () => {
    expect(policyHeadline(reading({ ...REARMED, breakCount: 2, brokenAtEnd: true }), S)).toEqual({
      tone: 'bad', text: `${BROKEN_HEAD} It re-arms after 6 months back on the line (month 36). It broke 2 times in all and stays broken to the end of this run.`,
    });
    expect(policyHeadline(reading({ ...REARMED, breakCount: 2 }), S).text)
      .toBe(`${BROKEN_HEAD} It re-arms after 6 months back on the line (month 36). It broke 2 times in all.`);
  });

  it('Strike alone over its limit repays first; with Coinbase also over, it repays after Coinbase', () => {
    const skOver = { roomUsd: -2_000, roomMonths: 0, over: true };
    expect(policyHeadline(reading({ sk: skOver }), S).text).toBe('Strike is $2,000 over its limit at support — spare income repays it first');
    expect(policyDetails(reading({ ...OVER, sk: skOver }), S)[1]).toBe('Strike is $2,000 over its limit at support — spare income repays it after Coinbase');
  });
});

describe('policyDetails — the card\'s lines, in a fixed order', () => {
  it('room (CB, Strike), breaker, call, cash, unpaid, then the cold alarm — the spec\'s sentences', () => {
    const r = reading({
      brokenMonth: 11, rearmMonth: 36, breakCount: 1,
      call: { firstMonth: 18, cured: 1, sold: 0, cashUsd: 4_000, coldBtc: 0.05, soldBtc: 0 },
      cash: { openingUsd: 36_000, leftUsd: 12_000, toBillsUsd: 20_000, toCureUsd: 4_000 },
      unpaid: { firstMonth: 12, totalUsd: 72_000, zone: 'paused' },
      coldAboveSupportBtc: 0.31,
    });
    expect(policyDetails(r, S)).toEqual([
      'Coinbase: $41,700 of room at support — 7 months of bills',
      'Strike: $30,000 of room at support',
      `${BROKEN_HEAD} It re-arms after 6 months back on the line (month 36).`,
      'Strike margin call in month 18 — cured with $4,000 of cash and 0.0500 ₿ from cold; nothing sold.',
      'Cash reserve: $12,000 left of $36,000 ($20,000 paid bills, $4,000 cured a Strike call).',
      "From month 12, $72,000 of bills went unpaid — the policy won't borrow below support. A larger cash reserve would cover them.",
      '0.3100 ₿ came out of cold while price was above support — the position opened over its limits.',
    ]);
  });

  it('the minimal card: the two rooms and the cold PROMISE; the spec\'s cash line; nothing when not applied', () => {
    expect(policyDetails(reading(), S)).toEqual([
      'Coinbase: $41,700 of room at support — 7 months of bills',
      'Strike: $30,000 of room at support',
      'Cold is never touched while price is at or above support.',
    ]);
    expect(policyDetails(reading({ cash: { openingUsd: 36_000, leftUsd: 12_000, toBillsUsd: 24_000, toCureUsd: 0 } }), S))
      .toContain('Cash reserve: $12,000 left of $36,000 ($24,000 paid bills).');
    expect(policyDetails(reading({ applied: false }), S)).toEqual([]);
  });

  it('room edge cases: under a month, one month, no months line without bills, and dust reads "at its limit"', () => {
    expect(policyDetails(reading({ cb: { roomUsd: 2_000, roomMonths: 0, over: false } }), S)[0]).toBe('Coinbase: $2,000 of room at support — under a month of bills');
    expect(policyDetails(reading({ cb: { roomUsd: 6_000, roomMonths: 1, over: false } }), S)[0]).toBe('Coinbase: $6,000 of room at support — 1 month of bills');
    expect(policyDetails(reading({ cb: { roomUsd: 6_000, roomMonths: null, over: false } }), S)[0]).toBe('Coinbase: $6,000 of room at support');
    expect(policyDetails(reading({ cb: { roomUsd: 0.3, roomMonths: 0, over: false } }), S)[0]).toBe('Coinbase: at its limit at support');
  });

  it('the unpaid line names the cause of the FIRST unpaid month — "below support" is true only of a paused one', () => {
    const line = (zone: PolicyState | null): string =>
      policyDetails(reading({ unpaid: { firstMonth: 5, totalUsd: 12_000, zone } }), S).find((l) => l.startsWith('From month'))!;
    expect(line('paused')).toBe("From month 5, $12,000 of bills went unpaid — the policy won't borrow below support. Set a cash reserve to cover them.");
    expect(line('broken')).toContain("the policy won't borrow while the model is treated as broken.");
    expect(line('hold')).toContain('the policy takes on no new debt above the buy zone.');
    expect(line('payDown')).toContain('the policy takes on no new debt above the buy zone.');
    expect(line('accumulate')).toContain("the credit line and the limits at support couldn't cover them.");
    expect(line(null)).toContain('nothing in the model paid them.');
  });
});

describe('policyReading on Run 1\'s own fixtures', () => {
  it('the opening on the line reads "Buy with the line · 1.00× support" from month 1 (the device gate\'s view)', () => {
    const r = runPolicy(pathP1());
    expect(policyHeadline(read(r, 1), S)).toEqual({ tone: 'good', text: 'Buy with the line · 1.00× support' });
  });

  it('the over-ceiling restore fixture: both legs over, Coinbase repaid first', () => {
    const r = runPolicy(pathP1(), {}, RESTORE_OPENING);
    const rd = read(r, 1);
    expect(rd.cb!.over).toBe(true);
    expect(rd.sk!.over).toBe(true);
    expect(policyHeadline(rd, S)).toEqual({
      tone: 'warn', text: `Coinbase is ${fmtUSD(-rd.cb!.roomUsd)} over its limit at support — spare income repays it first`,
    });
    expect(policyDetails(rd, S)[1]).toBe(`Strike is ${fmtUSD(-rd.sk!.roomUsd)} over its limit at support — spare income repays it after Coinbase`);
    expect(policyDetails(rd, S).at(-1)).toBe('Cold is never touched while price is at or above support.');
  });

  it('⭐ P6: a latched break reads bad; the same break re-armed at 6 reads warn (v1.1 #2)', () => {
    const latched = runPolicy(pathP6());
    const rearmed = runPolicy(pathP6(), { breakerRearmMonths: DEFAULT_BREAKER_REARM_MONTHS });
    expect([latched.modelBrokenMonth, latched.firstRearmMonth, rearmed.modelBrokenMonth, rearmed.firstRearmMonth]).toEqual([11, null, 11, 35]);
    expect(read(latched, 20).brokenAtEnd).toBe(true);
    expect(read(rearmed, 20).brokenAtEnd).toBe(false);
    // This fixture runs with NO re-arm rule; a reading states the faces' rule, so a true latch says so (moved pin).
    expect(policyHeadline({ ...read(latched, 20), rearmRule: null }, S))
      .toEqual({ tone: 'bad', text: `${BROKEN_HEAD} It stays that way for the rest of this run.` });
    expect(policyHeadline(read(rearmed, 20), S)).toEqual({
      tone: 'warn', text: `${BROKEN_HEAD} It re-arms after 6 months back on the line (month 35).`,
    });
  });

  it('⭐ v1.2 #12: a run given the re-arm that ends broken STATES the rule — it never fires before the run ends', () => {
    // Breaks at 0.6× support and never climbs back: the 6-month rule is set, it just has no six months to count.
    const r = runPolicy(multiplePath([[0, 1.35], [12, 0.6], [72, 0.6]]), { breakerRearmMonths: DEFAULT_BREAKER_REARM_MONTHS });
    expect(r.modelBrokenMonth).not.toBeNull();
    expect(r.firstRearmMonth).toBeNull();
    const rd = read(r, 40);
    expect(rd.brokenAtEnd).toBe(true);
    const head = `Price spent two month-ends more than 10% under support in month ${r.modelBrokenMonth} — the model is treated as broken: no new debt.`;
    expect(policyHeadline(rd, S)).toEqual({
      tone: 'bad', text: `${head} It re-arms after 6 months back on the line — that doesn't happen before this run ends.`,
    });
    expect(policyDetails(rd, S)).toContain(policyHeadline(rd, S).text);
    expect(policyHeadline(rd, S).text).not.toContain('It stays that way');
  });

  it('the cured and the sold call fixtures — the call line and the cash line', () => {
    const cured = callRun({ openingCashUsd: CASH_6_USD });
    const cd = policyDetails(read(cured, 1), S);
    expect(cd).toContain(`Strike margin call in month 1 — cured with ${fmtUSD(cured.totalCashToCureUsd)} of cash; nothing sold.`);
    expect(cd).toContain(`Cash reserve: ${fmtUSD(cured.cashLeftUsd)} left of $36,000 (${fmtUSD(cured.totalCashToCureUsd)} cured a Strike call).`);
    const coldCured = callRun({}, { strikeLtvCapPct: 0, openingColdBtc: 1 });
    expect(policyDetails(read(coldCured, 1), S))
      .toContain(`Strike margin call in month 1 — cured with ${coldCured.totalStrikeCureColdBtc.toFixed(4)} ₿ from cold; nothing sold.`);
    const sold = callRun();
    expect(policyDetails(read(sold, 1), S))
      .toContain(`Strike margin call in month 1 — ${sold.totalStrikeLiquidatedBtc.toFixed(4)} ₿ sold to bring it back to 65%.`);
    // This fixture also breaks the model at month 2 and stays below — the latched break outranks the sale.
    expect(policyHeadline(read(sold, 1), S).tone).toBe('bad');
    expect(policyHeadline(read(sold, 1), S).text).toContain('the model is treated as broken');
  });

  it('⭐ P7 with cash 0 and cash 6 — the unpaid line, the cash line, and the paused headline', () => {
    const cases = a5Cases();
    const c0 = runCyclingSim(cases.find((c) => c.name === 'P7 (cash 0)')!.on);
    const c6 = runCyclingSim(cases.find((c) => c.name === 'P7 (cash 6)')!.on);
    expect(policyDetails(read(c0, 12), S)).toContain(
      "From month 12, $72,000 of bills went unpaid — the policy won't borrow below support. Set a cash reserve to cover them.");
    const d6 = policyDetails(read(c6, 12), S);
    expect(d6).toContain('Cash reserve: $0 left of $36,000 ($36,000 paid bills).');
    expect(d6).toContain("From month 18, $36,000 of bills went unpaid — the policy won't borrow below support. A larger cash reserve would cover them.");
    expect(policyHeadline(read(c0, 12), S)).toEqual({ tone: 'warn', text: 'Paused — below support · 0.92× support' });
  });

  it('the cold-alarm fixture (G2\'s over-ceiling opening): the alarm replaces the promise', () => {
    const r = runPolicy(pathP1(), {}, OVER_CEILING_COLD_OPENING);
    expect(r.coldRetrievedAboveSupportBtc).toBeGreaterThan(0);
    const rd = read(r, 1);
    expect(policyDetails(rd, S).at(-1)).toBe(
      `${r.coldRetrievedAboveSupportBtc.toFixed(4)} ₿ came out of cold while price was above support — the position opened over its limits.`);
    expect(policyHeadline(rd, S).text).toContain('over its limit at support');   // over outranks the cold alarm
  });

  it('⭐ roomMonths is null when bills are ≤ 0 or not a number — never "Infinity months" (v1.1 #3)', () => {
    const r = runPolicy(pathP1());
    expect(read(r, 1).cb!.roomMonths).toBe(Math.round(r.rows[1].cbCeilingHeadroomUsd! / BILLS));
    for (const bills of [0, -500, Number.NaN, Number.POSITIVE_INFINITY]) {
      const rd = policyReading(r, 1, bills);
      expect(rd.cb!.roomMonths, `${bills}`).toBeNull();
      expect(rd.sk!.roomMonths, `${bills}`).toBeNull();
      const text = policyDetails(rd, S).join(' ');
      expect(text).not.toMatch(/Infinity|NaN|months of bills/);
    }
  });

  it('the spec\'s room example: $41,700 at $6,000 of bills reads 7 months', () => {
    const r = runPolicy(pathP1());
    const sim: CyclingResult = { ...r, rows: r.rows.map((x) => (x.m === 1 ? { ...x, cbCeilingHeadroomUsd: 41_700 } : x)) };
    expect(policyDetails(policyReading(sim, 1, 6_000), S)[0]).toBe('Coinbase: $41,700 of room at support — 7 months of bills');
  });

  it('float dust over the limit (a ceiling-capped refinance leaves ~1e-10) is "at its limit", never "$0 over"', () => {
    const r = runPolicy(pathP1());
    const dust: CyclingResult = { ...r, rows: r.rows.map((x) => (x.m === 1 ? { ...x, cbCeilingHeadroomUsd: -1e-10 } : x)) };
    const rd = policyReading(dust, 1, BILLS);
    expect(rd.cb).toEqual({ roomUsd: 0, roomMonths: 0, over: false });
    expect(policyDetails(rd, S)[0]).toBe('Coinbase: at its limit at support');
    const real: CyclingResult = { ...r, rows: r.rows.map((x) => (x.m === 1 ? { ...x, cbCeilingHeadroomUsd: -1 } : x)) };
    expect(policyReading(real, 1, BILLS).cb!.over).toBe(true);   // a real dollar over is over
  });

  it('policy off → a neutral reading (every renderer then says nothing)', () => {
    const rd = read(runCyclingSim({ ...SP_REPRO, pricePath: pathP2(0) }), 5);
    expect(rd).toMatchObject({ applied: false, zone: null, cb: null, sk: null, call: null, unpaid: null, neverDraws: null });
    expect(neverDrawsNote(rd, S)).toBe('');
  });
});

// ── neverDraws — TOTAL and TRUE (v1.1 #1, #6) ────────────────────────────────────────────────────────────────────

describe('neverDraws — every run that applies the policy and never draws gets a TRUE reason', () => {
  it('the five kinds and their sentences, one fixture each', () => {
    const note = (r: CyclingResult): [NeverDraws | null, string] => {
      const rd = read(r, 1);
      return [rd.neverDraws, neverDrawsNote(rd, S)];
    };
    expect(note(never('zone'))).toEqual(['zone', 'Price never comes back to 1.5× support or below on this path, so the policy never borrows.']);
    expect(note(never('zoneMixed'))).toEqual(['zone',
      "The policy's buy zone — support to 1.5× support — never opens on this path, so the policy never borrows."]);
    expect(note(never('ceiling'))).toEqual(['ceiling',
      "The buy zone comes, but the limits at support (or Strike's own line) never leave room to borrow on this path, so the policy never borrows."]);
    expect(note(never('line'))).toEqual(['line', "Strike's line has no room to draw, so the bills come from income."]);
    // Paused all run (no break) → the owner's sentence; paused then broken → the variant that names the break.
    const p8 = runCyclingSim(a5Cases().find((c) => c.name === 'P8 · P1 on b 5.63')!.on);
    expect(note(p8)).toEqual(['belowSupport', 'Price stays under support on this path, so the policy never borrows.']);
    expect(note(callRun())).toEqual(['belowSupport',
      'Price stays under support, or the model stays broken, for this whole path, so the policy never borrows.']);
  });

  it('⭐ liquidated: a month-0 breach "starts past its liquidation line" — never "in month 0" (v1.1 #6)', () => {
    const cells = reachGrid();
    const atOpening = runCyclingSim({ ...cells[0].off, supportPolicy: policyFor(cells[0].support) });
    expect(atOpening.liqMonth).toBe(0);
    const rd = read(atOpening, 0);
    expect(rd.neverDraws).toBe('liquidated');
    expect(neverDrawsNote(rd, S)).toBe('Coinbase starts this scenario past its liquidation line, so the policy never borrows.');
    const later = cells.map((c) => runCyclingSim({ ...c.off, supportPolicy: policyFor(c.support) }))
      .find((r) => r.firstDrawMonth === null && r.liqMonth !== null && r.liqMonth > 0)!;
    expect(later).toBeDefined();
    expect(neverDrawsNote(read(later, 0), S)).toBe(`Coinbase is liquidated in month ${later.liqMonth}, before the policy ever borrows.`);
  });

  it('null whenever the run draws, or the policy is off', () => {
    expect(read(runPolicy(pathP1()), 1).neverDraws).toBeNull();
    expect(read(runCyclingSim({ ...NEVER.zone, supportPolicy: undefined }), 1).neverDraws).toBeNull();
  });

  it('⭐ exhaustive: every A5 path (cash 0 and 6) and every grid cell, latched and re-arm 6 — non-null and TRUE', () => {
    const kinds: Partial<Record<NeverDraws, number>> = {};
    let atOpening = 0;
    let mixed = 0;
    const check = (name: string, inputs: CyclingInputs): void => {
      const r = runCyclingSim(inputs);
      if (!r.policyApplied || r.firstDrawMonth !== null) return;
      const rd = policyReading(r, 0, inputs.expenses);
      const kind = rd.neverDraws;
      expect(kind, name).not.toBeNull();
      expect(neverDrawsNote(rd, S), name).not.toBe('');
      kinds[kind!] = (kinds[kind!] ?? 0) + 1;
      const states = r.rows.slice(1).map((x) => x.policyZone);
      switch (kind) {
        case 'liquidated':
          expect(r.liqMonth, name).not.toBeNull();
          if (r.liqMonth === 0) atOpening++;
          break;
        case 'belowSupport':
          expect(states.every((z) => z === 'paused' || z === 'broken'), name).toBe(true);
          break;
        case 'zone':
          expect(states.includes('accumulate'), name).toBe(false);
          expect(states.some((z) => z === 'hold' || z === 'payDown'), name).toBe(true);
          break;
        case 'ceiling':
        case 'line': {
          // Strike's OWN capacity at each buy-zone month's decision, recomputed from the inputs and the month before.
          const caps = r.rows.slice(1).filter((x) => x.policyZone === 'accumulate').map((x) => {
            const prev = r.rows[x.m - 1];
            return Math.max(0, Math.min(inputs.strikeCreditLine, prev.strikeCollateralBtc * x.price * inputs.strikeMaxDrawLtv) - prev.strikeBalance);
          });
          expect(caps.length, name).toBeGreaterThan(0);
          if (kind === 'line') expect(caps.every((c) => c === 0), name).toBe(true);
          else {
            expect(caps.some((c) => c > 0), name).toBe(true);   // a limit — not the line — blocked a month with line room
            if (caps.some((c) => c === 0)) mixed++;
          }
        }
      }
    };
    const rearm = (i: CyclingInputs): CyclingInputs =>
      ({ ...i, supportPolicy: { ...i.supportPolicy!, breakerRearmMonths: DEFAULT_BREAKER_REARM_MONTHS } });
    for (const c of a5Cases()) {
      const cash6: CyclingInputs = { ...c.on, supportPolicy: { ...c.on.supportPolicy!, openingCashUsd: CASH_6_USD } };
      for (const i of [c.on, cash6]) { check(c.name, i); check(`${c.name} · re-arm`, rearm(i)); }
    }
    for (const [grid, cells] of [['face-world', faceWorldGrid()], ['synthetic', syntheticGrid()], ['reach', reachGrid()]] as const) {
      cells.forEach((cell, i) => {
        const on: CyclingInputs = { ...cell.off, supportPolicy: policyFor(cell.support) };
        check(`${grid} #${i}`, on);
        check(`${grid} #${i} · re-arm`, rearm(on));
      });
    }
    for (const [name, inputs] of Object.entries(NEVER)) check(name, inputs);
    // Non-vacuous: every kind occurs, including a month-0 breach and ceiling runs where the line also blocked.
    for (const k of ['liquidated', 'ceiling', 'belowSupport', 'zone', 'line'] as const) expect(kinds[k] ?? 0, k).toBeGreaterThan(0);
    expect(atOpening).toBeGreaterThan(0);
    expect(mixed).toBeGreaterThan(0);   // why the ceiling sentence also names Strike's own line
  });
});


// ── 11 · policyPauseReason ───────────────────────────────────────────────────────────────────────────────────────

describe('policyPauseReason — the real reason a month did not borrow', () => {
  const p2 = runPolicy(pathP2(0));
  const hold = { ...firstRow(p2, 'hold'), multiple: 1.62 };
  const payDown = { ...firstRow(p2, 'payDown'), multiple: 2.31 };
  const paused = { ...firstRow(runPolicy(pathP4()), 'paused'), multiple: 0.94 };
  const broken = firstRow(runPolicy(pathP6()), 'broken');
  const blocked = runPolicy(pathP1(), {}, RESTORE_OPENING).rows[1];   // buy zone, no room, $2,000 of restore

  it('one sentence per zone — the spec\'s words', () => {
    expect(policyPauseReason(hold, S, BILLS)).toBe('Price is 1.62× support — above the 1.5× buy zone, so no new debt: your paycheck pays the bills.');
    expect(policyPauseReason({ ...payDown, payDownUsd: 2_000 }, S, BILLS))
      .toBe('Price is 2.31× support — above 2×, so spare income pays debt down ($2,000 this month) before buying.');
    expect(policyPauseReason(paused, S, BILLS)).toBe('Price is under support (0.94×) — the policy borrows nothing until it is back on the line.');
    expect(policyPauseReason(broken, S, BILLS)).toBe('The model is treated as broken — no new debt.');
    // The row cannot say whether a limit or Strike's own line bound, so the sentence names both.
    expect(policyPauseReason({ ...blocked, restoreUsd: 0 }, S, BILLS))
      .toBe("The limits at support (or Strike's own line) leave no room to borrow this month, so your paycheck pays the bills.");
  });

  it('pay down with nothing paid: "nothing was left for it" with debt left, "no debt left" without — never "($0 this month)"', () => {
    expect(payDown.debt).toBeGreaterThan(0);
    // v1.2 #10 (a moved pin): "(there was none this month)" read as "no debt" in a sentence that exists because there IS.
    expect(policyPauseReason({ ...payDown, payDownUsd: 0 }, S, BILLS))
      .toBe('Price is 2.31× support — above 2×, so spare income pays debt down before buying (nothing was left for it this month).');
    expect(policyPauseReason({ ...payDown, payDownUsd: 0, restoreUsd: 1_200 }, S, BILLS))
      .toBe('Price is 2.31× support — above 2×, so spare income pays debt down before buying (nothing was left for it this month). '
        + '$1,200 of spare income repaid a loan over its limit first.');
    expect(policyPauseReason({ ...payDown, payDownUsd: 0, debt: 0 }, S, BILLS))
      .toBe("Price is 2.31× support — above 2×, and there's no debt left to pay down, so spare income buys.");
  });

  it('the restore / cash / unpaid suffixes, in that order — and the paycheck "pays what it can" when it did not cover', () => {
    expect(policyPauseReason({ ...blocked, restoreUsd: 1_200 }, S, BILLS))
      .toBe("The limits at support (or Strike's own line) leave no room to borrow this month, so your paycheck pays the bills. $1,200 of spare income repaid a loan over its limit first.");
    expect(policyPauseReason({ ...hold, cashToBillsUsd: 2_000 }, S, BILLS))
      .toBe('Price is 1.62× support — above the 1.5× buy zone, so no new debt: your paycheck pays what it can. Your cash reserve paid $2,000 of bills.');
    expect(policyPauseReason({ ...hold, unfundedUsd: 2_000 }, S, BILLS))
      .toBe('Price is 1.62× support — above the 1.5× buy zone, so no new debt: your paycheck pays what it can. $2,000 of bills went unpaid.');
    expect(policyPauseReason({ ...blocked, restoreUsd: 1_200, cashToBillsUsd: 2_000, unfundedUsd: 1_000 }, S, BILLS))
      .toBe("The limits at support (or Strike's own line) leave no room to borrow this month, so your paycheck pays what it can. "
        + '$1,200 of spare income repaid a loan over its limit first. Your cash reserve paid $2,000 of bills. $1,000 of bills went unpaid.');
    // Float dust (a ceiling-capped refinance leaves ~1e-10 over the limit) is never a sentence.
    expect(policyPauseReason({ ...hold, restoreUsd: 1e-10 }, S, BILLS)).toBe(policyPauseReason(hold, S, BILLS));
  });

  it('⭐ v1.2 #9: no bills is not a pause — null in every zone at bills ≤ 0 (the faces print noBillsNote)', () => {
    const rows = { hold, payDown, paused, broken, blocked };
    for (const [name, row] of Object.entries(rows)) {
      expect(policyPauseReason(row, S, BILLS), `${name} with bills`).not.toBeNull();   // non-vacuous
      for (const bills of [0, -500, Number.NaN]) expect(policyPauseReason(row, S, bills), `${name} at ${bills}`).toBeNull();
    }
    // …and against the engine: at $0 of bills the policy's "drawing" month draws $0, which is where the old copy lied.
    const noBills = runPolicy(pathP1(), {}, { expenses: 0 });
    const r1 = noBills.rows[1];
    expect([r1.policyZone, r1.strikeDrawn]).toEqual(['accumulate', 0]);
    expect(policyPauseReason(r1, S, 0)).toBeNull();
  });

  it('C1b: billsRemainderTail IS the pause reason\'s tail — one definition, byte-identical', () => {
    const cases = [{ ...hold, cashToBillsUsd: 2_000 }, { ...hold, unfundedUsd: 2_000 }, { ...blocked, cashToBillsUsd: 2_000, unfundedUsd: 1_000 }];
    for (const row of cases) {
      const tail = billsRemainderTail(row);
      expect(tail).not.toBe('');
      expect(policyPauseReason(row, S, BILLS)!.endsWith(tail)).toBe(true);
    }
    expect(billsRemainderTail({ cashToBillsUsd: 2_000, unfundedUsd: 1_000 })).toBe(' Your cash reserve paid $2,000 of bills. $1,000 of bills went unpaid.');
    expect(billsRemainderTail({ cashToBillsUsd: 0.4, unfundedUsd: 0.49 })).toBe('');   // dust is never a sentence
  });

  it('null on a drawing row, with the policy off, and at month 0; the loop\'s end after a liquidation', () => {
    const drew = runPolicy(pathP1()).rows[1];
    expect(drew.strikeDrawn).toBeGreaterThan(0);
    expect(policyPauseReason(drew, S, BILLS)).toBeNull();
    expect(policyPauseReason(runCyclingSim({ ...SP_REPRO, pricePath: pathP2(0) }).rows[20], S, BILLS)).toBeNull();
    expect(policyPauseReason(p2.rows[0], S, BILLS)).toBeNull();
    const cell = reachGrid()[0];
    const liq = runCyclingSim({ ...cell.off, supportPolicy: policyFor(cell.support) });
    expect(liq.rows[1].postLiquidation).toBe(true);
    // The seizure left a deficiency over the Coinbase limit, so the month's spare income repaid it — true, and said.
    expect(policyPauseReason(liq.rows[1], S, BILLS)).toBe(
      'Coinbase has been liquidated — the policy borrows nothing more. $2,000 of spare income repaid a loan over its limit first.');
  });
});

// ── 12 · drawPauseClause ─────────────────────────────────────────────────────────────────────────────────────────

describe('drawPauseClause — the verdict\'s pause clause', () => {
  const clause = (stopMonth: number | null, resumed: number | null, applied: boolean, zone: PolicyState | null = null) =>
    ({ stopMonth, drawingResumedMonth: resumed, policyApplied: applied, rows: Array.from({ length: 50 }, () => ({ policyZone: zone })) });

  it('⭐ policy off: today\'s exact strings, pinned from CyclingFace / UnifiedFace', () => {
    expect(drawPauseClause(clause(7, null, false), S)).toBe(' · drawing stopped at month 7');
    expect(drawPauseClause(clause(7, 12, false), S)).toBe(' · drawing paused at month 7, resumed at 12');
    expect(drawPauseClause(clause(null, null, false), S)).toBe('');
    expect(drawPauseClause(clause(7, 12, true, 'hold'), null)).toBe(' · drawing paused at month 7, resumed at 12');
    // Against the engine: the faces' own template, verbatim.
    const r = runCyclingSim({ ...SP_REPRO, cbLtvCapPct: 50, pricePath: pathP2(0) });
    expect(r.stopMonth).not.toBeNull();
    const faces = r.drawingResumedMonth === null
      ? ` · drawing stopped at month ${r.stopMonth}`
      : ` · drawing paused at month ${r.stopMonth}, resumed at ${r.drawingResumedMonth}`;
    expect(drawPauseClause(r, S)).toBe(faces);
  });

  it('policy on: the zone that stopped the borrowing — the spec\'s example is P2 exactly', () => {
    expect(drawPauseClause(runPolicy(pathP2(0)), S)).toBe(' · borrowing paused at month 12 (price above 1.5× support), resumed at 40');
    expect(drawPauseClause(clause(8, null, true, 'paused'), S)).toBe(' · borrowing stopped at month 8 (price under support)');
    expect(drawPauseClause(clause(8, 35, true, 'broken'), S)).toBe(' · borrowing paused at month 8 (model treated as broken), resumed at 35');
    expect(drawPauseClause(clause(1, 12, true, 'accumulate'), S)).toBe(' · borrowing paused at month 1 (no room to borrow), resumed at 12');
    expect(drawPauseClause(clause(21, null, true, 'payDown'), S)).toBe(' · borrowing stopped at month 21 (price above 1.5× support)');
  });
});

// ── 16 · the strip, the chart line, the cold gate ────────────────────────────────────────────────────────────────

describe('zoneStrip / policyLimitPct / coldShown', () => {
  it('zoneStrip: one cell per month (m0..N); counts over m ≥ 1 ARE the engine\'s and sum to the horizon', () => {
    const r = runPolicy(pathP2(0));
    const strip = zoneStrip(r.rows);
    expect(strip.zones).toHaveLength(r.rows.length);
    expect(strip.zones[0]).toBe(r.rows[0].policyZone);
    expect(strip.counts).toEqual(r.monthsInZone);
    expect(Object.values(strip.counts).reduce((a, b) => a + b, 0)).toBe(SP_MONTHS);
    expect(zoneStrip(runCyclingSim({ ...SP_REPRO, pricePath: pathP2(0) }).rows))
      .toEqual({ zones: [], counts: { paused: 0, accumulate: 0, hold: 0, payDown: 0, broken: 0 } });
  });

  it('policyLimitPct: flat at the stop on the support line, half at 2×, null without a multiple', () => {
    const rows = runPolicy(pathP1()).rows;
    for (const x of rows.slice(1)) expect(policyLimitPct(x, S.cbStopEffPct)).toBe(S.cbStopEffPct);   // multiple exactly 1
    expect(S.cbStopEffPct).toBeCloseTo(60, 12);
    expect(policyLimitPct({ multiple: 2 }, 60)).toBe(30);
    expect(policyLimitPct({ multiple: null }, 60)).toBeNull();
    expect(policyLimitPct({ multiple: 0 }, 60)).toBeNull();
    expect(policyLimitPct({ multiple: Number.NaN }, 60)).toBeNull();
  });

  it('coldShown: the classic sweep on, or the policy\'s own sweep running', () => {
    expect(coldShown(0, { policyApplied: false })).toBe(false);
    expect(coldShown(30, { policyApplied: false })).toBe(true);
    expect(coldShown(0, { policyApplied: true })).toBe(true);
  });
});

// ── layering — the §2 wall and the one-way import between the two view modules ────────────────────────────────

describe('layering: the support path is built in ONE place; the view modules import no belief', () => {
  const src = (f: string): string => readFileSync(join(process.cwd(), 'src/components/Almanac', f), 'utf8');
  const imports = (f: string): string[] => src(f).split('\n').filter((l) => /^import\b/.test(l) || /^\} from /.test(l));

  it('supportPolicyView / cyclingFaceView / ownershipFaceView import nothing from powerLaw, cyclePath, cycleModel, the store or React', () => {
    for (const f of ['supportPolicyView.ts', 'cyclingFaceView.ts', 'ownershipFaceView.ts']) {
      const lines = imports(f);
      expect(lines.length, f).toBeGreaterThan(0);
      for (const l of lines) expect(l, f).not.toMatch(/powerLaw|cyclePath|cycleModel|\/store\/|'react'/);
    }
  });

  it('supportPolicyView never imports cyclingFaceView (that module imports it — one direction only)', () => {
    expect(imports('supportPolicyView.ts').join('\n')).not.toMatch(/cyclingFaceView/);
    expect(imports('cyclingFaceView.ts').join('\n')).toMatch(/supportPolicyView/);
  });

  it('supportPolicyInputs.ts is the only non-test module here that builds a support path from the power law', () => {
    expect(src('supportPolicyInputs.ts')).toMatch(/plBandAt\('floor'/);
    for (const f of ['supportPolicyView.ts', 'cyclingFaceView.ts', 'ownershipFaceView.ts']) {
      expect(src(f), f).not.toMatch(/plBandAt|plConvergencePath|plBandsAt/);
    }
  });
});

// ── Run 2b — the card's copy and the faces' policy notes ─────────────────────────────────────────────────────────

describe('the one dust floor, and the stop formatter', () => {
  it('DUST_USD is $0.50: below it a figure is never a sentence; junk is never shown', () => {
    expect(DUST_USD).toBe(0.5);
    expect([shownUsd(0.49), shownUsd(0.5), shownUsd(Number.NaN), shownUsd(Number.POSITIVE_INFINITY)]).toEqual([false, true, false, false]);
  });

  it('fmtPolicyPct trims float residue and keeps a real half point', () => {
    expect([fmtPolicyPct(0.55 * 100), fmtPolicyPct(60), fmtPolicyPct(66.5)]).toEqual(['55', '60', '66.5']);
  });
});

describe('⭐ policyUnpaidNote — ONE sentence for the card and the constraints slot (v1.2 #8)', () => {
  it('equals the unpaid line inside policyDetails; null with nothing unpaid, and on dust', () => {
    const c0 = runCyclingSim(a5Cases().find((c) => c.name === 'P7 (cash 0)')!.on);
    const rd = read(c0, 12);
    const note = policyUnpaidNote(rd);
    expect(note).toBe("From month 12, $72,000 of bills went unpaid — the policy won't borrow below support. Set a cash reserve to cover them.");
    expect(policyDetails(rd, S)).toContain(note);
    expect(policyUnpaidNote(read(runPolicy(pathP1()), 1))).toBeNull();
    expect(policyUnpaidNote(reading({ unpaid: { firstMonth: 3, totalUsd: 0.3, zone: 'paused' } }))).toBeNull();
  });
});

describe('policyAlert — the headline for a face\'s alert slot: warn / bad only, the call left to strikeCapNote', () => {
  const SOLD = { call: { firstMonth: 18, cured: 0, sold: 1, cashUsd: 0, coldBtc: 0, soldBtc: 0.1429 } };
  const CURED = { call: { firstMonth: 18, cured: 1, sold: 0, cashUsd: 4_000, coldBtc: 0, soldBtc: 0 } };
  const REARMED = { brokenMonth: 11, rearmMonth: 36, breakCount: 1, brokenAtEnd: false };

  it('a sale or a cure alone raises no alert — the cap note already says it; what ranks below still shows', () => {
    expect(policyAlert(reading(SOLD), S)).toBeNull();
    expect(policyAlert(reading(CURED), S)).toBeNull();
    expect(policyAlert(reading({ ...REARMED, ...SOLD }), S))
      .toEqual({ tone: 'warn', text: `${BROKEN_HEAD} It re-arms after 6 months back on the line (month 36).` });
    expect(policyAlert(reading({ ...CURED, cb: { roomUsd: -6_300, roomMonths: 0, over: true } }), S))
      .toEqual({ tone: 'warn', text: 'Coinbase is $6,300 over its limit at support — spare income repays it first' });
  });

  it('warn and bad pass through; a good or quiet zone, and a policy that is off, raise nothing', () => {
    expect(policyAlert(reading({ brokenMonth: 11, breakCount: 1, brokenAtEnd: true }), S)!.tone).toBe('bad');
    expect(policyAlert(reading({ zone: 'paused', multiple: 0.94 }), S)).toEqual({ tone: 'warn', text: 'Paused — below support · 0.94× support' });
    expect(policyAlert(reading(), S)).toBeNull();
    expect(policyAlert(reading({ zone: 'hold', multiple: 1.62 }), S)).toBeNull();
    expect(policyAlert(reading({ applied: false }), S)).toBeNull();
  });
});

describe('policyStopSentence — Ownership\'s verdict when the policy stopped borrowing', () => {
  it('P2: the zone, as a sentence — the pause clause\'s reason', () => {
    expect(policyStopSentence(runPolicy(pathP2(0)), S))
      .toBe('Borrowing pauses in month 12 (price above 1.5× support) and runs again from month 40.');
  });

  it('a stop that never resumes; the policy off, or no stop, says nothing', () => {
    const rows = Array.from({ length: 20 }, () => ({ policyZone: 'paused' as PolicyState }));
    expect(policyStopSentence({ stopMonth: 8, drawingResumedMonth: null, policyApplied: true, rows }, S))
      .toBe("Borrowing stops in month 8 (price under support) and doesn't resume on this path.");
    expect(policyStopSentence({ stopMonth: 8, drawingResumedMonth: null, policyApplied: false, rows }, S)).toBe('');
    expect(policyStopSentence(runPolicy(pathP1()), S)).toBe('');
  });
});

describe('policyIgnoredNote — the card never renders an empty "on" state', () => {
  it('every reason the engine can report has a sentence; strikeLadder names the dashboard setting', () => {
    const EVERY = {
      mode: true, supportPath: true, cbStop: true, strikeStop: true, zones: true, buffer: true, cash: true,
      strikeLadder: true, retrieveLtv: true, rearm: true,
    } satisfies Record<PolicyIgnoredReason, true>;
    for (const reason of Object.keys(EVERY) as PolicyIgnoredReason[]) {
      expect(policyIgnoredNote(reason), reason).toMatch(/^The policy can't run here: .+\. Limits are measured at today's price instead\.$/);
    }
    expect(policyIgnoredNote('strikeLadder')).toContain("Strike's liquidation LTV (edited on the safety dashboard) must sit above its 70% margin call");
    expect(policyIgnoredNote(null)).toBe('');
  });

  it('⭐ reachable from a face: a Strike liquidation LTV of 70 (the dashboard allows 0–100) fails the ladder', () => {
    const at = (liqPct: number): CyclingResult => runCyclingSim({
      ...SP_REPRO, pricePath: pathP1(), supportPolicy: supportPolicyFor(S, SUPPORT, BILLS, liqPct, 'cycle'),
    });
    expect([at(70).policyApplied, at(70).policyIgnoredReason]).toEqual([false, 'strikeLadder']);
    expect([at(85).policyApplied, at(85).policyIgnoredReason]).toEqual([true, null]);
  });
});

describe('ZONE_COLOR / ZONE_ORDER / zoneStripLabel', () => {
  it('one token per zone, every zone in order; hold is --text-muted, never --text-faint (2.52:1 on --surface)', () => {
    const EVERY = { paused: true, accumulate: true, hold: true, payDown: true, broken: true } satisfies Record<PolicyState, true>;
    expect([...ZONE_ORDER].sort()).toEqual(Object.keys(EVERY).sort());
    expect(Object.keys(ZONE_COLOR).sort()).toEqual(Object.keys(EVERY).sort());
    for (const c of Object.values(ZONE_COLOR)) expect(c).toMatch(/^var\(--[a-z-]+\)$/);
    expect(ZONE_COLOR.hold).toBe('var(--text-muted)');
    expect(Object.values(ZONE_COLOR)).not.toContain('var(--text-faint)');
  });

  it('the strip\'s name reads the engine\'s counts: the zones that occur, in order, "months" on the first', () => {
    const counts = zoneStrip(runPolicy(pathP2(0)).rows).counts;
    const label = zoneStripLabel(counts);
    expect(label.startsWith(`Zones by month: buy with the line ${counts.accumulate} months, hold ${counts.hold}`)).toBe(true);
    expect(zoneStripLabel({ accumulate: 0, hold: 1, payDown: 0, paused: 0, broken: 2 })).toBe('Zones by month: hold 1 month, model broken 2.');
    expect(zoneStripLabel({ accumulate: 0, hold: 0, payDown: 0, paused: 0, broken: 0 })).toBe('Zones by month: none.');
  });
});

describe('settingReadouts — the six sliders, from the EFFECTIVE settings', () => {
  const ctx = { cbLtvCapPct: 70, strikeCapEffPct: 60 };
  const eff = (o: Partial<SupportPolicySettings>, c: { cbLtvCapPct: number; strikeCapEffPct: number } = ctx) =>
    effectivePolicySettings({ ...DEFAULT_SUPPORT_POLICY_SETTINGS, ...o }, c);
  const joined = (r: { value: string; clause: string }): string => (r.clause ? `${r.value} — ${r.clause}` : r.value);

  it('the defaults read the spec\'s figures', () => {
    const r = settingReadouts(eff({}), 6_000);
    expect(joined(r.cbStop)).toBe('60% — liquidated 30% below support');
    expect(joined(r.skStop)).toBe('50% — margin call 29% below support');
    expect(joined(r.accumulateBelow)).toBe('1.50× support');
    expect(joined(r.payDownAbove)).toBe('2.00× support');
    expect(r.bearBuffer).toEqual({ value: '12 months', clause: '$72,000 of bills' });
    expect(r.cashReserve).toEqual({ value: 'none', clause: '' });
    expect(settingReadouts(eff({ cashReserveMonths: 6 }), 6_000).cashReserve).toEqual({ value: '6 months', clause: '$36,000 of bills' });
    expect(settingReadouts(eff({ bearBufferMonths: 1 }), 6_000).bearBuffer).toEqual({ value: '1 month', clause: '$6,000 of bills' });
    expect(settingReadouts(eff({ bearBufferMonths: 1 }), 0).bearBuffer.clause).toBe('$0 of bills');
  });

  it('⭐ v1.2 #13: a stop held to its defense line reads the stop the run USES', () => {
    expect(joined(settingReadouts(eff({ cbStopAtSupportPct: 65 }, { cbLtvCapPct: 60, strikeCapEffPct: 60 }), 6_000).cbStop))
      .toBe('65% — held to your 60% defense line: liquidated 30% below support');
    expect(joined(settingReadouts(eff({ strikeStopAtSupportPct: 55 }, { cbLtvCapPct: 70, strikeCapEffPct: 50 }), 6_000).skStop))
      .toBe('55% — held to your 50% defense line: margin call 29% below support');
  });

  it('⭐ C3: a pushed pay-down line reads as pushed — accumulate 2.0, pay down 1.5', () => {
    expect(settingReadouts(eff({ accumulateBelow: 2.0, payDownAbove: 1.5 }), 6_000).payDownAbove)
      .toEqual({ value: '2.10× support', clause: 'held above your 2.00× buy zone' });
  });
});

describe('⭐ C4: every "limit X% at support" is the EFFECTIVE stop', () => {
  // A Coinbase limit of 65 under a 60 defense line runs at 60.
  const held = effectivePolicySettings({ ...DEFAULT_SUPPORT_POLICY_SETTINGS, cbStopAtSupportPct: 65 }, { cbLtvCapPct: 60, strikeCapEffPct: 60 });

  it('the CB LTV tile, the defense-line note and the InfoTip', () => {
    expect(policyTileSub(held, 60)).toBe('limit 60% at support · defense 60%');
    expect(defenseLineNote('coinbase', held))
      .toBe("Where the defenses fire if price breaks below support. The policy's own limit (65%) is held to this line: 60% at support.");
    expect(policyTip(held)[2]).toBe('Every recorded cycle low sat at or above ~0.98× support; a 60% Coinbase limit set there survives a 30% break below it.');
  });

  it('the unclamped defaults, and the Strike line with its cap off', () => {
    expect(policyTileSub(S, 70)).toBe('limit 60% at support · defense 70%');
    expect(defenseLineNote('coinbase', S)).toBe("Where the defenses fire if price breaks below support. The policy's own limit is 60% at support.");
    expect(defenseLineNote('strike', S)).toBe("Where the defenses fire if price breaks below support. The policy's own limit is 50% at support.");
    expect(defenseLineNote('strike', S, false))
      .toBe("Off — the Strike top-up doesn't fire if price breaks below support. The policy's own limit is 50% at support.");
    expect(policyTip(S)).toEqual([
      "Every limit is measured at the power-law support line instead of today's price, so borrowing can't grow with a rally.",
      'Buy with the line up to 1.5× support; hold to 2×; pay down above; pause below support.',
      'Every recorded cycle low sat at or above ~0.98× support; a 60% Coinbase limit set there survives a 30% break below it.',
    ]);
  });
});

describe('policyColdNote — the cold card while the policy decides what goes to cold', () => {
  it('names the buffer, and the broken exception (the engine never sweeps while broken)', () => {
    expect(policyColdNote(S)).toBe('The support policy decides what goes to cold: Coinbase keeps what it needs at support plus 12 months '
      + 'of bills; the rest goes to cold whenever price is at or above support, unless the model is treated as broken.');
    const one = effectivePolicySettings({ ...DEFAULT_SUPPORT_POLICY_SETTINGS, bearBufferMonths: 1 }, { cbLtvCapPct: 70, strikeCapEffPct: 60 });
    expect(policyColdNote(one)).toContain('plus 1 month of bills;');
    const none = effectivePolicySettings({ ...DEFAULT_SUPPORT_POLICY_SETTINGS, bearBufferMonths: 0 }, { cbLtvCapPct: 70, strikeCapEffPct: 60 });
    expect(policyColdNote(none)).toContain('Coinbase keeps what it needs at support; the rest');
  });
});
