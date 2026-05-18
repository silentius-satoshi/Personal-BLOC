import { useStore } from '../../store/useStore';
import type { MiningCurrency } from '../../simulation/types';
import styles from './CurrencyToggle.module.css';

const OPTIONS: { value: MiningCurrency; label: string }[] = [
  { value: 'usd',  label: 'USD'  },
  { value: 'sats', label: 'sats' },
  { value: 'btc',  label: 'BTC'  },
];

export function CurrencyToggle() {
  const currency         = useStore((s) => s.miningInputs.currency);
  const setMiningCurrency = useStore((s) => s.setMiningCurrency);

  return (
    <div className={styles.toggle}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          className={`${styles.option} ${currency === o.value ? styles.active : ''}`}
          onClick={() => setMiningCurrency(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
