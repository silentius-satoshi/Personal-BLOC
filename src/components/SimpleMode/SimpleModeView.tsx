import { useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { getCurrentStrategyMonth, isStrategyComplete } from '../../simulation/runAdvisor';
import { computeExpenseReanchor } from '../../simulation/logUtils';
import { fmtUSDCents, shownUsd, toCents } from '../../utils/format';
import { planLogRows, planReanchorWords, planMoveBringsCbWithin, PLAN_PATHS_LINK } from '../Almanac/planMonthView';
import { MonthlyLogOverlay } from '../Advisor/MonthlyLogOverlay';
import { SafetyDashboard } from './SafetyDashboard';
import { ViewToggle } from '../Layout/ViewToggle';
import { HeaderNavCluster } from '../Layout/HeaderNavCluster';
import { BackupNagCard } from '../Entry/BackupNagCard';
import { PlanMonthCard } from './PlanMonthCard';
import { usePlanCardInputs } from './usePlanCardInputs';
import styles from './SimpleModeView.module.css';


interface SimpleModeViewProps {
  onOpenSettings: () => void;
  onOpenAlmanac:  () => void;
  /** Run 3 — the Outlook's place: the Almanac, opened on the Decision face. */
  onOpenPlanPaths: () => void;
  simpleView: 'dashboard' | 'monthly' | 'daily';
  setSimpleView: (v: 'dashboard' | 'monthly' | 'daily') => void;
}



function ModalField({ label, prefix, value, onChange, step = 1, hint }: {
  label: string; prefix?: string; value: number;
  onChange: (v: number) => void; step?: number; hint?: string;
}) {
  return (
    <div className={styles.modalFieldGroup}>
      <span className={styles.modalFieldLabel}>{label}</span>
      <div className={styles.modalFieldInput}>
        {prefix && <span className={styles.modalFieldPrefix}>{prefix}</span>}
        <input
          type="number"
          className={styles.modalNumberInput}
          value={value}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        />
      </div>
      {hint && <span className={styles.positionStatHint}>{hint}</span>}
    </div>
  );
}

export function SimpleModeView({ onOpenSettings, onOpenAlmanac, onOpenPlanPaths, simpleView, setSimpleView }: SimpleModeViewProps) {
  const income    = useStore((s) => s.income);
  const expenses  = useStore((s) => s.expenses);
  const creditLine = useStore((s) => s.creditLine);

  const advisorActualBlocBalance    = useStore((s) => s.advisorActualBlocBalance);
  const emitBalanceReading          = useStore((s) => s.emitBalanceReading);   // §5b — Quick-Setup save emits a journaled Strike reading
  const currentBtcHeld              = useStore((s) => s.getCurrentBtcHeld());   // reading-anchored current Strike collateral (v20)
  const advisorStartDate            = useStore((s) => s.advisorStartDate);

  // §3 — advisorSkip* are DORMANT (retained in the store/payload for sync compat; no consumers since Run 3 — the
  // Advisor tab's Pay / Skip toggles retired with its plan rows).
  const viewerMode           = useStore((s) => s.viewerMode);   // read-only viewer → hide/disable mutation controls

  const setSimpleMode = useStore((s) => s.setSimpleMode);

  const setIncome     = useStore((s) => s.setIncome);
  const setExpenses   = useStore((s) => s.setExpenses);
  const expenseReanchorDismissedAt    = useStore((s) => s.expenseReanchorDismissedAt);
  const setExpenseReanchorDismissedAt = useStore((s) => s.setExpenseReanchorDismissedAt);
  const setCreditLine = useStore((s) => s.setCreditLine);

  const monthlyLog       = useStore((s) => s.monthlyLog);

  // Change 1 (iter 2) — setup modal
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [modalDraft, setModalDraft] = useState({
    income, expenses, creditLine,
    blocBalance: advisorActualBlocBalance,
    btcHeld: currentBtcHeld,
  });

  // Monthly log overlay
  const [logOverlayOpen, setLogOverlayOpen]               = useState(false);
  const [logOverlayInitialMonth, setLogOverlayInitialMonth] = useState(0);

  const currentMonth    = getCurrentStrategyMonth(advisorStartDate);
  const strategyDone    = isStrategyComplete(advisorStartDate);

  // Run 3 — this screen's ONE run of the plan of record: the card, and the log overlay's planned rows (the Advisor's
  // rows left every screen with the Outlook).
  const { pm, crashLine, ndp, ndpEstimate, ndpActionActive } = usePlanCardInputs();
  const overlayRows = useMemo(() => planLogRows(pm.run.sim, currentMonth), [pm.run.sim, currentMonth]);
  // F-R4-1 — the month in progress is still being logged, so only the months before it count. Once the year is done
  // currentMonth stays 12, and month 12 keeps every later draw (bucketEventToMonth clamps), so it never counts.
  const { show: showReanchor, avg: reanchorAvg } = computeExpenseReanchor(
    monthlyLog, expenses, expenseReanchorDismissedAt, currentMonth);
  const reanchor = planReanchorWords(reanchorAvg, expenses);

  const isDefaultSetup = income === 5000 && expenses === 4000 && advisorActualBlocBalance === 0;

  const openSetupModal = () => {
    setModalDraft({ income, expenses, creditLine, blocBalance: advisorActualBlocBalance, btcHeld: currentBtcHeld });
    setShowSetupModal(true);
  };

  const handleSaveSetup = () => {
    setIncome(modalDraft.income);
    setExpenses(modalDraft.expenses);
    setCreditLine(modalDraft.creditLine);
    // §5b — emit a journaled Strike reading (the seam re-anchors advisorActualBlocBalance + asOf=today); Strike-only
    // (no CB re-base). v20 — when "BTC held" (collateral) changed too, MERGE strikeCollateral into the SAME emission
    // (the LTV is then computed from the new collateral) rather than emitting twice.
    const collChanged = modalDraft.btcHeld !== useStore.getState().getCurrentBtcHeld();
    emitBalanceReading({
      strikeBal: modalDraft.blocBalance,
      ...(collChanged ? { strikeCollateral: modalDraft.btcHeld } : {}),
    });
    setShowSetupModal(false);
  };


  return (
    <>
    <div className={styles.root}>
    <div className={styles.content}>

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.brandMark}>₿</span>
          <span className={styles.brandName}>Personal ₿LOC</span>
        </div>
        <HeaderNavCluster
          active="journal"
          onDashboard={() => setSimpleView('dashboard')}
          onJournal={() => setSimpleView('daily')}
          onFullMode={() => setSimpleMode(false)}
          onAlmanac={onOpenAlmanac}
          onSettings={onOpenSettings}
        />
      </div>

      {/* R2c-5 — see DailyModeView: the same self-gating, owner-only nag, with a session-shared dismiss. */}
      <BackupNagCard />

      <ViewToggle simpleView={simpleView} setSimpleView={setSimpleView} />

      <SafetyDashboard moveBringsCbWithin={planMoveBringsCbWithin(pm.run.placement)} />

      <div className={styles.cards}>

        {/* Feature 3 — NDP urgency card */}
        {(ndp.status === 'soon' || ndp.status === 'overdue') && (
          <div className={`${styles.ndpUrgentCard} ${ndp.status === 'overdue' ? styles.ndpUrgentOverdue : styles.ndpUrgentSoon}`}>
            <span className={styles.ndpUrgentIcon}>
              {ndp.status === 'overdue' ? '⛔' : '⚠'}
            </span>
            <div className={styles.ndpUrgentText}>
              <span className={styles.ndpUrgentTitle}>
                {ndp.status === 'overdue'
                  ? 'NDP overdue — pay Strike immediately'
                  : `NDP due in ${ndp.daysRemaining} days`}
              </span>
              {shownUsd(ndpEstimate) && (
                <span className={styles.ndpUrgentSub}>
                  ~{fmtUSDCents(ndpEstimate)} minimum to keep your line active
                </span>
              )}
            </div>
          </div>
        )}

        {/* The plan of record's Monthly Playbook (Run 2): one card, one month, each fact once. */}
        <PlanMonthCard
          pm={pm}
          currentMonth={currentMonth}
          strategyDone={strategyDone}
          crashLine={crashLine}
          ndp={ndp}
          ndpActionActive={ndpActionActive}
          onOpenLedger={() => setSimpleView('daily')}
          onEditMonth={(m) => { setLogOverlayInitialMonth(m - 1); setLogOverlayOpen(true); }}
        />

        {/* Run 3 — the Outlook's place: the plan on the price paths, in the Almanac's Decision face (one engine). */}
        <button className={styles.pathsLink} onClick={onOpenPlanPaths}>{PLAN_PATHS_LINK} →</button>

        {/* The expenses prompt (on the Outlook until Run 3) — to the cent, like THIS MONTH (BL19); owner-only: Update
            writes the plan. Its words and buttons are planMonthView's (BL26). */}
        {showReanchor && !viewerMode && (
          <div className={styles.reanchorBanner}>
            <span className={styles.reanchorText}>{reanchor.line}</span>
            <div className={styles.reanchorBtns}>
              <button
                className={`${styles.reanchorBtn} ${styles.reanchorBtnPrimary}`}
                onClick={() => setExpenses(toCents(reanchorAvg))}
              >{reanchor.update}</button>
              <button
                className={styles.reanchorBtn}
                onClick={() => setExpenseReanchorDismissedAt(Math.round(reanchorAvg))}
              >{reanchor.keep}</button>
            </div>
          </div>
        )}

        {/* Change 1 (iter 2) — setup prompt + modal (always reachable; first-run copy when defaults).
            Hidden for read-only viewers — they cannot edit the owner's numbers. */}
        <>
            {!viewerMode && (
            <button className={styles.setupPrompt} onClick={openSetupModal}>
              {isDefaultSetup ? '⚙ Set up your numbers to personalize this plan' : '⚙ Edit your numbers'}
            </button>
            )}

            {showSetupModal && (
              <div className={styles.modalOverlay} onClick={() => setShowSetupModal(false)}>
                <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
                  <h3 className={styles.modalTitle}>Quick Setup</h3>
                  <div className={styles.modalFields}>
                    <ModalField label="Monthly income"   prefix="$" value={modalDraft.income}      onChange={(v) => setModalDraft(d => ({ ...d, income: v }))} />
                    <ModalField label="Monthly expenses" prefix="$" value={modalDraft.expenses}    onChange={(v) => setModalDraft(d => ({ ...d, expenses: v }))} />
                    <ModalField label="Credit line"      prefix="$" value={modalDraft.creditLine}  onChange={(v) => setModalDraft(d => ({ ...d, creditLine: v }))} />
                    <ModalField label="Amount Drawn"      prefix="$" value={modalDraft.blocBalance} onChange={(v) => setModalDraft(d => ({ ...d, blocBalance: v }))} />
                    <ModalField label="BTC held"         prefix="₿" value={modalDraft.btcHeld}     onChange={(v) => setModalDraft(d => ({ ...d, btcHeld: v }))} step={0.001} />
                  </div>
                  <div className={styles.modalActions}>
                    <button className={styles.modalCancel} onClick={() => setShowSetupModal(false)}>Cancel</button>
                    <button className={styles.modalSave}   onClick={handleSaveSetup}>Save</button>
                  </div>
                </div>
              </div>
            )}
        </>

      </div>

      <button className={styles.fullAppLink} onClick={() => setSimpleMode(false)}>
        Full App →
      </button>

    </div>
    </div>

    {logOverlayOpen && (
      <MonthlyLogOverlay
        initialMonth={logOverlayInitialMonth}
        months={overlayRows}
        openInEditMode
        onClose={() => setLogOverlayOpen(false)}
        money={fmtUSDCents}
      />
    )}
    </>
  );
}
