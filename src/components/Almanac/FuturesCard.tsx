import { InfoTip } from '../ui/InfoTip';
import type { FuturesReadout } from './futuresView';
import styles from './FuturesCard.module.css';

/**
 * The futures readout on the Strategy face. LAYOUT ONLY: it reads no store and no engine, and it writes no word — the
 * face hands it every string, all built in futuresView. While a newer run is going the last figures stay, dimmed, with
 * `aria-busy` on the section, so a slider drag never blanks the card.
 */
export interface FuturesCardProps {
  /** The title — the count and the face's CURRENT horizon (the figures under it can be one run behind). */
  title: string;
  /** Null until the first run lands. */
  readout: FuturesReadout | null;
  running: boolean;
  /** What the card says before the first run lands. */
  runningText: string;
  tip: readonly string[];
  tipLabel: string;
}

export default function FuturesCard({ title, readout, running, runningText, tip, tipLabel }: FuturesCardProps) {
  return (
    <section className={styles.card} aria-busy={running} aria-label={title}>
      <span className={styles.label}>
        {title}
        <InfoTip label={tipLabel}>
          {tip.map((line) => <p key={line}>{line}</p>)}
        </InfoTip>
      </span>
      {readout === null ? (
        <p className={styles.quiet}>{runningText}</p>
      ) : (
        <>
          <div className={`${styles.grid} ${running ? styles.stale : ''}`}>
            {readout.rows.map((r) => (
              <div key={r.label} className={styles.cell}>
                <span className={styles.term}>{r.label}</span>
                <span className={styles.value}>{r.value}</span>
                <span className={styles.sub}>{r.sub}</span>
              </div>
            ))}
          </div>
          {readout.note !== null && <p className={styles.quiet}>{readout.note}</p>}
        </>
      )}
    </section>
  );
}
