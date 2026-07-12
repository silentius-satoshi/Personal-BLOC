// advisorJournalSlice (Phase 1c) — advisor scalars + skip flags + monthlyLog actions. getState()→get() only.
import type { StoreState, StoreSet, StoreGet } from '../types';
import { recomputeBtcHeld, upsertEntry, deriveStrikeCollateral, bucketEventToMonth, rollupMonth, priorStocksForMonth, strikeCollateralDelta, sameRollupFields, legacyBucketEventToMonth } from '../../simulation/logUtils';
import { todayLocalISO } from '../../utils/format';
import { nostrLog } from '../../lib/nostr/log';
import { kickRecordsPublish } from '../bootstrap';
import { isMonthlyMeaningful, rerollMonth } from '../dailyRouting';

type AdvisorJournalSlice = Pick<StoreState,
  | 'monthBucketReconcileDone' | 'advisorStartDate' | 'advisorActualBlocBalance' | 'advisorActualBlocBalanceAsOf'
  | 'advisorMonthStartBalance' | 'advisorActualBtcHeld' | 'getCurrentBtcHeld' | 'ndpLastPaidDate' | 'advisorSkipBlocDraw'
  | 'advisorSkipCbPayment' | 'advisorSkipBtcBuying' | 'monthlyLog' | 'showMiningInLog' | 'setAdvisorStartDate'
  | 'setAdvisorActualBlocBalance' | 'setAdvisorActualBlocBalanceAsOf' | 'setAdvisorMonthStartBalance'
  | 'setAdvisorActualBtcHeld' | 'setNdpLastPaidDate' | 'setAdvisorSkipBlocDraw' | 'setAdvisorSkipCbPayment'
  | 'setAdvisorSkipBtcBuying' | 'setMonthlyLog' | 'upsertLogEntry' | 'deleteLogEntry' | 'setShowMiningInLog'
  | 'confirmMonth' | 'unconfirmMonth' | 'reconcileMonthBuckets'
>;

export const createAdvisorJournalSlice = (set: StoreSet, get: StoreGet): AdvisorJournalSlice => ({
  monthBucketReconcileDone: false,   // rides ...rest (persisted, not synced); false → the one-shot reconcile runs once
  advisorStartDate:         todayLocalISO(),
  advisorActualBlocBalance: 0,
  advisorActualBlocBalanceAsOf: null,   // §5b — never anchored yet (null → the reading guard always applies first time)
  advisorMonthStartBalance: 0,
  advisorActualBtcHeld:     0,
  getCurrentBtcHeld: (): number => {
    const s: StoreState = get();
    return deriveStrikeCollateral(s.dayLog, s.strikeCollateralBtc);   // Collateral-Truth v20 — reading-anchored
  },
  ndpLastPaidDate:          null,
  advisorSkipBlocDraw:  false,
  advisorSkipCbPayment: false,
  advisorSkipBtcBuying: false,
  monthlyLog:      [],
  showMiningInLog: false,
  setAdvisorStartDate:         (v) => { set({ advisorStartDate: v }); get().syncSettingsToNostr(); },
  // §5b — a manual/knob write stamps asOf=today (freshness), so a stale reading can't clobber it (deriveReadingAnchors guard).
  setAdvisorActualBlocBalance: (v) => { set({ advisorActualBlocBalance: v, advisorActualBlocBalanceAsOf: todayLocalISO() }); get().syncSettingsToNostr(); },
  setAdvisorActualBlocBalanceAsOf: (v) => { set({ advisorActualBlocBalanceAsOf: v }); get().syncSettingsToNostr(); },
  setAdvisorMonthStartBalance: (v) => { set({ advisorMonthStartBalance: v }); get().syncSettingsToNostr(); },
  setAdvisorActualBtcHeld:     (v) => { set({ advisorActualBtcHeld: v });    get().syncSettingsToNostr(); },
  setNdpLastPaidDate:          (v) => { set({ ndpLastPaidDate: v }); get().syncSettingsToNostr(); },

  setAdvisorSkipBlocDraw:  (v) => { set({ advisorSkipBlocDraw: v });  get().syncSettingsToNostr(); },
  setAdvisorSkipCbPayment: (v) => { set({ advisorSkipCbPayment: v }); get().syncSettingsToNostr(); },
  setAdvisorSkipBtcBuying: (v) => { set({ advisorSkipBtcBuying: v }); get().syncSettingsToNostr(); },
  setMonthlyLog:  (entries) => set({ monthlyLog: entries }),
  upsertLogEntry: (entry) => {
    // M2 guard (centralized — all Monthly UI write paths funnel here): a daily-owned month must not be clobbered by a
    // non-daily (manual/monthly) write. The daily routing stamps source:'daily' (passes); confirmMonth preserves it
    // (passes); legacy/manual months (source undefined) are unaffected.
    const existingForGuard = get().monthlyLog.find((e) => e.month === entry.month);
    if (existingForGuard?.source === 'daily' && entry.source !== 'daily') {
      nostrLog('warn', 'monthly write blocked — month is daily-owned');
      return;
    }
    set((state) => {
      // Collateral-Truth v20 — graduation retired. collateralAdjustment is NEVER written again; existing
      // stored values stay (historical ledger — never "fix" the data). recomputeBtcHeld still runs for the
      // historical btcHeld chain (display + sync-norm stability). Strike collateral is now reading-anchored
      // (deriveStrikeCollateral over dayLog), independent of this entry.
      const existingAdj = state.monthlyLog.find((e) => e.month === entry.month)?.collateralAdjustment ?? 0;
      const stamped = { ...entry, updatedAt: Date.now(), collateralAdjustment: existingAdj };
      const { [entry.month]: _gone, ...restDel } = state.deletedMonths;   // re-log clears the tombstone
      return {
        monthlyLog: recomputeBtcHeld(upsertEntry(state.monthlyLog, stamped), state.advisorActualBtcHeld),
        deletedMonths: restDel,
        recordsDirty: true,
      };
    });
    kickRecordsPublish();
  },
  deleteLogEntry: (month) => {
    set((state) => {
      // Collateral-Truth v20 — restore-on-delete retired (no pending). recomputeBtcHeld fixes the surviving
      // historical chain (stale-btcHeld gap); current Strike collateral is reading-anchored, unaffected.
      return {
        monthlyLog: recomputeBtcHeld(state.monthlyLog.filter((e) => e.month !== month), state.advisorActualBtcHeld),
        deletedMonths: { ...state.deletedMonths, [month]: Date.now() },
        recordsDirty: true,
      };
    });
    kickRecordsPublish();
  },
  setShowMiningInLog: (v) => set({ showMiningInLog: v }),

  // Logging Consolidation §2 — the Sign-off absorbs the confirm in ONE atomic write. extras (from the
  // ReviewSheet's SIGN-OFF DETAILS group) land together with confirmed:true → single publish, no
  // half-signed window. The spread keeps source:'daily' so the M2 guard passes. Zero-arg callers unchanged.
  confirmMonth: (month, extras) => {
    const e = get().monthlyLog.find((m) => m.month === month);
    if (e) get().upsertLogEntry({ ...e, ...extras, confirmed: true });
  },

  // §4 — the honest "signed off too early" flow for a daily-owned month: flip confirmed→false, entry +
  // rollup preserved (spread keeps source:'daily' → M2 guard passes). Replaces the delete-based Undo/Unlog
  // for daily months (DELETE tombstones the month; un-confirm keeps it so the Ledger's events keep rolling).
  unconfirmMonth: (month) => {
    const e = get().monthlyLog.find((m) => m.month === month);
    if (e) get().upsertLogEntry({ ...e, confirmed: false });
  },

  // One-shot reconcile after the calendar-anniversary bucketing fix — re-roll stored monthlyLog entries that were
  // rolled under the OLD 30.4375 buckets. Diff-guarded: a month re-rolls ONLY when its fresh rollup fields differ
  // OR a boundary strike-collateral move changed its attribution (the entry's collateralAdjustment can't be
  // equality-tested — collateralDelta is separate + folds graduated pending — so compare the delta under the new
  // vs. the legacy bucket). Ascending so month m−1 (priorStocks source) reconciles first. Idempotent (a re-run
  // finds no diffs). Only CHANGED months publish (via rerollMonth→upsertLogEntry); rerollMonth's reopen-on-edit
  // correctly reopens a changed confirmed month.
  reconcileMonthBuckets: () => {
    const start = get().advisorStartDate;
    for (let m = 1; m <= 12; m++) {
      const s = get();
      const events   = s.dayLog.filter((e) => isMonthlyMeaningful(e) && bucketEventToMonth(e.date, start) === m);
      const existing = s.monthlyLog.find((e) => e.month === m);
      const { entry: fresh } = rollupMonth(s.dayLog, m, start, priorStocksForMonth(s.dayLog, start, m));
      const emptiedDaily    = events.length === 0 && existing?.source === 'daily';
      const collateralMoved = strikeCollateralDelta(s.dayLog, start, m, bucketEventToMonth)
                            !== strikeCollateralDelta(s.dayLog, start, m, legacyBucketEventToMonth);
      if (emptiedDaily || collateralMoved || (events.length > 0 && !sameRollupFields(existing, fresh))) rerollMonth(get, m);
    }
    set({ monthBucketReconcileDone: true });
  },
});
