// Same-origin proxy for Coinbase Exchange candles (avoids the cross-origin CORS question that the
// api.exchange.coinbase.com host would otherwise pose from the browser). Mirrors api/btc-history.js.
const ALLOWED = new Set(['60', '300', '900', '3600', '21600', '86400']);

export default async function handler(req, res) {
  const g = String(req.query.granularity ?? '900');
  if (!ALLOWED.has(g)) {
    res.status(400).json({ error: 'bad granularity' });
    return;
  }
  try {
    const r = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=' + g);
    if (!r.ok) {
      res.status(502).json({ error: `Upstream ${r.status}` });
      return;
    }
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.json(data);   // Coinbase's [time, low, high, open, close, volume] array, verbatim
  } catch (e) {
    res.status(500).json({ error: 'Proxy error' });
  }
}
