import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// BL14 — the plan's goal amount on the REAL store (Batch 1, build 2; spec pbloc-spec-batch-1-v1 §2.2): one synced plan
// field beside the six, edited only in Settings → Your plan. Round synthetic figures only — this repo is public.
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
import { PREFS_FIELDS } from '../settingsFields';
import { PLAN_GOAL_FIELD } from '../../lib/planGoal';
import { buildPlanBackup } from '../../lib/backup/exportPlan';
import { validatePlanBackup } from '../../lib/backup/validatePlanBackup';
import { foldPlanEvents } from '../../lib/planEvents/fold';
import { migrateState } from '../persistConfig';

const goalEvents = () => useStore.getState().planEvents.filter((e) => e.field === PLAN_GOAL_FIELD);

beforeEach(() => {
  vi.useFakeTimers();   // the emit's 2s publish kick never fires
  useStore.setState({ planGoalNetBtc: null, planEvents: [], planDirty: false, viewerMode: false } as never);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('⭐ GOAL STORE — the goal is a plan field, set one way', () => {
  it('⭐ GOAL SEED — no goal by default; never a pref; lib/planGoal.ts imports nothing', () => {
    expect((useStore.getInitialState() as unknown as Record<string, unknown>).planGoalNetBtc, 'GOAL SEED').toBeNull();
    expect(PREFS_FIELDS as readonly string[], 'GOAL never a pref').not.toContain(PLAN_GOAL_FIELD);
    const lib = readFileSync(join(process.cwd(), 'src/lib/planGoal.ts'), 'utf8');
    expect(lib, 'GOAL zero imports').not.toMatch(/^\s*import\b/m);
    expect(lib, 'GOAL zero imports').not.toMatch(/\bfrom\s*['"]/);
  });

  it('⭐ GOAL EMIT — a change is one plan event: the field, the value, planDirty', () => {
    useStore.getState().setPlanGoalNetBtc(2);
    expect(useStore.getState().planGoalNetBtc, 'GOAL EMIT').toBe(2);
    expect(goalEvents().map((e) => [e.field, e.value]), 'GOAL EMIT one event').toEqual([[PLAN_GOAL_FIELD, 2]]);
    expect(useStore.getState().planDirty, 'GOAL EMIT dirty').toBe(true);
  });

  it('⭐ GOAL QUIET — the same goal again emits nothing; no goal again emits nothing', () => {
    useStore.getState().setPlanGoalNetBtc(null);
    expect(useStore.getState().planEvents, 'GOAL QUIET none → none').toEqual([]);
    useStore.getState().setPlanGoalNetBtc(1.5);
    useStore.getState().setPlanGoalNetBtc(1.5);
    useStore.getState().setPlanGoalNetBtc(1.500000001);   // the same goal to the satoshi
    expect(goalEvents().length, 'GOAL QUIET same goal').toBe(1);
  });

  it('⭐ GOAL CLEAR — null is an event: "no goal" beats an older goal from another device', () => {
    useStore.getState().setPlanGoalNetBtc(3);
    const set3 = goalEvents().at(-1);
    useStore.getState().setPlanGoalNetBtc(null);
    expect(useStore.getState().planGoalNetBtc, 'GOAL CLEAR').toBeNull();
    const cleared = goalEvents().at(-1);
    // The log compacts a burst to one event per field — the newest, so "no goal" is what remains, and it is newer.
    expect([cleared?.value, (cleared?.ts ?? 0) > (set3?.ts ?? Infinity)], 'GOAL CLEAR the newest event').toEqual([null, true]);
    expect(foldPlanEvents(useStore.getState().planEvents)[PLAN_GOAL_FIELD], 'GOAL CLEAR folds to none').toBeNull();
  });

  it('⭐ GOAL SANITIZE — the setter stores the one read rule\'s value: junk is no goal, the rest to the satoshi', () => {
    useStore.getState().setPlanGoalNetBtc(1.234567891);
    expect(useStore.getState().planGoalNetBtc, 'GOAL SANITIZE sats').toBe(1.23456789);
    expect(goalEvents().at(-1)?.value, 'GOAL SANITIZE the event carries the sanitized goal').toBe(1.23456789);
    for (const junk of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      useStore.getState().setPlanGoalNetBtc(junk);
      expect(useStore.getState().planGoalNetBtc, `GOAL SANITIZE ${junk}`).toBeNull();
      expect(goalEvents().at(-1)?.value, `GOAL SANITIZE ${junk} — never stored as itself`).toBeNull();
    }
  });

  it('⭐ GOAL FOLD — a peer\'s goal lands through the fold; a fold without it leaves the goal alone', () => {
    useStore.getState().applyPlanFold({ planGoalNetBtc: 4 } as never);
    expect(useStore.getState().planGoalNetBtc, 'GOAL FOLD').toBe(4);
    useStore.getState().applyPlanFold({ income: 7777 });
    expect(useStore.getState().planGoalNetBtc, 'GOAL FOLD absent = not set').toBe(4);
  });

  it('⭐ GOAL PERSIST — an older blob without the field reads no goal; a saved one survives (no version bump)', () => {
    const migrated = migrateState({ monthlyLog: [] } as never) as unknown as Record<string, unknown>;
    expect(migrated.planGoalNetBtc, 'GOAL PERSIST absent').toBeNull();
    const kept = migrateState({ monthlyLog: [], planGoalNetBtc: 2.5 } as never) as unknown as Record<string, unknown>;
    expect(kept.planGoalNetBtc, 'GOAL PERSIST kept').toBe(2.5);
  });
});

describe('⭐ GOAL BACKUP and VIEWERS', () => {
  it('⭐ GOAL BACKUP — it exports; a backup made before it validates and leaves the goal be; a new one restores it', () => {
    useStore.getState().setPlanGoalNetBtc(2);
    const backup = buildPlanBackup(useStore.getState());
    expect(backup.plan.settings[PLAN_GOAL_FIELD as keyof typeof backup.plan.settings], 'GOAL BACKUP exports').toBe(2);

    const old = JSON.parse(JSON.stringify(backup));
    delete old.plan.settings[PLAN_GOAL_FIELD];   // a backup made before build 2
    const v = validatePlanBackup(old);
    expect(v.ok, 'GOAL BACKUP old validates').toBe(true);
    if (!v.ok) return;
    useStore.getState().applyPlanBackup(v.backup);
    expect(useStore.getState().planGoalNetBtc, 'GOAL BACKUP old leaves the goal').toBe(2);

    const next = JSON.parse(JSON.stringify(backup));
    next.plan.settings[PLAN_GOAL_FIELD] = 3;
    const v2 = validatePlanBackup(next);
    expect(v2.ok, 'GOAL BACKUP new validates').toBe(true);
    if (!v2.ok) return;
    useStore.getState().applyPlanBackup(v2.backup);
    expect(useStore.getState().planGoalNetBtc, 'GOAL BACKUP restores').toBe(3);
  });

  it('⭐ GOAL VIEWER — a trusted viewer receives and applies it (G2-A); a safe snapshot carries none of it', () => {
    useStore.getState().setPlanGoalNetBtc(2.5);
    const trusted = buildViewerSnapshotPayload(useStore.getState(), 'trusted').settings as Record<string, unknown>;
    expect(trusted[PLAN_GOAL_FIELD], 'GOAL VIEWER trusted').toBe(2.5);
    const safe = JSON.stringify(buildViewerSnapshotPayload(useStore.getState(), 'safe'));
    expect(safe, 'GOAL VIEWER safe').not.toContain(PLAN_GOAL_FIELD);
    expect(safe, 'GOAL VIEWER safe — not the amount either').not.toContain('2.5');

    useStore.setState({ planGoalNetBtc: null, planEvents: [], planDirty: false } as never);   // the viewer's own store
    useStore.getState().applyViewerSettings(trusted);
    expect(useStore.getState().planGoalNetBtc, 'GOAL VIEWER applies').toBe(2.5);
    expect([useStore.getState().planEvents.length, useStore.getState().planDirty], 'GOAL VIEWER RAW — no event').toEqual([0, false]);
    expect(buildSettingsPayload(useStore.getState())[PLAN_GOAL_FIELD], 'GOAL VIEWER payload').toBe(2.5);
  });

  it('⭐ GOAL SEED RESETS — both seed resets clear the goal', () => {
    useStore.getState().setPlanGoalNetBtc(2);
    useStore.getState().clearViewerData();
    expect(useStore.getState().planGoalNetBtc, 'GOAL clearViewerData').toBeNull();
    useStore.getState().setPlanGoalNetBtc(2);
    useStore.getState().resetPlanToSeeds();
    expect(useStore.getState().planGoalNetBtc, 'GOAL resetPlanToSeeds').toBeNull();
  });
});

describe('⭐ GOAL EDITOR — Settings\' "Your plan" is the only editor', () => {
  const root = join(process.cwd(), 'src');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === '__tests__' || p === join(root, 'store') ? [] : walk(p);
    return /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const files = walk(root).map((p) => ({ rel: p.slice(root.length + 1), src: strip(readFileSync(p, 'utf8')) }));

  it('⭐ GOAL EDITOR — outside the store, only YourPlanSection names the setter', () => {
    expect(files.length, 'GOAL EDITOR files scanned').toBeGreaterThan(100);
    expect(files.filter((f) => /\bsetPlanGoalNetBtc\b/.test(f.src)).map((f) => f.rel), 'GOAL EDITOR')
      .toEqual(['components/Settings/YourPlanSection.tsx']);
  });

  it('⭐ GOAL READ — every reader outside the store takes the goal through planGoalOf, never the raw field', () => {
    // A raw read would let a restored backup's junk ("2", -1) reach a run or a tile.
    const raw = files.filter((f) => /\b(?:st|s|state)\.planGoalNetBtc\b/.test(f.src) && !/planGoalOf\((?:st|s|state)\.planGoalNetBtc\)/.test(f.src));
    expect(raw.map((f) => f.rel), 'GOAL READ raw').toEqual([]);
    const readers = files.filter((f) => /planGoalOf\((?:st|s|state)\.planGoalNetBtc\)/.test(f.src)).map((f) => f.rel).sort();
    expect(readers, 'GOAL READ — the five plan readers, the tile and the field').toEqual([
      'components/Almanac/CyclingFace.tsx', 'components/Almanac/DecisionFace.tsx', 'components/Almanac/OwnershipFace.tsx',
      'components/Almanac/UnifiedFace.tsx', 'components/Almanac/usePlanMonth.ts', 'components/Settings/YourPlanSection.tsx',
      'components/Viewer/ViewerHomeView.tsx',
    ]);
  });
});
