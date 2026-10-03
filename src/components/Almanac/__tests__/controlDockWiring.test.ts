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

// ── Run 2 (spec v1.6, D6–D8) — the same dock on the three parents ──────────────────────────────────────────────────
const PARENTS = [
  { name: 'Cycling', file: 'CyclingFace.tsx', css: 'CyclingFace.module.css' },
  { name: 'Ownership', file: 'OwnershipFace.tsx', css: 'OwnershipFace.module.css' },
  { name: 'Strategy', file: 'UnifiedFace.tsx', css: 'UnifiedFace.module.css' },
] as const;
type Parent = (typeof PARENTS)[number]['name'];
/** The dock's panels: the `dockContent` object, up to `const dockPanels`. */
const panelsOf = (face: string): string => {
  const at = face.indexOf('const dockContent');
  return at < 0 ? '' : face.slice(at, face.indexOf('const dockPanels', at));
};
/** One panel of `dockContent`: from its key to the next panel's (or to the end of the object). */
const panel = (face: string, key: string, next: string | null): string => {
  const p = panelsOf(face);
  const at = p.indexOf(`${key}: (`);
  if (at < 0) return '';
  return next === null ? p.slice(at) : p.slice(at, p.indexOf(`${next}: (`, at));
};
/** The JSX tag that opens at `at`, to its `/>` — braces counted, so an arrow's `>` inside `{…}` never ends it. */
const tagAt = (s: string, at: number): string => {
  let depth = 0;
  for (let i = at; i < s.length - 1; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') depth--;
    else if (depth === 0 && s[i] === '/' && s[i + 1] === '>') return s.slice(at, i + 2);
  }
  return '';
};
/** Every self-closing `<name …/>` tag in `s`, with where it opens. */
const tagsOf = (s: string, name: string): { at: number; tag: string }[] =>
  [...s.matchAll(new RegExp(`<${name}\\s`, 'g'))].map((m) => ({ at: m.index ?? 0, tag: tagAt(s, m.index ?? 0) }));
/** A JSX attribute's raw value — `"…"` or a balanced `{…}`; 'true' for a bare one; null when absent. */
const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}(=|(?=[\\s/>]))`).exec(tag);
  if (!m) return null;
  const i = m.index + m[0].length;
  if (m[1] !== '=') return 'true';
  if (tag[i] === '"') return tag.slice(i, tag.indexOf('"', i + 1) + 1);
  let depth = 0;
  for (let j = i; j < tag.length; j++) {
    if (tag[j] === '{') depth++;
    else if (tag[j] === '}' && --depth === 0) return tag.slice(i, j + 1);
  }
  return null;
};

describe('⭐ the parents — Cycling, Ownership, Strategy (Run 2)', () => {
  it('⭐ P-ONE-DOCK — each parent\'s last child: one dock, after the disclaimer (Cycling, Strategy) or after the two-column shell (Ownership, F16), nothing after it but the face\'s own closing tag', () => {
    // mutations: the dock rendered first (Cycling) → red; the dock inside Ownership's side column → red
    for (const p of PARENTS) {
      const face = strip(read(p.file));
      expect(count(face, '<ControlDock '), p.name).toBe(1);
      expect(count(face, '<ControlDock panels={dockPanels} />'), p.name).toBe(1);
      const at = face.indexOf('<ControlDock ');
      expect(at, `${p.name}: after the disclaimer`).toBeGreaterThan(face.indexOf('<div className={styles.disclaimer}>'));
      const after = face.slice(face.indexOf('/>', at) + 2).replace(/\{\s*\}/g, '').replace(/\s+/g, '');
      expect(after, `${p.name}: the face's last child`).toBe('</div>);}');
    }
  });

  it('⭐ P-ONCE — the scrubber cards are gone: the month and the stress exist once each, in the dock; "Inspect month" on all four; each face keeps its stress range; the dock\'s words', () => {
    const RANGE: Record<Parent, string> = {
      Cycling: 'min={0.35} max={2.2} step={0.01}',
      Ownership: 'min={0.2} max={2.2} step={0.01}',
      Strategy: 'min={0.35} max={2.2} step={0.01}',
    };
    for (const p of PARENTS) {
      const face = strip(read(p.file));
      // RENAME — one name on all four faces. mutation: Ownership's dock slider back to aria-label="Month" → red
      expect(face, `RENAME ${p.name}`).not.toContain('aria-label="Month"');
      expect(count(face, '>Inspect month<'), `RENAME ${p.name}`).toBe(1);
      const panels = panelsOf(face);
      expect(panels.length, `${p.name}: the dock's panels`).toBeGreaterThan(0);
      for (const label of ['aria-label="Inspect month"', 'aria-label="Price stress multiplier"']) {
        expect(count(face, label), `${p.name} ${label}`).toBe(1);
        expect(panels, `${p.name} ${label}`).toContain(label);
      }
      // RANGE — the card's range, kept. mutation: Ownership's stress min 0.35 → red
      expect(panel(face, 'stress', 'path'), `RANGE ${p.name}`).toContain(RANGE[p.name]);
      // WORDS (I6, Δ10; R6 — the post-liq flag). mutations: Ownership's readout inline again → red; the flag dropped → red
      const month = panel(face, 'month', 'stress');
      expect(month, `WORDS ${p.name}`).toContain('{monthReadout(monthIdx)}');
      expect(month, `WORDS ${p.name}: the post-liq flag`).toContain('{selRow.postLiquidation && ');
      expect(face, `WORDS ${p.name}`).toMatch(/const stress = stressPct\(lens\);/);
      expect(face, `WORDS ${p.name}`).not.toContain('(monthIdx / 12).toFixed(1)');
    }
    // SCRUB (Δ11) — Ownership's dock ranges compose Cycling's 44px scrub. mutation: back on styles.scrub → red
    const own = strip(read('OwnershipFace.tsx'));
    expect(panel(own, 'month', 'stress'), 'SCRUB').toContain('className={styles.dockScrub}');
    expect(panel(own, 'stress', 'path'), 'SCRUB').toContain('className={styles.dockScrub}');
    expect(strip(read('OwnershipFace.module.css')), 'SCRUB')
      .toMatch(/\.dockScrub \{ composes: scrub from '\.\/CyclingFace\.module\.css'; \}/);
  });

  it('⭐ P-NOTES — the scrubber cards\' notes stay where the cards were, outside the dock', () => {
    // mutation: the stress note moved into Cycling's Stress panel → red
    const AT: Record<Parent, readonly [string, string]> = {
      Cycling: ['{statTiles.map(', 'Holdings by venue'],
      Ownership: ['{applied && playbook !== null && <p className={styles.noteQuiet}>{playbook}</p>}', '{statTiles.map('],
      Strategy: ['{unpaidNote && <div>{unpaidNote}</div>}', '{statTiles.map('],
    };
    const NOTES = [
      'Anchored {fmtUSD(anchorPrice)}', 'Stress from this month forward', 'Support line at this month:',
      'Below the power-law support line',
    ];
    for (const p of PARENTS) {
      const face = strip(read(p.file));
      const [from, to] = AT[p.name];
      const a = face.indexOf(from);
      const b = face.indexOf(to, a);
      expect(a > 0 && b > a, `${p.name}: the anchors`).toBe(true);
      // Non-vacuous: "not in the dock" means nothing without a dock.
      expect(panelsOf(face).length, `${p.name}: the dock's panels`).toBeGreaterThan(0);
      for (const n of NOTES) {
        expect(count(face, n), `${p.name}: ${n}`).toBe(1);
        expect(face.slice(a, b), `${p.name}: ${n} in place`).toContain(n);
        expect(panelsOf(face), `${p.name}: ${n} not in the dock`).not.toContain(n);
      }
    }
  });

  it('⭐ P-DOUBLED — each parent\'s bottom padding is the dock\'s: the root takes faceDocked, each module a doubled 0 / 12px pair; tokens only', () => {
    // mutations: a single `.faceDocked` (Cycling) → red; Ownership's root without faceDocked → red here and at the e2e's END
    for (const p of PARENTS) {
      expect(strip(read(p.file)), p.name).toMatch(/className=\{`\$\{styles\.face\} \$\{styles\.faceDocked\}`\}/);
      const css = strip(read(p.css));
      expect(css, p.name).toMatch(/\.faceDocked\.faceDocked \{ padding-bottom: 0; \}/);
      expect(css, p.name).toMatch(/@media \(min-width: 1024px\) \{\s*\.faceDocked\.faceDocked \{ padding-bottom: 12px; \}/);
      expect(css, `TOKENS ${p.name}`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it('⭐ P-ONE-PICKER — each parent\'s card and dock share ONE path picker, and its buttons carry aria-pressed', () => {
    // mutations: a second PATH_META.map for the dock (Strategy) → red; the picker without aria-pressed (Cycling) → red
    for (const p of PARENTS) {
      const face = strip(read(p.file));
      expect(count(face, '{PATH_META.map((p) => ('), p.name).toBe(1);
      expect(count(face, '<PathPicker '), p.name).toBe(2);
      expect(panel(face, 'path', 'policy'), `${p.name}: the dock's Path panel`).toContain('<PathPicker ');
      const at = face.indexOf('function PathPicker(');
      expect(at, `${p.name}: the picker`).toBeGreaterThan(0);
      expect(face.slice(at, face.indexOf('\n}', at)), `${p.name}: aria-pressed`).toContain('aria-pressed={pathKind === p.key}');
    }
  });

  it('⭐ P-TIMING — the dock\'s 4-yr timing range is the card\'s: the same min, max, step, value, onChange, aria-label and lock (I4, I19), only while the 4-yr path is on', () => {
    // mutations: the dock's max off by one (Cycling) → red; a lock on the card's range only (Ownership) → red
    const ATTRS = ['min', 'max', 'step', 'value', 'onChange', 'aria-label', 'disabled'];
    for (const p of PARENTS) {
      const face = strip(read(p.file));
      const tags = tagsOf(face, 'input').filter((t) => t.tag.includes('aria-label="4-yr cycle timing"'));
      expect(tags.length, `${p.name}: the card's and the dock's`).toBe(2);
      // Told apart by WHERE they sit: on Cycling and Strategy the two tags are the same text.
      const from = face.indexOf('const dockContent');
      const to = face.indexOf('const dockPanels', from);
      const dock = tags.find((t) => t.at > from && t.at < to);
      const card = tags.find((t) => t.at < from || t.at > to);
      expect(dock !== undefined && card !== undefined, `${p.name}: one in the dock, one in the card`).toBe(true);
      for (const a of ATTRS) expect(attr(dock!.tag, a), `${p.name}: ${a} (VIEWER for the lock)`).toBe(attr(card!.tag, a));
      expect(panel(face, 'path', 'policy'), `${p.name}: only while the 4-yr path is on`).toContain("{pathKind === 'fourYear' && (");
    }
  });

  it('⭐ P-LENS — Strategy\'s lens switch exists once, in the dock, and both views still render (I20); the dock\'s Stress moves `lens`, its Lens moves `lensView`; a flip resets nothing (F18)', () => {
    // mutations: the switch also left on the page → red (I20); the Lens buttons write nothing → red (F18); the Stress
    // slider writes the month → red (F18); `lensView` in the reset list → red (LENS-NO-RESET)
    const face = strip(read('UnifiedFace.tsx'));
    const panels = panelsOf(face);
    expect(count(face, 'role="group" aria-label="Lens"'), 'I20').toBe(1);
    expect(panels, 'I20').toContain('role="group" aria-label="Lens"');
    const views = face.indexOf("{lensView === 'position' ? (");
    expect(views, 'I20: both views').toBeGreaterThan(0);
    expect(face.slice(views), 'I20: the Position view').toContain('Yours in bitcoin');
    expect(face.slice(views), 'I20: the Flywheel view').toContain('Cash flow at month');
    const stress = panel(face, 'stress', 'path');
    const lens = panel(face, 'lens', null);
    expect(stress, 'F18').toContain('onChange={(e) => setLens(Number(e.target.value))}');
    expect(stress, 'F18').not.toContain('setLensView');
    expect(lens, 'F18').toContain('onClick={() => setLensView(k)}');
    expect(lens, 'F18').not.toMatch(/\bsetLens\(/);
    expect(count(face, 'setLensView('), 'I20: the view is set only in the dock').toBe(count(panels, 'setLensView('));
    expect(face, 'the Lens tab reads the view').toMatch(/strategyDockTabs\(\{[^}]*\blensView\b/);
    const reset = /useEffect\(\(\) => \{ setLens\(1\); \}, \[([\s\S]*?)\]\);/.exec(face)?.[1] ?? '';
    expect(reset.length, 'LENS-NO-RESET: the reset list').toBeGreaterThan(0);
    expect(reset, 'LENS-NO-RESET').not.toMatch(/\blensView\b/);
  });

  it('⭐ P-POLICY — each dock\'s Policy panel is the card\'s own controls, with the card\'s props, branching on the face\'s mode', () => {
    // mutation: the dock's Policy ignores onChange (Cycling) → red
    const MODE: Record<Parent, string> = { Cycling: "'cycle'", Ownership: 'mode', Strategy: 'mode' };
    for (const p of PARENTS) {
      const face = strip(read(p.file));
      const card = tagsOf(face, 'SupportPolicyCard');
      const controls = tagsOf(face, 'SupportPolicyControls');
      expect([card.length, controls.length], p.name).toEqual([1, 1]);
      expect(panel(face, 'policy', p.name === 'Strategy' ? 'lens' : null), p.name).toContain('<SupportPolicyControls');
      for (const prop of ['sim', 'raw', 'settings', 'onChange', 'onReset', 'mode', 'expenses']) {
        expect(attr(controls[0].tag, prop), `${p.name}: ${prop}`).toBe(attr(card[0].tag, prop));
      }
      expect(controls[0].tag, p.name).toContain('layout="grid"');
      expect(face, p.name).toContain(`policy: policyCardState(${MODE[p.name]}, policySettings.enabled, sim.policyApplied)`);
    }
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
