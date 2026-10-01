import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PL_SERIES, powerLawTooltip, historyDrawn, legendEntries, todayTiles, modelLines, fmtCoef, fmtMonthYear,
} from '../powerLawView';
import { PL_BAND_LABEL, PL_A_FAIR, PL_A_FLOOR, PL_A_CEILING } from '../../../simulation/powerLaw';

/**
 * The Power Law view model. The chart's (spec `pbloc-spec-powerlaw-polish-v1.md`): ONE series table that the chart, the
 * tooltip and the legend all read; the tooltip, dated in UTC and never "$0"; the legend rule. The face's (spec
 * `pbloc-spec-powerlaw-face-v1.md`): today's tiles and the model card, every figure read off the model. Round synthetic
 * figures only. Each ⭐ names the mutation that turns it red.
 */

/** A top-level function's text, from `function <name>(` to its closing brace at column 0. */
const fnBody = (src: string, name: string): string => {
  const at = src.indexOf(`function ${name}(`);
  return at < 0 ? '' : src.slice(at, src.indexOf('\n}\n', at) + 2);
};
const VIEW_SRC = readFileSync(join(process.cwd(), 'src/components/PowerLaw/powerLawView.ts'), 'utf8');

describe('⭐ PL_SERIES — one colour and one name per concept (D1, D2, P5)', () => {
  it('⭐ the labels are PL_BAND_LABEL\'s plus "History"; the colours are tokens, all distinct; only Resistance is dashed', () => {
    // mutations: "Fair Value" for Fair; History given Fair's colour; Support dashed
    const by = Object.fromEntries(PL_SERIES.map((s) => [s.key, s]));
    expect(PL_SERIES.map((s) => s.key)).toEqual(['price', 'ceiling', 'fair', 'floor']);
    expect(PL_SERIES.map((s) => s.label)).toEqual(
      ['History', PL_BAND_LABEL.ceiling, PL_BAND_LABEL.fair, PL_BAND_LABEL.floor],
    );
    expect({ price: by.price.color, ceiling: by.ceiling.color, fair: by.fair.color, floor: by.floor.color }).toEqual({
      price: 'var(--btc)', ceiling: 'var(--amber)', fair: 'var(--text-secondary)', floor: 'var(--green)',
    });
    expect(new Set(PL_SERIES.map((s) => s.color)).size).toBe(PL_SERIES.length);
    expect(PL_SERIES.filter((s) => s.dash === 'dashed').map((s) => s.key)).toEqual(['ceiling']);
  });
});

describe('⭐ the tooltip — dated in UTC, never "$0"', () => {
  // ⚠ Pin a zone BEHIND UTC, or in a UTC container local time IS UTC and the local-getters mutation passes vacuously.
  // Pacific/Honolulu is UTC−10 all year (no DST). The pin takes effect only under the forks pool (P4) — vite.config
  // pins it, and the premise below fails loudly (never vacuously) if the pin didn't land.
  beforeAll(() => { vi.stubEnv('TZ', 'Pacific/Honolulu'); });
  afterAll(() => { vi.unstubAllEnvs(); });

  it('⭐ the head is the row\'s UTC date, "D Mon YYYY" — weekly rows share months, so the day is shown', () => {
    // mutation: local getters (toLocaleString('default', { month: 'short' }) + getFullYear()) → "Dec 2026"
    const t = Date.UTC(2027, 0, 1);
    expect(new Date(t).getFullYear()).toBe(2026);   // premise: the pin took effect — local time is a day behind
    expect(powerLawTooltip(t, { fair: 100_000 })!.head).toBe('1 Jan 2027');
  });

  it('⭐ vite.config pins the forks pool — the TZ pin needs it (P4)', () => {
    // mutation: remove `pool: 'forks'` → a threads run reads UTC and the premise above fails
    expect(readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8')).toMatch(/\bpool:\s*'forks'/);
  });

  it('⭐ rows: History first, then Resistance · Fair · Support; nothing missing or ≤ 0; priced by fmtTooltipUsd', () => {
    // mutations: drop the > 0 filter → a History row at $0; format with fmtUSD → "$0" for a sub-cent band
    const early = powerLawTooltip(Date.UTC(2010, 5, 1), { price: 0, ceiling: 0.2, fair: 0.1, floor: 1e-12 })!;
    expect(early.rows.map((r) => r.label)).toEqual([PL_BAND_LABEL.ceiling, PL_BAND_LABEL.fair, PL_BAND_LABEL.floor]);
    expect(early.rows.map((r) => r.text)).toEqual(['$0.20', '$0.10', 'under $0.01']);
    const full = powerLawTooltip(Date.UTC(2026, 0, 1), { price: 90_000, ceiling: 200_000, fair: 100_000, floor: 40_000 })!;
    expect(full.rows.map((r) => r.label)).toEqual(
      ['History', PL_BAND_LABEL.ceiling, PL_BAND_LABEL.fair, PL_BAND_LABEL.floor],
    );
    expect(full.rows.map((r) => r.text)).toEqual(['$90,000', '$200,000', '$100,000', '$40,000']);
    expect(powerLawTooltip(Date.UTC(2026, 0, 1), {})).toBeNull();
    expect(powerLawTooltip(Number.NaN, { fair: 100_000 })).toBeNull();
  });
});

describe('⭐ the legend — only what is drawn (D5, P3)', () => {
  it('⭐ History only once two rows carry a positive price; the three bands always', () => {
    // mutation: `priced >= 1` → one priced row lists History
    const rows = (prices: (number | undefined)[]) => prices.map((price, i) => ({ timestamp: i, price }));
    expect(historyDrawn(rows([undefined, 0, 0, 50_000, undefined]))).toBe(false);   // one priced row draws nothing
    expect(historyDrawn(rows([0, 0, 0]))).toBe(false);                               // blockchain.info's $0 prefix
    expect(historyDrawn(rows([Number.NaN, Number.POSITIVE_INFINITY, 50_000]))).toBe(false);
    expect(historyDrawn(rows([0, 40_000, 50_000]))).toBe(true);
    const bands = [PL_BAND_LABEL.ceiling, PL_BAND_LABEL.fair, PL_BAND_LABEL.floor];
    expect(legendEntries(false).map((s) => s.label)).toEqual(bands);
    expect(legendEntries(true).map((s) => s.label)).toEqual(['History', ...bands]);
  });
});

// ── The face (spec pbloc-spec-powerlaw-face-v1) ───────────────────────────────────────────────────────────────────

/** Round synthetic bands — the real ones grow every day. */
const BANDS = { floor: 40_000, fair: 100_000, ceiling: 200_000 };

describe('⭐ today\'s tiles — the price, vs Fair and the three bands (I5)', () => {
  it('⭐ with a price: Price · vs Fair · Resistance · Fair · Support — labels from PL_BAND_LABEL, values through fmtUSD, the band colours', () => {
    // mutations: V1 Resistance `--amber` → `--red`; V2 the true minus → an ASCII hyphen
    const t = todayTiles(50_000, BANDS);
    expect(t.map((x) => x.key)).toEqual(['price', 'vsFair', 'ceiling', 'fair', 'floor']);
    expect(t.map((x) => x.label)).toEqual(
      ['Price', `vs ${PL_BAND_LABEL.fair}`, PL_BAND_LABEL.ceiling, PL_BAND_LABEL.fair, PL_BAND_LABEL.floor],
    );
    expect(t.map((x) => x.value)).toEqual(['$50,000', '−50.0%', '$200,000', '$100,000', '$40,000']);
    expect(t.map((x) => x.color)).toEqual(
      ['var(--text-primary)', 'var(--red)', 'var(--amber)', 'var(--text-primary)', 'var(--green)'],
    );
    expect(t[0].sub).toBe('live');
  });

  it('⭐ vs Fair: a true minus, no sign at 0.0, and the colour and the words follow the true side of the line', () => {
    // mutations: V2 an ASCII hyphen; V3 `above = dev > 0` (exactly on the line reads red, "below")
    const vs = (p: number) => todayTiles(p, BANDS).find((x) => x.key === 'vsFair')!;
    expect(vs(150_000)).toMatchObject({ value: '+50.0%', color: 'var(--green)', sub: 'above the fair line' });
    expect(vs(100_000)).toMatchObject({ value: '0.0%', color: 'var(--green)', sub: 'above the fair line' });
    // 0.01% under: the printed figure rounds to 0.0 (no sign); the colour and the words still say "below".
    expect(vs(99_990)).toMatchObject({ value: '0.0%', color: 'var(--red)', sub: 'below the fair line' });
    expect(vs(99_900)).toMatchObject({ value: '−0.1%', color: 'var(--red)', sub: 'below the fair line' });
  });

  it('⭐ no live price (null, 0, −1, NaN, ∞): Price reads "—" with "no live price yet", vs Fair is left out — never NaN', () => {
    // mutation: V4 the finite / positive guard dropped (0 → "$0" and "−100.0%"; NaN → "$NaN")
    for (const p of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const t = todayTiles(p, BANDS);
      expect(t.map((x) => x.key), String(p)).toEqual(['price', 'ceiling', 'fair', 'floor']);
      expect(t[0], String(p)).toMatchObject({ value: '—', sub: 'no live price yet' });
      expect(JSON.stringify(t), String(p)).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  it('⭐ the band subs are the constants\' own multiples of fair — computed, never typed', () => {
    // mutation: V5 a typed "2.1× fair"
    const sub = (k: string) => todayTiles(null, BANDS).find((x) => x.key === k)!.sub;
    expect(sub('ceiling')).toBe(`${(PL_A_CEILING / PL_A_FAIR).toFixed(2)}× fair`);
    expect(sub('ceiling')).toBe('2.07× fair');
    expect(sub('fair')).toBe('the trend line');
    expect(sub('floor')).toBe(`${(PL_A_FLOOR / PL_A_FAIR).toFixed(2)}× fair`);
    expect(sub('floor')).toBe('0.36× fair');
  });
});

describe('⭐ the model card — every figure read off the model\'s constants (D3)', () => {
  // A zone BEHIND UTC, as for the tooltip above: 1 Nov 2032 UTC is still 31 Oct in Honolulu, so a month read with local
  // getters would print "Oct 2032". (The projections alone can't show it: 29 Feb and 24 Nov stay in their months.)
  beforeAll(() => { vi.stubEnv('TZ', 'Pacific/Honolulu'); });
  afterAll(() => { vi.unstubAllEnvs(); });

  it('⭐ modelLines: the formula, the genesis date and the projections line exactly — its months in UTC', () => {
    // mutations: V7 the panel's "~2033–2035" back; V8 `toFixed(1)` in fmtCoef ("1.2 × 10⁻¹⁷"); fmtMonthYear on local
    // getters (Δ5 — "Oct 2032")
    const nov1 = new Date(Date.UTC(2032, 10, 1));
    expect(nov1.getMonth(), 'premise: local time is a day behind').toBe(9);
    expect(fmtMonthYear(nov1)).toBe('Nov 2032');
    const [formula, projections, calibration] = modelLines();
    expect(formula).toContain('Fair = 1.16 × 10⁻¹⁷ × days^5.82');
    expect(formula).toContain('(3 Jan 2009)');
    expect(projections).toBe('On the model, Support reaches $100k in Feb 2028 and Fair reaches $1M in Nov 2032.');
    expect(calibration).toContain('2.07× fair');
  });

  it('⭐ derived, never typed — modelLines reads its dates and its coefficient off the model', () => {
    // mutations: V6 a hand-typed "Nov 2032" (the rendered text alone would still pass); V7 "~2033–2035" back
    const body = fnBody(VIEW_SRC, 'modelLines');
    expect(body, 'modelLines body').not.toBe('');
    expect(body.match(/\bplDateAtPrice\(/g)?.length ?? 0, 'plDateAtPrice(').toBe(2);
    expect(body).toMatch(/\bfmtCoef\(PL_A_FAIR\)/);
    expect(body, 'a typed month').not.toMatch(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\b/);
    expect(body, 'a typed year or range').not.toMatch(/~\s*20\d\d|20\d\d\s*[–-]\s*20\d\d/);
  });

  it('⭐ fmtCoef: a coefficient in scientific form, carrying a mantissa that rounds to 10', () => {
    // mutations: V8 `toFixed(1)`; the carry dropped (Δ4 — "10 × 10⁻¹⁸")
    expect(fmtCoef(1.16e-17)).toBe('1.16 × 10⁻¹⁷');
    expect(fmtCoef(4.2e-18)).toBe('4.2 × 10⁻¹⁸');
    expect(fmtCoef(2.4e-17)).toBe('2.4 × 10⁻¹⁷');
    expect(fmtCoef(1e5)).toBe('1 × 10⁵');
    expect(fmtCoef(9.999e-18)).toBe('1 × 10⁻¹⁷');
  });
});
