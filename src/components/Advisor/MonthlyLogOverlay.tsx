import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store/useStore';
import { getCurrentStrategyMonth } from '../../simulation/runAdvisor';
import type { runAdvisor } from '../../simulation/runAdvisor';
import { fmtUSD } from '../../utils/format';
import type { MonthlyLogEntry } from '../../simulation/types';
import styles from './MonthlyLogOverlay.module.css';

type AdvisorMonthRow = ReturnType<typeof runAdvisor>['rows'][number];

interface MonthlyLogOverlayProps {
  initialMonth:   number;          // 0-indexed (0–11)
  months:         AdvisorMonthRow[];
  collateralBtc:  number;
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
  return d.toISOString().split('T')[0];
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

export function MonthlyLogOverlay({ initialMonth, months, collateralBtc, onClose }: MonthlyLogOverlayProps) {
  const monthlyLog      = useStore((s) => s.monthlyLog);
  const upsertLogEntry  = useStore((s) => s.upsertLogEntry);
  const advisorStartDate = useStore((s) => s.advisorStartDate);
  const hasCbLoan       = useStore((s) => s.hasCbLoan);
  const showMiningInLog = useStore((s) => s.showMiningInLog);
  const btcPrice        = useStore((s) => s.btcPrice);
  const income          = useStore((s) => s.income);
  const expenses        = useStore((s) => s.expenses);

  const [currentIdx, setCurrentIdx] = useState(Math.min(Math.max(initialMonth, 0), 11));
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<OverlayForm>(emptyForm);
  const [saved, setSaved] = useState(false);

  const touchStartX = useRef<number | null>(null);

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
    setEditing(false);
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

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (delta < -50) setCurrentIdx((i) => Math.min(11, i + 1));
    if (delta >  50) setCurrentIdx((i) => Math.max(0, i - 1));
    touchStartX.current = null;
  };

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
  const isLogged    = !!loggedEntry;
  const isCurrent   = monthNum === currentMonth;

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

  function renderCard() {
    if (isLogged) {
      return (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardHeaderLeft}>
              <span className={styles.badgeLogged}>✓ LOGGED</span>
              <span className={styles.cardDate}>{getMonthLabel(advisorStartDate, monthNum)}</span>
            </div>
            {!editing && (
              <button className={styles.editBtn} onClick={() => setEditing(true)}>Edit</button>
            )}
          </div>

          {editing ? (
            <>
              <div className={styles.formGrid}>{sharedFields}</div>
              <div className={styles.cardActions}>
                <button className={styles.cancelBtn} onClick={() => setEditing(false)}>Cancel</button>
                <button className={styles.saveBtn} onClick={handleSave}>Save changes</button>
              </div>
            </>
          ) : (
            <div className={styles.viewGrid}>
              <ViewRow label="BTC Bought"     value={`+${loggedEntry.btcBought.toFixed(5)} ₿`} green />
              <ViewRow label="Income → BTC"   value={fmtUSD(loggedEntry.income)} />
              <ViewRow label="BLOC Paydown"   value={fmtUSD(loggedEntry.paydown)} />
              <ViewRow label="Strike Balance" value={fmtUSD(loggedEntry.strikeBal)} />
              <ViewRow label="Strike LTV"     value={`${(loggedEntry.strikeLtv * 100).toFixed(2)}%`} />
              {hasCbLoan && loggedEntry.cbBal != null && <ViewRow label="CB Balance" value={fmtUSD(loggedEntry.cbBal)} />}
              {hasCbLoan && loggedEntry.cbLtv != null && <ViewRow label="CB LTV"     value={`${(loggedEntry.cbLtv * 100).toFixed(1)}%`} />}
              {showMiningInLog && loggedEntry.miningSats != null && <ViewRow label="Mining Sats" value={loggedEntry.miningSats.toLocaleString()} />}
            </div>
          )}
          {saved && <p className={styles.savedNote}>✓ Saved</p>}
        </div>
      );
    }

    if (isCurrent) {
      return (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardHeaderLeft}>
              <span className={styles.badgeCurrent}>CURRENT MONTH</span>
              <span className={styles.cardDate}>{getMonthLabel(advisorStartDate, monthNum)}</span>
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

    // Future or past — read-only projected values
    const row = months.find((r) => r.month === monthNum);
    return (
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderLeft}>
            <span className={styles.badgeFuture}>PROJECTED</span>
            <span className={styles.cardDate}>{getMonthLabel(advisorStartDate, monthNum)}</span>
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
    <div className={styles.overlay} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
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
          {renderCard()}
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
