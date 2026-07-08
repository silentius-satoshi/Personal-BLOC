import type { ReactNode } from 'react';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { selectSafetyViewInputs, computeViewerSafety, type SafetyLevel, type SafeSnapshot, type ViewerSafetyResult } from '../../simulation/safetyView';
import { fmtUSD, relativeAge } from '../../utils/format';
import { PriceChart } from '../SimpleMode/PriceChart';
import { RadialGauge } from './RadialGauge';
import { RolePill, useGrantedRoles } from './RolePill';
import styles from './ViewerHomeView.module.css';

/**
 * Viewer Experience Revamp — V1 + Viewer V2 (C-safe/C-trusted).
 *
 * The dedicated, calm, READ-ONLY viewer home: three radial status gauges (Strike BLOC credit,
 * Strike BLOC LTV, Coinbase LTV) + a warm greeting + one overall status pill. Gauges/pill/badges
 * render identically in either mode; only the SUB-LINES differ:
 *  - C-SAFE (default): the owner shared health ratios only → useViewerSafety scales them to the LIVE
 *    price (scaleSafetyView) and shows plain language + a live drop%. No absolutes exist to show.
 *  - C-TRUSTED (opt-in): the store is fully hydrated → live-derive via the shared deriveSafetyView and
 *    show real figures ($ used/available, liquidation prices) computed from the hydrated raw data.
 * Inherently read-only — no inputs. Recomputes on price tick.
 */
export interface ViewerHomeViewProps {
  onOpenSettings: () => void;
  previewSafeSnap?: SafeSnapshot | null;   // owner "Preview as viewer": inject the snap (safe) or null (force trusted live-derive); undefined = viewer device (store-driven)
  preview?: boolean;                       // owner preview → hide settings-nav affordances + bottom nav; pill age reads 'live preview'
  ownerNav?: ReactNode;                    // owner IA — the 5-icon header cluster (Dashboard active). Present ⇒ owner-dashboard mount: replaces the lone ⚙, suppresses the bottom nav, pill reads 'live'. viewer/preview never pass it → unchanged.
  notice?: ReactNode;                      // R2b-2 — a slim owner-only card above the greeting (NoPlanNotice). Rendered ONLY when ownerNav is present, so it can never reach a viewer or pollute Preview-as-viewer fidelity.
}

const LEVEL_COLOR: Record<SafetyLevel, string> = {
  safe: 'var(--green)',
  watch: 'var(--amber)',
  act: 'var(--red)',
};

const BADGE: Record<SafetyLevel, string> = { safe: 'Safe', watch: 'Fair', act: 'Poor' };

// Mirrors RadialGauge's own clamp + one-decimal (trailing-zero-stripped) formatting, so the a11y
// label always matches the visible gauge text.
function gaugePctLabel(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  return clamped % 1 === 0 ? clamped.toFixed(0) : clamped.toFixed(1);
}

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

// relativeAge moved to utils/format.ts (V4) — shared with ViewerSettings' sync-status row.

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

/** C-safe Strike sub-line — the plain V1 tone, with a LIVE drop-to-liquidation on the healthy case. */
function strikeSubSafe(level: SafetyLevel, dropPct: number): string {
  if (level === 'safe') return `Safe through a ~${Math.round(dropPct * 100)}% dip`;
  return strikeSub(level);
}

/**
 * The one seam that unifies C-safe (scaled from the shared snapshot) and C-trusted (live-derived from
 * the hydrated store) into a single render-ready shape. All store reads run UNCONDITIONALLY before the pick;
 * `injectedSafeSnap` (owner preview) wins over the store snap — a SafeSnapshot forces the safe path, `null`
 * forces the trusted live-derive, `undefined` (viewer device) falls back to the store. Pure core =
 * computeViewerSafety (safetyView.ts).
 */
export function useViewerSafety(injectedSafeSnap?: SafeSnapshot | null): ViewerSafetyResult {
  const storeSnap = useStore((s) => s.viewerSafeSnapshot);
  const livePrice = useStore((s) => s.btcPrice);                    // live via AppShell's useBtcPrice()
  const inputs    = useStore(useShallow(selectSafetyViewInputs));   // trusted path (subscribed either way; harmless in safe mode)
  const safeSnap  = injectedSafeSnap !== undefined ? injectedSafeSnap : storeSnap;
  return computeViewerSafety(safeSnap, livePrice, inputs);
}

export function ViewerHomeView({ onOpenSettings, previewSafeSnap, preview, ownerNav, notice }: ViewerHomeViewProps) {
  const s = useViewerSafety(previewSafeSnap);
  const lastSync = useStore((st) => st.viewerLastSyncAt);
  const displayName = useStore((st) => st.viewerDisplayName);   // V3 — device-local, never synced
  const grantedRoles = useGrantedRoles();                       // V5 — dormant (renders nothing today)
  const f = s.figures;

  const creditSub = f ? `${fmtUSD(f.credit.used)} of ${fmtUSD(f.credit.total)}\n${fmtUSD(f.credit.avail)} available`
                      : CREDIT_SUB[s.creditLevel];
  const strikeSubLine = f ? `Liq at ~${fmtUSD(f.strike.liqPrice)}\n${fmtUSD(f.strike.balance)} balance`
                          : strikeSubSafe(s.strikeLevel, s.strikeDropPct);
  const cbSub = f ? `Liq at ~${fmtUSD(f.cb.liqPrice)}\n${fmtUSD(f.cb.balance)} balance`
                  : CB_SUB[s.cbLevel];

  return (
    <div className={styles.root}>
      <div className={styles.content}>
        {/* Header */}
        <header className={styles.appbar}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>₿</span>
            <span className={styles.brandName}>Personal ₿LOC</span>
          </div>
          <RolePill roles={grantedRoles} />
          {ownerNav ? (
            ownerNav
          ) : !preview && (
            <button className={styles.iconBtn} onClick={onOpenSettings} aria-label="Settings">
              ⚙
            </button>
          )}
        </header>

        {/* R2b-2 — owner-only notice slot. `ownerNav` is the owner-dashboard discriminator (the real viewer and
            ViewerPreview never pass it), so this can't leak into a viewer surface. */}
        {ownerNav && notice}

        {/* Greeting */}
        <div className={styles.greeting}>
          <h1 className={styles.greetTitle}>Good {greetingTime()}{displayName ? `, ${displayName}` : ''}</h1>
        </div>

        {/* Live price context — public candles, self-fetching, privacy-clean for the viewer by construction */}
        <div className={styles.chartSlot}>
          <PriceChart />
        </div>

        {/* Overall pill */}
        <div className={styles.pill}>
          <span className={styles.pillDot} style={{ background: LEVEL_COLOR[s.overall] }} />
          <span className={styles.pillText} style={{ color: LEVEL_COLOR[s.overall] }}>
            {OVERALL_COPY[s.overall]}
          </span>
          <span className={styles.pillAge}>{preview ? 'live preview' : ownerNav ? 'live' : relativeAge(lastSync)}</span>
        </div>

        {/* Status cards */}
        <div className={styles.cards}>
          <StatusCard
            label="Strike BLOC credit"
            pct={s.capacityUsed * 100}
            level={s.creditLevel}
            sub={creditSub}
          />
          <StatusCard
            label="Strike BLOC LTV"
            pct={s.strikeLtv * 100}
            level={s.strikeLevel}
            sub={strikeSubLine}
          />
          {s.hasCbLoan && (
            <StatusCard
              label="Coinbase LTV"
              pct={s.cbLtv * 100}
              level={s.cbLevel}
              sub={cbSub}
            />
          )}
        </div>
      </div>

      {/* Bottom nav — hidden in owner preview AND on the owner dashboard (ownerNav supersedes it) */}
      {!preview && !ownerNav && (
        <nav className={styles.bottomNav}>
          <button className={`${styles.navBtn} ${styles.navActive}`} aria-current="page">
            Home
          </button>
          <button className={styles.navBtn} onClick={onOpenSettings}>
            Settings
          </button>
        </nav>
      )}
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
      <RadialGauge pct={pct} color={LEVEL_COLOR[level]} label={`${label} ${gaugePctLabel(pct)}%`} />
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
