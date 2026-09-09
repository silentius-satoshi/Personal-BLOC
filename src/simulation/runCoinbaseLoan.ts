export const CB_LLTV = 0.86;
export const CB_WARN_LTV = 0.65;  // Coinbase/Morpho warning band start (watch→warning boundary; see classifyLtv)
export const CB_LIF  = 1 / (0.3 * CB_LLTV + 0.7);  // ≈ 1.04384

/**
 * Coinbase loan ORIGINATION FEE — a published FACT, not a belief.
 * "A one-time processing fee is added to your crypto-backed loan EACH TIME YOU BORROW, even when adding
 * to an existing loan… 2% on the first $250,000, 1% on the amount above $250,000… It is added to your
 * loan balance, accrues interest, and is paid when you repay your loan."
 *   → https://help.coinbase.com/en/coinbase/trading-and-funding/loan/fee
 *
 * Two consequences the model must not miss:
 *  1. EVERY refinance sweep pays it. A monthly cycle pays it 12x a year, not once.
 *  2. It is CAPITALISED — added to principal, so it compounds at the CB APR for the rest of the horizon.
 */
// (origination-fee constants are below, after the platform fee)

/**
 * Coinbase's PLATFORM FEE — a spread it charges ON TOP of the third-party (Morpho) variable borrow rate.
 * In-app disclosure, Sept 2026: "Net APR 6.21% · Includes platform fee of 1.5%" over a Morpho variable
 * rate of 4.71% — plain ADDITION, 4.71 + 1.5 = 6.21, verified against the owner's own borrow screen.
 *
 * ⚠ PROVENANCE: this comes from the in-app disclosure, NOT the help centre. As of this writing the public
 * pages still describe the loan as having "no Coinbase fees" with rates "set by open lending markets" —
 * they have not caught up with the product. The screenshot is the newer, authoritative source. Named as a
 * constant precisely because it is a Coinbase pricing decision that can move; change it in ONE place.
 *
 * ⚠ It is charged MONTHLY onto the loan balance ("Platform fees are added to your loan amount on a monthly
 * basis"), which is exactly how every engine here already compounds `cbAprPct` (`cbAprPct/100/12`). So
 * folding it into the APR is the CORRECT model, not an approximation — no separate accrual is needed.
 * It is NOT the origination fee below: that one is per-borrow, this one is per-month-on-balance.
 */
export const CB_PLATFORM_FEE_PCT = 1.5;

/**
 * Morpho's published variable borrow APY → the rate the owner ACTUALLY pays. Morpho's API reports the
 * market rate; Coinbase adds its platform fee before billing. Every place that turns a Morpho reading
 * into a `cbAprPct` must go through here, or the model understates the cost of the loan by 1.5 points.
 *
 * ⚠ Do NOT confuse Coinbase's "Net APR" (market rate PLUS Coinbase's fee — bigger) with Morpho's
 * `netBorrowApy` field (market rate MINUS reward incentives — smaller). Opposite directions, same word.
 */
export function cbNetApr(morphoApyPct: number | null): number | null {
  if (morphoApyPct === null || !Number.isFinite(morphoApyPct)) return null;
  return morphoApyPct + CB_PLATFORM_FEE_PCT;
}

/**
 * The APR a FRESH install / reset / onboarding draft starts at. Derived, not typed: it is the market rate
 * that was observed when this seed was chosen, plus the platform fee — so if `CB_PLATFORM_FEE_PCT` ever
 * changes, every seed site moves with it and none can silently keep an understated figure.
 *
 * ⚠ WHY THIS EXISTS: the platform-fee change moved the store's initial `cbAprPct` 4.77 → 6.27 but left
 * FOUR other seed sites hard-coded at 4.77 — and one of them, the OnboardingModal draft, writes over the
 * store default on first launch, so every new owner still got the understated rate. The fix was not to
 * edit four literals; it was to stop having four literals. A test pins every site to this constant.
 */
export const CB_MARKET_APR_SEED_PCT = 4.77;
export const CB_APR_SEED_PCT        = CB_MARKET_APR_SEED_PCT + CB_PLATFORM_FEE_PCT;   // 6.27

export const CB_FEE_TIER1_PCT = 0.02;
export const CB_FEE_TIER2_PCT = 0.01;
export const CB_FEE_TIER_BREAK = 250_000;

/**
 * Fee on borrowing `amount` when the loan already stands at `balance`. MARGINAL brackets, like tax:
 * the slice of the new borrow that lands under $250k pays 2%, the slice above pays 1%. Guards negatives
 * and non-finite inputs to 0 so a degenerate call can never inject NaN into the debt.
 */
export function cbBorrowFee(amount: number, balance: number): number {
  if (!(amount > 0) || !Number.isFinite(balance)) return 0;
  const base = Math.max(0, balance);
  const inTier1 = Math.max(0, Math.min(base + amount, CB_FEE_TIER_BREAK) - base);
  const inTier2 = amount - inTier1;
  return inTier1 * CB_FEE_TIER1_PCT + inTier2 * CB_FEE_TIER2_PCT;
}

/**
 * Inverse of `cbBorrowFee`: the largest CASH draw whose principal-plus-capitalised-fee still fits in
 * `headroom`, given the loan already stands at `balance`. Solves `d + cbBorrowFee(d, balance) = headroom`
 * on the SAME marginal brackets, so a caller filling to an LTV target doesn't breach it by the fee.
 * Lives here, beside the brackets, so the two can never drift apart.
 */
export function cbMaxDrawForHeadroom(headroom: number, balance: number): number {
  if (!(headroom > 0) || !Number.isFinite(balance)) return 0;
  const base      = Math.max(0, balance);
  const tier1Room = Math.max(0, CB_FEE_TIER_BREAK - base);   // cash that still fits under the break
  const tier1Cost = tier1Room * (1 + CB_FEE_TIER1_PCT);      // what that cash costs, fee included
  if (headroom <= tier1Cost) return headroom / (1 + CB_FEE_TIER1_PCT);
  return tier1Room + (headroom - tier1Cost) / (1 + CB_FEE_TIER2_PCT);
}

export interface CbLoanInputs {
  loanBalance:   number;
  collateralBtc: number;
  aprPct:        number;
  monthlyPayment: number;
  btcPrice:      number;
}

export type CbLtvStatus =
  | 'safe'
  | 'watch'
  | 'warning'
  | 'emergency'
  | 'critical'
  | 'liquidated';

export interface CbMonthRow {
  month:     number;
  balance:   number;
  interest:  number;
  payment:   number;
  netChange: number;
  ltv:       number;
  status:    CbLtvStatus;
}

export interface CbLoanProjection {
  rows:           CbMonthRow[];
  finalBalance:   number;
  finalLtv:       number;
  totalInterest:  number;
  totalPayments:  number;
}

export function classifyLtv(ltv: number): CbLtvStatus {
  if (ltv < 0.55) return 'safe';
  if (ltv < CB_WARN_LTV) return 'watch';
  if (ltv < 0.70) return 'warning';
  if (ltv < 0.84) return 'emergency';
  if (ltv < 0.86) return 'critical';
  return 'liquidated';
}

export function runCoinbaseLoan(inputs: CbLoanInputs): CbLoanProjection {
  const { loanBalance, collateralBtc, aprPct, monthlyPayment, btcPrice } = inputs;
  const monthlyRate = aprPct / 100 / 12;

  let balance = loanBalance;
  const rows: CbMonthRow[] = [];
  let totalInterest = 0;
  let totalPayments = 0;

  for (let month = 1; month <= 12; month++) {
    const prevBalance = balance;

    const interest = balance * monthlyRate;
    balance += interest;

    const payment = Math.min(monthlyPayment, balance);
    balance -= payment;

    const netChange = balance - prevBalance;
    const ltv = balance / (collateralBtc * btcPrice);

    totalInterest += interest;
    totalPayments += payment;

    rows.push({ month, balance, interest, payment, netChange, ltv, status: classifyLtv(ltv) });
  }

  return {
    rows,
    finalBalance:  balance,
    finalLtv:      rows[11].ltv,
    totalInterest,
    totalPayments,
  };
}

export interface LiquidationScenario {
  repayPct:               number;
  debtRepaid:             number;
  collateralSeizedUsd:    number;
  collateralSeizedBtc:    number;
  lifBonus:               number;
  remainingDebt:          number;
  remainingCollateralBtc: number;
  remainingCollateralUsd: number;
  newLtv:                 number;
  stillLiquidatable:      boolean;
}

export interface LiquidationAnalysis {
  userSuppliedPrice:          number;
  effectivePrice:             number;
  isAlreadyLiquidatable:      boolean;
  lif:                        number;
  lifPct:                     number;
  collateralAtEffectivePrice: number;
  equity:                     number;
  scenarios:                  LiquidationScenario[];
}

export function computeLiquidationAnalysis(
  loanBalance:      number,
  collateralBtc:    number,
  btcPrice:         number,
  liquidationPrice: number,
): LiquidationAnalysis {
  const isAlreadyLiquidatable     = btcPrice <= liquidationPrice;
  const effectivePrice             = isAlreadyLiquidatable ? btcPrice : liquidationPrice;
  const collateralAtEffectivePrice = collateralBtc * effectivePrice;
  const equity                     = collateralAtEffectivePrice - loanBalance;

  const scenarios: LiquidationScenario[] = ([0.25, 0.50, 0.75, 1.0] as const).map((repayPct) => {
    const debtRepaid             = loanBalance * repayPct;
    const collateralSeizedUsd    = debtRepaid * CB_LIF;
    const collateralSeizedBtc    = collateralSeizedUsd / effectivePrice;
    const lifBonus               = debtRepaid * (CB_LIF - 1);
    const remainingDebt          = loanBalance - debtRepaid;
    const remainingCollateralBtc = collateralBtc - collateralSeizedBtc;
    const remainingCollateralUsd = remainingCollateralBtc * effectivePrice;
    const newLtv                 = remainingCollateralUsd > 0 ? remainingDebt / remainingCollateralUsd : 0;
    return {
      repayPct, debtRepaid, collateralSeizedUsd, collateralSeizedBtc,
      lifBonus, remainingDebt, remainingCollateralBtc, remainingCollateralUsd,
      newLtv, stillLiquidatable: newLtv >= CB_LLTV,
    };
  });

  return {
    userSuppliedPrice: liquidationPrice,
    effectivePrice,
    isAlreadyLiquidatable,
    lif:    CB_LIF,
    lifPct: (CB_LIF - 1) * 100,
    collateralAtEffectivePrice,
    equity,
    scenarios,
  };
}
