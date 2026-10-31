import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FACE_TILES, FACE_GROUPS, faceShown, gridGroups, type Face, type FaceGates } from '../almanacGrid';

/**
 * ⚠ The Almanac's grid (BL40, BL45 — the owner's pick B). The rule is pure, so every gate combination is tested here; the
 * hub's wiring has no render harness, so it is read off the source, and e2e/almanacGrid.spec.ts pins what the grid does on
 * screen. Each assertion carries the tag its planted bug turns red.
 */
const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
/** Code with its comments removed — block, JSX and line comments (a `//` after a `:` is a URL, kept). */
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const ALL: Face[] = ['halving', 'cycle', 'mining', 'powerlaw', 'sats', 'defense', 'ledger', 'scenario', 'cycling', 'ownership', 'unified', 'decision', 'fire'];
/** All eight gate combinations. */
const COMBOS: FaceGates[] = [false, true].flatMap((hasCbLoan) => [false, true].flatMap((ledgerAvailable) =>
  [false, true].map((fireOnDeploy) => ({ hasCbLoan, ledgerAvailable, fireOnDeploy }))));
const label = (g: FaceGates): string => `loan ${g.hasCbLoan} · ledger ${g.ledgerAvailable} · fire ${g.fireOnDeploy}`;

/**
 * The pill row's rule as it stood at `0cc0ecd` (AlmanacView's `visibleFaces`), kept here as the reference: the grid
 * shows exactly the faces the pills showed (BL45's kill criterion — a face no viewer could reach before is no nearer).
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
    ...(g.fireOnDeploy ? ['fire' as Face] : []),
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
    const all = gridGroups({ hasCbLoan: true, ledgerAvailable: true, fireOnDeploy: true });
    expect(all.map((g) => g.label), 'ORDER the groups').toEqual(['Your plan', 'Bitcoin']);
    expect(all[0].tiles.map((t) => t.name), 'ORDER your plan').toEqual(
      ['Decision', 'Strategy', 'Ownership', 'Cycling', 'Ledger', 'Scenario', 'Emergency', 'FIRE']);
    expect(all[1].tiles.map((t) => t.name), 'ORDER bitcoin').toEqual(['Halving Clock', 'Cycle Clock', 'Power Law', 'Mining', 'Sats']);
  });
});

describe('⭐ the gates', () => {
  it('⭐ GATES — the loan, the Ledger\'s data and the deploy rule, each on its own faces, in all eight combinations', () => {
    for (const g of COMBOS) {
      const want: Record<Face, boolean> = {
        decision: true, ownership: true, scenario: true, halving: true, cycle: true, powerlaw: true, mining: true, sats: true,
        unified: g.hasCbLoan, cycling: g.hasCbLoan, defense: g.hasCbLoan, ledger: g.ledgerAvailable, fire: g.fireOnDeploy,
      };
      for (const f of ALL) expect(faceShown(f, g), `GATES ${f} · ${label(g)}`).toBe(want[f]);
      const shown = gridGroups(g).flatMap((grp) => grp.tiles.map((t) => t.key));
      expect(shown.sort(), `GATES the grid shows what faceShown does · ${label(g)}`).toEqual(ALL.filter((f) => want[f]).sort());
    }
  });

  it('⭐ PILLS — the grid offers exactly the faces the pill row did, in every combination (BL45)', () => {
    for (const g of COMBOS) {
      const grid = gridGroups(g).flatMap((grp) => grp.tiles.map((t) => t.key));
      expect([...grid].sort(), `PILLS ${label(g)}`).toEqual(pillRow(g).sort());
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
    expect(HUB, 'GRID no face mounts on the grid').toMatch(/\{face !== null && renderFace\(face\)\}/);
    expect(HUB, 'GRID the grid or the way back').toMatch(/\{face === null \? \(\s*<nav className=\{styles\.grid\} aria-label="Faces">/);
  });

  it('⭐ ONE RULE — the hub reads its three gates once and asks almanacGrid; no gate of its own', () => {
    expect(HUB, 'ONE RULE the grid').toContain('const groups = gridGroups({ hasCbLoan, ledgerAvailable, fireOnDeploy: FIRE_ON_THIS_DEPLOY });');
    expect(HUB, 'ONE RULE the fallback').toMatch(
      /useEffect\(\(\) => \{\s*if \(face !== null && !faceShown\(face, \{ hasCbLoan, ledgerAvailable, fireOnDeploy: FIRE_ON_THIS_DEPLOY \}\)\) setFace\(null\);\s*\}, \[face, hasCbLoan, ledgerAvailable\]\);/);
    expect(HUB, 'ONE RULE no pill list').not.toMatch(/visibleFaces|subnav/);
    expect(HUB, 'ONE RULE no gate spread of its own').not.toMatch(/hasCbLoan \?|ledgerAvailable \?|FIRE_ON_THIS_DEPLOY \?/);
    expect(HUB, 'ONE RULE no face falls back to a face').not.toMatch(/setFace\('halving'\)/);
  });

  it('⭐ BACK — a face reports its way to the grid; the grid and the link\'s face report none', () => {
    expect(HUB, 'BACK every way in from inside').toContain('const openFace = (f: Face) => { setFace(f); setFromOutside(false); };');
    expect(HUB, 'BACK to the grid, ringing the face left').toContain(
      'const toGrid = useCallback(() => { setLastFace(face); setFace(null); setFromOutside(false); }, [face]);');
    expect(HUB, 'BACK the one level').toMatch(
      /useEffect\(\(\) => \{\s*registerBack\?\.\(face !== null && !fromOutside \? toGrid : null\);\s*return \(\) => registerBack\?\.\(null\);\s*\}, \[face, fromOutside, toGrid, registerBack\]\);/);
    expect(HUB, 'BACK the visible way').toMatch(/<button type="button" className=\{styles\.backBtn\} onClick=\{toGrid\}>← Almanac<\/button>/);
    expect(HUB, 'BACK a face\'s own links are inside').toContain("if (f === 'decision')  return <DecisionFace onNavigate={openFace} />;");
    expect(HUB, 'BACK the cycle clock\'s link is inside').toContain('onSwitchToHalving={() => openFace(\'halving\')}');
    expect(HUB, 'BACK the ring').toMatch(/className=\{`\$\{styles\.tile\} \$\{t\.key === lastFace \? styles\.tileLast : ''\}`\}/);
  });

  it('⭐ SHELL — Branch I chains the edge swipe through the grid; full mode has no swipe to chain', () => {
    expect(SHELL, 'SHELL the chain').toContain(
      'const almanacEdgeBack = () => { const b = almanacBackRef.current; if (b) b(); else setActiveTab(previousTab); };');
    expect(SHELL, 'SHELL the gesture').toContain(
      '<EdgeBackGesture onBack={almanacEdgeBack} renderUnder={() => (almanacBackRef.current ? null : renderSimpleUnder())}>');
    expect(SHELL, 'SHELL the report').toContain('<AlmanacView initialFace={almanacFace} registerBack={(fn) => { almanacBackRef.current = fn; }} />');
    expect(SHELL, 'SHELL the visible ← Back still leaves').toMatch(
      /<button className=\{styles\.simpleModeBackBtn\} onClick=\{\(\) => setActiveTab\(previousTab\)\}>← Back<\/button>\s*<span className=\{styles\.simpleModeSettingsTitle\}>Almanac<\/span>/);
    expect(SHELL, 'SHELL full mode').toContain("activeTab === 'almanac'    ? <AlmanacView initialFace={almanacFace} /> :");
  });

  it('⭐ ICONS — one drawing a face, decorative', () => {
    const entries = [...ICONS.matchAll(/^ {2}(\w+): (<>[\s\S]*?<\/>),$/gm)];
    expect(entries.map((m) => m[1]).sort(), 'ICONS every face').toEqual([...ALL].sort());
    expect(new Set(entries.map((m) => m[2])).size, 'ICONS no two alike').toBe(ALL.length);
    expect(ICONS, 'ICONS decorative').toMatch(/aria-hidden="true"/);
  });
});
