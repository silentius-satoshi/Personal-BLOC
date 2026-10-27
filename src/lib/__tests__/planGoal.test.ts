import { describe, it, expect } from 'vitest';
import { planGoalOf, parseGoalInput, goalText, PLAN_GOAL_FIELD, PLAN_GOAL_MAX_BTC } from '../planGoal';
import { netCoinsBtc, atGoalOf, GOAL_EPS } from '../../simulation/goal';
import { SETTINGS_FIELDS, PLAN_EVENT_FIELDS, VIEWER_SETTINGS_FIELDS, VALIDATE_WHITELIST, APPLY_FIELDS } from '../../store/settingsFields';

/**
 * BL14 — the goal amount's two pure rules (Batch 1, build 2; spec pbloc-spec-batch-1-v1 §2.2): how every reader takes the
 * stored goal, and net coins. ⚠ SYNTHETIC round figures — this repo is public. The follow-ups (§5): the field takes a
 * comma for the decimal (D-2), and shows the goal fixed-point to the satoshi (D-4).
 */
describe('⭐ GOAL READ — planGoalOf: a goal, or none', () => {
  it('⭐ GOAL READ — a finite number above zero is a goal, to the satoshi; everything else is none', () => {
    expect(planGoalOf(2), 'a whole goal').toBe(2);
    expect(planGoalOf(0.5), 'a fraction').toBe(0.5);
    expect(planGoalOf(1.234567891234), 'to the satoshi').toBe(1.23456789);
    for (const junk of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, '2', {}, [], true]) {
      expect(planGoalOf(junk), `none: ${String(junk)}`).toBeNull();
    }
    expect(planGoalOf(0.000000004), 'rounds to zero sats → none').toBeNull();
    expect(planGoalOf(0.000000006), 'one satoshi').toBe(0.00000001);
    expect(planGoalOf(1e12), 'at most every coin').toBe(PLAN_GOAL_MAX_BTC);
  });

  it('⭐ GOAL INPUT — Settings\' field: empty clears, an amount above zero sets, anything else changes nothing', () => {
    expect(parseGoalInput(''), 'empty → no goal').toBeNull();
    expect(parseGoalInput('   '), 'spaces → no goal').toBeNull();
    expect(parseGoalInput('0'), 'zero → no goal').toBeNull();
    expect(parseGoalInput('2'), 'whole').toBe(2);
    expect(parseGoalInput(' 2.5 '), 'trimmed').toBe(2.5);
    expect(parseGoalInput('.5'), 'leading point').toBe(0.5);
    expect(parseGoalInput('2.'), 'trailing point').toBe(2);
    expect(parseGoalInput('2,5'), 'a comma decimal (the follow-ups\' D-2)').toBe(2.5);
    for (const bad of ['-1', '-0', 'abc', '1e3', '1.2.3', '0x10', '₿2']) expect(parseGoalInput(bad), `not a goal: ${bad}`).toBeUndefined();
  });

  it('⭐ GOAL INPUT — a comma decimal (the follow-ups\' D-2): one separator, a point or a comma; a comma beside a point, or two of either, is not a goal', () => {
    // An iPhone's decimal keypad in a comma-decimal region has a comma and no point.
    expect(parseGoalInput('0,5'), 'a comma decimal').toBe(0.5);
    expect(parseGoalInput(',5'), 'a leading comma').toBe(0.5);
    expect(parseGoalInput('2,'), 'a trailing comma').toBe(2);
    expect(parseGoalInput(' 2,5 '), 'trimmed').toBe(2.5);
    expect(parseGoalInput('1,000'), '"1,000" reads as 1 — that keypad has no thousands separator').toBe(1);
    for (const zero of ['0,0', ',0', '0,']) expect(parseGoalInput(zero), `a comma zero clears, as "0.0" does: ${zero}`).toBeNull();
    for (const bad of ['1,000.5', '1.000,5', '1,2,3', '1,,5', ',', '.,5', '5,.', ',,', '1 ,5']) {
      expect(parseGoalInput(bad), `not a goal: ${bad}`).toBeUndefined();
    }
  });

  it('⭐ GOAL INPUT — every input the field took before keeps its value: the old rule, frozen, over every string of up to five characters', () => {
    // The rule before the follow-ups' D-2, word for word — a frozen copy, as ⭐26 freezes the old normAxis.
    const before = (raw: string): number | null | undefined => {
      const t = raw.trim();
      if (t === '') return null;
      if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return undefined;
      const v = Number(t);
      if (!Number.isFinite(v)) return undefined;
      if (v === 0) return null;
      return planGoalOf(v) ?? undefined;
    };
    const ALPHABET = ['0', '1', '5', '9', '.', ',', ' ', '-', 'e', 'x'];
    let took = 0;
    const moved: string[] = [];
    const walk = (s: string, depth: number): void => {
      if (s !== '') {
        const b = before(s);
        if (b !== undefined) {
          took += 1;
          if (parseGoalInput(s) !== b) moved.push(s);
        }
      }
      if (depth > 0) for (const ch of ALPHABET) walk(s + ch, depth - 1);
    };
    walk('', 5);
    expect(took, 'GOAL INPUT non-vacuous: the old rule took thousands').toBeGreaterThan(1000);
    expect(moved, 'GOAL INPUT every one keeps its value').toEqual([]);
  });

  it('⭐ GOAL FIELD — one synced plan field: a plan event, in the backup, and EXPOSED to a trusted viewer (G2-A)', () => {
    expect(PLAN_GOAL_FIELD).toBe('planGoalNetBtc');
    expect(SETTINGS_FIELDS, 'synced').toContain(PLAN_GOAL_FIELD);
    expect(PLAN_EVENT_FIELDS, 'a plan event, not a pref').toContain(PLAN_GOAL_FIELD);
    expect(VALIDATE_WHITELIST.has(PLAN_GOAL_FIELD), 'a backup carrying it is accepted').toBe(true);
    expect(APPLY_FIELDS.has(PLAN_GOAL_FIELD), 'a restore applies it').toBe(true);
    expect(VIEWER_SETTINGS_FIELDS, 'a trusted viewer receives it').toContain(PLAN_GOAL_FIELD);
  });
});

describe('⭐ GOAL TEXT — the field\'s text (the follow-ups\' D-4)', () => {
  it('⭐ GOAL TEXT — fixed-point to the satoshi, trailing zeros trimmed, never an exponent', () => {
    expect(goalText(null), 'GOAL TEXT no goal').toBe('');
    expect(goalText(2), 'GOAL TEXT whole').toBe('2');
    expect(goalText(0.5), 'GOAL TEXT a fraction').toBe('0.5');
    expect(goalText(planGoalOf(50 / 100_000_000)), 'GOAL TEXT 50 sats — String() says "5e-7"').toBe('0.0000005');
    expect(goalText(PLAN_GOAL_MAX_BTC), 'GOAL TEXT every coin').toBe('21000000');
  });

  it('⭐ GOAL TEXT — the round trip: the text, parsed, is the goal to the satoshi — every goal under 100 sats, and a sweep to 21M', () => {
    const sats: number[] = [];
    for (let s = 1; s <= 100_000; s++) sats.push(s);   // every goal under 100 sats (String()'s exponents), and on to 0.001 ₿
    for (let s = 100_000; s < 2.1e15; s = Math.ceil(s * 1.001)) sats.push(s);
    let seed = 21;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < 20_000; i++) sats.push(1 + Math.floor(rnd() * rnd() * 2.1e15));
    sats.push(2.1e15 - 1, 2.1e15);
    const failed: string[] = [];
    for (const s of sats) {
      const g = s / 100_000_000;
      if (planGoalOf(g) !== g) { failed.push(`${s}: not a canonical goal`); continue; }   // the premise
      const t = goalText(g);
      if (parseGoalInput(t) !== g || /e/i.test(t)) failed.push(`${s}: "${t}"`);
    }
    expect(sats.length, 'GOAL TEXT non-vacuous').toBeGreaterThan(130_000);
    expect(failed.slice(0, 5), 'GOAL TEXT every goal round-trips').toEqual([]);
  });
});

describe('⭐ NET — net coins: every coin minus what is owed, in bitcoin at the price', () => {
  it('⭐ NET — the arithmetic, and no figure when it can\'t be read', () => {
    const base = { strikeBtc: 1, cbBtc: 1, coldBtc: 0.5, strikeBalanceUsd: 20_000, cbDebtUsd: 50_000, price: 100_000 };
    expect(netCoinsBtc(base), '2.5 ₿ held, $70,000 owed at $100,000').toBeCloseTo(1.8, 12);
    expect(netCoinsBtc({ ...base, strikeBalanceUsd: 0, cbDebtUsd: 0 }), 'nothing owed: every coin').toBe(2.5);
    expect(netCoinsBtc({ ...base, strikeBtc: 0, cbBtc: 0.1, coldBtc: 0 }), 'can be negative: owing more than is held').toBeLessThan(0);
    for (const price of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(netCoinsBtc({ ...base, price }), `price ${price}`).toBeNull();
    expect(netCoinsBtc({ ...base, cbDebtUsd: Number.NaN }), 'a junk part').toBeNull();
  });

  it('⭐ AT — at or above the goal, with a figure computed onto it never read as below', () => {
    expect(atGoalOf(2, 2), 'exactly at').toBe(true);
    expect(atGoalOf(2 * (1 - GOAL_EPS / 2), 2), 'float dust under').toBe(true);
    expect(atGoalOf(1.999, 2), 'below').toBe(false);
    expect(atGoalOf(3, 2), 'above').toBe(true);
    expect(atGoalOf(null, 2), 'no figure').toBe(false);
    expect(atGoalOf(3, null), 'no goal').toBe(false);
  });
});
