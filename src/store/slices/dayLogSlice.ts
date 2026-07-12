// dayLogSlice (Phase 1c) — dayLog mutators + emitBalanceReading. Helpers receive set/get; getState()→get() only.
import type { StoreState, StoreSet, StoreGet } from '../types';
import type { DayEvent } from '../../simulation/types';
import { deriveCbCollateral, deriveStrikeCollateral } from '../../simulation/logUtils';
import { computeStrikeLtv } from '../../simulation/strikeCredit';
import { accruedCbBalance, cbMetrics } from '../../simulation/cbMetrics';
import { todayLocalISO } from '../../utils/format';
import { kickRecordsPublish } from '../bootstrap';
import { refreshCbCollateralCache, refreshStrikeCollateralCache, refreshBalanceAnchors, readingCtx, monthOf, rerollMonth } from '../dailyRouting';

type DayLogSlice = Pick<StoreState,
  | 'dayLog' | 'cbLtvAction' | 'addDayEvent' | 'updateDayEvent' | 'deleteDayEvent' | 'undoDayEventDeletion'
  | 'setDayLog' | 'setCbLtvAction' | 'emitBalanceReading'
>;

export const createDayLogSlice = (set: StoreSet, get: StoreGet): DayLogSlice => ({
  dayLog:      [],
  cbLtvAction: 'paydown',
  // Daily Mode P2a/P3 — dayLog mutators. Each mutates dayLog, refreshes the cbCollateralBtc clock, then re-rolls any
  // affected strategy month(s). cbCollateralReading is clock-only (Route 1) — it never re-rolls / touches monthlyLog.
  // P3 — EVERY mutator marks recordsDirty + publishes explicitly: journal-only events (cbCollateralReading, target:'cb')
  // have monthOf===null → no rerollMonth → no publish, and rerollMonth's delete-to-empty branch returns without one.
  // recordsDirty is set BEFORE publishing so a failed immediate publish is retried by syncNow (mirrors upsertLogEntry).
  // Monthly-meaningful events publish twice (here + via rerollMonth→upsertLogEntry) — harmless (replaceable + idempotent merge).
  addDayEvent: (event) => {
    set((s) => ({ dayLog: [...s.dayLog, event], recordsDirty: true }));
    refreshCbCollateralCache(set, get);
    refreshStrikeCollateralCache(set, get);   // Collateral-Truth v20 — reading-anchored Strike collateral cache
    refreshBalanceAnchors(set, get);   // §5b — a new reading re-anchors the live safety gauges (no removed source on add)
    const m = monthOf(get, event);
    if (m !== null) rerollMonth(get, m);
    kickRecordsPublish();
  },
  updateDayEvent: (event) => {
    // ts is the MERGE VERSION CLOCK — every edit must bump it or the edit ties with (and loses to) the
    // stale copy on other devices; date carries occurrence.
    const bumped = { ...event, ts: Date.now() };
    const before = get().dayLog.find((e) => e.id === event.id);
    set((s) => ({ dayLog: s.dayLog.map((e) => (e.id === event.id ? bumped : e)), recordsDirty: true }));
    refreshCbCollateralCache(set, get);
    refreshStrikeCollateralCache(set, get);   // Collateral-Truth v20 — reading-anchored Strike collateral cache
    refreshBalanceAnchors(set, get, readingCtx(before));   // §5b — editing a reading re-anchors; a moved/changed source falls back via the ctx proxy
    const months = new Set<number>();
    const mb = monthOf(get, before); if (mb !== null) months.add(mb);   // re-roll the OLD month (date may have crossed a boundary)
    const ma = monthOf(get, bumped); if (ma !== null) months.add(ma);   // and the NEW month
    for (const m of months) rerollMonth(get, m);
    kickRecordsPublish();
  },
  deleteDayEvent: (id) => {
    const before = get().dayLog.find((e) => e.id === id);
    if (!before) return;
    set((s) => ({ dayLog: s.dayLog.filter((e) => e.id !== id), deletedDayEvents: { ...s.deletedDayEvents, [id]: Date.now() }, recordsDirty: true }));
    refreshCbCollateralCache(set, get);
    refreshStrikeCollateralCache(set, get);   // Collateral-Truth v20 — reading-anchored Strike collateral cache
    refreshBalanceAnchors(set, get, readingCtx(before));   // §5b — deleting the anchor-source reading falls back to the date-latest survivor
    const m = monthOf(get, before);
    if (m !== null) rerollMonth(get, m);
    kickRecordsPublish();
  },
  // P2 undo (Snackbar) — restore a just-deleted event. The store discarded the object on delete, so the CALLER
  // passes the retained DayEvent. Re-add with a FRESH ts (Date.now()) + strip the tombstone — the canonical
  // edit-after-delete revive (mergeRecords: an event survives iff tombstone.ts is NOT strictly > event.ts, so a
  // bumped-ts restore beats any tombstone already published within the 5s window on every device). Mirrors the
  // add/delete mutators' cache/reroll/publish tail.
  undoDayEventDeletion: (event) => {
    const restored = { ...event, ts: Date.now() };
    set((s) => {
      const rest = { ...s.deletedDayEvents };
      delete rest[event.id];
      return {
        dayLog: [...s.dayLog.filter((e) => e.id !== event.id), restored],   // filter guards a double-undo
        deletedDayEvents: rest,
        recordsDirty: true,
      };
    });
    refreshCbCollateralCache(set, get);
    refreshStrikeCollateralCache(set, get);
    refreshBalanceAnchors(set, get, readingCtx(restored));
    const m = monthOf(get, restored);
    if (m !== null) rerollMonth(get, m);
    kickRecordsPublish();
  },
  // P3 — raw write-back from the records merge (sync.ts). FOLDS the Seam-2 derive: set dayLog AND recompute
  // cbCollateralBtc ONCE from the merged array. NO rollup / per-event derive — keeps the sync apply path actions-only.
  setDayLog: (events) => set((s) => ({ dayLog: events, cbCollateralBtc: deriveCbCollateral(events, s.cbCollateralBtc), strikeCollateralBtc: deriveStrikeCollateral(events, s.strikeCollateralBtc) })),
  setCbLtvAction: (v) => set({ cbLtvAction: v }),

  // §5b — the emit-conversion for the SafetyDashboard inline editors + the Quick-Setup position modal: a manual
  // re-anchor becomes a journaled balanceReading (one write path). Synthesizes the UN-edited half from current
  // derived state — the CB balance defaults to accruedCbBalance (re-basing accrued interest to today, restoring the
  // R2 confirm-sheet auto-accrual), the Strike LTV to computeStrikeLtv, LTVs as fractions. addDayEvent → the seam
  // re-anchors from it. Today-dated → "last action wins" (a manual re-anchor is the newest assertion).
  emitBalanceReading: (overrides) => {
    const s = get();
    const price = s.btcPrice;
    const btcHeld = s.getCurrentBtcHeld();
    // v20 — a strikeCollateral override makes this a COLLATERAL anchor: the reading carries it and the LTV is
    // computed against the NEW collateral (not getCurrentBtcHeld). Absent → byte-identical to today (debt re-anchor).
    const collateral = overrides.strikeCollateral ?? btcHeld;
    const strikeBal = overrides.strikeBal ?? s.advisorActualBlocBalance;
    const reading: Extract<DayEvent, { kind: 'balanceReading' }>['reading'] = {
      strikeBal,
      strikeLtv: computeStrikeLtv(strikeBal, collateral, price),   // fraction — from the NEW collateral when overridden
      price,
      ...(overrides.strikeCollateral !== undefined ? { strikeCollateral: overrides.strikeCollateral } : {}),
    };
    // CB half only when a CB field is genuinely asserted (CB box) — a Strike-only re-anchor (Strike box /
    // Quick Setup) emits a Strike-only reading so it never re-bases the CB balance or fake-freshens the CB
    // freshness label. The FAB "Set balance" path is separate (buildEventsFromSheet) and requires both.
    if (s.hasCbLoan && (overrides.cbBal !== undefined || overrides.cbLiqPrice !== undefined)) {
      const cbBal = overrides.cbBal ?? accruedCbBalance(s.cbLoanBalance, s.cbAprPct, s.cbLoanBalanceAsOf);
      reading.cbBal = cbBal;
      reading.cbLtv = cbMetrics(cbBal, s.cbCollateralBtc, price, s.cbLtvTriggerPct).ltv;   // fraction
      reading.cbCollateral = s.cbCollateralBtc;
      const liq = overrides.cbLiqPrice ?? (s.cbLiquidationPrice > 0 ? s.cbLiquidationPrice : undefined);
      if (liq !== undefined) reading.cbLiqPrice = liq;
    }
    const id = globalThis.crypto?.randomUUID?.() ?? `read-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    get().addDayEvent({ id, date: todayLocalISO(), ts: Date.now(), kind: 'balanceReading', reading });
  },
});
