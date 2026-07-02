// Pure display helpers for the Daily Mode view (P4a, read-only). Standalone — NO store/UI/price
// dependency (the only imports are the pure bucketEventToMonth helper, the DayEvent type, and the
// pure fmtUSD formatter). Any USD-from-spot-price estimate stays in the component.
import { bucketEventToMonth } from '../../simulation/logUtils';
import { fmtUSD } from '../../utils/format';
import type { DayEvent } from '../../simulation/types';

/**
 * The day events that fall in a given strategy month, oldest→newest (chronological within the month).
 * Filters via bucketEventToMonth(ev.date, advisorStartDate) — the same date→month bucketing rollupMonth uses.
 */
export function selectMonthEvents(
  dayLog: DayEvent[],
  month: number,
  advisorStartDate: string,
): DayEvent[] {
  return dayLog
    .filter((ev) => bucketEventToMonth(ev.date, advisorStartDate) === month)
    .sort((a, b) => a.ts - b.ts);
}

export interface DayEventDescriptor {
  icon:   string;
  label:  string;
  detail: string;
}

// BTC amount → trimmed string (strip trailing zeros, sats-level precision). parseFloat drops the zeros.
const btc = (n: number) => `₿ ${parseFloat(n.toFixed(8))}`;
const pct = (frac: number) => `${(frac * 100).toFixed(1)}%`;
const TARGET_LABEL: Record<'strike' | 'cb', string> = { strike: 'Strike', cb: 'Coinbase' };

/**
 * Map a DayEvent to a read-only display descriptor (icon · label · detail). PURE — covers all 7 kinds:
 *  - flows: draw / buy (shows usd when present) / paydown
 *  - collateral moves: deposit / withdraw (with target)
 *  - readings: balanceReading (Strike always, CB when present) / cbCollateralReading
 */
export function describeDayEvent(ev: DayEvent): DayEventDescriptor {
  switch (ev.kind) {
    case 'draw':
      return { icon: '↓', label: 'Credit-line draw', detail: fmtUSD(ev.amount) };
    case 'buy':
      return {
        icon: '₿',
        label: 'Bought Bitcoin',
        detail: ev.usd !== undefined ? `${btc(ev.amount)} (~${fmtUSD(ev.usd)})` : btc(ev.amount),
      };
    case 'paydown':
      return { icon: '↘', label: 'BLOC paydown', detail: fmtUSD(ev.amount) };
    case 'minPayment':
      return { icon: '◇', label: 'Strike minimum', detail: fmtUSD(ev.amount) };
    case 'deposit':
      return { icon: '+', label: `Deposit to ${TARGET_LABEL[ev.target]}`, detail: btc(ev.amount) };
    case 'withdraw':
      return { icon: '−', label: `Withdraw from ${TARGET_LABEL[ev.target]}`, detail: btc(ev.amount) };
    case 'cbCollateralReading':
      return { icon: '◈', label: 'CB collateral reading', detail: btc(ev.cbCollateral) };
    case 'balanceReading': {
      const r = ev.reading;
      let detail = `Strike ${fmtUSD(r.strikeBal)} (${pct(r.strikeLtv)} LTV)`;
      if (r.cbBal !== undefined) {
        detail += ` · CB ${fmtUSD(r.cbBal)}${r.cbLtv !== undefined ? ` (${pct(r.cbLtv)} LTV)` : ''}`;
      }
      return { icon: '◉', label: 'Balance reading', detail };
    }
  }
}
