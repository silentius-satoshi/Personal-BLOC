import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { runBlocYearOne, getCollateralForTier } from '../../simulation/runBlocYearOne';
import { fmtUSD } from '../../utils/format';
import styles from './MonthBreakdown.module.css';

export default function MonthBreakdown() {
  const income           = useStore((s) => s.income);
  const expenses         = useStore((s) => s.expenses);
  const btcPrice         = useStore((s) => s.btcPrice);
  const activeTier       = useStore((s) => s.activeTier);
  const customCollateral = useStore((s) => s.customCollateral);
  const blocApr          = useStore((s) => s.blocApr);
  const creditLine       = useStore((s) => s.creditLine);

  const ltvCeiling = 0.15;

  const collateralBtc = getCollateralForTier(activeTier, expenses, btcPrice, customCollateral);

  const result = useMemo(
    () => runBlocYearOne({ collateralBtc, btcPrice, income, expenses, apr: blocApr / 100, ltvCeiling, creditLine }),
    [collateralBtc, btcPrice, income, expenses, blocApr, creditLine],
  );

  const breakEven = income / (1 + (blocApr / 100) / 12);
  const isSustainable = expenses <= breakEven;
  const anyCreditExceeded = result.rows.some((r) => r.creditExceeded);

  const ndpInterest = Math.round(result.rows[0].strikeBalance * (blocApr / 100) / 12);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h3 className={styles.title}>Month-by-Month Breakdown</h3>
          <p className={styles.subtitle}>
            Flat BTC · 15% LTV ceiling · {collateralBtc.toFixed(5)} BTC collateral
            {' · '}
            <span className={styles.creditLineLabel}>Credit line: {fmtUSD(creditLine)}</span>
          </p>
        </div>
        <span className={isSustainable ? styles.sustainGreen : styles.sustainOrange}>
          {isSustainable ? 'BTC buying runs all year' : 'Draw exceeds break-even — balance will drift'}
        </span>
      </div>

      {anyCreditExceeded && (
        <div className={styles.creditWarning}>
          ⚠ Credit line reached — draws capped at {fmtUSD(creditLine)}. Contact Strike to request a credit line increase.
        </div>
      )}

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Month</th>
              <th>Income → BTC</th>
              <th>Paydown</th>
              <th>BTC Bought</th>
              <th>Strike Bal.</th>
              <th>Strike Col.</th>
              <th>Strike LTV</th>
              <th>Avail. Credit</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => {
              const phaseClass =
                row.phase === 1 ? styles.phaseOne :
                row.phase === 2 ? styles.phaseTwo :
                styles.phaseThree;

              const creditCellClass =
                row.availableCredit === 0
                  ? styles.cellRed
                  : row.availableCredit < creditLine * 0.1
                    ? styles.cellOrange
                    : styles.cellMuted;

              return (
                <tr
                  key={row.month}
                  className={`${phaseClass}${row.creditExceeded ? ` ${styles.creditExceededRow}` : ''}`}
                >
                  <td>
                    <span className={styles.monthLabel}>Mo {row.month}</span>
                    {row.month === 1 && (
                      <span
                        className={styles.ndpBadge}
                        title="Annual Non-Draw Payment month — pay ~$38 from USD balance instead of rolling via Draw. Satisfies 12-month requirement at minimum cost."
                      >
                        NDP
                      </span>
                    )}
                  </td>
                  <td className={styles.cellGreen}>{fmtUSD(row.incomeTowardBtc)}</td>
                  <td className={row.paydown > 0 ? styles.cellOrange : styles.cellMuted}>
                    {row.paydown > 0 ? fmtUSD(row.paydown) : '—'}
                  </td>
                  <td className={styles.cellGreen}>{row.btcBought.toFixed(5)}</td>
                  <td>{fmtUSD(row.strikeBalance)}</td>
                  <td>{row.strikeCollateral.toFixed(5)} BTC</td>
                  <td className={styles.cellGreen}>{(row.strikeLtv * 100).toFixed(2)}%</td>
                  <td className={creditCellClass}>{fmtUSD(row.availableCredit)}</td>
                </tr>
              );
            })}

            <tr className={styles.yearTotal}>
              <td><span className={styles.yearLabel}>Year Total</span></td>
              <td className={styles.cellGreen}>{fmtUSD(result.totalIncomeTowardBtc)}</td>
              <td className={styles.cellOrange}>{fmtUSD(result.totalPaydown)}</td>
              <td className={styles.cellGreen}>+{result.totalBtcBought.toFixed(5)} BTC</td>
              <td>{fmtUSD(result.finalBalance)}</td>
              <td>{result.finalCollateral.toFixed(5)} BTC</td>
              <td className={styles.cellGreen}>{(result.finalLtv * 100).toFixed(2)}%</td>
              <td className={styles.cellMuted}>{fmtUSD(Math.max(0, creditLine - result.finalBalance))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <div className={styles.legendDot} style={{ background: 'var(--green)' }} />
          Phase 1 — Full income buys BTC
        </div>
        <div className={styles.legendItem}>
          <div className={styles.legendDot} style={{ background: 'var(--amber)' }} />
          Phase 2 — First paydown month
        </div>
        <div className={styles.legendItem}>
          <div className={styles.legendDot} style={{ background: 'var(--border)' }} />
          Phase 3 — Equilibrium (partial paydown)
        </div>
      </div>

      <p className={styles.footnote}>
        <span className={styles.ndpInline}>NDP</span>
        {' '}Annual Non-Draw Payment — pay one month's interest (~${ndpInterest} in Mo 1) from your Strike USD balance. Satisfies the 12-month requirement at minimum cost. Keep $150 USD buffer in Strike account.
      </p>
    </section>
  );
}
