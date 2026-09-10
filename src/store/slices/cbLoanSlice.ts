// cbLoanSlice (Phase 1c) — Coinbase loan + Strike collateral/liq + bloc-min-payment + Strike API display fields.
import type { StoreState, StoreSet, StoreGet } from '../types';
import { todayLocalISO } from '../../utils/format';
import { CB_APR_SEED_PCT } from '../../simulation/runCoinbaseLoan';

type CbLoanSlice = Pick<StoreState,
  | 'hasCbLoan' | 'setHasCbLoan' | 'cbLoanBalance' | 'cbCollateralBtc' | 'strikeCollateralBtc' | 'cbAprPct'
  | 'coldStorageBtc' | 'setColdStorageBtc'
  | 'cbMonthlyPayment' | 'cbLiquidationPrice' | 'cbPaymentStrategy' | 'cbLtvTriggerPct' | 'cbLtvTargetPct'
  | 'cbRotateBackPct' | 'cbEmergencyCeilingPct' | 'cbLoanBalanceAsOf' | 'cbLiquidationPriceAsOf' | 'strikeLiquidationLtvPct'
  | 'blocMinPaymentSource' | 'blocStatementMinimum' | 'blocMinPaymentDueDay' | 'setCbLoanBalance' | 'setCbCollateralBtc'
  | 'setCbAprPct' | 'setCbMonthlyPayment' | 'setCbLiquidationPrice' | 'setCbPaymentStrategy' | 'setCbLtvTriggerPct'
  | 'setCbLtvTargetPct' | 'setCbRotateBackPct' | 'setCbEmergencyCeilingPct' | 'setCbLoanBalanceAsOf'
  | 'setCbLiquidationPriceAsOf' | 'setStrikeLiquidationLtvPct' | 'setBlocMinPaymentSource' | 'setBlocStatementMinimum'
  | 'setBlocMinPaymentDueDay' | 'strikeUsdBalance' | 'strikeBtcAvailable' | 'strikeRate' | 'strikeApiConnected'
  | 'strikeLastFetched' | 'setStrikeUsdBalance' | 'setStrikeBtcAvailable' | 'setStrikeRate' | 'setStrikeApiConnected'
  | 'setStrikeLastFetched'
>;

export const createCbLoanSlice = (set: StoreSet, get: StoreGet): CbLoanSlice => ({
  hasCbLoan:    false,
  setHasCbLoan: (v) => get().emitPlanSets([['hasCbLoan', v]]),   // 4c: emit a plan event (was syncSettingsToNostr)
  cbLoanBalance:       60000,
  cbCollateralBtc:     1.48,
  // Self-custodied BTC the owner actually holds. 0 on a fresh install — most people start with none
  // unpledged, and inventing a number here would put a figure in the viewer nobody entered.
  // ⚠ Distinct from the Almanac's cold-storage SWEEP, which is projected and never written to the store.
  coldStorageBtc: 0,
  strikeCollateralBtc: 0,   // Collateral-Truth v20 — reading-anchored derived cache; fresh install = deriveStrikeCollateral([], 0) = 0
  // ⚠ ALL-IN, not the Morpho market rate. Coinbase adds its platform fee on top of the market rate before
  // billing, and every engine compounds this field monthly — which is exactly how that fee is charged —
  // so this field means the NET APR the owner pays. CB_APR_SEED_PCT carries the composition; every other
  // seed site uses the same constant so they cannot drift apart again.
  // NO MIGRATION for existing installs on purpose: a blind +1.5 would double-count for anyone who had
  // already entered a net figure by hand. Persisted values stay put; the faces and the Settings/Safety
  // hints now state the live all-in number so the owner can correct their own slider.
  cbAprPct:            CB_APR_SEED_PCT,
  cbMonthlyPayment:    0,
  cbLiquidationPrice:  0,
  cbPaymentStrategy:   'monthly' as const,
  cbLtvTriggerPct:     75,
  cbLtvTargetPct:      65,
  cbRotateBackPct:     55,
  cbEmergencyCeilingPct: 30,
  cbLoanBalanceAsOf:      null,
  cbLiquidationPriceAsOf: null,
  strikeLiquidationLtvPct: 85,
  blocMinPaymentSource:  'roll' as const,
  blocStatementMinimum:  null,
  blocMinPaymentDueDay:  15,
  setCbLoanBalance:    (v) => get().emitPlanSets([['cbLoanBalance', v], ['cbLoanBalanceAsOf', todayLocalISO()]]),
  setCbCollateralBtc:  (v) => {
    // Daily Mode P2a Seam 2: emit a cbCollateralReading (clock-only — feeds the derived cache via deriveCbCollateral)
    // instead of syncing the field. NO syncSettingsToNostr — cross-device sync rides the RECORDS event now (P3): the
    // cbCollateralReading is part of dayLog, and addDayEvent (Change 3) publishes records. addDayEvent's clock refresh
    // sets cbCollateralBtc to v (latest-ts event); set explicitly too.
    const id = globalThis.crypto?.randomUUID?.() ?? `cbcoll-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    get().addDayEvent({ id, date: todayLocalISO(), ts: Date.now(), kind: 'cbCollateralReading', cbCollateral: v });
    set({ cbCollateralBtc: v });
  },
  setCbAprPct:         (v) => get().emitPlanSets([['cbAprPct', v]]),
  setColdStorageBtc:   (v) => get().emitPlanSets([['coldStorageBtc', v]]),
  setCbMonthlyPayment:   (v) => get().emitPlanSets([['cbMonthlyPayment', v]]),
  setCbLiquidationPrice: (v) => get().emitPlanSets([['cbLiquidationPrice', v], ['cbLiquidationPriceAsOf', todayLocalISO()]]),
  setCbPaymentStrategy:  (v) => get().emitPlanSets([['cbPaymentStrategy', v]]),
  setCbLtvTriggerPct:    (v) => get().emitPlanSets([['cbLtvTriggerPct', Math.max(0, Math.min(85, v))]]),
  setCbLtvTargetPct:     (v) => get().emitPlanSets([['cbLtvTargetPct', Math.max(0, Math.min(85, v))]]),
  setCbRotateBackPct:    (v) => get().emitPlanSets([['cbRotateBackPct', Math.max(0, Math.min(85, v))]]),
  setCbEmergencyCeilingPct: (v) => get().emitPlanSets([['cbEmergencyCeilingPct', Math.max(20, Math.min(50, v))]]),   // clamp preserved inside the value
  setCbLoanBalanceAsOf:      (v) => get().emitPlanSets([['cbLoanBalanceAsOf', v]]),
  setCbLiquidationPriceAsOf: (v) => get().emitPlanSets([['cbLiquidationPriceAsOf', v]]),
  setStrikeLiquidationLtvPct: (v) => get().emitPlanSets([['strikeLiquidationLtvPct', v]]),
  setBlocMinPaymentSource: (v) => get().emitPlanSets([['blocMinPaymentSource', v]]),
  setBlocStatementMinimum: (v) => get().emitPlanSets([['blocStatementMinimum', v]]),
  setBlocMinPaymentDueDay: (v) => get().emitPlanSets([['blocMinPaymentDueDay', Math.max(1, Math.min(28, Math.round(v)))]]),   // clamp preserved inside the value
  strikeUsdBalance:   null,
  strikeBtcAvailable: null,
  strikeRate:         null,
  strikeApiConnected: false,
  strikeLastFetched:  null,
  setStrikeUsdBalance:   (v) => set({ strikeUsdBalance: v }),
  setStrikeBtcAvailable: (v) => set({ strikeBtcAvailable: v }),
  setStrikeRate:         (v) => set({ strikeRate: v }),
  setStrikeApiConnected: (v) => set({ strikeApiConnected: v }),
  setStrikeLastFetched:  (v) => set({ strikeLastFetched: v }),
});
