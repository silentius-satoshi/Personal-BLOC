import styles from './PrivacyScreen.module.css';

/**
 * Opaque privacy cover shown when the app is backgrounded/blurred (driven by useAppHidden). Hides sensitive
 * financial data from the iOS app-switcher snapshot + shoulder-surfers. Fully opaque (NOT a blur) — content must
 * not be readable underneath. Cover-only (no re-auth yet). Decorative → aria-hidden.
 */
export function PrivacyScreen() {
  return (
    <div className={styles.privacyOverlay} aria-hidden="true">
      <div className={styles.logo}>₿</div>
      <div className={styles.title}>Personal ₿LOC</div>
    </div>
  );
}
