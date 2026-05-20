import { describe, it, expect } from 'vitest';
import {
  revPerTHPerDay,
  dailyEV_usd,
  monthlyElecCost,
  calcLotteryOdds,
  calcAllStrategies,
} from '../miningUtils';
import { fmtMining } from '../../utils/format';
import type { MiningInputs } from '../types';

const defaultMiningInputs: MiningInputs = {
  devices: [
    { name: 'Gamma 601', hashrateTH: 1.07, powerW: 22.3, efficiencyJTH: 20.23, enabled: true, soloMining: false, poolName: '', poolFee: 2.0 },
    { name: 'Gamma 602', hashrateTH: 1.20, powerW: 18.0, efficiencyJTH: 15.0,  enabled: true, soloMining: false, poolName: '', poolFee: 2.0 },
  ],
  electricityRateCents: 12,
  btcPriceOverride: null,
  networkHashrateEH: 1000,
  selectedStrategy: 'split',
  currency: 'usd',
  projectionYears: 5,
  btcPriceScenarios: [76000, 150000, 300000, 1000000],
};

describe('revPerTHPerDay', () => {
  it('returns correct value at $76,000 BTC', () => {
    // (3.125 × 144 × 76000) / 1e9 = 0.0342
    expect(revPerTHPerDay(76000)).toBeCloseTo(0.0342, 3);
  });
});

describe('dailyEV_usd', () => {
  it('2.27 TH/s at 2% fee, $76k BTC', () => {
    expect(dailyEV_usd(2.27, 76000, 2)).toBeCloseTo(0.0764, 3);
  });
  it('2.27 TH/s at 0% fee, $76k BTC', () => {
    expect(dailyEV_usd(2.27, 76000, 0)).toBeCloseTo(0.0779, 3);
  });
});

describe('monthlyElecCost', () => {
  it('40.3W at $0.12/kWh = ~$3.50/month', () => {
    expect(monthlyElecCost(40.3, 12)).toBeCloseTo(3.50, 1);
  });
});

describe('calcLotteryOdds', () => {
  it('2.27 TH/s on 1000 EH/s network', () => {
    const odds = calcLotteryOdds(2.27, 1000);
    expect(odds.annualProbability).toBeCloseTo(0.0001193, 5);
    expect(odds.expectedYearsToBlock).toBeCloseTo(8381, -1);
  });
  it('1.07 TH/s on 1000 EH/s network (601 solo portion)', () => {
    const odds = calcLotteryOdds(1.07, 1000);
    expect(odds.expectedYearsToBlock).toBeCloseTo(17781, -1);
  });
});

describe('fmtMining', () => {
  it('USD mode', () => expect(fmtMining(0.0890, 'usd', 76000)).toBe('$0.09'));
  it('sats mode', () => expect(fmtMining(0.0890, 'sats', 76000)).toBe('117 sats'));
  it('BTC mode',  () => expect(fmtMining(0.0890, 'btc',  76000)).toBe('0.00000117 BTC'));
});

describe('calcAllStrategies', () => {
  it('returns 3 strategies', () => {
    const results = calcAllStrategies(defaultMiningInputs, 76000);
    expect(results).toHaveLength(3);
  });
  it('type reflects device.soloMining', () => {
    const results = calcAllStrategies(defaultMiningInputs, 76000);
    const split = results.find(r => r.id === 'split')!;
    // Both fixture devices have soloMining: false
    expect(split.devices[0].type).toBe('pooled');
    expect(split.devices[1].type).toBe('pooled');
  });
  it('fully pooled: no lottery odds', () => {
    const results = calcAllStrategies(defaultMiningInputs, 76000);
    const pooled = results.find(r => r.id === 'pooled')!;
    expect(pooled.lotteryOdds).toBeNull();
  });
});
