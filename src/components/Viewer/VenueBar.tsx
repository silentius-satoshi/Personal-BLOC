import { deriveVenueSplit } from '../../simulation/viewerVenue';
import { fmtUSD } from '../../utils/format';
import styles from './VenueBar.module.css';

/**
 * Viewer home — where the coins sit, across Strike, Coinbase, and cold storage.
 *
 * Answers what none of the three gauges answer: what SHARE of the stack sits on the facility that
 * liquidates instantly with no cure window. Each gauge reports a ratio within one facility; none reports
 * concentration across them.
 *
 * ⚠ COLD STORAGE is shown only when the owner actually holds some (`coldStorageBtc > 0`) — a permanent
 * 0.000 cell would imply the app is tracking something it is not. It is the one venue here that is not
 * collateral: no loan, no LTV, no lender able to reach it. That is why it gets the bitcoin accent instead
 * of a lender's colour, and why it is NOT the Almanac's projected sweep — this card reports what IS, and
 * the projection is a simulation of what could be.
 *
 * ⚠ NOT a fourth gauge, and deliberately badge-less. The card grammar above is gauge → Safe/Fair/Poor →
 * sub-line; a badge needs a level, a level needs a threshold, and thresholds come from lender rules
 * (CREDIT_WARN_USED, CB_LLTV, strikeLiqLtv). No lender rule says a venue concentration is unsafe, so a
 * badge here would mean inventing a risk threshold and dressing it as a peer of three that are real.
 *
 * Pure-from-props: no store access, no context, no mutators. TRUSTED-mode only — the caller gates it, and
 * the C-safe snapshot carries no absolutes to feed it anyway (pinned by viewerVenue.test.ts).
 */
export interface VenueBarProps {
  strikeBtc: number;
  cbBtc: number;
  /** REAL self-custodied balance the owner entered. Optional — omitted/0 hides the segment entirely. */
  coldBtc?: number;
  btcPrice: number;
}

const fmtBtc = (n: number): string => `${n.toFixed(3)} ₿`;
const fmtShare = (share: number): string => `${Math.round(share * 100)}%`;

export function VenueBar({ strikeBtc, cbBtc, coldBtc = 0, btcPrice }: VenueBarProps) {
  const v = deriveVenueSplit(strikeBtc, cbBtc, coldBtc);
  if (!v.hasData) return null;   // nothing to compose — render NOTHING, not an empty bar

  const usd = (btc: number) => fmtUSD(btc * btcPrice);
  const label =
    `Split: ${fmtShare(v.strikeShare)} on Strike, ${fmtShare(v.cbShare)} on Coinbase` +
    (v.coldBtc > 0 ? `, ${fmtShare(v.coldShare)} in cold storage` : '') +
    `, ${fmtBtc(v.combinedBtc)} total`;

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.title}>Where the coins sit</span>
        <span className={styles.total}>{fmtBtc(v.combinedBtc)} total</span>
      </div>

      {/* Decorative — the three cells below carry the numbers. Mirrors RadialGauge's role="img" pattern. */}
      <div className={styles.bar} role="img" aria-label={label}>
        <span className={styles.segStrike} style={{ width: `${v.strikeShare * 100}%` }} aria-hidden="true" />
        <span className={styles.segCb} style={{ width: `${v.cbShare * 100}%` }} aria-hidden="true" />
        {v.coldBtc > 0 && (
          <span className={styles.segCold} style={{ width: `${v.coldShare * 100}%` }} aria-hidden="true" />
        )}
      </div>

      <div className={styles.cells}>
        <div className={styles.cell}>
          <div className={styles.cellKey}>Strike</div>
          <div className={`${styles.cellVal} ${styles.valStrike}`}>{fmtBtc(v.strikeBtc)}</div>
          <div className={styles.cellSub}>{usd(v.strikeBtc)} · {fmtShare(v.strikeShare)}</div>
        </div>
        <div className={styles.cell}>
          <div className={styles.cellKey}>Coinbase</div>
          <div className={`${styles.cellVal} ${styles.valCb}`}>{fmtBtc(v.cbBtc)}</div>
          <div className={styles.cellSub}>{usd(v.cbBtc)} · {fmtShare(v.cbShare)}</div>
        </div>
        {v.coldBtc > 0 && (
          <div className={styles.cell}>
            <div className={styles.cellKey}>Cold storage</div>
            <div className={`${styles.cellVal} ${styles.valCold}`}>{fmtBtc(v.coldBtc)}</div>
            <div className={styles.cellSub}>{usd(v.coldBtc)} · {fmtShare(v.coldShare)}</div>
          </div>
        )}
        <div className={`${styles.cell} ${styles.cellRule}`}>
          <div className={styles.cellKey}>Combined</div>
          <div className={`${styles.cellVal} ${styles.valTotal}`}>{fmtBtc(v.combinedBtc)}</div>
          <div className={styles.cellSub}>{usd(v.combinedBtc)}</div>
        </div>
      </div>
    </div>
  );
}
