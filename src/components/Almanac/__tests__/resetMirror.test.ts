import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⚠ STRUCTURAL GUARD — each face's lens-reset effect must MIRROR its engine-inputs memo.
 *
 * All three engine faces drop a price-stress scenario the moment any engine input changes: a stress run
 * measured against inputs that have since moved reports the wrong position. That rule lived only in a
 * comment ("if an input is added to runCyclingSim, add it here too") and it drifted — `coldBufferPct`
 * reached `engineInputs` on both faces but never the reset list, so dragging the cold-storage slider
 * under an engaged lens kept a stale scenario. The comment could not hold the mirror; this test does.
 *
 * `startDate` is the one legitimate omission: it only feeds `pricePath`, which the reset list carries.
 *
 * Proven red against the unfixed faces before `coldBufferPct` was added — a regex that matched nothing
 * would pass without testing anything, which is why the first case asserts the lists are real.
 */
const FACES = ['CyclingFace.tsx', 'OwnershipFace.tsx', 'UnifiedFace.tsx'] as const;
const ENGINE_DEPS = /const engineInputs = useMemo\(\(\) => \(\{[\s\S]*?\}\), \[([\s\S]*?)\]\);/;
const RESET_DEPS = /useEffect\(\(\) => \{ setLens\(1\); \}, \[([\s\S]*?)\]\);/;
const LEGITIMATE_OMISSIONS = new Set(['startDate']);

function readFace(face: string): string {
  return readFileSync(join(process.cwd(), 'src/components/Almanac', face), 'utf8');
}

function depList(src: string, re: RegExp): string[] {
  const m = src.match(re);
  if (!m) return [];
  return m[1].split(',').map((d) => d.trim()).filter(Boolean);
}

describe.each(FACES)('%s — the lens reset mirrors the engine inputs', (face) => {
  const src = readFace(face);
  const engineDeps = depList(src, ENGINE_DEPS);
  const resetDeps = depList(src, RESET_DEPS);

  it('both dep arrays are found and hold real content (no vacuous pass)', () => {
    expect(engineDeps.length).toBeGreaterThan(5);
    expect(resetDeps.length).toBeGreaterThan(5);
    // A known member of each, so a regex that grabbed the wrong array cannot pass either.
    expect(engineDeps).toContain('cbDebt');
    expect(resetDeps).toContain('pricePath');
  });

  it('⭐ every engine input except startDate also resets the lens', () => {
    const missing = engineDeps.filter((d) => !LEGITIMATE_OMISSIONS.has(d) && !resetDeps.includes(d));
    expect(missing, `${face}: engine inputs that do not reset the lens`).toEqual([]);
  });
});
