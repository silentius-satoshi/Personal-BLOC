import styles from './DemoBanner.module.css';

// C0 — the sandbox strip. Mounted by ONE line in AppShell behind VITE_DEMO === '1' (dead branch / tree-shaken on the
// owner build). Fixed-top, over every branch. Links home ('/') to the landing page.
export function DemoBanner() {
  return (
    <div className={styles.banner} role="note">
      <span className={styles.text}>Sandbox — example plan, edits reset on reload</span>
      <span className={styles.sep}>·</span>
      <a className={styles.link} href="/">Get the real thing →</a>
    </div>
  );
}
