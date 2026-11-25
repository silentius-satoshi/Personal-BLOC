import { describe, it, expect } from 'vitest';
import {
  CB_MOVE_BRINGS_WITHIN, cbAtSupportLine, deriveSafetyView, ownerAtSupportLine, type SafetyViewInputs,
} from '../../../simulation/safetyView';
import { CYCLE_TURNS, cycleLegAt } from '../../../simulation/cycleModel';
import { cycleLegView } from '../../Almanac/cycleClockView';
import { fmtUSD } from '../../../utils/format';
import { engineScene, type EngineFacts } from '../engineScene';
import {
  LEVEL_WORD, PART_NAMES, PART_ORDER, TAPE_READ_NOTE, TRIED_NOTE, atSupportNote, atSupportText, btc2, btcText, bufferPctText,
  engineAria, engineHeadline, liqFooter, liqShift, partCard, readoutPrice, readoutTime, tapePriceText, tapeTitle, tickDelta,
  turnDate, usdK,
} from '../engineView';

/**
 * ⚠ The Engine · Micro's words (BL61, step 1) — every sentence the face and its canvas show comes from `engineView`, in
 * the Dashboard's own words where it has them. Synthetic, round figures. Each assertion carries its tag.
 */
const INPUTS: SafetyViewInputs = {
  advisorActualBlocBalance: 10_000, creditLine: 25_000, currentBtcHeld: 0.5, btcPrice: 100_000,
  strikeLiquidationLtvPct: 85, hasCbLoan: true, cbLoanBalance: 50_000, cbAprPct: 10, cbLoanBalanceAsOf: null,
  cbCollateralBtc: 1, cbLtvTriggerPct: 75, cbLiquidationPrice: 0, cbLiquidationPriceAsOf: null,
  cbLimitAtSupport: 0.45, supportToday: 60_000,
};
const NOW = Date.UTC(2026, 10, 23);
const facts = (s: Partial<SafetyViewInputs> = {}, o: Partial<EngineFacts> = {}): EngineFacts => ({
  safety: { ...INPUTS, ...s },
  month: { strikeInterestUsd: 100, strikeDrawn: 3_000, strikeRepaidUsd: 200, cbRepaidUsd: 300, strikeMinPaidUsd: 40, cashToCureUsd: 0, refinancedFeeUsd: 0 },
  moveBringsCbWithin: false,
  cycle: { leg: cycleLegAt(NOW)!, view: cycleLegView(NOW)! },
  candles: [], feed: 'manual', livePrice: null, liveAt: null, ...o,
});

describe('⭐ the Dashboard\'s words', () => {
  it('⭐ WORDS — the level words and the at-support line, the Dashboard\'s own; the buffer, the prototype\'s (BL64)', () => {
    expect(LEVEL_WORD, 'WORDS the Coinbase badge\'s words').toEqual({ safe: 'Safe', watch: 'Fair', act: 'Poor' });
    expect([0.4186, 0.005, 0.995, 0, -0.2].map(bufferPctText), 'WORDS the buffer, one decimal').toEqual(['41.8%', '0.5%', '99.5%', '0.0%', '0.0%']);
    expect([0.41899, 0.4199999, 0.0999].map(bufferPctText), 'WORDS rounded down, as v3\'s pctDown1').toEqual(['41.8%', '41.9%', '9.9%']);
    for (let x = 0; x <= 1; x += 0.00137) expect(parseFloat(bufferPctText(x)), `WORDS never more room than there is (${x})`).toBeLessThanOrEqual(x * 100 + 1e-9);
    const sc = engineScene(facts(), 390, null);
    const v = deriveSafetyView(INPUTS);
    expect(atSupportNote(sc.card), 'WORDS the at-support line is cbAtSupportLine\'s').toBe(cbAtSupportLine(v.cbAtSupport!, fmtUSD));
    expect(atSupportNote(engineScene(facts({ supportToday: 200_000 }), 390, null).card), 'WORDS within: no line').toBe(null);
    // this month's move's clause, as the owner's Dashboard says it (`ownerAtSupportLine`) — v1.4. Mutation: never → red
    const r = v.cbAtSupport!;
    expect(ownerAtSupportLine({ ...r, over: true }, true), 'WORDS premise: the Dashboard says the clause').toMatch(/; this month's move brings it within$/);
    for (const over of [true, false]) {
      for (const within of [true, false]) {
        const rr = { ...r, over };
        const dashboardSays = ownerAtSupportLine(rr, within).endsWith(CB_MOVE_BRINGS_WITHIN);
        expect(atSupportText(rr, within), `WORDS the clause as the Dashboard (over ${over}, the move ${within})`)
          .toBe(cbAtSupportLine(rr, fmtUSD) + (dashboardSays ? CB_MOVE_BRINGS_WITHIN : ''));
      }
    }
    expect(atSupportNote(engineScene(facts({}, { moveBringsCbWithin: true }), 390, null).card), 'WORDS over, and the move brings it within')
      .toBe(cbAtSupportLine(r, fmtUSD) + CB_MOVE_BRINGS_WITHIN);
    const cbCard = partCard('coinbase', engineScene(facts({}, { moveBringsCbWithin: true }), 390, null).card).lines;
    expect(cbCard[cbCard.length - 1], 'WORDS the Coinbase card too').toBe(`${cbAtSupportLine(r, fmtUSD)}${CB_MOVE_BRINGS_WITHIN}.`);
  });

  it('⭐ HEADLINE — the buffer to the liquidation price; at a tried price "At this price"; under it, said; no loan, said', () => {
    expect(engineHeadline(engineScene(facts(), 390, null).card), 'HEADLINE today')
      .toBe("Today: a 41.8% buffer to Coinbase's liquidation price ($58,140).");
    expect(engineHeadline(engineScene(facts(), 390, 80_000).card), 'HEADLINE tried')
      .toBe("At this price: a 27.3% buffer to Coinbase's liquidation price ($58,140).");
    expect(engineHeadline(engineScene(facts(), 390, 50_000).card), 'HEADLINE under it')
      .toBe("At this price, bitcoin is at or under Coinbase's liquidation price ($58,140).");
    expect(engineHeadline(engineScene(facts({ hasCbLoan: false }), 390, null).card), 'HEADLINE no loan')
      .toBe('No Coinbase loan — Strike holds ₿0.500.');
    expect(engineHeadline(engineScene(facts({ cbLoanBalance: 0 }), 390, null).card), 'HEADLINE nothing owed')
      .toBe('Coinbase: nothing owed, so nothing to sell.');
    // a debt with no coins held against it is owed, not "nothing" (v1.4). Mutation: the no-coins words gone → red
    const bare = engineScene(facts({ cbCollateralBtc: 0 }), 390, null).card;
    expect(engineHeadline(bare), 'HEADLINE owed, no coins').toBe('Coinbase: $50,000 owed, with no coins held against it.');
    expect(partCard('sale', bare).lines, 'HEADLINE its liquidation card').toEqual(['Coinbase: $50,000 owed, with no coins held against it, so there is no liquidation price.']);
    expect(engineAria(bare), 'HEADLINE the screen reader').toBe('The Engine, right now. Bitcoin $100,000. Coinbase: $50,000 owed, with no coins held against it. This month $3,517 flows into the loans and $540 is paid out.');
  });

  it('⭐ FORMATS — coins to three places in the cards (two from ₿10), two on the canvas; the prototype\'s short dollars; turns as the Cycle Clock prints them', () => {
    expect([0.5, 1, 12.345, Number.NaN].map(btcText), 'FORMATS coins').toEqual(['₿0.500', '₿1.000', '₿12.35', '₿—']);
    expect([0.5, 1, 12.3456, Number.NaN].map(btc2), 'FORMATS coins on the canvas').toEqual(['₿0.50', '₿1.00', '₿12.35', '₿—']);
    expect([400, 9_999, 10_000, 50_000, 150_000, 1_250_000, 12_500_000, -50_000, Number.POSITIVE_INFINITY].map(usdK), 'FORMATS the prototype\'s usdK')
      .toEqual(['$400', '$9,999', '$10.0K', '$50.0K', '$150K', '$1.25M', '$12.5M', '−$50.0K', '—']);
    expect(CYCLE_TURNS.slice(0, 4).map((t) => turnDate(t.date)), 'FORMATS the turns')
      .toEqual(['6 Oct 2025', '5 Oct 2026', '3 Sep 2029', '2 Sep 2030']);
  });
});

describe('⭐ the canvas\'s words — the prototype\'s', () => {
  it('⭐ CANVAS WORDS — the tags, the names, the motor, the wheel, the pipes, as the prototype writes them, its buffer too (BL64)', () => {
    const l = engineScene(facts(), 390, null).labels;
    expect([l.priceTitle, l.priceText, l.dragHint, l.liqTitle, l.liqText, l.bufferText, l.bufferWord], 'CANVAS WORDS the tags')
      .toEqual(['Price', '$100,000', '↕ drag', 'Liquidation', '$58,140', '41.8%', 'buffer']);
    expect([l.cbName, l.cbCoins, l.cbOwe, l.skName, l.skCoins, l.skOwe], 'CANVAS WORDS the names')
      .toEqual(['Coinbase', '₿1.00', 'owe $50.0K', 'Strike', '₿0.50', 'owe $10.0K']);
    expect([l.motorName, l.wheelTop, l.gaugeText, l.gaugeLiqMark], 'CANVAS WORDS the motor, the wheel, the gauge').toEqual(['Price motor', 'Top', '50%', '86']);
    expect([l.inTitle, l.inText, l.outTitle, l.outText], 'CANVAS WORDS the pipes').toEqual(['INTEREST AND DRAWS IN', '+$3,517 a month', 'PAYMENTS FLOW OUT', '−$540 a month']);
    const quiet = engineScene(facts({}, {}), 390, null);
    expect(quiet.labels.bannerTitle, 'CANVAS WORDS no banner above the line').toBe(null);
    const t = engineScene(facts(), 390, 80_000).labels;
    expect([t.priceTitle, t.priceText, t.backHint], 'CANVAS WORDS a tried price').toEqual(['Test price', '$80,000', '↺ back to live']);
    const paid = engineScene(facts({ advisorActualBlocBalance: 0, cbLoanBalance: 0 }), 390, null).labels;
    expect([paid.cbOwe, paid.skOwe], 'CANVAS WORDS nothing owed').toEqual(['no loan', 'paid']);
    const dripping = engineScene(facts({}, { month: { strikeInterestUsd: 100, strikeDrawn: 0, strikeRepaidUsd: 200, cbRepaidUsd: 300, strikeMinPaidUsd: 40, cashToCureUsd: 0, refinancedFeeUsd: 0 } }), 390, null).labels;
    expect(dripping.inTitle, 'CANVAS WORDS no draw: it drips').toBe('INTEREST DRIPS IN');
    const refinanced = engineScene(facts({}, { month: { strikeInterestUsd: 100, strikeDrawn: 0, strikeRepaidUsd: 200, cbRepaidUsd: 300, strikeMinPaidUsd: 40, cashToCureUsd: 0, refinancedFeeUsd: 90 } }), 390, null).labels;
    expect([refinanced.inTitle, refinanced.inText], 'CANVAS WORDS no draw but a refinance\'s fee (v1.4)').toEqual(['INTEREST AND A FEE IN', '+$607 a month']);
  });

  it('⭐ TAPE WORDS — the title by what the tape shows; the foot by its width; a tick\'s move; a line\'s shift', () => {
    expect([tapeTitle('live', 30, 0, true), tapeTitle('live', 30, 0, false), tapeTitle('live', 1, 0, true), tapeTitle('live', 1, 0, false)], 'TAPE WORDS live')
      .toEqual(['Last 30 min', 'Price · live, last 30 minutes', 'Live', 'Price · live']);
    expect([tapeTitle('stale', 30, 4, true), tapeTitle('stale', 30, 0, true)], 'TAPE WORDS stale').toEqual(['Last price 4 min ago', 'Last price 1 min ago']);
    expect([tapeTitle('manual', 30, 0, true), tapeTitle('off', 30, 0, false), tapeTitle('manual', 1, 0, true)], 'TAPE WORDS held or off')
      .toEqual(['Last 30 min', 'Price · last 30 minutes', 'Price']);
    expect([400, 250, 160, 120].map((w) => liqFooter(w, '$58,140', '41.8%')), 'TAPE WORDS the foot').toEqual([
      'Liquidation price $58,140 · 41.8% below ↓', 'Liquidation $58,140 · 41.8% below ↓', '$58,140 · 41.8% below ↓', '$58,140 ↓']);
    expect([tickDelta(21), tickDelta(-7), tickDelta(1234.4)], 'TAPE WORDS a tick').toEqual(['+$21', '−$7', '+$1,234']);
    expect([liqShift(-1240), liqShift(15_000)], 'TAPE WORDS a shift').toEqual(['▼ $1,240', '▲ $15.0K']);
    // the tape's dollars, the app's one format — never the drawing's own (v1.4)
    expect([tapePriceText(99_850.4), tapePriceText(124_000)], 'TAPE WORDS its dollars').toEqual([fmtUSD(99_850.4), '$124,000']);
  });

  it('⭐ READOUT WORDS — the tape\'s readout in the Dashboard chart\'s words: its clock, to the second, and "BTC : $…" (2026-11-25)', () => {
    // the device's own time, as the Dashboard's tooltip prints it (en-US), with the seconds the tape holds
    const t = (h: number, m: number, sec: number): number => new Date(2026, 10, 23, h, m, sec).getTime();
    expect([readoutTime(t(8, 34, 12)), readoutTime(t(14, 5, 0)), readoutTime(t(0, 0, 9))].map((x) => x.replace(/\s/g, ' ')), 'READOUT WORDS the clock')
      .toEqual(['8:34:12 AM', '2:05:00 PM', '12:00:09 AM']);
    expect([readoutPrice(100_011.4), readoutPrice(99_850.6)], 'READOUT WORDS the price, the Dashboard\'s name and the Almanac\'s whole dollars')
      .toEqual(['BTC : $100,011', 'BTC : $99,851']);
    const lines = partCard('tape', engineScene(facts(), 390, null).card).lines;
    expect(lines[lines.length - 1], 'READOUT WORDS the live price card says how').toBe(TAPE_READ_NOTE);
    expect(TAPE_READ_NOTE, 'READOUT WORDS the note').toBe('Slide a finger along the tape, or point at it, to read its price at any moment.');
  });
});

describe('⭐ the cards', () => {
  const FORBIDDEN = /\bshould\b|\bguarantee|\brecommend|NaN|Infinity|undefined|\$-|−\$0\b/;

  it('⭐ CARDS — every part has a card, in every state: loan or none, today or tried, under the line; no banned word', () => {
    const states = [
      engineScene(facts(), 390, null), engineScene(facts(), 390, 70_000), engineScene(facts(), 390, 50_000),
      engineScene(facts({ hasCbLoan: false }), 390, null), engineScene(facts({ cbLoanBalance: 0 }), 390, null),
      engineScene(facts({ advisorActualBlocBalance: 0 }, { month: null, cycle: null, feed: 'off' }), 390, null),
      engineScene(facts({ cbCollateralBtc: 0 }), 390, null),
    ];
    expect(PART_ORDER.map((p) => PART_NAMES[p]), 'CARDS the row').toEqual(
      ['Price', 'Liquidation', 'Coinbase', 'Strike', 'Loan level', 'Cycle', 'Live price', 'This month']);
    for (const sc of states) {
      for (const p of PART_ORDER) {
        const c = partCard(p, sc.card);
        expect(c.title.length, `CARDS ${p} a title`).toBeGreaterThan(0);
        expect(c.lines.length, `CARDS ${p} a line`).toBeGreaterThan(0);
        for (const l of [c.title, ...c.lines]) expect(l, `CARDS ${p} no banned word`).not.toMatch(FORBIDDEN);
      }
      expect(engineAria(sc.card), 'CARDS the screen reader\'s line').not.toMatch(FORBIDDEN);
      expect(Object.values(sc.labels).join(' '), 'CARDS the canvas\'s words').not.toMatch(FORBIDDEN);
    }
  });

  it('⭐ PRICE — the price card says what is tried and that nothing is saved', () => {
    const tried = partCard('price', engineScene(facts(), 390, 70_000).card);
    expect(tried.title, 'PRICE tried').toBe('Test price $70,000');
    expect(tried.lines, 'PRICE today\'s, and nothing saved').toEqual([
      "Today's price is $100,000. The piston, the loan levels, the buffer and the gauge follow the price you're trying; the month's two pipes stay the plan's, at today's price.", TRIED_NOTE,
    ]);
    expect(TRIED_NOTE, 'PRICE the note').toBe("A price you're trying: nothing is saved, and the plan doesn't change.");
    expect(partCard('price', engineScene(facts(), 390, null).card).title, 'PRICE today').toBe('Bitcoin $100,000');
  });

  it('⭐ MONTH CARD — the month\'s parts by name and their sums; moves between the loans said to be left out', () => {
    expect(partCard('month', engineScene(facts(), 390, null).card).lines, 'MONTH CARD').toEqual([
      "In: Coinbase's interest $417 (at today's balance), Strike's interest $100, $3,000 drawn for the bills — $3,517.",
      "Out: $500 repaid from spare income, Strike's minimum, $40, paid from income — $540.",
      "The plan's month, as THIS MONTH shows it; moves between the two loans are left out, but a refinance's fee is new debt, so it is in.",
    ]);
    const refi = { strikeInterestUsd: 100, strikeDrawn: 3_000, strikeRepaidUsd: 200, cbRepaidUsd: 300, strikeMinPaidUsd: 40, cashToCureUsd: 0, refinancedFeeUsd: 90 };
    expect(partCard('month', engineScene(facts({}, { month: refi }), 390, null).card).lines[0], 'MONTH CARD a refinance\'s fee, in (v1.4)')
      .toBe("In: Coinbase's interest $417 (at today's balance), Strike's interest $100, $3,000 drawn for the bills, Coinbase's fee on the refinance $90 — $3,607.");
  });

  it('⭐ CYCLE CARD — the Cycle Clock\'s leg, in its words', () => {
    const c = partCard('cycle', engineScene(facts(), 390, null).card);
    const v = cycleLegView(NOW)!;
    expect(c.title, 'CYCLE CARD the phase').toBe(`${v.phase} ~${v.pct}%`);
    expect(c.lines[0], 'CYCLE CARD the turns').toContain('from the 5 Oct 2026 floor toward the 3 Sep 2029 peak');
  });
});
