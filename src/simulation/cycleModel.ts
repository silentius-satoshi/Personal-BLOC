/**
 * Almanac CycleClock — pure domain model (P1).
 *
 * Two INDEPENDENT lifetimes live here and must never mix in code (the §2/§3 hard boundary):
 *   1. Halving math (epochFromHeight / epochProgress / dateAtBlock / blockAtDate /
 *      blockPositionInEpoch) — GENERALIZES to any future epoch with no code change.
 *   2. Cycle projection (CYCLE_TURNS / nextTurnAfter) — FIXED-ANCHORED to the 6 Oct 2025 ATH;
 *      it does NOT generalize and never feeds the halving math.
 *
 * 🔴 Standalone + pure: this module imports NOTHING from the risk/position core (runAdvisor,
 * runCoinbaseLoan, strikeCredit, cbMetrics, the store) and reads no clock — callers pass ms/height.
 */

// ── Verified constants (do not alter) ───────────────────────────────────────
export const HALVING_INTERVAL = 210_000;
export const GENESIS_REWARD = 50;
export const TARGET_BLOCK_S = 600;
export const H4 = { block: 840_000, date: Date.UTC(2024, 3, 20, 0, 9, 0) }; // 4th halving anchor
export const NEXT_HALVING_BLOCK = H4.block + HALVING_INTERVAL; // 1_050_000
export const H5_EST = Date.UTC(2028, 3, 12); // date-fallback boundary ONLY
export const CYCLE_ANCHOR = Date.UTC(2025, 9, 6); // ATH — Mon 6 Oct 2025

// ── Halving math (generalizes) ──────────────────────────────────────────────

export interface Epoch {
  index: number; // 0-based halving index = floor(height / HALVING_INTERVAL)
  era: number; // 1-based era = index + 1
  startBlock: number;
  endBlock: number;
  reward: number; // subsidy in BTC = GENESIS_REWARD / 2**index
}

export interface EpochProgress extends Epoch {
  blocksIntoEpoch: number;
  blocksRemaining: number;
  fraction: number; // half-open [0,1): snaps to 0 at the halving (rollover to the next epoch)
}

/** The halving epoch a block height sits in — generalizes to any future epoch. */
export function epochFromHeight(height: number): Epoch {
  const index = Math.floor(height / HALVING_INTERVAL);
  const startBlock = index * HALVING_INTERVAL;
  return {
    index,
    era: index + 1,
    startBlock,
    endBlock: startBlock + HALVING_INTERVAL,
    reward: GENESIS_REWARD / 2 ** index,
  };
}

/**
 * Progress through the current epoch. `fraction` is THE single source for the dial's hand, arc,
 * and "% through epoch". Half-open [0,1) by construction — at exactly endBlock the height belongs
 * to the next epoch (fraction 0), which is the halving wrap.
 */
export function epochProgress(height: number): EpochProgress {
  const e = epochFromHeight(height);
  const blocksIntoEpoch = height - e.startBlock;
  return {
    ...e,
    blocksIntoEpoch,
    blocksRemaining: e.endBlock - height,
    fraction: blocksIntoEpoch / HALVING_INTERVAL,
  };
}

/** Estimated wall-clock (ms) of a target block from a known tip, at ~blockS seconds/block. */
export function dateAtBlock(
  target: number,
  tip: { height: number; ts: number },
  blockS: number = TARGET_BLOCK_S,
): number {
  return tip.ts + (target - tip.height) * blockS * 1000;
}

/** Estimated block height at a wall-clock instant (ms), anchored at H4 — the date fallback. */
export function blockAtDate(ms: number): number {
  return H4.block + (ms - H4.date) / 1000 / TARGET_BLOCK_S;
}

/**
 * Where a date falls within an epoch, as a fraction of the epoch (≈0..1). Callers clamp/hide when
 * the result lands outside [0,1] (the projected turn is in a different epoch than the one shown).
 */
export function blockPositionInEpoch(ms: number, e: { startBlock: number }): number {
  return (blockAtDate(ms) - e.startBlock) / HALVING_INTERVAL;
}

// ── Cycle projection (fixed-anchored — does NOT generalize) ─────────────────

export interface CycleTurn {
  date: number; // ms (UTC)
  kind: 'high' | 'low';
}

const DAY_MS = 86_400_000;
const HIGH_TO_LOW_DAYS = 364; // peak → floor (= 52 weeks → always a Monday)
const LOW_TO_HIGH_DAYS = 1064; // floor → peak (= 152 weeks → always a Monday)
const TURN_COUNT = 14; // anchor + 13 alternating steps → ~2050

/**
 * The idealized cycle cadence (the IMG_7080 premise): from the 6 Oct 2025 ATH (a Monday), alternate
 * High→Low (+364d) and Low→High (+1064d) to ~2050. Both steps are multiples of 7, so EVERY turn
 * lands on a Monday. A pattern, not a forecast — independent of the halving math above.
 */
function buildCycleTurns(): CycleTurn[] {
  const turns: CycleTurn[] = [{ date: CYCLE_ANCHOR, kind: 'high' }];
  let date = CYCLE_ANCHOR;
  let kind: 'high' | 'low' = 'high';
  for (let i = 1; i < TURN_COUNT; i++) {
    date += (kind === 'high' ? HIGH_TO_LOW_DAYS : LOW_TO_HIGH_DAYS) * DAY_MS;
    kind = kind === 'high' ? 'low' : 'high';
    turns.push({ date, kind });
  }
  return turns;
}

export const CYCLE_TURNS: CycleTurn[] = buildCycleTurns();

/** The first projected turn strictly after `ms`, or null past the end of the projection. */
export function nextTurnAfter(ms: number): CycleTurn | null {
  for (const t of CYCLE_TURNS) {
    if (t.date > ms) return t;
  }
  return null;
}
