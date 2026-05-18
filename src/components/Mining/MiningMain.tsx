import { useStore } from '../../store/useStore';
import { useMiningSimulation } from '../../hooks/useMiningSimulation';
import { CurrencyToggle } from './CurrencyToggle';
import { StrategyCard } from './StrategyCard';
import { MiningOddsBar } from './MiningOddsBar';
import { PoolSetupPanel } from './PoolSetupPanel';
import { MiningProjectionTable } from './MiningProjectionTable';
import styles from './MiningMain.module.css';

export function MiningMain() {
  const setMiningStrategy     = useStore((s) => s.setMiningStrategy);
  const currency              = useStore((s) => s.miningInputs.currency);
  const networkHashrateEH     = useStore((s) => s.miningInputs.networkHashrateEH);
  const selectedStrategyId    = useStore((s) => s.miningInputs.selectedStrategy);
  const { strategies, selected, btcPrice } = useMiningSimulation();

  return (
    <div className={styles.main}>
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <h2 className={styles.title}>Bitcoin Mining</h2>
          <p className={styles.subtitle}>Bitaxe Gamma home miner — three strategies compared</p>
        </div>
        <CurrencyToggle />
      </div>

      <div className={styles.strategyCards}>
        {strategies.map((result) => (
          <StrategyCard
            key={result.id}
            result={result}
            currency={currency}
            btcPrice={btcPrice}
            active={result.id === selectedStrategyId}
            onClick={() => setMiningStrategy(result.id)}
          />
        ))}
      </div>

      {selected.lotteryOdds && (
        <MiningOddsBar
          result={selected}
          currency={currency}
          btcPrice={btcPrice}
          networkHashrateEH={networkHashrateEH}
        />
      )}

      <PoolSetupPanel result={selected} />

      <MiningProjectionTable />
    </div>
  );
}
