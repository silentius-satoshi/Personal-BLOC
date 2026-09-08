import { useBtcPrice } from '../../hooks/useBtcPrice';
import { useMempoolData } from '../../hooks/useMempoolData';
import { plFairValue, plFloor, plCeiling } from '../../simulation/powerLaw';
import { fmtUSD } from '../../utils/format';
import styles from './PowerLawSidebar.module.css';

export function PowerLawSidebar() {
  const { livePrice } = useBtcPrice();
  const mempool = useMempoolData();

  const today   = new Date();
  const fair    = plFairValue(today);
  const floor   = plFloor(today);
  const ceiling = plCeiling(today);

  const deviation =
    livePrice != null ? ((livePrice - fair) / fair) * 100 : null;

  const deviationColor =
    deviation == null ? undefined
    : deviation >= 0  ? 'var(--green)'
    :                   'var(--red)';

  const halvingLine =
    mempool.loading ? '—'
    : mempool.daysUntilHalving != null && mempool.halvingYear != null
      ? `In ${mempool.daysUntilHalving.toLocaleString()} days (~${mempool.halvingYear})`
      : '—';

  const halvingBlock =
    mempool.nextHalvingBlock != null
      ? `Block #${mempool.nextHalvingBlock.toLocaleString()}`
      : null;

  return (
    <div className={styles.panel}>
      <div className={styles.sectionHeader}>Power Law Model</div>

      <div className={styles.stat}>
        <div className={styles.statLabel}>Current Price</div>
        <div className={styles.statValue}>
          {livePrice != null ? fmtUSD(livePrice) : '—'}
        </div>
      </div>

      <hr className={styles.divider} />

      <div className={styles.sectionHeader}>Today's Model</div>

      <div className={styles.stat}>
        <div className={styles.statLabel}>Resistance</div>
        <div className={styles.statValue} style={{ color: 'var(--red)' }}>
          {fmtUSD(ceiling)}
        </div>
      </div>

      <div className={styles.stat}>
        <div className={styles.statLabel}>Fair Value</div>
        <div className={styles.statValue}>{fmtUSD(fair)}</div>
      </div>

      <div className={styles.stat}>
        <div className={styles.statLabel}>Support</div>
        <div className={styles.statValue} style={{ color: 'var(--green)' }}>
          {fmtUSD(floor)}
        </div>
      </div>

      {deviation != null && (
        <div className={styles.stat}>
          <div className={styles.statLabel}>vs Fair Value</div>
          <div className={styles.statValue} style={{ color: deviationColor }}>
            {deviation >= 0 ? '+' : ''}{deviation.toFixed(1)}%
          </div>
        </div>
      )}

      <hr className={styles.divider} />

      <div className={styles.sectionHeader}>Bitcoin Network</div>

      <div className={styles.stat}>
        <div className={styles.statLabel}>Block Height</div>
        <div className={styles.statValue}>
          {mempool.loading ? '—'
            : mempool.blockHeight != null
              ? mempool.blockHeight.toLocaleString()
              : '—'}
        </div>
      </div>

      <div className={styles.stat}>
        <div className={styles.statLabel}>Next Halving</div>
        <div className={styles.statValue}>{halvingLine}</div>
        {halvingBlock && (
          <div className={styles.statSub}>{halvingBlock}</div>
        )}
      </div>

      <hr className={styles.divider} />

      <div className={styles.sectionHeader}>Key Projections</div>

      <div className={styles.note}>
        $100k floor: ~2028<br />
        $1M fair value: ~2033–2035<br />
        Formula: 1.16e‑17 × days^5.82
      </div>
    </div>
  );
}
