import type { StrategyResult } from '../../simulation/types';
import styles from './ComparisonBanner.module.css';

interface Props {
  smartBloc: StrategyResult;
  sellToLive: StrategyResult;
  annualBtcGrowth: number;
  timeHorizonYears: number;
}

function fmtUSD(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v).toLocaleString()}`;
}

export function ComparisonBanner({ smartBloc, sellToLive, annualBtcGrowth, timeHorizonYears }: Props) {
  if (smartBloc.finalNetWorthNominal <= sellToLive.finalNetWorthNominal) return null;

  const advantage = smartBloc.finalNetWorthNominal - sellToLive.finalNetWorthNominal;
  const yearLabel = timeHorizonYears === 1 ? '1 year' : `${timeHorizonYears} years`;

  return (
    <div className={styles.banner}>
      <div className={styles.label}>Smart BLOC vs Sell to Live</div>
      <div className={styles.body}>
        At {annualBtcGrowth}% BTC growth over {yearLabel}, Smart BLOC beats Sell to Live,
        even after {fmtUSD(smartBloc.finalInterestPaid)} in total interest.
        You&apos;re ahead by <span className={styles.highlight}>{fmtUSD(advantage)}</span>.
      </div>
    </div>
  );
}
