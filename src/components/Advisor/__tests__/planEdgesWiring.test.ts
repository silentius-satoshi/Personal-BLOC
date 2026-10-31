import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SETTINGS_FIELDS, VALIDATE_WHITELIST } from '../../../store/settingsFields';
import { atTriggerLine, cbTabCrashDayLine, CONSOLE_LINK, isCrashDay } from '../../Tools/crashPlaybookView';
import { suggestedLineWords } from '../../Almanac/decisionView';
import { FACE_TILES } from '../../Almanac/almanacGrid';
import { planRuleRows, PLAN_RULE_LABEL } from '../../Almanac/supportPolicyView';
import { planPolicySettingsOf } from '../../Almanac/planRun';
import { PLAN_POLICY_DEFAULTS } from '../../../lib/planPolicy';

/**
 * ⚠ STRUCTURAL GUARD — the plan of record's Run 4, Safety and the edges (spec pbloc-spec-plan-of-record-v1 §16). The repo
 * has no render harness, so — like planRunWiring and planYearWiring — these rules are read off the source, beside the
 * pure words they print:
 *
 *  - GATE (D3) — the Emergency Console's gate is the Coinbase loan: the console, both labels, the Decision face and the
 *    crash day read `hasCbLoan`, no longer the LTV-triggered strategy; the Liq Sim, with no other screen, is gone;
 *  - INV6 (D3) — `cbPaymentStrategy` and `cbMonthlyPayment` retire, inert: no component reads or writes them, their keys
 *    stay listed and restorable, and no screen edits them;
 *  - RULES — the Advisor tab's sidebar names the plan's rules, as the plan runs them, where the typed PRIORITY RULES stood;
 *  - CBTAB — the CB Loan tab's crash day is the console's (the trigger, a link), its colours Safety's, and its projection
 *    (which read the retired monthly payment) gives way to the plan's year;
 *  - COLOUR — today's Coinbase LTV wears Safety's colour on the Advisor tab;
 *  - SAFETY (D7) / VIEWER (D9) — the at-support reading reaches the owner's Safety card, the viewer's home and the safe
 *    snapshot (its pure rule: simulation/__tests__/safetyAtSupport.test.ts);
 *  - MIN — the Smart BLOC tab's recommendation is the plan's suggested line, in the Decision face's words.
 *
 * Each check was proven red by a temporary edit to the real file before it landed (§16, the mutations).
 */
const SRC = join(process.cwd(), 'src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');
/** The code without its comments — a comment may name what left (the history stays); the code may not. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const DEFENSE = read('components/Tools/CbDefenseTool.tsx');
const SHELL = read('components/Layout/AppShell.tsx');
const ALMANAC = read('components/Almanac/AlmanacView.tsx');
const DECISION = read('components/Almanac/DecisionFace.tsx');
const DECISION_VIEW = read('components/Almanac/decisionView.ts');
const CARD_INPUTS = read('components/SimpleMode/usePlanCardInputs.ts');
const DAILY = read('components/Daily/DailyModeView.tsx');
const CRASH_VIEW = read('components/Tools/crashPlaybookView.ts');
const SETTINGS = read('components/Settings/SettingsMain.tsx');
const CB_SIDEBAR = read('components/CoinbaseLoan/CoinbaseLoanSidebar.tsx');
const CB_TAB = read('components/CoinbaseLoan/CoinbaseLoanMain.tsx');
const SIDEBAR = read('components/Advisor/AdvisorSidebar.tsx');
const ADVISOR = read('components/Advisor/AdvisorMain.tsx');
const SAFETY = read('components/SimpleMode/SafetyDashboard.tsx');
const VIEWER_HOME = read('components/Viewer/ViewerHomeView.tsx');
const PAYLOADS = read('store/payloads.ts');
const INPUTS = read('components/Inputs/InputsPanel.tsx');

/** Every .ts/.tsx under a folder of src, outside tests. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== '__probe__') out.push(...sources(p)); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe('⭐ GATE — D3: the Emergency Console runs with a Coinbase loan', () => {
  it('⭐ GATE — the console\'s one gate is the loan; the Liq Sim is gone', () => {
    expect(DEFENSE, 'GATE the console').toMatch(/const hasCbLoan = useStore\(\(s\) => s\.hasCbLoan\);\s*return hasCbLoan \? <EmergencyConsole \/> : null;/);
    expect(code(DEFENSE), 'GATE no strategy').not.toMatch(/cbPaymentStrategy|LiqSimulator/);
    for (const f of ['components/Tools/LiqSimulator.tsx', 'components/Tools/liqSimulatorView.ts', 'components/Tools/LiqSimulator.module.css']) {
      expect(existsSync(join(SRC, f)), `GATE ${f} gone`).toBe(false);
    }
  });
  it('⭐ GATE — every label names the console; the Decision face and the crash day read the loan', () => {
    expect(SHELL, 'GATE the tab').toMatch(/\{ key: 'liqsim',\s+fullLabel: 'Emergency',\s+shortLabel: 'Emerg'\s+\}/);
    // ui.md: Settings' own tab list keeps in step with the shell's — the tab-order row names the console too.
    expect(SETTINGS, 'GATE Settings\' tab list').toMatch(/\{ key: 'liqsim',\s+label: 'Emergency'\s+\}/);
    const named = sources(join(SRC, 'components')).filter((f) => /Liq Sim/.test(code(readFileSync(f, 'utf8'))));
    expect(named.map((f) => relative(SRC, f)), 'GATE no screen names the Liq Sim').toEqual([]);
    expect(code(SHELL), 'GATE the shell reads no strategy').not.toMatch(/cbPaymentStrategy|withEmergencyLabel/);
    // With the loan off the bar shows neither of the loan's tabs, so neither stays open — the console's gate would leave
    // an empty page (the e2e's NO LOAN reads it on screen).
    expect(SHELL, 'GATE no tab without its loan').toMatch(/const shut = \(k: string\): boolean => hiddenTabs\.includes\(k\) \|\| \(!hasCbLoan && \(k === 'coinbase' \|\| k === 'liqsim'\)\);/);
    expect(SHELL, 'GATE no tab without its loan, on every change').toMatch(/\}, \[hiddenTabs, activeTab, hasCbLoan\]\);/);
    expect(SHELL, 'GATE no tab without its loan, on the open tab').toMatch(/if \(shut\(activeTab\)\) \{\s*const first = ALL_TABS_META\.find\(\(t\) => !shut\(t\.key\)\);/);
    // The Almanac's tile (the grid — BL45): named Emergency, on the loan.
    expect(FACE_TILES.find((t) => t.key === 'defense'), 'GATE the face').toEqual({ key: 'defense', name: 'Emergency', group: 'plan', gate: 'cbLoan' });
    expect(code(ALMANAC), 'GATE the hub reads no strategy').not.toMatch(/cbPaymentStrategy/);
    expect(DECISION, 'GATE the Decision face').toMatch(/const consoleRuns = s\.hasCbLoan;/);
    expect(DECISION, 'GATE the card\'s context').toMatch(/\n\s+consoleRuns,\n/);
    expect(code(DECISION), 'GATE the face reads no strategy').not.toMatch(/cbPaymentStrategy/);
    expect(CRASH_VIEW, 'GATE the crash day').toMatch(/hasCbLoan: boolean; cbDebt: number; cbCollateralBtc: number; price: number; triggerPct: number;\s*\}\): boolean \{\s*if \(!f\.hasCbLoan\) return false;/);
    for (const [name, src] of Object.entries({ CARD_INPUTS, DAILY })) {
      expect(src, `GATE ${name}`).toMatch(/isCrashDay\(\{\s*hasCbLoan, cbDebt: effectiveCbBalance, cbCollateralBtc,/);
      expect(code(src), `GATE ${name} no strategy`).not.toMatch(/cbPaymentStrategy|ltvTriggered/);
    }
  });
  it('⭐ GATE — the crash day: a loan at or past its trigger at today\'s price, whatever the old strategy said', () => {
    const at = { hasCbLoan: true, cbDebt: 75_000, cbCollateralBtc: 1, price: 100_000, triggerPct: 75 };
    expect(isCrashDay(at), 'GATE at the trigger').toBe(true);
    expect(isCrashDay({ ...at, cbDebt: 74_999 }), 'GATE under it').toBe(false);
    expect(isCrashDay({ ...at, hasCbLoan: false }), 'GATE no loan').toBe(false);
  });
});

describe('⭐ INV6 — D3: the payment strategy and the monthly payment retire, inert', () => {
  const RETIRED = ['cbPaymentStrategy', 'cbMonthlyPayment'];
  it('⭐ INV6 — no component reads or writes them', () => {
    const components = sources(join(SRC, 'components'));
    expect(components.length, 'INV6 the sweep reads the components').toBeGreaterThan(100);
    for (const f of RETIRED) {
      const readers = components.filter((p) => new RegExp(`\\b${f}\\b`).test(readFileSync(p, 'utf8')))
        .map((p) => relative(SRC, p).replace(/\\/g, '/'));
      expect(readers, `INV6 ${f}`).toEqual([]);
    }
    const writers = components.filter((p) => /\bset(?:CbPaymentStrategy|CbMonthlyPayment)\b/.test(readFileSync(p, 'utf8')));
    expect(writers, 'INV6 no writer').toEqual([]);
  });
  it('⭐ INV6 — their keys stay listed and restorable, so an older backup still restores', () => {
    for (const f of RETIRED) {
      expect(SETTINGS_FIELDS as readonly string[], `INV6 ${f} listed`).toContain(f);
      expect([...VALIDATE_WHITELIST], `INV6 ${f} restorable`).toContain(f);
    }
  });
  it('⭐ INV6 — no screen edits them; the crash-day thresholds show with a loan', () => {
    expect(code(SETTINGS), 'INV6 no strategy pills').not.toMatch(/CB PAYMENT STRATEGY|LTV-Triggered|>Monthly</);
    expect(code(SETTINGS), 'INV6 no monthly payment').not.toMatch(/Monthly payment/);
    expect(code(SETTINGS), 'INV6 no payment strategy').not.toMatch(/payment strategy/i);   // the Coinbase row's subtitle too
    expect(code(CB_SIDEBAR), 'INV6 the CB sidebar').not.toMatch(/MONTHLY PAYMENT|interest-only/);
    expect(code(SIDEBAR), 'INV6 the Advisor sidebar').not.toMatch(/Min\. payment/);
    // The trigger, the target and the action at the trigger — the console's crash day — sit inside the loan's block.
    const block = SETTINGS.slice(SETTINGS.indexOf("{settingsPage === 'cbloan'"), SETTINGS.indexOf('Liquidation price'));
    expect(block, 'INV6 the thresholds with a loan').toMatch(/\{hasCbLoan && \([\s\S]*ACTION AT TRIGGER[\s\S]*label="Draw trigger LTV"[\s\S]*Pay down to LTV/);
  });
});

describe('⭐ RULES — the Advisor tab\'s sidebar names the plan\'s rules', () => {
  it('⭐ RULES — the plan\'s six settings as the plan runs them, where the typed PRIORITY RULES stood', () => {
    expect(SIDEBAR, 'RULES the rows').toMatch(/const planRules = planRuleRows\(planPolicySettingsOf\(usePlanPolicy\(\)\), expenses\);/);
    expect(SIDEBAR, 'RULES rendered').toMatch(/\{planRules\.map\(\(r\) => <SummaryRow key=\{r\.key\} label=\{r\.label\} value=\{r\.value\} \/>\)\}/);
    expect(SIDEBAR, 'RULES the section').toMatch(/>YOUR PLAN</);
    expect(code(SIDEBAR), 'RULES no typed rules').not.toMatch(/PRIORITY RULES|55%|65%|70%|Halve BLOC|all income to CB/);
  });
  it('⭐ RULES — at C1, in the sliders\' own words; a limit held to its line shows the line', () => {
    expect(planRuleRows(planPolicySettingsOf({ ...PLAN_POLICY_DEFAULTS }), 3_500), 'RULES C1').toEqual([
      { key: 'cbStop', label: PLAN_RULE_LABEL.cbStopAtSupportPct, value: '45%' },
      { key: 'skStop', label: PLAN_RULE_LABEL.strikeStopAtSupportPct, value: '50%' },
      { key: 'accumulateBelow', label: PLAN_RULE_LABEL.accumulateBelow, value: '2.00× support' },
      { key: 'payDownAbove', label: PLAN_RULE_LABEL.payDownAbove, value: '3.00× support' },
      { key: 'bearBuffer', label: PLAN_RULE_LABEL.bearBufferMonths, value: '12 months' },
      { key: 'cashReserve', label: PLAN_RULE_LABEL.cashReserveMonths, value: 'none' },
    ]);
    const s = planPolicySettingsOf({ ...PLAN_POLICY_DEFAULTS, cbStopAtSupportPct: 60, payDownAbove: 1.6, accumulateBelow: 2.4 });
    const rows = Object.fromEntries(planRuleRows(s, 3_500).map((r) => [r.key, r.value]));
    expect(rows.payDownAbove, 'RULES the pay-down zone as run (pushed above the buy zone)').toBe(`${s.payDownAbove.toFixed(2)}× support`);
    expect(s.payDownPushed, 'RULES premise: pushed').toBe(true);
    const clamped = { ...s, cbStopEffPct: 55, cbClamped: true };
    expect(Object.fromEntries(planRuleRows(clamped, 3_500).map((r) => [r.key, r.value])).cbStop, 'RULES held to its line').toBe('55%');
  });
});

describe('⭐ CBTAB — the CB Loan tab: the console\'s crash day, Safety\'s colours, the plan\'s year', () => {
  it('⭐ CBTAB — no fourth crash-day answer: the trigger and a link, in the console\'s own words', () => {
    expect(code(CB_TAB), 'CBTAB no protocol').not.toMatch(/Emergency Protocol|Redirect all income|Resume Smart BLOC|0\.70|\b76%|\b84%/);
    expect(CB_TAB, 'CBTAB the crash day').toMatch(/const crashDay\s+= isCrashDay\(\{ hasCbLoan, cbDebt: accruedBalance, cbCollateralBtc, price: btcPrice, triggerPct: cbLtvTriggerPct \}\);/);
    expect(CB_TAB, 'CBTAB the banner').toMatch(/\{crashDay && \([\s\S]*?\{atTriggerLine\(cbLtvTriggerPct, true\)\}[\s\S]*?onClick=\{onOpenConsole\}>\{CONSOLE_LINK\} →/);
    expect(CB_TAB, 'CBTAB the card').toMatch(/\{cbTabCrashDayLine\(cbLtvTriggerPct, m\.triggerPrice\)\}/);
    // A paid-off or unbacked loan has no trigger or seizure price: its rows read —, never "$0".
    expect(CB_TAB, 'CBTAB no price, no figure').toMatch(/\{shownUsd\(t\.price\) \? `\$\$\{Math\.round\(t\.price\)\.toLocaleString\(\)\}` : '—'\}/);
    expect(CB_TAB, 'CBTAB the alert rows: the trigger and the 86% line').toMatch(/label: 'Your trigger',[^\n]*ltvPct: cbLtvTriggerPct, price: m\.triggerPrice, action: 'Work from the Emergency Console'/);
    expect(CB_TAB, 'CBTAB the bar\'s marker').toMatch(/<LtvSafetyBar currentLtv=\{currentLtv\} level=\{safety\.cbLevel\} triggerPct=\{cbLtvTriggerPct\} \/>/);
    expect(CB_TAB, 'CBTAB the marker at the trigger').toMatch(/<div className=\{styles\.ltvMarker\} style=\{\{ left: `\$\{triggerPct\}%` \}\}>\s*<span className=\{styles\.ltvMarkerLabel\}>\{triggerPct\}%<\/span>/);
    expect(CB_TAB, 'CBTAB the legend').toMatch(/↑\{triggerPct\}% your trigger/);
    expect(CB_TAB, 'CBTAB the fill in Safety\'s colour').toMatch(/background: LEVEL_COLOR\[level\]/);
    expect(SHELL, 'CBTAB the shell\'s links').toMatch(/<CoinbaseLoanMain onOpenConsole=\{consoleInFullMode\} onOpenPlanPaths=\{planPathsInFullMode\} \/>/);
    // Settings can hide the Emergency tab, and a hidden tab bounces: the link shows only while the tab can open.
    expect(SHELL, 'CBTAB the console link only while its tab can open')
      .toMatch(/const consoleInFullMode = hiddenTabs\.includes\('liqsim'\) \? null : \(\) => setActiveTab\('liqsim'\);/);
    expect(CB_TAB.match(/\{onOpenConsole && \(\s*<button className=\{styles\.consoleLink\} onClick=\{onOpenConsole\}>\{CONSOLE_LINK\} →<\/button>/g)?.length,
      'CBTAB both console links only with the link').toBe(2);
  });
  it('⭐ CBTAB — Safety\'s colours; the projection gives way to the plan\'s year', () => {
    expect(CB_TAB, 'CBTAB Safety\'s level').toMatch(/const safety\s+= deriveSafetyView\(useStore\(useShallow\(selectSafetyViewInputs\)\)\);/);
    expect(CB_TAB, 'CBTAB the stat card').toMatch(/valueColor=\{LEVEL_COLOR\[safety\.cbLevel\]\}\s*sub=\{LEVEL_WORD\[safety\.cbLevel\]\}/);
    expect(code(CB_TAB), 'CBTAB no projection, no second classifier').not.toMatch(/runCoinbaseLoan\(|classifyLtv\(|12-Month Projection|ltvColor/);
    expect(CB_TAB, 'CBTAB the plan\'s year').toMatch(/\{onOpenPlanPaths && \([\s\S]*?\{PLAN_PATHS_LINK\} →/);
  });
  it('⭐ CBTAB — the words: one at-trigger sentence for the Decision face and the tab; never "should"', () => {
    expect(atTriggerLine(75, true), 'CBTAB at the trigger').toBe("Coinbase is at or past your 75% trigger at today's price — work from the Emergency Console.");
    expect(atTriggerLine(75, false), 'CBTAB its gate').toBe("Coinbase is at or past your 75% trigger at today's price — work from the Emergency Console (it runs once your Coinbase loan is switched on).");
    expect(cbTabCrashDayLine(75, 66_666.67), 'CBTAB the card').toBe("At your 75% trigger — BTC at $66,667 today — work from the Emergency Console: it names the day's moves from your live position and your cold storage.");
    // No price to show — a paid-off loan (0), a dust figure (40¢), not finite — the card names the trigger alone.
    for (const p of [0, 0.4, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(cbTabCrashDayLine(75, p), `CBTAB the card with no price ${p}`)
        .toBe("At your 75% trigger, work from the Emergency Console: it names the day's moves from your live position and your cold storage.");
    }
    expect(CONSOLE_LINK, 'CBTAB the link').toBe('Open the Emergency Console');
    expect(DECISION_VIEW.match(/is at or past your/g)?.length, 'CBTAB one copy: the Decision face reads it').toBeUndefined();
    expect(DECISION_VIEW, 'CBTAB the alert reads it').toMatch(/return line\('alert', 'warn', atTriggerLine\(t, ctx\.consoleRuns\)\);/);
    for (const w of [atTriggerLine(75, true), cbTabCrashDayLine(75, 66_666.67)]) expect(w, 'CBTAB banned').not.toMatch(/\b(?:should|need to)\b/i);
  });
});

describe('⭐ COLOUR — today\'s Coinbase LTV wears Safety\'s colour on the Advisor tab', () => {
  it('⭐ COLOUR — Safety\'s figure and level; no Advisor tiers', () => {
    expect(ADVISOR, 'COLOUR Safety\'s view').toMatch(/const safety = deriveSafetyView\(useStore\(useShallow\(selectSafetyViewInputs\)\)\);/);
    expect(ADVISOR, 'COLOUR the card').toMatch(/style=\{\{ color: LEVEL_COLOR\[safety\.cbLevel\] \}\}>\s*\{fmtLtvPct\(safety\.cbLtv, 1\)\}/);
    expect(code(ADVISOR), 'COLOUR no tiers').not.toMatch(/getTier|getTierColor/);
  });
});

describe('⭐ SAFETY / VIEWER — the at-support reading reaches every Safety surface', () => {
  it('⭐ SAFETY — the owner\'s card: today\'s support, the reading on the bar\'s inputs, the line under the cushion, the verdict', () => {
    expect(SAFETY, 'SAFETY today\'s support').toMatch(/const support = useMemo\(\(\) => supportToday\(todayISO\), \[todayISO\]\);/);
    expect(SAFETY, 'SAFETY one input set').toMatch(/const view = deriveSafetyView\(\{ \.\.\.useStore\(useShallow\(selectSafetyViewInputs\)\), supportToday: support \}\);/);
    expect(SAFETY, 'SAFETY the line, to the cent').toMatch(/\{cbAtSupport && \([\s\S]*?\{ownerAtSupportLine\(cbAtSupport, moveBringsCbWithin\)\}/);
    // D-R4-1 — the screen's own run says when this month's move is the fix: THIS MONTH and Daily pass it.
    for (const [name, src] of Object.entries({ SIMPLE: read('components/SimpleMode/SimpleModeView.tsx'), DAILY })) {
      expect(src, `SAFETY ${name} passes the move`).toMatch(/<SafetyDashboard moveBringsCbWithin=\{planMoveBringsCbWithin\(pm\.run\.placement\)\} \/>/);
    }
    expect(SAFETY, 'SAFETY amber when over').toMatch(/style=\{\{ color: cbAtSupport\.over \? LEVEL_COLOR\.watch : undefined \}\}/);
    expect(SAFETY, 'SAFETY the verdict').toMatch(/const \{ state, copy: stateCopy \} = ownerSafetyVerdict\(view, hasCbLoan\);/);
  });
  it('⭐ VIEWER — the viewer\'s home and the safe snapshot', () => {
    expect(VIEWER_HOME, 'VIEWER today\'s support on the trusted path')
      .toMatch(/computeViewerSafety\(safeSnap, livePrice, \{ \.\.\.inputs, supportToday: supportToday\(todayLocalISO\(\)\) \}\);/);
    expect(VIEWER_HOME, 'VIEWER under the gauge').toMatch(/const cbAtSupportSub = s\.cbAtSupport \? `\\n\$\{cbAtSupportLine\(s\.cbAtSupport\)\}` : '';/);
    expect(PAYLOADS, 'VIEWER the snapshot reads today\'s support')
      .toMatch(/const view = deriveSafetyView\(\{ \.\.\.selectSafetyViewInputs\(s\), supportToday: supportToday\(todayLocalISO\(\)\) \}\);/);
    expect(PAYLOADS, 'VIEWER the plan\'s limit').toMatch(/cbLimitAtSupport: planCbLimitOf\(s\),/);
  });
});

describe('⭐ MIN — the Smart BLOC tab\'s recommendation is the plan\'s suggested line', () => {
  it('⭐ MIN — the Decision face\'s figure, on the plan\'s position, and its words', () => {
    expect(INPUTS, 'MIN the figure').toMatch(/const suggestedLine = suggestedLineUsd\(\{\s*expenses, cbDebt: planCbDebt, cbCollateralBtc: planCbCollateral, price: btcPrice, cbLtvTriggerPct, cbLtvTargetPct,\s*\}\);/);
    expect(INPUTS, 'MIN the plan\'s Coinbase leg').toMatch(/const planCbDebt = accruedCbBalance\(planCbBalance, cbAprPct, cbLoanBalanceAsOf\);/);
    expect(INPUTS, 'MIN the words').toMatch(/\{lineWords\.text\}/);
    expect(code(INPUTS), 'MIN no year-one minimum').not.toMatch(/Recommended min|runBlocYearOne\(|\* 1\.10|ltvCeiling|Increase credit line/);
  });
  it('⭐ MIN — the words, one copy with THE MOVE\'s line', () => {
    expect(suggestedLineWords(10_000, 9_000, true, 75, 65), 'MIN covers').toEqual({
      covers: true, text: 'Your $10,000 line already covers two months of bills and one Coinbase paydown (75% → 65%).',
    });
    expect(suggestedLineWords(9_000, 9_000, true, 75, 65).covers, 'MIN at the suggestion, it covers').toBe(true);
    expect(suggestedLineWords(5_000, 9_000, false, 75, 65), 'MIN short').toEqual({
      covers: false, text: 'A $9,000 line would cover two months of bills, with 25% spare.',
    });
    expect(DECISION_VIEW, 'MIN THE MOVE reads it').toMatch(/const w = suggestedLineWords\(ctx\.ownerLineUsd, ctx\.suggestedLineUsd, hasLoan, ctx\.cbLtvTriggerPct, ctx\.cbLtvTargetPct\);/);
  });
});
