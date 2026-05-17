import { useStore } from '../../store/useStore';
import { InputsPanel } from '../Inputs/InputsPanel';
import { LivingInputsPanel } from '../LivingOnBitcoin/LivingInputsPanel';
import { SmartBlocMain } from './SmartBlocMain';
import { LivingOnBitcoin } from '../LivingOnBitcoin/LivingOnBitcoin';
import styles from './AppShell.module.css';

export function AppShell() {
  const activeTab    = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);

  return (
    <div className={styles.shell}>
      <div className={styles.tabBar}>
        <button
          className={`${styles.tab} ${activeTab === 'living' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('living')}
        >
          Living on Bitcoin
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'bloc' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('bloc')}
        >
          Smart BLOC
        </button>
        <div className={styles.headerBranding}>
          <span className={styles.headerLogo}>₿</span>
          <div className={styles.headerText}>
            <span className={styles.headerTitle}>Smart BLOC</span>
            <span className={styles.headerSub}> + Fold CC Advisor</span>
          </div>
        </div>
      </div>

      <aside className={styles.sidebar}>
        <div className={styles.sidebarInner}>
          {activeTab === 'living' ? <LivingInputsPanel /> : <InputsPanel />}
        </div>
      </aside>

      <main className={styles.main}>
        {activeTab === 'living' ? <LivingOnBitcoin /> : <SmartBlocMain />}
      </main>
    </div>
  );
}
