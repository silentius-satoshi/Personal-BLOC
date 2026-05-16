import styles from './ProgressBar.module.css';

interface Props {
  paydown: number;
  income: number;
}

export function ProgressBar({ paydown, income }: Props) {
  const paydownPct = income > 0 ? Math.min(100, (paydown / income) * 100) : 0;
  const btcPct = 100 - paydownPct;

  return (
    <div className={styles.bar}>
      {paydownPct > 0 && (
        <div
          className={styles.segmentRed}
          style={{ width: `${paydownPct}%` }}
        />
      )}
      <div
        className={styles.segmentGreen}
        style={{ width: `${btcPct}%` }}
      />
    </div>
  );
}
