import { useStore } from '../../store/useStore';
import styles from './GrowthPresetPills.module.css';

const PRESETS = [
  { label: 'Conservative', value: 30 },
  { label: 'Moderate',     value: 50 },
  { label: 'Historical',   value: 80 },
];

export function GrowthPresetPills() {
  const annualBtcGrowth    = useStore((s) => s.annualBtcGrowth);
  const setAnnualBtcGrowth = useStore((s) => s.setAnnualBtcGrowth);

  return (
    <div className={styles.pills}>
      {PRESETS.map((p) => (
        <button
          key={p.value}
          className={`${styles.pill} ${annualBtcGrowth === p.value ? styles.active : ''}`}
          onClick={() => setAnnualBtcGrowth(p.value)}
        >
          {p.label} <span className={styles.rate}>{p.value}%</span>
        </button>
      ))}
    </div>
  );
}
