import { useStore } from '../../store/useStore';
import { useBtcPrice } from '../../hooks/useBtcPrice';
import { NumberInput } from '../ui/NumberInput';
import { getCollateralForTier } from '../../simulation/runBlocYearOne';
import { suggestedLineUsd } from '../../simulation/placement';
import { accruedCbBalance } from '../../simulation/cbMetrics';
import { shownUsd } from '../../utils/format';
import { planCbCollateralOf, planCbLoanBalanceOf } from '../Almanac/planRun';
import { suggestedLineWords } from '../Almanac/decisionView';
import { getNdpStatus } from '../../simulation/runAdvisor';
import { fmtUSD, todayLocalISO } from '../../utils/format';
import styles from './InputsPanel.module.css';

export function InputsPanel() {
  const income            = useStore((s) => s.income);
  const expenses          = useStore((s) => s.expenses);
  const btcPrice          = useStore((s) => s.btcPrice);
  const creditLine        = useStore((s) => s.creditLine);
  const blocApr           = useStore((s) => s.blocApr);
  const activeTier        = useStore((s) => s.activeTier);
  // Smart BLOC is a SANDBOX — what-if collateral, no write-back to the real position
  const sandboxBtc              = useStore((s) => s.sandboxCollateralBtc ?? s.getCurrentBtcHeld());
  const setSandboxCollateralBtc = useStore((s) => s.setSandboxCollateralBtc);
  const setIncome           = useStore((s) => s.setIncome);
  const setExpenses         = useStore((s) => s.setExpenses);
  const setBtcPrice         = useStore((s) => s.setBtcPrice);
  const setCreditLine       = useStore((s) => s.setCreditLine);
  const setActiveTier       = useStore((s) => s.setActiveTier);
  const advisorActualBlocBalance = useStore((s) => s.advisorActualBlocBalance);
  const ndpLastPaidDate          = useStore((s) => s.ndpLastPaidDate);
  const setNdpLastPaidDate       = useStore((s) => s.setNdpLastPaidDate);
  const btcPriceMode    = useStore((s) => s.btcPriceMode);
  const setBtcPriceMode = useStore((s) => s.setBtcPriceMode);

  const strikeUsdBalance   = useStore((s) => s.strikeUsdBalance);
  const strikeBtcAvailable = useStore((s) => s.strikeBtcAvailable);
  const strikeRate         = useStore((s) => s.strikeRate);
  const strikeApiConnected = useStore((s) => s.strikeApiConnected);
  const strikeLastFetched  = useStore((s) => s.strikeLastFetched);
  // Run 4 — the plan's suggested line reads the plan's Coinbase leg (D-R2-4: none with the loan switched off).
  const hasCbLoan         = useStore((s) => s.hasCbLoan);
  const planCbBalance     = useStore((s) => planCbLoanBalanceOf(s));
  const planCbCollateral  = useStore((s) => planCbCollateralOf(s));
  const cbAprPct          = useStore((s) => s.cbAprPct);
  const cbLoanBalanceAsOf = useStore((s) => s.cbLoanBalanceAsOf);
  const cbLtvTriggerPct   = useStore((s) => s.cbLtvTriggerPct);
  const cbLtvTargetPct    = useStore((s) => s.cbLtvTargetPct);

  const effectiveCollateral = getCollateralForTier(activeTier, expenses, btcPrice, sandboxBtc);

  const { livePrice, lastUpdated, isStale } = useBtcPrice();

  const isSynced = livePrice !== null && Math.abs(btcPrice - livePrice) < 1;

  // Run 4 — the plan's suggested line, where the year-one model's "Recommended min" (its peak × 1.10, at a typed 15%
  // ceiling) stood: the Decision face's figure — two months of bills or one Coinbase paydown, with 25% spare — on the
  // plan's real position, at today's price, and its words, one copy.
  const planCbDebt = accruedCbBalance(planCbBalance, cbAprPct, cbLoanBalanceAsOf);
  const suggestedLine = suggestedLineUsd({
    expenses, cbDebt: planCbDebt, cbCollateralBtc: planCbCollateral, price: btcPrice, cbLtvTriggerPct, cbLtvTargetPct,
  });
  const lineWords = suggestedLineWords(creditLine, suggestedLine, hasCbLoan && shownUsd(planCbDebt), cbLtvTriggerPct, cbLtvTargetPct);

  const breakEven = income / (1 + (blocApr / 100) / 12);
  const isSustainable = expenses <= breakEven;

  const ndpBalance = advisorActualBlocBalance > 0 ? advisorActualBlocBalance : creditLine * 0.15;
  const ndp = getNdpStatus(ndpLastPaidDate, ndpBalance, blocApr);

  const netBlocDraw = strikeUsdBalance !== null && strikeUsdBalance > 0
    ? Math.max(0, expenses - strikeUsdBalance)
    : null;

  return (
    <div className={styles.panel}>
      <div className={styles.scrollArea}>
        <div className={styles.strikeWidget}>
          <div className={styles.strikeWidgetHeader}>
            <span className={styles.strikeWidgetLabel}>STRIKE USD HOLDINGS</span>
            <span className={strikeApiConnected ? styles.strikeDotConnected : styles.strikeDotDisconnected} />
          </div>

          {!strikeApiConnected ? (
            <p className={styles.strikePlaceholder}>—</p>
          ) : (
            <>
              <p className={styles.strikeBalanceValue}>{fmtUSD(strikeUsdBalance ?? 0)}</p>
              {netBlocDraw !== null && netBlocDraw < expenses && (
                <p className={styles.strikeNetDraw}>
                  Draw only {fmtUSD(netBlocDraw)} this month
                  <span className={styles.strikeNetDrawSub}> (expenses − Strike holdings)</span>
                </p>
              )}
              {strikeLastFetched && (
                <p className={styles.strikeLastUpdated}>
                  updated {Math.round((Date.now() - strikeLastFetched) / 1000)}s ago
                </p>
              )}
            </>
          )}

          {strikeRate !== null && Math.abs((strikeRate - btcPrice) / btcPrice) > 0.005 && (
            <p className={styles.strikeRateDelta}>
              Strike BTC: {fmtUSD(strikeRate)}
              {' '}
              <span>
                ({strikeRate > btcPrice ? '+' : ''}{((strikeRate - btcPrice) / btcPrice * 100).toFixed(2)}% vs Coinbase)
              </span>
            </p>
          )}
        </div>

        <div className={styles.strikeWidget}>
          <div className={styles.strikeWidgetHeader}>
            <span className={styles.strikeWidgetLabel}>STRIKE BTC DRY POWDER</span>
            <span className={strikeApiConnected ? styles.strikeDotConnected : styles.strikeDotDisconnected} />
          </div>

          {!strikeApiConnected || strikeBtcAvailable === null ? (
            <p className={styles.strikePlaceholder}>—</p>
          ) : (
            <>
              <p className={styles.strikeBalanceValue}>{strikeBtcAvailable.toFixed(8)} ₿</p>
              {btcPrice > 0 && (
                <p className={styles.strikeBtcDryPowderUsd}>~{fmtUSD(strikeBtcAvailable * btcPrice)}</p>
              )}
              <p className={styles.strikeDryPowderNote}>spendable — not collateral</p>
              {strikeLastFetched && (
                <p className={styles.strikeLastUpdated}>
                  updated {Math.round((Date.now() - strikeLastFetched) / 1000)}s ago
                </p>
              )}
            </>
          )}
        </div>

        <div className={styles.header}>
          <span className={styles.title}>Inputs</span>
        </div>

        <div className={styles.fields}>
          <NumberInput
            label="Monthly Income"
            value={income}
            onChange={setIncome}
            min={0}
            max={500000}
            step={100}
            prefix="$"
            save="leave"
          />
          <NumberInput
            label="Monthly Expenses"
            value={expenses}
            onChange={setExpenses}
            min={0}
            max={200000}
            step={100}
            prefix="$"
            save="leave"
          />
          <div className={styles.btcPriceRow}>
            <div className={styles.btcPriceLabelRow}>
              <span className={styles.fieldLabel}>BTC PRICE</span>
              {btcPriceMode === 'manual' ? (
                <button
                  className={styles.liveBadge}
                  style={{ color: 'var(--amber)', borderColor: 'var(--amber)' }}
                  onClick={() => { if (livePrice !== null) setBtcPrice(livePrice); setBtcPriceMode('live'); }}
                  title="Manual price — click to restore live"
                >
                  Manual
                </button>
              ) : isStale ? (
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
                  onClick={() => livePrice !== null && setBtcPrice(livePrice)}
                  disabled={livePrice === null}
                  title="Restore live price"
                >
                  LIVE
                </button>
              )}
            </div>
            <NumberInput
              value={btcPrice}
              onChange={(v) => { setBtcPrice(v); setBtcPriceMode('manual'); }}
              min={1000}
              max={5000000}
              step={1000}
              prefix="$"
              save="leave"
            />
            {lastUpdated && btcPriceMode === 'live' && <div className={styles.note}>Live — just updated</div>}
          </div>
          <NumberInput
            label="Credit Line"
            value={creditLine}
            onChange={setCreditLine}
            prefix="$"
            min={0}
            step={500}
            save="leave"
          />
          <NumberInput
            label="Collateral (BTC)"
            value={parseFloat(effectiveCollateral.toFixed(8))}
            onChange={(v) => {
              setSandboxCollateralBtc(v);
              setActiveTier('custom');
            }}
            min={0.001}
            step={0.001}
            prefix="₿"
            subtext="What-if only — your real position lives in Settings"
            save="live"
          />
        </div>
      </div>

      <div className={styles.recommendations}>
        <div className={styles.recHeader}>RECOMMENDATIONS</div>

        <div className={styles.recRow}>
          <span className={styles.recLabel}>Credit line</span>
          <span className={styles.recValue}>{fmtUSD(creditLine)}</span>
        </div>
        <div className={styles.recRow}>
          <span className={styles.recLabel}>Your plan's suggested line</span>
          <span className={`${styles.recValue} ${lineWords.covers ? styles.recGreen : styles.recOrange}`}>
            {fmtUSD(suggestedLine)}
            {lineWords.covers
              ? <span className={styles.recBadgeGreen}> ✓</span>
              : <span className={styles.recBadgeOrange}> ↑</span>
            }
          </span>
        </div>
        <div className={styles.recHint}>{lineWords.text}</div>

        <div className={styles.recDivider} />

        <div className={styles.recRow}>
          <span className={styles.recLabel}>Break-even draw</span>
          <span className={styles.recValue}>{fmtUSD(Math.round(breakEven))}/mo</span>
        </div>
        <div className={styles.recRow}>
          <span className={styles.recLabel}>Your expenses</span>
          <span className={`${styles.recValue} ${isSustainable ? styles.recGreen : styles.recOrange}`}>
            {fmtUSD(expenses)}/mo
            {isSustainable
              ? <span className={styles.recBadgeGreen}> ✓</span>
              : <span className={styles.recBadgeOrange}> ↑</span>
            }
          </span>
        </div>
        {!isSustainable && (
          <div className={styles.recHint}>Draw exceeds break-even — balance will drift</div>
        )}

        <div className={styles.recDivider} />

        <div className={`${styles.ndpRow} ${styles[`ndpRow_${ndp.status}`]}`}>
          <span className={styles.ndpRowLabel}>
            {ndp.status === 'never'    && '⚡ NDP — not recorded'}
            {ndp.status === 'ok'       && `⚡ NDP due in ${ndp.daysRemaining}d`}
            {ndp.status === 'upcoming' && `⚠ NDP due in ${ndp.daysRemaining}d`}
            {ndp.status === 'soon'     && `⚠ NDP due in ${ndp.daysRemaining}d`}
            {ndp.status === 'overdue'  && '✗ NDP overdue'}
          </span>
          {ndp.status !== 'ok' && (
            <button
              className={styles.ndpRowBtn}
              onClick={() => setNdpLastPaidDate(todayLocalISO())}
            >
              Paid
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
