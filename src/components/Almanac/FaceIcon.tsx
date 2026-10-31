import type { ReactNode } from 'react';
import type { Face } from './almanacGrid';

/**
 * The grid's line icons (BL45) — one per face, drawn for the grid the owner picked (B): a 24px box, a 1.75 stroke in the
 * tile's own colour, round ends. Thirteen, since the pills' glyphs couldn't serve — two faces shared one (₿ Cycle Clock
 * and ₿ Power Law; ⚖ Scenario and ⚖ Ownership) and two showed as colour emoji on an iPhone (⛏, 🚨). Decorative: the
 * tile's name is its accessible name.
 */
const PATHS: Record<Face, ReactNode> = {
  // a signpost — what the plan does this month
  decision: <><path d="M12 3v18" /><path d="M5 5.5h11l3 2.5-3 2.5H5z" /><path d="M19 12.5H8l-3 2.5 3 2.5h11z" /></>,
  // a diamond in a diamond — one run, two lenses
  unified: <><path d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12z" /><path d="M12 7.5l4.5 4.5-4.5 4.5L7.5 12z" /></>,
  // a pie — who holds the coins
  ownership: <><circle cx="12" cy="12" r="9" /><path d="M12 3v9l6.4 6.4" /><path d="M12 12H3" /></>,
  // two arrows round a loop — Strike to Coinbase and back
  cycling: <><path d="M17 3.5l3 3-3 3" /><path d="M4 11V9a2.5 2.5 0 0 1 2.5-2.5H20" /><path d="M7 20.5l-3-3 3-3" /><path d="M20 13v2a2.5 2.5 0 0 1-2.5 2.5H4" /></>,
  // a ruled page — the months logged
  ledger: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6" /><path d="M9 12h6" /><path d="M9 16h4" /></>,
  // two columns side by side — a plan against a change
  scenario: <><rect x="3" y="5" width="7" height="14" rx="1.5" /><rect x="14" y="5" width="7" height="14" rx="1.5" /><path d="M10 12h4" /></>,
  // a warning triangle — the crash-day console
  defense: <><path d="M12 3.5l9 16H3z" /><path d="M12 10v4.5" /><path d="M12 17.5v.01" /></>,
  // a target — the number to stop working
  fire: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>,
  // a clock with its quarter shaded — the halving countdown
  halving: <><path d="M12 3a9 9 0 0 1 9 9h-9z" style={{ fill: 'currentColor', fillOpacity: 0.25, stroke: 'none' }} /><circle cx="12" cy="12" r="9" /><path d="M12 12V3" /><path d="M12 12h9" /></>,
  // a circle coming round — the four-year cycle
  cycle: <><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v4h-4" /><circle cx="12" cy="12" r="1.5" /></>,
  // a curve on its axes — price against its trend
  powerlaw: <><path d="M4 4v16h16" /><path d="M7 17c4-1 7-4 9-8s3-4 4-5" /></>,
  // a block — mining
  mining: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5" /><path d="M12 12v9" /><path d="M12 12L4 7.5" /></>,
  // the 丰 sats sign, in lines
  sats: <><path d="M12 3v18" /><path d="M6 8h12" /><path d="M6 12h12" /><path d="M6 16h12" /></>,
};

export default function FaceIcon({ face }: { face: Face }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[face]}
    </svg>
  );
}
