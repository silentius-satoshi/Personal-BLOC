import { describe, it, expect, vi } from 'vitest';

// Mock localStorage BEFORE the store import (vi.hoisted runs first) — useStore's module-init seed IIFEs
// touch it. Mirrors simpleView.test.ts / characterization.test.ts. Pure-model tests don't need it, but the
// store-posture block imports useStore, so the shim must exist at module-eval time.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem:    (k: string) => mem.get(k) ?? null,
    setItem:    (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { deriveSafetyView, type SafetyViewInputs } from '../safetyView';
import { applyOverlay, diffScenarios, type ScenarioOverlay, type PinnedScenario } from '../scenarioDiff';
import { useStore, partializeState } from '../../store/useStore';
import { buildSettingsPayload } from '../../store/payloads';

// CB-bearing base — chosen so a 30% price drop crosses bands on BOTH Strike LTV and CB LTV, while credit
// capacity (price-free) stays put. aprPct 0 + asOf null → accrued === balance (no accrual noise in the math).
const BASE: SafetyViewInputs = {
  advisorActualBlocBalance: 50000,   // Strike debt
  creditLine: 100000,
  currentBtcHeld: 1,                 // Strike collateral
  btcPrice: 100000,
  strikeLiquidationLtvPct: 85,
  hasCbLoan: true,
  cbLoanBalance: 60000,
  cbAprPct: 0,
  cbLoanBalanceAsOf: null,
  cbCollateralBtc: 1,
  cbLtvTriggerPct: 75,
  cbLiquidationPrice: 0,             // 0 → computed liq price
};

const OVERLAY_KEYS: (keyof ScenarioOverlay)[] = [
  'btcPrice', 'advisorActualBlocBalance', 'currentBtcHeld', 'creditLine', 'cbLoanBalance', 'cbCollateralBtc',
];

describe('scenarioDiff — applyOverlay (pure substitution)', () => {
  it('identity overlay ({}) returns an equal-valued NEW object', () => {
    const out = applyOverlay(BASE, {});
    expect(out).toEqual(BASE);
    expect(out).not.toBe(BASE);
  });

  it('a present-but-undefined lever does NOT clobber the base', () => {
    const out = applyOverlay(BASE, { btcPrice: undefined });
    expect(out.btcPrice).toBe(BASE.btcPrice);
  });

  it('each lever lands on exactly its SafetyViewInputs member, leaving the rest untouched', () => {
    for (const k of OVERLAY_KEYS) {
      const v = BASE[k] === 0 ? 123 : (BASE[k] as number) * 0.5 + 1;   // any distinct number
      const out = applyOverlay(BASE, { [k]: v } as ScenarioOverlay);
      expect(out[k]).toBe(v);
      for (const other of Object.keys(BASE) as (keyof SafetyViewInputs)[]) {
        if (other !== k) expect(out[other]).toBe(BASE[other]);
      }
    }
  });
});

describe('scenarioDiff — diffScenarios (flows through deriveSafetyView)', () => {
  it('identity diff (base vs base): every dim delta 0, no worsening, levels equal', () => {
    const d = diffScenarios(BASE, BASE);
    for (const dim of [d.capacityUsed, d.strikeLtv, d.cbLtv]) {
      expect(dim.delta).toBe(0);
      expect(dim.worsened).toBe(false);
      expect(dim.fromLevel).toBe(dim.toLevel);
    }
    expect(d.worsenedCount).toBe(0);
    expect(d.overallFrom).toBe(d.overallTo);
    expect(d.crashLtv.from).toBe(d.crashLtv.to);
    expect(d.cbLiqFrac.from).toBe(d.cbLiqFrac.to);
  });

  it('no-drift pin: each dimension `to` matches a direct deriveSafetyView on the overlaid inputs', () => {
    for (const k of OVERLAY_KEYS) {
      const v = BASE[k] === 0 ? 42 : (BASE[k] as number) * 0.7;
      const overlaid = applyOverlay(BASE, { [k]: v } as ScenarioOverlay);
      const d = diffScenarios(BASE, overlaid);
      const direct = deriveSafetyView(overlaid);
      expect(d.capacityUsed.to).toBe(direct.capacityUsed);
      expect(d.capacityUsed.toLevel).toBe(direct.creditLevel);
      expect(d.strikeLtv.to).toBe(direct.strikeLtv);
      expect(d.strikeLtv.toLevel).toBe(direct.strikeLevel);
      expect(d.cbLtv.to).toBe(direct.cbLtv);
      expect(d.cbLtv.toLevel).toBe(direct.cbLevel);
      expect(d.crashLtv.to).toBe(direct.crashLtv);
      expect(d.cbLiqFrac.to).toBe(direct.cbLiqFrac);
    }
  });

  it('30% price-drop overlay (CB-bearing): Strike + CB LTV rise, both worsen, levels match the bands', () => {
    const overlay: ScenarioOverlay = { btcPrice: BASE.btcPrice * 0.7 };
    const overlaid = applyOverlay(BASE, overlay);
    const d = diffScenarios(BASE, overlaid);
    const direct = deriveSafetyView(overlaid);

    expect(d.strikeLtv.to).toBeGreaterThan(d.strikeLtv.from);
    expect(d.cbLtv.to).toBeGreaterThan(d.cbLtv.from);
    expect(d.strikeLtv.worsened).toBe(true);
    expect(d.cbLtv.worsened).toBe(true);
    // toLevel comes straight off deriveSafetyView's own band verdict — never re-derived here.
    expect(d.strikeLtv.toLevel).toBe(direct.strikeLevel);
    expect(d.cbLtv.toLevel).toBe(direct.cbLevel);
    // credit capacity is price-free → unchanged
    expect(d.capacityUsed.worsened).toBe(false);
    expect(d.worsenedCount).toBe(2);
  });

  it('hasCbLoan=false: the CB dimension is excluded from worsenedCount', () => {
    const noCbBase: SafetyViewInputs = { ...BASE, hasCbLoan: false };
    const overlaid = applyOverlay(noCbBase, { btcPrice: noCbBase.btcPrice * 0.7 });
    const d = diffScenarios(noCbBase, overlaid);
    expect(d.cbLtv.worsened).toBe(false);              // deriveSafetyView zeroes CB when !hasCbLoan
    expect(d.worsenedCount).toBe(Number(d.strikeLtv.worsened) + Number(d.capacityUsed.worsened));
    expect(d.worsenedCount).toBe(1);                   // only Strike worsened
  });
});

// ── Store posture — device-local persisted, NEVER synced ──────────────────────
describe('pinnedScenario store field (device-local persisted, unsynced)', () => {
  it('defaults to null', () => {
    expect(useStore.getState().pinnedScenario).toBeNull();
  });

  it('is absent from the synced settings payload', () => {
    expect('pinnedScenario' in buildSettingsPayload(useStore.getState())).toBe(false);
  });

  it('rides partializeState (persisted, not in the omit list)', () => {
    expect('pinnedScenario' in partializeState(useStore.getState())).toBe(true);
  });

  it('setter round-trips and clears', () => {
    const pin: PinnedScenario = {
      label: 'baseline', pinnedAt: 1_700_000_000_000, btcPrice: 100000, inputs: BASE,
    };
    useStore.getState().setPinnedScenario(pin);
    expect(useStore.getState().pinnedScenario).toBe(pin);
    useStore.getState().setPinnedScenario(null);
    expect(useStore.getState().pinnedScenario).toBeNull();
  });
});
