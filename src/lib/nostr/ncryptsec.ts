// R2c-7a-fix — PURE shape + error helpers for NIP-49 encrypted keys (`ncryptsec1…`). Zero imports.
//
// WHY THIS EXISTS. `nip49` exports only `encrypt`/`decrypt` — no shape-only check — and `decrypt` runs scrypt
// (~1s, SYNCHRONOUS) before it can tell you anything. So we cannot ask "is this even a key?" by decrypting.
// These let the UI answer at PASTE TIME, before it asks for a passphrase, so a malformed payload is never
// misreported as a wrong passphrase (the R2c-7a bug).
//
// ⚠ Do NOT move any of this into `classifyRecoveryInput` — that classifier is deliberately SHAPE-BY-PREFIX
// only, and validity belongs to the caller (its own header rule). "Starts with ncryptsec1" is satisfied by
// plenty of strings that are not ncryptsecs; these helpers are how the caller finds out.

/**
 * A well-formed ncryptsec is ALWAYS exactly this long. The payload is fixed-width — version(1) + logn(1) +
 * salt(16) + nonce(24) + ksb(1) + ciphertext(32-byte sec + 16-byte poly1305 tag = 48) = 91 bytes → 146 bech32
 * words → 'ncryptsec'(9) + '1'(1) + 146 + checksum(6) = 162. Verified against nip49.encrypt at logn 1/8/16/20:
 * `logn` is one byte OF the payload, so it never changes the length. Pinned by test — a length change would
 * silently disable the shape gate below.
 */
export const NCRYPTSEC_LENGTH = 162;

/** The bech32 alphabet (lowercase). Excludes `1`, `b`, `i`, `o` — and, load-bearing for us, `:`. */
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/**
 * LAYER 1 — cheap structural test: could this string possibly be an ncryptsec? Prefix + exact length + bech32
 * charset. Runs no crypto, so it is safe to call on every keystroke. Rejects a `:npub…` handoff-token suffix,
 * a truncated paste, a bare nsec, and newline/charset damage.
 *
 * ⚠ It does NOT verify the bech32 CHECKSUM — a single-character typo passes this and then fails inside
 * `nip49.decrypt`. That residual is LAYER 2, {@link classifyNcryptsecError}. Neither layer alone suffices.
 * (Verifying the checksum here would mean importing `bech32` from `@scure/base`, which is not a direct dep.)
 *
 * Lowercase only, matching `classifyRecoveryInput`'s lowercase `ncryptsec1` prefix test. bech32 permits an
 * all-uppercase encoding, but such a string never reaches the encrypted branch — the classifier calls it
 * `unknown`.
 */
export function isWellFormedNcryptsec(s: string): boolean {
  if (s.length !== NCRYPTSEC_LENGTH) return false;
  if (!s.startsWith('ncryptsec1')) return false;
  for (let i = 'ncryptsec1'.length; i < s.length; i++) {
    if (!BECH32_CHARSET.includes(s[i])) return false;
  }
  return true;
}

/**
 * LAYER 2 — why did `nip49.decrypt` throw? It performs every structural check (bech32 decode → prefix →
 * version) BEFORE scrypt, and only the final AEAD step can fail because of the passphrase:
 *
 *   'invalid tag'           → xchacha20poly1305 auth failure → WRONG PASSPHRASE
 *   'Invalid checksum in …' → bech32                         → malformed
 *   'Unknown letter: "…"'   → bech32 charset                 → malformed
 *   'invalid prefix …'      → not an ncryptsec               → malformed
 *   'invalid version …'     → unsupported payload            → malformed
 *
 * ⚠ POSITIVE TEST on the passphrase error, deliberately. If a dependency ever renames `invalid tag`, we
 * degrade to calling a wrong passphrase "malformed" — confusing, but it never imports a key. The inverse
 * default (assume passphrase) is PRECISELY the bug this fixes: it blames the user for a corrupted paste.
 *
 * ⚠ NEVER surface `e.message` to the user: bech32's errors ECHO THE ENTIRE ncryptsec into the message, and
 * `Unknown letter` echoes the offending character. Same discipline as `entropyFromWords` (nip06Key.ts).
 */
export function classifyNcryptsecError(e: unknown): 'malformed' | 'passphrase' {
  const message = e instanceof Error ? e.message : String(e);
  return /invalid tag/i.test(message) ? 'passphrase' : 'malformed';
}
