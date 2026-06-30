import { useState } from 'react';
import HalvingClock from './HalvingClock';
import CycleClock from './CycleClock';
import FreshnessBadge from './FreshnessBadge';
import AlmanacConsentSheet from './AlmanacConsentSheet';
import { useChainTip } from '../../hooks/useChainTip';
import { useStore } from '../../store/useStore';
import styles from './AlmanacView.module.css';

/**
 * Almanac container — the sub-nav + the two clock faces. Holds the local face state (DEFAULT halving,
 * §14.3 — nothing persisted, nothing synced). P3: the single useChainTip lives HERE and feeds the SAME
 * height/mode to both faces, so switching faces is pure presentation and never remounts the data layer
 * (§14.5 by construction). The eyebrow badge is the live-block-height toggle (device-local; one-time
 * consent on first enable). Imports nothing from the risk/position core.
 */
export default function AlmanacView() {
  const [face, setFace] = useState<'halving' | 'cycle'>('halving');
  const [consentOpen, setConsentOpen] = useState(false);

  const tip = useChainTip();
  const almanacLiveEnabled = useStore((s) => s.almanacLiveEnabled);
  const almanacLiveConsented = useStore((s) => s.almanacLiveConsented);
  const setAlmanacLiveEnabled = useStore((s) => s.setAlmanacLiveEnabled);
  const setAlmanacLiveConsented = useStore((s) => s.setAlmanacLiveConsented);

  const handleBadgeTap = () => {
    if (almanacLiveEnabled) {
      setAlmanacLiveEnabled(false);            // off — silent
    } else if (almanacLiveConsented) {
      setAlmanacLiveEnabled(true);             // already consented — silent enable
    } else {
      setConsentOpen(true);                    // first enable — one-time consent
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.eyebrow}>
        <span className={styles.eyebrowLabel}>Almanac</span>
        <FreshnessBadge
          enabled={almanacLiveEnabled}
          mode={tip.mode}
          source={tip.source}
          lastUpdated={tip.lastUpdated}
          isStale={tip.isStale}
          onTap={handleBadgeTap}
        />
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
        <HalvingClock height={tip.height} mode={tip.mode} />
      ) : (
        <CycleClock height={tip.height} mode={tip.mode} onSwitchToHalving={() => setFace('halving')} />
      )}

      <AlmanacConsentSheet
        open={consentOpen}
        onCancel={() => setConsentOpen(false)}
        onConfirm={() => {
          setAlmanacLiveConsented(true);
          setAlmanacLiveEnabled(true);
          setConsentOpen(false);
        }}
      />
    </div>
  );
}
