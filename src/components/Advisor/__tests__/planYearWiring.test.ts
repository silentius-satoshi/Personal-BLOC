import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SETTINGS_FIELDS, VALIDATE_WHITELIST } from '../../../store/settingsFields';

/**
 * ⚠ STRUCTURAL GUARD — the plan of record's Run 3, the year (spec pbloc-spec-plan-of-record-v1 §15). The repo has no
 * render harness, so — like planRunWiring — these rules are read off the source:
 *
 *  - YEAR (D5) — the full-mode Advisor tab shows THIS MONTH's card on its own one run; its plan rows and their Pay /
 *    Skip toggles are gone (the policy has no skip);
 *  - LOG — the month log's planned figures (the Advisor tab's log and the month overlay, on both screens) read the same
 *    run through `planLogRows`;
 *  - PATHS (D5) — the Outlook became a link: THIS MONTH and the Advisor tab open the Almanac on the Decision face; the
 *    nav's Almanac button still opens the default face;
 *  - INV6 — fields with no reader left are inert, never removed: no component reads them, and their keys stay in the
 *    settings list and the backup whitelist, so an older backup still restores.
 *
 * Each check was proven red by a temporary edit to the real file before it landed (§15, the mutations).
 */
const SRC = join(process.cwd(), 'src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');
const ADVISOR = read('components/Advisor/AdvisorMain.tsx');
const SIMPLE = read('components/SimpleMode/SimpleModeView.tsx');
const OVERLAY = read('components/Advisor/MonthlyLogOverlay.tsx');
const SECTION = read('components/Advisor/MonthlyLogSection.tsx');
const SHELL = read('components/Layout/AppShell.tsx');
const ALMANAC = read('components/Almanac/AlmanacView.tsx');
const SETTINGS = read('components/Settings/SettingsMain.tsx');
const SIDEBAR = read('components/Advisor/AdvisorSidebar.tsx');
const INPUTS = read('components/SimpleMode/usePlanCardInputs.ts');

/** Every .ts/.tsx under a folder of src, outside tests. */
function sources(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== '__probe__') out.push(...sources(p)); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe('⭐ YEAR — D5: the Advisor tab shows the plan of record\'s card', () => {
  it('⭐ YEAR — the card, on the tab\'s one run, with the crash line, the NDP and the Ledger', () => {
    expect((ADVISOR.match(/= usePlanCardInputs\(\);/g) ?? []).length, 'YEAR one run').toBe(1);
    expect(ADVISOR, 'YEAR the card').toMatch(
      /<PlanMonthCard\s+pm=\{pm\}\s+currentMonth=\{currentMonth\}\s+strategyDone=\{strategyDone\}\s+crashLine=\{crashLine\}\s+ndp=\{ndp\}\s+ndpActionActive=\{ndpActionActive\}\s+onOpenLedger=\{onOpenLedger\}/);
    // The Ledger lives in Simple mode's Daily view: the shell opens it from full mode.
    expect(SHELL, 'YEAR the Ledger from full mode')
      .toMatch(/<AdvisorMain onOpenLedger=\{\(\) => \{ setSimpleMode\(true\); setSimpleView\('daily'\); \}\}/);
  });
  it('⭐ YEAR — the Advisor\'s plan rows and their Pay / Skip toggles are gone (the policy has no skip)', () => {
    expect(ADVISOR, 'YEAR no skip').not.toMatch(/advisorSkip|setAdvisorSkip|ActionRow|paySkip|overriddenPlan/);
    expect(ADVISOR, 'YEAR no Advisor month').not.toMatch(/\brunAdvisor\(|result\.rows|thisMonth\./);
    expect(ADVISOR, 'YEAR no projection').not.toMatch(/OutlookProjection|deriveAdvisorStart|getCollateralForTier/);
    // The sidebar no longer says where the projection starts — there is none.
    expect(SIDEBAR, 'YEAR the sidebar\'s projection line').not.toMatch(/projecting from|before log/);
  });
});

describe('⭐ INPUTS — the card\'s inputs, gathered once per screen', () => {
  it('⭐ INPUTS — the NDP as THIS MONTH read it, and the crash gate on the live Coinbase figures', () => {
    expect(INPUTS, 'INPUTS the NDP').toMatch(/const ndp\s+= getNdpStatus\(ndpLastPaidDate, ndpBalance, blocApr\);/);
    expect(INPUTS, 'INPUTS the annual clause, roll mode only').toMatch(/const ndpActionActive = blocMinPaymentSource === 'roll' && ndp\.status !== 'ok';/);
    expect(INPUTS, 'INPUTS the accrued balance, behind the loan switch')
      .toMatch(/const effectiveCbBalance\s+= hasCbLoan \? accruedCbBalance\(cbLoanBalance, cbAprPct, cbLoanBalanceAsOf\) : 0;/);
    expect(INPUTS, 'INPUTS the crash gate').toMatch(/hasCbLoan, ltvTriggered: cbPaymentStrategy === 'ltvTriggered', cbDebt: effectiveCbBalance, cbCollateralBtc,/);
    // THIS MONTH's NDP card reads the hook's figures — it computes none itself.
    expect(SIMPLE, 'INPUTS THIS MONTH takes them').toMatch(/const \{ pm, crashLine, ndp, ndpEstimate, ndpActionActive \} = usePlanCardInputs\(\);/);
    expect(SIMPLE, 'INPUTS no second NDP').not.toMatch(/getNdpStatus\(|planNdpBalance\(|planNdpEstimateUsd\(/);
    expect(ADVISOR, 'INPUTS the Advisor tab takes them').toMatch(/const \{ pm, crashLine, ndp, ndpActionActive \} = usePlanCardInputs\(\);/);
  });
});

describe('⭐ LOG — the month log\'s planned figures are the plan\'s run', () => {
  it('⭐ LOG — both screens hand the log their one run\'s rows', () => {
    expect(ADVISOR, 'LOG the Advisor tab').toMatch(
      /const logRows = useMemo\(\(\) => planLogRows\(pm\.run\.sim, currentMonth\), \[pm\.run\.sim, currentMonth\]\);/);
    expect((ADVISOR.match(/months=\{logRows\}/g) ?? []).length, 'LOG the log and the overlay').toBe(2);
    expect(SIMPLE, 'LOG THIS MONTH').toMatch(
      /const overlayRows = useMemo\(\(\) => planLogRows\(pm\.run\.sim, currentMonth\), \[pm\.run\.sim, currentMonth\]\);/);
    expect(SIMPLE, 'LOG THIS MONTH\'s overlay').toMatch(/months=\{overlayRows\}/);
  });
  it('⭐ LOG — the log and the overlay take the plan\'s rows, and their forms start from the plan\'s own figures', () => {
    for (const [name, src] of Object.entries({ section: SECTION, overlay: OVERLAY })) {
      expect(src, `LOG ${name} type`).toMatch(/months:\s+PlanLogRow\[\];/);
      expect(src, `LOG ${name} no Advisor row`).not.toMatch(/AdvisorMonthRow|typeof runAdvisor/);
      // The plan's Strike paydown — never the Advisor's income residual (income − CB payment − buy).
      expect(src, `LOG ${name} no residual`).not.toMatch(/income - \(/);
    }
    expect(SECTION, 'LOG the section\'s paydown').toMatch(/paydown:\s+String\(Math\.round\(row\.paydown\)\),/);
    expect(OVERLAY, 'LOG the overlay\'s paydown').toMatch(/paydown:\s+fmt\(row\.paydown\),/);
    // The overlay's LTVs are the run's own month-end LTVs, through the editable-number rule (∞ → 0, never "Infinity").
    expect(OVERLAY, 'LOG the overlay\'s Strike LTV').toMatch(/strikeLtvPct: fmt\(ltvFieldNumber\(row\.blocLtv\)\),/);
    expect(OVERLAY, 'LOG the overlay\'s Coinbase LTV').toMatch(/cbLtvPct:\s+fmt\(ltvFieldNumber\(row\.cbLtv\)\),/);
    expect(OVERLAY, 'LOG no tier collateral').not.toMatch(/collateralBtc/);
  });
});

describe('⭐ PATHS — D5: the Outlook is a link to the Decision face', () => {
  it('⭐ PATHS — THIS MONTH has no Outlook switch; it links to the Decision face', () => {
    expect(SIMPLE, 'PATHS no switch').not.toMatch(/segmentControl|simpleSegment|OutlookProjection|>Outlook</);
    expect(SIMPLE, 'PATHS the link').toMatch(/<button className=\{styles\.pathsLink\} onClick=\{onOpenPlanPaths\}>\{PLAN_PATHS_LINK\} →<\/button>/);
    expect(SHELL, 'PATHS THIS MONTH\'s link').toMatch(/<SimpleModeView [^>]*onOpenPlanPaths=\{goPlanPaths\}/);
  });
  it('⭐ PATHS — the Advisor tab links there too, while the Almanac tab can open', () => {
    expect(ADVISOR, 'PATHS the link').toMatch(
      /\{onOpenPlanPaths && \(\s*<button className=\{styles\.pathsLink\} onClick=\{onOpenPlanPaths\}>\{PLAN_PATHS_LINK\} →<\/button>\s*\)\}/);
    expect(SHELL, 'PATHS hidden tab → no link').toMatch(/const planPathsInFullMode = hiddenTabs\.includes\('almanac'\) \? null : goPlanPaths;/);
    expect(SHELL, 'PATHS full mode').toMatch(/onOpenPlanPaths=\{planPathsInFullMode\}/);
  });
  it('⭐ PATHS — the link opens the Decision face; the nav\'s button the default; leaving forgets the face', () => {
    expect(SHELL, 'PATHS the face').toMatch(/const goPlanPaths = \(\) => \{ setAlmanacFace\('decision'\);/);
    // goAlmanac sets no face and takes NO argument: the nav passes it as onClick, so a click event must never become a
    // face. Leaving the hub (the effect below) is what brings every other way in back to the default.
    expect(SHELL, 'PATHS the nav').toMatch(
      /const goAlmanac {2}= \(\) => \{ setPreviousTab\(activeTab as Exclude<ActiveTab, 'settings'>\); setActiveTab\('almanac'\); \};/);
    expect(SHELL, 'PATHS forgotten on leaving').toMatch(
      /useEffect\(\(\) => \{ if \(activeTab !== 'almanac'\) setAlmanacFace\(undefined\); \}, \[activeTab\]\);/);
    expect((SHELL.match(/<AlmanacView initialFace=\{almanacFace\} \/>/g) ?? []).length, 'PATHS both modes').toBe(2);
    expect(SHELL, 'PATHS no bare hub').not.toMatch(/<AlmanacView \/>/);
    expect(ALMANAC, 'PATHS read at mount').toMatch(/const \[face, setFace\] = useState<Face>\(initialFace \?\? 'halving'\);/);
  });
  it('⭐ PATHS — the expenses prompt moved onto THIS MONTH, owner-only (its Update writes the plan)', () => {
    expect(SIMPLE, 'PATHS the prompt').toMatch(/\{showReanchor && !viewerMode && \(/);
  });
});

describe('⭐ INV6 — invariant 6: retired fields are inert, never removed', () => {
  // Run 3 leaves these with no reader: the Pay / Skip toggles (the Advisor's plan rows), the refill's rotate-back level
  // (runAdvisor off every screen) and the projection's month-start base.
  const RETIRED = ['advisorSkipBlocDraw', 'advisorSkipCbPayment', 'advisorSkipBtcBuying', 'cbRotateBackPct', 'advisorMonthStartBalance'];

  it('⭐ INV6 — no component reads them (the store keeps them for sync, backups and the viewer)', () => {
    const components = sources(join(SRC, 'components'));
    expect(components.length, 'INV6 the sweep reads the components').toBeGreaterThan(100);
    for (const f of RETIRED) {
      const readers = components.filter((p) => new RegExp(`\\b${f}\\b`).test(readFileSync(p, 'utf8')))
        .map((p) => relative(SRC, p).replace(/\\/g, '/'));
      expect(readers, `INV6 ${f}`).toEqual([]);
    }
    // Writes may stay — a retired field keeps its writers until its key leaves. One is left: the month review's sign-off
    // still carries the signed month's ending balance into the month-start base. Harmless: nothing reads it.
    const writers = components.filter((p) => /\bset(?:AdvisorSkip\w+|CbRotateBackPct|AdvisorMonthStartBalance)\b/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(SRC, p).replace(/\\/g, '/'));
    expect(writers, 'INV6 the one writer left').toEqual(['components/Daily/DailyModeView.tsx']);
  });
  it('⭐ INV6 — their keys stay in the settings list and the backup whitelist, so an older backup still restores', () => {
    for (const f of RETIRED) {
      expect(SETTINGS_FIELDS as readonly string[], `INV6 ${f} listed`).toContain(f);
      expect([...VALIDATE_WHITELIST], `INV6 ${f} restorable`).toContain(f);
    }
  });
  it('⭐ INV6 — Settings and Quick Setup carry no editor for them', () => {
    expect(SETTINGS, 'INV6 no rotate-back').not.toMatch(/Rotate-back/);
    expect(SETTINGS, 'INV6 the order check without it').toMatch(/\{!\(cbLtvTargetPct < cbLtvTriggerPct && cbLtvTriggerPct < 86\) && \(/);
    expect(SETTINGS, 'INV6 the order hint').toMatch(/Thresholds must satisfy target &lt; trigger &lt; 86% \(Morpho liquidation\)\./);
    for (const [name, src] of Object.entries({ settings: SETTINGS, quickSetup: SIMPLE })) {
      expect(src, `INV6 ${name} no month-start field`).not.toMatch(/Balance at start of this month/);
    }
    // The Outlook is gone, so no hint names it.
    expect(SETTINGS, 'INV6 no Outlook').not.toMatch(/Outlook/);
  });
});
