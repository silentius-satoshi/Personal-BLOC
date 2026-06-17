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
  const activeTier       = useStore((s) => s.activeTier);
  const sandboxBtc       = useStore((s) => s.sandboxCollateralBtc ?? s.getCurrentBtcHeld());   // Smart BLOC sandbox
  const scenario         = useStore((s) => s.scenario);
  const scrubMonth    = useStore((s) => s.scrubMonth);
  const creditLine    = useStore((s) => s.creditLine);

  return useMemo(() => {
    const tiers = calcTiers(expenses, btcPrice);
    const startBTC = activeTier === 'custom'
      ? sandboxBtc
      : tiers[activeTier as 'min' | 'rec' | 'ideal'];
    const annualRate = ANNUAL_RATES[scenario];
    const apr = blocApr / 100;

    const blocData = runBLOC(annualRate, {
      income,
      expenses,
      startPrice: btcPrice,
      apr,
      startBTC,
      creditLine,
    });

    const stsData = runSTS(annualRate, {
      income,
      expenses,
      startPrice: btcPrice,
      startBTC,
    });

    const currentMonth = blocData[Math.min(scrubMonth, 60)];

    return { blocData, stsData, tiers, currentMonth };
  }, [income, expenses, btcPrice, blocApr, activeTier, sandboxBtc, scenario, scrubMonth, creditLine]);
}
