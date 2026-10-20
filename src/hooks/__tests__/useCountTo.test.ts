import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COUNT_MS, countFrame } from '../useCountTo';

/**
 * 5e (F12) — the chart's headline counts to a new figure (the device's copy handing over to the live history, and every
 * refresh that moves the price) over a few hundred ms, easing out; never on the first draw, never from "no figure", never
 * with reduced motion. The frames are pure; the hook's wiring is read off its source (the repo has no render harness).
 */
describe('⭐ F12 COUNT — the frames', () => {
  it('⭐ F12 COUNT — it starts at the figure on screen and ends exactly on the new one, up and down', () => {
    expect(countFrame(98_765.43, 99_000, 0), 'COUNT starts on screen').toBe(98_765.43);
    expect(countFrame(98_765.43, 99_000, COUNT_MS), 'COUNT ends exactly').toBe(99_000);
    expect(countFrame(98_765.43, 99_000, COUNT_MS * 3), 'COUNT stays there').toBe(99_000);
    expect(countFrame(99_000, 98_765.43, COUNT_MS), 'COUNT down ends exactly').toBe(98_765.43);
    expect(countFrame(1, 2, -50), 'COUNT a frame before its start is its start').toBe(1);
  });

  it('⭐ F12 COUNT — every frame moves toward the new figure, never past it, and it eases out (most of the way in the first half)', () => {
    const frames = Array.from({ length: COUNT_MS + 1 }, (_, ms) => countFrame(100, 200, ms));
    for (let i = 1; i < frames.length; i++) expect(frames[i], `COUNT monotone at ${i} ms`).toBeGreaterThanOrEqual(frames[i - 1]);
    expect(frames.every((v) => v >= 100 && v <= 200), 'COUNT never past it').toBe(true);
    expect(countFrame(100, 200, COUNT_MS / 2), 'COUNT eases out').toBeGreaterThan(180);
  });

  it('a few hundred milliseconds — the plan of record\'s F12', () => {
    expect(COUNT_MS).toBe(400);
  });
});

describe('⭐ F12 COUNT — the hook (read off its source)', () => {
  const HOOK = readFileSync(join(process.cwd(), 'src', 'hooks', 'useCountTo.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('⭐ F12 COUNT — no count on the first draw, from no figure, or with reduced motion; frames on rAF\'s own clock', () => {
    expect(HOOK, 'COUNT reduced motion').toMatch(/const reduced = useReducedMotion\(\);/);
    expect(HOOK, 'COUNT a jump: the first draw, no figure, reduced motion, nothing to count')
      .toMatch(/if \(target === null \|\| from === null \|\| reduced \|\| from === target\) \{\s*onScreen\.current = target;\s*setShown\(target\);\s*return;/);
    expect(HOOK, 'COUNT the figure on screen in a ref').toMatch(/const onScreen = useRef<number \| null>\(target\);/);
    expect(HOOK, 'COUNT rAF timestamps').toMatch(/const step = \(ts: number\) => \{\s*if \(start === null\) start = ts;\s*const v = countFrame\(from, target, ts - start\);/);
    expect(HOOK, 'COUNT never Date.now').not.toMatch(/Date\.now|performance\.now|setInterval/);
    expect(HOOK, 'COUNT cancelled with its figure').toMatch(/return \(\) => cancelAnimationFrame\(raf\);/);
  });
});
