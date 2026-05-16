import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import type { LivingInputs } from '../simulation/types';
import { runNoBitcoin } from '../simulation/runNoBitcoin';
import { runSellToLive } from '../simulation/runSellToLive';
import { runSmartBLOC_Living } from '../simulation/runSmartBLOC_Living';
import { runMaxLeverage } from '../simulation/runMaxLeverage';

const LTV_TYPE_MAP = {
  target:  0.05,
  current: 0.10,
  high:    0.15,
  hyper:   0.20,
};

export function useLivingSimulation() {
  const btcHoldings      = useStore((s) => s.btcHoldings);
  const btcPrice         = useStore((s) => s.btcPrice);
  const income           = useStore((s) => s.income);
  const expenses         = useStore((s) => s.expenses);
  const annualBtcGrowth  = useStore((s) => s.annualBtcGrowth);
  const blocApr          = useStore((s) => s.blocApr);
  const inflationRate    = useStore((s) => s.inflationRate);
  const ltvType          = useStore((s) => s.ltvType);
  const timeHorizonYears = useStore((s) => s.timeHorizonYears);
  const bearMarket       = useStore((s) => s.bearMarket);

  return useMemo(() => {
    const inputs: LivingInputs = {
      btcHoldings,
      startPrice:          btcPrice,
      income,
      expenses,
      annualBtcGrowth:     annualBtcGrowth / 100,
      apr:                 blocApr / 100,
      inflationRate:       inflationRate / 100,
      timeHorizonMonths:   timeHorizonYears * 12,
      ltvCeiling:          LTV_TYPE_MAP[ltvType],
      capitalGainsTaxRate: 0.30,
      bearMarket,
    };

    const noBtcResult = runNoBitcoin(inputs);
    const sellToLive  = runSellToLive(inputs, noBtcResult.finalNetWorthNominal);
    const smartBloc   = runSmartBLOC_Living(inputs, noBtcResult.finalNetWorthNominal);
    const maxLeverage = runMaxLeverage(inputs, noBtcResult.finalNetWorthNominal);

    return { noBtcResult, sellToLive, smartBloc, maxLeverage };
  }, [btcHoldings, btcPrice, income, expenses, annualBtcGrowth, blocApr,
      inflationRate, ltvType, timeHorizonYears, bearMarket]);
}
