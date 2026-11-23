import { cycleLegAt } from '../../simulation/cycleModel';

/**
 * The Clocks' leg, in words (step 0 of the Engine, BL61; spec `pbloc-spec-cycle-clock-leg-v1`) — ONE pure view for the
 * Cycle Clock and the Halving Clock's pattern card. The leg is `cycleLegAt`'s: the projected turns on either side of
 * `ms`. After a low the cadence rises toward the next high; after a high it descends toward the next low. The Clocks
 * paired the last high with the next low, so from the 5 Oct 2026 low on they read "descending" toward the low after
 * next. Pure: the caller passes `ms` (no clock), no store, nothing from the risk core (§2).
 */
export type TurnWord = 'peak' | 'floor';

export interface CycleLegView {
  rising: boolean;
  /** "Rising phase" or "Descending phase". */
  phase: string;
  /** "floor → peak" or "peak → floor". */
  route: string;
  /** Whole percent through the leg. */
  pct: number;
  /** The projected turn behind `ms` and the one ahead: its date, its word (peak or floor) and its kind (high or low). */
  prev: { date: number; word: TurnWord; kind: 'high' | 'low' };
  next: { date: number; word: TurnWord; kind: 'high' | 'low' };
}

const wordOf = (kind: 'high' | 'low'): TurnWord => (kind === 'high' ? 'peak' : 'floor');

/** The leg at `ms`, in words — null where the projection has no leg (before its first turn, from its last on). */
export function cycleLegView(ms: number): CycleLegView | null {
  const leg = cycleLegAt(ms);
  if (leg === null) return null;
  return {
    rising: leg.rising,
    phase: leg.rising ? 'Rising phase' : 'Descending phase',
    route: leg.rising ? 'floor → peak' : 'peak → floor',
    pct: Math.round(leg.fraction * 100),
    prev: { date: leg.prev.date, word: wordOf(leg.prev.kind), kind: leg.prev.kind },
    next: { date: leg.next.date, word: wordOf(leg.next.kind), kind: leg.next.kind },
  };
}
