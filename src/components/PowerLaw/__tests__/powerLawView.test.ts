import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PL_SERIES, powerLawTooltip, historyDrawn, legendEntries } from '../powerLawView';
import { PL_BAND_LABEL } from '../../../simulation/powerLaw';

/**
 * The Power Law chart's view model (spec `pbloc-spec-powerlaw-polish-v1.md`): ONE series table that the chart, the
 * tooltip and the legend all read; the tooltip, dated in UTC and never "$0"; the legend rule. Round synthetic
 * figures only. Each ⭐ names the mutation that turns it red.
 */

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
