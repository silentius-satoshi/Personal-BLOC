export function getBtcPrice(
  month: number,
  startPrice: number,
  monthlyGrowthRate: number,
  bearMarket: boolean,
  timeHorizonMonths: number,
  annualBtcGrowth: number
): number {
  if (!bearMarket) {
    return startPrice * Math.pow(1 + monthlyGrowthRate, month);
  }

  const half = Math.floor(timeHorizonMonths / 2);
  const bearMonthly = Math.pow(0.70, 1 / 12) - 1;

  if (month <= half) {
    return startPrice * Math.pow(1 + bearMonthly, month);
  }

  const priceAtHalf = startPrice * Math.pow(1 + bearMonthly, half);
  const recoveryRate = Math.pow(1 + annualBtcGrowth + 0.30, 1 / 12) - 1;
  return priceAtHalf * Math.pow(1 + recoveryRate, month - half);
}
