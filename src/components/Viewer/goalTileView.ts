import { goalPair, netBtcText } from '../Almanac/planMonthView';
import { atGoalOf } from '../../simulation/goal';

/**
 * BL14 (G1-C) — the Dashboard's goal tile, as words: net coins TODAY (live, like the rest of the Dashboard) against the
 * owner's saved goal. PURE — the tile renders these and composes nothing.
 *
 * 🔴 It never names a plan move: what the plan does at the goal is THIS MONTH's to say, at the month's price — so the two
 * screens can't contradict each other; their figures differ only by the price, and each says which it uses.
 */
export interface GoalTileView {
  /** "₿1.234 of ₿2.000" */
  value: string;
  /** "net coins today · 62%", or "net coins today · at or past your goal". */
  sub: string;
  /** The bar's fill, 0..1. */
  fill: number;
  /** The tile, read aloud. */
  aria: string;
}

export const GOAL_TILE_TITLE = 'Your goal';

/** `null` when there is nothing to show: no goal, or net coins that can't be read. */
export function goalTileView(net: number | null, goal: number | null): GoalTileView | null {
  if (goal === null || net === null || !Number.isFinite(net)) return null;
  const reached = atGoalOf(net, goal);   // the engine's own rule, float dust forgiven
  const p = goalPair(net, goal, reached);
  const share = net / goal;
  const pct = Math.max(0, Math.floor(share * 100));
  const sub = reached ? 'net coins today · at or past your goal' : `net coins today · ${pct}%`;
  return {
    value: `${netBtcText(p.net)} of ₿${p.goal}`,
    sub,
    fill: Math.min(1, Math.max(0, share)),
    aria: `Your goal: ${p.net.startsWith('-') ? `minus ${p.net.slice(1)}` : p.net} bitcoin in net coins today, of ${p.goal}`
      + `${reached ? ' — at or past it' : ` — ${pct}%`}.`,
  };
}
