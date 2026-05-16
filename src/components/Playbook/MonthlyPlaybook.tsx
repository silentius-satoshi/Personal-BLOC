import { useSimulation } from '../../hooks/useSimulation';
import { useStore } from '../../store/useStore';
import { fmtUSD } from '../../utils/format';
import { ProgressBar } from './ProgressBar';
import { PlaybookItems } from './PlaybookItems';
import { PlaybookScrubber } from './PlaybookScrubber';
import styles from './MonthlyPlaybook.module.css';

function buildNarrative(
  month: number,
  ltv: number,
  income: number,
  expenses: number,
  paydown: number,
  interest: number
): string {
  const ltvPct = (ltv * 100).toFixed(1);
  const hasPD  = paydown > 0;
  const buyAmt = income - paydown;

  if (hasPD) {
    return `Month ${month}: LTV hit ${ltvPct}% after drawing expenses — ${fmtUSD(paydown)} of income reduces the LoC back to 15%, then ${fmtUSD(buyAmt)} buys Bitcoin. Full ${fmtUSD(expenses)} expenses always paid.`;
  }
  return `Month ${month}: LTV is ${ltvPct}% — well below the 15% ceiling. All ${fmtUSD(income)} income goes straight into Bitcoin. ${fmtUSD(expenses)} in expenses drawn from LoC. Interest of ${fmtUSD(interest)} capitalizes onto the balance.`;
}

export function MonthlyPlaybook() {
  const { currentMonth } = useSimulation();
  const scrubMonth = useStore((s) => s.scrubMonth);
  const income     = useStore((s) => s.income);
  const expenses   = useStore((s) => s.expenses);

  const { ltv, btcPrice, paydown, interest } = currentMonth;
  const ltvPct = (ltv * 100).toFixed(1);
  const hasPD  = paydown > 0;

  return (
    <div className={styles.playbook}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>Monthly Playbook</span>
      </div>

      {/* Header row */}
      <div className={styles.header}>
        <span className={styles.monthLabel}>Month {scrubMonth} of 60</span>
        <span
          className={styles.ltvBadge}
          style={{ color: hasPD ? 'var(--orange)' : 'var(--green)' }}
        >
          LTV {ltvPct}%{hasPD ? ' — paydown triggered' : ''}
        </span>
        <span className={styles.priceLabel}>BTC {fmtUSD(btcPrice)}</span>
      </div>

      <ProgressBar paydown={paydown} income={income} />
      <PlaybookScrubber />
      <PlaybookItems data={currentMonth} />

      <div className={styles.narrative}>
        {buildNarrative(scrubMonth, ltv, income, expenses, paydown, interest)}
      </div>
    </div>
  );
}
