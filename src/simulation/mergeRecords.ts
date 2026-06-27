import type { MonthlyLogEntry, DayEvent } from './types';

export interface RecordsState {
  entries:   MonthlyLogEntry[];
  deletions: Record<number, number>;   // month → deletedAt (Unix ms); tombstones for synced deletes
  // Daily Mode P3 — the granular journal rides the SAME records:v1 channel as entries.
  dayLog:          DayEvent[];
  dayLogDeletions: Record<string, number>;   // event id → deletedAt (Unix ms); tombstones for synced dayLog deletes
}

const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;   // 90 days

const entryTs = (e: MonthlyLogEntry): number => e.updatedAt ?? e.loggedAt ?? 0;

/**
 * Deterministic merge of two records states across BOTH collections. Months: union by month; the newer
 * entry (updatedAt, falling back to loggedAt) wins; a deletion tombstone newer than the winning entry
 * deletes the month; an entry newer than the tombstone survives (re-log) and drops it. DayLog (P3):
 * union by event id; the higher-ts event wins (edits replace in place); a tombstone strictly newer than
 * the event suppresses it; an event at/after its tombstone survives (edit-after-delete) and drops it.
 * Both maps GC tombstones older than 90 days. Idempotent — applying any fetched state is always safe.
 */
export function mergeRecords(
  local: RecordsState,
  remote: RecordsState,
  opts: { preferLocalOnTie: boolean },
): RecordsState {
  const now = Date.now();

  // --- monthlyLog (entries) merge — UNCHANGED from P2a ---
  // JSON-parsed deletions keys are strings while entry months are numbers — coerce the union.
  const months = new Set<number>();
  for (const e of local.entries)  months.add(e.month);
  for (const e of remote.entries) months.add(e.month);
  for (const k of Object.keys(local.deletions))  months.add(Number(k));
  for (const k of Object.keys(remote.deletions)) months.add(Number(k));

  const entries: MonthlyLogEntry[] = [];
  const deletions: Record<number, number> = {};

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

  // --- dayLog merge (P3) — union by id, higher ts wins; tombstone suppression (strict >), 90-day GC ---
  const ids = new Set<string>();
  for (const e of local.dayLog)  ids.add(e.id);
  for (const e of remote.dayLog) ids.add(e.id);
  for (const k of Object.keys(local.dayLogDeletions))  ids.add(k);
  for (const k of Object.keys(remote.dayLogDeletions)) ids.add(k);

  const dayLog: DayEvent[] = [];
  const dayLogDeletions: Record<string, number> = {};

  for (const id of ids) {
    const l = local.dayLog.find((e) => e.id === id);
    const r = remote.dayLog.find((e) => e.id === id);

    // Higher ts wins (edit replaces in place); exact tie → local.
    const candidate: DayEvent | undefined = l && r ? (r.ts > l.ts ? r : l) : (l ?? r);

    const d = Math.max(local.dayLogDeletions[id] ?? 0, remote.dayLogDeletions[id] ?? 0);

    if (!candidate) {
      if (d > 0 && d >= now - TOMBSTONE_TTL_MS) dayLogDeletions[id] = d;
    } else if (d > candidate.ts) {
      // Tombstone strictly newer than the event — suppressed (deleted).
      if (d >= now - TOMBSTONE_TTL_MS) dayLogDeletions[id] = d;
    } else {
      // Event at/after its tombstone — it survives (edit-after-delete); drop the stale tombstone.
      dayLog.push(candidate);
    }
  }

  // Deterministic, idempotent ordering: ts asc, id tiebreak.
  dayLog.sort((a, b) => (a.ts - b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { entries, deletions, dayLog, dayLogDeletions };
}
