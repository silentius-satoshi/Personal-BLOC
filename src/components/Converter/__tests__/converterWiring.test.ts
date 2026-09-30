import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⚠ STRUCTURAL GUARD — the Sats face's rates (spec `pbloc-spec-sats-rates-v1.md`). The repo has no render harness, so the
 * wiring is read off the source. Each check was proven red by its named mutation before it landed.
 */
const DIR = join(process.cwd(), 'src/components/Converter');
const read = (f: string): string => readFileSync(join(DIR, f), 'utf8');
const MAIN = read('ConverterMain.tsx');
const SIDEBAR = read('ConverterSidebar.tsx');
const SIDEBAR_CSS = read('ConverterSidebar.module.css');

/** The text from `open` through the first `close` after it — '' when either is missing. */
const slice = (src: string, open: string, close: string): string => {
  const at = src.indexOf(open);
  if (at < 0) return '';
  const end = src.indexOf(close, at);
  return end < 0 ? '' : src.slice(at, end + close.length);
};

describe('⭐ the Satoshi Rates — under the converter, and a row fills it', () => {
  it('⭐ the sidebar renders no table: the rates left it, with their store writes and their styles', () => {
    // mutation W1: the old table block pasted back into ConverterSidebar → red
    expect(SIDEBAR).not.toMatch(/<table|Satoshi Rates/);
    expect(SIDEBAR).not.toMatch(/setConverter(?:ActiveField|RawValue)|setStored(?:ActiveField|RawValue)/);
    expect(SIDEBAR_CSS).not.toMatch(/\.table\b|\.tableCard\b/);
    for (const h of ['Sats Per Dollar', 'Bitcoin Price', 'Key Equivalences', 'What is a Satoshi?']) {
      expect(SIDEBAR, h).toContain(`>${h}</div>`);
    }
  });

  it('⭐ S2 — a row fills the converter through the fields\' own updates, never the store setters', () => {
    // mutations W2: the row back on setStoredActiveField / setStoredRawValue; W3: the row's onKeyDown dropped → red
    const fill = slice(MAIN, 'const fillFromRate = (sats: number) => {', '};');
    expect(fill, 'fillFromRate').not.toBe('');
    expect(fill).toMatch(/updateActiveField\('sats'\);/);
    expect(fill).toMatch(/updateRawValue\(String\(sats\)\);/);
    expect(fill).not.toMatch(/setStored|setConverter/);
    // The store is written ONLY by the fields' own updates — once each.
    expect(MAIN.match(/setStoredActiveField\(/g) ?? []).toHaveLength(1);
    expect(MAIN.match(/setStoredRawValue\(/g) ?? []).toHaveLength(1);
    expect(slice(MAIN, 'const updateActiveField = ', '};')).toMatch(/setStoredActiveField\(field\);/);
    expect(slice(MAIN, 'const updateRawValue = ', '};')).toMatch(/setStoredRawValue\(value\);/);
    // The row itself — sliced, because ConverterField has an Enter handler of its own.
    const row = slice(MAIN, '<tr key={r.sats} role="button" tabIndex={0}', '</tr>');
    expect(row, 'the row').not.toBe('');
    expect(row).toMatch(/onClick=\{\(\) => fillFromRate\(r\.sats\)\}/);
    expect(row).toMatch(
      /onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter' \|\| e\.key === ' '\) \{ e\.preventDefault\(\); fillFromRate\(r\.sats\); \} \}\}/,
    );
  });

  it('⭐ S4 and D1 reach the screen: the rows come from rateRows, in a section after the converter card', () => {
    // mutation W4: a row's dollar cell back on inline `fmtUsdLocal((r.sats / SATS_PER_BTC) * btcPrice)` → red
    const card = MAIN.indexOf('className={styles.converterCard}');
    const open = '<section className={styles.ratesCard}';
    const section = slice(MAIN, open, '</section>');
    expect(card, 'the converter card').toBeGreaterThan(0);
    expect(section, 'the rates section').not.toBe('');
    expect(MAIN.indexOf(open)).toBeGreaterThan(card);
    expect(MAIN).toMatch(/rateRows\(btcPrice\)/);
    expect(section).toMatch(/rates\.map\(/);
    // The cells print the helper's text: no price and no formatting in the section (the converter's own maths stays
    // outside it).
    expect(section).not.toMatch(/btcPrice|SATS_PER_BTC|fmtUsdLocal\(|toFixed\(|toLocaleString\(/);
    // ONE definition of the unit and the dollar formatter the Sats page shares: converterView.ts.
    for (const [name, src] of [['ConverterMain', MAIN], ['ConverterSidebar', SIDEBAR]] as const) {
      expect(src, name).not.toMatch(/const SATS_PER_BTC\s*=|function fmtUsdLocal\(/);
    }
    expect(read('converterView.ts')).toMatch(/export const SATS_PER_BTC = 100_000_000;/);
    expect(read('converterView.ts')).toMatch(/export function fmtUsdLocal\(/);
  });
});
