import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⚠ STRUCTURAL GUARD — how the three engine faces wire the owner's REAL cold reserve (real-cold spec v1). The repo has
 * no render harness, so, like resetMirror / supportPolicyWiring, these rules are read off the source:
 *
 *  - the reserve comes from the store getter `getCurrentColdBtc()` (anchor + journal) — never the raw anchor;
 *  - every opening figure includes it: `openingBtc` feeds the "from X ₿" tiles, the seed row and "Opening position",
 *    and the engine's month 0 already holds the reserve, so leaving it out reads an unspent reserve as ₿ gained;
 *  - no Almanac file passes `deriveOwnership` a 4th (cold) argument — the engine's `btcHeld` already contains the
 *    reserve, so passing it again double-counts the pool (the ownership.test.ts convention, widened to the directory);
 *  - the "Keep me safe down to" slider sits behind `coldBufferPct > 0`: a reserve now opens the cold card with the sweep
 *    OFF, and the slider must not render at 0%.
 * (The engine-input / lens-reset mirror for `openingColdBtc` is pinned in resetMirror.test.ts.)
 *
 * Each check was proven red by a temporary edit to a real face before it landed.
 */
const FACES = ['CyclingFace.tsx', 'OwnershipFace.tsx', 'UnifiedFace.tsx'] as const;
const ALMANAC = join(process.cwd(), 'src/components/Almanac');
const readAlmanac = (file: string): string => readFileSync(join(ALMANAC, file), 'utf8');

describe.each(FACES)('%s — the cold reserve wiring', (face) => {
  const src = readAlmanac(face);

  it('⭐ the selector reads the reserve through getCurrentColdBtc()', () => {
    expect(src).toMatch(/\bopeningColdBtc: st\.getCurrentColdBtc\(\),/);
  });

  it('⭐ the opening figure includes the reserve', () => {
    const line = src.match(/const openingBtc = [^;]*;/)?.[0] ?? '';
    expect(line, `${face}: const openingBtc = …`).not.toBe('');
    expect(line).toMatch(/\bs\.openingColdBtc\b/);
  });
});

describe('no Almanac file passes deriveOwnership the cold pool', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(f) ? [p] : [];
  });

  it('⭐ every deriveOwnership call in src/components/Almanac/ takes three arguments', () => {
    const calls = walk(ALMANAC).flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/deriveOwnership\(([^)]*)\)/g)].map((m) => ({ f, args: m[1] })));
    expect(calls.length, 'deriveOwnership calls found').toBeGreaterThan(3);   // non-vacuous: the walker sees them
    for (const { f, args } of calls) {
      expect(args.split(',').length, `${f}: deriveOwnership(${args}) must not pass coldBtc`).toBe(3);
    }
  });
});

describe('the cold card never renders its buffer slider at 0%', () => {
  it.each(['CyclingFace.tsx', 'UnifiedFace.tsx'] as const)(
    '⭐ %s: "Keep me safe down to" sits behind coldBufferPct > 0', (face) => {
      const src = readAlmanac(face);
      const at = src.indexOf('label="Keep me safe down to"');
      expect(at, `${face}: the slider`).toBeGreaterThan(0);
      // From the cold block's policy/no-policy fork to the slider: the sweep-on gate must sit in between.
      const fork = src.lastIndexOf('applied ? (', at);
      expect(fork, `${face}: the applied fork before the slider`).toBeGreaterThan(0);
      expect(src.slice(fork, at)).toMatch(/coldBufferPct\s*>\s*0\s*(?:\?|&&)/);
    },
  );
});
