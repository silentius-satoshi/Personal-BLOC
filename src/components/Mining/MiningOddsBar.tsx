import type { MiningStrategyResult } from '../../simulation/types';
import type { MiningCurrency } from '../../simulation/types';
import { fmtMining } from '../../utils/format';
import styles from './MiningOddsBar.module.css';

interface Props {
  result: MiningStrategyResult;
  currency: MiningCurrency;
  btcPrice: number;
  networkHashrateEH: number;
}

export function MiningOddsBar({ result, currency, btcPrice, networkHashrateEH }: Props) {
  if (!result.lotteryOdds) return null;

  const { lotteryOdds, soloHashTH } = result;

  // Logarithmic bar: log10(annualProbability) from log10(1e-10) to log10(1)
  const LOG_MIN = -10;
  const LOG_MAX = 0;
  const logProb = Math.log10(Math.max(lotteryOdds.annualProbability, 1e-10));
  const barPct  = Math.max(0, Math.min(100, ((logProb - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 100));

  const jackpotDisplay = currency === 'btc'
    ? '3.12500000 BTC'
    : fmtMining(lotteryOdds.jackpotValue_usd, currency, btcPrice);

  return (
    <div className={styles.panel}>
      <div className={styles.title}>
        ANNUAL BLOCK PROBABILITY — {soloHashTH.toFixed(2)} TH/s on {networkHashrateEH.toLocaleString()} EH/s network
      </div>

      <div className={styles.barTrack}>
        <div className={styles.barFill} style={{ width: `${barPct}%` }} />
        <span className={styles.barLabel}>{(lotteryOdds.annualProbability * 100).toFixed(4)}%</span>
      </div>

      <div className={styles.stats}>
        <span>1 in {Math.round(lotteryOdds.expectedYearsToBlock).toLocaleString()} chance per year</span>
        <span>·</span>
        <span>Expected wait: ~{Math.round(lotteryOdds.expectedYearsToBlock).toLocaleString()} years</span>
      </div>
      <div className={styles.jackpot}>
        If found: {jackpotDisplay} jackpot
        {currency === 'btc' && <span className={styles.note}> · block reward, price-independent</span>}
      </div>
      <div className={styles.note}>Confirmed Bitaxe blocks found in 2024–2025: 5+</div>
    </div>
  );
}
