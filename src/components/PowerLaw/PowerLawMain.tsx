import { usePowerLawData } from '../../hooks/usePowerLawData';
import { PowerLawChart, PowerLawChartEmpty } from './PowerLawChart';
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

      {/* Loading and error show the chart's title row and a box the chart's height, so the box keeps its place when the
          chart arrives; only the swatch line under it appears then. The chart (its box and its swatches) renders only
          once the history has loaded, so nothing is listed while loading or on error. ONE error test in both
          branches: an empty error string still counts as an error, so the error box and the chart can never both
          render. */}
      {loading && <PowerLawChartEmpty text="Loading price history…" />}
      {!loading && error !== null && <PowerLawChartEmpty text="Price history unavailable" />}
      {!loading && error === null && <PowerLawChart historical={historical} bands={bands} />}

      <div className={styles.disclaimer}>
        Not financial advice. Power law models rely on historical pattern extrapolation.
      </div>
    </div>
  );
}
