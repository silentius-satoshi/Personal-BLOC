import { describe, it, expect } from 'vitest';
import { useStore } from '../useStore';
import type { StoreSet, StoreGet } from '../types';
import { createUiSlice } from '../slices/uiSlice';
import { createPlanInputsSlice } from '../slices/planInputsSlice';
import { createMiningSlice } from '../slices/miningSlice';
import { createCbLoanSlice } from '../slices/cbLoanSlice';
import { createAdvisorJournalSlice } from '../slices/advisorJournalSlice';
import { createDayLogSlice } from '../slices/dayLogSlice';
import { createIdentitySlice } from '../slices/identitySlice';
import { createViewerSlice } from '../slices/viewerSlice';
import { createSyncSlice } from '../slices/syncSlice';

// Phase 1c — the store's create() closure is sliced across 9 domain files. This pins the partition: each creator's
// returned object supplies a DISJOINT set of StoreState keys, and their union is the WHOLE store (a duplicate would
// silently last-spread-win; a dropped key would leave a hole). tsc already enforces slice keys ⊆ StoreState (Pick)
// and union ⊇ StoreState (missing-prop at composition) — this adds the disjointness + exact-size proof.
const set = (() => {}) as unknown as StoreSet;
const get = (() => ({})) as unknown as StoreGet;

const creators = {
  ui:             createUiSlice,
  planInputs:     createPlanInputsSlice,
  mining:         createMiningSlice,
  cbLoan:         createCbLoanSlice,
  advisorJournal: createAdvisorJournalSlice,
  dayLog:         createDayLogSlice,
  identity:       createIdentitySlice,
  viewer:         createViewerSlice,
  sync:           createSyncSlice,
};

describe('store slices — partition of StoreState', () => {
  const keySets: Record<string, string[]> = Object.fromEntries(
    Object.entries(creators).map(([name, fn]) => [name, Object.keys(fn(set, get))]),
  );

  it('slices are pairwise DISJOINT (no key defined in two slices)', () => {
    const names = Object.keys(keySets);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = new Set(keySets[names[i]]);
        const overlap = keySets[names[j]].filter((k) => a.has(k));
        expect(overlap, `${names[i]} ∩ ${names[j]}`).toEqual([]);
      }
    }
  });

  it('union of slice keys === the full store key-set (nothing dropped or invented)', () => {
    const union = new Set(Object.values(keySets).flat());
    const store = new Set(Object.keys(useStore.getState()));
    const missing = [...store].filter((k) => !union.has(k));   // in the store but no slice supplies it
    const extra   = [...union].filter((k) => !store.has(k));   // a slice supplies a key the store doesn't have
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    expect(union.size).toBe(store.size);
  });
});
