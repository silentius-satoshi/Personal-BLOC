import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cycleConvergencePath, cycleMultAt } from '../cyclePath';
import { plFairValue, addMonths, PL_ON_THE_LINE } from '../powerLaw';

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

// The Advisor's price path — its operating-plan goldens, its pricePath tests and the month-1 step through the engine —
// left with runAdvisor in 5e (batch 1, D5-A): no screen had called it since the plan of record's Run 3. What stays is
// the cycle path's own month-1 step, which nothing else pins, and invariant 3, turned around: the engine is gone.

// ⚠ NAMED TRAP — the month-1 step (its third occurrence; see cyclePath.test.ts "Trap 1"). On the line,
// path[0] is the live price EXACTLY and path[1..] sits ON the modelled curve, so month 0→1 is a
// discontinuity whose SIGN depends on the anchor. Invisible when you reason about "the path" instead of
// path[0] vs path[1]. Fixed UTC dates + synthetic anchors — never today or the live price.
describe('the 4-yr cycle path at a 12-month horizon — the month-1 step', () => {
  const START = utc('2026-09-13');
  const onCurve = (m: number) => { const d = addMonths(START, m); return plFairValue(d) * cycleMultAt(d); };

  it('⭐ the step is SIGNED by the anchor — down from $80k, up from $60k', () => {
    const hi = cycleConvergencePath(80_000, START, 12, PL_ON_THE_LINE);
    const lo = cycleConvergencePath(60_000, START, 12, PL_ON_THE_LINE);
    expect(hi[1] / hi[0] - 1).toBeLessThan(-0.15);
    expect(lo[1] / lo[0] - 1).toBeGreaterThan(0.05);
  });

  it('⭐ month 0 is the anchor exactly and month 1 onward sits ON the curve (the on-the-line decision)', () => {
    const path = cycleConvergencePath(80_000, START, 12, PL_ON_THE_LINE);
    expect(path[0]).toBe(80_000);
    for (let m = 1; m <= 12; m++) expect(Math.abs(path[m] / onCurve(m) - 1)).toBeLessThan(1e-12);
  });

  it('a 12-month segment is NOT always monotone — mid-2029 holds the top AND a fall', () => {
    // Pinned so nobody writes "the segment is monotone" into copy or a test again.
    const path = cycleConvergencePath(390_000, utc('2029-06-13'), 12, PL_ON_THE_LINE);
    expect(path.slice(1).some((v, i) => v > path[i])).toBe(true);
    expect(path.slice(1).some((v, i) => v < path[i])).toBe(true);
  });
});

describe('⭐ invariant 3 — runAdvisor is gone (5e, D5-A; the comparison engine kept one release after the plan of record)', () => {
  /** Every .ts/.tsx under src, outside tests. */
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return e.name === '__tests__' || e.name === '__probe__' ? [] : sources(p);
      return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
    });
  }
  /** What left with it: the engine, its tier helpers, its projection's start, the Coinbase projection and its classifier. */
  const GONE = /\b(runAdvisor|deriveAdvisorStart|getTier|getTierColor|getTierLabel|runCoinbaseLoan|classifyLtv)\(/;

  it('⭐ GONE — no source file defines or calls the engine or what left with it; its helpers stay where they were', () => {
    const src = fileURLToPath(new URL('../..', import.meta.url));
    const files = sources(src);
    // Non-vacuous: the sweep reads the whole tree, the engine's old file among it, and that file still holds the helpers.
    expect(files.length, 'INV3 the sweep reads src').toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith(join('simulation', 'runAdvisor.ts'))), 'INV3 the sweep reads its old file').toBe(true);
    const hits = files.filter((f) => GONE.test(readFileSync(f, 'utf8'))).map((f) => f.split(/[\\/]/).pop());
    expect(hits, 'INV3 GONE — no definition and no call left').toEqual([]);
    const home = readFileSync(join(src, 'simulation', 'runAdvisor.ts'), 'utf8');
    for (const helper of ['getCurrentStrategyMonth', 'isStrategyComplete', 'getNdpStatus']) {
      expect(home, `INV3 ${helper} stays`).toMatch(new RegExp(`export function ${helper}\\(`));
    }
  });
});
