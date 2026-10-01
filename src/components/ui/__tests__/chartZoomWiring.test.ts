import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⚠ STRUCTURAL GUARD — chart zoom (spec `pbloc-spec-chart-zoom-v1.md`). The repo has no render harness, so the
 * adoption recipe and the view-only rule are read off the source:
 *
 *  - every adopter calls `useChartZoom(` once, reads BOTH axes' domains from `zoom.view` with `allowDataOverflow`,
 *    builds its ticks from `timeTicks(` / `logTicks(`, mounts the plot probe, and keeps its tooltip, cursor and active
 *    dots quiet through a gesture and after it (Z17), with a tooltip that snaps into place (Z23);
 *  - Z18: the toolbar sits in each chart's title row — one layout, never over the plot;
 *  - VIEW ONLY: zoom never reaches a memo that feeds data (the series, the domains-as-data, the engine inputs);
 *  - `chartZoom.ts` is a zero-import leaf; the hook has exactly one non-passive listener, and it is the pinch's
 *    `touchmove`; every clamp passes the reach;
 *  - Z1: the overlay layers never take the pointer (`pointer-events: none` on `.plot`, `.box`, `.note`), or recharts
 *    gets no hover or tap and the tooltip dies on both charts.
 *
 * Each check was proven red by a temporary edit to the real file before it landed. A future adopter joins ADOPTERS.
 */
const SRC = join(process.cwd(), 'src');
const read = (p: string): string => readFileSync(join(SRC, p), 'utf8');
const ADOPTERS = ['components/Almanac/DecisionFace.tsx', 'components/PowerLaw/PowerLawChart.tsx'];

/** The self-closing JSX element that starts at `at`, up to ITS `/>` — one inside a `{…}` prop
 *  (`content={<DecisionTip />}`) is skipped. */
function tagAt(src: string, at: number): string {
  let depth = 0;
  for (let i = at; i < src.length - 1; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
    else if (depth === 0 && src[i] === '/' && src[i + 1] === '>') return src.slice(at, i + 2);
  }
  return '';
}

/** The first self-closing JSX element that starts with `open` (e.g. `<XAxis`). */
function tag(src: string, open: string): string {
  const at = src.indexOf(open);
  return at < 0 ? '' : tagAt(src, at);
}

/** The source with its comments removed — block, JSX and line comments (a `//` after a `:` is a URL, kept). */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** The argument text of every call `fn(` — up to its matching close paren (decisionWiring's helper). */
function callArgs(src: string, fn: string): string[] {
  const out: string[] = [];
  for (let at = src.indexOf(`${fn}(`); at >= 0; at = src.indexOf(`${fn}(`, at + 1)) {
    if (at > 0 && /[A-Za-z0-9_$.]/.test(src[at - 1])) continue;   // the tail of a longer identifier
    let depth = 0;
    let i = at + fn.length;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') { depth -= 1; if (depth === 0) break; }
    }
    out.push(src.slice(at + fn.length + 1, i));
  }
  return out;
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

  it('⭐ the plot probe is mounted; the tooltip stays quiet through a gesture and after it (Z17), and snaps into place — no slide, even under Reduce Motion (Z23)', () => {
    // mutations: back on `zoom.dragging` (the tooltip pops back when the fingers lift) → red; drop
    // isAnimationActive={false} (a 400ms glide) → red; drop the wrapperStyle (Reduce Motion's global 80ms transition on
    // `all` slides it) → red
    expect(src).toMatch(/<Customized component=\{zoom\.probe\}/);
    const tip = tag(src, '<Tooltip');
    expect(tip).toMatch(/\bactive=\{zoom\.quiet \? false : undefined\}/);
    expect(tip).toMatch(/\bisAnimationActive=\{false\}/);
    expect(tip).toMatch(/\bwrapperStyle=\{\{ transitionProperty: 'none' \}\}/);
  });

  it('⭐ Z17 — every series hides its active dot while the chart is quiet (recharts draws them off its own state)', () => {
    // mutation: drop activeDot from any one series → red. Z24: `\b`, not a trailing space — Power Law's band <Line is
    // followed by a newline, inside its .map.
    const code = stripComments(src);
    const series = [...code.matchAll(/<(Area|Line)\b/g)].map((m) => tagAt(code, m.index!));
    expect(series.length, 'series').toBeGreaterThanOrEqual(2);
    for (const t of series) expect(t, t.slice(0, 60)).toMatch(/\bactiveDot=\{!zoom\.quiet\}/);
  });

  it('⭐ Z18 — the toolbar sits in the chart\'s title row, above the chart box: one layout, never over the plot', () => {
    // mutation: the toolbar back inside the box (the old touch row above the plot) → red
    const code = stripComments(src);
    expect(code.match(/<ChartZoomToolbar\b/g)?.length ?? 0, 'one toolbar').toBe(1);
    const head = code.indexOf('className={styles.chartHead}');
    expect(head, 'the title row').toBeGreaterThan(-1);
    expect(code.slice(head, code.indexOf('</div>', head))).toMatch(/<ChartZoomToolbar zoom=\{zoom\} \/>/);
    const placed = code.indexOf('<ChartHead zoom={zoom} />');
    expect(placed, '<ChartHead zoom={zoom} />').toBeGreaterThan(-1);
    expect(placed).toBeLessThan(code.indexOf('<ChartZoomFrame zoom={zoom}>'));
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

  it('⭐ Z15 — pressMode goes through nextMode( (pure, tested), never an inline rule', () => {
    const hook = read('hooks/useChartZoom.ts');
    const at = hook.indexOf('const pressMode = useCallback(');
    expect(at, 'pressMode').toBeGreaterThan(-1);
    const body = hook.slice(at, hook.indexOf('}, []);', at));
    expect(body).toMatch(/\bnextMode\(/);
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

  it('⭐ Z17 — quiet outlives the gesture: endDrag and endPinch never clear it; only a fresh one-finger move or a mouse move does, never mid-gesture', () => {
    // mutations: endPinch clears quiet (the tooltip pops back under the last finger) → red; `!drag` dropped from the
    // touchmove wake (a quiet chart flashes its tooltip before a touch box arms) → red
    const hook = stripComments(read('hooks/useChartZoom.ts'));
    const body = (name: string): string => {
      const at = hook.indexOf(`const ${name} = (`);
      return at < 0 ? '' : hook.slice(at, hook.indexOf('\n    };', at));
    };
    for (const name of ['endDrag', 'endPinch']) {
      expect(body(name), name).not.toBe('');
      expect(body(name), name).not.toMatch(/setQuiet\(/);
    }
    expect(hook.match(/setQuiet\(true\)/g)?.length ?? 0, 'set at the drag\'s arm and the pinch\'s start').toBe(2);
    expect(hook.match(/setQuiet\(false\)/g)?.length ?? 0, 'woken by a fresh move and a mouse move').toBe(2);
    expect(hook).toMatch(/if \(wake !== null && !drag && e\.touches\.length === 1/);
    expect(hook).toMatch(/const onMouseMove = \(\) => \{\s*if \(!drag && !pinch\b/);
    expect(hook).toMatch(/addEventListener\('mousemove', onMouseMove, \{ passive: true \}\)/);
  });

  it('⭐ Z18 — one layout: no media query touches the toolbar, and it never sits over the plot', () => {
    // mutation: the fine-pointer overlay restored (absolute at the plot's top right, fading in) → red
    const css = read('components/ui/ChartZoomFrame.module.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const media: string[] = [];
    for (let at = css.indexOf('@media'); at >= 0; at = css.indexOf('@media', at + 1)) {
      const open = css.indexOf('{', at);
      let depth = 0;
      let i = open;
      for (; i < css.length; i++) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}') { depth -= 1; if (depth === 0) break; }
      }
      media.push(css.slice(open, i + 1));
    }
    expect(media.length, '@media blocks (the fine-pointer cursors)').toBeGreaterThan(0);
    for (const m of media) expect(m).not.toMatch(/\.toolbar\b/);
    const rule = /\.toolbar\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule, '.toolbar').not.toBe('');
    expect(rule).not.toMatch(/position:\s*absolute|opacity:/);
  });

  it('⭐ the reach — every normalizePins( in the hook passes it; the Decision chart gives one, PowerLawChart none (byte-identical)', () => {
    // mutation: the pan frame drops `L2.reach` (it would clamp to home mid-drag, then jump at the release) → red
    const hook = stripComments(read('hooks/useChartZoom.ts'));
    const calls = callArgs(hook, 'normalizePins');
    expect(calls.length, 'normalizePins calls').toBeGreaterThanOrEqual(5);
    for (const a of calls) expect(a.split(',').pop()!.trim(), a).toMatch(/\breach$/);
    expect(read('components/Almanac/DecisionFace.tsx')).toMatch(/useChartZoom\(fullView, TIME_LOG, reachView\)/);
    expect(read('components/PowerLaw/PowerLawChart.tsx')).toMatch(/useChartZoom\(fullView, TIME_LOG\)/);
  });
});
