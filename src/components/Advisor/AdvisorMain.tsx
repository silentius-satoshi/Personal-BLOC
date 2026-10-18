import { useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import {
  getTier,
  getTierColor,
  getCurrentStrategyMonth,
  isStrategyComplete,
} from '../../simulation/runAdvisor';
import { deriveCurrentPosition } from '../../simulation/logUtils';
import { strikeAvailableCredit } from '../../simulation/strikeCredit';
import { fmtUSD, fmtLtvPct } from '../../utils/format';
import { planLogRows, PLAN_PATHS_LINK } from '../Almanac/planMonthView';
import { PlanMonthCard } from '../SimpleMode/PlanMonthCard';
import { usePlanCardInputs } from '../SimpleMode/usePlanCardInputs';
import { MonthlyLogSection } from './MonthlyLogSection';
import { MonthlyLogOverlay } from './MonthlyLogOverlay';
import styles from './AdvisorMain.module.css';
import { accruedCbBalance } from '../../simulation/cbMetrics';

interface AdvisorMainProps {
  /** The Ledger — Simple mode's Daily view, where a month is signed off. */
  onOpenLedger: () => void;
  /** Run 3 — the Outlook's place: the Almanac, opened on the Decision face; null when the Almanac tab is hidden. */
  onOpenPlanPaths: (() => void) | null;
}

/**
 * The full-mode Advisor tab (Run 3, D5): the plan of record's card — THIS MONTH's own, one run, the same words — then
 * the monthly log, whose planned figures read the same run. The Advisor's plan rows and their Pay / Skip toggles
 * retired (the policy has no skip), and the Outlook's projection became a link to the Decision face.
 */
export function AdvisorMain({ onOpenLedger, onOpenPlanPaths }: AdvisorMainProps) {
  const blocApr           = useStore((s) => s.blocApr);
  const creditLine        = useStore((s) => s.creditLine);
  const btcPrice          = useStore((s) => s.btcPrice);
  const cbLoanBalance     = useStore((s) => s.cbLoanBalance);
  const cbCollateralBtc   = useStore((s) => s.cbCollateralBtc);
  const cbAprPct          = useStore((s) => s.cbAprPct);
  const cbLoanBalanceAsOf = useStore((s) => s.cbLoanBalanceAsOf);
  const advisorStartDate         = useStore((s) => s.advisorStartDate);
  const advisorActualBlocBalance = useStore((s) => s.advisorActualBlocBalance);
  const currentBtcHeld           = useStore((s) => s.getCurrentBtcHeld());   // reading-anchored current Strike collateral (v20)
  const hasCbLoan                = useStore((s) => s.hasCbLoan);
  const monthlyLog               = useStore((s) => s.monthlyLog);

  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayInitialMonth, setOverlayInitialMonth] = useState(0);

  const position      = deriveCurrentPosition(monthlyLog, currentBtcHeld, advisorActualBlocBalance);
  const availCredit   = strikeAvailableCredit(creditLine, position.btcHeld, btcPrice, position.blocBalance);
  const currentMonth  = getCurrentStrategyMonth(advisorStartDate);
  const strategyDone  = isStrategyComplete(advisorStartDate);
  const effectiveCbBalance = hasCbLoan ? accruedCbBalance(cbLoanBalance, cbAprPct, cbLoanBalanceAsOf) : 0;
  const currentCbLtv  = cbCollateralBtc * btcPrice > 0 ? effectiveCbBalance / (cbCollateralBtc * btcPrice) : 0;
  const currentTier   = getTier(currentCbLtv);

  // Run 3 — this tab's ONE run of the plan of record: the card, the monthly log's planned figures and the overlay's.
  const { pm, crashLine, ndp, ndpActionActive } = usePlanCardInputs();
  const logRows = useMemo(() => planLogRows(pm.run.sim, currentMonth), [pm.run.sim, currentMonth]);

  return (
    <div className={styles.main}>

      {/* Section 1 — Header + Progress */}
      <div className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>Advisor</h2>
        <p className={styles.pageSubtitle}>
          Your plan of record — the support policy, with your settings
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
                    {fmtLtvPct(currentCbLtv, 1)}
                  </span>
                </div>
                <div className={styles.positionStat}>
                  <span className={styles.positionLabel}>Monthly interest</span>
                  <span className={styles.positionValue}>{fmtUSD(Math.round(cbLoanBalance * cbAprPct / 100 / 12))}</span>
                </div>
              </div>
            )}
          </div>

          {/* Section 3 — the plan of record's card (Run 3): THIS MONTH's own, on this tab's one run. */}
          <PlanMonthCard
            pm={pm}
            currentMonth={currentMonth}
            strategyDone={strategyDone}
            crashLine={crashLine}
            ndp={ndp}
            ndpActionActive={ndpActionActive}
            onOpenLedger={onOpenLedger}
            onEditMonth={(m) => { setOverlayInitialMonth(m - 1); setOverlayOpen(true); }}
          />

          {/* Monthly Log section — its planned figures read the same run */}
          <MonthlyLogSection
            months={logRows}
            onOpenOverlay={(m) => {
              setOverlayInitialMonth(m);
              setOverlayOpen(true);
            }}
          />

          {/* Section 4 — the Outlook's place (Run 3): the plan on the price paths, in the Almanac's Decision face. */}
          {onOpenPlanPaths && (
            <button className={styles.pathsLink} onClick={onOpenPlanPaths}>{PLAN_PATHS_LINK} →</button>
          )}
        </>
      )}

      {/* Section 5 — Disclaimer */}
      <div className={styles.disclaimer}>
        <strong>Not financial advice.</strong> This tab models the support policy for
        educational purposes only. Bitcoin-backed loans carry significant risk including
        total loss of collateral. The plan is a model at today's price — actual
        decisions depend on your full financial situation. Consult a qualified financial
        advisor before making any borrowing decisions.
      </div>

      {overlayOpen && (
        <MonthlyLogOverlay
          initialMonth={overlayInitialMonth}
          months={logRows}
          onClose={() => setOverlayOpen(false)}
        />
      )}

    </div>
  );
}
