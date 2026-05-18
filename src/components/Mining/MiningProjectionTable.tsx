import { useStore } from '../../store/useStore';
import { useMiningSimulation } from '../../hooks/useMiningSimulation';
import { fmtMining } from '../../utils/format';
import type { MiningCurrency } from '../../simulation/types';
import styles from './MiningProjectionTable.module.css';

function fmtHeader(price: number): string {
  if (price < 100) return '$' + price.toFixed(2);
  return '$' + Math.round(price).toLocaleString();
}

function fmtProjectionValue(sats: number, scenario: number, currency: MiningCurrency, btcPrice: number): string {
  const usd = (sats / 100_000_000) * scenario;
  if (currency === 'usd')  return fmtMining(usd, 'usd', btcPrice);
  if (currency === 'sats') return `${sats.toLocaleString()} sats`;
  return `${(sats / 100_000_000).toFixed(8)} BTC`;
}

export function MiningProjectionTable() {
  const currency          = useStore((s) => s.miningInputs.currency);
  const { selected, btcPrice } = useMiningSimulation();

  const scenarios = [btcPrice, 150_000, 300_000, 1_000_000];
  const headers   = [`${fmtHeader(btcPrice)} now`, '$150k', '$300k', '$1M'];
  const yearlyNetSats = selected.dailyEV_sats * 365;

  return (
    <div className={styles.panel}>
      <div className={styles.titleRow}>
        <span className={styles.title}>SAT ACCUMULATION PROJECTION</span>
        <span className={styles.note}>constant difficulty assumed</span>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thYear}>Year</th>
              {headers.map((h, i) => (
                <th key={i} className={i === 0 ? styles.thLive : styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {selected.projection.map((row) => (
              <tr key={row.year}>
                <td className={styles.tdYear}>{row.year} yr</td>
                {scenarios.map((price, i) => (
                  <td key={i} className={i === 0 ? styles.tdLive : styles.td}>
                    {fmtProjectionValue(row.satsAccumulated, price, currency, btcPrice)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.footer}>
        Sats/year: ~{yearlyNetSats.toLocaleString()} · After electricity · No difficulty adj.
      </div>
      <div className={styles.disclaimer}>
        Projection assumes constant network difficulty and electricity rate.
        Real earnings decrease as network difficulty rises over time.
      </div>
    </div>
  );
}
