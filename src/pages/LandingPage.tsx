import { useState } from 'react';
import { barLevel, type SafetyLevel } from '../simulation/cbMetrics';
import { CB_WARN_LTV, CB_LLTV } from '../simulation/runCoinbaseLoan';
import { LEVEL_COLOR } from '../simulation/safetyView';
import styles from './LandingPage.module.css';

// C0/C1/C2 — the commercial landing page, served at '/' on the PUBLIC deploy (VITE_LANDING=1) for a not-yet-onboarded
// visitor. Self-contained: no store, no simulation state, no NostrProvider dependency (App renders it as a sibling of
// the gate ladder). The only app imports are PURE band constants/functions so the crash-test widget's Safe/Watch/Act
// thresholds can't drift from the app.

const REPO_URL = import.meta.env.VITE_REPO_URL || 'https://github.com/silentius-satoshi/personal-bloc';
// C1 — the landing→sandbox link. NO fallback URL: a dead sandbox link is worse than none, so the CTA is
// rendered only when the env is set (the sandbox is a separate Vercel project; the public deploy may not have one).
const SANDBOX_URL = import.meta.env.VITE_SANDBOX_URL || null;
const LEVEL_LABEL: Record<SafetyLevel, string> = { safe: 'Safe', watch: 'Watch', act: 'Act' };

// C2 — the crash-test widget. The visitor sets up THEIR OWN loan (collateral + borrowed), then drags the price down to
// feel liquidation approach — the product's whole premise in one gesture. Store-free (plain <input>, local state).
// ⚠ collateral/borrowed are held as RAW STRINGS and coerced/clamped only at compute, so clearing a field mid-type
// doesn't snap the value back under the user. All band math flows through the REAL app thresholds (imports above).
function CrashTest() {
  const [colRaw, setColRaw] = useState('1');
  const [borRaw, setBorRaw] = useState('20000');
  const [price, setPrice] = useState(100_000);

  const collateral = Math.max(0.01, Number(colRaw) || 1.0);
  const borrowed = Math.max(100, Number(borRaw) || 20_000);
  const ltv = borrowed / (collateral * price); // 0..1
  const level = barLevel(ltv, CB_WARN_LTV, 0.75); // green <65% · amber 65–75% · red ≥75% (the real app's bands)
  const color = LEVEL_COLOR[level];
  const liq = borrowed / (collateral * CB_LLTV); // the price at which LTV hits the 86% liquidation line
  const liquidated = ltv >= CB_LLTV;
  const fillPct = Math.min(100, (ltv / CB_LLTV) * 100);
  const triggerPct = (0.75 / CB_LLTV) * 100;
  const dropPct = Math.max(0, Math.round((1 - liq / price) * 100));
  const ltvText = ltv >= 1 ? (ltv * 100).toFixed(0) : (ltv * 100).toFixed(1);

  return (
    <div className={styles.widget}>
      <div className={styles.widgetHeadline}>
        <span className={styles.widgetTitle}>Would you survive a crash?</span>
        <span className={styles.widgetSub}>Set up a loan, then drag the price down.</span>
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Collateral</span>
          <span className={styles.fieldInputWrap}>
            <span className={styles.fieldPrefix}>₿</span>
            <input
              className={styles.fieldInput}
              type="number"
              step={0.1}
              min={0.01}
              value={colRaw}
              onChange={(e) => setColRaw(e.target.value)}
              aria-label="Collateral in bitcoin"
            />
          </span>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Borrowed</span>
          <span className={styles.fieldInputWrap}>
            <span className={styles.fieldPrefix}>$</span>
            <input
              className={styles.fieldInput}
              type="number"
              step={1000}
              min={100}
              value={borRaw}
              onChange={(e) => setBorRaw(e.target.value)}
              aria-label="Borrowed in dollars"
            />
          </span>
        </label>
      </div>

      <div className={styles.priceRow}>
        <span className={styles.priceLabel}>If bitcoin goes to…</span>
        <span className={styles.priceValue}>${Math.round(price).toLocaleString()}</span>
      </div>
      <input
        className={styles.slider}
        type="range"
        min={15_000}
        max={250_000}
        step={1_000}
        value={price}
        onChange={(e) => setPrice(Number(e.target.value))}
        aria-label="Bitcoin price"
      />

      <div className={styles.readout}>
        <div className={styles.readoutLtv}>
          <span className={styles.ltvBig} style={{ color }}>{ltvText}%</span>
          <span className={styles.ltvUnit}>loan-to-value</span>
        </div>
        <span
          className={styles.verdictPill}
          style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
        >
          {liquidated ? 'LIQUIDATED' : LEVEL_LABEL[level].toUpperCase()}
        </span>
      </div>

      <div className={styles.gaugeTrack}>
        <div className={styles.gaugeFill} style={{ width: `${fillPct}%`, background: color }} />
        <div className={styles.gaugeTick} style={{ left: `${triggerPct}%` }} />
        <div className={styles.gaugeLiq} />
      </div>

      <p className={styles.story} style={{ color }}>
        {liquidated ? (
          <>Below <strong>${Math.round(liq).toLocaleString()}</strong> this position is <strong>liquidated</strong>. The
          app would have flagged this months earlier.</>
        ) : (
          <>Liquidation at <strong>${Math.round(liq).toLocaleString()}</strong> — bitcoin would have to fall{' '}
          <strong>{dropPct}%</strong> from here.</>
        )}
      </p>
    </div>
  );
}

const FEATURES = [
  { icon: '📊', title: 'Safety dashboard', body: 'Live LTV bars and liquidation distance for every loan.' },
  { icon: '🗓️', title: 'Monthly playbook', body: 'Twelve months of draws, buys, and paydowns — planned vs. real.' },
  {
    icon: '🛡️',
    title: 'Censorship-resistant by design',
    body: 'Your key, your device. Encrypted sync over Nostr — open relays no company can shut off. No accounts to breach.',
  },
];

const STEPS = [
  { n: '01', label: 'Create a key' },
  { n: '02', label: 'Set your numbers' },
  { n: '03', label: 'Follow the playbook' },
];

export function LandingPage() {
  return (
    <div className={styles.page}>
      {/* Nav — the single "View source" instance + the front-door sign-up/log-in CTA (→ /app → onboarding fork) */}
      <nav className={styles.nav}>
        <span className={styles.navBrand}>₿ Personal ₿LOC</span>
        <span className={styles.navActions}>
          <a className={styles.ctaGhost} href={REPO_URL} target="_blank" rel="noreferrer">View source</a>
          <a className={styles.ctaPrimary} href="/app">Sign up / Log in</a>
        </span>
      </nav>

      {/* Hero */}
      <header className={styles.hero}>
        <h1 className={styles.headline}>
          Borrow against your bitcoin.<br />
          <span className={styles.headlineAccent}>Never sell.</span>
        </h1>
        <p className={styles.tagline}>
          A sovereign planner for accumulating Bitcoin with a Line of Credit — your key, your plan, no accounts.
        </p>
        <div className={styles.ctaRow}>
          <a className={styles.ctaPrimary} href="/app">Get started — it's free</a>
          {SANDBOX_URL && (
            <a className={styles.ctaGhost} href={SANDBOX_URL} target="_blank" rel="noreferrer">Try the sandbox</a>
          )}
        </div>
        <p className={styles.heroHint}>Free · No email · Your keys stay yours</p>
        <CrashTest />
      </header>

      {/* Features — hairline triptych */}
      <section className={styles.section}>
        <div className={styles.triptych}>
          {FEATURES.map((f) => (
            <div key={f.title} className={styles.triCell}>
              <span className={styles.triIcon}>{f.icon}</span>
              <h3 className={styles.triTitle}>{f.title}</h3>
              <p className={styles.triBody}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works — one row */}
      <section className={styles.section}>
        <div className={styles.stepsLine}>
          {STEPS.map((s) => (
            <div key={s.n} className={styles.stepItem}>
              <span className={styles.stepN}>{s.n}</span>
              <span className={styles.stepLabel}>{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerStrip}>
          <span className={styles.footerCol}>FSL-1.1-MIT · self-host free</span>
          <span className={styles.footerCol}>Hosted — Lightning, coming soon</span>
          <span className={styles.footerLinks}>
            <a href={REPO_URL} target="_blank" rel="noreferrer">Source</a>
            {SANDBOX_URL && <a href={SANDBOX_URL} target="_blank" rel="noreferrer">Sandbox</a>}
            <a href="/app">Get started</a>
          </span>
        </div>
        <p className={styles.disclaimer}>
          Personal ₿LOC is planning software, not financial advice. Bitcoin-collateralized borrowing carries
          liquidation risk — model it before you live it.
        </p>
      </footer>
    </div>
  );
}
