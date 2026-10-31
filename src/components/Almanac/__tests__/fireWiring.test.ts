import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FIRE_INPUT_DEFAULTS } from '../../../lib/fireInputs';
import { FACE_TILES, faceShown } from '../almanacGrid';

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
const GRID = read('src/components/Almanac/almanacGrid.ts');
const VIEW = read('src/components/Almanac/fireFaceView.ts');
const SCALE = strip(read('src/components/Almanac/FireScale.tsx'));
const SOURCES = [
  FACE_PATH, 'src/components/Almanac/fireFaceView.ts', 'src/components/Almanac/fireReplays.ts',
  'src/components/Almanac/FireScale.tsx', 'src/lib/fireInputs.ts', 'src/lib/fireDeploy.ts',
];
/** Every FIRE file — sources, styles and tests — for the walls that read text. */
const FIRE_FILES = [
  ...SOURCES, 'src/components/Almanac/FireFace.module.css', 'src/components/Almanac/FireScale.module.css',
  'src/components/Almanac/__tests__/fireFaceView.test.ts', 'src/components/Almanac/__tests__/fireReplays.test.ts',
  'src/components/Almanac/__tests__/fireWiring.test.ts', 'src/lib/__tests__/fireInputs.test.ts',
  'src/lib/__tests__/fireDeploy.test.ts', 'src/store/__tests__/fireInputsStore.test.ts', 'e2e/fire.spec.ts',
];
/** Every source file under src/, tests excluded (fireWalls' walker). */
const srcFiles = (dir = join(ROOT, 'src')): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (statSync(p).isDirectory()) return f === '__tests__' ? [] : srcFiles(p);
  return /\.(ts|tsx)$/.test(f) ? [p] : [];
});
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

  it('⭐ DEPLOY GATE — its tile last in your plan, on the deploy rule, never the loan; the env read once, where the grid is built; unreachable where hidden (BL42, BL45)', () => {
    const fire = FACE_TILES.filter((t) => t.key === 'fire');
    expect(fire, 'DEPLOY GATE one FIRE tile, on the rule').toEqual([{ key: 'fire', name: 'FIRE', group: 'plan', gate: 'fireDeploy' }]);
    const plan = FACE_TILES.filter((t) => t.group === 'plan');
    expect(plan[plan.length - 1].key, 'DEPLOY GATE last in your plan').toBe('fire');
    // The rule reads the deploy flag alone: off the deploy it never shows, with or without the loan; on it, always.
    for (const hasCbLoan of [false, true]) {
      for (const ledgerAvailable of [false, true]) {
        expect(faceShown('fire', { hasCbLoan, ledgerAvailable, fireOnDeploy: false }), 'DEPLOY GATE never the loan').toBe(false);
        expect(faceShown('fire', { hasCbLoan, ledgerAvailable, fireOnDeploy: true }), 'DEPLOY GATE never the loan').toBe(true);
      }
    }
    expect(strip(GRID), 'DEPLOY GATE the rule\'s case').toMatch(/case 'fireDeploy': return gates\.fireOnDeploy;/);
    // Every env check reads code, never a comment: a doc comment can't turn the gate red.
    const hub = strip(HUB);
    expect(hub, 'DEPLOY GATE never the loan').not.toMatch(/face === 'fire' && !hasCbLoan/);
    expect(hub, 'DEPLOY GATE the rule\'s import').toContain("import { fireFaceOnDeploy } from '../../lib/fireDeploy';");
    expect(hub, 'DEPLOY GATE the env, read once where the grid is built').toMatch(
      /const FIRE_ON_THIS_DEPLOY = fireFaceOnDeploy\(\{\s*VITE_LANDING: import\.meta\.env\.VITE_LANDING, VITE_DEMO: import\.meta\.env\.VITE_DEMO,\s*\}\);/);
    expect(count(hub, 'import.meta'), 'DEPLOY GATE the hub reads the env only there').toBe(2);
    const calls = srcFiles().flatMap((f) => {
      const code = strip(readFileSync(f, 'utf8')).replace(/function fireFaceOnDeploy\(/g, '');
      return Array.from({ length: count(code, 'fireFaceOnDeploy(') }, () => f.slice(ROOT.length + 1).split('\\').join('/'));
    });
    expect(calls, 'DEPLOY GATE the rule\'s one call, in the hub').toEqual(['src/components/Almanac/AlmanacView.tsx']);
    for (const f of SOURCES) expect(strip(read(f)), `DEPLOY GATE ${f} reads no env`).not.toContain('import.meta');
    expect(hub, 'DEPLOY GATE unreachable where hidden: the fallback').toMatch(
      /useEffect\(\(\) => \{\s*if \(face !== null && !faceShown\(face, \{ hasCbLoan, ledgerAvailable, fireOnDeploy: FIRE_ON_THIS_DEPLOY \}\)\) setFace\(null\);\s*\}, \[face, hasCbLoan, ledgerAvailable\]\);/);
    expect(hub, 'DEPLOY GATE the grid, on the same rule').toContain('gridGroups({ hasCbLoan, ledgerAvailable, fireOnDeploy: FIRE_ON_THIS_DEPLOY })');
    expect(count(hub, 'FIRE_ON_THIS_DEPLOY'), 'DEPLOY GATE one constant: declared, the grid, the fallback').toBe(3);
  });

  it('⭐ THIRTEEN — the union carries the face and the header counts it', () => {
    expect(GRID, 'THIRTEEN the union').toMatch(/type Face =[^;]*\| 'fire';/);
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

  it('⭐ ONE DEFINITION — the chart\'s <Line>s, the legend and the hover box read FIRE_LINES; the marks are CyclingFace\'s (BL41)', () => {
    const lines = [...FACE.matchAll(/<Line\b[^>]*\/>/g)].map((m) => m[0]);
    expect(lines.length, 'ONE DEFINITION two lines').toBe(2);
    for (const k of ['owned', 'needed']) {
      const tag = lines.find((t) => t.includes(`dataKey="${k}"`)) ?? '';
      expect(tag, `ONE DEFINITION the ${k} line's colour`).toContain(`stroke={FIRE_LINES.${k}.color}`);
      expect(tag, `ONE DEFINITION the ${k} line's dash`).toContain(`strokeDasharray={FIRE_LINES.${k}.dash}`);
    }
    const legend = FACE.slice(FACE.indexOf('{CHART_TITLE}'), FACE.indexOf('{domain === null'));
    for (const k of ['owned', 'needed']) {
      expect(legend, `ONE DEFINITION the legend's ${k}`).toContain(
        `<span style={{ color: FIRE_LINES.${k}.color }}><LineMark line={FIRE_LINES.${k}} />{FIRE_LINES.${k}.name}</span>`);
    }
    const tip = FACE.slice(FACE.indexOf('function FireTip('), FACE.indexOf('export default function FireFace('));
    expect(tip, 'ONE DEFINITION the hover box: a line\'s name in its colour, after its mark').toContain(
      '<span style={l.line ? { color: l.line.color } : undefined}>{l.line && <LineMark line={l.line} />}{l.name}</span>');
    const mark = FACE.slice(FACE.indexOf('function LineMark('), FACE.indexOf('function FireTip('));
    expect(mark, 'ONE DEFINITION the mark is drawn like its line').toContain(
      'line.dash === undefined ? styles.lineMark : `${styles.lineMark} ${styles.lineMarkDash}`');
    for (const [where, src] of [['the lines', lines.join('\n')], ['the legend', legend], ['the hover box', tip], ['the mark', mark]]) {
      expect(src.length, `ONE DEFINITION ${where} found`).toBeGreaterThan(40);
      expect(src, `ONE DEFINITION no colour literal in ${where}`).not.toMatch(/var\(--|#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    }
    expect(FACE, 'ONE DEFINITION the two colours live in the view').not.toMatch(/var\(--btc\)|var\(--text-secondary\)/);
    // The view spells each colour once, inside FIRE_LINES; the Milestones' ₿ owned cell reads the definition too.
    const view = strip(VIEW);
    const defn = view.slice(view.indexOf('export const FIRE_LINES'), view.indexOf('};', view.indexOf('export const FIRE_LINES')));
    for (const c of ["'var(--btc)'", "'var(--text-secondary)'"]) {
      expect(count(view, c), `ONE DEFINITION the view spells ${c} once`).toBe(1);
      expect(count(defn, c), `ONE DEFINITION ${c} inside FIRE_LINES`).toBe(1);
    }
    expect(view, 'ONE DEFINITION the Milestones\' ₿ owned cell').toContain(
      "{ label: '₿ owned', value: btcOrNull(row.btc) ?? NONE, color: FIRE_LINES.owned.color },");
    const css = read('src/components/Almanac/FireFace.module.css');
    for (const c of ['lineMark', 'lineMarkDash']) {
      expect(css, `ONE DEFINITION .${c} composed`).toContain(`.${c} { composes: ${c} from './CyclingFace.module.css'; }`);
    }
    const base = read('src/components/Almanac/CyclingFace.module.css');
    expect(base, 'ONE DEFINITION the mark: 14px, a 2px top border in the text\'s colour').toMatch(
      /\.lineMark \{[^}]*width: 14px;[^}]*border-top: 2px solid currentColor;[^}]*\}/);
    expect(base, 'ONE DEFINITION the dashed mark').toMatch(/\.lineMarkDash \{ border-top-style: dashed; \}/);
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
