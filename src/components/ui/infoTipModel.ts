/**
 * InfoTip's pure rules (spec `pbloc-spec-infotip-fit-v1.md` v1.1). ZERO imports — infoTipWiring.test.ts pins that.
 *
 * `tipShift` — where the open panel goes. CSS hangs it under the ⓘ; InfoTip measures it before paint and slides it
 * sideways by this much, so it sits inside the 16px gutters at every width. No fixed side works: on a phone the ⓘs sit
 * left of centre and the panel is about 90% of the screen wide, so hanging it left runs it off the left edge, and
 * hanging it right runs it off the right.
 *
 * `nextTipState` — who opens and closes it. Hover opens it only for a mouse (InfoTip gates on `pointerType`): a touch
 * tap fires a compat mouseenter before its click. With the old click toggle, that shut the tip in ONE tap (Chromium);
 * with pin-on-press, an ungated hover would leave iOS needing three taps to close it. A tap or click pins it; a second
 * tap or click on the ⓘ, Escape, or a tap or click outside closes it; moving the mouse away closes only a tip that
 * hover opened.
 */

/** The cards' own side margin on a phone. The panel's CSS max-width leaves this much each side. */
export const TIP_GUTTER_PX = 16;

/**
 * How far to slide the open panel (px, + = right) so it sits inside [TIP_GUTTER_PX, width − TIP_GUTTER_PX]. `left` and
 * `right` are the panel's edges where the CSS puts it; `width` is the screen's (`documentElement.clientWidth`, which
 * leaves out a computer's scrollbar). Too wide to fit ⇒ pin the left (reading) edge. Any non-finite input ⇒ 0.
 */
export function tipShift(left: number, right: number, width: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(width)) return 0;
  const lo = TIP_GUTTER_PX;
  const hi = width - TIP_GUTTER_PX;
  if (right - left > hi - lo) return lo - left;   // too wide to fit: pin the left (reading) edge
  if (left < lo) return lo - left;                 // off the left: slide right to the gutter
  if (right > hi) return hi - right;               // off the right: slide left to the gutter
  return 0;
}

export type TipState = 'closed' | 'hover' | 'pinned';
/** `hoverIn` / `hoverOut` come from a mouse only; `press` is a tap or click on the ⓘ; `dismiss` is Escape or a tap or
 *  click outside. */
export type TipEvent = 'hoverIn' | 'hoverOut' | 'press' | 'dismiss';

export function nextTipState(state: TipState, event: TipEvent): TipState {
  switch (event) {
    case 'hoverIn':  return state === 'closed' ? 'hover' : state;        // a pinned tip stays pinned
    case 'hoverOut': return state === 'hover' ? 'closed' : state;        // leaving closes only a hover-opened tip
    case 'press':    return state === 'pinned' ? 'closed' : 'pinned';    // shows it and keeps it; a second press closes
    case 'dismiss':  return 'closed';
  }
}
