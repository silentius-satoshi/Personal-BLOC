import { useEffect, useState, type ReactNode } from 'react';
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
import LedgerFace from './LedgerFace';
import ScenarioFace from './ScenarioFace';
import CyclingFace from './CyclingFace';
import OwnershipFace from './OwnershipFace';
import { ledgerFaceAvailable } from '../../lib/ledgerCsv';
import styles from './AlmanacView.module.css';

/**
 * Almanac — a HUB SHELL (eyebrow + sub-nav + face host) for NINE faces: Halving Clock / Cycle Clock (both
 * cycleModel-only, rendered inside the shared `.container`, which now itself `composes: toolContainer`),
 * Mining / Power Law / Sats (each embeds the REAL tool's main content PLUS its own input panel, stacked in
 * a `.faceStack` in that tool's own mobile DOM order — mining/powerlaw panel-first, sats main-first,
 * mirroring the presence/absence of AppShell's converter-only `order` override; at ≥768px `.faceStack`
 * goes two-column mirroring AppShell's own 280px/1fr shell grid, with `.facePanel` pinning the panel to
 * the left column regardless of each face's own mobile DOM order), and the gated `defense`
 * face (embeds the shared `CbDefenseTool` — the same Emergency/Liq-Sim mode gate used by the `liqsim` tab
 * in AppShell — hidden entirely when `!hasCbLoan`), plus the own-container Ledger / Scenario / Cycling
 * faces (the last also `hasCbLoan`-gated). Every embedded tool brings its OWN already-shipped
 * `toolContainer`-composed width — the hub adds none of its own (§8 toolContainer adoption is now CLOSED:
 * EmergencyConsole/LiqSimulator, Mining/PowerLaw/Converter, and AlmanacView's own `.container` all compose
 * from the same `toolShell.module.css`). Holds the local face state (DEFAULT halving, §14.3 — nothing
 * persisted, nothing synced). P3: the single useChainTip lives HERE and feeds the SAME height/mode to the
 * two clock faces, so switching faces is pure presentation and never remounts the data layer (§14.5 by
 * construction) — Mining/PowerLaw/Sats/defense don't consume it at all. The eyebrow badge is the
 * live-block-height toggle (device-local; one-time consent on first enable).
 *
 * ⚠ FACE SWITCHING IS TAP-ONLY. The sub-nav pills are the SINGLE way to change face on every platform —
 * the horizontal swipe pager (SwipeStrip) was REMOVED, along with its `shouldStart` chart/edge exclusions,
 * the neighbour-pane preload, and the scoped `touch-action` rules that existed only to arbitrate against
 * it. Faces now own their own axes: charts scrub, tables scroll, sliders drag, and a vertical stroke that
 * starts anywhere scrolls the page. Do NOT re-introduce a pager here without re-deriving those exclusions.
 *
 * ISOLATION WALL (restated, unchanged): cycleModel/HalvingClock/CycleClock import nothing from the
 * risk/position core (§2); emergencyModel imports nothing from cycleModel/power-law (§7). Co-locating all
 * six faces under one hub is navigation only — it crosses neither wall.
 */
type Face = 'halving' | 'cycle' | 'mining' | 'powerlaw' | 'sats' | 'defense' | 'ledger' | 'scenario' | 'cycling' | 'ownership';

export default function AlmanacView() {
  const [face, setFace] = useState<Face>('halving');
  const [consentOpen, setConsentOpen] = useState(false);

  const tip = useChainTip();
  const almanacLiveEnabled = useStore((s) => s.almanacLiveEnabled);
  const almanacLiveConsented = useStore((s) => s.almanacLiveConsented);
  const setAlmanacLiveEnabled = useStore((s) => s.setAlmanacLiveEnabled);
  const setAlmanacLiveConsented = useStore((s) => s.setAlmanacLiveConsented);
  const hasCbLoan = useStore((s) => s.hasCbLoan);
  const cbPaymentStrategy = useStore((s) => s.cbPaymentStrategy);
  const monthlyLog = useStore((s) => s.monthlyLog);
  const ledgerAvailable = ledgerFaceAvailable(monthlyLog);

  // If the defense face is showing and the CB loan gets turned off, fall back — the face would otherwise
  // render a tool with nothing to show.
  useEffect(() => {
    if (face === 'defense' && !hasCbLoan) setFace('halving');
  }, [face, hasCbLoan]);

  // If the ledger face is showing and the log empties, fall back (mirrors the defense pattern).
  useEffect(() => {
    if (face === 'ledger' && !ledgerAvailable) setFace('halving');
  }, [face, ledgerAvailable]);

  // Same fallback for the cycling face — the whole strategy is a Strike→Coinbase refinance loop, so
  // without a CB leg there is nothing to model.
  useEffect(() => {
    if (face === 'cycling' && !hasCbLoan) setFace('halving');
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

  // SINGLE source for the sub-nav pills — the only face-switching surface. Gated faces (defense/ledger)
  // are simply absent from the array.
  const visibleFaces: { key: Face; label: string }[] = [
    { key: 'halving',  label: '◔ Halving Clock' },
    { key: 'cycle',    label: '₿ Cycle Clock' },
    { key: 'mining',   label: '⛏ Mining' },
    { key: 'powerlaw', label: '₿ Power Law' },
    { key: 'sats',     label: '丰 Sats' },
    ...(hasCbLoan ? [{ key: 'defense' as Face, label: cbPaymentStrategy === 'ltvTriggered' ? '🚨 Emergency' : 'Liq Sim' }] : []),
    ...(ledgerAvailable ? [{ key: 'ledger' as Face, label: '▤ Ledger' }] : []),
    { key: 'scenario' as Face, label: '⚖ Scenario' },   // Phase 3b — ungated
    // ⚠ Appended LAST, and gated — `halving` must stay first: it is the default face.
    ...(hasCbLoan ? [{ key: 'cycling' as Face, label: '♻ Cycling' }] : []),
    { key: 'ownership' as Face, label: '⚖ Ownership' },   // S3 — UNGATED, after cycling
  ];

  // The face content for a face key. Pure presentation — switching faces never remounts the hub's
  // useChainTip (§14.5).
  const renderFace = (f: Face): ReactNode => {
    if (f === 'halving')  return <div className={styles.container}><HalvingClock height={tip.height} mode={tip.mode} /></div>;
    if (f === 'cycle')    return <div className={styles.container}><CycleClock height={tip.height} mode={tip.mode} onSwitchToHalving={() => setFace('halving')} /></div>;
    if (f === 'defense')  return <CbDefenseTool />;
    if (f === 'ledger')   return <LedgerFace />;
    if (f === 'cycling')  return <CyclingFace />;
    if (f === 'scenario') return <div className={styles.container}><ScenarioFace /></div>;
    if (f === 'mining')   return <div className={styles.faceStack}><div className={styles.facePanel}><MiningInputsPanel /></div><MiningMain /></div>;
    if (f === 'powerlaw') return <div className={styles.faceStack}><div className={styles.facePanel}><PowerLawSidebar /></div><PowerLawMain /></div>;
    // ⚠ MUST be an explicit branch ABOVE the final return — the fallback renders the Converter, so a
    // face added to the union without a branch here compiles clean and silently shows the wrong tool (C8).
    if (f === 'ownership') return <OwnershipFace />;
    return <div className={styles.faceStack}><ConverterMain /><div className={styles.facePanel}><ConverterSidebar /></div></div>;
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
          {visibleFaces.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`${styles.subnavBtn} ${face === f.key ? styles.subnavBtnOn : ''}`}
              onClick={() => setFace(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Only the selected face mounts — no neighbour panes, so a heavy face (Power Law/Mining hooks)
          mounts exactly when its pill is tapped. */}
      {renderFace(face)}

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
