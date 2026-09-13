import { useEffect, useState } from 'react';
import { isAnchorHeld, stressAnchorPrice, anchorDrift } from './cyclingFaceView';

export interface StressLens {
  /** The stress multiplier. 1 = "as modeled". */
  lens: number;
  setLens: (next: number) => void;
  /** The price `plConvergencePath` must be built from — the held anchor while stressed, else live. */
  anchorPrice: number;
  /** True while the anchor is held, so the face can say so instead of still claiming "today's live". */
  priceHeld: boolean;
  /** Spot, STILL LIVE while the anchor holds — the scenario freezes, the market readout does not. */
  livePrice: number;
  /** Spot vs the held anchor, as a fraction. 0 when nothing is held. */
  drift: number;
}

/**
 * The price-stress lens for the Almanac faces, with the anchor that keeps a scenario alive.
 *
 * Both faces drop a stress scenario the moment any engine input changes — correct, since a run
 * measured against inputs that have since moved reports the wrong position. But `pricePath` is one of
 * those inputs and it is rebuilt from `s.btcPrice`, which the spot poll rewrites every few seconds.
 * A scenario therefore could not outlive one quote. Holding the anchor for the duration of the lens
 * makes the background quote invisible to the reset effect while leaving every deliberate change to
 * reset exactly as before. See `isAnchorHeld` / `stressAnchorPrice` for the full reasoning.
 *
 * The caller keeps its own reset effect and keeps calling `setLens(1)` from it: returning to "as
 * modeled" releases the anchor here, so there is nothing extra to remember at the call site.
 */
export function useStressLens(livePrice: number, priceMode: 'live' | 'manual'): StressLens {
  const [lens, setLens] = useState(1);
  const [anchor, setAnchor] = useState<number | null>(null);

  const priceHeld = isAnchorHeld(lens, priceMode);

  // ⚠ LATCH IN AN EFFECT, NOT IN THE DRAG HANDLER — the handler would close over a stale price and
  // reintroduce the very reset it is meant to prevent (see `stressAnchorPrice`). Both branches are
  // idempotent, so the live-quote dependency re-runs this harmlessly on every tick.
  useEffect(() => {
    if (priceHeld && anchor === null) setAnchor(livePrice);
    else if (!priceHeld && anchor !== null) setAnchor(null);
  }, [priceHeld, anchor, livePrice]);

  const anchorPrice = stressAnchorPrice(livePrice, anchor, priceHeld);
  // ⚠ `livePrice` is returned UNCHANGED on purpose. Insulating the path memo from the poll must not
  // also hide the market: the store quote still re-renders the face, so spot and drift keep ticking at
  // the poll's own cadence while the scenario underneath holds still.
  return { lens, setLens, anchorPrice, priceHeld, livePrice, drift: anchorDrift(livePrice, anchorPrice, priceHeld) };
}
