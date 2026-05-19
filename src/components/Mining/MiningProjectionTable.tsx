import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useMiningSimulation } from '../../hooks/useMiningSimulation';
import { fmtMining, fmtMiningUSD } from '../../utils/format';
import styles from './MiningProjectionTable.module.css';

const DAYS_PER_MONTH = 365.25 / 12;

const SCENARIOS       = [150_000, 300_000, 1_000_000];
const SCENARIO_LABELS = ['$150k', '$300k', '$1M'];

export function MiningProjectionTable() {
  const currency        = useStore((s) => s.miningInputs.currency);
  const projectionYears = useStore((s) => s.miningInputs.projectionYears);
  const maxMonths       = projectionYears * 12;
  const { selected, btcPrice } = useMiningSimulation();

  const [selectedMonth, setSelectedMonth] = useState(maxMonths);

  const dailyEV_sats = selected.dailyEV_sats;

  const grossSats = Math.round(dailyEV_sats * DAYS_PER_MONTH * selectedMonth);
  const netSats   = grossSats;

  const totalElecCost_usd = selected.monthlyElecCost_usd * selectedMonth;

  return (
    <div className={styles.panel}>

      <div className={styles.stageHeader}>SAT ACCUMULATION</div>

      <div>
        <div className={styles.scrubberHeader}>
          <span className={styles.monthLabel}>
            Month <strong>{selectedMonth}</strong> of {maxMonths}
          </span>
          <span className={styles.satsLabel}>
            丰 {netSats.toLocaleString()} sats mined
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

      <div className={styles.breakdown}>
        <div className={styles.breakdownRow}>
          <span className={styles.breakdownLabel}>⛏ Mined</span>
          <span className={styles.breakdownValue}>
            丰 {grossSats.toLocaleString()} sats
          </span>
        </div>
        <div className={`${styles.breakdownRow} ${styles.breakdownElec}`}>
          <span className={styles.breakdownLabel}>⚡ Electricity</span>
          <span className={styles.breakdownValueMuted}>
            {fmtMiningUSD(selected.monthlyElecCost_usd)}/mo · {fmtMiningUSD(totalElecCost_usd)} total
          </span>
        </div>
        <div className={`${styles.breakdownRow} ${styles.breakdownNet}`}>
          <span className={styles.breakdownLabelBold}>NET ACCUMULATED</span>
          <span className={styles.breakdownValueBold}>
            丰 {netSats.toLocaleString()} sats
          </span>
        </div>
      </div>

      <div className={styles.elecNote}>
        Electricity paid in fiat · 100% of mined sats kept
      </div>

      <div className={styles.stageHeader} style={{ marginTop: 8 }}>
        IF BTC REACHES...
      </div>
      <div className={styles.stageNote}>USD value of 丰 {netSats.toLocaleString()} sats</div>

      <div className={styles.scenarioGrid}>
        {SCENARIOS.map((price, i) => {
          const value = (netSats / 100_000_000) * price;
          return (
            <div key={price} className={styles.scenarioCard}>
              <div className={styles.scenarioLabel}>{SCENARIO_LABELS[i]}</div>
              <div className={styles.scenarioValue}>
                {fmtMining(value, 'usd', btcPrice)}
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.disclaimer}>
        Constant difficulty assumed · Real earnings decrease as network hashrate rises
      </div>

    </div>
  );
}
