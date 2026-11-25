import { fmtLtvPct, fmtUSD, shownUsd } from '../../utils/format';
import { CB_MOVE_BRINGS_WITHIN, cbAtSupportLine, type CbAtSupport, type SafetyLevel } from '../../simulation/safetyView';
import type { CycleLegView } from '../Almanac/cycleClockView';

/**
 * The Engine · Micro (BL61, step 1) — every word the face and its canvas show, in ONE pure module (the house rule: a
 * component composes no sentence). It takes plain figures — the scene's, which are the Dashboard's and THIS MONTH's — and
 * returns strings. No store, no clock, no DOM.
 *
 * Its words are the Dashboard's where the Dashboard has them: "Liquidation", the Coinbase bar's level words (Safe · Fair ·
 * Poor) and its at-support line (`cbAtSupportLine`, the same function, with this month's move's clause as the owner's
 * Dashboard adds it — v1.4). The room to Coinbase's liquidation price is the
 * owner's prototype's "buffer", one decimal rounded down (BL64) — the Dashboard's "drop" follows after step 1. Dollars print whole, as on every Almanac face (`fmtUSD`); a loan level prints through `fmtLtvPct`.
 */

/** The Dashboard's Coinbase badge words (`SafetyDashboard.tsx`'s `cbBadge`). */
export const LEVEL_WORD: Record<SafetyLevel, string> = { safe: 'Safe', watch: 'Fair', act: 'Poor' };

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A turn's date as the Cycle Clock prints it — "5 Oct 2026" (UTC; a fixed month table, never the device's locale). */
export function turnDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** A coin amount in a card or the headline: three decimals, two from ₿10. */
export function btcText(btc: number): string {
  return `₿${Number.isFinite(btc) ? btc.toFixed(Math.abs(btc) >= 10 ? 2 : 3) : '—'}`;
}

/** A coin amount on the canvas, as the prototypes print it: two decimals. */
export function btc2(btc: number): string {
  return `₿${Number.isFinite(btc) ? btc.toFixed(2) : '—'}`;
}

/** A dollar figure where the canvas has little room, as the prototypes print it (their `usdK`): whole dollars under
 *  $10,000, then "$50.0K" to $100,000, "$150K" to a million, then "$1.25M" ("$12.5M" from ten million). */
export function usdK(n: number): string {
  const a = Math.abs(n);
  if (!Number.isFinite(a)) return '—';
  const sign = n < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e5) return `${sign}$${Math.round(a / 1e3)}K`;
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}${fmtUSD(a)}`;
}

/** The buffer to Coinbase's liquidation price as the owner's prototype writes it (BL64): one decimal, rounded DOWN, so it
 *  never shows more room than there is ("41.8%", where the Dashboard's whole percent says "42%"). */
export function bufferPctText(drop: number): string {
  return Number.isFinite(drop) ? `${(Math.floor(Math.max(0, drop) * 1000 + 1e-9) / 10).toFixed(1)}%` : '—';
}

/** The live feed's state, as the motor's lamp and the tape show it. */
export type FeedState = 'live' | 'stale' | 'manual' | 'off';

/** The tape's title, by the prototype's rule: how much it shows, and whether it is live. `narrow` is a tape under 330 px. */
export function tapeTitle(feed: FeedState, minutes: number, agoMin: number, narrow: boolean): string {
  if (feed === 'stale') return `Last price ${Math.max(1, agoMin)} min ago`;
  const live = feed === 'live';
  if (minutes < 2) return live ? (narrow ? 'Live' : 'Price · live') : 'Price';
  return narrow ? `Last ${minutes} min` : `Price · ${live ? 'live, ' : ''}last ${minutes} minutes`;
}

/** The tape's foot while Coinbase's liquidation price is under its window, as wide as the tape allows. */
export function liqFooter(tapeW: number, liqText: string, bufferText: string): string {
  if (tapeW > 300) return `Liquidation price ${liqText} · ${bufferText} below ↓`;
  if (tapeW > 190) return `Liquidation ${liqText} · ${bufferText} below ↓`;
  if (tapeW > 150) return `${liqText} · ${bufferText} below ↓`;
  return `${liqText} ↓`;
}

/** What a live tick moved the price by, floating off the tape's pen ("+$21", "−$7"). */
export function tickDelta(by: number): string {
  return `${by > 0 ? '+' : '−'}${fmtUSD(Math.abs(by))}`;
}

/** The tape's dollars — its scale's two levels: whole, the app's one format (`fmtUSD`), never the drawing's own (v1.4). */
export function tapePriceText(price: number): string {
  return fmtUSD(price);
}

/** The chart's readout, in the Dashboard chart's words (`PriceChart`'s tooltip, the owner's ask of 2026-11-25): its
 *  clock — `toLocaleTimeString('en-US')`, the device's time, as there — to the second, because the tape holds a price a
 *  second ("8:34:12 AM"); and its price, named as there ("BTC : $100,011"), in the Almanac's whole dollars. */
export function readoutTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}
export function readoutPrice(price: number): string {
  return `BTC : ${fmtUSD(price)}`;
}

/** What a change of the loan moved Coinbase's liquidation price by, in its tag for a moment ("▼ $1,240"). */
export function liqShift(by: number): string {
  const a = Math.abs(by);
  return `${by < 0 ? '▼' : '▲'} ${a >= 1e4 ? usdK(a) : fmtUSD(a)}`;
}

/** The month's two flows, as the scene hands them over: THIS MONTH's run (the plan of record's month 1) and the CB Loan
 *  tab's monthly interest. */
export interface FlowFigures {
  /** Coinbase's interest a month at today's balance — the CB Loan tab's "Monthly interest". 0 with no Coinbase loan. */
  cbInterestUsd: number;
  /** Strike's interest this month — THIS MONTH's figure (`strikeInterestUsd`, its estimate of Strike's minimum). */
  strikeInterestUsd: number;
  /** Drawn on Strike for the bills this month (`strikeDrawn`). */
  drawnUsd: number;
  /** Coinbase's fee on this month's refinance (`refinancedFeeUsd`): new debt, so it is in — the move itself isn't (v1.4). */
  feeUsd: number;
  /** Repaid from spare income this month, on both loans (`strikeRepaidUsd + cbRepaidUsd`). */
  repaidUsd: number;
  /** Strike's minimum paid from income this month (`strikeMinPaidUsd`). */
  minPaidUsd: number;
  /** The cash reserve's cure of a Strike call this month (`cashToCureUsd`). */
  cureUsd: number;
  /** In: the interest, the draw and a refinance's fee. Out: the repayments, the minimum and the cure. */
  inUsd: number;
  outUsd: number;
}

/** Everything the canvas writes that the scene settles at rest, from its figures — the prototypes' words, their
 *  "buffer" among them (BL64). */
export interface EngineLabels {
  priceTitle: string;
  priceText: string;
  /** Over the price's tag while a price is tried: a tap goes back to today's. */
  backHint: string;
  /** Over the price's tag until the piston has been dragged. */
  dragHint: string;
  liqTitle: string;
  liqText: string;
  bufferText: string;
  bufferWord: string;
  gaugeText: string;
  gaugeLiqMark: string;
  cbName: string;
  cbCoins: string;
  cbOwe: string;
  skName: string;
  skCoins: string;
  skOwe: string;
  /** Coinbase would sell: the banner's two lines; null while it wouldn't. */
  bannerTitle: string | null;
  bannerCoins: string | null;
  inTitle: string;
  inText: string;
  outTitle: string;
  outText: string;
  motorName: string;
  wheelTop: string;
}

export interface LabelFigures {
  price: number;
  tried: boolean;
  hasCbLoan: boolean;
  cbCoins: number;
  cbDebt: number;
  cbLiq: number;
  cbLtv: number;
  cbLevel: SafetyLevel;
  cbLiqFrac: number;
  skCoins: number;
  skDebt: number;
  drop: number | null;
  sells: boolean;
  atSupportOver: boolean;
  flows: FlowFigures | null;
  feed: FeedState;
  /** What Coinbase would sell at the price drawn, at most (the CB Loan tab's liquidation math, its full-repayment case);
   *  null while it wouldn't. */
  sellBtc: number | null;
}

/** A price on the canvas: whole dollars, "$1.25M" from a million (the prototypes' tags). */
const tagUsd = (n: number): string => (Math.abs(n) >= 1e6 ? usdK(n) : fmtUSD(n));

export function engineLabels(f: LabelFigures): EngineLabels {
  const cbOwes = f.hasCbLoan && shownUsd(f.cbDebt);
  const draws = f.flows !== null && shownUsd(f.flows.drawnUsd);
  const fee = f.flows !== null && shownUsd(f.flows.feeUsd);
  return {
    priceTitle: f.tried ? 'Test price' : 'Price',
    priceText: tagUsd(f.price),
    backHint: '↺ back to live',
    dragHint: '↕ drag',
    liqTitle: 'Liquidation',
    liqText: tagUsd(f.cbLiq),
    bufferText: f.drop === null ? '—' : bufferPctText(f.drop),
    bufferWord: 'buffer',
    gaugeText: f.hasCbLoan ? fmtLtvPct(f.cbLtv, 0) : '—',
    gaugeLiqMark: (f.cbLiqFrac * 100).toFixed(0),
    cbName: 'Coinbase',
    cbCoins: btc2(f.cbCoins),
    cbOwe: cbOwes ? `owe ${usdK(f.cbDebt)}` : 'no loan',
    skName: 'Strike',
    skCoins: btc2(f.skCoins),
    skOwe: shownUsd(f.skDebt) ? `owe ${usdK(f.skDebt)}` : 'paid',
    bannerTitle: f.sells ? 'Coinbase would sell' : null,
    bannerCoins: f.sells && f.sellBtc !== null ? `up to ${btc2(f.sellBtc)}` : null,
    inTitle: draws ? 'INTEREST AND DRAWS IN' : fee ? 'INTEREST AND A FEE IN' : 'INTEREST DRIPS IN',
    inText: f.flows === null ? '—' : `+${fmtUSD(f.flows.inUsd)} a month`,
    outTitle: 'PAYMENTS FLOW OUT',
    outText: f.flows === null ? '—' : `${shownUsd(f.flows.outUsd) ? '−' : ''}${fmtUSD(f.flows.outUsd)} a month`,
    motorName: 'Price motor',
    wheelTop: 'Top',
  };
}

/** The line over the canvas: where bitcoin stands against Coinbase's liquidation price — the prototype's buffer (BL64). */
export function engineHeadline(f: Pick<LabelFigures, 'hasCbLoan' | 'cbDebt' | 'cbLiq' | 'drop' | 'sells' | 'tried' | 'skCoins'>): string {
  if (!f.hasCbLoan || !shownUsd(f.cbDebt) || !(f.cbLiq > 0) || f.drop === null) {
    if (!f.hasCbLoan) return `No Coinbase loan — Strike holds ${btcText(f.skCoins)}.`;
    return shownUsd(f.cbDebt) ? noCoinsWords(f.cbDebt) : 'Coinbase: nothing owed, so nothing to sell.';
  }
  const at = f.tried ? 'At this price' : 'Today';
  if (f.sells) return `${at}, bitcoin is at or under Coinbase's liquidation price (${fmtUSD(f.cbLiq)}).`;
  return `${at}: a ${bufferPctText(f.drop)} buffer to Coinbase's liquidation price (${fmtUSD(f.cbLiq)}).`;
}

/** A Coinbase debt with no coins held against it — its loan level is infinite and it has no liquidation price (v1.4). */
function noCoinsWords(debt: number): string {
  return `Coinbase: ${fmtUSD(debt)} owed, with no coins held against it.`;
}

/** The owner's Dashboard's at-support line (`ownerAtSupportLine`), in the Almanac's whole dollars: `cbAtSupportLine`, and
 *  — while Coinbase is over and this month's move brings it within — the move's clause (v1.4). */
export function atSupportText(r: CbAtSupport, moveBringsCbWithin: boolean): string {
  return cbAtSupportLine(r, fmtUSD) + (r.over && moveBringsCbWithin ? CB_MOVE_BRINGS_WITHIN : '');
}

/** The at-support line, under the headline while Coinbase is over the plan's limit at support (`atSupportText`); null
 *  within it, or with no reading. */
export function atSupportNote(f: Pick<CardFigures, 'cbAtSupport' | 'moveBringsCbWithin'>): string | null {
  return f.cbAtSupport !== null && f.cbAtSupport.over ? atSupportText(f.cbAtSupport, f.moveBringsCbWithin) : null;
}

/** The face's subtitle. */
export const ENGINE_FRAMING = 'Your two loans as an engine, right now: the price drives the piston, and the red line is where '
  + 'Coinbase sells. Drag the piston to try a price; tap a part to read it.';

/** The note under the canvas while a price is tried. */
export const TRIED_NOTE = "A price you're trying: nothing is saved, and the plan doesn't change.";

/** The live price card's way to read the tape, as the Dashboard's chart reads (the owner's ask of 2026-11-25). */
export const TAPE_READ_NOTE = 'Slide a finger along the tape, or point at it, to read its price at any moment.';

/** A part's card's way out, for a screen reader. */
export const CARD_CLOSE = 'Close';

/** The try row's buttons. */
export const TRY_DOWN = '−10%';
export const TRY_UP = '+10%';
export const TRY_BACK = "Back to today's price";

/** The parts a tap (or a button) can open, in the row's order. */
export type EnginePart = 'price' | 'sale' | 'coinbase' | 'strike' | 'gauge' | 'cycle' | 'tape' | 'month';
export const PART_NAMES: Record<EnginePart, string> = {
  price: 'Price', sale: 'Liquidation', coinbase: 'Coinbase', strike: 'Strike', gauge: 'Loan level', cycle: 'Cycle',
  tape: 'Live price', month: 'This month',
};
export const PART_ORDER: readonly EnginePart[] = ['price', 'sale', 'coinbase', 'strike', 'gauge', 'cycle', 'tape', 'month'];

/** A part's card: its title and its lines. */
export interface PartCard { title: string; lines: string[] }

export interface CardFigures extends LabelFigures {
  realPrice: number;
  cbAprPct: number;
  skLtv: number;
  skLevel: SafetyLevel;
  skLiq: number;
  strikeLiqLtvPct: number;
  cbLtvTriggerPct: number;
  cbActAt: number;
  cbAtSupport: CbAtSupport | null;
  /** This month's move brings Coinbase within its limit at support (THIS MONTH's `planMoveBringsCbWithin`, as the owner's
   *  Dashboard is told it): the at-support line says so (v1.4). */
  moveBringsCbWithin: boolean;
  leg: CycleLegView | null;
}

/** A part's card, in words. */
export function partCard(part: EnginePart, f: CardFigures): PartCard {
  switch (part) {
    case 'price':
      return {
        title: f.tried ? `Test price ${fmtUSD(f.price)}` : `Bitcoin ${fmtUSD(f.price)}`,
        lines: f.tried
          ? [`Today's price is ${fmtUSD(f.realPrice)}. The piston, the loan levels, the buffer and the gauge follow the price you're trying; the month's two pipes stay the plan's, at today's price.`, TRIED_NOTE]
          : [f.feed === 'manual'
            ? 'Your manual price — the one every screen reads while it is set.'
            : 'The price every screen reads, kept live while the app is open.',
          'Drag the piston, or use the buttons below, to try another price.'],
      };
    case 'sale': {
      if (!f.hasCbLoan || !shownUsd(f.cbDebt) || !(f.cbLiq > 0)) {
        return {
          title: 'Liquidation',
          lines: [!f.hasCbLoan ? 'No Coinbase loan, so there is no liquidation price.'
            : shownUsd(f.cbDebt) ? `${noCoinsWords(f.cbDebt).slice(0, -1)}, so there is no liquidation price.`
              : 'Coinbase: nothing owed, so there is no liquidation price.'],
        };
      }
      return {
        title: `Liquidation ${fmtUSD(f.cbLiq)}`,
        lines: [
          `If bitcoin falls to ${fmtUSD(f.cbLiq)}, Coinbase sells coins to repay its loan — at ${fmtLtvPct(f.cbLiqFrac, 0)} loan to value.`,
          f.drop === null ? '' : f.sells
            ? 'This price is at or under it.'
            : `The buffer to it is ${bufferPctText(f.drop)}: how far bitcoin would have to fall to reach it.`,
        ].filter((l) => l !== ''),
      };
    }
    case 'coinbase':
      return {
        title: 'Coinbase',
        lines: !f.hasCbLoan
          ? ['No Coinbase loan is switched on.']
          : [
            `${btcText(f.cbCoins)} held, ${fmtUSD(f.cbDebt)} owed, with interest to today.`,
            `Its loan level is ${fmtLtvPct(f.cbLtv)} — ${LEVEL_WORD[f.cbLevel]}, as on the Dashboard.`,
            ...(f.cbAtSupport !== null ? [atSupportText(f.cbAtSupport, f.moveBringsCbWithin) + '.'] : []),
          ],
      };
    case 'strike':
      return {
        title: 'Strike',
        lines: [
          `${btcText(f.skCoins)} held, ${fmtUSD(f.skDebt)} owed.`,
          shownUsd(f.skDebt) && f.skLiq > 0
            ? `Its loan level is ${fmtLtvPct(f.skLtv)} — ${LEVEL_WORD[f.skLevel]}; Strike sells at ${fmtLtvPct(f.strikeLiqLtvPct / 100, 0)}, if bitcoin falls to ${fmtUSD(f.skLiq)}.`
            : 'Nothing owed, so Strike has nothing to sell.',
        ],
      };
    case 'gauge':
      return {
        title: f.hasCbLoan ? `Loan level ${fmtLtvPct(f.cbLtv)}` : 'Loan level',
        lines: f.hasCbLoan
          ? [
            `Coinbase's loan against its coins at this price — ${LEVEL_WORD[f.cbLevel]}, the Dashboard's word.`,
            `Safe under your ${fmtLtvPct(f.cbLtvTriggerPct / 100, 0)} trigger, Fair to ${fmtLtvPct(f.cbActAt, 0)}, Poor from there; Coinbase sells at ${fmtLtvPct(f.cbLiqFrac, 0)}.`,
          ]
          : ['No Coinbase loan is switched on.'],
      };
    case 'cycle':
      return f.leg === null
        ? { title: 'The 4-year cycle', lines: ['Outside the Cycle Clock\'s projection.'] }
        : {
          title: `${f.leg.phase} ~${f.leg.pct}%`,
          lines: [
            `The wheel turns once every four years, as the Cycle Clock's cadence: ${f.leg.route}, from the ${turnDate(f.leg.prev.date)} ${f.leg.prev.word} toward the ${turnDate(f.leg.next.date)} ${f.leg.next.word}.`,
            'An idealized pattern, not a forecast; it moves no figure here.',
          ],
        };
    case 'tape':
      return {
        title: 'Live price',
        lines: [
          f.tried
            ? 'A price is being tried, so the motor rests; the tape still shows the market\'s last half hour.'
            : f.feed === 'manual'
              ? 'A manual price is set, so the motor rests; the tape still shows the market\'s last half hour.'
              : f.feed === 'live' ? 'The market\'s last half hour, price by price; the motor turns while the price is live, and each new price sparks down the wire.'
                : f.feed === 'stale' ? 'The live price hasn\'t updated for a while; the tape shows the last prices it has.'
                  : 'No live price yet; the tape fills in as prices arrive.',
          TAPE_READ_NOTE,
        ],
      };
    case 'month': {
      const fl = f.flows;
      if (fl === null) return { title: 'This month', lines: ['The plan\'s month isn\'t ready yet.'] };
      const ins = [
        f.hasCbLoan ? `Coinbase's interest ${fmtUSD(fl.cbInterestUsd)} (at today's balance)` : null,
        `Strike's interest ${fmtUSD(fl.strikeInterestUsd)}`,
        shownUsd(fl.drawnUsd) ? `${fmtUSD(fl.drawnUsd)} drawn for the bills` : null,
        shownUsd(fl.feeUsd) ? `Coinbase's fee on the refinance ${fmtUSD(fl.feeUsd)}` : null,
      ].filter((s): s is string => s !== null);
      const outs = [
        shownUsd(fl.repaidUsd) ? `${fmtUSD(fl.repaidUsd)} repaid from spare income` : null,
        shownUsd(fl.minPaidUsd) ? `Strike's minimum, ${fmtUSD(fl.minPaidUsd)}, paid from income` : null,
        shownUsd(fl.cureUsd) ? `${fmtUSD(fl.cureUsd)} from the cash reserve` : null,
      ].filter((s): s is string => s !== null);
      return {
        title: 'This month',
        lines: [
          `In: ${ins.join(', ')} — ${fmtUSD(fl.inUsd)}.`,
          outs.length > 0 ? `Out: ${outs.join(', ')} — ${fmtUSD(fl.outUsd)}.` : 'Out: nothing is repaid this month.',
          'The plan\'s month, as THIS MONTH shows it; moves between the two loans are left out, but a refinance\'s fee is new debt, so it is in.',
        ],
      };
    }
  }
}

/** What the canvas says to a screen reader. */
export function engineAria(f: LabelFigures): string {
  const parts = [`The Engine, ${f.tried ? 'at a price you are trying' : 'right now'}. Bitcoin ${fmtUSD(f.price)}.`];
  if (f.hasCbLoan && shownUsd(f.cbDebt) && f.cbLiq > 0 && f.drop !== null) {
    parts.push(f.sells
      ? `At or under Coinbase's liquidation price, ${fmtUSD(f.cbLiq)}.`
      : `Coinbase's liquidation price is ${fmtUSD(f.cbLiq)}, a ${bufferPctText(f.drop)} buffer.`);
    parts.push(`Coinbase's loan level ${fmtLtvPct(f.cbLtv)}, ${LEVEL_WORD[f.cbLevel]}.`);
  } else if (f.hasCbLoan && shownUsd(f.cbDebt)) parts.push(noCoinsWords(f.cbDebt));
  if (f.flows !== null) parts.push(`This month ${fmtUSD(f.flows.inUsd)} flows into the loans and ${fmtUSD(f.flows.outUsd)} is paid out.`);
  return parts.join(' ');
}
