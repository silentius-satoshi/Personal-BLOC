import { describe, it, expect, vi } from 'vitest';

// Mock localStorage BEFORE the store import (vi.hoisted runs first) — partializeState + the module-init
// GATE_*/WK_* seeds touch it. Mirrors remotePlanFound.test.ts / backupGate.test.ts.
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

// R2c-2 — backupNagDismissed: session-transient, single-writer (the Dismiss button). Simpler than
// remotePlanFound (no module latch) — nothing re-writes it mid-session, so it stays dismissed until the next
// boot resets it. That per-session reappearance IS the escalation ladder.

describe('backupNagDismissed — field posture', () => {
  it('defaults to false', () => {
    expect(useStore.getState().backupNagDismissed).toBe(false);
  });

  it('is NEVER synced — absent from the settings payload', () => {
    expect('backupNagDismissed' in buildSettingsPayload(useStore.getState())).toBe(false);
  });

  // The omit pin: session-transient means it must NOT survive a reload. Persisting it would keep the nag
  // dismissed across launches, defeating the ladder (the nag must return each boot while unsatisfied).
  it('is EXCLUDED from partializeState (session-transient, must not persist)', () => {
    useStore.setState({ backupNagDismissed: true } as never);
    expect('backupNagDismissed' in partializeState(useStore.getState())).toBe(false);
    useStore.setState({ backupNagDismissed: false } as never);
  });
});

describe('backupNagDismissed — dismiss', () => {
  it('dismissBackupNag sets it true', () => {
    expect(useStore.getState().backupNagDismissed).toBe(false);
    useStore.getState().dismissBackupNag();
    expect(useStore.getState().backupNagDismissed).toBe(true);
    useStore.setState({ backupNagDismissed: false } as never);
  });
});
