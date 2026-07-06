import { describe, it, expect } from 'vitest';
import { getPublicKey, generateSecretKey, nip19 } from 'nostr-tools';
import * as nip49 from 'nostr-tools/nip49';
import { buildHandoffToken, parseHandoffToken } from '../handoffToken';
import { deriveViewerKeyFromNsec } from '../viewerKey';

const OWNER_NPUB = nip19.npubEncode(getPublicKey(new Uint8Array(32).fill(7)));
const NSEC = nip19.nsecEncode(new Uint8Array(32).fill(3));

describe('handoffToken build/parse', () => {
  it('roundtrips an nsec token — build then parse recovers keyPart + ownerNpub', () => {
    const token = buildHandoffToken(NSEC, OWNER_NPUB);
    const parsed = parseHandoffToken(token);
    expect(parsed).toEqual({ kind: 'nsec', keyPart: NSEC, ownerNpub: OWNER_NPUB });
  });

  it('roundtrips an ncryptsec token — kind classified by prefix', () => {
    const nc = nip49.encrypt(new Uint8Array(32).fill(3), 'pw', 1);   // low logn = fast scrypt
    const token = buildHandoffToken(nc, OWNER_NPUB);
    const parsed = parseHandoffToken(token);
    expect(parsed).toEqual({ kind: 'ncryptsec', keyPart: nc, ownerNpub: OWNER_NPUB });
  });

  it('bare nsec with no ":" → null (token-only; bare-nsec back-compat retired)', () => {
    expect(parseHandoffToken(NSEC)).toBeNull();
  });

  it('requires exactly 2 parts — a single-part ncryptsec with no npub half → null', () => {
    const nc = nip49.encrypt(new Uint8Array(32).fill(3), 'pw', 1);   // low logn = fast scrypt
    expect(parseHandoffToken(nc)).toBeNull();
  });

  it('trims surrounding whitespace before parsing', () => {
    const token = buildHandoffToken(NSEC, OWNER_NPUB);
    expect(parseHandoffToken(`  ${token}\n`)).toEqual({ kind: 'nsec', keyPart: NSEC, ownerNpub: OWNER_NPUB });
  });

  it('rejects malformed input → null', () => {
    expect(parseHandoffToken('')).toBeNull();
    expect(parseHandoffToken('   ')).toBeNull();
    expect(parseHandoffToken('garbage')).toBeNull();                          // no key prefix
    expect(parseHandoffToken('npub1abc')).toBeNull();                         // npub is not a key part
    expect(parseHandoffToken(`${NSEC}:${OWNER_NPUB}:extra`)).toBeNull();      // >1 colon
    expect(parseHandoffToken(`${NSEC}:`)).toBeNull();                         // trailing colon, empty half
    expect(parseHandoffToken(`${NSEC}:notannpub`)).toBeNull();               // bad npub half
    expect(parseHandoffToken(`${NSEC}:${NSEC}`)).toBeNull();                 // npub half is actually an nsec
  });
});

describe('handoff token — NIP-49 encrypt→decrypt roundtrip end-to-end', () => {
  it('derives a viewer key, encrypts into a token, parses, decrypts → byte-equal', async () => {
    const ownerSk = generateSecretKey();
    const derived = await deriveViewerKeyFromNsec(ownerSk, getPublicKey(ownerSk), 1);
    const passphrase = 'correct horse battery staple';

    const keyPart = nip49.encrypt(derived, passphrase, 1);   // low logn keeps scrypt fast in CI
    const token = buildHandoffToken(keyPart, nip19.npubEncode(getPublicKey(ownerSk)));

    const parsed = parseHandoffToken(token);
    expect(parsed?.kind).toBe('ncryptsec');
    const recovered = nip49.decrypt(parsed!.keyPart, passphrase);
    expect(Array.from(recovered)).toEqual(Array.from(derived));   // byte-for-byte

    // wrong passphrase throws (the viewer flow catches this → null → friendly error)
    expect(() => nip49.decrypt(parsed!.keyPart, 'wrong')).toThrow();
  });
});
