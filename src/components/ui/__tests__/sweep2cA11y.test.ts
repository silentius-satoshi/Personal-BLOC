import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { ALL_IN, ALL_IN_CAPS } from '../../../utils/format';
import { PassphraseInput } from '../PassphraseInput';

/**
 * Sweep 2c (BL52) — layout, motion and accessibility, pinned in the source (the screen side is e2e/layoutMotion.spec.ts).
 *   ⭐ M1 REDUCED MOTION — under prefers-reduced-motion only opacity cross-fades (transition-property: opacity).
 *   ⭐ L1 ONE NAME — no role="img" carries a title: Chromium reads a title as the description, so the name came twice.
 *   ⭐ L2 CHART TEXT — no chart's text reads --text-faint or --text-ghost, by name or by value (#555555, #444444 —
 *     about 2.5:1 and 2:1 on the cards); every face's subtitle is --text-muted too (C1).
 *   ⭐ L5 ALL-IN — every on-screen "all-in" holds together: ALL_IN and ALL_IN_CAPS carry a word joiner after the
 *     hyphen, and no code under src/ writes the bare word in either case (comments aside).
 *   ⭐ RECOVERY KEY — the sign-in's recovery-key paste field goes through PassphraseInput, its toggle named for it.
 */
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const n of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, n);
    if (statSync(join(ROOT, rel)).isDirectory()) { if (n !== '__tests__') out.push(...files(rel, ext)); }
    else if (ext.test(n) && !/\.test\.tsx?$/.test(n)) out.push(rel);
  }
  return out;
}
/** Each opening tag that says role="img" — from its '<' to the '>' that closes it, braces counted. */
function imgTags(src: string): string[] {
  const tags: string[] = [];
  for (let i = src.indexOf('role="img"'); i !== -1; i = src.indexOf('role="img"', i + 1)) {
    const start = src.lastIndexOf('<', i);
    let depth = 0;
    let k = start;
    for (; k < src.length; k++) {
      const c = src[k];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    tags.push(src.slice(start, k + 1));
  }
  return tags;
}

describe('Sweep 2c — layout, motion and accessibility, in the source', () => {
  it('⭐ M1 REDUCED MOTION — only opacity cross-fades under Reduce Motion', () => {
    const css = read('src/styles/global.css');
    const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(at, 'M1 the block').toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf('\n}', at));
    expect(block, 'M1 the property').toContain('transition-property: opacity !important;');
    expect(block, 'M1 the duration, as before').toContain('transition-duration: 80ms !important;');
  });

  it('⭐ L1 ONE NAME — no role="img" carries a title', () => {
    const found = files('src/components', /\.tsx$/).flatMap((f) => imgTags(read(f)).map((t) => ({ f, t })));
    expect(found.length, 'L1 the sweep reaches the image roles').toBeGreaterThan(8);
    const withTitle = found.filter(({ t }) => /\stitle=/.test(t)).map(({ f }) => f);
    expect(withTitle, 'L1 no title beside the name').toEqual([]);
  });

  it('⭐ L2 CHART TEXT — chart text and the faces\' subtitle read --text-muted, never faint or ghost', () => {
    const tsx = files('src/components', /\.tsx$/);
    const faintFill = tsx.filter((f) => /fill(: '|=")(var\(--text-(faint|ghost)\)|#(555|444)(555|444)?['"])/.test(read(f)));
    expect(faintFill, 'L2 no faint or ghost fill').toEqual([]);
    // Recharts paints an axis's tick labels in the axis stroke unless `tick` names a fill.
    const bareAxes = tsx.flatMap((f) => (read(f).match(/<[XY]Axis\b[^>]*>/g) ?? [])
      .filter((t) => /stroke="var\(--text-(faint|ghost)\)"/.test(t) && !/tick=\{\{[^}]*fill:/.test(t)).map(() => f));
    expect(bareAxes, 'L2 every faint axis gives its ticks a fill').toEqual([]);
    expect(tsx.filter((f) => /<[XY]Axis\b/.test(read(f))).length, 'L2 the sweep reaches the charts').toBeGreaterThan(5);
    // Every face's subtitle: each `.framing` that sets its own colour (the others compose CyclingFace's).
    const framings = files('src/components', /\.module\.css$/).filter((f) => {
      const css = read(f);
      const i = css.indexOf('.framing {');
      return i > -1 && /color:/.test(css.slice(i, css.indexOf('}', i)));
    });
    expect(framings.length, 'L2 the sweep reaches the faces\' subtitles').toBeGreaterThan(3);
    const CSS: [string, string][] = [
      ['src/components/Charts/LTVSafetyChart.module.css', '.sub'],
      ['src/components/Charts/NetEquityChart.module.css', '.sub'],
      ['src/components/Charts/BtcStackChart.module.css', '.summary'],
      ...framings.map((f): [string, string] => [f, '.framing']),
    ];
    for (const [f, cls] of CSS) {
      const css = read(f);
      const i = css.indexOf(`${cls} {`);
      expect(i, `L2 ${f} ${cls} found`).toBeGreaterThan(-1);
      expect(css.slice(i, css.indexOf('}', i)), `L2 ${f} ${cls}`).toMatch(/color: var\(--text-muted\)/);
    }
  });

  it('⭐ L5 ALL-IN — the word joiner, and no bare "all-in" written in code, in either case', () => {
    expect(ALL_IN, 'L5 the constant').toBe('all-⁠in');
    expect(ALL_IN_CAPS, 'L5 the capitals').toBe('ALL-\u2060IN');
    const printer = ts.createPrinter({ removeComments: true });
    const scanned = files('src', /\.tsx?$/);
    expect(scanned.length, 'L5 the sweep reaches src').toBeGreaterThan(300);
    const bare = scanned.filter((f) => {
      const kind = f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      const sf = ts.createSourceFile(f, read(f), ts.ScriptTarget.Latest, true, kind);
      return /all-in/i.test(printer.printFile(sf));
    });
    expect(bare, 'L5 no bare "all-in" on screen').toEqual([]);
  }, 60_000);   // a sweep of every code file under src/ through the printer: about 1.2 s alone, more in a loaded full suite

  it('⭐ RECOVERY KEY — the paste field goes through PassphraseInput, its toggle named "Show recovery key"', () => {
    const gate = read('src/components/Auth/NostrAuthGate.tsx');
    expect(gate, 'RECOVERY KEY no hand-rolled type').not.toMatch(/type=\{\w+ \? 'text' : (['"])password\1\}/);
    expect(gate, 'RECOVERY KEY the widget')
      .toMatch(/<PassphraseInput\s[^>]*placeholder="Paste your recovery key — nsec or encrypted"[^>]*revealNoun="recovery key"/);
    const named = renderToStaticMarkup(createElement(PassphraseInput, { value: '', onChange: () => {}, revealNoun: 'recovery key' }));
    expect(named, 'RECOVERY KEY the name').toContain('aria-label="Show recovery key"');
    const plain = renderToStaticMarkup(createElement(PassphraseInput, { value: '', onChange: () => {} }));
    expect(plain, 'RECOVERY KEY the default').toContain('aria-label="Show passphrase"');
    // The quoted word, written so this file never matches the rule's own grep of src.
    const masked = files('src', /\.tsx$/).filter((f) => /(['"])password\1/.test(read(f)));
    expect(masked, 'RECOVERY KEY the masked-field grep finds the widget alone').toEqual(['src/components/ui/PassphraseInput.tsx']);
  });
});
