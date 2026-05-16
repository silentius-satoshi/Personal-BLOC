import { useStore } from '../../store/useStore';
import styles from './SummaryBar.module.css';

function fmtUSD(n: number): string {
  return (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString();
}

function ratioColor(ratio: number) {
  if (ratio < 1.1)  return 'var(--red)';
  if (ratio < 1.25) return 'var(--orange)';
  if (ratio < 1.5)  return 'var(--amber)';
  return 'var(--green)';
}

function budgetHealth(ratio: number) {
  if (ratio < 1.1)  return 'Too thin';
  if (ratio < 1.25) return 'Tight';
  if (ratio < 1.5)  return 'Moderate';
  return 'Healthy';
}

export function SummaryBar() {
  const income   = useStore((s) => s.income);
  const expenses = useStore((s) => s.expenses);
  const surplus  = income - expenses;
  const ratio    = expenses > 0 ? income / expenses : 0;

  return (
    <div className={styles.bar}>
      <div className={styles.col}>
        <span className={styles.label}>Monthly Surplus</span>
        <span className={styles.value} style={{ color: surplus >= 0 ? 'var(--green)' : 'var(--red)' }}>
          {fmtUSD(surplus)}
        </span>
      </div>
      <div className={styles.divider} />
      <div className={styles.col}>
        <span className={styles.label}>Income / Expenses</span>
        <span className={styles.value} style={{ color: ratioColor(ratio) }}>
          {ratio.toFixed(2)}×
        </span>
      </div>
      <div className={styles.divider} />
      <div className={styles.col}>
        <span className={styles.label}>Budget Health</span>
        <span className={styles.value} style={{ color: ratioColor(ratio) }}>
          {budgetHealth(ratio)}
        </span>
      </div>
    </div>
  );
}
