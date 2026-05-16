import { useStore } from '../../store/useStore';
import styles from './LtvTypePills.module.css';

const PILLS = [
  { key: 'target'  as const, label: 'Target',  pct: '5%'  },
  { key: 'current' as const, label: 'Current', pct: '10%' },
  { key: 'high'    as const, label: 'High',    pct: '15%' },
  { key: 'hyper'   as const, label: 'Hyper',   pct: '20%' },
];

export function LtvTypePills() {
  const ltvType    = useStore((s) => s.ltvType);
  const setLtvType = useStore((s) => s.setLtvType);

  return (
    <div className={styles.pills}>
      {PILLS.map((p) => (
        <button
          key={p.key}
          className={`${styles.pill} ${ltvType === p.key ? styles.active : ''}`}
          onClick={() => setLtvType(p.key)}
        >
          {p.label} <span className={styles.rate}>{p.pct}</span>
        </button>
      ))}
    </div>
  );
}
