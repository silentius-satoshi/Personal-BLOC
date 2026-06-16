import { describe, it, expect } from 'vitest';
import { deriveForMonth, isOperatingMonth, composeMonthSummary, type MonthSummaryArgs } from '../simpleModePlan';
import { runAdvisor, type AdvisorMonthRow } from '../runAdvisor';

function makeRow(month: number, o: Partial<AdvisorMonthRow> = {}): AdvisorMonthRow {
  return {
    month, tier: 4, tierLabel: 'Safe', isCurrentMonth: false,
    blocDraw: 3500, fiatGap: 0, cbPayment: 0, cbExtraPayment: 0,
    cbPaydownDraw: 0, cbLtvTriggered: false, cbPaydownCapped: false, cbPaydownShortfall: 0,
    strikeRepayDraw: 0, strikeRepayFired: false,
    btcBought: 0.05, incomeToBtc: 4000, blocBalance: 10000, blocLtv: 0.12,
    cbBalance: 0, cbLtv: 0, btcHeld: 1.0, blocInterest: 108, cbInterest: 0, totalInterest: 108,
    ...o,
  };
}

function summaryArgs(o: Partial<MonthSummaryArgs> = {}): MonthSummaryArgs {
  return {
    month: 3, isCurrent: false, isLogged: false, hasCbLoan: false,
    cbLtv: 0, triggerPct: 75, draw: 3500, btcBoughtUsd: 4000, cbPayment: 0,
    rotationFired: false, rotationAmount: 0, interest: 108,
    skipDraw: false, skipBtc: false, skipCb: false, unallocated: 0,
    ...o,
  };
}

describe('deriveForMonth — unskipped projection', () => {
  it('maps a row to plain projected amounts (no CB loan)', () => {
    const p = deriveForMonth(makeRow(1, { incomeToBtc: 4000, blocDraw: 3500, blocInterest: 108 }), 4000, false, 'monthly');
    expect(p.blocDraw).toBe(3500);
    expect(p.btcBoughtUsd).toBe(4000);
    expect(p.cbPayment).toBe(0);
    expect(p.cbLtv).toBe(0);            // !hasCbLoan zeros CB
    expect(p.blocInterest).toBe(108);
    expect(p.paydown).toBe(0);          // income - 0 - 4000
    expect(p.allocatedFromIncome).toBe(4000);
    expect(p.isFullyAllocated).toBe(true);
  });

  it('counts the monthly CB payment in monthly mode', () => {
    const p = deriveForMonth(makeRow(1, { cbPayment: 500, incomeToBtc: 3500, cbLtv: 0.6 }), 4000, true, 'monthly');
    expect(p.cbPayment).toBe(500);
    expect(p.btcBoughtUsd).toBe(3500);
    expect(p.paydown).toBe(0);          // 4000 - 500 - 3500
    expect(p.allocatedFromIncome).toBe(4000);
    expect(p.cbLtv).toBe(0.6);
  });

  it('does NOT count CB payment as a monthly line in ltvTriggered mode', () => {
    const p = deriveForMonth(makeRow(1, { cbPayment: 0, incomeToBtc: 4000, cbLtv: 0.7 }), 4000, true, 'ltvTriggered');
    expect(p.cbPayment).toBe(0);        // event-driven, not an income line
    expect(p.cbLtv).toBe(0.7);
  });

  it('two different rows produce different values (bars track the scrubbed month)', () => {
    const a = deriveForMonth(makeRow(1, { blocLtv: 0.12, blocInterest: 90 }), 4000, false, 'monthly');
    const b = deriveForMonth(makeRow(8, { blocLtv: 0.30, blocInterest: 240 }), 4000, false, 'monthly');
    expect(a.blocLtv).not.toBe(b.blocLtv);
    expect(a.blocInterest).not.toBe(b.blocInterest);
  });
});

describe('isOperatingMonth', () => {
  it('is true only when selected === current', () => {
    expect(isOperatingMonth(3, 3)).toBe(true);
    expect(isOperatingMonth(2, 3)).toBe(false);
    expect(isOperatingMonth(4, 3)).toBe(false);
  });
});

describe('composeMonthSummary', () => {
  it('omits the CB clause and the LTV lead when there is no CB loan', () => {
    const s = composeMonthSummary(summaryArgs({ hasCbLoan: false }));
    expect(s).toContain('Month 3:');
    expect(s).not.toContain('CB LTV');
    expect(s).not.toContain('Coinbase');
  });

  it('future month uses plan voice (Draw / Buy)', () => {
    const s = composeMonthSummary(summaryArgs({ isCurrent: false, isLogged: false, draw: 3500, btcBoughtUsd: 4000 }));
    expect(s).toContain('Draw $3,500');
    expect(s).toContain('Buy $4,000 of Bitcoin');
  });

  it('rotation fired → rotation clause, not a paydown clause', () => {
    const s = composeMonthSummary(summaryArgs({ hasCbLoan: true, cbLtv: 0.6, rotationFired: true, rotationAmount: 2000, cbPayment: 500 }));
    expect(s).toContain('Rotate $2,000');
    expect(s).not.toContain('Pay $500 to your Coinbase loan');
  });

  it('logged month narrates past-tense actuals', () => {
    const s = composeMonthSummary(summaryArgs({ isLogged: true, hasCbLoan: true, cbLtv: 0.55, draw: 3500, btcBoughtUsd: 4000, cbPayment: 500 }));
    expect(s).toContain('CB LTV was');
    expect(s).toContain('You drew $3,500');
    expect(s).toContain('Bought $4,000');
    expect(s).toContain('Paid $500');
  });

  it('current month + skipBtc → "skipped … unallocated"', () => {
    const s = composeMonthSummary(summaryArgs({ isCurrent: true, skipBtc: true, unallocated: 4000 }));
    expect(s).toContain("skipped this month's Bitcoin buy");
    expect(s).toContain('$4,000 income unallocated');
    expect(s).not.toContain('Buy $');
  });

  it('current month + skipDraw → "covering … from savings"', () => {
    const s = composeMonthSummary(summaryArgs({ isCurrent: true, skipDraw: true, draw: 3500 }));
    expect(s).toContain('covering $3,500 from savings');
  });
});

describe('projection-vs-reality split (the headline guarantee)', () => {
  it('deriveForMonth carries NO skip parameters — its output is skip-independent by construction', () => {
    // Same row + income → identical projection no matter what skip state the caller holds.
    const row = makeRow(5, { incomeToBtc: 4000 });
    const a = deriveForMonth(row, 4000, false, 'monthly');
    const b = deriveForMonth(row, 4000, false, 'monthly');
    expect(a).toEqual(b);
    expect(a.isFullyAllocated).toBe(true);   // a clean forward projection is always fully allocated
  });

  it('a monthly CB payment lowers the advisor row LTV below the start-of-month (skipped) LTV', () => {
    // The current-month skip-aware CB LTV uses the start-of-month (no-payment) figure; paying drops it.
    const cbBalance = 60000, cbCollateralBtc = 1.48, btcPrice = 82000;
    const startLtv = cbBalance / (cbCollateralBtc * btcPrice);
    const { rows } = runAdvisor({
      btcPrice, income: 4000, expenses: 3500, blocApr: 13, creditLine: 10000, blocLtvCeiling: 0.15,
      cbBalance, cbCollateralBtc, cbAprPct: 4.77, cbMonthlyPayment: 1000,
      cbPaymentStrategy: 'monthly', cbLtvTriggerPct: 75, cbLtvTargetPct: 65, cbRotateBackPct: 55,
      startingBlocBalance: 0, startingBtcHeld: 1.0, startingMonth: 1, btcGrowthRate: 0,
    });
    expect(rows[0].cbLtv).toBeLessThan(startLtv);
  });
});
