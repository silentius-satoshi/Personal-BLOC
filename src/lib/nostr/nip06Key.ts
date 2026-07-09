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
// `entropyFromWords` is the exact INVERSE of `wordsFromEntropy`. Because the NIP-06 path is deterministic, the
// two doors agree: deriveSkFromEntropy(entropyFromWords(w)) === skFromWords(w) for every valid phrase (pinned by
// test). That identity is what lets an IMPORTED phrase be stored as its entropy — so the ceremony can re-display
// and quiz the user's real words — without changing the key they sign in as (R2c-4b).
//
// ⚠ THE WORDS STRING IS A TRANSIENT SECRET. A JS string cannot be zeroed — it lives until the GC collects it.
// Callers must never persist it, log it (`nostrLog` included), put it in an Error message, or hold it in React
// state that outlives the screen showing it. The ZEROABLE representations are `entropy` (16 bytes) and `sk`
// (32 bytes): CALLERS OWN ZEROING BOTH (`.fill(0)`), exactly as they already do for `sk` around keyVault.
//
// Imports nothing from keyVault (keyVault imports THIS) — the dependency direction is one-way, no cycle.

import { privateKeyFromSeedWords, validateWords } from 'nostr-tools/nip06';
import { getPublicKey } from 'nostr-tools/pure';
import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
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
 * Trim, collapse inner whitespace, lowercase. This is what makes a phrase copied off paper work, so it is part
 * of the recovery contract, not an incidental convenience — SHARED by both doors into this module
 * (`skFromWords`, `entropyFromWords`) so they can never drift. (@scure's own `normalize` splits on a SINGLE
 * space and would reject a doubled-space phrase outright, so this must run first.)
 */
function normalizeWords(words: string): string {
  return words.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Validate a normalized phrase, or throw the typed, word-free error. */
function assertValidWords(normalized: string): void {
  // `validateWords` RETURNS FALSE rather than throwing, so the check must be explicit.
  if (!normalized || !validateWords(normalized)) throw new InvalidSeedWordsError();
}

/**
 * A hand-typed phrase → the NIP-06 secret key. Normalizes + validates first. Throws
 * {@link InvalidSeedWordsError} on a bad checksum or a non-English word.
 */
export function skFromWords(words: string): Uint8Array {
  const normalized = normalizeWords(words);
  assertValidWords(normalized);
  return privateKeyFromSeedWords(normalized);
}

/**
 * A hand-typed phrase → its 16 bytes of NIP-06 entropy. The exact INVERSE of {@link wordsFromEntropy}.
 *
 * IDENTITY-SAFE: the NIP-06 path is deterministic, so for any valid phrase `w`
 *   `deriveSkFromEntropy(entropyFromWords(w))` === `skFromWords(w)`
 * — pinned by test. That equality is what lets an IMPORTED phrase be wrapped as its entropy
 * (payloadKind 'nip06-entropy') without changing the identity the user is signing in as (R2c-4b).
 *
 * ⚠ Validates BEFORE decoding, and rethrows any decode failure as {@link InvalidSeedWordsError}. Two reasons,
 * both load-bearing: (1) callers render `InvalidSeedWordsError.message` verbatim, so a raw library throw would
 * silently downgrade the curated prose; (2) `mnemonicToEntropy` bottoms out in @scure/base's alphabet decoder,
 * which throws `Unknown letter: "<word>"` — it INTERPOLATES THE OFFENDING SEED WORD into its message, which
 * this module's header forbids. `assertValidWords` catches that case first; the try/catch makes the leak
 * structurally impossible.
 *
 * ⚠ CALLER OWNS ZEROING the returned buffer (`.fill(0)`).
 */
export function entropyFromWords(words: string): Uint8Array {
  const normalized = normalizeWords(words);
  assertValidWords(normalized);
  try {
    return mnemonicToEntropy(normalized, wordlist);
  } catch {
    throw new InvalidSeedWordsError();   // never surface a library message — it can contain a seed word
  }
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
