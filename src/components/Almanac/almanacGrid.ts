/**
 * The Almanac's grid (BL40, BL45 — the owner's pick B): which faces the hub offers, in which group and in which order.
 * ONE pure rule: the hub reads its three gates — the Coinbase loan, the Ledger's data, the FIRE face's deploy rule — and
 * passes them in; this module reads no store and no env, so every combination is a unit test (`almanacGrid.test.ts`).
 * A gated face is simply absent, as its pill was: the grid shows exactly the faces the pill row showed (BL45's kill
 * criterion), so a face no viewer could reach before is no nearer now.
 */

/** The thirteen faces. A face added here needs a tile below (the test counts them), a branch in `AlmanacView`'s
 *  `renderFace` above its Converter fallback (C8), and an icon in `FaceIcon`. */
export type Face =
  | 'halving' | 'cycle' | 'mining' | 'powerlaw' | 'sats' | 'defense' | 'ledger' | 'scenario' | 'cycling' | 'ownership'
  | 'unified' | 'decision' | 'fire';

export type FaceGroup = 'plan' | 'bitcoin';

/** What a gated tile waits on — the pill row's three gates, unchanged. */
type FaceGate = 'cbLoan' | 'ledger' | 'fireDeploy';

export interface FaceTile {
  key: Face;
  /** The tile's name — its accessible name too, exactly. */
  name: string;
  group: FaceGroup;
  gate?: FaceGate;
}

/** The gates as the hub reads them: `hasCbLoan` (Emergency, Cycling, Strategy), `ledgerFaceAvailable` (Ledger) and
 *  `fireFaceOnDeploy` (FIRE — the owner's deploy and dev only until its borrow lane ships, BL42). */
export interface FaceGates {
  hasCbLoan: boolean;
  ledgerAvailable: boolean;
  fireOnDeploy: boolean;
}

/** Every face, in the grid's order: your plan's faces first, then bitcoin's (BL45). */
export const FACE_TILES: readonly FaceTile[] = [
  { key: 'decision',  name: 'Decision',      group: 'plan' },
  { key: 'unified',   name: 'Strategy',      group: 'plan', gate: 'cbLoan' },
  { key: 'ownership', name: 'Ownership',     group: 'plan' },
  { key: 'cycling',   name: 'Cycling',       group: 'plan', gate: 'cbLoan' },
  { key: 'ledger',    name: 'Ledger',        group: 'plan', gate: 'ledger' },
  { key: 'scenario',  name: 'Scenario',      group: 'plan' },
  { key: 'defense',   name: 'Emergency',     group: 'plan', gate: 'cbLoan' },
  { key: 'fire',      name: 'FIRE',          group: 'plan', gate: 'fireDeploy' },
  { key: 'halving',   name: 'Halving Clock', group: 'bitcoin' },
  { key: 'cycle',     name: 'Cycle Clock',   group: 'bitcoin' },
  { key: 'powerlaw',  name: 'Power Law',     group: 'bitcoin' },
  { key: 'mining',    name: 'Mining',        group: 'bitcoin' },
  { key: 'sats',      name: 'Sats',          group: 'bitcoin' },
];

/** The groups' headings, in order. */
export const FACE_GROUPS: readonly { group: FaceGroup; label: string }[] = [
  { group: 'plan', label: 'Your plan' },
  { group: 'bitcoin', label: 'Bitcoin' },
];

/** Whether the hub offers a face — the tile shows, and an open face stays open. */
export function faceShown(face: Face, gates: FaceGates): boolean {
  const tile = FACE_TILES.find((t) => t.key === face);
  if (!tile) return false;
  switch (tile.gate) {
    case undefined: return true;
    case 'cbLoan': return gates.hasCbLoan;
    case 'ledger': return gates.ledgerAvailable;
    case 'fireDeploy': return gates.fireOnDeploy;
  }
}

/** The grid as drawn: each group with the tiles it shows, in order. A group left with no tile is dropped (none can be
 *  today — Decision, Ownership and Scenario are ungated, and so is every bitcoin face). */
export function gridGroups(gates: FaceGates): { group: FaceGroup; label: string; tiles: FaceTile[] }[] {
  return FACE_GROUPS
    .map(({ group, label }) => ({ group, label, tiles: FACE_TILES.filter((t) => t.group === group && faceShown(t.key, gates)) }))
    .filter((g) => g.tiles.length > 0);
}
