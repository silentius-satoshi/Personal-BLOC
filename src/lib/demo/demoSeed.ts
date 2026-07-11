// C0 — sandbox demo seed. On the PUBLIC deploy (VITE_DEMO=1) this module's side-effect block writes a curated
// showcase plan into localStorage on EVERY load (that re-write IS the reload-reset), booting the real app into the
// identity-less-shell state R2c-6b documented: onboarded, NO Nostr identity → AppShell's auth/viewer gates are all
// skipped → Branch J renders the hydrated plan. Publish is impossible by construction (no signer can exist).
//
// ⚠ IMPORT-ORDER CONSTRAINT: main.tsx imports THIS FIRST, before anything that pulls useStore — the store's
// module-init IIFEs read localStorage at import time, so the seed must land before the store module evaluates.
// Therefore this file imports ONLY pure helpers (utils/format) + type-only shapes (erased at compile). It must
// NEVER transitively import useStore.
//
// ⚠ NO identity/viewer fields, and keyProvenance/backupVerifiedAt absent (→ null → the backup nag, which gates on
// 'generated', stays hidden). A fixed MANUAL btcPrice keeps the showcase deterministic (a live price could push the
// CB gauge out of the intended watch band on a volatile day).

import { toLocalISO } from '../../utils/format';
import { CURRENT_STORE_VERSION } from '../storeVersion';   // zero-import module → does NOT violate the never-import-useStore constraint
import type { MonthlyLogEntry, DayEvent } from '../../simulation/types';

// ⚠ MUST equal the store's persist `version` (src/store/useStore.ts). Sourced from the single CURRENT_STORE_VERSION
// constant; e2e/helpers.ts keeps its own pinned copy (Playwright can't resolve src imports) — both in the CLAUDE.md
// Build & Deploy bump checklist.
export const DEMO_SEED_STORE_VERSION = CURRENT_STORE_VERSION;

/** Add `n` calendar months to `d`, clamping the day for short target months (matches bucketEventToMonth's
 *  calendar-anniversary stepping). Local-date construction so it pairs with toLocalISO. */
function addMonths(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const daysInTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), daysInTarget));
  return target;
}

// Fixed showcase price — the whole plan's dollar figures are consistent with this. btcPriceMode:'manual' suppresses
// the live overwrite so the demo dashboard is deterministic (Strike LTV green, CB LTV in the watch band under 75%).
const DEMO_BTC_PRICE = 115_000;

/**
 * Build the demo store `state` — all dates relative to `today` so the showcase never rots. Pure + exported for the
 * unit test. advisorStartDate = today − 7 calendar months → the plan sits in strategy Month 8.
 */
export function buildDemoSeedState(today: Date): Record<string, unknown> {
  const startDate = addMonths(today, -7);
  const advisorStartDate = toLocalISO(startDate);
  const todayISO = toLocalISO(today);
  const asOf = toLocalISO(addMonths(today, 0)); // today; kept explicit for the anchors below
  const anchorAsOf = toLocalISO(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 3)); // ~3 days back

  // ── Coinbase loan (ltvTriggered) — CB LTV ≈ 99000/(1.2×115000) = 71.7% → WATCH band, just under the 75% trigger.
  const cbLoanBalance = 99_000;
  const cbCollateralBtc = 1.2;
  const cbLiquidationPrice = Math.round(cbLoanBalance / (cbCollateralBtc * 0.86)); // ≈ 95,930 (balance/(collat×CB_LLTV))

  // ── Strike position — live drawn 8500 against 0.85 ₿ at 115k → LTV 8.7% → GREEN (< 10%). Credit 8500/25000 = 34%.
  const currentStrikeCollateral = 0.85;
  const advisorActualBlocBalance = 8_500;
  const baselineBtcHeld = 0.55; // month-0 baseline, below the current collateral

  // ── 7 confirmed historical months (source:'manual' — the realistic legacy shape; NOT 'daily', or the one-shot
  //    reconcile's emptied-daily branch would delete every month that has no dayLog events). Coherent chained story:
  //    btcHeld ascending, ≥2 months with a paydown (so the playbook two-tone scrubber + ltvTriggered amber render).
  const rows: Array<Pick<MonthlyLogEntry, 'btcHeld' | 'strikeBal' | 'strikeLtv' | 'paydown' | 'income' | 'btcBought' | 'expensesActual' | 'cbBal' | 'cbLtv'>> = [
    { btcHeld: 0.60, strikeBal: 4000, strikeLtv: 0.120, paydown: 0,    income: 3500, btcBought: 0.030, expensesActual: 4500, cbBal: 95_000, cbLtv: 0.700 },
    { btcHeld: 0.64, strikeBal: 4200, strikeLtv: 0.115, paydown: 0,    income: 3500, btcBought: 0.032, expensesActual: 4500, cbBal: 95_300, cbLtv: 0.705 },
    { btcHeld: 0.68, strikeBal: 5000, strikeLtv: 0.130, paydown: 1200, income: 2300, btcBought: 0.020, expensesActual: 4500, cbBal: 95_600, cbLtv: 0.710 },
    { btcHeld: 0.72, strikeBal: 5200, strikeLtv: 0.120, paydown: 0,    income: 3500, btcBought: 0.030, expensesActual: 4500, cbBal: 96_000, cbLtv: 0.715 },
    { btcHeld: 0.76, strikeBal: 6000, strikeLtv: 0.125, paydown: 900,  income: 2600, btcBought: 0.022, expensesActual: 4500, cbBal: 96_500, cbLtv: 0.720 },
    { btcHeld: 0.80, strikeBal: 6500, strikeLtv: 0.115, paydown: 0,    income: 3500, btcBought: 0.030, expensesActual: 4500, cbBal: 97_500, cbLtv: 0.710 },
    { btcHeld: 0.84, strikeBal: 8000, strikeLtv: 0.100, paydown: 0,    income: 3500, btcBought: 0.028, expensesActual: 4500, cbBal: 98_500, cbLtv: 0.715 },
  ];
  const monthlyLog: MonthlyLogEntry[] = rows.map((r, i) => {
    const month = i + 1;
    const d = addMonths(startDate, i);
    return {
      month,
      date: toLocalISO(d),
      loggedAt: d.getTime(),
      source: 'manual',
      confirmed: true,
      ...r,
    };
  });

  const monthStartBalance = rows[rows.length - 1].strikeBal; // start-of-Month-8 base = month-7 ending strikeBal

  // ── Current-month (Month 8) dayLog — a draw, a buy, and a balanceReading whose reading.strikeCollateral anchors
  //    getCurrentBtcHeld() to currentStrikeCollateral (v20 Collateral-Truth). The reading also carries the CB
  //    figures (hasCbLoan) so the derived cbCollateral clock lands on 1.2.
  const t = today.getTime();
  const dayLog: DayEvent[] = [
    { id: 'demo-buy-1', date: toLocalISO(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 5)), ts: t - 5 * 86_400_000, kind: 'buy', amount: 0.012, usd: 1_380 },
    { id: 'demo-draw-1', date: toLocalISO(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2)), ts: t - 2 * 86_400_000, kind: 'draw', amount: 1_200 },
    {
      id: 'demo-reading-1', date: todayISO, ts: t, kind: 'balanceReading',
      reading: {
        strikeBal: advisorActualBlocBalance,
        strikeLtv: advisorActualBlocBalance / (currentStrikeCollateral * DEMO_BTC_PRICE), // 0.0870
        strikeCollateral: currentStrikeCollateral,
        cbBal: cbLoanBalance,
        cbLtv: cbLoanBalance / (cbCollateralBtc * DEMO_BTC_PRICE), // 0.717
        cbCollateral: cbCollateralBtc,
        cbLiqPrice: cbLiquidationPrice,
        price: DEMO_BTC_PRICE,
      },
    },
  ];

  return {
    // Plan basics
    income: 8000,
    expenses: 4500,
    creditLine: 25000,
    blocApr: 12,
    btcPrice: DEMO_BTC_PRICE,
    btcPriceMode: 'manual', // deterministic showcase — no live overwrite

    // View
    simpleMode: true,
    simpleView: 'dashboard',
    onboardingComplete: true,

    // Coinbase loan (ltvTriggered)
    hasCbLoan: true,
    cbLoanBalance,
    cbCollateralBtc,
    cbAprPct: 4.77,
    cbLiquidationPrice,
    cbPaymentStrategy: 'ltvTriggered',
    cbLtvTriggerPct: 75,
    cbLtvTargetPct: 65,
    cbRotateBackPct: 55,
    cbLoanBalanceAsOf: anchorAsOf,
    cbLiquidationPriceAsOf: anchorAsOf,
    strikeLiquidationLtvPct: 85,

    // Advisor / live position (§5b reading→anchor runs only in dayLog mutators, NOT on hydrate → seed these directly)
    advisorStartDate,
    advisorActualBlocBalance,
    advisorActualBlocBalanceAsOf: asOf,
    advisorMonthStartBalance: monthStartBalance,
    advisorActualBtcHeld: baselineBtcHeld,
    strikeCollateralBtc: currentStrikeCollateral, // onRehydrate re-derives from the reading anyway (belt-and-braces)

    // Records
    monthlyLog,
    dayLog,

    // ⚠ Block the one-shot calendar-bucket reconcile from running against the synthetic state (it would otherwise
    //    fire on first boot and, combined with a 'daily' source, delete the seeded history).
    monthBucketReconcileDone: true,
  };
}

// ── Side-effect: seed on every load. Gated on VITE_DEMO — dead-code-eliminated on the owner build. ──────────────
if (import.meta.env.VITE_DEMO === '1') {
  try {
    localStorage.setItem('personal-bloc-onboarded', '1');
    // A stale prior state must never leak into the sandbox. Remove the identity GATE keys + writer key material +
    // the at-rest enc flag (which would route the plaintext seed blob through the encrypted adapter, whose setItem
    // silently drops writes while locked → session edits would stop persisting).
    for (const k of [
      'personal-bloc-nostr-pubkey', 'personal-bloc-nostr-auth', 'personal-bloc-nostr-method',
      'personal-bloc-provenance', 'personal-bloc-writer-key-wrapped', 'personal-bloc-writer-key-meta',
      'personal-bloc-store-enc-enabled',
    ]) localStorage.removeItem(k);
    localStorage.setItem('personal-bloc-store', JSON.stringify({ state: buildDemoSeedState(new Date()), version: DEMO_SEED_STORE_VERSION }));
  } catch { /* noop — private-mode / storage disabled */ }
}
