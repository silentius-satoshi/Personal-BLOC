// R2b-2 — shape classification for the dual-format Recovery Key field (nsec OR 12 words).
//
// PURE, zero imports. This decides only WHICH DOOR the input goes through, never whether it is VALID:
//   nsec  → nip19.decode owns the verdict (bech32 checksum, type tag)
//   words → skFromWords owns the verdict (BIP-39 checksum, English wordlist)
// So a 12-token string of nonsense classifies as `words` and is then rejected downstream with a real,
// user-facing InvalidSeedWordsError message. Do NOT add validation here — a classifier that also validated
// would have to duplicate (and could drift from) two separate crypto contracts.

/** The only phrase length v1 mints (128-bit entropy) — see nip06Key.ENTROPY_BYTES. */
export const RECOVERY_WORD_COUNT = 12;

export type RecoveryInput =
  | { kind: 'nsec';  value: string }   // trimmed, ready for nip19.decode
  | { kind: 'words'; value: string }   // whitespace collapsed to single spaces
  | { kind: 'unknown' };

/**
 * Classify a pasted/typed Recovery Key by SHAPE.
 * - starts with `nsec1` (case-sensitive — bech32 nsecs are lowercase) → nsec
 * - otherwise splits on whitespace into exactly RECOVERY_WORD_COUNT tokens → words
 * - anything else → unknown (the caller names both accepted forms in the error)
 */
export function classifyRecoveryInput(raw: string): RecoveryInput {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'unknown' };
  if (trimmed.startsWith('nsec1')) return { kind: 'nsec', value: trimmed };
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === RECOVERY_WORD_COUNT) return { kind: 'words', value: tokens.join(' ') };
  return { kind: 'unknown' };
}
