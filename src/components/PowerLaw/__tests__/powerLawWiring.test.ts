import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PL_BAND_LABEL } from '../../../simulation/powerLaw';

/**
 * ⚠ STRUCTURAL GUARD — the Power Law chart polish (spec `pbloc-spec-powerlaw-polish-v1.md`) and the Power Law face (spec
 * `pbloc-spec-powerlaw-face-v1.md`). The repo has no render harness, so the conventions are read off the source. Each
 * check was proven red by a temporary edit to the real file before it landed. chartZoomWiring still owns the zoom
 * recipe; this file owns the rest.
 *
 * Files are read LAZILY ('' while a file doesn't exist), and every check on the face opens with a positive anchor. So on
 * a tree without the face each check is red at its own assertion, and a missing file can never pass a negative check.
 */
const ROOT = process.cwd();
const DIR = join(ROOT, 'src/components/PowerLaw');
const readIf = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const read = (f: string): string => readIf(join(DIR, f));
const CHART = read('PowerLawChart.tsx');
const DECISION = readIf(join(ROOT, 'src/components/Almanac/DecisionFace.tsx'));

/** Code with its comments removed — block, JSX and line comments (a `//` after a `:` is a URL, kept). */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
/** The face's code, comments stripped (its docblock may name the legend or a band) — '' while the file doesn't exist. */
const faceCode = (): string => stripComments(read('PowerLawFace.tsx'));
/** The positive anchor every face check opens with. */
const FACE = /export function PowerLawFace\(/;

/** The self-closing JSX element that starts at `open`, up to ITS `/>` (a `/>` inside `{…}` is skipped). */
function tagAt(src: string, at: number): string {
  let depth = 0;
  for (let i = at; i < src.length - 1; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
    else if (depth === 0 && src[i] === '/' && src[i + 1] === '>') return src.slice(at, i + 2);
  }
  return '';
}
const tag = (src: string, open: string): string => { const at = src.indexOf(open); return at < 0 ? '' : tagAt(src, at); };
/** A top-level function's text, from `function <name>(` to its closing brace at column 0. */
const fnBody = (src: string, name: string): string => {
  const at = src.indexOf(`function ${name}(`);
  return at < 0 ? '' : src.slice(at, src.indexOf('\n}\n', at) + 2);
};
const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/;

describe('⭐ the Power Law chart — tokens, the Decision chart\'s conventions', () => {
  it('⭐ no hex colour in any Power Law source file — tokens only', () => {
    // mutation: put back `fill: '#666'` on a tick → red
    expect(HEX.test("fill: '#666'")).toBe(true);   // non-vacuous: the pattern catches the old tick colour
    const files = readdirSync(DIR).filter((f) => /\.(tsx?|css)$/.test(f));
    expect(files).toEqual(expect.arrayContaining(['PowerLawChart.tsx', 'PowerLawFace.tsx', 'PowerLawFace.module.css']));
    for (const f of files) expect(read(f).match(HEX)?.[0] ?? null, f).toBeNull();
  });

  it('⭐ the history gradient id is per mount (useId), never a document-global literal', () => {
    // mutation: `<linearGradient id="powerLawHistory"` → red
    expect(CHART).toMatch(/\buseId\(\)/);
    expect(CHART).toMatch(/<linearGradient id=\{gradientId\}/);
    expect(CHART).toMatch(/fill=\{`url\(#\$\{gradientId\}\)`\}/);
    expect(CHART).not.toMatch(/<linearGradient id="/);
  });

  it('⭐ the grid, and the history as an Area that never animates (P2)', () => {
    // mutations: the history back to a <Line → red; drop the Area's isAnimationActive={false} → red
    expect(CHART).toMatch(/<CartesianGrid stroke="var\(--line-2\)" vertical=\{false\}/);
    const area = tag(CHART, '<Area');
    expect(area, '<Area').toMatch(/dataKey="price"/);
    expect(area).toMatch(/isAnimationActive=\{false\}/);
    expect(CHART).not.toMatch(/<Line[^>]*dataKey="price"/);
  });

  it('⭐ Today is one timestamp per mount, never Date.now() in the render', () => {
    // mutation: `x={Date.now()}` → red
    expect(CHART).toMatch(/useState\(\(\) => Date\.now\(\)\)/);
    expect(CHART.match(/Date\.now\(\)/g)?.length).toBe(1);
  });

  it('⭐ the chart fills a CSS-sized box; every --pl-* length carries a unit (P8); the toolbar left the box (Z18)', () => {
    // mutations: `height={520}` on the container → red; `--pl-plot: 360` (a bare number makes `height: var(--pl-plot)`
    // invalid at computed-value time: the height resolves to auto, and the box and its 100%-high chart collapse to
    // 0px) → red; `--pl-toolbar` back (the old touch row inside the box) → red
    expect(tag(CHART, '<ResponsiveContainer')).toMatch(/height="100%"/);
    expect(CHART).toMatch(/className=\{styles\.chartBox\}/);
    const css = read('PowerLawChart.module.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const values = [...css.matchAll(/--pl-[a-z-]+:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(values.length, '--pl-* declarations').toBeGreaterThanOrEqual(2);
    for (const v of values) expect(v, `--pl-* = ${v}`).toMatch(/^\d+(?:\.\d+)?px$/);
    expect(css).toMatch(/height:\s*var\(--pl-plot\)/);
    expect(css).not.toMatch(/--pl-toolbar/);
  });

  it('⭐ ONE tooltip price formatter: the Decision and Power Law tooltips both price through fmtTooltipUsd (P1)', () => {
    // mutation: DecisionTip back to fmtUSD → red
    const decisionTip = fnBody(DECISION, 'DecisionTip');
    expect(decisionTip, 'DecisionTip').toMatch(/\bfmtTooltipUsd\(/);
    expect(decisionTip).not.toMatch(/\bfmtUSD\(/);
    expect(read('powerLawView.ts')).toMatch(/\bfmtTooltipUsd\(/);
    const plTip = fnBody(CHART, 'PowerLawTooltip');
    expect(plTip, 'PowerLawTooltip').toMatch(/\bpowerLawTooltip\(/);
    expect(plTip).not.toMatch(/\bfmtUSD\(/);
  });

  it('⭐ the legend goes through legendEntries( inside the chart; the face has none, and shows the chart only once loaded — on ONE error test', () => {
    // mutations: a legend back in the face → red; the chart branch back on `!error` (an empty error string would render
    // the error box AND the chart) → red
    expect(CHART).toMatch(/\blegendEntries\(historyDrawn\(chartData\)\)/);
    const code = faceCode();
    expect(code, 'PowerLawFace.tsx').toMatch(FACE);
    expect(code).not.toMatch(/legend/i);
    expect(code).toMatch(/!loading && error !== null && <PowerLawChartEmpty /);
    expect(code).toMatch(/!loading && error === null && <PowerLawChart /);
    expect(code).not.toMatch(/!error\b/);
  });

  it('⭐ one tick colour on both zoom charts: --text-muted (P6)', () => {
    // mutation: the Decision chart's ticks back to --text-faint → red
    for (const [name, src] of [['PowerLawChart', CHART], ['DecisionFace', DECISION]] as const) {
      const ticks = [...src.matchAll(/tick=\{\{[^}]*\}\}/g)].map((m) => m[0]);
      expect(ticks.length, `${name} ticks`).toBe(2);
      for (const t of ticks) expect(t, name).toMatch(/fill: 'var\(--text-muted\)'/);
    }
  });
});

describe('⭐ the Power Law face — the four faces\' layout, on both surfaces (spec pbloc-spec-powerlaw-face-v1)', () => {
  it('⭐ the face\'s copy comes from powerLawView — no figure and no band name typed in the face; D1\'s order; one date per mount', () => {
    // mutations: W6 a band name typed in the face → red; E1 the tiles above the chart → red (the order); `plBandsAt(new
    // Date())` in the render → red
    const code = faceCode();
    expect(code, 'PowerLawFace.tsx').toMatch(FACE);
    for (const use of ['todayTiles(', 'modelLines()', '{PL_FACE_TITLE}', '{PL_FRAMING}', '{PL_DISCLAIMER.lead}',
      '{PL_DISCLAIMER.body}', 'style={{ color: t.color }}']) {
      expect(code, use).toContain(use);
    }
    expect(stripComments(CHART), 'the chart\'s title').toContain('{PL_CHART_TITLE}');
    expect(code.match(/\$\d/)?.[0] ?? null, 'a typed figure').toBeNull();
    const bandName = new RegExp(`\\b(?:${Object.values(PL_BAND_LABEL).join('|')})\\b`);
    expect(code.match(bandName)?.[0] ?? null, 'a typed band name').toBeNull();
    // D1's order (I3), read in the face's own render: head → chart card → tiles → the model card → disclaimer.
    const face = fnBody(code, 'PowerLawFace');
    const render = face.slice(face.indexOf('return ('));
    const at = ['{PL_FACE_TITLE}', '<PowerLawChartEmpty', '<TodayTiles', 'modelLines().map(', '{PL_DISCLAIMER.lead}']
      .map((s) => render.indexOf(s));
    expect(at.every((i) => i >= 0), `all five in PowerLawFace's render: ${at.join(', ')}`).toBe(true);
    expect([...at].sort((a, b) => a - b), 'D1 order').toEqual(at);
    // Today's lines: one Date per mount (I5). A Date taken in the render would move on every re-render.
    expect(code).toMatch(/useState\(\(\) => new Date\(\)\)/);
    expect(code).not.toMatch(/plBandsAt\(new Date\(\)\)/);
  });

  it('⭐ ONE layout — PowerLawFace.module.css composes the four faces\' classes and declares nothing of its own (I2)', () => {
    // mutation: W4 a local `padding` on `.card` → red (and composedOverrides turns red too)
    const NAMES = ['face', 'head', 'title', 'framing', 'card', 'cardLabel', 'noteQuiet', 'statGrid', 'stat', 'statValue',
      'statSub', 'disclaimer'];
    const css = read('PowerLawFace.module.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const RULE = /([^{}]+)\{([^{}]*)\}/g;
    const rules = [...css.matchAll(RULE)].map((m) => ({ sel: m[1].trim(), body: m[2].trim().replace(/\s+/g, ' ') }));
    expect(rules.map((r) => r.sel).sort(), 'the twelve rules').toEqual(NAMES.map((n) => `.${n}`).sort());
    for (const r of rules) expect(r.body, r.sel).toBe(`composes: ${r.sel.slice(1)} from '../Almanac/CyclingFace.module.css';`);
    expect(css.replace(RULE, '').trim(), 'nothing outside the rules').toBe('');
  });

  it('⭐ both surfaces mount the face bare — the Almanac\'s branch; AppShell\'s main, with no sidebar and the hide rules; the old pair is gone (I1)', () => {
    // mutations: W1 the branch back in a .faceStack; W2 the sidebar line renders the face again; W3 the sidebar's hide
    // rule dropped → red
    const hub = readIf(join(ROOT, 'src/components/Almanac/AlmanacView.tsx'));
    expect(hub, 'the Almanac branch').toContain("if (f === 'powerlaw') return <PowerLawFace />;");
    const shell = readIf(join(ROOT, 'src/components/Layout/AppShell.tsx'));
    const aside = shell.slice(shell.indexOf('<aside'), shell.indexOf('</aside>'));
    const main = shell.slice(shell.indexOf('<main'), shell.indexOf('</main>'));
    expect(aside, 'the sidebar renders nothing for powerlaw').toMatch(/activeTab === 'powerlaw'\s*\?\s*null\s*:/);
    expect(main, 'the main column renders the face').toMatch(/activeTab === 'powerlaw'\s*\?\s*<PowerLawFace \/>\s*:/);
    const css = readIf(join(ROOT, 'src/components/Layout/AppShell.module.css')).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css, 'the sidebar hidden').toMatch(/\[data-active-tab="powerlaw"\]\s*\.sidebar\s*\{\s*display:\s*none;\s*\}/);
    expect(css, 'the main full width').toMatch(/\[data-active-tab="powerlaw"\]\s*\.main\s*\{\s*grid-column:\s*1 \/ -1;\s*\}/);
    for (const f of ['PowerLawMain.tsx', 'PowerLawMain.module.css', 'PowerLawSidebar.tsx', 'PowerLawSidebar.module.css']) {
      expect(existsSync(join(DIR, f)), `${f} is gone`).toBe(false);
    }
  });

  it('⭐ no block-height fetch (D2): the face reads only the price and the history; useMempoolData is gone; only the tiles poll the price, and the chart is memoised (R2)', () => {
    // mutations: W5 a mempool fetch added to the face → red; useBtcPrice() moved into PowerLawFace → red; the chart's
    // memo dropped → red
    const code = faceCode();
    expect(code, 'PowerLawFace.tsx').toMatch(FACE);
    expect(code.match(/useMempoolData|mempool|useChainTip|\bfetch\(/)?.[0] ?? null, 'an explorer in the face').toBeNull();
    expect(existsSync(join(ROOT, 'src/hooks/useMempoolData.ts')), 'useMempoolData.ts is gone').toBe(false);
    const hooks = [...code.matchAll(/from '\.\.\/\.\.\/hooks\/(\w+)'/g)].map((m) => m[1]).sort();
    expect(hooks, 'the face\'s hooks').toEqual(['useBtcPrice', 'usePowerLawData']);
    // Δ1: only the tiles poll the price, so the face's own poll re-renders the tiles alone. The app shell's root poll still
    // re-renders the face, so the chart is memoised on its stable props (R2) — the Decision chart's pattern.
    expect(fnBody(code, 'TodayTiles'), 'TodayTiles polls the price').toMatch(/\buseBtcPrice\(\)/);
    expect(fnBody(code, 'PowerLawFace'), 'PowerLawFace does not').not.toMatch(/\buseBtcPrice\(/);
    expect(CHART, 'the chart is memoised').toMatch(/export const PowerLawChart = memo\(function PowerLawChart\(/);
  });
});
