import { useEffect, useState } from 'react';
import HalvingClock from './HalvingClock';
import CycleClock from './CycleClock';
import FreshnessBadge from './FreshnessBadge';
import AlmanacConsentSheet from './AlmanacConsentSheet';
import { useChainTip } from '../../hooks/useChainTip';
import { useStore } from '../../store/useStore';
import { MiningInputsPanel } from '../Mining/MiningInputsPanel';
import { MiningMain } from '../Mining/MiningMain';
import { PowerLawSidebar } from '../PowerLaw/PowerLawSidebar';
import { PowerLawMain } from '../PowerLaw/PowerLawMain';
import { ConverterMain } from '../Converter/ConverterMain';
import { ConverterSidebar } from '../Converter/ConverterSidebar';
import { CbDefenseTool } from '../Tools/CbDefenseTool';
import styles from './AlmanacView.module.css';

/**
 * Almanac — a HUB SHELL (eyebrow + sub-nav + face host) for SIX faces: Halving Clock / Cycle Clock (both
 * cycleModel-only, rendered inside the shared `.container`, which now itself `composes: toolContainer`),
 * Mining / Power Law / Sats (each embeds the REAL tool's main content PLUS its own input panel, stacked in
 * a `.faceStack` in that tool's own mobile DOM order — mining/powerlaw panel-first, sats main-first,
 * mirroring the presence/absence of AppShell's converter-only `order` override; at ≥768px `.faceStack`
 * goes two-column mirroring AppShell's own 280px/1fr shell grid, with `.facePanel` pinning the panel to
 * the left column regardless of each face's own mobile DOM order), and the gated `defense`
 * face (embeds the shared `CbDefenseTool` — the same Emergency/Liq-Sim mode gate used by the `liqsim` tab
 * in AppShell — hidden entirely when `!hasCbLoan`). Every embedded tool brings its OWN already-shipped
 * `toolContainer`-composed width — the hub adds none of its own (§8 toolContainer adoption is now CLOSED:
 * EmergencyConsole/LiqSimulator, Mining/PowerLaw/Converter, and AlmanacView's own `.container` all compose
 * from the same `toolShell.module.css`). Holds the local face state (DEFAULT halving, §14.3 — nothing
 * persisted, nothing synced). P3: the single useChainTip lives HERE and feeds the SAME height/mode to the
 * two clock faces, so switching faces is pure presentation and never remounts the data layer (§14.5 by
 * construction) — Mining/PowerLaw/Sats/defense don't consume it at all. The eyebrow badge is the
 * live-block-height toggle (device-local; one-time consent on first enable).
 *
 * ISOLATION WALL (restated, unchanged): cycleModel/HalvingClock/CycleClock import nothing from the
 * risk/position core (§2); emergencyModel imports nothing from cycleModel/power-law (§7). Co-locating all
 * six faces under one hub is navigation only — it crosses neither wall.
 */
export default function AlmanacView() {
  const [face, setFace] = useState<'halving' | 'cycle' | 'mining' | 'powerlaw' | 'sats' | 'defense'>('halving');
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
          <button
            type="button"
            className={`${styles.subnavBtn} ${face === 'sats' ? styles.subnavBtnOn : ''}`}
            onClick={() => setFace('sats')}
          >
            丰 Sats
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
        <div className={styles.faceStack}>
          <div className={styles.facePanel}><MiningInputsPanel /></div>
          <MiningMain />
        </div>
      ) : face === 'powerlaw' ? (
        <div className={styles.faceStack}>
          <div className={styles.facePanel}><PowerLawSidebar /></div>
          <PowerLawMain />
        </div>
      ) : (
        <div className={styles.faceStack}>
          <ConverterMain />
          <div className={styles.facePanel}><ConverterSidebar /></div>
        </div>
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
