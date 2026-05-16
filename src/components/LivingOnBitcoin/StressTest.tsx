import type { StrategyResult } from '../../simulation/types';
import { fmtUSD } from '../../utils/format';
import styles from './StressTest.module.css';

interface Props {
  maxLeverage: StrategyResult;
  smartBloc: StrategyResult;
  finalBtcPrice: number;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

type BadgeType = 'safe' | 'margin' | 'liquidated';

function getBadge(crashLtv: number): BadgeType {
  if (crashLtv < 0.70) return 'safe';
  if (crashLtv < 0.85) return 'margin';
  return 'liquidated';
}

interface BarProps {
  label: string;
  crashLtv: number;
  finalLtv: number;
}

function CrashBar({ label, crashLtv, finalLtv }: BarProps) {
  const badge = getBadge(crashLtv);
  const fillPct = Math.min(crashLtv * 100, 100);

  const fillColor =
    badge === 'safe'       ? 'var(--green)' :
    badge === 'margin'     ? 'var(--amber)' :
                             'var(--red)';

  return (
    <div className={styles.barSection}>
      <div className={styles.barHeader}>
        <span className={styles.barLabel}>{label}</span>
        <div className={styles.barMeta}>
          <span className={styles.ltvText}>LTV: {fmtPct(finalLtv)}</span>
          <span
            className={`${styles.badge} ${
              badge === 'safe' ? styles.badgeSafe :
              badge === 'margin' ? styles.badgeMargin :
              styles.badgeLiquidated
            }`}
          >
            {badge === 'safe' ? 'Safe' : badge === 'margin' ? 'Margin Call' : 'Liquidated'}
          </span>
        </div>
      </div>
      <div className={styles.barTrack}>
        <div
          className={styles.barFill}
          style={{ width: `${fillPct}%`, background: fillColor }}
        />
        <div className={styles.refLine} style={{ left: '70%' }} />
        <div className={`${styles.refLine} ${styles.refLineRed}`} style={{ left: '85%' }} />
      </div>
      <div className={styles.barMarkers}>
        <span style={{ left: '70%' }} className={styles.markerLabel}>70%</span>
        <span style={{ left: '85%' }} className={styles.markerLabel}>85%</span>
      </div>
    </div>
  );
}

export function StressTest({ maxLeverage, smartBloc, finalBtcPrice }: Props) {
  const crashPrice = finalBtcPrice * 0.20;

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <div className={styles.title}>Crash Stress Test</div>
        <div className={styles.subtitle}>
          BTC price crashes: {fmtUSD(finalBtcPrice)} → {fmtUSD(crashPrice)}
        </div>
      </div>

      <div className={styles.bars}>
        <CrashBar
          label="Max Leverage"
          crashLtv={maxLeverage.crashLtv}
          finalLtv={maxLeverage.finalLtv}
        />
        <CrashBar
          label="Smart BLOC"
          crashLtv={smartBloc.crashLtv}
          finalLtv={smartBloc.finalLtv}
        />
      </div>

      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <div className={styles.refDot} style={{ background: 'var(--amber)' }} />
          <span>70% — Margin call risk</span>
        </div>
        <div className={styles.legendItem}>
          <div className={styles.refDot} style={{ background: 'var(--red)' }} />
          <span>85% — Liquidation threshold</span>
        </div>
      </div>
    </div>
  );
}
