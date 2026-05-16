// src/simulation/__tests__/living.test.ts
import { describe, it, expect } from 'vitest';
import { runNoBitcoin } from '../runNoBitcoin';
import { runSellToLive } from '../runSellToLive';
import { runSmartBLOC_Living } from '../runSmartBLOC_Living';
import { runMaxLeverage } from '../runMaxLeverage';
import type { LivingInputs } from '../types';

const INPUTS: LivingInputs = {
  btcHoldings: 0.7,
  startPrice: 80000,
  income: 3500,
  expenses: 3000,
  annualBtcGrowth: 0.50,
  apr: 0.13,
  inflationRate: 0.02,
  timeHorizonMonths: 12,
  ltvCeiling: 0.05,           // Target 5% — only affects Max Leverage initial borrow
  capitalGainsTaxRate: 0.30,  // 30% verified: produces ~$2,070 tax
  bearMarket: false,
};

describe('Living on Bitcoin — all four strategies', () => {
  const noBtc      = runNoBitcoin(INPUTS);
  const sellToLive = runSellToLive(INPUTS, noBtc.finalNetWorthNominal);
  const smartBloc  = runSmartBLOC_Living(INPUTS, noBtc.finalNetWorthNominal);
  const maxLev     = runMaxLeverage(INPUTS, noBtc.finalNetWorthNominal);

  it('year-end BTC price ≈ $120,000', () => {
    expect(maxLev.monthlyData[12].btcPrice).toBeCloseTo(120000, -3);
  });

  // ── No Bitcoin ───────────────────────────────────────────────────────────
  describe('No Bitcoin (Cash Only)', () => {
    it('net worth = $62,000', () => {
      expect(noBtc.finalNetWorthNominal).toBeCloseTo(62000, -2);
    });

    it('BTC held = 0', () => {
      expect(noBtc.finalBtcHeld).toBe(0);
    });

    it('real return = −2.0%', () => {
      expect(noBtc.realReturn * 100).toBeCloseTo(-2.0, 1);
    });

    it('no LoC, no interest, no taxes', () => {
      expect(noBtc.finalLocBalance).toBe(0);
      expect(noBtc.finalInterestPaid).toBe(0);
      expect(noBtc.finalTaxesPaid).toBe(0);
    });
  });

  // ── Sell to Live ─────────────────────────────────────────────────────────
  describe('Sell to Live (No LoC)', () => {
    it('real net worth ≈ $87,165 (inflation-adjusted)', () => {
      // Reference shows real (inflation-adjusted) values on cards
      expect(sellToLive.finalNetWorthReal).toBeCloseTo(87165, -3); // within ±500
    });

    it('BTC held ≈ 0.74 (net of buy/sell over 12 months)', () => {
      // Reference settles tax by selling BTC; tolerance loosened accordingly
      expect(sellToLive.finalBtcHeld).toBeCloseTo(0.74, 1); // within ±0.05
    });

    it('taxes ≈ $2,070 (30% on gains above $80k cost basis)', () => {
      expect(sellToLive.finalTaxesPaid).toBeCloseTo(2070, -2); // within ±50
    });

    it('no LoC, no interest', () => {
      expect(sellToLive.finalLocBalance).toBe(0);
      expect(sellToLive.finalInterestPaid).toBe(0);
    });

    it('real return ≈ +40.6%', () => {
      expect(sellToLive.realReturn * 100).toBeCloseTo(40.6, 0);
    });
  });

  // ── Smart BLOC ───────────────────────────────────────────────────────────
  describe('Smart BLOC (Crash-Safe)', () => {
  it('real net worth ≈ $90,638 (inflation-adjusted)', () => {
    expect(smartBloc.finalNetWorthReal).toBeCloseTo(90638, -3);
  });

  it('BTC held close to reference 0.8432', () => {
    expect(smartBloc.finalBtcHeld).toBeCloseTo(0.8432, 1); // within ±0.05
  });

  it('LoC balance is lower than Max Leverage (paydowns working)', () => {
    expect(smartBloc.finalLocBalance).toBeLessThan(maxLev.finalLocBalance);
    expect(smartBloc.finalLocBalance).toBeGreaterThan(0);
  });

  it('interest is lower than Max Leverage', () => {
    expect(smartBloc.finalInterestPaid).toBeLessThan(maxLev.finalInterestPaid);
  });

  it('final LTV stays below 15% ceiling', () => {
    expect(smartBloc.finalLtv * 100).toBeLessThan(15);
  });

  it('real return ≈ +46.2%', () => {
    expect(smartBloc.realReturn * 100).toBeCloseTo(46.2, 0);
  });

  it('crash LTV is safe — below 70% margin call threshold', () => {
    expect(smartBloc.crashLtv).toBeLessThan(0.70);
  });
});

  // ── Max Leverage ─────────────────────────────────────────────────────────
  describe('Max Leverage (Dangerous)', () => {
    it('real net worth ≈ $94,156 (inflation-adjusted)', () => {
      expect(maxLev.finalNetWorthReal).toBeCloseTo(94156, -3);
    });

    it('BTC held ≈ 1.1003', () => {
      expect(maxLev.finalBtcHeld).toBeCloseTo(1.1003, 2);
    });

    it('LoC balance ≈ $36,000 (expenses only — interest paid from income)', () => {
      expect(maxLev.finalLocBalance).toBeCloseTo(36000, -2);
    });

    it('interest paid ≈ $2,535', () => {
      expect(maxLev.finalInterestPaid).toBeCloseTo(2535, -2);
    });

    it('final LTV ≈ 27.3%', () => {
      expect(maxLev.finalLtv * 100).toBeCloseTo(27.3, 0);
    });

    it('real return ≈ +51.9%', () => {
      expect(maxLev.realReturn * 100).toBeCloseTo(51.9, 0);
    });

    it('crash LTV ≈ 136.3% — Liquidated', () => {
      expect(maxLev.crashLtv * 100).toBeCloseTo(136.3, 0);
      expect(maxLev.crashLtv).toBeGreaterThan(0.85);
    });
  });

  // ── Ordering sanity checks ────────────────────────────────────────────────
  describe('Strategy ordering', () => {
    it('Max Leverage > Smart BLOC > Sell to Live > No Bitcoin', () => {
      expect(maxLev.finalNetWorthNominal).toBeGreaterThan(smartBloc.finalNetWorthNominal);
      expect(smartBloc.finalNetWorthNominal).toBeGreaterThan(sellToLive.finalNetWorthNominal);
      expect(sellToLive.finalNetWorthNominal).toBeGreaterThan(noBtc.finalNetWorthNominal);
    });

    it('Max Leverage holds more BTC than Smart BLOC', () => {
      expect(maxLev.finalBtcHeld).toBeGreaterThan(smartBloc.finalBtcHeld);
    });

    it('Smart BLOC has lower LoC than Max Leverage', () => {
      expect(smartBloc.finalLocBalance).toBeLessThan(maxLev.finalLocBalance);
    });
  });
});