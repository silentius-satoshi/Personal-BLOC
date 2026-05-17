import { useStore } from '../../store/useStore';
import { useBtcPrice } from '../../hooks/useBtcPrice';
import { fmtUSD } from '../../utils/format';
import { SliderInput } from '../ui/SliderInput';
import { GrowthPresetPills } from '../ui/GrowthPresetPills';
import { LtvTypePills } from '../ui/LtvTypePills';
import { Toggle } from '../ui/Toggle';
import styles from './LivingInputsPanel.module.css';

export function LivingInputsPanel() {
  const btcHoldings      = useStore((s) => s.btcHoldings);
  const btcPrice         = useStore((s) => s.btcPrice);
  const income           = useStore((s) => s.income);
  const expenses         = useStore((s) => s.expenses);
  const annualBtcGrowth  = useStore((s) => s.annualBtcGrowth);
  const bearMarket       = useStore((s) => s.bearMarket);
  const bearPeriodYears  = useStore((s) => s.bearPeriodYears);
  const annualDecline    = useStore((s) => s.annualDecline);
  const inflationRate    = useStore((s) => s.inflationRate);
  const timeHorizonYears = useStore((s) => s.timeHorizonYears);

  const setBtcHoldings      = useStore((s) => s.setBtcHoldings);
  const setBtcPrice         = useStore((s) => s.setBtcPrice);
  const setIncome           = useStore((s) => s.setIncome);
  const setExpenses         = useStore((s) => s.setExpenses);
  const setAnnualBtcGrowth  = useStore((s) => s.setAnnualBtcGrowth);
  const setBearMarket       = useStore((s) => s.setBearMarket);
  const setBearPeriodYears  = useStore((s) => s.setBearPeriodYears);
  const setAnnualDecline    = useStore((s) => s.setAnnualDecline);
  const setInflationRate    = useStore((s) => s.setInflationRate);
  const setTimeHorizonYears = useStore((s) => s.setTimeHorizonYears);

  const { livePrice, lastUpdated } = useBtcPrice();

  const isSynced = livePrice !== null && Math.abs(btcPrice - livePrice) < 1;

  const liveBadge = (
    <button
      className={`${styles.liveBadge} ${isSynced ? styles.liveBadgeSynced : ''}`}
      onClick={() => livePrice !== null && setBtcPrice(livePrice)}
      disabled={livePrice === null}
      title="Restore live price"
    >
      LIVE
    </button>
  );

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
          display={`${String(btcHoldings)} BTC`}
          minLabel="0"
          maxLabel="100 BTC"
        />
        <SliderInput
          label="BTC Price"
          labelSuffix={liveBadge}
          value={btcPrice}
          onChange={setBtcPrice}
          min={20000}
          max={1000000}
          step={1000}
          display={fmtUSD(btcPrice)}
          minLabel="$20k"
          maxLabel="$1M"
        />
        {lastUpdated && <div className={styles.note}>Live — just updated</div>}
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
          display={`${annualBtcGrowth >= 0 ? '+' : ''}${annualBtcGrowth}%`}
          minLabel="-50%"
          maxLabel="100%"
        />
        <GrowthPresetPills />
        <div className={styles.note}>BTC 10-year avg CAGR: ~84%</div>

        <div className={styles.toggleRow}>
          <span className={styles.sectionLabel}>BEAR MARKET PHASE</span>
          <Toggle
            value={bearMarket}
            onChange={setBearMarket}
          />
        </div>

        {bearMarket && (
          <div className={styles.bearMarketBox}>
            <p className={styles.bearMarketDesc}>
              Price falls during the bear phase, then recovers at the CAGR above.
            </p>
            <SliderInput
              label="Bear period"
              value={bearPeriodYears}
              onChange={setBearPeriodYears}
              min={1}
              max={5}
              step={1}
              display={`${bearPeriodYears} ${bearPeriodYears === 1 ? 'yr' : 'yrs'}`}
              minLabel="1yr"
              maxLabel="5yrs"
            />
            <SliderInput
              label="Annual decline"
              value={annualDecline}
              onChange={setAnnualDecline}
              min={-80}
              max={-10}
              step={1}
              display={`${annualDecline}%`}
              minLabel="-80%"
              maxLabel="-10%"
            />
            <p className={styles.troughNote}>
              BTC falls to ~{fmtUSD(btcPrice * Math.pow(1 + annualDecline / 100, bearPeriodYears))} after bear phase
            </p>
          </div>
        )}

        <SliderInput
          label="Inflation Rate"
          value={inflationRate}
          onChange={setInflationRate}
          min={0}
          max={10}
          step={0.1}
          display={`${inflationRate}%`}
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
