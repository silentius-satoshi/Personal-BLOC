import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';

// node env has no localStorage — minimal in-memory shim (defined BEFORE importing the store so its module-init
// writer-credential seed + escapeHatch's removeItem calls have something to read/write).
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
};

// Mock the relay-touching deps so resetAndResync's outcome is driven entirely by the test.
vi.mock('../../nostr/session', () => ({ restoreSigner: vi.fn() }));
vi.mock('../../nostr/sync', () => ({ fetchAndSync: vi.fn() }));
// Keep the real exports (DEFAULT_RELAYS is read by the store at module init) — mock only fetchUserRelays.
vi.mock('../../nostr/relays', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../nostr/relays')>()),
  fetchUserRelays: vi.fn(),
}));

import { restoreSigner } from '../../nostr/session';
import { fetchAndSync } from '../../nostr/sync';
import { fetchUserRelays } from '../../nostr/relays';
import { resetAndResync } from '../escapeHatch';
import * as storeMod from '../../../store/useStore';

const { useStore } = storeMod;
const STUB_SIGNER = {} as any;

beforeEach(() => {
  vi.clearAllMocks();
  mem.clear();
  // A signed-in owner with relays — the recovery precondition.
  useStore.getState().setNostrPubkey('owner-hex-pubkey');
  useStore.getState().setNostrRelays(['wss://relay.test']);
  useStore.getState().setWriterKeyWrapped('WRAPPED');
  useStore.getState().setWriterKeyWrapMeta({ iv: 'aXY=', scheme: 'pin', salt: 'c2FsdA==' });
  useStore.getState().setNostrSigner(null);   // isolation: the live-signer test sets it; a leak would skip restoreSigner elsewhere
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

describe('resetAndResync', () => {
  it('THE CRITICAL TEST — failed pull never publishes (relay data can never be erased)', async () => {
    vi.mocked(restoreSigner).mockResolvedValue(STUB_SIGNER);
    vi.mocked(fetchAndSync).mockResolvedValue(false);   // relays unreachable
    useStore.getState().setRecordsDirty(true);
    useStore.getState().setSettingsDirty(true);

    const pubSettingsSpy = vi.spyOn(storeMod, 'publishSettingsNow');
    const pubRecordsSpy  = vi.spyOn(storeMod, 'publishRecordsNow');

    const result = await resetAndResync({} as any);

    expect(result).toBe('no-relays');
    expect(pubSettingsSpy).not.toHaveBeenCalled();
    expect(pubRecordsSpy).not.toHaveBeenCalled();

    // Structural guarantee: the module references NO publish symbol, so a push is impossible by construction.
    const src = readFileSync(new URL('../escapeHatch.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/publishSettingsNow|publishRecordsNow/);
  });

  it('happy path — pull succeeds → ok, and dirty flags are cleared BEFORE the pull', async () => {
    vi.mocked(restoreSigner).mockResolvedValue(STUB_SIGNER);
    useStore.getState().setRecordsDirty(true);
    useStore.getState().setSettingsDirty(true);
    // At the instant the pull runs, the just-cleared empty state must already be NOT dirty.
    vi.mocked(fetchAndSync).mockImplementation(async () => {
      expect(useStore.getState().recordsDirty).toBe(false);
      expect(useStore.getState().settingsDirty).toBe(false);
      return true;
    });

    const result = await resetAndResync({} as any);

    expect(result).toBe('ok');
    expect(fetchAndSync).toHaveBeenCalledOnce();
  });

  it('reuses a live signer (no Face ID re-prompt) and resets the sync watermarks to 0 before the pull', async () => {
    useStore.getState().setNostrSigner(STUB_SIGNER);            // already-authenticated owner
    useStore.getState().setLastSettingsSyncAt(1_700_000_000);   // stale watermark from a prior sync
    useStore.getState().setLastRecordsSyncAt(1_700_000_000);
    // The pull must see the watermarks already reset to 0 (so the relay's settings re-hydrate immediately).
    vi.mocked(fetchAndSync).mockImplementation(async () => {
      expect(useStore.getState().lastSettingsSyncAt).toBe(0);
      expect(useStore.getState().lastRecordsSyncAt).toBe(0);
      return true;
    });

    const result = await resetAndResync({} as any);

    expect(result).toBe('ok');
    expect(restoreSigner).not.toHaveBeenCalled();   // live signer reused → no unwrapSecretKey → no Face ID
    expect(fetchAndSync).toHaveBeenCalledOnce();
  });

  it('no-auth — signer cannot be restored → no pull, no publish', async () => {
    vi.mocked(restoreSigner).mockResolvedValue(null);
    const result = await resetAndResync({} as any);
    expect(result).toBe('no-auth');
    expect(fetchAndSync).not.toHaveBeenCalled();
  });

  it('no-auth — restoreSigner throws → no pull', async () => {
    vi.mocked(restoreSigner).mockRejectedValue(new Error('Face ID cancelled'));
    const result = await resetAndResync({} as any);
    expect(result).toBe('no-auth');
    expect(fetchAndSync).not.toHaveBeenCalled();
  });

  it('zero-relays false-ok guard — empty relays + discovery returns none → no-relays, never pulls from nothing', async () => {
    vi.mocked(restoreSigner).mockResolvedValue(STUB_SIGNER);
    vi.mocked(fetchUserRelays).mockResolvedValue([]);   // discovery yields nothing
    useStore.getState().setNostrRelays([]);

    const result = await resetAndResync({} as any);

    expect(result).toBe('no-relays');
    expect(fetchAndSync).not.toHaveBeenCalled();   // never mistake a trivial empty-relay true for a real pull
  });
});
