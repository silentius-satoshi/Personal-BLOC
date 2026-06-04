import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { runCoinbaseLoan, classifyLtv, type CbLtvStatus } from '../../simulation/runCoinbaseLoan';
import { LiquidationModeler } from './LiquidationModeler';
import { fmtUSD } from '../../utils/format';
import styles from './CoinbaseLoanMain.module.css';

function ltvColor(status: CbLtvStatus): string {
  switch (status) {
    case 'safe':       return 'var(--green)';
    case 'watch':      return 'var(--amber)';
    case 'warning':    return 'var(--orange)';
    case 'emergency':  return 'var(--orange)';
    case 'critical':   return 'var(--red)';
    case 'liquidated': return 'var(--red)';
  }
}

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

function LtvSafetyBar({ currentLtv }: { currentLtv: number }) {
  const pct = Math.min(currentLtv * 100, 100);
  const fillColor =
    currentLtv < 0.55 ? 'var(--green)'
    : currentLtv < 0.65 ? 'var(--amber)'
    : currentLtv < 0.70 ? 'var(--orange)'
    : 'var(--red)';

  return (
    <div className={styles.ltvBarWrapper}>
      <div className={styles.ltvBarTrack}>
        <div className={styles.ltvBarFill} style={{ width: `${pct}%`, background: fillColor }} />
        <div className={styles.ltvMarker} style={{ left: '70%' }}>
          <span className={styles.ltvMarkerLabel}>70%</span>
        </div>
        <div className={styles.ltvMarker} style={{ left: '86%' }}>
          <span className={styles.ltvMarkerLabel}>86%</span>
        </div>
      </div>
      <div className={styles.ltvBarLabels}>
        <span className={styles.ltvBarCurrent}>{(currentLtv * 100).toFixed(2)}% LTV</span>
        <div className={styles.ltvBarLegend}>
          <span style={{ color: 'var(--amber)' }}>↑70% Emergency</span>
          <span style={{ color: 'var(--red)' }}>↑86% Liquidation</span>
        </div>
      </div>
    </div>
  );
}

export function CoinbaseLoanMain() {
  const btcPrice         = useStore((s) => s.btcPrice);
  const cbLoanBalance    = useStore((s) => s.cbLoanBalance);
  const cbCollateralBtc  = useStore((s) => s.cbCollateralBtc);
  const cbAprPct         = useStore((s) => s.cbAprPct);
  const cbMonthlyPayment   = useStore((s) => s.cbMonthlyPayment);
  const cbLiquidationPrice = useStore((s) => s.cbLiquidationPrice);

  const monthlyInterest = cbLoanBalance * (cbAprPct / 100 / 12);
  const currentLtv      = cbLoanBalance / (cbCollateralBtc * btcPrice);
  const autoLiqPrice    = cbLoanBalance / (cbCollateralBtc * 0.86);
  const dropToLiqPct    = Math.max(0, (1 - autoLiqPrice / btcPrice) * 100);
  const currentStatus   = classifyLtv(currentLtv);

  const thresholds = useMemo(() => [
    { label: 'Emergency Protocol', ltvPct: 70, price: cbLoanBalance / (cbCollateralBtc * 0.70), action: 'Stop BLOC buying · Redirect all income to CB paydown' },
    { label: 'Critical',           ltvPct: 76, price: cbLoanBalance / (cbCollateralBtc * 0.76), action: 'Aggressive paydown — 10 pts from auto-liquidation' },
    { label: 'Danger',             ltvPct: 84, price: cbLoanBalance / (cbCollateralBtc * 0.84), action: 'Pay down or add collateral immediately' },
    { label: 'Auto-Liquidation',   ltvPct: 86, price: cbLoanBalance / (cbCollateralBtc * 0.86), action: 'Position liquidated + 4.38% penalty · possible full wipeout' },
  ], [cbLoanBalance, cbCollateralBtc]);

  const projection = useMemo(
    () => runCoinbaseLoan({ loanBalance: cbLoanBalance, collateralBtc: cbCollateralBtc, aprPct: cbAprPct, monthlyPayment: cbMonthlyPayment, btcPrice }),
    [cbLoanBalance, cbCollateralBtc, cbAprPct, cbMonthlyPayment, btcPrice],
  );

  return (
    <div className={styles.main}>

      {/* Section 1 — Page Header */}
      <div className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>Coinbase Loan</h2>
        <p className={styles.pageSubtitle}>
          Bitcoin-backed · Morpho Protocol · {cbCollateralBtc.toFixed(5)} BTC collateral
        </p>
      </div>

      {/* Emergency Banner */}
      {currentLtv >= 0.70 && (
        <div className={styles.emergencyBanner}>
          <span className={styles.emergencyIcon}>⚠</span>
          <span>Emergency Protocol Active — LTV {(currentLtv * 100).toFixed(1)}% · Redirect all income to Coinbase paydown immediately</span>
        </div>
      )}

      {/* Section 2 — Stat Cards */}
      <div className={styles.statGrid}>
        <StatCard
          label="CURRENT LTV"
          value={`${(currentLtv * 100).toFixed(2)}%`}
          valueColor={ltvColor(currentStatus)}
          sub={currentStatus.toUpperCase()}
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
        <LtvSafetyBar currentLtv={currentLtv} />
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
                  <tr key={t.ltvPct} className={isBreach ? styles.alertRowActive : ''}>
                    <td className={styles.alertPrice}>${Math.round(t.price).toLocaleString()}</td>
                    <td className={styles.alertLtv}>{t.ltvPct}%</td>
                    <td>
                      <span className={`${styles.alertBadge} ${styles[`alert${t.ltvPct}`]}`}>{t.label}</span>
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
        liquidationPrice={cbLiquidationPrice}
      />

      {/* Section 5 — 12-Month Projection */}
      <div className={styles.card}>
        <div className={styles.projectionHeader}>
          <div>
            <h3 className={styles.cardTitle}>12-Month Projection</h3>
            <p className={styles.cardSubtitle}>
              Flat BTC @ ${btcPrice.toLocaleString()} · {cbMonthlyPayment > 0 ? `$${cbMonthlyPayment.toLocaleString()}/mo payment` : 'No payments (interest-only)'}
            </p>
          </div>
          <div className={styles.projectionSummary}>
            <span className={styles.projSumLabel}>Year-end balance</span>
            <span className={styles.projSumValue}>{fmtUSD(projection.finalBalance)}</span>
            <span className={styles.projSumLabel}>Year-end LTV</span>
            <span className={`${styles.projSumValue} ${styles[`ltvColor_${classifyLtv(projection.finalLtv)}`]}`}>
              {(projection.finalLtv * 100).toFixed(2)}%
            </span>
          </div>
        </div>
        <div className={styles.tableWrapper}>
          <table className={styles.projTable}>
            <thead>
              <tr>
                <th>Month</th>
                <th>Balance</th>
                <th>Interest</th>
                <th>Payment</th>
                <th>Net Change</th>
                <th>LTV</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {projection.rows.map((row) => (
                <tr key={row.month} className={styles[`status_${row.status}`]}>
                  <td className={styles.moCell}>Mo {row.month}</td>
                  <td>{fmtUSD(row.balance)}</td>
                  <td className={styles.interestCell}>{fmtUSD(row.interest)}</td>
                  <td className={row.payment > 0 ? styles.paymentCell : styles.mutedCell}>
                    {row.payment > 0 ? fmtUSD(row.payment) : '—'}
                  </td>
                  <td className={row.netChange >= 0 ? styles.negCell : styles.posCell}>
                    {row.netChange >= 0 ? '+' : '−'}{fmtUSD(Math.abs(row.netChange))}
                  </td>
                  <td className={styles[`ltvColor_${row.status}`]}>{(row.ltv * 100).toFixed(2)}%</td>
                  <td>
                    <span className={`${styles.statusBadge} ${styles[`badge_${row.status}`]}`}>{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td>{fmtUSD(projection.finalBalance)}</td>
                <td className={styles.interestCell}>{fmtUSD(projection.totalInterest)}</td>
                <td className={projection.totalPayments > 0 ? styles.paymentCell : styles.mutedCell}>
                  {projection.totalPayments > 0 ? fmtUSD(projection.totalPayments) : '—'}
                </td>
                <td />
                <td className={styles[`ltvColor_${classifyLtv(projection.finalLtv)}`]}>
                  {(projection.finalLtv * 100).toFixed(2)}%
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Section 6 — Emergency Protocol */}
      <div className={`${styles.card} ${currentLtv >= 0.70 ? styles.cardUrgent : ''}`}>
        <h3 className={styles.cardTitle}>Emergency Protocol</h3>
        <p className={styles.cardSubtitle}>
          Activates when CB LTV ≥ 70% (BTC at ${Math.round(cbLoanBalance / (cbCollateralBtc * 0.70)).toLocaleString()})
        </p>
        <ol className={styles.protocolList}>
          <li className={styles.protocolStep}>
            <span className={styles.stepNum}>1</span>
            <div>
              <strong>Stop all Smart BLOC BTC buying</strong>
              <p>Redirect 100% of monthly income to Coinbase loan paydown. BLOC interest continues rolling into balance silently (~${Math.round(monthlyInterest)}/mo).</p>
            </div>
          </li>
          <li className={styles.protocolStep}>
            <span className={styles.stepNum}>2</span>
            <div>
              <strong>Monitor daily</strong>
              <p>Morpho has no warning system. You must self-monitor. Auto-liquidation fires instantly at 86% LLTV with no grace period.</p>
            </div>
          </li>
          <li className={styles.protocolStep}>
            <span className={styles.stepNum}>3</span>
            <div>
              <strong>Resume Smart BLOC when CB LTV &lt; 60%</strong>
              <p>Once Coinbase LTV is safely below 60%, redirect income back to Smart BLOC paydown and BTC accumulation.</p>
            </div>
          </li>
        </ol>
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
