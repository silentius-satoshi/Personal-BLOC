import { useState, useMemo } from 'react';
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
import { deriveAdvisorStart, deriveCurrentPosition } from '../../simulation/logUtils';
import { strikeAvailableCredit, BLOC_OPERATING_CEILING } from '../../simulation/strikeCredit';
import { fmtUSD } from '../../utils/format';
import { MonthlyLogSection } from './MonthlyLogSection';
import { MonthlyLogOverlay } from './MonthlyLogOverlay';
import { OutlookProjection } from './OutlookProjection';
import styles from './AdvisorMain.module.css';

interface ActionRowProps {
  icon: string;
  label: string;
  sub: string;
  value: string;
  valueColor: string;
  skipped: boolean;
  onPay: () => void;
  onSkip: () => void;
  styles: Record<string, string>;
}

function ActionRow({ icon, label, sub, value, valueColor, skipped, onPay, onSkip, styles }: ActionRowProps) {
  return (
    <div className={`${styles.actionRow} ${skipped ? styles.actionRowSkipped : ''}`}>
      <span className={styles.actionIcon}>{icon}</span>
      <div className={styles.actionContent}>
        <span className={styles.actionLabel}>{label}</span>
        <span className={styles.actionSub}>{sub}</span>
      </div>
      <div className={styles.actionRight}>
        <span
          className={styles.actionValue}
          style={{ color: skipped ? 'var(--text-faint)' : valueColor, textDecoration: skipped ? 'line-through' : 'none' }}
        >
          {value}
        </span>
        <div className={styles.paySkipBtns}>
          <button
            className={`${styles.paySkipBtn} ${!skipped ? styles.paySkipBtnActive : ''}`}
            onClick={onPay}
          >Pay</button>
          <button
            className={`${styles.paySkipBtn} ${skipped ? styles.paySkipBtnSkipped : ''}`}
            onClick={onSkip}
          >Skip</button>
        </div>
      </div>
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
  const cbLoanBalance     = useStore((s) => s.cbLoanBalance);
  const cbCollateralBtc   = useStore((s) => s.cbCollateralBtc);
  const cbAprPct          = useStore((s) => s.cbAprPct);
  const cbMonthlyPayment   = useStore((s) => s.cbMonthlyPayment);
  const cbPaymentStrategy  = useStore((s) => s.cbPaymentStrategy);
  const cbLtvTriggerPct    = useStore((s) => s.cbLtvTriggerPct);
  const cbLtvTargetPct     = useStore((s) => s.cbLtvTargetPct);
  const cbRotateBackPct    = useStore((s) => s.cbRotateBackPct);
  const blocMinPaymentSource = useStore((s) => s.blocMinPaymentSource);
  const advisorStartDate         = useStore((s) => s.advisorStartDate);
  const advisorActualBlocBalance = useStore((s) => s.advisorActualBlocBalance);
  const advisorMonthStartBalance = useStore((s) => s.advisorMonthStartBalance);
  const advisorActualBtcHeld     = useStore((s) => s.advisorActualBtcHeld);
  const pendingCollateralAdjustment = useStore((s) => s.pendingCollateralAdjustment);
  const currentBtcHeld           = useStore((s) => s.getCurrentBtcHeld());
  const advisorSkipBlocDraw      = useStore((s) => s.advisorSkipBlocDraw);
  const advisorSkipCbPayment     = useStore((s) => s.advisorSkipCbPayment);
  const advisorSkipBtcBuying     = useStore((s) => s.advisorSkipBtcBuying);
  const hasCbLoan                = useStore((s) => s.hasCbLoan);
  const monthlyLog               = useStore((s) => s.monthlyLog);
  const setAdvisorSkipBlocDraw   = useStore((s) => s.setAdvisorSkipBlocDraw);
  const setAdvisorSkipCbPayment  = useStore((s) => s.setAdvisorSkipCbPayment);
  const setAdvisorSkipBtcBuying  = useStore((s) => s.setAdvisorSkipBtcBuying);

  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayInitialMonth, setOverlayInitialMonth] = useState(0);

  const collateralBtc = getCollateralForTier(activeTier, expenses, btcPrice, currentBtcHeld);
  const position      = deriveCurrentPosition(monthlyLog, advisorActualBtcHeld, advisorActualBlocBalance, pendingCollateralAdjustment);
  const availCredit   = strikeAvailableCredit(creditLine, position.btcHeld, btcPrice, position.blocBalance);
  const currentMonth  = getCurrentStrategyMonth(advisorStartDate);
  const strategyDone  = isStrategyComplete(advisorStartDate);
  const effectiveCbBalance = hasCbLoan ? cbLoanBalance : 0;
  const currentCbLtv  = cbCollateralBtc * btcPrice > 0 ? effectiveCbBalance / (cbCollateralBtc * btcPrice) : 0;
  const currentTier   = getTier(currentCbLtv);

  const { startingBlocBalance, startingBtcHeld, startingMonth } = useMemo(
    () => deriveAdvisorStart(
      monthlyLog,
      advisorActualBtcHeld,
      advisorActualBlocBalance,
      currentMonth,
      pendingCollateralAdjustment,
      advisorMonthStartBalance,
    ),
    [monthlyLog, advisorActualBtcHeld, advisorActualBlocBalance, advisorStartDate, currentMonth, pendingCollateralAdjustment, advisorMonthStartBalance],
  );

  const result = useMemo(
    () => {
      const r = runAdvisor({
        btcPrice, income, expenses,
        blocApr, creditLine, blocLtvCeiling: BLOC_OPERATING_CEILING,
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
        btcGrowthRate: 0,   // operating plan = flat; scenario projection lives in <OutlookProjection>
        blocMinPaymentSource,
      });
      return r;
    },
    [
      btcPrice, income, expenses, blocApr, creditLine,
      cbLoanBalance, cbCollateralBtc, cbAprPct, cbMonthlyPayment,
      cbPaymentStrategy, cbLtvTriggerPct, cbLtvTargetPct, cbRotateBackPct,
      startingBlocBalance, startingBtcHeld, startingMonth, blocMinPaymentSource,
    ],
  );

  const thisMonth = result.rows[0];

  const overriddenPlan = useMemo(() => {
    if (!thisMonth) return null;

    const blocPaydown = Math.max(0, income - thisMonth.cbPayment - thisMonth.incomeToBtc);

    const effectiveBlocDraw = advisorSkipBlocDraw ? 0 : thisMonth.blocDraw;
    const effectiveFiatGap  = expenses - effectiveBlocDraw;

    let availableIncome = income - blocPaydown;

    // In ltvTriggered mode, CB payment from income is always 0
    const effectiveCbPayment = cbPaymentStrategy === 'ltvTriggered' ? 0
      : advisorSkipCbPayment ? 0 : thisMonth.cbPayment;
    availableIncome -= effectiveCbPayment;

    const effectiveBtcIncome   = advisorSkipBtcBuying ? 0 : availableIncome;
    const effectiveUnallocated = advisorSkipBtcBuying ? availableIncome : 0;
    const effectiveBtcBought   = effectiveBtcIncome / btcPrice;

    const totalAllocated = blocPaydown + effectiveCbPayment + effectiveBtcIncome;

    return {
      blocDraw:       effectiveBlocDraw,
      fiatGap:        effectiveFiatGap,
      blocPaydown,
      cbPayment:      effectiveCbPayment,
      cbSkipped:      advisorSkipCbPayment,
      cbFreed:        advisorSkipCbPayment ? thisMonth.cbPayment : 0,
      cbPaydownDraw:      thisMonth.cbPaydownDraw,
      cbLtvTriggered:     thisMonth.cbLtvTriggered,
      cbPaydownCapped:    thisMonth.cbPaydownCapped,
      cbPaydownShortfall: thisMonth.cbPaydownShortfall,
      strikeRepayDraw:    thisMonth.strikeRepayDraw,
      strikeRepayFired:   thisMonth.strikeRepayFired,
      btcIncome:      effectiveBtcIncome,
      btcBought:      effectiveBtcBought,
      unallocated:    effectiveUnallocated,
      totalAllocated,
      incomeFullyUsed: Math.abs(totalAllocated - income) < 0.01,
    };
  }, [
    thisMonth, income, expenses, btcPrice,
    cbPaymentStrategy,
    advisorSkipBlocDraw, advisorSkipCbPayment, advisorSkipBtcBuying,
  ]);

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
          <div className={hasCbLoan ? styles.positionGrid : styles.positionGridSingle}>
            <div className={styles.positionCard}>
              <div className={styles.positionCardTitle}>SMART BLOC</div>
              <div className={styles.positionStat}>
                <span className={styles.positionLabel}>Amount Drawn</span>
                <span className={styles.positionValue}>{fmtUSD(advisorActualBlocBalance)}</span>
              </div>
              <div className={styles.positionStat}>
                <span className={styles.positionLabel}>Available Credit</span>
                <span className={styles.positionValue}>{fmtUSD(availCredit.available)}</span>
              </div>
              <div className={styles.positionSub} style={{ color: availCredit.binding === 'collateral' ? 'var(--amber)' : 'var(--text-ghost)' }}>
                {availCredit.binding === 'line'
                  ? `limited by credit line · fully backed above ${fmtUSD(availCredit.fullyBackedPrice)}`
                  : 'limited by collateral value (50% LTV)'}
              </div>
              <div className={styles.positionStat}>
                <span className={styles.positionLabel}>Monthly interest</span>
                <span className={styles.positionValue}>{fmtUSD(Math.round(advisorActualBlocBalance * blocApr / 100 / 12))}</span>
              </div>
              {hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && overriddenPlan?.strikeRepayFired && (
                <div className={styles.positionSub} style={{ color: 'var(--green)' }}>
                  ↩ Rotation ready — shift this balance to the cheaper CB loan
                </div>
              )}
            </div>
            {hasCbLoan && (
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
            )}
          </div>

          {/* Section 3 — This Month's Plan */}
          {thisMonth && (
            <div className={`${styles.card} ${styles[`cardTier${currentTier}`]}`}>
              <div className={styles.cardTitleRow}>
                <h3 className={styles.cardTitle}>Month {currentMonth} — This Month's Plan</h3>
                <span className={`${styles.tierBadge} ${hasCbLoan && cbPaymentStrategy === 'ltvTriggered' ? tierBadgeClass(4) : tierBadgeClass(currentTier)}`}>
                  {hasCbLoan && cbPaymentStrategy === 'ltvTriggered'
                    ? `LTV-TRIGGERED — ${cbLtvTriggerPct}% TRIGGER / ${cbLtvTargetPct}% TARGET`
                    : `TIER ${currentTier} — ${getTierLabel(currentTier).toUpperCase()}`}
                </span>
              </div>
              <p className={styles.cardSubtitle}>
                {hasCbLoan && `CB LTV: ${(currentCbLtv * 100).toFixed(1)}% · `}
                BLOC: {fmtUSD(advisorActualBlocBalance)} ·
                BTC: {startingBtcHeld.toFixed(5)}
              </p>

              {overriddenPlan && (
                <>
                  {/* FROM CREDIT LINE */}
                  <div className={styles.fundingSection}>
                    <div className={styles.fundingLabel}>FROM CREDIT LINE</div>

                    <ActionRow
                      icon="💳"
                      label="Draw from BLOC"
                      sub="covers monthly expenses"
                      value={fmtUSD(overriddenPlan.blocDraw)}
                      valueColor="var(--amber)"
                      skipped={advisorSkipBlocDraw}
                      onPay={() => setAdvisorSkipBlocDraw(false)}
                      onSkip={() => setAdvisorSkipBlocDraw(true)}
                      styles={styles}
                    />

                    {hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && overriddenPlan.cbLtvTriggered && (
                      <div className={styles.mandatoryRow}>
                        <span className={styles.mandatoryLabel}>⚠ CB LTV alert — BLOC draws to pay down CB</span>
                        <span className={styles.mandatoryValue}>{fmtUSD(overriddenPlan.cbPaydownDraw)}</span>
                      </div>
                    )}
                    {hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && overriddenPlan.cbLtvTriggered && overriddenPlan.cbPaydownCapped && (
                      <div className={styles.mandatoryRow} style={{ color: 'var(--amber)', fontSize: '0.8rem' }}>
                        ⚠ Paydown capped — Strike credit line reached · {fmtUSD(overriddenPlan.cbPaydownShortfall)} shortfall
                      </div>
                    )}
                    {hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && overriddenPlan.strikeRepayFired && (
                      <div className={styles.mandatoryRow} style={{ color: 'var(--green)' }}>
                        <span className={styles.mandatoryLabel}>
                          ↩ Rotate to cheap debt — Strike repaid
                          <span className={styles.muted} style={{ display: 'block', fontSize: '0.8rem' }}>
                            saves ~{fmtUSD(overriddenPlan.strikeRepayDraw * (blocApr - cbAprPct) / 100)}/yr
                          </span>
                        </span>
                        <span className={styles.mandatoryValue}>{fmtUSD(overriddenPlan.strikeRepayDraw)}</span>
                      </div>
                    )}

                    {(advisorSkipBlocDraw || overriddenPlan.fiatGap > 0) && (
                      <div className={styles.redirectNote}>
                        💵 Cover from fiat: <strong>{fmtUSD(overriddenPlan.fiatGap)}</strong>
                        {' '}
                        <span className={styles.muted}>
                          {advisorSkipBlocDraw
                            ? '(BLOC draw skipped)'
                            : hasCbLoan && cbPaymentStrategy === 'monthly' && (currentTier === 1 || currentTier === 2)
                              ? '(BLOC draw limited by CB priority rules)'
                              : '(credit line fully drawn)'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* FROM MONTHLY INCOME */}
                  <div className={styles.fundingSection}>
                    <div className={styles.fundingLabel}>
                      FROM MONTHLY INCOME
                      <span className={styles.fundingIncome}>{fmtUSD(income)}/mo</span>
                    </div>

                    {overriddenPlan.blocPaydown > 0 && (
                      <div className={styles.mandatoryRow}>
                        <span className={styles.mandatoryLabel}>⚡ BLOC paydown (LTV triggered)</span>
                        <span className={styles.mandatoryValue}>{fmtUSD(overriddenPlan.blocPaydown)}</span>
                      </div>
                    )}

                    {hasCbLoan && cbPaymentStrategy === 'monthly' && (
                      <ActionRow
                        icon="🏦"
                        label="CB Loan payment"
                        sub={overriddenPlan.cbSkipped
                          ? `skipped — ${fmtUSD(overriddenPlan.cbFreed)} redirected to BTC`
                          : thisMonth.cbExtraPayment > 0
                            ? `min + ${fmtUSD(thisMonth.cbExtraPayment)} extra`
                            : 'minimum payment'}
                        value={fmtUSD(overriddenPlan.cbPayment)}
                        valueColor="var(--red)"
                        skipped={advisorSkipCbPayment}
                        onPay={() => setAdvisorSkipCbPayment(false)}
                        onSkip={() => setAdvisorSkipCbPayment(true)}
                        styles={styles}
                      />
                    )}

                    <ActionRow
                      icon="₿"
                      label="Buy Bitcoin"
                      sub={advisorSkipBtcBuying
                        ? `skipped — ${fmtUSD(overriddenPlan.unallocated)} unallocated`
                        : `→ ${overriddenPlan.btcBought.toFixed(5)} BTC`}
                      value={fmtUSD(overriddenPlan.btcIncome)}
                      valueColor="var(--green)"
                      skipped={advisorSkipBtcBuying}
                      onPay={() => setAdvisorSkipBtcBuying(false)}
                      onSkip={() => setAdvisorSkipBtcBuying(true)}
                      styles={styles}
                    />

                    {advisorSkipBtcBuying && overriddenPlan.unallocated > 0 && (
                      <div className={styles.unallocatedNote}>
                        💵 Unallocated cash: <strong>{fmtUSD(overriddenPlan.unallocated)}</strong>
                      </div>
                    )}
                  </div>

                  {/* Income allocation summary */}
                  <div className={`${styles.incomeSummary} ${overriddenPlan.incomeFullyUsed ? styles.incomeSummaryOk : styles.incomeSummaryPartial}`}>
                    <span>Income allocated:</span>
                    <span>
                      <strong>{fmtUSD(overriddenPlan.totalAllocated)}</strong>
                      {' of '}
                      <strong>{fmtUSD(income)}</strong>
                      {overriddenPlan.incomeFullyUsed ? ' ✓' : ''}
                    </span>
                  </div>
                </>
              )}

              {currentTier === 1 && (
                <div className={styles.emergencyNote}>
                  ⚠ Emergency active — BTC buying paused until CB LTV drops below 70%
                </div>
              )}

              {!strategyDone && (
                <button
                  className={styles.logThisMonthBtn}
                  onClick={() => {
                    setOverlayInitialMonth(currentMonth - 1);
                    setOverlayOpen(true);
                  }}
                >
                  Log this month
                </button>
              )}
            </div>
          )}

          {/* Monthly Log section */}
          <MonthlyLogSection
            months={result.rows}
            onOpenOverlay={(m) => {
              setOverlayInitialMonth(m);
              setOverlayOpen(true);
            }}
          />

          {/* Section 4 — Projection (shared scenario component) */}
          <OutlookProjection
            startingBlocBalance={startingBlocBalance}
            startingBtcHeld={startingBtcHeld}
            startingMonth={startingMonth}
            currentMonth={currentMonth}
            btcPrice={btcPrice}
            income={income}
            expenses={expenses}
            blocApr={blocApr}
            creditLine={creditLine}
            hasCbLoan={hasCbLoan}
            cbLoanBalance={cbLoanBalance}
            cbCollateralBtc={cbCollateralBtc}
            cbAprPct={cbAprPct}
            cbMonthlyPayment={cbMonthlyPayment}
            cbPaymentStrategy={cbPaymentStrategy}
            cbLtvTriggerPct={cbLtvTriggerPct}
            cbLtvTargetPct={cbLtvTargetPct}
            cbRotateBackPct={cbRotateBackPct}
            blocMinPaymentSource={blocMinPaymentSource}
          />
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

      {overlayOpen && (
        <MonthlyLogOverlay
          initialMonth={overlayInitialMonth}
          months={result.rows}
          collateralBtc={collateralBtc}
          onClose={() => setOverlayOpen(false)}
        />
      )}

    </div>
  );
}
