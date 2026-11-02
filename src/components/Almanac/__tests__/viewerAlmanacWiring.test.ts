import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, normalize } from 'node:path';
import { useStore } from '../../../store/useStore';

/**
 * ⚠ BL48 — trusted viewers in the Almanac (spec `pbloc-spec-trusted-viewers-v1`): what a viewer's faces leave out —
 * the copies off the app (V5 A) and Scenario's Pin, which saves (V4 B) — and everything the hub's faces can write, read
 * off the source, as the repo's wiring tests do; e2e/viewerAlmanac.spec.ts pins them on screen. With it, the owner's
 * ask: the family word his first viewer's examples used is gone everywhere — the app names a viewer "viewer" (the word is
 * spelt out below only by its letters, so this file passes its own sweep). Each assertion carries the tag its planted
 * bug turns red.
 */
const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('⭐ what a viewer\'s faces leave out', () => {
  it('⭐ COPIES — no copy, download or print of the schedule for a viewer (V5 A)', () => {
    const face = strip(read('src/components/Almanac/DecisionFace.tsx'));
    expect(face, 'COPIES the schedule\'s buttons, the owner\'s only').toMatch(
      /\{!s\.viewerMode && \(\s*<div className=\{styles\.presetRow\}>\s*<button type="button" className=\{styles\.ghostBtn\} onClick=\{\(\) => \{ void copySchedule\(\); \}\}>/);
    expect(face.match(/onClick=\{(downloadSchedule|printSchedule)\}/g), 'COPIES no other way to them').toHaveLength(2);
  });

  it('⭐ PIN — Scenario\'s Pin row and its drift line are the owner\'s only: a pin saves, a viewer\'s what-ifs never do', () => {
    const face = strip(read('src/components/Almanac/ScenarioFace.tsx'));
    expect(face, 'PIN the row').toMatch(/\{!viewerMode && \(\s*<div className=\{styles\.pinRow\}>/);
    expect(face, 'PIN the drift').toContain('{drift && !viewerMode && (');
    expect(face.match(/onClick=\{pin\}/g), 'PIN no other way to it').toHaveLength(2);
    expect(face, 'PIN the words, a viewer\'s without it').toContain(
      "{viewerMode ? 'Test a what-if against the plan.' : 'Pin a plan, then test a what-if against it.'}");
  });
});

/** The hub's import closure: AlmanacView.tsx and every module it imports, the store excepted — reached through `useStore`
 *  alone — with their comments removed. */
function hubClosure(): { path: string; code: string }[] {
  const seen = new Map<string, string>();
  const stack = ['src/components/Almanac/AlmanacView.tsx'];
  const resolve = (from: string, spec: string): string | null => {
    const base = normalize(join(dirname(from), spec)).split('\\').join('/');
    for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
      if (/\.(ts|tsx)$/.test(c) && existsSync(join(ROOT, c))) return c;
    }
    return null;
  };
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    const code = read(f);
    seen.set(f, strip(code));
    for (const m of code.matchAll(/(?:import|export)\s[^;]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const r = resolve(f, m[1] ?? m[2]);
      if (r && !r.includes('/__tests__/') && !r.startsWith('src/store/')) stack.push(r);
    }
  }
  return [...seen].map(([path, code]) => ({ path, code }));
}

/** What the hub's faces may call on the store (V4 B — a viewer's what-ifs save nothing): two reads; the viewer's own
 *  device tools — the live-height switch, the Sats converter and its live quote, Mining's list; and three writes no viewer
 *  reaches — Scenario's pin (its row the owner's only: PIN) and FIRE's inputs (no FIRE face for a viewer: OWNER ONLY;
 *  locked inside it: WHAT-IF). A name not on the list is a write a trusted viewer could make from a face: decide, then
 *  list it here, or lock it. */
const HUB_STORE_CALLS = [
  'getCurrentBtcHeld', 'getCurrentColdBtc',
  'setAlmanacLiveConsented', 'setAlmanacLiveEnabled',
  'setBtcPrice', 'setConverterActiveField', 'setConverterRawValue',
  'addMiningDevice', 'removeMiningDevice', 'setMiningCurrency', 'setMiningDevice', 'setMiningInputs', 'setMiningStrategy',
  'setPinnedScenario', 'setFireInputs', 'setInflationRate',
].sort();

describe('⭐ what the hub\'s faces can write (V4 B)', () => {
  it('⭐ WRITES — the faces call only the listed store functions: two reads, the viewer\'s own tools, three writes no viewer reaches', () => {
    const closure = hubClosure();
    const fns = Object.entries(useStore.getState()).filter(([, v]) => typeof v === 'function').map(([k]) => k);
    const FACES = ['Almanac/HalvingClock.tsx', 'Almanac/CycleClock.tsx', 'Tools/CbDefenseTool.tsx', 'Almanac/LedgerFace.tsx',
      'Almanac/CyclingFace.tsx', 'Almanac/ScenarioFace.tsx', 'Mining/MiningInputsPanel.tsx', 'Mining/MiningMain.tsx',
      'PowerLaw/PowerLawFace.tsx', 'Almanac/OwnershipFace.tsx', 'Almanac/UnifiedFace.tsx', 'Almanac/DecisionFace.tsx',
      'Almanac/FireFace.tsx', 'Converter/ConverterMain.tsx', 'Converter/ConverterSidebar.tsx'].map((f) => `src/components/${f}`);
    expect(closure.map((c) => c.path), 'WRITES premise: the walk reaches every face').toEqual(expect.arrayContaining(FACES));
    expect(fns.length > 100 && fns.includes('setIncome') && fns.includes('setCbAprPct'), 'WRITES premise: the store\'s functions').toBe(true);
    const called = fns.filter((n) => closure.some(({ code }) => new RegExp(`\\b${n}\\b`).test(code))).sort();
    expect(called, 'WRITES').toEqual(HUB_STORE_CALLS);
    expect(closure.filter(({ code }) => /\buseStore\.setState\b/.test(code)).map((c) => c.path), 'WRITES no raw write').toEqual([]);
  });
});

/** The word, and its "…'s" — built from letters, never written here. */
const WORD = ['d', 'a', 'd'].join('');
const OLD = new RegExp(`\\b${WORD}\\b|\\b${WORD}[’']s\\b|(?<!grand)fa${'ther'}`, 'i');

describe('⭐ "viewer", never the family word (the owner\'s ask, BL48)', () => {
  it('⭐ NO WORD — in no file of the repo: code, tests, docs, rules, the spec index, the book (grandfathering is another word)', () => {
    // Every file git would commit — tracked, or new and not ignored (`Claude outputs/` is ignored) — read as text.
    const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0').filter((f) => f && f !== 'node_modules');
    const hits = files.flatMap((f) => {
      let text = '';
      try { text = readFileSync(join(ROOT, f), 'utf8'); } catch { return []; }
      if (text.includes('\0')) return [];   // a binary
      return text.split('\n').flatMap((line, i) => (OLD.test(line) ? [`${f}:${i + 1}`] : []));
    });
    expect(OLD.test(`Good morning, ${WORD.toUpperCase()}`) && !OLD.test('grandfathered'), 'NO WORD premise: the sweep sees it').toBe(true);
    expect(files, 'NO WORD premise: the whole repo').toEqual(expect.arrayContaining(['00-MASTER-SPEC-INDEX.md', 'CLAUDE.md', 'src/App.tsx']));
    expect(hits, 'NO WORD').toEqual([]);
  });

  it('⭐ PREVIEW — "Preview as viewer" names no viewer: its banner reads no roster label', () => {
    const preview = strip(read('src/components/Viewer/ViewerPreview.tsx'));
    expect(preview, 'PREVIEW the banner').toContain("PREVIEW · what your viewer sees — {effectiveTrusted ? 'Trusted mode' : 'Safe mode'}");
    expect(preview, 'PREVIEW no label read').not.toMatch(/\.label\b/);
  });
});
