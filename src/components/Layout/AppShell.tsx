import { InputsPanel } from '../Inputs/InputsPanel';
import { SummaryBar } from '../Summary/SummaryBar';
import { TierCards } from '../Collateral/TierCards';
import { MonthlyPlaybook } from '../Playbook/MonthlyPlaybook';
import { BtcStackChart } from '../Charts/BtcStackChart';
import { NetEquityChart } from '../Charts/NetEquityChart';
import { LTVSafetyChart } from '../Charts/LTVSafetyChart';
import styles from './AppShell.module.css';

export function AppShell() {
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarInner}>
          <div className={styles.logo}>
            <span className={styles.logoMark}>₿</span>
            <div>
              <div className={styles.logoTitle}>Smart BLOC</div>
              <div className={styles.logoSub}>+ Fold CC Advisor</div>
            </div>
          </div>
          <InputsPanel />
        </div>
      </aside>

      <main className={styles.main}>
        <SummaryBar />
        <TierCards />
        <MonthlyPlaybook />
        <BtcStackChart />
        <NetEquityChart />
        <LTVSafetyChart />
      </main>
    </div>
  );
}
