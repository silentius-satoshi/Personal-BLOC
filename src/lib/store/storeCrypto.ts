// At-rest store encryption — Phase B (encrypted persist adapter + in-memory store-key holder).
//
// The plan blob is persisted as AES-GCM ciphertext ({ ct, iv } envelope). The CryptoKey lives ONLY in memory
// (this module's holder) — never persisted, mirroring viewerSync's holder discipline + the nsec key. While
// LOCKED (no key): getItem returns null (store hydrates to seeds, AppUnlockGate shows) and setItem DROPS the
// write — plan data is NEVER written to localStorage in the clear once the encrypted adapter is active.
//
// This adapter is wired into persist ONLY when the standalone `personal-bloc-store-enc-enabled` flag is '1'
// (OFF by default → persist uses default localStorage, byte-identical to today). Phase C handles migration.

import { encryptBlob, decryptBlob } from '../nostr/keyVault';

let storeKey: CryptoKey | null = null;
export function getStoreKey(): CryptoKey | null { return storeKey; }
export function setStoreKey(k: CryptoKey | null): void { storeKey = k; }
export function isStoreUnlocked(): boolean { return storeKey !== null; }

/**
 * Teardown safety: clear the at-rest encryption flag + pending-decrypt marker, nuke the on-disk blob, and drop the
 * in-memory key — so a later plaintext-adapter load can never misread a stale {ct,iv} envelope as a raw string and
 * hydrate to seeds (the "settings revert to defaults" desync). Called as the FIRST action by both teardown paths
 * ("Remove local key" + escapeHatch.resetAndResync); the caller reloads after. Must clear ALL FOUR — missing any one
 * re-opens the desync (clearing the flag but not the blob IS the exact bug).
 */
export function clearStoreEncryptionState(): void {
  try { localStorage.removeItem('personal-bloc-store-enc-enabled'); } catch { /* noop */ }
  try { localStorage.removeItem('personal-bloc-store-enc-pending-decrypt'); } catch { /* noop */ }
  try { localStorage.removeItem('personal-bloc-store'); } catch { /* noop */ }   // nuke the (possibly {ct,iv}) blob
  setStoreKey(null);
}

interface Envelope { ct?: string; iv?: string }

export const encryptedStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const raw = localStorage.getItem(name);
    if (!raw) return null;
    let env: Envelope;
    try { env = JSON.parse(raw) as Envelope; } catch { return null; }
    // Not an {ct,iv} envelope → a plaintext (pre-encryption) blob → pass through untouched (Phase-C interim).
    if (env.ct == null || env.iv == null) return raw;
    // Enveloped but locked → no hydrate (AppUnlockGate drives the unlock); enveloped + key → decrypt.
    if (!storeKey) return null;
    try { return await decryptBlob(env.ct, env.iv, storeKey); }
    catch { return null; }   // wrong key / corrupt → empty, don't crash
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (!storeKey) return;   // locked → DROP the write; NEVER persist plaintext
    const { ct, iv } = await encryptBlob(value, storeKey);
    localStorage.setItem(name, JSON.stringify({ ct, iv }));
  },
  removeItem: async (name: string): Promise<void> => { localStorage.removeItem(name); },
};
