import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⚠ STRUCTURAL GUARD — sticky controls (spec `pbloc-spec-sticky-controls-v1.md` v1.1). The repo has no render harness, so
 * the wiring is read off the source; the e2e (`e2e/controlDock.spec.ts`) pins where the dock sits on screen. Each
 * assertion carries the tag its named mutation turns red.
 */
const ROOT = process.cwd();
const ALMANAC = join(ROOT, 'src/components/Almanac');
const read = (f: string): string => readFileSync(join(ALMANAC, f), 'utf8');
/** Code with its comments removed — block, JSX and line comments (a `//` after a `:` is a URL, kept). */
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const count = (src: string, needle: string): number => src.split(needle).length - 1;
/** The declarations of the first rule whose selector is exactly `sel`, from its `{` to its `}`. */
const ruleBody = (css: string, sel: string): string => {
  const at = css.indexOf(`${sel} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};
const files = (dir: string, ext: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p, ext) : n.endsWith(ext) ? [p] : [];
});

const FACE = strip(read('DecisionFace.tsx'));
const CARD = strip(read('SupportPolicyCard.tsx'));
const DOCK = strip(read('ControlDock.tsx'));
const DOCK_VIEW = strip(read('controlDockView.ts'));
const DOCK_CSS = strip(read('ControlDock.module.css'));
const FACE_CSS = strip(read('DecisionFace.module.css'));
const SHELL_CSS = strip(readFileSync(join(ROOT, 'src/components/Layout/AppShell.module.css'), 'utf8'));
const TIP_CSS = strip(readFileSync(join(ROOT, 'src/components/ui/InfoTip.module.css'), 'utf8'));

describe('⭐ the dock is sticky, never fixed', () => {
  it('PREMISE — EdgeBackGesture\'s page still has will-change: transform, the trap a fixed dock falls into', () => {
    // mutation: `.page` without will-change → red (the guard is not vacuous)
    const css = strip(readFileSync(join(ROOT, 'src/components/ui/EdgeBackGesture.module.css'), 'utf8'));
    expect(ruleBody(css, '.page')).toMatch(/will-change:\s*transform/);
  });

  it('⭐ STICKY-CSS — `.dock` is position: sticky, nothing in its CSS is fixed or hex, it sits under an open InfoTip, and no stylesheet sets scroll-padding', () => {
    // mutation: `position: fixed` on .dock → red (and the e2e's STICKY: the dock scrolls away with the page)
    expect(ruleBody(DOCK_CSS, '.dock')).toMatch(/position:\s*sticky/);
    expect(DOCK_CSS).not.toMatch(/position:\s*fixed/);
    // TOKENS (I12) — colours come from tokens. mutation: a hex colour in the dock's CSS → red
    expect(DOCK_CSS, 'TOKENS').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // STACK (Δ3) — the dock and InfoTip's panel share a stacking context, and on a tie the later DOM node (the dock)
    // paints over the tip. mutation: `.dock { z-index: 40 }` → red
    const z = (body: string): number => Number(/z-index:\s*(\d+)/.exec(body)?.[1] ?? Number.NaN);
    const dockZ = z(ruleBody(DOCK_CSS, '.dock'));
    const tipZ = z(ruleBody(TIP_CSS, '.panel'));
    expect(Number.isFinite(dockZ) && Number.isFinite(tipZ), 'STACK: both z-indexes found').toBe(true);
    expect(dockZ, 'STACK').toBeLessThan(tipZ);
    // NO-SCROLL-PADDING (I11, F5) — it jumped the page when Tab entered the dock. mutation: in global.css → red
    const sheets = files(join(ROOT, 'src'), '.css').map((f) => strip(readFileSync(f, 'utf8'))).join('\n');
    expect(sheets, 'NO-SCROLL-PADDING').not.toMatch(/scroll-padding/);
  });
});

describe('⭐ the Decision face', () => {
  it('⭐ ONE-DOCK — the face\'s last child: after the disclaimer, nothing after it but the print portal; the dock reads no store', () => {
    // mutation: render <ControlDock> first in the face → red (and the e2e's PINNED: it scrolls off the top)
    expect(count(FACE, '<ControlDock ')).toBe(1);
    const at = FACE.indexOf('<ControlDock ');
    expect(at).toBeGreaterThan(FACE.indexOf('<div className={styles.disclaimer}>{disclaimer}</div>'));
    // A stripped JSX comment leaves its braces behind — drop them.
    const after = FACE.slice(FACE.indexOf('/>', at) + 2).replace(/\{\s*\}/g, '').trim();
    expect(after.startsWith('{createPortal(<pre className={styles.printArea}')).toBe(true);
    // LAYOUT-ONLY (I13) — the face's overlay is the dock's only state. mutation: useStore in ControlDock.tsx → red
    for (const [name, src] of [['ControlDock.tsx', DOCK], ['controlDockView.ts', DOCK_VIEW]] as const) {
      expect(src, `LAYOUT-ONLY ${name}`).not.toMatch(/\buseStore\b|from '[^']*\/store\//);
    }
  });

  it('⭐ ONCE — the scrubber card is gone: the month and the stress exist once, in the dock\'s panels; the Line is locked for a viewer', () => {
    // mutation: a second month slider on the page → red
    const panels = FACE.slice(FACE.indexOf('const dockContent'), FACE.indexOf('const dockPanels'));
    expect(panels.length, 'the dock\'s panels').toBeGreaterThan(0);
    for (const label of ['aria-label="Inspect month"', 'aria-label="Price stress multiplier"']) {
      expect(count(FACE, label), label).toBe(1);
      expect(panels, label).toContain(label);
    }
    // VIEWER (R1) — the card's SliderInput locks its line for a viewer, so the dock's must too. mutation: no `disabled`
    expect(panels, 'VIEWER').toContain('aria-label="Credit line (what-if)" disabled={s.viewerMode}');
    expect(FACE, 'VIEWER').toContain('viewerMode: st.viewerMode,');
  });

  it('⭐ NOTES — the scrubber\'s notes read under the chart they move', () => {
    // mutation: drop the stress note from the chart card → red
    const chartCard = FACE.slice(FACE.indexOf('<ChartHead />'), FACE.indexOf('</section>', FACE.indexOf('<ChartHead />')));
    for (const note of ['{stressNote(supportAtMonth)}', '{BELOW_SUPPORT_NOTE}', 'Anchored {fmtUSD(anchorPrice)}']) {
      expect(count(FACE, note), note).toBe(1);
      expect(chartCard, note).toContain(note);
    }
  });

  it('⭐ DOUBLED — the face\'s bottom padding is the dock\'s: a doubled class, 0 under 1024px and the bar\'s 12px float from it; full mode\'s .main is no scroll container', () => {
    // mutations: a single `.faceDocked` (it would tie the composed .face's padding — P9 / P10) → red; the face keeps
    // its 32px → red here and at the e2e's END; WIDE back to 768 → red here and at the e2e's LAYOUT 1023
    expect(FACE).toMatch(/className=\{`\$\{styles\.face\} \$\{styles\.faceDocked\}`\}/);
    expect(FACE_CSS).toMatch(/\.faceDocked\.faceDocked \{ padding-bottom: 0; \}/);
    expect(FACE_CSS).toMatch(/@media \(min-width: 1024px\) \{\s*\.faceDocked\.faceDocked \{ padding-bottom: 12px; \}/);
    expect(DOCK_CSS).toMatch(/@media \(min-width: 1024px\) \{\s*\.dock \{\s*bottom: 12px;/);
    expect(DOCK, 'WIDE').toMatch(/const WIDE = '\(min-width: 1024px\)';/);
    // FULL-MODE (Δ1) — AppShell's .main was overflow-y: auto: a scroll container that never scrolls, so a sticky dock
    // stuck to it instead of the window; and its 20px bottom padding lifted the bar at the end. mutations: the rule
    // removed → red; the rule without `padding-bottom: 0` → red
    const almanacMain = [...SHELL_CSS.matchAll(/\[data-active-tab="almanac"\]\s+\.main\s*\{([^}]*)\}/g)]
      .map((m) => m[1]).join(';');
    for (const decl of [/overflow-x:\s*clip/, /overflow-y:\s*visible/, /min-width:\s*0/, /padding-bottom:\s*0/]) {
      expect(almanacMain, `FULL-MODE ${decl}`).toMatch(decl);
    }
    expect(almanacMain, 'FULL-MODE').not.toMatch(/overflow(?:-[xy])?:\s*(?:auto|scroll|hidden)/);
  });

  it('⭐ ONE-PICKER — the What-if card\'s and the dock\'s (compact)', () => {
    expect(count(FACE, '{PATH_META.map((p) => (')).toBe(1);
    expect(count(FACE, '<PathPicker ')).toBe(2);
    expect(count(FACE, ' compact />')).toBe(1);
  });
});

describe('⭐ ONE support-policy settings block — the card and the dock can never offer different controls', () => {
  const LABELS = [
    'Coinbase limit at support', 'Strike limit at support', 'Buy with the line up to', 'Pay down above',
    'Borrowing room kept', 'Cash reserve',
  ];

  it('⭐ SIX-ONCE — each of the six sliders is written once in the app, in SupportPolicyCard.tsx', () => {
    // mutation: give the dock its own copy of a slider → red
    const all = files(join(ROOT, 'src/components'), '.tsx').map((f) => strip(readFileSync(f, 'utf8'))).join('\n');
    for (const l of LABELS) {
      expect(count(all, `label="${l}"`), l).toBe(1);
      expect(CARD, l).toContain(`label="${l}"`);
    }
  });

  it('⭐ ONE-BRANCH — the card\'s disclosure and the dock\'s panel both render SupportPolicySliders, branching on policyCardState', () => {
    // mutation: the dock's panel branches on its own → red
    const details = CARD.slice(CARD.indexOf('<details'), CARD.indexOf('</details>'));
    expect(details).toContain('<SupportPolicySliders ');
    expect(count(CARD, 'policyCardState(')).toBe(2);   // the card, and SupportPolicyControls
    expect(CARD).not.toMatch(/!settings\.enabled|!sim\.policyApplied/);
    expect(FACE).toMatch(/<SupportPolicyCard\b/);
    expect(FACE).toMatch(/<SupportPolicyControls\b/);
  });
});
