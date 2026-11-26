import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Sweep 3 (A5-8) — useStrikeData's `active` guard. The effect's flag was passed BY VALUE (`fetchAll(active)`): the call
 * kept the `true` it was handed, so a poll in flight when the effect was torn down (the page hidden, the owner switched
 * to viewer mode) still wrote the Strike fields. The guard is now a getter the call reads after every await.
 * No render harness here (the repo has none for hooks), so the shape is pinned in the source.
 * Mutation: `fetchAll(() => active)` → `fetchAll(active)` (with the parameter back to a boolean) → red.
 */
const SRC = readFileSync(join(process.cwd(), 'src/hooks/useStrikeData.ts'), 'utf8');

describe('⭐ STRIKE GUARD — a poll torn down mid-request writes nothing', () => {
  it('⭐ STRIKE GUARD — the guard is a getter, read after every await, and the effect hands it its own flag', () => {
    expect(SRC, 'STRIKE GUARD the parameter is a getter').toContain('const fetchAll = async (isActive: () => boolean = () => true) =>');
    expect(SRC, 'STRIKE GUARD the effect passes its flag live').toContain('await fetchAll(() => active);');
    expect(SRC, 'STRIKE GUARD no by-value call').not.toMatch(/fetchAll\(active\)/);
    const body = SRC.slice(SRC.indexOf('const fetchAll'), SRC.indexOf('useEffect('));
    // Every exit before a write reads the getter: the 503, the !ok, the success and the catch.
    expect(body.match(/if \(!isActive\(\)\) return;/g)?.length, 'STRIKE GUARD four checks').toBe(4);
    expect(body, 'STRIKE GUARD no stale boolean left').not.toMatch(/!active\b/);
    // The cleanup still sets the effect's flag false — what the getter reads.
    expect(SRC).toContain('return () => { active = false; clearInterval(interval); };');
  });
});
