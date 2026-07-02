import { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { getCurrentStrategyMonth } from '../../simulation/runAdvisor';
import type { runAdvisor } from '../../simulation/runAdvisor';
import type { MonthlyLogEntry } from '../../simulation/types';
import { fmtUSD, toLocalISO } from '../../utils/format';
import styles from './MonthlyLogSection.module.css';

type AdvisorMonthRow = ReturnType<typeof runAdvisor>['rows'][number];

interface MonthlyLogSectionProps {
  months:          AdvisorMonthRow[];
  onOpenOverlay?:  (initialMonth: number) => void;
  allowInlineLog?: boolean;   // default true; Simple Mode passes false
}

interface InlineForm {
  btcBought: string; income: string; paydown: string; strikeBal: string;
  strikeLtvPct: string; cbBal: string; cbLtvPct: string; miningSats: string;
}

function emptyForm(): InlineForm {
  return { btcBought: '0', income: '0', paydown: '0', strikeBal: '0', strikeLtvPct: '0', cbBal: '0', cbLtvPct: '0', miningSats: '0' };
}

function formFromEntry(e: MonthlyLogEntry): InlineForm {
  return {
    btcBought:    e.btcBought.toFixed(8),
    income:       String(Math.round(e.income)),
    paydown:      String(Math.round(e.paydown)),
    strikeBal:    String(Math.round(e.strikeBal)),
    strikeLtvPct: (e.strikeLtv * 100).toFixed(2),
    cbBal:        e.cbBal    != null ? String(Math.round(e.cbBal))           : '0',
    cbLtvPct:     e.cbLtv    != null ? (e.cbLtv * 100).toFixed(1)            : '0',
    miningSats:   e.miningSats != null ? String(e.miningSats)                : '0',
  };
}

function InlineFormField({ label, value, onChange, step = 'any', prefix, suffix }: {
  label: string; value: string; onChange: (v: string) => void;
  step?: string; prefix?: string; suffix?: string;
}) {
  return (
    <div className={styles.inlineFieldGroup}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.inlineFieldRow}>
        {prefix && <span className={styles.inlinePrefix}>{prefix}</span>}
        <input
          type="number"
          className={styles.inlineInput}
          value={value}
          step={step}
          min="0"
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix && <span className={styles.inlineSuffix}>{suffix}</span>}
      </div>
    </div>
  );
}

function getMonthLabel(advisorStartDate: string, monthNum: number): string {
  const [y, m] = advisorStartDate.split('-').map(Number);
  const d = new Date(y, m - 1 + (monthNum - 1), 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function MonthlyLogSection({ months, allowInlineLog = true }: MonthlyLogSectionProps) {
  const monthlyLog      = useStore((s) => s.monthlyLog);
  const advisorStartDate = useStore((s) => s.advisorStartDate);
  const hasCbLoan       = useStore((s) => s.hasCbLoan);
  const income          = useStore((s) => s.income);
  const expenses        = useStore((s) => s.expenses);
  const showMiningInLog = useStore((s) => s.showMiningInLog);
  const upsertLogEntry  = useStore((s) => s.upsertLogEntry);
  const deleteLogEntry  = useStore((s) => s.deleteLogEntry);
  const unconfirmMonth  = useStore((s) => s.unconfirmMonth);   // §4 — daily months un-sign-off (never delete)

  const currentMonth = getCurrentStrategyMonth(advisorStartDate);
  const loggedCount  = monthlyLog.length;

  const [selectedIdx,   setSelectedIdx]   = useState(Math.min(currentMonth - 1, 11));
  const [detailEditing, setDetailEditing] = useState(false);
  const [unlogConfirm,  setUnlogConfirm]  = useState(false);
  const [form, setForm] = useState<InlineForm>(emptyForm());

  const selectedMonthNum = selectedIdx + 1;
  const loggedEntry  = monthlyLog.find((e) => e.month === selectedMonthNum) ?? null;
  const projRow      = months.find((r) => r.month === selectedMonthNum) ?? null;
  const isLogged     = !!loggedEntry;
  // §4 — a daily-owned month is a living rollup: it's a VIEWER here (edits belong in the Ledger). Legacy/
  // manual months (source undefined/'manual') stay editable. Undo on a daily month un-signs, never deletes.
  const isDaily      = loggedEntry?.source === 'daily';
  const isCurrent    = selectedMonthNum === currentMonth;

  const buildFormFromRow = (row: AdvisorMonthRow): InlineForm => {
    const paydown = Math.max(0, income - (hasCbLoan ? row.cbPayment : 0) - row.incomeToBtc);
    return {
      btcBought:    row.btcBought.toFixed(8),
      income:       String(Math.round(row.incomeToBtc)),
      paydown:      String(Math.round(paydown)),
      strikeBal:    String(Math.round(row.blocBalance)),
      strikeLtvPct: (row.blocLtv * 100).toFixed(2),
      cbBal:        hasCbLoan ? String(Math.round(row.cbBalance)) : '0',
      cbLtvPct:     hasCbLoan ? (row.cbLtv * 100).toFixed(1)     : '0',
      miningSats:   '0',
    };
  };

  // Reset edit state and repopulate form when selected card changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setDetailEditing(false);
    setUnlogConfirm(false);
    if (loggedEntry)   setForm(formFromEntry(loggedEntry));
    else if (projRow)  setForm(buildFormFromRow(projRow));
    else               setForm(emptyForm());
  }, [selectedIdx]);

  const handleSave = () => {
    const mn = selectedMonthNum;
    // Extract y/m from the RAW string (never round-trip through new Date(advisorStartDate) — that parses
    // at UTC midnight, and reading it back via local getFullYear/getMonth shifts a month in behind-UTC
    // zones whenever advisorStartDate falls near a month boundary). Mirrors MonthlyLogOverlay.getMonthDate.
    const [ey, em] = advisorStartDate.split('-').map(Number);
    const entryDate = new Date(ey, em - 1 + (mn - 1), 1);
    const date = toLocalISO(entryDate);
    upsertLogEntry({
      month:      mn,
      date,
      btcBought:  parseFloat(form.btcBought)  || 0,
      income:     parseFloat(form.income)      || 0,
      paydown:    parseFloat(form.paydown)     || 0,
      strikeBal:  parseFloat(form.strikeBal)   || 0,
      strikeLtv:  (parseFloat(form.strikeLtvPct) || 0) / 100,
      cbBal:      hasCbLoan ? (parseFloat(form.cbBal)    || undefined) : undefined,
      cbLtv:      hasCbLoan ? (parseFloat(form.cbLtvPct) || 0) / 100  : undefined,
      miningSats: showMiningInLog ? (parseFloat(form.miningSats) || undefined) : undefined,
      loggedAt:       Date.now(),
      btcHeld:        0,
      expensesActual: loggedEntry?.expensesActual ?? expenses,
    });
    setDetailEditing(false);
  };

  const setF = (field: keyof InlineForm) => (v: string) =>
    setForm((f) => ({ ...f, [field]: v }));

  return (
    <div className={styles.section}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>MONTHLY LOG</span>
        <span className={styles.badge}>{loggedCount} / 12 logged</span>
      </div>

      {/* Horizontal carousel */}
      <div className={styles.carousel}>
        {Array.from({ length: 12 }, (_, i) => {
          const mn    = i + 1;
          const entry = monthlyLog.find((e) => e.month === mn);
          const logged  = !!entry;
          const status  = logged              ? 'logged'
                        : mn === currentMonth ? 'current'
                        : mn < currentMonth   ? 'unlogged'
                        :                       'future';
          const sel     = i === selectedIdx;
          return (
            <button
              key={mn}
              className={`${styles.miniCard} ${
                status === 'logged'   ? styles.miniCardLogged   :
                status === 'current'  ? styles.miniCardCurrent  :
                status === 'unlogged' ? styles.miniCardUnlogged :
                                        styles.miniCardFuture
              } ${sel ? (
                status === 'logged'   ? styles.miniCardSelLogged   :
                status === 'current'  ? styles.miniCardSelCurrent  :
                status === 'unlogged' ? styles.miniCardSelUnlogged :
                                        styles.miniCardSelFuture
              ) : ''}`}
              onClick={() => setSelectedIdx(i)}
            >
              <span className={styles.miniMonth}>Mo {mn}</span>
              {logged && <span className={styles.miniBtc}>+{entry.btcBought.toFixed(4)} ₿</span>}
              {logged && (entry.collateralAdjustment ?? 0) !== 0 && (
                <span className={styles.miniBtc}>
                  adj {(entry.collateralAdjustment ?? 0) > 0 ? '+' : ''}{entry.collateralAdjustment!.toFixed(4)} ₿
                </span>
              )}
              <span className={styles.miniLabel}>
                {status === 'logged'   ? '✓ logged'   :
                 status === 'current'  ? 'CURRENT'    :
                 status === 'unlogged' ? '⚠ unlogged' :
                                         'future'}
              </span>
            </button>
          );
        })}
      </div>

      {/* Detail panel */}
      <div className={styles.detail}>
        {/* Detail header */}
        <div className={styles.detailHeader}>
          <div className={styles.detailHeaderLeft}>
            <span className={`${styles.detailBadge} ${
              isLogged  ? styles.detailBadgeLogged  :
              isCurrent ? styles.detailBadgeCurrent :
                          styles.detailBadgeFuture
            }`}>
              {isLogged ? '✓ LOGGED' : isCurrent ? 'CURRENT MONTH' : 'PROJECTED'}
            </span>
            <span className={styles.detailTitle}>
              Month {selectedMonthNum} · {getMonthLabel(advisorStartDate, selectedMonthNum)}
            </span>
          </div>
          {/* Right-side buttons (only in view mode). §4 — daily months are read-only here (edit in the
              Ledger); the Remove action un-signs (reopen) rather than deleting. Manual months: Edit + Remove. */}
          {!detailEditing && isLogged && (
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {!isDaily && (
                <button className={styles.editBtn} onClick={() => { setForm(formFromEntry(loggedEntry!)); setDetailEditing(true); setUnlogConfirm(false); }}>
                  Edit
                </button>
              )}
              {!unlogConfirm && (
                <button className={styles.removeBtn} onClick={() => setUnlogConfirm(true)}>
                  {isDaily ? 'Reopen' : 'Remove'}
                </button>
              )}
            </div>
          )}
          {/* §4 — daily months: point edits to the Ledger */}
          {!detailEditing && isDaily && (
            <span className={styles.dailyHint}>Edit the day&apos;s events in the Ledger (Daily view).</span>
          )}
          {allowInlineLog && !detailEditing && !isDaily && isCurrent && !isLogged && (
            <button className={styles.logNowBtn} onClick={() => { setForm(projRow ? buildFormFromRow(projRow) : emptyForm()); setDetailEditing(true); }}>
              Log this month →
            </button>
          )}
        </div>

        {/* Unlog confirmation. §4 — daily months UN-SIGN (entry + rollup preserved; DELETE would tombstone
            the month and suppress its own future rollups); manual months delete. */}
        {unlogConfirm && (
          <div className={styles.unlogConfirmRow}>
            <span className={styles.unlogConfirmText}>{isDaily ? 'Reopen this month for editing?' : 'Remove this entry?'}</span>
            <button className={styles.confirmBtn} onClick={() => { if (isDaily) unconfirmMonth(selectedMonthNum); else deleteLogEntry(selectedMonthNum); setUnlogConfirm(false); }}>
              Confirm
            </button>
            <button className={styles.cancelConfirmBtn} onClick={() => setUnlogConfirm(false)}>
              Cancel
            </button>
          </div>
        )}

        {/* Inline edit form */}
        {detailEditing && (isLogged || isCurrent) ? (
          <>
            <div className={styles.editFormGrid}>
              <InlineFormField label="BTC Bought"     value={form.btcBought}    onChange={setF('btcBought')}    step="0.00000001" prefix="₿" />
              <InlineFormField label="Income → BTC"   value={form.income}        onChange={setF('income')}       step="1" prefix="$" />
              <InlineFormField label="BLOC Paydown"   value={form.paydown}       onChange={setF('paydown')}      step="1" prefix="$" />
              <InlineFormField label="Strike Balance" value={form.strikeBal}     onChange={setF('strikeBal')}    step="1" prefix="$" />
              <InlineFormField label="Strike LTV"     value={form.strikeLtvPct}  onChange={setF('strikeLtvPct')} step="0.01" suffix="%" />
              {hasCbLoan && <InlineFormField label="CB Balance" value={form.cbBal}    onChange={setF('cbBal')}    step="1" prefix="$" />}
              {hasCbLoan && <InlineFormField label="CB LTV"     value={form.cbLtvPct} onChange={setF('cbLtvPct')} step="0.01" suffix="%" />}
              {showMiningInLog && <InlineFormField label="Mining Sats" value={form.miningSats} onChange={setF('miningSats')} step="1" />}
            </div>
            <div className={styles.editFormActions}>
              <button className={styles.saveBtn} onClick={handleSave}>Save</button>
              <button className={styles.cancelEditBtn} onClick={() => setDetailEditing(false)}>Cancel</button>
            </div>
          </>
        ) : (
          /* View / projected values */
          <div className={styles.fieldGrid}>
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
            {(loggedEntry?.collateralAdjustment ?? 0) !== 0 && (
              <div className={styles.fieldCell}>
                <span className={styles.fieldLabel}>ADJ</span>
                <span className={styles.fieldValue}>
                  {loggedEntry!.collateralAdjustment! > 0 ? '+' : ''}{loggedEntry!.collateralAdjustment!.toFixed(5)} ₿
                </span>
              </div>
            )}
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
                {loggedEntry ? fmtUSD(loggedEntry.paydown) : '—'}
              </span>
            </div>
            {/* §2b — Strike minimum paid from income (only when recorded) */}
            {(loggedEntry?.strikeMinPaid ?? 0) > 0 ? (
              <div className={styles.fieldCell}>
                <span className={styles.fieldLabel}>Strike min</span>
                <span className={styles.fieldValue}>{fmtUSD(loggedEntry!.strikeMinPaid!)}</span>
              </div>
            ) : (
              <div className={styles.fieldCell} />
            )}
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
                {loggedEntry ? `${(loggedEntry.strikeLtv * 100).toFixed(2)}%` : '—'}
              </span>
            </div>
            {hasCbLoan && (
              <div className={styles.fieldCell}>
                <span className={styles.fieldLabel}>CB Balance</span>
                <span className={styles.fieldValue}>
                  {loggedEntry?.cbBal != null ? fmtUSD(loggedEntry.cbBal) : '—'}
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
        )}
      </div>
    </div>
  );
}
