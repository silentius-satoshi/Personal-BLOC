import styles from './FireScale.module.css';

/**
 * The FIRE face's scale (F2): years of funded spending — you-are-here and the need's marks, one at equal rates, two once a
 * bitcoin rate is typed. LAYOUT ONLY and WORDLESS: no store, no engine, no level names and no rungs — the view
 * (fireFaceView's `fireScale`) hands it every label and its spoken name.
 */
export interface FireScaleProps {
  /** The bar's end, in years. */
  max: number;
  you: { at: number; label: string } | null;
  marks: readonly { at: number; label: string }[];
  ariaLabel: string;
}

export default function FireScale({ max, you, marks, ariaLabel }: FireScaleProps) {
  const pos = (v: number): string => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <div className={styles.scale} role="img" aria-label={ariaLabel}>
      <div className={styles.track}>
        {you && <div className={styles.fill} style={{ width: pos(you.at) }} />}
        {marks.map((m) => <div key={m.label} className={styles.mark} style={{ left: pos(m.at) }} />)}
        {you && <div className={styles.you} style={{ left: pos(you.at) }} />}
      </div>
      <div className={styles.labels}>
        {you && <span className={styles.youLabel}>{you.label}</span>}
        {marks.map((m) => <span key={m.label} className={styles.markLabel}>{m.label}</span>)}
      </div>
    </div>
  );
}
