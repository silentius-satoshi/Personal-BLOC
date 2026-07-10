import { describe, it, expect, beforeEach } from 'vitest';

// node env has no localStorage/sessionStorage — minimal in-memory shims, installed BEFORE the module import
// (storeCrypto's clearStoreEncryptionState reaches for localStorage). Same shim as escapeHatch.test.
const local = new Map<string, string>();
const session = new Map<string, string>();
const shim = (mem: Map<string, string>) => ({
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
});
(globalThis as any).localStorage = shim(local);
(globalThis as any).sessionStorage = shim(session);

import { wipeLocalPlanData } from '../wipeLocalPlanData';

// ⭐ THE CONTRACT. This is the classified key inventory from wipeLocalPlanData's doc comment, executable. A new
// storage key added to the app without classifying it here means an identity-forget silently leaves it behind.
const PLAN_LOCAL_KEYS = [
  'personal-bloc-store',                      // the persist blob
  'personal-bloc-store-enc-enabled',
  'personal-bloc-store-enc-pending-decrypt',
  'personal-bloc-writer-key-wrapped',         // key material
  'personal-bloc-writer-key-meta',
  'personal-bloc-onboarded',                  // ⚠ standalone, NOT blob-resident — see below
  'personal-bloc-nostr-pubkey',
  'personal-bloc-nostr-auth',
  'personal-bloc-nostr-method',
];
const PLAN_SESSION_KEYS = ['bloc-nostr-log'];
const DEVICE_LOCAL_KEYS = ['bloc-device-tag'];

beforeEach(() => {
  local.clear();
  session.clear();
  for (const k of [...PLAN_LOCAL_KEYS, ...DEVICE_LOCAL_KEYS]) local.set(k, 'seeded');
  for (const k of PLAN_SESSION_KEYS) session.set(k, 'seeded');
});

describe('wipeLocalPlanData — the key inventory is the contract', () => {
  it.each(PLAN_LOCAL_KEYS)('removes the plan-scoped localStorage key %s', (key) => {
    wipeLocalPlanData();
    expect(local.get(key)).toBeUndefined();
  });

  it.each(PLAN_SESSION_KEYS)('removes the plan-scoped sessionStorage key %s', (key) => {
    wipeLocalPlanData();
    expect(session.get(key)).toBeUndefined();
  });

  it.each(DEVICE_LOCAL_KEYS)('RETAINS the device-level key %s', (key) => {
    wipeLocalPlanData();
    expect(local.get(key)).toBe('seeded');
  });

  // ⚠ The half-fix this whole change exists to prevent. `personal-bloc-onboarded` is a STANDALONE key seeded into
  // the store's initial state at module init — not a blob field. Wipe only `personal-bloc-store` and
  // onboardingComplete survives → the fresh entry fork never renders → the identity-less shell shows the (now
  // seeded, but previously hydrated) app instead of ChoosePathView.
  it('removes personal-bloc-onboarded, not just the blob — this is what produces the fresh entry fork', () => {
    wipeLocalPlanData();
    expect(local.get('personal-bloc-store')).toBeUndefined();
    expect(local.get('personal-bloc-onboarded')).toBeUndefined();
  });

  it('leaves nothing behind but the device tag', () => {
    wipeLocalPlanData();
    expect([...local.keys()]).toEqual(DEVICE_LOCAL_KEYS);
    expect([...session.keys()]).toEqual([]);
  });

  it('is idempotent and never throws on an already-clean device', () => {
    local.clear();
    session.clear();
    expect(() => { wipeLocalPlanData(); wipeLocalPlanData(); }).not.toThrow();
    expect([...local.keys()]).toEqual([]);
  });
});
