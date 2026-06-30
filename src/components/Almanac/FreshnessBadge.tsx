import styles from './FreshnessBadge.module.css';

/**
 * Almanac P3 — the freshness badge in the eyebrow row. It is ALSO the toggle affordance (a plain
 * <button>, NOT the auto-disabled Toggle — so a viewer can flip live block height on their own device →
 * viewer parity). OFF: muted "date-only · live off". LIVE: green "live · {ago} · {source}" (amber when
 * stale). The host owns the tap semantics (consent on first enable); this is presentation only.
 */
export interface FreshnessBadgeProps {
  enabled: boolean;
  mode: 'live' | 'estimated';
  source: string | null;
  lastUpdated: Date | null;
  isStale: boolean;
  onTap: () => void;
}

function fmtAgo(lastUpdated: Date): string {
  const s = Math.max(0, Math.round((Date.now() - lastUpdated.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export default function FreshnessBadge({ enabled, mode, source, lastUpdated, isStale, onTap }: FreshnessBadgeProps) {
  const isLive = enabled && mode === 'live';
  const tone = !isLive ? 'off' : isStale ? 'stale' : 'live';

  const label =
    tone === 'off'
      ? 'date-only · live off'
      : `live · ${lastUpdated ? fmtAgo(lastUpdated) : '—'}${source ? ` · ${source}` : ''}`;

  return (
    <button
      type="button"
      className={`${styles.badge} ${tone === 'live' ? styles.live : tone === 'stale' ? styles.stale : styles.off}`}
      onClick={onTap}
      aria-label={`Live block height: ${enabled ? 'on' : 'off'}, tap to toggle`}
    >
      <span className={styles.dot} />
      <span className={styles.text}>{label}</span>
    </button>
  );
}
