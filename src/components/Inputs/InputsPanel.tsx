import { useStore } from '../../store/useStore';
import { useBtcPrice } from '../../hooks/useBtcPrice';
import { NumberInput } from '../ui/NumberInput';
import { SettingsDropdown } from './SettingsDropdown';
import { getCollateralForTier } from '../../simulation/runBlocYearOne';
import styles from './InputsPanel.module.css';

export function InputsPanel() {
  const income            = useStore((s) => s.income);
  const expenses          = useStore((s) => s.expenses);
  const btcPrice          = useStore((s) => s.btcPrice);
  const creditLine        = useStore((s) => s.creditLine);
  const activeTier        = useStore((s) => s.activeTier);
  const customCollateral  = useStore((s) => s.customCollateral);
  const setIncome           = useStore((s) => s.setIncome);
  const setExpenses         = useStore((s) => s.setExpenses);
  const setBtcPrice         = useStore((s) => s.setBtcPrice);
  const setCreditLine       = useStore((s) => s.setCreditLine);
  const setActiveTier       = useStore((s) => s.setActiveTier);
  const setCustomCollateral = useStore((s) => s.setCustomCollateral);

  const effectiveCollateral = getCollateralForTier(activeTier, expenses, btcPrice, customCollateral);

  const { livePrice, lastUpdated } = useBtcPrice();

  const isSynced = livePrice !== null && Math.abs(btcPrice - livePrice) < 1;

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
          min={0}
          max={500000}
          step={100}
          prefix="$"
        />
        <NumberInput
          label="Monthly Expenses"
          value={expenses}
          onChange={setExpenses}
          min={0}
          max={200000}
          step={100}
          prefix="$"
        />
        <div className={styles.btcPriceRow}>
          <div className={styles.btcPriceLabelRow}>
            <span className={styles.fieldLabel}>BTC PRICE</span>
            <button
              className={`${styles.liveBadge} ${isSynced ? styles.liveBadgeSynced : ''}`}
              onClick={() => livePrice !== null && setBtcPrice(livePrice)}
              disabled={livePrice === null}
              title="Restore live price"
            >
              LIVE
            </button>
          </div>
          <NumberInput
            value={btcPrice}
            onChange={setBtcPrice}
            min={1000}
            max={5000000}
            step={1000}
            prefix="$"
          />
          {lastUpdated && <div className={styles.note}>Live — just updated</div>}
        </div>
        <NumberInput
          label="Credit Line"
          value={creditLine}
          onChange={setCreditLine}
          prefix="$"
          min={0}
          step={500}
        />
        <NumberInput
          label="Collateral (BTC)"
          value={parseFloat(effectiveCollateral.toFixed(5))}
          onChange={(v) => {
            setCustomCollateral(v);
            setActiveTier('custom');
          }}
          min={0.001}
          step={0.001}
          prefix="₿"
        />
      </div>
    </div>
  );
}
