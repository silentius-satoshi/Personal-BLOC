import { describe, it, expect, vi } from 'vitest';

// Mock localStorage BEFORE the store import (buildPlanBackup pulls useStore, whose module-init seeds touch it).
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { validatePlanBackup } from '../validatePlanBackup';
import { buildPlanBackup } from '../exportPlan';
import { useStore } from '../../../store/useStore';

// ⚠ SYNTHETIC round figures — this repo is public; never a real position.
const withEvent = (ev: Record<string, unknown>) => {
  const b = JSON.parse(JSON.stringify(buildPlanBackup(useStore.getState())));
  b.plan.records.dayLog = [{ id: 'e1', date: '2026-01-10', ts: 1, ...ev }];
  return b;
};

describe('validatePlanBackup — draw/paydown target + fee', () => {
  it('accepts a backup exported BEFORE Coinbase flows existed (no target = Strike)', () => {
    expect(validatePlanBackup(withEvent({ kind: 'draw', amount: 1000 })).ok).toBe(true);
  });

  it('accepts a Coinbase borrow with its fee, and a Coinbase paydown', () => {
    expect(validatePlanBackup(withEvent({ kind: 'draw', amount: 5000, target: 'cb', fee: 100 })).ok).toBe(true);
    expect(validatePlanBackup(withEvent({ kind: 'paydown', amount: 2000, target: 'cb' })).ok).toBe(true);
  });

  it('rejects an unknown venue', () => {
    expect(validatePlanBackup(withEvent({ kind: 'draw', amount: 5000, target: 'coinbase' })).ok).toBe(false);
  });

  it('rejects a non-numeric or negative fee', () => {
    expect(validatePlanBackup(withEvent({ kind: 'draw', amount: 5000, target: 'cb', fee: 'x' })).ok).toBe(false);
    expect(validatePlanBackup(withEvent({ kind: 'draw', amount: 5000, target: 'cb', fee: -1 })).ok).toBe(false);
  });
});
