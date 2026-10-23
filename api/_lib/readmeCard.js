// The README's live card — drawn on the server because GitHub strips scripts from READMEs and fetches every image
// through its Camo proxy. Served by api/readme-card.js, fresh per request: today's Coinbase spot price (the same
// endpoint useBtcPrice polls), and where the landing page's example loan — the crash-test widget's defaults,
// 1 BTC of collateral and $20,000 borrowed — meets each lender's line.
//
// _-prefixed dir → Vercel does NOT route this as a function. Plain ESM .js so it imports cleanly in BOTH the Vercel
// node runtime and vitest; the co-located readmeCard.d.ts lets the TS test import it under tsc -b. The thresholds
// and the example loan mirror the app's own (CB_LLTV, STRIKE_MARGIN_CALL_LTV, the store's strikeLiquidationLtvPct
// default, the widget's useState defaults) — src/lib/__tests__/readmeCard.test.ts fails if either side drifts.
// Synthetic numbers only: this repo is public.

export const SPOT_URL = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';

export const EXAMPLE_COLLATERAL_BTC = 1;
export const EXAMPLE_BORROWED_USD = 20_000;

export const STRIKE_MARGIN_CALL_LTV = 0.70;  // emergencyModel.STRIKE_MARGIN_CALL_LTV
export const STRIKE_PARTIAL_LIQ_LTV = 0.85;  // the store default strikeLiquidationLtvPct (85, Strike's published terms)
export const CB_LLTV = 0.86;                 // runCoinbaseLoan.CB_LLTV

export const LENDER_LINES = [
  { lender: 'Strike',   event: 'margin call',         ltv: STRIKE_MARGIN_CALL_LTV, tone: 'amber' },
  { lender: 'Strike',   event: 'partial liquidation', ltv: STRIKE_PARTIAL_LIQ_LTV, tone: 'red' },
  { lender: 'Coinbase', event: 'liquidation',         ltv: CB_LLTV,                tone: 'red' },
];

// Design tokens (src/styles/tokens.css) — an <img> SVG can't read CSS variables, so the hex values are copied.
const C = {
  bg: '#09090E', border: '#1E2028', btc: '#f7931a',
  text: '#E8E8E8', text2: '#D0D0D0', muted: '#888888', faint: '#555555',
  green: '#4ECB82', amber: '#F0A030', red: '#E8504A',
};

/** Coinbase's spot JSON → a positive price, or null. The same parse as useBtcPrice. */
export function parseSpot(json) {
  const price = parseFloat(json?.data?.amount ?? '');
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** The card's numbers. A line's price never depends on today's price; only the LTV and each line's fall do. */
export function cardModel(price) {
  const lines = LENDER_LINES.map((l) => {
    const triggerPrice = EXAMPLE_BORROWED_USD / (EXAMPLE_COLLATERAL_BTC * l.ltv);
    const fall = price == null ? null : 1 - triggerPrice / price;   // ≤ 0 → the price is already past this line
    return { ...l, triggerPrice, fall };
  });
  const ltv = price == null ? null : EXAMPLE_BORROWED_USD / (EXAMPLE_COLLATERAL_BTC * price);
  return { price, ltv, lines };
}

/** Whole dollars with thousands commas — no Intl, so every runtime prints the same string. */
export function fmtUsd(n) {
  return '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** utils/format.fmtLtvPct's output, one decimal (the test pins the two together). */
export function fmtLtv(fraction) {
  if (!Number.isFinite(fraction)) return fraction > 0 ? '∞' : '—';
  return `${(fraction * 100).toFixed(1)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

/** "20 Oct 2026, 23:41 UTC" — read off the UTC fields, so the server's zone never matters. */
export function fmtUtc(d) {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const W = 830;
const H = 326;
const ROW_Y = [196, 234, 272];

/** The card as a standalone SVG document. price null → no live numbers, but still a complete, valid card. */
export function renderReadmeCard({ price, now }) {
  const m = cardModel(price);
  const live = m.price != null;
  const loan = `${fmtUsd(EXAMPLE_BORROWED_USD)} against ${EXAMPLE_COLLATERAL_BTC} BTC`;

  const summary = live
    ? `Bitcoin today: ${fmtUsd(m.price)}. Example loan: ${loan}, ${fmtLtv(m.ltv)} loan-to-value. ` +
      m.lines.map((l) => `${l.lender} ${l.event} at ${fmtUsd(l.triggerPrice)}` +
        (l.fall > 0 ? ` (a ${Math.round(l.fall * 100)}% fall)` : ' (reached)')).join(', ') + '.'
    : `Live bitcoin price unavailable. Example loan: ${loan}. ` +
      m.lines.map((l) => `${l.lender} ${l.event} at ${fmtUsd(l.triggerPrice)}`).join(', ') + '.';

  const head = live
    ? `<rect x="28" y="26" width="68" height="22" rx="11" fill="${C.green}" fill-opacity="0.12"/>
    <circle cx="42" cy="37" r="4" fill="${C.green}"/>
    <text x="52" y="41.5" font-size="11.5" font-weight="700" letter-spacing="1.2" fill="${C.green}">LIVE</text>
    <text x="110" y="42" font-size="14" fill="${C.muted}">Bitcoin today · Coinbase spot price</text>
    <text x="28" y="98" font-size="42" font-weight="800" letter-spacing="-1" fill="${C.text}" class="num">${esc(fmtUsd(m.price))}</text>`
    : `<text x="28" y="42" font-size="14" fill="${C.muted}">Bitcoin today · Coinbase spot price</text>
    <text x="28" y="94" font-size="26" font-weight="700" fill="${C.muted}">Price unavailable right now</text>`;

  const loanBlock = `<text x="802" y="60" text-anchor="end" font-size="13" fill="${C.muted}">Example loan: ${esc(loan)}</text>` +
    (live
      ? `\n    <text x="802" y="96" text-anchor="end" font-size="26" font-weight="800" fill="${C.text}" class="num">${esc(fmtLtv(m.ltv))}<tspan font-size="14" font-weight="400" fill="${C.muted}" dx="8">loan-to-value</tspan></text>`
      : '');

  const rows = m.lines.map((l, i) => {
    const y = ROW_Y[i];
    const tone = C[l.tone];
    const reached = live && l.fall <= 0;
    const fallText = !live ? '—' : reached ? 'reached' : `${Math.round(l.fall * 100)}%`;
    const fallFill = !live ? C.faint : reached ? C.red : C.text;
    return `<circle cx="34" cy="${y - 5}" r="4.5" fill="${tone}"/>
    <text x="48" y="${y}" font-size="15" fill="${C.text2}"><tspan font-weight="700" fill="${C.text}">${esc(l.lender)}</tspan> · ${esc(l.event)}<tspan fill="${C.muted}"> at ${esc(fmtLtv(l.ltv).replace('.0%', '%'))} LTV</tspan></text>
    <text x="560" y="${y}" text-anchor="end" font-size="15" fill="${C.text}" class="num">${esc(fmtUsd(l.triggerPrice))}</text>
    <text x="802" y="${y}" text-anchor="end" font-size="15" font-weight="700" fill="${fallFill}" class="num">${esc(fallText)}</text>`;
  }).join('\n    ');

  const foot = live
    ? `Updated ${fmtUtc(now)} · the app's own thresholds · planning software, not financial advice`
    : `Live price unavailable · a line's price doesn't depend on it · planning software, not financial advice`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(summary)}">
  <title>${esc(summary)}</title>
  <defs>
    <radialGradient id="glow" cx="88%" cy="0%" r="60%">
      <stop offset="0%" stop-color="${C.btc}" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="${C.btc}" stop-opacity="0"/>
    </radialGradient>
    <style>
      text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif; }
      .num { font-variant-numeric: tabular-nums; }
    </style>
  </defs>
  <rect width="${W}" height="${H}" rx="16" fill="${C.bg}"/>
  <rect width="${W}" height="${H}" rx="16" fill="url(#glow)"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="15.5" fill="none" stroke="#ffffff" stroke-opacity="0.08"/>
  <g>
    ${head}
    ${loanBlock}
    <line x1="28" y1="128" x2="802" y2="128" stroke="${C.border}" stroke-width="1"/>
    <text x="28" y="160" font-size="11.5" font-weight="700" letter-spacing="1" fill="${C.faint}">WHERE EACH LENDER ACTS</text>
    <text x="560" y="160" text-anchor="end" font-size="11.5" font-weight="700" letter-spacing="1" fill="${C.faint}">BITCOIN AT</text>
    <text x="802" y="160" text-anchor="end" font-size="11.5" font-weight="700" letter-spacing="1" fill="${C.faint}">FALL FROM TODAY</text>
    ${rows}
    <text x="28" y="${H - 18}" font-size="12" fill="${C.faint}">${esc(foot)}</text>
  </g>
</svg>
`;
}

/** The whole response, fetch injected for the test. Never fails: a stalled, refused or malformed price only drops
 *  today's numbers. Camo gets `no-cache` (GitHub's advice for an image that changes); Vercel's CDN alone keeps a
 *  copy — 60 s, or 10 s when the price failed — so README traffic reaches Coinbase at most once a minute. */
export async function buildReadmeCard({ fetchImpl = fetch, now = new Date(), timeoutMs = 3000 } = {}) {
  let price = null;
  try {
    const r = await fetchImpl(SPOT_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (r.ok) price = parseSpot(await r.json());
  } catch {
    // stalled or unreachable: the card renders without today's numbers
  }
  return {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Vercel-CDN-Cache-Control': price == null ? 'max-age=10' : 'max-age=60',
    },
    body: renderReadmeCard({ price, now }),
  };
}
