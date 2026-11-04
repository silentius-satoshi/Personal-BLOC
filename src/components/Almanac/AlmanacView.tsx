import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
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
import { ALMANAC_LIST, faceShown, firstListFace, gridGroups, VIEWER_WHAT_IF_NOTE, viewerWhatIfNoteShown, type Face } from './almanacGrid';
import { ViewerWhatIf } from '../ui/viewerWhatIf';
import { useSeenAsViewer } from './seenAsViewer';
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
 * which group and order, from the four gates read here. A tap opens the face in place of the grid. On a face the
 * header's "Almanac" is the link back to the grid (`registerTitleLink` — the owner's ask, 2026-10-31: nothing between
 * the header and the page), where the face just left is ringed; the header's "←" still leaves the Almanac in one
 * tap. Full mode has no header, so the hub keeps a one-row eyebrow there, whose "Almanac" is that link on a face. The
 * edge swipe goes one level, as in Settings: a face → the grid → out (`registerBack`). A face the plan's link opens
 * (`initialFace`) swipes straight out, as before the grid, until the owner moves inside the hub; its header's
 * "Almanac" goes to the grid all the same. A gate that closes on an open face returns to the grid, where its tile has
 * gone too.
 *
 * A COMPUTER (BL46's A — the owner's pick). From 1200 px (`ALMANAC_LIST`) the grid is a list of the same faces — its
 * groups, order, names and icons, from the same `gridGroups` — at the left, with the open face beside it: one click
 * between faces, and the list stays. There is no grid page, so no step back: the header's "Almanac" is plain, and the
 * edge swipe leaves the Almanac. A face is always open there — the one asked for, else the face last open in this
 * session while the list shows it, else Decision (`firstListFace`; in memory only — nothing persisted, nothing synced).
 * A gate that closes on the open face opens Decision. The badge sits under the list's Bitcoin heading. Narrower — a
 * phone, an iPad, a narrower window — the grid as above. The open face keeps its place in the tree across 1200 px (two
 * wrappers drawn `display: contents` on the grid's side), so resizing the window never remounts it.
 *
 * ⚠ FACE SWITCHING IS TAP-ONLY. The grid's tiles — the list's items on a computer — and a face's own links to another
 * are the way to change face on every platform — the horizontal swipe pager (SwipeStrip) was REMOVED, along with its
 * `shouldStart` chart/edge exclusions, the neighbour-pane preload, and the scoped `touch-action` rules that existed
 * only to arbitrate against it. Faces now own their own axes: charts scrub, tables scroll, sliders drag, and a
 * vertical stroke that starts anywhere scrolls the page. Do NOT re-introduce a pager here without re-deriving those
 * exclusions.
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

/** The face last open in this session (BL46's A): a computer's list reopens on it. In memory only — nothing persisted,
 *  nothing synced; a reload forgets it. One per lens (BL50): the owner's own hub and his trusted preview of his viewer's
 *  each keep their own, so neither opens on a face the other left open. */
const lastOpenFace: Record<'own' | 'seen', Face | null> = { own: null, seen: null };

interface AlmanacViewProps {
  /** Read at mount only (the hub mounts each time it is opened): a face to open on, from outside the hub — the plan's
   *  "other price paths" link. Absent → the grid, or on a computer the list, open on the face last open in this
   *  session while it shows, else Decision (`firstListFace`, BL46's A). A gated face falls back by the effect below —
   *  to the grid, or on a computer to `firstListFace`'s pick. */
  initialFace?: AlmanacFace;
  /** The edge swipe's one level (AppShell Branch I, as Settings' `registerBack`): a face opened inside the hub reports its
   *  way back to the grid; the grid — and a face the link opened — report null, so the swipe leaves the Almanac. So does
   *  a computer's list, which has no grid page to step back to (BL46's A). */
  registerBack?: (fn: (() => void) | null) => void;
  /** The header's title (AppShell Branch I — simple mode): handed the way to the grid while a face is open — any face,
   *  the link's too — and null on the grid, so the header's "Almanac" is the link to the grid; null beside a computer's
   *  list too, where the title is plain (BL46's A). Absent — full mode, which has no header — the hub draws its own
   *  eyebrow, whose "Almanac" is that link on a face (the list names itself instead). */
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
  // A computer (BL46's A): from 1200 px the faces are a list beside the open face — no grid page, no back step.
  const listMode = useMediaQuery(ALMANAC_LIST);

  const tip = useChainTip();
  const almanacLiveEnabled = useStore((s) => s.almanacLiveEnabled);
  const almanacLiveConsented = useStore((s) => s.almanacLiveConsented);
  const setAlmanacLiveEnabled = useStore((s) => s.setAlmanacLiveEnabled);
  const setAlmanacLiveConsented = useStore((s) => s.setAlmanacLiveConsented);
  const hasCbLoan = useStore((s) => s.hasCbLoan);
  const monthlyLog = useStore((s) => s.monthlyLog);
  const ledgerAvailable = ledgerFaceAvailable(monthlyLog);
  // BL48 — a trusted viewer's hub (a safe viewer never opens it — AppShell): the owner's-only faces leave it, and a plan
  // face's what-ifs are his to try, never saved. BL50 — the owner's trusted preview reads it the same way.
  const seenAsViewer = useSeenAsViewer();

  // A gated face whose gate closes while it is open — the loan switched off, the log emptied, or the FIRE face off this
  // deploy (build 4b — BL42; an `initialFace` of 'fire' lands here too) — goes back to the grid, where its tile is
  // gone; on a computer the list opens Decision (`firstListFace` — the closed face no longer shows).
  useEffect(() => {
    if (face !== null && !faceShown(face, { hasCbLoan, ledgerAvailable, fireOnDeploy: FIRE_ON_THIS_DEPLOY, viewer: seenAsViewer })) setFace(null);
  }, [face, hasCbLoan, ledgerAvailable, seenAsViewer]);

  // Every way into a face from inside the hub — a tile, a list item on a computer, a face's own link to another — ends
  // the link's "from outside".
  const openFace = (f: Face) => { setFace(f); setFromOutside(false); };
  const toGrid = useCallback(() => { setLastFace(face); setFace(null); setFromOutside(false); }, [face]);

  // The edge swipe's one level, reported to the host as Settings reports its page (null on the grid, for a face the link
  // opened, and beside a computer's list — the swipe leaves the Almanac then).
  useEffect(() => {
    registerBack?.(face !== null && !fromOutside && !listMode ? toGrid : null);
    return () => registerBack?.(null);
  }, [face, fromOutside, toGrid, registerBack, listMode]);

  // The header's "Almanac" (simple mode): the way to the grid from any face — the link's too — and none on the grid or
  // beside a computer's list (no grid page there).
  useEffect(() => {
    registerTitleLink?.(face !== null && !listMode ? toGrid : null);
    return () => registerTitleLink?.(null);
  }, [face, toGrid, registerTitleLink, listMode]);

  const handleBadgeTap = () => {
    if (almanacLiveEnabled) {
      setAlmanacLiveEnabled(false);            // off — silent
    } else if (almanacLiveConsented) {
      setAlmanacLiveEnabled(true);             // already consented — silent enable
    } else {
      setConsentOpen(true);                    // first enable — one-time consent
    }
  };

  const groups = gridGroups({ hasCbLoan, ledgerAvailable, fireOnDeploy: FIRE_ON_THIS_DEPLOY, viewer: seenAsViewer });
  // In the list a face is always open (BL46's A): with none asked for, the face last open in this session while it shows,
  // else Decision — drawn at once, and kept as the open face, so narrowing the window keeps it too.
  const memory = seenAsViewer ? 'seen' : 'own';
  const listFace: Face | null = listMode && face === null ? firstListFace(lastOpenFace[memory], groups) : null;
  useEffect(() => { if (listFace !== null) setFace(listFace); }, [listFace]);
  const shown: Face | null = face ?? listFace;
  useEffect(() => { if (shown !== null) lastOpenFace[memory] = shown; }, [shown, memory]);

  const badge = (
    <FreshnessBadge
      enabled={almanacLiveEnabled}
      mode={tip.mode}
      source={tip.source}
      lastUpdated={tip.lastUpdated}
      isStale={tip.isStale}
      onTap={handleBadgeTap}
    />
  );

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

  // The list (a computer — BL46's A) and the grid's side share one tree: two wrappers that the grid's side draws as
  // `display: contents`, so crossing the width never remounts the open face (its month, its stress, its open chip).
  return (
    <div className={registerTitleLink ? `${styles.shell} ${styles.shellUnderHeader}` : styles.shell}>
      {/* Full mode has no header, so the hub names itself — on the grid's side the eyebrow, whose "Almanac" is the way
          to the grid on a face; in the list, the list's title. Simple mode's header does both, and the page starts
          right under it. */}
      {!listMode && !registerTitleLink && (
        <div className={styles.eyebrowBar}>
          <div className={styles.eyebrow}>
            {face === null
              ? <span className={styles.eyebrowLabel}>Almanac</span>
              : <button type="button" className={`${styles.eyebrowLabel} ${styles.eyebrowLink}`} onClick={toGrid}>Almanac</button>}
            <span className={styles.eyebrowLine} />
          </div>
        </div>
      )}

      <div className={listMode ? styles.listLayout : styles.contents}>
        {listMode && (
          // The faces as a list at the left — the grid's groups, names and icons — the open face marked: one click
          // between faces, no grid page, no step back.
          <nav className={styles.list} aria-label="Faces">
            {!registerTitleLink && <div className={`${styles.eyebrowLabel} ${styles.listTitle}`}>Almanac</div>}
            {groups.map((g) => (
              <section key={g.group} className={styles.listGroup} aria-labelledby={`almanac-group-${g.group}`}>
                <h2 id={`almanac-group-${g.group}`} className={`${styles.groupLabel} ${styles.listHead}`}>{g.label}</h2>
                {/* The live block height is bitcoin's — its toggle under that group's heading (the list is narrow). */}
                {g.group === 'bitcoin' && <div className={styles.listBadge}>{badge}</div>}
                {g.tiles.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`${styles.listItem} ${t.key === shown ? styles.listItemOn : ''}`}
                    aria-current={t.key === shown ? 'page' : undefined}
                    onClick={() => openFace(t.key)}
                  >
                    <FaceIcon face={t.key} />
                    <span className={styles.listName}>{t.name}</span>
                  </button>
                ))}
              </section>
            ))}
          </nav>
        )}
        {shown === null ? (
          <div className={styles.container}>
            {/* The grid — the hub's page (BL45). A tile is a button named by its face, its icon decorative. */}
            <nav className={styles.grid} aria-label="Faces">
              {groups.map((g) => (
                <section key={g.group} className={styles.group} aria-labelledby={`almanac-group-${g.group}`}>
                  <div className={styles.groupHead}>
                    <h2 id={`almanac-group-${g.group}`} className={styles.groupLabel}>{g.label}</h2>
                    {/* The live block height is bitcoin's — the two clocks read it — so its toggle heads that group. */}
                    {g.group === 'bitcoin' && badge}
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
          // mounts exactly when it opens: its tile tapped, or on a computer its list item clicked or the list opening
          // on it. BL48 (V4 B): the faces are a what-if place — inside, a viewer's shared inputs unlock
          // (`ViewerWhatIf`; FIRE's face locks its own again) — and a viewer reads so over a plan face.
          <div className={listMode ? styles.pane : styles.contents}>
            {viewerWhatIfNoteShown(shown, seenAsViewer) && <p className={styles.viewerNote} role="note">{VIEWER_WHAT_IF_NOTE}</p>}
            <ViewerWhatIf.Provider value={true}>{renderFace(shown)}</ViewerWhatIf.Provider>
          </div>
        )}
      </div>

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
