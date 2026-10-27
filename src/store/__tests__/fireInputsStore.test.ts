import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The FIRE face's own inputs on the REAL store (batch 1 build 4, D3 A): ONE device-local key, a plain set — persisted with
// the blob, in no field list and no payload, so never synced, never in a backup, never shown to a viewer. Round synthetic
// figures only — this repo is public. Every assertion carries its tag (PERSISTED, LEAK, LISTS, SETTER, RESTORE, SEEDS,
// WIPE); each planted bug in build-4-mutations.json turns its own tag red.
vi.hoisted(() => {
  const shim = () => {
    const mem = new Map<string, string>();
    return {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, String(v)); },
      removeItem: (k: string) => { mem.delete(k); },
      clear: () => { mem.clear(); },
    };
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = shim();
  (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = shim();
});

import { useStore, partializeState } from '../useStore';
import { buildSettingsPayload, buildViewerSnapshotPayload } from '../payloads';
import {
  SETTINGS_FIELDS, VIEWER_SETTINGS_FIELDS, PREFS_FIELDS, PLAN_EVENT_FIELDS, VALIDATE_WHITELIST, APPLY_FIELDS,
} from '../settingsFields';
import { buildPlanBackup, type PlanBackup } from '../../lib/backup/exportPlan';
import { wipeLocalPlanData } from '../../lib/store/wipeLocalPlanData';
import { CURRENT_STORE_VERSION } from '../../lib/storeVersion';
import type { StoredFireInputs } from '../../lib/fireInputs';

/** Every input at a distinctive, non-default figure — a leak would carry one of these strings. */
const TYPED: StoredFireInputs = {
  otherUsd: 123_456.78, retirementIncomeUsd: 2_345.67, spendUsd: 4_321.09, bufferPct: 7, wBtcPct: 6.5, wOtherPct: 3.5,
  otherReturnPct: 5.25, taxPct: 17, basisUsdPerBtc: 34_567.89, stopChoice: 'years', stopYears: 11,
};
const FIGURES = ['123456.78', '2345.67', '4321.09', '34567.89', '5.25'];
const fireInputs = () => (useStore.getState() as unknown as { fireInputs: StoredFireInputs | null }).fireInputs;

beforeEach(() => {
  vi.useFakeTimers();   // no publish kick ever fires
  useStore.setState({
    fireInputs: null, planEvents: [], planDirty: false, prefsDirty: false, viewerMode: false,
    nostrAuthEnabled: false, planLoaded: false,
  } as never);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('⭐ the FIRE face\'s inputs — one device-local key', () => {
  it('⭐ PERSISTED — seeded null (every default); what was typed persists with the blob', () => {
    expect((useStore.getInitialState() as unknown as Record<string, unknown>).fireInputs, 'PERSISTED seed').toBeNull();
    useStore.getState().setFireInputs(TYPED);
    const blob = JSON.parse(JSON.stringify(partializeState(useStore.getState())));
    expect(blob.fireInputs, 'PERSISTED in the blob').toEqual(TYPED);
  });

  it('⭐ LEAK — no sync, backup or viewer payload carries the key or any typed figure', () => {
    useStore.getState().setFireInputs(TYPED);
    const s = useStore.getState();
    const prefs = Object.fromEntries(PREFS_FIELDS.map((f) => [f, (s as unknown as Record<string, unknown>)[f]]));   // the prefs:v1 object, as syncEngine builds it
    const payloads: [string, unknown][] = [
      ['settings', buildSettingsPayload(s)],
      ['backup', buildPlanBackup(s)],
      ['trusted snapshot', buildViewerSnapshotPayload(s, 'trusted')],
      ['safe snapshot', buildViewerSnapshotPayload(s, 'safe')],
      ['prefs', prefs],
      ['plan events', s.planEvents],
    ];
    for (const [name, p] of payloads) {
      const json = JSON.stringify(p);
      expect(json, `LEAK ${name}: the key`).not.toContain('fireInputs');
      for (const fig of FIGURES) expect(json, `LEAK ${name}: ${fig}`).not.toContain(fig);
    }
  });

  it('⭐ LISTS — in no synced, backup or viewer field list', () => {
    const lists: [string, readonly string[]][] = [
      ['SETTINGS_FIELDS', SETTINGS_FIELDS], ['VIEWER_SETTINGS_FIELDS', VIEWER_SETTINGS_FIELDS], ['PREFS_FIELDS', PREFS_FIELDS],
      ['PLAN_EVENT_FIELDS', PLAN_EVENT_FIELDS], ['VALIDATE_WHITELIST', [...VALIDATE_WHITELIST]], ['APPLY_FIELDS', [...APPLY_FIELDS]],
    ];
    for (const [name, list] of lists) expect(list, `LISTS ${name}`).not.toContain('fireInputs');
  });

  it('⭐ SETTER — a plain merge; null resets; no plan event, nothing dirty; never held by the plan-load guard', () => {
    useStore.getState().setFireInputs({ otherUsd: 1000 });
    useStore.getState().setFireInputs({ bufferPct: 10 });
    expect(fireInputs(), 'SETTER merges').toEqual({ otherUsd: 1000, bufferPct: 10 });
    useStore.getState().setFireInputs({ otherUsd: 2000 });
    expect(fireInputs(), 'SETTER a field again replaces it').toEqual({ otherUsd: 2000, bufferPct: 10 });
    useStore.getState().setFireInputs(null);
    expect(fireInputs(), 'SETTER null is every default').toBeNull();
    const st = useStore.getState();
    expect([st.planEvents.length, st.planDirty, st.prefsDirty], 'SETTER no event, nothing dirty').toEqual([0, false, false]);
    // A signed-in device waiting for its plan (5c): a device-local face input is no plan write, so it lands.
    useStore.setState({ nostrAuthEnabled: true, planLoaded: false, viewerMode: false } as never);
    useStore.getState().setFireInputs({ wBtcPct: 5 });
    expect(fireInputs(), 'SETTER not a plan write').toEqual({ wBtcPct: 5 });
  });

  it('⭐ RESTORE — a backup restore leaves this device\'s inputs as they are', () => {
    useStore.getState().setFireInputs(TYPED);
    const backup: PlanBackup = {
      format: 'personal-bloc-plan-backup', schemaVersion: 1, storeVersion: CURRENT_STORE_VERSION,
      exportedAt: '2026-01-06T00:00:00.000Z',
      plan: { settings: { income: 7000, expenses: 3000 }, records: { monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {} } },
    };
    useStore.getState().applyPlanBackup(backup);
    expect(useStore.getState().income, 'RESTORE premise: the backup applied').toBe(7000);
    expect(fireInputs(), 'RESTORE untouched').toEqual(TYPED);
  });

  it('⭐ SEEDS — neither seed reset touches them (the viewer\'s clear, the orphaned owner reset)', () => {
    useStore.getState().setFireInputs(TYPED);
    useStore.getState().clearViewerData();
    expect(fireInputs(), 'SEEDS clearViewerData').toEqual(TYPED);
    useStore.getState().resetPlanToSeeds();
    expect(fireInputs(), 'SEEDS resetPlanToSeeds').toEqual(TYPED);
  });

  it('⭐ WIPE — an identity forget removes the blob that carries them', () => {
    useStore.getState().setFireInputs(TYPED);
    localStorage.setItem('personal-bloc-store', JSON.stringify({ state: partializeState(useStore.getState()), version: CURRENT_STORE_VERSION }));
    expect(localStorage.getItem('personal-bloc-store'), 'WIPE premise: the blob carries them').toContain('123456.78');
    wipeLocalPlanData();
    expect(localStorage.getItem('personal-bloc-store'), 'WIPE the blob is gone').toBeNull();
  });
});
