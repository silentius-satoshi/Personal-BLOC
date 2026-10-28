// uiSlice (Phase 1c) — app mode + display prefs + tabs + converter. Moved verbatim; getState()→get() the only change.
import type { StoreState, StoreSet, StoreGet } from '../types';
import { GATE_ONBOARDED_KEY, seedOnboardingComplete } from '../bootstrap';
import { checkVenueColor, normalizeHex, resolveVenueColors, venuePaletteOf, DEFAULT_VENUE_COLORS } from '../../lib/venueColors';

type UiSlice = Pick<StoreState,
  | 'activeTab' | 'simpleMode' | 'onboardingComplete' | 'btcBuyingUnit' | 'venueColors' | 'setVenueColor'
  | 'resetVenueColors' | 'devMode' | 'almanacLiveEnabled'
  | 'almanacLiveConsented' | 'expenseReanchorDismissedAt' | 'setExpenseReanchorDismissedAt' | 'setSimpleMode'
  | 'planNoteDismissed' | 'setPlanNoteDismissed' | 'planBreakerCache' | 'setPlanBreakerCache'
  | 'setOnboardingComplete' | 'setBtcBuyingUnit' | 'setDevMode' | 'setAlmanacLiveEnabled' | 'setAlmanacLiveConsented'
  | 'showPlanIncomeBar' | 'showPlanStrikeBar' | 'showPlanCbBar' | 'simpleView' | 'setActiveTab'
  | 'setShowPlanIncomeBar' | 'setShowPlanStrikeBar' | 'setShowPlanCbBar' | 'setSimpleView' | 'converterActiveField'
  | 'converterRawValue' | 'setConverterActiveField' | 'setConverterRawValue' | 'hiddenTabs' | 'tabOrder'
  | 'toolTabs' | 'previousTab' | 'toggleTabVisibility' | 'setHiddenTabs' | 'setTabOrder' | 'setToolTabs' | 'setPreviousTab'
>;

export const createUiSlice = (set: StoreSet, get: StoreGet): UiSlice => ({
  activeTab: 'living',
  simpleMode:         false,
  onboardingComplete: seedOnboardingComplete,   // 3a.4: standalone-seeded (false on fresh install = today's default)
  btcBuyingUnit:      'btc',
  venueColors:        undefined,   // BL15 — never set on this device: not published, exported or snapshotted
  devMode:            false,
  almanacLiveEnabled:   false,
  almanacLiveConsented: false,
  expenseReanchorDismissedAt: 0,
  planNoteDismissed: false,   // Run 2 (D8) — device-local, unsynced
  planBreakerCache:  null,    // Run 2 (§4.3) — device-local, unsynced; public price data only
  setSimpleMode:         (v) => get().emitPrefs({ simpleMode: v }),   // 4c: prefs channel (was syncSettingsToNostr)
  // 3a.4: write through to the standalone GATE_* key (outside the encrypted blob) so the unlock gate can bootstrap
  // on an encrypted cold start. Mirrors setWriterKeyWrapped.
  setOnboardingComplete: (v) => { try { v ? localStorage.setItem(GATE_ONBOARDED_KEY, '1') : localStorage.removeItem(GATE_ONBOARDED_KEY); } catch { /* noop */ } set({ onboardingComplete: v }); },
  setBtcBuyingUnit:      (v) => get().emitPrefs({ btcBuyingUnit: v }),
  // BL15 — the venue colours, on the prefs channel. THE rule gates the write here too, so no screen can store a colour
  // the picker would refuse. The write starts from the colours on screen (resolveVenueColors), so a stored colour the
  // rule hides is dropped, never revived by a change elsewhere; and the colour a venue already wears writes nothing, so
  // a device that never chose stays that way (undefined never travels).
  setVenueColor: (venue, color) => {
    const hex = normalizeHex(color);
    if (hex === null) return false;
    const cur = resolveVenueColors(get().venueColors);
    const palette = venuePaletteOf(cur);
    if (hex === palette[venue]) return true;
    if (checkVenueColor(venue, hex, palette) !== null) return false;
    const next = { ...cur };
    if (hex === DEFAULT_VENUE_COLORS[venue]) delete next[venue];
    else next[venue] = hex;
    get().emitPrefs({ venueColors: next });
    return true;
  },
  resetVenueColors: () => get().emitPrefs({ venueColors: {} }),
  setDevMode:            (v) => set({ devMode: v }),
  setAlmanacLiveEnabled:   (v) => set({ almanacLiveEnabled: v }),    // device-local, unsynced — no emit
  setAlmanacLiveConsented: (v) => set({ almanacLiveConsented: v }),  // device-local, unsynced — no emit
  setExpenseReanchorDismissedAt: (v) => set({ expenseReanchorDismissedAt: v }),   // device-local, unsynced — no emit
  setPlanNoteDismissed:  (v) => set({ planNoteDismissed: v }),    // device-local, unsynced — no emit
  setPlanBreakerCache:   (v) => set({ planBreakerCache: v }),     // device-local, unsynced — no emit
  showPlanIncomeBar: true,
  showPlanStrikeBar: true,
  showPlanCbBar:     true,
  // Default to the Dashboard (owner IA — dashboard-first); the custom merge fills this for existing
  // users (migrate-default only — a persisted choice is preserved, no version bump).
  simpleView: 'dashboard',
  setActiveTab: (v) => set({ activeTab: v }),
  // Device-local display prefs — plain set, NO emit (like devMode)
  setShowPlanIncomeBar: (v) => set({ showPlanIncomeBar: v }),
  setShowPlanStrikeBar: (v) => set({ showPlanStrikeBar: v }),
  setShowPlanCbBar:     (v) => set({ showPlanCbBar: v }),
  setSimpleView:        (v) => set({ simpleView: v }),

  converterActiveField: 'sats',
  converterRawValue:    '0',
  setConverterActiveField: (v) => set({ converterActiveField: v }),
  setConverterRawValue:    (v) => set({ converterRawValue: v }),
  hiddenTabs:  [],
  tabOrder:    ['living', 'bloc', 'powerlaw', 'converter', 'mining', 'coinbase', 'advisor'],
  toolTabs:    ['powerlaw', 'converter', 'mining', 'liqsim', 'almanac'],
  previousTab: 'living',
  // 4c: emitPrefs (spec §B) — this incidentally FIXES a latent asymmetry (a tab toggled here never synced,
  // unlike setHiddenTabs). Compute next from get() (the functional-set atomicity is unneeded under D2 single-writer).
  toggleTabVisibility: (tab) => {
    const cur = get().hiddenTabs;
    get().emitPrefs({ hiddenTabs: cur.includes(tab) ? cur.filter((t) => t !== tab) : [...cur, tab] });
  },
  setHiddenTabs: (v) => get().emitPrefs({ hiddenTabs: v }),
  setTabOrder:   (v) => get().emitPrefs({ tabOrder: v }),
  setToolTabs: (tabs) => set({ toolTabs: tabs }),
  setPreviousTab: (tab) => set({ previousTab: tab }),
});
