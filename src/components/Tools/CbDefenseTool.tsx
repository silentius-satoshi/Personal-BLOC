import { useStore } from '../../store/useStore';
import { EmergencyConsole } from './EmergencyConsole';

/**
 * The ONE gate for the Emergency Console — shared by the `liqsim` tab (AppShell) and the Almanac's gated defense face, so
 * the two mount points can never disagree. D3 (the plan of record's Run 4): the console runs whenever a Coinbase loan is
 * switched on — no longer only under the LTV-triggered strategy, which retired with its last reader. The Liq Sim it
 * showed otherwise had no other screen and went with it. Both mount points already show only with a loan; with none (the
 * store's seed figures, never the owner's), nothing.
 */
export function CbDefenseTool() {
  const hasCbLoan = useStore((s) => s.hasCbLoan);
  return hasCbLoan ? <EmergencyConsole /> : null;
}
