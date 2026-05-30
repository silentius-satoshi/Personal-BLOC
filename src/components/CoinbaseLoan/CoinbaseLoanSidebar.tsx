import { useStore } from '../../store/useStore';
import { useBtcPrice } from '../../hooks/useBtcPrice';
import { NumberInput } from '../ui/NumberInput';
import styles from './CoinbaseLoanSidebar.module.css';

export function CoinbaseLoanSidebar() {
  const btcPrice         = useStore((s) => s.btcPrice);
  const setBtcPrice      = useStore((s) => s.setBtcPrice);
  const cbLoanBalance    = useStore((s) => s.cbLoanBalance);
  const cbCollateralBtc  = useStore((s) => s.cbCollateralBtc);
  const cbAprPct         = useStore((s) => s.cbAprPct);
  const cbMonthlyPayment = useStore((s) => s.cbMonthlyPayment);
  const setCbLoanBalance    = useStore((s) => s.setCbLoanBalance);
  const setCbCollateralBtc  = useStore((s) => s.setCbCollateralBtc);
  const setCbAprPct         = useStore((s) => s.setCbAprPct);
  const setCbMonthlyPayment = useStore((s) => s.setCbMonthlyPayment);

  const { livePrice, lastUpdated } = useBtcPrice();
  const isSynced = livePrice !== null && Math.abs(btcPrice - livePrice) < 1;

  return (
    <div className={styles.sidebar}>
      <div className={styles.section}>
        <div className={styles.btcPriceLabelRow}>
          <span className={styles.label}>BTC PRICE</span>
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

      <div className={styles.divider} />

      <div className={styles.sectionLabel}>COINBASE LOAN</div>

      <div className={styles.section}>
        <span className={styles.label}>LOAN BALANCE</span>
        <NumberInput
          value={cbLoanBalance}
          onChange={setCbLoanBalance}
          prefix="$"
          min={0}
          step={500}
        />
      </div>

      <div className={styles.section}>
        <span className={styles.label}>BTC COLLATERAL</span>
        <NumberInput
          value={cbCollateralBtc}
          onChange={setCbCollateralBtc}
          suffix=" BTC"
          decimals={5}
          min={0.001}
          step={0.00001}
        />
      </div>

      <div className={styles.section}>
        <span className={styles.label}>APR %</span>
        <NumberInput
          value={cbAprPct}
          onChange={setCbAprPct}
          suffix="%"
          decimals={2}
          min={0}
          step={0.01}
        />
        <p className={styles.hint}>Variable — Morpho market rate</p>
      </div>

      <div className={styles.section}>
        <span className={styles.label}>MONTHLY PAYMENT</span>
        <NumberInput
          value={cbMonthlyPayment}
          onChange={setCbMonthlyPayment}
          prefix="$"
          min={0}
          step={100}
        />
        <p className={styles.hint}>0 = interest-only (no paydown)</p>
      </div>

      <div className={styles.divider} />

      <div className={styles.riskNote}>
        <div className={styles.riskRow}>
          <span className={styles.riskLabel}>LIQUIDATION</span>
          <span className={styles.riskValue}>86% LLTV · instant</span>
        </div>
        <div className={styles.riskRow}>
          <span className={styles.riskLabel}>GRACE PERIOD</span>
          <span className={styles.riskValue}>None · self-monitor</span>
        </div>
        <div className={styles.riskRow}>
          <span className={styles.riskLabel}>PENALTY</span>
          <span className={styles.riskValue}>4.38% on liquidated amount</span>
        </div>
      </div>
    </div>
  );
}
