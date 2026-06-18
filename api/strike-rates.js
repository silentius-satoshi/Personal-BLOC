import { validateOwnerRequest } from './_lib/ownerAuth.js';

export default async function handler(req, res) {
  const apiKey = process.env.STRIKE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Strike API not configured' });
  // NIP-98 owner-signed request (replaces the old shared x-app-secret). PUBLIC_ORIGIN + req.url must equal
  // the client's `u` tag exactly (the absolute deploy URL — trailing-slash-sensitive).
  const url  = `${process.env.PUBLIC_ORIGIN}${req.url}`;
  const auth = await validateOwnerRequest(req.headers['authorization'], url, req.method, process.env.OWNER_PUBKEY);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.status === 403 ? 'Forbidden' : 'Unauthorized' });
  }
  try {
    const response = await fetch(
      'https://api.strike.me/v1/rates/ticker?sourceCurrency=BTC&targetCurrency=USD',
      { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } },
    );
    if (!response.ok) return res.status(response.status).json({ error: 'Strike API error' });
    const data = await response.json();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch {
    return res.status(500).json({ error: 'Failed to fetch Strike rate' });
  }
}
