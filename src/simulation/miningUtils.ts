import type {
  MiningDevice,
  MiningInputs,
  MiningStrategy,
  MiningStrategyResult,
} from './types';

export function revPerTHPerDay(btcPrice: number): number {
  return (3.125 * 144 * btcPrice) / 1_000_000_000;
}

export function dailyEV_usd(hashTH: number, btcPrice: number, feePercent: number): number {
  return hashTH * revPerTHPerDay(btcPrice) * (1 - feePercent / 100);
}

export function monthlyElecCost(powerW: number, rateCentsPerKwh: number): number {
  return (powerW / 1000) * 24 * 30 * (rateCentsPerKwh / 100);
}

export function usdToSats(usd: number, btcPrice: number): number {
  return Math.round((usd / btcPrice) * 100_000_000);
}

export function calcLotteryOdds(soloHashTH: number, networkHashrateEH: number) {
  const networkHashTH = networkHashrateEH * 1_000_000;
  const dailyProbability = (soloHashTH / networkHashTH) * 144;
  const annualProbability = 1 - Math.pow(1 - dailyProbability, 365);
  const expectedYearsToBlock = 1 / (dailyProbability * 365);
  return { dailyProbability, annualProbability, expectedYearsToBlock };
}

export function calcMiningStrategy(
  strategyId: MiningStrategy,
  devices: MiningDevice[],
  btcPrice: number,
  electricityRateCents: number,
  networkHashrateEH: number,
  projectionYears: number,
  btcPriceScenarios: number[]
): MiningStrategyResult {
  const enabledDevices = devices.filter(d => d.enabled);

  const STRATEGY_META = {
    solo:   { label: 'Fully Solo',   emoji: '🎰' },
    split:  { label: 'Split Strategy', emoji: '⚡' },
    pooled: { label: 'Fully Pooled', emoji: '📊' },
  };

  const deviceResults = enabledDevices.map((device) => {
    const type    = device.soloMining ? 'solo' : 'pooled' as const;
    const ev_usd  = dailyEV_usd(device.hashrateTH, btcPrice, device.poolFee);
    const ev_sats = usdToSats(ev_usd, btcPrice);
    return { device, dailyEV_usd: ev_usd, dailyEV_sats: ev_sats, type };
  });

  const totalHashTH   = enabledDevices.reduce((s, d) => s + d.hashrateTH, 0);
  const soloHashTH    = deviceResults.filter(d => d.type === 'solo').reduce((s, d) => s + d.device.hashrateTH, 0);
  const pooledHashTH  = deviceResults.filter(d => d.type === 'pooled').reduce((s, d) => s + d.device.hashrateTH, 0);
  const totalPowerW   = enabledDevices.reduce((s, d) => s + d.powerW, 0);

  const totalDailyEV_usd  = deviceResults.reduce((s, d) => s + d.dailyEV_usd, 0);
  const totalDailyEV_sats = usdToSats(totalDailyEV_usd, btcPrice);
  const totalDailyEV_btc  = totalDailyEV_sats / 100_000_000;

  const monthlyElec = monthlyElecCost(totalPowerW, electricityRateCents);
  const monthlyElecSats = usdToSats(monthlyElec, btcPrice);

  const monthlyGrossUSD  = totalDailyEV_usd * 30;
  const monthlyNetUSD    = monthlyGrossUSD - monthlyElec;
  const monthlyNetSats   = usdToSats(monthlyNetUSD, btcPrice);
  const monthlyNetBtc    = monthlyNetSats / 100_000_000;

  const yearlyNetUSD  = monthlyNetUSD * 12;
  const yearlyNetSats = usdToSats(yearlyNetUSD, btcPrice);
  const yearlyNetBtc  = yearlyNetSats / 100_000_000;

  const lotteryOdds = soloHashTH > 0 ? (() => {
    const odds = calcLotteryOdds(soloHashTH, networkHashrateEH);
    const jackpotUSD  = 3.125 * btcPrice;
    const jackpotSats = Math.round(3.125 * 100_000_000);
    return {
      ...odds,
      jackpotValue_usd:  jackpotUSD,
      jackpotValue_sats: jackpotSats,
      jackpotValue_btc:  3.125,
    };
  })() : null;

  const projection = Array.from({ length: projectionYears }, (_, i) => {
    const year = i + 1;
    const grossSats = totalDailyEV_sats * 365 * year;
    const elecSats  = monthlyElecSats * 12 * year;
    const netSats   = Math.max(0, grossSats - elecSats);
    const valueByScenario: Record<number, number> = {};
    for (const price of btcPriceScenarios) {
      valueByScenario[price] = (netSats / 100_000_000) * price;
    }
    return { year, satsAccumulated: netSats, valueByScenario };
  });

  const poolSetup = enabledDevices.map((device) => ({
    deviceName: device.name,
    hashrateTH: device.hashrateTH,
    poolName:   device.poolName,
    poolFee:    device.poolFee,
    type:       (device.soloMining ? 'solo' : 'pooled') as 'solo' | 'pooled',
  }));

  return {
    id: strategyId,
    label: STRATEGY_META[strategyId].label,
    emoji: STRATEGY_META[strategyId].emoji,
    devices: deviceResults,
    totalHashTH,
    soloHashTH,
    pooledHashTH,
    dailyEV_usd:  totalDailyEV_usd,
    dailyEV_sats: totalDailyEV_sats,
    dailyEV_btc:  totalDailyEV_btc,
    monthlyNet_usd:  monthlyNetUSD,
    monthlyNet_sats: monthlyNetSats,
    monthlyNet_btc:  monthlyNetBtc,
    yearlyNet_usd:  yearlyNetUSD,
    yearlyNet_sats: yearlyNetSats,
    yearlyNet_btc:  yearlyNetBtc,
    totalPowerW,
    monthlyElecCost_usd: monthlyElec,
    lotteryOdds,
    projection,
    poolSetup,
  };
}

export function calcAllStrategies(inputs: MiningInputs, btcPrice: number): MiningStrategyResult[] {
  const { devices, electricityRateCents, networkHashrateEH, projectionYears, btcPriceScenarios } = inputs;
  return (['solo', 'split', 'pooled'] as MiningStrategy[]).map(id =>
    calcMiningStrategy(id, devices, btcPrice, electricityRateCents, networkHashrateEH, projectionYears, btcPriceScenarios)
  );
}
