import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  msYearLabel, MS_TABLE, MS_TABLE_OWNERSHIP, MS_VIEWS_CYCLING, MS_VIEWS_STRATEGY, MS_VIEWS_OWNERSHIP,
} from '../cyclingFaceView';

/**
 * The Milestones on a phone (spec `pbloc-spec-milestones-phone-v1.md`, Run 2: the switch table). The year label, the
 * queries and each face's views are pinned here; the wiring is read off the source (the repo has no render harness);
 * `e2e/milestones.spec.ts` pins the layout, the switch, and that every view shows the table's own figures. Each
 * assertion carries the tag its named mutation turns red (MV1–MV28, CLAUDE.md § Test Suite).
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
  cycling: { src: strip(read('CyclingFace.tsx')), views: MS_VIEWS_CYCLING, name: 'MS_VIEWS_CYCLING', query: 'MS_TABLE' },
  strategy: { src: strip(read('UnifiedFace.tsx')), views: MS_VIEWS_STRATEGY, name: 'MS_VIEWS_STRATEGY', query: 'MS_TABLE' },
  ownership: { src: strip(read('OwnershipFace.tsx')), views: MS_VIEWS_OWNERSHIP, name: 'MS_VIEWS_OWNERSHIP', query: 'MS_TABLE_OWNERSHIP' },
};
/** A face's Milestones table headers, less Year (its th carries a two-class template), in the table's order. */
const headsOf = (src: string): string[] => {
  const at = src.indexOf('<table className={styles.msTable}>');
  const head = src.slice(at, src.indexOf('</thead>', at));
  return [...head.matchAll(/<th className=\{[^}]*\}>([^<]+)<\/th>/g)].map((m) => m[1]);
};

describe('the Milestones\' words', () => {
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

  it('VIEWS — each face\'s switch views partition its table\'s columns: every column in exactly one view, in the table\'s order', () => {
    for (const [face, f] of Object.entries(FACES)) {
      const heads = headsOf(f.src);
      expect(heads.length, `VIEWS ${face}: the table's headers`).toBeGreaterThan(5);
      const cols = f.views.flatMap((v) => v.cols);
      // mutation: a view drops a column (Strategy's $ without Equity) → red; a column in two views → red
      expect([...cols].sort(), `PARTITION ${face}`).toEqual([...heads].sort());
      for (const v of f.views) {
        const at = v.cols.map((c) => heads.indexOf(c));
        // mutation: Ownership's LTV view as Price · Zone · CB LTV → red
        expect(at, `ORDER ${face} ${v.key}: the table's order`).toEqual([...at].sort((a, b) => a - b));
        expect(v.name.length > 0 && v.label.length > 0, `VIEWS ${face} ${v.key}: named`).toBe(true);
        // mutation: the LTV view's spoken name without its visible text ('Loan to value') → red (WCAG 2.5.3)
        if (/[A-Za-z]/.test(v.name)) expect(v.label.toLowerCase(), `LABEL-IN-NAME ${face} ${v.key}`).toContain(v.name.toLowerCase());
      }
      expect(new Set(f.views.map((v) => v.key)).size, `VIEWS ${face}: one key a view`).toBe(f.views.length);
    }
  });
});

describe('⭐ the wiring', () => {
  it('⭐ ONE-MARKUP — each face renders its table OR its switch table, picked by one media query, never both', () => {
    for (const [name, f] of Object.entries(FACES)) {
      const src = f.src;
      // mutation: Strategy renders the switch table under the table too → red (and the e2e's ONCE)
      expect(count(src, `const msTable = useMediaQuery(${f.query});`), `ONE-MARKUP ${name}: the query`).toBe(1);
      expect(count(src, '<MilestoneSwitchTable '), `ONE-MARKUP ${name}: one switch table`).toBe(1);
      expect(count(src, '<table className={styles.msTable}>'), `ONE-MARKUP ${name}: one table`).toBe(1);
      const at = src.indexOf('{msTable ? (');
      expect(at, `ONE-MARKUP ${name}: the switch`).toBeGreaterThan(0);
      const table = src.indexOf('<table className={styles.msTable}>');
      const phone = src.indexOf('<MilestoneSwitchTable ');
      const otherwise = src.indexOf(') : (', at);
      expect(at < table && table < otherwise && otherwise < phone, `ONE-MARKUP ${name}: table, then the switch table in the else`).toBe(true);
      // mutation: Ownership passes Strategy's views → red
      expect(count(src, `views={${f.name}}`), `ONE-MARKUP ${name}: its own views`).toBe(1);
      // mutation: Ownership imports Strategy's views under its own name → red
      expect([...src.matchAll(/MS_VIEWS_[A-Z]+/g)].map((m) => m[0]).filter((v) => v !== f.name), `ONE-MARKUP ${name}: no other face's views`).toEqual([]);
    }
  });

  it('⭐ STRATEGY-COLUMNS — Strategy\'s table carries Debt and Equity after Yours (the owner\'s ask)', () => {
    const heads = [...FACES.strategy.src.matchAll(/<th className=\{[^}]*\}>([^<]+)<\/th>/g)].map((m) => m[1]);
    // mutation: no Debt column → red
    expect(heads.slice(heads.indexOf('Yours'), heads.indexOf('Yours') + 3), 'STRATEGY-COLUMNS').toEqual(['Yours', 'Debt', 'Equity']);
  });

  it('⭐ LAYOUT-ONLY — MilestoneSwitchTable reads no store and no engine and writes no word; its CSS is tokens only', () => {
    const src = strip(read('MilestoneSwitchTable.tsx'));
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    // mutation: import useStore → red
    expect(imports, 'LAYOUT-ONLY').toEqual(['react', './MilestoneSwitchTable.module.css']);
    // WORDLESS — the face writes every word (M-I6): no word in a quoted literal, a template literal's text or JSX text.
    const ALLOWED = new Set(['react', './MilestoneSwitchTable.module.css', 'button', 'group', 'img', 'col', 'Enter', ' ', '']);
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
    // A tag's end, never an arrow's `=>`: an arrow whose body is JSX would otherwise read its props as text.
    const jsxText = [...bare.matchAll(/(?<!=)>((?:[^<>{}]|\{[^{}]*\})+)</g)].map((m) => m[1].replace(/\{[^{}]*\}/g, ''))
      .filter((t) => /[A-Za-z]/.test(t));
    // mutation: a fallback name (`aria-label={switchLabel || 'figures'}`) → red
    expect([...quoted, ...templated, ...jsxText], 'WORDLESS').toEqual([]);
    expect(strip(read('MilestoneSwitchTable.module.css')), 'TOKENS').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('⭐ FIT — every header and figure on one line; under 390 px the figures shrink with the window', () => {
    const css = strip(read('MilestoneSwitchTable.module.css'));
    // mutation: the cells may wrap → red here and in the e2e's FIT
    for (const sel of ['.th', '.td', '.turn']) expect(ruleBody(css, sel), `FIT ${sel}`).toMatch(/white-space:\s*nowrap/);
    // mutation: a fixed 12.5px → red here and in the e2e's FIT at 320 px in full mode (Cycling's ₿ view)
    for (const sel of ['.td', '.value']) expect(ruleBody(css, sel), `FIT ${sel}: the clamp`).toMatch(/font-size:\s*clamp\(10px,\s*3\.2vw,\s*12\.5px\)/);
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
