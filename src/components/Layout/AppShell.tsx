import { useStore } from '../../store/useStore';
import { InputsPanel } from '../Inputs/InputsPanel';
import { LivingInputsPanel } from '../LivingOnBitcoin/LivingInputsPanel';
import { SmartBlocMain } from './SmartBlocMain';
import { LivingOnBitcoin } from '../LivingOnBitcoin/LivingOnBitcoin';
import { PowerLawSidebar } from '../PowerLaw/PowerLawSidebar';
import { PowerLawMain }    from '../PowerLaw/PowerLawMain';
import { ConverterSidebar } from '../Converter/ConverterSidebar';
import { ConverterMain }    from '../Converter/ConverterMain';
import { MiningInputsPanel } from '../Mining/MiningInputsPanel';
import { MiningMain }        from '../Mining/MiningMain';
import styles from './AppShell.module.css';

function TabLabel({ full, short }: { full: string; short: string }) {
  return (
    <>
      <span className={styles.tabLabelFull}>{full}</span>
      <span className={styles.tabLabelShort}>{short}</span>
    </>
  );
}

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
          <TabLabel full="Living on Bitcoin" short="LO₿" />
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'bloc' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('bloc')}
        >
          <TabLabel full="Smart BLOC" short="₿LOC" />
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'powerlaw' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('powerlaw')}
        >
          <TabLabel full="Power Law" short="Power Law" />
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'converter' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('converter')}
        >
          <TabLabel full="Sats" short="丰" />
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'mining' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('mining')}
        >
          <TabLabel full="Mining ⛏" short="⛏" />
        </button>
        <div className={styles.headerBranding}>
          <span className={styles.headerLogo}>₿</span>
          <div className={styles.headerText}>
            <span className={styles.headerTitle}>Personal ₿LOC</span>
          </div>
        </div>
      </div>

      <aside className={styles.sidebar}>
        <div className={styles.sidebarInner}>
          {activeTab === 'living'    ? <LivingInputsPanel />  :
           activeTab === 'powerlaw'  ? <PowerLawSidebar />    :
           activeTab === 'converter' ? <ConverterSidebar />   :
           activeTab === 'mining'    ? <MiningInputsPanel />  :
                                       <InputsPanel />}
        </div>
      </aside>

      <main className={styles.main}>
        {activeTab === 'living'    ? <LivingOnBitcoin />  :
         activeTab === 'powerlaw'  ? <PowerLawMain />     :
         activeTab === 'converter' ? <ConverterMain />    :
         activeTab === 'mining'    ? <MiningMain />       :
                                     <SmartBlocMain />}
      </main>
    </div>
  );
}
