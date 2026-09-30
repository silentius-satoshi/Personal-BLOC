import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⚠ STRUCTURAL GUARD — the Power Law chart polish (spec `pbloc-spec-powerlaw-polish-v1.md`). The repo has no render
 * harness, so the chart's conventions are read off the source. Each check was proven red by a temporary edit to the
 * real file before it landed. chartZoomWiring still owns the zoom recipe; this file owns the rest.
 */
const DIR = join(process.cwd(), 'src/components/PowerLaw');
const read = (f: string): string => readFileSync(join(DIR, f), 'utf8');
const CHART = read('PowerLawChart.tsx');
const MAIN = read('PowerLawMain.tsx');
const DECISION = readFileSync(join(process.cwd(), 'src/components/Almanac/DecisionFace.tsx'), 'utf8');

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
    expect(files).toEqual(expect.arrayContaining(['PowerLawChart.tsx', 'PowerLawMain.tsx', 'PowerLawSidebar.tsx']));
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

  it('⭐ the chart fills a CSS-sized box; every --pl-* length carries a unit (P8)', () => {
    // mutations: `height={520}` on the container → red; `--pl-toolbar: 0` (a bare 0 makes calc() invalid, so the box
    // collapses to 0px on every fine pointer — and the touch-only e2e can't see it) → red
    expect(tag(CHART, '<ResponsiveContainer')).toMatch(/height="100%"/);
    expect(CHART).toMatch(/className=\{styles\.chartBox\}/);
    const css = read('PowerLawChart.module.css');
    const values = [...css.matchAll(/--pl-[a-z-]+:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(values.length, '--pl-* declarations').toBeGreaterThanOrEqual(4);
    for (const v of values) expect(v, `--pl-* = ${v}`).toMatch(/^\d+(?:\.\d+)?px$/);
    expect(css).toMatch(/height:\s*calc\(var\(--pl-plot\) \+ var\(--pl-toolbar\)\)/);
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

  it('⭐ the legend goes through legendEntries( inside the chart; PowerLawMain has none, and shows the chart only once loaded — on ONE error test', () => {
    // mutations: a legend back in PowerLawMain → red; the chart branch back on `!error` (an empty error string would
    // render the error box AND the chart) → red
    expect(CHART).toMatch(/\blegendEntries\(historyDrawn\(chartData\)\)/);
    expect(MAIN).not.toMatch(/legend/i);
    expect(MAIN).toMatch(/!loading && error !== null && <PowerLawChartEmpty /);
    expect(MAIN).toMatch(/!loading && error === null && <PowerLawChart /);
    expect(MAIN).not.toMatch(/!error\b/);
  });

  it('⭐ one tick colour on both zoom charts: --text-muted (P6)', () => {
    // mutation: the Decision chart's ticks back to --text-faint → red
    for (const [name, src] of [['PowerLawChart', CHART], ['DecisionFace', DECISION]] as const) {
      const ticks = [...src.matchAll(/tick=\{\{[^}]*\}\}/g)].map((m) => m[0]);
      expect(ticks.length, `${name} ticks`).toBe(2);
      for (const t of ticks) expect(t, name).toMatch(/fill: 'var\(--text-muted\)'/);
    }
  });

  it('⭐ the sidebar names the bands from PL_BAND_LABEL and colours Resistance --amber (D6)', () => {
    // mutation: Resistance back to var(--red) → red
    const side = read('PowerLawSidebar.tsx');
    expect(side).toMatch(/\{PL_BAND_LABEL\.ceiling\}<\/div>\s*<div className=\{styles\.statValue\} style=\{\{ color: 'var\(--amber\)' \}\}>/);
    expect(side).toMatch(/\{PL_BAND_LABEL\.fair\}/);
    expect(side).toMatch(/\{PL_BAND_LABEL\.floor\}/);
    expect(side).not.toMatch(/Fair Value/);
  });
});
