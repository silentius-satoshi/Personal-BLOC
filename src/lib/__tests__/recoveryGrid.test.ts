import { describe, it, expect } from 'vitest';
import { distributePaste, suggestWords, phraseStatus, isWord } from '../recoveryGrid';

// R2b-3 — pure capture-grid logic. Node, real wordlist + validateWords (both proven in-tree via nip06Key).

const VECTOR = 'leader monkey parrot ring guide accident before fence cannon height naive bean'.split(' ');
const fill = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`);

describe('distributePaste', () => {
  it('exactly 12 tokens → fill-from-start, regardless of focus', () => {
    for (const focus of [0, 5, 11]) {
      expect(distributePaste(fill(12), focus)).toBe('fill-from-start');
    }
  });

  it('5 tokens at focus 9 → 3 tokens (truncates at box 12)', () => {
    expect(distributePaste(fill(5), 9)).toEqual(['w0', 'w1', 'w2']);
  });

  it('5 tokens at focus 0 → all 5 (room to spare)', () => {
    expect(distributePaste(fill(5), 0)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4']);
  });

  it('a single token → [] (passthrough — default input behavior)', () => {
    expect(distributePaste(['leader'], 3)).toEqual([]);
  });

  it('zero tokens → []', () => {
    expect(distributePaste([], 0)).toEqual([]);
  });

  it('2 tokens at the last box → 1 token (only box 12 is left)', () => {
    expect(distributePaste(['a', 'b'], 11)).toEqual(['a']);
  });
});

describe('suggestWords', () => {
  it("'ab' → the first 4 prefix matches, capped", () => {
    expect(suggestWords('ab')).toEqual(['abandon', 'ability', 'able', 'about']);
  });

  it('is case-insensitive', () => {
    expect(suggestWords('AB')).toEqual(suggestWords('ab'));
  });

  it('respects a custom max', () => {
    expect(suggestWords('ab', 2)).toEqual(['abandon', 'ability']);
  });

  it("'zzz' → [] (no match)", () => {
    expect(suggestWords('zzz')).toEqual([]);
  });

  it('empty / whitespace prefix → []', () => {
    expect(suggestWords('')).toEqual([]);
    expect(suggestWords('   ')).toEqual([]);
  });

  it('a full word prefix still returns it', () => {
    expect(suggestWords('zoo')).toContain('zoo');
  });
});

describe('phraseStatus', () => {
  it('the NIP-06 vector → valid', () => {
    expect(phraseStatus(VECTOR)).toBe('valid');
  });

  it('normalizes case + whitespace before validating', () => {
    expect(phraseStatus(VECTOR.map((w, i) => (i % 2 ? `  ${w.toUpperCase()} ` : w)))).toBe('valid');
  });

  it('one word swapped to ANOTHER valid word → bad-checksum (all words valid, checksum fails)', () => {
    const swapped = [...VECTOR];
    swapped[11] = 'zoo';   // 'zoo' is a wordlist word, so this fails the checksum, not the wordlist
    expect(swapped.every(isWord)).toBe(true);
    expect(phraseStatus(swapped)).toBe('bad-checksum');
  });

  it('any empty box → incomplete', () => {
    const gap = [...VECTOR];
    gap[6] = '';
    expect(phraseStatus(gap)).toBe('incomplete');
  });

  it('fewer than 12 values → incomplete', () => {
    expect(phraseStatus(VECTOR.slice(0, 11))).toBe('incomplete');
  });
});

describe('isWord', () => {
  it('a wordlist word → true, case/whitespace-insensitive', () => {
    expect(isWord('leader')).toBe(true);
    expect(isWord('LEADER')).toBe(true);
    expect(isWord('  leader  ')).toBe(true);
  });

  it('a non-word / empty → false', () => {
    expect(isWord('zzzznotaword')).toBe(false);
    expect(isWord('')).toBe(false);
  });
});
