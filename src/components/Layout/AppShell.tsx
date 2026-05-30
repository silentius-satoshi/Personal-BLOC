import { useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
import { CoinbaseLoanSidebar } from '../CoinbaseLoan/CoinbaseLoanSidebar';
import { CoinbaseLoanMain }    from '../CoinbaseLoan/CoinbaseLoanMain';
import { BrandingDropdown }  from './BrandingDropdown';
import { SettingsMain }      from '../Settings/SettingsMain';
import styles from './AppShell.module.css';

const ALL_TABS_META = [
  { key: 'living',    fullLabel: 'Living on Bitcoin', shortLabel: 'LO₿'      },
  { key: 'bloc',      fullLabel: 'Smart BLOC',        shortLabel: '₿LOC'     },
  { key: 'powerlaw',  fullLabel: 'Power Law',         shortLabel: 'Power Law' },
  { key: 'converter', fullLabel: 'Sats',              shortLabel: '丰'        },
  { key: 'mining',    fullLabel: 'Miners',            shortLabel: 'Miners'   },
  { key: 'coinbase',  fullLabel: 'CB Loan',           shortLabel: 'CB'       },
] as const;

type TabKey = typeof ALL_TABS_META[number]['key'];
type ActiveTab = TabKey | 'settings';

interface SortableTabProps {
  tab: { key: string; fullLabel: string; shortLabel: string };
  isActive: boolean;
  onClick: () => void;
  styles: Record<string, string>;
}

function SortableTab({ tab, isActive, onClick, styles }: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor:  isDragging ? 'grabbing' : 'pointer',
    zIndex:  isDragging ? 10 : undefined,
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      <span className={styles.tabLabelFull}>{tab.fullLabel}</span>
      <span className={styles.tabLabelShort}>{tab.shortLabel}</span>
    </button>
  );
}

export function AppShell() {
  const activeTab    = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const hiddenTabs   = useStore((s) => s.hiddenTabs);
  const tabOrder     = useStore((s) => s.tabOrder);
  const setTabOrder  = useStore((s) => s.setTabOrder);

  const allKeys = ALL_TABS_META.map((t) => t.key);
  const orderedKeys = [
    ...tabOrder.filter((k) => allKeys.includes(k)),
    ...allKeys.filter((k) => !tabOrder.includes(k)),
  ];

  const visibleTabs = orderedKeys
    .map((key) => ALL_TABS_META.find((t) => t.key === key))
    .filter((t): t is typeof ALL_TABS_META[number] => t !== undefined && !hiddenTabs.includes(t.key));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleTabDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedKeys.indexOf(String(active.id));
    const newIndex = orderedKeys.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    setTabOrder(arrayMove(orderedKeys, oldIndex, newIndex));
  };

  useEffect(() => {
    if (activeTab === 'settings') return;
    if (hiddenTabs.includes(activeTab)) {
      const first = ALL_TABS_META.find((t) => !hiddenTabs.includes(t.key));
      if (first) setActiveTab(first.key);
    }
  }, [hiddenTabs, activeTab]);

  return (
    <div className={styles.shell} data-active-tab={activeTab}>
      <div className={styles.tabBar}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleTabDragEnd}>
          <SortableContext items={visibleTabs.map((t) => t.key)} strategy={horizontalListSortingStrategy}>
            {visibleTabs.map((tab) => (
              <SortableTab
                key={tab.key}
                tab={tab}
                isActive={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key as ActiveTab)}
                styles={styles}
              />
            ))}
          </SortableContext>
        </DndContext>
        <BrandingDropdown />
      </div>

      <aside className={styles.sidebar}>
        <div className={styles.sidebarInner}>
          {activeTab === 'settings'   ? null                   :
           activeTab === 'coinbase'   ? <CoinbaseLoanSidebar /> :
           activeTab === 'living'     ? <LivingInputsPanel />   :
           activeTab === 'powerlaw'   ? <PowerLawSidebar />     :
           activeTab === 'converter'  ? <ConverterSidebar />    :
           activeTab === 'mining'     ? <MiningInputsPanel />   :
                                        <InputsPanel />}
        </div>
      </aside>

      <main className={styles.main}>
        {activeTab === 'settings'   ? <SettingsMain />      :
         activeTab === 'coinbase'   ? <CoinbaseLoanMain />  :
         activeTab === 'living'     ? <LivingOnBitcoin />   :
         activeTab === 'powerlaw'   ? <PowerLawMain />      :
         activeTab === 'converter'  ? <ConverterMain />     :
         activeTab === 'mining'     ? <MiningMain />        :
                                      <SmartBlocMain />}
      </main>
    </div>
  );
}
