import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { backPlace, almanacExit, type BackState } from '../backPlace';

/**
 * ⚠ BL47 — the simple-mode header's way out says where it goes (spec `pbloc-spec-back-label-v1`). The rule is pure, so
 * every state is tested here; AppShell's wiring has no render harness, so it is read off the source, and
 * e2e/backPlace.spec.ts pins what the button says and opens on screen. Each assertion carries the tag its planted bug
 * turns red.
 */
const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
/** Code with its comments removed — block, JSX and line comments (a `//` after a `:` is a URL, kept). */
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** Every tab `previousTab` can hold — the store's ActiveTab, less 'settings'. */
const TABS = ['living', 'bloc', 'powerlaw', 'converter', 'mining', 'coinbase', 'advisor', 'liqsim', 'almanac'] as const;
/** The tabs that open the journal (or a viewer's home) in simple mode: all but the Almanac. */
const OUT = TABS.filter((t) => t !== 'almanac');
const VIEWS = ['dashboard', 'daily', 'monthly'] as const;
/** Every state the rule reads: a viewer or not, previewing or not, each journal view — twelve. */
const STATES: BackState[] = [false, true].flatMap((viewerMode) => [false, true].flatMap((viewerPreview) =>
  VIEWS.map((simpleView) => ({ viewerMode, viewerPreview, simpleView }))));
const owner = (simpleView: BackState['simpleView']): BackState => ({ viewerMode: false, viewerPreview: false, simpleView });

describe('⭐ the name', () => {
  it('⭐ NAMES — the owner\'s journal by its view: the Dashboard, or the Journal on Daily or Monthly (THIS MONTH)', () => {
    expect(backPlace('living', owner('dashboard')), 'NAMES the Dashboard').toBe('Dashboard');
    expect(backPlace('living', owner('daily')), 'NAMES Daily is the Journal').toBe('Journal');
    expect(backPlace('living', owner('monthly')), 'NAMES THIS MONTH is the Journal').toBe('Journal');
    for (const t of OUT) for (const v of VIEWS) {
      expect(backPlace(t, owner(v)), `NAMES ${t} opens the journal · ${v}`).toBe(v === 'dashboard' ? 'Dashboard' : 'Journal');
    }
  });

  it('⭐ VIEWER — a viewer goes home ("Home", its bottom bar\'s word), whatever the view or the preview flag', () => {
    for (const t of OUT) for (const s of STATES.filter((x) => x.viewerMode)) {
      expect(backPlace(t, s), `VIEWER ${t} · ${s.simpleView} · preview ${s.viewerPreview}`).toBe('Home');
    }
  });

  it('⭐ PREVIEW — the owner previewing as a viewer goes to the preview, whatever the view', () => {
    for (const t of OUT) for (const v of VIEWS) {
      expect(backPlace(t, { viewerMode: false, viewerPreview: true, simpleView: v }), `PREVIEW ${t} · ${v}`).toBe('Preview');
    }
  });

  it('⭐ ALMANAC — a Settings trip begun in the Almanac goes back to it, for anyone', () => {
    for (const s of STATES) {
      expect(backPlace('almanac', s), `ALMANAC viewer ${s.viewerMode} · preview ${s.viewerPreview} · ${s.simpleView}`).toBe('Almanac');
    }
  });
});

describe('⭐ the Almanac\'s way out', () => {
  it('⭐ EXIT — never the Almanac itself: from it, the app\'s first tab; every other tab as it is', () => {
    expect(almanacExit('almanac'), 'EXIT the first tab').toBe('living');
    for (const t of OUT) expect(almanacExit(t), `EXIT ${t} kept`).toBe(t);
    for (const t of TABS) for (const s of STATES) {
      expect(backPlace(almanacExit(t), s), `EXIT never names the Almanac · ${t}`).not.toBe('Almanac');
    }
  });
});

describe('⭐ the wiring (read off AppShell)', () => {
  const SHELL = strip(read('src/components/Layout/AppShell.tsx'));

  it('⭐ WIRED — Settings\' and the Almanac\'s "←" say the rule\'s name; no bare "← Back" is left', () => {
    expect(SHELL, 'WIRED the state').toContain('const backState  = { viewerMode, viewerPreview, simpleView };');
    expect(SHELL, 'WIRED Settings').toMatch(
      /onClick=\{\(\) => setActiveTab\(previousTab\)\}\s*>\s*\{`← \$\{backPlace\(previousTab, backState\)\}`\}\s*<\/button>\s*<span className=\{styles\.simpleModeSettingsTitle\}>Settings<\/span>/);
    expect(SHELL, 'WIRED the Almanac').toMatch(
      /<button className=\{styles\.simpleModeBackBtn\} onClick=\{\(\) => setActiveTab\(almanacOut\)\}>\s*\{`← \$\{backPlace\(almanacOut, backState\)\}`\}\s*<\/button>/);
    expect(SHELL.match(/className=\{styles\.simpleModeBackBtn\}/g), 'WIRED two headers, no third').toHaveLength(2);
    expect(SHELL, 'WIRED no bare Back').not.toMatch(/>\s*← Back\s*</);
  });

  it('⭐ EXIT WIRED — the Almanac\'s button and its swipe from the grid leave by almanacExit; Settings\' swipe keeps previousTab', () => {
    expect(SHELL, 'EXIT WIRED the way out').toContain('const almanacOut = almanacExit(previousTab);');
    expect(SHELL, 'EXIT WIRED the swipe').toContain(
      'const almanacEdgeBack = () => { const b = almanacBackRef.current; if (b) b(); else setActiveTab(almanacOut); };');
    expect(SHELL, 'EXIT WIRED Settings\' swipe — the Almanac is a place it returns to').toContain(
      'const settingsEdgeBack = () => { const b = settingsBackRef.current; if (b) b(); else setActiveTab(previousTab); };');
  });

  it('⭐ ORDER — the branches the rule mirrors are AppShell\'s: the viewer\'s home, then the Almanac, then the journal', () => {
    // BL48 — the viewer's home takes the Almanac tab unless the Almanac opens for him; Settings and the Almanac are simple
    // mode's pages for any viewer, whatever the owner's layout (viewerAccess.test.ts pins the rest).
    const home = SHELL.indexOf("viewerMode && viewerDataLoaded && activeTab !== 'settings' && !(activeTab === 'almanac' && almanacOpen) ? (");
    const settings = SHELL.indexOf("(simpleMode || viewerMode) && activeTab === 'settings' ? (");
    const almanac = SHELL.indexOf("(simpleMode || viewerMode) && activeTab === 'almanac' && almanacOpen ? (");
    const journal = SHELL.indexOf("simpleMode && activeTab !== 'settings' ? (");
    expect([home, settings, almanac, journal].every((i) => i > 0), 'ORDER every branch found').toBe(true);
    expect(home < settings && settings < almanac && almanac < journal, 'ORDER home, Settings, the Almanac, the journal').toBe(true);
    expect(SHELL, 'ORDER the preview inside the journal').toContain('{viewerPreview && !viewerMode ? <ViewerPreview /> : renderOwnerJournal()}');
    expect(SHELL, 'ORDER the journal by its view').toMatch(/const renderOwnerJournal = \(\) =>\s*simpleView === 'dashboard' \? \(/);
  });

  it('⭐ GUARD — the hidden-tab guard is the owner\'s full mode\'s: simple mode and a viewer redirect no tab, so every name holds', () => {
    // With the five journal tabs hidden and no loan, a redirect in simple mode opened the Almanac with no way out, and
    // "← Journal" named a journal it couldn't reach (Claude Code's F1). Full mode keeps the guard; a switch of mode re-runs it.
    // BL48: never a viewer's — the owner's synced hidden tabs bounced a trusted viewer's Almanac to his home.
    expect(SHELL, 'GUARD full mode only, never a viewer').toMatch(/useEffect\(\(\) => \{\s*if \(simpleMode \|\| viewerMode \|\| activeTab === 'settings'\) return;/);
    expect(SHELL, 'GUARD re-runs on a switch of mode').toContain('}, [hiddenTabs, activeTab, hasCbLoan, simpleMode, viewerMode]);');
  });
});
