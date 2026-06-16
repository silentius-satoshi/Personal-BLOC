import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage BEFORE the store import (vi.hoisted runs first).
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem:    (k: string) => mem.get(k) ?? null,
    setItem:    (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { useStore } from '../useStore';

describe('Simple Mode plan-bar toggles — device-local display prefs', () => {
  beforeEach(() => {
    useStore.setState({ showPlanIncomeBar: true, showPlanStrikeBar: true, showPlanCbBar: true } as never);
  });

  it('default to true', () => {
    const s = useStore.getState();
    expect(s.showPlanIncomeBar).toBe(true);
    expect(s.showPlanStrikeBar).toBe(true);
    expect(s.showPlanCbBar).toBe(true);
  });

  it('setters flip the value', () => {
    useStore.getState().setShowPlanIncomeBar(false);
    useStore.getState().setShowPlanStrikeBar(false);
    useStore.getState().setShowPlanCbBar(false);
    const s = useStore.getState();
    expect(s.showPlanIncomeBar).toBe(false);
    expect(s.showPlanStrikeBar).toBe(false);
    expect(s.showPlanCbBar).toBe(false);
  });

  it('are NOT synced (absent from SETTINGS_FIELDS): a remote settings payload cannot clobber them', () => {
    useStore.setState({ showPlanIncomeBar: false, income: 0 } as never);
    // hydrateSettings only applies the SETTINGS_FIELDS whitelist; the toggle must be ignored.
    useStore.getState().hydrateSettings({ showPlanIncomeBar: true, income: 1234 });
    expect(useStore.getState().showPlanIncomeBar).toBe(false);   // device-local — untouched
    expect(useStore.getState().income).toBe(1234);               // sanity: real synced field applied
  });
});
