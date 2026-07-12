import { describe, it, expect, beforeEach } from 'vitest';
import { generateSecretKey } from 'nostr-tools/pure';
import {
  cryptoClient,
  CryptoError,
  classifyWorkerFailure,
  encodeEncryptRequest,
  encodeDecryptRequest,
  resetCryptoClientForTests,
} from '../cryptoClient';

// Phase 2a. The worker itself is device-gated (real Worker + WebKit), not unit-tested. In node/vitest
// `typeof Worker === 'undefined'`, so every cryptoClient op naturally takes the SYNCHRONOUS in-thread FALLBACK
// path — which is byte-identical to the pre-2a code. We test that fallback + the pure protocol helpers.
// `logn: 1` keeps scrypt fast (the ncryptsec.test.ts precedent; production callers pass no logn → default 16).

const PASS = 'correct horse battery';

beforeEach(() => resetCryptoClientForTests());

describe('cryptoClient — fallback round-trip (node, no Worker)', () => {
  it('encrypt then decrypt returns the original secret key', async () => {
    const sk = generateSecretKey();
    const ncryptsec = await cryptoClient.nip49Encrypt(sk, PASS, 1);
    expect(ncryptsec.startsWith('ncryptsec1')).toBe(true);
    const back = await cryptoClient.nip49Decrypt(ncryptsec, PASS);
    expect(back).toEqual(sk);
  });

  it('wrong passphrase → CryptoError with kind "passphrase"', async () => {
    const ncryptsec = await cryptoClient.nip49Encrypt(generateSecretKey(), PASS, 1);
    const err = await cryptoClient.nip49Decrypt(ncryptsec, 'not the passphrase').catch((e) => e);
    expect(err).toBeInstanceOf(CryptoError);
    expect(err.kind).toBe('passphrase');
  });

  it('malformed input → CryptoError with kind "malformed"', async () => {
    // 'b' is not in the bech32 alphabet → nip49.decrypt throws a bech32 error → classified as malformed.
    const err = await cryptoClient.nip49Decrypt('ncryptsec1garbage', PASS).catch((e) => e);
    expect(err).toBeInstanceOf(CryptoError);
    expect(err.kind).toBe('malformed');
  });

  // Internal-copy contract: the client slices `sk` and works on the copy, so the caller's buffer survives
  // (every existing caller-side `finally { sk.fill(0) }` keeps working).
  it('does NOT zero the caller\'s sk buffer', async () => {
    const sk = generateSecretKey();
    const before = sk.slice();
    await cryptoClient.nip49Encrypt(sk, PASS, 1);
    expect(sk).toEqual(before);
    expect(sk.some((b) => b !== 0)).toBe(true);   // still real key bytes, not zeroed
  });
});

describe('cryptoClient — pure protocol helpers', () => {
  it('encodeEncryptRequest builds the message + transfer list', () => {
    const payload = new Uint8Array([1, 2, 3]).buffer;
    const { msg, transfer } = encodeEncryptRequest(7, payload, 'pw', 2);
    expect(msg).toEqual({ id: 7, op: 'nip49encrypt', payload, pass: 'pw', logn: 2 });
    expect(transfer).toEqual([payload]);   // the sk copy is transferred, not cloned
  });

  it('encodeEncryptRequest omits logn when not given', () => {
    const payload = new Uint8Array([9]).buffer;
    const { msg } = encodeEncryptRequest(1, payload, 'pw');
    expect(msg).toEqual({ id: 1, op: 'nip49encrypt', payload, pass: 'pw', logn: undefined });
  });

  it('encodeDecryptRequest builds the message with no transfer', () => {
    const { msg, transfer } = encodeDecryptRequest(9, 'ncryptsec1abc', 'pw');
    expect(msg).toEqual({ id: 9, op: 'nip49decrypt', ncryptsec: 'ncryptsec1abc', pass: 'pw' });
    expect(transfer).toEqual([]);
  });

  it('classifyWorkerFailure passes known kinds through, unknown → generic', () => {
    expect(classifyWorkerFailure({ error: 'passphrase' })).toBe('passphrase');
    expect(classifyWorkerFailure({ error: 'malformed' })).toBe('malformed');
    expect(classifyWorkerFailure({ error: 'generic' })).toBe('generic');
    expect(classifyWorkerFailure({ error: 'something-else' })).toBe('generic');
    expect(classifyWorkerFailure({})).toBe('generic');
  });
});
