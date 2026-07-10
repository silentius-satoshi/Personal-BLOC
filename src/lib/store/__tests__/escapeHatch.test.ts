import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';

// node env has no localStorage/window — minimal in-memory shims (defined BEFORE importing the store so its module-init
// writer-credential seed + escapeHatch's removeItem/reload calls have something to read/write).
const mem = new Map<string, string>();
const lsShim = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
};
(globalThis as any).localStorage = lsShim;
const reloadMock = vi.fn();
(globalThis as any).window = { location: { reload: reloadMock }, localStorage: lsShim };

// Keep the real exports (DEFAULT_RELAYS is read by the store at module init) — mock only fetchUserRelays.
vi.mock('../../nostr/relays', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../nostr/relays')>()),
  fetchUserRelays: vi.fn(),
}));

import { resetAndResync, resetAndResyncConfirmMessage } from '../escapeHatch';
import { setStoreKey, isStoreUnlocked } from '../storeCrypto';
import * as storeMod from '../../../store/useStore';

const { useStore } = storeMod;

beforeEach(() => {
  vi.clearAllMocks();   // resets reloadMock call history between cases
  mem.clear();
  // A signed-in owner with relays — the recovery precondition (used by the resetPlanToSeeds suite).
  useStore.getState().setNostrPubkey('owner-hex-pubkey');
  useStore.getState().setNostrRelays(['wss://relay.test']);
  useStore.getState().setWriterKeyWrapped('WRAPPED');
  useStore.getState().setWriterKeyWrapMeta({ iv: 'aXY=', scheme: 'pin', salt: 'c2FsdA==' });
  setStoreKey(null);
});

describe('resetPlanToSeeds', () => {
  it('resets plan/records/strike to seeds but PRESERVES identity + writer credential', () => {
    const s = useStore.getState();
    s.setIncome(9999); s.setExpenses(8888); s.setCreditLine(50000);
    s.setMonthlyLog([{ month: 1, btcBought: 0.5, blocDraw: 1000, loggedAt: 1 } as any]);
    useStore.setState({ strikeUsdBalance: 1234, strikeBtcAvailable: 0.9, strikeRate: 50000, deletedMonths: { 3: 1 } });

    useStore.getState().resetPlanToSeeds();

    const after = useStore.getState();
    expect(after.income).toBe(4000);
    expect(after.expenses).toBe(3500);
    expect(after.creditLine).toBe(10000);
    expect(after.cbLoanBalance).toBe(60000);
    expect(after.cbPaymentStrategy).toBe('monthly');
    expect(after.monthlyLog).toEqual([]);
    expect(after.deletedMonths).toEqual({});
    expect(after.strikeUsdBalance).toBeNull();
    expect(after.strikeBtcAvailable).toBeNull();
    expect(after.strikeRate).toBeNull();
    // PRESERVED — needed to re-auth + pull.
    expect(after.writerKeyWrapped).toBe('WRAPPED');
    expect(after.writerKeyWrapMeta).toEqual({ iv: 'aXY=', scheme: 'pin', salt: 'c2FsdA==' });
    expect(after.nostrPubkey).toBe('owner-hex-pubkey');
    expect(after.nostrRelays).toEqual(['wss://relay.test']);
  });
});

describe('resetAndResync (reload-based teardown)', () => {
  it('clears the enc flag + pending-decrypt marker + on-disk blob + in-memory key, then reloads', () => {
    // Simulate a flag-on, unlocked, encrypted-blob session.
    localStorage.setItem('personal-bloc-store-enc-enabled', '1');
    localStorage.setItem('personal-bloc-store-enc-pending-decrypt', '1');
    localStorage.setItem('personal-bloc-store', JSON.stringify({ ct: 'cipher', iv: 'iv' }));
    setStoreKey({} as any);   // unlocked
    expect(isStoreUnlocked()).toBe(true);

    resetAndResync();

    // All four cleared → a later plaintext-adapter load can't misread a stale {ct,iv} envelope.
    expect(localStorage.getItem('personal-bloc-store-enc-enabled')).toBeNull();
    expect(localStorage.getItem('personal-bloc-store-enc-pending-decrypt')).toBeNull();
    expect(localStorage.getItem('personal-bloc-store')).toBeNull();
    expect(isStoreUnlocked()).toBe(false);
    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it('is idempotent — reloads even with no flag/blob/key set (no throw)', () => {
    expect(() => resetAndResync()).not.toThrow();
    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it('THE STRUCTURAL GUARANTEE — the module references NO publish symbol (a push is impossible by construction)', () => {
    const src = readFileSync(new URL('../escapeHatch.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/publishSettingsNow|publishRecordsNow/);
  });
});

// R2c-6-final (bypass 1): a generated-unverified key has no relay copy, so "reloads from the relays" is a lie and
// resetting deletes the plan permanently — the confirm must say so.
describe('resetAndResyncConfirmMessage', () => {
  it('warns of permanent loss (never promises the relay) when never synced', () => {
    const msg = resetAndResyncConfirmMessage(true);
    expect(msg).toContain('deletes it permanently');
    expect(msg).toContain('Save your Recovery Key first');
    expect(msg).not.toMatch(/reloads it from the relays|stays on the relay/);
  });

  it('the normal branch promises the relay + warns about unsynced changes', () => {
    const msg = resetAndResyncConfirmMessage(false);
    expect(msg).toContain('reloads it from the relays');
    expect(msg).toContain('not yet synced will be lost');
  });
});
