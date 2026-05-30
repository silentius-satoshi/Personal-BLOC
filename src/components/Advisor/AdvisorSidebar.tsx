import { useStore } from '../../store/useStore';
import { NumberInput } from '../ui/NumberInput';
import { getCollateralForTier } from '../../simulation/runBlocYearOne';
import { getCurrentStrategyMonth, isStrategyComplete } from '../../simulation/runAdvisor';
import { fmtUSD } from '../../utils/format';
import styles from './AdvisorSidebar.module.css';

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.summaryRow}>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={styles.summaryValue}>{value}</span>
    </div>
  );
}

export function AdvisorSidebar() {
  const income            = useStore((s) => s.income);
  const expenses          = useStore((s) => s.expenses);
  const blocApr           = useStore((s) => s.blocApr);
  const creditLine        = useStore((s) => s.creditLine);
  const btcPrice          = useStore((s) => s.btcPrice);
  const activeTier        = useStore((s) => s.activeTier);
  const customCollateral  = useStore((s) => s.customCollateral);
  const cbLoanBalance     = useStore((s) => s.cbLoanBalance);
  const cbCollateralBtc   = useStore((s) => s.cbCollateralBtc);
  const cbAprPct          = useStore((s) => s.cbAprPct);
  const cbMonthlyPayment  = useStore((s) => s.cbMonthlyPayment);

  const advisorStartDate         = useStore((s) => s.advisorStartDate);
  const advisorActualBlocBalance = useStore((s) => s.advisorActualBlocBalance);
  const advisorActualBtcHeld     = useStore((s) => s.advisorActualBtcHeld);
  const setAdvisorStartDate         = useStore((s) => s.setAdvisorStartDate);
  const setAdvisorActualBlocBalance = useStore((s) => s.setAdvisorActualBlocBalance);
  const setAdvisorActualBtcHeld     = useStore((s) => s.setAdvisorActualBtcHeld);

  const collateralBtc = getCollateralForTier(activeTier, expenses, btcPrice, customCollateral);
  const currentMonth  = getCurrentStrategyMonth(advisorStartDate);
  const strategyDone  = isStrategyComplete(advisorStartDate);

  return (
    <div className={styles.sidebar}>

      <div className={styles.sectionLabel}>YOUR PROGRESS</div>

      <div className={styles.section}>
        <span className={styles.label}>STRATEGY START DATE</span>
        <input
          type="date"
          className={styles.dateInput}
          value={advisorStartDate}
          onChange={(e) => setAdvisorStartDate(e.target.value)}
          max={new Date().toISOString().split('T')[0]}
        />
      </div>

      <div className={styles.monthDisplay}>
        <span className={styles.monthLabel}>Current month</span>
        <span className={styles.monthValue}>
          {strategyDone ? 'Year complete ✓' : `Month ${currentMonth} of 12`}
        </span>
      </div>

      <div className={styles.section}>
        <span className={styles.label}>CURRENT BLOC BALANCE</span>
        <NumberInput
          value={advisorActualBlocBalance}
          onChange={setAdvisorActualBlocBalance}
          prefix="$"
          min={0}
          step={100}
        />
        <p className={styles.hint}>Check your Strike app</p>
      </div>

      <div className={styles.section}>
        <span className={styles.label}>CURRENT BTC HELD</span>
        <NumberInput
          value={advisorActualBtcHeld}
          onChange={setAdvisorActualBtcHeld}
          min={0}
          step={0.001}
          decimals={5}
          suffix=" BTC"
        />
        <p className={styles.hint}>Collateral + accumulated BTC</p>
      </div>

      <div className={styles.divider} />

      <div className={styles.sectionLabel}>FROM SMART BLOC</div>
      <SummaryRow label="Monthly income"   value={fmtUSD(income)} />
      <SummaryRow label="Monthly expenses" value={fmtUSD(expenses)} />
      <SummaryRow label="BLOC APR"         value={`${blocApr}%`} />
      <SummaryRow label="Credit line"      value={fmtUSD(creditLine)} />
      <SummaryRow label="Collateral"       value={`${collateralBtc.toFixed(5)} BTC`} />

      <div className={styles.divider} />

      <div className={styles.sectionLabel}>FROM CB LOAN</div>
      <SummaryRow label="Loan balance" value={fmtUSD(cbLoanBalance)} />
      <SummaryRow label="Collateral"   value={`${cbCollateralBtc} BTC`} />
      <SummaryRow label="APR"          value={`${cbAprPct}%`} />
      <SummaryRow label="Min. payment" value={cbMonthlyPayment > 0 ? fmtUSD(cbMonthlyPayment) : 'Interest-only'} />

      <div className={styles.divider} />

      <div className={styles.sectionLabel}>PRIORITY RULES</div>
      <div className={styles.ruleList}>
        <div className={styles.ruleRow}>
          <span className={styles.ruleDot} style={{ background: 'var(--green)' }} />
          <span className={styles.ruleText}>CB &lt; 55% — Normal strategy</span>
        </div>
        <div className={styles.ruleRow}>
          <span className={styles.ruleDot} style={{ background: 'var(--amber)' }} />
          <span className={styles.ruleText}>CB 55–65% — +25% to CB paydown</span>
        </div>
        <div className={styles.ruleRow}>
          <span className={styles.ruleDot} style={{ background: 'var(--orange)' }} />
          <span className={styles.ruleText}>CB 65–70% — Halve BLOC draw</span>
        </div>
        <div className={styles.ruleRow}>
          <span className={styles.ruleDot} style={{ background: 'var(--red)' }} />
          <span className={styles.ruleText}>CB ≥ 70% — Stop BLOC, all income to CB</span>
        </div>
      </div>

      <div className={styles.divider} />
      <p className={styles.editHint}>
        Edit loan inputs in Smart BLOC and CB Loan tabs.
      </p>

    </div>
  );
}
