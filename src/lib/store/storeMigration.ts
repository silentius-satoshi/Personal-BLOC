// At-rest store encryption — Phase C (opt-in migration, VERIFY-BEFORE-DELETE).
//
// Migrate the existing persist blob (the whole `{"state":…,"version":18}` string under 'personal-bloc-store')
// between plaintext and the AES-GCM {ct,iv} envelope. #1 SAFETY PROPERTY: the source is NEVER overwritten until
// the new blob has been decrypted back and verified EQUAL to the original — any crypto/storage failure leaves the
// source intact and recoverable. Both functions are idempotent (a no-op if the blob is already in the target form)
// and use the in-memory store key (getStoreKey) derived by the migration/unlock gate.

import { encryptBlob, decryptBlob } from '../nostr/keyVault';
import { getStoreKey } from './storeCrypto';

const NAME = 'personal-bloc-store';

function isEnvelope(s: string): boolean {
  try { const o = JSON.parse(s); return o && o.ct != null && o.iv != null; } catch { return false; }
}

/** Plaintext blob → {ct,iv} envelope. Returns false (source untouched) on any failure or verify mismatch. */
export async function migratePlaintextToEncrypted(name = NAME): Promise<boolean> {
  const key = getStoreKey();
  if (!key) return false;
  const raw = localStorage.getItem(name);
  if (raw == null) return true;          // fresh install — nothing to migrate
  if (isEnvelope(raw)) return true;      // idempotent — already encrypted
  let env: { ct: string; iv: string };
  try { env = await encryptBlob(raw, key); } catch { return false; }
  let roundTrip: string;
  try { roundTrip = await decryptBlob(env.ct, env.iv, key); } catch { return false; }
  if (roundTrip !== raw) return false;   // VERIFY failed → DO NOT overwrite the plaintext
  localStorage.setItem(name, JSON.stringify(env));   // only now
  return true;
}

/** {ct,iv} envelope → plaintext blob. Returns false (envelope untouched) on any failure. */
export async function migrateEncryptedToPlaintext(name = NAME): Promise<boolean> {
  const key = getStoreKey();
  if (!key) return false;
  const raw = localStorage.getItem(name);
  if (raw == null) return true;
  if (!isEnvelope(raw)) return true;     // idempotent — already plaintext
  const env = JSON.parse(raw) as { ct: string; iv: string };
  let plain: string;
  try { plain = await decryptBlob(env.ct, env.iv, key); } catch { return false; }
  // Verify the decrypted text is the persist envelope before overwriting.
  try { const o = JSON.parse(plain); if (!o || o.state == null) return false; } catch { return false; }
  localStorage.setItem(name, plain);     // only after a verified decrypt
  return true;
}

/** True when a blob exists and is NOT a {ct,iv} envelope (i.e. plaintext that needs migrating). */
export function blobIsPlaintext(name = NAME): boolean {
  const raw = localStorage.getItem(name);
  if (raw == null) return false;
  return !isEnvelope(raw);
}
