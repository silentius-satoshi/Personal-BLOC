// NIP-06 plan-key derivation — the BIP-39 foundation for the R2c word-quiz backup ceremony.
//
// PATH: m/44'/1237'/0'/0/0 — ACCOUNT 0, and NO BIP-39 passphrase. Both are nostr-tools'
// `privateKeyFromSeedWords(mnemonic, passphrase?, accountIndex = 0)` defaults, and both are pinned by the
// published-vector test. Changing either would silently derive a DIFFERENT key from the same words, which for
// a recovery artifact means permanent, undetectable data loss. Never parameterize them here.
//
// ENGLISH WORDLIST ONLY (v1). The words are something the owner writes on paper and re-types later, so the
// language is part of the recovery contract. Widening the set later is an ADDITIVE change to `skFromWords`
// (try other wordlists on validation failure) — it never re-derives an existing key, because the entropy →
// words mapping is what the wordlist selects, and an existing key's entropy is already wrapped at rest.
//
// ⚠ THE WORDS STRING IS A TRANSIENT SECRET. A JS string cannot be zeroed — it lives until the GC collects it.
// Callers must never persist it, log it (`nostrLog` included), put it in an Error message, or hold it in React
// state that outlives the screen showing it. The ZEROABLE representations are `entropy` (16 bytes) and `sk`
// (32 bytes): CALLERS OWN ZEROING BOTH (`.fill(0)`), exactly as they already do for `sk` around keyVault.
//
// Imports nothing from keyVault (keyVault imports THIS) — the dependency direction is one-way, no cycle.

import { privateKeyFromSeedWords, validateWords } from 'nostr-tools/nip06';
import { getPublicKey } from 'nostr-tools/pure';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';   // ⚠ the `.js` is REQUIRED — @scure/bip39's exports map has no extensionless subpath

/** 128 bits → a 12-word phrase. */
export const ENTROPY_BYTES = 16;

/**
 * The repo's FIRST Error subclass (everything else throws a bare `new Error`). It exists because a bad
 * recovery phrase is the one error a caller must *distinguish* — every other failure in this module is a
 * programmer bug. The UI catch blocks render `e.message` verbatim (OwnerKeySetup / ViewerLoginFlow / …), so
 * the message is user-facing prose. ⚠ It must NEVER interpolate the words themselves.
 */
export class InvalidSeedWordsError extends Error {
  readonly name = 'InvalidSeedWordsError';
  constructor(message = "Those recovery words aren't valid — check for typos. English words only.") {
    super(message);
  }
}

/** Entropy → its 12-word BIP-39 phrase. The returned string is a transient secret (see header). */
export function wordsFromEntropy(entropy: Uint8Array): string {
  return entropyToMnemonic(entropy, wordlist);
}

/** Entropy → the NIP-06 secret key. The intermediate words string is transient; the caller zeroes the sk. */
export function deriveSkFromEntropy(entropy: Uint8Array): Uint8Array {
  return privateKeyFromSeedWords(wordsFromEntropy(entropy));
}

/**
 * A hand-typed phrase → the NIP-06 secret key. Normalizes first (trim, collapse inner whitespace, lowercase)
 * — that normalization is what makes a phrase copied off paper work, so it is part of the contract, not an
 * incidental convenience. Throws {@link InvalidSeedWordsError} on a bad checksum or a non-English word
 * (`validateWords` returns false rather than throwing, so the check must be explicit).
 */
export function skFromWords(words: string): Uint8Array {
  const normalized = words.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized || !validateWords(normalized)) throw new InvalidSeedWordsError();
  return privateKeyFromSeedWords(normalized);
}

/**
 * Mint a fresh plan key: 128 bits of WebCrypto entropy → words → NIP-06 sk → pubkey.
 * ⚠ CALLER OWNS ZEROING of both `entropy` and `sk`; `words` is transient (see header).
 */
export function generatePlanKey(): { entropy: Uint8Array; words: string; sk: Uint8Array; pubkeyHex: string } {
  const entropy = new Uint8Array(ENTROPY_BYTES);
  crypto.getRandomValues(entropy);   // WebCrypto global — same source as keyVault's randomBytes, kept local so this module stays keyVault-free
  const words = wordsFromEntropy(entropy);
  const sk = privateKeyFromSeedWords(words);
  return { entropy, words, sk, pubkeyHex: getPublicKey(sk) };
}
