import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useBtcPrice } from '../../hooks/useBtcPrice';
import { useMiningSimulation } from '../../hooks/useMiningSimulation';
import { fmtMining } from '../../utils/format';
import { SliderInput } from '../ui/SliderInput';
import { NumberInput } from '../ui/NumberInput';
import { Toggle } from '../ui/Toggle';
import styles from './MiningInputsPanel.module.css';

export function MiningInputsPanel() {
  const miningInputs      = useStore((s) => s.miningInputs);
  const setMiningInputs   = useStore((s) => s.setMiningInputs);
  const setMiningDevice   = useStore((s) => s.setMiningDevice);
  const addMiningDevice   = useStore((s) => s.addMiningDevice);
  const removeMiningDevice = useStore((s) => s.removeMiningDevice);
  const { livePrice }     = useBtcPrice();
  const { selected, btcPrice } = useMiningSimulation();
  const currency = miningInputs.currency;

  const [minersOpen,      setMinersOpen]      = useState(true);
  const [electricityOpen, setElectricityOpen] = useState(true);
  const [networkOpen,     setNetworkOpen]     = useState(false);
  const [projectionOpen,  setProjectionOpen]  = useState(true);
  const [priceManual,     setPriceManual]     = useState(miningInputs.btcPriceOverride !== null);

  const enabledDevices = miningInputs.devices.filter(d => d.enabled);
  const totalHashTH    = enabledDevices.reduce((s, d) => s + d.hashrateTH, 0);
  const totalPowerW    = enabledDevices.reduce((s, d) => s + d.powerW, 0);
  const monthlyElec    = (totalPowerW / 1000) * 24 * 30 * (miningInputs.electricityRateCents / 100);

  function togglePriceMode(manual: boolean) {
    setPriceManual(manual);
    if (!manual) {
      setMiningInputs({ btcPriceOverride: null });
    } else {
      setMiningInputs({ btcPriceOverride: livePrice ?? btcPrice });
    }
  }

  return (
    <div className={styles.panel}>
      {/* YOUR MINERS */}
      <button className={styles.collapsibleHeader} onClick={() => setMinersOpen(o => !o)}>
        <span>{minersOpen ? '▾' : '▸'} YOUR MINERS</span>
      </button>

      {minersOpen && (
        <>
          {miningInputs.devices.map((device, i) => (
            <div key={i} className={styles.deviceBlock}>
              <div className={styles.deviceRow}>
                <span className={styles.deviceName}>{device.name}</span>
                <Toggle
                  value={device.enabled}
                  onChange={(v) => setMiningDevice(i, { enabled: v })}
                />
                <button
                  className={styles.trashBtn}
                  onClick={() => removeMiningDevice(i)}
                  disabled={miningInputs.devices.length === 1}
                  title="Remove miner"
                >
                  🗑
                </button>
              </div>
              <SliderInput
                label="Hashrate"
                value={device.hashrateTH}
                onChange={(v) => setMiningDevice(i, { hashrateTH: v })}
                min={0.1}
                max={5.0}
                step={0.01}
                display={`${device.hashrateTH.toFixed(2)} TH/s`}
                minLabel="0.1"
                maxLabel="5.0 TH/s"
              />
              <SliderInput
                label="Power"
                value={device.powerW}
                onChange={(v) => setMiningDevice(i, { powerW: v })}
                min={5}
                max={100}
                step={0.1}
                display={`${device.powerW.toFixed(1)} W`}
                minLabel="5W"
                maxLabel="100W"
              />
            </div>
          ))}

          <div className={styles.totalRow}>
            <span className={styles.totalLabel}>TOTAL</span>
            <span className={styles.totalValue}>{totalHashTH.toFixed(2)} TH/s · {totalPowerW.toFixed(1)} W</span>
          </div>

          <button className={styles.addMinerBtn} onClick={addMiningDevice}>
            + Add Miner
          </button>
        </>
      )}

      <hr className={styles.divider} />

      {/* ELECTRICITY */}
      <button className={styles.collapsibleHeader} onClick={() => setElectricityOpen(o => !o)}>
        <span>{electricityOpen ? '▾' : '▸'} ELECTRICITY</span>
      </button>

      {electricityOpen && (
        <>
          <SliderInput
            label="Rate"
            value={miningInputs.electricityRateCents}
            onChange={(v) => setMiningInputs({ electricityRateCents: v })}
            min={5}
            max={50}
            step={1}
            display={`${miningInputs.electricityRateCents}¢/kWh`}
            minLabel="5¢"
            maxLabel="50¢"
          />
          <div className={styles.derivedRow}>
            <span className={styles.derivedLabel}>Monthly Cost</span>
            <span className={styles.derivedValue}>${monthlyElec.toFixed(2)}/mo</span>
          </div>
        </>
      )}

      <hr className={styles.divider} />

      {/* NETWORK (collapsible, default closed) */}
      <button className={styles.collapsibleHeader} onClick={() => setNetworkOpen(o => !o)}>
        <span>{networkOpen ? '▾' : '▸'} NETWORK SETTINGS</span>
      </button>

      {networkOpen && (
        <div className={styles.networkBox}>
          <SliderInput
            label="Network Hashrate"
            value={miningInputs.networkHashrateEH}
            onChange={(v) => setMiningInputs({ networkHashrateEH: v })}
            min={100}
            max={5000}
            step={50}
            display={`${miningInputs.networkHashrateEH.toLocaleString()} EH/s`}
            minLabel="100 EH"
            maxLabel="5,000 EH"
          />

          <div className={styles.priceToggleRow}>
            <span className={styles.derivedLabel}>BTC Price</span>
            <div className={styles.priceModeToggle}>
              <button
                className={`${styles.modeBtn} ${!priceManual ? styles.modeBtnActive : ''}`}
                onClick={() => togglePriceMode(false)}
              >
                LIVE
              </button>
              <button
                className={`${styles.modeBtn} ${priceManual ? styles.modeBtnActive : ''}`}
                onClick={() => togglePriceMode(true)}
              >
                MANUAL
              </button>
            </div>
          </div>

          {priceManual ? (
            <NumberInput
              value={miningInputs.btcPriceOverride ?? btcPrice}
              onChange={(v) => setMiningInputs({ btcPriceOverride: v })}
              min={10000}
              max={1000000}
              step={1000}
              prefix="$"
              label="BTC Price Override"
            />
          ) : (
            <div className={styles.livePriceNote}>
              Live: ${(livePrice ?? btcPrice).toLocaleString()}
            </div>
          )}
        </div>
      )}

      <hr className={styles.divider} />

      {/* PROJECTION */}
      <button className={styles.collapsibleHeader} onClick={() => setProjectionOpen(o => !o)}>
        <span>{projectionOpen ? '▾' : '▸'} PROJECTION</span>
      </button>

      {projectionOpen && (
        <SliderInput
          label="Horizon"
          value={miningInputs.projectionYears}
          onChange={(v) => setMiningInputs({ projectionYears: v })}
          min={1}
          max={20}
          step={1}
          display={`${miningInputs.projectionYears} ${miningInputs.projectionYears === 1 ? 'year' : 'years'}`}
          minLabel="1 yr"
          maxLabel="20 yrs"
        />
      )}

      <hr className={styles.divider} />

      {/* SIDEBAR METRICS */}
      <div className={styles.sectionHeader}>Combined Fleet</div>
      <div className={styles.metricsStrip}>
        <div className={styles.metricRow}>
          <span className={styles.metricLabel}>Daily EV</span>
          <span className={styles.metricValue}>{fmtMining(selected.dailyEV_usd, currency, btcPrice)}</span>
        </div>
        <div className={styles.metricRow}>
          <span className={styles.metricLabel}>Monthly Net</span>
          <span className={styles.metricValue}>{fmtMining(selected.monthlyNet_usd, currency, btcPrice)}</span>
        </div>
        <div className={styles.metricRow}>
          <span className={styles.metricLabel}>Yearly Net</span>
          <span className={styles.metricValue}>{fmtMining(selected.yearlyNet_usd, currency, btcPrice)}</span>
        </div>
      </div>
    </div>
  );
}
