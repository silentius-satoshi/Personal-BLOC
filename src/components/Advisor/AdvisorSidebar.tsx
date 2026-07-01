import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useBtcPrice } from '../../hooks/useBtcPrice';
import { NumberInput } from '../ui/NumberInput';
import { getCollateralForTier } from '../../simulation/runBlocYearOne';
import { getCurrentStrategyMonth, isStrategyComplete, getNdpStatus } from '../../simulation/runAdvisor';
import { deriveCurrentPosition } from '../../simulation/logUtils';
import { fmtUSD, todayLocalISO } from '../../utils/format';
import styles from './AdvisorSidebar.module.css';

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.summaryRow}>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={styles.summaryValue}>{value}</span>
    </div>
  );
}

export function AdvisorSidebar() {
  const income            = useStore((s) => s.income);
  const expenses          = useStore((s) => s.expenses);
  const blocApr           = useStore((s) => s.blocApr);
  const creditLine        = useStore((s) => s.creditLine);
  const btcPrice          = useStore((s) => s.btcPrice);
  const setBtcPrice       = useStore((s) => s.setBtcPrice);
  const setBtcPriceMode   = useStore((s) => s.setBtcPriceMode);
  const activeTier        = useStore((s) => s.activeTier);
  const { livePrice, isStale } = useBtcPrice();
  const isSynced          = livePrice !== null && Math.abs(btcPrice - livePrice) < 1;
  const cbLoanBalance     = useStore((s) => s.cbLoanBalance);
  const cbCollateralBtc   = useStore((s) => s.cbCollateralBtc);
  const cbAprPct          = useStore((s) => s.cbAprPct);
  const cbMonthlyPayment  = useStore((s) => s.cbMonthlyPayment);

  const advisorStartDate         = useStore((s) => s.advisorStartDate);
  const advisorActualBlocBalance = useStore((s) => s.advisorActualBlocBalance);
  const advisorActualBtcHeld     = useStore((s) => s.advisorActualBtcHeld);
  const pendingCollateralAdjustment = useStore((s) => s.pendingCollateralAdjustment);
  const currentBtcHeld           = useStore((s) => s.getCurrentBtcHeld());
  const adjustCurrentCollateral  = useStore((s) => s.adjustCurrentCollateral);
  const monthlyLog               = useStore((s) => s.monthlyLog);
  const setAdvisorStartDate         = useStore((s) => s.setAdvisorStartDate);
  const setAdvisorActualBlocBalance = useStore((s) => s.setAdvisorActualBlocBalance);
  const ndpLastPaidDate    = useStore((s) => s.ndpLastPaidDate);
  const setNdpLastPaidDate = useStore((s) => s.setNdpLastPaidDate);
  const hasCbLoan     = useStore((s) => s.hasCbLoan);

  const collateralBtc = getCollateralForTier(activeTier, expenses, btcPrice, currentBtcHeld);
  // Reality edit — commit on blur only (NumberInput fires onChange per keystroke; a draft keeps
  // pending from churning while typing). Edits record a dated adjustment, never touch the baseline.
  const [btcHeldDraft, setBtcHeldDraft] = useState<number | null>(null);
  const currentMonth  = getCurrentStrategyMonth(advisorStartDate);
  const strategyDone  = isStrategyComplete(advisorStartDate);
  const ndpBalance    = advisorActualBlocBalance > 0 ? advisorActualBlocBalance : creditLine * 0.15;
  const ndp           = getNdpStatus(ndpLastPaidDate, ndpBalance, blocApr);

  return (
    <div className={styles.sidebar}>

      <div className={styles.section}>
        <div className={styles.labelRow}>
          <span className={styles.label}>BTC PRICE</span>
          {isStale ? (
            <button
              className={styles.liveBadge}
              style={{ color: 'var(--amber)', borderColor: 'var(--amber)' }}
              disabled={livePrice === null}
              onClick={() => { if (livePrice !== null) setBtcPrice(livePrice); }}
              title="Price may be stale — click to use last known live price"
            >
              ⚠ stale
            </button>
          ) : (
            <button
              className={`${styles.liveBadge} ${isSynced ? styles.liveBadgeSynced : ''}`}
              onClick={() => { if (livePrice !== null) setBtcPrice(livePrice); setBtcPriceMode('live'); }}
              disabled={livePrice === null}
              title={isSynced ? 'Live price synced' : 'Click to sync live price'}
            >
              {isSynced ? '✓ LIVE' : '↻ SYNC'}
            </button>
          )}
        </div>
        <div className={styles.priceDisplay}>${btcPrice.toLocaleString()}</div>
      </div>

      <div className={styles.divider} />

      <div className={styles.sectionLabel}>YOUR PROGRESS</div>

      <div className={styles.section}>
        <span className={styles.label}>STRATEGY START DATE</span>
        <input
          type="date"
          className={styles.dateInput}
          value={advisorStartDate}
          onChange={(e) => setAdvisorStartDate(e.target.value)}
          max={todayLocalISO()}
        />
      </div>

      <div className={styles.monthDisplay}>
        <span className={styles.monthLabel}>Current month</span>
        <span className={styles.monthValue}>
          {strategyDone ? 'Year complete ✓' : `Month ${currentMonth} of 12`}
        </span>
      </div>

      <div className={styles.section}>
        <span className={styles.label}>CURRENT AMOUNT DRAWN</span>
        <NumberInput
          value={advisorActualBlocBalance}
          onChange={setAdvisorActualBlocBalance}
          prefix="$"
          min={0}
          step={100}
        />
        <p className={styles.hint}>
          {monthlyLog.length > 0 ? 'Starting BLOC balance (before log)' : 'Check your Strike app'}
        </p>
      </div>

      {monthlyLog.length > 0 && (() => {
        const { lastLoggedMonth } = deriveCurrentPosition(monthlyLog, advisorActualBtcHeld, advisorActualBlocBalance, pendingCollateralAdjustment);
        const projFrom = Math.min((lastLoggedMonth ?? 0) + 1, 12);
        return (
          <div className={styles.section}>
            <p className={styles.hint} style={{ fontStyle: 'normal' }}>
              From log: Mo {lastLoggedMonth} logged → projecting from Mo {projFrom}
            </p>
          </div>
        );
      })()}

      <div
        className={styles.section}
        onBlur={() => {
          if (btcHeldDraft !== null && btcHeldDraft !== currentBtcHeld) adjustCurrentCollateral(btcHeldDraft);
          setBtcHeldDraft(null);
        }}
      >
        <span className={styles.label}>CURRENT BTC HELD</span>
        <NumberInput
          value={btcHeldDraft ?? currentBtcHeld}
          onChange={setBtcHeldDraft}
          prefix="₿"
          min={0}
          step={0.001}
        />
        <p className={styles.hint}>
          Edits record a dated collateral adjustment for this month
        </p>
        {pendingCollateralAdjustment !== 0 && (
          <p className={styles.hint} style={{ color: 'var(--orange)' }}>
            {pendingCollateralAdjustment > 0 ? '+' : ''}{pendingCollateralAdjustment.toFixed(5)} ₿ pending — dates to Month {currentMonth} when logged
          </p>
        )}
      </div>

      <div className={styles.divider} />
      <div className={styles.sectionLabel}>ANNUAL NON-DRAW PAYMENT</div>

      <div className={`${styles.ndpCard} ${styles[`ndp_${ndp.status}`]}`}>
        <div className={styles.ndpTop}>
          <span className={styles.ndpStatusLabel}>
            {ndp.status === 'never'    && 'No payment recorded'}
            {ndp.status === 'ok'       && `✓ Due in ${ndp.daysRemaining} days`}
            {ndp.status === 'upcoming' && `⚠ Due in ${ndp.daysRemaining} days`}
            {ndp.status === 'soon'     && `⚠ Due in ${ndp.daysRemaining} days`}
            {ndp.status === 'overdue'  && '⛔ Overdue — pay immediately'}
          </span>
          {ndp.estimatedAmount > 0 && (
            <span className={styles.ndpAmount}>~{fmtUSD(ndp.estimatedAmount)}</span>
          )}
        </div>

        {ndp.status === 'never' && (
          <p className={styles.ndpHint}>Strike requires 1 payment/yr to keep your line active.</p>
        )}
        {ndp.status === 'overdue' && (
          <p className={styles.ndpHint}>Log in to Strike and make a payment now to avoid losing your line.</p>
        )}
        {(ndp.status === 'soon' || ndp.status === 'upcoming') && (
          <p className={styles.ndpHint}>
            Make at least {fmtUSD(ndp.estimatedAmount)} in Strike before{' '}
            {ndp.nextDueDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
          </p>
        )}

        <button
          className={styles.ndpButton}
          onClick={() => setNdpLastPaidDate(todayLocalISO())}
        >
          {ndp.status === 'never' ? 'Record first payment' : 'Mark as paid today'}
        </button>

        {ndpLastPaidDate && (
          <div className={styles.ndpEditRow}>
            <input
              type="date"
              className={styles.ndpDateInput}
              value={ndpLastPaidDate}
              max={todayLocalISO()}
              onChange={(e) => setNdpLastPaidDate(e.target.value)}
            />
            <button
              className={styles.ndpClearBtn}
              onClick={() => setNdpLastPaidDate(null)}
              title="Clear payment record"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className={styles.divider} />

      <div className={styles.sectionLabel}>FROM SMART BLOC</div>
      <SummaryRow label="Monthly income"   value={fmtUSD(income)} />
      <SummaryRow label="Monthly expenses" value={fmtUSD(expenses)} />
      <SummaryRow label="BLOC APR"         value={`${blocApr}%`} />
      <SummaryRow label="Credit line"      value={fmtUSD(creditLine)} />
      <SummaryRow label="Collateral"       value={`${collateralBtc.toFixed(5)} BTC`} />

      {hasCbLoan && (
        <>
          <div className={styles.divider} />
          <div className={styles.sectionLabel}>FROM CB LOAN</div>
          <SummaryRow label="Loan balance" value={fmtUSD(cbLoanBalance)} />
          <SummaryRow label="Collateral"   value={`${cbCollateralBtc} BTC`} />
          <SummaryRow label="APR"          value={`${cbAprPct}%`} />
          <SummaryRow label="Min. payment" value={cbMonthlyPayment > 0 ? fmtUSD(cbMonthlyPayment) : 'Interest-only'} />
        </>
      )}

      {hasCbLoan && (
        <>
          <div className={styles.divider} />
          <div className={styles.sectionLabel}>PRIORITY RULES</div>
          <div className={styles.ruleList}>
            <div className={styles.ruleRow}>
              <span className={styles.ruleDot} style={{ background: 'var(--green)' }} />
              <span className={styles.ruleText}>CB &lt; 55% — Normal strategy</span>
            </div>
            <div className={styles.ruleRow}>
              <span className={styles.ruleDot} style={{ background: 'var(--amber)' }} />
              <span className={styles.ruleText}>CB 55–65% — +25% to CB paydown</span>
            </div>
            <div className={styles.ruleRow}>
              <span className={styles.ruleDot} style={{ background: 'var(--orange)' }} />
              <span className={styles.ruleText}>CB 65–70% — Halve BLOC draw</span>
            </div>
            <div className={styles.ruleRow}>
              <span className={styles.ruleDot} style={{ background: 'var(--red)' }} />
              <span className={styles.ruleText}>CB ≥ 70% — Stop BLOC, all income to CB</span>
            </div>
          </div>
        </>
      )}

      <div className={styles.divider} />
      <p className={styles.editHint}>
        {hasCbLoan
          ? 'Edit loan inputs in Smart BLOC and CB Loan tabs.'
          : 'Edit loan inputs in the Smart BLOC tab.'}
      </p>

    </div>
  );
}
