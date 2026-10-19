import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useBtcPrice } from '../../hooks/useBtcPrice';
import { NumberInput } from '../ui/NumberInput';
import { getCollateralForTier } from '../../simulation/runBlocYearOne';
import { getCurrentStrategyMonth, isStrategyComplete, getNdpStatus } from '../../simulation/runAdvisor';
import { fmtUSD, todayLocalISO } from '../../utils/format';
import { usePlanPolicy } from '../Almanac/usePlanPolicy';
import { planPolicySettingsOf } from '../Almanac/planRun';
import { planRuleRows } from '../Almanac/supportPolicyView';
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
  const blocMinPaymentSource = useStore((s) => s.blocMinPaymentSource);   // §2b — NDP only applies while rolling

  const advisorStartDate         = useStore((s) => s.advisorStartDate);
  const advisorActualBlocBalance = useStore((s) => s.advisorActualBlocBalance);
  const currentBtcHeld           = useStore((s) => s.getCurrentBtcHeld());   // reading-anchored current Strike collateral (v20)
  const emitBalanceReading       = useStore((s) => s.emitBalanceReading);
  const setAdvisorStartDate         = useStore((s) => s.setAdvisorStartDate);
  const setAdvisorActualBlocBalance = useStore((s) => s.setAdvisorActualBlocBalance);
  const ndpLastPaidDate    = useStore((s) => s.ndpLastPaidDate);
  const setNdpLastPaidDate = useStore((s) => s.setNdpLastPaidDate);
  const hasCbLoan     = useStore((s) => s.hasCbLoan);
  // Run 4 — the plan's rules, as the plan runs them (where the Advisor's typed PRIORITY RULES stood).
  const planRules = planRuleRows(planPolicySettingsOf(usePlanPolicy()), expenses);

  const collateralBtc = getCollateralForTier(activeTier, expenses, btcPrice, currentBtcHeld);
  // Reality edit — commit on blur only (draft keeps the reading from churning while typing). v20: editing emits a
  // journaled balanceReading carrying strikeCollateral → the seam re-anchors getCurrentBtcHeld.
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
        {/* Run 3 — the plan of record starts from this balance; the Advisor's projection, which started from the log's last
            month, left with runAdvisor, and its start line with it. */}
        <p className={styles.hint}>Check your Strike app</p>
      </div>

      <div
        className={styles.section}
        onBlur={() => {
          if (btcHeldDraft !== null && btcHeldDraft !== currentBtcHeld) emitBalanceReading({ strikeCollateral: btcHeldDraft });
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
          Your current BTC in Strike — edits log a balance reading that re-anchors your collateral
        </p>
      </div>

      {/* §2b — the annual NDP only exists while minimums are ROLLED into the line. In income mode the
          minimum is paid monthly from income (each payment IS a non-draw payment), so the clause is gone. */}
      {blocMinPaymentSource === 'roll' && (<>
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
      </>)}

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
        </>
      )}

      {/* Run 4 — the plan's rules as data: the support policy's six settings as the plan runs them (edited in Settings →
          Your plan). The Advisor's typed PRIORITY RULES (55 / 65 / 70) left with runAdvisor's last screen. */}
      <div className={styles.divider} />
      <div className={styles.sectionLabel}>YOUR PLAN</div>
      {planRules.map((r) => <SummaryRow key={r.key} label={r.label} value={r.value} />)}

      <div className={styles.divider} />
      <p className={styles.editHint}>
        {hasCbLoan
          ? 'Edit loan inputs in Smart BLOC and CB Loan tabs.'
          : 'Edit loan inputs in the Smart BLOC tab.'}
      </p>

    </div>
  );
}
