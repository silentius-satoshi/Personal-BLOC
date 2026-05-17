import { useStore } from '../../store/useStore';
import { useBtcPrice } from '../../hooks/useBtcPrice';
import { fmtUSD } from '../../utils/format';
import styles from './ConverterSidebar.module.css';

const SATS_PER_BTC = 100_000_000;

function fmtUsdLocal(n: number): string {
  if (n < 0.01) return '$' + n.toFixed(6);
  if (n < 1)    return '$' + n.toFixed(4);
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ConverterSidebar() {
  const { livePrice } = useBtcPrice();
  const btcPrice    = useStore((s) => s.btcPrice);
  const setBtcPrice = useStore((s) => s.setBtcPrice);

  const satsPerDollar = btcPrice > 0 ? SATS_PER_BTC / btcPrice : null;

  const isSynced   = livePrice != null && Math.abs(btcPrice - livePrice) < 1;
  const badgeColor = livePrice == null ? 'var(--text-ghost)'
    : isSynced ? 'var(--green)'
    : 'var(--orange)';

  return (
    <div className={styles.panel}>
      <div className={styles.sectionHeader}>Bitcoin Price</div>

      <div className={styles.stat}>
        <div className={styles.statLabel}>Current Price</div>
        <div className={styles.statValue}>
          {fmtUSD(btcPrice)}
          {' '}
          <span
            className={styles.badge}
            style={{ color: badgeColor, opacity: livePrice == null ? 0.3 : 1 }}
            onClick={() => { if (livePrice != null) setBtcPrice(livePrice); }}
          >
            LIVE
          </span>
        </div>
      </div>

      <hr className={styles.divider} />

      <div className={styles.sectionHeader}>Sats Per Dollar</div>

      <div className={styles.stat}>
        <div className={styles.statLabel}>1 USD =</div>
        <div className={styles.statValue}>
          {satsPerDollar != null ? Math.round(satsPerDollar).toLocaleString() : '—'} sats
        </div>
      </div>

      <hr className={styles.divider} />

      <div className={styles.sectionHeader}>Key Equivalences</div>

      {[1, 10, 100, 1_000].map((dollars) => (
        <div key={dollars} className={styles.stat}>
          <div className={styles.statLabel}>${dollars.toLocaleString()}</div>
          <div className={styles.statValue}>
            {btcPrice > 0
              ? Math.round((dollars / btcPrice) * SATS_PER_BTC).toLocaleString()
              : '—'} sats
          </div>
        </div>
      ))}

      {[1, 1_000].map((sats) => (
        <div key={sats} className={styles.stat}>
          <div className={styles.statLabel}>{sats.toLocaleString()} {sats === 1 ? 'sat' : 'sats'}</div>
          <div className={styles.statValue}>
            {btcPrice > 0 ? fmtUsdLocal((sats / SATS_PER_BTC) * btcPrice) : '—'}
          </div>
        </div>
      ))}

      <hr className={styles.divider} />

      <div className={styles.sectionHeader}>What is a Satoshi?</div>

      <div className={styles.note}>
        A satoshi (sat) is the smallest unit of Bitcoin.<br />
        1 BTC = 100,000,000 sats.<br />
        Named after Bitcoin's creator, Satoshi Nakamoto.
      </div>
    </div>
  );
}
