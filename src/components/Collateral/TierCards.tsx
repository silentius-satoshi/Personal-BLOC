import { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { useSimulation } from '../../hooks/useSimulation';
import { ltvOf } from '../../simulation/ltv';
import { fmtLtvPct } from '../../utils/format';
import styles from './TierCards.module.css';

/**
 * Sweep 3 (A4-6) — the Custom tier's reading: a month's expenses drawn on the sandbox collateral, by `ltvOf` (expenses
 * on ₿0 are ∞ — "Liquidated" — never the 0, "Safe", the old fallback read), and its 80%-crash LTV; printed through
 * `fmtLtvPct`. A priced position reads exactly as before (`ltvOf` is the same ratio; the crash keeps its `Math.ceil`).
 */
export function customTierReading(expenses: number, sandboxBtc: number, btcPrice: number): {
  dayOne: number; crash: number; label: 'Liquidated' | 'Margin Call' | 'Safe'; dayOneText: string; crashText: string;
} {
  const dayOne = ltvOf(expenses, sandboxBtc, btcPrice);
  const crash = dayOne / 0.20;
  const label = crash >= 0.85 ? 'Liquidated' : crash >= 0.70 ? 'Margin Call' : 'Safe';
  return {
    dayOne, crash, label,
    dayOneText: fmtLtvPct(dayOne),
    crashText: Number.isFinite(crash) ? `${Math.ceil(crash * 100)}%` : fmtLtvPct(crash),
  };
}

const TIERS: { key: 'min' | 'rec' | 'ideal'; label: string; ltv: number }[] = [
  { key: 'min',   label: 'Minimum',     ltv: 0.15 },
  { key: 'rec',   label: 'Recommended', ltv: 0.05 },
  { key: 'ideal', label: 'Ideal',       ltv: 0.02 },
];

export function TierCards() {
  const activeTier          = useStore((s) => s.activeTier);
  const setActiveTier       = useStore((s) => s.setActiveTier);
  const btcPrice            = useStore((s) => s.btcPrice);
  const expenses            = useStore((s) => s.expenses);
  // Smart BLOC is a SANDBOX — what-if collateral, no write-back to the real position
  const sandboxBtc              = useStore((s) => s.sandboxCollateralBtc ?? s.getCurrentBtcHeld());
  const setSandboxCollateralBtc = useStore((s) => s.setSandboxCollateralBtc);

  const { tiers } = useSimulation();

  const [customRaw, setCustomRaw] = useState(sandboxBtc.toFixed(2));

  useEffect(() => {
    setCustomRaw(sandboxBtc.toFixed(2));
  }, [sandboxBtc]);

  const custom = customTierReading(expenses, sandboxBtc, btcPrice);
  const customCrashColor =
    custom.crash >= 0.85 ? 'var(--red)' :
    custom.crash >= 0.70 ? 'var(--amber)' : 'var(--green)';

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
              <span className={styles.btcAmount}>₿ {btc.toFixed(4)} BTC</span>
              <span className={styles.ltvRow}>
                Day-one LTV: <strong>{(ltv * 100).toFixed(0)}%</strong>
              </span>
              <span className={styles.crashRow}>
                80% crash → <strong style={{ color: crashColor }}>{Math.ceil(crashLTV * 100)}% {crashLabel}</strong>
              </span>
            </button>
          );
        })}

        <button
          className={`${styles.card} ${activeTier === 'custom' ? styles.active : ''}`}
          onClick={() => setActiveTier('custom')}
        >
          <span
            className={styles.tierLabel}
            style={{ color: activeTier === 'custom' ? 'var(--orange)' : 'var(--text-ghost)' }}
          >
            CUSTOM
          </span>

          {activeTier === 'custom' ? (
            <div className={styles.customInputRow} onClick={(e) => e.stopPropagation()}>
              <input
                type="number"
                className={styles.customInput}
                value={customRaw}
                min={0.01}
                max={1000}
                step={0.01}
                onChange={(e) => setCustomRaw(e.target.value)}
                onBlur={() => {
                  const v = parseFloat(customRaw);
                  if (!isNaN(v) && v > 0) setSandboxCollateralBtc(v);
                  else setCustomRaw(sandboxBtc.toFixed(2));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = parseFloat(customRaw);
                    if (!isNaN(v) && v > 0) setSandboxCollateralBtc(v);
                    else setCustomRaw(sandboxBtc.toFixed(2));
                  }
                }}
              />
              <span className={styles.customInputUnit}>BTC</span>
            </div>
          ) : (
            <span className={styles.btcAmount}>₿ {sandboxBtc.toFixed(4)} BTC</span>
          )}

          <span className={styles.ltvRow}>
            Day-one LTV: <strong>{custom.dayOneText}</strong>
          </span>
          <span className={styles.crashRow}>
            80% crash →{' '}
            <strong style={{ color: customCrashColor }}>
              {custom.crashText} {custom.label}
            </strong>
          </span>
        </button>
      </div>
    </div>
  );
}
