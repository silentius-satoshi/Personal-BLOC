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

describe('validatePlanBackup — deposit/withdraw target (all three venues)', () => {
  it('accepts every known venue, on both kinds', () => {
    for (const kind of ['deposit', 'withdraw'] as const) {
      for (const target of ['strike', 'cb', 'cold'] as const) {
        expect(validatePlanBackup(withEvent({ kind, amount: 0.05, target })).ok,
          `${kind} → ${target}`).toBe(true);
      }
    }
  });

  it('⭐ rejects a PRESENT-but-unknown venue — it would restore clean, then silently vanish', () => {
    // isMonthlyMeaningful wants 'strike' and isColdMove wants 'cold', so an unknown venue is dropped as
    // journal-only by every consumer: a collateral move that disappears with no error anywhere.
    expect(validatePlanBackup(withEvent({ kind: 'deposit', amount: 0.05, target: 'vault' })).ok).toBe(false);
    expect(validatePlanBackup(withEvent({ kind: 'withdraw', amount: 0.05, target: 'vault' })).ok).toBe(false);
  });

  it('⭐ still accepts an ABSENT target — a backup this app wrote before the field existed', () => {
    // ⚠ The `!== undefined` arm is deliberate and must not be tightened: rejecting an absent target would
    // make a restore refuse a file this very app could have produced. Mirrors the draw/paydown rule.
    expect(validatePlanBackup(withEvent({ kind: 'deposit', amount: 0.05 })).ok).toBe(true);
    expect(validatePlanBackup(withEvent({ kind: 'withdraw', amount: 0.05 })).ok).toBe(true);
  });
});
