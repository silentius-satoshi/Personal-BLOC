import type { StrategyResult } from '../../simulation/types';
import { fmtUSD } from '../../utils/format';
import styles from './StrategyCards.module.css';

interface Props {
  maxLeverage: StrategyResult;
  smartBloc: StrategyResult;
  sellToLive: StrategyResult;
  noBtcResult: StrategyResult;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtBtc(v: number): string {
  return `${v.toFixed(4)} BTC`;
}

type DotStyle = 'orange-fill' | 'green-fill' | 'gray-outline';

function Dot({ style }: { style: DotStyle }) {
  if (style === 'orange-fill') {
    return <span className={`${styles.dot} ${styles.dotOrange}`} />;
  }
  if (style === 'green-fill') {
    return <span className={`${styles.dot} ${styles.dotGreen}`} />;
  }
  return <span className={`${styles.dot} ${styles.dotOutline}`} />;
}

interface CardProps {
  result: StrategyResult;
  dotStyle: DotStyle;
  costLabel: string;
  costValue: string;
}

function StrategyCard({ result, dotStyle, costLabel, costValue }: CardProps) {
  const returnPositive = result.realReturn >= 0;
  const ltvVisible = result.finalLtv > 0;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <Dot style={dotStyle} />
        <span className={styles.cardTitle}>{result.label}</span>
      </div>

      <div className={styles.netWorth}>{fmtUSD(result.finalNetWorthReal)}</div>
      <div className={styles.netWorthSub}>Net Worth</div>

      <div className={styles.rows}>
        <Row label="BTC Held" value={fmtBtc(result.finalBtcHeld)} />
        {ltvVisible && (
          <Row label="LoC Balance" value={fmtUSD(result.finalLocBalance)} valueClass={styles.red} />
        )}
        <Row label={costLabel} value={costValue} valueClass={styles.amber} />
        {ltvVisible && (
          <Row label="Final LTV" value={fmtPct(result.finalLtv)} />
        )}
        <Row
          label="Real Return"
          value={fmtPct(result.realReturn)}
          valueClass={returnPositive ? styles.green : styles.red}
        />
      </div>
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={`${styles.rowValue} ${valueClass ?? ''}`}>{value}</span>
    </div>
  );
}

export function StrategyCards({ maxLeverage, smartBloc, sellToLive, noBtcResult }: Props) {
  return (
    <div className={styles.grid}>
      <StrategyCard
        result={maxLeverage}
        dotStyle="orange-fill"
        costLabel="Interest Paid"
        costValue={fmtUSD(maxLeverage.finalInterestPaid)}
      />
      <StrategyCard
        result={smartBloc}
        dotStyle="green-fill"
        costLabel="Interest Paid"
        costValue={fmtUSD(smartBloc.finalInterestPaid)}
      />
      <StrategyCard
        result={sellToLive}
        dotStyle="gray-outline"
        costLabel="Taxes Paid"
        costValue={fmtUSD(sellToLive.finalTaxesPaid)}
      />
      <StrategyCard
        result={noBtcResult}
        dotStyle="gray-outline"
        costLabel="Taxes Paid"
        costValue="$0"
      />
    </div>
  );
}
