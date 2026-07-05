import { describe, it, expect } from 'vitest';

// Mock localStorage BEFORE the store import (vi.hoisted runs first).
import { vi } from 'vitest';
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem:    (k: string) => mem.get(k) ?? null,
    setItem:    (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { useStore, buildSettingsPayload, migrateState, partializeState } from '../useStore';

// Owner IA — dashboard-first. simpleView is a persisted DEVICE-LOCAL pref (rides partializeState's ...rest,
// NEVER synced). Default changes to 'dashboard'; migrate-default only (a persisted choice is preserved).
describe('simpleView — dashboard-first default (device-local, migrate-default only)', () => {
  it('fresh store defaults to dashboard', () => {
    expect(useStore.getState().simpleView).toBe('dashboard');
  });

  it('setter accepts all three values', () => {
    useStore.getState().setSimpleView('monthly');
    expect(useStore.getState().simpleView).toBe('monthly');
    useStore.getState().setSimpleView('daily');
    expect(useStore.getState().simpleView).toBe('daily');
    useStore.getState().setSimpleView('dashboard');
    expect(useStore.getState().simpleView).toBe('dashboard');
  });

  it('is device-local: absent from the synced settings payload', () => {
    expect('simpleView' in buildSettingsPayload(useStore.getState())).toBe(false);
  });

  it('rides partializeState (persisted, not in the omit list)', () => {
    useStore.getState().setSimpleView('monthly');
    expect(partializeState(useStore.getState()).simpleView).toBe('monthly');
  });

  it('migrate-default only: a persisted simpleView is preserved (never clobbered to dashboard)', () => {
    const migrated = migrateState({ simpleView: 'monthly' });
    expect(migrated.simpleView).toBe('monthly');
  });
});
