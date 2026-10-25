/**
 * BL34–BL35 (Batch 1, build 2d — F-2c-1) — NumberInput's save rules: what a keystroke saves, and what leaving the field,
 * Enter or Save saves. PURE.
 *
 * Every NumberInput says how it saves (`save`, a required prop — the compiler asks each new field):
 *  - `'button'` — a figure read off Strike or Coinbase, dated by its save (the four dated setters, Coinbase's collateral
 *    reading, Strike's collateral reading). Typing saves nothing; "Save — dated today" or Enter saves it once; Cancel
 *    restores the saved figure. Leaving the field keeps the typing, with its buttons; leaving the page drops it.
 *  - `'leave'` — a plan setting: a field of the synced plan, or the manual BTC price. Typing saves nothing; leaving the
 *    field, or Enter, saves it once.
 *  - `'live'` — a draft (the Log sheet's, the Safety card's — each with its own Save) or a what-if, and the read-only
 *    dry-powder field: each keystroke hands the figure on, and leaving the field saves no more than the owner typed.
 *
 * Why (F-2c-1, measured on `8ee997a`): the field saved the figure it showed on every blur and Enter, typed or not, and
 * on every keystroke — so a click in and out re-dated a dated figure (Coinbase's balance and liquidation price lost their
 * interest since entry: $50,522 → $50,004), and a typed figure saved each partial on the way (4, 40, 400 …, each dated
 * today); Coinbase's collateral logged a journal reading per keystroke (5 for "1.2345", 670 bytes, kept for good).
 *
 * The commit rule, for every mode: NOTHING unless the owner typed since the field took focus (for `'button'`, since its
 * last Save or Cancel); typed, the figure is clamped to [min, max] and saved only when it differs from what the field
 * shows — except a dated (`'button'`) field's, which saves as typed even when it equals the shown figure: saving dates it
 * today, and re-entering an unchanged balance is how the owner says it still holds (the reconciliation; the Safety card's
 * "Save — anchors to today" does the same). Untouched or unreadable, the field shows its current value again — a value
 * that changed while the field had focus (a sync) is shown, never overwritten.
 */
export type NumberSave = 'live' | 'leave' | 'button';

/** The Save button's words: every `'button'` field is a figure its save dates today. */
export const SAVE_DATED = 'Save — dated today';

export interface NumberCommitInput {
  /** Whether the owner typed since the field took focus (for `'button'`, since its last Save or Cancel). */
  typed: boolean;
  /** The field's text. */
  raw: string;
  /** The figure the field was given — what it shows. */
  value: number;
  min?: number;
  max?: number;
  decimals?: number;
  /** A `'button'` field: its save dates the figure, so a typed figure saves even when it equals the one shown. */
  dated?: boolean;
}

export interface NumberCommit {
  /** The figure to save, or null to save nothing. */
  write: number | null;
  /** The text the field shows afterwards. */
  show: string;
}

/** The field's text for a figure: `decimals` places when given, else the figure as typed. */
export function fmtNumberField(v: number, decimals?: number): string {
  return decimals !== undefined ? v.toFixed(decimals) : String(v);
}

export function numberCommit({ typed, raw, value, min, max, decimals, dated = false }: NumberCommitInput): NumberCommit {
  const shown = fmtNumberField(value, decimals);
  if (!typed) return { write: null, show: shown };
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return { write: null, show: shown };
  const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const text = fmtNumberField(clamped, decimals);
  return { write: text === shown && !dated ? null : clamped, show: text };
}

/** What a keystroke hands on: only a `'live'` field passes a figure on as it is typed — a readable, non-negative one. */
export function keystrokeWrite(save: NumberSave, raw: string): number | null {
  if (save !== 'live') return null;
  const n = parseFloat(raw);
  return !Number.isNaN(n) && n >= 0 ? n : null;
}

/** Whether leaving the field commits: `'live'` and `'leave'` do; a `'button'` field keeps its typing for Save. */
export function leaveCommits(save: NumberSave): boolean {
  return save !== 'button';
}
