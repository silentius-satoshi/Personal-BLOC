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
import { useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { DevPanel } from './DevPanel';
import { useNostrSync } from '../../hooks/useNostrSync';
import { useMorphoRate } from '../../hooks/useMorphoRate';
import { Toggle } from '../ui/Toggle';
import { NumberInput } from '../ui/NumberInput';
import { CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { disconnectNostr, reconnectNostr } from '../../lib/nostr/disconnect';
import { STRIKE_MAX_DRAW_LTV } from '../../simulation/strikeCredit';
import { getCurrentStrategyMonth } from '../../simulation/runAdvisor';
import { fmtUSD } from '../../utils/format';
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
  const devMode             = useStore((s) => s.devMode);
  const setDevMode          = useStore((s) => s.setDevMode);

  // Hidden dev-mode activation: 5 taps on the Build row (reset after 2.5s of inactivity).
  const tapCount  = useRef(0);
  const lastTapAt = useRef(0);
  const handleBuildTap = () => {
    const now = Date.now();
    if (now - lastTapAt.current > 2500) tapCount.current = 0;
    lastTapAt.current = now;
    tapCount.current += 1;
    if (tapCount.current >= 5) {
      tapCount.current = 0;
      setDevMode(!devMode);
    }
  };
  const hasCbLoan           = useStore((s) => s.hasCbLoan);
  const setHasCbLoan        = useStore((s) => s.setHasCbLoan);

  const nostrAuthEnabled    = useStore((s) => s.nostrAuthEnabled);
  const nostrPubkey         = useStore((s) => s.nostrPubkey);
  const nostrSyncing        = useStore((s) => s.nostrSyncing);
  const { triggerSync }     = useNostrSync();
  const { rate: morphoRate, loading: morphoLoading } = useMorphoRate();   // live cbBTC/USDC Base rate — reference only
  const nostrSigningMethod  = useStore((s) => s.nostrSigningMethod);
  const setNostrAuthEnabled = useStore((s) => s.setNostrAuthEnabled);

  const income      = useStore((s) => s.income);       const setIncome      = useStore((s) => s.setIncome);
  const expenses    = useStore((s) => s.expenses);     const setExpenses    = useStore((s) => s.setExpenses);
  const creditLine  = useStore((s) => s.creditLine);   const setCreditLine  = useStore((s) => s.setCreditLine);
  const blocApr     = useStore((s) => s.blocApr);      const setBlocApr     = useStore((s) => s.setBlocApr);

  const advisorActualBlocBalance    = useStore((s) => s.advisorActualBlocBalance);
  const setAdvisorActualBlocBalance = useStore((s) => s.setAdvisorActualBlocBalance);
  const currentBtcHeld              = useStore((s) => s.getCurrentBtcHeld());
  const advisorActualBtcHeld        = useStore((s) => s.advisorActualBtcHeld);  // read-only month-0 baseline
  const adjustCurrentCollateral     = useStore((s) => s.adjustCurrentCollateral);
  const pendingCollateralAdjustment = useStore((s) => s.pendingCollateralAdjustment);
  const strikeBtcAvailable          = useStore((s) => s.strikeBtcAvailable);
  const strikeApiConnected          = useStore((s) => s.strikeApiConnected);
  // Reality edit — commit on blur only (NumberInput fires onChange per keystroke; the draft keeps
  // pending from churning while typing). Edits record a dated adjustment, never touch the baseline.
  const [btcHeldDraft, setBtcHeldDraft] = useState<number | null>(null);
  const advisorStartDate            = useStore((s) => s.advisorStartDate);
  const setAdvisorStartDate         = useStore((s) => s.setAdvisorStartDate);
  const showMiningInLog             = useStore((s) => s.showMiningInLog);
  const setShowMiningInLog          = useStore((s) => s.setShowMiningInLog);
  const showPlanStrikeBar           = useStore((s) => s.showPlanStrikeBar);
  const setShowPlanStrikeBar        = useStore((s) => s.setShowPlanStrikeBar);
  const showPlanCbBar               = useStore((s) => s.showPlanCbBar);
  const setShowPlanCbBar            = useStore((s) => s.setShowPlanCbBar);

  const cbLoanBalance         = useStore((s) => s.cbLoanBalance);         const setCbLoanBalance         = useStore((s) => s.setCbLoanBalance);
  const cbCollateralBtc       = useStore((s) => s.cbCollateralBtc);       const setCbCollateralBtc       = useStore((s) => s.setCbCollateralBtc);
  const cbAprPct              = useStore((s) => s.cbAprPct);              const setCbAprPct              = useStore((s) => s.setCbAprPct);
  const cbMonthlyPayment      = useStore((s) => s.cbMonthlyPayment);      const setCbMonthlyPayment      = useStore((s) => s.setCbMonthlyPayment);
  const cbLiquidationPrice    = useStore((s) => s.cbLiquidationPrice);    const setCbLiquidationPrice    = useStore((s) => s.setCbLiquidationPrice);
  const cbPaymentStrategy     = useStore((s) => s.cbPaymentStrategy);     const setCbPaymentStrategy     = useStore((s) => s.setCbPaymentStrategy);
  const cbLtvTriggerPct       = useStore((s) => s.cbLtvTriggerPct);       const setCbLtvTriggerPct       = useStore((s) => s.setCbLtvTriggerPct);
  const cbLtvTargetPct        = useStore((s) => s.cbLtvTargetPct);        const setCbLtvTargetPct        = useStore((s) => s.setCbLtvTargetPct);
  const cbRotateBackPct       = useStore((s) => s.cbRotateBackPct);       const setCbRotateBackPct       = useStore((s) => s.setCbRotateBackPct);

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
              className={styles.nostrReconnectBtn}
              onClick={() => reconnectNostr()}
            >
              Reconnect
            </button>
            <button
              className={styles.nostrDisconnectBtn}
              onClick={() => disconnectNostr()}
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
          <div className={styles.setupFieldGroup}>
            <NumberInput label="Initial credit line" value={creditLine} onChange={setCreditLine} prefix="$" min={0} step={500} />
            <span className={styles.fieldHint}>
              Your approved max draw — available credit adjusts with BTC price below{' '}
              {currentBtcHeld > 0 ? fmtUSD(creditLine / (currentBtcHeld * STRIKE_MAX_DRAW_LTV)) : '—'}
            </span>
          </div>
          <div className={styles.setupFieldGroup}>
            <NumberInput
              label="Initial BTC collateral"
              value={advisorActualBtcHeld}
              onChange={() => {}}          // no-op; read-only
              prefix="₿"
              decimals={8}                 // 8-dp sat precision — matches the actual pledged amount (was toFixed(5))
              readOnly
              valueColor="var(--orange)"   // static orange text, distinct from the editable current field
            />
            <span className={styles.fieldHint}>
              What you started with at month 0 — the fixed baseline. Current collateral grows from here via logged buys and dated adjustments.
            </span>
            {(() => {
              const delta = currentBtcHeld - advisorActualBtcHeld;
              if (Math.abs(delta) < 1e-8) return null;   // hide when no movement yet
              return (
                <span className={styles.fieldHint} style={{ color: 'var(--green)' }}>
                  {delta > 0 ? '+' : ''}{delta.toFixed(8)} ₿ since start
                </span>
              );
            })()}
          </div>
          <div
            className={styles.setupFieldGroup}
            onBlur={() => {
              if (btcHeldDraft !== null && btcHeldDraft !== currentBtcHeld) adjustCurrentCollateral(btcHeldDraft);
              setBtcHeldDraft(null);
            }}
          >
            <NumberInput
              label="Current BTC collateral"
              value={btcHeldDraft ?? currentBtcHeld}
              onChange={setBtcHeldDraft}
              prefix="₿"
              min={0}
              step={0.001}
            />
            <span className={styles.fieldHint}>Your current BTC in Strike. Edits record a dated adjustment this month — feeds Advisor projections and Liq Sim.</span>
            {pendingCollateralAdjustment !== 0 && (
              <span className={styles.fieldHint} style={{ color: 'var(--orange)' }}>
                {pendingCollateralAdjustment > 0 ? '+' : ''}{pendingCollateralAdjustment.toFixed(5)} ₿ pending — dates to Month {getCurrentStrategyMonth(advisorStartDate)} when logged
              </span>
            )}
          </div>
          {strikeApiConnected && strikeBtcAvailable !== null && (
            <div className={styles.setupFieldGroup}>
              <NumberInput
                label="Spendable BTC (dry powder)"
                value={strikeBtcAvailable}
                onChange={() => {}}            // no-op; read-only, live-fetched from Strike
                prefix="₿"
                decimals={8}                   // sat precision, matches the collateral fields
                readOnly
                valueColor="var(--text-muted)" // muted/neutral — NOT collateral, NOT the orange baseline, NOT green delta
              />
              <span className={styles.fieldHint}>
                Spendable BTC held in Strike — NOT pledged as collateral, does not affect your LTV. Live from the Strike API.
              </span>
            </div>
          )}
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
          <div className={styles.setupGroupLabel}>MONTHLY PLAN</div>
          <div className={styles.cbLoanToggleRow}>
            <div className={styles.cbLoanToggleLabel}>
              <span className={styles.cbLoanToggleTitle}>Show Strike BLOC bar</span>
              <span className={styles.cbLoanToggleDesc}>In the monthly plan card</span>
            </div>
            <Toggle value={showPlanStrikeBar} onChange={setShowPlanStrikeBar} />
          </div>
          <div className={styles.cbLoanToggleRow}>
            <div className={styles.cbLoanToggleLabel}>
              <span className={styles.cbLoanToggleTitle}>Show Coinbase loan bar</span>
              <span className={styles.cbLoanToggleDesc}>In the monthly plan card</span>
            </div>
            <Toggle value={showPlanCbBar} onChange={setShowPlanCbBar} />
          </div>
        </div>

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
              <div className={styles.setupFieldGroup}>
                <NumberInput label="APR"             value={cbAprPct}           onChange={setCbAprPct}           min={0} step={0.01} />
                {morphoRate.borrowApy !== null ? (
                  <>
                    <span className={styles.fieldHint}>
                      Morpho cbBTC/USDC (Base) market rate: {morphoRate.borrowApy.toFixed(2)}% (live)
                    </span>
                    {Math.abs(morphoRate.borrowApy - cbAprPct) > 1 && (
                      <span className={styles.fieldHint}>Your APR differs — Coinbase may add a margin.</span>
                    )}
                  </>
                ) : (
                  <span className={styles.fieldHint}>
                    {morphoLoading ? 'checking Morpho rate…' : 'Morpho market rate unavailable'}
                  </span>
                )}
              </div>
              {cbPaymentStrategy === 'monthly' && (
                <NumberInput label="Monthly payment" value={cbMonthlyPayment} onChange={setCbMonthlyPayment} prefix="$" min={0} step={100} />
              )}
              {cbPaymentStrategy === 'ltvTriggered' && (
                <>
                  <NumberInput label="Draw trigger LTV" value={cbLtvTriggerPct} onChange={setCbLtvTriggerPct} min={0} step={1} />
                  <NumberInput label="Pay down to LTV"  value={cbLtvTargetPct}  onChange={setCbLtvTargetPct}  min={0} step={1} />
                  <NumberInput label="Rotate-back LTV"  value={cbRotateBackPct} onChange={setCbRotateBackPct} min={0} step={1} />
                  <span className={styles.fieldHint}>When CB LTV falls below this, shift expensive Strike debt back to the cheaper CB loan.</span>
                  {!(cbRotateBackPct < cbLtvTargetPct && cbLtvTargetPct < cbLtvTriggerPct) && (
                    <span className={styles.fieldHint} style={{ color: 'var(--amber)' }}>
                      Must satisfy: rotate-back &lt; pay-down &lt; trigger
                    </span>
                  )}
                </>
              )}
              <div className={styles.setupFieldGroup}>
                <NumberInput label="Liquidation price" value={cbLiquidationPrice} onChange={setCbLiquidationPrice} prefix="$" min={0} step={100} />
                <span className={styles.fieldHint}>Enter the exact figure Coinbase shows in your Loan Center.</span>
                {(() => {
                  const implied = cbCollateralBtc > 0 ? cbLoanBalance / (cbCollateralBtc * CB_LLTV) : 0;
                  const deviation = cbLiquidationPrice > 0 && implied > 0
                    ? Math.abs(cbLiquidationPrice - implied) / implied : 0;
                  return implied > 0 ? (
                    <span className={styles.fieldHint} style={{ color: deviation > 0.02 ? 'var(--amber)' : undefined }}>
                      Implied from balance ÷ (collateral × 86%): {fmtUSD(implied)}
                    </span>
                  ) : null;
                })()}
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

      <p className={styles.buildInfo} onClick={handleBuildTap}>
        Build {__BUILD_SHA__} · {new Date(__BUILD_TIME__).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </p>

      {devMode && <DevPanel />}
    </div>
  );
}
