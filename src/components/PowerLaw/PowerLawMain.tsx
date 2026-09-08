import { usePowerLawData } from '../../hooks/usePowerLawData';
import { PowerLawChart } from './PowerLawChart';
import styles from './PowerLawMain.module.css';

export function PowerLawMain() {
  const { historical, bands, loading, error } = usePowerLawData();

  return (
    <div className={styles.main}>
      <div className={styles.header}>
        <h2 className={styles.title}>Bitcoin Power Law</h2>
        <p className={styles.subtitle}>
          Log-log model by Giovanni Santostasi. Price follows a power law with time since the Genesis Block (Jan 3, 2009).
        </p>
      </div>

      {loading && (
        <div className={styles.loading}>Loading historical data…</div>
      )}
      {error && (
        <div className={styles.error}>Failed to load: {error}</div>
      )}
      {!loading && !error && (
        <div className={styles.chartBox}>
          <PowerLawChart historical={historical} bands={bands} />
        </div>
      )}

      <div className={styles.legend}>
        <span style={{ color: '#E85A4F' }}>– – Resistance</span>
        <span style={{ color: '#CCC' }}>—— Fair Value</span>
        <span style={{ color: '#4ECB82' }}>– – Support</span>
        <span style={{ color: '#E8836A' }}>—— BTC Price (historical)</span>
      </div>

      <div className={styles.disclaimer}>
        Not financial advice. Power law models rely on historical pattern extrapolation.
      </div>
    </div>
  );
}
