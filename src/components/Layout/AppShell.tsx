import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
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
import { getCurrentStrategyMonth, isStrategyComplete } from '../../simulation/runAdvisor';
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
import { AdvisorSidebar } from '../Advisor/AdvisorSidebar';
import { AdvisorMain }    from '../Advisor/AdvisorMain';
import { useStrikeData }     from '../../hooks/useStrikeData';
import { NostrAuthGate }     from '../Auth/NostrAuthGate';
import { BrandingDropdown }  from './BrandingDropdown';
import { SettingsMain }      from '../Settings/SettingsMain';
import { OnboardingModal }   from '../Onboarding/OnboardingModal';
import { SimpleModeView }    from '../SimpleMode/SimpleModeView';
import styles from './AppShell.module.css';

const ALL_TABS_META = [
  { key: 'living',    fullLabel: 'Living on Bitcoin', shortLabel: 'LO₿'      },
  { key: 'bloc',      fullLabel: 'Smart BLOC',        shortLabel: '₿LOC'     },
  { key: 'powerlaw',  fullLabel: 'Power Law',         shortLabel: 'Power Law' },
  { key: 'converter', fullLabel: 'Sats',              shortLabel: '丰'        },
  { key: 'mining',    fullLabel: 'Miners',            shortLabel: 'Miners'   },
  { key: 'coinbase',  fullLabel: 'CB Loan',           shortLabel: 'CB'       },
  { key: 'advisor',   fullLabel: 'Advisor',           shortLabel: 'Adv'      },
] as const;

type TabKey = typeof ALL_TABS_META[number]['key'];
type ActiveTab = TabKey | 'settings';

const TOOL_KEYS = ['powerlaw', 'converter', 'mining'] as const;

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

interface ToolsDropdownProps {
  tabs:      typeof ALL_TABS_META[number][];
  activeTab: string;
  onSelect:  (key: string) => void;
  styles:    Record<string, string>;
}

function ToolsDropdown({ tabs, activeTab, onSelect, styles }: ToolsDropdownProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const isActive = tabs.some((t) => t.key === activeTab);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  if (tabs.length === 0) return null;

  const openDropdown = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
    setOpen((o) => !o);
  };

  return (
    <div ref={ref} className={styles.toolsWrapper}>
      <button
        className={`${styles.toolsBtn} ${isActive ? styles.toolsBtnActive : ''}`}
        onClick={openDropdown}
        aria-expanded={open}
      >
        Tools ▾
      </button>
      {open && createPortal(
        <div className={styles.toolsDropdown} style={{ top: pos.top, left: pos.left }} onMouseDown={(e) => e.stopPropagation()}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`${styles.toolsItem} ${activeTab === tab.key ? styles.toolsItemActive : ''}`}
              onClick={() => { onSelect(tab.key); setOpen(false); }}
            >
              {tab.fullLabel}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

export function AppShell() {
  const activeTab    = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const hiddenTabs   = useStore((s) => s.hiddenTabs);
  const tabOrder     = useStore((s) => s.tabOrder);
  const setTabOrder  = useStore((s) => s.setTabOrder);
  const toolTabs     = useStore((s) => s.toolTabs);
  const hasCbLoan    = useStore((s) => s.hasCbLoan);

  const simpleMode            = useStore((s) => s.simpleMode);
  const onboardingComplete    = useStore((s) => s.onboardingComplete);
  const setSimpleMode         = useStore((s) => s.setSimpleMode);
  const setOnboardingComplete = useStore((s) => s.setOnboardingComplete);
  const previousTab           = useStore((s) => s.previousTab);

  const advisorChecklist    = useStore((s) => s.advisorChecklist);
  const setAdvisorChecklist = useStore((s) => s.setAdvisorChecklist);
  const advisorStartDate    = useStore((s) => s.advisorStartDate);

  const nostrAuthEnabled  = useStore((s) => s.nostrAuthEnabled);
  const isAuthenticated   = useStore((s) => s.isAuthenticated);
  const nostrSyncing      = useStore((s) => s.nostrSyncing);
  const setIsAuthenticated = useStore((s) => s.setIsAuthenticated);

  useStrikeData();

  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 640);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    const currentMonth = getCurrentStrategyMonth(advisorStartDate);
    const done = isStrategyComplete(advisorStartDate);
    if (!done && currentMonth !== advisorChecklist.month) {
      setAdvisorChecklist({
        month: currentMonth,
        blocDraw: false, cbPayment: false,
        btcBuying: false, fiatCoverage: false,
      });
    }
  }, [advisorStartDate, advisorChecklist.month]);

  const allKeys = ALL_TABS_META.map((t) => t.key);
  const orderedKeys = [
    ...tabOrder.filter((k) => allKeys.includes(k)),
    ...allKeys.filter((k) => !tabOrder.includes(k)),
  ];

  const visibleTabs = orderedKeys
    .map((key) => ALL_TABS_META.find((t) => t.key === key))
    .filter((t): t is typeof ALL_TABS_META[number] =>
      t !== undefined && !hiddenTabs.includes(t.key) && (t.key !== 'coinbase' || hasCbLoan)
    );

  const effectiveToolKeys: readonly string[] = isMobile ? TOOL_KEYS : toolTabs;

  const mainTabs = visibleTabs.filter((t) => !effectiveToolKeys.includes(t.key));

  const toolTabsList = orderedKeys
    .filter((k) => effectiveToolKeys.includes(k) && !hiddenTabs.includes(k) && (k !== 'coinbase' || hasCbLoan))
    .map((k) => ALL_TABS_META.find((t) => t.key === k))
    .filter((t): t is typeof ALL_TABS_META[number] => t !== undefined);

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
    <>
      {!onboardingComplete && (
        <OnboardingModal
          onComplete={(enableSimple) => {
            setOnboardingComplete(true);
            if (enableSimple) setSimpleMode(true);
          }}
        />
      )}

      {onboardingComplete && nostrAuthEnabled && !isAuthenticated ? (
        <NostrAuthGate onSuccess={() => setIsAuthenticated(true)} />
      ) : simpleMode && activeTab === 'settings' ? (
        <div className={styles.simpleModeSettings}>
          <div className={styles.simpleModeSettingsHeader}>
            <button
              className={styles.simpleModeBackBtn}
              onClick={() => setActiveTab(previousTab)}
            >
              ← Back
            </button>
            <span className={styles.simpleModeSettingsTitle}>Settings</span>
          </div>
          <SettingsMain hideHeader />
        </div>
      ) : simpleMode && activeTab !== 'settings' ? (
        <div className={styles.simpleModeRoot}>
          <SimpleModeView onOpenSettings={() => setActiveTab('settings')} />
        </div>
      ) : (
        <div className={styles.shell} data-active-tab={activeTab}>
          <div className={styles.tabBar}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleTabDragEnd}>
              <SortableContext items={mainTabs.map((t) => t.key)} strategy={horizontalListSortingStrategy}>
                {mainTabs.map((tab) => (
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

            <ToolsDropdown
              tabs={toolTabsList}
              activeTab={activeTab}
              onSelect={(key) => setActiveTab(key as ActiveTab)}
              styles={styles}
            />

            <BrandingDropdown />
          </div>

          <aside className={styles.sidebar}>
            <div className={styles.sidebarInner}>
              {activeTab === 'settings'   ? null                   :
               activeTab === 'coinbase'   ? <CoinbaseLoanSidebar /> :
               activeTab === 'advisor'    ? <AdvisorSidebar />      :
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
             activeTab === 'advisor'    ? <AdvisorMain />       :
             activeTab === 'living'     ? <LivingOnBitcoin />   :
             activeTab === 'powerlaw'   ? <PowerLawMain />      :
             activeTab === 'converter'  ? <ConverterMain />     :
             activeTab === 'mining'     ? <MiningMain />        :
                                          <SmartBlocMain />}
          </main>
        </div>
      )}

      {nostrAuthEnabled && nostrSyncing && (
        <div className={styles.nostrSyncing}>
          <span className={styles.nostrSyncingDot} />
          Syncing…
        </div>
      )}
    </>
  );
}
