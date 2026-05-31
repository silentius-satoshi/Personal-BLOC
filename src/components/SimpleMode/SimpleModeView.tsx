import { useStore } from '../../store/useStore';
import { getCurrentStrategyMonth, isStrategyComplete, getTier, getNdpStatus } from '../../simulation/runAdvisor';
import { classifyLtv } from '../../simulation/runCoinbaseLoan';
import { fmtUSD } from '../../utils/format';
import styles from './SimpleModeView.module.css';

interface SimpleModeViewProps {
  onOpenSettings: () => void;
}

function SimpleModeCheckItem({ checked, onChange, label, amount }: {
  checked: boolean; onChange: (v: boolean) => void;
  label: string; amount: string;
}) {
  return (
    <label className={`${styles.checkItem} ${checked ? styles.checkItemDone : ''}`}>
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.checkLabel}>{label}</span>
      <span className={styles.checkAmount}>{amount}</span>
    </label>
  );
}

export function SimpleModeView({ onOpenSettings }: SimpleModeViewProps) {
  const income    = useStore((s) => s.income);
  const expenses  = useStore((s) => s.expenses);
  const btcPrice  = useStore((s) => s.btcPrice);
  const blocApr   = useStore((s) => s.blocApr);
  const creditLine = useStore((s) => s.creditLine);

  const cbLoanBalance    = useStore((s) => s.cbLoanBalance);
  const cbCollateralBtc  = useStore((s) => s.cbCollateralBtc);
  const cbMonthlyPayment = useStore((s) => s.cbMonthlyPayment);

  const advisorActualBlocBalance = useStore((s) => s.advisorActualBlocBalance);
  const advisorStartDate         = useStore((s) => s.advisorStartDate);
  const advisorChecklist         = useStore((s) => s.advisorChecklist);
  const setAdvisorChecklist      = useStore((s) => s.setAdvisorChecklist);
  const ndpLastPaidDate          = useStore((s) => s.ndpLastPaidDate);

  const advisorSkipCbPayment = useStore((s) => s.advisorSkipCbPayment);
  const advisorSkipBtcBuying = useStore((s) => s.advisorSkipBtcBuying);

  const currentMonth = getCurrentStrategyMonth(advisorStartDate);
  const strategyDone = isStrategyComplete(advisorStartDate);
  const currentCbLtv = cbCollateralBtc * btcPrice > 0
    ? cbLoanBalance / (cbCollateralBtc * btcPrice)
    : 0;
  const currentTier = getTier(currentCbLtv);
  const cbStatus    = classifyLtv(currentCbLtv);
  const ndp         = getNdpStatus(
    ndpLastPaidDate,
    advisorActualBlocBalance > 0 ? advisorActualBlocBalance : creditLine * 0.15,
    blocApr,
  );

  const expectedBlocDraw = currentTier === 1 ? 0
    : currentTier === 2
      ? Math.min(expenses * 0.5, Math.max(0, creditLine - advisorActualBlocBalance))
      : Math.min(expenses, Math.max(0, creditLine - advisorActualBlocBalance));
  const expectedFiatGap   = Math.max(0, expenses - expectedBlocDraw);
  const expectedCbPayment = advisorSkipCbPayment ? 0 : cbMonthlyPayment;
  const expectedBtcBuying = advisorSkipBtcBuying ? 0
    : currentTier === 1 ? 0 : Math.max(0, income - expectedCbPayment);
  const showFiatRow = expectedFiatGap > 0;

  const totalItems = showFiatRow ? 4 : 3;
  const doneCount  = [
    advisorChecklist.blocDraw,
    showFiatRow && advisorChecklist.fiatCoverage,
    advisorChecklist.cbPayment,
    advisorChecklist.btcBuying,
  ].filter(Boolean).length;
  const allDone = doneCount === totalItems;

  const tierBadgeClass = styles[`tier${currentTier}`];
  const cardTierClass  = styles[`cardTier${currentTier}`];

  return (
    <div className={styles.root}>

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.brandMark}>₿</span>
          <span className={styles.brandName}>Personal ₿LOC</span>
        </div>
        <button className={styles.settingsBtn} onClick={onOpenSettings} title="Settings">
          ⚙
        </button>
      </div>

      {!strategyDone && (
        <div className={styles.progressRow}>
          {Array.from({ length: 12 }, (_, i) => (
            <div
              key={i}
              className={`${styles.progressDot} ${
                i + 1 < currentMonth  ? styles.dotDone :
                i + 1 === currentMonth ? styles.dotCurrent :
                                          styles.dotFuture
              }`}
            />
          ))}
          <span className={styles.progressLabel}>Month {currentMonth} of 12</span>
        </div>
      )}

      <div className={styles.cards}>

        {/* Position card */}
        <div className={styles.card}>
          <div className={styles.positionRow}>
            <div className={styles.positionCol}>
              <span className={styles.positionTitle}>STRIKE BLOC</span>
              <span className={styles.positionStat}>
                Balance: {fmtUSD(advisorActualBlocBalance)}
              </span>
              <span className={styles.positionStat}>
                Available: {fmtUSD(Math.max(0, creditLine - advisorActualBlocBalance))}
              </span>
              <span className={`${styles.ndpBadge} ${styles[`ndp_${ndp.status}`]}`}>
                {ndp.status === 'never'    && 'NDP — not recorded'}
                {ndp.status === 'ok'       && `NDP: ${ndp.daysRemaining}d`}
                {ndp.status === 'upcoming' && `⚠ NDP: ${ndp.daysRemaining}d`}
                {ndp.status === 'soon'     && `⚠ NDP: ${ndp.daysRemaining}d`}
                {ndp.status === 'overdue'  && '⛔ NDP overdue'}
              </span>
            </div>
            {cbLoanBalance > 0 && (
              <div className={styles.positionCol}>
                <span className={styles.positionTitle}>CB LOAN</span>
                <span className={styles.positionStat}>
                  LTV: {(currentCbLtv * 100).toFixed(1)}%
                </span>
                <span className={`${styles.cbBadge} ${styles[`cb_${cbStatus}`]}`}>
                  {cbStatus.toUpperCase()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Plan / completion card */}
        {allDone ? (
          <div className={`${styles.card} ${styles.cardDone}`}>
            <div className={styles.doneIcon}>✓</div>
            <h3 className={styles.doneTitle}>Month {currentMonth} complete</h3>
            <p className={styles.doneSub}>
              {strategyDone
                ? 'Year complete — update your start date in Settings to begin Year 2'
                : `Come back next month`
              }
            </p>
            <button
              className={styles.undoBtn}
              onClick={() => setAdvisorChecklist({
                month: currentMonth,
                blocDraw: false, cbPayment: false,
                btcBuying: false, fiatCoverage: false,
              })}
            >
              ← Undo
            </button>
          </div>
        ) : (
          <div className={`${styles.card} ${cardTierClass}`}>
            <div className={styles.planHeader}>
              <h3 className={styles.planTitle}>
                {new Date().toLocaleDateString('en-US', { month: 'long' })} — Your Plan
              </h3>
              <span className={`${styles.tierBadge} ${tierBadgeClass}`}>
                T{currentTier}
              </span>
            </div>

            <div className={styles.planSection}>
              <span className={styles.planSectionLabel}>FROM STRIKE BLOC</span>
              <SimpleModeCheckItem
                checked={advisorChecklist.blocDraw}
                onChange={(v) => setAdvisorChecklist({ blocDraw: v })}
                label="Draw for expenses"
                amount={expectedBlocDraw > 0 ? fmtUSD(expectedBlocDraw) : '—'}
              />
              {showFiatRow && (
                <SimpleModeCheckItem
                  checked={advisorChecklist.fiatCoverage}
                  onChange={(v) => setAdvisorChecklist({ fiatCoverage: v })}
                  label="Cover from savings"
                  amount={fmtUSD(expectedFiatGap)}
                />
              )}
            </div>

            <div className={styles.planSection}>
              <span className={styles.planSectionLabel}>
                FROM INCOME · {fmtUSD(income)}/mo
              </span>
              <SimpleModeCheckItem
                checked={advisorChecklist.cbPayment}
                onChange={(v) => setAdvisorChecklist({ cbPayment: v })}
                label="Pay CB Loan"
                amount={advisorSkipCbPayment ? 'Skipped' : expectedCbPayment > 0 ? fmtUSD(expectedCbPayment) : '—'}
              />
              <SimpleModeCheckItem
                checked={advisorChecklist.btcBuying}
                onChange={(v) => setAdvisorChecklist({ btcBuying: v })}
                label="Buy Bitcoin"
                amount={advisorSkipBtcBuying ? 'Skipped' : expectedBtcBuying > 0 ? fmtUSD(expectedBtcBuying) : '—'}
              />
            </div>

            <div className={styles.progress}>
              {doneCount} of {totalItems} done
            </div>
          </div>
        )}

      </div>

      <button className={styles.fullAppLink} onClick={onOpenSettings}>
        Full App →
      </button>

    </div>
  );
}
