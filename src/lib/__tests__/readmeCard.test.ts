import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SPOT_URL, EXAMPLE_COLLATERAL_BTC, EXAMPLE_BORROWED_USD, STRIKE_MARGIN_CALL_LTV as CARD_STRIKE_MARGIN_CALL,
  STRIKE_PARTIAL_LIQ_LTV, CB_LLTV as CARD_CB_LLTV, LENDER_LINES,
  parseSpot, cardModel, fmtUsd, fmtLtv, fmtUtc, renderReadmeCard, buildReadmeCard,
  type SpotResponse,
} from '../../../api/_lib/readmeCard.js';
import { CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { STRIKE_MARGIN_CALL_LTV } from '../../simulation/emergencyModel';
import { createCbLoanSlice } from '../../store/slices/cbLoanSlice';
import { fmtLtvPct } from '../../utils/format';

// The README's live card (api/readme-card.js → api/_lib/readmeCard.js). Its numbers are the app's, so the parity
// tests come first: a threshold or the example loan changing on either side turns this file red.

const NOW = new Date(Date.UTC(2026, 9, 20, 23, 41, 7));
const ok = (amount: unknown): SpotResponse => ({ ok: true, json: async () => ({ data: { amount } }) });

describe('readme card — parity with the app', () => {
  it('uses the app thresholds: CB_LLTV, STRIKE_MARGIN_CALL_LTV and the store default Strike partial liquidation', () => {
    expect(CARD_CB_LLTV).toBe(CB_LLTV);
    expect(CARD_STRIKE_MARGIN_CALL).toBe(STRIKE_MARGIN_CALL_LTV);
    const slice = createCbLoanSlice((() => {}) as never, (() => ({})) as never);
    expect(STRIKE_PARTIAL_LIQ_LTV).toBe(slice.strikeLiquidationLtvPct / 100);
    expect(LENDER_LINES.map((l) => l.ltv)).toEqual([STRIKE_MARGIN_CALL_LTV, slice.strikeLiquidationLtvPct / 100, CB_LLTV]);
  });

  it("uses the landing crash-test widget's default loan (1 BTC, $20,000)", () => {
    const landing = readFileSync(join(process.cwd(), 'src', 'pages', 'LandingPage.tsx'), 'utf8');
    expect(landing).toContain(`const [colRaw, setColRaw] = useState('${EXAMPLE_COLLATERAL_BTC}');`);
    expect(landing).toContain(`const [borRaw, setBorRaw] = useState('${EXAMPLE_BORROWED_USD}');`);
  });

  it('reads the same spot endpoint useBtcPrice polls', () => {
    const hook = readFileSync(join(process.cwd(), 'src', 'hooks', 'useBtcPrice.ts'), 'utf8');
    expect(hook).toContain(`'${SPOT_URL}'`);
  });

  it('formats an LTV exactly as fmtLtvPct does', () => {
    for (const f of [0, 0.2414, 0.25, 0.7, 0.8, 0.86, 1.25, Infinity]) expect(fmtLtv(f)).toBe(fmtLtvPct(f));
  });
});

describe('readme card — numbers', () => {
  it('parseSpot takes a positive amount and nothing else', () => {
    expect(parseSpot({ data: { amount: '82894.30' } })).toBe(82894.3);
    for (const bad of [null, undefined, {}, { data: {} }, { data: { amount: 'abc' } }, { data: { amount: '0' } },
      { data: { amount: '-5' } }, { data: { amount: 'Infinity' } }]) {
      expect(parseSpot(bad)).toBeNull();
    }
  });

  it("a line's price is the loan over collateral × its LTV; LTV and each fall come from today's price", () => {
    const m = cardModel(80_000);
    expect(m.ltv).toBe(0.25);
    expect(m.lines.map((l) => Math.round(l.triggerPrice))).toEqual([28_571, 23_529, 23_256]);
    expect(m.lines[0].fall).toBeCloseTo(1 - 28_571.428571 / 80_000, 6);
    const unknown = cardModel(null);
    expect(unknown.ltv).toBeNull();
    expect(unknown.lines.map((l) => l.fall)).toEqual([null, null, null]);
    expect(unknown.lines.map((l) => l.triggerPrice)).toEqual(m.lines.map((l) => l.triggerPrice));
  });

  it('prints whole dollars with commas and the time in UTC', () => {
    expect(fmtUsd(82_894.5)).toBe('$82,895');
    expect(fmtUsd(1_234_567.4)).toBe('$1,234,567');
    expect(fmtUsd(999)).toBe('$999');
    expect(fmtUtc(NOW)).toBe('20 Oct 2026, 23:41 UTC');
    expect(fmtUtc(new Date(Date.UTC(2027, 0, 3, 4, 5)))).toBe('3 Jan 2027, 04:05 UTC');
  });
});

describe('readme card — the drawing', () => {
  it('live: the price, the LTV, every line with its fall, and when it was drawn', () => {
    const svg = renderReadmeCard({ price: 82_835.12, now: NOW });
    for (const s of ['>LIVE<', '>$82,835<', '>24.1%<', '>$28,571<', '>$23,529<', '>$23,256<', '>66%<', '>72%<',
      'Updated 20 Oct 2026, 23:41 UTC', 'Example loan: $20,000 against 1 BTC']) expect(svg).toContain(s);
    expect(svg).not.toContain('reached');
  });

  it('a price past a line says reached, and only for that line', () => {
    const svg = renderReadmeCard({ price: 25_000, now: NOW });   // under the $28,571 margin call, over both liquidations
    expect(svg.match(/>reached</g)).toHaveLength(1);
    expect(svg).toContain('>80.0%<');
    expect(svg).toContain('>6%<');
    expect(svg).toContain('>7%<');
  });

  it('no price: still a full card with every line, and no live claim', () => {
    const svg = renderReadmeCard({ price: null, now: NOW });
    expect(svg).toContain('Price unavailable right now');
    for (const s of ['>$28,571<', '>$23,529<', '>$23,256<']) expect(svg).toContain(s);
    expect(svg).not.toContain('>LIVE<');
    expect(svg).not.toContain('Updated');
    expect(svg).not.toContain('loan-to-value');
  });

  it('is one well-formed, script-free SVG document', () => {
    for (const price of [82_835.12, 25_000, null]) {
      const svg = renderReadmeCard({ price, now: NOW });
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
      expect(svg.match(/<text\b/g)?.length).toBe(svg.match(/<\/text>/g)?.length);
      expect(svg.match(/<tspan\b/g)?.length ?? 0).toBe(svg.match(/<\/tspan>/g)?.length ?? 0);
      expect(svg).not.toMatch(/<script|<foreignObject|\son[a-z]+=|href=|<!--/i);
      expect(svg).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#39;)/);   // every & is an entity
    }
  });
});

describe('readme card — the response', () => {
  it('a good price: the live card, no-cache for Camo, a minute on the CDN', async () => {
    let asked = '';
    const r = await buildReadmeCard({ fetchImpl: async (url) => { asked = url; return ok('82835.12'); }, now: NOW });
    expect(asked).toBe(SPOT_URL);
    expect(r.headers).toEqual({
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Vercel-CDN-Cache-Control': 'max-age=60',
    });
    expect(r.body).toContain('>$82,835<');
  });

  it('refused, failed, malformed or stalled: the offline card, cached for 10 s only', async () => {
    const stall = (_url: string, init: { signal: AbortSignal }) => new Promise<SpotResponse>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });
    const cases: Array<(url: string, init: { signal: AbortSignal }) => Promise<SpotResponse>> = [
      async () => { throw new TypeError('fetch failed'); },
      async () => ({ ok: false, json: async () => ({}) }),
      async () => ok('not a number'),
      async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } }),
      stall,
    ];
    for (const fetchImpl of cases) {
      const r = await buildReadmeCard({ fetchImpl, now: NOW, timeoutMs: 20 });
      expect(r.headers['Vercel-CDN-Cache-Control']).toBe('max-age=10');
      expect(r.headers['Content-Type']).toBe('image/svg+xml; charset=utf-8');
      expect(r.body).toContain('Price unavailable right now');
    }
  });
});
