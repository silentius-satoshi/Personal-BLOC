export const fmtUSD = (n: number): string =>
  '$' + Math.round(Math.abs(n)).toLocaleString();
