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
  { n: '01', title: 'Create a key', desc: 'Generated on your device. No email, no account.' },
  { n: '02', title: 'Set your numbers', desc: 'Collateral, credit line, income — the engine plans the year.' },
  { n: '03', title: 'Follow the playbook', desc: 'Log each month. Defend your LTV before your lender does.' },
];

const FAQ = [
  {
    q: 'Is this financial advice?',
    a: 'No. Personal ₿LOC is planning software — it models the numbers you give it against thresholds you set. The decisions, and the loans, are yours.',
  },
  {
    q: 'Where does my data live?',
    a: 'On your device, and — if you enable sync — as end-to-end encrypted events on Nostr relays you choose. There is no server database to breach.',
  },
  {
    q: 'Which lenders does it model?',
    a: 'Strike BLOC and Coinbase (Morpho) bitcoin-backed loans today, with manual entry for anything else. The app never touches your funds.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. A key generated on your device is your identity. Save the 12-word recovery phrase and you can restore your plan anywhere.',
  },
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

      {/* Features */}
      <section className={styles.section}>
        <span className={styles.eyebrow}>What's inside</span>
        <h2 className={styles.sectionTitle}>Plan, log, and defend bitcoin-backed loans — private by design.</h2>
        <div className={styles.featureGrid}>
          {FEATURES.map((f) => (
            <div key={f.title} className={styles.featureCard}>
              <span className={styles.featureIcon}>{f.icon}</span>
              <h3 className={styles.featureTitle}>{f.title}</h3>
              <p className={styles.featureBody}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className={styles.section}>
        <span className={styles.eyebrow}>How it works</span>
        <div className={styles.stepCols}>
          {STEPS.map((s, i) => (
            <div key={s.n} className={styles.stepCol}>
              {i > 0 && <span className={styles.stepDivider} aria-hidden="true" />}
              <span className={styles.stepNum}>{s.n}</span>
              <h3 className={styles.stepTitle}>{s.title}</h3>
              <p className={styles.stepDesc}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className={styles.section}>
        <span className={styles.eyebrow}>Questions</span>
        <div className={styles.faqList}>
          {FAQ.map((item) => (
            <details key={item.q} className={styles.faqItem}>
              <summary className={styles.faqQ}>{item.q}</summary>
              <p className={styles.faqA}>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className={styles.section}>
        <span className={styles.eyebrow}>Pricing</span>
        <h2 className={styles.sectionTitle}>Simple, sovereign, prepaid</h2>
        <div className={styles.priceGrid}>
          <div className={styles.priceCard}>
            <span className={styles.eyebrow}>Early access</span>
            <div className={styles.priceBig}>Free</div>
            <div className={styles.priceSub}>for now</div>
            <p className={styles.priceBody}>Use the full app while we build. Your plan is yours — export or leave anytime.</p>
            <a className={styles.ctaGhost} href="/app">Get started</a>
          </div>
          <div className={`${styles.priceCard} ${styles.priceCardFeatured}`}>
            <span className={styles.priceChip}>Coming soon</span>
            <span className={styles.eyebrow}>Hosted</span>
            <div className={styles.priceBig}>Coming soon</div>
            <div className={styles.priceSub}>prepaid over Lightning</div>
            <p className={styles.priceBody}>A managed personal instance — auto-updates, managed relay with backups, priority support.</p>
            <span className={styles.priceBtnDisabled} aria-disabled="true">Coming soon</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerCols}>
          <div className={styles.footerBrand}>
            <span className={styles.footerBrandName}>₿ Personal ₿LOC</span>
            <p className={styles.footerBrandNote}>
              Planning software, not financial advice. Bitcoin-collateralized borrowing carries liquidation risk —
              model it before you live it.
            </p>
          </div>
          <div className={styles.footerCol}>
            <span className={styles.footerColTitle}>Product</span>
            <a className={styles.footerLink} href="/app">Get started</a>
            {SANDBOX_URL && <a className={styles.footerLink} href={SANDBOX_URL} target="_blank" rel="noreferrer">Sandbox</a>}
            <a className={styles.footerLink} href="#pricing">Pricing</a>
          </div>
          <div className={styles.footerCol}>
            <span className={styles.footerColTitle}>Resources</span>
            <a className={styles.footerLink} href={REPO_URL} target="_blank" rel="noreferrer">Source code</a>
            <a className={styles.footerLink} href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">License (FSL-1.1-MIT)</a>
            <a className={styles.footerLink} href="https://nostr.com" target="_blank" rel="noreferrer">Nostr</a>
          </div>
        </div>
        <div className={styles.footerBottom}>© 2026 Personal ₿LOC · Your keys, your plan</div>
      </footer>
    </div>
  );
}
