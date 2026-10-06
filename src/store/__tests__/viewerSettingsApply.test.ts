import { describe, it, expect, vi } from 'vitest';

// Phase 4e — the trusted viewer's plan hydrate, on the REAL store (viewerSync.test.ts mocks the applier, so it can't see
// what the whitelist keeps). Before 4e the viewer hydrated through hydrateSettings; the 4e spec's rename to a 4-key
// hydratePrefs would have dropped every plan field on every trusted viewer while the mocked tests stayed green.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { useStore } from '../useStore';
import { buildViewerSnapshotPayload } from '../payloads';
import { SETTINGS_FIELDS, VIEWER_SETTINGS_FIELDS, VIEWER_SNAPSHOT_STRIP } from '../settingsFields';

describe('Phase 4e — applyViewerSettings (the trusted viewer snapshot apply)', () => {
  it('VIEWER — a trusted snapshot lands the owner\'s plan fields in the viewer\'s store', () => {
    useStore.setState({ planEvents: [], planDirty: false, prefsDirty: false } as never);
    useStore.getState().applyViewerSettings({
      income: 6100, expenses: 4200, creditLine: 25000, blocApr: 11, cbLoanBalance: 33000, cbLtvTargetPct: 50,
      hasCbLoan: true, coldStorageBtc: 0.4, simpleMode: true,
    });
    const s = useStore.getState();
    expect([s.income, s.expenses, s.creditLine, s.blocApr, s.cbLoanBalance, s.cbLtvTargetPct], 'VIEWER plan')
      .toEqual([6100, 4200, 25000, 11, 33000, 50]);
    expect(s.hasCbLoan, 'VIEWER plan').toBe(true);
    expect(s.coldStorageBtc, 'VIEWER plan').toBe(0.4);
    expect(s.simpleMode, 'VIEWER prefs ride the snapshot too').toBe(true);
    expect([s.planEvents.length, s.planDirty, s.prefsDirty], 'RAW').toEqual([0, false, false]);
  });

  it('VIEWER — a snapshot can never write the viewer\'s relays, roster, gate stamp or the cold anchor\'s stamp', () => {
    const before = useStore.getState();
    const relays = before.nostrRelays, viewers = before.viewers, next = before.nextViewerIndex;
    const verified = before.backupVerifiedAt, coldAsOf = before.coldStorageBtcAsOf;
    useStore.getState().applyViewerSettings({
      nostrRelays: ['wss://foreign'], viewers: [{ pubkeyHex: 'x', index: 9 }], nextViewerIndex: 10,
      backupVerifiedAt: 123, coldStorageBtcAsOf: 456, income: 1,
    });
    const s = useStore.getState();
    expect(s.nostrRelays, 'VIEWER strip').toEqual(relays);
    expect(s.viewers, 'VIEWER strip').toEqual(viewers);
    expect(s.nextViewerIndex, 'VIEWER strip').toBe(next);
    expect(s.backupVerifiedAt, 'VIEWER strip').toBe(verified);
    expect(s.coldStorageBtcAsOf, 'VIEWER strip').toBe(coldAsOf);
    expect(s.income, 'VIEWER strip: the rest still lands').toBe(1);
  });

  it('VIEWER — one definition: the applier\'s whitelist IS the trusted snapshot\'s settings key set', () => {
    const snap = buildViewerSnapshotPayload(useStore.getState(), 'trusted');
    expect(Object.keys(snap.settings ?? {}).sort(), 'VIEWER keys').toEqual([...VIEWER_SETTINGS_FIELDS].sort());
    expect([...VIEWER_SETTINGS_FIELDS, ...VIEWER_SNAPSHOT_STRIP].sort(), 'VIEWER keys').toEqual([...SETTINGS_FIELDS].sort());
  });

  it('PREFS — hydratePrefs lands the four prefs keys and nothing else (no plan scalar without its event)', () => {
    const before = useStore.getState().income;
    useStore.setState({ planEvents: [], planDirty: false, prefsDirty: false } as never);
    useStore.getState().hydratePrefs({ simpleMode: false, btcBuyingUnit: 'sats', income: 999999, backupVerifiedAt: 1 });
    const s = useStore.getState();
    expect(s.simpleMode, 'PREFS').toBe(false);
    expect(s.btcBuyingUnit, 'PREFS').toBe('sats');
    expect(s.income, 'PREFS whitelist').toBe(before);
    expect(s.backupVerifiedAt, 'PREFS whitelist').not.toBe(1);
    expect([s.planEvents.length, s.planDirty, s.prefsDirty], 'RAW').toEqual([0, false, false]);
  });
});
