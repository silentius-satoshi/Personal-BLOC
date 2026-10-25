import type { ReactNode } from 'react';
import { COLD_CARD_TITLE, COLD_RULES_TITLE, type ColdCardView } from './coldCardView';
import styles from './ColdStorageCard.module.css';

/** The origin dots — the venue bar's own colours, so a part reads as the venue it came from. */
const DOT: Record<'cold' | 'coinbase' | 'strike', string> = {
  cold: styles.dotCold, coinbase: styles.dotCb, strike: styles.dotStrike,
};

/**
 * BL33 — the cold-storage card, the SAME on the four engine faces: the total by the run's end, where it came from, when
 * new coins first move, and — while the support policy applies — how the plan uses cold, folded (THIS MONTH's "Why this
 * plan?" pattern). Pure-from-props; its words are coldCardView's. A face adds only what is its own: Cycling's InfoTip
 * (`info`), the sweep's controls with the policy off (`children`). The Decision face passes `showTotal={false}`: its
 * outcome strip's first tile, directly above, already carries the total.
 */
export function ColdStorageCard({ view, info, children, showTotal = true }: {
  view: ColdCardView | null;
  info?: ReactNode;
  children?: ReactNode;
  showTotal?: boolean;
}) {
  return (
    <section className={styles.card} aria-label={COLD_CARD_TITLE}>
      <span className={styles.cardLabel}>{COLD_CARD_TITLE}{info}</span>
      {view !== null && (
        <>
          {/* ⚠ The headline is the OUTCOME, not the constraint: "₿ in your own custody" is what the owner wants. */}
          {showTotal && (
            <div className={styles.head}>
              <span className={styles.big}>{view.total}</span>
              <span className={styles.bigSub}>{view.totalSub}</span>
            </div>
          )}
          <div className={styles.split}>
            {view.parts.map((p) => (
              <span key={p.venue ?? 'used'}>
                {p.venue !== null && <span className={DOT[p.venue]} />}
                {p.text}
              </span>
            ))}
          </div>
          {view.moves !== '' && <p className={styles.moves}>{view.moves}</p>}
          {view.rules.length > 0 && (
            <details className={styles.rules}>
              <summary>{COLD_RULES_TITLE}</summary>
              <ul>
                {view.rules.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </details>
          )}
        </>
      )}
      {children && <div className={styles.own}>{children}</div>}
    </section>
  );
}
