import { useStore } from '../../store/useStore';
import type { MiningStrategy } from '../../store/useStore';
import { useMiningSimulation } from '../../hooks/useMiningSimulation';
import { CurrencyToggle } from './CurrencyToggle';
import { StrategyCard } from './StrategyCard';
import { MiningOddsBar } from './MiningOddsBar';
import { MiningProjectionTable } from './MiningProjectionTable';
import styles from './MiningMain.module.css';

export function MiningMain() {
  const setMiningStrategy     = useStore((s) => s.setMiningStrategy);
  const setMiningDevice       = useStore((s) => s.setMiningDevice);
  const devices               = useStore((s) => s.miningInputs.devices);
  const currency              = useStore((s) => s.miningInputs.currency);
  const selectedStrategyId    = useStore((s) => s.miningInputs.selectedStrategy);
  const { strategies, selected, btcPrice } = useMiningSimulation();

  function handleStrategySelect(strategy: MiningStrategy) {
    setMiningStrategy(strategy);
    devices.forEach((_, i) => {
      if (strategy === 'solo') {
        setMiningDevice(i, { soloMining: true });
      } else if (strategy === 'pooled') {
        setMiningDevice(i, { soloMining: false });
      } else {
        setMiningDevice(i, { soloMining: i === 0 });
      }
    });
  }

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
            onClick={() => handleStrategySelect(result.id)}
          />
        ))}
      </div>

      <MiningOddsBar currency={currency} btcPrice={btcPrice} />

<MiningProjectionTable />
    </div>
  );
}
