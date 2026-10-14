// Pure display helpers for the Daily Mode view (P4a, read-only). Standalone — NO store/UI/price
// dependency (the only imports are the pure bucketEventToMonth helper, the DayEvent type, and the
// pure fmtUSDCents formatter). Any USD-from-spot-price estimate stays in the component.
import { bucketEventToMonth, flowVenue } from '../../simulation/logUtils';
import { fmtUSDCents } from '../../utils/format';
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
const TARGET_LABEL: Record<'strike' | 'cb' | 'cold', string> = { strike: 'Strike', cb: 'Coinbase', cold: 'cold storage' };

/**
 * Map a DayEvent to a read-only display descriptor (icon · label · detail). PURE — covers all 7 kinds:
 *  - flows: draw / buy (shows usd when present) / paydown
 *  - collateral moves: deposit / withdraw (with target)
 *  - readings: balanceReading (Strike always, CB when present) / cbCollateralReading
 * Every dollar figure shows its cents (plan of record Run 2.1, BL19): a draw, a borrow and its fee, a paydown, Strike's
 * minimum, a reading's balances and a buy's "~$X".
 */
export function describeDayEvent(ev: DayEvent): DayEventDescriptor {
  switch (ev.kind) {
    case 'draw':
      // Venue-first, like "Deposit to Coinbase". A Strike row keeps its label (pinned); since Run 2.1 its amount shows cents.
      if (flowVenue(ev) === 'cb') {
        return { icon: '↓', label: 'Coinbase borrow', detail: ev.fee && ev.fee > 0 ? `${fmtUSDCents(ev.amount)} · fee ${fmtUSDCents(ev.fee)}` : fmtUSDCents(ev.amount) };
      }
      return { icon: '↓', label: 'Credit-line draw', detail: fmtUSDCents(ev.amount) };
    case 'buy':
      return {
        icon: '₿',
        label: 'Bought Bitcoin',
        detail: ev.usd !== undefined ? `${btc(ev.amount)} (~${fmtUSDCents(ev.usd)})` : btc(ev.amount),
      };
    case 'paydown':
      if (flowVenue(ev) === 'cb') return { icon: '↘', label: 'Coinbase paydown', detail: fmtUSDCents(ev.amount) };
      return { icon: '↘', label: 'BLOC paydown', detail: fmtUSDCents(ev.amount) };
    case 'minPayment':
      return { icon: '◇', label: 'Strike minimum', detail: fmtUSDCents(ev.amount) };
    case 'deposit':
      return { icon: '+', label: `Deposit to ${TARGET_LABEL[ev.target]}`, detail: btc(ev.amount) };
    case 'withdraw':
      return { icon: '−', label: `Withdraw from ${TARGET_LABEL[ev.target]}`, detail: btc(ev.amount) };
    case 'cbCollateralReading':
      return { icon: '◈', label: 'CB collateral reading', detail: btc(ev.cbCollateral) };
    case 'balanceReading': {
      const r = ev.reading;
      let detail = `Strike ${fmtUSDCents(r.strikeBal)} (${pct(r.strikeLtv)} LTV)`;
      if (r.cbBal !== undefined) {
        detail += ` · CB ${fmtUSDCents(r.cbBal)}${r.cbLtv !== undefined ? ` (${pct(r.cbLtv)} LTV)` : ''}`;
      }
      return { icon: '◉', label: 'Balance reading', detail };
    }
  }
}
