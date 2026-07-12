import type { StoreState } from './useStore';                 // type-only — no runtime edge
import type { ViewerSnapshot } from '../lib/nostr/publish';   // type-only
import { deriveSafetyView, selectSafetyViewInputs, buildSafeSafety } from '../simulation/safetyView';
import { deriveCbCollateral, deriveStrikeCollateral } from '../simulation/logUtils';

// THE settings payload — single source built from current state, consumed by BOTH publishSettingsNow AND the
// viewer snapshot so the two can never drift. The owner's viewer roster (viewers/nextViewerIndex) IS carried
// here (syncs across the owner's devices) but is STRIPPED from the viewer snapshot below.
export function buildSettingsPayload(s: StoreState): Record<string, unknown> {
  return {
    income:                   s.income,
    expenses:                 s.expenses,
    blocApr:                  s.blocApr,
    creditLine:               s.creditLine,
    advisorStartDate:         s.advisorStartDate,
    advisorActualBlocBalance: s.advisorActualBlocBalance,
    advisorActualBlocBalanceAsOf: s.advisorActualBlocBalanceAsOf,   // §5b — freshness travels with the balance (like cbLoanBalanceAsOf)
    advisorMonthStartBalance: s.advisorMonthStartBalance,
    advisorActualBtcHeld:     s.advisorActualBtcHeld,
    cbLoanBalance:            s.cbLoanBalance,
    // cbCollateralBtc REMOVED from settings sync (Daily Mode P2a, Seam 2) — it's now a LOCAL derived cache
    // (deriveCbCollateral over dayLog). Cross-device sync is intentionally SUSPENDED P2a→P3 (re-established when
    // dayLog rides the records event in P3).
    cbAprPct:                 s.cbAprPct,
    hasCbLoan:                s.hasCbLoan,
    ndpLastPaidDate:          s.ndpLastPaidDate,
    tabOrder:                 s.tabOrder,
    hiddenTabs:               s.hiddenTabs,
    simpleMode:               s.simpleMode,
    btcBuyingUnit:            s.btcBuyingUnit,
    cbLiquidationPrice:       s.cbLiquidationPrice,
    cbMonthlyPayment:         s.cbMonthlyPayment,
    cbPaymentStrategy:        s.cbPaymentStrategy,
    cbLtvTriggerPct:          s.cbLtvTriggerPct,
    cbLtvTargetPct:           s.cbLtvTargetPct,
    cbRotateBackPct:          s.cbRotateBackPct,
    cbEmergencyCeilingPct:    s.cbEmergencyCeilingPct,
    cbLoanBalanceAsOf:        s.cbLoanBalanceAsOf,
    cbLiquidationPriceAsOf:   s.cbLiquidationPriceAsOf,
    strikeLiquidationLtvPct:  s.strikeLiquidationLtvPct,
    blocMinPaymentSource:     s.blocMinPaymentSource,
    blocStatementMinimum:     s.blocStatementMinimum,
    blocMinPaymentDueDay:     s.blocMinPaymentDueDay,
    advisorSkipBlocDraw:      s.advisorSkipBlocDraw,
    advisorSkipCbPayment:     s.advisorSkipCbPayment,
    advisorSkipBtcBuying:     s.advisorSkipBtcBuying,
    nostrRelays:              s.nostrRelays,   // C: relay list syncs across the owner's devices (guarded on hydrate; stripped from the viewer snapshot)
    // Backup gate (R2a-1) — verifying on ONE owner device un-gates the owner's others. One-way latch (guarded on
    // hydrate); STRIPPED from the trusted viewer snapshot below. keyProvenance is device-local → NOT here.
    backupVerifiedAt:         s.backupVerifiedAt,
    // Multi-viewer roster (M1) — synced in the OWNER's settings:v1 only; STRIPPED from every viewer snapshot below.
    viewers:                  s.viewers,
    nextViewerIndex:          s.nextViewerIndex,
  };
}

// Viewer snapshot — MODE-SHAPED (Viewer V2). Default C-SAFE: a tiny payload of health ratios + config
// ratios + public price. NO absolute exists in it BY CONSTRUCTION (the privacy audit is Object.keys — no
// settings/records/strike/cbCollateralBtc keys). C-TRUSTED (opt-in): today's full payload. See safetyView.ts.
export function buildViewerSnapshotPayload(s: StoreState, tier: 'safe' | 'trusted'): ViewerSnapshot {
  const asOf = Date.now();
  if (tier !== 'trusted') {   // M2: tier is an explicit param (the slot-0 read moved into the fan-out loop) — built once per tier.
    // C-SAFE — the owner runs the dashboard's EXACT inputs (deriveSafetyView ∘ selectSafetyViewInputs), then
    // ships only the ratio/level block (buildSafeSafety drops the two $ absolutes) + config ratios + price.
    const view = deriveSafetyView(selectSafetyViewInputs(s));
    return {
      snapshotVersion: 2,
      privacyMode: 'safe',
      asOf,
      hasCbLoan: s.hasCbLoan,
      btcPriceAtSnapshot: s.btcPrice,   // public market data
      thresholds: {
        strikeLiqLtv:    s.strikeLiquidationLtvPct / 100,
        cbLtvTriggerPct: s.cbLtvTriggerPct,
        cbLiqFrac:       view.cbLiqFrac,
      },
      safety: buildSafeSafety(view, s.hasCbLoan),
    };
  }
  // C-TRUSTED (Option B): today's full payload. STRIP the owner's sharing/transport config (the viewers roster
  // + nextViewerIndex + nostrRelays) — the viewer must never see who else the owner shares with, their tiers/key
  // versions, nor the owner's relay set — AND backupVerifiedAt (R2a-1: the owner's key-custody state is none of
  // the viewer's business; it also gates nothing viewer-side).
  return {
    snapshotVersion: 2,
    privacyMode: 'trusted',
    asOf,
    settings: (() => { const { viewers: _vs, nextViewerIndex: _ni, nostrRelays: _r, backupVerifiedAt: _bv, ...rest } = buildSettingsPayload(s); return rest; })(),
    records:  { entries: s.monthlyLog, deletions: s.deletedMonths },   // the viewer gets the rolled-up months, NOT the raw dayLog journal
    strike:   { usd: s.strikeUsdBalance, btcAvail: s.strikeBtcAvailable, rate: s.strikeRate },
    cbCollateralBtc: deriveCbCollateral(s.dayLog, s.cbCollateralBtc),   // P3 (BUG2) — the derived scalar; the viewer raw-sets it (applyViewerEvent), never via setCbCollateralBtc
    strikeCollateralBtc: deriveStrikeCollateral(s.dayLog, s.strikeCollateralBtc),   // C-P4 — the reading-anchored Strike scalar; viewer raw-sets it (dayLog stays []). SAFE branch must NOT carry it
  };
}
