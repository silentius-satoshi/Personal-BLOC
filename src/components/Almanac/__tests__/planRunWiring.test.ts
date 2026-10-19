import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';

/**
 * ⚠ STRUCTURAL GUARD — how the plan of record reaches the main screens (Run 2, spec pbloc-spec-plan-of-record-v1 §13).
 * The repo has no render harness, so — like decisionWiring and resetMirror — these rules are read off the source:
 *
 *  - ONE — THIS MONTH and Daily build the month through `planMonthRun`; the Decision face through the same two
 *    builders (`placementInputOf`, `engineInputsOf`); no main screen runs the engine or the placement itself;
 *  - GATE (D-R2-4) — every plan reader takes Coinbase through `planCbCollateralOf` / `planCbLoanBalanceOf`;
 *  - MIN (D-R2-7) — every plan reader passes the owner's minimum source to the engine;
 *  - CARD — the main screens read the plan through `usePlanMonth`, never `runAdvisor` (Run 3: THIS MONTH and the Advisor
 *    tab through the card's inputs hook, one run each, shared with the month log), and the card formats no dollar or
 *    bitcoin figure of its own;
 *  - I31 — the two plan cards compose no sentence: every one lives in `planMonthView`; their own texts are a listed
 *    set of labels (headings, buttons) and readouts, read off the syntax tree;
 *  - NOTE (D8), CACHE (§4.3), HOLD (D9), WHATIF (§4.7) and CRASH (D13).
 *
 * Each check was proven red by a temporary edit to the real file before it landed (spec §13.8, Appendix P2).
 */
const SRC = join(process.cwd(), 'src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');
const FACE = read('components/Almanac/DecisionFace.tsx');
const PARENTS: Record<string, string> = {
  cycling: read('components/Almanac/CyclingFace.tsx'),
  ownership: read('components/Almanac/OwnershipFace.tsx'),
  unified: read('components/Almanac/UnifiedFace.tsx'),
};
const HOOK = read('components/Almanac/usePlanMonth.ts');
const CARD = read('components/SimpleMode/PlanMonthCard.tsx');
const SIMPLE = read('components/SimpleMode/SimpleModeView.tsx');
/** Run 3 — the card's inputs (the run, the crash line, the NDP), gathered once per screen; and the Advisor tab. */
const INPUTS = read('components/SimpleMode/usePlanCardInputs.ts');
const ADVISOR = read('components/Advisor/AdvisorMain.tsx');
const DAILY = read('components/Daily/DailyModeView.tsx');
const EVENT_SHEET = read('components/Daily/EventSheet.tsx');
const REVIEW = read('components/Daily/ReviewSheet.tsx');
const SAFETY = read('components/SimpleMode/SafetyDashboard.tsx');
const PRICE_CHART = read('components/SimpleMode/PriceChart.tsx');
const DAY_VIEW = read('components/Daily/dailyView.ts');
const SHEET_MODEL = read('components/Daily/eventSheetModel.ts');
const PLAN_VIEW = read('components/Almanac/planMonthView.ts');
const OVERLAY = read('components/Advisor/MonthlyLogOverlay.tsx');
const VIEWER_HOME = read('components/Viewer/ViewerHomeView.tsx');
const MONTH_EVENTS = read('components/Daily/MonthEventsModal.tsx');
const PLAYBOOK = read('components/Tools/crashPlaybookView.ts');
const CONSOLE = read('components/Tools/EmergencyConsole.tsx');
/** The five plan readers (D-R2-4): the four faces and the main screens' hook. */
const READERS: Record<string, string> = { decision: FACE, ...PARENTS, hook: HOOK };

/** The text of the first `const <name> = useMemo(` up to its dependency list's close. */
function memoBody(src: string, name: string): string {
  const at = src.indexOf(`const ${name} = useMemo(`);
  if (at < 0) return '';
  const end = src.indexOf(']);', at);
  return end < 0 ? '' : src.slice(at, end + 3);
}
/** The store selector — `useStore(useShallow((st) => ({` up to its close. */
function selectorBody(src: string): string {
  const at = src.indexOf('useStore(useShallow((st) => ({');
  if (at < 0) return '';
  const end = src.indexOf('})));', at);
  return end < 0 ? '' : src.slice(at, end + 5);
}
/** The dependency list of a memo body (after its last `}), [` or `, [`). */
const depsOf = (memo: string): string => memo.slice(memo.lastIndexOf('['));
/** Every .ts/.tsx under src, outside tests. */
function sources(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== '__probe__') out.push(...sources(p)); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe('⭐ ONE — invariant 2: one builder for THIS MONTH, Daily and the Decision face', () => {
  it('⭐ ONE — the face builds THE MOVE\'s input and the engine\'s inputs through planRun\'s builders', () => {
    expect(memoBody(FACE, 'placementInput'), 'ONE placement').toContain('placementInputOf({');
    expect(memoBody(FACE, 'engineInputs'), 'ONE engine').toContain('engineInputsOf({');
    expect(FACE, 'ONE imports').toMatch(/import \{[^}]*\bplacementInputOf\b[^}]*\bengineInputsOf\b[^}]*\} from '\.\/planRun'/);
    // ONE set of facts: one builder proves nothing if the face and the hook feed it different store fields. Each of THE
    // MOVE's facts is read by the same expression in both selectors (the face's key for the cold reserve differs).
    const FACTS: [face: string, hook: string, expr: string][] = [
      ['btcPrice', 'btcPrice', 'st.btcPrice'], ['income', 'income', 'st.income'], ['expenses', 'expenses', 'st.expenses'],
      ['blocApr', 'blocApr', 'st.blocApr'], ['cbAprPct', 'cbAprPct', 'st.cbAprPct'], ['creditLine', 'creditLine', 'st.creditLine'],
      ['strikeLiquidationLtvPct', 'strikeLiquidationLtvPct', 'st.strikeLiquidationLtvPct'],
      ['strikeCollateralBtc', 'strikeCollateralBtc', 'st.getCurrentBtcHeld()'],
      ['strikeBalance', 'strikeBalance', 'st.advisorActualBlocBalance'],
      ['cbCollateralBtc', 'cbCollateralBtc', 'planCbCollateralOf(st)'],
      ['openingColdBtc', 'coldBtc', 'st.getCurrentColdBtc()'],
      ['cbLoanBalance', 'cbLoanBalance', 'planCbLoanBalanceOf(st)'],
      ['cbLoanBalanceAsOf', 'cbLoanBalanceAsOf', 'st.cbLoanBalanceAsOf'],
      ['strikeDepositISO', 'strikeDepositISO', 'strikeDepositOf(st)'],
      ['strikeMinFromIncome', 'strikeMinFromIncome', "st.blocMinPaymentSource === 'income'"],
    ];
    for (const [face, hook, expr] of FACTS) {
      expect(selectorBody(FACE), `ONE same facts — the face's ${face}`).toContain(`${face}: ${expr},`);
      expect(selectorBody(HOOK), `ONE same facts — the hook's ${hook}`).toContain(`${hook}: ${expr},`);
    }
  });
  it('⭐ ONE — the hook builds the month through planMonthRun; no main screen runs the engine or the placement itself', () => {
    expect(memoBody(HOOK, 'run'), 'ONE hook').toContain('planMonthRun({');
    for (const [name, src] of Object.entries({ hook: HOOK, card: CARD, simple: SIMPLE, daily: DAILY, inputs: INPUTS, advisor: ADVISOR })) {
      expect(src, `ONE ${name} — no engine call`).not.toMatch(/\brunCyclingSim\(/);
      expect(src, `ONE ${name} — no placement call`).not.toMatch(/\bplacementPlan\(/);
    }
    // Today per render, not frozen at mount (an installed PWA resumes without remounting): the start date, S₀, the hold,
    // the breaker fold and the Coinbase accrual all key on it. The face keeps its own freeze (the stress lens).
    expect(HOOK, 'ONE today per render').toMatch(/const todayISO = todayLocalISO\(\);/);
    expect(HOOK, 'ONE today never frozen').not.toMatch(/useMemo\(\(\) => todayLocalISO\(\), \[\]\)/);
    // The accrual memo's OWN dependency list (it closes with "],\n  );", so memoBody — which stops at the next "]);" —
    // would read the run memo's list instead, and that one names todayISO anyway).
    expect(HOOK, 'ONE today per render — the accrual re-keys on it')
      .toMatch(/const cbDebt = useMemo\(\s*\(\) => accruedCbBalance\([^)]*\),\s*\[[^\]]*\btodayISO\b[^\]]*\],?\s*\);/);
  });
});

describe('⭐ GATE — D-R2-4: every plan reader takes Coinbase through the switch', () => {
  it('⭐ GATE — the five selectors read planCbCollateralOf / planCbLoanBalanceOf; none derives the collateral itself', () => {
    for (const [name, src] of Object.entries(READERS)) {
      const sel = selectorBody(src);
      expect(sel, `GATE ${name} selector`).not.toBe('');
      expect(sel, `GATE ${name} collateral`).toMatch(/cbCollateralBtc: planCbCollateralOf\(st\)/);
      expect(sel, `GATE ${name} balance`).toMatch(/cbLoanBalance: planCbLoanBalanceOf\(st\)/);
      expect(sel, `GATE ${name} no raw balance`).not.toMatch(/st\.cbLoanBalance\b/);
      expect(src, `GATE ${name} no direct derive`).not.toMatch(/\bderiveCbCollateral\(/);
    }
  });
  it('⭐ GATE — in the Almanac and on the main screens, only planRun derives Coinbase\'s collateral', () => {
    const callers = sources().filter((p) => /\bderiveCbCollateral\(/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(SRC, p).replace(/\\/g, '/'))
      .filter((p) => /^components\/(Almanac|SimpleMode|Daily)\//.test(p));
    expect(callers, 'GATE one deriver').toEqual(['components/Almanac/planRun.ts']);
  });
});

describe('⭐ MIN — D-R2-7: the owner\'s minimum source reaches every run', () => {
  it('⭐ MIN — the five selectors read it; every engine-inputs memo passes it and depends on it', () => {
    for (const [name, src] of Object.entries(READERS)) {
      expect(selectorBody(src), `MIN ${name} selector`).toMatch(/strikeMinFromIncome: st\.blocMinPaymentSource === 'income'/);
    }
    for (const [name, src] of Object.entries({ decision: FACE, ...PARENTS })) {
      const memo = memoBody(src, 'engineInputs');
      expect(memo, `MIN ${name} passes it`).toMatch(/strikeMinFromIncome: s\.strikeMinFromIncome/);
      expect(depsOf(memo), `MIN ${name} depends on it`).toMatch(/s\.strikeMinFromIncome/);
    }
    // The three parent faces' month sentence names the minimum income paid (the buy beside it is net of it).
    for (const [name, src] of Object.entries(PARENTS)) {
      expect(src, `MIN ${name} reads it`).toMatch(/const minNote = minimumPaidNote\(selRow\);/);
      expect(src, `MIN ${name} prints it`).toMatch(/\{minNote !== null && ` \$\{minNote\}`\}/);
    }
    const run = memoBody(HOOK, 'run');
    expect(run, 'MIN hook passes it').toMatch(/strikeMinFromIncome: s\.strikeMinFromIncome/);
    expect(depsOf(run), 'MIN hook depends on the selector').toMatch(/\bs\b/);
  });
});

describe('⭐ CARD — D-R2-2 / D-R2-8: the main screens read the plan, not the Advisor', () => {
  it('⭐ CARD — the card\'s screens and Daily read usePlanMonth: the card takes its screen\'s one run (Run 3)', () => {
    expect(INPUTS, 'CARD hook').toMatch(/const pm = usePlanMonth\(\);/);
    expect(DAILY, 'CARD Daily hook').toMatch(/const pm = usePlanMonth\(\);/);
    expect(CARD, 'CARD the run is a prop').toMatch(/\bpm: PlanMonth;/);
    expect(CARD, 'CARD runs nothing itself').not.toMatch(/\busePlanMonth\(/);
    for (const [name, src] of Object.entries({ simple: SIMPLE, advisor: ADVISOR })) {
      expect(src, `CARD ${name} renders the card`).toMatch(/<PlanMonthCard\b/);
      expect(src, `CARD ${name} hands it its one run`).toMatch(/\bpm=\{pm\}/);
    }
  });
  it('⭐ CARD — no runAdvisor on any plan screen (Run 3: the overlay\'s planned rows read the plan too)', () => {
    for (const [name, src] of Object.entries({ card: CARD, daily: DAILY, simple: SIMPLE, advisor: ADVISOR, inputs: INPUTS, overlay: OVERLAY })) {
      expect(src, `CARD ${name}`).not.toMatch(/\brunAdvisor\(/);
    }
  });
  it('⭐ CARD — the old card\'s Strike and Coinbase bars left Settings with it: no toggle that controls nothing', () => {
    const settings = read('components/Settings/SettingsMain.tsx');
    expect(settings, 'CARD no bar toggles').not.toMatch(/showPlanStrikeBar|showPlanCbBar|Show Strike BLOC bar|Show Coinbase loan bar/);
  });
  it('⭐ CARD — the next-month line hides in the strategy year\'s last month and once it is done (as before Run 2)', () => {
    expect(CARD).toMatch(/\{!strategyDone && currentMonth < 12 && nextLine && /);
  });
  it('⭐ CARD — the card formats no dollar or bitcoin figure itself: planMonthView does', () => {
    expect(CARD, 'CARD no fmtUSD').not.toMatch(/\bfmtUSD\b/);
    expect(CARD, 'CARD no toFixed').not.toMatch(/\.toFixed\(/);
    // One status colour per card: the Advisor's tier border (today's Coinbase LTV) is gone from THIS MONTH.
    expect(CARD, 'CARD no tier border').not.toMatch(/tierClass/);
    expect(SIMPLE, 'CARD no tier border').not.toMatch(/\bgetTier\(|cardTier/);
    expect(ADVISOR, 'CARD no tier border on the Advisor tab either (Run 3)').not.toMatch(/cardTier/);
    // The after box knows when the engine refused the policy (no meter, no limit tone).
    expect(CARD, 'CARD the after box reads the run\'s verdict').toMatch(/planAfter\(row, supportAt\(runMonth\), cbStop, pm\.run\.sim\.policyApplied\)/);
    // Daily's bars (Run 2.1, F13): the plan's month 1 in the Ledger's own streams, against the month SO FAR in both
    // scopes — Week reads the current month's rollup, Month the viewed month's, and a past month has no target (D14).
    // A paydown on either loan counts, as the plan's does. The bars' words are planMonthView's (planBars).
    expect(DAILY, 'CARD Daily targets').toMatch(/const target\s+= planLedgerTargets\(pr1\);/);
    expect(DAILY, 'BARS Week reads the current month')
      .toMatch(/const currentRollup = useMemo\(\(\) => buildMonthRollup\(dayLog, advisorStartDate, currentMonth\), \[dayLog, advisorStartDate, currentMonth\]\);/);
    expect(DAILY, 'BARS the month so far in both scopes').toMatch(/const barRollup\s+= isMonth \? monthRollup : currentRollup;/);
    expect(DAILY, 'BARS a past month has no target').toMatch(/const barTarget\s+= isMonth && safeViewedMonth !== currentMonth \? null : target;/);
    expect(DAILY, 'CARD Daily paydown, both loans').toMatch(/paid: barRollup\.streams\.paydown \+ barRollup\.streams\.cbPaydown,/);
    expect(DAILY, 'BARS one builder').toMatch(/const bars\s+= planBars\(\{[\s\S]*?\}, barTarget\);/);
    expect(DAILY, "BARS Week's caption")
      .toMatch(/\{!isMonth && <div className=\{styles\.streamsCaption\}>\{planBarsCaption\(currentMonth\)\}<\/div>\}/);
    expect(DAILY, 'BARS no bar composed in the screen').not.toMatch(/clampPct|plannedDraw|plannedPay|plannedBuy/);
    // Rolled in, all of Strike's interest capitalises; paid from income, only the unpaid part — never a past month's.
    expect(DAILY, 'CARD Daily interest capitalized').toMatch(/const capitalized\s+= pr1\.strikeInterestUsd - pr1\.strikeMinPaidUsd;/);
    expect(DAILY, 'CARD Daily interest capitalized — this month, past the floor')
      .toMatch(/const showCapitalized = safeViewedMonth === currentMonth && shownUsd\(capitalized\);/);
    expect((DAILY.match(/\{fmtUSDCents\(capitalized\)\}/g) ?? []).length, 'CENTS Daily interest capitalized — both sites').toBe(2);
    expect(DAILY, "CENTS Daily's interest row").toMatch(/\{fmtUSDCents\(pr1\.strikeInterestUsd\)\}/);
    expect(DAILY, 'CARD Daily interest capitalized — no whole-interest figure').not.toMatch(/fmtUSD\(pr1\.strikeInterestUsd\)\}<\/b>/);
  });

  it('⭐ CENTS — Daily\'s other figures (Run 2.1, BL19): the month rollup, the sheets\' fee, minimum, estimate and price, the month review, its seeds', () => {
    expect(DAILY, "CENTS Daily's month rollup — draws").toMatch(/\{fmtUSDCents\(monthRollup\.streams\.draw\)\}/);
    expect(DAILY, "CENTS Daily's month rollup — paydowns").toMatch(/\{fmtUSDCents\(monthRollup\.streams\.paydown\)\}/);
    expect(EVENT_SHEET, "CENTS the borrow sheet's fee").toMatch(/Origination fee \{fmtUSDCents\(cbFeePreview\)\}/);
    expect(EVENT_SHEET, "CENTS the paydown sheet's minimum").toMatch(/Minimum · due the .+? · \{fmtUSDCents\(strikeMinOwed\)\}/);
    // The owner's call at the plan review: "the 1th" is fixed here — the due day prints through the plan cards' fmtDayOrdinal.
    expect(EVENT_SHEET, "ORDINAL the paydown sheet's due day").toMatch(/Minimum · due the \{fmtDayOrdinal\(blocMinPaymentDueDay\)\} · /);
    expect(EVENT_SHEET, "CENTS the minimum's estimate kept to the cent (it seeds a stored amount)")
      .toMatch(/const strikeMinEstimate = toCents\(advisorActualBlocBalance \* \(blocApr \/ 100 \/ 12\)\);/);
    expect(EVENT_SHEET, "CENTS the sheet's estimate").toMatch(/\(~\$\{fmtUSDCents\(strikeBtcAvailable \* btcPrice\)\}\)/);
    expect(EVENT_SHEET, "CENTS the sheet's price").toMatch(/last: \$\{fmtUSDCents\(cbLiquidationPrice\)\}/);
    expect(REVIEW, "CENTS the month review's totals — drawn").toMatch(/\{fmtUSDCents\(rollup\.streams\.draw\)\}/);
    expect(REVIEW, "CENTS the month review's totals — paydown").toMatch(/\{fmtUSDCents\(rollup\.streams\.paydown\)\}/);
    expect(REVIEW, "CENTS the month review's Coinbase note — the borrow and its fee")
      .toMatch(/a Coinbase borrow of \$\{fmtUSDCents\(cbDraw\)\}\$\{cbFee > 0 \? ` \(\+\$\{fmtUSDCents\(cbFee\)\} fee\)` : ''\}/);
    expect(REVIEW, "CENTS the month review's Coinbase note — the paydown").toMatch(/a Coinbase paydown of \$\{fmtUSDCents\(cbPaydown\)\}/);
    expect(REVIEW, 'CENTS the month review formats no payment whole').not.toMatch(/\bfmtUSD\(/);
    // The sign-off seeds are kept to the cent: what a sign-off stores unless edited is never a rounded dollar (BL19).
    expect(REVIEW, 'CENTS the sign-off seeds kept to the cent (a stored default)')
      .toMatch(/useState\(toCents\(rollup\.streams\.draw\)\);[\s\S]*?useState\(toCents\(strikeMinPrefill\)\);[\s\S]*?useState\(toCents\(ndpPrefill\)\);/);
    expect(REVIEW, 'CENTS no seed rounds to a dollar').not.toMatch(/Math\.round\(/);
  });

  it('⭐ CENTS — no whole-dollar figure on THIS MONTH or Daily (BL19): every screen, card and sheet prints through fmtUSDCents', () => {
    const SCREENS: Record<string, string> = {
      DailyModeView: DAILY, PlanMonthCard: CARD, SafetyDashboard: SAFETY, PriceChart: PRICE_CHART, dailyView: DAY_VIEW,
      EventSheet: EVENT_SHEET, eventSheetModel: SHEET_MODEL, ReviewSheet: REVIEW, planMonthView: PLAN_VIEW,
      MonthEventsModal: MONTH_EVENTS,
    };
    for (const [name, src] of Object.entries(SCREENS)) {
      expect(src, `CENTS no whole-dollar formatter in ${name}`).not.toMatch(/\bfmtUSD\(|toLocaleString\(/);
    }
    // Simple mode: THIS MONTH's NDP card and the month log it opens print cents; the NDP's figures are gathered in the
    // card's inputs hook (Run 3).
    expect(SIMPLE, "CENTS THIS MONTH's NDP card").toMatch(/~\{fmtUSDCents\(ndpEstimate\)\} minimum to keep your line active/);
    expect(INPUTS, "CENTS THIS MONTH's NDP estimate to the cent").toMatch(/const ndpEstimate = planNdpEstimateUsd\(ndpBalance, blocApr\);/);
    expect(INPUTS, "CENTS THIS MONTH's NDP balance, the one helper").toMatch(/const ndpBalance\s+= planNdpBalance\(advisorActualBlocBalance, creditLine\);/);
    expect(DAILY, "CENTS Daily's NDP balance, the same helper").toMatch(/const ndpBalance\s+= planNdpBalance\(advisorActualBlocBalance, creditLine\);/);
    expect(SIMPLE, "CENTS THIS MONTH reads no whole-dollar NDP estimate").not.toMatch(/\.estimatedAmount/);
    expect(INPUTS, "CENTS the card's inputs read no whole-dollar NDP estimate").not.toMatch(/\.estimatedAmount/);
    expect(DAILY, "CENTS the review's NDP seed to the cent").toMatch(/ndpPrefill=\{planNdpEstimateUsd\(ndpBalance, blocApr\)\}/);
    expect(DAILY, "CENTS Daily's NDP check on the same balance").toMatch(/getNdpStatus\(ndpLastPaidDate, ndpBalance, blocApr\)\.status/);
    expect(DAILY, "CENTS Daily reads no whole-dollar NDP estimate").not.toMatch(/\.estimatedAmount/);
    // The price chart: whole by default — the Dashboard and the trusted viewer's home — and to the cent in the Safety card.
    expect(SAFETY, "CENTS the Safety card's price chart").toMatch(/<PriceChart money=\{fmtUSDCents\} \/>/);
    expect(PRICE_CHART, 'CENTS the price chart, whole by default (the Dashboard)').toMatch(/\{ money = fmtUSD \}/);
    expect(VIEWER_HOME, "CENTS the Dashboard's chart stays whole").toMatch(/<PriceChart \/>/);
    expect(SIMPLE, 'CENTS the month log opened from THIS MONTH').toMatch(/money=\{fmtUSDCents\}/);
    // Run 3 — the expenses prompt moved onto THIS MONTH with the Outlook gone: its words are planMonthView's, to the
    // cent, and its Update stores the average to the cent. THIS MONTH has no whole-dollar figure left.
    expect(SIMPLE, 'CENTS no whole-dollar formatter on THIS MONTH').not.toMatch(/\bfmtUSD\(|toLocaleString\(/);
    // Run 4 (BL26): the words and both buttons' labels are planMonthView's; the months before this one only (F-R4-1).
    expect(SIMPLE, 'CENTS the expenses prompt').toMatch(/const reanchor = planReanchorWords\(reanchorAvg, expenses\);/);
    expect(SIMPLE, 'CENTS the prompt prints its words').toMatch(/\{reanchor\.line\}/);
    expect(SIMPLE, 'CENTS its Update to the cent').toMatch(/onClick=\{\(\) => setExpenses\(toCents\(reanchorAvg\)\)\}\s*>\{reanchor\.update\}<\/button>/);
    expect(SIMPLE, 'CENTS its Keep dismisses').toMatch(/onClick=\{\(\) => setExpenseReanchorDismissedAt\(Math\.round\(reanchorAvg\)\)\}\s*>\{reanchor\.keep\}<\/button>/);
    expect(SIMPLE, 'REANCHOR the month in progress stays out').toMatch(
      /computeExpenseReanchor\(\s*monthlyLog, expenses, expenseReanchorDismissedAt, currentMonth\)/);
    // The month log overlay: whole in full mode (its default), cents when THIS MONTH passes them.
    expect(OVERLAY, 'CENTS the month log prints through its money prop').toMatch(/money = fmtUSD \}: MonthlyLogOverlayProps\)/);
    expect(OVERLAY, 'CENTS the month log has no fixed whole-dollar value').not.toMatch(/value=\{fmtUSD\(/);
  });
});

describe('⭐ I31 — the two plan cards compose no sentence: every one lives in planMonthView', () => {
  /** Every text a TSX source composes, read off its syntax tree (so comments never reach it): each JSX element's own
   *  text, with every {expression} as "X"; every string and template literal, each ${…} as "X"; imports skipped. With
   *  `within`, only inside the first JSX element whose opening tag matches it. */
  function textsOf(src: string, within?: RegExp): string[] {
    const sf = ts.createSourceFile('card.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let root: ts.Node | null = sf;
    if (within) {
      root = null;
      const find = (n: ts.Node): void => {
        if (root !== null) return;
        if (ts.isJsxElement(n) && within.test(n.openingElement.getText(sf))) root = n;
        else ts.forEachChild(n, find);
      };
      find(sf);
    }
    const out: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n)) return;
      if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
        let own = '';
        for (const c of n.children) {
          if (ts.isJsxText(c)) own += c.text;
          else if (ts.isJsxExpression(c)) own += c.expression ? ' X ' : '';
          else own += ' | ';
        }
        out.push(...own.split(' | '));
      }
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
      if (ts.isTemplateExpression(n)) out.push(n.head.text + n.templateSpans.map((sp) => ` X ${sp.literal.text}`).join(''));
      ts.forEachChild(n, visit);
    };
    if (root !== null) visit(root);
    return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s !== '');
  }
  /** Words: runs of two or more letters (the "X" stand-ins never count). */
  const wordCount = (s: string): number => (s.match(/[A-Za-z]{2,}/g) ?? []).length;
  /** The cards' own labels — headings, buttons and an aria name. Any other text of three or more words is a sentence,
   *  and lives in planMonthView. */
  const LABELS = [
    'To be within it today', 'Scrub through months', 'What month X recorded', 'To do this month', 'The plan for month X',
    'After this month', 'At month-end', '✎ View / edit this month', '← Back to current month', 'Why this plan?',
    "This month's plan",
  ];
  const CARD_TEXTS = textsOf(CARD);
  const DAILY_TEXTS = textsOf(DAILY, /className=\{styles\.pbcard\}/);
  it('the extraction is real (non-vacuous): both cards are read, and every listed label is still on one', () => {
    expect(CARD_TEXTS.length, 'I31 the card').toBeGreaterThan(50);
    expect(DAILY_TEXTS.length, 'I31 Daily\'s plan card').toBeGreaterThan(10);
    const all = new Set([...CARD_TEXTS, ...DAILY_TEXTS]);
    expect(LABELS.filter((l) => !all.has(l)), 'I31 a listed label left the cards').toEqual([]);
  });
  it('⭐ I31 — every text of three or more words on either plan card is one of its listed labels', () => {
    expect([...CARD_TEXTS, ...DAILY_TEXTS].filter((s) => wordCount(s) >= 3 && !LABELS.includes(s)), 'I31').toEqual([]);
  });
});

describe('⭐ NOTE · CACHE · HOLD · WHATIF · CRASH', () => {
  it('⭐ NOTE — D8: the one-time note is dismissed through the device-local setter, and never shown to a viewer', () => {
    expect(CARD).toMatch(/const noteDismissed = useStore\(\(s\) => s\.planNoteDismissed\);/);
    expect(CARD).toMatch(/const setNoteDismissed = useStore\(\(s\) => s\.setPlanNoteDismissed\);/);
    expect(CARD).toMatch(/\{!noteDismissed && !viewerMode && \(/);
    expect(CARD).toMatch(/onClick=\{\(\) => setNoteDismissed\(true\)\}/);
  });
  it('⭐ CACHE — §4.3: the breaker cache is written once, from a fresh fold only, in an effect', () => {
    const writes = HOOK.match(/\bsetBreakerCache\(/g) ?? [];
    expect(writes.length, 'CACHE one write').toBe(1);
    expect(HOOK, 'CACHE fresh only, in an effect').toMatch(
      /useEffect\(\(\) => \{\s*if \(fresh !== null && !sameSeed\(fresh, breakerCache\)\) setBreakerCache\(/);
    const writers = sources().filter((p) => /\bsetPlanBreakerCache\b/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(SRC, p).replace(/\\/g, '/'));
    expect(writers.sort(), 'CACHE no other writer').toEqual(['components/Almanac/usePlanMonth.ts', 'store/slices/uiSlice.ts', 'store/types.ts']);
    // …and read through the engine's own rule: a damaged cache is none (it never steers THE MOVE).
    expect(selectorBody(HOOK), 'CACHE validated').toMatch(/breakerCache: planBreakerCacheOf\(st\.planBreakerCache\),/);
    const readers = sources().filter((p) => /\bst\.planBreakerCache\b|\bs\.planBreakerCache\b/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(SRC, p).replace(/\\/g, '/'));
    expect(readers, 'CACHE validated — the only reader').toEqual(['components/Almanac/usePlanMonth.ts']);
  });
  it('⭐ HOLD — D9: every hold reader a viewer can reach reads the ONE fact through the ONE rule', () => {
    // A viewer never sees THIS MONTH or Daily (AppShell routes it to its own home), but it opens the Almanac: the Decision
    // face and the Emergency Console must hold exactly when the owner's do.
    expect(PLAYBOOK, 'HOLD the fact').toMatch(
      /return st\.viewerMode \? st\.viewerStrikeDepositISO : latestStrikeDepositISO\(st\.dayLog\);/);
    expect(PLAYBOOK, 'HOLD one rule').toMatch(
      /export function strikeHoldFrom\([^)]*\): StrikeHold \{\s*return strikeHoldAt\(latestStrikeDepositISO\(dayLog\), todayISO\);\s*\}/);
    expect(PLAYBOOK, 'HOLD the live builder').toMatch(/strikeInHold: strikeHoldAt\(live\.strikeDepositISO, live\.todayISO\)\.inHold,/);
    expect(HOOK, 'HOLD hook').toMatch(/strikeDepositISO: strikeDepositOf\(st\),/);
    expect(HOOK, 'HOLD hook rule').toMatch(/strikeHoldAt\(s\.strikeDepositISO, todayISO\)/);
    expect(FACE, 'HOLD face').toMatch(/strikeDepositISO: strikeDepositOf\(st\),/);
    expect(FACE, 'HOLD face rule').toMatch(/strikeHoldAt\(s\.strikeDepositISO, todayISO\)/);
    expect(CONSOLE, 'HOLD console').toMatch(/const strikeDeposit\s+= useStore\(\(s\) => strikeDepositOf\(s\)\);/);
    expect(CONSOLE, 'HOLD console rule').toMatch(/const hold = strikeHoldAt\(strikeDeposit, today\);/);
    expect(CONSOLE, 'HOLD console input').toMatch(/strikeDepositISO: strikeDeposit,/);
    expect(INPUTS, 'HOLD crash line').toMatch(/const strikeDeposit\s+= useStore\(\(s\) => strikeDepositOf\(s\)\);/);
    expect(INPUTS, 'HOLD crash line input').toMatch(/strikeDepositISO: strikeDeposit,/);
    // No screen reads the hold straight off a journal (a viewer's is empty).
    const direct = sources().filter((p) => /\bstrikeHoldFrom\(/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(SRC, p).replace(/\\/g, '/'));
    expect(direct, 'HOLD no screen reads a journal directly').toEqual(['components/Tools/crashPlaybookView.ts']);
  });
  it('⭐ WHATIF — §4.7: a what-if on the policy or the line flips THE MOVE\'s first line', () => {
    expect(FACE).toMatch(/const moveWhatIf = overlay\.supportPolicy !== undefined \|\| overlay\.creditLine !== undefined;/);
    const move = memoBody(FACE, 'move');
    expect(move, 'WHATIF passed').toMatch(/whatIf: moveWhatIf,/);
    expect(depsOf(move), 'WHATIF a dependency').toMatch(/\bmoveWhatIf\b/);
  });
  it('⭐ CRASH — D13: both main screens gate the crash title on the console\'s own rule', () => {
    expect(INPUTS, 'CRASH THIS MONTH and the Advisor tab').toMatch(/= isCrashDay\(\{/);
    expect(DAILY, 'CRASH Daily').toMatch(/const crashDay = isCrashDay\(\{/);
    expect(DAILY, 'CRASH Daily title').toMatch(/crashDay\s*\?\s*\{ tone: 'bad' as const, title: PLAN_CRASH_TITLE \}/);
  });
});
