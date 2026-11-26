import { describe, it, expect } from 'vitest';
import { compactPlanEvents, PLAN_LOG_BUDGET_BYTES } from '../compact';
import type { PlanEvent } from '../types';

/**
 * Hardening 2 — compact.ts's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HY.json).
 */
describe('Hardening 2 — compact', () => {
  it('HY-02 · sync.md "The plan log stays inside one publishable event" — the budget counts UTF-8 bytes, not code units', () => {
    // 150 settings of one field, a minute apart (no burst), each 100 two-byte characters: 150 × ~275 B ≈ 41 KB of history.
    const now = 200 * 86_400_000;
    const log: PlanEvent[] = Array.from({ length: 150 }, (_, i) => ({
      id: `e${String(i).padStart(3, '0')}`, ts: now - (149 - i) * 60_000, device: 'd', kind: 'set',
      field: 'note' as never, value: 'é'.repeat(100),
    }));
    const kept = compactPlanEvents(log, now);
    expect(kept.length, 'HY-02 premise: the trim ran').toBeLessThan(150);
    const bytes = new TextEncoder().encode(JSON.stringify({ events: kept })).length;
    expect(bytes, 'HY-02 the payload, in bytes, inside the budget').toBeLessThanOrEqual(PLAN_LOG_BUDGET_BYTES);
  });
});
