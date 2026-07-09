import { describe, it, expect } from 'vitest';
import { classifyRecoveryInput, RECOVERY_WORD_COUNT } from '../recoveryInput';
import { skFromWords, InvalidSeedWordsError } from '../nip06Key';

// R2b-2 — SHAPE classification for the dual-format Recovery Key field. Pure, node, no crypto.

const VECTOR_WORDS = 'leader monkey parrot ring guide accident before fence cannon height naive bean';
const VECTOR_NSEC  = 'nsec10allq0gjx7fddtzef0ax00mdps9t2kmtrldkyjfs8l5xruwvh2dq0lhhkp';
// Shape-only fixture — the classifier never decrypts, so this needs the prefix, not a valid payload.
const NCRYPTSEC    = 'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p';

describe('classifyRecoveryInput — nsec', () => {
  it("an nsec1… string classifies as nsec, trimmed", () => {
    expect(classifyRecoveryInput(`  ${VECTOR_NSEC}  `)).toEqual({ kind: 'nsec', value: VECTOR_NSEC });
  });

  it('the prefix check is the ONLY nsec test — a malformed nsec1… still routes to the nsec door (nip19.decode owns the verdict)', () => {
    expect(classifyRecoveryInput('nsec1garbage')).toEqual({ kind: 'nsec', value: 'nsec1garbage' });
  });

  it('an UPPERCASE NSEC1… is not an nsec (bech32 nsecs are lowercase) → single token → unknown', () => {
    expect(classifyRecoveryInput(VECTOR_NSEC.toUpperCase())).toEqual({ kind: 'unknown' });
  });
});

// R2c-7a — the fourth kind. Shape-only: nip49.decrypt (and the passphrase) own the verdict, never this.
describe('classifyRecoveryInput — encrypted (ncryptsec)', () => {
  it('an ncryptsec1… string classifies as encrypted, trimmed', () => {
    expect(classifyRecoveryInput(`  ${NCRYPTSEC}  `)).toEqual({ kind: 'encrypted', value: NCRYPTSEC });
  });

  it('the prefix check is the ONLY test — a malformed ncryptsec1… still routes to the decrypt door', () => {
    expect(classifyRecoveryInput('ncryptsec1garbage')).toEqual({ kind: 'encrypted', value: 'ncryptsec1garbage' });
  });

  // ⚠ PINS THE DISJOINTNESS. The two prefixes diverge at char 2 (`ns…` vs `nc…`), so no check order can confuse
  // them. If a future edit ever makes one a prefix of the other, these two fail together.
  it('ncryptsec1 and nsec1 are disjoint prefixes — neither can misclassify as the other', () => {
    expect('ncryptsec1'.startsWith('nsec1')).toBe(false);
    expect(classifyRecoveryInput(NCRYPTSEC).kind).toBe('encrypted');
    expect(classifyRecoveryInput(VECTOR_NSEC).kind).toBe('nsec');
  });

  it('an UPPERCASE NCRYPTSEC1… is not encrypted (bech32 is lowercase) → single token → unknown', () => {
    expect(classifyRecoveryInput(NCRYPTSEC.toUpperCase())).toEqual({ kind: 'unknown' });
  });
});

describe('classifyRecoveryInput — words', () => {
  it('exactly 12 tokens classify as words', () => {
    expect(RECOVERY_WORD_COUNT).toBe(12);
    expect(classifyRecoveryInput(VECTOR_WORDS)).toEqual({ kind: 'words', value: VECTOR_WORDS });
  });

  it('collapses newlines, tabs and doubled spaces to single spaces', () => {
    const messy = `  leader   monkey parrot\nring\tguide  accident before fence
                   cannon height naive bean  `;
    expect(classifyRecoveryInput(messy)).toEqual({ kind: 'words', value: VECTOR_WORDS });
  });

  // THE BOUNDARY: classification is shape, validity belongs to skFromWords. A classifier that also validated
  // would duplicate (and could drift from) the BIP-39 contract.
  it('12 NONSENSE tokens still classify as words — skFromWords, not the classifier, rejects them', () => {
    const nonsense = 'aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll';
    expect(classifyRecoveryInput(nonsense)).toEqual({ kind: 'words', value: nonsense });
    expect(() => skFromWords(nonsense)).toThrow(InvalidSeedWordsError);
  });

  it('a real 12-word phrase round-trips classifier → skFromWords', () => {
    const c = classifyRecoveryInput(VECTOR_WORDS);
    expect(c.kind).toBe('words');
    expect(skFromWords((c as { value: string }).value)).toHaveLength(32);
  });
});

describe('classifyRecoveryInput — unknown', () => {
  it.each([
    ['empty',            ''],
    ['whitespace only',  '   \n\t '],
    ['11 tokens',        'leader monkey parrot ring guide accident before fence cannon height naive'],
    ['13 tokens',        `${VECTOR_WORDS} extra`],
    ['a single word',    'leader'],
    ['garbage',          'hunter2!!'],
    ['an npub',          'npub1zutzeysacnf9rru6zqwmxd54mud0k44tst6l70ja5mhv8jjumytsd2x7nu'],
  ])('%s → unknown', (_label, input) => {
    expect(classifyRecoveryInput(input)).toEqual({ kind: 'unknown' });
  });
});
