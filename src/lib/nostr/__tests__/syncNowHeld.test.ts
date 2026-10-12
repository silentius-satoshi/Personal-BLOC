import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem:    (k: string) => mem.get(k) ?? null,
    setItem:    (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

// The pull is mocked (it would reach relays); the publish engine and the store are real.
vi.mock('../sync', () => ({ fetchAndSync: vi.fn().mockResolvedValue({ ok: true, planFound: true }) }));

import { useStore } from '../../../store/useStore';
import { syncNow } from '../syncNow';
import { getNostrLog, clearNostrLog } from '../log';

// 5c (spec `pbloc-spec-plan-load-guard-v1`) — a publish HELD because this device hasn't loaded the plan is not a signer
// problem: syncNow says so and does not raise Reconnect (5b's "TOO LARGE" rule, extended).

beforeEach(() => {
  clearNostrLog();
  useStore.setState({
    nostrAuthEnabled: true, keyProvenance: 'external', planLoaded: false, viewerMode: false, backupVerifiedAt: null,
    isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', nostrSigningMethod: 'nip07', nostrRelays: ['wss://a'],
    planDirty: true, recordsDirty: true, prefsDirty: false, nostrReconnectNeeded: false, pendingViewerRevocations: [],
  } as never);
});

describe('⭐ HELD LABEL — syncNow on a device without the plan', () => {
  it('both channels HELD; Reconnect not raised; the log says why', async () => {
    expect(await syncNow({} as never)).toBe(false);
    expect(useStore.getState().nostrReconnectNeeded).toBe(false);
    const line = getNostrLog().map((e) => e.msg).find((m) => m.startsWith('sync incomplete'))!;
    expect(line).toContain('records HELD');
    expect(line).toContain('plan HELD');
    expect(line).toContain('held until the plan loads here, not a signer problem');
    expect(useStore.getState().planDirty).toBe(true);
    expect(useStore.getState().recordsDirty).toBe(true);
  });
});
