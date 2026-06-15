import { useState, useMemo } from 'react';
import {
  runAdvisor,
  getTier,
  getTierColor,
  type AdvisorTier,
} from '../../simulation/runAdvisor';
import { PL_B, GENESIS } from '../../simulation/powerLaw';
import { fmtUSD } from '../../utils/format';
import styles from './AdvisorMain.module.css';

// THE shared scenario projection — rendered by BOTH AdvisorMain (Section 4) and Simple Mode's
// Outlook segment. Owns the growth-scenario picker + its own runAdvisor call so both hosts get
// byte-identical scenario behavior from one source. The starting position arrives as props
// (each host derives it via deriveAdvisorStart, threading pendingCollateralAdjustment), so a
// pending deposit flows into the projection on both surfaces.

interface OutlookProjectionProps {
  startingBlocBalance: number;
  startingBtcHeld:     number;
  startingMonth:       number;
  currentMonth:        number;
  btcPrice:            number;
  income:              number;
  expenses:            number;
  blocApr:             number;
  creditLine:          number;
  hasCbLoan:           boolean;
  cbLoanBalance:       number;
  cbCollateralBtc:     number;
  cbAprPct:            number;
  cbMonthlyPayment:    number;
  cbPaymentStrategy:   'monthly' | 'ltvTriggered';
  cbLtvTriggerPct:     number;
  cbLtvTargetPct:      number;
  cbRotateBackPct:     number;
}

function tierBadgeClass(tier: AdvisorTier): string {
  return styles[`tier${tier}`] ?? '';
}

type GrowthScenario = 'bear' | 'flat' | 'powerlaw' | 'bull';

export function OutlookProjection({
  startingBlocBalance, startingBtcHeld, startingMonth, currentMonth,
  btcPrice, income, expenses, blocApr, creditLine,
  hasCbLoan, cbLoanBalance, cbCollateralBtc, cbAprPct, cbMonthlyPayment,
  cbPaymentStrategy, cbLtvTriggerPct, cbLtvTargetPct, cbRotateBackPct,
}: OutlookProjectionProps) {
  const [growthScenario, setGrowthScenario] = useState<GrowthScenario>('flat');

  const plGrowthRate = useMemo(() => {
    const daysNow  = (Date.now() - GENESIS.getTime()) / (1000 * 60 * 60 * 24);
    const daysNext = daysNow + 365.25;
    return Math.pow(daysNext / daysNow, PL_B) - 1;
  }, []);

  const plGrowthPct = Math.round(plGrowthRate * 100);

  const btcGrowthRate = growthScenario === 'bear'     ? -0.30
                      : growthScenario === 'powerlaw'  ? plGrowthRate
                      : growthScenario === 'bull'      ? 0.80
                      : 0;

  const projectedPrice = Math.round(btcPrice * Math.pow(1 + btcGrowthRate, 1.0));

  const result = useMemo(
    () => runAdvisor({
      btcPrice, income, expenses,
      blocApr, creditLine, blocLtvCeiling: 0.15,
      cbBalance:        hasCbLoan ? cbLoanBalance   : 0,
      cbCollateralBtc:  hasCbLoan ? cbCollateralBtc : 1,
      cbAprPct:         hasCbLoan ? cbAprPct        : 0,
      cbMonthlyPayment:  hasCbLoan ? cbMonthlyPayment  : 0,
      cbPaymentStrategy: hasCbLoan ? cbPaymentStrategy : 'monthly',
      cbLtvTriggerPct,
      cbLtvTargetPct,
      cbRotateBackPct,
      startingBlocBalance,
      startingBtcHeld,
      startingMonth,
      btcGrowthRate,
    }),
    [
      btcPrice, income, expenses, blocApr, creditLine,
      cbLoanBalance, cbCollateralBtc, cbAprPct, cbMonthlyPayment,
      cbPaymentStrategy, cbLtvTriggerPct, cbLtvTargetPct, cbRotateBackPct,
      startingBlocBalance, startingBtcHeld, startingMonth,
      btcGrowthRate, hasCbLoan,
    ],
  );

  return (
    <div className={styles.card}>
      <div className={styles.projectionHeader}>
        <div>
          <h3 className={styles.cardTitle}>
            {currentMonth > 1 ? `Months ${currentMonth}–12 Projection` : '12-Month Projection'}
          </h3>
          <p className={styles.cardSubtitle}>
            {growthScenario === 'flat' ? 'Flat BTC' : growthScenario === 'bear' ? '−30%/yr bear' : growthScenario === 'powerlaw' ? `Power Law ~${plGrowthPct}%/yr` : '+80%/yr bull'} ·
            Combined interest: {fmtUSD(result.totalInterestPaid)} ·
            BTC accumulated: +{result.totalBtcBought.toFixed(5)}
          </p>
        </div>
        <div className={styles.projHeaderRight}>
          {result.totalFiatGap > 0 && (
            <div className={styles.fiatGapSummary}>
              <span className={styles.fiatGapLabel}>Total fiat coverage needed</span>
              <span className={styles.fiatGapValue}>{fmtUSD(result.totalFiatGap)}</span>
            </div>
          )}
          <div className={styles.priceEstimates}>
            <div className={styles.priceEstimateRow}>
              <span className={styles.bullet}>·</span>
              <span className={styles.priceEstLabel}>12-mo est.</span>
              <span className={styles.priceEstValue}>${projectedPrice.toLocaleString()}</span>
            </div>
            <div className={styles.priceEstimateRow}>
              <span className={styles.bullet}>·</span>
              <span className={styles.priceEstLabel}>Live</span>
              <span className={styles.priceEstValue}>${Math.round(btcPrice).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.scenarioToggle}>
        {([
          { key: 'bear',     label: 'Bear −30%'                },
          { key: 'flat',     label: 'Flat'                     },
          { key: 'powerlaw', label: `Power Law ~${plGrowthPct}%` },
          { key: 'bull',     label: 'Bull +80%'                },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            className={`${styles.scenarioBtn} ${growthScenario === key ? styles.scenarioBtnActive : ''}`}
            onClick={() => setGrowthScenario(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className={styles.scenarioDisclaimer}>
        Directional model only
      </p>

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
              {hasCbLoan && <th>{cbPaymentStrategy === 'ltvTriggered' ? 'CB Paydown' : 'CB Payment'}</th>}
              <th>BTC Bought</th>
              <th>Drawn</th>
              {hasCbLoan && <th>CB LTV</th>}
              <th>Interest</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr
                key={row.month}
                className={[
                  styles[`rowTier${row.tier}`],
                  row.isCurrentMonth ? styles.rowCurrent : '',
                  (cbPaymentStrategy === 'ltvTriggered' && row.cbLtvTriggered) ? styles.rowTrigger : '',
                ].filter(Boolean).join(' ')}
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
                {hasCbLoan && (
                  <td className={`${styles.paymentCell} ${row.cbLtvTriggered ? styles.triggerCell : ''}`}>
                    {cbPaymentStrategy === 'ltvTriggered'
                      ? (row.cbPaydownDraw > 0
                          ? <>{row.cbPaydownCapped && <span title={`$${Math.round(row.cbPaydownShortfall).toLocaleString()} shortfall`}>⚠ </span>}{fmtUSD(row.cbPaydownDraw)}</>
                          : row.strikeRepayFired
                            ? <span className={styles.rotateCell}>↩ {fmtUSD(row.strikeRepayDraw)}</span>
                            : <span className={styles.muted}>—</span>)
                      : fmtUSD(row.cbPayment)
                    }
                  </td>
                )}
                <td className={styles.btcCell}>
                  {row.btcBought > 0 ? `+${row.btcBought.toFixed(5)}` : <span className={styles.muted}>—</span>}
                </td>
                <td>{fmtUSD(row.blocBalance)}</td>
                {hasCbLoan && (
                  cbPaymentStrategy === 'ltvTriggered'
                    ? <td className={row.cbLtvTriggered ? styles.triggerCell : styles.muted}>
                        {(row.cbLtv * 100).toFixed(1)}%
                      </td>
                    : <td style={{ color: getTierColor(row.tier) }}>{(row.cbLtv * 100).toFixed(1)}%</td>
                )}
                <td className={styles.interestCell}>{fmtUSD(row.totalInterest)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td />
              <td>{fmtUSD(result.rows.reduce((s, r) => s + r.blocDraw, 0))}</td>
              {hasCbLoan && (
                <td className={styles.paymentCell}>
                  {cbPaymentStrategy === 'ltvTriggered'
                    ? (() => {
                        const paydown = result.rows.reduce((s, r) => s + r.cbPaydownDraw, 0);
                        const rotated = result.rows.reduce((s, r) => s + r.strikeRepayDraw, 0);
                        return (
                          <>
                            {fmtUSD(paydown)}
                            {rotated > 0 && <span className={styles.rotateCell}> · ↩ {fmtUSD(rotated)}</span>}
                          </>
                        );
                      })()
                    : fmtUSD(result.rows.reduce((s, r) => s + r.cbPayment, 0))
                  }
                </td>
              )}
              <td className={styles.btcCell}>+{result.totalBtcBought.toFixed(5)}</td>
              <td>→ {fmtUSD(result.finalBlocBalance)} <span className={styles.muted}>end</span></td>
              {hasCbLoan && (
                <td style={{ color: getTierColor(getTier(cbCollateralBtc * btcPrice > 0 ? result.finalCbBalance / (cbCollateralBtc * btcPrice) : 0)) }}>
                  {(cbCollateralBtc * btcPrice > 0 ? result.finalCbBalance / (cbCollateralBtc * btcPrice) * 100 : 0).toFixed(1)}%
                </td>
              )}
              <td className={styles.interestCell}>{fmtUSD(result.totalInterestPaid)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
