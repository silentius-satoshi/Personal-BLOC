import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fmtUSD, fmtMiningUSD, fmtMining } from '../format';
import type { MiningCurrency } from '../../simulation/types';

/**
 * ⭐ F1 (Sweep 2b) — the whole-number formats, built once. `fmtUSD`, `fmtMiningUSD`'s whole-dollar branch and
 * `fmtMining`'s sats format through one module-level `Intl.NumberFormat(undefined)` in place of a `toLocaleString()` call
 * per figure — the same default locale and options, so nothing on screen moves. Each is held to its OLD expression, kept
 * here as the reference, over a population that reaches every shape: integers and fractions, negatives, ±0, the .5
 * boundaries, 10⁰ to 10¹⁵, past 2⁵³, NaN and ±∞. Sized for Node 26, where the old `toLocaleString()` costs about 27 µs
 * a call (the spec's scratch sweep ran 2,000,000 values on Node 22).
 */
const OLD_USD = (n: number): string => '$' + Math.round(Math.abs(n)).toLocaleString();
const OLD_MINING_USD = (n: number): string => {
  if (n < 0.01) return '$' + n.toFixed(4);
  if (n < 100) return '$' + n.toFixed(2);
  return '$' + Math.round(n).toLocaleString();
};
const OLD_MINING = (usd: number, currency: MiningCurrency, price: number): string => {
  if (currency === 'usd') return OLD_MINING_USD(usd);
  const sats = Math.round((usd / price) * 100_000_000);
  if (currency === 'sats') return `${sats.toLocaleString()} sats`;
  return `${(sats / 100_000_000).toFixed(8)} BTC`;
};

function population(size: number): number[] {
  const out: number[] = [0, -0, NaN, Infinity, -Infinity, 0.5, -0.5, 1.5, 2.5, -2.5, 999.5, 1000.5, 0.49999999999999994,
    Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 2 ** 53 + 2, 1e21, 1e-7, 123456789.5];
  for (let e = 0; e <= 15; e++) {
    const p = 10 ** e;
    out.push(p, p - 1, p + 1, p - 0.5, p + 0.5, -p, p * 1.5, p - 0.4999, -(p + 0.5));
  }
  let x = 0x9e3779b9;   // xorshift32 — the same population on every run
  const rnd = (): number => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 2 ** 32; };
  while (out.length < size) {
    const v = rnd() * 10 ** Math.floor(rnd() * 16) * (rnd() < 0.2 ? -1 : 1);
    out.push(rnd() < 0.5 ? v : Math.round(v) + (rnd() < 0.5 ? 0.5 : 0));
  }
  return out;
}

describe('F1 — the whole-number formats, built once, print as toLocaleString() did', () => {
  const POP = population(20_000);

  it('⭐ F1 — premise — the population reaches every shape', () => {
    expect(POP.length, 'F1 premise — its size').toBeGreaterThanOrEqual(20_000);
    expect([POP.some(Number.isNaN), POP.includes(Infinity), POP.includes(-Infinity), POP.some((v) => Object.is(v, -0)),
      POP.some((v) => v >= 1e15), POP.some((v) => v < 0 && v > -1e15), POP.some((v) => v % 1 === 0.5)],
    'F1 premise — NaN, ±∞, −0, past 10¹⁵, negatives, the .5 boundaries').toEqual([true, true, true, true, true, true, true]);
    expect(fmtUSD(1234567), 'F1 premise — grouped as the device groups').toBe(OLD_USD(1234567));
  });

  it('⭐ F1 — fmtUSD — the whole population, byte for byte', () => {
    for (const v of POP) if (fmtUSD(v) !== OLD_USD(v)) expect(fmtUSD(v), `F1 fmtUSD(${v})`).toBe(OLD_USD(v));
  }, 60_000);

  it('⭐ F1 — fmtMiningUSD — the whole population, byte for byte (its whole-dollar branch from $100)', () => {
    let whole = 0;
    for (const v of POP) {
      if (v >= 100) whole += 1;
      if (fmtMiningUSD(v) !== OLD_MINING_USD(v)) expect(fmtMiningUSD(v), `F1 fmtMiningUSD(${v})`).toBe(OLD_MINING_USD(v));
    }
    expect(whole, 'F1 premise — the whole-dollar branch reached').toBeGreaterThan(5_000);
  }, 60_000);

  it('⭐ F1 — fmtMining — sats, dollars and coins at four prices, byte for byte', () => {
    for (const price of [65_000.123, 100_000, 1, 0]) {
      for (const v of POP.slice(0, 5_000)) {
        for (const c of ['sats', 'usd', 'btc'] as const) {
          const got = fmtMining(v, c, price);
          if (got !== OLD_MINING(v, c, price)) expect(got, `F1 fmtMining(${v}, ${c}, ${price})`).toBe(OLD_MINING(v, c, price));
        }
      }
    }
  }, 60_000);

  it('⭐ F1 — format.ts calls toLocaleString nowhere — one formatter, built once', () => {
    const src = readFileSync(join(process.cwd(), 'src/utils/format.ts'), 'utf8');
    expect(src, 'F1 no toLocaleString left').not.toMatch(/\.toLocaleString\(/);
    expect(src.match(/new Intl\.NumberFormat\(undefined\)/g)?.length, 'F1 WHOLE, built once').toBe(1);
  });
});
