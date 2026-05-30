import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { useBtcPrice } from '../../hooks/useBtcPrice';
import { NumberInput } from '../ui/NumberInput';
import { SettingsDropdown } from './SettingsDropdown';
import { runBlocYearOne, getCollateralForTier } from '../../simulation/runBlocYearOne';
import { fmtUSD } from '../../utils/format';
import styles from './InputsPanel.module.css';

export function InputsPanel() {
  const income            = useStore((s) => s.income);
  const expenses          = useStore((s) => s.expenses);
  const btcPrice          = useStore((s) => s.btcPrice);
  const creditLine        = useStore((s) => s.creditLine);
  const blocApr           = useStore((s) => s.blocApr);
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

  const ltvCeiling = 0.15;
  const collateralBtc = effectiveCollateral;

  const uncappedResult = useMemo(
    () => runBlocYearOne({ collateralBtc, btcPrice, income, expenses, apr: blocApr / 100, ltvCeiling, creditLine: Infinity }),
    [collateralBtc, btcPrice, income, expenses, blocApr],
  );

  const peakBalance = Math.max(...uncappedResult.rows.map((r) => r.strikeBalance));
  const recommendedCreditLine = Math.ceil((peakBalance * 1.10) / 500) * 500;
  const creditLineIsAdequate = creditLine >= recommendedCreditLine;

  const breakEven = income / (1 + (blocApr / 100) / 12);
  const isSustainable = expenses <= breakEven;

  return (
    <div className={styles.panel}>
      <div className={styles.scrollArea}>
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

      <div className={styles.recommendations}>
        <div className={styles.recHeader}>RECOMMENDATIONS</div>

        <div className={styles.recRow}>
          <span className={styles.recLabel}>Credit line</span>
          <span className={styles.recValue}>{fmtUSD(creditLine)}</span>
        </div>
        <div className={styles.recRow}>
          <span className={styles.recLabel}>Recommended min</span>
          <span className={`${styles.recValue} ${creditLineIsAdequate ? styles.recGreen : styles.recOrange}`}>
            {fmtUSD(recommendedCreditLine)}
            {creditLineIsAdequate
              ? <span className={styles.recBadgeGreen}> ✓</span>
              : <span className={styles.recBadgeOrange}> ↑</span>
            }
          </span>
        </div>
        {!creditLineIsAdequate && (
          <div className={styles.recHint}>Increase credit line before starting</div>
        )}

        <div className={styles.recDivider} />

        <div className={styles.recRow}>
          <span className={styles.recLabel}>Break-even draw</span>
          <span className={styles.recValue}>{fmtUSD(Math.round(breakEven))}/mo</span>
        </div>
        <div className={styles.recRow}>
          <span className={styles.recLabel}>Your expenses</span>
          <span className={`${styles.recValue} ${isSustainable ? styles.recGreen : styles.recOrange}`}>
            {fmtUSD(expenses)}/mo
            {isSustainable
              ? <span className={styles.recBadgeGreen}> ✓</span>
              : <span className={styles.recBadgeOrange}> ↑</span>
            }
          </span>
        </div>
        {!isSustainable && (
          <div className={styles.recHint}>Draw exceeds break-even — balance will drift</div>
        )}
      </div>
    </div>
  );
}
