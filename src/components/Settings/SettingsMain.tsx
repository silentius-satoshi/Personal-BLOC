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
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../../store/useStore';
import { useNostrSync } from '../../hooks/useNostrSync';
import { Toggle } from '../ui/Toggle';
import { NumberInput } from '../ui/NumberInput';
import styles from './SettingsMain.module.css';

const ALL_TABS = [
  { key: 'living',    label: 'Living on Bitcoin' },
  { key: 'bloc',      label: 'Smart BLOC'         },
  { key: 'powerlaw',  label: 'Power Law'           },
  { key: 'converter', label: 'Sats'                },
  { key: 'mining',    label: 'Miners'              },
  { key: 'coinbase',  label: 'CB Loan'             },
  { key: 'liqsim',   label: 'Liq Sim'             },
  { key: 'advisor',   label: 'Advisor'             },
] as const;

const MOVEABLE_KEYS = ['powerlaw', 'converter', 'mining', 'liqsim'];

type TabEntry = typeof ALL_TABS[number];

interface SortableTabRowProps {
  tab:             TabEntry;
  isVisible:       boolean;
  isLastVisible:   boolean;
  isToolTab:       boolean;
  isMoveable:      boolean;
  onToggle:        () => void;
  onLocationToggle: () => void;
  styles:          Record<string, string>;
}

function SortableTabRow({ tab, isVisible, isLastVisible, isToolTab, isMoveable, onToggle, onLocationToggle, styles }: SortableTabRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.key });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.tabRow} ${isDragging ? styles.tabRowDragging : ''}`}
    >
      <span
        className={styles.dragHandle}
        {...attributes}
        {...listeners}
        title="Drag to reorder"
      >
        ⠿
      </span>
      <span className={`${styles.tabLabel} ${!isVisible ? styles.tabLabelHidden : ''}`}>
        {tab.label}
      </span>
      {isMoveable && (
        <button
          className={`${styles.locationToggle} ${isToolTab ? styles.locationTools : styles.locationMain}`}
          onClick={(e) => { e.stopPropagation(); onLocationToggle(); }}
          title={isToolTab ? 'Move to main bar' : 'Move to Tools dropdown'}
        >
          {isToolTab ? 'Tools' : 'Main'}
        </button>
      )}
      <Toggle value={isVisible} onChange={onToggle} disabled={isLastVisible} />
    </div>
  );
}

interface SettingsMainProps {
  hideHeader?: boolean;
}

export function SettingsMain({ hideHeader = false }: SettingsMainProps) {
  const hiddenTabs          = useStore((s) => s.hiddenTabs);
  const toggleTabVisibility = useStore((s) => s.toggleTabVisibility);
  const previousTab         = useStore((s) => s.previousTab);
  const setActiveTab        = useStore((s) => s.setActiveTab);
  const tabOrder            = useStore((s) => s.tabOrder);
  const setTabOrder         = useStore((s) => s.setTabOrder);
  const toolTabs            = useStore((s) => s.toolTabs);
  const setToolTabs         = useStore((s) => s.setToolTabs);
  const simpleMode          = useStore((s) => s.simpleMode);
  const setSimpleMode       = useStore((s) => s.setSimpleMode);
  const hasCbLoan           = useStore((s) => s.hasCbLoan);
  const setHasCbLoan        = useStore((s) => s.setHasCbLoan);

  const nostrAuthEnabled    = useStore((s) => s.nostrAuthEnabled);
  const nostrPubkey         = useStore((s) => s.nostrPubkey);
  const nostrSyncing        = useStore((s) => s.nostrSyncing);
  const { triggerSync }     = useNostrSync();
  const nostrSigningMethod  = useStore((s) => s.nostrSigningMethod);
  const setNostrAuthEnabled = useStore((s) => s.setNostrAuthEnabled);
  const setNostrPubkey      = useStore((s) => s.setNostrPubkey);
  const setNostrSigningMethod = useStore((s) => s.setNostrSigningMethod);
  const setNostrBunkerUri   = useStore((s) => s.setNostrBunkerUri);
  const setIsAuthenticated  = useStore((s) => s.setIsAuthenticated);

  const income      = useStore((s) => s.income);       const setIncome      = useStore((s) => s.setIncome);
  const expenses    = useStore((s) => s.expenses);     const setExpenses    = useStore((s) => s.setExpenses);
  const creditLine  = useStore((s) => s.creditLine);   const setCreditLine  = useStore((s) => s.setCreditLine);
  const blocApr     = useStore((s) => s.blocApr);      const setBlocApr     = useStore((s) => s.setBlocApr);
  const customCollateral   = useStore((s) => s.customCollateral);
  const setCustomCollateral = useStore((s) => s.setCustomCollateral);
  const setActiveTier       = useStore((s) => s.setActiveTier);

  const advisorActualBlocBalance    = useStore((s) => s.advisorActualBlocBalance);
  const setAdvisorActualBlocBalance = useStore((s) => s.setAdvisorActualBlocBalance);
  const advisorActualBtcHeld        = useStore((s) => s.advisorActualBtcHeld);
  const setAdvisorActualBtcHeld     = useStore((s) => s.setAdvisorActualBtcHeld);
  const advisorStartDate            = useStore((s) => s.advisorStartDate);
  const setAdvisorStartDate         = useStore((s) => s.setAdvisorStartDate);
  const showMiningInLog             = useStore((s) => s.showMiningInLog);
  const setShowMiningInLog          = useStore((s) => s.setShowMiningInLog);

  const cbLoanBalance    = useStore((s) => s.cbLoanBalance);    const setCbLoanBalance    = useStore((s) => s.setCbLoanBalance);
  const cbCollateralBtc  = useStore((s) => s.cbCollateralBtc);  const setCbCollateralBtc  = useStore((s) => s.setCbCollateralBtc);
  const cbAprPct         = useStore((s) => s.cbAprPct);         const setCbAprPct         = useStore((s) => s.setCbAprPct);

  const visibleCount = ALL_TABS.filter((t) => !hiddenTabs.includes(t.key)).length;

  const toggleToolLocation = (key: string) => {
    if (toolTabs.includes(key)) {
      setToolTabs(toolTabs.filter((k) => k !== key));
    } else {
      setToolTabs([...toolTabs, key]);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tabOrder.indexOf(String(active.id));
    const newIndex = tabOrder.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    setTabOrder(arrayMove(tabOrder, oldIndex, newIndex));
  };

  const orderedTabs: TabEntry[] = [
    ...tabOrder
      .map((key) => ALL_TABS.find((t) => t.key === key))
      .filter((t): t is TabEntry => t !== undefined),
    ...ALL_TABS.filter((t) => !tabOrder.includes(t.key)),
  ];

  return (
    <div className={styles.main}>
      {!hideHeader && (
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => setActiveTab(previousTab)}>
            ← Back
          </button>
          <h2 className={styles.title}>Settings</h2>
        </div>
      )}

      <div className={styles.simpleModeToggle}>
        <div className={styles.simpleModeLabel}>
          <span className={styles.simpleModeTitle}>Simple Mode</span>
          <span className={styles.simpleModeDesc}>
            Shows only your monthly plan — hides all charts and details
          </span>
        </div>
        <Toggle value={simpleMode} onChange={setSimpleMode} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>NOSTR IDENTITY</div>

        <div className={styles.cbLoanToggleRow}>
          <div className={styles.cbLoanToggleLabel}>
            <span className={styles.cbLoanToggleTitle}>Enable Nostr Lock</span>
            <span className={styles.cbLoanToggleDesc}>Require Nostr sign-in on every page load</span>
          </div>
          <Toggle value={nostrAuthEnabled} onChange={setNostrAuthEnabled} />
        </div>

        {nostrPubkey && (
          <div className={styles.nostrIdentityRow}>
            <span className={styles.nostrPubkey}>
              {nostrPubkey.slice(0, 8)}…{nostrPubkey.slice(-8)}
            </span>
            <span className={styles.nostrBadge}>{nostrSigningMethod === 'nip07' ? 'NIP-07' : 'NIP-46'}</span>
            <button
              className={styles.nostrDisconnectBtn}
              onClick={() => {
                setNostrPubkey(null);
                setNostrSigningMethod(null);
                setNostrBunkerUri(null);
                setNostrAuthEnabled(false);
                setIsAuthenticated(false);
              }}
            >
              Disconnect
            </button>
          </div>
        )}

        {nostrAuthEnabled && (
          <button
            onClick={triggerSync}
            disabled={nostrSyncing}
            className={styles.syncButton}
          >
            {nostrSyncing ? 'Syncing…' : '↻ Sync now'}
          </button>
        )}

        {nostrAuthEnabled && !nostrPubkey && (
          <p className={styles.nostrWarning}>
            ⚠ Back up your nsec — losing it means permanent loss of encrypted relay data.
          </p>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>SETUP</div>

        <div className={styles.setupGroup}>
          <div className={styles.setupGroupLabel}>BUDGET</div>
          <NumberInput label="Monthly income"   value={income}   onChange={setIncome}   prefix="$" min={0} step={100} />
          <NumberInput label="Monthly expenses" value={expenses} onChange={setExpenses} prefix="$" min={0} step={100} />
        </div>

        <div className={styles.setupGroup}>
          <div className={styles.setupGroupLabel}>STRIKE BLOC</div>
          <NumberInput label="Credit line"     value={creditLine}       onChange={setCreditLine}       prefix="$" min={0} step={500} />
          <NumberInput
            label="BTC collateral"
            value={parseFloat(customCollateral.toFixed(5))}
            onChange={(v) => { setCustomCollateral(v); setActiveTier('custom'); }}
            prefix="₿"
            min={0}
            step={0.001}
          />
          <NumberInput label="BLOC APR"        value={blocApr}          onChange={setBlocApr}          min={0} step={0.1} />
          <NumberInput label="Amount Drawn"    value={advisorActualBlocBalance} onChange={setAdvisorActualBlocBalance} prefix="$" min={0} step={100} />
          <div className={styles.setupFieldGroup}>
            <span className={styles.setupFieldLabel}>Strategy start date</span>
            <input
              type="date"
              className={styles.setupDateInput}
              value={advisorStartDate}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => setAdvisorStartDate(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.setupGroup}>
          <div className={styles.setupGroupLabel}>YOUR BITCOIN</div>
          <NumberInput label="BTC held" value={advisorActualBtcHeld} onChange={setAdvisorActualBtcHeld} prefix="₿" min={0} step={0.001} />
        </div>

        {!hiddenTabs.includes('mining') && (
          <div className={styles.setupGroup}>
            <div className={styles.setupGroupLabel}>MONTHLY LOG</div>
            <div className={styles.cbLoanToggleRow}>
              <div className={styles.cbLoanToggleLabel}>
                <span className={styles.cbLoanToggleTitle}>Include mining sats in monthly log</span>
              </div>
              <Toggle value={showMiningInLog} onChange={setShowMiningInLog} />
            </div>
          </div>
        )}

        <div className={styles.setupGroup}>
          <div className={styles.setupGroupLabel}>COINBASE LOAN</div>
          <div className={styles.cbLoanToggleRow}>
            <div className={styles.cbLoanToggleLabel}>
              <span className={styles.cbLoanToggleTitle}>I have a Coinbase loan</span>
              <span className={styles.cbLoanToggleDesc}>
                Shows CB Loan tab and includes loan in Advisor calculations
              </span>
            </div>
            <Toggle value={hasCbLoan} onChange={setHasCbLoan} />
          </div>
          {hasCbLoan && (
            <>
              <NumberInput label="Loan balance"   value={cbLoanBalance}   onChange={setCbLoanBalance}   prefix="$" min={0} step={1000} />
              <NumberInput label="BTC collateral" value={cbCollateralBtc} onChange={setCbCollateralBtc} prefix="₿" min={0} step={0.001} />
              <NumberInput label="APR"            value={cbAprPct}        onChange={setCbAprPct}                    min={0} step={0.01} />
            </>
          )}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>TAB VISIBILITY & ORDER</div>
        <div className={styles.sectionDescription}>
          Drag ⠿ to reorder. Toggle visibility. Use Main/Tools to move between bar and dropdown.
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={tabOrder} strategy={verticalListSortingStrategy}>
            <div className={styles.tabList}>
              {orderedTabs.map((tab) => {
                const isVisible      = !hiddenTabs.includes(tab.key);
                const isLastVisible  = isVisible && visibleCount === 1;
                const isToolTab      = toolTabs.includes(tab.key);
                const isMoveable     = MOVEABLE_KEYS.includes(tab.key);

                return (
                  <SortableTabRow
                    key={tab.key}
                    tab={tab}
                    isVisible={isVisible}
                    isLastVisible={isLastVisible}
                    isToolTab={isToolTab}
                    isMoveable={isMoveable}
                    onToggle={() => { if (!isLastVisible) toggleTabVisibility(tab.key); }}
                    onLocationToggle={() => toggleToolLocation(tab.key)}
                    styles={styles}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
