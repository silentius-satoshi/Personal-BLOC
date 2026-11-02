/**
 * The Almanac's grid (BL40, BL45 — the owner's pick B): which faces the hub offers, in which group and in which order.
 * ONE pure rule: the hub reads its gates — the Coinbase loan, the Ledger's data, the FIRE face's deploy rule, and
 * whether this device is a viewer's — and passes them in; this module reads no store and no env, so every combination
 * is a unit test (`almanacGrid.test.ts`). A gated face is simply absent, as its pill was: for the owner the grid shows
 * exactly the faces the pill row showed (BL45's kill criterion). A trusted viewer gets the same faces less the
 * owner's-only — FIRE, whose assumptions are each device's own (BL48 V1, D3 A); a safe viewer never opens the hub.
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
  /** BL48 (V1) — a face no viewer gets: it reads what stays on the owner's device, so a viewer's would show other
   *  figures. FIRE alone, until its assumptions sync (C2, with its borrow lane). */
  ownerOnly?: true;
}

/** The gates as the hub reads them: `hasCbLoan` (Emergency, Cycling, Strategy), `ledgerFaceAvailable` (Ledger),
 *  `fireFaceOnDeploy` (FIRE — the owner's deploy and dev only until its borrow lane ships, BL42) and `viewerMode`
 *  (BL48 — the owner's-only faces leave a viewer's hub). */
export interface FaceGates {
  hasCbLoan: boolean;
  ledgerAvailable: boolean;
  fireOnDeploy: boolean;
  viewer: boolean;
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
  { key: 'fire',      name: 'FIRE',          group: 'plan', gate: 'fireDeploy', ownerOnly: true },
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
  if (tile.ownerOnly && gates.viewer) return false;
  switch (tile.gate) {
    case undefined: return true;
    case 'cbLoan': return gates.hasCbLoan;
    case 'ledger': return gates.ledgerAvailable;
    case 'fireDeploy': return gates.fireOnDeploy;
  }
}

/** BL48 (V4 B) — what a viewer reads over a face whose what-ifs he can try: nothing he changes there is saved. */
export const VIEWER_WHAT_IF_NOTE = "What-if only: what you change here isn't saved, and the plan doesn't change.";

/** Whether that note shows: on a viewer's device, over every plan face he gets but the Ledger (a table — nothing to
 *  try). The Bitcoin faces hold nothing of the plan's; FIRE is the owner's only. */
export function viewerWhatIfNoteShown(face: Face, viewer: boolean): boolean {
  const tile = FACE_TILES.find((t) => t.key === face);
  return viewer && tile !== undefined && tile.group === 'plan' && face !== 'ledger' && !tile.ownerOnly;
}

/** A computer (BL46's A — the owner's pick): from this width the hub shows its faces as a list beside the open face, with
 *  no grid page and no step back. 1200 px is where every face keeps its own width beside the list in either mode — the
 *  plan faces' 960 px, the widest (AlmanacView.module.css's `.listLayout`); narrower — a phone, an iPad, a narrower
 *  window — keeps the grid. */
export const ALMANAC_LIST = '(min-width: 1200px)';

/** The face a computer's list opens on when none is asked for: the face last open in this session while the list still
 *  shows it, else Decision — ungated, so always there. Reads the groups as drawn, so the list's gates are the grid's. */
export function firstListFace(last: Face | null, groups: readonly { tiles: readonly FaceTile[] }[]): Face {
  return last !== null && groups.some((g) => g.tiles.some((t) => t.key === last)) ? last : 'decision';
}

/** The grid as drawn: each group with the tiles it shows, in order. A group left with no tile is dropped (none can be
 *  today — Decision, Ownership and Scenario are ungated, and so is every bitcoin face). */
export function gridGroups(gates: FaceGates): { group: FaceGroup; label: string; tiles: FaceTile[] }[] {
  return FACE_GROUPS
    .map(({ group, label }) => ({ group, label, tiles: FACE_TILES.filter((t) => t.group === group && faceShown(t.key, gates)) }))
    .filter((g) => g.tiles.length > 0);
}
