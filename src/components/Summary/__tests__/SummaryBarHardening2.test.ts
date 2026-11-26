import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Hardening 2 — SummaryBar.tsx's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HS.json).
 * The store is mocked: a selector over a plain object (renderToStaticMarkup reads zustand's initial state, not a test's
 * setState — noPlanNotice.test.tsx's pattern). SYNTHETIC round figures.
 */
const h = vi.hoisted(() => ({ state: { income: 5_000, expenses: 4_000 } }));
vi.mock('../../../store/useStore', () => ({ useStore: (sel: (s: typeof h.state) => unknown) => sel(h.state) }));

import { SummaryBar } from '../SummaryBar';

const render = (income: number, expenses: number) => {
  Object.assign(h.state, { income, expenses });
  return renderToStaticMarkup(createElement(SummaryBar));
};

describe('Hardening 2 — SummaryBar', () => {
  it('HS-38 · ui.md "`SummaryBar fmtUSD`" (local, sign-preserving) — a deficit prints its minus sign, not only the red', () => {
    const deficit = render(4_000, 5_000);
    const surplus = render(5_000, 4_000);
    expect([deficit.includes('>-$1,000<'), surplus.includes('>$1,000<')], 'HS-38 the sign is printed: [deficit, surplus]')
      .toEqual([true, true]);
  });
});
