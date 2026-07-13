import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { useStore } from '../useStore';
import { CURRENT_STORE_VERSION } from '../../lib/storeVersion';
import { isBackupGateSatisfied } from '../../lib/backupGate';
import type { PlanBackup } from '../../lib/backup/exportPlan';

// A backup whose dayLog carries a strikeCollateral-bearing balanceReading + a cbCollateral, so the folded derives
// produce determinate values (1.23 / 2.5) regardless of the pre-import caches.
const backup = (settings: Record<string, unknown>): PlanBackup => ({
  format: 'personal-bloc-plan-backup',
  schemaVersion: 1,
  storeVersion: CURRENT_STORE_VERSION,
  exportedAt: '2026-01-06T00:00:00.000Z',
  plan: {
    settings,
    records: {
      monthlyLog: [],
      deletedMonths: {},
      dayLog: [
        {
          id: 'e1', date: '2026-01-05', ts: 1000, kind: 'balanceReading',
          reading: { strikeBal: 5000, strikeLtv: 0.1, strikeCollateral: 1.23, cbBal: 60000, cbLtv: 0.5, cbCollateral: 2.5 },
        },
      ] as never,
      deletedDayEvents: {},
    },
  },
});

const seedGated = () => useStore.setState({
  keyProvenance: 'generated', backupVerifiedAt: null,
  income: 4000, expenses: 3500,
  viewers: [{ index: 0, pubkeyHex: 'aa', npub: 'npub1x', label: 'Dad', tier: 'safe', keyVersion: 1 }],
  nextViewerIndex: 1,
  nostrRelays: ['wss://my-custom-relay'],
  cbCollateralBtc: 9.9, strikeCollateralBtc: 8.8,
  initialSettingsPullDone: false,
  isAuthenticated: false, nostrSigner: null,
} as never);

beforeEach(seedGated);
afterEach(() => vi.restoreAllMocks());

describe('applyPlanBackup', () => {
  it('applies the settings partition (APPLY_FIELDS) — income/expenses replaced', () => {
    useStore.getState().applyPlanBackup(backup({ income: 7777, expenses: 3333 }));
    expect(useStore.getState().income).toBe(7777);
    expect(useStore.getState().expenses).toBe(3333);
  });

  it('NEVER writes backupVerifiedAt — a generated-unverified key STAYS gated after import', () => {
    // even a backup carrying a stamp must not open the gate
    useStore.getState().applyPlanBackup(backup({ income: 1, backupVerifiedAt: 1_700_000_000_000 }));
    expect(useStore.getState().backupVerifiedAt).toBeNull();
    expect(useStore.getState().keyProvenance).toBe('generated');
    expect(isBackupGateSatisfied({
      keyProvenance: useStore.getState().keyProvenance,
      backupVerifiedAt: useStore.getState().backupVerifiedAt,
    })).toBe(false);
  });

  it('does NOT touch the transport fields (viewer roster + relays)', () => {
    useStore.getState().applyPlanBackup(backup({ viewers: [], nextViewerIndex: 99, nostrRelays: ['wss://foreign'] }));
    expect(useStore.getState().viewers).toHaveLength(1);         // seeded roster preserved
    expect(useStore.getState().nextViewerIndex).toBe(1);
    expect(useStore.getState().nostrRelays).toEqual(['wss://my-custom-relay']);
  });

  it('sets initialSettingsPullDone true (first-pull exception can no longer clobber the import)', () => {
    useStore.getState().applyPlanBackup(backup({ income: 1 }));
    expect(useStore.getState().initialSettingsPullDone).toBe(true);
  });

  it('folds the collateral caches from the imported dayLog even when the pre-import caches disagree', () => {
    expect(useStore.getState().cbCollateralBtc).toBe(9.9);       // pre-import (wrong)
    expect(useStore.getState().strikeCollateralBtc).toBe(8.8);
    useStore.getState().applyPlanBackup(backup({ income: 1 }));
    expect(useStore.getState().cbCollateralBtc).toBe(2.5);        // derived from the imported reading
    expect(useStore.getState().strikeCollateralBtc).toBe(1.23);
  });

  it('replaces the records wholesale + marks dirty (4c: planDirty + recordsDirty, NOT settingsDirty)', () => {
    useStore.getState().applyPlanBackup(backup({ income: 1 }));
    expect(useStore.getState().monthlyLog).toEqual([]);
    expect(useStore.getState().dayLog).toHaveLength(1);
    expect(useStore.getState().planDirty).toBe(true);
    expect(useStore.getState().recordsDirty).toBe(true);
  });

  it('4c: APPLY_FIELDS become plan-field scalars AND appended plan events, atomically', () => {
    useStore.getState().applyPlanBackup(backup({ income: 7777, expenses: 3333 }));
    expect(useStore.getState().income).toBe(7777);                                   // scalar (parity)
    const evs = useStore.getState().planEvents;
    expect(evs.some((e) => e.field === 'income' && e.value === 7777)).toBe(true);    // + a plan event
    expect(evs.some((e) => e.field === 'expenses' && e.value === 3333)).toBe(true);
    // backupVerifiedAt is APPLY_FIELDS-excluded → never an event (the gate stays shut)
    expect(evs.some((e) => e.field === 'backupVerifiedAt')).toBe(false);
  });
});
