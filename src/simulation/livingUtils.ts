export function getBtcPrice(
  month: number,
  startPrice: number,
  monthlyGrowthRate: number,
  bearMarket: boolean,
  timeHorizonMonths: number,    // kept for API compatibility, unused
  annualBtcGrowth: number,      // kept for API compatibility, unused
  bearPeriodMonths: number,
  annualDecline: number,        // decimal, e.g. -0.50
): number {
  if (!bearMarket) {
    return startPrice * Math.pow(1 + monthlyGrowthRate, month);
  }

  const monthlyDeclineRate = Math.pow(1 + annualDecline, 1 / 12) - 1;

  if (month <= bearPeriodMonths) {
    return startPrice * Math.pow(1 + monthlyDeclineRate, month);
  }

  const troughPrice = startPrice * Math.pow(1 + monthlyDeclineRate, bearPeriodMonths);
  return troughPrice * Math.pow(1 + monthlyGrowthRate, month - bearPeriodMonths);
}
