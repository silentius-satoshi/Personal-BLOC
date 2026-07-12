import { describe, it, expect } from 'vitest';
// Phase 4b — plan-events pure core. Node; no store import. Fold/union/compaction/genesis + the field partition.
import { foldPlanEvents, unionPlanEvents } from '../fold';
import { compactPlanEvents } from '../compact';
import { nextPlanEventTs, makePlanEventId, synthesizeGenesisEvents } from '../genesis';
import type { PlanEvent, PlanField, PlanState } from '../types';
import { SETTINGS_FIELDS, PREFS_FIELDS, PLAN_EVENT_FIELDS } from '../../../store/settingsFields';

const DAY = 24 * 60 * 60 * 1000;

// Fixture helper — id defaults to `${field}-${ts}` (unique per field+ts); override for tie-break tests.
const ev = (field: PlanField, ts: number, value: unknown, id?: string): PlanEvent =>
  ({ id: id ?? `${field}-${ts}`, ts, device: 'dev', kind: 'set', field, value });

describe('foldPlanEvents', () => {
  it('is order-independent (fold(reordered) ≡ fold(sorted))', () => {
    const e = [
      ev('income', 1, 1000), ev('expenses', 2, 500), ev('income', 3, 2000), ev('blocApr', 2, 13),
    ];
    const forward = foldPlanEvents(e);
    const reversed = foldPlanEvents([...e].reverse());
    const scrambled = foldPlanEvents([e[2], e[0], e[3], e[1]]);
    expect(reversed).toEqual(forward);
    expect(scrambled).toEqual(forward);
    expect(forward).toEqual({ income: 2000, expenses: 500, blocApr: 13 });
  });

  it('takes the latest value per field by ts', () => {
    expect(foldPlanEvents([ev('income', 5, 100), ev('income', 9, 300), ev('income', 7, 200)]))
      .toEqual({ income: 300 });
  });

  it('breaks a same-ts collision by id deterministically (higher id wins as the later sort position)', () => {
    // same field, same ts, different ids → (ts,id) sort puts 'income-5-b' after 'income-5-a' → b wins
    const a = ev('income', 5, 'A', 'income-5-a');
    const b = ev('income', 5, 'B', 'income-5-b');
    expect(foldPlanEvents([a, b])).toEqual({ income: 'B' });
    expect(foldPlanEvents([b, a])).toEqual({ income: 'B' });   // order-independent tie-break
  });

  it('leaves an unset field ABSENT (never seeds a default)', () => {
    const out = foldPlanEvents([ev('income', 1, 1000)]);
    expect('income' in out).toBe(true);
    expect('expenses' in out).toBe(false);
  });

  it('set-to-empty is DISTINCT from absent (§6): viewers=[] and blocStatementMinimum=null appear in output', () => {
    const out = foldPlanEvents([ev('viewers', 1, []), ev('blocStatementMinimum', 2, null)]);
    expect('viewers' in out).toBe(true);
    expect(out.viewers).toEqual([]);
    expect('blocStatementMinimum' in out).toBe(true);
    expect(out.blocStatementMinimum).toBeNull();
  });

  it('backupVerifiedAt folds latest-set-wins, including a null-valued set', () => {
    expect(foldPlanEvents([ev('backupVerifiedAt', 1, 111), ev('backupVerifiedAt', 2, null)]))
      .toEqual({ backupVerifiedAt: null });
    expect(foldPlanEvents([ev('backupVerifiedAt', 2, 222), ev('backupVerifiedAt', 1, 111)]))
      .toEqual({ backupVerifiedAt: 222 });
  });

  it('applies both halves of a same-ts AsOf pair', () => {
    const out = foldPlanEvents([
      ev('cbLoanBalance', 100, 60000, 'cbLoanBalance-100'),
      ev('cbLoanBalanceAsOf', 100, '2026-07-12', 'cbLoanBalanceAsOf-100'),
    ]);
    expect(out).toEqual({ cbLoanBalance: 60000, cbLoanBalanceAsOf: '2026-07-12' });
  });

  it('does not mutate its input', () => {
    const e = [ev('income', 3, 1), ev('income', 1, 2)];
    const snapshot = e.map((x) => x.id);
    foldPlanEvents(e);
    expect(e.map((x) => x.id)).toEqual(snapshot);
  });
});

describe('unionPlanEvents', () => {
  it('dedupes by id, keeping the first (append-only ids are unique; a dup is an identical echo)', () => {
    const a = [ev('income', 1, 100, 'x')];
    const b = [ev('income', 1, 100, 'x'), ev('expenses', 2, 500, 'y')];
    const u = unionPlanEvents(a, b);
    expect(u.map((e) => e.id)).toEqual(['x', 'y']);
  });

  it('returns a disjoint union sorted by (ts, id)', () => {
    const a = [ev('income', 3, 1, 'c'), ev('expenses', 1, 2, 'a')];
    const b = [ev('blocApr', 1, 3, 'b')];
    expect(unionPlanEvents(a, b).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('is idempotent (union(a, a) ≡ a, canonically ordered)', () => {
    const a = [ev('income', 2, 1, 'b'), ev('expenses', 1, 2, 'a')];
    expect(unionPlanEvents(a, a)).toEqual([a[1], a[0]]);
  });
});

describe('compactPlanEvents', () => {
  const NOW = 1_000_000_000_000;
  // income: latest@NOW, superseded-recent@(NOW-1d, kept), superseded-old@(NOW-100d, dropped)
  // expenses: sole event @(NOW-200d) — the latest, kept forever despite age
  const log = [
    ev('income', NOW, 300, 'income-new'),
    ev('income', NOW - 1 * DAY, 200, 'income-recent'),
    ev('income', NOW - 100 * DAY, 100, 'income-old'),
    ev('expenses', NOW - 200 * DAY, 500, 'expenses-ancient'),
  ];

  it('keeps latest-per-field forever, superseded <90d, drops superseded >90d', () => {
    const ids = compactPlanEvents(log, NOW).map((e) => e.id).sort();
    expect(ids).toEqual(['expenses-ancient', 'income-new', 'income-recent'].sort());
    expect(ids).not.toContain('income-old');
  });

  it('fold(compact(e, now)) ≡ fold(e) — the merge-safety proof (§7)', () => {
    expect(foldPlanEvents(compactPlanEvents(log, NOW))).toEqual(foldPlanEvents(log));
  });

  it('is idempotent', () => {
    const once = compactPlanEvents(log, NOW);
    expect(compactPlanEvents(once, NOW)).toEqual(once);
  });

  it('a stale device re-unioning compacted-away events does not change the fold', () => {
    const compacted = compactPlanEvents(log, NOW);
    const staleReintroduced = unionPlanEvents(compacted, [ev('income', NOW - 100 * DAY, 100, 'income-old')]);
    expect(foldPlanEvents(staleReintroduced)).toEqual(foldPlanEvents(log));
    // re-compaction sweeps the re-introduced stale event
    expect(compactPlanEvents(staleReintroduced, NOW).map((e) => e.id)).not.toContain('income-old');
  });
});

describe('genesis', () => {
  it('fold(synthesizeGenesisEvents(partition)) ≡ partition (load-bearing round-trip)', () => {
    const partition: Partial<PlanState> = {
      income: 5000, hasCbLoan: true, viewers: [], blocStatementMinimum: null,
    };
    expect(foldPlanEvents(synthesizeGenesisEvents(partition, 1000, 'dev'))).toEqual(partition);
  });

  it('emits present keys only — an absent partition key produces no event', () => {
    const events = synthesizeGenesisEvents({ income: 100 }, 1000, 'dev');
    expect(events.map((e) => e.field)).toEqual(['income']);
  });

  it('produces unique, monotonically-staggered ids and ts', () => {
    const partition: Partial<PlanState> = { income: 1, expenses: 2, blocApr: 3 };
    const events = synthesizeGenesisEvents(partition, 500, 'dev');
    const tss = events.map((e) => e.ts);
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(events.length);
    expect(new Set(tss).size).toBe(events.length);
    for (let i = 1; i < tss.length; i++) expect(tss[i]).toBeGreaterThan(tss[i - 1]);
    expect(ids.every((id) => id.startsWith('genesis-'))).toBe(true);
  });

  it('nextPlanEventTs is monotonic under a frozen clock', () => {
    const FROZEN = 5000;
    expect(nextPlanEventTs(0, FROZEN)).toBe(FROZEN);          // now dominates
    expect(nextPlanEventTs(FROZEN, FROZEN)).toBe(FROZEN + 1); // lastTs+1 dominates a tie
    expect(nextPlanEventTs(FROZEN + 100, FROZEN)).toBe(FROZEN + 101);
  });

  it('makePlanEventId formats field-ts-rand4 with an injectable rand', () => {
    expect(makePlanEventId('income', 42, () => 0)).toBe('income-42-0000');
    expect(makePlanEventId('income', 42, () => 0.999999)).toMatch(/^income-42-[0-9a-f]{4}$/);
  });
});

describe('field partition', () => {
  it('PLAN_EVENT_FIELDS ∪ PREFS_FIELDS set-equals SETTINGS_FIELDS', () => {
    expect(new Set([...PLAN_EVENT_FIELDS, ...PREFS_FIELDS])).toEqual(new Set(SETTINGS_FIELDS));
    expect(PLAN_EVENT_FIELDS.length + PREFS_FIELDS.length).toBe(SETTINGS_FIELDS.length);
    expect(PLAN_EVENT_FIELDS.length).toBe(33);
    expect(PREFS_FIELDS.length).toBe(4);
  });

  it('the two partitions are disjoint', () => {
    const prefs = new Set<string>(PREFS_FIELDS);
    expect(PLAN_EVENT_FIELDS.some((f) => prefs.has(f))).toBe(false);
  });

  it('backupVerifiedAt is a PLAN field (the R2a-1 amendment to the lock §3)', () => {
    expect((PLAN_EVENT_FIELDS as readonly string[]).includes('backupVerifiedAt')).toBe(true);
  });
});
