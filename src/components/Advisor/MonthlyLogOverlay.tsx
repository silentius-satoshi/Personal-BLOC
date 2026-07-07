import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store/useStore';
import { getCurrentStrategyMonth } from '../../simulation/runAdvisor';
import type { runAdvisor } from '../../simulation/runAdvisor';
import { fmtUSD, toLocalISO } from '../../utils/format';
import type { MonthlyLogEntry } from '../../simulation/types';
import { SwipeStrip } from '../ui/SwipeStrip';
import styles from './MonthlyLogOverlay.module.css';

type AdvisorMonthRow = ReturnType<typeof runAdvisor>['rows'][number];

interface MonthlyLogOverlayProps {
  initialMonth:   number;          // 0-indexed (0–11)
  months:         AdvisorMonthRow[];
  collateralBtc:  number;
  openInEditMode?: boolean;        // open a logged month straight in the edit form (default: view-first)
  onClose:        () => void;
}

interface OverlayForm {
  btcBought:    string;
  income:       string;
  paydown:      string;
  strikeBal:    string;
  strikeLtvPct: string;  // percentage string e.g. "14.83"
  cbBal:        string;
  cbLtvPct:     string;
  miningSats:   string;
}

function emptyForm(): OverlayForm {
  return { btcBought: '0', income: '0', paydown: '0', strikeBal: '0', strikeLtvPct: '0', cbBal: '0', cbLtvPct: '0', miningSats: '0' };
}

function getMonthLabel(advisorStartDate: string, monthNum: number): string {
  const [y, m] = advisorStartDate.split('-').map(Number);
  const d = new Date(y, m - 1 + (monthNum - 1), 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function getMonthDate(advisorStartDate: string, monthNum: number): string {
  const [y, m] = advisorStartDate.split('-').map(Number);
  const d = new Date(y, m - 1 + (monthNum - 1), 1);
  return toLocalISO(d);
}

function fmt(n: number): string { return isNaN(n) ? '0' : n.toString(); }

interface FormFieldProps {
  label:    string;
  value:    string;
  onChange: (v: string) => void;
  step?:    string;
  prefix?:  string;
  suffix?:  string;
}

function FormField({ label, value, onChange, step = 'any', prefix, suffix }: FormFieldProps) {
  return (
    <div className={styles.formField}>
      <span className={styles.formLabel}>{label}</span>
      <div className={styles.formInputRow}>
        {prefix && <span className={styles.formPrefix}>{prefix}</span>}
        <input
          type="number"
          className={styles.formInput}
          value={value}
          step={step}
          min="0"
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix && <span className={styles.formSuffix}>{suffix}</span>}
      </div>
    </div>
  );
}

export function MonthlyLogOverlay({ initialMonth, months, collateralBtc, openInEditMode, onClose }: MonthlyLogOverlayProps) {
  const monthlyLog      = useStore((s) => s.monthlyLog);
  const upsertLogEntry  = useStore((s) => s.upsertLogEntry);
  const advisorStartDate = useStore((s) => s.advisorStartDate);
  const hasCbLoan       = useStore((s) => s.hasCbLoan);
  const showMiningInLog = useStore((s) => s.showMiningInLog);
  const btcPrice        = useStore((s) => s.btcPrice);
  const income          = useStore((s) => s.income);
  const expenses        = useStore((s) => s.expenses);

  const [currentIdx, setCurrentIdx] = useState(Math.min(Math.max(initialMonth, 0), 11));
  const [editing, setEditing] = useState(!!openInEditMode);   // honored on mount; nav resets it (see didInit)
  const [form, setForm] = useState<OverlayForm>(emptyForm);
  const [saved, setSaved] = useState(false);

  const didInit = useRef(false);   // first effect run is the initial mount — don't clobber the seeded editing state

  const currentMonth = getCurrentStrategyMonth(advisorStartDate);

  // Populate form when month changes
  useEffect(() => {
    const monthNum = currentIdx + 1;
    const entry = monthlyLog.find((e) => e.month === monthNum);
    const row   = months.find((r) => r.month === monthNum);

    if (entry) {
      setForm({
        btcBought:    fmt(entry.btcBought),
        income:       fmt(entry.income),
        paydown:      fmt(entry.paydown),
        strikeBal:    fmt(entry.strikeBal),
        strikeLtvPct: fmt(parseFloat((entry.strikeLtv * 100).toFixed(4))),
        cbBal:        fmt(entry.cbBal ?? 0),
        cbLtvPct:     fmt(parseFloat(((entry.cbLtv ?? 0) * 100).toFixed(4))),
        miningSats:   fmt(entry.miningSats ?? 0),
      });
    } else if (row && monthNum === currentMonth) {
      const ltvPct = collateralBtc > 0 && btcPrice > 0
        ? parseFloat(((row.blocBalance / (collateralBtc * btcPrice)) * 100).toFixed(4))
        : 0;
      const paydownComputed = Math.max(0, income - (row.cbPayment ?? 0) - row.incomeToBtc);
      setForm({
        btcBought:    fmt(row.btcBought),
        income:       fmt(row.incomeToBtc),
        paydown:      fmt(paydownComputed),
        strikeBal:    fmt(row.blocBalance),
        strikeLtvPct: fmt(ltvPct),
        cbBal:        '0',
        cbLtvPct:     fmt(parseFloat(((row.cbLtv ?? 0) * 100).toFixed(4))),
        miningSats:   '0',
      });
    } else {
      setForm(emptyForm());
    }
    if (didInit.current) setEditing(false);   // navigating to another month exits edit-mode (mount keeps the seed)
    didInit.current = true;
    setSaved(false);
  }, [currentIdx]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  setCurrentIdx((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setCurrentIdx((i) => Math.min(11, i + 1));
      if (e.key === 'Escape')     onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSave = () => {
    const monthNum  = currentIdx + 1;
    const entry: MonthlyLogEntry = {
      month:     monthNum,
      date:      getMonthDate(advisorStartDate, monthNum),
      btcBought: parseFloat(form.btcBought) || 0,
      income:    parseFloat(form.income)    || 0,
      paydown:   parseFloat(form.paydown)   || 0,
      strikeBal: parseFloat(form.strikeBal) || 0,
      strikeLtv: (parseFloat(form.strikeLtvPct) || 0) / 100,
      ...(hasCbLoan ? {
        cbBal: parseFloat(form.cbBal)    || 0,
        cbLtv: (parseFloat(form.cbLtvPct) || 0) / 100,
      } : {}),
      ...(showMiningInLog ? { miningSats: parseFloat(form.miningSats) || 0 } : {}),
      loggedAt:       Date.now(),
      btcHeld:        0,
      expensesActual: monthlyLog.find((e) => e.month === monthNum)?.expensesActual ?? expenses,
    };
    upsertLogEntry(entry);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const monthNum    = currentIdx + 1;
  const loggedEntry = monthlyLog.find((e) => e.month === monthNum) ?? null;
  // §4 — a daily-owned month is a VIEWER here; edits belong in the Ledger (a manual write is re-clobbered by
  // the next re-roll and dropped by the store's M2 guard). Legacy/manual months stay editable. (isLogged/
  // isCurrent are now derived per-pane inside renderMonthCard; only the active month's daily-ness gates editing.)
  const isDaily     = loggedEntry?.source === 'daily';

  useEffect(() => { if (isDaily) setEditing(false); }, [isDaily, monthNum]);

  const setF = (key: keyof OverlayForm) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  const sharedFields = (
    <>
      <FormField label="BTC Bought"    value={form.btcBought}    onChange={setF('btcBought')}    step="0.00000001" prefix="₿" />
      <FormField label="Income → BTC"  value={form.income}       onChange={setF('income')}        step="1" prefix="$" />
      <FormField label="BLOC Paydown"  value={form.paydown}      onChange={setF('paydown')}       step="1" prefix="$" />
      <FormField label="Strike Balance" value={form.strikeBal}   onChange={setF('strikeBal')}     step="1" prefix="$" />
      <FormField label="Strike LTV"    value={form.strikeLtvPct} onChange={setF('strikeLtvPct')} step="0.01" suffix="%" />
      {hasCbLoan && <FormField label="CB Balance" value={form.cbBal}    onChange={setF('cbBal')}    step="1" prefix="$" />}
      {hasCbLoan && <FormField label="CB LTV"     value={form.cbLtvPct} onChange={setF('cbLtvPct')} step="0.01" suffix="%" />}
      {showMiningInLog && <FormField label="Mining Sats" value={form.miningSats} onChange={setF('miningSats')} step="1" />}
    </>
  );

  // P2 — parameterized by month so the SwipeStrip can render adjacent panes. `active` (the center pane) gets
  // the full stateful card (edit form / LOG button — the single-instance form state is tied to currentIdx);
  // neighbors render the read-only view (no form). Real state (currentIdx) changes only at rest, after a page.
  function renderMonthCard(mn: number, active: boolean) {
    const logged  = monthlyLog.find((e) => e.month === mn) ?? null;
    const isLog   = !!logged;
    const isDailyM = logged?.source === 'daily';
    const isCur   = mn === currentMonth;
    const row     = months.find((r) => r.month === mn);

    if (isLog && logged) {
      const showForm = active && editing && !isDailyM;
      return (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardHeaderLeft}>
              <span className={styles.badgeLogged}>✓ LOGGED</span>
              <span className={styles.cardDate}>{getMonthLabel(advisorStartDate, mn)}</span>
            </div>
            {active && !editing && !isDailyM && (
              <button className={styles.editBtn} onClick={() => setEditing(true)}>Edit</button>
            )}
            {active && !editing && isDailyM && (
              <span className={styles.ledgerHint}>Edit in the Ledger</span>
            )}
          </div>

          {showForm ? (
            <>
              <div className={styles.formGrid}>{sharedFields}</div>
              <div className={styles.cardActions}>
                <button className={styles.cancelBtn} onClick={() => setEditing(false)}>Cancel</button>
                <button className={styles.saveBtn} onClick={handleSave}>Save changes</button>
              </div>
            </>
          ) : (
            <div className={styles.viewGrid}>
              <ViewRow label="BTC Bought"     value={`+${logged.btcBought.toFixed(5)} ₿`} green />
              {(logged.collateralAdjustment ?? 0) !== 0 && (
                <ViewRow label="ADJ" value={`${logged.collateralAdjustment! > 0 ? '+' : ''}${logged.collateralAdjustment!.toFixed(5)} ₿`} />
              )}
              <ViewRow label="Income → BTC"   value={fmtUSD(logged.income)} />
              <ViewRow label="BLOC Paydown"   value={fmtUSD(logged.paydown)} />
              <ViewRow label="Strike Balance" value={fmtUSD(logged.strikeBal)} />
              <ViewRow label="Strike LTV"     value={`${(logged.strikeLtv * 100).toFixed(2)}%`} />
              {hasCbLoan && logged.cbBal != null && <ViewRow label="CB Balance" value={fmtUSD(logged.cbBal)} />}
              {hasCbLoan && logged.cbLtv != null && <ViewRow label="CB LTV"     value={`${(logged.cbLtv * 100).toFixed(1)}%`} />}
              {showMiningInLog && logged.miningSats != null && <ViewRow label="Mining Sats" value={logged.miningSats.toLocaleString()} />}
            </div>
          )}
          {active && saved && <p className={styles.savedNote}>✓ Saved</p>}
        </div>
      );
    }

    if (isCur && active) {
      return (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardHeaderLeft}>
              <span className={styles.badgeCurrent}>CURRENT MONTH</span>
              <span className={styles.cardDate}>{getMonthLabel(advisorStartDate, mn)}</span>
            </div>
          </div>
          <div className={styles.btcBoughtHighlight}>
            <span className={styles.btcBoughtLabel}>₿ BTC Bought</span>
            <input
              type="number"
              className={styles.btcBoughtInput}
              value={form.btcBought}
              step="0.00000001"
              min="0"
              onChange={(e) => setF('btcBought')(e.target.value)}
            />
          </div>
          <div className={styles.formGrid}>
            <FormField label="Income → BTC"  value={form.income}       onChange={setF('income')}        step="1" prefix="$" />
            <FormField label="BLOC Paydown"  value={form.paydown}      onChange={setF('paydown')}       step="1" prefix="$" />
            <FormField label="Strike Balance" value={form.strikeBal}   onChange={setF('strikeBal')}     step="1" prefix="$" />
            <FormField label="Strike LTV"    value={form.strikeLtvPct} onChange={setF('strikeLtvPct')} step="0.01" suffix="%" />
            {hasCbLoan && <FormField label="CB Balance" value={form.cbBal}    onChange={setF('cbBal')}    step="1" prefix="$" />}
            {hasCbLoan && <FormField label="CB LTV"     value={form.cbLtvPct} onChange={setF('cbLtvPct')} step="0.01" suffix="%" />}
            {showMiningInLog && <FormField label="Mining Sats" value={form.miningSats} onChange={setF('miningSats')} step="1" />}
          </div>
          <button className={styles.logNowBtn} onClick={handleSave}>LOG THIS MONTH</button>
          {saved && <p className={styles.savedNote}>✓ Logged</p>}
        </div>
      );
    }

    // Read-only projected values (future/past, OR the current month as a NEIGHBOR pane).
    return (
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderLeft}>
            <span className={isCur ? styles.badgeCurrent : styles.badgeFuture}>{isCur ? 'CURRENT MONTH' : 'PROJECTED'}</span>
            <span className={styles.cardDate}>{getMonthLabel(advisorStartDate, mn)}</span>
          </div>
        </div>
        {row ? (
          <div className={styles.viewGrid}>
            <ViewRow label="BTC Bought"     value={`+${row.btcBought.toFixed(5)} ₿`} proj />
            <ViewRow label="Income → BTC"   value={fmtUSD(row.incomeToBtc)} proj />
            <ViewRow label="Strike Balance" value={fmtUSD(row.blocBalance)} proj />
            {hasCbLoan && <ViewRow label="CB LTV" value={`${(row.cbLtv * 100).toFixed(1)}%`} proj />}
          </div>
        ) : (
          <p className={styles.noData}>No projection data for this month</p>
        )}
      </div>
    );
  }

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modalCard}
        onClick={(e) => e.stopPropagation()}
      >
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>MONTHLY LOG</span>
        <span className={styles.headerSub}>Mo {monthNum} of 12</span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
      </div>

      {/* Nav + card */}
      <div className={styles.navArea}>
        <button
          className={styles.navBtn}
          onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
          disabled={currentIdx === 0}
          aria-label="Previous month"
        >
          ‹
        </button>

        <div className={styles.cardScroll}>
          {/* P2 — SwipeStrip replaces the legacy touch handlers; pages months, real state changes at rest. */}
          <SwipeStrip
            onPage={(dir) => setCurrentIdx((i) => Math.min(11, Math.max(0, i + dir)))}
            canPage={(dir) => (dir === -1 ? currentIdx > 0 : currentIdx < 11)}
            renderPane={(offset) => renderMonthCard(currentIdx + 1 + offset, offset === 0)}
          />
        </div>

        <button
          className={styles.navBtn}
          onClick={() => setCurrentIdx((i) => Math.min(11, i + 1))}
          disabled={currentIdx === 11}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      {/* Dot indicator */}
      <div className={styles.dots}>
        {Array.from({ length: 12 }, (_, i) => {
          const mn = i + 1;
          const logged = monthlyLog.some((e) => e.month === mn);
          return (
            <button
              key={i}
              className={`${styles.dot} ${
                i === currentIdx ? styles.dotActive :
                logged           ? styles.dotLogged :
                                   styles.dotEmpty
              }`}
              onClick={() => setCurrentIdx(i)}
              aria-label={`Month ${mn}`}
            />
          );
        })}
      </div>
      </div>
    </div>,
    document.body,
  );
}

function ViewRow({ label, value, green, proj }: { label: string; value: string; green?: boolean; proj?: boolean }) {
  return (
    <div className={styles.viewRow}>
      <span className={styles.viewLabel}>{label}</span>
      <span className={`${styles.viewValue} ${green ? styles.viewGreen : ''} ${proj ? styles.viewProj : ''}`}>
        {value}{proj && <span className={styles.projTag}> (proj)</span>}
      </span>
    </div>
  );
}
