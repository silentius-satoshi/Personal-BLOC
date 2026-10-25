// BL14 (Batch 1, build 2) — Settings → Your plan's goal field. No DOM harness in this repo, so its saving rule is read off
// the source (the e2e types into it): saved on leaving the field or Enter, never per keystroke — typing "2.5" must never
// send "2" and "2." to the plan, and the sync. BL33 (build 2c): the GOAL group first, a short lead, where you stand (the
// Dashboard tile's own reading and words), and "What happens at your goal" folded, one fact a line.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GOAL_LEAD, GOAL_RULES, GOAL_RULES_TITLE, GOAL_BAD, GOAL_CLEAR, GoalNow } from '../YourPlanSection';
import { GOAL_STAND_DOWN_WORDS } from '../../Almanac/supportPolicyView';
import { goalNowView } from '../../Viewer/goalTileView';

const SRC = readFileSync(join(process.cwd(), 'src/components/Settings/YourPlanSection.tsx'), 'utf8');

describe('⭐ GOAL FIELD — Settings\' one editor of the goal', () => {
  it('⭐ GOAL FIELD — saved on blur and on Enter, through parseGoalInput; a keystroke saves nothing', () => {
    expect(SRC).toMatch(/onChange=\{\(e\) => \{ setRaw\(e\.target\.value\); setBad\(false\); \}\}/);
    expect(SRC).toMatch(/onBlur=\{\(\) => \{ focused\.current = false; commit\(\); \}\}/);
    expect(SRC).toMatch(/onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter'\) commit\(\); \}\}/);
    expect(SRC).toMatch(/const v = parseGoalInput\(raw\);\s*if \(v === undefined\) \{ setBad\(true\); return; \}/);
    expect((SRC.match(/\bsetGoal\(/g) ?? []).length, 'two writers: the commit and "No goal"').toBe(2);
    expect(SRC, 'the field shows the goal through its read rule').toMatch(/const goal = useStore\(\(s\) => planGoalOf\(s\.planGoalNetBtc\)\);/);
    expect(SRC, 'another device\'s edit lands while the field is not being typed in')
      .toMatch(/useEffect\(\(\) => \{ if \(!focused\.current\) setRaw\(goalText\(goal\)\); \}, \[goal\]\);/);
  });

  it('⭐ GOAL FIELD — δ-L10: after a save the field shows what the plan KEPT, so a refused edit snaps back', () => {
    expect(SRC).toMatch(/const shown = \(\) => goalText\(planGoalOf\(useStore\.getState\(\)\.planGoalNetBtc\)\);/);
    expect(SRC).toMatch(/setGoal\(v\);\s*setRaw\(shown\(\)\);/);
    expect(SRC).toMatch(/setGoal\(null\); setRaw\(shown\(\)\);/);
    expect(SRC, 'never the typed text after a save').not.toMatch(/setRaw\(goalText\(v\)\)|setRaw\(''\)/);
  });

  it('⭐ GOAL FIELD — its words: what counts, what the plan does at it, the bills, re-entry, and how to clear it', () => {
    // BL33 — the lead says what net coins are and what the goal does; the rules hold the rest, one fact a line.
    expect(GOAL_LEAD).toContain('minus what you owe');
    // δ-L2 — the crash defense still runs at the goal: the only borrowing there.
    expect(GOAL_LEAD).toContain('buys nothing and borrows only to defend Coinbase in a crash');
    // δ-L9 — the engine's own order in a month that doesn't borrow: income, then the cash reserve, then unpaid.
    expect(GOAL_RULES[0]).toBe("Your paycheck pays the bills, then your cash reserve if you set one, and any they can't cover go unpaid.");
    // δ-L9 — a loan over its limit is repaid first (the restore), then the goal's order.
    expect(GOAL_RULES[1]).toContain('repays a loan over its limit first, then Strike, then Coinbase');
    // BL32 — the stand-down, in its ONE phrase.
    expect(GOAL_RULES[2]).toBe(`With both loans repaid, ${GOAL_STAND_DOWN_WORDS}.`);
    expect(GOAL_RULES[3]).toContain('borrowing and buying resume');
    expect(GOAL_RULES).toHaveLength(4);
    for (const w of [GOAL_LEAD, ...GOAL_RULES]) expect(w).not.toMatch(/\bshould\b|\bsafe\b|guarantee/i);
    expect(GOAL_RULES_TITLE).toBe('What happens at your goal');
    expect(GOAL_BAD).toContain('leave it empty for no goal');
    expect(GOAL_CLEAR).toBe('No goal');
  });
});

describe('⭐ GOAL GROUP — first on "Your plan", where you stand, and the rules folded (BL33)', () => {
  it('⭐ GOAL FIRST — the goal group renders before the support policy\'s', () => {
    const group = SRC.indexOf('<GoalGroup styles={styles} />');
    const policy = SRC.indexOf('>SUPPORT POLICY<');
    expect(group, 'GOAL FIRST the group').toBeGreaterThan(0);
    expect(policy, 'GOAL FIRST the policy group').toBeGreaterThan(group);
    expect((SRC.match(/>GOAL</g) ?? []).length, 'GOAL FIRST one goal label').toBe(1);
  });

  it('⭐ GOAL NOW — the reading is the Dashboard tile\'s: the owner\'s live derive, through the one hook, against the SAVED goal', () => {
    const body = SRC.slice(SRC.indexOf('function GoalGroup('), SRC.indexOf('export default function YourPlanSection'));
    expect(body, 'GOAL NOW the saved goal').toMatch(/const goal = useStore\(\(s\) => planGoalOf\(s\.planGoalNetBtc\)\);/);
    // The owner Dashboard's own mount (AppShell: previewSafeSnap={null}) — never undefined, which would read a store snapshot.
    expect(body, 'GOAL NOW the trusted live derive').toMatch(/const safety = useViewerSafety\(null\);/);
    expect(body, 'GOAL NOW the one hook').toMatch(/const net = useNetCoinsToday\(safety\);/);
    expect(body, 'GOAL NOW the tile\'s words').toMatch(/const now = goalNowView\(net, goal\);/);
    // The order: the lead, the reading, the field, the rules.
    const at = (needle: string) => body.indexOf(needle);
    expect(at('{GOAL_LEAD}'), 'GOAL NOW lead').toBeGreaterThan(0);
    expect(at('{now && <GoalNow view={now} />}'), 'GOAL NOW reading after the lead').toBeGreaterThan(at('{GOAL_LEAD}'));
    expect(at('<GoalField />'), 'GOAL NOW field after the reading').toBeGreaterThan(at('{now && <GoalNow view={now} />}'));
    expect(at('<summary>{GOAL_RULES_TITLE}</summary>'), 'GOAL NOW rules last').toBeGreaterThan(at('<GoalField />'));
    expect(body, 'GOAL NOW one rule a line').toMatch(/\{GOAL_RULES\.map\(\(r\) => <li key=\{r\}>\{r\}<\/li>\)\}/);
  });

  it('⭐ GOAL NOW — renders exactly the view: the figure, the bar with a goal (none without), the line, named for a screen reader', () => {
    const under = goalNowView(0.5, 2);
    if (under === null) throw new Error('premise');
    const html = renderToStaticMarkup(createElement(GoalNow, { view: under }));
    expect(html).toContain('>₿0.500 of ₿2.000<');
    expect(html).toContain('width:25.0%');
    expect(html).toContain('>net coins today · 25%<');
    expect(html).toContain('role="group" aria-label="Your goal: 0.500 bitcoin in net coins today, of 2.000 — 25%."');
    const none = goalNowView(1.8, null);
    if (none === null) throw new Error('premise');
    const bare = renderToStaticMarkup(createElement(GoalNow, { view: none }));
    expect(bare).toContain('>₿1.800<');
    expect(bare).toContain('>net coins today<');
    expect(bare, 'no goal, no bar').not.toContain('width:');
    expect(bare).toContain('aria-label="Net coins today: 1.800 bitcoin."');
  });
});
