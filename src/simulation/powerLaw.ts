export const PL_B         = 5.82;
export const PL_A_FAIR    = 1.16e-17;
export const PL_A_FLOOR   = 0.42e-17;
export const PL_A_CEILING = 10 ** -16.12;
export const GENESIS      = new Date('2009-01-03T00:00:00Z');

export function daysSinceGenesis(date: Date): number {
  return Math.floor((date.getTime() - GENESIS.getTime()) / 86_400_000);
}

export function plFairValue(date: Date): number {
  return PL_A_FAIR * Math.pow(daysSinceGenesis(date), PL_B);
}

export function plFloor(date: Date): number {
  return PL_A_FLOOR * Math.pow(daysSinceGenesis(date), PL_B);
}

export function plCeiling(date: Date): number {
  return PL_A_CEILING * Math.pow(daysSinceGenesis(date), PL_B);
}
