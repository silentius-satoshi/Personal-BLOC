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
import { useStore, importRelaysFromNip65, publishRelayListToNip65 } from '../../store/useStore';
import { DevPanel } from './DevPanel';
import { SharingPage } from './SharingPage';
import { ViewerSettings } from './ViewerSettings';
import { NostrAuthGate } from '../Auth/NostrAuthGate';
import { ViewerLoginFlow } from '../Auth/ViewerLoginFlow';
import { RevealRecoveryKey } from './RevealRecoveryKey';
import { RecoveryKeyCeremony } from './RecoveryKeyCeremony';
import { BackupGateInterstitial } from './BackupGateInterstitial';
import { isBackupGateSatisfied } from '../../lib/backupGate';
import { downloadPlanBackup } from '../../lib/backup/exportPlan';
import { useNostrSync } from '../../hooks/useNostrSync';
import { useNostr } from '@nostrify/react';
import { resetAndResync } from '../../lib/store/escapeHatch';
import { migrateEncryptedToPlaintext, blobIsPlaintext } from '../../lib/store/storeMigration';
import { isStoreUnlocked, clearStoreEncryptionState } from '../../lib/store/storeCrypto';
import { useMorphoRate } from '../../hooks/useMorphoRate';
import { useRelayStatus } from '../../hooks/useRelayStatus';
import { Toggle } from '../ui/Toggle';
import { NumberInput } from '../ui/NumberInput';
import { CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { disconnectNostr, reconnectNostr } from '../../lib/nostr/disconnect';
import { DEFAULT_RELAYS, addRelay } from '../../lib/nostr/relays';
import { nip19 } from 'nostr-tools';
import { STRIKE_MAX_DRAW_LTV } from '../../simulation/strikeCredit';
import { fmtUSD, todayLocalISO } from '../../utils/format';
import styles from './SettingsMain.module.css';

// Stable empty-array identity so useRelayStatus opens NO probe sockets unless the Network subpage is actually visible
// (passing a fresh [] each render would re-key the effect; this keeps the join('') dep stable).
const EMPTY_RELAYS: string[] = [];

// Relative-time for the SYNC rows — mirrors ViewerHomeView's relativeAge m/h/d convention, but "never" when
// unsynced and no "updated" prefix (the row already reads "Settings synced · …").
// ts is unix SECONDS — matches event.created_at stored by sync.ts; store units must not change (the
// watermark gate in sync.ts compares in seconds too).
function relativeSync(ts: number | null): string {
  if (!ts) return 'never';
  const mins = Math.floor((Date.now() / 1000 - ts) / 60);
  if (mins <= 0) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

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
type SettingsPage = 'menu' | 'identity' | 'sharing' | 'strike' | 'cbloan' | 'display' | 'tabs' | 'network' | 'about' | 'backup';

const SUBPAGE_TITLES: Record<Exclude<SettingsPage, 'menu'>, string> = {
  identity: 'Identity & Security',
  sharing:  'Sharing',
  strike:   'Strike Strategy',
  cbloan:   'Coinbase Loan',
  display:  'Display',
  tabs:     'Tabs',
  network:  'Network',
  about:    'About',
  backup:   'Backup',
};

interface SettingsRowProps {
  icon:      string;
  title:     string;
  subtitle?: string;
  onClick:   () => void;
  styles:    Record<string, string>;
  /** R2c-5 — amber dot on the row icon (the backup breadcrumb). Additive: default false → every other row is
   *  byte-identical. Decorative (aria-hidden); the row title is the accessible name. */
  alert?:    boolean;
}

function SettingsRow({ icon, title, subtitle, onClick, styles, alert = false }: SettingsRowProps) {
  return (
    <div
      className={styles.settingsRow}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <span className={styles.settingsRowIcon}>
        {icon}
        {alert && <span className={styles.rowBadgeDot} aria-hidden="true" />}
      </span>
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
  /**
   * P3.1 nested back-chain: SettingsMain reports a one-level-back handler to its host so an edge-swipe-back can
   * mirror the visible ← Back. Called with `() => setSettingsPage('menu')` while a subpage is open, `null` on
   * the main list (and on cleanup). The host (AppShell Branch H) chains: subpage-back first, else exit Settings.
   */
  registerBack?: (fn: (() => void) | null) => void;
}

export function SettingsMain({ hideHeader = false, registerBack }: SettingsMainProps) {
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
  // Access Layer Redesign Phase 1 — the persistent front-door flows (each renders its own overlay).
  const [accessFlow, setAccessFlow] = useState<null | 'login' | 'viewer'>(null);
  // R2c-1 — the backup ceremony (own overlay; NOT a subpage — a guided reveal+quiz must own the screen).
  const [ceremonyOpen, setCeremonyOpen] = useState(false);
  const backupVerifiedAt = useStore((s) => s.backupVerifiedAt);   // for the "Backed up ✓" chip on the entry row
  // R2c-2 ladder rung 3 — Sharing/Network are the hard-gate pages (a generated-unverified key can't publish).
  const keyProvenance = useStore((s) => s.keyProvenance);
  const backupGated   = !isBackupGateSatisfied({ keyProvenance, backupVerifiedAt });

  // Network subpage (P1) — local relay list management.
  const nostrRelays    = useStore((s) => s.nostrRelays);
  const setNostrRelaysAndSync = useStore((s) => s.setNostrRelaysAndSync);   // user-edit path: set + mark dirty → publishes on its own
  const [relayDraft, setRelayDraft] = useState('');
  const [relayError, setRelayError] = useState<string | null>(null);
  const handleAddRelay = () => {
    const result = addRelay(nostrRelays, relayDraft);
    setRelayError(result.error);
    if (!result.error) { setNostrRelaysAndSync(result.list); setRelayDraft(''); }
  };
  const handleRestoreRelays = () => {
    if (!window.confirm('Reset your relay list to the app defaults?')) return;
    setNostrRelaysAndSync([...DEFAULT_RELAYS]);
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
  // P3: live per-relay status dots. Unconditional call (rules of hooks), but probe sockets open ONLY while the
  // Network subpage is visible (EMPTY_RELAYS otherwise → no sockets). See useRelayStatus for the owned-probe model.
  const relayStatus = useRelayStatus(settingsPage === 'network' && !backupGated ? nostrRelays : EMPTY_RELAYS);   // no probe sockets behind the interstitial

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

  // P3.1 nested back-chain — report a one-level-back handler while a subpage is open (null on the list). Placed
  // BEFORE the viewerMode early-return so it runs on both paths (viewer stays 'menu' → always null; ViewerSettings
  // is flat). Host edge-back mirrors the visible ← Settings.
  useEffect(() => {
    registerBack?.(settingsPage === 'menu' ? null : () => setSettingsPage('menu'));
    return () => registerBack?.(null);
  }, [settingsPage, registerBack]);

  const nostrPubkey         = useStore((s) => s.nostrPubkey);
  const nostrSyncing        = useStore((s) => s.nostrSyncing);
  const { triggerSync }     = useNostrSync();
  const { nostr }           = useNostr();   // for the escape-hatch reset & re-sync
  const { rate: morphoRate, loading: morphoLoading } = useMorphoRate();   // live cbBTC/USDC Base rate — reference only
  const nostrSigningMethod  = useStore((s) => s.nostrSigningMethod);
  const isAuthenticated     = useStore((s) => s.isAuthenticated);
  const nostrReconnectNeeded = useStore((s) => s.nostrReconnectNeeded);
  const lastSettingsSyncAt  = useStore((s) => s.lastSettingsSyncAt);
  const lastRecordsSyncAt   = useStore((s) => s.lastRecordsSyncAt);
  // Viewer/sharing config now lives in <SharingPage/> (extracted). Only npubCopied stays here (the
  // Identity page's tap-to-copy also uses it).

  const income      = useStore((s) => s.income);       const setIncome      = useStore((s) => s.setIncome);
  const expenses    = useStore((s) => s.expenses);     const setExpenses    = useStore((s) => s.setExpenses);
  const creditLine  = useStore((s) => s.creditLine);   const setCreditLine  = useStore((s) => s.setCreditLine);
  const blocApr     = useStore((s) => s.blocApr);      const setBlocApr     = useStore((s) => s.setBlocApr);
  const blocMinPaymentSource    = useStore((s) => s.blocMinPaymentSource);
  const setBlocMinPaymentSource = useStore((s) => s.setBlocMinPaymentSource);
  const blocStatementMinimum    = useStore((s) => s.blocStatementMinimum);
  const setBlocStatementMinimum = useStore((s) => s.setBlocStatementMinimum);
  const blocMinPaymentDueDay    = useStore((s) => s.blocMinPaymentDueDay);
  const setBlocMinPaymentDueDay = useStore((s) => s.setBlocMinPaymentDueDay);

  const advisorActualBlocBalance    = useStore((s) => s.advisorActualBlocBalance);
  const setAdvisorActualBlocBalance = useStore((s) => s.setAdvisorActualBlocBalance);
  const advisorMonthStartBalance    = useStore((s) => s.advisorMonthStartBalance);
  const setAdvisorMonthStartBalance = useStore((s) => s.setAdvisorMonthStartBalance);
  const currentBtcHeld              = useStore((s) => s.getCurrentBtcHeld());
  const advisorActualBtcHeld        = useStore((s) => s.advisorActualBtcHeld);  // read-only month-0 baseline
  const emitBalanceReading          = useStore((s) => s.emitBalanceReading);
  const strikeBtcAvailable          = useStore((s) => s.strikeBtcAvailable);
  const strikeApiConnected          = useStore((s) => s.strikeApiConnected);
  // Reality edit — commit on blur; v20: emits a journaled balanceReading carrying strikeCollateral → re-anchors current.
  const [btcHeldDraft, setBtcHeldDraft] = useState<number | null>(null);
  const [npubCopied, setNpubCopied]     = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryMsg, setRecoveryMsg]   = useState<string | null>(null);

  const handleResetAndResync = () => {
    if (!window.confirm('This clears local data on this device and reloads it from the relays. Your Nostr key and relay data are safe. Any local changes not yet synced will be lost. Continue?')) return;
    setRecoveryBusy(true);
    setRecoveryMsg(null);
    resetAndResync(nostr);   // reload-based: clears encryption state + reloads; the normal boot unlock → syncNow repopulates from the relay
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
  const almanacLiveEnabled          = useStore((s) => s.almanacLiveEnabled);
  const setAlmanacLiveEnabled       = useStore((s) => s.setAlmanacLiveEnabled);
  const setAlmanacLiveConsented     = useStore((s) => s.setAlmanacLiveConsented);

  const cbLoanBalance         = useStore((s) => s.cbLoanBalance);         const setCbLoanBalance         = useStore((s) => s.setCbLoanBalance);
  const cbCollateralBtc       = useStore((s) => s.cbCollateralBtc);       const setCbCollateralBtc       = useStore((s) => s.setCbCollateralBtc);
  const cbAprPct              = useStore((s) => s.cbAprPct);              const setCbAprPct              = useStore((s) => s.setCbAprPct);
  const cbMonthlyPayment      = useStore((s) => s.cbMonthlyPayment);      const setCbMonthlyPayment      = useStore((s) => s.setCbMonthlyPayment);
  const cbLiquidationPrice    = useStore((s) => s.cbLiquidationPrice);    const setCbLiquidationPrice    = useStore((s) => s.setCbLiquidationPrice);
  const cbPaymentStrategy     = useStore((s) => s.cbPaymentStrategy);     const setCbPaymentStrategy     = useStore((s) => s.setCbPaymentStrategy);
  const cbLtvTriggerPct       = useStore((s) => s.cbLtvTriggerPct);       const setCbLtvTriggerPct       = useStore((s) => s.setCbLtvTriggerPct);
  const cbLtvTargetPct        = useStore((s) => s.cbLtvTargetPct);        const setCbLtvTargetPct        = useStore((s) => s.setCbLtvTargetPct);
  const cbRotateBackPct       = useStore((s) => s.cbRotateBackPct);       const setCbRotateBackPct       = useStore((s) => s.setCbRotateBackPct);
  const cbEmergencyCeilingPct = useStore((s) => s.cbEmergencyCeilingPct); const setCbEmergencyCeilingPct = useStore((s) => s.setCbEmergencyCeilingPct);
  const cbLtvAction           = useStore((s) => s.cbLtvAction);           const setCbLtvAction           = useStore((s) => s.setCbLtvAction);

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

  // Viewer V4 — a viewer gets the purpose-built FLAT settings screen, NOT the owner menu/subpages
  // (a viewer never reaches accessFlow — those rows are !viewerMode). AppShell mounts this as
  // <SettingsMain hideHeader/> inside .simpleModeSettings, which supplies the ← Back header.
  if (viewerMode) {
    return (
      <div className={styles.main}>
        {!hideHeader && (
          <div className={styles.header}>
            <button className={styles.backBtn} onClick={() => setActiveTab(previousTab)}>← Back</button>
            <h2 className={styles.title}>Settings</h2>
          </div>
        )}
        <ViewerSettings />
      </div>
    );
  }

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
            {/* Access Layer Redesign Phase 1 — persistent front-door doors (the lockout fix). Top of menu,
                no drill-down, so they're found the moment Settings opens. Owner-only (a viewer's exit is V4). */}
            {!viewerMode && <div className={styles.settingsGroupLabel}>ACCESS</div>}
            {/* Phase 2: hide the "sign in" door once authed — Identity & Security is the connected-identity home
                (a duplicate sign-in row over-promises). Serves pre-1.5 local-owner-not-authed + post-key-removal. */}
            {!viewerMode && !isAuthenticated && <SettingsRow icon="🔑" title="Connect Nostr identity" subtitle="Sign in to sync this plan across devices" onClick={() => setAccessFlow('login')} styles={styles} />}
            {!viewerMode && <SettingsRow icon="👁" title="Connect to a shared plan" subtitle="Switch this device to viewing someone's plan" onClick={() => { if (window.confirm('This switches this device to viewing someone else’s plan and clears your current plan. Continue?')) setAccessFlow('viewer'); }} styles={styles} />}
            {/* R2c-5 breadcrumb rung 2 — reuses the `backupGated` already computed above (never recomputed).
                ⚠ The `nostrSigningMethod === 'local'` term keeps the breadcrumb from pointing at a page with no
                ceremony: the "Save your Recovery Key" button + RevealRecoveryKey render ONLY for a local signer,
                so on a NIP-07/NIP-46 signer the Identity page has nothing to reach. Today this is a NO-OP —
                a 'generated' key is always minted locally by OwnerKeySetup (which sets method 'local'), and
                disconnectNostr clears provenance, so backupGated ⇒ local. It is DEFENSIVE, not a live fix:
                it makes the "generated key on an external signer" state (which shouldn't exist) render
                correctly rather than misleadingly. Don't delete it as dead code. */}
            {!viewerMode && <SettingsRow icon="🔑" title="Identity & Security" subtitle="Nostr login, sync, recovery" onClick={() => setSettingsPage('identity')} styles={styles} alert={backupGated && nostrSigningMethod === 'local'} />}
            {!viewerMode && <SettingsRow icon="💾" title="Backup" subtitle="Download a copy of your plan" onClick={() => setSettingsPage('backup')} styles={styles} />}
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
            <SettingsRow icon="🖥️" title="Display" subtitle="Monthly Mode, plan bars, mining log" onClick={() => setSettingsPage('display')} styles={styles} />
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
            <span className={styles.simpleModeTitle}>Monthly Mode</span>
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

        {nostrPubkey ? (
          <>
          {/* IDENTITY CARD (hero) — npub · method chip · connection status */}
          <div className={styles.identityCard}>
            <div className={styles.identityRing}>₿</div>
            <div className={styles.identityCardBody}>
              <button
                className={styles.identityNpub}
                onClick={() => {
                  try {
                    const npub = nip19.npubEncode(nostrPubkey);
                    navigator.clipboard?.writeText(npub);
                    setNpubCopied(true);
                    setTimeout(() => setNpubCopied(false), 1500);
                  } catch { /* nostrPubkey not valid hex — no-op */ }
                }}
              >
                <span className={styles.identityNpubText}>
                  {(() => { try { const n = nip19.npubEncode(nostrPubkey); return `${n.slice(0, 14)}…${n.slice(-6)}`; } catch { return `${nostrPubkey.slice(0, 8)}…${nostrPubkey.slice(-8)}`; } })()}
                </span>
                <span className={styles.identityCopyHint}>{npubCopied ? 'Copied ✓' : 'tap to copy'}</span>
              </button>
              <div className={styles.identityMeta}>
                <span className={styles.identityChip}>
                  {nostrSigningMethod === 'local' ? 'Face ID · local key' : nostrSigningMethod === 'nip07' ? 'Extension (NIP-07)' : 'Remote signer (NIP-46)'}
                </span>
                <span className={styles.identityStatus}>
                  <span className={nostrReconnectNeeded ? styles.identityDotWarn : styles.identityDotOn} />
                  {nostrReconnectNeeded ? 'Reconnect needed' : 'Connected'}
                </span>
              </div>
            </div>
          </div>

          {/* SYNC */}
          <div className={styles.settingsGroupLabel}>SYNC</div>
          <div className={styles.syncRow}><span className={styles.syncRowLabel}>Settings synced</span><span className={styles.syncRowValue}>{relativeSync(lastSettingsSyncAt)}</span></div>
          <div className={styles.syncRow}><span className={styles.syncRowLabel}>Records synced</span><span className={styles.syncRowValue}>{relativeSync(lastRecordsSyncAt)}</span></div>
          <button onClick={triggerSync} disabled={nostrSyncing} className={styles.syncButton}>
            {nostrSyncing ? 'Syncing…' : '↻ Sync now'}
          </button>

          {/* THIS DEVICE — one exit row per method (local: Remove local key · nip07/46: Disconnect) */}
          <div className={styles.settingsGroupLabel}>THIS DEVICE</div>
          <div className={styles.syncRow}>
            <span className={styles.syncRowLabel}>Signing method</span>
            <span className={styles.syncRowValue}>{nostrSigningMethod === 'local' ? 'Face ID · local key' : nostrSigningMethod === 'nip07' ? 'Extension (NIP-07)' : 'Remote signer (NIP-46)'}</span>
          </div>
          {nostrSigningMethod !== 'local' && nostrReconnectNeeded && (
            <button className={styles.nostrReconnectBtn} onClick={() => reconnectNostr()}>Reconnect</button>
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
                s.setKeyProvenance(null);      // R2a-1: identity teardown — provenance dies with the identity (see disconnectNostr)
                s.setBackupVerifiedAt(null);
                clearStoreEncryptionState();   // also clear the enc flag + {ct,iv} blob + key — next launch is a clean plaintext slate (no locked-out encrypted blob)
                window.location.reload();
              }}
            >
              Remove local key
            </button>
          ) : (
            <button
              className={styles.nostrDisconnectBtn}
              onClick={() => { if (window.confirm('Disconnect this identity from this device? Your plan stays on the relay.')) disconnectNostr(); }}
            >
              Disconnect
            </button>
          )}

          {/* RECOVERY — save (ceremony) · reveal key (local) · backup plan · reset & re-sync · decrypt-back (when enc on) */}
          <div className={styles.settingsGroupLabel}>RECOVERY</div>
          {/* R2c-1 — the guided backup ceremony (the primary CTA); RevealRecoveryKey below is the quiet view-only utility.
              R2c-5 breadcrumb rung 3 (the terminus): the amber dot and the "Backed up ✓" chip are MUTUALLY
              EXCLUSIVE by construction — backupGated ⇒ backupVerifiedAt == null, and the chip renders only when
              backupVerifiedAt != null. Tapping already opens the ceremony; the dot adds no wiring.
              ⚠ All three breadcrumb dots + the nag subscribe keyProvenance + backupVerifiedAt, so the ceremony's
              stamp clears every one of them reactively. No imperative cleanup anywhere. */}
          {nostrSigningMethod === 'local' && (
            <button className={styles.nostrReconnectBtn} onClick={() => setCeremonyOpen(true)}>
              {backupGated && <span className={styles.btnBadgeDot} aria-hidden="true" />}
              Save your Recovery Key{backupVerifiedAt != null && <span className={styles.backedUpChip}> · Backed up ✓ {new Date(backupVerifiedAt).toLocaleDateString()}</span>}
            </button>
          )}
          {nostrSigningMethod === 'local' && <RevealRecoveryKey />}
          <button className={styles.nostrReconnectBtn} onClick={() => setSettingsPage('backup')}>Backup plan</button>
          <button onClick={handleResetAndResync} disabled={recoveryBusy} className={styles.nostrReconnectBtn}>
            {recoveryBusy ? 'Resetting…' : 'Reset local data & re-sync from relays'}
          </button>
          {recoveryMsg && <p className={styles.nostrWarning}>{recoveryMsg}</p>}
          {showDecryptBack && (
            <>
              <button onClick={handleDecryptBack} disabled={decryptBusy} className={styles.nostrReconnectBtn}>
                {decryptBusy ? 'Decrypting…' : 'Turn off at-rest encryption (decrypt local data)'}
              </button>
              {decryptMsg && <p className={styles.nostrWarning}>{decryptMsg}</p>}
            </>
          )}

          <span className={styles.fieldHint}>Your key is encrypted at rest and never stored in plain text.</span>
          </>
        ) : (
          <span className={styles.fieldHint}>
            No identity connected on this device. Use “Connect Nostr identity” from the Settings menu to sign in.
          </span>
        )}
      </div>
      )}

      {settingsPage === 'sharing' && !viewerMode && (
      <div className={styles.section}>
        {backupGated ? <BackupGateInterstitial onBack={() => setSettingsPage('menu')} /> : <SharingPage />}
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
              if (btcHeldDraft !== null && btcHeldDraft !== currentBtcHeld) emitBalanceReading({ strikeCollateral: btcHeldDraft });
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
            <span className={styles.fieldHint}>Your current BTC in Strike. Edits log a balance reading that re-anchors your collateral — feeds Advisor projections and Liq Sim.</span>
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

          {/* §2b — MINIMUM PAYMENT group (source policy + this month's statement figure + due day) */}
          <div className={styles.setupFieldGroup}>
            <span className={styles.setupFieldLabel}>MINIMUM PAYMENT</span>
            <div className={styles.strategyPills}>
              <button
                className={`${styles.strategyPill} ${blocMinPaymentSource === 'income' ? styles.strategyPillActive : ''}`}
                onClick={() => setBlocMinPaymentSource('income')}
              >Pay from income</button>
              <button
                className={`${styles.strategyPill} ${blocMinPaymentSource === 'roll' ? styles.strategyPillActive : ''}`}
                onClick={() => setBlocMinPaymentSource('roll')}
              >Roll into line</button>
            </div>
            <span className={styles.fieldHint}>
              {blocMinPaymentSource === 'roll'
                ? 'Roll: the payment is drawn from the line and accrues interest; requires an annual non-draw payment.'
                : 'Income: paid from your paycheck — keeps the balance from compounding.'}
            </span>
            <NumberInput
              label="This month's amount"
              value={blocStatementMinimum ?? 0}
              onChange={(v) => setBlocStatementMinimum(v > 0 ? v : null)}
              prefix="$"
              min={0}
              step={1}
            />
            <span className={styles.fieldHint}>
              From your Strike monthly statement (billed the 1st){blocStatementMinimum == null ? ' — blank uses the computed estimate.' : '.'}
            </span>
            <NumberInput label="Due day" value={blocMinPaymentDueDay} onChange={setBlocMinPaymentDueDay} min={1} max={28} step={1} />
            <span className={styles.fieldHint}>Strike's default is the 15th.</span>
          </div>
          <div className={styles.setupFieldGroup}>
            <NumberInput label="Amount Drawn" value={advisorActualBlocBalance} onChange={setAdvisorActualBlocBalance} prefix="$" min={0} step={100} />
            <span className={styles.fieldHint}>Current outstanding BLOC draw balance.</span>
          </div>
          <div className={styles.setupFieldGroup}>
            <NumberInput label="Balance at start of this month" value={advisorMonthStartBalance} onChange={setAdvisorMonthStartBalance} prefix="$" min={0} step={100} />
            <span className={styles.fieldHint}>What you owed on Strike at the start of the current month — the base for this month's projection.</span>
            <span className={styles.fieldHint}>Auto-carried from each month's sign-off — edit only to correct the current month's starting balance.</span>
          </div>
          <div className={styles.setupFieldGroup}>
            <span className={styles.setupFieldLabel}>Strategy start date</span>
            <input
              type="date"
              className={styles.setupDateInput}
              value={advisorStartDate}
              max={todayLocalISO()}
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

        <div className={styles.setupGroup}>
          <div className={styles.setupGroupLabel}>ALMANAC</div>
          <div className={styles.cbLoanToggleRow}>
            <div className={styles.cbLoanToggleLabel}>
              <span className={styles.cbLoanToggleTitle}>Live block height</span>
              <span className={styles.cbLoanToggleDesc}>
                Fetches the current block from mempool.space, blockstream.info, blockchain.info, or
                blockchair — block height only, no identity. Off = local estimate.
              </span>
            </div>
            <Toggle
              value={almanacLiveEnabled}
              onChange={(v) => {
                if (v) {
                  setAlmanacLiveConsented(true);   // the host list above satisfies the disclosure
                  setAlmanacLiveEnabled(true);
                } else {
                  setAlmanacLiveEnabled(false);
                }
              }}
            />
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
                  <div className={styles.setupFieldGroup}>
                    <span className={styles.setupFieldLabel}>ACTION AT TRIGGER</span>
                    <div className={styles.strategyPills}>
                      <button
                        className={`${styles.strategyPill} ${cbLtvAction === 'paydown' ? styles.strategyPillActive : ''}`}
                        onClick={() => setCbLtvAction('paydown')}
                      >Paydown</button>
                      <button
                        className={`${styles.strategyPill} ${cbLtvAction === 'addCollateral' ? styles.strategyPillActive : ''}`}
                        onClick={() => setCbLtvAction('addCollateral')}
                      >Add collateral</button>
                    </div>
                    {cbLtvAction === 'addCollateral' && (
                      <span className={styles.fieldHint}>Add-collateral shapes logging and guidance only for now — the Outlook projection still models paydown.</span>
                    )}
                  </div>
                  <NumberInput label="Draw trigger LTV" value={cbLtvTriggerPct} onChange={setCbLtvTriggerPct} min={0} max={85} step={1} />
                  <NumberInput
                    label={cbLtvAction === 'addCollateral' ? 'Reduce to LTV' : 'Pay down to LTV'}
                    value={cbLtvTargetPct}
                    onChange={setCbLtvTargetPct}
                    min={0}
                    max={85}
                    step={1}
                  />
                  <NumberInput label="Rotate-back LTV"  value={cbRotateBackPct} onChange={setCbRotateBackPct} min={0} max={85} step={1} />
                  <span className={styles.fieldHint}>When CB LTV falls below this, shift expensive Strike debt back to the cheaper CB loan.</span>
                  <NumberInput label="Emergency ceiling %" value={cbEmergencyCeilingPct} onChange={setCbEmergencyCeilingPct} min={20} max={50} step={1} />
                  <span className={styles.fieldHint}>Emergency Console: the Strike LTV crash-day collateral top-ups draw to (20–50%).</span>
                  {!(cbRotateBackPct < cbLtvTargetPct && cbLtvTargetPct < cbLtvTriggerPct && cbLtvTriggerPct < 86) && (
                    <span className={styles.fieldHint} style={{ color: 'var(--amber)' }}>
                      Thresholds must satisfy rotate-back &lt; target &lt; trigger &lt; 86% (Morpho liquidation).
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

      {settingsPage === 'network' && !viewerMode && backupGated && (
      <div className={styles.section}>
        <BackupGateInterstitial onBack={() => setSettingsPage('menu')} />
      </div>
      )}

      {settingsPage === 'network' && !viewerMode && !backupGated && (
      <div className={styles.section}>
        <div className={styles.setupGroup}>
          <div className={styles.setupGroupLabel}>YOUR RELAYS</div>
          {nostrRelays.length === 0 && <span className={styles.fieldHint}>No relays configured.</span>}
          {nostrRelays.map((url) => (
            <div key={url} className={styles.relayRow}>
              {/* P3: live connection dot (green/amber/red) driven by the relay's real WebSocket state */}
              <span className={
                relayStatus[url] === 'connected' ? styles.relayDotOn
                : relayStatus[url] === 'offline' ? styles.relayDotOff
                : styles.relayDotConnecting
              } />
              <span className={styles.relayUrl}>{url}</span>
              <button
                className={styles.relayRemove}
                onClick={() => setNostrRelaysAndSync(nostrRelays.filter((r) => r !== url))}
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

      {/* Plan Export / Backup Tool — EXPORT phase only (read-only; import/restore is a later build).
          Plan-only: downloadPlanBackup strips the sharing/transport config (the viewers roster +
          nextViewerIndex + nostrRelays) and includes the full records set (incl. raw dayLog). Owner-only. */}
      {settingsPage === 'backup' && !viewerMode && (
        <div className={styles.section}>
          <p className={styles.cbLoanToggleDesc}>
            Downloads your full plan — settings and all records — as a JSON file you can keep as a backup.
            It stays on your device; nothing is uploaded. Keep it somewhere safe so you can restore your
            plan if you ever need to.
          </p>
          <button className={styles.syncButton} onClick={() => downloadPlanBackup(useStore.getState())}>
            Export plan
          </button>
        </div>
      )}

      {/* Access Layer Redesign Phase 1 — front-door flows (each owns its full-screen overlay). The gate
          sets auth itself → owner gates take over; ViewerLoginFlow sets viewerMode → viewer gates take over. */}
      {accessFlow === 'login' && (
        <NostrAuthGate onSuccess={() => setAccessFlow(null)} onBack={() => setAccessFlow(null)} />
      )}
      {accessFlow === 'viewer' && (
        <ViewerLoginFlow onDone={() => { setSimpleMode(true); setAccessFlow(null); }} onBack={() => setAccessFlow(null)} />
      )}
      {/* R2c-1 — the backup ceremony overlay (own screen; stamps backupVerifiedAt on verified success). */}
      {ceremonyOpen && <RecoveryKeyCeremony onClose={() => setCeremonyOpen(false)} />}
    </div>
  );
}
