import type { CyclingResult, CyclingRow } from '../../simulation/cyclingSim';
import { coldOriginsParts, coldMovesSentence, type ColdOriginPart } from './cyclingFaceView';
import {
  coldShown, policyColdNote, policyColdGoalNote, policyReserveNote, shownBtc, type EffectivePolicySettings,
} from './supportPolicyView';

/**
 * BL33 — the cold-storage card, ONE view for the four engine faces (Cycling, Strategy, Ownership, Decision). PURE.
 *
 * The outcome first — the total by the run's end — then where it came from, when new coins first move, and, while the
 * support policy applies, how the plan uses cold: one fact a line, folded. Every sentence is an existing one-definition
 * helper's (coldOriginsParts, coldMovesSentence, policyColdNote, policyColdGoalNote, policyReserveNote), behind its own
 * gates; this only arranges them, so the four faces can't drift. One widening, on purpose: the moves line shows wherever
 * the card does, the policy off included (Strategy printed none then; Cycling's sweep-off note no longer repeats it).
 * Each face supplies its own time labels ("Oct 2031" / "month 60", "Jan 2029" / "at month 27") — the coldMovesSentence
 * rule.
 */
export const COLD_CARD_TITLE = 'Cold storage';
export const COLD_RULES_TITLE = 'How the plan uses cold storage';
/** The no-reserve "nothing moves" sentence — ONE for the four faces (BL33; the reserve's twin is coldMovesSentence's). */
export const NOTHING_MOVES_TO_COLD = ' Nothing moves to cold on this path.';

export interface ColdCardView {
  /** "2.662 ₿" — the cold at the run's end. */
  total: string;
  /** "in your own custody by Oct 2031" — "in", not "into": with a reserve the coins are there from month 0. */
  totalSub: string;
  /** Where it came from — the reserve, Coinbase, Strike, less what the defenses used (they foot with the cold ledger). */
  parts: ColdOriginPart[];
  /** "New coins first move Jan 2029." — the run's first sweep month, or that nothing new moves. */
  moves: string;
  /** While the policy applies: the rule, the goal's stand-down (with a goal the run applied), the reserve's (when it is
   *  true of the run). Empty with the policy off — the face's own sweep controls say what fills cold then. */
  rules: string[];
}

export interface ColdCardLabels {
  /** The run's last month, in the face's terms: "Oct 2031", "month 60". */
  end: string;
  /** The first sweep month, in the face's terms ("Jan 2029", "at month 27"); null when nothing new moves. */
  firstCold: string | null;
}

/** `null` when cold can't be non-zero on this run (coldShown): the card then shows only what the face adds. */
export function coldCardView(
  sim: Pick<CyclingResult,
    'policyApplied' | 'openingColdBtc' | 'totalColdBtc' | 'totalColdFromCb' | 'totalColdFromStrike' | 'totalColdRetrievedBtc'
    | 'goalNetBtc' | 'coldRetrievedAboveSupportBtc' | 'liqMonth'>
    & { rows: ReadonlyArray<Pick<CyclingRow, 'topUpFromColdBtc'>> },
  settings: EffectivePolicySettings,
  coldBufferPct: number,
  labels: ColdCardLabels,
): ColdCardView | null {
  if (!coldShown(coldBufferPct, sim)) return null;
  const rules: string[] = [];
  if (sim.policyApplied) {
    rules.push(policyColdNote(settings));
    const goal = policyColdGoalNote(sim.goalNetBtc);
    if (goal !== null) rules.push(goal);
    const reserve = policyReserveNote(sim).trim();
    if (reserve !== '') rules.push(reserve);
  }
  return {
    total: `${sim.totalColdBtc.toFixed(3)} ₿`,
    totalSub: `in your own custody by ${labels.end}`,
    parts: coldOriginsParts(sim),
    moves: coldMovesSentence(labels.firstCold, shownBtc(sim.openingColdBtc), NOTHING_MOVES_TO_COLD).trim(),
    rules,
  };
}
