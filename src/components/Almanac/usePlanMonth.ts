import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { accruedCbBalance } from '../../simulation/cbMetrics';
import { usePowerLawData } from '../../hooks/usePowerLawData';
import { strikeHoldAt, strikeDepositOf } from '../Tools/crashPlaybookView';
import { todayLocalISO } from '../../utils/format';
import { usePlanPolicy } from './usePlanPolicy';
import { DEFAULT_BREAKER_REARM_MONTHS } from './supportPolicyView';
import { breakerFromHistory, type BreakerSeed } from './supportPolicyInputs';
import {
  planMonthRun, firstMonthUnderLimit, planCbCollateralOf, planCbLoanBalanceOf, planBreakerCacheOf, type PlanMonthRun,
} from './planRun';
import { planBreakerSource, type PlanBreakerSource } from './planMonthView';

export interface PlanMonth {
  run: PlanMonthRun;
  todayISO: string;
  /** Where the run's breaker came from (invariant 10): today's fold, this device's cache, or nothing yet. */
  breaker: PlanBreakerSource;
  monthsBackUnder: number | null;
  coldBtc: number;
}

/**
 * The plan of record's month for the main screens (Run 2): the store's live position, the saved plan, today's price,
 * the policy's memory (Strike's hold from its one fact, `strikeDepositOf` — the journal, or a trusted viewer's copy;
 * the breaker from month-end prices — or this device's cache of it), run through the ONE builder the Decision face uses.
 *
 * 🔴 The Coinbase leg is the OWNER'S (D-R2-4): with no Coinbase loan switched on, the run starts with none — never the
 * store's seed figures. The ONLY write is the breaker cache (device-local, public price data); the plan is read-only.
 */
export function usePlanMonth(): PlanMonth {
  const s = useStore(useShallow((st) => ({
    btcPrice: st.btcPrice,
    income: st.income,
    expenses: st.expenses,
    blocApr: st.blocApr,
    cbAprPct: st.cbAprPct,
    creditLine: st.creditLine,
    strikeLiquidationLtvPct: st.strikeLiquidationLtvPct,
    strikeCollateralBtc: st.getCurrentBtcHeld(),
    strikeBalance: st.advisorActualBlocBalance,
    cbCollateralBtc: planCbCollateralOf(st),
    coldBtc: st.getCurrentColdBtc(),
    cbLoanBalance: planCbLoanBalanceOf(st),
    cbLoanBalanceAsOf: st.cbLoanBalanceAsOf,
    strikeDepositISO: strikeDepositOf(st),   // the hold's one fact — the journal's, or a trusted viewer's copy (D9)
    strikeMinFromIncome: st.blocMinPaymentSource === 'income',
    // D-R2-6 — read through the engine's own rule: a damaged cache is none (the stored object itself when valid, so the
    // selector stays stable), and the next fresh fold rewrites it.
    breakerCache: planBreakerCacheOf(st.planBreakerCache),
    setBreakerCache: st.setPlanBreakerCache,
  })));
  const plan = usePlanPolicy();
  // "Today" per render, not frozen at mount: an installed PWA resumes without remounting, and the start date, S₀, the
  // hold, the breaker fold and the Coinbase accrual all key on it. A string, so the memos below recompute once a day
  // (the Decision face freezes its own today for the stress lens; this screen has none).
  const todayISO = todayLocalISO();
  const startDate = useMemo(() => new Date(todayISO), [todayISO]);
  const { historical, loading } = usePowerLawData();
  const fresh = useMemo(
    () => breakerFromHistory(historical, startDate, DEFAULT_BREAKER_REARM_MONTHS ?? null),
    [historical, startDate],
  );
  // §4.3 — the main screen is offline-first: a fresh fold refreshes this device's cache; without one, the cache stands in.
  const { breakerCache, setBreakerCache } = s;
  useEffect(() => {
    if (fresh !== null && !sameSeed(fresh, breakerCache)) setBreakerCache({ state: { ...fresh.state }, lastMonthEndISO: fresh.lastMonthEndISO });
  }, [fresh, breakerCache, setBreakerCache]);
  const breaker = useMemo(() => planBreakerSource(fresh, breakerCache, loading), [fresh, breakerCache, loading]);
  const breakerSeed: BreakerSeed | null = breaker.kind === 'fresh' || breaker.kind === 'cached' ? breaker.seed : null;
  // D9 — the hold through its one rule, from its one fact (a trusted viewer has no journal: the snapshot's date).
  const hold = useMemo(() => strikeHoldAt(s.strikeDepositISO, todayISO), [s.strikeDepositISO, todayISO]);
  // The accrual reads the clock (`accruedCbBalance` reads Date.now()): `todayISO` keys it, so a screen left open
  // re-accrues once a day.
  const cbDebt = useMemo(
    () => accruedCbBalance(s.cbLoanBalance, s.cbAprPct, s.cbLoanBalanceAsOf),
    [s.cbLoanBalance, s.cbAprPct, s.cbLoanBalanceAsOf, todayISO],
  );
  const run = useMemo(() => planMonthRun({
    todayISO, price: s.btcPrice, plan,
    income: s.income, expenses: s.expenses, blocApr: s.blocApr, cbAprPct: s.cbAprPct, creditLine: s.creditLine,
    strikeBalance: s.strikeBalance, strikeCollateralBtc: s.strikeCollateralBtc,
    cbCollateralBtc: s.cbCollateralBtc, coldBtc: s.coldBtc, cbDebt,
    strikeLiquidationLtvPct: s.strikeLiquidationLtvPct, hold, breakerSeed,
    strikeMinFromIncome: s.strikeMinFromIncome,
  }), [todayISO, s, plan, cbDebt, hold, breakerSeed]);
  const monthsBackUnder = useMemo(() => firstMonthUnderLimit(run.sim), [run.sim]);
  return { run, todayISO, breaker, monthsBackUnder, coldBtc: s.coldBtc };
}

const sameSeed = (a: BreakerSeed, b: BreakerSeed | null): boolean => b !== null
  && a.lastMonthEndISO === b.lastMonthEndISO && a.state.broken === b.state.broken
  && a.state.monthsAtOrAbove === b.state.monthsAtOrAbove && a.state.monthsBelow === b.state.monthsBelow
  && a.state.brokenMonth === b.state.brokenMonth;
