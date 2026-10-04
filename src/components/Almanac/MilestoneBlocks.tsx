import type { KeyboardEvent } from 'react';
import styles from './MilestoneBlocks.module.css';

/**
 * The Milestones as blocks, one per milestone row, where the table doesn't fit (spec `pbloc-spec-milestones-phone-v1.md`):
 * under 768 px, and in Ownership's side column. LAYOUT ONLY — the face builds every word and figure (its table's own
 * expressions), and this lays them out; it writes no word itself (a zone is named only when the face names it). ONE
 * markup at a time: the face renders this OR its table, never both (useMediaQuery, the control dock's pattern).
 */
export interface MilestoneCell {
  /** The table's column header — a block's labels are its table's headers, less Year, Zone and Price (the head line). */
  label: string;
  value: string;
  /** A token, as the table's cell colours it. */
  color?: string;
  /** A second figure under the value — the gain cell's other line. */
  sub?: string;
  subColor?: string;
}
export interface MilestoneFlag { text: string; title?: string }
export interface MilestoneBlock {
  month: number;
  /** msYearLabel — "3 yr", "1.1 yr". */
  year: string;
  /** The table's year-cell flags, in its order. */
  flags: MilestoneFlag[];
  /** "peak · 3 Sep 2029" — a 4-yr cycle turn on this row. */
  turn: string | null;
  /** null when the table has no Zone column (the policy not applied). */
  zone: { letter: string; color?: string; label?: string } | null;
  price: string;
  lines: MilestoneCell[][];
  selected?: boolean;
  post?: boolean;
  /** Strategy's and Ownership's rows jump the month; Cycling's don't. */
  onPick?: () => void;
}

export default function MilestoneBlocks({ blocks, label }: { blocks: MilestoneBlock[]; label: string }) {
  return (
    <div className={styles.list} role="list" aria-label={label}>
      {blocks.map((b) => {
        const pick = b.onPick;
        const act = pick
          ? {
            role: 'button' as const,
            tabIndex: 0,
            onClick: pick,
            onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
            },
          }
          : {};
        return (
          <div key={b.month} role="listitem"
            className={`${styles.block}${b.selected ? ` ${styles.on}` : ''}${b.post ? ` ${styles.post}` : ''}`}>
            <div className={`${styles.inner}${pick ? ` ${styles.pick}` : ''}`} {...act}>
              <div className={styles.head}>
                <span className={styles.year}>
                  {b.year}
                  {b.flags.map((f) => <span key={f.text} className={styles.flag} title={f.title}> {f.text}</span>)}
                </span>
                {b.zone && (b.zone.label ? (
                  <span className={styles.zone} role="img" aria-label={b.zone.label} title={b.zone.label}
                    style={b.zone.color ? { color: b.zone.color } : undefined}>
                    {b.zone.letter}
                  </span>
                ) : (
                  <span className={styles.zone}>{b.zone.letter}</span>
                ))}
                <span className={styles.price}>{b.price}</span>
              </div>
              {b.turn && <div className={styles.turn}>{b.turn}</div>}
              {/* A term and its figures: a description list per line, read as "Debt — $60k". */}
              {b.lines.map((line, i) => (
                <dl key={i} className={styles.line}>
                  {line.map((c) => (
                    <div key={c.label} className={styles.cell}>
                      <dt className={styles.label}>{c.label}</dt>
                      <dd className={styles.value} style={c.color ? { color: c.color } : undefined}>{c.value}</dd>
                      {c.sub !== undefined && (
                        <dd className={styles.sub} style={c.subColor ? { color: c.subColor } : undefined}>{c.sub}</dd>
                      )}
                    </div>
                  ))}
                </dl>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
