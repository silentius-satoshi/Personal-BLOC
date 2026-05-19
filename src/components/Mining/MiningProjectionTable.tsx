import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useMiningSimulation } from '../../hooks/useMiningSimulation';
import { fmtMining } from '../../utils/format';
import styles from './MiningProjectionTable.module.css';

const DAYS_PER_MONTH = 365.25 / 12;

function fmtScenarioHeader(price: number): string {
  if (price >= 1_000_000) return '$' + (price / 1_000_000).toFixed(0) + 'M';
  if (price >= 1_000)     return '$' + Math.round(price / 1_000) + 'k';
  return '$' + Math.round(price).toLocaleString();
}

export function MiningProjectionTable() {
  const currency        = useStore((s) => s.miningInputs.currency);
  const projectionYears = useStore((s) => s.miningInputs.projectionYears);
  const maxMonths       = projectionYears * 12;
  const { selected, btcPrice } = useMiningSimulation();

  const [selectedMonth, setSelectedMonth] = useState(maxMonths);

  const dailyEV_sats    = selected.dailyEV_sats;
  const monthlyElecSats = Math.round(
    (selected.monthlyElecCost_usd / btcPrice) * 100_000_000
  );

  const grossSats = Math.round(dailyEV_sats * DAYS_PER_MONTH * selectedMonth);

  const scenarios = [btcPrice, 150_000, 300_000, 1_000_000];
  const headers   = [`${fmtScenarioHeader(btcPrice)} now`, '$150k', '$300k', '$1M'];

  const livePriceNetSats = Math.max(0, grossSats - monthlyElecSats * selectedMonth);

  return (
    <div className={styles.panel}>
      <div className={styles.titleRow}>
        <span className={styles.title}>SAT ACCUMULATION PROJECTION</span>
        <span className={styles.note}>constant difficulty assumed</span>
      </div>

      <div>
        <div className={styles.scrubberHeader}>
          <span className={styles.monthLabel}>
            Month <strong>{selectedMonth}</strong> of {maxMonths}
          </span>
          <span className={styles.satsLabel}>
            丰 {livePriceNetSats.toLocaleString()} sats
          </span>
        </div>

        <div className={styles.scrubberTrack}>
          <input
            type="range"
            min={1}
            max={maxMonths}
            step={1}
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className={styles.scrubberInput}
            style={{
              background: `linear-gradient(to right,
                var(--orange) 0%,
                var(--orange) ${((selectedMonth - 1) / (maxMonths - 1)) * 100}%,
                var(--border) ${((selectedMonth - 1) / (maxMonths - 1)) * 100}%,
                var(--border) 100%)`
            }}
          />
        </div>

        <div className={styles.yearTicks}>
          {Array.from({ length: projectionYears }, (_, i) => (
            <span
              key={i + 1}
              className={styles.yearTick}
              style={{ left: `${((i + 1) / projectionYears) * 100}%` }}
            >
              Yr {i + 1}
            </span>
          ))}
        </div>

        <div className={styles.hint}>
          Drag to scrub through any month of the {projectionYears}-year journey
        </div>
      </div>

      <div className={styles.grid}>
        {scenarios.map((price, i) => {
          const elecSats_at_price = Math.round(
            (selected.monthlyElecCost_usd / price) * 100_000_000
          ) * selectedMonth;
          const netSats_at_price = Math.max(0, grossSats - elecSats_at_price);
          const value = (netSats_at_price / 100_000_000) * price;
          const isLive = i === 0;
          return (
            <div key={price} className={`${styles.card} ${isLive ? styles.cardLive : ''}`}>
              <div className={styles.cardHeader}>{headers[i]}</div>
              <div className={styles.cardValue}>
                {fmtMining(value, currency, btcPrice)}
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.summary}>
        丰 {livePriceNetSats.toLocaleString()} sats at current price
      </div>

      <div className={styles.disclaimer}>
        Constant difficulty assumed. Real earnings decrease as network hashrate rises.
      </div>
    </div>
  );
}
