export default async function handler(req, res) {
  try {
    const response = await fetch(
      'https://api.blockchain.info/charts/market-price' +
      '?timespan=all&format=json'
    );
    if (!response.ok) {
      res.status(502).json({ error: `Upstream ${response.status}` });
      return;
    }
    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Proxy error' });
  }
}
