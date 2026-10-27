import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fireInputsOf, fireTaxRateOf, FIRE_INPUT_DEFAULTS, FIRE_INPUT_RANGES, FIRE_TAX_PCT_DEFAULT,
} from '../fireInputs';
import { CAPITAL_GAINS_TAX_RATE } from '../../simulation/taxes';

/**
 * The FIRE face's own inputs (batch 1 build 4, D3 A) — ONE device-local store key read through ONE rule, `fireInputsOf`.
 * A field missing, junk or out of range reads its default, so an older blob or a later field never reads `undefined`.
 * Round synthetic figures only — this repo is public. Every assertion carries its tag (DEFAULTS, READ RULE).
 */

describe('⭐ DEFAULTS — each default, and none leans hopeful (D13\'s reason)', () => {
  it('⭐ DEFAULTS — the read of nothing is every default', () => {
    expect(fireInputsOf(null), 'DEFAULTS null').toEqual(FIRE_INPUT_DEFAULTS);
    expect(fireInputsOf(undefined), 'DEFAULTS undefined').toEqual(FIRE_INPUT_DEFAULTS);
    expect(fireInputsOf({}), 'DEFAULTS an empty object').toEqual(FIRE_INPUT_DEFAULTS);
    expect(FIRE_INPUT_DEFAULTS, 'DEFAULTS the values').toEqual({
      otherUsd: 0,                // nothing assumed
      retirementIncomeUsd: 0,     // nothing assumed
      spendUsd: null,             // follows the plan's expenses (D5)
      bufferPct: 0,
      wBtcPct: 4,                 // D13 — 4% for bitcoin too, never the Compass's 8%
      wOtherPct: 4,
      otherReturnPct: null,       // follows inflation: 0% real (D-4)
      taxPct: null,               // Living's rate (D11, R1(d))
      basisUsdPerBtc: null,       // the month-0 price (F7)
      stopChoice: 'atFi',
      stopYears: 5,               // D-4
    });
  });

  it('⭐ DEFAULTS — the tax is Living\'s one rate, and its field shows it as a whole percent', () => {
    expect(fireTaxRateOf(fireInputsOf(null)), 'DEFAULTS tax').toBe(CAPITAL_GAINS_TAX_RATE);
    expect(FIRE_TAX_PCT_DEFAULT, 'DEFAULTS the field shows 30').toBe(30);
    expect(fireTaxRateOf(fireInputsOf({ taxPct: 15 })), 'DEFAULTS a typed rate is ÷ 100').toBe(0.15);
    expect(fireTaxRateOf(fireInputsOf({ taxPct: 0 })), 'DEFAULTS a typed 0 is no tax').toBe(0);
  });

  it('⭐ DEFAULTS — lib/fireInputs.ts imports only the tax leaf (the planPolicy precedent: pure)', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/fireInputs.ts'), 'utf8');
    const imports = [...src.matchAll(/^import[^;]*?from '([^']+)';/gm)].map((m) => m[1]);
    expect(imports, 'DEFAULTS imports').toEqual(['../simulation/taxes']);
  });
});

describe('⭐ READ RULE — missing, junk or out of range reads the default; in range is kept', () => {
  const NUMERIC = ['otherUsd', 'retirementIncomeUsd', 'bufferPct', 'wBtcPct', 'wOtherPct', 'stopYears'] as const;
  const FOLLOW = ['spendUsd', 'otherReturnPct', 'taxPct', 'basisUsdPerBtc'] as const;
  const JUNK: unknown[] = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '4', true, {}, [], undefined];

  it('⭐ READ RULE — a number field: junk and out of range read the default; its ends are kept', () => {
    for (const k of NUMERIC) {
      const r = FIRE_INPUT_RANGES[k];
      for (const v of JUNK) expect(fireInputsOf({ [k]: v })[k], `READ RULE ${k} junk ${String(v)}`).toBe(FIRE_INPUT_DEFAULTS[k]);
      expect(fireInputsOf({ [k]: r.min - 1 })[k], `READ RULE ${k} below`).toBe(FIRE_INPUT_DEFAULTS[k]);
      expect(fireInputsOf({ [k]: r.max + 1 })[k], `READ RULE ${k} above`).toBe(FIRE_INPUT_DEFAULTS[k]);
      expect(fireInputsOf({ [k]: null })[k], `READ RULE ${k} null`).toBe(FIRE_INPUT_DEFAULTS[k]);
      expect(fireInputsOf({ [k]: r.min })[k], `READ RULE ${k} min kept`).toBe(r.min);
      expect(fireInputsOf({ [k]: r.max })[k], `READ RULE ${k} max kept`).toBe(r.max);
    }
  });

  it('⭐ READ RULE — a "follow" field: null follows; junk and out of range follow too; in range is kept', () => {
    for (const k of FOLLOW) {
      const r = FIRE_INPUT_RANGES[k];
      expect(fireInputsOf({ [k]: null })[k], `READ RULE ${k} null follows`).toBeNull();
      for (const v of JUNK) expect(fireInputsOf({ [k]: v })[k], `READ RULE ${k} junk ${String(v)}`).toBeNull();
      expect(fireInputsOf({ [k]: r.max + 1 })[k], `READ RULE ${k} above`).toBeNull();
      expect(fireInputsOf({ [k]: r.max })[k], `READ RULE ${k} max kept`).toBe(r.max);
    }
    // A cost of 0 is no cost: it follows the month-0 price (the blank-means-default field, F7).
    expect(fireInputsOf({ basisUsdPerBtc: 0 }).basisUsdPerBtc, 'READ RULE basis 0').toBeNull();
    expect(fireInputsOf({ basisUsdPerBtc: 30_000 }).basisUsdPerBtc, 'READ RULE basis kept').toBe(30_000);
    expect(fireInputsOf({ otherReturnPct: -20 }).otherReturnPct, 'READ RULE a loss is kept').toBe(-20);
    expect(fireInputsOf({ spendUsd: 0 }).spendUsd, 'READ RULE spending 0 is a figure').toBe(0);
  });

  it('⭐ READ RULE — the stop: one of three choices; whole years only', () => {
    for (const c of ['atFi', 'now', 'years'] as const) expect(fireInputsOf({ stopChoice: c }).stopChoice, `READ RULE ${c}`).toBe(c);
    for (const v of ['later', 'AtFi', 3, null, undefined, {}]) {
      expect(fireInputsOf({ stopChoice: v }).stopChoice, `READ RULE stop junk ${String(v)}`).toBe('atFi');
    }
    expect(fireInputsOf({ stopYears: 12 }).stopYears, 'READ RULE years kept').toBe(12);
    expect(fireInputsOf({ stopYears: 2.5 }).stopYears, 'READ RULE a part year is junk').toBe(5);
  });

  it('⭐ READ RULE — not an object reads every default; an older blob and a later field never read undefined', () => {
    for (const raw of [null, undefined, 0, 'x', true, [], [1, 2]]) {
      expect(fireInputsOf(raw), `READ RULE raw ${JSON.stringify(raw)}`).toEqual(FIRE_INPUT_DEFAULTS);
    }
    const older = fireInputsOf({ otherUsd: 50_000 });   // a blob from before a field existed
    for (const v of Object.values(older)) expect(v, 'READ RULE older blob').not.toBeUndefined();
    expect(older.otherUsd, 'READ RULE older blob keeps what it has').toBe(50_000);
    const later = fireInputsOf({ otherUsd: 50_000, aFieldFromLater: 7 }) as unknown as Record<string, unknown>;
    expect(later.aFieldFromLater, 'READ RULE a later field is not read').toBeUndefined();
    expect(Object.keys(later).sort(), 'READ RULE the shape').toEqual(Object.keys(FIRE_INPUT_DEFAULTS).sort());
  });
});
