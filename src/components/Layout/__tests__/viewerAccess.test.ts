import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { viewerTier, almanacOpensFor, type ViewerAccessState } from '../viewerAccess';

/**
 * ⚠ BL48 — trusted viewers in the Almanac (BL40's second piece; spec `pbloc-spec-trusted-viewers-v1`). The tier is pure,
 * so every state is tested here; AppShell's and the viewer home's wiring have no render harness, so they are read off
 * the source, and e2e/viewerAlmanac.spec.ts pins on screen what a trusted, a safe and a demoted viewer get. Each
 * assertion carries the tag its planted bug turns red.
 */
const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
/** Code with its comments removed — block, JSX and line comments (a `//` after a `:` is a URL, kept). */
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const SAFE_BLOCK = { safety: {}, thresholds: {}, btcPriceAtSnapshot: 1, hasCbLoan: false } as unknown as NonNullable<ViewerAccessState['viewerSafeSnapshot']>;
/** Every state the rule reads: a viewer or not, a snapshot applied or not, a safe block or none — eight. */
const STATES: ViewerAccessState[] = [false, true].flatMap((viewerMode) => [false, true].flatMap((viewerDataLoaded) =>
  [null, SAFE_BLOCK].map((viewerSafeSnapshot) => ({ viewerMode, viewerDataLoaded, viewerSafeSnapshot }))));
const label = (s: ViewerAccessState): string =>
  `viewer ${s.viewerMode} · loaded ${s.viewerDataLoaded} · safe block ${s.viewerSafeSnapshot !== null}`;

describe('⭐ the tier', () => {
  it('⭐ TIER — by the last snapshot applied: trusted without a safe block, safe with one; none for the owner or before the first', () => {
    for (const s of STATES) {
      const want = !s.viewerMode || !s.viewerDataLoaded ? null : s.viewerSafeSnapshot === null ? 'trusted' : 'safe';
      expect(viewerTier(s), `TIER ${label(s)}`).toBe(want);
    }
  });

  it('⭐ OPENS — the Almanac opens for the owner and a trusted viewer; never a safe viewer, nor one still waiting', () => {
    let owner = 0; let trusted = 0; let closed = 0;
    for (const s of STATES) {
      const want = !s.viewerMode || (s.viewerDataLoaded && s.viewerSafeSnapshot === null);
      expect(almanacOpensFor(s), `OPENS ${label(s)}`).toBe(want);
      if (!s.viewerMode) owner++; else if (want) trusted++; else closed++;
    }
    expect([owner, trusted, closed], 'OPENS every case reached (non-vacuous)').toEqual([4, 1, 3]);
  });
});

describe('⭐ the wiring (read off AppShell)', () => {
  const SHELL = strip(read('src/components/Layout/AppShell.tsx'));

  it('⭐ ONE READ — AppShell asks viewerAccess, once each, from the three fields', () => {
    expect(SHELL, 'ONE READ the import').toContain("import { almanacOpensFor, viewerTier } from './viewerAccess';");
    expect(SHELL, 'ONE READ the safe block').toContain('const viewerSafeSnapshot = useStore((s) => s.viewerSafeSnapshot);');
    expect(SHELL, 'ONE READ trusted').toContain(
      "const viewerTrusted = viewerTier({ viewerMode, viewerDataLoaded, viewerSafeSnapshot }) === 'trusted';");
    expect(SHELL, 'ONE READ opens').toContain('const almanacOpen   = almanacOpensFor({ viewerMode, viewerDataLoaded, viewerSafeSnapshot });');
  });

  it('⭐ HOME — a viewer\'s home takes the Almanac tab unless it opens for him; its "Almanac" only for a trusted viewer, the under-layer\'s too', () => {
    expect(SHELL, 'HOME the branch').toContain(
      "viewerMode && viewerDataLoaded && activeTab !== 'settings' && !(activeTab === 'almanac' && almanacOpen) ? (");
    expect(SHELL.match(/onOpenAlmanac=\{viewerTrusted \? goAlmanac : undefined\}/g), 'HOME the way in, trusted only — home and under-layer')
      .toHaveLength(2);
    // Three mounts of the home: the owner's Dashboard (its own nav — no bar, no way in of the viewer's), the viewer's
    // branch and the under-layer — and the way in on those two only, trusted only.
    expect(SHELL.match(/<ViewerHomeView\b/g), 'HOME premise: three mounts').toHaveLength(3);
    // The owner's journal keeps its own way in (Daily, THIS MONTH) — inside renderOwnerJournal, which a viewer never gets.
    const ungated = SHELL.split('\n').filter((l) => l.includes('onOpenAlmanac={goAlmanac}')).map((l) => l.trim().split(' ')[0]);
    expect(ungated, 'HOME the plain way in is the owner journal\'s alone').toEqual(['<DailyModeView', '<SimpleModeView']);
    expect(SHELL.match(/ownerNav=\{/g), 'HOME the Dashboard\'s own nav, once').toHaveLength(1);
    expect(SHELL, 'HOME the under-layer is the home').toMatch(
      /const renderSimpleUnder = \(\) =>\s*viewerMode\s*\? <ViewerHomeView onOpenSettings=\{goSettings\} onOpenAlmanac=\{viewerTrusted \? goAlmanac : undefined\} \/>/);
  });

  it('⭐ PAGES — a viewer\'s Settings and Almanac are simple mode\'s pages whatever the owner\'s layout; the Almanac only where it opens', () => {
    expect(SHELL, 'PAGES Settings').toContain("(simpleMode || viewerMode) && activeTab === 'settings' ? (");
    expect(SHELL, 'PAGES the Almanac').toContain("(simpleMode || viewerMode) && activeTab === 'almanac' && almanacOpen ? (");
    const shell = SHELL.indexOf('<div className={styles.shell} data-active-tab={activeTab}>');
    const pages = SHELL.indexOf("(simpleMode || viewerMode) && activeTab === 'almanac' && almanacOpen ? (");
    expect(pages > 0 && shell > pages, 'PAGES before the full-mode shell').toBe(true);
  });

  it('⭐ PUT BACK — a viewer the Almanac doesn\'t open for is taken off it, and off a way back that names it', () => {
    expect(SHELL, 'PUT BACK the effect').toMatch(
      /useEffect\(\(\) => \{\s*if \(almanacOpen\) return;\s*if \(activeTab === 'almanac'\) setActiveTab\('living'\);\s*if \(previousTab === 'almanac'\) setPreviousTab\('living'\);\s*\}, \[almanacOpen, activeTab, previousTab, setActiveTab, setPreviousTab\]\);/);
  });
});

describe('⭐ the home bar (ViewerHomeView)', () => {
  const HOME = strip(read('src/components/Viewer/ViewerHomeView.tsx'));

  it('⭐ BAR — Home · Almanac · Settings: the middle one only when handed its way in; the owner\'s Dashboard and the preview have no bar', () => {
    expect(HOME, 'BAR the prop').toContain('onOpenAlmanac?: () => void;');
    expect(HOME, 'BAR in order').toMatch(
      /aria-current="page">\s*Home\s*<\/button>\s*\{onOpenAlmanac && \(\s*<button className=\{styles\.navBtn\} onClick=\{onOpenAlmanac\}>\s*Almanac\s*<\/button>\s*\)\}\s*<button className=\{styles\.navBtn\} onClick=\{onOpenSettings\}>\s*Settings/);
    expect(HOME, 'BAR the bar\'s own gate, unchanged').toContain('{!preview && !ownerNav && (');
  });
});
