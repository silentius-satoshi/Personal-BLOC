import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FIRE_INPUT_DEFAULTS } from '../../../lib/fireInputs';

/**
 * ⚠ STRUCTURAL GUARD — the FIRE face's wiring (batch 1 build 4). The repo has no render harness, so the wiring is read off
 * the source; e2e/fire.spec.ts pins what the face shows. Each assertion carries the tag its planted bug turns red.
 */
const ROOT = process.cwd();
const read = (p: string): string => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '');
/** Code with its comments removed — block, JSX and line comments (a `//` after a `:` is a URL, kept). */
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const count = (src: string, needle: string): number => src.split(needle).length - 1;
const importsOf = (src: string): string[] => [...src.matchAll(/^import[^;]*?from '([^']+)';/gm)].map((m) => m[1]);

const FACE_PATH = 'src/components/Almanac/FireFace.tsx';
const FACE = strip(read(FACE_PATH));
const HUB = read('src/components/Almanac/AlmanacView.tsx');
const VIEW = read('src/components/Almanac/fireFaceView.ts');
const SCALE = strip(read('src/components/Almanac/FireScale.tsx'));
const SOURCES = [
  FACE_PATH, 'src/components/Almanac/fireFaceView.ts', 'src/components/Almanac/fireReplays.ts',
  'src/components/Almanac/FireScale.tsx', 'src/lib/fireInputs.ts',
];
/** Every FIRE file — sources, styles and tests — for the walls that read text. */
const FIRE_FILES = [
  ...SOURCES, 'src/components/Almanac/FireFace.module.css', 'src/components/Almanac/FireScale.module.css',
  'src/components/Almanac/__tests__/fireFaceView.test.ts', 'src/components/Almanac/__tests__/fireReplays.test.ts',
  'src/components/Almanac/__tests__/fireWiring.test.ts', 'src/lib/__tests__/fireInputs.test.ts',
  'src/store/__tests__/fireInputsStore.test.ts', 'e2e/fire.spec.ts',
];
/** A memo's (or effect's) dependency list, by its opening text. */
const depsAfter = (src: string, opener: string): string[] => {
  const at = src.indexOf(opener);
  if (at < 0) return [];
  const close = src.indexOf(']);', at);
  const open = src.lastIndexOf('[', close);
  return src.slice(open + 1, close).split(',').map((d) => d.trim()).filter(Boolean);
};

describe('⭐ the hub', () => {
  it('⭐ C8 — the explicit renderFace branch sits ABOVE the Converter fallback', () => {
    const branch = HUB.indexOf("if (f === 'fire')      return <FireFace />;");
    const fallback = HUB.indexOf('return <div className={styles.faceStack}><ConverterMain />');
    expect(branch, 'C8 the branch').toBeGreaterThan(0);
    expect(fallback, 'C8 the fallback').toBeGreaterThan(0);
    expect(branch, 'C8 above the fallback').toBeLessThan(fallback);
  });

  it('⭐ LAST and UNGATED — the pill is appended last, ungated; halving stays first', () => {
    const list = HUB.slice(HUB.indexOf('const visibleFaces'), HUB.indexOf('];', HUB.indexOf('const visibleFaces')));
    const entries = list.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{') || l.startsWith('...'));
    expect(entries[entries.length - 1], 'LAST and UNGATED').toBe("{ key: 'fire' as Face, label: '◎ FIRE' },");
    expect(entries[0], 'LAST halving first').toBe("{ key: 'halving',  label: '◔ Halving Clock' },");
  });

  it('⭐ THIRTEEN — the union carries the face and the header counts it', () => {
    expect(HUB, 'THIRTEEN the union').toMatch(/type Face = [^;]*\| 'fire';/);
    expect(HUB, 'THIRTEEN the header').toMatch(/for THIRTEEN faces/);
    expect(HUB, 'THIRTEEN no stale count').not.toMatch(/TWELVE/);
  });
});

describe('⭐ the walls', () => {
  it('⭐ BELIEF — the view imports no belief, no store, no React; the scale is layout only', () => {
    for (const i of importsOf(VIEW)) expect(i, `BELIEF fireFaceView imports ${i}`).not.toMatch(/powerLaw|cyclePath|cycleModel|cycleReplays|pricePaths|data\/|\/store\/|^react$|controlDockView|fireReplays/);
    expect(importsOf(VIEW).length, 'BELIEF non-vacuous').toBeGreaterThan(3);
    expect(importsOf(SCALE), 'BELIEF the scale').toEqual(['./FireScale.module.css']);
  });

  it('⭐ NO SIM — no FIRE source reads the simulations or runs the strategy engine (D1 A′)', () => {
    for (const f of SOURCES) {
      const src = strip(read(f));
      expect(src.length, `NO SIM ${f} read`).toBeGreaterThan(0);
      for (const i of importsOf(src)) expect(i, `NO SIM ${f} imports ${i}`).not.toMatch(/pricePaths|monteCarlo|futuresRun|useFutures|futuresClient|futuresView|FuturesCard/);
      expect(src, `NO SIM ${f} runs no strategy engine`).not.toMatch(/\brunCyclingSim\(/);
    }
  });

  it('⭐ NO FETCH — no FIRE source fetches; the history is usePowerLawData\'s, as it is', () => {
    for (const f of SOURCES) expect(strip(read(f)), `NO FETCH ${f}`).not.toMatch(/\bfetch\(/);
    expect(FACE, 'NO FETCH the history').toMatch(/const \{ historical, loading: historyLoading, error: historyError \} = usePowerLawData\(\);/);
  });

  it('⭐ WRITES — the face writes only its own inputs and the shared inflation', () => {
    const setters = [...new Set([...FACE.matchAll(/\bst\.(set[A-Z]\w*)/g)].map((m) => m[1]))].sort();
    expect(setters, 'WRITES').toEqual(['setFireInputs', 'setInflationRate']);
    expect(FACE, 'WRITES no getState writer').not.toMatch(/getState\(\)\.set[A-Z]|useStore\.setState/);
  });

  it('⭐ RESET — "Reset to defaults" resets the face\'s inputs only; inflation is Living\'s too, and stays', () => {
    expect(FACE, 'RESET the one handler').toMatch(/const resetInputs = \(\) => s\.setFireInputs\(null\);/);
    expect(FACE, 'RESET the selector').toContain('setInflationRate: st.setInflationRate,');
    expect(count(FACE, 's.setInflationRate'), 'RESET inflation written only by its field').toBe(1);
    expect(FACE, 'RESET the button').toMatch(/onClick=\{resetInputs\} disabled=\{s\.viewerMode\}/);
  });

  it('⭐ SHARED INFLATION — one field, two editors: the face edits the store\'s inflationRate; its inputs hold none', () => {
    expect(FACE, 'SHARED INFLATION the field').toMatch(/value=\{s\.inflationRate\} onChange=\{s\.setInflationRate\}/);
    expect(Object.keys(FIRE_INPUT_DEFAULTS).filter((k) => /inflation/i.test(k)), 'SHARED INFLATION no copy').toEqual([]);
  });

  it('⭐ TEST-ONLY — no FIRE file names a test-only engine input, even in a comment', () => {
    const guard = read('src/simulation/__tests__/cyclingSim.test.ts');
    const found = guard.match(/grep -rnE "([A-Za-z|]+)" src\/components\//);   // by its pattern, never its line number
    expect(found, 'TEST-ONLY the survival-guard grep').not.toBeNull();
    const names = found![1].split('|');
    expect(names.length, 'TEST-ONLY its list').toBeGreaterThanOrEqual(10);
    for (const f of FIRE_FILES) {
      const text = read(f);
      expect(text.length, `TEST-ONLY ${f} read`).toBeGreaterThan(0);
      names.forEach((n, k) => expect(text.includes(n), `TEST-ONLY ${f} names test-only input ${k}`).toBe(false));
    }
  });
});

describe('⭐ the face\'s reads', () => {
  it('⭐ POSITION — the four faces\' reads, the accrual, the parents\' sums; one three-argument call, in the view', () => {
    for (const read of [
      'strikeCollateralBtc: st.getCurrentBtcHeld(),', 'strikeBalance: st.advisorActualBlocBalance,',
      'cbCollateralBtc: planCbCollateralOf(st),', 'openingColdBtc: st.getCurrentColdBtc(),',
      'cbLoanBalance: planCbLoanBalanceOf(st),',
    ]) expect(FACE, `POSITION ${read}`).toContain(read);
    expect(FACE, 'POSITION the accrual').toMatch(/accruedCbBalance\(s\.cbLoanBalance, s\.cbAprPct, s\.cbLoanBalanceAsOf\)/);
    expect(FACE, 'POSITION the coins').toContain('const openingBtc = s.strikeCollateralBtc + s.cbCollateralBtc + s.openingColdBtc;');
    expect(FACE, 'POSITION the debt').toContain('const openingDebt = cbDebt + s.strikeBalance;');
    // planRunWiring's GATE: never the raw balance, never a derive of the collateral.
    expect(FACE, 'POSITION no raw balance').not.toMatch(/st\.cbLoanBalance\b/);
    expect(FACE, 'POSITION no direct derive').not.toMatch(/\bderiveCbCollateral\(/);
    expect(FACE, 'POSITION no call in the face').not.toMatch(/deriveOwnership\(/);
    const calls = [...strip(VIEW).matchAll(/deriveOwnership\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls.map((a) => a.split(',').length), 'POSITION one call, three arguments').toEqual([3]);
  });

  it('⭐ ANCHOR — the path is built from the held anchor, never the polled quote', () => {
    expect(FACE, 'ANCHOR the lens').toContain('useStressLens(s.btcPrice, s.btcPriceMode)');
    expect(FACE, 'ANCHOR the band path').toContain('plConvergencePath(anchorPrice, pathKind, startDate, months, convergeMonths)');
    expect(FACE, 'ANCHOR the cycle path').toContain('cycleConvergencePath(anchorPrice, startDate, months, convergeMonths, phaseShiftMonths)');
    expect(FACE, 'ANCHOR never the quote').not.toMatch(/ConvergencePath\(s\.btcPrice/);
  });

  it('⭐ HORIZON — the engine gets `months` prices (months 0 … months − 1), never months + 1', () => {
    expect(count(FACE, '.slice(0, months)'), 'HORIZON').toBe(1);
    expect(FACE, 'HORIZON the path memo').toMatch(/convergeMonths\)\)\.slice\(0, months\),/);
  });

  it('⭐ CLAMP — the inspected month is clamped at render, and no row is read by the raw index', () => {
    expect(FACE, 'CLAMP').toContain('const monthIdx = clampMonth(selectedMonth, pricePath.length);');
    expect(FACE, 'CLAMP never the raw index').not.toMatch(/\[selectedMonth\]/);
  });

  it('⭐ STABLE — the inputs are read once a change, never once a render; every dependency is stable', () => {
    expect(FACE, 'STABLE the memoised read').toContain('const fi = useMemo(() => fireInputsOf(s.fireInputs), [s.fireInputs]);');
    expect(count(FACE, 'fireInputsOf('), 'STABLE one read').toBe(1);
    for (const [name, opener] of [['engine', 'const engineInputs = useMemo('], ['reset', 'useEffect(() => { setLens(1); }, [']] as const) {
      const deps = depsAfter(FACE, opener);
      expect(deps.length, `STABLE ${name} found`).toBeGreaterThan(3);
      for (const d of deps) expect(d, `STABLE ${name} ${d}`).toMatch(/^[\w.]+$/);   // a name or a member — no call, no literal
    }
  });

  it('⭐ RESET MIRROR — every engine input also resets the lens; the path and the month too', () => {
    const engine = depsAfter(FACE, 'const engineInputs = useMemo(');
    const reset = depsAfter(FACE, 'useEffect(() => { setLens(1); }, [');
    expect(engine, 'RESET MIRROR a known engine input').toContain('fi');
    expect(engine.filter((d) => !reset.includes(d)), 'RESET MIRROR missing from the reset').toEqual([]);
    for (const d of ['pricePath', 'monthIdx']) expect(reset, `RESET MIRROR ${d}`).toContain(d);
  });

  it('⭐ VIEWER — the face\'s own buttons are inert for a viewer (D-1); its number fields are already read-only', () => {
    expect(FACE, 'VIEWER the flag').toContain('viewerMode: st.viewerMode,');
    expect(count(FACE, 'disabled={s.viewerMode}'), 'VIEWER the stop choice and Reset').toBe(2);
  });

  it('⭐ SITES — eleven literal number fields, every one saved on leaving', () => {
    const tags = [...FACE.matchAll(/<NumberInput\b/g)].map((m) => FACE.slice(m.index, FACE.indexOf('/>', m.index)));
    expect(tags.length, 'SITES 11 literal tags').toBe(11);
    for (const t of tags) expect(t, 'SITES leave').toMatch(/\bsave="leave"/);
  });
});

describe('⭐ the face\'s shape', () => {
  it('⭐ CSS — only composes CyclingFace\'s classes; the one override is the doubled .faceDocked pair; no hex', () => {
    const css = strip(read('src/components/Almanac/FireFace.module.css'));
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2].trim() }));
    expect(rules.length, 'CSS non-vacuous').toBeGreaterThan(10);
    for (const r of rules) {
      if (r.sel.endsWith('.faceDocked.faceDocked')) { expect(r.body, `CSS ${r.sel}`).toMatch(/^padding-bottom: \d+(px)?;$/); continue; }
      expect(r.body, `CSS ${r.sel}`).toMatch(/^composes: [\w-]+ from '\.\/CyclingFace\.module\.css';$/);
    }
    expect(css, 'CSS the doubled pair').toMatch(/\.faceDocked\.faceDocked \{ padding-bottom: 0; \}/);
    expect(css, 'CSS the bar\'s float').toMatch(/@media \(min-width: 1024px\) \{\s*\.faceDocked\.faceDocked \{ padding-bottom: 12px; \}/);
    for (const f of ['FireFace.module.css', 'FireScale.module.css']) {
      expect(strip(read(`src/components/Almanac/${f}`)), `CSS ${f} tokens only`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
    expect(FACE, 'CSS the face\'s classes').toContain('className={`${styles.face} ${styles.faceDocked}`}');
  });

  it('⭐ FOLD and LINK — the Assumptions read as a fold, and the credit link is readable on the card', () => {
    expect(FACE, 'FOLD the details').toContain('<details className={styles.fold}>');
    expect(FACE, 'LINK the credit').toMatch(/<a className=\{styles\.link\} href=\{c\.href\}/);
    const css = read('src/components/Almanac/FireFace.module.css');
    expect(css, 'FOLD composed').toContain(".fold { composes: fold from './CyclingFace.module.css'; }");
    expect(css, 'LINK composed').toContain(".link { composes: link from './CyclingFace.module.css'; }");
    const base = read('src/components/Almanac/CyclingFace.module.css');
    expect(base, 'FOLD the pointer').toMatch(/\.fold > summary \{[^}]*cursor: pointer;/);
    expect(base, 'FOLD the marker').toMatch(/\.fold > summary::after \{ content: ' ›'; \}/);
    expect(base, 'LINK a readable token').toMatch(/\.link \{[^}]*color: var\(--text-secondary\);/);
  });

  it('⭐ DOCK LAST — one dock, the face\'s last child, after the disclaimer; never position: fixed', () => {
    expect(count(FACE, '<ControlDock '), 'DOCK LAST one').toBe(1);
    const at = FACE.indexOf('<ControlDock ');
    expect(at, 'DOCK LAST after the disclaimer').toBeGreaterThan(FACE.indexOf('className={styles.disclaimer}'));
    const after = FACE.slice(FACE.indexOf('/>', at) + 2).replace(/\{\s*\}/g, '').trim();
    expect(after.startsWith('</div>\n  );\n}'), 'DOCK LAST nothing after it').toBe(true);
    expect(FACE, 'DOCK LAST its tabs').toContain('fireDockTabs({ monthIdx, lens, path: pathKind })');
    for (const f of ['FireFace.module.css', 'FireScale.module.css']) {
      expect(read(`src/components/Almanac/${f}`), `DOCK LAST ${f}`).not.toMatch(/position:\s*fixed/);
    }
  });

  it('⭐ I31 — no string literal and no JSX text in the face is a sentence; every one lives in fireFaceView', () => {
    const isSentence = (t: string): boolean => {
      const x = t.trim();
      return (x.endsWith('.') || x.endsWith('—')) && (x.match(/[A-Za-z]{2,}/g) ?? []).length >= 4;
    };
    const strings = [...FACE.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
    const jsxText = [...FACE.matchAll(/>([^<>{}]*)</g)].map((m) => m[1]);
    expect(strings.length, 'I31 non-vacuous').toBeGreaterThan(20);
    expect(jsxText.some((t) => t.includes('Price')), 'I31 non-vacuous: the table\'s headers').toBe(true);
    expect([...strings, ...jsxText].filter(isSentence), 'I31').toEqual([]);
  });

  it('⭐ WORDLESS — the scale writes no word: the view hands it every label', () => {
    const ALLOWED = new Set(['./FireScale.module.css', 'img', '']);
    const quoted = [...SCALE.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map((m) => m[1] ?? m[2]).filter((l) => !ALLOWED.has(l));
    const templated = [...SCALE.replace(/\$\{[^}]*\}/g, '').matchAll(/`([^`]*)`/g)].map((m) => m[1]).filter((t) => /[A-Za-z]/.test(t));
    const jsxText = [...SCALE.matchAll(/(?<!=)>((?:[^<>{}]|\{[^{}]*\})+)</g)].map((m) => m[1].replace(/\{[^{}]*\}/g, '')).filter((t) => /[A-Za-z]/.test(t));
    expect(SCALE.length, 'WORDLESS read').toBeGreaterThan(0);
    expect([...quoted, ...templated, ...jsxText], 'WORDLESS').toEqual([]);
  });
});
