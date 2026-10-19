import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { cbMetrics, accruedCbBalance, accruedCbLiquidationPrice, type SafetyLevel } from '../../simulation/cbMetrics';
import { deriveSafetyView, selectSafetyViewInputs, LEVEL_COLOR } from '../../simulation/safetyView';
import { isCrashDay, atTriggerLine, cbTabCrashDayLine, CONSOLE_LINK } from '../Tools/crashPlaybookView';
import { PLAN_PATHS_LINK } from '../Almanac/planMonthView';
import { LiquidationModeler } from './LiquidationModeler';
import { fmtLtvPct, shownUsd } from '../../utils/format';
import styles from './CoinbaseLoanMain.module.css';

/** Safety's badge words for today's level — the CB Loan tab reads Safety's classifier (Run 4), so its words too. */
const LEVEL_WORD: Record<SafetyLevel, string> = { safe: 'SAFE', watch: 'FAIR', act: 'POOR' };

interface StatCardProps { label: string; value: string; valueColor: string; sub: string; }

function StatCard({ label, value, valueColor, sub }: StatCardProps) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue} style={{ color: valueColor }}>{value}</span>
      <span className={styles.statSub}>{sub}</span>
    </div>
  );
}

/** Run 4 — today's LTV on the 0–100% track, in Safety's colour; the marker is the owner's trigger (the crash day's line,
 *  the console's), where a typed 70% "Emergency" stood. */
function LtvSafetyBar({ currentLtv, level, triggerPct }: { currentLtv: number; level: SafetyLevel; triggerPct: number }) {
  const pct = Math.min(currentLtv * 100, 100);
  return (
    <div className={styles.ltvBarWrapper}>
      <div className={styles.ltvBarTrack}>
        <div className={styles.ltvBarFill} style={{ width: `${pct}%`, background: LEVEL_COLOR[level] }} />
        <div className={styles.ltvMarker} style={{ left: `${triggerPct}%` }}>
          <span className={styles.ltvMarkerLabel}>{triggerPct}%</span>
        </div>
        <div className={styles.ltvMarker} style={{ left: '86%' }}>
          <span className={styles.ltvMarkerLabel}>86%</span>
        </div>
      </div>
      <div className={styles.ltvBarLabels}>
        <span className={styles.ltvBarCurrent}>{fmtLtvPct(currentLtv, 2)} LTV</span>
        <div className={styles.ltvBarLegend}>
          <span style={{ color: 'var(--amber)' }}>↑{triggerPct}% your trigger</span>
          <span style={{ color: 'var(--red)' }}>↑86% Liquidation</span>
        </div>
      </div>
    </div>
  );
}

interface CoinbaseLoanMainProps {
  /** Run 4 — the Emergency Console (the `liqsim` tab): the crash day is the console's; null when that tab is hidden. */
  onOpenConsole: (() => void) | null;
  /** Run 4 — the plan's year on the price paths, the Almanac's Decision face; null when the Almanac tab is hidden. */
  onOpenPlanPaths: (() => void) | null;
}

export function CoinbaseLoanMain({ onOpenConsole, onOpenPlanPaths }: CoinbaseLoanMainProps) {
  const btcPrice         = useStore((s) => s.btcPrice);
  const cbLoanBalance    = useStore((s) => s.cbLoanBalance);
  const cbCollateralBtc  = useStore((s) => s.cbCollateralBtc);
  const cbAprPct         = useStore((s) => s.cbAprPct);
  const hasCbLoan          = useStore((s) => s.hasCbLoan);
  const cbLiquidationPrice = useStore((s) => s.cbLiquidationPrice);
  const cbLiquidationPriceAsOf = useStore((s) => s.cbLiquidationPriceAsOf);
  const cbLtvTriggerPct    = useStore((s) => s.cbLtvTriggerPct);
  const cbLoanBalanceAsOf  = useStore((s) => s.cbLoanBalanceAsOf);

  // accrue the stored balance to today, then derive LTV/liq price via the shared helper
  // (single source of truth — same numbers as the Simple Mode SafetyDashboard)
  const accruedBalance  = accruedCbBalance(cbLoanBalance, cbAprPct, cbLoanBalanceAsOf);
  const m               = cbMetrics(accruedBalance, cbCollateralBtc, btcPrice, cbLtvTriggerPct);
  const monthlyInterest = accruedBalance * (cbAprPct / 100 / 12);
  const currentLtv      = m.ltv;
  const autoLiqPrice    = m.liqPrice;
  const activeLiqPrice  = cbLiquidationPrice > 0
    ? accruedCbLiquidationPrice(cbLiquidationPrice, cbAprPct, cbLiquidationPriceAsOf)
    : m.liqPrice;
  const dropToLiqPct    = Math.max(0, (1 - autoLiqPrice / btcPrice) * 100);
  // Run 4 — today's level is Safety's (one classifier for today's Coinbase LTV: Safety, the Advisor tab and this tab).
  const safety          = deriveSafetyView(useStore(useShallow(selectSafetyViewInputs)));
  // The crash day is the console's (D13's one rule, the console's gate): at or past the trigger at today's price.
  const crashDay        = isCrashDay({ hasCbLoan, cbDebt: accruedBalance, cbCollateralBtc, price: btcPrice, triggerPct: cbLtvTriggerPct });

  // Run 4 — the price alerts: the owner's trigger (where the console takes over) and Coinbase's 86% line. The typed
  // 70% "Emergency Protocol", 76% "Critical" and 84% "Danger" rows — a fourth crash-day answer — went with it.
  const thresholds = useMemo(() => [
    { label: 'Your trigger',     key: 'trigger', badge: styles.alert70, ltvPct: cbLtvTriggerPct, price: m.triggerPrice, action: 'Work from the Emergency Console' },
    { label: 'Auto-Liquidation', key: 'lltv',    badge: styles.alert86, ltvPct: 86,              price: autoLiqPrice,   action: 'Position liquidated + 4.38% penalty · possible full wipeout' },
  ], [cbLtvTriggerPct, m.triggerPrice, autoLiqPrice]);

  return (
    <div className={styles.main}>

      {/* Section 1 — Page Header */}
      <div className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>Coinbase Loan</h2>
        <p className={styles.pageSubtitle}>
          Bitcoin-backed · Morpho Protocol · {cbCollateralBtc.toFixed(5)} BTC collateral
        </p>
      </div>

      {/* The crash day — the console's (Run 4): at or past the owner's trigger, a pointer to it, never a fourth answer */}
      {crashDay && (
        <div className={styles.emergencyBanner}>
          <span className={styles.emergencyIcon}>⚠</span>
          <span>{atTriggerLine(cbLtvTriggerPct, true)}</span>
          {onOpenConsole && (
            <button className={styles.consoleLink} onClick={onOpenConsole}>{CONSOLE_LINK} →</button>
          )}
        </div>
      )}

      {/* Section 2 — Stat Cards */}
      <div className={styles.statGrid}>
        <StatCard
          label="CURRENT LTV"
          value={fmtLtvPct(currentLtv, 2)}
          valueColor={LEVEL_COLOR[safety.cbLevel]}
          sub={LEVEL_WORD[safety.cbLevel]}
        />
        <StatCard
          label="AUTO-LIQ PRICE"
          value={`$${Math.round(autoLiqPrice).toLocaleString()}`}
          valueColor="var(--text-primary)"
          sub="at 86% LLTV"
        />
        <StatCard
          label="DROP TO LIQ"
          value={`${dropToLiqPct.toFixed(1)}%`}
          valueColor={dropToLiqPct < 25 ? 'var(--red)' : dropToLiqPct < 40 ? 'var(--orange)' : 'var(--green)'}
          sub="price decline needed"
        />
        <StatCard
          label="MONTHLY INTEREST"
          value={`$${Math.round(monthlyInterest).toLocaleString()}`}
          valueColor="var(--text-primary)"
          sub={`${cbAprPct}% APR variable`}
        />
      </div>

      {/* Section 3 — LTV Safety Bar */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>LTV Risk Position</h3>
        <LtvSafetyBar currentLtv={currentLtv} level={safety.cbLevel} triggerPct={cbLtvTriggerPct} />
      </div>

      {/* Section 4 — Alert Thresholds */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Price Alert Thresholds</h3>
        <p className={styles.cardSubtitle}>Reactive — updates with loan balance and collateral inputs</p>
        <div className={styles.alertTableWrapper}>
          <table className={styles.alertTable}>
            <thead>
              <tr>
                <th>BTC Price</th>
                <th>CB LTV</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {thresholds.map((t) => {
                const isBreach = btcPrice <= t.price;
                return (
                  <tr key={t.key} className={isBreach ? styles.alertRowActive : ''}>
                    <td className={styles.alertPrice}>{shownUsd(t.price) ? `$${Math.round(t.price).toLocaleString()}` : '—'}</td>
                    <td className={styles.alertLtv}>{t.ltvPct}%</td>
                    <td>
                      <span className={`${styles.alertBadge} ${t.badge}`}>{t.label}</span>
                    </td>
                    <td className={styles.alertAction}>{t.action}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className={styles.alertNote}>Set price alerts in your exchange or portfolio tracker at each threshold.</p>
        <p className={styles.alertNote}>
          ⚠ Coinbase/Morpho liquidation is instant with no grace period.
          Liquidators may repay up to 100% of debt in one transaction,
          capturing a 4.38% penalty from your collateral.
          A full liquidation permanently closes your position.
        </p>
      </div>

      {/* Liquidation Modeler */}
      <LiquidationModeler
        loanBalance={cbLoanBalance}
        collateralBtc={cbCollateralBtc}
        btcPrice={btcPrice}
        liquidationPrice={activeLiqPrice}
        isEstimated={cbLiquidationPrice <= 0}
      />

      {/* Run 4 — the 12-month projection read the retired monthly payment (D3): the plan's year is the Advisor tab's card,
          month by month, and the Decision face's, on the price paths. */}
      {onOpenPlanPaths && (
        <button className={styles.pathsLink} onClick={onOpenPlanPaths}>{PLAN_PATHS_LINK} →</button>
      )}

      {/* Section 6 — the crash day (Run 4): the console's, at the owner's trigger. Replaced the typed "Emergency Protocol"
          (income to Coinbase at 70%, back to Smart BLOC under 60%) — a fourth crash-day answer. */}
      <div className={`${styles.card} ${crashDay ? styles.cardUrgent : ''}`}>
        <h3 className={styles.cardTitle}>On a crash day</h3>
        <p className={styles.cardSubtitle}>{cbTabCrashDayLine(cbLtvTriggerPct, m.triggerPrice)}</p>
        {onOpenConsole && (
          <button className={styles.consoleLink} onClick={onOpenConsole}>{CONSOLE_LINK} →</button>
        )}
      </div>

      {/* Section 7 — Strike vs Coinbase Comparison */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Strike vs Coinbase — Risk Comparison</h3>
        <div className={styles.compareTableWrapper}>
          <table className={styles.compareTable}>
            <thead>
              <tr>
                <th>Feature</th>
                <th>Coinbase (Morpho)</th>
                <th>Strike BLOC</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Liquidation threshold', '86% LLTV — instant',           '85% — after failed margin call'],
                ['Margin call / grace',   'None',                          '70% LTV — 72-hour cure window'],
                ['Liquidation scope',     'Up to 100% of position',       'Only enough to restore 65% LTV'],
                ['Liquidation penalty',   '4.38%',                        'None'],
                ['Warning system',        'None — self-monitor',          'Push + email notification'],
                ['Interest rate',         'Variable (Morpho market)',     'Variable (Prime + 6.25%)'],
                ['Collateral type',       'cbBTC on Base (smart contract)', 'Custodial BTC'],
                ['Collateral retrieval',  'Any time, post-withdrawal < 86%', 'LTV ≤ 40%, loan > 60 days'],
              ].map(([feature, cb, strike]) => (
                <tr key={feature}>
                  <td className={styles.compareFeature}>{feature}</td>
                  <td className={styles.compareCb}>{cb}</td>
                  <td className={styles.compareStrike}>{strike}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
