import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { getCurrentStrategyMonth } from '../../simulation/runAdvisor';
import type { runAdvisor } from '../../simulation/runAdvisor';
import { fmtUSD } from '../../utils/format';
import styles from './MonthlyLogSection.module.css';

type AdvisorMonthRow = ReturnType<typeof runAdvisor>['rows'][number];

interface MonthlyLogSectionProps {
  months:        AdvisorMonthRow[];
  onOpenOverlay: (initialMonth: number) => void;
}

function getMonthLabel(advisorStartDate: string, monthNum: number): string {
  const [y, m] = advisorStartDate.split('-').map(Number);
  const d = new Date(y, m - 1 + (monthNum - 1), 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function MonthlyLogSection({ months, onOpenOverlay }: MonthlyLogSectionProps) {
  const monthlyLog      = useStore((s) => s.monthlyLog);
  const advisorStartDate = useStore((s) => s.advisorStartDate);
  const hasCbLoan       = useStore((s) => s.hasCbLoan);

  const currentMonth = getCurrentStrategyMonth(advisorStartDate);
  const loggedCount  = monthlyLog.length;

  const [selectedIdx, setSelectedIdx] = useState(Math.min(currentMonth - 1, 11));

  const selectedMonthNum = selectedIdx + 1;
  const loggedEntry  = monthlyLog.find((e) => e.month === selectedMonthNum) ?? null;
  const projRow      = months.find((r) => r.month === selectedMonthNum) ?? null;

  const isLogged  = !!loggedEntry;
  const isCurrent = selectedMonthNum === currentMonth;

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <span className={styles.title}>MONTHLY LOG</span>
        <span className={styles.badge}>{loggedCount} / 12 logged</span>
        <button className={styles.viewAllBtn} onClick={() => onOpenOverlay(selectedIdx)}>
          View all →
        </button>
      </div>

      {/* Horizontal carousel */}
      <div className={styles.carousel}>
        {Array.from({ length: 12 }, (_, i) => {
          const mn    = i + 1;
          const entry = monthlyLog.find((e) => e.month === mn);
          const logged  = !!entry;
          const current = mn === currentMonth;
          const sel     = i === selectedIdx;

          return (
            <button
              key={mn}
              className={`${styles.miniCard} ${
                logged  ? styles.miniCardLogged  :
                current ? styles.miniCardCurrent :
                          styles.miniCardFuture
              } ${sel ? (logged ? styles.miniCardSelLogged : current ? styles.miniCardSelCurrent : styles.miniCardSelFuture) : ''}`}
              onClick={() => setSelectedIdx(i)}
            >
              <span className={styles.miniMonth}>Mo {mn}</span>
              {logged && (
                <span className={styles.miniBtc}>+{entry.btcBought.toFixed(4)} ₿</span>
              )}
              <span className={styles.miniLabel}>
                {logged ? '● logged' : current ? 'CURRENT' : 'projected'}
              </span>
            </button>
          );
        })}
      </div>

      {/* Detail panel */}
      <div className={styles.detail}>
        <div className={styles.detailHeader}>
          <div className={styles.detailHeaderLeft}>
            <span className={`${styles.detailBadge} ${
              isLogged ? styles.detailBadgeLogged : isCurrent ? styles.detailBadgeCurrent : styles.detailBadgeFuture
            }`}>
              {isLogged ? '✓ LOGGED' : isCurrent ? 'CURRENT MONTH' : 'PROJECTED'}
            </span>
            <span className={styles.detailTitle}>
              Month {selectedMonthNum} · {getMonthLabel(advisorStartDate, selectedMonthNum)}
            </span>
          </div>
          {isLogged && (
            <button className={styles.editBtn} onClick={() => onOpenOverlay(selectedIdx)}>
              Edit entry
            </button>
          )}
          {isCurrent && !isLogged && (
            <button className={styles.logNowBtn} onClick={() => onOpenOverlay(selectedIdx)}>
              Log this month →
            </button>
          )}
        </div>

        <div className={styles.fieldGrid}>
          {/* Row 1 */}
          <div className={styles.fieldCell}>
            <span className={styles.fieldLabel}>BTC Bought</span>
            <span className={`${styles.fieldValue} ${styles.fieldGreen}`}>
              {loggedEntry
                ? `+${loggedEntry.btcBought.toFixed(5)} ₿`
                : projRow
                  ? <><span className={styles.proj}>+{projRow.btcBought.toFixed(5)} ₿</span><span className={styles.projTag}> (proj)</span></>
                  : '—'}
            </span>
          </div>
          <div className={styles.fieldCell}>
            <span className={styles.fieldLabel}>Income → BTC</span>
            <span className={styles.fieldValue}>
              {loggedEntry
                ? fmtUSD(loggedEntry.income)
                : projRow
                  ? <><span className={styles.proj}>{fmtUSD(projRow.incomeToBtc)}</span><span className={styles.projTag}> (proj)</span></>
                  : '—'}
            </span>
          </div>
          <div className={styles.fieldCell}>
            <span className={styles.fieldLabel}>Paydown</span>
            <span className={styles.fieldValue}>
              {loggedEntry
                ? fmtUSD(loggedEntry.paydown)
                : projRow
                  ? <><span className={styles.proj}>{fmtUSD(projRow.blocDraw > 0 ? 0 : 0)}</span><span className={styles.projTag}> (proj)</span></>
                  : '—'}
            </span>
          </div>
          <div className={styles.fieldCell} />

          {/* Row 2 */}
          <div className={styles.fieldCell}>
            <span className={styles.fieldLabel}>Strike Balance</span>
            <span className={styles.fieldValue}>
              {loggedEntry
                ? fmtUSD(loggedEntry.strikeBal)
                : projRow
                  ? <><span className={styles.proj}>{fmtUSD(projRow.blocBalance)}</span><span className={styles.projTag}> (proj)</span></>
                  : '—'}
            </span>
          </div>
          <div className={styles.fieldCell}>
            <span className={styles.fieldLabel}>Strike LTV</span>
            <span className={styles.fieldValue}>
              {loggedEntry
                ? `${(loggedEntry.strikeLtv * 100).toFixed(2)}%`
                : '—'}
            </span>
          </div>
          {hasCbLoan && (
            <div className={styles.fieldCell}>
              <span className={styles.fieldLabel}>CB Balance</span>
              <span className={styles.fieldValue}>
                {loggedEntry?.cbBal != null
                  ? fmtUSD(loggedEntry.cbBal)
                  : '—'}
              </span>
            </div>
          )}
          {hasCbLoan && (
            <div className={styles.fieldCell}>
              <span className={styles.fieldLabel}>CB LTV</span>
              <span className={styles.fieldValue}>
                {loggedEntry?.cbLtv != null
                  ? `${(loggedEntry.cbLtv * 100).toFixed(1)}%`
                  : projRow
                    ? <><span className={styles.proj}>{(projRow.cbLtv * 100).toFixed(1)}%</span><span className={styles.projTag}> (proj)</span></>
                    : '—'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
