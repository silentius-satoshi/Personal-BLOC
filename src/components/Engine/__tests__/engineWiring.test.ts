import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { useStore } from '../../../store/useStore';

/**
 * ⚠ The Engine · Micro's wiring (BL61, step 1), read off the source: the face has no render harness here (the canvas
 * needs a browser — `e2e/engine.spec.ts` drives it). Its facts are gathered where the Dashboard and THIS MONTH gather
 * them; it writes nothing; its frame loop runs only while it can be seen; its colours are tokens. Each assertion
 * carries the tag its planted bug turns red.
 */
const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
/** Code with its comments removed — block, JSX and line comments (a `//` after a `:` is a URL, kept). */
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const DIR = 'src/components/Engine';
const FILES = readdirSync(join(ROOT, DIR)).filter((f) => /\.(ts|tsx|css)$/.test(f)).map((f) => `${DIR}/${f}`);
const FACTS = strip(read(`${DIR}/useEngineFacts.ts`));
const FACE = strip(read(`${DIR}/EngineFace.tsx`));
const CANVAS = strip(read(`${DIR}/EngineCanvas.tsx`));
const SCENE = read(`${DIR}/engineScene.ts`);
const VIEW = read(`${DIR}/engineView.ts`);
const DRAW = read(`${DIR}/engineDraw.ts`);
const PALETTE = `${DIR}/enginePalette.ts`;
const importsOf = (src: string): string[] => [...src.matchAll(/^import[\s\S]*?from '([^']+)';/gm)].map((m) => m[1]);

describe('⭐ one source for each figure', () => {
  it('⭐ ONE SOURCE — the Dashboard\'s inputs as the Dashboard builds them; THIS MONTH\'s run and its month 1, as Daily reads it', () => {
    expect(FACTS, 'ONE SOURCE the Dashboard\'s inputs').toContain('const base = useStore(useShallow(selectSafetyViewInputs));');
    expect(FACTS, 'ONE SOURCE today\'s support, keyed on the day').toContain('const support = useMemo(() => supportToday(todayISO), [todayISO]);');
    expect(FACTS, 'ONE SOURCE the support joins them').toContain('({ ...base, supportToday: support })');
    expect(FACTS, 'ONE SOURCE THIS MONTH\'s run').toContain('const pm = usePlanMonth();');
    expect(FACTS, 'ONE SOURCE its month 1 — Daily\'s pr1').toContain('const month = pm.run.sim.rows[1] ?? pm.run.sim.last;');
    expect(read('src/components/Daily/DailyModeView.tsx'), 'ONE SOURCE premise: Daily\'s own').toContain(
      'const pr1 = pm.run.sim.rows[1] ?? pm.run.sim.last;');
    expect(FACTS, 'ONE SOURCE the Cycle Clock\'s leg').toMatch(/cycleLegAt\(now\)[\s\S]*cycleLegView\(now\)/);
    expect(FACTS, 'ONE SOURCE the live price, each second while open (BL64)').toContain('const live = useLivePrice({ perSecond: true });');
    expect(FACTS, 'ONE SOURCE this month\'s move, as the Dashboard is told it (v1.4)').toContain('const moveBringsCbWithin = planMoveBringsCbWithin(pm.run.placement);');
    for (const f of ['src/components/SimpleMode/SimpleModeView.tsx', 'src/components/Daily/DailyModeView.tsx']) {
      expect(read(f), `ONE SOURCE premise: ${f} tells the Dashboard so`).toContain('moveBringsCbWithin={planMoveBringsCbWithin(pm.run.placement)}');
    }
    expect(FACTS, 'ONE SOURCE the minute clock, read again on a show (v1.4)').toContain('const now = useNow(60_000);');
    expect(FACTS, 'ONE SOURCE no clock of its own').not.toMatch(/setInterval|setTimeout/);
    expect(FACTS, 'ONE SOURCE never the old cadence').not.toMatch(/useBtcPrice/);
    expect(read('src/components/CoinbaseLoan/CoinbaseLoanMain.tsx'), 'ONE SOURCE the CB Loan tab reads the one expression')
      .toContain('const monthlyInterest = cbMonthlyInterest(accruedBalance, cbAprPct);');
    expect(SCENE, 'ONE SOURCE the scene: the Dashboard\'s view at the price drawn').toContain('const view = deriveSafetyView(inputs);');
    expect(SCENE, 'ONE SOURCE a tried price swaps the price alone').toContain('{ ...facts.safety, btcPrice: price }');
    expect(SCENE, 'ONE SOURCE no engine run of its own').not.toMatch(/runCyclingSim|planMonthRun|placementPlan/);
  });
});

describe('⭐ it writes nothing', () => {
  it('⭐ WRITES NOTHING — no store function is named in the Engine\'s files; the tried price never leaves the face', () => {
    const fns = Object.entries(useStore.getState()).filter(([, v]) => typeof v === 'function').map(([k]) => k);
    expect(fns.length > 100 && fns.includes('setBtcPrice'), 'WRITES NOTHING premise: the store\'s functions').toBe(true);
    for (const f of FILES) {
      const code = strip(read(f));
      const named = fns.filter((n) => new RegExp(`\\b${n}\\b`).test(code));
      expect(named, `WRITES NOTHING ${f}`).toEqual([]);
      expect(code, `WRITES NOTHING ${f}: no raw write, no storage`).not.toMatch(/useStore\.setState|getState\(\)|localStorage|sessionStorage/);
    }
    expect(FACE, 'WRITES NOTHING the tried price is the face\'s state').toContain('const [tried, setTried] = useState<number | null>(null);');
    expect(FACE.match(/\bsetTried\b/g)?.length, 'WRITES NOTHING set by the drag, the two steps and the two ways back only').toBe(5);
    expect(CANVAS, 'WRITES NOTHING the canvas only reports a tried price, kept in the frame')
      .toContain('onTry(Math.min(Math.exp(hi) * 0.985, Math.max(Math.exp(lo) * 1.01, price)));');
  });
});

describe('⭐ the frame loop', () => {
  it('⭐ FRAMES — the loop runs only while the page is visible and motion is allowed, and stops on leaving; else one still frame', () => {
    expect(CANVAS, 'FRAMES the condition: off screen, no loop at all (v1.4)').toContain('const running = visible && !reducedMotion && onScreen;');
    expect(CANVAS, 'FRAMES on screen, as the observer says').toContain('setOnScreen(es.some((e) => e.isIntersecting))');
    expect(CANVAS, 'FRAMES the loop restarts with it').toContain('}, [visible, reducedMotion, onScreen, draw, still]);');
    expect(CANVAS, 'FRAMES motion built once (v1.4)').toContain('const [firstMotion] = useState(newMotion);');
    expect(CANVAS, 'FRAMES never one a render').not.toContain('useRef(newMotion())');
    expect(CANVAS, 'FRAMES a still frame otherwise').toMatch(/if \(!running\) \{[\s\S]*?still\(\);/);
    expect(CANVAS, 'FRAMES cancelled on leaving').toContain('return () => cancelAnimationFrame(frame.current);');
    expect(FACE, 'FRAMES the motion preference').toContain('const reducedMotion = useReducedMotion();');
  });

  it('⭐ HAND — the drag lives on the piston\'s handle (no page scroll stolen elsewhere); a tap is not a drag', () => {
    const css = read(`${DIR}/EngineFace.module.css`);
    expect(css, 'HAND the picture scrolls').toMatch(/\.canvas \{[^}]*touch-action: pan-y;/);
    expect(css, 'HAND the handle drags').toMatch(/\.handle \{[^}]*touch-action: none;/);
    expect(CANVAS, 'HAND a tap is not a drag').toContain('if (!d.moved && Math.abs(p.x - d.x0) + Math.abs(p.y - d.y0) <= 4) return;');
    expect(CANVAS, 'HAND it holds where it was taken').toContain('off: pistonY.current - p.y');
    expect(CANVAS, 'HAND the scale holds still under the hand').toContain('m.held = true; m.hinted = true;');
    expect(CANVAS, 'HAND a fingertip finds a small part').toContain('regionAt(sceneRef.current, x, y, lp?.finger ?? false)');
    // a cancelled touch is not a tap: it opens nothing (v1.4). Mutation: the cancel as a release → red
    expect(CANVAS, 'HAND a cancel lets go').toContain('onPointerCancel={onCancel}');
    const cancel = CANVAS.match(/const onCancel = [\s\S]*?\n {2}\};/)?.[0] ?? '';
    expect(cancel, 'HAND premise: the cancel\'s own handler').toContain('drag.current = null;');
    expect(cancel, 'HAND a cancel opens nothing').not.toMatch(/onPart|onTry/);
  });

  it('⭐ READ — the tape reads out to a finger that goes clearly sideways, so an up-and-down stroke still scrolls; let go, it stays; taken by the page, it goes; a readout is no tap (2026-11-25)', () => {
    const css = read(`${DIR}/EngineFace.module.css`);
    expect(css, 'READ premise: the page may take an up-and-down stroke on the picture').toMatch(/\.canvas \{[^}]*touch-action: pan-y;/);
    // Mutation: any move reads (no sideways rule) → red
    expect(CANVAS, 'READ clearly sideways: the prototypes\' rule for the tape').toContain('if (!pr.reading && dx > 8 && dx > dy * 1.2) { pr.reading = true; onHand(); }');
    expect(CANVAS, 'READ only a press that began on the tape').toContain("tape: regionAt(sceneRef.current, p.x, p.y)?.id === 'tape'");
    const up = CANVAS.match(/const onCanvasUp = [\s\S]*?\n {2}\};/)?.[0] ?? '';
    expect(up, 'READ let go: pinned to its moment').toContain('m.read = { x, at: c.t0 + (x - c.x0) / (c.x1 - c.x0) * c.span };');
    const cancel = CANVAS.match(/const onCanvasCancel = [\s\S]*?\n {2}\};/)?.[0] ?? '';
    expect(cancel, 'READ taken by the page: gone').toContain('if (pr.reading) { motion.current.read = null; redraw(); }');
    expect(cancel, 'READ premise: the cancel\'s own handler').toContain('press.current = null;');
    // Mutation: the click after a readout opens the tape's card → red
    expect(CANVAS, 'READ a readout, or a mouse\'s drag, is no tap').toContain('if (lp !== null && (lp.reading || (!lp.finger && lp.moved))) return;');
    expect(CANVAS, 'READ a new touch takes a finger\'s readout away').toContain('if (finger && m.read !== null) { m.read = null; redraw(); }');
    expect(CANVAS, 'READ the box on the Dashboard tooltip\'s tokens').toContain("card: v('--bg-card'), border: v('--border')");
    // Mutation: a tap on no part leaves the card open → red; the piston's drag leaves it open → red
    expect(CANVAS, 'READ a tap on no part closes the card').toContain('if (hit === null) { onNothing(); return; }');
    expect(CANVAS, 'READ the piston\'s drag closes it, as the prototypes\'').toContain('if (!d.moved) onHand();');
    expect(CANVAS, 'READ the canvas\'s whole stroke').toMatch(/onPointerDown=\{onCanvasDown\}[\s\S]*onPointerMove=\{onCanvasMove\}[\s\S]*onPointerUp=\{onCanvasUp\}[\s\S]*onPointerCancel=\{onCanvasCancel\}/);
  });

  it('⭐ POP — a part\'s card pops up: the face\'s last child, a sheet under 640 px sticky to the screen\'s bottom (never fixed), beside its part from 640; Escape and a press elsewhere close it (2026-11-25)', () => {
    const css = strip(read(`${DIR}/EngineFace.module.css`));
    expect(css, 'POP never position: fixed (ui.md: EdgeBackGesture\'s page traps it)').not.toMatch(/position:\s*fixed/);
    expect(css, 'POP on a computer, placed in the face').toMatch(/\.face \{[^}]*position: relative;/);
    expect(css, 'POP beside its part').toMatch(/\.pop \{[^}]*position: absolute;/);
    // Mutation: the sheet fixed, or not sticky → red
    expect(css, 'POP a sheet under 640 px, sticky to the bottom').toMatch(/@media \(max-width: 639px\) \{\s*\.pop \{[^}]*position: sticky;[^}]*bottom: calc\(8px \+ env\(safe-area-inset-bottom, 0px\)\);/);
    expect(SCENE, 'POP the script\'s sheet is the CSS\'s').toContain("export const SHEET_MQ = '(max-width: 639px)';");
    // the face's last child. Mutation: the card back under the canvas, or before the parts → red
    const jsx = FACE.slice(FACE.indexOf('return ('));
    const last = jsx.lastIndexOf('<section');
    expect(last, 'POP premise: the card').toBeGreaterThan(jsx.indexOf('ref={partsRef}'));
    expect(jsx.slice(last), 'POP the face\'s last child').toMatch(/^<section ref=\{cardRef\} className=\{styles\.pop\} role="dialog"[^>]*>[\s\S]*<\/section>\n\s*\)\}\n\s*<\/div>\n\s*\);\n\}\s*$/);
    expect(FACE, 'POP placed as the prototypes place theirs').toContain('const p = cardPlace(open.at, open.from, el.offsetWidth, el.offsetHeight, document.documentElement.clientWidth, window.innerHeight);');
    expect(FACE, 'POP on a phone, the part kept in view above the sheet').toContain('if (over > 0) pageScroller(face).scrollBy({ top: over, behavior: reducedMotion ? \'auto\' : \'smooth\' });');
    // Escape and a press elsewhere. Mutation: no Escape, or a press anywhere closes (the picture's own taps then can't swap) → red
    expect(FACE, 'POP Escape closes').toContain("if (e.key === 'Escape') closeRef.current();");
    expect(FACE, 'POP a press elsewhere closes; the card, the picture and the buttons decide for themselves').toContain('for (const r of [cardRef, wrapRef, partsRef]) if (r.current?.contains(t)) return;');
    expect(FACE, 'POP a press, not a click').toContain("document.addEventListener('pointerdown', onDown);");
    expect(FACE, 'POP a press a moment after it opens was aimed at what was there').toContain('if (performance.now() - openedAt.current >= GUARD_MS) close();');
    expect(FACE, 'POP another part swaps it; the same one closes it').toContain('setOpen((o) => (o !== null && o.part === part ? null : { part, from, at }));');
  });

  it('⭐ STAGE — the canvas as wide as the prototype\'s on the same phone, on its card; under reduced motion a still charge, spread out', () => {
    const css = strip(read(`${DIR}/EngineFace.module.css`));
    expect(css, 'STAGE 9 px from the screen\'s edge, as the prototype').toMatch(/\.wrap \{[^}]*width: min\(700px, calc\(100% \+ 14px\)\);/);
    expect(css, 'STAGE centred from 700 px').toMatch(/\.wrap \{[^}]*margin: 8px 0 0 calc\(\(100% - min\(700px, calc\(100% \+ 14px\)\)\) \/ 2\);/);
    expect(DRAW, 'STAGE the charge pours in only while it can move').toContain('const pour = init && !reduce;');
  });
});

describe('⭐ the walls', () => {
  it('⭐ TOKENS — one file writes a colour, the machine\'s own paint, and none the app has a token for; the canvas reads the tokens', () => {
    expect(FILES, 'TOKENS premise: the palette is among the files').toContain(PALETTE);
    expect(FILES.filter((f) => f.endsWith('.css')).length, 'TOKENS premise: the face\'s CSS is among them').toBe(1);
    for (const f of FILES.filter((x) => x !== PALETTE)) {
      // a colour by its code, or by its name in any quotes (v1.5: double quotes and backticks too)
      expect(strip(read(f)), `TOKENS ${f}: no colour`)
        .not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|(['"`])(?:gray|grey|white|black|red|green|blue|orange|yellow|purple|pink|silver|gold)\1/);
      // and in the CSS, a colour's name as a bare value — never a token's (`var(--green)`) or a property's (`white-space`)
      if (f.endsWith('.css')) {
        expect(strip(read(f)), `TOKENS ${f}: no colour by its bare name`).not.toMatch(/:[^;{}]*?(?<![-\w.])(?:gray|grey|white|black|red|green|blue|orange|yellow|purple|pink|silver|gold)(?![-\w])/);
      }
    }
    const tokens = [...read('src/styles/tokens.css').matchAll(/--[\w-]+:\s*(#[0-9a-fA-F]{3,8})\b/g)].map((m) => m[1].toLowerCase());
    expect(tokens.length, 'TOKENS premise: the tokens read').toBeGreaterThan(15);
    const paint = strip(read(PALETTE)).toLowerCase();
    expect(paint.match(/#[0-9a-f]{3,8}\b/g)?.length ?? 0, 'TOKENS premise: the paint is there').toBeGreaterThan(40);
    for (const hex of tokens) expect(paint, `TOKENS the palette repeats no token: ${hex}`).not.toMatch(new RegExp(`${hex}\\b`));
    expect(CANVAS, 'TOKENS the theme\'s colours').toMatch(/'--green'[\s\S]*'--amber'[\s\S]*'--red'[\s\S]*'--btc'[\s\S]*'--text-primary'[\s\S]*'--orange'/);
    expect(CANVAS, 'TOKENS the venue colours').toMatch(/'--venue-coinbase'[\s\S]*'--venue-strike'/);
    expect(CANVAS, 'TOKENS never the venue defaults').not.toMatch(/'--coinbase'|var\(--coinbase\)/);
    expect(strip(read(`${DIR}/EngineFace.module.css`)), 'TOKENS the stage is the card the prototypes draw on').toMatch(/\.stage \{[^}]*background: var\(--bg-card\);/);
  });

  it('⭐ LAYERS — the scene and the words are pure: no store, no React, no hook; the cycle reaches the scene as a type', () => {
    for (const [name, src] of [['engineScene', SCENE], ['engineView', VIEW], ['engineDraw', DRAW]] as const) {
      const imps = importsOf(src);
      expect(imps.length, `LAYERS ${name} non-vacuous`).toBeGreaterThan(1);
      for (const i of imps) expect(i, `LAYERS ${name} imports ${i}`).not.toMatch(/\/store\/|^react$|\/hooks\/|usePlanMonth|useEngineFacts/);
    }
    expect(SCENE, 'LAYERS the cycle, a type').toMatch(/^import type \{ CycleLeg \} from '\.\.\/\.\.\/simulation\/cycleModel';$/m);
    expect(VIEW, 'LAYERS the words import no belief at run time').not.toMatch(/^import \{[^}]*\} from '[^']*(cycleModel|powerLaw|cyclePath)'/m);
    expect(importsOf(DRAW).sort(), 'LAYERS the drawing reads the scene, the words and the paint, nothing else')
      .toEqual(['../../simulation/safetyView', './engineScene', './enginePalette', './engineView'].sort());
    expect(DRAW, 'LAYERS the drawing computes no figure: no engine, no safety view').not.toMatch(/deriveSafetyView|computeViewerSafety|computeLiquidationAnalysis|cbMonthlyInterest/);
    expect(DRAW, 'LAYERS every dollar it prints, through the words (v1.4)').not.toMatch(/toLocaleString\(|\$\$\{|'\$'/);
  });

  it('⭐ HUB — the face\'s branch above the Converter fallback; its icon; the owner\'s only', () => {
    const hub = read('src/components/Almanac/AlmanacView.tsx');
    const branch = hub.indexOf("if (f === 'engine')    return <EngineFace />;");
    expect(branch, 'HUB the branch').toBeGreaterThan(0);
    expect(branch, 'HUB above the fallback (C8)').toBeLessThan(hub.indexOf('return <div className={styles.faceStack}><ConverterMain />'));
    expect(read('src/components/Almanac/FaceIcon.tsx'), 'HUB its icon').toMatch(/\n {2}engine: </);
    expect(read('src/components/Almanac/almanacGrid.ts'), 'HUB first in your plan, the owner\'s only').toMatch(
      /FACE_TILES: readonly FaceTile\[\] = \[\n {2}\{ key: 'engine', {4}name: 'Engine', {8}group: 'plan', ownerOnly: true \}/);
  });
});
