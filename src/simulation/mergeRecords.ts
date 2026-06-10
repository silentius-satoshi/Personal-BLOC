import type { MonthlyLogEntry } from './types';

export interface RecordsState {
  entries:   MonthlyLogEntry[];
  deletions: Record<number, number>;   // month → deletedAt (Unix ms); tombstones for synced deletes
}

const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;   // 90 days

const entryTs = (e: MonthlyLogEntry): number => e.updatedAt ?? e.loggedAt ?? 0;

/**
 * Deterministic per-month merge of two records states. Union by month; the newer entry
 * (updatedAt, falling back to loggedAt) wins; a deletion tombstone newer than the winning
 * entry deletes the month; an entry newer than the tombstone survives (re-log) and drops it.
 * Idempotent — applying any fetched state is always safe.
 */
export function mergeRecords(
  local: RecordsState,
  remote: RecordsState,
  opts: { preferLocalOnTie: boolean },
): RecordsState {
  // JSON-parsed deletions keys are strings while entry months are numbers — coerce the union.
  const months = new Set<number>();
  for (const e of local.entries)  months.add(e.month);
  for (const e of remote.entries) months.add(e.month);
  for (const k of Object.keys(local.deletions))  months.add(Number(k));
  for (const k of Object.keys(remote.deletions)) months.add(Number(k));

  const entries: MonthlyLogEntry[] = [];
  const deletions: Record<number, number> = {};
  const now = Date.now();

  for (const m of months) {
    const l = local.entries.find((e) => e.month === m);
    const r = remote.entries.find((e) => e.month === m);

    let candidate: MonthlyLogEntry | undefined;
    if (l && r) {
      const lt = entryTs(l), rt = entryTs(r);
      candidate = lt > rt ? l : rt > lt ? r : (opts.preferLocalOnTie ? l : r);
    } else {
      candidate = l ?? r;
    }

    const d = Math.max(local.deletions[m] ?? 0, remote.deletions[m] ?? 0);

    if (!candidate) {
      if (d > 0 && d >= now - TOMBSTONE_TTL_MS) deletions[m] = d;
    } else if (d > entryTs(candidate)) {
      // Deletion is newer than the surviving entry — month is deleted.
      if (d >= now - TOMBSTONE_TTL_MS) deletions[m] = d;
    } else {
      // Entry newer than (or untouched by) the tombstone — it survives; drop the tombstone (re-log).
      entries.push(candidate);
    }
  }

  entries.sort((a, b) => a.month - b.month);
  return { entries, deletions };
}
