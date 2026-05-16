import { useStore } from '../../store/useStore';
import styles from './PlaybookScrubber.module.css';

export function PlaybookScrubber() {
  const scrubMonth  = useStore((s) => s.scrubMonth);
  const setScrubMonth = useStore((s) => s.setScrubMonth);

  return (
    <div className={styles.root}>
      <input
        type="range"
        className={styles.range}
        min={1}
        max={60}
        value={scrubMonth}
        onChange={(e) => setScrubMonth(Number(e.target.value))}
      />
      <div className={styles.labels}>
        {[1, 2, 3, 4, 5].map((y) => (
          <span key={y} className={styles.yearLabel}>Y{y}</span>
        ))}
      </div>
    </div>
  );
}
