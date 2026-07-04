import { useStore } from '../../store/useStore';
import { EmergencyConsole } from './EmergencyConsole';
import { LiqSimulator } from './LiqSimulator';

/**
 * The ONE mode-gate definition (Emergency vs Liq Sim) — shared by the `liqsim` tab (AppShell) and the
 * Almanac's gated defense face, so the two mount points can never disagree.
 */
export function CbDefenseTool() {
  const cbPaymentStrategy = useStore((s) => s.cbPaymentStrategy);
  return cbPaymentStrategy === 'ltvTriggered' ? <EmergencyConsole /> : <LiqSimulator />;
}
