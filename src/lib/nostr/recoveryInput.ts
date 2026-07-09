// Shape classification for the Recovery Key field (nsec, ncryptsec, OR 12 words).
//
// PURE, zero imports. This decides only WHICH DOOR the input goes through, never whether it is VALID:
//   nsec      → nip19.decode owns the verdict (bech32 checksum, type tag)
//   encrypted → nip49.decrypt owns the verdict (R2c-7a; the passphrase + scrypt are the COMPONENT's job,
//               never the classifier's — exactly as words-validity belongs to nip06Key)
//   words     → nip06Key owns the verdict (BIP-39 checksum, English wordlist). Both of its doors share one
//               normalize+validate contract and throw the same InvalidSeedWordsError: entropyFromWords (what
//               the import path calls since R2c-4b) and skFromWords.
// So a 12-token string of nonsense classifies as `words` and is then rejected downstream with a real,
// user-facing InvalidSeedWordsError message. Do NOT add validation here — a classifier that also validated
// would have to duplicate (and could drift from) two separate crypto contracts.

/** The only phrase length v1 mints (128-bit entropy) — see nip06Key.ENTROPY_BYTES. */
export const RECOVERY_WORD_COUNT = 12;

export type RecoveryInput =
  | { kind: 'nsec';      value: string }   // trimmed, ready for nip19.decode
  | { kind: 'encrypted'; value: string }   // trimmed, ready for nip49.decrypt (needs a passphrase)
  | { kind: 'words';     value: string }   // whitespace collapsed to single spaces
  | { kind: 'unknown' };

/**
 * Classify a pasted/typed Recovery Key by SHAPE.
 * - starts with `ncryptsec1` → encrypted (NIP-49; the caller collects a passphrase and decrypts)
 * - starts with `nsec1` → nsec
 *   (both case-sensitive — bech32 is lowercase)
 * - otherwise splits on whitespace into exactly RECOVERY_WORD_COUNT tokens → words
 * - anything else → unknown (the caller names the accepted forms in its error)
 *
 * ⚠ The `ncryptsec1` check is FIRST for readability, NOT because the prefixes collide: they diverge at the
 * second character (`ns…` vs `nc…`), so `'ncryptsec1'.startsWith('nsec1') === false` and no check order can
 * confuse them. A test pins that disjointness so a future prefix edit can't quietly introduce one.
 */
export function classifyRecoveryInput(raw: string): RecoveryInput {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'unknown' };
  if (trimmed.startsWith('ncryptsec1')) return { kind: 'encrypted', value: trimmed };
  if (trimmed.startsWith('nsec1')) return { kind: 'nsec', value: trimmed };
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === RECOVERY_WORD_COUNT) return { kind: 'words', value: tokens.join(' ') };
  return { kind: 'unknown' };
}
