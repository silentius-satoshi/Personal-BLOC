import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * BL15 (Customization; batch spec §2.4) — the wiring, read off the source: every venue mark reads a venue token; Settings'
 * "Display" and "Tabs" are one owner page with the colours on it; the sink runs once, at the top of AppShell; the picker
 * runs THE rule before it writes, from swatches alone; the hover boxes sit on a venue surface. Every assertion carries
 * its tag (TOKENS ONLY, STAYS, SURFACES, ONE PAGE, SINK, PICKER).
 */

const SRC = join(process.cwd(), 'src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : files(p, ext);
    return ext.test(e.name) ? [p] : [];
  });
}
const rel = (p: string): string => p.slice(SRC.length + 1);

/** Every CSS rule whose selector names a venue class: [file, selector, body]. */
const VENUE_CLASS = /\.(?:venue(?:Seg|Dot)(?:Strike|Cb|Cold)|(?:seg|val)(?:Strike|Cb|Cold)|coldNum|coldBig|msCold)\b/;
function venueRules(): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const f of files(join(SRC, 'components'), /\.module\.css$/)) {
    const css = code(readFileSync(f, 'utf8'));
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim();
      if (VENUE_CLASS.test(selector) && /(?:^|;)\s*(?:color|background(?:-color)?)\s*:/.test(m[2])) out.push([rel(f), selector, m[2]]);
    }
  }
  return out;
}

describe('⭐ TOKENS ONLY — every venue mark reads a venue token', () => {
  it('⭐ TOKENS ONLY — the venue classes (dots, bar segments, figures, the cold numbers) wear --venue-*', () => {
    const rules = venueRules();
    expect(rules.length, 'TOKENS ONLY premise: the venue rules found').toBeGreaterThanOrEqual(20);
    for (const [file, selector, body] of rules) {
      expect(body, `TOKENS ONLY ${file} ${selector}`).toMatch(/var\(--venue-(?:strike|coinbase|cold)\)/);
      expect(body, `TOKENS ONLY ${file} ${selector} — no shared token`).not.toMatch(/var\(--(?:text-primary|coinbase|btc)\)/);
    }
  });

  it('⭐ TOKENS ONLY — --coinbase is read by tokens.css alone (the venue token\'s default)', () => {
    const hits = files(SRC, /\.(?:css|tsx?)$/).filter((f) => code(readFileSync(f, 'utf8')).includes('var(--coinbase)')).map(rel);
    expect(hits, 'TOKENS ONLY --coinbase').toEqual(['styles/tokens.css']);
  });

  it('⭐ TOKENS ONLY — the faces\' Strike, Coinbase and Cold lines, the limits drawn in their venue\'s colour, the plan\'s venue map', () => {
    for (const face of ['components/Almanac/OwnershipFace.tsx', 'components/Almanac/UnifiedFace.tsx']) {
      const s = code(read(face));
      for (const [name, token] of [['Strike', 'strike'], ['Coinbase', 'coinbase'], ['Cold', 'cold'], ['Policy limit', 'coinbase']]) {
        const line = s.match(new RegExp(`<Line [^>]*name="${name}"[^>]*>`));
        expect(line?.[0], `TOKENS ONLY ${face} the ${name} line`).toContain(`stroke="var(--venue-${token})"`);
      }
    }
    const own = code(read('components/Almanac/OwnershipFace.tsx'));
    expect(own, 'TOKENS ONLY Ownership\'s Strike draw cap').toMatch(/<ReferenceLine y=\{50\} stroke="var\(--venue-strike\)"[\s\S]{0,120}value: 'Strike draw cap', fill: 'var\(--venue-strike\)'/);
    const uni = code(read('components/Almanac/UnifiedFace.tsx'));
    expect(uni, 'TOKENS ONLY Strategy\'s Strike cap').toMatch(/<ReferenceLine y=\{strikeCapEff\} stroke="var\(--venue-strike\)"[\s\S]{0,160}fill: 'var\(--venue-strike\)'/);
    expect(code(read('components/Almanac/CyclingFace.tsx')), 'TOKENS ONLY Cycling\'s Cold figure')
      .toMatch(/label: 'Cold', value: `₿\$\{r\.coldBtc\.toFixed\(3\)\}`, color: 'var\(--venue-cold\)'/);
    expect(code(read('components/Almanac/planMonthView.ts')), 'TOKENS ONLY the plan\'s venue map')
      .toMatch(/strike: 'var\(--venue-strike\)', coinbase: 'var\(--venue-coinbase\)', cold: 'var\(--venue-cold\)'/);
  });

  it('⭐ STAYS — the bitcoin orange that marks bitcoin itself, and the Cycling face\'s lone Coinbase line, keep --btc', () => {
    const cyc = code(read('components/Almanac/CyclingFace.tsx'));
    expect(cyc, 'STAYS Cycling\'s CB LTV line').toMatch(/<Line type="monotone" dataKey="cbLtvPct" name="CB LTV" stroke="var\(--btc\)"/);
    expect(cyc, 'STAYS BTC gained').toMatch(/label: 'BTC gained'[^\n]*color: 'var\(--btc\)'/);
    expect(code(read('components/Almanac/OwnershipFace.tsx')), 'STAYS Yours').toMatch(/dataKey="yours" name="Yours" stroke="var\(--btc\)"/);
    const cal = code(read('components/Daily/Calendar.module.css'));
    expect(cal, 'STAYS the calendar\'s CB collateral dot (bitcoin going in)').toMatch(/\.mCb \{ background: var\(--btc\); \}/);
    expect(cal, 'STAYS … and its legend').toMatch(/\.lgCb\s+\{ background: var\(--btc\); \}/);
    expect(cal, 'STAYS premise: a selected day is --surface-3, no venue surface').toMatch(/\.cellSel \{\s*background: var\(--surface-3\);/);
  });
});

describe('⭐ SURFACES — a venue mark sits on a venue surface, hover boxes included', () => {
  it('⭐ SURFACES — the charts\' shared hover box is --surface-2, as Ownership\'s; a face that composes it never repaints it', () => {
    const box = (f: string) => code(read(f)).match(/\.tooltip \{[^}]*\}/)?.[0];
    expect(box('components/Almanac/CyclingFace.module.css'), 'SURFACES the shared hover box').toMatch(/background: var\(--surface-2\);/);
    expect(box('components/Almanac/OwnershipFace.module.css'), 'SURFACES Ownership\'s own').toMatch(/background: var\(--surface-2\);/);
    let composed = 0;
    for (const f of files(join(SRC, 'components'), /\.module\.css$/)) {
      for (const m of code(readFileSync(f, 'utf8')).matchAll(/\.tooltip(?:Head|Row)?\s*\{([^}]*)\}/g)) {
        if (!m[1].includes('composes:')) continue;
        composed++;
        expect(m[1], `SURFACES ${rel(f)} composes without a background`).not.toMatch(/background/);
      }
    }
    expect(composed, 'SURFACES premise: the faces that compose it (Decision, Strategy, FIRE, the Power Law chart)').toBeGreaterThanOrEqual(12);
  });
});

describe('⭐ ONE PAGE — "Display" and "Tabs" are one Customization page; the colours are the owner\'s', () => {
  const main = code(read('components/Settings/SettingsMain.tsx'));
  it('⭐ ONE PAGE — one row, one page key; no Display or Tabs page left; a viewer never reaches it', () => {
    expect(main, 'ONE PAGE no display page').not.toMatch(/'display'/);
    expect(main, 'ONE PAGE no tabs page').not.toMatch(/settingsPage === 'tabs'|setSettingsPage\('tabs'\)/);
    expect(main.match(/title="Customization"/g)?.length, 'ONE PAGE one row').toBe(1);
    expect(main, 'ONE PAGE the row').toMatch(/title="Customization" subtitle="Display, venue colors, tabs"/);
    const viewerReturn = main.search(/if \(viewerMode\) \{\s*return \([\s\S]*?<ViewerSettings \/>/);
    expect(viewerReturn, 'ONE PAGE a viewer gets ViewerSettings, returned before the menu').toBeGreaterThan(-1);
    expect(viewerReturn, 'ONE PAGE … so no viewer reaches the row').toBeLessThan(main.indexOf('title="Customization"'));
  });
  it('⭐ ONE PAGE — Monthly Mode first, then the display groups, the colours and the tabs, in that order', () => {
    const blocks = [...main.matchAll(/\{settingsPage === 'customize'( && !viewerMode)? && \(/g)];
    expect(blocks.map((b) => b[1] !== undefined), 'ONE PAGE the three blocks: Monthly Mode\'s, then two that keep their own !viewerMode guard').toEqual([false, true, true]);
    const at = (s: string) => main.indexOf(s);
    const mm = at('<span className={styles.simpleModeTitle}>Monthly Mode</span>');
    expect(mm, 'ONE PAGE Monthly Mode in the first block').toBeGreaterThan(blocks[0].index ?? Infinity);
    expect(mm, 'ONE PAGE … before the owner\'s').toBeLessThan(blocks[1].index ?? -1);
    const colours = at('<VenueColorsGroup styles={styles} />');
    expect(main.split('<VenueColorsGroup').length - 1, 'ONE PAGE the colours once').toBe(1);
    expect(colours, 'ONE PAGE the colours in the owner display block').toBeGreaterThan(at('Live block height'));
    expect(colours, 'ONE PAGE … before the tabs').toBeLessThan(at('TAB VISIBILITY & ORDER'));
    expect(at('TAB VISIBILITY & ORDER'), 'ONE PAGE the tabs in the last owner block').toBeGreaterThan(blocks[2].index ?? Infinity);
  });
});

describe('⭐ SINK — once, at the top of AppShell, before paint', () => {
  it('⭐ SINK — AppShell\'s first statement; a layout effect over the cleaned value', () => {
    const shell = code(read('components/Layout/AppShell.tsx'));
    expect(shell, 'SINK first in AppShell, on its own line').toMatch(/export function AppShell\(\) \{\n\s*useVenueColors\(\);/);
    expect(shell.match(/useVenueColors\(\)/g)?.length, 'SINK once').toBe(1);
    const hook = code(read('hooks/useVenueColors.ts'));
    expect(hook, 'SINK before paint').toMatch(/useLayoutEffect\(\(\) => \{\s*applyVenueColors\(document\.documentElement\.style, venueColors\);\s*\}, \[venueColors\]\);/);
  });
});

describe('⭐ PICKER — THE rule before every write; the swatches are the only choices', () => {
  it('⭐ PICKER — pick() checks, then writes; each venue\'s row is its default and the six swatches, no colour input', () => {
    const g = code(read('components/Settings/VenueColorsGroup.tsx'));
    const pick = g.slice(g.indexOf('const pick: PickFn'), g.indexOf('return (', g.indexOf('const pick: PickFn')));
    expect(pick.indexOf('checkVenueColor('), 'PICKER checks').toBeGreaterThan(-1);
    expect(pick.indexOf('setVenueColor('), 'PICKER writes after the check').toBeGreaterThan(pick.indexOf('checkVenueColor('));
    expect(g, 'PICKER the row').toMatch(/\[DEFAULT_VENUE_COLORS\[venue\], \.\.\.VENUE_SWATCHES\]\.map\(/);
    expect(g, 'PICKER no colour input').not.toMatch(/type="color"|<input/);
  });
});
