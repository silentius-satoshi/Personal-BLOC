import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { viewerTier, almanacOpensFor, previewTier, type ViewerAccessState } from '../viewerAccess';

/**
 * ⚠ BL48 — trusted viewers in the Almanac (BL40's second piece; spec `pbloc-spec-trusted-viewers-v1`). The tier is pure,
 * so every state is tested here; AppShell's and the viewer home's wiring have no render harness, so they are read off
 * the source, and e2e/viewerAlmanac.spec.ts pins on screen what a trusted, a safe and a demoted viewer get. BL50 — the
 * owner's preview of his viewer (spec `pbloc-spec-preview-bar-v1`): the tier he previews is pure, tested here too; its
 * wiring is read off AppShell and ViewerPreview; the e2e pins the preview's bar, and its hub against a real trusted
 * viewer's. Each assertion carries the tag its planted bug turns red.
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
    expect(SHELL, 'ONE READ the import').toContain("import { almanacOpensFor, viewerTier, previewTier } from './viewerAccess';");
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
    // BL50 — and his preview's: AppShell hands it to ViewerPreview, which passes it on for a trusted preview only (BAR).
    const ungated = SHELL.split('\n').filter((l) => l.includes('onOpenAlmanac={goAlmanac}')).map((l) => l.trim().split(' ')[0]);
    expect(ungated, 'HOME the plain way in is the owner journal\'s and his preview\'s').toEqual(['<DailyModeView', '<SimpleModeView', 'onOpenAlmanac={goAlmanac}']);
    expect(SHELL, 'HOME the preview\'s, in renderPreview').toMatch(
      /const renderPreview = \(\) => \(\s*<ViewerPreview trusted=\{previewActualTrusted\} override=\{previewOverride\} setOverride=\{setPreviewOverride\}\s*onOpenAlmanac=\{goAlmanac\} \/>/);
    expect(SHELL.match(/ownerNav=\{/g), 'HOME the Dashboard\'s own nav, once').toHaveLength(1);
    expect(SHELL, 'HOME the under-layer is the home').toMatch(
      /const renderSimpleUnder = \(\) =>\s*viewerMode\s*\? <ViewerHomeView onOpenSettings=\{goSettings\} onOpenAlmanac=\{viewerTrusted \? goAlmanac : undefined\} \/>/);
    expect(SHELL, 'HOME the owner\'s under-layer: his preview while it lasts (BL50), else his journal').toMatch(
      /onOpenAlmanac=\{viewerTrusted \? goAlmanac : undefined\} \/>\s*: previewing \? renderPreview\(\) : renderOwnerJournal\(\);/);
  });

  it('⭐ PAGES — a viewer\'s Settings and Almanac are simple mode\'s pages whatever the owner\'s layout; the Almanac only where it opens', () => {
    expect(SHELL, 'PAGES Settings').toContain("(simpleMode || viewerMode) && activeTab === 'settings' ? (");
    expect(SHELL, 'PAGES the Almanac').toContain("(simpleMode || viewerMode) && activeTab === 'almanac' && almanacOpen && previewing !== 'safe' ? (");
    const shell = SHELL.indexOf('<div className={styles.shell} data-active-tab={activeTab}>');
    const pages = SHELL.indexOf("(simpleMode || viewerMode) && activeTab === 'almanac' && almanacOpen && previewing !== 'safe' ? (");
    expect(pages > 0 && shell > pages, 'PAGES before the full-mode shell').toBe(true);
  });

  it('⭐ PUT BACK — a viewer the Almanac doesn\'t open for is taken off it, and off a way back that names it', () => {
    expect(SHELL, 'PUT BACK the effect').toMatch(
      /useEffect\(\(\) => \{\s*if \(almanacOpen\) return;\s*if \(activeTab === 'almanac'\) setActiveTab\('living'\);\s*if \(previousTab === 'almanac'\) setPreviousTab\('living'\);\s*\}, \[almanacOpen, activeTab, previousTab, setActiveTab, setPreviousTab\]\);/);
  });
});

describe('⭐ the preview (BL50)', () => {
  const SHELL = strip(read('src/components/Layout/AppShell.tsx'));

  it('⭐ PREVIEW TIER — the tier the owner previews: none unless he previews where it is drawn (simple mode), never on a viewer\'s device; trusted or safe by his choice', () => {
    const reached = { none: 0, trusted: 0, safe: 0 };
    for (const viewerMode of [false, true]) for (const viewerPreview of [false, true]) for (const simpleMode of [false, true]) {
      for (const previewTrusted of [false, true]) {
        const want = viewerMode || !viewerPreview || !simpleMode ? null : previewTrusted ? 'trusted' : 'safe';
        expect(previewTier({ viewerMode, viewerPreview, simpleMode, previewTrusted }),
          `PREVIEW TIER viewer ${viewerMode} · preview ${viewerPreview} · simple ${simpleMode} · trusted ${previewTrusted}`).toBe(want);
        reached[want ?? 'none']++;
      }
    }
    expect(reached, 'PREVIEW TIER every case reached (non-vacuous)').toEqual({ none: 14, trusted: 1, safe: 1 });
    // The case the rule was written for: full mode with the flag set (Sharing's button) — nothing drawn, nothing on.
    expect(previewTier({ viewerMode: false, viewerPreview: true, simpleMode: false, previewTrusted: false }), 'PREVIEW TIER full mode: none').toBeNull();
  });

  it('⭐ PREVIEW WIRING — AppShell: the choice outlives a visit to the Almanac and ends with the preview; a safe preview never opens the Almanac; the lens around the hub alone; the label over it', () => {
    expect(SHELL, 'PREVIEW WIRING the roster, read once').toContain(
      "const previewActualTrusted = useStore((s) => s.viewers[0]?.tier === 'trusted');");
    expect(SHELL, 'PREVIEW WIRING the choice, kept here').toContain('const [previewOverride, setPreviewOverride] = useState<boolean | null>(null);');
    expect(SHELL, 'PREVIEW WIRING the tier: his choice, else the roster\'s — as the preview draws it').toContain(
      'const previewTrusted = previewOverride ?? previewActualTrusted;');
    expect(SHELL, 'PREVIEW WIRING the tier').toContain('const previewing = previewTier({ viewerMode, viewerPreview, simpleMode, previewTrusted });');
    expect(SHELL, 'PREVIEW WIRING the choice ends with the preview').toContain(
      'useEffect(() => { if (!viewerPreview) setPreviewOverride(null); }, [viewerPreview]);');
    expect(SHELL, 'PREVIEW WIRING a safe preview leaves the Almanac, and a way back that names it').toMatch(
      /useEffect\(\(\) => \{\s*if \(previewing !== 'safe'\) return;\s*if \(activeTab === 'almanac'\) setActiveTab\(almanacExit\(previousTab\)\);\s*if \(previousTab === 'almanac'\) setPreviousTab\('living'\);\s*\}, \[previewing, activeTab, previousTab, setActiveTab, setPreviousTab\]\);/);
    expect(SHELL.match(/<PreviewAsViewer\.Provider value=\{previewing === 'trusted'\}>\s*<AlmanacView /g), 'PREVIEW WIRING the lens around the hub').toHaveLength(1);
    expect(SHELL.match(/PreviewAsViewer\.Provider/g), 'PREVIEW WIRING no other lens — the full-mode hub is the owner\'s own').toHaveLength(2);
    expect(SHELL.match(/<AlmanacView /g), 'PREVIEW WIRING premise: two hubs, simple mode\'s and full mode\'s').toHaveLength(2);
    // One provider, AppShell's: the lens is named where it is made and where AppShell provides it, nowhere else, and its
    // module exports the context and the hook alone — no alias to wrap another page in (the independent check's plant:
    // an alias around full mode's page hid his own FIRE).
    const namers = (readdirSync(join(ROOT, 'src'), { recursive: true }) as string[]).map((f) => f.split('\\').join('/'))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__/') && /\bPreviewAsViewer\b/.test(strip(read(`src/${f}`)))).sort();
    expect(namers, 'PREVIEW WIRING the lens named in two files').toEqual(['components/Almanac/seenAsViewer.ts', 'components/Layout/AppShell.tsx']);
    expect(strip(read('src/components/Almanac/seenAsViewer.ts')).match(/^export /gm), 'PREVIEW WIRING the lens module exports two').toHaveLength(2);
    expect(SHELL, 'PREVIEW WIRING the label over the Almanac').toContain("{previewing === 'trusted' && <PreviewLabel trusted />}");
    const css = read('src/components/Viewer/ViewerPreview.module.css');
    expect(css, 'PREVIEW WIRING the label stays on screen (the independent check)').toMatch(
      /\.previewLabelBar \{\s*position: sticky;\s*top: 0;\s*z-index: 20;/);
  });
});

describe('⭐ the home bar (ViewerHomeView)', () => {
  const HOME = strip(read('src/components/Viewer/ViewerHomeView.tsx'));

  it('⭐ BAR — Home · Almanac · Settings: the middle one only when handed its way in; the owner\'s Dashboard has none; the preview draws it, its Settings and ⚙ inert (BL50)', () => {
    expect(HOME, 'BAR the prop').toContain('onOpenAlmanac?: () => void;');
    expect(HOME, 'BAR in order').toMatch(
      /aria-current="page">\s*Home\s*<\/button>\s*\{onOpenAlmanac && \(\s*<button className=\{styles\.navBtn\} onClick=\{onOpenAlmanac\}>\s*Almanac\s*<\/button>\s*\)\}\s*<button className=\{styles\.navBtn\} onClick=\{onOpenSettings\} disabled=\{preview\}>\s*Settings/);
    expect(HOME, 'BAR the bar\'s own gate: never the Dashboard\'s (BL50 — the preview\'s too)').toContain('{!ownerNav && (');
    expect(HOME, 'BAR the ⚙, drawn in the preview too, inert there').toMatch(
      /ownerNav \? \(\s*ownerNav\s*\) : \(\s*<button className=\{styles\.iconBtn\} onClick=\{onOpenSettings\} disabled=\{preview\} aria-label="Settings">/);
    const css = read('src/components/Viewer/ViewerHomeView.module.css');
    expect(css, 'BAR inert, and looks it').toContain('.iconBtn:disabled, .navBtn:disabled { opacity: 0.45; cursor: default; }');
    // The preview hands the way in for a trusted preview alone — its "Almanac" opens the hub as he reads it.
    const PREVIEW = strip(read('src/components/Viewer/ViewerPreview.tsx'));
    expect(PREVIEW, 'BAR the preview\'s way in, trusted only').toMatch(
      /<ViewerHomeView previewSafeSnap=\{previewSnap\} preview onOpenSettings=\{noop\}\s*onOpenAlmanac=\{effectiveTrusted \? onOpenAlmanac : undefined\} \/>/);
    expect(PREVIEW, 'BAR the preview reads no roster of its own (AppShell\'s one read)').not.toMatch(/\bviewers\b/);
  });
});
