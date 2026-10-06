import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The plan of record, Run 1 (spec `pbloc-spec-plan-of-record-v1` D1/D2/D9) — the support policy's six settings as the
// owner's SAVED plan, on the REAL store. Every ⭐ was proven red by a named mutation (spec v1.0, Appendix P).
// Round synthetic figures only — this repo is public.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { useStore } from '../useStore';
import { buildSettingsPayload, buildViewerSnapshotPayload } from '../payloads';
import { PLAN_EVENT_FIELDS, PREFS_FIELDS, SETTINGS_FIELDS, VALIDATE_WHITELIST, VIEWER_SETTINGS_FIELDS } from '../settingsFields';
import {
  PLAN_POLICY_DEFAULTS, PLAN_POLICY_FIELD, PLAN_POLICY_KEYS, PLAN_POLICY_RANGES, PLAN_POLICY_SEED, planPolicyOf,
} from '../../lib/planPolicy';
import { DEFAULT_SUPPORT_POLICY_SETTINGS, SUPPORT_POLICY_RANGES } from '../../components/Almanac/supportPolicyView';
import { PLAN_CLAMP } from '../../components/Almanac/planClamp';
import { buildPlanBackup } from '../../lib/backup/exportPlan';
import { validatePlanBackup } from '../../lib/backup/validatePlanBackup';
import { foldPlanEvents } from '../../lib/planEvents/fold';

const FIELDS = PLAN_POLICY_KEYS.map((k) => PLAN_POLICY_FIELD[k]);
const plan = () => {
  const s = useStore.getState() as unknown as Record<string, unknown>;
  return Object.fromEntries(FIELDS.map((f) => [f, s[f]]));
};
const policyEvents = () => useStore.getState().planEvents.filter((e) => (FIELDS as readonly string[]).includes(e.field));

beforeEach(() => {
  vi.useFakeTimers();   // the emit's 2s publish kick never fires
  useStore.setState({ ...PLAN_POLICY_SEED, planEvents: [], planDirty: false, viewerMode: false } as never);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('the plan of record — six synced plan fields (D1)', () => {
  it('⭐ PLAN FIELDS — the six are plan fields: synced, in the backup, never prefs; C1 is the one default', () => {
    for (const f of FIELDS) {
      expect(SETTINGS_FIELDS as readonly string[], `PLAN FIELDS ${f}`).toContain(f);
      expect(PLAN_EVENT_FIELDS as readonly string[], `PLAN FIELDS ${f}`).toContain(f);
      expect(PREFS_FIELDS as readonly string[], `PLAN FIELDS ${f}`).not.toContain(f);
      expect(VALIDATE_WHITELIST.has(f), `PLAN FIELDS ${f} restores`).toBe(true);
    }
    const { enabled: _on, ...faceDefaults } = DEFAULT_SUPPORT_POLICY_SETTINGS;
    expect(PLAN_POLICY_DEFAULTS, 'PLAN FIELDS C1').toEqual(faceDefaults);
    expect(SUPPORT_POLICY_RANGES, 'PLAN FIELDS ranges').toBe(PLAN_POLICY_RANGES);
    expect(Object.keys(PLAN_POLICY_FIELD).length, 'PLAN FIELDS — no off switch').toBe(6);
    // The slices' own seed — read from the initial state, which the beforeEach reset can't mask.
    const initial = useStore.getInitialState() as unknown as Record<string, unknown>;
    expect(Object.fromEntries(FIELDS.map((f) => [f, initial[f]])), 'PLAN FIELDS seed').toEqual(PLAN_POLICY_SEED);
    // lib/planPolicy.ts imports NOTHING: the store and the faces both read it, so it may depend on neither (§4.1). The
    // chartZoom.ts / infoTipModel.ts idiom, plus `from '…'`, which also catches an `export … from` re-export.
    const lib = readFileSync(join(process.cwd(), 'src/lib/planPolicy.ts'), 'utf8');
    expect(lib, 'PLAN FIELDS zero imports').not.toMatch(/^\s*import\b/m);
    expect(lib, 'PLAN FIELDS zero imports').not.toMatch(/\brequire\(/);
    expect(lib, 'PLAN FIELDS zero imports').not.toMatch(/\bfrom\s*['"]/);
  });

  it('⭐ EMIT — a change is a plan event: the field, one event, planDirty', () => {
    useStore.getState().setPlanPolicy({ cbStopAtSupportPct: 50 });
    const s = useStore.getState();
    expect(s.policyCbStopAtSupportPct, 'EMIT').toBe(50);
    expect(policyEvents().map((e) => [e.field, e.value]), 'EMIT').toEqual([['policyCbStopAtSupportPct', 50]]);
    expect(s.planDirty, 'EMIT').toBe(true);
  });

  it('⭐ CLAMP — out of range lands at the edge; junk lands at the default', () => {
    useStore.getState().setPlanPolicy({ cbStopAtSupportPct: 99, accumulateBelow: 0.2 });
    expect([useStore.getState().policyCbStopAtSupportPct, useStore.getState().policyAccumulateBelow], 'CLAMP edges')
      .toEqual([PLAN_POLICY_RANGES.cbStopAtSupportPct.max, PLAN_POLICY_RANGES.accumulateBelow.min]);
    useStore.getState().setPlanPolicy({ payDownAbove: Number.NaN });   // already at its default → no event
    expect(useStore.getState().policyPayDownAbove, 'CLAMP junk').toBe(PLAN_POLICY_DEFAULTS.payDownAbove);
  });

  it('⭐ QUIET — an unchanged value or `enabled` (no off switch in the plan) emits nothing', () => {
    useStore.getState().setPlanPolicy({ cbStopAtSupportPct: PLAN_POLICY_DEFAULTS.cbStopAtSupportPct });
    useStore.getState().setPlanPolicy({ enabled: false } as never);
    expect(useStore.getState().planEvents, 'QUIET').toEqual([]);
    expect(useStore.getState().planDirty, 'QUIET').toBe(false);
  });

  it('⭐ RESET — "Back to the defaults (C1)" emits all six as explicit events with one ts', () => {
    useStore.getState().setPlanPolicy({ cbStopAtSupportPct: 60, bearBufferMonths: 24 });
    useStore.getState().resetPlanPolicy();
    expect(plan(), 'RESET values').toEqual(PLAN_POLICY_SEED);
    const last = policyEvents().slice(-6);
    expect(last.map((e) => e.field).sort(), 'RESET six events').toEqual([...FIELDS].sort());
    expect(new Set(last.map((e) => e.ts)).size, 'RESET one ts').toBe(1);
    expect(foldPlanEvents(useStore.getState().planEvents), 'RESET folds to C1').toMatchObject(PLAN_POLICY_SEED);
  });

  it('⭐ READ — every reader sees the plan through its clamp: junk reads C1, out of range reads the edge', () => {
    // What no setter wrote — a restored backup is checked for its keys, never its values.
    const restored = { ...PLAN_POLICY_SEED, policyCbStopAtSupportPct: Number.NaN, policyPayDownAbove: 99, policyBearBufferMonths: '24' };
    expect(planPolicyOf(restored), 'READ')
      .toEqual({ ...PLAN_POLICY_DEFAULTS, payDownAbove: PLAN_POLICY_RANGES.payDownAbove.max });
    expect(planPolicyOf(PLAN_POLICY_SEED), 'READ C1').toEqual(PLAN_POLICY_DEFAULTS);
  });

  it('⭐ FOLD — a peer\'s event lands through the fold; a log without them leaves the plan alone', () => {
    useStore.getState().applyPlanFold({ policyStrikeStopAtSupportPct: 40 } as never);
    expect(useStore.getState().policyStrikeStopAtSupportPct, 'FOLD').toBe(40);
    useStore.getState().applyPlanFold({ income: 7777 });
    expect(useStore.getState().policyStrikeStopAtSupportPct, 'FOLD absent = not set').toBe(40);
  });
});

describe('the plan of record — backup and viewers', () => {
  it('⭐ BACKUP — the six export; a backup made before them still validates and restores, leaving them be', () => {
    useStore.getState().setPlanPolicy({ cbStopAtSupportPct: 55 });
    const backup = buildPlanBackup(useStore.getState());
    for (const f of FIELDS) expect(f in backup.plan.settings, `BACKUP exports ${f}`).toBe(true);

    const old = JSON.parse(JSON.stringify(backup));
    for (const f of FIELDS) delete old.plan.settings[f];   // a backup made before Run 1
    const v = validatePlanBackup(old);
    expect(v.ok, 'BACKUP old validates').toBe(true);
    if (!v.ok) return;
    useStore.getState().applyPlanBackup(v.backup);
    expect(useStore.getState().policyCbStopAtSupportPct, 'BACKUP old leaves the plan').toBe(55);

    const v2 = validatePlanBackup(JSON.parse(JSON.stringify({ ...backup, plan: { ...backup.plan, settings: { ...backup.plan.settings, policyCbStopAtSupportPct: 62 } } })));
    expect(v2.ok, 'BACKUP new validates').toBe(true);
    if (!v2.ok) return;
    useStore.getState().applyPlanBackup(v2.backup);
    expect(useStore.getState().policyCbStopAtSupportPct, 'BACKUP restores').toBe(62);
    expect(policyEvents().some((e) => e.field === 'policyCbStopAtSupportPct' && e.value === 62), 'BACKUP restores as an event').toBe(true);
  });

  it('⭐ VIEWER — a trusted viewer receives and applies the six (D9 EXPOSE); a safe snapshot carries none', () => {
    useStore.getState().setPlanPolicy({ cbStopAtSupportPct: 52, payDownAbove: 3.5 });
    const settings = buildViewerSnapshotPayload(useStore.getState(), 'trusted').settings as Record<string, unknown>;
    for (const f of FIELDS) {
      expect(f in settings, `VIEWER trusted ${f}`).toBe(true);
      expect(VIEWER_SETTINGS_FIELDS, `VIEWER applies ${f}`).toContain(f);
    }
    const safe = JSON.stringify(buildViewerSnapshotPayload(useStore.getState(), 'safe'));
    for (const f of FIELDS) expect(safe, `VIEWER safe ${f}`).not.toContain(f);

    useStore.setState({ ...PLAN_POLICY_SEED, planEvents: [], planDirty: false } as never);   // the viewer's own store
    useStore.getState().applyViewerSettings(settings);
    expect([useStore.getState().policyCbStopAtSupportPct, useStore.getState().policyPayDownAbove], 'VIEWER applies').toEqual([52, 3.5]);
    expect([useStore.getState().planEvents.length, useStore.getState().planDirty], 'VIEWER RAW').toEqual([0, false]);
    expect(buildSettingsPayload(useStore.getState()).policyCbStopAtSupportPct, 'VIEWER payload').toBe(52);
  });

  it('⭐ SEED — both seed resets return the plan to C1', () => {
    useStore.getState().setPlanPolicy({ cbStopAtSupportPct: 61 });
    useStore.getState().clearViewerData();
    expect(plan(), 'SEED clearViewerData').toEqual(PLAN_POLICY_SEED);
    useStore.getState().setPlanPolicy({ cbStopAtSupportPct: 61 });
    useStore.getState().resetPlanToSeeds();
    expect(plan(), 'SEED resetPlanToSeeds').toEqual(PLAN_POLICY_SEED);
  });
});

// ── the wiring (source pins — the faces render under the browser only) ───────────────────────────────────────────
const SRC = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
const FACES = ['DecisionFace.tsx', 'UnifiedFace.tsx', 'OwnershipFace.tsx', 'CyclingFace.tsx'];

describe('the plan of record — the wiring', () => {
  it('⭐ FACES START FROM THE PLAN — defaults, then the plan, then the face\'s what-if; no face writes the plan (D2)', () => {
    for (const f of FACES) {
      const src = SRC(`components/Almanac/${f}`);
      expect(src, `FACES ${f} reads the plan`).toMatch(/const plan = usePlanPolicy\(\);/);
      expect(src, `FACES ${f} order`)
        .toMatch(/\{ \.\.\.DEFAULT_SUPPORT_POLICY_SETTINGS, \.\.\.plan, \.\.\.overlay\.supportPolicy \}/);
      expect(src, `FACES ${f} deps`).toMatch(/\[plan, overlay\.supportPolicy\]/);
      expect(src, `FACES ${f} never writes the plan`).not.toMatch(/setPlanPolicy|resetPlanPolicy/);
    }
    expect(SRC('components/Almanac/usePlanPolicy.ts'), 'FACES hook reads only').not.toMatch(/\bst\.set[A-Z]|getState\(\)/);
  });

  it('⭐ SETTINGS — "Your plan" is owner-only, writes through the store, offers C1 and no off switch', () => {
    const main = SRC('components/Settings/SettingsMain.tsx');
    expect(main, 'SETTINGS owner-only page').toMatch(/\{settingsPage === 'plan' && !viewerMode && <YourPlanSection styles=\{styles\} \/>\}/);
    expect(main, 'SETTINGS owner-only row').toMatch(/\{!viewerMode && <SettingsRow icon="[^"]+" title="Your plan"/);
    const sec = SRC('components/Settings/YourPlanSection.tsx');
    expect(sec, 'SETTINGS writes').toMatch(/onChange=\{setPlanPolicy\} onReset=\{resetPlanPolicy\}/);
    expect(sec, 'SETTINGS C1').toMatch(/resetLabel="Back to the defaults \(C1\)" offSwitch=\{false\}/);
    expect(sec, 'SETTINGS one clamp').toMatch(/effectivePolicySettings\(raw, PLAN_CLAMP\)/);
    const card = SRC('components/Almanac/SupportPolicyCard.tsx');
    expect(card, 'SETTINGS face label').toMatch(/resetLabel = 'Back to your plan', offSwitch = true/);
    // "Your plan" is the ONLY editor — app-wide, not only on the four faces: outside the store and the tests, only
    // YourPlanSection names the plan's setters, and no file emits plan events directly (emitPlanSets is the store's).
    // Comments stripped. ⚠ Names only: a raw useStore.setState({ policy…: v }) would get past it (today the one raw
    // setState outside the store, viewerSync's, writes three non-policy scalars).
    const root = join(process.cwd(), 'src');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return f === '__tests__' || p === join(root, 'store') ? [] : walk(p);
      return /\.(ts|tsx)$/.test(f) ? [p] : [];
    });
    const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const files = walk(root).map((p) => ({ rel: p.slice(root.length + 1), src: strip(readFileSync(p, 'utf8')) }));
    expect(files.length, 'SETTINGS the only editor — files scanned').toBeGreaterThan(100);   // non-vacuous: the walker sees src/
    expect(files.filter((f) => /\b(?:setPlanPolicy|resetPlanPolicy)\b/.test(f.src)).map((f) => f.rel), 'SETTINGS the only editor')
      .toEqual(['components/Settings/YourPlanSection.tsx']);
    expect(files.filter((f) => /\bemitPlanSets\b/.test(f.src)).map((f) => f.rel), 'SETTINGS the only editor (emitPlanSets)')
      .toEqual([]);
  });

  it('⭐ ONE CLAMP — the Decision face runs on the plan\'s clamp', () => {
    const src = SRC('components/Almanac/DecisionFace.tsx');
    expect(src, 'ONE CLAMP').toMatch(/const CAP_PCT = PLAN_CB_LTV_CAP_PCT;/);
    expect(src, 'ONE CLAMP').toMatch(/const STRIKE_CAP_EFF = PLAN_STRIKE_CAP_EFF;/);
    expect(PLAN_CLAMP.cbLtvCapPct, 'ONE CLAMP 70 — the Decision face\'s Coinbase cap, unchanged').toBe(70);
  });

  it('⭐ CONSOLE — every live crash-playbook build passes the plan\'s Coinbase limit', () => {
    for (const f of ['components/Tools/EmergencyConsole.tsx', 'components/SimpleMode/SimpleModeView.tsx']) {
      expect(SRC(f), `CONSOLE ${f}`).toMatch(/planCbStopAtSupportPct = useStore\(\(s\) => s\.policyCbStopAtSupportPct\)/);
      expect(SRC(f), `CONSOLE ${f}`).toMatch(/cbLtvTargetPct, planCbStopAtSupportPct, dayLog/);
    }
    expect(SRC('components/Advisor/OutlookProjection.tsx'), 'CONSOLE Outlook')
      .toMatch(/playbookDepthFor\(cbLtvTargetPct, planCbStopAtSupportPct\)/);
    // …and both of the Outlook's parents hand it the plan's limit, never a literal.
    for (const f of ['components/SimpleMode/SimpleModeView.tsx', 'components/Advisor/AdvisorMain.tsx']) {
      expect(SRC(f), `CONSOLE Outlook's parent ${f}`).toMatch(/planCbStopAtSupportPct = useStore\(\(s\) => s\.policyCbStopAtSupportPct\)/);
      expect(SRC(f), `CONSOLE Outlook's parent ${f}`).toMatch(/planCbStopAtSupportPct=\{planCbStopAtSupportPct\}/);
    }
  });
});
