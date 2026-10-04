import { Fragment, useState, type KeyboardEvent } from 'react';
import styles from './MilestoneSwitchTable.module.css';

/**
 * The Milestones where a face's table doesn't fit (spec `pbloc-spec-milestones-phone-v1.md`, Run 2): under 768 px, and in
 * Ownership's side column. One line a year, and a switch above it that shows a few of the table's columns at a time — each
 * view is the table's own headers over its own figures. LAYOUT ONLY: the face builds every word and figure (its table's
 * own expressions) and names the views; this lays them out and remembers which view is open. ONE markup at a time: the
 * face renders this OR its table (useMediaQuery, the control dock's pattern).
 */
export interface MilestoneCell {
  /** The table's column header — a view picks its cells by it. */
  label: string;
  value: string;
  /** A token, as the table's cell colours it. */
  color?: string;
  /** The spoken name of a symbol value — the zone letter's zone. */
  name?: string;
  /** A second figure under the value — the gain cell's other line. */
  sub?: string;
  subColor?: string;
}
export interface MilestoneFlag { text: string; title?: string }
export interface MilestoneRow {
  month: number;
  /** msYearLabel — "3 yr", "1.1 yr". */
  year: string;
  /** The table's year-cell flags, in its order. */
  flags: MilestoneFlag[];
  /** "peak · 3 Sep 2029" — a 4-yr cycle turn on this row. */
  turn: string | null;
  /** Every figure of the table's row but the year, each under its header, in the table's order. */
  cells: MilestoneCell[];
  selected?: boolean;
  post?: boolean;
  /** Strategy's and Ownership's rows jump the month; Cycling's don't. */
  onPick?: () => void;
}
export interface MilestoneView {
  key: string;
  /** The switch's text. */
  name: string;
  /** Its spoken name — the button's aria-label, and nothing else (a title equal to it would be read twice). */
  label: string;
  /** The columns it shows, by header, in the table's order. */
  cols: readonly string[];
}

export default function MilestoneSwitchTable({ rows, views, label, switchLabel, yearHead }: {
  rows: MilestoneRow[];
  views: readonly MilestoneView[];
  /** The table's name. */
  label: string;
  /** The switch's name. */
  switchLabel: string;
  /** The first column's header. */
  yearHead: string;
}) {
  // A view shows only the columns its table shows (Cycling's Cold; the Zone without the policy); an emptied view leaves.
  const has = (c: string) => rows.some((r) => r.cells.some((x) => x.label === c));
  const live = views.map((v) => ({ ...v, cols: v.cols.filter(has) })).filter((v) => v.cols.length > 0);
  const [open, setOpen] = useState(live[0]?.key);
  const view = live.find((v) => v.key === open) ?? live[0];
  if (!view) return null;
  return (
    <div className={styles.wrap}>
      <div className={styles.switch} role="group" aria-label={switchLabel}>
        {live.map((v) => (
          <button key={v.key} type="button" aria-pressed={v.key === view.key} aria-label={v.label}
            className={`${styles.tab}${v.key === view.key ? ` ${styles.tabOn}` : ''}`} onClick={() => setOpen(v.key)}>
            {v.name}
          </button>
        ))}
      </div>
      <table className={styles.table} aria-label={label}>
        <thead>
          <tr>
            <th scope="col" className={`${styles.th} ${styles.year}`}>{yearHead}</th>
            {view.cols.map((c) => <th key={c} scope="col" className={styles.th}>{c}</th>)}
          </tr>
        </thead>
        {/* One row group a year: its line and, under it, the turn's line — together the row's tap target. */}
        {rows.map((r) => {
          const pick = r.onPick;
          const act = pick
            ? {
              role: 'button' as const,
              tabIndex: 0,
              onClick: pick,
              onKeyDown: (e: KeyboardEvent<HTMLTableSectionElement>) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
              },
            }
            : {};
          return (
            <tbody key={r.month} {...act}
              className={`${styles.row}${pick ? ` ${styles.pick}` : ''}${r.selected ? ` ${styles.on}` : ''}${r.post ? ` ${styles.post}` : ''}`}>
              <tr>
                <td className={`${styles.td} ${styles.year}`}>
                  <span className={styles.yr}>{r.year}</span>
                  {/* The space sits outside the flag, so a long flag can drop under its year. */}
                  {r.flags.map((f) => <Fragment key={f.text}>{' '}<span className={styles.flag} title={f.title}>{f.text}</span></Fragment>)}
                </td>
                {view.cols.map((c) => {
                  const x = r.cells.find((y) => y.label === c);
                  return (
                    <td key={c} className={styles.td}>
                      {x && (x.name ? (
                        <span className={styles.value} role="img" aria-label={x.name} title={x.name}
                          style={x.color ? { color: x.color } : undefined}>{x.value}</span>
                      ) : (
                        <span className={styles.value} style={x.color ? { color: x.color } : undefined}>{x.value}</span>
                      ))}
                      {x?.sub !== undefined && (
                        <span className={styles.sub} style={x.subColor ? { color: x.subColor } : undefined}>{x.sub}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
              {r.turn && (
                <tr>
                  <td className={styles.turn} colSpan={view.cols.length + 1}>{r.turn}</td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
