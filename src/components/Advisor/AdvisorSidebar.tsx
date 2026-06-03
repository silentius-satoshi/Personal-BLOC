import { useStore } from '../../store/useStore';
import { useBtcPrice } from '../../hooks/useBtcPrice';
import { NumberInput } from '../ui/NumberInput';
import { getCollateralForTier } from '../../simulation/runBlocYearOne';
import { getCurrentStrategyMonth, isStrategyComplete, getNdpStatus, getTier } from '../../simulation/runAdvisor';
import { fmtUSD } from '../../utils/format';
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
  const activeTier        = useStore((s) => s.activeTier);
  const { livePrice }     = useBtcPrice();
  const isSynced          = livePrice !== null && Math.abs(btcPrice - livePrice) < 1;
  const customCollateral  = useStore((s) => s.customCollateral);
  const cbLoanBalance     = useStore((s) => s.cbLoanBalance);
  const cbCollateralBtc   = useStore((s) => s.cbCollateralBtc);
  const cbAprPct          = useStore((s) => s.cbAprPct);
  const cbMonthlyPayment  = useStore((s) => s.cbMonthlyPayment);

  const advisorStartDate         = useStore((s) => s.advisorStartDate);
  const advisorActualBlocBalance = useStore((s) => s.advisorActualBlocBalance);
  const advisorActualBtcHeld     = useStore((s) => s.advisorActualBtcHeld);
  const setAdvisorStartDate         = useStore((s) => s.setAdvisorStartDate);
  const setAdvisorActualBlocBalance = useStore((s) => s.setAdvisorActualBlocBalance);
  const setAdvisorActualBtcHeld     = useStore((s) => s.setAdvisorActualBtcHeld);
  const ndpLastPaidDate    = useStore((s) => s.ndpLastPaidDate);
  const setNdpLastPaidDate = useStore((s) => s.setNdpLastPaidDate);
  const advisorChecklist    = useStore((s) => s.advisorChecklist);
  const setAdvisorChecklist = useStore((s) => s.setAdvisorChecklist);
  const skipBlocDraw  = useStore((s) => s.advisorSkipBlocDraw);
  const skipCbPayment = useStore((s) => s.advisorSkipCbPayment);
  const skipBtcBuying = useStore((s) => s.advisorSkipBtcBuying);
  const hasCbLoan     = useStore((s) => s.hasCbLoan);

  const collateralBtc = getCollateralForTier(activeTier, expenses, btcPrice, customCollateral);
  const currentMonth  = getCurrentStrategyMonth(advisorStartDate);
  const strategyDone  = isStrategyComplete(advisorStartDate);
  const ndpBalance    = advisorActualBlocBalance > 0 ? advisorActualBlocBalance : creditLine * 0.15;
  const ndp           = getNdpStatus(ndpLastPaidDate, ndpBalance, blocApr);

  const currentCbLtv      = cbCollateralBtc * btcPrice > 0 ? cbLoanBalance / (cbCollateralBtc * btcPrice) : 0;
  const currentTier       = getTier(currentCbLtv);
  const expectedBlocDraw  = currentTier === 1 ? 0
    : currentTier === 2
      ? Math.min(expenses * 0.5, Math.max(0, creditLine - advisorActualBlocBalance))
      : Math.min(expenses, Math.max(0, creditLine - advisorActualBlocBalance));
  const expectedCbPayment  = cbMonthlyPayment;
  const expectedBtcBuying  = currentTier === 1 ? 0 : Math.max(0, income - expectedCbPayment);
  const effectiveBlocDraw  = skipBlocDraw  ? 0 : expectedBlocDraw;
  const effectiveCbPayment = skipCbPayment ? 0 : expectedCbPayment;
  const effectiveBtcBuying = skipBtcBuying ? 0 : expectedBtcBuying;
  const effectiveFiatGap   = Math.max(0, expenses - effectiveBlocDraw);
  const showFiatRow        = effectiveFiatGap > 0;

  return (
    <div className={styles.sidebar}>

      <div className={styles.section}>
        <div className={styles.labelRow}>
          <span className={styles.label}>BTC PRICE</span>
          <button
            className={`${styles.liveBadge} ${isSynced ? styles.liveBadgeSynced : ''}`}
            onClick={() => livePrice !== null && setBtcPrice(livePrice)}
            disabled={livePrice === null}
            title={isSynced ? 'Live price synced' : 'Click to sync live price'}
          >
            {isSynced ? '✓ LIVE' : '↻ SYNC'}
          </button>
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
          max={new Date().toISOString().split('T')[0]}
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
        <p className={styles.hint}>Check your Strike app</p>
      </div>

      <div className={styles.section}>
        <span className={styles.label}>CURRENT BTC HELD</span>
        <NumberInput
          value={advisorActualBtcHeld}
          onChange={setAdvisorActualBtcHeld}
          prefix="₿"
          min={0}
          step={0.001}
        />
        <p className={styles.hint}>Collateral + accumulated BTC</p>
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
          onClick={() => setNdpLastPaidDate(new Date().toISOString().split('T')[0])}
        >
          {ndp.status === 'never' ? 'Record first payment' : 'Mark as paid today'}
        </button>

        {ndpLastPaidDate && (
          <div className={styles.ndpEditRow}>
            <input
              type="date"
              className={styles.ndpDateInput}
              value={ndpLastPaidDate}
              max={new Date().toISOString().split('T')[0]}
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

      {!strategyDone && (
        <>
          <div className={styles.divider} />
          <div className={styles.sectionLabel}>THIS MONTH — MO {currentMonth}</div>

          <div className={styles.checklist}>

            <label className={`${styles.checkItem} ${advisorChecklist.blocDraw ? styles.checkItemDone : ''}`}>
              <input type="checkbox" className={styles.checkbox}
                checked={advisorChecklist.blocDraw}
                onChange={(e) => setAdvisorChecklist({ blocDraw: e.target.checked })} />
              <span className={styles.checkLabel}>Draw from BLOC</span>
              <span className={styles.checkAmount}>
                {skipBlocDraw ? 'Skipped' : effectiveBlocDraw > 0 ? fmtUSD(effectiveBlocDraw) : '—'}
              </span>
            </label>

            {showFiatRow && (
              <label className={`${styles.checkItem} ${advisorChecklist.fiatCoverage ? styles.checkItemDone : ''}`}>
                <input type="checkbox" className={styles.checkbox}
                  checked={advisorChecklist.fiatCoverage}
                  onChange={(e) => setAdvisorChecklist({ fiatCoverage: e.target.checked })} />
                <span className={styles.checkLabel}>Cover from fiat</span>
                <span className={styles.checkAmount}>{fmtUSD(effectiveFiatGap)}</span>
              </label>
            )}

            {hasCbLoan && (
              <label className={`${styles.checkItem} ${advisorChecklist.cbPayment ? styles.checkItemDone : ''}`}>
                <input type="checkbox" className={styles.checkbox}
                  checked={advisorChecklist.cbPayment}
                  onChange={(e) => setAdvisorChecklist({ cbPayment: e.target.checked })} />
                <span className={styles.checkLabel}>Pay CB Loan</span>
                <span className={styles.checkAmount}>
                  {skipCbPayment ? 'Skipped' : effectiveCbPayment > 0 ? fmtUSD(effectiveCbPayment) : '—'}
                </span>
              </label>
            )}

            <label className={`${styles.checkItem} ${advisorChecklist.btcBuying ? styles.checkItemDone : ''}`}>
              <input type="checkbox" className={styles.checkbox}
                checked={advisorChecklist.btcBuying}
                onChange={(e) => setAdvisorChecklist({ btcBuying: e.target.checked })} />
              <span className={styles.checkLabel}>Buy Bitcoin</span>
              <span className={styles.checkAmount}>
                {skipBtcBuying ? 'Skipped' : effectiveBtcBuying > 0 ? fmtUSD(effectiveBtcBuying) : '—'}
              </span>
            </label>

            {skipBtcBuying && expectedBtcBuying > 0 && (
              <div className={styles.unallocatedRow}>
                <span className={styles.unallocatedLabel}>↳ Unallocated cash</span>
                <span className={styles.unallocatedAmount}>{fmtUSD(expectedBtcBuying)}</span>
              </div>
            )}

          </div>

          {(() => {
            const total = (showFiatRow ? 1 : 0) + (hasCbLoan ? 1 : 0) + 2;
            const done  = [
              advisorChecklist.blocDraw,
              showFiatRow && advisorChecklist.fiatCoverage,
              hasCbLoan && advisorChecklist.cbPayment,
              advisorChecklist.btcBuying,
            ].filter(Boolean).length;
            return (
              <p className={`${styles.checkProgress} ${done === total ? styles.checkProgressDone : ''}`}>
                {done === total
                  ? `✓ Month ${currentMonth} complete`
                  : `${done} of ${total} actions completed`}
              </p>
            );
          })()}
        </>
      )}

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
