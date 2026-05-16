import { useStore } from '../../store/useStore';
import { useBtcPrice } from '../../hooks/useBtcPrice';
import { SliderInput } from '../ui/SliderInput';
import { GrowthPresetPills } from '../ui/GrowthPresetPills';
import { LtvTypePills } from '../ui/LtvTypePills';
import { Toggle } from '../ui/Toggle';
import styles from './LivingInputsPanel.module.css';

function fmtUSD(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

export function LivingInputsPanel() {
  const btcHoldings      = useStore((s) => s.btcHoldings);
  const btcPrice         = useStore((s) => s.btcPrice);
  const income           = useStore((s) => s.income);
  const expenses         = useStore((s) => s.expenses);
  const annualBtcGrowth  = useStore((s) => s.annualBtcGrowth);
  const bearMarket       = useStore((s) => s.bearMarket);
  const inflationRate    = useStore((s) => s.inflationRate);
  const timeHorizonYears = useStore((s) => s.timeHorizonYears);

  const setBtcHoldings      = useStore((s) => s.setBtcHoldings);
  const setBtcPrice         = useStore((s) => s.setBtcPrice);
  const setIncome           = useStore((s) => s.setIncome);
  const setExpenses         = useStore((s) => s.setExpenses);
  const setAnnualBtcGrowth  = useStore((s) => s.setAnnualBtcGrowth);
  const setBearMarket       = useStore((s) => s.setBearMarket);
  const setInflationRate    = useStore((s) => s.setInflationRate);
  const setTimeHorizonYears = useStore((s) => s.setTimeHorizonYears);

  const { isLive } = useBtcPrice();

  const horizonLabel = timeHorizonYears === 1 ? '1 year' : `${timeHorizonYears} years`;

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>Your Bitcoin</div>
        <SliderInput
          label="BTC Holdings"
          value={btcHoldings}
          onChange={setBtcHoldings}
          min={0}
          max={100}
          step={0.01}
          display={`${btcHoldings.toFixed(2)} BTC`}
          minLabel="0"
          maxLabel="100 BTC"
        />
        <SliderInput
          label={isLive ? 'BTC Price — Live' : 'BTC Price'}
          value={btcPrice}
          onChange={setBtcPrice}
          min={20000}
          max={1000000}
          step={1000}
          display={fmtUSD(btcPrice)}
          minLabel="$20k"
          maxLabel="$1M"
        />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>Your Life</div>
        <SliderInput
          label="Monthly Income"
          value={income}
          onChange={setIncome}
          min={0}
          max={100000}
          step={100}
          display={fmtUSD(income)}
          minLabel="$0"
          maxLabel="$100k"
        />
        <SliderInput
          label="Monthly Expenses"
          value={expenses}
          onChange={setExpenses}
          min={0}
          max={100000}
          step={100}
          display={fmtUSD(expenses)}
          minLabel="$0"
          maxLabel="$100k"
        />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>Assumptions</div>

        <SliderInput
          label="BTC Annual Growth Rate"
          value={annualBtcGrowth}
          onChange={setAnnualBtcGrowth}
          min={-50}
          max={100}
          step={1}
          display={`${annualBtcGrowth}%`}
          minLabel="-50%"
          maxLabel="100%"
        />
        <GrowthPresetPills />
        <div className={styles.note}>BTC 10-year avg CAGR: ~84%</div>

        <div className={styles.toggleRow}>
          <span className={styles.toggleLabel}>Bear Market Phase</span>
          <Toggle
            checked={bearMarket}
            onChange={setBearMarket}
            label=""
          />
          <span className={styles.toggleState}>{bearMarket ? 'ON' : 'OFF'}</span>
        </div>

        <SliderInput
          label="Inflation Rate"
          value={inflationRate}
          onChange={setInflationRate}
          min={0}
          max={10}
          step={0.1}
          display={`${inflationRate.toFixed(1)}%`}
          minLabel="0%"
          maxLabel="10%"
        />
        <div className={styles.note}>Adjusts all outcomes to real purchasing power</div>

        <div className={styles.fieldLabel}>LTV Type</div>
        <LtvTypePills />

        <SliderInput
          label="Time Horizon"
          value={timeHorizonYears}
          onChange={setTimeHorizonYears}
          min={1}
          max={10}
          step={1}
          display={horizonLabel}
          minLabel="1 yr"
          maxLabel="10 yrs"
        />
      </div>
    </div>
  );
}
