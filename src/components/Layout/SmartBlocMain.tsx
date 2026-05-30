import { SummaryBar } from '../Summary/SummaryBar';
import { TierCards } from '../Collateral/TierCards';
import { MonthlyPlaybook } from '../Playbook/MonthlyPlaybook';
import { BtcStackChart } from '../Charts/BtcStackChart';
import { NetEquityChart } from '../Charts/NetEquityChart';
import { LTVSafetyChart } from '../Charts/LTVSafetyChart';
import MonthBreakdown from '../MonthBreakdown/MonthBreakdown';

export function SmartBlocMain() {
  return (
    <>
      <SummaryBar />
      <TierCards />
      <MonthlyPlaybook />
      <BtcStackChart />
      <NetEquityChart />
      <LTVSafetyChart />
      <MonthBreakdown />
    </>
  );
}
