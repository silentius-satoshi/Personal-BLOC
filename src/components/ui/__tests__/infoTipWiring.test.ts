import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⚠ STRUCTURAL GUARD — InfoTip fit (spec `pbloc-spec-infotip-fit-v1.md` v1.1). The repo has no render harness, so the
 * wiring is read off the source. Each check was proven red by its named mutation (W1–W7) before it landed.
 *
 * Comments are stripped before every check: the component's docblock names `mouseenter`, and a comment's stray paren
 * would cut a body short.
 */
const SRC = join(process.cwd(), 'src');
const read = (p: string): string => readFileSync(join(SRC, p), 'utf8');
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const TIP = strip(read('components/ui/InfoTip.tsx'));
const CSS = strip(read('components/ui/InfoTip.module.css'));

/** The text of the first `open` call (e.g. `useLayoutEffect(`), up to the paren that closes it — '' when missing. */
function callBody(src: string, open: string): string {
  const at = src.indexOf(open);
  if (at < 0) return '';
  let depth = 0;
  for (let i = at + open.length - 1; i < src.length; i++) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') { depth -= 1; if (depth === 0) return src.slice(at, i + 1); }
  }
  return '';
}

describe('⭐ InfoTip — placed against the screen', () => {
  it('⭐ infoTipModel.ts imports nothing (a pure leaf, like chartZoom.ts)', () => {
    const model = read('components/ui/infoTipModel.ts');
    expect(model).not.toMatch(/^\s*import\b/m);
    expect(model).not.toMatch(/\brequire\(/);
  });

  it('⭐ the panel is placed in a useLayoutEffect through tipShift, against documentElement.clientWidth', () => {
    // mutation W4: `window.innerWidth` for the width → red (it counts a computer's scrollbar)
    const body = callBody(TIP, 'useLayoutEffect(');
    expect(body, 'useLayoutEffect').not.toBe('');
    expect(body).toMatch(/\btipShift\(/);
    expect(body).toMatch(/\.getBoundingClientRect\(\)/);
    expect(body).toMatch(/document\.documentElement\.clientWidth/);
  });

  it('⭐ …and placed again on resize (rotation fires it too)', () => {
    // mutation W3: the resize listener dropped → red
    const body = callBody(TIP, 'useLayoutEffect(');
    expect(body).toMatch(/window\.addEventListener\('resize', place\)/);
    expect(body).toMatch(/window\.removeEventListener\('resize', place\)/);
  });
});

describe('⭐ InfoTip — one tap opens it, and a click never closes a tip you are reading', () => {
  it('⭐ no React hover props: a touch tap fires mouseenter, then click', () => {
    // mutation W1: `onMouseEnter` / `onMouseLeave` back on the wrap → red
    expect(TIP).not.toMatch(/\bon(?:Mouse|Pointer)(?:Enter|Leave)\s*=/);
  });

  it('⭐ hover is a mouse\'s only: native pointerenter / pointerleave, each send gated on pointerType === \'mouse\'', () => {
    // mutation W2: either gate dropped → red
    expect(TIP).toMatch(/\.addEventListener\('pointerenter', enter\)/);
    expect(TIP).toMatch(/\.addEventListener\('pointerleave', leave\)/);
    const sends = TIP.split('\n').filter((l) => /\bsend\('hover(?:In|Out)'\)/.test(l));
    expect(sends.length).toBe(2);
    for (const l of sends) expect(l).toMatch(/\bpointerType === 'mouse'/);
    expect(sends.some((l) => l.includes("send('hoverIn')"))).toBe(true);
    expect(sends.some((l) => l.includes("send('hoverOut')"))).toBe(true);
  });

  it('⭐ the open state goes through nextTipState — a tap or click pins, never a toggle', () => {
    // mutation W7: the click back to a toggle → red
    expect(TIP).toMatch(/useReducer\(nextTipState, 'closed'\)/);
    expect(TIP).toMatch(/onClick=\{\(\) => send\('press'\)\}/);
    expect(TIP).not.toMatch(/\(v\) => !v/);
    expect(TIP).not.toMatch(/\bsetOpen\b/);
  });
});

describe('⭐ InfoTip — the panel CSS', () => {
  it('⭐ the ≤480px rule is gone; the panel keeps left: -8px, fits between the gutters, and never transitions', async () => {
    // mutation W5: the ≤480px `right: -8px` rule back → red; mutation W6: `transition-property: none` dropped → red
    const { TIP_GUTTER_PX } = await import('../infoTipModel');
    expect(CSS).not.toMatch(/480px/);
    expect(CSS).not.toMatch(/right:\s*-8px/);
    const panel = /\.panel\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(panel, '.panel').not.toBe('');
    expect(panel).toMatch(/\bleft:\s*-8px/);
    // The CSS gutter is the model's: the max width leaves 16px each side, so the panel always fits between them.
    expect(panel).toContain(`max-width: min(calc(100vw - ${2 * TIP_GUTTER_PX}px), 26rem)`);
    expect(panel).toMatch(/transition-property:\s*none/);
  });
});

describe('InfoTip — unchanged', () => {
  it('the panel renders only while open; Escape and an outside pointerdown close it; the aria attributes stay', () => {
    expect(TIP).toMatch(/\{open && \(/);
    expect(TIP).toMatch(/e\.key === 'Escape'/);
    expect(TIP).toMatch(/document\.addEventListener\('pointerdown', onDown\)/);
    expect(TIP).toMatch(/role="note"/);
    expect(TIP).toMatch(/aria-expanded=\{open\}/);
    expect(TIP).toMatch(/aria-controls=\{open \? panelId : undefined\}/);
  });
});
