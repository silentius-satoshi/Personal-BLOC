import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * ⚠ STRUCTURAL GUARD — a composed class's property is never overridden beside `composes:` (spec
 * `pbloc-spec-powerlaw-polish-v1.md` v1.3, P9–P11). The e2e can't see this bug: it runs 390px wide, and the dev server
 * orders the CSS differently from the production bundle. So the rule is read off the source.
 *
 * A declaration beside `composes:` ties the composed class's specificity (0,1,0), so the bundle's RULE ORDER decides
 * which one wins, and that order is an accident of the import graph. P10: production emits toolShell's CSS after every
 * tool's, so Mining, Power Law and the Converter rendered 600px wide on a computer. An override belongs on a DOUBLED
 * selector (`.main.main`, 0,2,0), which wins in any order.
 *
 * This test IS the audit. For EVERY composing rule in every *.module.css under src/: no single-class rule of the
 * composing class (a media query's included) declares a property the composed class sets, following its own
 * `composes:` too. Shorthand-aware: two declarations clash when the longhands they set intersect (`border` covers
 * `border-color`, `padding` covers `padding-top`, …). Non-vacuous: a control pair must clash, and the six doubled
 * overrides must be found.
 */
const SRC = join(process.cwd(), 'src');

/** Each shorthand's longhands, one level down (`leaves` recurses). */
const SHORTHAND: Record<string, readonly string[]> = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  'margin-block': ['margin-top', 'margin-bottom'],
  'margin-inline': ['margin-left', 'margin-right'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  'padding-block': ['padding-top', 'padding-bottom'],
  'padding-inline': ['padding-left', 'padding-right'],
  inset: ['top', 'right', 'bottom', 'left'],
  'inset-block': ['top', 'bottom'],
  'inset-inline': ['left', 'right'],
  border: ['border-top', 'border-right', 'border-bottom', 'border-left', 'border-image'],
  'border-top': ['border-top-width', 'border-top-style', 'border-top-color'],
  'border-right': ['border-right-width', 'border-right-style', 'border-right-color'],
  'border-bottom': ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'],
  'border-left': ['border-left-width', 'border-left-style', 'border-left-color'],
  'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  'border-style': ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
  'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius',
    'border-bottom-left-radius'],
  'border-image': ['border-image-source', 'border-image-slice', 'border-image-width', 'border-image-outset',
    'border-image-repeat'],
  background: ['background-color', 'background-image', 'background-position', 'background-size',
    'background-repeat', 'background-attachment', 'background-origin', 'background-clip'],
  font: ['font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-size', 'line-height', 'font-family'],
  overflow: ['overflow-x', 'overflow-y'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  'flex-flow': ['flex-direction', 'flex-wrap'],
  gap: ['row-gap', 'column-gap'],
  'grid-template': ['grid-template-rows', 'grid-template-columns', 'grid-template-areas'],
  'grid-area': ['grid-row', 'grid-column'],
  'grid-row': ['grid-row-start', 'grid-row-end'],
  'grid-column': ['grid-column-start', 'grid-column-end'],
  'place-items': ['align-items', 'justify-items'],
  'place-content': ['align-content', 'justify-content'],
  'place-self': ['align-self', 'justify-self'],
  outline: ['outline-color', 'outline-style', 'outline-width'],
  'text-decoration': ['text-decoration-line', 'text-decoration-color', 'text-decoration-style',
    'text-decoration-thickness'],
  transition: ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay'],
  animation: ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay',
    'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state'],
  'list-style': ['list-style-type', 'list-style-position', 'list-style-image'],
};

/** Logical longhands, on the physical sides this app lays out in (horizontal, left to right). */
const LOGICAL: Record<string, string> = {
  'margin-block-start': 'margin-top', 'margin-block-end': 'margin-bottom',
  'margin-inline-start': 'margin-left', 'margin-inline-end': 'margin-right',
  'padding-block-start': 'padding-top', 'padding-block-end': 'padding-bottom',
  'padding-inline-start': 'padding-left', 'padding-inline-end': 'padding-right',
  'inset-block-start': 'top', 'inset-block-end': 'bottom', 'inset-inline-start': 'left', 'inset-inline-end': 'right',
};

function leaves(prop: string): Set<string> {
  const p = LOGICAL[prop] ?? prop;
  const kids = SHORTHAND[p];
  return kids === undefined ? new Set([p]) : new Set(kids.flatMap((k) => [...leaves(k)]));
}

/** Two declarations clash when the longhands they set intersect. */
function clash(a: string, b: string): boolean {
  const la = leaves(a);
  return [...leaves(b)].some((x) => la.has(x));
}

function cssModules(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cssModules(p));
    else if (name.endsWith('.module.css')) out.push(p);
  }
  return out;
}

interface Rule { selectors: string[]; decls: Map<string, string> }

/** Every leaf rule, comments stripped. A media query's rules come out with the rest. */
function rulesOf(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => {
    // Anything before a `;` in the prelude is a statement (an @import), not part of the selector.
    const prelude = m[1].split(';').pop() ?? '';
    const selectors = prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const decls = new Map<string, string>();
    for (const d of m[2].split(';')) {
      const at = d.indexOf(':');
      if (at <= 0) continue;
      const name = d.slice(0, at).trim();
      decls.set(name.startsWith('--') ? name : name.toLowerCase(), d.slice(at + 1).trim());
    }
    return { selectors, decls };
  });
}

const SHEETS = new Map(cssModules(SRC).map((f): [string, Rule[]] => [f, rulesOf(readFileSync(f, 'utf8'))]));

/** A `composes:` value → the classes and the file that defines them; null when it can't be followed. */
function readComposes(file: string, value: string): { names: string[]; target: string } | null {
  const m = /^([\w-]+(?:\s+[\w-]+)*)(?:\s+from\s+(['"])([^'"]+)\2)?$/.exec(value);
  if (m === null) return null;
  const names = m[1].split(/\s+/);
  if (names.includes('from')) return null;   // `from global`, or an unquoted path
  const from = m[3] as string | undefined;
  return { names, target: from === undefined ? file : resolve(dirname(file), from) };
}

/** Every property a class sets: its single-class rules (a media query's included), plus whatever it composes. */
function propsOf(file: string, name: string, seen: Set<string> = new Set()): string[] {
  const key = `${file}#${name}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const out: string[] = [];
  for (const r of SHEETS.get(file) ?? []) {
    if (!r.selectors.includes(`.${name}`)) continue;
    for (const [prop, value] of r.decls) {
      if (prop !== 'composes') { out.push(prop); continue; }
      const c = readComposes(file, value);
      if (c !== null) for (const n of c.names) out.push(...propsOf(c.target, n, seen));
    }
  }
  return out;
}

/** The six overrides P9–P11 put on a doubled selector. The audit must find every one. */
const DOUBLED = [
  'components/Almanac/DecisionFace.module.css .chartBox.chartBox',
  'components/Almanac/DecisionFace.module.css .moveCard.moveCard',
  'components/Converter/ConverterMain.module.css .main.main',
  'components/Mining/MiningMain.module.css .main.main',
  'components/PowerLaw/PowerLawChart.module.css .chartBox.chartBox',
  'components/PowerLaw/PowerLawMain.module.css .main.main',
];

describe('⭐ a composed class is overridden on a doubled selector, never beside composes: (P9–P11)', () => {
  it('⭐ the audit: no single-class rule of a composing class declares a property its composed class sets — and the six doubled overrides are found', () => {
    // mutations:
    // - PowerLawMain: max-width back beside composes: → red
    // - DecisionFace: height back beside composes: → red
    // - DecisionFace: the touch query back to a single .chartBox → red
    // - MiningMain: .main.main deleted → red
    // - ConverterMain: .main.main un-doubled → red
    // - DecisionFace: .moveCard's border-color back beside composes: → red
    expect(clash('border', 'border-color'), 'control: border covers border-color').toBe(true);
    expect(clash('border-color', 'border')).toBe(true);
    expect(clash('border-radius', 'border'), 'control: border never sets a radius').toBe(false);

    const rel = (f: string): string => relative(SRC, f);
    const problems: string[] = [];
    const clashes: string[] = [];
    const doubled = new Set<string>();
    for (const [file, rules] of SHEETS) {
      for (const rule of rules) {
        const value = rule.decls.get('composes');
        if (value === undefined) continue;
        const sel = rule.selectors.length === 1 ? rule.selectors[0] : '';
        const c = readComposes(file, value);
        if (!/^\.[A-Za-z_][\w-]*$/.test(sel) || c === null || !SHEETS.has(c.target)) {
          problems.push(`${rel(file)}: can't follow \`${rule.selectors.join(', ')} { composes: ${value} }\``);
          continue;
        }
        const cls = sel.slice(1);
        for (const name of c.names) {
          const sets = propsOf(c.target, name);
          for (const r of rules) {
            const single = r.selectors.includes(`.${cls}`);
            const twice = r.selectors.includes(`.${cls}.${cls}`);
            if (!single && !twice) continue;
            for (const prop of r.decls.keys()) {
              if (prop === 'composes') continue;
              const hit = sets.find((q) => clash(prop, q));
              if (hit === undefined) continue;
              if (single) clashes.push(`${rel(file)} .${cls} { ${prop} } — ${name} sets ${hit}`);
              if (twice) doubled.add(`${rel(file)} .${cls}.${cls}`);
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
    expect(clashes).toEqual([]);
    expect([...doubled]).toEqual(expect.arrayContaining(DOUBLED));
  });
});
