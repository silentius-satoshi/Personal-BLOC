import { useStore } from '../../store/useStore';
import styles from './ScenarioPills.module.css';

const PILLS = [
  { key: 'conservative' as const, label: 'Conservative', rate: '30%' },
  { key: 'moderate'     as const, label: 'Moderate',     rate: '50%' },
  { key: 'historical'   as const, label: 'Historical',   rate: '80%' },
];

export function ScenarioPills() {
  const scenario = useStore((s) => s.scenario);
  const setScenario = useStore((s) => s.setScenario);
  const viewerMode = useStore((s) => s.viewerMode);

  return (
    <div className={styles.pills}>
      {PILLS.map((p) => (
        <button
          key={p.key}
          className={`${styles.pill} ${scenario === p.key ? styles.active : ''}`}
          onClick={() => setScenario(p.key)}
          disabled={viewerMode}
        >
          {p.label} <span className={styles.rate}>{p.rate}</span>
        </button>
      ))}
    </div>
  );
}
