// The FIRE face's own inputs (batch 1 build 4, D3 A) — ONE device-local store key, `fireInputs`, read through ONE rule.
// PURE: its one import is the zero-import tax leaf, for Living's one default rate (R1(d)); the planPolicy.ts precedent.
//
// ⚠ Device-local by construction: the key rides partializeState's `...rest` and is in no field list, so it never syncs,
//   is never in a backup and never reaches a viewer (`.claude/rules/store.md`). The store keeps only what was typed on
//   this device — a partial object, `null` = every default — and every reader takes it through `fireInputsOf`, so an
//   older blob or a later field never reads `undefined`. The face memoises that read on the stored object, never once
//   a render (the lens reset would fire every render).
// ⚠ None of the defaults leans hopeful (D13's reason): 4% / 4%, nothing assumed beyond the plan, the other assets' return
//   no more than inflation, Living's 30% tax. The month-0 basis is F7's convention, and it leans hopeful for coins bought
//   lower — the face says so beside the field.
import { CAPITAL_GAINS_TAX_RATE } from '../simulation/taxes';

/** When work stops: at FI, now, or in a whole number of years. */
export type FireStopChoice = 'atFi' | 'now' | 'years';

/** The face's inputs as every reader sees them — each in range. A `null` keeps its "follow" meaning. */
export interface FireFaceInputs {
  /** Other investable assets, dollars. */
  otherUsd: number;
  /** A month of retirement income, today's dollars — from the stop month on. */
  retirementIncomeUsd: number;
  /** A month of spending in retirement, today's dollars; null = the plan's expenses (D5). */
  spendUsd: number | null;
  /** A buffer on the spending, %; the view folds it in — the engine has none. */
  bufferPct: number;
  /** The withdrawal rates, % a year (D13). */
  wBtcPct: number;
  wOtherPct: number;
  /** The other assets' return, % a year; null = the inflation rate (0% real). */
  otherReturnPct: number | null;
  /** The tax on what a sale gains, %; null = Living's rate, `CAPITAL_GAINS_TAX_RATE`. */
  taxPct: number | null;
  /** The owner's own average cost, dollars a coin; null = the month-0 price (F7). */
  basisUsdPerBtc: number | null;
  stopChoice: FireStopChoice;
  /** Whole years from now, for `stopChoice: 'years'` — kept while another choice is on. */
  stopYears: number;
}

/** What the store keeps: only what was typed on this device. `null` = every default. */
export type StoredFireInputs = Partial<FireFaceInputs>;

export const FIRE_INPUT_DEFAULTS: Readonly<FireFaceInputs> = Object.freeze({
  otherUsd: 0,
  retirementIncomeUsd: 0,
  spendUsd: null,
  bufferPct: 0,
  wBtcPct: 4,
  wOtherPct: 4,
  otherReturnPct: null,
  taxPct: null,
  basisUsdPerBtc: null,
  stopChoice: 'atFi',
  stopYears: 5,
});

/** Each number field's range — the read rule's, and its field's min and max. */
export const FIRE_INPUT_RANGES = {
  otherUsd:            { min: 0,   max: 1_000_000_000 },
  retirementIncomeUsd: { min: 0,   max: 10_000_000 },
  spendUsd:            { min: 0,   max: 10_000_000 },
  bufferPct:           { min: 0,   max: 100 },
  wBtcPct:             { min: 0.5, max: 50 },
  wOtherPct:           { min: 0.5, max: 50 },
  otherReturnPct:      { min: -50, max: 50 },
  taxPct:              { min: 0,   max: 99 },
  basisUsdPerBtc:      { min: 0,   max: 100_000_000 },
  stopYears:           { min: 1,   max: 20 },
} as const;

/** Living's rate as its field shows it, a whole percent — derived from the one constant, never typed twice. */
export const FIRE_TAX_PCT_DEFAULT = Math.round(CAPITAL_GAINS_TAX_RATE * 10_000) / 100;

type Range = { readonly min: number; readonly max: number };
const inRange = (v: unknown, r: Range): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= r.min && v <= r.max;
const numberOr = (v: unknown, r: Range, d: number): number => (inRange(v, r) ? v : d);
const followOr = (v: unknown, r: Range): number | null => (inRange(v, r) ? v : null);
const STOP_CHOICES: readonly FireStopChoice[] = ['atFi', 'now', 'years'];

/** THE read rule: a field missing, junk or out of range reads its default; anything that isn't an object reads them all. */
export function fireInputsOf(raw: unknown): FireFaceInputs {
  const o = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const R = FIRE_INPUT_RANGES, D = FIRE_INPUT_DEFAULTS;
  const basis = followOr(o.basisUsdPerBtc, R.basisUsdPerBtc);
  const years = o.stopYears;
  return {
    otherUsd: numberOr(o.otherUsd, R.otherUsd, D.otherUsd),
    retirementIncomeUsd: numberOr(o.retirementIncomeUsd, R.retirementIncomeUsd, D.retirementIncomeUsd),
    spendUsd: followOr(o.spendUsd, R.spendUsd),
    bufferPct: numberOr(o.bufferPct, R.bufferPct, D.bufferPct),
    wBtcPct: numberOr(o.wBtcPct, R.wBtcPct, D.wBtcPct),
    wOtherPct: numberOr(o.wOtherPct, R.wOtherPct, D.wOtherPct),
    otherReturnPct: followOr(o.otherReturnPct, R.otherReturnPct),
    taxPct: followOr(o.taxPct, R.taxPct),
    basisUsdPerBtc: basis !== null && basis > 0 ? basis : null,   // a cost of 0 is no cost: the month-0 price
    stopChoice: STOP_CHOICES.includes(o.stopChoice as FireStopChoice) ? (o.stopChoice as FireStopChoice) : D.stopChoice,
    stopYears: inRange(years, R.stopYears) && Number.isInteger(years) ? years : D.stopYears,
  };
}

/** The tax as the engine takes it, a decimal: Living's rate unless a rate was typed. */
export function fireTaxRateOf(fi: FireFaceInputs): number {
  return fi.taxPct === null ? CAPITAL_GAINS_TAX_RATE : fi.taxPct / 100;
}
