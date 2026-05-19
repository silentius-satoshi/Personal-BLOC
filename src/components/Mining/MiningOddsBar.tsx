import type { MiningCurrency } from '../../simulation/types';
import { useStore } from '../../store/useStore';
import { fmtMining } from '../../utils/format';
import styles from './MiningOddsBar.module.css';

interface Props {
  currency: MiningCurrency;
  btcPrice: number;
}

export function MiningOddsBar({ currency, btcPrice }: Props) {
  const devices           = useStore((s) => s.miningInputs.devices);
  const networkHashrateEH = useStore((s) => s.miningInputs.networkHashrateEH);

  const enabledDevices = devices.filter((d) => d.enabled);
  const soloDevices    = enabledDevices.filter((d) => d.soloMining);
  const soloHashTH     = soloDevices.reduce((sum, d) => sum + d.hashrateTH, 0);

  const dailyProb     = soloHashTH > 0
    ? (soloHashTH / (networkHashrateEH * 1_000_000)) * 144
    : 0;
  const annualProb    = 1 - Math.pow(1 - dailyProb, 365);
  const expectedYears = dailyProb > 0 ? Math.round(1 / (dailyProb * 365)) : null;
  const jackpotValue_usd = 3.125 * btcPrice;

  if (soloHashTH === 0) return null;

  const LOG_MIN = -10;
  const LOG_MAX = 0;
  const logProb = Math.log10(Math.max(annualProb, 1e-10));
  const barPct  = Math.max(0, Math.min(100, ((logProb - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 100));

  const jackpotDisplay = currency === 'btc'
    ? '3.12500000 BTC'
    : fmtMining(jackpotValue_usd, currency, btcPrice);

  return (
    <div className={styles.panel}>
      <div className={styles.title}>
        ANNUAL BLOCK PROBABILITY — {soloHashTH.toFixed(2)} TH/s on {networkHashrateEH.toLocaleString()} EH/s network
      </div>

      <div className={styles.barRow}>
        <div className={styles.barTrack}>
          <div className={styles.barFill} style={{ width: `${barPct}%` }} />
        </div>
        <span className={styles.barLabel}>{(annualProb * 100).toFixed(4)}%</span>
      </div>

      <div className={styles.stats}>
        <span>1 in {(expectedYears ?? 0).toLocaleString()} chance per year</span>
        <span>·</span>
        <span>Expected wait: ~{(expectedYears ?? 0).toLocaleString()} years</span>
      </div>
      <div className={styles.jackpot}>
        If found: {jackpotDisplay} jackpot
        {currency === 'btc' && <span className={styles.note}> · block reward, price-independent</span>}
      </div>
      <div className={styles.note}>Confirmed Bitaxe blocks found in 2024–2025: 5+</div>
    </div>
  );
}
