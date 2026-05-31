import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { getCurrentStrategyMonth, isStrategyComplete, getTier, getNdpStatus, type AdvisorTier } from '../../simulation/runAdvisor';
import { classifyLtv } from '../../simulation/runCoinbaseLoan';
import { fmtUSD } from '../../utils/format';
import styles from './SimpleModeView.module.css';

interface SimpleModeViewProps {
  onOpenSettings: () => void;
}

function SimpleModeCheckItem({ checked, onChange, label, amount, animating }: {
  checked: boolean; onChange: (v: boolean) => void;
  label: string; amount: string; animating?: boolean;
}) {
  return (
    <label className={`${styles.checkItem} ${checked ? styles.checkItemDone : ''} ${animating ? styles.checkItemPop : ''}`}>
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

  const advisorActualBlocBalance    = useStore((s) => s.advisorActualBlocBalance);
  const setAdvisorActualBlocBalance = useStore((s) => s.setAdvisorActualBlocBalance);
  const advisorStartDate            = useStore((s) => s.advisorStartDate);
  const advisorChecklist            = useStore((s) => s.advisorChecklist);
  const setAdvisorChecklist         = useStore((s) => s.setAdvisorChecklist);
  const ndpLastPaidDate             = useStore((s) => s.ndpLastPaidDate);

  const advisorSkipCbPayment = useStore((s) => s.advisorSkipCbPayment);
  const advisorSkipBtcBuying = useStore((s) => s.advisorSkipBtcBuying);
  const hasCbLoan            = useStore((s) => s.hasCbLoan);

  // Feature 2
  const [showTierTip, setShowTierTip] = useState(false);
  // Feature 4
  const [editingBalance, setEditingBalance] = useState(false);
  // Feature 5
  const [justChecked, setJustChecked] = useState<string | null>(null);
  // Feature 6
  const [showMonthBanner, setShowMonthBanner] = useState(false);
  const prevMonth = useRef<number | null>(null);

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

  const totalItems = (showFiatRow ? 1 : 0) + (hasCbLoan ? 1 : 0) + 2;
  const doneCount  = [
    advisorChecklist.blocDraw,
    showFiatRow && advisorChecklist.fiatCoverage,
    hasCbLoan && advisorChecklist.cbPayment,
    advisorChecklist.btcBuying,
  ].filter(Boolean).length;
  const allDone = doneCount === totalItems;

  const tierBadgeClass = styles[`tier${currentTier}`];
  const cardTierClass  = styles[`cardTier${currentTier}`];

  // Feature 1
  const isDefaultSetup = income === 5000 && expenses === 4000 && advisorActualBlocBalance === 0;

  // Feature 2
  const tierTip: Record<AdvisorTier, string> = {
    4: 'Safe — full BTC buying strategy active',
    3: 'Watch — CB LTV elevated, extra payment directed there',
    2: 'Warning — BLOC draw halved, 50% income to CB paydown',
    1: 'Emergency — stop BLOC draws, all income to CB paydown',
  };

  // Feature 6
  useEffect(() => {
    if (prevMonth.current !== null && prevMonth.current !== advisorChecklist.month) {
      setShowMonthBanner(true);
      const t = setTimeout(() => setShowMonthBanner(false), 4000);
      return () => clearTimeout(t);
    }
    prevMonth.current = advisorChecklist.month;
  }, [advisorChecklist.month]);

  const fireCheck = (key: string, patch: Parameters<typeof setAdvisorChecklist>[0], value: boolean) => {
    if (value) {
      setJustChecked(key);
      setTimeout(() => setJustChecked(null), 350);
    }
    setAdvisorChecklist(patch);
  };

  return (
    <div className={styles.root}>
    <div className={styles.content}>

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.brandMark}>₿</span>
          <span className={styles.brandName}>Personal ₿LOC</span>
        </div>
        <button className={styles.settingsBtn} onClick={onOpenSettings} title="Settings">
          ⚙
        </button>
      </div>

      {/* Feature 1 — empty state banner */}
      {isDefaultSetup && (
        <div className={styles.emptyStateBanner}>
          Your numbers look like defaults — tap ⚙ to personalize
        </div>
      )}

      {/* Feature 6 — new month banner */}
      {showMonthBanner && (
        <div className={styles.newMonthBanner}>
          ✦ New month — here's your plan for{' '}
          {new Date().toLocaleDateString('en-US', { month: 'long' })}
        </div>
      )}

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

              {/* Feature 4 — inline balance edit */}
              {editingBalance ? (
                <input
                  type="number"
                  className={styles.balanceInput}
                  defaultValue={advisorActualBlocBalance}
                  autoFocus
                  onBlur={(e) => {
                    setAdvisorActualBlocBalance(parseFloat(e.target.value) || 0);
                    setEditingBalance(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setAdvisorActualBlocBalance(parseFloat((e.target as HTMLInputElement).value) || 0);
                      setEditingBalance(false);
                    }
                    if (e.key === 'Escape') setEditingBalance(false);
                  }}
                />
              ) : (
                <button
                  className={styles.balanceEditBtn}
                  onClick={() => setEditingBalance(true)}
                  title="Tap to update"
                >
                  Balance: {fmtUSD(advisorActualBlocBalance)} ✎
                </button>
              )}

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
            {hasCbLoan && cbLoanBalance > 0 && (
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

        {/* Feature 3 — NDP urgency card */}
        {(ndp.status === 'soon' || ndp.status === 'overdue') && (
          <div className={`${styles.ndpUrgentCard} ${ndp.status === 'overdue' ? styles.ndpUrgentOverdue : styles.ndpUrgentSoon}`}>
            <span className={styles.ndpUrgentIcon}>
              {ndp.status === 'overdue' ? '⛔' : '⚠'}
            </span>
            <div className={styles.ndpUrgentText}>
              <span className={styles.ndpUrgentTitle}>
                {ndp.status === 'overdue'
                  ? 'NDP overdue — pay Strike immediately'
                  : `NDP due in ${ndp.daysRemaining} days`}
              </span>
              {ndp.estimatedAmount > 0 && (
                <span className={styles.ndpUrgentSub}>
                  ~{fmtUSD(ndp.estimatedAmount)} minimum to keep your line active
                </span>
              )}
            </div>
          </div>
        )}

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
              {/* Feature 2 — tappable tier badge */}
              <button
                className={`${styles.tierBadge} ${tierBadgeClass}`}
                onClick={() => setShowTierTip((v) => !v)}
              >
                T{currentTier}
              </button>
            </div>
            {/* Feature 2 — tier tip */}
            {showTierTip && (
              <p className={styles.tierTip}>
                {hasCbLoan ? tierTip[currentTier] : 'BLOC strategy running normally'}
              </p>
            )}

            <div className={styles.planSection}>
              <span className={styles.planSectionLabel}>FROM STRIKE BLOC</span>
              <SimpleModeCheckItem
                checked={advisorChecklist.blocDraw}
                animating={justChecked === 'blocDraw'}
                onChange={(v) => fireCheck('blocDraw', { blocDraw: v }, v)}
                label="Draw for expenses"
                amount={expectedBlocDraw > 0 ? fmtUSD(expectedBlocDraw) : '—'}
              />
              {showFiatRow && (
                <SimpleModeCheckItem
                  checked={advisorChecklist.fiatCoverage}
                  animating={justChecked === 'fiatCoverage'}
                  onChange={(v) => fireCheck('fiatCoverage', { fiatCoverage: v }, v)}
                  label="Cover from savings"
                  amount={fmtUSD(expectedFiatGap)}
                />
              )}
            </div>

            <div className={styles.planSection}>
              <span className={styles.planSectionLabel}>
                FROM INCOME · {fmtUSD(income)}/mo
              </span>
              {hasCbLoan && (
                <SimpleModeCheckItem
                  checked={advisorChecklist.cbPayment}
                  animating={justChecked === 'cbPayment'}
                  onChange={(v) => fireCheck('cbPayment', { cbPayment: v }, v)}
                  label="Pay CB Loan"
                  amount={advisorSkipCbPayment ? 'Skipped' : expectedCbPayment > 0 ? fmtUSD(expectedCbPayment) : '—'}
                />
              )}
              <SimpleModeCheckItem
                checked={advisorChecklist.btcBuying}
                animating={justChecked === 'btcBuying'}
                onChange={(v) => fireCheck('btcBuying', { btcBuying: v }, v)}
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
    </div>
  );
}
