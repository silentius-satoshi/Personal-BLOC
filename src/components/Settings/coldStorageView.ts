import { toLocalISO } from '../../utils/format';

/**
 * BL33 — Settings → Strike Strategy's COLD STORAGE group, as words. PURE.
 *
 * The field shows the LIVE total — the total last entered plus every cold move since (`deriveColdStorage`) — so the line
 * under it says what that figure is made of, in the owner's words: "Entered <day>, plus N moves since." Entering a total
 * re-dates it (the anchor is the moment it was entered, `coldStorageBtcAsOf`), and only the moves after it are added
 * (`coldMovesSinceAnchor`, the derive's own rule: a move dated after that day, or logged later that same day — a move
 * backdated before it is already inside the total, so "since", never "logged since"). Never "anchor", never the
 * Almanac's sweep: the faces' plans never change this total — only a move you log, or a total you enter.
 */
export const COLD_GROUP_LEAD =
  'Coins in your own custody, pledged to nobody. They count in what you hold and in your net coins (your goal) — '
  + "never in a loan's LTV.";
export const COLD_FIELD_LABEL = 'Total in cold storage';
export const COLD_HOW =
  'When you move coins in or out, log it in Daily → Collateral → Cold. Entering a new total here sets it as of today.';

/** What the field's figure is made of: the day the total was entered, and the cold moves since (the derive's rule). */
export function coldAsOfLine(asOfMs: number | null, movesSince: number): string {
  if (asOfMs === null || !Number.isFinite(asOfMs)) return 'Not dated yet — enter your total once to date it.';
  const day = toLocalISO(new Date(asOfMs));
  return movesSince > 0
    ? `Entered ${day}, plus ${movesSince} move${movesSince === 1 ? '' : 's'} since.`
    : `Entered ${day}.`;
}
