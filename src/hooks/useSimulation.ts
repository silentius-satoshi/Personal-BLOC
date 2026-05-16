import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { calcTiers, runBLOC } from '../simulation/runBLOC';
import { runSTS } from '../simulation/runSTS';

const ANNUAL_RATES = {
  conservative: 0.30,
  moderate:     0.50,
  historical:   0.80,
} as const;

export function useSimulation() {
  const income        = useStore((s) => s.income);
  const expenses      = useStore((s) => s.expenses);
  const btcPrice      = useStore((s) => s.btcPrice);
  const blocApr       = useStore((s) => s.blocApr);
  const foldRewardRate = useStore((s) => s.foldRewardRate);
  const showFoldCC    = useStore((s) => s.showFoldCC);
  const activeTier       = useStore((s) => s.activeTier);
  const customCollateral = useStore((s) => s.customCollateral);
  const scenario         = useStore((s) => s.scenario);
  const scrubMonth    = useStore((s) => s.scrubMonth);

  return useMemo(() => {
    const tiers = calcTiers(expenses, btcPrice);
    const startBTC = activeTier === 'custom'
      ? customCollateral
      : tiers[activeTier as 'min' | 'rec' | 'ideal'];
    const annualRate = ANNUAL_RATES[scenario];
    const apr = blocApr / 100;
    const foldRate = showFoldCC ? foldRewardRate / 100 : 0;

    const blocData = runBLOC(annualRate, {
      income,
      expenses,
      startPrice: btcPrice,
      apr,
      foldRate,
      startBTC,
    });

    const stsData = runSTS(annualRate, {
      income,
      expenses,
      startPrice: btcPrice,
      startBTC,
    });

    const currentMonth = blocData[Math.min(scrubMonth, 60)];

    return { blocData, stsData, tiers, currentMonth };
  }, [income, expenses, btcPrice, blocApr, foldRewardRate, showFoldCC, activeTier, customCollateral, scenario, scrubMonth]);
}
