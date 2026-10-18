import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⚠ STRUCTURAL GUARD — the Monthly Playbook's crash line (crash playbook Run 3; plan of record Runs 2–3). The repo has no
 * render harness, so, like emergencyConsoleWiring.test.ts, these rules are read off the source:
 *
 *  - the card's crash line builds through the Emergency Console's one builder, on the live figures — in ONE place, the
 *    card's inputs hook, which both screens that show the card (THIS MONTH and the full-mode Advisor tab) call;
 *  - the projection (runAdvisor) and its Coinbase-paydown label left every screen with the Outlook (Run 3), so no screen
 *    says "CB paydown" any more.
 *
 * Each check was proven red by a temporary edit before it landed.
 */
const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');
const SIMPLE = 'src/components/SimpleMode/SimpleModeView.tsx';
const ADVISOR = 'src/components/Advisor/AdvisorMain.tsx';
const DAILY = 'src/components/Daily/DailyModeView.tsx';
const CARD = 'src/components/SimpleMode/PlanMonthCard.tsx';
const INPUTS = 'src/components/SimpleMode/usePlanCardInputs.ts';

describe("the projection's Coinbase paydown — gone with the Outlook (Run 3)", () => {
  it('⭐ no screen that shows the plan says "CB paydown" or "pay down CB" — comments included', () => {
    for (const f of [SIMPLE, ADVISOR, DAILY, CARD, INPUTS]) {
      const src = read(f);
      expect(src, `NO CB PAYDOWN in ${f}`).not.toMatch(/CB paydown/i);
      expect(src, `NO CB PAYDOWN in ${f}`).not.toMatch(/pay down CB/i);
      expect(src, `NO CB PAYDOWN in ${f}`).not.toContain('CB_PAYDOWN_LABEL');
    }
  });
});

describe('the plan card — the crash line', () => {
  it("⭐ builds through the console's builder, on the live figures, in the card's inputs hook", () => {
    const src = read(INPUTS);
    for (const call of ['playbookInputFromLive(', 'crashPlaybook(', 'monthPlaybookLine(', 'plBandsAt(']) {
      expect(src, call).toContain(call);
    }
    expect(src).toContain('useStore((s) => s.getCurrentColdBtc())');
    // The playbook's Strike balance is the LIVE balance — never the start-of-month projection base.
    expect(src, "the playbook on Strike's live balance").toMatch(/strikeBalance: advisorActualBlocBalance\b/);
    expect(src, 'the playbook on the live Strike collateral').toMatch(/strikeCollateralBtc: currentBtcHeld\b/);
    expect(src, 'the accrued Coinbase balance').toMatch(/cbDebt: effectiveCbBalance\b/);
    // The builder's own first line — the crash gate's call names the same balance, so the line is pinned whole.
    expect(src, 'the builder on the accrued balance').toMatch(
      /price: btcPrice, support: plBandsAt\(new Date\(today\)\)\.floor, cbDebt: effectiveCbBalance, cbCollateralBtc,/);
    expect(src, 'the hook hands the card its line').toMatch(/return \{ pm, crashLine: playbookLine, ndp, ndpEstimate, ndpActionActive \};/);
  });

  it('⭐ both screens that show the card take its inputs from the hook — once — and hand the card its crash line', () => {
    for (const f of [SIMPLE, ADVISOR]) {
      const src = read(f);
      expect((src.match(/= usePlanCardInputs\(\);/g) ?? []).length, `${f} calls the hook once`).toBe(1);
      expect(src, f).toMatch(/crashLine=\{crashLine\}/);
      // No screen builds the line itself.
      expect(src, f).not.toMatch(/\bplaybookInputFromLive\(|\bcrashPlaybook\(|\bmonthPlaybookLine\(/);
    }
    // Run 2 (D13) — the line reaches the plan's card, whose status leads with the console and whose to-do rows are the
    // monthly model's estimates (crashNote).
    const card = read(CARD);
    expect(card).toMatch(/\{PLAN_CRASH_TITLE\}/);
    expect(card).toMatch(/\{crash && <p className=\{styles\.pmFoot\}>\{crashNote\(true\)\}<\/p>\}/);
    // The old paydown figure and its naive creditLine − drawn affordability are gone. A regex, not the names spelled
    // out, so the gate's repo-wide grep for the deleted names stays empty.
    expect(read(SIMPLE)).not.toMatch(/cbPaydown(?:ToTarget|Affordable)/);
  });
});
