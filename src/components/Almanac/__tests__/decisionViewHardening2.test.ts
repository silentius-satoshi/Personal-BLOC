import { describe, it, expect } from 'vitest';
import { rowActions, moveCard, type MoveCardContext } from '../decisionView';
import { runCyclingSim } from '../../../simulation/cyclingSim';
import { placementPlan, type PlacementInput } from '../../../simulation/placement';
import { HARD_BREAKER_DEPTH, HARD_BREAKER_MONTHS } from '../../../simulation/supportPolicy';
import { SP_REPRO, SUPPORT, policyFor } from '../../../simulation/__tests__/supportPolicyPaths';
import { fmtUSDCents } from '../../../utils/format';

// decisionView.test.ts's placement and card context.
const PLACE: PlacementInput = {
  creditLine: 40_000, strikeBalance: 0, strikeCollateralBtc: 2, cbDebt: 60_000, cbCollateralBtc: 2,
  coldBtc: 0.5, price: 100_000, support: 100_000, skStop: 0.50, cbStop: 0.60, cbDefenseLtv: 0.70,
  bufferUsd: 72_000, accumulateBelow: 1.5, payDownAbove: 2.0, inHold: false, broken: false,
};
const CTX: MoveCardContext = {
  whatIf: false,
  policyApplied: true, policyEnabled: true, policyIgnoredReason: null,
  plan: placementPlan(PLACE), holdThroughISO: null, holdDepositISO: null,
  breaker: { broken: false, monthsAtOrAbove: 0, monthsBelow: 0, lastMonthEndLabel: '31 Aug 2026' }, rearmRule: 6,
  runLineUsd: 40_000, ownerLineUsd: 40_000, suggestedLineUsd: 20_000,
  expenses: 6_000, bearBufferMonths: 12, cbStop: 0.60, support: 100_000, price: 100_000,
  cbDebt: 60_000, cbLtvTriggerPct: 75, cbLtvTargetPct: 65, hasCbLoan: true, consoleRuns: true,
};
const card = (o: Partial<MoveCardContext> = {}) => moveCard({ ...CTX, ...o });

/**
 * Hardening 2 — decisionView.ts's GAPs from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HS.json).
 * Round synthetic figures; decisionView.test.ts's fixtures where a card is needed.
 */
const aRow = () => runCyclingSim({ ...SP_REPRO, pricePath: SUPPORT, supportPolicy: policyFor(SUPPORT) }).rows[1];

describe('Hardening 2 — decisionView', () => {
  it('HS-23 · journal.md "THIS MONTH … print dollars to the cent" (a shared builder takes a formatter) — a seizure on the way down names its price in the formatter it was handed', () => {
    const first = rowActions({ ...aRow(), m: 12 }, 12, { onTheWayDown: true, priceUsd: 57_140.25 }, fmtUSDCents)[0];
    expect(first.text).toBe(`Coinbase liquidates the loan on the way down, at ${fmtUSDCents(57_140.25)}.`);
  });

  it('HS-24 · engine.md "A run shown as THIS MONTH\'S MOVE carries the policy\'s memory" — the one-short breaker warning names the trip\'s own depth: 10% under support', () => {
    expect([HARD_BREAKER_DEPTH, HARD_BREAKER_MONTHS], 'HS-24 premise: the hard breaker is two month-ends 10% under').toEqual([0.10, 2]);
    const oneShort = card({ breaker: { broken: false, monthsAtOrAbove: 0, monthsBelow: 1, lastMonthEndLabel: '31 Aug 2026' } });
    const text = oneShort.lines.find((l) => l.key === 'breaker')!.text;
    expect(text.includes('closed more than 10% under support'), `HS-24 "${text}"`).toBe(true);
  });

  it('HS-25 · file-structure.md § decisionView.ts (THE MOVE names no figure under its floor, never "$0") — 30¢ of Strike room left reads "no room"', () => {
    const short = card({ plan: { ...placementPlan(PLACE), strikeShortBtc: 0.05, strikeRoomUsd: 0.3 } });
    const text = short.lines.find((l) => l.key === 'short')!.text;
    expect(text.endsWith('leaves no room.'), `HS-25 "${text}"`).toBe(true);
    expect(/\$0(?![\d,])/.test(text), 'HS-25 never "$0"').toBe(false);
  });
});
