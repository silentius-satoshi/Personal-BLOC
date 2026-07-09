// R2c-1 — pure verify-step logic for RecoveryKeyCeremony. Node-testable, no React/DOM.
//
// The ceremony proves the user actually saved their Recovery Key before stamping backupVerifiedAt. What it asks for
// depends on what the user's SAVED ARTIFACT actually is (R2c-7b-fix):
//   PLAINTEXT backup, entropy key ('nip06-entropy') → a two-word quiz (pickQuizIndices + checkQuizAnswers)
//   PLAINTEXT backup, sk key ('sk')                 → the last 6 chars of the nsec (checkNsecTail)
//   ENCRYPTED backup (either key kind)              → re-enter the passphrase (checkBackupPassphrase)
//
// ⚠ The encrypted case is NOT a word quiz: the saved file is a passphrase-locked ncryptsec, so the only thing that
// can lose the plan is a forgotten passphrase. Quizzing the words there would verify an artifact the user did not save.

/**
 * Two DISTINCT word indices in 0–11. `rand` is injectable so tests are deterministic — the codebase had no
 * prior rand-injection precedent; this establishes it (default Math.random). Distinctness is LOOP-FREE:
 * b = (a + offset) % 12 with offset ∈ 1–11, so b ≠ a in a single draw — a constant `rand` (always 0, always
 * 0.99) can never hang it. The Math.min clamps guard against a test rand returning exactly 1 (Math.random never
 * does; the domain is [0,1)).
 */
export function pickQuizIndices(rand: () => number = Math.random): [number, number] {
  const a = Math.min(11, Math.floor(rand() * 12));
  const b = (a + 1 + Math.min(10, Math.floor(rand() * 11))) % 12;
  return [a, b];
}

/**
 * The word quiz: both answers must match `words[indices]` after trim + lowercase. POSITION-SENSITIVE — when the
 * two quizzed words differ, transposing the answers fails (you must put each word in its own slot).
 */
export function checkQuizAnswers(
  words: string[],
  indices: [number, number],
  answers: [string, string],
): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  return norm(answers[0]) === norm(words[indices[0]]) && norm(answers[1]) === norm(words[indices[1]]);
}

/**
 * The nsec check: the last 6 characters of the bech32 nsec. Input is trimmed only — bech32 is lowercase, so the
 * comparison is CASE-SENSITIVE (an upper-cased tail of a lowercase nsec fails).
 */
export function checkNsecTail(nsec: string, input: string): boolean {
  return input.trim() === nsec.slice(-6);
}

/**
 * R2c-7b-fix — the encrypted path: does the re-entered passphrase match the one that locked the backup?
 *
 * ⚠ BOTH SIDES ARE TRIMMED, and that is load-bearing. The ceremony encrypts with `filePass.trim()`
 * (`nip49.encrypt(sk, filePass.trim())`), so the passphrase that ACTUALLY opens the file is the trimmed one.
 * Comparing untrimmed would reject a re-entry that would decrypt the file perfectly — a false mismatch over a
 * trailing space the encrypt already stripped. Same trim symmetry as every decrypt site (SharingPage,
 * ViewerLoginFlow, NostrAuthGate).
 *
 * Case-SENSITIVE (a passphrase is), and an empty passphrase never passes — so a user who somehow reached verify
 * with no passphrase set cannot confirm by submitting nothing.
 */
export function checkBackupPassphrase(expected: string, input: string): boolean {
  const e = expected.trim();
  return e.length > 0 && e === input.trim();
}
