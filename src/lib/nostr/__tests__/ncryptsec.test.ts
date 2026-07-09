import { describe, it, expect } from 'vitest';
import * as nip49 from 'nostr-tools/nip49';
import * as nip19 from 'nostr-tools/nip19';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { NCRYPTSEC_LENGTH, isWellFormedNcryptsec, classifyNcryptsecError } from '../ncryptsec';

// R2c-7a-fix — the two layers that let the Recovery-key tab distinguish a malformed payload from a wrong
// passphrase. Real nip49 output; logn 1 keeps scrypt fast enough for a unit test (it is one payload byte, so
// it does not change the encoding length — see below).

const SK   = generateSecretKey();
const PASS = 'correct horse battery';
const enc  = (logn = 1) => nip49.encrypt(SK, PASS, logn);
const VALID = enc();
const NPUB  = nip19.npubEncode(getPublicKey(SK));

/** Flip the last char to break the bech32 checksum while keeping length + charset intact. */
const tamper = (s: string) => s.slice(0, -1) + (s.slice(-1) === 'q' ? 'p' : 'q');
/** Capture what nip49.decrypt actually throws for a given input. */
const thrown = (ncryptsec: string, pass: string): unknown => {
  try { nip49.decrypt(ncryptsec, pass); throw new Error('TEST BUG: decrypt did not throw'); }
  catch (e) { return e; }
};

describe('isWellFormedNcryptsec — LAYER 1 (paste-time shape gate, no crypto)', () => {
  it('a real nip49.encrypt output → true', () => {
    expect(isWellFormedNcryptsec(VALID)).toBe(true);
  });

  // ⚠ THE BUG THIS FIXES. SharingPage reveals `<ncryptsec>:<npub>`; the ':npub' suffix corrupts the bech32,
  // and R2c-7a reported the resulting throw as "Wrong passphrase".
  it('a full handoff token (ncryptsec + ":" + npub) → false', () => {
    const token = `${VALID}:${NPUB}`;
    expect(token.startsWith('ncryptsec1')).toBe(true);   // classifyRecoveryInput still calls it 'encrypted'
    expect(isWellFormedNcryptsec(token)).toBe(false);    // …but the shape gate rejects it before any passphrase
  });

  it('a truncated paste → false', () => {
    expect(isWellFormedNcryptsec(VALID.slice(0, -10))).toBe(false);
  });

  it('a bare nsec → false', () => {
    expect(isWellFormedNcryptsec(nip19.nsecEncode(SK))).toBe(false);
  });

  it('a trailing newline → false (charset)', () => {
    expect(isWellFormedNcryptsec(`${VALID}\n`)).toBe(false);
  });

  it('uppercase → false (the classifier never routes it here anyway)', () => {
    expect(isWellFormedNcryptsec(VALID.toUpperCase())).toBe(false);
  });

  it('empty / garbage → false', () => {
    expect(isWellFormedNcryptsec('')).toBe(false);
    expect(isWellFormedNcryptsec('ncryptsec1garbage')).toBe(false);
  });

  // ⚠ Layer 1's KNOWN HOLE, documented so nobody "fixes" the test: a 1-char typo keeps length + charset, so it
  // passes the shape gate and is caught later by Layer 2 (classifyNcryptsecError → 'malformed').
  it('a single-character typo PASSES the shape gate — Layer 2 owns that case', () => {
    expect(isWellFormedNcryptsec(tamper(VALID))).toBe(true);
  });

  // A silent length change would disable the gate entirely. `logn` is ONE BYTE of the payload, so it cannot
  // affect the encoded length — 16 is nip49's default and the costliest value worth paying for here (logn 20
  // is 2^20 scrypt rounds and blows the default 5s test timeout for no extra coverage).
  it('NCRYPTSEC_LENGTH is 162 and independent of logn', () => {
    expect(NCRYPTSEC_LENGTH).toBe(162);
    for (const logn of [1, 8, 16]) expect(enc(logn)).toHaveLength(NCRYPTSEC_LENGTH);
  }, 20_000);
});

describe('classifyNcryptsecError — LAYER 2 (why did decrypt throw?)', () => {
  // The ONLY passphrase-caused failure: xchacha20poly1305 rejects the auth tag, after scrypt.
  it("a wrong passphrase on a valid ncryptsec → 'passphrase'", () => {
    expect(classifyNcryptsecError(thrown(VALID, 'not the passphrase'))).toBe('passphrase');
  });

  // Structural failures all precede scrypt, so they can never be the passphrase's fault.
  it("a broken checksum (1-char typo) → 'malformed'", () => {
    expect(classifyNcryptsecError(thrown(tamper(VALID), PASS))).toBe('malformed');
  });

  it("a wrong prefix (bare nsec) → 'malformed'", () => {
    expect(classifyNcryptsecError(thrown(nip19.nsecEncode(SK), PASS))).toBe('malformed');
  });

  it("a full handoff token → 'malformed' (belt-and-braces: Layer 1 already rejected it)", () => {
    expect(classifyNcryptsecError(thrown(`${VALID}:${NPUB}`, PASS))).toBe('malformed');
  });

  // Safe default: never claim "wrong passphrase" for something we can't identify.
  it("a non-Error throw → 'malformed'", () => {
    expect(classifyNcryptsecError('some string')).toBe('malformed');
    expect(classifyNcryptsecError(undefined)).toBe('malformed');
  });

  // Pins the positive test. If a dep renames 'invalid tag' we degrade to 'malformed' (confusing, never unsafe)
  // rather than back to R2c-7a's behavior of blaming the passphrase for everything.
  it("discriminates on 'invalid tag' specifically", () => {
    expect(classifyNcryptsecError(new Error('invalid tag'))).toBe('passphrase');
    expect(classifyNcryptsecError(new Error('Invalid checksum in ncryptsec1abc…'))).toBe('malformed');
    expect(classifyNcryptsecError(new Error('invalid prefix nsec, expected ncryptsec'))).toBe('malformed');
  });
});
