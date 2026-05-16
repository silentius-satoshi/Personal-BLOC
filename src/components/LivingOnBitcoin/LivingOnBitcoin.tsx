import { useStore } from '../../store/useStore';
import { useLivingSimulation } from '../../hooks/useLivingSimulation';
import { NetWorthChart } from './NetWorthChart';
import { ComparisonBanner } from './ComparisonBanner';
import { StrategyCards } from './StrategyCards';
import { StressTest } from './StressTest';
import styles from './LivingOnBitcoin.module.css';

export function LivingOnBitcoin() {
  const inflationRate = useStore((s) => s.inflationRate);

  const { noBtcResult, sellToLive, smartBloc, maxLeverage } = useLivingSimulation();

  const lastIdx = maxLeverage.monthlyData.length - 1;
  const finalBtcPrice = maxLeverage.monthlyData[lastIdx]?.btcPrice ?? 0;

  return (
    <div className={styles.content}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Living on Bitcoin</h1>
        <p className={styles.pageDesc}>
          See what Strike&apos;s Bitcoin Line of Credit can do for your life.
          Compare strategies: Max Leverage (Dangerous), Smart BLOC, Sell to Live, or no Bitcoin at all.
        </p>
      </div>

      <NetWorthChart
        noBtcResult={noBtcResult}
        sellToLive={sellToLive}
        smartBloc={smartBloc}
        maxLeverage={maxLeverage}
        inflationRate={inflationRate}
      />

      <ComparisonBanner
        smartBloc={smartBloc}
        sellToLive={sellToLive}
      />

      <StrategyCards
        maxLeverage={maxLeverage}
        smartBloc={smartBloc}
        sellToLive={sellToLive}
        noBtcResult={noBtcResult}
      />

      <StressTest
        maxLeverage={maxLeverage}
        smartBloc={smartBloc}
        finalBtcPrice={finalBtcPrice}
      />
    </div>
  );
}
