import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⚠ STRUCTURAL GUARD — chart zoom (spec `pbloc-spec-chart-zoom-v1.md`). The repo has no render harness, so the
 * adoption recipe and the view-only rule are read off the source:
 *
 *  - every adopter calls `useChartZoom(` once, reads BOTH axes' domains from `zoom.view` with `allowDataOverflow`,
 *    builds its ticks from `timeTicks(` / `logTicks(`, mounts the plot probe and hides its tooltip while dragging;
 *  - VIEW ONLY: zoom never reaches a memo that feeds data (the series, the domains-as-data, the engine inputs);
 *  - `chartZoom.ts` is a zero-import leaf; the hook has exactly one non-passive listener, and it is the pinch's
 *    `touchmove`;
 *  - Z1: the overlay layers never take the pointer (`pointer-events: none` on `.plot`, `.box`, `.note`), or recharts
 *    gets no hover or tap and the tooltip dies on both charts.
 *
 * Each check was proven red by a temporary edit to the real file before it landed. A future adopter joins ADOPTERS.
 */
const SRC = join(process.cwd(), 'src');
const read = (p: string): string => readFileSync(join(SRC, p), 'utf8');
const ADOPTERS = ['components/Almanac/DecisionFace.tsx', 'components/PowerLaw/PowerLawChart.tsx'];

/** The self-closing JSX element that starts with `open` (e.g. `<XAxis`), up to ITS `/>` — one inside a `{…}` prop
 *  (`content={<DecisionTip />}`) is skipped. */
function tag(src: string, open: string): string {
  const at = src.indexOf(open);
  if (at < 0) return '';
  let depth = 0;
  for (let i = at; i < src.length - 1; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
    else if (depth === 0 && src[i] === '/' && src[i + 1] === '>') return src.slice(at, i + 2);
  }
  return '';
}

/** The text of `const <name> = useMemo(…)` (a generic is allowed), up to the paren that closes the call — so a
 *  multi-line memo ending `],\n  );` never runs on into the next one. */
function memoBody(src: string, name: string): string {
  const m = new RegExp(`const ${name} = useMemo(?:<[^>]*>)?\\(`).exec(src);
  if (!m) return '';
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < src.length; i++) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') { depth -= 1; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  return '';
}

describe.each(ADOPTERS)('⭐ %s adopts the zoom', (file) => {
  const src = read(file);

  it('⭐ calls useChartZoom( exactly once', () => {
    expect(src.match(/\buseChartZoom\(/g)?.length ?? 0).toBe(1);
  });

  it('⭐ both axes read the zoom view, both allow overflow, and both take explicit ticks', () => {
    const x = tag(src, '<XAxis');
    const y = tag(src, '<YAxis');
    expect(x, '<XAxis').not.toBe('');
    expect(y, '<YAxis').not.toBe('');
    expect(x).toMatch(/\bdomain=\{zoom\.view\.x\}/);
    expect(y).toMatch(/\bdomain=\{zoom\.view\.y\}/);
    expect(x).toMatch(/\ballowDataOverflow\b/);
    expect(y).toMatch(/\ballowDataOverflow\b/);
    expect(x).toMatch(/\bticks=\{/);
    expect(y).toMatch(/\bticks=\{/);
    expect(src).toMatch(/\btimeTicks\(/);
    expect(src).toMatch(/\blogTicks\(/);
  });

  it('⭐ the plot probe is mounted, and the tooltip hides while a gesture runs', () => {
    expect(src).toMatch(/<Customized component=\{zoom\.probe\}/);
    expect(tag(src, '<Tooltip')).toMatch(/\bactive=\{zoom\.dragging \? false : undefined\}/);
  });
});

describe('⭐ VIEW ONLY — zoom never reaches a memo that feeds data', () => {
  it.each([
    ['components/Almanac/DecisionFace.tsx', 'engineInputs'],
    ['components/Almanac/DecisionFace.tsx', 'chart'],
    ['components/Almanac/DecisionFace.tsx', 'domain'],
    ['components/Almanac/DecisionFace.tsx', 'xRange'],
    ['components/PowerLaw/PowerLawChart.tsx', 'chartData'],
  ])('⭐ %s — the %s memo', (file, name) => {
    const body = memoBody(read(file), name);
    expect(body, `${name} memo`).not.toBe('');
    expect(body).not.toMatch(/\bzoom\b/);
  });

  it('⭐ the Decision series still come from the face, with the same eight arguments (decisionWiring pins them)', () => {
    expect(read('components/Almanac/DecisionFace.tsx')).toMatch(
      /buildChartSeries\(historical, startDate, displayedPath, stitched, supportPath, supportAtDates, months, cliff\)/,
    );
  });
});

describe('⭐ the shared pieces', () => {
  it('⭐ chartZoom.ts imports nothing (a pure leaf, like ltv.ts)', () => {
    const lib = read('lib/chartZoom.ts');
    expect(lib).not.toMatch(/^\s*import\b/m);
    expect(lib).not.toMatch(/\brequire\(/);
  });

  it('⭐ useChartZoom has exactly ONE non-passive listener, and it is the touchmove (the pinch and the Z6 scrub lock)', () => {
    const hook = read('hooks/useChartZoom.ts');
    const lines = hook.split('\n').filter((l) => /passive:\s*false/.test(l));
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/'touchmove'/);
  });

  it('⭐ Z6 — every touch listener states its passive option, and touchstart\'s is true: a tap is never cancelled', () => {
    // An element's touchstart listener with no options is NON-passive in WebKit, so a stray preventDefault there
    // would swallow taps — the tooltip's and the double-tap reset's.
    const touch = read('hooks/useChartZoom.ts').split('\n').filter((l) => /addEventListener\('touch/.test(l));
    expect(touch.length).toBe(4);   // touchstart, touchmove, touchend, touchcancel
    for (const l of touch) expect(l).toMatch(/passive:\s*(true|false)/);
    expect(touch.find((l) => l.includes("'touchstart'"))).toMatch(/passive:\s*true/);
  });

  it('⭐ Z6 — the scrub lock is decided by lockAxis( (pure, tested), never open-coded in the hook', () => {
    const hook = read('hooks/useChartZoom.ts');
    expect(hook).toMatch(/\blockAxis\(/);
    expect(hook).not.toMatch(/Math\.abs\([^)]*\)\s*>=?\s*Math\.abs\(/);
  });

  it('⭐ Z9 — the toolbar reads Zoom · Pan · + · − · Reset (the plan\'s and bitbo\'s order)', () => {
    const frame = read('components/ui/ChartZoomFrame.tsx');
    const labels = [...frame.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]).filter((l) => l !== 'Chart zoom');
    expect(labels).toEqual(['Zoom (drag a box)', 'Pan', 'Zoom in', 'Zoom out', 'Reset view']);
  });

  it.each(['plot', 'box', 'note'])('⭐ Z1 — .%s never takes the pointer (pointer-events: none)', (cls) => {
    const css = read('components/ui/ChartZoomFrame.module.css');
    expect(css).toMatch(new RegExp(`\\.${cls}\\s*\\{[^}]*pointer-events:\\s*none`));
  });
});
