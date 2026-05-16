import { useStore } from '../../store/useStore';
import { useBtcPrice } from '../../hooks/useBtcPrice';
import { NumberInput } from '../ui/NumberInput';
import { SettingsDropdown } from './SettingsDropdown';
import styles from './InputsPanel.module.css';

export function InputsPanel() {
  const income   = useStore((s) => s.income);
  const expenses = useStore((s) => s.expenses);
  const btcPrice = useStore((s) => s.btcPrice);
  const setIncome   = useStore((s) => s.setIncome);
  const setExpenses = useStore((s) => s.setExpenses);
  const setBtcPrice = useStore((s) => s.setBtcPrice);

  const { livePrice, lastUpdated } = useBtcPrice();

  const liveSubtext = livePrice !== null && lastUpdated
    ? `Live — just updated`
    : undefined;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Inputs</span>
        <SettingsDropdown />
      </div>

      <div className={styles.fields}>
        <NumberInput
          label="Monthly Income"
          value={income}
          onChange={setIncome}
          min={100}
          max={500000}
          step={100}
          prefix="$"
        />
        <NumberInput
          label="Monthly Expenses"
          value={expenses}
          onChange={setExpenses}
          min={100}
          max={200000}
          step={100}
          prefix="$"
        />
        <NumberInput
          label="BTC Price"
          value={btcPrice}
          onChange={setBtcPrice}
          min={1000}
          max={5000000}
          step={1000}
          prefix="$"
          subtext={liveSubtext}
        />
      </div>
    </div>
  );
}
