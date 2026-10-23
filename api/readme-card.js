// The README's live card: an SVG image (GitHub runs no scripts in a README, and fetches images through Camo), so
// a reader sees today's bitcoin price and where the landing page's example loan meets each lender's line.
// All the work — the price fetch with its time limit, the drawing, the cache headers — is in _lib/readmeCard.js;
// this file only writes the answer. It always answers 200 with a valid card, so the README never shows a broken image.
import { buildReadmeCard } from './_lib/readmeCard.js';

export default async function handler(req, res) {
  const { headers, body } = await buildReadmeCard();
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.status(200).send(body);
}
