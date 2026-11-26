import { useEffect, useMemo, useRef, useState } from 'react';
import { useBtcHistory } from '../../hooks/useBtcHistory';
import { useCountTo } from '../../hooks/useCountTo';
import { withLivePoint } from '../../lib/liveFeed';
import { fmtUSD } from '../../utils/format';
import { PLATE_ASSET, PLATE_DAY, PLATE_LABEL, plateView, type FeedState } from './engineView';
import styles from './EngineFace.module.css';

/** How long the price shows the way it moved, as the prototypes' does. */
const FLASH_MS = 650;

/**
 * The Engine's price bar (BL67) — the owner's prototypes' nameplate, where the face's framing sentence was: Bitcoin and
 * the feed's state, the price the Engine draws (it counts to each new one, as the Dashboard's does, and flashes the way
 * it moved), the day's move as a pill and a line, and where and when the price came from.
 *
 * Its figures come from the face (`useEngineFacts`'s feed and live price, the scene's price) and from the Dashboard
 * chart's 1D history — the same hook, the same line (`withLivePoint`), the same move (`lib/priceMove.ts`). It writes
 * nothing. The price changes each second while the feed is live, so it is never a live region: a screen reader reads it
 * when asked.
 */
export default function EnginePlate({ feed, price, livePrice, liveAt, reducedMotion }: {
  feed: FeedState;
  price: number;
  livePrice: number | null;
  liveAt: number | null;
  reducedMotion: boolean;
}) {
  const { candles, asOf } = useBtcHistory('1D');
  const day = useMemo(() => {
    if (asOf !== null) return null;
    // withLivePoint reads a tick's price and time alone; the source is the type's, not read
    const tick = livePrice !== null && liveAt !== null ? { price: livePrice, at: liveAt, source: 'socket' as const } : null;
    return withLivePoint(candles, tick, true);
  }, [candles, asOf, livePrice, liveAt]);
  const view = plateView(feed, liveAt, day);
  const shown = useCountTo(price);

  // The price shows the way it moved, a moment — while it is the market's live price, and never under reduced motion. A
  // flash under way ends at once when either stops: the re-run's cleanup has cleared its timer, so it would stay (v1.1).
  const before = useRef(price);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    const from = before.current;
    before.current = price;
    if (feed !== 'live' || reducedMotion) { setFlash(null); return; }
    if (from === price) return;
    setFlash(price > from ? 'up' : 'down');
    const id = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(id);
  }, [price, feed, reducedMotion]);

  const priceTone = flash === 'up' ? styles.up : flash === 'down' ? styles.down : '';
  return (
    <div className={styles.plate} role="group" aria-label={PLATE_LABEL} data-engine-plate="">
      <div className={styles.tk}>
        <div className={styles.tkLabel}>
          <span>{PLATE_ASSET}</span>
          <span className={styles.pill} data-feed={feed}><i className={styles.dot} aria-hidden="true" />{view.pill}</span>
        </div>
        <div className={styles.tkRow}>
          <b className={`${styles.tkPrice} ${priceTone}`}>{fmtUSD(shown ?? price)}</b>
          {view.change !== null && (
            <span className={`${styles.chg} ${view.change.up ? styles.chgUp : styles.chgDown}`} title={PLATE_DAY}>
              {view.change.text}<span className={styles.srOnly}>, {PLATE_DAY.toLowerCase()}</span>
            </span>
          )}
          {view.spark !== null && (
            <svg className={styles.spark} width="58" height="18" viewBox="0 0 58 18" aria-hidden="true">
              <polyline points={view.spark.points} className={view.spark.up ? styles.sparkUp : styles.sparkDown} />
            </svg>
          )}
        </div>
      </div>
      <span className={styles.plateNote}>{view.note}</span>
    </div>
  );
}
