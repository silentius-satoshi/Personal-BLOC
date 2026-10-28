// BL33 (Batch 1, build 2c) — Settings → Strike Strategy's COLD STORAGE group: its own group after the Strike BLOC's, in
// plain words. No DOM harness renders SettingsMain, so its wiring is read off the source (the e2e types into the field);
// the words are pure. ⚠ The field is bound to the LIVE total — a field bound to the anchor would re-stamp it on a mere
// focus-and-leave and silently drop every cold move since (coldStorage.test.ts proves the live binding lossless).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { COLD_GROUP_LEAD, COLD_FIELD_LABEL, COLD_HOW, coldAsOfLine } from '../coldStorageView';
import { NumberInput } from '../../ui/NumberInput';

const MAIN = readFileSync(join(process.cwd(), 'src/components/Settings/SettingsMain.tsx'), 'utf8');
const AT = Date.UTC(2026, 9, 5, 12);   // 2026-10-05, noon UTC — the same local day from UTC−11 to UTC+11

describe('⭐ COLD WORDS — what the figure is made of, in the owner\'s words', () => {
  it('⭐ COLD AS-OF — the day it was entered, and the moves since', () => {
    expect(coldAsOfLine(AT, 0)).toBe('Entered 2026-10-05.');
    // "since", never "logged since": N is the derive's — a move logged later but dated before the entry is inside it.
    expect(coldAsOfLine(AT, 1)).toBe('Entered 2026-10-05, plus 1 move since.');
    expect(coldAsOfLine(AT, 2)).toBe('Entered 2026-10-05, plus 2 moves since.');
    // Never dated (a legacy anchor), or a stamp the derive can't read: every move counts there, so it isn't "entered".
    expect(coldAsOfLine(null, 0)).toBe('Not dated yet — enter your total once to date it.');
    expect(coldAsOfLine(Number.NaN, 3)).toBe('Not dated yet — enter your total once to date it.');
  });

  it('⭐ COLD WORDS — where it counts and how it changes; no "anchor", no journal or sweep jargon', () => {
    expect(COLD_GROUP_LEAD).toContain('pledged to nobody');
    expect(COLD_GROUP_LEAD).toContain('net coins (your goal)');
    expect(COLD_GROUP_LEAD).toContain("never in a loan's LTV");
    expect(COLD_HOW).toContain('Daily → Collateral → Cold');
    expect(COLD_HOW).toContain('Entering a new total here sets it as of today.');
    expect(COLD_FIELD_LABEL).toBe('Total in cold storage');
    for (const w of [COLD_GROUP_LEAD, COLD_HOW, COLD_FIELD_LABEL, coldAsOfLine(AT, 2), coldAsOfLine(null, 0)]) {
      expect(w).not.toMatch(/anchor|journal|sweep|Almanac/i);
    }
  });
});

describe('⭐ COLD GROUP — its own group on the Strike Strategy page, bound to the live total', () => {
  const strike = MAIN.slice(MAIN.indexOf("{settingsPage === 'strike' && !viewerMode && ("), MAIN.indexOf("{settingsPage === 'customize' && !viewerMode && ("));

  it('⭐ COLD GROUP — after the Strike BLOC group closes, never inside it, and not gated on a Coinbase loan', () => {
    const bloc = strike.indexOf('>STRIKE BLOC<');
    const start = strike.indexOf('Strategy start date');
    const cold = strike.indexOf('>COLD STORAGE<');
    expect(bloc, 'COLD GROUP the Strike BLOC group').toBeGreaterThan(0);
    expect(start, 'COLD GROUP the Strike BLOC group\'s last field').toBeGreaterThan(bloc);
    expect(cold, 'COLD GROUP after it').toBeGreaterThan(start);
    expect(strike.slice(bloc, cold), 'COLD GROUP not inside the Strike BLOC group').not.toContain('setColdStorageBtc');
    expect((MAIN.match(/onChange=\{setColdStorageBtc\}/g) ?? []).length, 'COLD GROUP one cold field').toBe(1);
    expect(strike.slice(start, cold + '>COLD STORAGE</div>'.length), 'COLD GROUP its own group').toMatch(/<div className=\{styles\.setupGroup\}>\s*<div className=\{styles\.setupGroupLabel\}>COLD STORAGE<\/div>/);
    expect(strike, 'COLD GROUP never behind hasCbLoan').not.toMatch(/hasCbLoan\s*(?:&&|\?)/);
  });

  it('⭐ COLD FIELD — the live total, written through the store, at sat precision, named for a screen reader', () => {
    expect(MAIN, 'COLD FIELD the live total').toMatch(/const coldStorageLive\s+= useStore\(\(s\) => s\.getCurrentColdBtc\(\)\);/);
    const field = strike.slice(strike.indexOf('>COLD STORAGE<'));
    expect(field).toMatch(/<NumberInput\s+label=\{COLD_FIELD_LABEL\}\s+ariaLabel=\{COLD_FIELD_LABEL\}\s+value=\{coldStorageLive\}\s+onChange=\{setColdStorageBtc\}/);
    expect(field).toMatch(/decimals=\{8\}/);
    expect(field, 'COLD FIELD never the raw anchor').not.toMatch(/value=\{coldStorageBtc\}/);
    expect(field).toMatch(/\{coldAsOfLine\(coldStorageBtcAsOf, coldMovesSince\)\}/);
    expect(field.indexOf('{COLD_GROUP_LEAD}'), 'COLD FIELD the lead first').toBeLessThan(field.indexOf('<NumberInput'));
    expect(field.indexOf('{COLD_HOW}'), 'COLD FIELD how it changes, last').toBeGreaterThan(field.indexOf('{coldAsOfLine('));
  });

  it('⭐ COLD FIELD — NumberInput names its input only when asked (every other field renders as before)', () => {
    const named = renderToStaticMarkup(createElement(NumberInput, { value: 0.5, onChange: () => {}, save: 'button', label: COLD_FIELD_LABEL, ariaLabel: COLD_FIELD_LABEL, decimals: 8 }));
    expect(named).toMatch(/<input [^>]*aria-label="Total in cold storage"/);
    expect(named).toContain('value="0.50000000"');
    const plain = renderToStaticMarkup(createElement(NumberInput, { value: 0.5, onChange: () => {}, save: 'button', label: COLD_FIELD_LABEL }));
    expect(plain).not.toContain('aria-label');
  });

  it('⭐ MENU — the two rows say what their pages hold now', () => {
    expect(MAIN).toContain('title="Strike Strategy" subtitle="Budget, BLOC, collateral, start date, cold storage"');
    expect(MAIN).toContain('title="Your plan" subtitle="Your goal, and the support policy\'s limits and zones"');
  });
});
