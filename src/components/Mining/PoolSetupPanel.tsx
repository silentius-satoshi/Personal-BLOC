import type { MiningStrategyResult } from '../../simulation/types';
import styles from './PoolSetupPanel.module.css';

interface Props {
  result: MiningStrategyResult;
}

export function PoolSetupPanel({ result }: Props) {
  return (
    <div className={styles.panel}>
      <div className={styles.title}>RECOMMENDED POOL SETUP</div>
      {result.poolSetup.map((entry, i) => (
        <div key={i} className={styles.entry}>
          <div className={styles.deviceRow}>
            <span className={styles.deviceName}>{entry.deviceName}</span>
            <span className={styles.deviceHash}>· {entry.hashrateTH.toFixed(2)} TH/s</span>
          </div>
          <div className={styles.poolRow}>
            <span className={styles.poolName}>{entry.pool.name}</span>
            <span className={styles.poolFee}>· {entry.pool.feePercent}% fee</span>
            <span className={styles.poolType}>· {entry.type}</span>
            {entry.pool.lightning && <span className={styles.lightning}>⚡ Lightning</span>}
          </div>
          <div className={styles.stratum}>{entry.pool.stratum}</div>
        </div>
      ))}
      <div className={styles.legend}>⚡ = Lightning payouts available</div>
    </div>
  );
}
