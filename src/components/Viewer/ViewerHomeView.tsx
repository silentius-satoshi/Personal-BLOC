import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { deriveSafetyView, deriveViewerOverall, selectSafetyViewInputs, type SafetyLevel } from '../../simulation/safetyView';
import { RadialGauge } from './RadialGauge';
import styles from './ViewerHomeView.module.css';

/**
 * Viewer Experience Revamp — V1.
 *
 * The dedicated, calm, READ-ONLY viewer home: three radial status gauges (Strike BLOC credit,
 * Strike BLOC LTV, Coinbase LTV) + a warm greeting + one overall status pill. Replaces the
 * Daily/Monthly surface as the viewer's only monitoring screen. C-safe DISPLAY only — renders the
 * ratios/levels the viewer already receives; no absolute figures, no snapshot stripping (that's V2).
 *
 * Reads the store directly (recomputes on price tick) and calls the shared deriveSafetyView so the
 * level math can't drift from the owner's SafetyDashboard. Inherently read-only — no inputs.
 */
export interface ViewerHomeViewProps {
  onOpenSettings: () => void;
}

const LEVEL_COLOR: Record<SafetyLevel, string> = {
  safe: 'var(--green)',
  watch: 'var(--amber)',
  act: 'var(--red)',
};

const BADGE: Record<SafetyLevel, string> = { safe: 'Safe', watch: 'Fair', act: 'Poor' };

const OVERALL_COPY: Record<SafetyLevel, string> = {
  safe: 'All positions safe',
  watch: 'Worth keeping an eye',
  act: 'Action needed',
};

function greetingTime(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

function relativeAge(ts: number | null): string {
  if (!ts) return 'syncing…';
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins <= 0) return 'updated just now';
  if (mins < 60) return `updated ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `updated ${hrs}h ago`;
  return `updated ${Math.floor(hrs / 24)}d ago`;
}

const CREDIT_SUB: Record<SafetyLevel, string> = {
  safe: 'Plenty of room left',
  watch: 'Limited room left',
  act: 'Very little room left',
};

const CB_SUB: Record<SafetyLevel, string> = {
  safe: 'Cushion comfortable',
  watch: 'Cushion tightening',
  act: 'Cushion very tight',
};

function strikeSub(level: SafetyLevel): string {
  if (level === 'safe') return 'Healthy cushion — safe even through a major drop';
  if (level === 'watch') return 'Getting tighter — worth a look';
  return 'Action needed';
}

export function ViewerHomeView({ onOpenSettings }: ViewerHomeViewProps) {
  // Shared store→inputs mapping (selectSafetyViewInputs), subscribed via useShallow so this re-renders
  // ONLY when one of the 12 mapped values changes — preserving the prior per-field reactivity.
  const inputs = useStore(useShallow(selectSafetyViewInputs));
  const view = deriveSafetyView(inputs);
  const hasCbLoan = inputs.hasCbLoan;
  const lastSync = useStore((s) => s.viewerLastSyncAt);

  const overall = deriveViewerOverall(view, hasCbLoan);

  return (
    <div className={styles.root}>
      <div className={styles.content}>
        {/* Header */}
        <header className={styles.appbar}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>₿</span>
            <span className={styles.brandName}>Personal ₿LOC</span>
          </div>
          <button className={styles.iconBtn} onClick={onOpenSettings} aria-label="Settings">
            ⚙
          </button>
        </header>

        {/* Greeting */}
        <div className={styles.greeting}>
          <h1 className={styles.greetTitle}>Good {greetingTime()}</h1>
          <p className={styles.greetSub}>{OVERALL_COPY[overall]}</p>
        </div>

        {/* Overall pill */}
        <div className={styles.pill}>
          <span className={styles.pillDot} style={{ background: LEVEL_COLOR[overall] }} />
          <span className={styles.pillText} style={{ color: LEVEL_COLOR[overall] }}>
            {OVERALL_COPY[overall]}
          </span>
          <span className={styles.pillAge}>{relativeAge(lastSync)}</span>
        </div>

        {/* Status cards */}
        <div className={styles.cards}>
          <StatusCard
            label="Strike BLOC credit"
            pct={view.capacityUsed * 100}
            level={view.creditLevel}
            sub={CREDIT_SUB[view.creditLevel]}
          />
          <StatusCard
            label="Strike BLOC LTV"
            pct={view.strikeLtv * 100}
            level={view.strikeLevel}
            sub={strikeSub(view.strikeLevel)}
          />
          {hasCbLoan && (
            <StatusCard
              label="Coinbase LTV"
              pct={view.cbLtv * 100}
              level={view.cbLevel}
              sub={CB_SUB[view.cbLevel]}
            />
          )}
        </div>
      </div>

      {/* Bottom nav */}
      <nav className={styles.bottomNav}>
        <button className={`${styles.navBtn} ${styles.navActive}`} aria-current="page">
          Home
        </button>
        <button className={styles.navBtn} onClick={onOpenSettings}>
          Settings
        </button>
      </nav>
    </div>
  );
}

function StatusCard({
  label,
  pct,
  level,
  sub,
}: {
  label: string;
  pct: number;
  level: SafetyLevel;
  sub: string;
}) {
  return (
    <div className={styles.card}>
      <RadialGauge pct={pct} color={LEVEL_COLOR[level]} label={`${label} ${Math.round(pct)}%`} />
      <div className={styles.cardBody}>
        <div className={styles.cardLabel}>{label}</div>
        <span className={styles.badge} style={{ color: LEVEL_COLOR[level], borderColor: LEVEL_COLOR[level] }}>
          {BADGE[level]}
        </span>
        <p className={styles.cardSub}>{sub}</p>
      </div>
    </div>
  );
}
