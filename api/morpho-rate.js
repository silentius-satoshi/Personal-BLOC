// Same-origin proxy for the Morpho borrow APY of the confirmed cbBTC/USDC Base market.
// Hardcodes the on-chain-confirmed market (the user's loan position lives here): cbBTC collateral /
// USDC loan / 86% LLTV. Same-origin to dodge any CORS question; s-maxage to share across tabs and
// respect the API's no-SLA posture. Mirrors api/btc-candles.js, but POSTs a GraphQL query.
// Schema note: this endpoint's Market type uses `marketId`, NOT `uniqueKey` (the latter throws).
const MARKET_ID = '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836';
const CHAIN_ID  = 8453; // Base

export default async function handler(req, res) {
  const query = `query { marketById(marketId: "${MARKET_ID}", chainId: ${CHAIN_ID}) { state { borrowApy netBorrowApy } } }`;
  try {
    const r = await fetch('https://api.morpho.org/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!r.ok) {
      res.status(502).json({ error: `Upstream ${r.status}` });
      return;
    }
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate'); // 5-min cache; the rate drifts slowly
    res.json(data);   // { data: { marketById: { state: { borrowApy, netBorrowApy } } } } — verbatim
  } catch (e) {
    res.status(500).json({ error: 'Proxy error' });
  }
}
