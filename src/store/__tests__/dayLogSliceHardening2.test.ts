import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../useStore';
import type { DayEvent } from '../../simulation/types';

/**
 * Hardening 2 — dayLogSlice.ts's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HY.json).
 * The real store, signed out (no publish), as dailyModeStore.test.ts drives it. Round synthetic figures.
 */
beforeEach(() => {
  useStore.setState({
    monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {}, recordsDirty: false,
    isAuthenticated: false, nostrSigner: null, nostrPubkey: '',
    hasCbLoan: true, cbLoanBalance: 10_000, cbLoanBalanceAsOf: null, cbAprPct: 0, cbCollateralBtc: 1, btcPrice: 100_000,
    cbLtvTriggerPct: 75,
  } as never);
});
const lastReading = () => {
  const log = useStore.getState().dayLog;
  return (log[log.length - 1] as Extract<DayEvent, { kind: 'balanceReading' }>).reading;
};

describe('Hardening 2 — dayLogSlice', () => {
  it('HY-16 · general.md "`cbLiquidationPrice` — 0 = not set" — a Coinbase re-anchor with no liquidation price set stamps none on the reading', () => {
    useStore.setState({ cbLiquidationPrice: 0 } as never);
    useStore.getState().emitBalanceReading({ cbBal: 10_000 });
    expect('cbLiqPrice' in lastReading(), 'HY-16 the not-set sentinel is no price').toBe(false);
    // Premise — a price that IS set rides the reading.
    useStore.setState({ cbLiquidationPrice: 60_000 } as never);
    useStore.getState().emitBalanceReading({ cbBal: 10_000 });
    expect(lastReading().cbLiqPrice, 'HY-16 premise: a set price is stamped').toBe(60_000);
  });
});
