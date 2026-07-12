import { describe, it, expect, vi } from 'vitest';

// Mock localStorage BEFORE the store import (vi.hoisted runs first) — partializeState + the module-init
// GATE_*/WK_* seeds touch it. Mirrors simpleView.test.ts / backupGate.test.ts.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem:    (k: string) => mem.get(k) ?? null,
    setItem:    (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { useStore, partializeState } from '../useStore';
import { buildSettingsPayload } from '../payloads';

// R2b-2 — remotePlanFound: session-transient tri-state, written exactly once per session by syncNow's first
// owner pull, dismissible to null without ever re-opening.

describe('remotePlanFound — field posture', () => {
  it('defaults to null (not yet determined)', () => {
    expect(useStore.getState().remotePlanFound).toBeNull();
  });

  it('is NEVER synced — absent from the settings payload', () => {
    expect('remotePlanFound' in buildSettingsPayload(useStore.getState())).toBe(false);
  });

  // The omit pin: session-transient means it must NOT survive a reload. If someone drops it from
  // partializeState's destructure it would ride ...rest and persist, and a dismissed notice would come back
  // as a *stale false* on the next boot before any pull had run.
  it('is EXCLUDED from partializeState (session-transient, must not persist)', () => {
    useStore.setState({ remotePlanFound: false } as never);
    expect('remotePlanFound' in partializeState(useStore.getState())).toBe(false);
    useStore.setState({ remotePlanFound: null } as never);
  });
});

describe('remotePlanFound — set-once latch', () => {
  // ONE test by design: the latch is module-level and vitest isolates the module registry per FILE, so it is
  // fresh here but shared across `it` blocks. Asserting the whole lifecycle in sequence is the honest shape.
  it('records once per session; a later record is ignored; Dismiss cannot be re-opened', () => {
    // 1. the first owner pull finds nothing
    useStore.getState().recordRemotePlanFound(false);
    expect(useStore.getState().remotePlanFound).toBe(false);

    // 2. a second pull (foreground/visibility) must NOT overwrite it
    useStore.getState().recordRemotePlanFound(true);
    expect(useStore.getState().remotePlanFound).toBe(false);

    // 3. the user dismisses the notice
    useStore.getState().setRemotePlanFound(null);
    expect(useStore.getState().remotePlanFound).toBeNull();

    // 4. ⚠ THE POINT: the next foreground syncNow must not resurrect the notice. A bare `=== null` guard
    //    (instead of the latch) would write `false` here and the banner would reappear.
    useStore.getState().recordRemotePlanFound(false);
    expect(useStore.getState().remotePlanFound).toBeNull();
  });
});
