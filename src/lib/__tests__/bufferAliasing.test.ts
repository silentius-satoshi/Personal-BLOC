import { describe, it, expect } from 'vitest';

/**
 * R2c-7b — pins the contract behind the R2c-7a Critical Constraints row:
 *
 *   "The encrypted branch's payload MUST be `.slice()`d"
 *
 * THE HAZARD (real, diagnosed, not hypothetical). `NostrAuthGate.handleLocal`'s encrypted branch reads its secret
 * key out of REACT STATE (`decryptState.sk`, produced once by the debounced decrypt effect). It hands that buffer
 * to `establishLocalOwner`, which:
 *
 *   1. WRAPS and PERSISTS the payload to `writerKeyWrapped` …
 *   2. … THEN derives the pubkey from it …
 *   3. … and zeros the payload in a `finally`, on success AND on failure.
 *
 * So a FAILED establish (Face ID cancelled) zeros the state-held buffer IN PLACE. The state is unchanged — React
 * has no idea — and the user's retry passes the same reference again, now 32 zero bytes. Step 1 writes a wrapped
 * all-zero "key" to disk for an identity that never existed; step 2 then throws. Net: a corrupted credential.
 *
 * The nsec/words branches are immune only incidentally: each attempt re-derives a fresh buffer from the input
 * string. The encrypted branch decrypts ONCE, so its buffer is long-lived — hence the `.slice()`.
 *
 * ⚠ SCOPE. This pins the MECHANISM, not the UI: it does not exercise NostrAuthGate's retry (the repo has no
 * render harness — deliberate house rule). Its job is to make "copy a buffer you are about to zero" EXECUTABLE,
 * so a future refactor that deletes a `.slice()` as a redundant copy fails loudly instead of silently shipping
 * the bug back.
 */

/** Stands in for React state holding a decrypted key across renders. */
type KeyState = { sk: Uint8Array };

/** What a wrapped credential on disk would look like. */
let persisted: Uint8Array | null = null;

/**
 * Stands in for `establishLocalOwner`: persist the payload FIRST, derive SECOND (and fail), zero in a `finally`.
 * The ordering is the whole point — the write to disk happens before anything can reject the key.
 */
function establishLike(payload: Uint8Array): void {
  try {
    persisted = Uint8Array.from(payload);   // step 1: wrap + persist (a copy, as keyVault's encrypt would produce)
    throw new Error('Face ID cancelled');   // step 2: derive/authenticate — fails
  } finally {
    payload.fill(0);                        // step 3: zero the caller's buffer, always
  }
}

const REAL_KEY = () => Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const ZEROS = new Uint8Array(32);

describe('buffer aliasing — why the encrypted payload must be .slice()d', () => {
  it('ALIASED: a failed establish zeros the state buffer, and the retry persists 32 zero bytes', () => {
    const state: KeyState = { sk: REAL_KEY() };

    expect(() => establishLike(state.sk)).toThrow('Face ID cancelled');

    // The bug, in one line: state was never reassigned, yet its bytes are gone.
    expect(state.sk).toEqual(ZEROS);

    // …so the user's retry hands over an all-zero key, which step 1 writes to disk BEFORE step 2 throws.
    persisted = null;
    expect(() => establishLike(state.sk)).toThrow('Face ID cancelled');
    expect(persisted).toEqual(ZEROS);   // ⚠ a corrupted credential for an identity that never existed
  });

  it('COPIED: .slice() sacrifices the copy, so the state buffer survives for the retry', () => {
    const state: KeyState = { sk: REAL_KEY() };

    expect(() => establishLike(state.sk.slice())).toThrow('Face ID cancelled');

    // The copy absorbed the zeroing; the real key is intact.
    expect(state.sk).toEqual(REAL_KEY());

    // The retry therefore persists the REAL key (and would go on to derive the right pubkey).
    persisted = null;
    expect(() => establishLike(state.sk.slice())).toThrow('Face ID cancelled');
    expect(persisted).toEqual(REAL_KEY());
    expect(state.sk).toEqual(REAL_KEY());
  });

  it('.slice() is a real copy, not a view — writes to it never reach the source', () => {
    const source = REAL_KEY();
    const copy = source.slice();
    expect(copy).toEqual(source);
    expect(copy.buffer).not.toBe(source.buffer);
    copy.fill(0);
    expect(source).toEqual(REAL_KEY());
  });
});
