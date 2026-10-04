import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { msYearLabel, MS_TABLE, MS_TABLE_OWNERSHIP } from '../cyclingFaceView';

/**
 * The Milestones on a phone (spec `pbloc-spec-milestones-phone-v1.md`). The words are pinned here; the wiring is read off
 * the source (the repo has no render harness); `e2e/milestones.spec.ts` pins the layout and that the blocks show the
 * table's own figures. Each assertion carries the tag its named mutation turns red (MM1–MM22, CLAUDE.md § Test Suite).
 */
const ROOT = process.cwd();
const ALMANAC = join(ROOT, 'src/components/Almanac');
const read = (f: string): string => readFileSync(join(ALMANAC, f), 'utf8');
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const count = (src: string, needle: string): number => src.split(needle).length - 1;
const ruleBody = (css: string, sel: string): string => {
  const at = css.indexOf(`${sel} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

const FACES = {
  cycling: strip(read('CyclingFace.tsx')),
  strategy: strip(read('UnifiedFace.tsx')),
  ownership: strip(read('OwnershipFace.tsx')),
};

describe('the blocks\' words', () => {
  it('YEAR — a milestone\'s year with its unit: whole years bare, a turn\'s month to one decimal', () => {
    // mutation: toFixed(1) always ("1.0 yr") → red
    expect([12, 13, 18, 36, 60, 120].map(msYearLabel)).toEqual(['1 yr', '1.1 yr', '1.5 yr', '3 yr', '5 yr', '10 yr']);
  });

  it('QUERIES — the table from 768 px; Ownership\'s also leaves its 400 px side column, which starts where its CSS says', () => {
    // mutation: '(min-width: 640px)' → red (Cycling's table needs 561–583 px; its frame at 640 is 578, 538 in full mode)
    expect(MS_TABLE).toBe('(min-width: 768px)');
    expect(MS_TABLE_OWNERSHIP).toBe('(min-width: 768px) and (max-width: 919px)');
    // SIDE — the two-column shell's breakpoint, read from Ownership's CSS: the query's max is one under it.
    const css = strip(read('OwnershipFace.module.css'));
    const side = /@media \(min-width: (\d+)px\) \{\s*\.shell \{/.exec(css)?.[1];
    expect(side, 'SIDE: the .shell media query').toBeDefined();
    expect(MS_TABLE_OWNERSHIP, 'SIDE').toContain(`(max-width: ${Number(side) - 1}px)`);
  });
});

describe('⭐ the wiring', () => {
  it('⭐ ONE-MARKUP — each face renders its table OR its blocks, picked by one media query, never both', () => {
    for (const [name, src] of Object.entries(FACES)) {
      const query = name === 'ownership' ? 'MS_TABLE_OWNERSHIP' : 'MS_TABLE';
      // mutation: Strategy renders the blocks under the table too → red (and the e2e's ONCE)
      expect(count(src, `const msTable = useMediaQuery(${query});`), `ONE-MARKUP ${name}: the query`).toBe(1);
      expect(count(src, '<MilestoneBlocks '), `ONE-MARKUP ${name}: one blocks`).toBe(1);
      expect(count(src, '<table className={styles.msTable}>'), `ONE-MARKUP ${name}: one table`).toBe(1);
      const at = src.indexOf('{msTable ? (');
      expect(at, `ONE-MARKUP ${name}: the switch`).toBeGreaterThan(0);
      const table = src.indexOf('<table className={styles.msTable}>');
      const blocks = src.indexOf('<MilestoneBlocks ');
      const otherwise = src.indexOf(') : (', at);
      expect(at < table && table < otherwise && otherwise < blocks, `ONE-MARKUP ${name}: table, then the blocks in the else`).toBe(true);
    }
  });

  it('⭐ STRATEGY-COLUMNS — Strategy\'s table carries Debt and Equity after Yours (the owner\'s ask)', () => {
    const heads = [...FACES.strategy.matchAll(/<th className=\{[^}]*\}>([^<]+)<\/th>/g)].map((m) => m[1]);
    // mutation: no Debt column → red
    expect(heads.slice(heads.indexOf('Yours'), heads.indexOf('Yours') + 3), 'STRATEGY-COLUMNS').toEqual(['Yours', 'Debt', 'Equity']);
  });

  it('⭐ LAYOUT-ONLY — MilestoneBlocks reads no store and no engine; its CSS is tokens only', () => {
    const src = strip(read('MilestoneBlocks.tsx'));
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    // mutation: import useStore → red
    expect(imports, 'LAYOUT-ONLY').toEqual(['react', './MilestoneBlocks.module.css']);
    // WORDLESS — the face writes every word (M-I6): no word in a quoted literal, a template literal's text or JSX text.
    const ALLOWED = new Set(['react', './MilestoneBlocks.module.css', 'list', 'listitem', 'button', 'img', 'Enter', ' ', '']);
    const bare = ((s: string): string => {            // every interpolation dropped, braces balanced
      let out = '';
      let depth = 0;
      for (let i = 0; i < s.length; i++) {
        if (depth === 0 && s[i] === '$' && s[i + 1] === '{') { depth = 1; i++; continue; }
        if (depth > 0) { if (s[i] === '{') depth++; else if (s[i] === '}') depth--; continue; }
        out += s[i];
      }
      return out;
    })(src);
    const quoted = [...bare.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map((m) => m[1] ?? m[2]).filter((l) => !ALLOWED.has(l));
    const templated = [...bare.matchAll(/`([^`]*)`/g)].map((m) => m[1]).filter((t) => /[A-Za-z]/.test(t));
    const jsxText = [...bare.matchAll(/>((?:[^<>{}]|\{[^{}]*\})+)</g)].map((m) => m[1].replace(/\{[^{}]*\}/g, ""))
      .filter((t) => /[A-Za-z]/.test(t));
    expect([...quoted, ...templated, ...jsxText], 'WORDLESS').toEqual([]);
    expect(strip(read('MilestoneBlocks.module.css')), 'TOKENS').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('⭐ FIT — a block\'s figures stay on one line, and a cell never shrinks below its own content', () => {
    const css = strip(read('MilestoneBlocks.module.css'));
    // mutation: minmax(0, 1fr) → red here and in the e2e's FIT at 320 px (Strike LTV ran into its neighbour)
    expect(ruleBody(css, '.line'), 'FIT').toMatch(/grid-auto-columns:\s*minmax\(min-content,\s*1fr\)/);
    for (const sel of ['.label', '.value', '.sub']) expect(ruleBody(css, sel), `FIT ${sel}`).toMatch(/white-space:\s*nowrap/);
  });

  it('⭐ TABS (R3) — the dock\'s tab values shrink on a small phone, and in full mode the dock bleeds across .main\'s padding', () => {
    const dock = strip(read('ControlDock.module.css'));
    // mutation: font-size 12px → red (and the e2e's TABS: "Flywheel" cut at 360 px)
    expect(ruleBody(dock, '.tabValue'), 'CLAMP').toMatch(/font-size:\s*clamp\(10px,\s*3\.1vw,\s*12px\)/);
    // mutation: margin back to 12px -16px 0 → red (and the e2e's BLEED)
    expect(ruleBody(dock, '.dock'), 'BLEED').toMatch(/margin:\s*12px calc\(-16px - var\(--dock-bleed, 0px\)\) 0;/);
    const shell = strip(readFileSync(join(ROOT, 'src/components/Layout/AppShell.module.css'), 'utf8'));
    const pad = /\.main \{[^}]*?padding:\s*(\d+)px;/.exec(shell)?.[1];
    const bleed = /\[data-active-tab="almanac"\] \.main \{[^}]*--dock-bleed:\s*(\d+)px/.exec(shell)?.[1];
    expect(pad !== undefined && bleed !== undefined, 'BLEED: both found').toBe(true);
    expect(bleed, 'BLEED: = .main\'s padding').toBe(pad);
  });
});
