import styles from './RadialGauge.module.css';

/**
 * Viewer Experience Revamp — V1.
 *
 * Lightweight presentational SVG donut (fitness-app ring) via stroke-dasharray/offset. NOT the
 * epoch-specific Almanac CycleDial (that's coordinate-system-specialized). Pure-from-props.
 */
export interface RadialGaugeProps {
  pct: number; // 0..100+ (clamped to 0..100 for the arc)
  color: string; // CSS color (a --green/--amber/--red token from the caller)
  label: string; // a11y label (e.g. "Strike BLOC LTV 48%")
}

const SIZE = 120;
const STROKE = 11;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

export function RadialGauge({ pct, color, label }: RadialGaugeProps) {
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = C * (1 - clamped / 100);
  return (
    <svg
      className={styles.gauge}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={label}
    >
      <circle
        className={styles.track}
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={R}
        strokeWidth={STROKE}
        fill="none"
      />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={R}
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={C}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
      <text className={styles.value} x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill={color}>
        {Math.round(clamped)}%
      </text>
    </svg>
  );
}
