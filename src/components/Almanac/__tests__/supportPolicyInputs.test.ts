import { describe, it, expect, vi } from 'vitest';
import {
  buildSupportPath, supportPolicyFor, supportAtDates, breakerFromHistory, holdMonthsFrom,
} from '../supportPolicyInputs';
import {
  effectivePolicySettings, DEFAULT_SUPPORT_POLICY_SETTINGS, DEFAULT_BREAKER_REARM_MONTHS,
} from '../supportPolicyView';
import { runCyclingSim, effectiveStrikeCapPct, type CyclingMode } from '../../../simulation/cyclingSim';
import { STRIKE_MARGIN_CALL_LTV } from '../../../simulation/emergencyModel';
// Tests may import beliefs; the no-belief-imports rule restricts the view MODULES, not their tests.
import { addMonths, plBandAt, plConvergencePath, PL_ON_THE_LINE } from '../../../simulation/powerLaw';
import {
  nextRearmableBreakerState, REARMABLE_BREAKER_START,
} from '../../../simulation/supportPolicy';
import {
  SP_START, SP_MONTHS, SUPPORT, S0, SP_REPRO, policyFor, pathP1,
  supportPathFor, multiplePath, P6_KNOTS, falseRecoveryPath,
} from '../../../simulation/__tests__/supportPolicyPaths';

/**
 * Run 2a — the faces' one §2 crossing (supportPolicyInputs.ts). Round synthetic figures only — this repo is public.
 */

/** The effective settings a face with SP_REPRO's defense lines (CB 70, Strike cap 60) would build. */
const ctx = {
  cbLtvCapPct: SP_REPRO.cbLtvCapPct,
  strikeCapEffPct: effectiveStrikeCapPct(SP_REPRO.strikeLtvCapPct, STRIKE_MARGIN_CALL_LTV),
};
const defaults = effectivePolicySettings(DEFAULT_SUPPORT_POLICY_SETTINGS, ctx);

describe('buildSupportPath — the support line, built in ONE place', () => {
  it('has months + 1 entries, each exactly plBandAt(\'floor\', start, m)', () => {
    const path = buildSupportPath(SP_START, 24);
    expect(path).toHaveLength(25);
    path.forEach((s, m) => expect(s).toBe(plBandAt('floor', SP_START, m)));
  });

  it('⭐ is bit-equal to the on-the-line price path from month 1 — and IS Run 1\'s SUPPORT fixture', () => {
    const price = plConvergencePath(1.35 * S0, 'floor', SP_START, SP_MONTHS, PL_ON_THE_LINE);
    const support = buildSupportPath(SP_START, SP_MONTHS);
    expect(support).toHaveLength(price.length);
    for (let m = 1; m <= SP_MONTHS; m++) expect(support[m], `m${m}`).toBe(price[m]);
    expect(price[0]).toBe(1.35 * S0);           // month 0 is the live price, not the line
    expect(support).toEqual(SUPPORT);
  });

  it('floors the horizon, and a negative or non-finite one gives month 0 only', () => {
    expect(buildSupportPath(SP_START, 12.7)).toHaveLength(13);
    expect(buildSupportPath(SP_START, -3)).toEqual([plBandAt('floor', SP_START, 0)]);
    expect(buildSupportPath(SP_START, Number.NaN)).toHaveLength(1);
  });
});

describe('supportPolicyFor — the engine\'s policy input, as a face builds it', () => {
  it('undefined when the policy is off, and in every non-cycle mode (the engine then runs as today)', () => {
    expect(supportPolicyFor({ ...defaults, enabled: false }, SUPPORT, SP_REPRO.expenses, 85, 'cycle')).toBeUndefined();
    for (const mode of ['hold', 'clearStrike', 'clearBoth'] as CyclingMode[]) {
      expect(supportPolicyFor(defaults, SUPPORT, SP_REPRO.expenses, 85, mode), mode).toBeUndefined();
    }
    expect(supportPolicyFor(defaults, SUPPORT, SP_REPRO.expenses, 85, 'cycle')).toBeDefined();
  });

  it('opening cash = months of the face\'s bills; never negative or NaN', () => {
    const six = { ...defaults, cashReserveMonths: 6 };
    expect(supportPolicyFor(six, SUPPORT, 6_000, 85, 'cycle')!.openingCashUsd).toBe(36_000);
    expect(supportPolicyFor(six, SUPPORT, 4_500, 85, 'cycle')!.openingCashUsd).toBe(27_000);
    expect(supportPolicyFor(six, SUPPORT, -1, 85, 'cycle')!.openingCashUsd).toBe(0);
    expect(supportPolicyFor(six, SUPPORT, Number.NaN, 85, 'cycle')!.openingCashUsd).toBe(0);
  });

  it('the partial-liquidation LTV follows the store setting, with the published 85% as the fallback', () => {
    expect(supportPolicyFor(defaults, SUPPORT, 6_000, 85, 'cycle')!.strikePartialLiqLtv).toBeCloseTo(0.85, 12);
    expect(supportPolicyFor(defaults, SUPPORT, 6_000, 90, 'cycle')!.strikePartialLiqLtv).toBeCloseTo(0.90, 12);
    expect(supportPolicyFor(defaults, SUPPORT, 6_000, 0, 'cycle')!.strikePartialLiqLtv).toBe(0.85);
  });

  it('exactly the Run 1 keys plus the re-arm — nothing else, so no test-only input can reach the engine', () => {
    const p = supportPolicyFor(defaults, SUPPORT, 6_000, 85, 'cycle')!;
    expect(Object.keys(p).sort()).toEqual([
      'accumulateBelow', 'bearBufferMonths', 'breakerRearmMonths', 'cbStopAtSupportPct', 'openingCashUsd',
      'payDownAbove', 'strikeCureLtv', 'strikePartialLiqLtv', 'strikeRetrieveMaxLtv', 'strikeStopAtSupportPct',
      'supportPath',
    ]);
    expect(p.breakerRearmMonths).toBe(DEFAULT_BREAKER_REARM_MONTHS);
  });

  it('⭐ the re-arm key is ABSENT when the constant is undefined — a local override, never an edit of it', async () => {
    vi.resetModules();
    vi.doMock('../supportPolicyView', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../supportPolicyView')>()),
      DEFAULT_BREAKER_REARM_MONTHS: undefined,
    }));
    try {
      const latched = await import('../supportPolicyInputs');
      const p = latched.supportPolicyFor(defaults, SUPPORT, SP_REPRO.expenses, 85, 'cycle');
      expect(p).toBeDefined();
      expect(Object.keys(p!)).not.toContain('breakerRearmMonths');
      expect(p).toEqual(policyFor(SUPPORT));   // a latched run is exactly Run 1's object
    } finally {
      vi.doUnmock('../supportPolicyView');
      vi.resetModules();
    }
  });

  it('⭐ a face-shaped input: the engine applies it, and it IS Run 1\'s default policy plus the re-arm', () => {
    const supportPath = buildSupportPath(SP_START, SP_MONTHS);
    const policy = supportPolicyFor(defaults, supportPath, SP_REPRO.expenses, 85, 'cycle');
    expect(policy).toEqual({ ...policyFor(SUPPORT), breakerRearmMonths: DEFAULT_BREAKER_REARM_MONTHS });
    const r = runCyclingSim({ ...SP_REPRO, pricePath: pathP1(), supportPolicy: policy });
    expect(r.policyApplied).toBe(true);
    expect(r.policyIgnoredReason).toBeNull();
  });
});

// ── Decision face Run A · the policy's memory, rebuilt from prices (§4.5–4.6) ──────────────────────────────────

describe('⭐ supportAtDates — the ONE support line, bit-aligned with the engine\'s path', () => {
  it('⭐ supportAtDates(addMonths(start, m)) is bit-equal to buildSupportPath(start, M)[m]', () => {
    const path = buildSupportPath(SP_START, 60);
    for (let m = 0; m <= 60; m++) {
      expect(supportAtDates([addMonths(SP_START, m)])[0], `m${m}`).toBe(path[m]);
    }
  });

  it('maps every date, in order', () => {
    const dates = [SP_START, addMonths(SP_START, 7), addMonths(SP_START, 31)];
    expect(supportAtDates(dates)).toEqual(dates.map((d) => buildSupportPath(d, 0)[0]));
  });
});

describe('⭐ I25 — breakerFromHistory folds ONE trip rule, and agrees with the engine', () => {
  // A start on the 31st of a 31-day month: `addMonths` then lands EVERY engine month on a calendar month-end, so
  // the history's closes and the engine's own month-ends are the same dates — which is what makes the two folds
  // comparable at all. Round synthetic knots.
  const START = new Date('2027-01-31T00:00:00Z');
  const MONTHS = 72;
  const SUP = supportPathFor(START, MONTHS);
  const DAY = 86_400_000;
  const PATHS: [string, number[]][] = [
    ['P6', multiplePath(P6_KNOTS, SUP)],
    ['false recovery 0.6', falseRecoveryPath(0.6, SUP)],
    ['false recovery 0.35', falseRecoveryPath(0.35, SUP)],
  ];
  /** History points at months 1…t — the month-ends that have CLOSED. */
  const historyTo = (path: number[], t: number) =>
    Array.from({ length: t }, (_, i) => ({ timestamp: addMonths(START, i + 1).getTime(), price: path[i + 1] }));
  /**
   * ⚠ The LOAD-BEARING state. `brokenMonth` is deliberately excluded: the fold's month argument is its own grid
   * index (history can start anywhere), so there is no "correct" month number for a SEEDED break — which is why
   * the engine never reads one (`modelBrokenMonth` stays the first in-run trip; pinned in cyclingSimPolicy).
   */
  const carriedState = (b: { monthsBelow: number; monthsAtOrAbove: number; broken: boolean }) =>
    ({ monthsBelow: b.monthsBelow, monthsAtOrAbove: b.monthsAtOrAbove, broken: b.broken });
  /** The same fold, applied directly — the reference. */
  const directFold = (path: number[], t: number) => {
    let st = REARMABLE_BREAKER_START;
    for (let m = 1; m <= t; m++) st = nextRearmableBreakerState(st, path[m], SUP[m], m, 6);
    return st;
  };

  it.each(PATHS)('⭐ %s — the fold equals the direct fold, and its `broken` equals the engine\'s zone', (_name, path) => {
    const run = runCyclingSim({
      ...SP_REPRO, pricePath: path, startYear: 2027,
      supportPolicy: policyFor(SUP, { breakerRearmMonths: 6 }),
    });
    expect(run.policyApplied).toBe(true);
    for (let t = 1; t <= MONTHS; t++) {
      const seed = breakerFromHistory(historyTo(path, t), new Date(addMonths(START, t).getTime() + DAY), 6);
      expect(seed, `t${t}`).not.toBeNull();
      expect(carriedState(seed!.state), `t${t}`).toEqual(carriedState(directFold(path, t)));
      expect(seed!.state.broken, `t${t} vs engine`).toBe(run.rows[t].policyZone === 'broken');
    }
  });

  it('⭐ non-vacuous: these paths DO break and DO re-arm', () => {
    const path = falseRecoveryPath(0.35, SUP);
    const states = Array.from({ length: MONTHS }, (_, i) =>
      breakerFromHistory(historyTo(path, i + 1), new Date(addMonths(START, i + 1).getTime() + DAY), 6)!.state.broken);
    expect(states.some((b) => b)).toBe(true);
    expect(states.some((b) => !b)).toBe(true);
  });

  it('⭐ junk CARRIES the state — a stale close, a missing month, and a close ≤ 0 all read the same', () => {
    const path = falseRecoveryPath(0.35, SUP);
    // t = 6 is the window where month 6 still MATTERS: this path is already under 0.9 × support at month 5, so
    // with month 6 the breaker has tripped (two consecutive) and without it, it has not. A later window is
    // vacuous — the trip simply happens a month or two later and the arms re-converge.
    const T = 6;
    const full = historyTo(path, T);
    const today = new Date(addMonths(START, T).getTime() + DAY);
    const skipSix = (() => {
      let st = REARMABLE_BREAKER_START;
      for (let m = 1; m <= T; m++) if (m !== 6) st = nextRearmableBreakerState(st, path[m], SUP[m], m, 6);
      return st;
    })();
    const JUNKED: [string, typeof full][] = [
      ['missing', full.filter((_, i) => i !== 5)],
      ['stale close', full.map((x, i) => (i === 5 ? { ...x, timestamp: x.timestamp - 10 * DAY } : x))],
      ['close ≤ 0', full.map((x, i) => (i === 5 ? { ...x, price: 0 } : x))],
    ];
    for (const [name, hist] of JUNKED) {
      expect(carriedState(breakerFromHistory(hist, today, 6)!.state), name).toEqual(carriedState(skipSix));
    }
    // Non-vacuous: WITH month 6 the breaker has tripped, without it, it has not.
    expect(breakerFromHistory(full, today, 6)!.state.broken).toBe(true);
    expect(skipSix.broken).toBe(false);
  });

  it('⭐ N7 — the 7-day boundary: exactly 7 days is JUNK, 7 days less 1 ms is read', () => {
    const path = falseRecoveryPath(0.35, SUP);
    const T = 6;
    const full = historyTo(path, T);
    const today = new Date(addMonths(START, T).getTime() + DAY);
    const endOfSix = addMonths(START, T).getTime() + DAY;   // the next month's first UTC midnight
    const skipSix = (() => {
      let st = REARMABLE_BREAKER_START;
      for (let m = 1; m <= T; m++) if (m !== 6) st = nextRearmableBreakerState(st, path[m], SUP[m], m, 6);
      return st;
    })();
    const at = (gapMs: number) => full.map((x, i) => (i === 5 ? { ...x, timestamp: endOfSix - gapMs } : x));
    // Exactly 7 days before the month's end: junk, so the state carries.
    expect(carriedState(breakerFromHistory(at(7 * DAY), today, 6)!.state)).toEqual(carriedState(skipSix));
    // One millisecond closer: read.
    expect(carriedState(breakerFromHistory(at(7 * DAY - 1), today, 6)!.state))
      .toEqual(carriedState(breakerFromHistory(full, today, 6)!.state));
    // Non-vacuous: the two answers differ.
    expect(carriedState(skipSix)).not.toEqual(carriedState(breakerFromHistory(full, today, 6)!.state));
  });

  it('no usable history ⇒ null — the caller runs clean and SAYS so', () => {
    expect(breakerFromHistory([], new Date('2027-06-30T00:00:00Z'), 6)).toBeNull();
    // Points only in the CURRENT month: no month has closed yet.
    expect(breakerFromHistory(
      [{ timestamp: Date.UTC(2027, 5, 3), price: 50_000 }], new Date('2027-06-30T00:00:00Z'), 6,
    )).toBeNull();
    // Junk points are filtered out entirely.
    expect(breakerFromHistory(
      [{ timestamp: Number.NaN, price: 1 }, { timestamp: 1, price: Number.NaN }], new Date('2027-06-30T00:00:00Z'), 6,
    )).toBeNull();
  });

  it('lastMonthEndISO names the last month-end actually read', () => {
    const path = multiplePath(P6_KNOTS, SUP);
    const seed = breakerFromHistory(historyTo(path, 5), new Date(addMonths(START, 5).getTime() + DAY), 6)!;
    expect(seed.lastMonthEndISO).toBe('2027-06-30');      // month 5 from a 2027-01-31 start
  });

  it('rearmMonths null LATCHES — the same fold, without the re-arm', () => {
    const path = falseRecoveryPath(0.35, SUP);
    const today = new Date(addMonths(START, MONTHS).getTime() + DAY);
    expect(breakerFromHistory(historyTo(path, MONTHS), today, null)!.state.broken).toBe(true);
  });
});

describe('⭐ I26 — holdMonthsFrom', () => {
  it('null, junk, or a past date ⇒ 0', () => {
    expect(holdMonthsFrom(null, SP_START)).toBe(0);
    expect(holdMonthsFrom('not-a-date', SP_START)).toBe(0);
    expect(holdMonthsFrom('2000-01-01', SP_START)).toBe(0);
  });

  it('⭐ otherwise the FIRST engine month strictly past the hold', () => {
    for (const m of [1, 2, 5]) {
      // A hold that ends one day before engine month m: month m is the first past it.
      const through = new Date(addMonths(SP_START, m).getTime() - 86_400_000).toISOString().slice(0, 10);
      expect(holdMonthsFrom(through, SP_START), `m${m}`).toBe(m);
    }
  });

  it('a hold ending exactly ON a month start pushes to the NEXT month (strictly past)', () => {
    const iso = addMonths(SP_START, 3).toISOString().slice(0, 10);
    expect(holdMonthsFrom(iso, SP_START)).toBe(4);
  });
});
