import { describe, it, expect, beforeEach, vi } from 'vitest';

// node env has no localStorage — minimal in-memory shim (defined BEFORE any import of the store). The store's
// module-init seed IIFE reads these GATE_* keys; freshStore() re-imports the module so the IIFE runs against
// whatever we've staged in `mem`.
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
};

const ONB = 'personal-bloc-onboarded';
const AUTH = 'personal-bloc-nostr-auth';
const METHOD = 'personal-bloc-nostr-method';
const PUBKEY = 'personal-bloc-nostr-pubkey';
const BLOB = 'personal-bloc-store';

// Re-evaluate useStore from scratch so the module-init seed IIFE runs against the current `mem` contents.
async function freshStore() {
  vi.resetModules();
  return (await import('../useStore')).useStore;
}

beforeEach(() => { mem.clear(); vi.resetModules(); });

describe('gate-condition fields — standalone localStorage (3a.4)', () => {
  it('seeds the store initial state from the GATE_* keys (encrypted cold-start bootstrap)', async () => {
    mem.set(ONB, '1'); mem.set(AUTH, '1'); mem.set(METHOD, 'local'); mem.set(PUBKEY, 'abc123');
    const useStore = await freshStore();
    const s = useStore.getState();
    expect(s.onboardingComplete).toBe(true);
    expect(s.nostrAuthEnabled).toBe(true);
    expect(s.nostrSigningMethod).toBe('local');
    expect(s.nostrPubkey).toBe('abc123');
  });

  it('fresh install (no GATE_* keys) → false/false/null/null — IDENTICAL to today’s constants', async () => {
    const useStore = await freshStore();
    const s = useStore.getState();
    expect(s.onboardingComplete).toBe(false);
    expect(s.nostrAuthEnabled).toBe(false);
    expect(s.nostrSigningMethod).toBeNull();
    expect(s.nostrPubkey).toBeNull();
  });

  it('back-fills the GATE_* keys from a PLAINTEXT blob (one-time, existing user)', async () => {
    mem.set(BLOB, JSON.stringify({
      state: { onboardingComplete: true, nostrAuthEnabled: true, nostrSigningMethod: 'local', nostrPubkey: 'deadbeef' },
      version: 18,
    }));
    const useStore = await freshStore();
    expect(mem.get(ONB)).toBe('1');
    expect(mem.get(AUTH)).toBe('1');
    expect(mem.get(METHOD)).toBe('local');
    expect(mem.get(PUBKEY)).toBe('deadbeef');
    const s = useStore.getState();
    expect(s.onboardingComplete).toBe(true);
    expect(s.nostrPubkey).toBe('deadbeef');
  });

  it('does NOT back-fill from an ENCRYPTED blob ({ct,iv}) — stays at fresh defaults', async () => {
    mem.set(BLOB, JSON.stringify({ ct: 'x', iv: 'y' }));
    const useStore = await freshStore();
    expect(mem.get(ONB)).toBeUndefined();
    expect(mem.get(PUBKEY)).toBeUndefined();
    expect(useStore.getState().onboardingComplete).toBe(false);
    expect(useStore.getState().nostrPubkey).toBeNull();
  });

  it('write-through: each setter writes its GATE_* key; null/false removes it', async () => {
    const useStore = await freshStore();
    const s = () => useStore.getState();

    s().setOnboardingComplete(true);   expect(mem.get(ONB)).toBe('1');
    s().setNostrAuthEnabled(true);     expect(mem.get(AUTH)).toBe('1');
    s().setNostrSigningMethod('local'); expect(mem.get(METHOD)).toBe('local');
    s().setNostrPubkey('abc');         expect(mem.get(PUBKEY)).toBe('abc');

    // Logout/disconnect calls these with false/null → standalone keys cleared (no phantom gate).
    s().setOnboardingComplete(false);  expect(mem.has(ONB)).toBe(false);
    s().setNostrAuthEnabled(false);    expect(mem.has(AUTH)).toBe(false);
    s().setNostrSigningMethod(null);   expect(mem.has(METHOD)).toBe(false);
    s().setNostrPubkey(null);          expect(mem.has(PUBKEY)).toBe(false);
  });

  // B1: nostrAuthEnabled is DERIVED from pubkey presence — setNostrPubkey drives it in lockstep + mirrors GATE_AUTH_KEY.
  it('B1 pin: setNostrPubkey drives nostrAuthEnabled and mirrors GATE_AUTH_KEY (can never desync)', async () => {
    const useStore = await freshStore();
    const s = () => useStore.getState();

    s().setNostrPubkey('abc');
    expect(s().nostrPubkey).toBe('abc');
    expect(s().nostrAuthEnabled).toBe(true);     // auth active iff signed in
    expect(mem.get(AUTH)).toBe('1');             // GATE_AUTH_KEY mirrors GATE_PUBKEY_KEY (3a.4 cold-start gate)

    s().setNostrPubkey(null);
    expect(s().nostrPubkey).toBeNull();
    expect(s().nostrAuthEnabled).toBe(false);    // signed out → auth off, in lockstep
    expect(mem.has(AUTH)).toBe(false);
    expect(mem.has(PUBKEY)).toBe(false);
  });
});
