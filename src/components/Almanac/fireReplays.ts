import { deriveReplays, replayPath, type DatedPrice, type ReplayReading } from '../../simulation/cycleReplays';
import type { ReplayPathReading } from './fireFaceView';

/**
 * The FIRE face's bear-market replays — their ONE belief crossing (batch 1 build 4, D-3), as supportPolicyInputs.ts is the
 * support line's. It imports the replay leaf (a belief: its tail is the power-law trend), so the view module never does —
 * fireFaceView.ts takes plain arrays.
 *
 * 🔴 Each replay is spliced into the face's OWN displayed path at the face's OWN stop month — the number fireTimeline
 *    resolved on that path, held — at exactly that month's price, wherever the cycle is (F9: harsh on purpose).
 * ⚠ No price series is committed (D-2): the history is the one the app loads (usePowerLawData — one fetch a visit). With
 *    no stop month, or one at or past the horizon, there is nothing to replay; a cycle with no top or a gap is named.
 * 🔴 The follow-ups' F-1 — each replay hands the view its low as a plain number: `troughMonth`, months after the stop (the
 *    leaf's own, unchanged by the splice), so the view can tell a replay the horizon ends before its low without importing
 *    the leaf.
 */

/** Each cycle's replay from the history the app loaded — the leaf's own rule, no other. */
export function fireReplayReadings(history: ReadonlyArray<DatedPrice>, today: Date): ReplayReading[] {
  return deriveReplays(history, today);
}

/** Each cycle spliced into the face's path at its stop month, with its low; none without a stop month inside the horizon. */
export function replayPathsAt(
  path: readonly number[], startDate: Date, stop: number | null, readings: readonly ReplayReading[],
): ReplayPathReading[] {
  if (stop === null || !(stop >= 0 && stop < path.length)) return [];
  return readings.map((r): ReplayPathReading => (r.replay === null
    ? { id: r.id, path: null, reason: r.reason ?? 'gap', troughMonth: null }
    : { id: r.id, path: replayPath(path, startDate, stop, r.replay), reason: null, troughMonth: r.replay.troughMonth }));
}
