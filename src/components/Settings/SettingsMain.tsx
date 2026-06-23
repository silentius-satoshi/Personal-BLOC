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
import { useRef, useState, useEffect } from 'react';
import { useStore, publishViewerSnapshotNow, publishViewerRevocationNow, importRelaysFromNip65, publishRelayListToNip65 } from '../../store/useStore';
import { DevPanel } from './DevPanel';
import { useNostrSync } from '../../hooks/useNostrSync';
import { useNostr } from '@nostrify/react';
import { resetAndResync } from '../../lib/store/escapeHatch';
import { migrateEncryptedToPlaintext, blobIsPlaintext } from '../../lib/store/storeMigration';
import { isStoreUnlocked } from '../../lib/store/storeCrypto';
import { useMorphoRate } from '../../hooks/useMorphoRate';
import { Toggle } from '../ui/Toggle';
import { NumberInput } from '../ui/NumberInput';
import { CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { disconnectNostr, reconnectNostr } from '../../lib/nostr/disconnect';
import { DEFAULT_RELAYS, addRelay } from '../../lib/nostr/relays';
import { nip19 } from 'nostr-tools';
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

// Phase 1 navigation shell: the long scroll becomes a section menu (rows) that drills into subpages.
type SettingsPage = 'menu' | 'identity' | 'sharing' | 'strike' | 'cbloan' | 'display' | 'tabs' | 'network' | 'about';

const SUBPAGE_TITLES: Record<Exclude<SettingsPage, 'menu'>, string> = {
  identity: 'Identity & Security',
  sharing:  'Sharing',
  strike:   'Strike Strategy',
  cbloan:   'Coinbase Loan',
  display:  'Display',
  tabs:     'Tabs',
  network:  'Network',
  about:    'About',
};

interface SettingsRowProps {
  icon:      string;
  title:     string;
  subtitle?: string;
  onClick:   () => void;
  styles:    Record<string, string>;
}

function SettingsRow({ icon, title, subtitle, onClick, styles }: SettingsRowProps) {
  return (
    <div
      className={styles.settingsRow}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <span className={styles.settingsRowIcon}>{icon}</span>
      <div className={styles.settingsRowBody}>
        <span className={styles.settingsRowTitle}>{title}</span>
        {subtitle && <span className={styles.settingsRowSubtitle}>{subtitle}</span>}
      </div>
      <span className={styles.settingsRowChevron}>›</span>
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
  const viewerMode          = useStore((s) => s.viewerMode);   // hide owner-only sections for a read-only viewer
  const setDevMode          = useStore((s) => s.setDevMode);

  // Phase 1: which settings subpage is showing (local — not threaded through the store/activeTab).
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('menu');

  // Network subpage (P1) — local relay list management.
  const nostrRelays    = useStore((s) => s.nostrRelays);
  const setNostrRelays = useStore((s) => s.setNostrRelays);
  const [relayDraft, setRelayDraft] = useState('');
  const [relayError, setRelayError] = useState<string | null>(null);
  const handleAddRelay = () => {
    const result = addRelay(nostrRelays, relayDraft);
    setRelayError(result.error);
    if (!result.error) { setNostrRelays(result.list); setRelayDraft(''); }
  };
  const handleRestoreRelays = () => {
    if (!window.confirm('Reset your relay list to the app defaults?')) return;
    setNostrRelays([...DEFAULT_RELAYS]);
    setRelayError(null);
  };
  // Network subpage (P2) — NIP-65 import/publish.
  const [relaySyncBusy, setRelaySyncBusy] = useState<'idle' | 'import' | 'publish'>('idle');
  const [relaySyncMsg, setRelaySyncMsg] = useState<string | null>(null);
  const handleImportRelays = async () => {
    if (!window.confirm('Replace your local relay list with the one from your Nostr (NIP-65) profile?')) return;
    setRelaySyncBusy('import'); setRelaySyncMsg(null); setRelayError(null);
    try {
      const r = await importRelaysFromNip65();
      if (r.found && !r.empty) setRelaySyncMsg(`Imported ${r.count} relay${r.count === 1 ? '' : 's'} from your Nostr list.`);
      else if (r.found) setRelaySyncMsg('Your Nostr relay list is empty — keeping your current relays.');
      else setRelaySyncMsg('No relay list found on your Nostr profile — keeping your current relays.');
    } finally { setRelaySyncBusy('idle'); }
  };
  const handlePublishRelays = async () => {
    setRelaySyncBusy('publish'); setRelaySyncMsg(null);
    try {
      const ok = await publishRelayListToNip65();
      setRelaySyncMsg(ok ? 'Published your relay list to Nostr.' : 'Publish failed — try again.');
    } finally { setRelaySyncBusy('idle'); }
  };

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

  // Don't strand the user on the Coinbase Loan subpage if the loan is turned off (via the menu-row toggle) while there.
  useEffect(() => {
    if (settingsPage === 'cbloan' && !hasCbLoan) setSettingsPage('menu');
  }, [settingsPage, hasCbLoan]);

  const nostrAuthEnabled    = useStore((s) => s.nostrAuthEnabled);
  const nostrPubkey         = useStore((s) => s.nostrPubkey);
  const nostrSyncing        = useStore((s) => s.nostrSyncing);
  const { triggerSync }     = useNostrSync();
  const { nostr }           = useNostr();   // for the escape-hatch reset & re-sync
  const { rate: morphoRate, loading: morphoLoading } = useMorphoRate();   // live cbBTC/USDC Base rate — reference only
  const nostrSigningMethod  = useStore((s) => s.nostrSigningMethod);
  const setNostrAuthEnabled = useStore((s) => s.setNostrAuthEnabled);
  const viewerNpub          = useStore((s) => s.viewerNpub);
  const viewerLabel         = useStore((s) => s.viewerLabel);
  const setViewerNpub       = useStore((s) => s.setViewerNpub);
  const setViewerPubkey     = useStore((s) => s.setViewerPubkey);
  const setViewerLabel      = useStore((s) => s.setViewerLabel);

  const income      = useStore((s) => s.income);       const setIncome      = useStore((s) => s.setIncome);
  const expenses    = useStore((s) => s.expenses);     const setExpenses    = useStore((s) => s.setExpenses);
  const creditLine  = useStore((s) => s.creditLine);   const setCreditLine  = useStore((s) => s.setCreditLine);
  const blocApr     = useStore((s) => s.blocApr);      const setBlocApr     = useStore((s) => s.setBlocApr);

  const advisorActualBlocBalance    = useStore((s) => s.advisorActualBlocBalance);
  const setAdvisorActualBlocBalance = useStore((s) => s.setAdvisorActualBlocBalance);
  const advisorMonthStartBalance    = useStore((s) => s.advisorMonthStartBalance);
  const setAdvisorMonthStartBalance = useStore((s) => s.setAdvisorMonthStartBalance);
  const currentBtcHeld              = useStore((s) => s.getCurrentBtcHeld());
  const advisorActualBtcHeld        = useStore((s) => s.advisorActualBtcHeld);  // read-only month-0 baseline
  const adjustCurrentCollateral     = useStore((s) => s.adjustCurrentCollateral);
  const pendingCollateralAdjustment = useStore((s) => s.pendingCollateralAdjustment);
  const strikeBtcAvailable          = useStore((s) => s.strikeBtcAvailable);
  const strikeApiConnected          = useStore((s) => s.strikeApiConnected);
  // Reality edit — commit on blur only (NumberInput fires onChange per keystroke; the draft keeps
  // pending from churning while typing). Edits record a dated adjustment, never touch the baseline.
  const [btcHeldDraft, setBtcHeldDraft] = useState<number | null>(null);
  const [viewerDraft, setViewerDraft]   = useState('');
  const [viewerLabelDraft, setViewerLabelDraft] = useState('');
  const [viewerError, setViewerError]   = useState<string | null>(null);
  const [npubCopied, setNpubCopied]     = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryMsg, setRecoveryMsg]   = useState<string | null>(null);

  const handleResetAndResync = async () => {
    if (!window.confirm('This clears local data on this device and reloads it from the relays. Your Nostr key and relay data are safe. Any local changes not yet synced will be lost. Continue?')) return;
    setRecoveryBusy(true);
    setRecoveryMsg(null);
    try {
      const result = await resetAndResync(nostr);
      // No reload: resetAndResync already pulled the relay data into the in-memory store, so the reactive
      // useStore selectors rehydrate the UI in place. Reloading would discard it + bounce through the auth gate.
      if (result === 'ok') { setRecoveryMsg('Local data reset and re-synced from the relays.'); return; }
      if (result === 'no-relays') {
        setRecoveryMsg("Couldn't reach the relays. Your data is safe — local was reset but nothing was published. Check your connection and try again.");
      } else {
        setRecoveryMsg("Couldn't unlock your key — re-enter your login to continue.");
      }
    } catch {
      setRecoveryMsg('Reset failed — please try again.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  // 3a.5: user-facing decrypt-back opt-out (turn OFF at-rest encryption). Safe order — decrypt + VERIFY-before-
  // overwrite FIRST (plaintext written to disk), THEN clear the flag, THEN reload. A failed decrypt short-circuits
  // before the flag is touched → encryption stays on, blob untouched, nothing lost.
  const [decryptBusy, setDecryptBusy] = useState(false);
  const [decryptMsg, setDecryptMsg]   = useState<string | null>(null);
  // Show ONLY when there's an encrypted blob AND the key is in memory (post-unlock) — a plaintext or locked user
  // never sees it (a locked user has no key to decrypt with anyway).
  const showDecryptBack = !blobIsPlaintext() && isStoreUnlocked() &&
    (() => { try { return localStorage.getItem('personal-bloc-store') != null; } catch { return false; } })();
  const handleDecryptBack = async () => {
    setDecryptBusy(true);
    setDecryptMsg(null);
    try {
      const ok = await migrateEncryptedToPlaintext();
      if (!ok) {
        setDecryptMsg('Could not decrypt — encryption left on, your data is unchanged. Try again after unlocking.');
        setDecryptBusy(false);
        return;
      }
      try { localStorage.removeItem('personal-bloc-store-enc-enabled'); } catch { /* noop */ }
      setDecryptMsg('Encryption turned off. Reloading…');
      setTimeout(() => window.location.reload(), 600);
    } catch {
      setDecryptMsg('Could not decrypt — encryption left on, your data is unchanged.');
      setDecryptBusy(false);
    }
  };
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
      {settingsPage === 'menu' && (
        <>
          {!hideHeader && (
            <div className={styles.header}>
              <button className={styles.backBtn} onClick={() => setActiveTab(previousTab)}>
                ← Back
              </button>
              <h2 className={styles.title}>Settings</h2>
            </div>
          )}

          {viewerMode && (
            <p className={styles.sectionDescription}>
              You're viewing a shared plan, read-only. Manage your viewing key from the banner.
            </p>
          )}

          <div className={styles.settingsMenu}>
            {!viewerMode && <SettingsRow icon="🔑" title="Identity & Security" subtitle="Nostr login, sync, recovery" onClick={() => setSettingsPage('identity')} styles={styles} />}
            {!viewerMode && <SettingsRow icon="👁" title="Sharing" subtitle="Give someone read-only viewer access" onClick={() => setSettingsPage('sharing')} styles={styles} />}
            {!viewerMode && <SettingsRow icon="⚡" title="Strike Strategy" subtitle="Budget, BLOC, collateral, start date" onClick={() => setSettingsPage('strike')} styles={styles} />}
            {!viewerMode && (
              <div
                className={`${styles.settingsRow} ${!hasCbLoan ? styles.settingsRowDisabled : ''}`}
                role={hasCbLoan ? 'button' : undefined}
                tabIndex={hasCbLoan ? 0 : undefined}
                onClick={hasCbLoan ? () => setSettingsPage('cbloan') : undefined}
                onKeyDown={hasCbLoan ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSettingsPage('cbloan'); } } : undefined}
              >
                <span className={styles.settingsRowIcon}>🏦</span>
                <div className={styles.settingsRowBody}>
                  <span className={styles.settingsRowTitle}>Coinbase Loan</span>
                  <span className={styles.settingsRowSubtitle}>{hasCbLoan ? 'Balance, collateral, APR, payment strategy' : 'Turn on if you have a Coinbase/Morpho loan'}</span>
                </div>
                {/* the toggle is the only interactive element when the loan is off; stopPropagation so toggling never navigates */}
                <span className={styles.settingsRowToggle} onClick={(e) => e.stopPropagation()}>
                  <Toggle value={hasCbLoan} onChange={setHasCbLoan} />
                </span>
                {hasCbLoan && <span className={styles.settingsRowChevron}>›</span>}
              </div>
            )}
            <SettingsRow icon="🖥️" title="Display" subtitle="Simple Mode, plan bars, mining log" onClick={() => setSettingsPage('display')} styles={styles} />
            {!viewerMode && <SettingsRow icon="🗂️" title="Tabs" subtitle="Visibility & order" onClick={() => setSettingsPage('tabs')} styles={styles} />}
            {!viewerMode && <SettingsRow icon="🌐" title="Network" subtitle="Relays & connections" onClick={() => setSettingsPage('network')} styles={styles} />}
            <SettingsRow icon="ℹ️" title="About" subtitle="Build info" onClick={() => setSettingsPage('about')} styles={styles} />
          </div>
        </>
      )}

      {settingsPage !== 'menu' && (
        <div className={styles.subHeader}>
          <button className={styles.subBackBtn} onClick={() => setSettingsPage('menu')}>← Settings</button>
          <h2 className={styles.subTitle}>{SUBPAGE_TITLES[settingsPage]}</h2>
        </div>
      )}

      {settingsPage === 'display' && (
        <div className={styles.simpleModeToggle}>
          <div className={styles.simpleModeLabel}>
            <span className={styles.simpleModeTitle}>Simple Mode</span>
            <span className={styles.simpleModeDesc}>
              Shows only your monthly plan — hides all charts and details
            </span>
          </div>
          <Toggle value={simpleMode} onChange={setSimpleMode} />
        </div>
      )}

      {settingsPage === 'identity' && !viewerMode && (
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
          <>
          <div className={styles.nostrIdentityRow}>
            <span className={styles.nostrPubkey}>
              {nostrPubkey.slice(0, 8)}…{nostrPubkey.slice(-8)}
            </span>
            <span className={styles.nostrBadge}>{nostrSigningMethod === 'nip07' ? 'NIP-07' : nostrSigningMethod === 'local' ? 'Local · Face ID' : 'NIP-46'}</span>
            <button
              className={styles.nostrReconnectBtn}
              onClick={() => {
                try {
                  const npub = nip19.npubEncode(nostrPubkey);
                  navigator.clipboard?.writeText(npub);
                  setNpubCopied(true);
                  setTimeout(() => setNpubCopied(false), 1500);
                } catch { /* nostrPubkey not valid hex — no-op */ }
              }}
            >
              {npubCopied ? 'Copied ✓' : 'Copy npub'}
            </button>
            {nostrSigningMethod !== 'local' && (
              <button
                className={styles.nostrReconnectBtn}
                onClick={() => reconnectNostr()}
              >
                Reconnect
              </button>
            )}
            {nostrSigningMethod === 'local' ? (
              <button
                className={styles.nostrDisconnectBtn}
                onClick={() => {
                  if (!window.confirm('Remove the encrypted key from this device? Make sure your nsec is backed up — you’ll need it to log in again.')) return;
                  const s = useStore.getState();
                  s.setWriterKeyWrapped(null);
                  s.setWriterKeyWrapMeta(null);
                  s.setNostrSigningMethod(null);
                  s.setNostrPubkey(null);
                  s.setNostrSigner(null);
                  s.setIsAuthenticated(false);
                  window.location.reload();
                }}
              >
                Remove local key
              </button>
            ) : (
              <button
                className={styles.nostrDisconnectBtn}
                onClick={() => disconnectNostr()}
              >
                Disconnect
              </button>
            )}
          </div>
          <span className={styles.cbLoanToggleDesc}>Share your npub to give someone read-only viewer access.</span>
          </>
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

        {nostrAuthEnabled && nostrPubkey && !viewerMode && (
          <>
            <button
              onClick={handleResetAndResync}
              disabled={recoveryBusy}
              className={styles.nostrReconnectBtn}
            >
              {recoveryBusy ? 'Resetting…' : 'Reset local data & re-sync from relays'}
            </button>
            {recoveryMsg && <p className={styles.nostrWarning}>{recoveryMsg}</p>}
            {showDecryptBack && (
              <>
                <button
                  onClick={handleDecryptBack}
                  disabled={decryptBusy}
                  className={styles.nostrReconnectBtn}
                >
                  {decryptBusy ? 'Decrypting…' : 'Turn off at-rest encryption (decrypt local data)'}
                </button>
                {decryptMsg && <p className={styles.nostrWarning}>{decryptMsg}</p>}
              </>
            )}
          </>
        )}

        {nostrAuthEnabled && !nostrPubkey && (
          <p className={styles.nostrWarning}>
            ⚠ Back up your nsec — losing it means permanent loss of encrypted relay data.
          </p>
        )}
      </div>
      )}

      {settingsPage === 'sharing' && !viewerMode && (
      <div className={styles.section}>
        {nostrPubkey ? (
          <div className={styles.viewerAccessBlock}>
            <div className={styles.cbLoanToggleTitle}>VIEWER ACCESS</div>
            <p className={styles.cbLoanToggleDesc}>
              Shares a continuously-updated, read-only copy of your full model and live Strike balances with this
              person. They can see everything but can never change your inputs. Remove anytime to stop sharing
              future updates.
            </p>
            {viewerNpub ? (
              <div className={styles.nostrIdentityRow}>
                {viewerLabel
                  ? <span className={styles.nostrPubkey}>{viewerLabel}{' '}
                      <span style={{ color: 'var(--text-ghost)', fontWeight: 400 }}>({viewerNpub.slice(0, 12)}…{viewerNpub.slice(-6)})</span>
                    </span>
                  : <span className={styles.nostrPubkey}>{viewerNpub.slice(0, 12)}…{viewerNpub.slice(-6)}</span>}
                <button
                  className={styles.nostrDisconnectBtn}
                  onClick={() => {
                    void publishViewerRevocationNow();   // seal the tombstone to the viewer WHILE viewerPubkey is still set
                    setViewerNpub(null); setViewerPubkey(null); setViewerLabel(null);
                    setViewerDraft(''); setViewerLabelDraft(''); setViewerError(null);
                  }}
                >
                  Revoke
                </button>
              </div>
            ) : (
              <>
                <input
                  className={styles.setupDateInput}
                  type="text"
                  placeholder="Nickname (e.g. Dad's iPhone)"
                  value={viewerLabelDraft}
                  onChange={(e) => setViewerLabelDraft(e.target.value)}
                />
                <input
                  className={styles.setupDateInput}
                  type="text"
                  placeholder="npub1…"
                  value={viewerDraft}
                  onChange={(e) => { setViewerDraft(e.target.value); setViewerError(null); }}
                />
                <button
                  className={styles.nostrReconnectBtn}
                  onClick={() => {
                    const input = viewerDraft.trim();
                    try {
                      const decoded = nip19.decode(input);
                      if (decoded.type !== 'npub') { setViewerError('Not a valid npub'); return; }
                      setViewerNpub(input);
                      setViewerPubkey(decoded.data as string);
                      const label = viewerLabelDraft.trim();
                      if (label) setViewerLabel(label);
                      setViewerError(null);
                      void publishViewerSnapshotNow();   // seal + publish a snapshot NOW so the viewer hydrates without waiting for an owner edit
                    } catch { setViewerError('Not a valid npub'); }
                  }}
                >
                  Save
                </button>
              </>
            )}
            {viewerError && <p className={styles.nostrWarning}>{viewerError}</p>}
          </div>
        ) : (
          <p className={styles.sectionDescription}>Connect a Nostr identity first to share viewer access.</p>
        )}
      </div>
      )}

      {settingsPage === 'strike' && !viewerMode && (
      <div className={styles.section}>
        <div className={styles.setupGroup}>
          <div className={styles.setupGroupLabel}>BUDGET</div>
          <NumberInput label="Monthly income"   value={income}   onChange={setIncome}   prefix="$" min={0} step={100} />
          <NumberInput label="Monthly expenses" value={expenses} onChange={setExpenses} prefix="$" min={0} step={100} />
        </div>

        <div className={styles.setupGroup}>
          <div className={styles.setupGroupLabel}>STRIKE BLOC</div>
          <div className={styles.strikeStatusRow}>
            <span className={strikeApiConnected ? styles.strikeStatusDotOn : styles.strikeStatusDotOff} />
            <span className={styles.strikeStatusLabel}>
              Strike API · {strikeApiConnected ? 'Connected' : 'Not connected'}
            </span>
          </div>
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
            <NumberInput label="Balance at start of this month" value={advisorMonthStartBalance} onChange={setAdvisorMonthStartBalance} prefix="$" min={0} step={100} />
            <span className={styles.fieldHint}>What you owed on Strike at the start of the current month — the base for this month's projection.</span>
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
      </div>
      )}

      {settingsPage === 'display' && !viewerMode && (
      <div className={styles.section}>
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
      </div>
      )}

      {settingsPage === 'cbloan' && !viewerMode && (
      <div className={styles.section}>
        <div className={styles.setupGroup}>
          <div className={styles.setupGroupLabel}>COINBASE LOAN</div>
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
      )}

      {settingsPage === 'tabs' && !viewerMode && (
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
      )}

      {settingsPage === 'network' && !viewerMode && (
      <div className={styles.section}>
        <div className={styles.setupGroup}>
          <div className={styles.setupGroupLabel}>YOUR RELAYS</div>
          {nostrRelays.length === 0 && <span className={styles.fieldHint}>No relays configured.</span>}
          {nostrRelays.map((url) => (
            <div key={url} className={styles.relayRow}>
              {/* P1: neutral placeholder dot — live connection status is P3 */}
              <span className={styles.strikeStatusDotOff} />
              <span className={styles.relayUrl}>{url}</span>
              <button
                className={styles.relayRemove}
                onClick={() => setNostrRelays(nostrRelays.filter((r) => r !== url))}
                aria-label={`Remove ${url}`}
                title="Remove relay"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className={styles.setupGroup}>
          <div className={styles.setupGroupLabel}>ADD RELAY</div>
          <div className={styles.relayAddRow}>
            <input
              className={styles.setupDateInput}
              style={{ flex: 1, minWidth: 0 }}
              type="text"
              placeholder="wss://relay.example.com"
              value={relayDraft}
              onChange={(e) => { setRelayDraft(e.target.value); setRelayError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddRelay(); }}
            />
            <button className={styles.nostrReconnectBtn} onClick={handleAddRelay} disabled={!relayDraft.trim()}>
              Add
            </button>
          </div>
          {relayError && <span className={styles.fieldHint} style={{ color: 'var(--amber)' }}>{relayError}</span>}
        </div>

        <div className={styles.setupGroup}>
          <div className={styles.setupGroupLabel}>SYNC</div>
          <button className={styles.nostrReconnectBtn} onClick={handleImportRelays} disabled={relaySyncBusy !== 'idle'}>
            {relaySyncBusy === 'import' ? 'Importing…' : 'Import from Nostr'}
          </button>
          <button className={styles.nostrReconnectBtn} onClick={handlePublishRelays} disabled={relaySyncBusy !== 'idle'}>
            {relaySyncBusy === 'publish' ? 'Publishing…' : 'Publish to Nostr'}
          </button>
          {relaySyncMsg && <span className={styles.fieldHint}>{relaySyncMsg}</span>}
          <button className={styles.nostrDisconnectBtn} onClick={handleRestoreRelays}>Restore defaults</button>
        </div>
      </div>
      )}

      {settingsPage === 'about' && (
        <div className={styles.section}>
          <p className={styles.buildInfo} onClick={handleBuildTap}>
            Build {__BUILD_SHA__} · {new Date(__BUILD_TIME__).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
          {devMode && <DevPanel />}
        </div>
      )}
    </div>
  );
}
