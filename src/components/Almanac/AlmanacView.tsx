import { useState } from 'react';
import HalvingClock from './HalvingClock';
import CycleClock from './CycleClock';
import styles from './AlmanacView.module.css';

/**
 * Almanac container (P2) — the sub-nav + the two clock faces. Holds the local face state (DEFAULT
 * halving, §14.3 — nothing persisted, nothing synced). The SAME height/mode are passed to both faces,
 * so switching faces is pure presentation and never remounts a data layer (§14.5). In P3 the single
 * useChainTip lives HERE and feeds height/mode down — this prop shape is already that seam.
 *
 * STILL STATIC in P2 — height/mode default to a review fixture; not wired into the app surface switch
 * (P4). Imports nothing from the risk/position core.
 */
export interface AlmanacViewProps {
  height?: number;
  mode?: 'live' | 'estimated';
}

export default function AlmanacView({ height = 955_710, mode = 'estimated' }: AlmanacViewProps) {
  const [face, setFace] = useState<'halving' | 'cycle'>('halving');

  return (
    <div>
      <div className={styles.eyebrow}>
        <span className={styles.eyebrowLabel}>Almanac</span>
        <span className={styles.eyebrowLine} />
      </div>

      <div className={styles.subnav}>
        <button
          type="button"
          className={`${styles.subnavBtn} ${face === 'halving' ? styles.subnavBtnOn : ''}`}
          onClick={() => setFace('halving')}
        >
          ◔ Halving Clock
        </button>
        <button
          type="button"
          className={`${styles.subnavBtn} ${face === 'cycle' ? styles.subnavBtnOn : ''}`}
          onClick={() => setFace('cycle')}
        >
          ₿ Cycle Clock
        </button>
        <button type="button" className={`${styles.subnavBtn} ${styles.subnavBtnSoon}`} disabled>
          ⛏ Mining <span className={styles.soonTag}>soon</span>
        </button>
        <button type="button" className={`${styles.subnavBtn} ${styles.subnavBtnSoon}`} disabled>
          ₿ Power Law <span className={styles.soonTag}>soon</span>
        </button>
      </div>

      {face === 'halving' ? (
        <HalvingClock height={height} mode={mode} />
      ) : (
        <CycleClock height={height} mode={mode} onSwitchToHalving={() => setFace('halving')} />
      )}
    </div>
  );
}
