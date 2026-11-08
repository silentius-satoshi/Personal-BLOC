import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALMANAC_LIST, FACE_TILES, FACE_GROUPS, VIEWER_WHAT_IF_NOTE, faceShown, firstListFace, gridGroups, viewerWhatIfNoteShown,
  type Face, type FaceGates,
} from '../almanacGrid';

/**
 * ⚠ The Almanac's grid (BL40, BL45 — the owner's pick B), and on a computer its list (BL46's A). The rule is pure, so every
 * gate combination is tested here; the hub's wiring has no render harness, so it is read off the source, and
 * e2e/almanacGrid.spec.ts and e2e/almanacList.spec.ts pin what the grid and the list do on screen. Each assertion carries
 * the tag its planted bug turns red.
 */
const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
/** Code with its comments removed — block, JSX and line comments (a `//` after a `:` is a URL, kept). */
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const ALL: Face[] = ['halving', 'cycle', 'mining', 'powerlaw', 'sats', 'defense', 'ledger', 'scenario', 'cycling', 'ownership', 'unified', 'decision', 'fire'];
/** All eight gate combinations — the owner's four and a viewer's (BL48). The FIRE face's deploy gate is gone with its
 *  borrow lane (BL57 B4): it shows on every deploy. */
const COMBOS: FaceGates[] = [false, true].flatMap((hasCbLoan) => [false, true].flatMap((ledgerAvailable) =>
  [false, true].map((viewer) => ({ hasCbLoan, ledgerAvailable, viewer }))));
const label = (g: FaceGates): string => `loan ${g.hasCbLoan} · ledger ${g.ledgerAvailable} · viewer ${g.viewer}`;

/**
 * The pill row's rule as it stood at `0cc0ecd` (AlmanacView's `visibleFaces`), kept here as the reference: the grid
 * shows exactly the faces the pills showed (BL45's kill criterion — a face no viewer could reach before is no nearer).
 * FIRE as the pills showed it on the owner's deploy — every deploy is that one for it now (BL57 B4).
 */
function pillRow(g: FaceGates): Face[] {
  return [
    'halving', 'cycle', 'mining', 'powerlaw', 'sats',
    ...(g.hasCbLoan ? ['defense' as Face] : []),
    ...(g.ledgerAvailable ? ['ledger' as Face] : []),
    'scenario',
    ...(g.hasCbLoan ? ['cycling' as Face] : []),
    'ownership',
    ...(g.hasCbLoan ? ['unified' as Face] : []),
    'decision',
    'fire',
  ];
}

describe('⭐ the catalogue', () => {
  it('⭐ CATALOGUE — every face once, named as on its tile, in its group', () => {
    expect(FACE_TILES.map((t) => t.key).sort(), 'CATALOGUE every face once').toEqual([...ALL].sort());
    expect(Object.fromEntries(FACE_TILES.map((t) => [t.key, t.name])), 'CATALOGUE the names').toEqual({
      decision: 'Decision', unified: 'Strategy', ownership: 'Ownership', cycling: 'Cycling', ledger: 'Ledger',
      scenario: 'Scenario', defense: 'Emergency', fire: 'FIRE', halving: 'Halving Clock', cycle: 'Cycle Clock',
      powerlaw: 'Power Law', mining: 'Mining', sats: 'Sats',
    });
    expect(FACE_GROUPS, 'CATALOGUE the groups, in order').toEqual([
      { group: 'plan', label: 'Your plan' }, { group: 'bitcoin', label: 'Bitcoin' },
    ]);
  });

  it('⭐ ORDER — your plan\'s faces, then bitcoin\'s, as the owner picked them (B)', () => {
    const all = gridGroups({ hasCbLoan: true, ledgerAvailable: true, viewer: false });
    expect(all.map((g) => g.label), 'ORDER the groups').toEqual(['Your plan', 'Bitcoin']);
    expect(all[0].tiles.map((t) => t.name), 'ORDER your plan').toEqual(
      ['Decision', 'Strategy', 'Ownership', 'Cycling', 'Ledger', 'Scenario', 'Emergency', 'FIRE']);
    expect(all[1].tiles.map((t) => t.name), 'ORDER bitcoin').toEqual(['Halving Clock', 'Cycle Clock', 'Power Law', 'Mining', 'Sats']);
  });
});

describe('⭐ the gates', () => {
  it('⭐ GATES — the loan, the Ledger\'s data and a viewer\'s device, each on its own faces, in all eight combinations', () => {
    for (const g of COMBOS) {
      const want: Record<Face, boolean> = {
        decision: true, ownership: true, scenario: true, halving: true, cycle: true, powerlaw: true, mining: true, sats: true,
        unified: g.hasCbLoan, cycling: g.hasCbLoan, defense: g.hasCbLoan, ledger: g.ledgerAvailable,
        fire: !g.viewer,   // BL48 (V1) — the owner's only: a viewer has no FIRE face; on every deploy for the owner (BL57 B4)
      };
      for (const f of ALL) expect(faceShown(f, g), `GATES ${f} · ${label(g)}`).toBe(want[f]);
      const shown = gridGroups(g).flatMap((grp) => grp.tiles.map((t) => t.key));
      expect(shown.sort(), `GATES the grid shows what faceShown does · ${label(g)}`).toEqual(ALL.filter((f) => want[f]).sort());
    }
  });

  it('⭐ PILLS — the owner\'s grid offers exactly the faces the pill row did, in every combination (BL45); a viewer\'s, those less FIRE (BL48)', () => {
    for (const g of COMBOS) {
      const grid = gridGroups(g).flatMap((grp) => grp.tiles.map((t) => t.key));
      const want = g.viewer ? pillRow(g).filter((f) => f !== 'fire') : pillRow(g);
      expect([...grid].sort(), `PILLS ${label(g)}`).toEqual(want.sort());
      expect(new Set(grid).size, `PILLS no tile twice · ${label(g)}`).toBe(grid.length);
    }
  });

  it('⭐ GROUPS — neither group is ever empty (no heading over nothing)', () => {
    for (const g of COMBOS) expect(gridGroups(g).map((grp) => grp.group), `GROUPS ${label(g)}`).toEqual(['plan', 'bitcoin']);
  });
});

describe('⭐ the hub', () => {
  const HUB = strip(read('src/components/Almanac/AlmanacView.tsx'));
  const SHELL = read('src/components/Layout/AppShell.tsx');
  const ICONS = read('src/components/Almanac/FaceIcon.tsx');

  it('⭐ GRID — the hub opens on the grid; the link\'s face opens directly, from outside', () => {
    expect(HUB, 'GRID the default').toMatch(/const \[face, setFace\] = useState<Face \| null>\(initialFace \?\? null\);/);
    expect(HUB, 'GRID the link, from outside').toMatch(/const \[fromOutside, setFromOutside\] = useState\(initialFace !== undefined\);/);
    expect(HUB, 'GRID no face mounts on the grid').toMatch(
      /\) : \(\s*<div className=\{listMode \? styles\.pane : styles\.contents\}>\s*\{viewerWhatIfNoteShown\(shown, seenAsViewer\) && <p className=\{styles\.viewerNote\} role="note">\{VIEWER_WHAT_IF_NOTE\}<\/p>\}\s*<ViewerWhatIf\.Provider value=\{true\}>\{renderFace\(shown\)\}<\/ViewerWhatIf\.Provider>\s*<\/div>\s*\)\}/);
    expect(HUB, 'GRID the grid or a face').toMatch(
      /\{shown === null \? \(\s*<div className=\{styles\.container\}>\s*(?:\{\}\s*)?<nav className=\{styles\.grid\} aria-label="Faces">/);
    expect(HUB, 'GRID the face on screen: the face open, or the list\'s').toContain('const shown: Face | null = face ?? listFace;');
  });

  it('⭐ ONE RULE — the hub reads its three gates once and asks almanacGrid; no gate of its own', () => {
    // BL50 — the viewer gate is the lens: a viewer's device, or the owner's trusted preview (seenAsViewer.ts).
    expect(HUB, 'ONE RULE the grid').toContain(
      'const groups = gridGroups({ hasCbLoan, ledgerAvailable, viewer: seenAsViewer });');
    expect(HUB, 'ONE RULE the fallback').toMatch(
      /useEffect\(\(\) => \{\s*if \(face !== null && !faceShown\(face, \{ hasCbLoan, ledgerAvailable, viewer: seenAsViewer \}\)\) setFace\(null\);\s*\}, \[face, hasCbLoan, ledgerAvailable, seenAsViewer\]\);/);
    expect(HUB, 'ONE RULE no pill list').not.toMatch(/visibleFaces|subnav/);
    expect(HUB, 'ONE RULE no gate spread of its own').not.toMatch(/hasCbLoan \?|ledgerAvailable \?/);
    expect(HUB, 'ONE RULE no face falls back to a face').not.toMatch(/setFace\('halving'\)/);
  });

  it('⭐ BACK — a face reports its way to the grid; the grid, the link\'s face and the list report none', () => {
    expect(HUB, 'BACK every way in from inside').toContain('const openFace = (f: Face) => { setFace(f); setFromOutside(false); };');
    expect(HUB, 'BACK to the grid, ringing the face left').toContain(
      'const toGrid = useCallback(() => { setLastFace(face); setFace(null); setFromOutside(false); }, [face]);');
    expect(HUB, 'BACK the one level').toMatch(
      /useEffect\(\(\) => \{\s*registerBack\?\.\(face !== null && !fromOutside && !listMode \? toGrid : null\);\s*return \(\) => registerBack\?\.\(null\);\s*\}, \[face, fromOutside, toGrid, registerBack, listMode\]\);/);
    expect(HUB, 'BACK a face\'s own links are inside').toContain("if (f === 'decision')  return <DecisionFace onNavigate={openFace} />;");
    expect(HUB, 'BACK the cycle clock\'s link is inside').toContain('onSwitchToHalving={() => openFace(\'halving\')}');
    expect(HUB, 'BACK the ring').toMatch(/className=\{`\$\{styles\.tile\} \$\{t\.key === lastFace \? styles\.tileLast : ''\}`\}/);
  });

  it('⭐ TITLE — the way to the grid is the header\'s "Almanac" on any face (the link\'s too) — none in the list, which has no grid; full mode\'s eyebrow without a header', () => {
    expect(HUB, 'TITLE the header\'s link, from any face, none on the grid or in the list').toMatch(
      /useEffect\(\(\) => \{\s*registerTitleLink\?\.\(face !== null && !listMode \? toGrid : null\);\s*return \(\) => registerTitleLink\?\.\(null\);\s*\}, \[face, toGrid, registerTitleLink, listMode\]\);/);
    expect(HUB, 'TITLE the eyebrow only where no header names the hub, on the grid\'s side').toMatch(
      /\{!listMode && !registerTitleLink && \(\s*<div className=\{styles\.eyebrowBar\}>/);
    expect(HUB, 'TITLE full mode\'s link').toContain(
      '<button type="button" className={`${styles.eyebrowLabel} ${styles.eyebrowLink}`} onClick={toGrid}>Almanac</button>');
    expect(HUB, 'TITLE no row of its own on a face').not.toMatch(/← Almanac|backBtn|faceBar/);
    expect(SHELL, 'TITLE the header\'s state').toContain('const [almanacTitleLink, setAlmanacTitleLink] = useState<(() => void) | null>(null);');
    expect(SHELL, 'TITLE the setter, stable').toContain(
      'const registerAlmanacTitleLink = useCallback((fn: (() => void) | null) => setAlmanacTitleLink(() => fn), []);');
    expect(SHELL, 'TITLE the link on a face, the name on the grid; the header\'s "←" still leaves (BL47: named)').toMatch(
      /<button className=\{styles\.simpleModeBackBtn\} onClick=\{\(\) => setActiveTab\(almanacOut\)\}>\s*\{`← \$\{backPlace\(almanacOut, backState\)\}`\}\s*<\/button>\s*\{almanacTitleLink\s*\? <button type="button" className=\{styles\.simpleModeTitleLink\} onClick=\{almanacTitleLink\}>Almanac<\/button>\s*: <span className=\{styles\.simpleModeSettingsTitle\}>Almanac<\/span>\}/);
  });

  it('⭐ BADGE — the live-height badge heads the Bitcoin group, once — beside its heading on the grid, under it in the list', () => {
    expect(HUB.match(/<FreshnessBadge\b/g), 'BADGE once').toHaveLength(1);
    expect(HUB, 'BADGE heads Bitcoin on the grid').toContain("{g.group === 'bitcoin' && badge}");
    expect(HUB, 'BADGE heads Bitcoin in the list').toContain("{g.group === 'bitcoin' && <div className={styles.listBadge}>{badge}</div>}");
  });

  it('⭐ SHELL — Branch I chains the edge swipe through the grid; full mode has no swipe to chain', () => {
    expect(SHELL, 'SHELL the chain').toContain(
      'const almanacEdgeBack = () => { const b = almanacBackRef.current; if (b) b(); else setActiveTab(almanacOut); };');
    expect(SHELL, 'SHELL the gesture').toContain(
      '<EdgeBackGesture onBack={almanacEdgeBack} renderUnder={() => (almanacBackRef.current ? null : renderSimpleUnder())}>');
    expect(SHELL, 'SHELL the report').toMatch(
      /<AlmanacView\s+initialFace=\{almanacFace\}\s+registerBack=\{\(fn\) => \{ almanacBackRef\.current = fn; \}\}\s+registerTitleLink=\{registerAlmanacTitleLink\}\s*\/>/);
    expect(SHELL, 'SHELL full mode').toContain("activeTab === 'almanac'    ? <AlmanacView initialFace={almanacFace} /> :");
  });

  it('⭐ ICONS — one drawing a face, decorative', () => {
    const entries = [...ICONS.matchAll(/^ {2}(\w+): (<>[\s\S]*?<\/>),$/gm)];
    expect(entries.map((m) => m[1]).sort(), 'ICONS every face').toEqual([...ALL].sort());
    expect(new Set(entries.map((m) => m[2])).size, 'ICONS no two alike').toBe(ALL.length);
    expect(ICONS, 'ICONS decorative').toMatch(/aria-hidden="true"/);
  });
});

describe('⭐ a computer (BL46\'s A — the owner\'s pick): the list', () => {
  const HUB = strip(read('src/components/Almanac/AlmanacView.tsx'));
  const CSS = read('src/components/Almanac/AlmanacView.module.css');
  const DOCK = strip(read('src/components/Almanac/ControlDock.tsx'));
  const px = (rule: string, prop: string): number => {
    const body = CSS.match(new RegExp(`\\n${rule.replace('.', '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
    return parseFloat(body.match(new RegExp(`${prop}:\\s*([\\d.]+)px`))?.[1] ?? 'NaN');
  };

  it('⭐ WIDTH — from 1200 px; there a plan face keeps its full 960 px beside the list in either mode, and its bar is already a bar', () => {
    expect(ALMANAC_LIST, 'WIDTH the list\'s width').toBe('(min-width: 1200px)');
    const column = parseFloat(CSS.match(/\.listLayout \{[^}]*grid-template-columns:\s*([\d.]+)px/)?.[1] ?? 'NaN');
    const footprint = px('.listLayout', 'padding-left') + column + px('.listLayout', 'column-gap');
    expect(footprint, 'WIDTH the list\'s footprint, read from the CSS').toBe(192);
    // Full mode's .main pads 20px a side (AppShell.module.css): the narrowest face column at 1200 is 1200 − 40 − 192.
    expect(1200 - 40 - footprint, 'WIDTH a face\'s 960 px fits beside the list in full mode').toBeGreaterThanOrEqual(960);
    expect(read('src/components/Layout/AppShell.module.css'), 'WIDTH full mode\'s padding, as counted').toMatch(/\.main \{[^}]*padding: 20px;/);
    expect(DOCK, 'WIDTH the bar from 1024 px, under the list\'s width').toContain("const WIDE = '(min-width: 1024px)';");
    expect(HUB, 'WIDTH the hub follows the rule').toContain('const listMode = useMediaQuery(ALMANAC_LIST);');
  });

  it('⭐ FIRST — the list opens on the face last open while it shows, else Decision — in all eight combinations', () => {
    let kept = 0;
    let fell = 0;
    for (const g of COMBOS) {
      const groups = gridGroups(g);
      expect(firstListFace(null, groups), `FIRST none yet: Decision · ${label(g)}`).toBe('decision');
      expect(faceShown('decision', g), `FIRST Decision always shows · ${label(g)}`).toBe(true);
      for (const f of ALL) {
        const want = faceShown(f, g) ? f : 'decision';
        expect(firstListFace(f, groups), `FIRST ${f} · ${label(g)}`).toBe(want);
        if (want === f && f !== 'decision') kept++;
        if (want !== f) fell++;
      }
    }
    expect(kept, 'FIRST a face kept (non-vacuous)').toBeGreaterThan(0);
    expect(fell, 'FIRST a hidden face falls back (non-vacuous)').toBeGreaterThan(0);
  });

  it('⭐ LIST — the list: the drawn groups\' faces as buttons, the open one marked; the open face beside it; the hub\'s name only where no header gives it', () => {
    expect(HUB, 'LIST the faces\' navigation').toMatch(/\{listMode && \(\s*<nav className=\{styles\.list\} aria-label="Faces">/);
    expect(HUB, 'LIST the name without a header').toContain(
      '{!registerTitleLink && <div className={`${styles.eyebrowLabel} ${styles.listTitle}`}>Almanac</div>}');
    expect(HUB, 'LIST the drawn groups').toMatch(/\{groups\.map\(\(g\) => \(\s*<section key=\{g\.group\} className=\{styles\.listGroup\}/);
    expect(HUB, 'LIST one click opens').toMatch(
      /className=\{`\$\{styles\.listItem\} \$\{t\.key === shown \? styles\.listItemOn : ''\}`\}\s*aria-current=\{t\.key === shown \? 'page' : undefined\}\s*onClick=\{\(\) => openFace\(t\.key\)\}/);
    expect(HUB, 'LIST its icon and name').toMatch(/<FaceIcon face=\{t\.key\} \/>\s*<span className=\{styles\.listName\}>\{t\.name\}<\/span>/);
    expect(HUB, 'LIST no face falls back to the grid in the list').not.toMatch(/listMode && face === null \? null/);
  });

  it('⭐ KEEP — one tree for both sides of 1200 px, so the open face never remounts; the list\'s face kept as the open one; the session\'s last face in memory only', () => {
    expect(HUB, 'KEEP the layout\'s wrapper').toContain('<div className={listMode ? styles.listLayout : styles.contents}>');
    expect(HUB, 'KEEP the face\'s wrapper').toMatch(
      /<div className=\{listMode \? styles\.pane : styles\.contents\}>\s*\{viewerWhatIfNoteShown[^\n]*\n\s*<ViewerWhatIf\.Provider value=\{true\}>\{renderFace\(shown\)\}<\/ViewerWhatIf\.Provider>\s*<\/div>/);
    expect(CSS, 'KEEP no box on the grid\'s side').toMatch(/\n\.contents \{\s*display: contents;\s*\}/);
    // BL50 — the session's last face is kept per lens: the owner's own hub, and his trusted preview of his viewer's.
    expect(HUB, 'KEEP the list\'s face').toContain(
      'const listFace: Face | null = listMode && face === null ? firstListFace(lastOpenFace[memory], groups) : null;');
    expect(HUB, 'KEEP kept as the open face').toMatch(/useEffect\(\(\) => \{ if \(listFace !== null\) setFace\(listFace\); \}, \[listFace\]\);/);
    expect(HUB, 'KEEP the session\'s last face').toMatch(/useEffect\(\(\) => \{ if \(shown !== null\) lastOpenFace\[memory\] = shown; \}, \[shown, memory\]\);/);
    expect(HUB, 'KEEP in memory only').toMatch(/^const lastOpenFace: Record<'own' \| 'seen', Face \| null> = \{ own: null, seen: null \};$/m);
    expect(HUB, 'KEEP nothing persisted').not.toMatch(/localStorage|sessionStorage|setAlmanacFace|lastOpenFace\s*=\s*useStore/);
  });
});

describe('⭐ a trusted viewer\'s hub (BL48)', () => {
  const HUB = strip(read('src/components/Almanac/AlmanacView.tsx'));
  const FIRE = strip(read('src/components/Almanac/FireFace.tsx'));

  it('⭐ OWNER ONLY — FIRE alone leaves a viewer\'s hub, before any gate: no deploy or loan brings it back', () => {
    expect(FACE_TILES.filter((t) => t.ownerOnly).map((t) => t.key), 'OWNER ONLY FIRE alone').toEqual(['fire']);
    for (const g of COMBOS.filter((c) => c.viewer)) {
      expect(faceShown('fire', g), `OWNER ONLY no FIRE for a viewer · ${label(g)}`).toBe(false);
      for (const f of ALL.filter((x) => x !== 'fire')) {
        expect(faceShown(f, g), `OWNER ONLY ${f}: as the owner's · ${label(g)}`).toBe(faceShown(f, { ...g, viewer: false }));
      }
    }
  });

  it('⭐ NOTE — a viewer reads "nothing saved" over every plan face he gets but the Ledger; never the owner, never a Bitcoin face', () => {
    expect(VIEWER_WHAT_IF_NOTE, 'NOTE the words').toBe("What-if only: what you change here isn't saved, and the plan doesn't change.");
    const shown = ALL.filter((f) => viewerWhatIfNoteShown(f, true));
    expect(shown.sort(), 'NOTE a viewer\'s plan faces').toEqual(['cycling', 'decision', 'defense', 'ownership', 'scenario', 'unified']);
    expect(ALL.filter((f) => viewerWhatIfNoteShown(f, false)), 'NOTE never the owner').toEqual([]);
  });

  it('⭐ WHAT-IF — the hub is a what-if place: its faces sit inside ViewerWhatIf (true); FIRE, whose inputs save, puts the lock back', () => {
    expect(HUB.match(/<ViewerWhatIf\.Provider/g), 'WHAT-IF one place in the hub').toHaveLength(1);
    expect(HUB, 'WHAT-IF around the face').toContain('<ViewerWhatIf.Provider value={true}>{renderFace(shown)}</ViewerWhatIf.Provider>');
    expect(FIRE, 'WHAT-IF FIRE locks its own').toMatch(
      /export default function FireFace\(\) \{\s*return <ViewerWhatIf\.Provider value=\{false\}><FireFaceBody \/><\/ViewerWhatIf\.Provider>;\s*\}/);
  });
});
