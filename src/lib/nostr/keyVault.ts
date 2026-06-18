// Identity-agnostic encrypted-key vault. Wraps a 32-byte secret behind Face ID (WebAuthn PRF) or a PIN,
// using WebCrypto (PBKDF2/HKDF → AES-GCM). Knows NOTHING about "writer" vs "viewer" — both consume it
// unchanged (the writer local-key signer builds on it now; the queued viewer-access phase reuses it).
//
// SECURITY: the unwrapped key is returned in memory only and NEVER persisted by this module. The device
// copy of a wrapped key is convenience, never the only copy (the caller enforces the backup gate).
//
// NOTE: the PIN path (PBKDF2 → HKDF → AES-GCM) is fully unit-tested. The PRF path needs WebAuthn +
// a platform authenticator (iOS Safari 18.4+), so its exact extension wiring is verified on-device, not
// in jsdom — it's isolated behind prfRegister/prfAuthenticate so it can be tuned without touching callers.

import {
  startRegistration,
  startAuthentication,
  platformAuthenticatorIsAvailable,
  browserSupportsWebAuthn,
  bufferToBase64URLString,
  base64URLStringToBuffer,
} from '@simplewebauthn/browser';

export type WrapMethod = 'prf' | 'pin';
export interface WrapMeta {
  iv: string;            // base64 — AES-GCM nonce
  scheme: WrapMethod;
  credentialId?: string; // base64url — PRF passkey id (prf scheme only)
  salt: string;          // base64 — HKDF salt (also PBKDF2 salt for the pin scheme)
}

const PBKDF2_ITERS = 600_000;
const HKDF_INFO = new TextEncoder().encode('personal-bloc/keyvault/v1');
// Fixed PRF eval input — PRF output is unique per authenticator credential regardless, so a constant
// eval is fine (uniqueness comes from the credential, identified by meta.credentialId).
const PRF_EVAL = new TextEncoder().encode('personal-bloc/keyvault/prf-eval/v1');

const subtle = () => crypto.subtle;

// ── base64 (standard) for stored ciphertext/iv/salt ───────────────────────────
function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

// ── shared crypto: ikm → AES-GCM key via HKDF ─────────────────────────────────
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

async function deriveAesKey(ikm: ArrayBuffer, salt: Uint8Array): Promise<CryptoKey> {
  const ikmKey = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: bs(salt), info: bs(HKDF_INFO) },
    ikmKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function pinIkm(pin: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const pinKey = await subtle().importKey('raw', bs(new TextEncoder().encode(pin)), 'PBKDF2', false, ['deriveBits']);
  return subtle().deriveBits(
    { name: 'PBKDF2', salt: bs(salt), iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    pinKey,
    256,
  ) as Promise<ArrayBuffer>;
}

// ── PRF (Face ID) — deploy-verified; isolated ─────────────────────────────────
function extractPrfFirst(resp: unknown): ArrayBuffer {
  // simplewebauthn returns clientExtensionResults.prf.results.first as a base64url string (JSON) or buffer.
  const first = (resp as any)?.clientExtensionResults?.prf?.results?.first;
  if (first == null) throw new Error('PRF output unavailable (authenticator lacks PRF support)');
  if (typeof first === 'string') return base64URLStringToBuffer(first);
  if (first instanceof ArrayBuffer) return first;
  if (ArrayBuffer.isView(first)) return (first as ArrayBufferView).buffer as ArrayBuffer;
  throw new Error('PRF output in unexpected form');
}

async function prfRegister(): Promise<{ credentialId: string; ikm: ArrayBuffer }> {
  const challenge = bufferToBase64URLString(randomBytes(32).buffer as ArrayBuffer);
  const userId = bufferToBase64URLString(randomBytes(16).buffer as ArrayBuffer);
  const resp = await startRegistration({
    optionsJSON: {
      challenge,
      rp: { name: 'Personal ₿LOC', id: window.location.hostname },
      user: { id: userId, name: 'local-key', displayName: 'Personal ₿LOC local key' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: { eval: { first: bufferToBase64URLString(PRF_EVAL.buffer as ArrayBuffer) } } } as any,
    } as any,
  });
  // Registration confirms PRF is enabled; the PRF OUTPUT itself only comes from an assertion → do one now.
  const credentialId = resp.id;
  const ikm = await prfAuthenticate(credentialId);
  return { credentialId, ikm: ikm };
}

async function prfAuthenticate(credentialId: string): Promise<ArrayBuffer> {
  const challenge = bufferToBase64URLString(randomBytes(32).buffer as ArrayBuffer);
  const resp = await startAuthentication({
    optionsJSON: {
      challenge,
      rpId: window.location.hostname,
      allowCredentials: [{ id: credentialId, type: 'public-key' }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: bufferToBase64URLString(PRF_EVAL.buffer as ArrayBuffer) } } } as any,
    } as any,
  });
  return extractPrfFirst(resp);
}

// ── public API ────────────────────────────────────────────────────────────────

/** PRF (platform authenticator, e.g. Face ID) when available, else PIN fallback. */
export async function probeKeyVaultCapability(): Promise<WrapMethod> {
  try {
    if (browserSupportsWebAuthn() && (await platformAuthenticatorIsAvailable())) return 'prf';
  } catch { /* fall through */ }
  return 'pin';
}

/** Encrypt a 32-byte secret. Returns base64 ciphertext + meta to re-derive the unwrap key. */
export async function wrapSecretKey(
  sk: Uint8Array,
  method: WrapMethod,
  pin?: string,
): Promise<{ ciphertext: string; meta: WrapMeta }> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  let ikm: ArrayBuffer;
  let credentialId: string | undefined;
  if (method === 'pin') {
    if (!pin) throw new Error('PIN required');
    ikm = await pinIkm(pin, salt);
  } else {
    const reg = await prfRegister();
    credentialId = reg.credentialId;
    ikm = reg.ikm;
  }
  const aesKey = await deriveAesKey(ikm, salt);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv: bs(iv) }, aesKey, bs(sk));
  return {
    ciphertext: toB64(new Uint8Array(ct)),
    meta: { iv: toB64(iv), scheme: method, credentialId, salt: toB64(salt) },
  };
}

/** Decrypt → key in MEMORY ONLY (returned to the caller; never persisted here). Throws on wrong PIN /
 *  cancelled Face ID / tampered ciphertext. */
export async function unwrapSecretKey(
  ciphertext: string,
  meta: WrapMeta,
  pin?: string,
): Promise<Uint8Array> {
  if (!meta || !meta.iv || !meta.salt || !meta.scheme) throw new Error('malformed wrap meta');
  const salt = fromB64(meta.salt);
  const iv = fromB64(meta.iv);
  let ikm: ArrayBuffer;
  if (meta.scheme === 'pin') {
    if (!pin) throw new Error('PIN required');
    ikm = await pinIkm(pin, salt);
  } else {
    if (!meta.credentialId) throw new Error('no PRF credential');
    ikm = await prfAuthenticate(meta.credentialId);
  }
  const aesKey = await deriveAesKey(ikm, salt);
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: bs(iv) }, aesKey, bs(fromB64(ciphertext)));
  return new Uint8Array(pt);
}
