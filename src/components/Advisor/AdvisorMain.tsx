import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import {
  runAdvisor,
  getTier,
  getTierLabel,
  getTierColor,
  getCurrentStrategyMonth,
  isStrategyComplete,
  type AdvisorTier,
} from '../../simulation/runAdvisor';
import { getCollateralForTier } from '../../simulation/runBlocYearOne';
import { fmtUSD } from '../../utils/format';
import styles from './AdvisorMain.module.css';

interface ActionRowProps {
  icon: string;
  label: string;
  value: string;
  sub: string;
  highlight?: 'green' | 'orange';
}

function ActionRow({ icon, label, value, sub, highlight }: ActionRowProps) {
  return (
    <div className={styles.actionRow}>
      <span className={styles.actionIcon}>{icon}</span>
      <div className={styles.actionContent}>
        <span className={styles.actionLabel}>{label}</span>
        <span className={styles.actionSub}>{sub}</span>
      </div>
      <span className={`${styles.actionValue} ${highlight ? styles[`highlight_${highlight}`] : ''}`}>
        {value}
      </span>
    </div>
  );
}

function tierBadgeClass(tier: AdvisorTier): string {
  return styles[`tier${tier}`] ?? '';
}

export function AdvisorMain() {
  const income            = useStore((s) => s.income);
  const expenses          = useStore((s) => s.expenses);
  const blocApr           = useStore((s) => s.blocApr);
  const creditLine        = useStore((s) => s.creditLine);
  const btcPrice          = useStore((s) => s.btcPrice);
  const activeTier        = useStore((s) => s.activeTier);
  const customCollateral  = useStore((s) => s.customCollateral);
  const cbLoanBalance     = useStore((s) => s.cbLoanBalance);
  const cbCollateralBtc   = useStore((s) => s.cbCollateralBtc);
  const cbAprPct          = useStore((s) => s.cbAprPct);
  const cbMonthlyPayment  = useStore((s) => s.cbMonthlyPayment);
  const advisorStartDate         = useStore((s) => s.advisorStartDate);
  const advisorActualBlocBalance = useStore((s) => s.advisorActualBlocBalance);
  const advisorActualBtcHeld     = useStore((s) => s.advisorActualBtcHeld);

  const collateralBtc = getCollateralForTier(activeTier, expenses, btcPrice, customCollateral);
  const currentMonth  = getCurrentStrategyMonth(advisorStartDate);
  const strategyDone  = isStrategyComplete(advisorStartDate);
  const currentCbLtv  = cbCollateralBtc * btcPrice > 0 ? cbLoanBalance / (cbCollateralBtc * btcPrice) : 0;
  const currentTier   = getTier(currentCbLtv);

  const startingBtcHeld = advisorActualBtcHeld || collateralBtc;

  const result = useMemo(
    () => runAdvisor({
      btcPrice, income, expenses,
      blocApr, creditLine, collateralBtc, blocLtvCeiling: 0.15,
      cbBalance: cbLoanBalance, cbCollateralBtc, cbAprPct, cbMonthlyPayment,
      startingBlocBalance: advisorActualBlocBalance,
      startingBtcHeld,
      startingMonth: currentMonth,
    }),
    [
      btcPrice, income, expenses, blocApr, creditLine, collateralBtc,
      cbLoanBalance, cbCollateralBtc, cbAprPct, cbMonthlyPayment,
      advisorActualBlocBalance, startingBtcHeld, currentMonth,
    ],
  );

  const thisMonth = result.rows[0];

  return (
    <div className={styles.main}>

      {/* Section 1 — Header + Progress */}
      <div className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>Advisor</h2>
        <p className={styles.pageSubtitle}>
          Unified Smart BLOC + Coinbase Loan action plan · Flat BTC @ ${btcPrice.toLocaleString()}
        </p>
        <div className={styles.progressBar}>
          {Array.from({ length: 12 }, (_, i) => (
            <div
              key={i + 1}
              className={`${styles.progressDot} ${
                i + 1 < currentMonth   ? styles.progressDotDone    :
                i + 1 === currentMonth ? styles.progressDotCurrent :
                                         styles.progressDotFuture
              }`}
              title={`Month ${i + 1}`}
            />
          ))}
          <span className={styles.progressLabel}>
            {strategyDone ? 'Year complete' : `Month ${currentMonth} of 12`}
          </span>
        </div>
      </div>

      {strategyDone ? (
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Year Complete</h3>
          <p className={styles.cardSubtitle}>
            You've completed 12 months of your strategy. Update your start date
            in the sidebar to begin projecting Year 2.
          </p>
        </div>
      ) : (
        <>
          {/* Section 2 — Current Position */}
          <div className={styles.positionGrid}>
            <div className={styles.positionCard}>
              <div className={styles.positionCardTitle}>SMART BLOC</div>
              <div className={styles.positionStat}>
                <span className={styles.positionLabel}>Current balance</span>
                <span className={styles.positionValue}>{fmtUSD(advisorActualBlocBalance)}</span>
              </div>
              <div className={styles.positionStat}>
                <span className={styles.positionLabel}>Credit available</span>
                <span className={styles.positionValue}>{fmtUSD(Math.max(0, creditLine - advisorActualBlocBalance))}</span>
              </div>
              <div className={styles.positionStat}>
                <span className={styles.positionLabel}>Monthly interest</span>
                <span className={styles.positionValue}>{fmtUSD(Math.round(advisorActualBlocBalance * blocApr / 100 / 12))}</span>
              </div>
            </div>
            <div className={styles.positionCard}>
              <div className={styles.positionCardTitle}>COINBASE LOAN</div>
              <div className={styles.positionStat}>
                <span className={styles.positionLabel}>Balance</span>
                <span className={styles.positionValue}>{fmtUSD(cbLoanBalance)}</span>
              </div>
              <div className={styles.positionStat}>
                <span className={styles.positionLabel}>Current LTV</span>
                <span className={styles.positionValue} style={{ color: getTierColor(currentTier) }}>
                  {(currentCbLtv * 100).toFixed(1)}%
                </span>
              </div>
              <div className={styles.positionStat}>
                <span className={styles.positionLabel}>Monthly interest</span>
                <span className={styles.positionValue}>{fmtUSD(Math.round(cbLoanBalance * cbAprPct / 100 / 12))}</span>
              </div>
            </div>
          </div>

          {/* Section 3 — This Month's Plan */}
          {thisMonth && (
            <div className={`${styles.card} ${styles[`cardTier${currentTier}`]}`}>
              <div className={styles.cardTitleRow}>
                <h3 className={styles.cardTitle}>Month {currentMonth} — This Month's Plan</h3>
                <span className={`${styles.tierBadge} ${tierBadgeClass(currentTier)}`}>
                  TIER {currentTier} — {getTierLabel(currentTier).toUpperCase()}
                </span>
              </div>
              <p className={styles.cardSubtitle}>
                CB LTV: {(currentCbLtv * 100).toFixed(1)}% ·
                BLOC balance: {fmtUSD(advisorActualBlocBalance)} ·
                BTC held: {startingBtcHeld.toFixed(5)}
              </p>

              <div className={styles.actionGrid}>
                <ActionRow
                  icon="💳"
                  label="Draw from BLOC"
                  value={thisMonth.blocDraw > 0 ? fmtUSD(thisMonth.blocDraw) : '$0'}
                  sub="for monthly expenses"
                />
                {thisMonth.fiatGap > 0 && (
                  <ActionRow
                    icon="💵"
                    label="Cover from fiat"
                    value={fmtUSD(thisMonth.fiatGap)}
                    sub="expense gap — pay from savings"
                    highlight="orange"
                  />
                )}
                <ActionRow
                  icon="🏦"
                  label="Pay toward CB Loan"
                  value={fmtUSD(thisMonth.cbPayment)}
                  sub={thisMonth.cbExtraPayment > 0
                    ? `min + ${fmtUSD(thisMonth.cbExtraPayment)} extra (tier ${currentTier})`
                    : 'minimum payment'}
                />
                <ActionRow
                  icon="₿"
                  label="Buy Bitcoin"
                  value={fmtUSD(thisMonth.incomeToBtc)}
                  sub={thisMonth.btcBought > 0 ? `→ ${thisMonth.btcBought.toFixed(5)} BTC` : 'paused this tier'}
                  highlight={thisMonth.incomeToBtc > 0 ? 'green' : undefined}
                />
              </div>

              {currentTier === 1 && (
                <div className={styles.emergencyNote}>
                  ⚠ Emergency active — BTC buying paused until CB LTV drops below 70%
                </div>
              )}
            </div>
          )}

          {/* Section 4 — Projection Table */}
          <div className={styles.card}>
            <div className={styles.projectionHeader}>
              <div>
                <h3 className={styles.cardTitle}>
                  {currentMonth > 1 ? `Months ${currentMonth}–12 Projection` : '12-Month Projection'}
                </h3>
                <p className={styles.cardSubtitle}>
                  Flat BTC ·
                  Combined interest: {fmtUSD(result.totalInterestPaid)} ·
                  BTC accumulated: +{result.totalBtcBought.toFixed(5)}
                </p>
              </div>
              {result.totalFiatGap > 0 && (
                <div className={styles.fiatGapSummary}>
                  <span className={styles.fiatGapLabel}>Total fiat coverage needed</span>
                  <span className={styles.fiatGapValue}>{fmtUSD(result.totalFiatGap)}</span>
                </div>
              )}
            </div>

            {currentMonth > 1 && (
              <div className={styles.pastMonthsNote}>
                Months 1–{currentMonth - 1} completed · Showing Month {currentMonth} onward
              </div>
            )}

            <div className={styles.tableWrapper}>
              <table className={styles.projTable}>
                <thead>
                  <tr>
                    <th>Mo</th>
                    <th>Tier</th>
                    <th>BLOC Draw</th>
                    <th>CB Payment</th>
                    <th>BTC Bought</th>
                    <th>BLOC Bal</th>
                    <th>CB LTV</th>
                    <th>Interest</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr
                      key={row.month}
                      className={`${styles[`rowTier${row.tier}`]} ${row.isCurrentMonth ? styles.rowCurrent : ''}`}
                    >
                      <td className={styles.moCell}>
                        Mo {row.month}
                        {row.isCurrentMonth && <span className={styles.nowPill}>NOW</span>}
                      </td>
                      <td>
                        <span className={`${styles.tierPill} ${tierBadgeClass(row.tier)}`}>
                          T{row.tier}
                        </span>
                      </td>
                      <td>{row.blocDraw > 0 ? fmtUSD(row.blocDraw) : <span className={styles.muted}>—</span>}</td>
                      <td className={styles.paymentCell}>{fmtUSD(row.cbPayment)}</td>
                      <td className={styles.btcCell}>
                        {row.btcBought > 0 ? `+${row.btcBought.toFixed(5)}` : <span className={styles.muted}>—</span>}
                      </td>
                      <td>{fmtUSD(row.blocBalance)}</td>
                      <td style={{ color: getTierColor(row.tier) }}>{(row.cbLtv * 100).toFixed(1)}%</td>
                      <td className={styles.interestCell}>{fmtUSD(row.totalInterest)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td />
                    <td />
                    <td className={styles.paymentCell}>
                      {fmtUSD(result.rows.reduce((s, r) => s + r.cbPayment, 0))}
                    </td>
                    <td className={styles.btcCell}>+{result.totalBtcBought.toFixed(5)}</td>
                    <td>{fmtUSD(result.finalBlocBalance)}</td>
                    <td style={{ color: getTierColor(getTier(cbCollateralBtc * btcPrice > 0 ? result.finalCbBalance / (cbCollateralBtc * btcPrice) : 0)) }}>
                      {(cbCollateralBtc * btcPrice > 0 ? result.finalCbBalance / (cbCollateralBtc * btcPrice) * 100 : 0).toFixed(1)}%
                    </td>
                    <td className={styles.interestCell}>{fmtUSD(result.totalInterestPaid)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Section 5 — Disclaimer */}
      <div className={styles.disclaimer}>
        <strong>Not financial advice.</strong> This tab provides rule-based calculations for
        educational purposes only. Bitcoin-backed loans carry significant risk including
        total loss of collateral. Priority tiers are simplified heuristics — actual
        decisions depend on your full financial situation. Consult a qualified financial
        advisor before making any borrowing decisions.
      </div>

    </div>
  );
}
