import { useStore } from '../../store/useStore';
import { useSimulation } from '../../hooks/useSimulation';
import styles from './TierCards.module.css';

type Tier = 'min' | 'rec' | 'ideal';

const TIERS: { key: Tier; label: string; ltv: number }[] = [
  { key: 'min',   label: 'Minimum',     ltv: 0.15 },
  { key: 'rec',   label: 'Recommended', ltv: 0.05 },
  { key: 'ideal', label: 'Ideal',       ltv: 0.02 },
];

export function TierCards() {
  const activeTier  = useStore((s) => s.activeTier);
  const setActiveTier = useStore((s) => s.setActiveTier);
  const { tiers } = useSimulation();

  return (
    <div className={styles.cards}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>Starting Collateral</span>
        <span className={styles.sectionSub}>How much BTC you put in on Day 1</span>
      </div>
      <div className={styles.grid}>
        {TIERS.map(({ key, label, ltv }) => {
          const btc = tiers[key];
          const crashLTV = ltv / 0.20;
          const isActive = activeTier === key;
          const crashSafe = crashLTV < 0.70;
          const crashLabel = crashSafe ? 'Safe' : 'Margin Call';
          const crashColor = crashSafe ? 'var(--green)' : 'var(--amber)';

          return (
            <button
              key={key}
              className={`${styles.card} ${isActive ? styles.active : ''}`}
              onClick={() => setActiveTier(key)}
            >
              <span
                className={styles.tierLabel}
                style={{ color: isActive ? 'var(--orange)' : 'var(--text-ghost)' }}
              >
                {label.toUpperCase()}
              </span>
              <span className={styles.btcAmount}>{btc.toFixed(4)} BTC</span>
              <span className={styles.ltvRow}>
                Day-one LTV: <strong>{(ltv * 100).toFixed(0)}%</strong>
              </span>
              <span className={styles.crashRow}>
                80% crash → <strong style={{ color: crashColor }}>{(crashLTV * 100).toFixed(0)}% {crashLabel}</strong>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
