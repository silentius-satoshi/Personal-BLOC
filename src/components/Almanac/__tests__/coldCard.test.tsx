// BL33 (Batch 1, build 2c) — the cold-storage card, the SAME on the four engine faces (Cycling, Strategy, Ownership,
// Decision): the total by the run's end, where it came from, when new coins first move, and — while the support policy
// applies — how the plan uses cold, folded. Its words are pure (`coldCardView`), every sentence an existing one-definition
// helper's; the card composes nothing. ⚠ SYNTHETIC round figures (public repo).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  coldCardView, COLD_CARD_TITLE, COLD_RULES_TITLE, NOTHING_MOVES_TO_COLD, type ColdCardView,
} from '../coldCardView';
import { ColdStorageCard } from '../ColdStorageCard';
import { coldOriginsParts } from '../cyclingFaceView';
import {
  policyColdNote, policyColdGoalNote, policyReserveNote, effectivePolicySettings, DEFAULT_SUPPORT_POLICY_SETTINGS,
  GOAL_STAND_DOWN_WORDS,
} from '../supportPolicyView';
import { planMonthRun, type PlanMonthFacts } from '../planRun';
import { PLAN_POLICY_DEFAULTS } from '../../../lib/planPolicy';

const S = effectivePolicySettings({ ...DEFAULT_SUPPORT_POLICY_SETTINGS }, { cbLtvCapPct: 70, strikeCapEffPct: 60 });
const LABELS = { end: 'Oct 2031', firstCold: 'Jan 2029' };
type Sim = Parameters<typeof coldCardView>[0];
const sim = (over: Partial<Sim> = {}): Sim => ({
  policyApplied: true, openingColdBtc: 0.5, totalColdBtc: 2.5, totalColdFromCb: 1.5, totalColdFromStrike: 0.5,
  totalColdRetrievedBtc: 0, goalNetBtc: null, coldRetrievedAboveSupportBtc: 0, liqMonth: null,
  rows: [{ topUpFromColdBtc: 0 }],
  ...over,
});
const RESERVE = policyReserveNote(sim()).trim();

describe('⭐ COLD VIEW — the four faces\' one arrangement of the cold card\'s words', () => {
  it('⭐ COLD VIEW — the outcome, where it came from, when new coins first move, and the policy\'s rules in order', () => {
    expect(RESERVE, 'premise: the reserve sentence is true of this run').toMatch(/^Your reserve is spent only/);
    expect(coldCardView(sim(), S, 30, LABELS)).toEqual({
      total: '2.500 ₿',
      totalSub: 'in your own custody by Oct 2031',
      parts: coldOriginsParts(sim()),
      moves: 'New coins first move Jan 2029.',
      rules: [policyColdNote(S), RESERVE],
    } satisfies ColdCardView);
  });

  it('⭐ COLD VIEW — the goal\'s stand-down only with the goal the run applied, between the rule and the reserve', () => {
    expect(coldCardView(sim({ goalNetBtc: 2 }), S, 30, LABELS)?.rules).toEqual([policyColdNote(S), policyColdGoalNote(2), RESERVE]);
    expect(coldCardView(sim({ goalNetBtc: null }), S, 30, LABELS)?.rules.join(' ')).not.toContain(GOAL_STAND_DOWN_WORDS);
  });

  it('⭐ COLD VIEW — the reserve\'s line only when it is true of the run; none without a reserve', () => {
    // Cold came out at or above support: the reserve sentence's first clause is false, so it is gone (policyReserveNote).
    expect(coldCardView(sim({ coldRetrievedAboveSupportBtc: 0.1 }), S, 30, LABELS)?.rules).toEqual([policyColdNote(S)]);
    expect(coldCardView(sim({ openingColdBtc: 0 }), S, 30, LABELS)?.rules).toEqual([policyColdNote(S)]);
    // Cold into a Coinbase liquidated later: the second clause drops, the first stays (the gate's own words).
    const doomed = coldCardView(sim({ liqMonth: 1, rows: [{ topUpFromColdBtc: 0.1 }, { topUpFromColdBtc: 0 }] }), S, 30, LABELS);
    expect(doomed?.rules[1]).toBe('Your reserve is spent only in a break below support.');
  });

  it('⭐ COLD VIEW — the policy off: no rules (the face\'s own sweep controls say what fills cold then)', () => {
    expect(coldCardView(sim({ policyApplied: false }), S, 30, LABELS)?.rules).toEqual([]);
    expect(coldCardView(sim({ policyApplied: false, goalNetBtc: 2 }), S, 30, LABELS)?.rules).toEqual([]);
  });

  it('⭐ COLD VIEW — when new coins move: with a reserve "new coins"; without, "first coins"; none, one sentence each', () => {
    const at = (o: Partial<Sim>, first: string | null) => coldCardView(sim(o), S, 30, { end: 'month 60', firstCold: first })?.moves;
    expect(at({}, 'at month 27')).toBe('New coins first move at month 27.');
    expect(at({ openingColdBtc: 0 }, 'at month 27')).toBe('First coins move at month 27.');
    expect(at({}, null)).toBe('No new coins move to cold on this path.');
    expect(at({ openingColdBtc: 0 }, null), 'one no-reserve sentence for the four faces').toBe(NOTHING_MOVES_TO_COLD.trim());
    expect(NOTHING_MOVES_TO_COLD).toBe(' Nothing moves to cold on this path.');
  });

  it('⭐ COLD VIEW — no card body when cold can\'t be non-zero: the policy off, the sweep off, no reserve', () => {
    expect(coldCardView(sim({ policyApplied: false, openingColdBtc: 0 }), S, 0, LABELS)).toBeNull();
    expect(coldCardView(sim({ policyApplied: false, openingColdBtc: 0 }), S, 30, LABELS), 'sweep on').not.toBeNull();
    expect(coldCardView(sim({ policyApplied: false, openingColdBtc: 0.5 }), S, 0, LABELS), 'a reserve').not.toBeNull();
    expect(coldCardView(sim({ openingColdBtc: 0 }), S, 0, LABELS), 'the policy\'s own sweep').not.toBeNull();
  });

  it('⭐ COLD VIEW — on the plan\'s own run: the total is the run\'s cold, the parts foot with its ledger', () => {
    const facts = (goal: number | null): PlanMonthFacts => ({
      todayISO: '2026-10-12', price: 100_000, plan: { ...PLAN_POLICY_DEFAULTS },
      income: 6_000, expenses: 4_000, blocApr: 13, cbAprPct: 6.27, creditLine: 40_000,
      strikeBalance: 0, strikeCollateralBtc: 1, cbCollateralBtc: 1, coldBtc: 0.5, cbDebt: 0,
      strikeLiquidationLtvPct: 85, hold: { inHold: false, throughISO: null }, breakerSeed: null, strikeMinFromIncome: false,
      goalNetBtc: goal,
    });
    for (const goal of [null, 2, 3]) {
      const r = planMonthRun(facts(goal)).sim;
      const v = coldCardView(r, S, 30, { end: `month ${r.last.m}`, firstCold: null });
      if (v === null) throw new Error('premise: the policy applies');
      expect(v.total, `goal ${goal}`).toBe(`${r.totalColdBtc.toFixed(3)} ₿`);
      const footed = v.parts.reduce((a, p) => a + p.btc, 0);
      // The parts drop a residue under the display floor, so they foot to the ledger within it.
      expect(Math.abs(footed - r.totalColdBtc), `goal ${goal}: the parts foot`).toBeLessThan(0.001);
      expect(v.rules.some((l) => l.includes(GOAL_STAND_DOWN_WORDS)), `goal ${goal}: the stand-down line`).toBe(goal !== null);
    }
  });
});

describe('⭐ COLD CARD — renders exactly the view', () => {
  const view = coldCardView(sim({ goalNetBtc: 2 }), S, 30, LABELS) as ColdCardView;

  it('⭐ COLD CARD — the label, the total, the origins, the moves, and the rules folded, one a line', () => {
    const html = renderToStaticMarkup(<ColdStorageCard view={view} />);
    expect(html).toMatch(/^<section [^>]*aria-label="Cold storage"/);
    expect(html).toContain(`>${COLD_CARD_TITLE}<`);
    expect(html).toContain('>2.500 ₿<');
    expect(html).toContain('>in your own custody by Oct 2031<');
    for (const p of view.parts) expect(html).toContain(p.text);
    expect(html).toContain('>New coins first move Jan 2029.<');
    expect(html).toMatch(/<details [^>]*><summary>How the plan uses cold storage<\/summary><ul>/);
    expect(COLD_RULES_TITLE).toBe('How the plan uses cold storage');
    for (const r of view.rules) expect(html).toContain(`<li>${r.replace(/'/g, '&#x27;')}</li>`);
    // The order: the outcome, then the origins, the moves, the rules.
    const at = (t: string) => html.indexOf(t);
    expect(at('>2.500 ₿<')).toBeLessThan(at(view.parts[0].text));
    expect(at(view.parts[0].text)).toBeLessThan(at('>New coins first move'));
    expect(at('>New coins first move')).toBeLessThan(at('<details'));
  });

  it('⭐ COLD CARD — the Decision face\'s card leaves its total to the outcome strip; a card with no body, the face\'s own', () => {
    const noTotal = renderToStaticMarkup(<ColdStorageCard view={view} showTotal={false} />);
    expect(noTotal).not.toContain('>2.500 ₿<');
    expect(noTotal).not.toContain('in your own custody');
    expect(noTotal).toContain(view.parts[0].text);
    const empty = renderToStaticMarkup(<ColdStorageCard view={null}><button type="button">Sweep to cold storage</button></ColdStorageCard>);
    expect(empty).toContain('>Cold storage<');
    expect(empty).not.toContain('<details');
    expect(empty).toContain('Sweep to cold storage');
    const off = renderToStaticMarkup(<ColdStorageCard view={{ ...view, rules: [] }} />);
    expect(off, 'no rules, no fold').not.toContain('<details');
    expect(renderToStaticMarkup(<ColdStorageCard view={view}>{false}</ColdStorageCard>), 'no children, no wrapper')
      .toBe(renderToStaticMarkup(<ColdStorageCard view={view} />));
  });
});

describe('⭐ COLD FACES — the four engine faces render the one card, from their own run', () => {
  const src = (f: string) => readFileSync(join(process.cwd(), 'src/components/Almanac', f), 'utf8');
  const FACES = {
    'CyclingFace.tsx': /const coldView = coldCardView\(sim, policySettings, coldBufferPct, \{\s*end: bandDateLabel\(rows\.length - 1\),\s*firstCold: sim\.firstColdMonth === null \? null : bandDateLabel\(sim\.firstColdMonth\),\s*\}\);/,
    'UnifiedFace.tsx': /const coldView = coldCardView\(sim, policySettings, coldBufferPct, \{\s*end: `month \$\{sim\.last\.m\}`,\s*firstCold: sim\.firstColdMonth === null \? null : `at month \$\{sim\.firstColdMonth\}`,\s*\}\);/,
    'OwnershipFace.tsx': /const coldView = coldCardView\(sim, policySettings, coldBufferPct, \{\s*end: `month \$\{sim\.last\.m\}`,\s*firstCold: sim\.firstColdMonth === null \? null : `at month \$\{sim\.firstColdMonth\}`,\s*\}\);/,
    // The plan of record's own buffer — the run sweeps at it (engineInputsOf).
    'DecisionFace.tsx': /const coldView = coldCardView\(sim, policySettings, PLAN_COLD_BUFFER_PCT, \{\s*end: `month \$\{sim\.last\.m\}`,\s*firstCold: sim\.firstColdMonth === null \? null : `at month \$\{sim\.firstColdMonth\}`,\s*\}\);/,
  } as const;

  it.each(Object.entries(FACES))('⭐ %s — one card, through the one view, with this face\'s labels', (face, view) => {
    const s = src(face);
    expect(s, `${face}: the view`).toMatch(view);
    expect((s.match(/<ColdStorageCard\b/g) ?? []).length, `${face}: one card`).toBe(1);
    expect(s, `${face}: the card reads the view`).toMatch(/<ColdStorageCard\s+view=\{coldView\}/);
    // One arrangement: no face composes the card's sentences itself any more.
    for (const helper of ['policyColdNote(', 'policyColdGoalNote(', 'policyReserveNote(', 'coldMovesSentence(', 'coldOriginsParts(']) {
      expect(s, `${face}: ${helper}`).not.toContain(helper);
    }
    // Its own card, never nested in another: the last section opened before it is closed before it.
    const at = s.indexOf('<ColdStorageCard');
    expect(s.lastIndexOf('</section>', at), `${face}: not nested`).toBeGreaterThan(s.lastIndexOf('<section', at));
  });

  it('⭐ COLD FACES — where each card sits, and the Decision face\'s leaves its total to the strip', () => {
    const order = (face: string, before: string, after: string) => {
      const s = src(face);
      const card = s.indexOf('<ColdStorageCard');
      expect(s.indexOf(before), `${face}: after ${before}`).toBeGreaterThan(0);
      expect(s.indexOf(before), `${face}: after ${before}`).toBeLessThan(card);
      expect(s.indexOf(after, card), `${face}: before ${after}`).toBeGreaterThan(card);
    };
    order('CyclingFace.tsx', 'Holdings by venue', 'Coinbase LTV over time');
    order('OwnershipFace.tsx', 'Holdings by venue', 'chartSeg');
    order('UnifiedFace.tsx', 'Turn Strike ', '<SupportPolicyCard');
    order('DecisionFace.tsx', '{tiles.map((t) => (', 'What if · price path');
    expect(src('DecisionFace.tsx')).toMatch(/<ColdStorageCard view=\{coldView\} showTotal=\{false\} \/>/);
    for (const f of ['CyclingFace.tsx', 'UnifiedFace.tsx', 'OwnershipFace.tsx']) expect(src(f), f).not.toContain('showTotal');
    // The Strategy face's old in-card cold block is gone ("₿ in custody" / "off" head).
    expect(src('UnifiedFace.tsx')).not.toContain('₿ in custody');
  });
});
