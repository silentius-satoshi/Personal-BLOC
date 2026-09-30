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
// DecisionFace (Run B) is the fourth engine face — its reset must mirror its engine inputs like the other three.
const FACES = ['CyclingFace.tsx', 'OwnershipFace.tsx', 'UnifiedFace.tsx', 'DecisionFace.tsx'] as const;
const ENGINE_DEPS = /const engineInputs = useMemo\(\(\) => \(\{[\s\S]*?\}\), \[([\s\S]*?)\]\);/;
const ENGINE_BODY = /const engineInputs = useMemo\(\(\) => \(\{([\s\S]*?)\}\), \[/;
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

  it('⭐ the support policy (Run 2b) reaches the engine AND resets the lens', () => {
    // In the object handed to the engine, in its memo's deps, and in the reset list — a policy setting changed under
    // an engaged stress must clear the scenario, exactly like every other engine input.
    expect(src.match(ENGINE_BODY)?.[1] ?? '', `${face}: engineInputs body`).toMatch(/\bsupportPolicy\b/);
    expect(engineDeps, `${face}: engineInputs deps`).toContain('supportPolicy');
    expect(resetDeps, `${face}: lens-reset deps`).toContain('supportPolicy');
  });

  it('⭐ the owner\'s cold reserve (real-cold spec v1) reaches the engine AND resets the lens', () => {
    // A cold move logged on the Daily view changes the reserve — an engaged stress measured against the old one must clear.
    // ⚠ WIDENED for the Decision face (Run B, G1): its run starts from THE MOVE's position when the move is made
    // (`seedFromMove ? placement.opening.coldBtc : s.openingColdBtc`), so the literal parents' form can't hold there.
    // The regex accepts the bare form OR a ternary whose ELSE-branch is the store's reserve — an inverted ternary, or
    // a seed with no store fallback, still fails it (both proven red). The full seeding rule is pinned in
    // decisionWiring.test.ts.
    expect(src.match(ENGINE_BODY)?.[1] ?? '', `${face}: engineInputs body`)
      .toMatch(/\bopeningColdBtc: (?:[^,\n]*? : )?s\.openingColdBtc\b/);
    expect(engineDeps, `${face}: engineInputs deps`).toContain('s.openingColdBtc');
    expect(resetDeps, `${face}: lens-reset deps`).toContain('s.openingColdBtc');
  });
});
