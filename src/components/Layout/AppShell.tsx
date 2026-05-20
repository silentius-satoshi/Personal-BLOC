import { useEffect } from 'react';
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
import { BrandingDropdown }  from './BrandingDropdown';
import { SettingsMain }      from '../Settings/SettingsMain';
import styles from './AppShell.module.css';

const ALL_TABS = [
  { key: 'living',    fullLabel: 'Living on Bitcoin', shortLabel: 'LO₿'      },
  { key: 'bloc',      fullLabel: 'Smart BLOC',        shortLabel: '₿LOC'     },
  { key: 'powerlaw',  fullLabel: 'Power Law',         shortLabel: 'Power Law' },
  { key: 'converter', fullLabel: 'Sats',              shortLabel: '丰'        },
  { key: 'mining',    fullLabel: 'Miners',            shortLabel: 'Miners'   },
] as const;

type TabKey = typeof ALL_TABS[number]['key'];

export function AppShell() {
  const activeTab    = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const hiddenTabs   = useStore((s) => s.hiddenTabs);

  const visibleTabs = ALL_TABS.filter((t) => !hiddenTabs.includes(t.key));

  useEffect(() => {
    if (activeTab === 'settings') return;
    if (hiddenTabs.includes(activeTab)) {
      const first = ALL_TABS.find((t) => !hiddenTabs.includes(t.key));
      if (first) setActiveTab(first.key);
    }
  }, [hiddenTabs, activeTab]);

  return (
    <div className={styles.shell} data-active-tab={activeTab}>
      <div className={styles.tabBar}>
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className={styles.tabLabelFull}>{tab.fullLabel}</span>
            <span className={styles.tabLabelShort}>{tab.shortLabel}</span>
          </button>
        ))}
        <BrandingDropdown />
      </div>

      <aside className={styles.sidebar}>
        <div className={styles.sidebarInner}>
          {activeTab === 'settings'   ? null               :
           activeTab === 'living'     ? <LivingInputsPanel /> :
           activeTab === 'powerlaw'   ? <PowerLawSidebar />   :
           activeTab === 'converter'  ? <ConverterSidebar />  :
           activeTab === 'mining'     ? <MiningInputsPanel /> :
                                        <InputsPanel />}
        </div>
      </aside>

      <main className={styles.main}>
        {activeTab === 'settings'   ? <SettingsMain />    :
         activeTab === 'living'     ? <LivingOnBitcoin /> :
         activeTab === 'powerlaw'   ? <PowerLawMain />    :
         activeTab === 'converter'  ? <ConverterMain />   :
         activeTab === 'mining'     ? <MiningMain />      :
                                      <SmartBlocMain />}
      </main>
    </div>
  );
}
