import { describe, it, expect, vi } from 'vitest';

// Phase 4e — plan-log coverage (flag A of the 4e build plan). After 4e the log is the only plan channel, so a plan
// field held at a non-seed value that the log never carried would return as its seed on a new device. The helper is
// pure; the real-store case pins the seed source (the store's pre-hydration initial state) and the emit path.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planLogGaps } from '../coverage';
import { useStore } from '../../../store/useStore';

const evt = (field: string, value: unknown, ts = 5) => ({ id: `${field}-${ts}-a`, ts, device: 'd', kind: 'set' as const, field, value });

describe('4e — plan-log coverage', () => {
  it('COVERAGE — lists a non-seed field the log lacks; skips seed-valued and logged fields', () => {
    const seed = { income: 4000, expenses: 3500, creditLine: 10000 };
    const live = { income: 5150, expenses: 3600, creditLine: 10000 };
    expect(planLogGaps([evt('income', 5150)] as never, live, seed), 'COVERAGE').toEqual(['expenses']);
    expect(planLogGaps([evt('income', 5150), evt('expenses', 3600)] as never, live, seed), 'COVERAGE none').toEqual([]);
  });

  it('COVERAGE — real store: a raw write is a gap until an emit carries it', () => {
    useStore.setState({ planEvents: [] } as never);
    const gaps = () => planLogGaps(useStore.getState().planEvents, useStore.getState() as never, useStore.getInitialState() as never);
    expect(gaps(), 'COVERAGE fresh store').toEqual([]);
    useStore.setState({ expenses: 3600 } as never);   // what a pre-4c edit the log never carried looks like
    expect(gaps(), 'COVERAGE raw').toEqual(['expenses']);
    useStore.getState().setExpenses(3600);              // re-saving the field emits it
    expect(gaps(), 'COVERAGE emitted').toEqual([]);
  });

  it('COVERAGE — DevPanel reads it against the seed state', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', 'components', 'Settings', 'DevPanel.tsx'), 'utf8');
    expect(src, 'COVERAGE row').toMatch(/planLogGaps\(planEvents, useStore\.getState\(\) as unknown as Record<string, unknown>, useStore\.getInitialState\(\) as unknown as Record<string, unknown>\)/);
    expect(src, 'COVERAGE row').toMatch(/>log gaps</);
  });
});
