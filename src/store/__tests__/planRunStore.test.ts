import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage BEFORE the store import (vi.hoisted runs first).
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { useStore } from '../useStore';
import { SETTINGS_FIELDS } from '../settingsFields';
import { buildSettingsPayload, buildViewerSnapshotPayload } from '../payloads';
import { partializeState } from '../persistConfig';
import type { DayEvent } from '../../simulation/types';

/**
 * Run 2's three device-local fields (spec pbloc-spec-plan-of-record-v1 §13): the one-time note (D8), the breaker's
 * offline cache (§4.3) and a trusted viewer's copy of the owner's latest Strike deposit date (D9). Every assertion
 * carries a tag from §13.3. ⚠ SYNTHETIC values — this repo is public.
 */
const SEED = { state: { broken: false, monthsBelow: 0, brokenMonth: null, monthsAtOrAbove: 3 }, lastMonthEndISO: '2026-09-30' };
const quiet = { planEvents: [], planDirty: false, prefsDirty: false, recordsDirty: false };

beforeEach(() => {
  useStore.setState({ ...quiet, planNoteDismissed: false, planBreakerCache: null, viewerStrikeDepositISO: null, viewerMode: false } as never);
});

describe('⭐ DEVICE — the three fields are this device\'s alone', () => {
  it('⭐ DEVICE — defaults: the note shows, no cache, no viewer date (the store\'s own initial state)', () => {
    const s = useStore.getInitialState() as unknown as Record<string, unknown>;
    expect([s.planNoteDismissed, s.planBreakerCache, s.viewerStrikeDepositISO]).toEqual([false, null, null]);
    for (const k of ['setPlanNoteDismissed', 'setPlanBreakerCache']) expect(typeof s[k], `DEVICE ${k}`).toBe('function');
  });
  it('⭐ DEVICE — the setters write and emit nothing: no plan event, no dirty channel', () => {
    useStore.getState().setPlanNoteDismissed(true);
    useStore.getState().setPlanBreakerCache(SEED);
    const s = useStore.getState();
    expect(s.planNoteDismissed, 'DEVICE note').toBe(true);
    expect(s.planBreakerCache, 'DEVICE cache').toEqual(SEED);
    expect(s.planEvents, 'DEVICE no emit').toEqual([]);
    expect([s.planDirty, s.prefsDirty, s.recordsDirty], 'DEVICE nothing dirty').toEqual([false, false, false]);
  });
  it('⭐ DEVICE — never synced: not a settings field, not in the plan backup, and no prefs or viewer apply can clobber them', () => {
    for (const k of ['planNoteDismissed', 'planBreakerCache', 'viewerStrikeDepositISO']) {
      expect((SETTINGS_FIELDS as readonly string[]).includes(k), `DEVICE ${k} not a settings field`).toBe(false);
      expect(k in buildSettingsPayload(useStore.getState()), `DEVICE ${k} not in the backup`).toBe(false);
    }
    useStore.setState({ planNoteDismissed: true, planBreakerCache: SEED } as never);
    useStore.getState().hydratePrefs({ planNoteDismissed: false, planBreakerCache: null } as never);
    useStore.getState().applyViewerSettings({ planNoteDismissed: false, planBreakerCache: null, viewerStrikeDepositISO: '2020-01-01', income: 1234 } as never);
    const s = useStore.getState();
    expect([s.planNoteDismissed, s.planBreakerCache, s.viewerStrikeDepositISO], 'DEVICE untouched').toEqual([true, SEED, null]);
    expect(s.income, 'DEVICE sanity: a real synced field applied').toBe(1234);
  });
  it('⭐ DEVICE — persisted on this device: a reload keeps the dismissed note and the cache', () => {
    useStore.setState({ planNoteDismissed: true, planBreakerCache: SEED } as never);
    const blob = JSON.parse(JSON.stringify(partializeState(useStore.getState())));
    expect([blob.planNoteDismissed, blob.planBreakerCache], 'DEVICE persisted').toEqual([true, SEED]);
  });
  it('⭐ DEVICE — a viewer\'s copy of the owner\'s date leaves with the rest of the viewer\'s data', () => {
    useStore.setState({ viewerStrikeDepositISO: '2026-09-01' } as never);
    useStore.getState().clearViewerData();
    expect(useStore.getState().viewerStrikeDepositISO, 'DEVICE cleared').toBeNull();
  });
});

describe('⭐ HOLD — D9: the trusted snapshot carries the hold\'s one fact; the safe one never does', () => {
  const deposit = (id: string, date: string, target: 'strike' | 'cb' | 'cold'): DayEvent =>
    ({ id, date, ts: Date.parse(date), kind: 'deposit', target, amount: 0.1 }) as unknown as DayEvent;
  it('⭐ HOLD — the trusted snapshot\'s date is the latest logged Strike deposit, any age; null with none', () => {
    useStore.setState({ dayLog: [deposit('a', '2026-06-01', 'strike'), deposit('b', '2026-09-01', 'strike'), deposit('c', '2026-10-01', 'cb')] } as never);
    expect(buildViewerSnapshotPayload(useStore.getState(), 'trusted').strikeLastDepositISO, 'HOLD trusted').toBe('2026-09-01');
    expect('strikeLastDepositISO' in buildViewerSnapshotPayload(useStore.getState(), 'safe'), 'HOLD never safe').toBe(false);
    useStore.setState({ dayLog: [deposit('c', '2026-10-01', 'cb')] } as never);
    expect(buildViewerSnapshotPayload(useStore.getState(), 'trusted').strikeLastDepositISO, 'HOLD none').toBeNull();
    useStore.setState({ dayLog: [] } as never);
  });
});
