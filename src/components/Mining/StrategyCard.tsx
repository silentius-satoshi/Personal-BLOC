import type { MiningStrategyResult } from '../../simulation/types';
import type { MiningCurrency } from '../../simulation/types';
import { fmtMining } from '../../utils/format';
import styles from './StrategyCard.module.css';

const STRATEGY_COLOR: Record<string, string> = {
  solo:   '#FF4444',
  split:  '#F7931A',
  pooled: '#00C896',
};

interface Props {
  result: MiningStrategyResult;
  currency: MiningCurrency;
  btcPrice: number;
  active: boolean;
  onClick: () => void;
}

export function StrategyCard({ result, currency, btcPrice, active, onClick }: Props) {
  const color = STRATEGY_COLOR[result.id];
  const { lotteryOdds } = result;

  return (
    <button
      className={`${styles.card} ${active ? styles.active : ''}`}
      style={{ '--strategy-color': color } as React.CSSProperties}
      onClick={onClick}
    >
      <div className={styles.header}>
        <span className={styles.emoji}>{result.emoji}</span>
        <span className={styles.title} style={{ color: active ? color : undefined }}>
          {result.label.toUpperCase()}
        </span>
        {active && <span className={styles.activePip} style={{ background: color }} />}
      </div>

      <div className={styles.desc}>
        {result.poolSetup.map(p => `${p.deviceName} → ${p.poolName || '—'}`).join(' · ')}
      </div>

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Daily EV</span>
          <span className={styles.metricValue}>{fmtMining(result.dailyEV_usd, currency, btcPrice)}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Monthly Net</span>
          <span className={styles.metricValue}>{fmtMining(result.monthlyNet_usd, currency, btcPrice)}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Yearly Net</span>
          <span className={styles.metricValue}>{fmtMining(result.yearlyNet_usd, currency, btcPrice)}</span>
        </div>
      </div>

      {lotteryOdds && (
        <div className={styles.lottery}>
          <div className={styles.lotteryTitle}>
            🎯 LOTTERY ODDS
            {result.id === 'split' && <span className={styles.lotteryNote}> · 601 only</span>}
          </div>
          <div className={styles.lotteryRow}>
            1 in {Math.round(lotteryOdds.expectedYearsToBlock).toLocaleString()} per year
          </div>
          <div className={styles.lotteryRow}>
            Jackpot:{' '}
            {currency === 'btc'
              ? '3.12500000 BTC'
              : fmtMining(lotteryOdds.jackpotValue_usd, currency, btcPrice)}
            {currency === 'btc' && (
              <span className={styles.lotteryNote}> · block reward</span>
            )}
          </div>
        </div>
      )}
    </button>
  );
}
