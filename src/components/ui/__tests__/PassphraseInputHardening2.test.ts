import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PassphraseInput } from '../PassphraseInput';

/**
 * Hardening 2 — PassphraseInput.tsx's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HS.json).
 * The masked field rendered to static markup (sweep2cA11y.test.ts's way), its <input> read for the four iOS suppressions.
 */
const SUPPRESSIONS = ['autocomplete="off"', 'autocorrect="off"', 'autocapitalize="none"', 'spellcheck="false"'];

describe('Hardening 2 — PassphraseInput', () => {
  it('HS-40 · ui.md "Every masked field goes through `ui/PassphraseInput`" (the widget keeps the four iOS suppressions) — the masked input carries all four', () => {
    const html = renderToStaticMarkup(createElement(PassphraseInput, { value: '', onChange: () => {} }));
    // HTML attribute names are case-insensitive, and React prints these three in camelCase (autoComplete="off").
    const input = (html.match(/<input[^>]*>/)?.[0] ?? '').toLowerCase();
    expect(input.includes('type="password"'), 'HS-40 premise: the field is masked').toBe(true);
    expect(SUPPRESSIONS.filter((a) => !input.includes(a)), 'HS-40 no suppression missing — iOS would capitalize a passphrase').toEqual([]);
  });
});
