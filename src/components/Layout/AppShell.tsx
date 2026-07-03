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
import { useBtcPrice }            from '../../hooks/useBtcPrice';
import { useStrikeData }          from '../../hooks/useStrikeData';
import { useNostrAutoRestore }    from '../../hooks/useNostrAutoRestore';
import { useNostrSync }           from '../../hooks/useNostrSync';
import { useViewerSync }          from '../../hooks/useViewerSync';
import { useMonthBucketReconcile } from '../../hooks/useMonthBucketReconcile';
import { NostrAuthGate }     from '../Auth/NostrAuthGate';
import { LocalUnlockGate }   from '../Auth/LocalUnlockGate';
import { ViewerUnlockGate }  from '../Auth/ViewerUnlockGate';
import { ViewerWaitingGate } from '../Auth/ViewerWaitingGate';
import { PrivateAppNotice }  from '../Auth/PrivateAppNotice';
import { resetViewerSession, getViewerNpub } from '../../lib/nostr/viewerSync';
import { isOwnerPubkey }     from '../../lib/nostr/ownerGate';
import { BrandingDropdown }  from './BrandingDropdown';
import { SettingsMain }      from '../Settings/SettingsMain';
import { OnboardingModal }   from '../Onboarding/OnboardingModal';
import { SimpleModeView }    from '../SimpleMode/SimpleModeView';
import { DailyModeView }     from '../Daily/DailyModeView';
import { ViewerHomeView }    from '../Viewer/ViewerHomeView';
import { LiqSimulator }     from '../Tools/LiqSimulator';
import AlmanacView          from '../Almanac/AlmanacView';
import { reconnectNostr }   from '../../lib/nostr/disconnect';
import styles from './AppShell.module.css';

const ALL_TABS_META = [
  { key: 'living',    fullLabel: 'Living on Bitcoin', shortLabel: 'LO₿'      },
  { key: 'bloc',      fullLabel: 'Smart BLOC',        shortLabel: '₿LOC'     },
  { key: 'powerlaw',  fullLabel: 'Power Law',         shortLabel: 'Power Law' },
  { key: 'converter', fullLabel: 'Sats',              shortLabel: '丰'        },
  { key: 'mining',    fullLabel: 'Miners',            shortLabel: 'Miners'   },
  { key: 'coinbase',  fullLabel: 'CB Loan',           shortLabel: 'CB'       },
  { key: 'liqsim',   fullLabel: 'Liq Sim',           shortLabel: 'Liq'      },
  { key: 'almanac',  fullLabel: 'Almanac',            shortLabel: 'Almanac'  },
  { key: 'advisor',  fullLabel: 'Advisor',            shortLabel: 'Adv'      },
] as const;

type TabKey = typeof ALL_TABS_META[number]['key'];
type ActiveTab = TabKey | 'settings';

const TOOL_KEYS = ['powerlaw', 'converter', 'mining', 'liqsim', 'almanac'] as const;

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
  const simpleView            = useStore((s) => s.simpleView);        // Monthly Playbook vs Daily journal (device-local)
  const setSimpleView         = useStore((s) => s.setSimpleView);
  const onboardingComplete    = useStore((s) => s.onboardingComplete);
  const setSimpleMode         = useStore((s) => s.setSimpleMode);
  const setOnboardingComplete = useStore((s) => s.setOnboardingComplete);
  const previousTab           = useStore((s) => s.previousTab);
  const setPreviousTab        = useStore((s) => s.setPreviousTab);

  const nostrAuthEnabled  = useStore((s) => s.nostrAuthEnabled);
  const isAuthenticated   = useStore((s) => s.isAuthenticated);
  const nostrSigningMethod = useStore((s) => s.nostrSigningMethod);
  const nostrPubkey       = useStore((s) => s.nostrPubkey);
  const nostrSigner       = useStore((s) => s.nostrSigner);
  const nostrSyncing      = useStore((s) => s.nostrSyncing);
  const nostrReconnectNeeded = useStore((s) => s.nostrReconnectNeeded);
  const setIsAuthenticated = useStore((s) => s.setIsAuthenticated);
  const [unlockEscape, setUnlockEscape] = useState(false);
  const [bannerCopied, setBannerCopied] = useState(false);

  const isOwner = isOwnerPubkey(nostrPubkey, import.meta.env.VITE_OWNER_PUBKEY as string | undefined);
  const viewerMode    = useStore((s) => s.viewerMode);
  const viewerNpubSelf = useStore((s) => s.viewerWriterPubkey);   // the owner this viewer follows (for the banner)
  const viewerKeyWrapped = useStore((s) => s.viewerKeyWrapped);   // Phase 3 — wrapped-at-rest viewer key
  const viewerUnlocked   = useStore((s) => s.viewerUnlocked);     // in-memory holder populated?
  const viewerSecretKey  = useStore((s) => s.viewerSecretKey);    // v17 migrant plaintext (pre-wrap)
  const viewerDataLoaded = useStore((s) => s.viewerDataLoaded);   // true only after a VALID snapshot decrypt

  // Reset viewing key (gate escape / recovery) — delegates to the SINGLE shared teardown
  // (resetViewerSession, viewerSync.ts — Viewer V4) so the gate escapes and the Settings Sign-out
  // can't drift. Lossless: the owner's snapshot stays on relay.
  const resetViewer = () => resetViewerSession();

  useBtcPrice(); // keep store btcPrice live for the whole session — Simple Mode mounts no sidebar that calls this
  useStrikeData(isAuthenticated && isOwner);   // Strike fetch is owner-only — never runs for visitors/non-owners (viewer gets Strike from the snapshot)
  useNostrAutoRestore();
  useViewerSync();   // read-only viewer pull/sub — no-op unless viewerMode
  useMonthBucketReconcile();   // one-shot: re-roll entries stored under the pre-fix bucketing (owner-only, once)

  const { triggerSync } = useNostrSync({ live: !viewerMode });   // writer sync OFF in viewerMode (by construction)

  // Two-stage reconnect affordance: retry sync first; escalate to full re-auth only if the retry fails.
  const [retryFailed, setRetryFailed] = useState(false);
  useEffect(() => { if (!nostrReconnectNeeded) setRetryFailed(false); }, [nostrReconnectNeeded]);

  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 640);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const allKeys: string[] = ALL_TABS_META.map((t) => t.key);
  const orderedKeys = [
    ...tabOrder.filter((k) => allKeys.includes(k)),
    ...allKeys.filter((k) => !tabOrder.includes(k)),
  ];

  const visibleTabs = orderedKeys
    .map((key) => ALL_TABS_META.find((t) => t.key === key))
    .filter((t): t is typeof ALL_TABS_META[number] =>
      t !== undefined && !hiddenTabs.includes(t.key) && (t.key !== 'coinbase' || hasCbLoan) && (t.key !== 'liqsim' || hasCbLoan)
    );

  const effectiveToolKeys: readonly string[] = isMobile ? TOOL_KEYS : toolTabs;

  const mainTabs = visibleTabs.filter((t) => !effectiveToolKeys.includes(t.key));

  const toolTabsList = orderedKeys
    .filter((k) => effectiveToolKeys.includes(k) && !hiddenTabs.includes(k) && (k !== 'coinbase' || hasCbLoan) && (k !== 'liqsim' || hasCbLoan))
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

      {viewerMode && (
        <div className={styles.viewerBanner}>
          👁 Viewing {viewerNpubSelf ? `${viewerNpubSelf.slice(0, 8)}…` : 'a shared plan'} · read-only
          {(() => {
            const myNpub = getViewerNpub();
            return myNpub ? (
              <>
                {' · '}
                <button
                  className={styles.viewerBannerCopyBtn}
                  onClick={() => { navigator.clipboard?.writeText(myNpub); setBannerCopied(true); setTimeout(() => setBannerCopied(false), 1500); }}
                >
                  {bannerCopied ? 'copied ✓' : 'copy my npub'}
                </button>
              </>
            ) : null;
          })()}
        </div>
      )}

      {onboardingComplete && viewerMode && viewerKeyWrapped && !viewerUnlocked && !import.meta.env.DEV ? (
        <ViewerUnlockGate onReset={resetViewer} />   // wrapped viewer — must unlock (Face ID / PIN) before render
      ) : onboardingComplete && viewerMode && !viewerKeyWrapped && viewerSecretKey && !import.meta.env.DEV ? (
        <ViewerUnlockGate onReset={resetViewer} />   // v17 migrant — one-time wrap-setup screen, then falls through
      ) : onboardingComplete && viewerMode && !viewerDataLoaded && !import.meta.env.DEV ? (
        <ViewerWaitingGate onReset={resetViewer} />   // unlocked viewer, no VALID decrypt yet — never show stale store data
      ) : onboardingComplete && !viewerMode && nostrAuthEnabled && nostrSigningMethod === 'local' && nostrPubkey && !isAuthenticated && !unlockEscape && !import.meta.env.DEV ? (
        // Bug 3: hold until isAuthenticated (NOT !nostrSigner) — restoreSigner sets nostrSigner mid-unlock(), across
        // unlock()'s await boundaries; the old !nostrSigner term unmounted the gate then → NostrAuthGate/seed flash.
        <LocalUnlockGate onReauth={() => setUnlockEscape(true)} />
      ) : onboardingComplete && !viewerMode && nostrAuthEnabled && !nostrSigner && !isAuthenticated && !import.meta.env.DEV ? (
        // Bug 3: !nostrSigner guard — a present signer never shows the re-auth screen (every NostrAuthGate handler
        // sets signer→isAuthenticated synchronously/batched, so this can't drop the gate mid-auth for nip07/46).
        <NostrAuthGate onSuccess={() => setIsAuthenticated(true)} onBack={() => setUnlockEscape(false)} backLabel="← Back to Face ID unlock" />
      ) : onboardingComplete && !viewerMode && nostrAuthEnabled && isAuthenticated && !isOwner && !import.meta.env.DEV ? (
        <PrivateAppNotice />
      ) : viewerMode && viewerDataLoaded && activeTab !== 'settings' && activeTab !== 'almanac' ? (
        // Viewer Experience Revamp V1 — the dedicated read-only viewer home REPLACES Daily/Monthly for
        // the viewer. Settings/Almanac fall through to their simple-mode branches below.
        <ViewerHomeView
          onOpenSettings={() => { setPreviousTab(activeTab as Exclude<ActiveTab, 'settings'>); setActiveTab('settings'); }}
        />
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
      ) : simpleMode && activeTab === 'almanac' ? (
        <div className={styles.simpleModeSettings}>
          <div className={styles.simpleModeSettingsHeader}>
            <button className={styles.simpleModeBackBtn} onClick={() => setActiveTab(previousTab)}>← Back</button>
            <span className={styles.simpleModeSettingsTitle}>Almanac</span>
          </div>
          <AlmanacView />
        </div>
      ) : simpleMode && activeTab !== 'settings' ? (
        <div className={styles.simpleModeRoot}>
          {simpleView === 'daily'
            ? <DailyModeView
                onOpenSettings={() => { setPreviousTab(activeTab as Exclude<ActiveTab, 'settings'>); setActiveTab('settings'); }}
                onOpenAlmanac={() => { setPreviousTab(activeTab as Exclude<ActiveTab, 'settings'>); setActiveTab('almanac'); }}
                simpleView={simpleView}
                setSimpleView={setSimpleView}
              />
            : <SimpleModeView
                onOpenSettings={() => { setPreviousTab(activeTab as Exclude<ActiveTab, 'settings'>); setActiveTab('settings'); }}
                onOpenAlmanac={() => { setPreviousTab(activeTab as Exclude<ActiveTab, 'settings'>); setActiveTab('almanac'); }}
                simpleView={simpleView}
                setSimpleView={setSimpleView}
              />}
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

            <button
              className={styles.simpleModeBtn}
              onClick={() => setSimpleMode(true)}
              aria-label="Switch to simple view"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="1" y="3" width="14" height="10" rx="1.5" fill="currentColor"/>
              </svg>
            </button>
            <BrandingDropdown />
          </div>

          <aside className={styles.sidebar}>
            <div className={styles.sidebarInner}>
              {activeTab === 'settings'   ? null                   :
               activeTab === 'liqsim'     ? null                   :
               activeTab === 'almanac'    ? null                   :
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
             activeTab === 'liqsim'     ? <LiqSimulator />     :
             activeTab === 'almanac'    ? <AlmanacView />      :
                                          <SmartBlocMain />}
          </main>
        </div>
      )}

      {nostrAuthEnabled && nostrSyncing && !nostrReconnectNeeded && (
        <div className={styles.nostrSyncing}>
          <span className={styles.nostrSyncingDot} />
          Syncing…
        </div>
      )}

      {nostrAuthEnabled && nostrReconnectNeeded && (
        retryFailed ? (
          <button className={styles.nostrReconnect} onClick={() => reconnectNostr()}>
            ⚠ Re-authorize
          </button>
        ) : (
          <button
            className={styles.nostrReconnect}
            onClick={async () => {
              await triggerSync();
              if (useStore.getState().nostrReconnectNeeded) setRetryFailed(true);
            }}
          >
            ⚠ Reconnect
          </button>
        )
      )}

    </>
  );
}
