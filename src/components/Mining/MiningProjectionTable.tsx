import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useMiningSimulation } from '../../hooks/useMiningSimulation';
import { fmtMining, fmtMiningUSD } from '../../utils/format';
import { SliderInput } from '../ui/SliderInput';
import styles from './MiningProjectionTable.module.css';

const DAYS_PER_MONTH    = 365.25 / 12;
const BLOCK_REWARD_SATS = 312_500_000;

const SCENARIOS       = [150_000, 300_000, 1_000_000];
const SCENARIO_LABELS = ['$150k', '$300k', '$1M'];

export function MiningProjectionTable() {
  const currency           = useStore((s) => s.miningInputs.currency);
  const projectionYears    = useStore((s) => s.miningInputs.projectionYears);
  const setMiningInputs    = useStore((s) => s.setMiningInputs);
  const devices            = useStore((s) => s.miningInputs.devices);
  const networkHashrateEH  = useStore((s) => s.miningInputs.networkHashrateEH);
  const maxMonths          = projectionYears * 12;
  const { selected, btcPrice } = useMiningSimulation();

  const [selectedMonth, setSelectedMonth] = useState(maxMonths);

  const enabledDevices = devices.filter((d) => d.enabled);
  const soloDevices    = enabledDevices.filter((d) => d.soloMining);
  const pooledDevices  = enabledDevices.filter((d) => !d.soloMining);

  const allSolo = enabledDevices.length > 0 && pooledDevices.length === 0;
  const isMixed = soloDevices.length > 0 && pooledDevices.length > 0;

  const totalHashTH    = enabledDevices.reduce((sum, d) => sum + d.hashrateTH, 0);
  const pooledHashTH   = pooledDevices.reduce((sum, d) => sum + d.hashrateTH, 0);
  const pooledFraction = totalHashTH > 0 ? pooledHashTH / totalHashTH : 0;

  const grossSats = Math.round(
    selected.dailyEV_sats * pooledFraction * DAYS_PER_MONTH * selectedMonth
  );

  const totalElecCost_usd = selected.monthlyElecCost_usd * selectedMonth;

  const soloHashTH    = soloDevices.reduce((sum, d) => sum + d.hashrateTH, 0);
  const dailyProb     = soloHashTH > 0
    ? (soloHashTH / (networkHashrateEH * 1_000_000)) * 144
    : 0;
  const annualProb    = 1 - Math.pow(1 - dailyProb, 365);
  const annualPct     = (annualProb * 100).toFixed(4);
  const expectedYears = dailyProb > 0 ? Math.round(1 / (dailyProb * 365)) : null;

  return (
    <div className={styles.panel}>

      <div className={styles.projectionControl}>
        <SliderInput
          label="Projection horizon"
          value={projectionYears}
          onChange={(v) => setMiningInputs({ projectionYears: v })}
          min={1}
          max={20}
          step={1}
          display={`${projectionYears} ${projectionYears === 1 ? 'year' : 'years'}`}
          minLabel="1 yr"
          maxLabel="20 yrs"
        />
      </div>

      <div className={styles.stageHeader}>SAT ACCUMULATION</div>

      {!allSolo ? (
        <>
          <div>
            <div className={styles.scrubberHeader}>
              <span className={styles.monthLabel}>
                Month <strong>{selectedMonth}</strong> of {maxMonths}
              </span>
              <span className={styles.satsLabel}>
                丰 {grossSats.toLocaleString()} sats mined
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
                {isMixed && <span className={styles.deviceHint}> (pooled miners only)</span>}
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
                丰 {grossSats.toLocaleString()} sats
              </span>
            </div>
          </div>

          <div className={styles.elecNote}>
            Electricity paid in fiat · 100% of mined sats kept
          </div>
        </>
      ) : (
        <div className={styles.allSoloNote}>
          All miners running solo — no daily payouts. Accumulation depends on finding a block.
        </div>
      )}

      {(allSolo || isMixed) && soloHashTH > 0 && (
        <div className={styles.lotteryBox}>
          <div className={styles.lotteryTitle}>
            🎰 {isMixed ? 'SOLO MINER LOTTERY' : 'FULLY SOLO — LOTTERY MODEL'}
          </div>
          {isMixed && (
            <div className={styles.lotteryDevice}>
              {soloDevices.map((d) => d.name).join(', ')} · {soloHashTH.toFixed(2)} TH/s
            </div>
          )}
          <div className={styles.lotteryStats}>
            <div className={styles.lotteryStat}>
              <span className={styles.lotteryLabel}>Annual win chance</span>
              <span className={styles.lotteryValue}>{annualPct}%</span>
            </div>
            <div className={styles.lotteryStat}>
              <span className={styles.lotteryLabel}>Expected wait</span>
              <span className={styles.lotteryValue}>
                {expectedYears != null ? `~${expectedYears.toLocaleString()} yrs` : '∞'}
              </span>
            </div>
            <div className={styles.lotteryStat}>
              <span className={styles.lotteryLabel}>Jackpot</span>
              <span className={styles.lotteryValue}>丰 312,500,000 sats</span>
            </div>
          </div>
          <div className={styles.lotteryNote}>
            Most likely {projectionYears}-year outcome from solo: $0
          </div>
        </div>
      )}

      <div className={styles.stageHeader} style={{ marginTop: 8 }}>
        IF BTC REACHES...
      </div>
      <div className={styles.stageNote}>USD value of 丰 {grossSats.toLocaleString()} sats</div>

      <div className={styles.scenarioGrid}>
        {SCENARIOS.map((price, i) => {
          const value = (grossSats / 100_000_000) * price;
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

      {(allSolo || isMixed) && (
        <>
          <div className={styles.stageHeader} style={{ marginTop: 8 }}>
            IF YOU FIND A BLOCK...
          </div>
          <div className={styles.stageNote}>One-time jackpot · 3.125 BTC</div>
          <div className={styles.scenarioGrid}>
            {SCENARIOS.map((price, i) => {
              const jackpot = (BLOCK_REWARD_SATS / 100_000_000) * price;
              return (
                <div key={price} className={`${styles.scenarioCard} ${styles.scenarioCardJackpot}`}>
                  <div className={styles.scenarioLabel}>{SCENARIO_LABELS[i]}</div>
                  <div className={styles.scenarioValue}>
                    {fmtMining(jackpot, 'usd', btcPrice)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className={styles.disclaimer}>
        Constant difficulty assumed · Real earnings decrease as network hashrate rises
      </div>

    </div>
  );
}
