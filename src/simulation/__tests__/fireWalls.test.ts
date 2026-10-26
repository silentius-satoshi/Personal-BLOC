import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The FIRE engine's walls (batch 1 build 3; FIRE plan R2, R7, D1 A′; `.claude/rules/engine.md`). fire.ts and taxes.ts are
 * pure + − × ÷ (G-FIRE stays exact on every runtime); each FIRE module imports only what its row says; cycleReplays.ts
 * is the one that imports a belief; no FIRE module reads the simulations; the risk core imports none of them; and no FIRE
 * file names a test-only engine input. Every assertion carries a tag; each planted bug in `build-3-mutations.json` turns
 * its own tag red.
 */

const ROOT = process.cwd();
const SIM = join(ROOT, 'src/simulation');
const read = (f: string): string => readFileSync(join(SIM, f), 'utf8');
const importsOf = (src: string): string[] => [...src.matchAll(/^import[^;]*?from '([^']+)';/gm)].map((m) => m[1]);
/** Code only — the walls match what runs, never what a comment says (as `cyclingSimPolicy.test.ts`'s walk does). */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const FIRE_SOURCES = ['fire.ts', 'fireBreakEven.ts', 'taxes.ts', 'cycleReplays.ts'];
const FIRE_FILES = [
  ...FIRE_SOURCES,
  ...['fire', 'fireBreakEven', 'taxes', 'cycleReplays', 'fireWalls'].map((t) => `__tests__/${t}.test.ts`),
  '__tests__/goldens/fireParity.golden.json', '__tests__/goldens/fireTimeline.golden.json',
];

describe('⭐ APPROX — fire.ts and taxes.ts are pure + − × ÷: no implementation-approximated Math in their import graph', () => {
  it('the walk reaches exactly the two files, finds none, and the break-even\'s Math.pow sits outside it', () => {
    // `cyclingSimPolicy.test.ts`'s own pattern and import walk (both quote styles), over comment-stripped code.
    const APPROXIMATED = /Math\.(a?sinh?|a?cosh?|a?tanh?|atan2|cbrt|exp|expm1|hypot|log|log1p|log2|log10|pow)\b|\*\*/;
    const RELATIVE_IMPORT = /from\s*['"]\.\/(\w+)['"]/g;
    const seen = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = read(file);
      for (const m of src.matchAll(RELATIVE_IMPORT)) walk(`${m[1]}.ts`);
      expect(code(src), `APPROX ${file}`).not.toMatch(APPROXIMATED);
    };
    walk('fire.ts');
    walk('taxes.ts');
    expect([...seen].sort(), 'APPROX the graph').toEqual(['fire.ts', 'taxes.ts']);
    expect(code(read('fireBreakEven.ts')), 'APPROX non-vacuous: the break-even builds its paths with Math.pow').toMatch(APPROXIMATED);
  });
});

describe('⭐ IMPORTS — each FIRE module imports only what its rule says', () => {
  it('fire.ts → ./taxes only (D-1 A); taxes.ts → nothing; fireBreakEven.ts → ./fire; cycleReplays.ts → ./powerLaw', () => {
    expect(importsOf(read('fire.ts')), 'IMPORTS fire.ts').toEqual(['./taxes']);
    expect(importsOf(read('taxes.ts')), 'IMPORTS taxes.ts').toEqual([]);
    expect(importsOf(read('fireBreakEven.ts')), 'IMPORTS fireBreakEven.ts').toEqual(['./fire']);
    expect(importsOf(read('cycleReplays.ts')), 'IMPORTS cycleReplays.ts').toEqual(['./powerLaw']);
    expect(importsOf(read('pricePaths.ts')).sort(), 'IMPORTS non-vacuous: the reader sees a module\'s imports').toEqual(['./cycleModel', './powerLaw']);
  });
});

describe('⭐ BELIEF — one FIRE module imports a belief; none reads the simulations; the risk core imports none (R2, D1 A′)', () => {
  it('cycleReplays.ts alone imports a belief, and no FIRE module imports pricePaths, monteCarlo or futuresRun', () => {
    const BELIEF = /^\.\/(powerLaw|cycleModel|cyclePath|pricePaths|cycleReplays)$/;
    for (const f of FIRE_SOURCES) {
      const imports = importsOf(read(f));
      expect(imports.some((i) => BELIEF.test(i)), `BELIEF ${f}`).toBe(f === 'cycleReplays.ts');
      for (const i of imports) expect(i, `BELIEF ${f} reads no simulation (D1 A′)`).not.toMatch(/pricePaths|monteCarlo|futuresRun/);
    }
  });

  it('outside the FIRE modules, only the Living tab\'s two tax readers import one — no risk module, no face yet', () => {
    const SRC = join(ROOT, 'src');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return f === '__tests__' ? [] : walk(p);
      return /\.(ts|tsx)$/.test(f) ? [p] : [];
    });
    const files = walk(SRC);
    expect(files.length, 'BELIEF non-vacuous: the walker reads src/').toBeGreaterThan(200);
    const importers = files
      .filter((f) => /from '[^']*\/(fire|fireBreakEven|cycleReplays|taxes)';/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length + 1).split('\\').join('/'))
      .sort();
    expect(importers, 'BELIEF the importers').toEqual([
      'hooks/useLivingSimulation.ts', 'simulation/fire.ts', 'simulation/fireBreakEven.ts', 'simulation/runSellToLive.ts',
    ]);
  });
});

describe('⭐ TEST-ONLY — no FIRE file names a test-only engine input, even in a comment', () => {
  it('the survival-guard grep\'s own list, read from it by its pattern, appears in no FIRE source, test or golden', () => {
    const guard = read('__tests__/cyclingSim.test.ts');
    const found = guard.match(/grep -rnE "([A-Za-z|]+)" src\/components\//);   // by its pattern, never its line number
    expect(found, 'TEST-ONLY the survival-guard grep').not.toBeNull();
    const names = found![1].split('|');
    expect(names.length, 'TEST-ONLY its list (a new name joins both)').toBeGreaterThanOrEqual(10);
    const engine = read('cyclingSim.ts');
    names.forEach((n, k) => expect(engine.includes(n), `TEST-ONLY positive control: name ${k} is an engine input`).toBe(true));
    for (const f of FIRE_FILES) {
      const text = read(f);
      names.forEach((n, k) => expect(text.includes(n), `TEST-ONLY ${f} names test-only input ${k}`).toBe(false));
    }
  });
});
