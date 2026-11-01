import { useCallback, useEffect, useState, type ReactNode } from 'react';
import HalvingClock from './HalvingClock';
import CycleClock from './CycleClock';
import FreshnessBadge from './FreshnessBadge';
import AlmanacConsentSheet from './AlmanacConsentSheet';
import { useChainTip } from '../../hooks/useChainTip';
import { useStore } from '../../store/useStore';
import { MiningInputsPanel } from '../Mining/MiningInputsPanel';
import { MiningMain } from '../Mining/MiningMain';
import { PowerLawFace } from '../PowerLaw/PowerLawFace';
import { ConverterMain } from '../Converter/ConverterMain';
import { ConverterSidebar } from '../Converter/ConverterSidebar';
import { CbDefenseTool } from '../Tools/CbDefenseTool';
import LedgerFace from './LedgerFace';
import ScenarioFace from './ScenarioFace';
import CyclingFace from './CyclingFace';
import OwnershipFace from './OwnershipFace';
import UnifiedFace from './UnifiedFace';
import DecisionFace from './DecisionFace';
import FireFace from './FireFace';
import FaceIcon from './FaceIcon';
import { faceShown, gridGroups, type Face } from './almanacGrid';
import { ledgerFaceAvailable } from '../../lib/ledgerCsv';
import { fireFaceOnDeploy } from '../../lib/fireDeploy';
import styles from './AlmanacView.module.css';

/**
 * Almanac — a HUB SHELL (the grid + face host; full mode's eyebrow) for THIRTEEN faces: Halving Clock / Cycle Clock
 * (both cycleModel-only, rendered inside the shared `.container`, which now itself `composes: toolContainer`),
 * Mining / Sats (each embeds the REAL tool's main content PLUS its own input panel, stacked in a `.faceStack` in
 * that tool's own mobile DOM order — mining panel-first, sats main-first, mirroring the presence/absence of
 * AppShell's converter-only `order` override; at ≥768px `.faceStack` goes two-column mirroring AppShell's own
 * 280px/1fr shell grid, with `.facePanel` pinning the panel to the left column regardless of each face's own
 * mobile DOM order), the Power Law face (`PowerLawFace` — rendered BARE, in the four faces' one column; the
 * full-mode Power Law tab mounts the same component — spec pbloc-spec-powerlaw-face-v1), and the gated `defense`
 * face (embeds the shared `CbDefenseTool` — the same Emergency Console gate used by the `liqsim` tab
 * in AppShell — hidden entirely when `!hasCbLoan`), plus the own-container Ledger / Scenario / Cycling /
 * Ownership / Strategy / Decision / FIRE faces (Cycling and Strategy `hasCbLoan`-gated; Strategy is one engine run read
 * through both the Ownership and the Cycling lens; FIRE is the sell lane — batch 1 build 4 — shown on the owner's deploy and in
 * dev only, build 4b). Every embedded tool brings its OWN width — the hub adds none
 * of its own (§8 toolContainer adoption is now CLOSED: EmergencyConsole, Mining/Converter, and
 * AlmanacView's own `.container` all compose from the same `toolShell.module.css`; the faces, Power Law's
 * included, compose CyclingFace's 960px `.face`). Holds the local face state (nothing persisted, nothing synced). P3: the
 * single useChainTip lives HERE and feeds the SAME height/mode to the
 * two clock faces, so switching faces is pure presentation and never remounts the data layer (§14.5 by
 * construction) — Mining/PowerLaw/Sats/defense don't consume it at all, and no face fetches a block height of
 * its own (D2), so the badge's "live off" holds everywhere. The badge is the live-block-height toggle (device-local;
 * one-time consent on first enable); it heads the grid's Bitcoin group, whose two clocks read the height and say
 * "live" or "estimate" themselves.
 *
 * THE GRID (BL40, BL45 — the owner's pick B). The hub opens on its faces as tiles in two groups — your plan's, then
 * bitcoin's — each a line icon over its name (`FaceIcon`); `almanacGrid.ts` is the ONE rule for which faces show, in
 * which group and order, from the three gates read here. A tap opens the face in place of the grid. On a face the
 * header's "Almanac" is the link back to the grid (`registerTitleLink` — the owner's ask, 2026-10-31: nothing between
 * the header and the page), where the face just left is ringed; the header's "←" still leaves the Almanac in one
 * tap. Full mode has no header, so the hub keeps a one-row eyebrow there, whose "Almanac" is that link on a face. The
 * edge swipe goes one level, as in Settings: a face → the grid → out (`registerBack`). A face the plan's link opens
 * (`initialFace`) swipes straight out, as before the grid, until the owner moves inside the hub; its header's
 * "Almanac" goes to the grid all the same. A gate that closes on an open face returns to the grid, where its tile has
 * gone too.
 *
 * ⚠ FACE SWITCHING IS TAP-ONLY. The grid's tiles (and a face's own links to another) are the way to change face on
 * every platform — the horizontal swipe pager (SwipeStrip) was REMOVED, along with its `shouldStart` chart/edge
 * exclusions, the neighbour-pane preload, and the scoped `touch-action` rules that existed only to arbitrate against
 * it. Faces now own their own axes: charts scrub, tables scroll, sliders drag, and a vertical stroke that
 * starts anywhere scrolls the page. Do NOT re-introduce a pager here without re-deriving those exclusions.
 *
 * ISOLATION WALL (restated, unchanged): cycleModel/HalvingClock/CycleClock import nothing from the
 * risk/position core (§2); emergencyModel imports nothing from cycleModel/power-law (§7). Co-locating the
 * faces under one hub is navigation only — it crosses neither wall.
 */
/** A face the hub can be opened on — Run 3: the plan's "other price paths" link opens the Decision face. */
export type AlmanacFace = Face;

/** Where the FIRE face shows: the owner's deploy and dev, never the public deploy or the sandbox until its borrow lane
 *  ships (batch 1 build 4b — BL42). The two flags are read here, once, where the grid is built; the rule is pure. */
const FIRE_ON_THIS_DEPLOY = fireFaceOnDeploy({
  VITE_LANDING: import.meta.env.VITE_LANDING, VITE_DEMO: import.meta.env.VITE_DEMO,
});

interface AlmanacViewProps {
  /** Read at mount only (the hub mounts each time it is opened): a face to open on, from outside the hub — the plan's
   *  "other price paths" link. Absent → the grid. A gated face falls back to the grid by the effect below. */
  initialFace?: AlmanacFace;
  /** The edge swipe's one level (AppShell Branch I, as Settings' `registerBack`): a face opened inside the hub reports its
   *  way back to the grid; the grid — and a face the link opened — report null, so the swipe leaves the Almanac. */
  registerBack?: (fn: (() => void) | null) => void;
  /** The header's title (AppShell Branch I — simple mode): handed the way to the grid while a face is open — any face,
   *  the link's too — and null on the grid, so the header's "Almanac" is the link to the grid. Absent — full mode,
   *  which has no header — the hub draws its own eyebrow, whose "Almanac" is that link on a face. */
  registerTitleLink?: (fn: (() => void) | null) => void;
}

export default function AlmanacView({ initialFace, registerBack, registerTitleLink }: AlmanacViewProps = {}) {
  // The open face; null is the grid (BL45). The link opens its face directly.
  const [face, setFace] = useState<Face | null>(initialFace ?? null);
  // A face the link opened, until the owner moves inside the hub — its swipe leaves, as it did before the grid.
  const [fromOutside, setFromOutside] = useState(initialFace !== undefined);
  // The face just left, ringed on the grid. Session-only, like the face.
  const [lastFace, setLastFace] = useState<Face | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);

  const tip = useChainTip();
  const almanacLiveEnabled = useStore((s) => s.almanacLiveEnabled);
  const almanacLiveConsented = useStore((s) => s.almanacLiveConsented);
  const setAlmanacLiveEnabled = useStore((s) => s.setAlmanacLiveEnabled);
  const setAlmanacLiveConsented = useStore((s) => s.setAlmanacLiveConsented);
  const hasCbLoan = useStore((s) => s.hasCbLoan);
  const monthlyLog = useStore((s) => s.monthlyLog);
  const ledgerAvailable = ledgerFaceAvailable(monthlyLog);

  // A gated face whose gate closes while it is open — the loan switched off, the log emptied, or the FIRE face off this
  // deploy (build 4b — BL42; an `initialFace` of 'fire' lands here too) — goes back to the grid, where its tile is gone.
  useEffect(() => {
    if (face !== null && !faceShown(face, { hasCbLoan, ledgerAvailable, fireOnDeploy: FIRE_ON_THIS_DEPLOY })) setFace(null);
  }, [face, hasCbLoan, ledgerAvailable]);

  // Every way into a face from inside the hub — a tile, a face's own link to another — ends the link's "from outside".
  const openFace = (f: Face) => { setFace(f); setFromOutside(false); };
  const toGrid = useCallback(() => { setLastFace(face); setFace(null); setFromOutside(false); }, [face]);

  // The edge swipe's one level, reported to the host as Settings reports its page (null on the grid and for a face the
  // link opened — the swipe leaves the Almanac then).
  useEffect(() => {
    registerBack?.(face !== null && !fromOutside ? toGrid : null);
    return () => registerBack?.(null);
  }, [face, fromOutside, toGrid, registerBack]);

  // The header's "Almanac" (simple mode): the way to the grid from any face — the link's too — and none on the grid.
  useEffect(() => {
    registerTitleLink?.(face !== null ? toGrid : null);
    return () => registerTitleLink?.(null);
  }, [face, toGrid, registerTitleLink]);

  const handleBadgeTap = () => {
    if (almanacLiveEnabled) {
      setAlmanacLiveEnabled(false);            // off — silent
    } else if (almanacLiveConsented) {
      setAlmanacLiveEnabled(true);             // already consented — silent enable
    } else {
      setConsentOpen(true);                    // first enable — one-time consent
    }
  };

  const groups = gridGroups({ hasCbLoan, ledgerAvailable, fireOnDeploy: FIRE_ON_THIS_DEPLOY });

  // The face content for a face key. Pure presentation — switching faces never remounts the hub's
  // useChainTip (§14.5).
  const renderFace = (f: Face): ReactNode => {
    if (f === 'halving')  return <div className={styles.container}><HalvingClock height={tip.height} mode={tip.mode} /></div>;
    if (f === 'cycle')    return <div className={styles.container}><CycleClock height={tip.height} mode={tip.mode} onSwitchToHalving={() => openFace('halving')} /></div>;
    if (f === 'defense')  return <CbDefenseTool />;
    if (f === 'ledger')   return <LedgerFace />;
    if (f === 'cycling')  return <CyclingFace />;
    if (f === 'scenario') return <div className={styles.container}><ScenarioFace /></div>;
    if (f === 'mining')   return <div className={styles.faceStack}><div className={styles.facePanel}><MiningInputsPanel /></div><MiningMain /></div>;
    if (f === 'powerlaw') return <PowerLawFace />;
    // ⚠ MUST be an explicit branch ABOVE the final return — the fallback renders the Converter, so a
    // face added to the union without a branch here compiles clean and silently shows the wrong tool (C8).
    if (f === 'ownership') return <OwnershipFace />;
    if (f === 'unified')   return <UnifiedFace />;
    if (f === 'decision')  return <DecisionFace onNavigate={openFace} />;
    if (f === 'fire')      return <FireFace />;
    return <div className={styles.faceStack}><ConverterMain /><div className={`${styles.facePanel} ${styles.facePanelInset}`}><ConverterSidebar /></div></div>;
  };

  return (
    <div className={registerTitleLink ? `${styles.shell} ${styles.shellUnderHeader}` : styles.shell}>
      {/* Full mode has no header, so the hub names itself: the eyebrow, whose "Almanac" is the way to the grid on a
          face. Simple mode's header does both, and the page starts right under it. */}
      {!registerTitleLink && (
        <div className={styles.eyebrowBar}>
          <div className={styles.eyebrow}>
            {face === null
              ? <span className={styles.eyebrowLabel}>Almanac</span>
              : <button type="button" className={`${styles.eyebrowLabel} ${styles.eyebrowLink}`} onClick={toGrid}>Almanac</button>}
            <span className={styles.eyebrowLine} />
          </div>
        </div>
      )}

      {face === null ? (
        <div className={styles.container}>
          {/* The grid — the hub's page (BL45). A tile is a button named by its face, its icon decorative. */}
          <nav className={styles.grid} aria-label="Faces">
            {groups.map((g) => (
              <section key={g.group} className={styles.group} aria-labelledby={`almanac-group-${g.group}`}>
                <div className={styles.groupHead}>
                  <h2 id={`almanac-group-${g.group}`} className={styles.groupLabel}>{g.label}</h2>
                  {/* The live block height is bitcoin's — the two clocks read it — so its toggle heads that group. */}
                  {g.group === 'bitcoin' && (
                    <FreshnessBadge
                      enabled={almanacLiveEnabled}
                      mode={tip.mode}
                      source={tip.source}
                      lastUpdated={tip.lastUpdated}
                      isStale={tip.isStale}
                      onTap={handleBadgeTap}
                    />
                  )}
                </div>
                <div className={styles.tiles}>
                  {g.tiles.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className={`${styles.tile} ${t.key === lastFace ? styles.tileLast : ''}`}
                      onClick={() => openFace(t.key)}
                    >
                      <FaceIcon face={t.key} />
                      <span className={styles.tileName}>{t.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </nav>
        </div>
      ) : (
        // Only the open face mounts — none on the grid, no neighbour panes — so a heavy face (Power Law/Mining hooks)
        // mounts exactly when its tile is tapped.
        renderFace(face)
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
