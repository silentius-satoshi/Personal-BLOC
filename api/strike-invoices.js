export default async function handler(req, res) {
  const apiKey = process.env.STRIKE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Strike API not configured' });
  const { limit = 20, after } = req.query;
  const params = new URLSearchParams({ limit: String(limit) });
  if (after) params.set('after', after);
  try {
    const response = await fetch(
      `https://api.strike.me/v1/invoices?${params.toString()}`,
      { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } },
    );
    if (!response.ok) return res.status(response.status).json({ error: 'Strike API error' });
    const data = await response.json();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch {
    return res.status(500).json({ error: 'Failed to fetch Strike invoices' });
  }
}
