import { describe, it, expect } from 'vitest';
import { pickQuizIndices, checkQuizAnswers, checkNsecTail, checkBackupPassphrase } from '../recoveryQuiz';

// R2c-1 — pure ceremony verify logic. Node; rand injected for determinism.

/** A rand that replays a fixed sequence (then repeats the last value). */
const seq = (...xs: number[]) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)]; };

const VECTOR = 'leader monkey parrot ring guide accident before fence cannon height naive bean'.split(' ');

describe('pickQuizIndices', () => {
  it('an injected sequence yields the expected distinct pair', () => {
    // a = floor(0*12)=0; b = (0 + 1 + floor(0*11)) % 12 = 1
    expect(pickQuizIndices(seq(0, 0))).toEqual([0, 1]);
    // a = floor(0.99*12)=11; b = (11 + 1 + floor(0.99*11)) % 12 = (11+1+10)%12 = 10
    expect(pickQuizIndices(seq(0.99, 0.99))).toEqual([11, 10]);
  });

  it('both indices are in range 0–11', () => {
    for (const [x, y] of [[0, 0], [0.5, 0.5], [0.99, 0.99], [0.99, 0]]) {
      const [a, b] = pickQuizIndices(seq(x, y));
      expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThanOrEqual(11);
      expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThanOrEqual(11);
    }
  });

  it('a CONSTANT rand still returns two distinct indices (loop-free proof)', () => {
    for (const c of [0, 0.5, 0.99]) {
      const [a, b] = pickQuizIndices(() => c);
      expect(a).not.toBe(b);
    }
  });

  it('default Math.random: always distinct + in range over many draws', () => {
    for (let n = 0; n < 500; n++) {
      const [a, b] = pickQuizIndices();
      expect(a).not.toBe(b);
      expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThanOrEqual(11);
      expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThanOrEqual(11);
    }
  });
});

describe('checkQuizAnswers', () => {
  it('the correct pair → true', () => {
    expect(checkQuizAnswers(VECTOR, [0, 5], [VECTOR[0], VECTOR[5]])).toBe(true);
  });

  it('one wrong word → false', () => {
    expect(checkQuizAnswers(VECTOR, [0, 5], [VECTOR[0], 'wrong'])).toBe(false);
  });

  it('transposed answers → false (distinct words must land in their own slots)', () => {
    expect(checkQuizAnswers(VECTOR, [0, 5], [VECTOR[5], VECTOR[0]])).toBe(false);
  });

  it('trims + lowercases each answer', () => {
    expect(checkQuizAnswers(VECTOR, [0, 5], [`  ${VECTOR[0].toUpperCase()} `, ` ${VECTOR[5]} `])).toBe(true);
  });
});

describe('checkNsecTail', () => {
  const NSEC = 'nsec10allq0gjx7fddtzef0ax00mdps9t2kmtrldkyjfs8l5xruwvh2dq0lhhkp';

  it('the last 6 chars → true', () => {
    expect(checkNsecTail(NSEC, NSEC.slice(-6))).toBe(true);
  });

  it('trims the input', () => {
    expect(checkNsecTail(NSEC, `  ${NSEC.slice(-6)}\n`)).toBe(true);
  });

  it('a wrong tail → false', () => {
    expect(checkNsecTail(NSEC, 'zzzzzz')).toBe(false);
  });

  it('is case-sensitive (bech32 is lowercase)', () => {
    expect(checkNsecTail(NSEC, NSEC.slice(-6).toUpperCase())).toBe(false);
  });
});

// R2c-7b-fix — the ENCRYPTED path's verify. The saved artifact is a passphrase-locked ncryptsec, so this is what
// stands between the user and an unopenable backup.
describe('checkBackupPassphrase', () => {
  it('an exact match → true', () => {
    expect(checkBackupPassphrase('correct horse battery', 'correct horse battery')).toBe(true);
  });

  // ⚠ THE LOAD-BEARING CASE. The ceremony encrypts with filePass.trim(), so the passphrase that actually opens the
  // file is the trimmed one. Comparing untrimmed would reject a re-entry that WOULD decrypt it.
  it('trims BOTH sides — surrounding whitespace on either input still matches', () => {
    expect(checkBackupPassphrase('  hunter two  ', 'hunter two')).toBe(true);
    expect(checkBackupPassphrase('hunter two', '  hunter two\n')).toBe(true);
    expect(checkBackupPassphrase(' hunter two ', '\thunter two  ')).toBe(true);
  });

  it('inner whitespace is significant (unlike a seed phrase, this is not normalized)', () => {
    expect(checkBackupPassphrase('hunter two', 'huntertwo')).toBe(false);
    expect(checkBackupPassphrase('hunter two', 'hunter  two')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(checkBackupPassphrase('Hunter Two', 'hunter two')).toBe(false);
  });

  it('a real mismatch → false', () => {
    expect(checkBackupPassphrase('correct horse battery', 'correct horse staple')).toBe(false);
  });

  // Nothing can confirm by submitting nothing, even if the expected passphrase were somehow blank.
  it('an empty expected passphrase never passes', () => {
    expect(checkBackupPassphrase('', '')).toBe(false);
    expect(checkBackupPassphrase('   ', '   ')).toBe(false);
    expect(checkBackupPassphrase('', 'anything')).toBe(false);
  });

  it('an empty re-entry against a real passphrase → false', () => {
    expect(checkBackupPassphrase('hunter two', '   ')).toBe(false);
  });
});
