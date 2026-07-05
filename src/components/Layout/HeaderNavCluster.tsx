import styles from './HeaderNavCluster.module.css';

/**
 * Owner IA — the SINGLE 5-icon header cluster that is the owner's primary navigation in simple mode.
 * Renders byte-identically on every simple-mode surface (Dashboard, Journal) so the nav never drifts.
 *
 * Order (LOCKED): Dashboard · Journal · Full mode · Almanac · Settings. The four app icons are inline
 * <svg> (Dashboard = gauge, Journal = ledger, Full mode + Almanac reuse the existing glyphs verbatim);
 * Settings is the ⚙ glyph exactly as before. The active surface's icon gets the highlight.
 *
 * GROWTH INVARIANT: this cluster is fixed at 5. Every future tool becomes an Almanac face (the existing
 * face-registration pattern), NEVER a new header icon — the Almanac is the app hub.
 */
export interface HeaderNavClusterProps {
  active: 'dashboard' | 'journal';
  onDashboard: () => void;
  onJournal: () => void;
  onFullMode: () => void;
  onAlmanac: () => void;
  onSettings: () => void;
}

export function HeaderNavCluster({
  active,
  onDashboard,
  onJournal,
  onFullMode,
  onAlmanac,
  onSettings,
}: HeaderNavClusterProps) {
  const cls = (on: boolean) => `${styles.iconBtn}${on ? ` ${styles.iconBtnActive}` : ''}`;
  return (
    <div className={styles.cluster}>
      {/* Dashboard — gauge/donut glyph */}
      <button
        className={cls(active === 'dashboard')}
        onClick={onDashboard}
        aria-label="Dashboard"
        aria-current={active === 'dashboard' ? 'page' : undefined}
        title="Dashboard"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M13.45 11.55 15.5 9.5" />
          <path d="M6.4 20a9 9 0 1 1 11.2 0Z" />
        </svg>
      </button>

      {/* Journal — ledger/notebook glyph (distinct from the Almanac book) */}
      <button
        className={cls(active === 'journal')}
        onClick={onJournal}
        aria-label="Journal"
        aria-current={active === 'journal' ? 'page' : undefined}
        title="Journal"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 19a2 2 0 0 1 2-2h14" />
          <path d="M5 17V3a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2Z" />
          <path d="M9 6h7M9 10h7" />
        </svg>
      </button>

      {/* Full mode — reuse the existing 4-rect grid glyph verbatim */}
      <button className={styles.iconBtn} onClick={onFullMode} aria-label="Switch to full app" title="Full mode">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.7"/>
          <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.7"/>
          <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor"/>
          <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor"/>
        </svg>
      </button>

      {/* Almanac — reuse the existing almanac book glyph verbatim */}
      <button className={styles.iconBtn} onClick={onAlmanac} aria-label="Almanac" title="Almanac">
        <svg width="15" height="15" viewBox="0 0 640 640" fill="currentColor" aria-hidden="true">
          <path d="M480 576L192 576C139 576 96 533 96 480L96 160C96 107 139 64 192 64L496 64C522.5 64 544 85.5 544 112L544 400C544 420.9 530.6 438.7 512 445.3L512 512C529.7 512 544 526.3 544 544C544 561.7 529.7 576 512 576L480 576zM192 448C174.3 448 160 462.3 160 480C160 497.7 174.3 512 192 512L448 512L448 448L192 448zM224 216C224 229.3 234.7 240 248 240L424 240C437.3 240 448 229.3 448 216C448 202.7 437.3 192 424 192L248 192C234.7 192 224 202.7 224 216zM248 288C234.7 288 224 298.7 224 312C224 325.3 234.7 336 248 336L424 336C437.3 336 448 325.3 448 312C448 298.7 437.3 288 424 288L248 288z"/>
        </svg>
      </button>

      {/* Settings — the ⚙ glyph, unchanged */}
      <button className={styles.iconBtn} onClick={onSettings} aria-label="Settings" title="Settings">⚙</button>
    </div>
  );
}
