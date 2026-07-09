// R2b-3 — pure logic for the 12-box recovery-phrase capture grid (WordGrid input mode).
//
// Node-testable, no React/DOM. ⚠ CAPTURE UX ONLY — none of this owns the validity verdict. `phraseStatus`/
// `isWord` power the live hints (checksum line, per-box tint); the authoritative check is `entropyFromWords` on
// submit (nip06Key.ts), which normalizes + validates. The grid's green is a hint, the derivation is the verdict —
// the same discipline as classifyRecoveryInput not owning validity (recoveryInput.ts).

import { validateWords } from 'nostr-tools/nip06';
import { wordlist } from '@scure/bip39/wordlists/english.js';   // ⚠ the `.js` is REQUIRED — no extensionless subpath
import { RECOVERY_WORD_COUNT } from './nostr/recoveryInput';

const WORD_SET = new Set(wordlist);   // O(1) membership for the per-box tint (wordlist is 2048 lowercase words)

/**
 * Route a paste landing on box `focusedIndex` (0-based):
 *   'fill-from-start' — exactly 12 tokens → the caller replaces all 12 boxes from box 1, regardless of focus.
 *   []                — 0 or 1 token → passthrough; the caller does NOT preventDefault (the box's native paste
 *                       handles a single token).
 *   string[]          — 2–11 tokens → the tokens to place starting at `focusedIndex`, already truncated to the
 *                       room left (max 12 − focusedIndex) so the caller never overruns box 12.
 */
export function distributePaste(tokens: string[], focusedIndex: number): string[] | 'fill-from-start' {
  if (tokens.length === RECOVERY_WORD_COUNT) return 'fill-from-start';
  if (tokens.length < 2) return [];
  const room = Math.max(0, RECOVERY_WORD_COUNT - focusedIndex);
  return tokens.slice(0, room);
}

/** Up to `max` BIP-39 English words with this prefix (trimmed, lowercased); [] for empty / no match. */
export function suggestWords(prefix: string, max = 4): string[] {
  const p = prefix.trim().toLowerCase();
  if (!p) return [];
  const out: string[] = [];
  for (const w of wordlist) {   // sorted; a linear scan with an early break is plenty for 2048 words
    if (w.startsWith(p)) {
      out.push(w);
      if (out.length === max) break;
    }
  }
  return out;
}

/**
 * Whole-phrase status for the checksum line + the Continue gate. Any empty/whitespace box ⇒ 'incomplete';
 * otherwise defer to `validateWords` (BIP-39 checksum) over the normalized phrase (each token trimmed +
 * lowercased, joined with single spaces — mirroring skFromWords' normalization).
 */
export function phraseStatus(values: string[]): 'incomplete' | 'valid' | 'bad-checksum' {
  if (values.length < RECOVERY_WORD_COUNT || values.some((v) => !v.trim())) return 'incomplete';
  const phrase = values.map((v) => v.trim().toLowerCase()).join(' ');
  return validateWords(phrase) ? 'valid' : 'bad-checksum';
}

/** Per-box tint predicate — green iff the word is in the English wordlist. Case/whitespace-insensitive. */
export function isWord(w: string): boolean {
  return WORD_SET.has(w.trim().toLowerCase());
}
