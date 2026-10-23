// Type declaration for the plain-ESM .js helper so the vitest suite (TS, under tsc -b) can import it.
export const SPOT_URL: string;
export const EXAMPLE_COLLATERAL_BTC: number;
export const EXAMPLE_BORROWED_USD: number;
export const STRIKE_MARGIN_CALL_LTV: number;
export const STRIKE_PARTIAL_LIQ_LTV: number;
export const CB_LLTV: number;

export interface LenderLine {
  lender: string;
  event: string;
  ltv: number;
  tone: 'amber' | 'red';
}
export const LENDER_LINES: readonly LenderLine[];

export interface CardLine extends LenderLine {
  triggerPrice: number;
  fall: number | null;
}
export interface CardModel {
  price: number | null;
  ltv: number | null;
  lines: CardLine[];
}

export function parseSpot(json: unknown): number | null;
export function cardModel(price: number | null): CardModel;
export function fmtUsd(n: number): string;
export function fmtLtv(fraction: number): string;
export function fmtUtc(d: Date): string;
export function renderReadmeCard(input: { price: number | null; now: Date }): string;

export interface SpotResponse {
  ok: boolean;
  json(): Promise<unknown>;
}
export function buildReadmeCard(opts?: {
  fetchImpl?: (url: string, init: { signal: AbortSignal }) => Promise<SpotResponse>;
  now?: Date;
  timeoutMs?: number;
}): Promise<{ headers: Record<string, string>; body: string }>;
