import { useEffect, useState } from 'react';
import HalvingClock from './HalvingClock';
import CycleClock from './CycleClock';
import FreshnessBadge from './FreshnessBadge';
import AlmanacConsentSheet from './AlmanacConsentSheet';
import { useChainTip } from '../../hooks/useChainTip';
import { useStore } from '../../store/useStore';
import { MiningMain } from '../Mining/MiningMain';
import { PowerLawMain } from '../PowerLaw/PowerLawMain';
import { CbDefenseTool } from '../Tools/CbDefenseTool';
import styles from './AlmanacView.module.css';

/**
 * Almanac — a HUB SHELL (eyebrow + sub-nav + face host) for five faces: Halving Clock / Cycle Clock (both
 * cycleModel-only, rendered inside the shared 600px `.container`), Mining / Power Law (each embeds the
 * REAL `MiningMain`/`PowerLawMain` tool with its OWN already-shipped container/width — no double-wrapping),
 * and the gated `defense` face (embeds the shared `CbDefenseTool` — the same Emergency/Liq-Sim mode gate
 * used by the `liqsim` tab in AppShell — hidden entirely when `!hasCbLoan`). Holds the local face state
 * (DEFAULT halving, §14.3 — nothing persisted, nothing synced). P3: the single useChainTip lives HERE and
 * feeds the SAME height/mode to the two clock faces, so switching faces is pure presentation and never
 * remounts the data layer (§14.5 by construction) — Mining/PowerLaw/defense don't consume it at all.
 * The eyebrow badge is the live-block-height toggle (device-local; one-time consent on first enable).
 *
 * ISOLATION WALL (restated, unchanged): cycleModel/HalvingClock/CycleClock import nothing from the
 * risk/position core (§2); emergencyModel imports nothing from cycleModel/power-law (§7). Co-locating all
 * five faces under one hub is navigation only — it crosses neither wall.
 */
export default function AlmanacView() {
  const [face, setFace] = useState<'halving' | 'cycle' | 'mining' | 'powerlaw' | 'defense'>('halving');
  const [consentOpen, setConsentOpen] = useState(false);

  const tip = useChainTip();
  const almanacLiveEnabled = useStore((s) => s.almanacLiveEnabled);
  const almanacLiveConsented = useStore((s) => s.almanacLiveConsented);
  const setAlmanacLiveEnabled = useStore((s) => s.setAlmanacLiveEnabled);
  const setAlmanacLiveConsented = useStore((s) => s.setAlmanacLiveConsented);
  const hasCbLoan = useStore((s) => s.hasCbLoan);
  const cbPaymentStrategy = useStore((s) => s.cbPaymentStrategy);

  // If the defense face is showing and the CB loan gets turned off, fall back — the face would otherwise
  // render a tool with nothing to show.
  useEffect(() => {
    if (face === 'defense' && !hasCbLoan) setFace('halving');
  }, [face, hasCbLoan]);

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
    <div className={styles.shell}>
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
          <button
            type="button"
            className={`${styles.subnavBtn} ${face === 'mining' ? styles.subnavBtnOn : ''}`}
            onClick={() => setFace('mining')}
          >
            ⛏ Mining
          </button>
          <button
            type="button"
            className={`${styles.subnavBtn} ${face === 'powerlaw' ? styles.subnavBtnOn : ''}`}
            onClick={() => setFace('powerlaw')}
          >
            ₿ Power Law
          </button>
          {hasCbLoan && (
            <button
              type="button"
              className={`${styles.subnavBtn} ${face === 'defense' ? styles.subnavBtnOn : ''}`}
              onClick={() => setFace('defense')}
            >
              {cbPaymentStrategy === 'ltvTriggered' ? '🚨 Emergency' : 'Liq Sim'}
            </button>
          )}
        </div>
      </div>

      {face === 'halving' || face === 'cycle' ? (
        <div className={styles.container}>
          {face === 'halving' ? (
            <HalvingClock height={tip.height} mode={tip.mode} />
          ) : (
            <CycleClock height={tip.height} mode={tip.mode} onSwitchToHalving={() => setFace('halving')} />
          )}
        </div>
      ) : face === 'defense' ? (
        <CbDefenseTool />
      ) : face === 'mining' ? (
        <MiningMain />
      ) : (
        <PowerLawMain />
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
