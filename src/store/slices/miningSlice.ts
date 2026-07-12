// miningSlice (Phase 1c) — mining inputs + device mutators (set-only; get is unused here).
import type { StoreState, StoreSet, StoreGet } from '../types';
import { defaultMiningInputs } from '../bootstrap';

type MiningSlice = Pick<StoreState,
  | 'miningInputs' | 'setMiningInputs' | 'setMiningDevice' | 'setMiningCurrency' | 'setMiningStrategy'
  | 'addMiningDevice' | 'removeMiningDevice'
>;

export const createMiningSlice = (set: StoreSet, _get: StoreGet): MiningSlice => ({
  miningInputs: defaultMiningInputs,
  setMiningInputs: (patch) => set((s) => ({ miningInputs: { ...s.miningInputs, ...patch } })),
  setMiningDevice: (index, patch) => set((s) => {
    const devices = s.miningInputs.devices.map((d, i) => i === index ? { ...d, ...patch } : d);
    return { miningInputs: { ...s.miningInputs, devices } };
  }),
  setMiningCurrency: (currency) => set((s) => ({ miningInputs: { ...s.miningInputs, currency } })),
  setMiningStrategy: (strategy) => set((s) => ({ miningInputs: { ...s.miningInputs, selectedStrategy: strategy } })),
  addMiningDevice: () => set((s) => ({
    miningInputs: {
      ...s.miningInputs,
      devices: [
        ...s.miningInputs.devices,
        { name: 'New Miner', hashrateTH: 1.0, powerW: 20, efficiencyJTH: 20, enabled: true, soloMining: false, poolName: '', poolFee: 2.0 },
      ],
    },
  })),
  removeMiningDevice: (index) => set((s) => ({
    miningInputs: {
      ...s.miningInputs,
      devices: s.miningInputs.devices.filter((_, i) => i !== index),
    },
  })),
});
