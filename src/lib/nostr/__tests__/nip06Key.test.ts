import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { getPublicKey } from 'nostr-tools/pure';
import {
  ENTROPY_BYTES,
  InvalidSeedWordsError,
  deriveSkFromEntropy,
  generatePlanKey,
  skFromWords,
  wordsFromEntropy,
} from '../nip06Key';

// R2a-2 — NIP-06 plan-key derivation. Node env, real WebCrypto (no shims), same as keyVault.test.ts.

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// The published NIP-06 test vector. This PINS the derivation path m/44'/1237'/0'/0/0, account 0, and the
// absence of a BIP-39 passphrase. Cross-confirmed: the spec's own npub
// npub1zutzeysacnf9rru6zqwmxd54mud0k44tst6l70ja5mhv8jjumytsd2x7nu decodes to exactly VECTOR_PUBKEY.
// ⚠ Any change to these constants means the same words now yield a DIFFERENT key — i.e. every recovery
// phrase ever written down is silently void. Treat a failure here as data loss, never as a stale fixture.
const VECTOR_WORDS  = 'leader monkey parrot ring guide accident before fence cannon height naive bean';
const VECTOR_SK_HEX = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a';
const VECTOR_PUBKEY = '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917';
const VECTOR_NSEC   = 'nsec10allq0gjx7fddtzef0ax00mdps9t2kmtrldkyjfs8l5xruwvh2dq0lhhkp';

const entropyA = Uint8Array.from({ length: ENTROPY_BYTES }, (_, i) => i + 1);
const entropyB = Uint8Array.from({ length: ENTROPY_BYTES }, (_, i) => (i * 7 + 3) & 0xff);

describe('nip06Key — the published NIP-06 vector (pins the derivation path)', () => {
  it("skFromWords reproduces the spec's secret key, pubkey and nsec", () => {
    const sk = skFromWords(VECTOR_WORDS);
    expect(hex(sk)).toBe(VECTOR_SK_HEX);
    expect(getPublicKey(sk)).toBe(VECTOR_PUBKEY);
    expect(nip19.nsecEncode(sk)).toBe(VECTOR_NSEC);
  });

  it("the spec's own npub decodes to the same pubkey (independent cross-check)", () => {
    const decoded = nip19.decode('npub1zutzeysacnf9rru6zqwmxd54mud0k44tst6l70ja5mhv8jjumytsd2x7nu');
    expect(decoded.data).toBe(VECTOR_PUBKEY);
  });
});

describe('nip06Key — entropy ⇄ words ⇄ sk', () => {
  it('wordsFromEntropy yields 12 words for 128 bits', () => {
    expect(ENTROPY_BYTES).toBe(16);
    expect(wordsFromEntropy(entropyA).split(' ')).toHaveLength(12);
  });

  it('skFromWords(wordsFromEntropy(e)) === deriveSkFromEntropy(e) — the round-trip', () => {
    expect(hex(skFromWords(wordsFromEntropy(entropyA)))).toBe(hex(deriveSkFromEntropy(entropyA)));
  });

  it('deriveSkFromEntropy is deterministic and yields a 32-byte key', () => {
    const a = deriveSkFromEntropy(entropyA);
    expect(a).toHaveLength(32);
    expect(hex(a)).toBe(hex(deriveSkFromEntropy(entropyA)));
  });

  it('different entropy → different sk', () => {
    expect(hex(deriveSkFromEntropy(entropyA))).not.toBe(hex(deriveSkFromEntropy(entropyB)));
  });

  it('does not mutate the caller entropy', () => {
    const before = hex(entropyA);
    deriveSkFromEntropy(entropyA);
    wordsFromEntropy(entropyA);
    expect(hex(entropyA)).toBe(before);
  });
});

describe('nip06Key — generatePlanKey', () => {
  it('returns a self-consistent quad (entropy 16B / 12 words / sk 32B / 64-hex pubkey)', () => {
    const { entropy, words, sk, pubkeyHex } = generatePlanKey();
    expect(entropy).toHaveLength(ENTROPY_BYTES);
    expect(words.split(' ')).toHaveLength(12);
    expect(sk).toHaveLength(32);
    expect(pubkeyHex).toMatch(/^[0-9a-f]{64}$/);
    // internally consistent: both derivation routes reach the same key, and the pubkey matches it
    expect(hex(deriveSkFromEntropy(entropy))).toBe(hex(sk));
    expect(hex(skFromWords(words))).toBe(hex(sk));
    expect(getPublicKey(sk)).toBe(pubkeyHex);
  });

  it('mints fresh entropy per call', () => {
    expect(hex(generatePlanKey().entropy)).not.toBe(hex(generatePlanKey().entropy));
  });
});

describe('nip06Key — skFromWords rejects bad input with a typed error', () => {
  it('bad checksum → InvalidSeedWordsError', () => {
    // 12 valid English words, invalid checksum. (⚠ the canonical "abandon ×11 + about" IS valid — not usable here.)
    const badChecksum = 'abandon '.repeat(12).trim();
    expect(() => skFromWords(badChecksum)).toThrow(InvalidSeedWordsError);
  });

  it('non-English word → InvalidSeedWordsError', () => {
    const nonEnglish = [...VECTOR_WORDS.split(' ').slice(0, 11), 'ábaco'].join(' ');
    expect(() => skFromWords(nonEnglish)).toThrow(InvalidSeedWordsError);
  });

  it('empty / whitespace-only → InvalidSeedWordsError', () => {
    expect(() => skFromWords('')).toThrow(InvalidSeedWordsError);
    expect(() => skFromWords('   ')).toThrow(InvalidSeedWordsError);
  });

  it('the error message never leaks the words', () => {
    try {
      skFromWords(VECTOR_WORDS.replace('leader', 'zzzz'));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidSeedWordsError);
      expect((e as Error).name).toBe('InvalidSeedWordsError');
      expect((e as Error).message).not.toContain('monkey');
    }
  });
});

describe('nip06Key — skFromWords normalizes a hand-typed phrase', () => {
  it('tolerates leading/trailing space, doubled spaces, newlines and mixed case', () => {
    const messy = `  Leader   MONKEY parrot\nring guide  accident before fence
                   cannon height naive Bean  `;
    expect(hex(skFromWords(messy))).toBe(VECTOR_SK_HEX);
  });
});
