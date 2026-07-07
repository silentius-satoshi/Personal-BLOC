import { useEffect, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { SwipeStrip } from '../ui/SwipeStrip';
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
import { ledgerFaceAvailable } from '../../lib/ledgerCsv';
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
type Face = 'halving' | 'cycle' | 'mining' | 'powerlaw' | 'sats' | 'defense' | 'ledger';

/** A neighbour pane while paging (P3): the face LABEL only — the real face (with its heavy Power Law/Mining
 *  data hooks) materialises at rest after the snap commits (§14.5 + perf). aria-hidden — decorative. */
function FacePreviewCard({ label }: { label: string }) {
  return (
    <div className={styles.previewCard} aria-hidden="true">
      <span className={styles.previewLabel}>{label}</span>
    </div>
  );
}

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

  const handleBadgeTap = () => {
    if (almanacLiveEnabled) {
      setAlmanacLiveEnabled(false);            // off — silent
    } else if (almanacLiveConsented) {
      setAlmanacLiveEnabled(true);             // already consented — silent enable
    } else {
      setConsentOpen(true);                    // first enable — one-time consent
    }
  };

  // SINGLE source for BOTH the sub-nav pills AND the swipe pager — they can never disagree on which faces
  // exist or their order. Gated faces (defense/ledger) are simply absent from the array.
  const visibleFaces: { key: Face; label: string }[] = [
    { key: 'halving',  label: '◔ Halving Clock' },
    { key: 'cycle',    label: '₿ Cycle Clock' },
    { key: 'mining',   label: '⛏ Mining' },
    { key: 'powerlaw', label: '₿ Power Law' },
    { key: 'sats',     label: '丰 Sats' },
    ...(hasCbLoan ? [{ key: 'defense' as Face, label: cbPaymentStrategy === 'ltvTriggered' ? '🚨 Emergency' : 'Liq Sim' }] : []),
    ...(ledgerAvailable ? [{ key: 'ledger' as Face, label: '▤ Ledger' }] : []),
  ];
  const idx = visibleFaces.findIndex((f) => f.key === face);

  // The REAL face content for a face key (offset-0 pane). Pure presentation — face paging never remounts the
  // hub's useChainTip (§14.5).
  const renderFace = (f: Face): ReactNode => {
    if (f === 'halving')  return <div className={styles.container}><HalvingClock height={tip.height} mode={tip.mode} /></div>;
    if (f === 'cycle')    return <div className={styles.container}><CycleClock height={tip.height} mode={tip.mode} onSwitchToHalving={() => setFace('halving')} /></div>;
    if (f === 'defense')  return <CbDefenseTool />;
    if (f === 'ledger')   return <LedgerFace />;
    if (f === 'mining')   return <div className={styles.faceStack}><div className={styles.facePanel}><MiningInputsPanel /></div><MiningMain /></div>;
    if (f === 'powerlaw') return <div className={styles.faceStack}><div className={styles.facePanel}><PowerLawSidebar /></div><PowerLawMain /></div>;
    return <div className={styles.faceStack}><ConverterMain /><div className={styles.facePanel}><ConverterSidebar /></div></div>;
  };

  const renderPane = (offset: -1 | 0 | 1): ReactNode => {
    if (offset === 0) return renderFace(face);
    const target = visibleFaces[idx + offset];
    return target ? <FacePreviewCard label={target.label} /> : null;
  };
  const onPage = (dir: -1 | 1) => { const t = visibleFaces[idx + dir]; if (t) setFace(t.key); };
  const canPage = (dir: -1 | 1): boolean => idx + dir >= 0 && idx + dir < visibleFaces.length;
  // Charts always win over face paging (PowerLaw's recharts); the left 20px belongs to EdgeBackGesture.
  const shouldStart = (e: ReactPointerEvent) =>
    !(e.target as Element)?.closest?.('.recharts-wrapper, canvas, [data-gesture-exempt]') && e.clientX >= 20;

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

      {/* P3 — faces page via SwipeStrip (neighbours are lightweight preview cards; the real face lands at
          rest). Charts + the left edge-back zone are excluded via shouldStart. Highlight updates at commit. */}
      <SwipeStrip
        onPage={onPage}
        canPage={canPage}
        renderPane={renderPane}
        shouldStart={shouldStart}
      />

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
