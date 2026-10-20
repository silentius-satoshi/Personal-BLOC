// BL14 — the plan's goal amount (Batch 1, build 2; spec `pbloc-spec-batch-1-v1` §2.2). One more synced plan field beside
// the support policy's six: the goal, in NET COINS — every coin (Strike, Coinbase, cold) minus what is owed, in bitcoin at
// the month's price (simulation/goal.ts, the one rule). At or above it the plan stops borrowing and buying; spare income
// repays Strike, then Coinbase; with both repaid the plan holds. Absent (null) = no goal: nothing changes for anyone who
// hasn't set one.
//
// PURE, ZERO imports (the planPolicy.ts precedent), so the store, Settings and every reader take the field one way.

/** The goal's store field — one plan event per change; a set-to-null event means "no goal" (blocStatementMinimum's
 *  precedent: an empty value is an event, an absent one the seed). */
export const PLAN_GOAL_FIELD = 'planGoalNetBtc' as const;

/** The most a goal can be: every bitcoin there will ever be. */
export const PLAN_GOAL_MAX_BTC = 21_000_000;

const SATS_PER_BTC = 100_000_000;

/**
 * The goal as every reader takes it: a finite number above zero, at most 21M, to the satoshi; anything else — null, absent,
 * zero, negative, junk from a restored backup (its validator checks keys, never values) — is NO goal (null). A goal that
 * rounds to zero sats is no goal either.
 */
export function planGoalOf(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  const sats = Math.round(Math.min(v, PLAN_GOAL_MAX_BTC) * SATS_PER_BTC);
  return sats > 0 ? sats / SATS_PER_BTC : null;
}

/**
 * What Settings' goal field holds, typed: empty (or only spaces) clears the goal; a number above zero sets it (through
 * `planGoalOf`); anything else is not a goal and changes nothing (`undefined`).
 */
export function parseGoalInput(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === '') return null;
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return undefined;
  const v = Number(t);
  if (!Number.isFinite(v)) return undefined;
  if (v === 0) return null;
  return planGoalOf(v) ?? undefined;
}
