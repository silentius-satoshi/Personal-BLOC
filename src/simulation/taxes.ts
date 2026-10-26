/**
 * The capital-gains rule — ONE formula (FIRE plan R1(d); batch 1 build 3). Living's own formula, lifted out of
 * `runSellToLive` — both of its sites call it, in their own order, so the Living tab is bit for bit what it was — with
 * its one default rate; and the FIRE sell lane's closed form for a sale that nets a given amount after that tax.
 *
 * 🔴 Zero imports; + − × ÷ and Math.max only. `fire.ts` imports this module — its only import — and `fireWalls.test.ts`
 * walks both for implementation-approximated Math, so the FIRE engine's exact goldens hold on every runtime.
 * ⚠ Never the Compass's t ÷ (1 − t) gross-up on every dollar spent (C8): the tax is on what a sale gains, nothing else.
 */

/** Living's rate on realized gains — the one default. `useLivingSimulation` passes it; the FIRE face defaults to it. */
export const CAPITAL_GAINS_TAX_RATE = 0.30;

/**
 * rate × max(0, proceeds − coins sold × basis) — Living's formula, in Living's order. `runSellToLive`'s running liability
 * (Σ dollars sold, Σ coins sold, the start price) and the FIRE sell lane's per-sale tax both go through it.
 * ⚠ No guard on purpose: Living's figures stay bit for bit, junk included — callers pass what they mean.
 */
export function capitalGainsTax(proceedsUsd: number, coinsSold: number, basisUsdPerBtc: number, rate: number): number {
  return Math.max(0, proceedsUsd - coinsSold * basisUsdPerBtc) * rate;
}

export interface Sale { btc: number; proceedsUsd: number; taxUsd: number }

/**
 * The coins to sell at `priceUsd` so the sale nets `netUsd` after `capitalGainsTax` against an average cost of
 * `basisUsdPerBtc` — the closed form q = net ÷ (p − rate × max(0, p − basis)). At or below the basis nothing is owed and
 * q = net ÷ p exactly; at a rate of 0 it is net ÷ p bit for bit (the parity golden's sale). Junk — a net or a price that
 * isn't finite and above 0, a basis that isn't finite and at or above 0, a rate outside [0, 1) — sells nothing, so the
 * answer is never NaN, ∞ or a negative coin.
 */
export function sellToNet(netUsd: number, priceUsd: number, basisUsdPerBtc: number, rate: number): Sale {
  if (!(Number.isFinite(netUsd) && netUsd > 0) || !(Number.isFinite(priceUsd) && priceUsd > 0)
    || !(Number.isFinite(basisUsdPerBtc) && basisUsdPerBtc >= 0) || !(Number.isFinite(rate) && rate >= 0 && rate < 1)) {
    return { btc: 0, proceedsUsd: 0, taxUsd: 0 };
  }
  const btc = netUsd / (priceUsd - rate * Math.max(0, priceUsd - basisUsdPerBtc));
  const proceedsUsd = btc * priceUsd;
  return { btc, proceedsUsd, taxUsd: capitalGainsTax(proceedsUsd, btc, basisUsdPerBtc, rate) };
}
