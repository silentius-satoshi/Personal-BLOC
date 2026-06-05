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
  const setActiveTier       = useStore((s) => s.setActiveTier);

  const advisorActualBlocBalance    = useStore((s) => s.advisorActualBlocBalance);
  const setAdvisorActualBlocBalance = useStore((s) => s.setAdvisorActualBlocBalance);
  const advisorActualBtcHeld        = useStore((s) => s.advisorActualBtcHeld);
  const setAdvisorActualBtcHeld     = useStore((s) => s.setAdvisorActualBtcHeld);
  const advisorStartDate            = useStore((s) => s.advisorStartDate);
  const setAdvisorStartDate         = useStore((s) => s.setAdvisorStartDate);
  const showMiningInLog             = useStore((s) => s.showMiningInLog);
  const setShowMiningInLog          = useStore((s) => s.setShowMiningInLog);

  const cbLoanBalance         = useStore((s) => s.cbLoanBalance);         const setCbLoanBalance         = useStore((s) => s.setCbLoanBalance);
  const cbCollateralBtc       = useStore((s) => s.cbCollateralBtc);       const setCbCollateralBtc       = useStore((s) => s.setCbCollateralBtc);
  const cbAprPct              = useStore((s) => s.cbAprPct);              const setCbAprPct              = useStore((s) => s.setCbAprPct);
  const cbMonthlyPayment      = useStore((s) => s.cbMonthlyPayment);      const setCbMonthlyPayment      = useStore((s) => s.setCbMonthlyPayment);
  const cbLiquidationPrice    = useStore((s) => s.cbLiquidationPrice);    const setCbLiquidationPrice    = useStore((s) => s.setCbLiquidationPrice);
  const cbPaymentStrategy     = useStore((s) => s.cbPaymentStrategy);     const setCbPaymentStrategy     = useStore((s) => s.setCbPaymentStrategy);
  const cbLtvTriggerPct       = useStore((s) => s.cbLtvTriggerPct);       const setCbLtvTriggerPct       = useStore((s) => s.setCbLtvTriggerPct);
  const cbLtvTargetPct        = useStore((s) => s.cbLtvTargetPct);        const setCbLtvTargetPct        = useStore((s) => s.setCbLtvTargetPct);

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
          <div className={styles.setupFieldGroup}>
            <NumberInput
              label="BTC collateral"
              value={parseFloat(advisorActualBtcHeld.toFixed(5))}
              onChange={(v) => { setAdvisorActualBtcHeld(v); setActiveTier('custom'); }}
              prefix="₿"
              min={0}
              step={0.001}
            />
            <span className={styles.fieldHint}>Your BTC in Strike. Feeds BLOC calculations, Advisor projections, and Liq Sim.</span>
          </div>
          <NumberInput label="BLOC APR"        value={blocApr}          onChange={setBlocApr}          min={0} step={0.1} />
          <div className={styles.setupFieldGroup}>
            <NumberInput label="Amount Drawn" value={advisorActualBlocBalance} onChange={setAdvisorActualBlocBalance} prefix="$" min={0} step={100} />
            <span className={styles.fieldHint}>Current outstanding BLOC draw balance.</span>
          </div>
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
              <div className={styles.setupFieldGroup}>
                <span className={styles.setupFieldLabel}>CB PAYMENT STRATEGY</span>
                <div className={styles.strategyPills}>
                  <button
                    className={`${styles.strategyPill} ${cbPaymentStrategy === 'monthly' ? styles.strategyPillActive : ''}`}
                    onClick={() => setCbPaymentStrategy('monthly')}
                  >Monthly</button>
                  <button
                    className={`${styles.strategyPill} ${cbPaymentStrategy === 'ltvTriggered' ? styles.strategyPillActive : ''}`}
                    onClick={() => setCbPaymentStrategy('ltvTriggered')}
                  >LTV-Triggered</button>
                </div>
              </div>
              <NumberInput label="Loan balance"   value={cbLoanBalance}   onChange={setCbLoanBalance}   prefix="$" min={0} step={1000} />
              <div className={styles.setupFieldGroup}>
                <NumberInput label="BTC collateral" value={cbCollateralBtc} onChange={setCbCollateralBtc} prefix="₿" min={0} step={0.001} />
                <span className={styles.fieldHint}>BTC pledged to your Coinbase/Morpho loan.</span>
              </div>
              <NumberInput label="APR"             value={cbAprPct}           onChange={setCbAprPct}           min={0} step={0.01} />
              {cbPaymentStrategy === 'monthly' && (
                <NumberInput label="Monthly payment" value={cbMonthlyPayment} onChange={setCbMonthlyPayment} prefix="$" min={0} step={100} />
              )}
              {cbPaymentStrategy === 'ltvTriggered' && (
                <>
                  <NumberInput label="Draw trigger LTV" value={cbLtvTriggerPct} onChange={setCbLtvTriggerPct} min={0} step={1} />
                  <NumberInput label="Pay down to LTV"  value={cbLtvTargetPct}  onChange={setCbLtvTargetPct}  min={0} step={1} />
                  {cbLtvTriggerPct <= cbLtvTargetPct && (
                    <span className={styles.fieldHint} style={{ color: 'var(--amber)' }}>
                      Trigger must be above target LTV
                    </span>
                  )}
                </>
              )}
              <div className={styles.setupFieldGroup}>
                <NumberInput label="Liquidation price" value={cbLiquidationPrice} onChange={setCbLiquidationPrice} prefix="$" min={0} step={100} />
                <span className={styles.fieldHint}>Enter the exact figure Coinbase shows in your Loan Center.</span>
              </div>
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
