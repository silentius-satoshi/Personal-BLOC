// BL34–BL35 (Batch 1, build 2d — F-2c-1) — what a number field saves, and when. No DOM harness renders a focus or a blur
// here, so the rules are pure (numberInputModel) and NumberInput's wiring, each field's save mode and the swipe-back's
// blur are read off the source; the e2e clicks real fields (numberField.spec.ts) and swipes them away with a real touch
// stream (numberFieldSwipe.spec.ts). ⚠ SYNTHETIC round figures — this repo is public.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { keystrokeWrite, leaveCommits, numberCommit, SAVE_DATED } from '../numberInputModel';

const read = (f: string): string => readFileSync(join(process.cwd(), f), 'utf8');
const SRC = read('src/components/ui/NumberInput.tsx');

describe('⭐ NUMBER COMMIT — leaving a number field, Enter or Save saves only what the owner typed', () => {
  it('⭐ UNTOUCHED — a click in and out saves nothing, and the field shows its value', () => {
    expect(numberCommit({ typed: false, raw: '50000', value: 50000, min: 0 })).toEqual({ write: null, show: '50000' });
    // the cold total at sat precision, and a figure with more decimals than the field shows (5d §12's stray blur)
    expect(numberCommit({ typed: false, raw: '0.55000000', value: 0.55, min: 0, decimals: 8 }).write).toBeNull();
    expect(numberCommit({ typed: false, raw: '0.12345679', value: 0.123456789, min: 0, decimals: 8 }).write).toBeNull();
    // a stored figure outside the field's range stays as it is: only what the owner types is clamped
    expect(numberCommit({ typed: false, raw: '90', value: 90, min: 0, max: 85 })).toEqual({ write: null, show: '90' });
    // a dated field too: untouched, nothing
    expect(numberCommit({ typed: false, raw: '50000', value: 50000, min: 0, dated: true }).write).toBeNull();
  });

  it('⭐ SYNCED — a value that changed while the field had focus is shown, never overwritten', () => {
    expect(numberCommit({ typed: false, raw: '50000', value: 52000, min: 0 })).toEqual({ write: null, show: '52000' });
  });

  it('⭐ TYPED — a new figure saves, clamped to the field\'s range', () => {
    expect(numberCommit({ typed: true, raw: '40000', value: 50000, min: 0 })).toEqual({ write: 40000, show: '40000' });
    expect(numberCommit({ typed: true, raw: '90', value: 50, min: 0, max: 85 })).toEqual({ write: 85, show: '85' });
    expect(numberCommit({ typed: true, raw: '-5', value: 3, min: 0 })).toEqual({ write: 0, show: '0' });
    expect(numberCommit({ typed: true, raw: '0.75', value: 0.6, min: 0, decimals: 8 }))
      .toEqual({ write: 0.75, show: '0.75000000' });
  });

  it('⭐ ONCE — a figure the field already shows is not saved again; unreadable text saves nothing', () => {
    expect(numberCommit({ typed: true, raw: '40000', value: 40000, min: 0 })).toEqual({ write: null, show: '40000' });
    expect(numberCommit({ typed: true, raw: '0.75', value: 0.75, min: 0, decimals: 8 }))
      .toEqual({ write: null, show: '0.75000000' });
    expect(numberCommit({ typed: true, raw: '', value: 7, min: 0 })).toEqual({ write: null, show: '7' });
    expect(numberCommit({ typed: true, raw: 'abc', value: 7, min: 0 })).toEqual({ write: null, show: '7' });
  });

  it('⭐ DATED — a dated field\'s typed figure saves even when unchanged (saving dates it); unreadable, nothing', () => {
    expect(numberCommit({ typed: true, raw: '50000', value: 50000, min: 0, dated: true })).toEqual({ write: 50000, show: '50000' });
    expect(numberCommit({ typed: true, raw: '-5', value: 3, min: 0, dated: true })).toEqual({ write: 0, show: '0' });
    expect(numberCommit({ typed: true, raw: '', value: 7, min: 0, dated: true })).toEqual({ write: null, show: '7' });
    expect(SAVE_DATED, 'DATED the button says so').toBe('Save — dated today');
  });

  it('⭐ MODES — only a live field hands a figure on as it is typed; a button field keeps its typing when left', () => {
    expect(keystrokeWrite('live', '40000')).toBe(40000);
    expect(keystrokeWrite('live', '-5'), 'MODES a negative waits for leaving').toBeNull();
    expect(keystrokeWrite('live', '')).toBeNull();
    expect(keystrokeWrite('leave', '40000'), 'MODES a plan setting saves on leaving').toBeNull();
    expect(keystrokeWrite('button', '40000'), 'MODES a dated figure saves on Save').toBeNull();
    expect([leaveCommits('live'), leaveCommits('leave'), leaveCommits('button')]).toEqual([true, true, false]);
  });

  it('⭐ WIRING — NumberInput saves only through the rules: typing marks the field, focus clears it, leaving, Enter and Save use them', () => {
    expect(SRC, 'WIRING every field says how it saves').toMatch(/\n {2}save: NumberSave;\n/);
    expect(SRC, 'WIRING the rule').toMatch(/const pending = numberCommit\(\{ typed, raw, value, min, max, decimals, dated: save === 'button' \}\);/);
    expect(SRC, 'WIRING a held figure').toMatch(/const holds = save === 'button' && pending\.write !== null;/);
    expect(SRC, 'WIRING only the rule saves').toMatch(/function commit\(\) \{\s*if \(pending\.write !== null\) onChange\(pending\.write\);\s*setRaw\(pending\.show\);\s*setTyped\(false\);\s*\}/);
    expect(SRC, 'WIRING Cancel saves nothing').toMatch(/function cancel\(\) \{\s*setRaw\(fmt\(value\)\);\s*setTyped\(false\);\s*\}/);
    expect(SRC, 'WIRING typing marks it').toMatch(/if \(ro\) return;\s*setTyped\(true\);/);
    expect(SRC, 'WIRING a keystroke through its rule').toMatch(/const w = keystrokeWrite\(save, raw\);\s*if \(w !== null\) onChange\(w\);/);
    expect(SRC, 'WIRING focus clears it, a held figure aside').toMatch(/onFocus=\{\(\) => \{ focused\.current = true; if \(!holds\) setTyped\(false\); \}\}/);
    expect(SRC, 'WIRING leaving').toMatch(/onBlur=\{\(\) => \{ if \(!ro\) \{ focused\.current = false; if \(leaveCommits\(save\)\) commit\(\); else if \(!holds\) cancel\(\); \} \}\}/);
    expect(SRC, 'WIRING Enter').toMatch(/onKeyDown=\{\(e\) => \{ if \(!ro && e\.key === 'Enter'\) commit\(\); \}\}/);
    expect(SRC, 'WIRING a sync never overwrites a held figure').toMatch(/if \(!focused\.current && !holds\) setRaw\(fmt\(value\)\);/);
    expect(SRC, 'WIRING the buttons only while held').toMatch(/\{holds && \(\s*<div className=\{styles\.saveRow\}>\s*<button type="button" className=\{styles\.saveBtn\} onClick=\{commit\}/);
    expect(SRC, 'WIRING Cancel').toMatch(/className=\{styles\.cancelBtn\} onClick=\{cancel\}/);
    // Two writers and no third: a live keystroke's, and the rule's.
    expect((SRC.match(/onChange\(/g) ?? []).length, 'WIRING two writers').toBe(2);
  });
});

// ── Every NumberInput, and how it saves ─────────────────────────────────────────────────────────────────────────────
// Each `<NumberInput … />` in the app, in source order, with its mode. A field that records a figure read off Strike or
// Coinbase — dated by its save, or a journal reading — has a Save button; a plan setting (a field of the synced plan, or
// the manual BTC price) saves on leaving; only drafts, what-ifs and the read-only dry-powder field are live. A field
// added, moved or re-moded changes this table, so the change is a decision, never a slip.
const SITES: Record<string, string[]> = {
  'src/components/Advisor/AdvisorSidebar.tsx': ['button', 'button'],
  'src/components/Almanac/ScenarioFace.tsx': ['live'],
  'src/components/CoinbaseLoan/CoinbaseLoanSidebar.tsx': ['leave', 'button', 'button', 'button', 'leave'],
  'src/components/Daily/EventSheet.tsx': Array(10).fill('live'),
  'src/components/Inputs/InputsPanel.tsx': ['leave', 'leave', 'leave', 'leave', 'live'],
  'src/components/Mining/MiningInputsPanel.tsx': ['live'],
  'src/components/Settings/SettingsMain.tsx': ['leave', 'leave', 'leave', 'button', 'live', 'leave', 'leave', 'leave',
    'button', 'button', 'button', 'button', 'leave', 'leave', 'leave', 'button'],
  'src/components/SimpleMode/SafetyDashboard.tsx': Array(5).fill('live'),
};
/** The writers a Save button guards: the four dated setters, Coinbase's collateral reading, Strike's collateral reading. */
const DATED = /\b(setCbLoanBalance|setCbLiquidationPrice|setAdvisorActualBlocBalance|setColdStorageBtc|setCbCollateralBtc|emitBalanceReading)\b/;
/** Plan settings — the synced plan's setters and the manual BTC price (`setBtcPrice`): saved on leaving, never live. */
const PLAN = /\b(setIncome|setExpenses|setCreditLine|setBlocApr|setBlocStatementMinimum|setBlocMinPaymentDueDay|setCbAprPct|setCbLtvTriggerPct|setCbLtvTargetPct|setBtcPrice)\b/;

function sites(file: string): { mode: string | null; writer: string }[] {
  const s = read(file);
  return [...s.matchAll(/<NumberInput\b/g)].map((m) => {
    const block = s.slice(m.index, s.indexOf('/>', m.index));
    const mode = /\bsave="(live|leave|button)"/.exec(block)?.[1] ?? null;
    const writer = /onChange=\{([\s\S]*?)\}\s*(?=\n|[a-zA-Z]+=|\/\/|\/?>|$)/.exec(block)?.[1] ?? '';
    return { mode, writer };
  });
}

/** Every app file (tests aside) that renders a NumberInput. */
function filesWithNumberInput(dir = 'src'): string[] {
  return readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === '__tests__' ? [] : filesWithNumberInput(p);
    return /\.tsx$/.test(e.name) && /<NumberInput\b/.test(read(p)) ? [p] : [];
  });
}

describe('⭐ SITES — every number field says how it saves, and the right way', () => {
  it('⭐ SITES — the 45 fields, by file and in order: 11 with a Save button, 15 saved on leaving, 19 live', () => {
    expect(filesWithNumberInput().sort(), 'SITES every file that renders one').toEqual(Object.keys(SITES).sort());
    const all = Object.entries(SITES).flatMap(([f, modes]) => {
      expect(sites(f).map((x) => x.mode), `SITES ${f}`).toEqual(modes);
      return modes;
    });
    expect(all.length).toBe(45);
    expect(['button', 'leave', 'live'].map((m) => all.filter((x) => x === m).length)).toEqual([11, 15, 19]);
  });

  it("⭐ SITES — Strike's two collateral fields: the reading carries the figure saved, from the live collateral", () => {
    for (const f of ['src/components/Settings/SettingsMain.tsx', 'src/components/Advisor/AdvisorSidebar.tsx']) {
      expect(read(f), `SITES ${f}`).toMatch(/value=\{currentBtcHeld\}\s*onChange=\{\(v\) => emitBalanceReading\(\{ strikeCollateral: v \}\)\}/);
      expect(read(f), `SITES ${f}: no draft left`).not.toMatch(/btcHeldDraft/);
    }
  });

  it('⭐ SITES — a dated figure or a reading has its Save button; a plan setting is never live', () => {
    for (const f of Object.keys(SITES)) {
      for (const { mode, writer } of sites(f)) {
        expect(DATED.test(writer) ? mode === 'button' : mode !== 'button', `SITES ${f}: ${writer.slice(0, 60)}`).toBe(true);
        if (PLAN.test(writer)) expect(mode, `SITES ${f}: ${writer.slice(0, 60)}`).toBe('leave');
      }
    }
  });
});

// ── Leaving the page ────────────────────────────────────────────────────────────────────────────────────────────────
describe('⭐ LEAVING THE PAGE — the edge swipe-back leaves the field first (F1)', () => {
  it('⭐ GESTURE — a committed swipe and a forwarded tap blur the focused field before the page goes', () => {
    // React runs no onBlur for a field it unmounts, and neither a touch swipe nor the zone's forwarded tap moves focus:
    // without the blur, a typed plan setting would leave unsaved (measured: e2e/numberFieldSwipe.spec.ts).
    const g = read('src/components/ui/EdgeBackGesture.tsx');
    expect(g, 'GESTURE the one blur').toMatch(/const blurFocused = \(\) => \(document\.activeElement as HTMLElement \| null\)\?\.blur\(\);/);
    expect(g, 'GESTURE a committed swipe blurs first').toMatch(/if \(doBack\) \{\s*blurFocused\(\);/);
    expect(g, 'GESTURE a forwarded tap blurs first').toMatch(/blurFocused\(\);\s*try \{ \(document\.elementFromPoint\(x, y\) as HTMLElement \| null\)\?\.click\(\); \}/);
  });
});
