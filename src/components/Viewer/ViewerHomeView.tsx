import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { deriveSafetyView, deriveViewerOverall, selectSafetyViewInputs, scaleSafetyView, type SafetyLevel } from '../../simulation/safetyView';
import { fmtUSD, relativeAge } from '../../utils/format';
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

interface ViewerSafetyResult {
  mode: 'safe' | 'trusted';
  capacityUsed: number; creditLevel: SafetyLevel;
  strikeLtv: number;    strikeLevel: SafetyLevel;
  cbLtv: number;        cbLevel: SafetyLevel;
  hasCbLoan: boolean;   overall: SafetyLevel;
  strikeDropPct: number;
  figures: null | {
    credit: { used: number; total: number; avail: number };
    strike: { liqPrice: number; balance: number };
    cb:     { liqPrice: number; balance: number };
  };
}

/**
 * The one seam that unifies C-safe (scaled from the shared snapshot) and C-trusted (live-derived from
 * the hydrated store) into a single render-ready shape. All hooks run unconditionally before the branch.
 */
function useViewerSafety(): ViewerSafetyResult {
  const safeSnap  = useStore((s) => s.viewerSafeSnapshot);
  const livePrice = useStore((s) => s.btcPrice);                    // live via AppShell's useBtcPrice()
  const inputs    = useStore(useShallow(selectSafetyViewInputs));   // trusted path (subscribed either way; harmless in safe mode)
  if (safeSnap) {
    const v = scaleSafetyView(safeSnap, livePrice);
    return {
      mode: 'safe',
      capacityUsed: v.capacityUsed, creditLevel: v.creditLevel,
      strikeLtv: v.strikeLtv, strikeLevel: v.strikeLevel,
      cbLtv: v.cbLtv, cbLevel: v.cbLevel,
      hasCbLoan: safeSnap.hasCbLoan, overall: v.overall,
      strikeDropPct: v.strikeDropPct, figures: null,
    };
  }
  const view = deriveSafetyView(inputs);
  const overall = deriveViewerOverall(view, inputs.hasCbLoan);
  const strikeLiqLtv = inputs.strikeLiquidationLtvPct / 100;
  const strikeDropPct = strikeLiqLtv > 0 ? Math.max(0, 1 - view.strikeLtv / strikeLiqLtv) : 0;
  const availCredit = inputs.creditLine - inputs.advisorActualBlocBalance;
  const strikeLiqPrice = inputs.currentBtcHeld > 0
    ? inputs.advisorActualBlocBalance / (inputs.currentBtcHeld * strikeLiqLtv)   // bloc / (btcHeld × liqLtv)
    : 0;
  return {
    mode: 'trusted',
    capacityUsed: view.capacityUsed, creditLevel: view.creditLevel,
    strikeLtv: view.strikeLtv, strikeLevel: view.strikeLevel,
    cbLtv: view.cbLtv, cbLevel: view.cbLevel,
    hasCbLoan: inputs.hasCbLoan, overall, strikeDropPct,
    figures: {
      credit: { used: inputs.advisorActualBlocBalance, total: inputs.creditLine, avail: availCredit },
      strike: { liqPrice: strikeLiqPrice, balance: inputs.advisorActualBlocBalance },
      cb:     { liqPrice: view.cbLiqPrice, balance: view.accruedBalance },
    },
  };
}

export function ViewerHomeView({ onOpenSettings }: ViewerHomeViewProps) {
  const s = useViewerSafety();
  const lastSync = useStore((st) => st.viewerLastSyncAt);
  const displayName = useStore((st) => st.viewerDisplayName);   // V3 — device-local, never synced
  const grantedRoles = useGrantedRoles();                       // V5 — dormant (renders nothing today)
  const f = s.figures;

  const creditSub = f ? `${fmtUSD(f.credit.used)} of ${fmtUSD(f.credit.total)} · ${fmtUSD(f.credit.avail)} available`
                      : CREDIT_SUB[s.creditLevel];
  const strikeSubLine = f ? `Liq at ~${fmtUSD(f.strike.liqPrice)} · ${fmtUSD(f.strike.balance)} balance`
                          : strikeSubSafe(s.strikeLevel, s.strikeDropPct);
  const cbSub = f ? `Liq at ~${fmtUSD(f.cb.liqPrice)} · ${fmtUSD(f.cb.balance)} balance`
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
          <button className={styles.iconBtn} onClick={onOpenSettings} aria-label="Settings">
            ⚙
          </button>
        </header>

        {/* Greeting */}
        <div className={styles.greeting}>
          <h1 className={styles.greetTitle}>Good {greetingTime()}{displayName ? `, ${displayName}` : ''}</h1>
          <p className={styles.greetSub}>{OVERALL_COPY[s.overall]}</p>
        </div>

        {/* Overall pill */}
        <div className={styles.pill}>
          <span className={styles.pillDot} style={{ background: LEVEL_COLOR[s.overall] }} />
          <span className={styles.pillText} style={{ color: LEVEL_COLOR[s.overall] }}>
            {OVERALL_COPY[s.overall]}
          </span>
          <span className={styles.pillAge}>{relativeAge(lastSync)}</span>
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
