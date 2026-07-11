import { useState } from 'react';
import { barLevel, type SafetyLevel } from '../simulation/cbMetrics';
import { CB_WARN_LTV, CB_LLTV } from '../simulation/runCoinbaseLoan';
import { LEVEL_COLOR } from '../simulation/safetyView';
import styles from './LandingPage.module.css';

// C0 — the commercial landing page, served at '/' on the PUBLIC deploy (VITE_LANDING=1). Self-contained: no store,
// no simulation state, no NostrProvider dependency (App renders it as a sibling of the gate ladder). The only app
// imports are PURE band constants/functions so the LtvDemo widget's Safe/Watch/Act thresholds can't drift from the app.

const REPO_URL = import.meta.env.VITE_REPO_URL || 'https://github.com/silentius-satoshi/personal-bloc';
// C1 — the landing→sandbox link. NO fallback URL: a dead sandbox link is worse than none, so the CTA is
// rendered only when the env is set (the sandbox is a separate Vercel project; the public deploy may not have one).
const SANDBOX_URL = import.meta.env.VITE_SANDBOX_URL || null;
const LEVEL_LABEL: Record<SafetyLevel, string> = { safe: 'Safe', watch: 'Watch', act: 'Act' };

// A fixed example loan position — the widget drags the BTC PRICE and everything else reacts, so the "price drops →
// LTV rises → you approach liquidation" story (the product's whole premise) is visible in one gesture. The position
// (1 ₿ collateral, $45k borrowed) + range are chosen so all THREE bands are reachable at plausible prices: Safe
// above ~$69k, Watch $60k–69k (65–75%), Act below ~$60k (≥75%), liquidation at ~$52k.
const COLLATERAL_BTC = 1.0;
const DRAWN_USD = 45_000;
const PRICE_MIN = 40_000;
const PRICE_MAX = 200_000;
const LIQ_PRICE = DRAWN_USD / (COLLATERAL_BTC * CB_LLTV); // the price at which LTV hits the 86% liquidation line

function LtvDemo() {
  const [price, setPrice] = useState(95_000);
  const ltv = DRAWN_USD / (COLLATERAL_BTC * price); // 0..1
  const level = barLevel(ltv, CB_WARN_LTV, 0.75); // green <65% · amber 65–75% · red ≥75% (the real app's bands)
  const color = LEVEL_COLOR[level];
  const fillPct = Math.min(100, (ltv / CB_LLTV) * 100); // fill toward the 86% liquidation line

  return (
    <div className={styles.widget}>
      <div className={styles.widgetHead}>
        <span className={styles.widgetLabel}>Loan-to-value at</span>
        <span className={styles.widgetPrice}>${Math.round(price).toLocaleString()}/₿</span>
        <span className={styles.widgetBadge} style={{ color, borderColor: color }}>{LEVEL_LABEL[level]}</span>
      </div>

      <div className={styles.gaugeTrack}>
        <div className={styles.gaugeFill} style={{ width: `${fillPct}%`, background: color }} />
      </div>
      <div className={styles.gaugeMeta}>
        <span className={styles.ltvValue} style={{ color }}>{(ltv * 100).toFixed(1)}% LTV</span>
        <span className={styles.liqNote}>liquidation at ${Math.round(LIQ_PRICE).toLocaleString()}</span>
      </div>

      <input
        className={styles.slider}
        type="range"
        min={PRICE_MIN}
        max={PRICE_MAX}
        step={500}
        value={price}
        onChange={(e) => setPrice(Number(e.target.value))}
        aria-label="Bitcoin price"
      />
      <p className={styles.widgetHint}>
        {COLLATERAL_BTC.toFixed(1)} ₿ collateral · ${DRAWN_USD.toLocaleString()} borrowed — drag the price to see how a
        drawdown moves your risk. Personal ₿LOC watches this for you and tells you exactly when to act.
      </p>
    </div>
  );
}

const FEATURES = [
  { title: 'Your key, your plan', body: 'No accounts, no sign-ups. A key generated on your device secures everything — nothing lives on our servers.' },
  { title: 'Model the real thing', body: 'Strike Bitcoin Line of Credit and Coinbase-loan strategies, side by side, with liquidation-aware math.' },
  { title: 'A monthly playbook', body: 'Daily and monthly views turn the model into a plain-English "do this" — draw, buy, pay down, repeat.' },
  { title: 'Safety at a glance', body: 'Live Safe / Watch / Act gauges for Strike and Coinbase, so you always know how much room you have.' },
  { title: 'Share, read-only', body: 'Give a partner or advisor a private, read-only view of your plan — abstracted or with real figures, your call.' },
  { title: 'Offline & cross-device', body: 'A full PWA that works offline, with optional end-to-end-encrypted sync across your own devices over Nostr.' },
];

const STEPS = [
  { n: '1', title: 'Generate your key', body: 'One tap mints your plan key on-device and walks you through backing it up.' },
  { n: '2', title: 'Set your numbers', body: 'Income, expenses, credit line, collateral — the model calibrates to your situation.' },
  { n: '3', title: 'Follow the playbook', body: 'Each month it tells you what to do and flags danger before it arrives.' },
];

const FAQ = [
  {
    q: 'Do you hold my keys or my data?',
    a: 'No. Your plan is secured by a key generated on your device and never leaves it unencrypted. There is no account and no server-side copy of your plan.',
  },
  {
    q: 'Can I self-host it?',
    a: 'Yes. The source is available under FSL-1.1-MIT — run your own locked instance for free. A hosted option, prepaid over Lightning, is coming.',
  },
  {
    q: 'Is this financial advice?',
    a: 'No. Personal ₿LOC is a modeling and planning tool. It shows you the mechanics and the math; the decisions are yours.',
  },
  {
    q: 'What happens to the demo when I reload?',
    a: 'The sandbox is a fixed example plan. Edit anything you like — a reload resets it. Nothing you do there is saved or sent anywhere.',
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
        <div className={styles.brandRing}>₿</div>
        <h1 className={styles.title}>Personal ₿LOC</h1>
        <p className={styles.tagline}>
          A sovereign planner for accumulating Bitcoin with a Line of Credit — your key, your plan, no accounts.
        </p>
        <div className={styles.ctaRow}>
          <a className={styles.ctaPrimary} href="/app">Get started — it's free</a>
          {SANDBOX_URL && (
            <a className={styles.ctaGhost} href={SANDBOX_URL} target="_blank" rel="noreferrer">Try the sandbox</a>
          )}
        </div>
        <p className={styles.heroHint}>Free to use · installable PWA · no email · no tracking</p>
        <LtvDemo />
      </header>

      {/* Features */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>What it does</h2>
        <div className={styles.featureGrid}>
          {FEATURES.map((f) => (
            <div key={f.title} className={styles.featureCard}>
              <h3 className={styles.featureTitle}>{f.title}</h3>
              <p className={styles.featureBody}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>How it works</h2>
        <div className={styles.stepRow}>
          {STEPS.map((s) => (
            <div key={s.n} className={styles.stepCard}>
              <div className={styles.stepNum}>{s.n}</div>
              <h3 className={styles.stepTitle}>{s.title}</h3>
              <p className={styles.stepBody}>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Pricing</h2>
        <div className={styles.priceRow}>
          <div className={styles.priceCard}>
            <h3 className={styles.priceName}>Self-host</h3>
            <div className={styles.priceAmount}>Free</div>
            <p className={styles.priceBody}>Run your own locked instance. Source-available under FSL-1.1-MIT.</p>
            <a className={styles.ctaGhost} href={REPO_URL} target="_blank" rel="noreferrer">View source</a>
          </div>
          <div className={`${styles.priceCard} ${styles.priceCardFeatured}`}>
            <h3 className={styles.priceName}>Hosted</h3>
            <div className={styles.priceAmount}>Coming soon</div>
            <p className={styles.priceBody}>
              A managed personal instance — same sovereignty model, none of the DevOps. Prepaid with bitcoin over
              Lightning when it lands.
            </p>
            <a className={styles.ctaPrimary} href="/app">Get started free →</a>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Questions</h2>
        <div className={styles.faqList}>
          {FAQ.map((item) => (
            <div key={item.q} className={styles.faqItem}>
              <h3 className={styles.faqQ}>{item.q}</h3>
              <p className={styles.faqA}>{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <span className={styles.footerBrand}>Personal ₿LOC</span>
        <span className={styles.footerLinks}>
          <a href="/app">Get started</a>
          {SANDBOX_URL && <a href={SANDBOX_URL} target="_blank" rel="noreferrer">Sandbox</a>}
          <a href={REPO_URL} target="_blank" rel="noreferrer">View source</a>
        </span>
        <span className={styles.footerNote}>© 2026 · Source-available under FSL-1.1-MIT</span>
      </footer>
    </div>
  );
}
