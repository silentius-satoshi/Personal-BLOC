import { useStore } from '../../store/useStore';
import { getNdpStatus, type NdpInfo } from '../../simulation/runAdvisor';
import { accruedCbBalance } from '../../simulation/cbMetrics';
import { plBandsAt } from '../../simulation/powerLaw';
import { crashPlaybook } from '../../simulation/crashPlaybook';
import {
  playbookInputFromLive, monthPlaybookLine, isCrashDay, strikeDepositOf, type MonthPlaybookLine,
} from '../Tools/crashPlaybookView';
import { planNdpBalance, planNdpEstimateUsd } from '../Almanac/planMonthView';
import { usePlanMonth, type PlanMonth } from '../Almanac/usePlanMonth';
import { todayLocalISO } from '../../utils/format';

export interface PlanCardInputs {
  /** The plan of record's run — the card's, the month log's and the overlay's ONE run on this screen. */
  pm: PlanMonth;
  /** The Emergency Console's line when today is a crash day (D13); null otherwise. */
  crashLine: MonthPlaybookLine | null;
  ndp: NdpInfo;
  /** The NDP estimate, to the cent (BL19) — the engine's own estimate is a whole dollar, for full mode's sidebar. */
  ndpEstimate: number;
  /** The annual non-draw payment applies only while minimums roll into the line. */
  ndpActionActive: boolean;
}

/**
 * Everything the plan of record's card needs besides the strategy month (Run 3): the two screens that show it — THIS
 * MONTH and the full-mode Advisor tab — call this ONCE each, so the card, the month log and its overlay read one run
 * (one fetch of the plan's price history), and the two screens can never gather the card's inputs differently.
 *
 * The crash line builds through the Emergency Console's one builder (`playbookInputFromLive`), on the LIVE figures —
 * the crash gate keeps the console's own inputs behind the loan switch, never the plan's (D13).
 */
export function usePlanCardInputs(): PlanCardInputs {
  const pm = usePlanMonth();
  const btcPrice   = useStore((s) => s.btcPrice);
  const blocApr    = useStore((s) => s.blocApr);
  const creditLine = useStore((s) => s.creditLine);

  const cbLoanBalance      = useStore((s) => s.cbLoanBalance);
  const cbLoanBalanceAsOf  = useStore((s) => s.cbLoanBalanceAsOf);
  const cbAprPct           = useStore((s) => s.cbAprPct);
  const cbCollateralBtc    = useStore((s) => s.cbCollateralBtc);
  const cbLtvTriggerPct    = useStore((s) => s.cbLtvTriggerPct);
  const cbLtvTargetPct     = useStore((s) => s.cbLtvTargetPct);
  const planCbStopAtSupportPct = useStore((s) => s.policyCbStopAtSupportPct);   // the plan of record's Coinbase limit (Run 1)

  const advisorActualBlocBalance = useStore((s) => s.advisorActualBlocBalance);
  const currentBtcHeld           = useStore((s) => s.getCurrentBtcHeld());   // reading-anchored current Strike collateral (v20)
  const ndpLastPaidDate          = useStore((s) => s.ndpLastPaidDate);
  const strikeDeposit            = useStore((s) => strikeDepositOf(s));   // Strike's 60-day hold's one fact (D9)
  const coldBtc                  = useStore((s) => s.getCurrentColdBtc());   // the live cold total — the crash playbook's first source
  const hasCbLoan                = useStore((s) => s.hasCbLoan);
  const blocMinPaymentSource     = useStore((s) => s.blocMinPaymentSource);
  const effectiveCbBalance       = hasCbLoan ? accruedCbBalance(cbLoanBalance, cbAprPct, cbLoanBalanceAsOf) : 0;

  const ndpBalance  = planNdpBalance(advisorActualBlocBalance, creditLine);
  const ndp         = getNdpStatus(ndpLastPaidDate, ndpBalance, blocApr);
  const ndpEstimate = planNdpEstimateUsd(ndpBalance, blocApr);

  // D13 — a crash day (Coinbase at or past the trigger at today's price): the card's status carries the Emergency
  // Console's own line, built through crashPlaybookView's one builder (the console's inputs).
  const cbTriggered = isCrashDay({
    hasCbLoan, cbDebt: effectiveCbBalance, cbCollateralBtc,
    price: btcPrice, triggerPct: cbLtvTriggerPct,
  });
  const today = todayLocalISO();
  const playbookInput = playbookInputFromLive({
    price: btcPrice, support: plBandsAt(new Date(today)).floor, cbDebt: effectiveCbBalance, cbCollateralBtc,
    strikeBalance: advisorActualBlocBalance, strikeCollateralBtc: currentBtcHeld, creditLine, coldBtc,
    cbLtvTargetPct, planCbStopAtSupportPct, strikeDepositISO: strikeDeposit, todayISO: today,
  });
  const playbookLine = cbTriggered ? monthPlaybookLine(crashPlaybook(playbookInput), playbookInput) : null;

  // NDP re-scope (Simple Mode Corrections A): the annual non-draw payment only applies while minimums
  // are ROLLED into the line. In income mode every month's external minimum IS a non-draw payment, so
  // the annual clause disappears entirely.
  const ndpActionActive = blocMinPaymentSource === 'roll' && ndp.status !== 'ok';

  return { pm, crashLine: playbookLine, ndp, ndpEstimate, ndpActionActive };
}
