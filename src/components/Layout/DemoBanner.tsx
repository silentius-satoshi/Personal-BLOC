import styles from './DemoBanner.module.css';

// C0/C1 — the sandbox strip. Mounted by ONE line in AppShell behind VITE_DEMO === '1' (dead branch / tree-shaken on the
// owner + public builds). Fixed-top, over every branch. "Get the real thing" links the PUBLIC site (VITE_PUBLIC_SITE_URL,
// set on the sandbox project) — NOT '/', which on the sandbox's own origin would loop back to the sandbox.
export function DemoBanner() {
  return (
    <div className={styles.banner} role="note">
      <span className={styles.text}>Sandbox — example plan, edits reset on reload</span>
      <span className={styles.sep}>·</span>
      <a className={styles.link} href={import.meta.env.VITE_PUBLIC_SITE_URL || '/'}>Get the real thing →</a>
    </div>
  );
}
