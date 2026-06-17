import type { MonthData } from '../../simulation/types';
import { useStore } from '../../store/useStore';
import { fmtUSD } from '../../utils/format';
import styles from './PlaybookItems.module.css';

function fmtPct(n: number) {
  return `${Math.round(n * 100)}%`;
}

interface DotProps { color: string }
function Dot({ color }: DotProps) {
  return <span className={styles.dot} style={{ background: color }} />;
}

interface RowProps {
  dot: string;
  label: string;
  subtext?: string;
  right: React.ReactNode;
}
function Row({ dot, label, subtext, right }: RowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.left}>
        <Dot color={dot} />
        <div className={styles.labelWrap}>
          <span className={styles.label}>{label}</span>
          {subtext && <span className={styles.subtext}>{subtext}</span>}
        </div>
      </div>
      <div className={styles.right}>{right}</div>
    </div>
  );
}

interface Props {
  data: MonthData;
}

export function PlaybookItems({ data }: Props) {
  const income         = useStore((s) => s.income);
  const expenses       = useStore((s) => s.expenses);

  const hasPD   = data.paydown > 0;
  const buyAmt  = income - data.paydown;
  const buyPct  = income > 0 ? buyAmt / income : 1;
  const pdPct   = income > 0 ? data.paydown / income : 0;

  return (
    <div className={styles.items}>
      {/* Income allocation */}
      <Row
        dot="var(--green)"
        label="Buy Bitcoin"
        subtext={hasPD ? '(after paydown)' : '(100% of income)'}
        right={
          <div className={styles.rightInner}>
            <span className={styles.pct}>{fmtPct(buyPct)}</span>
            <span className={styles.amount}>{fmtUSD(buyAmt)}</span>
          </div>
        }
      />

      {hasPD && (
        <Row
          dot="var(--orange)"
          label="LoC Paydown"
          subtext="(reducing LTV back to 15%)"
          right={
            <div className={styles.rightInner}>
              <span className={styles.pct}>{fmtPct(pdPct)}</span>
              <span className={styles.amount}>{fmtUSD(data.paydown)}</span>
            </div>
          }
        />
      )}

      {/* LoC section separator */}
      <div className={styles.separator}>
        <span className={styles.separatorLabel}>Line of Credit (funds your lifestyle)</span>
      </div>

      <Row
        dot="var(--amber)"
        label="Monthly Draw"
        subtext="(via Strike Bill Pay)"
        right={<span className={styles.amount}>{fmtUSD(expenses)}</span>}
      />

      <Row
        dot="var(--red)"
        label="Interest /mo"
        subtext="(capitalizes onto LoC balance)"
        right={<span className={styles.amount} style={{ color: 'var(--red)' }}>{fmtUSD(data.interest)}</span>}
      />
    </div>
  );
}
