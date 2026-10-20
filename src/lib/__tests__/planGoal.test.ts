import { describe, it, expect } from 'vitest';
import { planGoalOf, parseGoalInput, PLAN_GOAL_FIELD, PLAN_GOAL_MAX_BTC } from '../planGoal';
import { netCoinsBtc, atGoalOf, GOAL_EPS } from '../../simulation/goal';
import { SETTINGS_FIELDS, PLAN_EVENT_FIELDS, VIEWER_SETTINGS_FIELDS, VALIDATE_WHITELIST, APPLY_FIELDS } from '../../store/settingsFields';

/**
 * BL14 — the goal amount's two pure rules (Batch 1, build 2; spec pbloc-spec-batch-1-v1 §2.2): how every reader takes the
 * stored goal, and net coins. ⚠ SYNTHETIC round figures — this repo is public.
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
    for (const bad of ['-1', '-0', 'abc', '1e3', '2,5', '1.2.3', '0x10', '₿2']) expect(parseGoalInput(bad), `not a goal: ${bad}`).toBeUndefined();
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
