// BL14 (Batch 1, build 2) — Settings → Your plan's goal field. No DOM harness in this repo, so its saving rule is read off
// the source (the e2e types into it): saved on leaving the field or Enter, never per keystroke — typing "2.5" must never
// send "2" and "2." to the plan, and the sync.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GOAL_HINT, GOAL_BAD, GOAL_CLEAR } from '../YourPlanSection';

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
    expect(GOAL_HINT).toContain('minus what you owe');
    // δ-L9 — the engine's own order in a month that doesn't borrow: income, then the cash reserve, then unpaid.
    expect(GOAL_HINT).toContain("your paycheck pays the bills, then your cash reserve if you set one, and any they can't cover go unpaid");
    // δ-L9 — a loan over its limit is repaid first (the restore), then the goal's order.
    expect(GOAL_HINT).toContain('repays a loan over its limit first, then Strike, then Coinbase');
    // δ-L2 — the crash defense still runs at the goal: the only borrowing there.
    expect(GOAL_HINT).toContain('buys nothing and borrows only to defend Coinbase in a crash');
    expect(GOAL_HINT).toContain('borrowing and buying resume');
    expect(GOAL_HINT).not.toMatch(/\bshould\b|\bsafe\b|guarantee/i);
    expect(GOAL_BAD).toContain('leave it empty for no goal');
    expect(GOAL_CLEAR).toBe('No goal');
  });
});
