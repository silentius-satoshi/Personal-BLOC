import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CB_PAYDOWN_LABEL, IF_YOU_SHIFT_DEBT } from '../crashPlaybookView';

/**
 * ⚠ STRUCTURAL GUARD — the Monthly Playbook's crash line and the projection's Coinbase-paydown label (crash playbook
 * Run 3). The repo has no render harness, so, like emergencyConsoleWiring.test.ts, these rules are read off the source:
 *
 *  - the projection (runAdvisor) models only the debt shift, while the crash playbook may top up first — so every place
 *    the projection's Coinbase paydown appears says "(if you shift debt)", through ONE label, never a bare wording;
 *  - SimpleModeView's THIS MONTH line builds through the Emergency Console's one builder, on the live figures, and
 *    Box 3 says when its figures include the projection's shift;
 *  - the Outlook legend's depth is computed, never a literal;
 *  - JSX drops the whitespace at a line break next to an expression, so each label keeps its neighbour on its line.
 *
 * Each check was proven red by a temporary edit before it landed.
 */
const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');
const SIMPLE = 'src/components/SimpleMode/SimpleModeView.tsx';
const OUTLOOK = 'src/components/Advisor/OutlookProjection.tsx';
const ADVISOR = 'src/components/Advisor/AdvisorMain.tsx';
const DAILY = 'src/components/Daily/DailyModeView.tsx';
const CARD = 'src/components/SimpleMode/PlanMonthCard.tsx';

describe("the projection's Coinbase paydown — one label", () => {
  it('⭐ the label says the projection shifts debt', () => {
    expect(CB_PAYDOWN_LABEL).toBe('CB paydown (if you shift debt)');
    expect(IF_YOU_SHIFT_DEBT).toBe('if you shift debt');
  });

  it('⭐ the two Advisor sites render the label and say neither bare wording — comments included', () => {
    // Run 2 — THIS MONTH and Daily's card run the plan of record: the projection's paydown is not on them any more (the
    // plan's own defense rows name their move), so the label lives where runAdvisor still renders — until Run 3.
    for (const f of [OUTLOOK, ADVISOR]) {
      const src = read(f);
      expect(src, f).toContain('CB_PAYDOWN_LABEL');
      expect(src, f).not.toMatch(/CB paydown/i);
      expect(src, f).not.toMatch(/pay down CB/i);
    }
    for (const f of [SIMPLE, DAILY, CARD]) {
      const src = read(f);
      expect(src, f).not.toContain('CB_PAYDOWN_LABEL');
      expect(src, f).not.toMatch(/CB paydown/i);
      expect(src, f).not.toMatch(/pay down CB/i);
    }
  });

  it('⭐ keeps the space beside every label expression (JSX drops whitespace at a line break)', () => {
    const outlook = read('src/components/Advisor/OutlookProjection.tsx');
    expect(outlook).toMatch(/\{CB_PAYDOWN_LABEL\} —/);
    expect(outlook).toMatch(/between(?: |\{' '\}\s*)\{playbookDepthFor\(/);
    expect(read(ADVISOR), ADVISOR).toMatch(/alert — \{CB_PAYDOWN_LABEL\}/);
  });
});

describe('SimpleModeView — the THIS MONTH crash line', () => {
  it("⭐ builds through the console's builder, on the live figures, and the card says the console is the authority", () => {
    const src = read(SIMPLE);
    for (const call of ['playbookInputFromLive(', 'crashPlaybook(', 'monthPlaybookLine(', 'plBandsAt(']) {
      expect(src, call).toContain(call);
    }
    expect(src).toContain('useStore((s) => s.getCurrentColdBtc())');
    // The playbook's Strike balance is the LIVE balance — never the start-of-month projection base.
    expect(src).toMatch(/strikeBalance: advisorActualBlocBalance\b/);
    expect(src).toMatch(/strikeCollateralBtc: currentBtcHeld\b/);
    expect(src).toMatch(/cbDebt: effectiveCbBalance\b/);
    // Run 2 (D13) — the line reaches the plan's card, whose status leads with the console and whose to-do rows are the
    // monthly model's estimates (crashNote) — Box 3 and its "(if you shift debt)" retired with the boxes.
    expect(src).toMatch(/crashLine=\{playbookLine\}/);
    const card = read(CARD);
    expect(card).toMatch(/\{PLAN_CRASH_TITLE\}/);
    expect(card).toMatch(/\{crash && <p className=\{styles\.pmFoot\}>\{crashNote\(true\)\}<\/p>\}/);
    // The old paydown figure and its naive creditLine − drawn affordability are gone. A regex, not the names spelled
    // out, so the gate's repo-wide grep for the deleted names stays empty.
    expect(src).not.toMatch(/cbPaydown(?:ToTarget|Affordable)/);
  });
});

describe("OutlookProjection — the legend's depth is computed", () => {
  it('⭐ calls playbookDepthFor and holds no typed depth multiple (0.70× before Policy v2, 0.52× since)', () => {
    const src = read(OUTLOOK);
    expect(src).toContain('playbookDepthFor(');
    expect(src).not.toMatch(/\d\.\d{2}×/);
  });
});
