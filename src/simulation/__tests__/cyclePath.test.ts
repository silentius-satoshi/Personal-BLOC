import { describe, it, expect } from 'vitest';
import {
  CYCLE_LOW_MULT, CYCLE_TOP_MULT, CYCLE_SHIFT_MONTH_MS, CYCLE_PHASE_SHIFT_MAX_MONTHS,
  cycleMultAt, cycleConvergencePath, shiftedCycleTurns, upcomingCycleTurns, cycleTurnsInHorizon,
} from '../cyclePath';
import { CYCLE_TURNS } from '../cycleModel';
import {
  PL_A_FAIR, PL_A_FLOOR, plFairValue, plFloor, plConvergencePath, plBandAt, addMonths,
} from '../powerLaw';
import { runCyclingSim, type CyclingInputs } from '../cyclingSim';
import { STRIKE_MAX_DRAW_LTV } from '../strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../emergencyModel';

const utc = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const isoOf = (d: Date): string => d.toISOString().slice(0, 10);
const multOf = (kind: 'high' | 'low'): number => (kind === 'high' ? CYCLE_TOP_MULT : CYCLE_LOW_MULT);
const DAY = 86_400_000;

/** Deepest drawdown from any prior peak (≤ 0). Equivalent to min over i of (min(p[i..]) / max(p[..i]) − 1). */
function maxDrawdown(path: number[]): number {
  let peak = -Infinity;
  let dd = 0;
  for (const p of path) {
    peak = Math.max(peak, p);
    dd = Math.min(dd, p / peak - 1);
  }
  return dd;
}

describe('the model constants', () => {
  it('1 · CYCLE_LOW_MULT is DERIVED from the power-law constants, not a literal', () => {
    expect(CYCLE_LOW_MULT).toBe(PL_A_FLOOR / PL_A_FAIR);
    expect(CYCLE_LOW_MULT).toBeCloseTo(0.36207, 5);
    expect(CYCLE_TOP_MULT).toBe(1);
  });

  it('the phase-shift month is a whole number of ms — why a shift round-trips exactly', () => {
    expect(CYCLE_SHIFT_MONTH_MS).toBe(2_629_800_000);
    expect(Number.isInteger(CYCLE_SHIFT_MONTH_MS)).toBe(true);
  });
});

describe('cycleMultAt', () => {
  it('2 · ⭐ the cycle trough and the support line are the SAME claim — compared as PRICES', () => {
    // ⚠ Not `cycleMultAt(t) === plFloor(t) / plFairValue(t)`: (a·x)/(b·x) !== a/b in IEEE-754, and that
    // form fails on dozens of dates. The claim that matters is the price at the trough.
    const lows = CYCLE_TURNS.filter((t) => t.kind === 'low');
    expect(lows.length).toBe(7);
    for (const t of lows) {
      const d = new Date(t.date);
      expect(plFairValue(d) * cycleMultAt(d) / plFloor(d)).toBeCloseTo(1, 12);
    }
  });

  it('3 · returns exactly CYCLE_TOP_MULT at a high and CYCLE_LOW_MULT at a low', () => {
    // The verified schedule — a fixed-anchored belief, so these dates are pinned, not derived.
    expect(CYCLE_TURNS.slice(0, 6).map((t) => `${isoOf(new Date(t.date))} ${t.kind}`)).toEqual([
      '2025-10-06 high', '2026-10-05 low', '2029-09-03 high',
      '2030-09-02 low', '2033-08-01 high', '2034-07-31 low',
    ]);
    // ⚠ This pins the EXACTNESS, not the exact-hit shortcut: the log-linear interpolation also lands
    // exactly on these values without it today, so the shortcut is a precaution no test can tell apart.
    for (const t of CYCLE_TURNS) expect(cycleMultAt(new Date(t.date))).toBe(multOf(t.kind));
    // ⭐ CANARY on the accident that HIDES the shortcut. Deleting the shortcut today changes no result,
    // so no test can catch its removal — mutation-verified: all 23 cases still pass without it. What can
    // be pinned is the assumption underneath. If either line below ever fails, exp(log(x)) has stopped
    // round-tripping, the shortcut has become load-bearing, and it needs a test of its own.
    expect(Math.exp(Math.log(CYCLE_LOW_MULT))).toBe(CYCLE_LOW_MULT);
    expect(Math.exp(Math.log(CYCLE_TOP_MULT))).toBe(CYCLE_TOP_MULT);
  });

  it('4 · is strictly monotone between consecutive turns, and never leaves [LOW, TOP]', () => {
    for (let i = 1; i < CYCLE_TURNS.length; i++) {
      const a = CYCLE_TURNS[i - 1];
      const b = CYCLE_TURNS[i];
      const falling = a.kind === 'high';
      let prev = cycleMultAt(new Date(a.date));
      for (let k = 1; k <= 40; k++) {
        const v = cycleMultAt(new Date(a.date + ((b.date - a.date) * k) / 41));
        if (falling) expect(v).toBeLessThan(prev);
        else expect(v).toBeGreaterThan(prev);
        expect(v).toBeGreaterThanOrEqual(CYCLE_LOW_MULT);
        expect(v).toBeLessThanOrEqual(CYCLE_TOP_MULT);
        prev = v;
      }
    }
  });

  it('5 · ⭐ a phase shift translates EVERY turn by n × 30.4375 days, exactly', () => {
    // The observable contract: the shifted schedule and the shifted probe meet exactly on each turn. With an
    // addMonths shift this fails on the 2034-07-31 turn for 5 of 12 shift values; with ms it cannot.
    expect(CYCLE_TURNS.some((t) => isoOf(new Date(t.date)) === '2034-07-31')).toBe(true);
    for (let n = -CYCLE_PHASE_SHIFT_MAX_MONTHS; n <= CYCLE_PHASE_SHIFT_MAX_MONTHS; n++) {
      const shifted = shiftedCycleTurns(n);
      shifted.forEach((st, i) => {
        expect(st.date.getTime() - CYCLE_TURNS[i].date).toBe(n * CYCLE_SHIFT_MONTH_MS);
        expect(cycleMultAt(st.date, n)).toBe(multOf(st.kind));
      });
    }
  });

  it('a POSITIVE shift means the cycle runs LATE', () => {
    const low = new Date(CYCLE_TURNS[1].date);                 // the 2026-10-05 low
    expect(cycleMultAt(low, 3)).toBeGreaterThan(CYCLE_LOW_MULT);   // three months late: not there yet
    expect(cycleMultAt(new Date(low.getTime() + 3 * CYCLE_SHIFT_MONTH_MS), 3)).toBe(CYCLE_LOW_MULT);
  });

  it('6 · clamps outside the schedule and never returns NaN', () => {
    const first = CYCLE_TURNS[0];
    const last = CYCLE_TURNS[CYCLE_TURNS.length - 1];
    expect(cycleMultAt(utc('2009-06-01'))).toBe(multOf(first.kind));
    expect(cycleMultAt(utc('2060-01-01'))).toBe(multOf(last.kind));
    expect(Number.isFinite(cycleMultAt(utc('2009-06-01')))).toBe(true);
    // Non-finite input — a NaN here would poison the whole path and every downstream LTV.
    expect(cycleMultAt(new Date(NaN))).toBe(CYCLE_TOP_MULT);
    expect(cycleMultAt(utc('2027-01-01'), NaN)).toBe(CYCLE_TOP_MULT);
    expect(shiftedCycleTurns(NaN).map((t) => t.date.getTime())).toEqual(CYCLE_TURNS.map((t) => t.date));
  });
});

describe('cycleConvergencePath — a structural mirror of plConvergencePath', () => {
  const start = utc('2027-01-01');

  it('7 · month 0 is EXACTLY the anchor (the SafetyDashboard-agreement invariant)', () => {
    expect(cycleConvergencePath(100_000, start, 60, 1)[0]).toBe(100_000);
    expect(cycleConvergencePath(100_000, start, 60, 48, 5)[0]).toBe(100_000);
  });

  it('on the line, every month ≥ 1 IS the cycle curve for that month', () => {
    const path = cycleConvergencePath(100_000, start, 60, 1);
    for (let m = 1; m <= 60; m++) {
      const dm = addMonths(start, m);
      expect(path[m]).toBe(plFairValue(dm) * cycleMultAt(dm));
    }
  });

  it('the degenerate guards return a flat array of the right length', () => {
    expect(cycleConvergencePath(0, start, 60, 1)).toEqual(new Array(61).fill(0));
    expect(cycleConvergencePath(-5, start, 60, 1)).toEqual(new Array(61).fill(-5));
    expect(cycleConvergencePath(100_000, start, 60, 0)).toEqual(new Array(61).fill(100_000));
    expect(cycleConvergencePath(100_000, start, 12.7, 1)).toHaveLength(13);
  });
});

describe('cycleTurnsInHorizon / shiftedCycleTurns / upcomingCycleTurns', () => {
  const rowsOf = (turns: { month: number; kind: string; date: Date }[]) =>
    turns.map((t) => `${t.month} ${t.kind} ${isoOf(t.date)}`);

  it('8a · today\'s default view: rows 1 (low), 36 (high), 48 (low)', () => {
    expect(rowsOf(cycleTurnsInHorizon(utc('2026-09-12'), 60))).toEqual([
      '1 low 2026-10-05', '36 high 2029-09-03', '48 low 2030-09-02',
    ]);
  });

  it('8b · ⭐ ties go to the LATER row', () => {
    // From a 2026-08-20 start the 2026-10-05 low is exactly 15 days from row 1 (09-20) and row 2 (10-20).
    // This is the case that pins the rule: ties-to-earlier would say row 1.
    const start = utc('2026-08-20');
    const low = CYCLE_TURNS[1].date;
    expect(low - addMonths(start, 1).getTime()).toBe(addMonths(start, 2).getTime() - low);   // a real tie
    expect(cycleTurnsInHorizon(start, 12).map((t) => t.month)).toEqual([2]);
    // The spec's 2026-09-20 tie (rows 0 and 1) also lands on row 1 — but the snap would put it there
    // either way, so on its own it cannot catch a wrong tie-break.
    expect(cycleTurnsInHorizon(utc('2026-09-20'), 12).map((t) => t.month)).toEqual([1]);
  });

  it('8c · ⭐ a turn nearest row 0 SNAPS to row 1 and keeps its real date — it is never dropped', () => {
    const start = utc('2026-09-28');
    const low = CYCLE_TURNS[1].date;
    // Genuinely nearest row 0 (7 days) rather than row 1 (23 days) — so this exercises the snap.
    expect(low - start.getTime()).toBeLessThan(addMonths(start, 1).getTime() - low);
    expect(rowsOf(cycleTurnsInHorizon(start, 12))).toEqual(['1 low 2026-10-05']);
  });

  it('8d · no turn ever lands on row 0, over two years of start dates, horizons and shifts', () => {
    for (let day = 0; day < 730; day += 3) {
      const start = new Date(utc('2026-01-01').getTime() + day * DAY);
      for (const months of [12, 60]) {
        for (const shift of [-12, 0, 12]) {
          for (const t of cycleTurnsInHorizon(start, months, shift)) {
            expect(t.month).toBeGreaterThanOrEqual(1);
            expect(t.month).toBeLessThanOrEqual(months);
          }
        }
      }
    }
  });

  it('8e · the path note reads the UNCLIPPED schedule — a 12-month horizon still has a next high', () => {
    const start = utc('2026-09-12');
    expect(rowsOf(cycleTurnsInHorizon(start, 12))).toEqual(['1 low 2026-10-05']);
    expect(upcomingCycleTurns(start, 2).map((t) => `${t.kind} ${isoOf(t.date)}`)).toEqual([
      'low 2026-10-05', 'high 2029-09-03',
    ]);
  });

  it('8f · the phase shift moves the turns', () => {
    const shifted = cycleTurnsInHorizon(utc('2026-09-12'), 60, 3);
    expect(shifted.map((t) => t.kind)).toEqual(['low', 'high', 'low']);
    expect(shifted.map((t) => t.month)).toEqual([4, 39, 51]);
    expect(shifted[1].date.getTime()).toBe(utc('2029-09-03').getTime() + 3 * CYCLE_SHIFT_MONTH_MS);
  });

  it('an empty horizon has no turns', () => {
    expect(cycleTurnsInHorizon(utc('2026-09-12'), 0)).toEqual([]);
  });
});

describe('11 · ⭐ the drawdown gap — the reason this module exists', () => {
  // Months 1…60 only: month 0 is the live anchor and month 1 the convergence step onto the path.
  const start = utc('2027-01-01');

  it('Support rides its line monotonically — its deepest drawdown is EXACTLY zero', () => {
    // That zero is the defect: a path that cannot fall can never exercise the CB LTV stop or the defense
    // cascade, and can never show what the cold-storage sweep costs. Liquidation is a path property.
    expect(maxDrawdown(plConvergencePath(100_000, 'floor', start, 60, 1).slice(1))).toBe(0);
  });

  it('the 4-yr cycle falls about 52% from the 2029 top into the 2030 trough', () => {
    const dd = maxDrawdown(cycleConvergencePath(100_000, start, 60, 1).slice(1));
    expect(dd).toBeLessThan(-0.45);
    expect(dd).toBeGreaterThan(-0.6);
  });
});

describe('12 · ⭐ through the engine: liquidation lands in a descent, not anywhere', () => {
  // ⚠ SYNTHETIC round figures — this repo is public; never a real position.
  const START = utc('2027-01-01');
  // Trap 1 closed: anchor ON the support line, so month 1 is no step-down that could liquidate on its own.
  const ANCHOR = plBandAt('floor', START, 0);
  const cycle = cycleConvergencePath(ANCHOR, START, 60, 1);
  const floor = plConvergencePath(ANCHOR, 'floor', START, 60, 1);
  const position: Omit<CyclingInputs, 'pricePath'> = {
    startYear: 2027,
    strikeCollateralBtc: 0.25,
    strikeBalance: 0,
    strikeCreditLine: 10_000,
    strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV,
    strikeMarginLtv: STRIKE_MARGIN_CALL_LTV,
    cbCollateralBtc: 1.0,
    cbDebt: 20_000,
    income: 2_000,
    expenses: 8_000,
    strikeAprPct: 13,
    cbAprPct: 6,
    cycleMonths: 1,
    cbLtvCapPct: 70,
    coldStoreBufferPct: 0,   // isolate the path shape — the faces run 30
    defendCbLtv: true,       // as the faces do
  };

  it('the fixture is step-free: month 1 moves up on both paths', () => {
    expect(floor[1] / floor[0] - 1).toBeGreaterThan(0);
    expect(floor[1] / floor[0] - 1).toBeLessThan(0.05);
    expect(cycle[1] / cycle[0] - 1).toBeGreaterThan(0);
  });

  it('liquidates on the cycle path — inside the fall into a trough', () => {
    const res = runCyclingSim({ ...position, pricePath: cycle });
    // Trap 2 closed: no vacuous pass when nothing liquidates.
    expect(res.liqMonth).not.toBeNull();
    const liqMonth = res.liqMonth!;
    expect(liqMonth).toBeGreaterThan(1);   // never the month-1 step
    const trough = cycleTurnsInHorizon(START, 60).find((t) => t.kind === 'low' && t.month >= liqMonth);
    expect(trough).toBeDefined();
    // The fall takes 364 days: 13 months is the descent window plus a month of slack.
    expect(liqMonth).toBeGreaterThanOrEqual(trough!.month - 13);
    expect(liqMonth).toBeLessThanOrEqual(trough!.month);
  });

  it('⭐ the contrast — the SAME position on Support never liquidates', () => {
    expect(runCyclingSim({ ...position, pricePath: floor }).liqMonth).toBeNull();
  });
});
