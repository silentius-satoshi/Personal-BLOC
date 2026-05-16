import { useStore } from '../../store/useStore';
import type { StrategyResult } from '../../simulation/types';
import { fmtUSD } from '../../utils/format';
import styles from './ComparisonBanner.module.css';

interface Props {
  smartBloc: StrategyResult;
  sellToLive: StrategyResult;
}

const fmtDelta = (n: number): string =>
  n >= 1_000_000
    ? '$' + (n / 1_000_000).toFixed(1) + 'M'
    : n >= 1_000
    ? '$' + Math.round(n / 1_000) + 'k'
    : '$' + Math.round(n);

export function ComparisonBanner({ smartBloc, sellToLive }: Props) {
  const annualBtcGrowth  = useStore((s) => s.annualBtcGrowth);
  const timeHorizonYears = useStore((s) => s.timeHorizonYears);

  if (smartBloc.finalNetWorthNominal <= sellToLive.finalNetWorthNominal) return null;

  const delta = smartBloc.finalNetWorthNominal - sellToLive.finalNetWorthNominal;

  return (
    <div className={styles.banner}>
      <p className={styles.label}>SMART BLOC VS SELL TO LIVE</p>
      <p className={styles.body}>
        At {annualBtcGrowth}% BTC growth over {timeHorizonYears}{' '}
        {timeHorizonYears === 1 ? 'year' : 'years'}, Smart BLOC beats
        Sell to Live, even after {fmtUSD(smartBloc.finalInterestPaid)} in
        total interest. You're ahead by{' '}
        <span className={styles.delta}>{fmtDelta(delta)}</span>.
      </p>
    </div>
  );
}
