import { deriveOwnership } from '../../simulation/ownership';
import { fmtUSD } from '../../utils/format';
import styles from './OwnershipBar.module.css';

/**
 * Viewer home — the ownership split: what's YOURS vs what's OWED.
 *
 * Answers what none of the three gauges answer: of everything held, how much survives the debt at the
 * current price. The venue bar (VenueBar) says WHERE the coins sit; this bar says WHO they belong to.
 *
 * ⚠ NOT a fourth gauge, and deliberately badge-less — the same rule as VenueBar: no lender rule defines
 * an ownership-threshold, so a Safe/Fair/Poor badge here would be inventing a risk verdict.
 *
 * Pure-from-props: no store access, no context, no mutators. TRUSTED-mode only — the caller gates it,
 * and the C-safe snapshot carries no absolutes to feed it anyway (pinned by ownership.test.ts).
 *
 * ⚠ Palette: `--btc` / `--text-faint` (3.24 contrast) — the right pair for the ownership read, and
 * deliberately NOT VenueBar's `--text-muted` Coinbase segment (1.54, the palette amendment's job).
 */
export interface OwnershipBarProps {
  btcHeld: number;
  debt: number;
  btcPrice: number;
}

const fmtBtc = (n: number): string => `${n.toFixed(3)} ₿`;
const fmtShare = (share: number): string => `${Math.round(share * 100)}%`;

export function OwnershipBar({ btcHeld, debt, btcPrice }: OwnershipBarProps) {
  const o = deriveOwnership(btcHeld, debt, btcPrice);
  if (!o.hasData) return null;   // nothing to split — render NOTHING, not an empty bar

  const usd = (btc: number) => fmtUSD(btc * btcPrice);
  const label =
    `Ownership split: ${fmtShare(o.yoursShare)} yours, ${fmtShare(o.lendersShare)} owed, ` +
    `${fmtBtc(btcHeld)} held`;

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.title}>What&apos;s yours</span>
        <span className={styles.total}>{fmtBtc(btcHeld)} held</span>
      </div>

      {/* Decorative — the cells below carry the numbers. Mirrors VenueBar's role="img" pattern. */}
      <div className={styles.bar} role="img" aria-label={label}>
        <span className={styles.segYours} style={{ width: `${o.yoursShare * 100}%` }} aria-hidden="true" />
        <span className={styles.segOwed} style={{ width: `${o.lendersShare * 100}%` }} aria-hidden="true" />
      </div>

      <div className={styles.cells}>
        <div className={styles.cell}>
          <div className={styles.cellKey}>Yours</div>
          <div className={`${styles.cellVal} ${styles.valYours}`}>{fmtBtc(o.yoursBtc)}</div>
          <div className={styles.cellSub}>{usd(o.yoursBtc)} · {fmtShare(o.yoursShare)}</div>
        </div>
        <div className={styles.cell}>
          <div className={styles.cellKey}>Owed</div>
          <div className={`${styles.cellVal} ${styles.valOwed}`}>{fmtBtc(o.lendersBtc)}</div>
          <div className={styles.cellSub}>{usd(o.lendersBtc)} · {fmtShare(o.lendersShare)}</div>
        </div>
        <div className={`${styles.cell} ${styles.cellRule}`}>
          <div className={styles.cellKey}>Held</div>
          <div className={`${styles.cellVal} ${styles.valHeld}`}>{fmtBtc(btcHeld)}</div>
          <div className={styles.cellSub}>{usd(btcHeld)}</div>
        </div>
      </div>
    </div>
  );
}
