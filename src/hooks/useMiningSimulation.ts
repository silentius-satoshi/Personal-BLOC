import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { useBtcPrice } from './useBtcPrice';
import { calcAllStrategies } from '../simulation/miningUtils';
import type { MiningStrategyResult } from '../simulation/types';

export function useMiningSimulation(): {
  strategies: MiningStrategyResult[];
  selected: MiningStrategyResult;
  btcPrice: number;
} {
  const miningInputs = useStore((s) => s.miningInputs);
  const { livePrice } = useBtcPrice();

  const btcPrice = miningInputs.btcPriceOverride ?? livePrice ?? 80000;

  const strategies = useMemo(
    () => calcAllStrategies(miningInputs, btcPrice),
    [miningInputs, btcPrice]
  );

  const selected = strategies.find(s => s.id === miningInputs.selectedStrategy)!;

  return { strategies, selected, btcPrice };
}
