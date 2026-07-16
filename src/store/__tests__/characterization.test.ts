import { describe, it, expect, afterEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1a — CHARACTERIZATION / PARITY INSTRUMENT for the monolith cleave.
// These four suites pin the EXACT current shapes of the persisted blob, the
// settings payload, both viewer-snapshot tiers, and the records payload. In
// Phase 1b (SyncEngine extraction) and 1c (store slicing) these ASSERTIONS stay
// FROZEN — only the import line below gets mechanically repointed when symbols
// move to payloads.ts / syncEngine.ts. Treat every literal as a CONTRACT, not a
// snapshot to regenerate. If a literal ever disagrees with source, the move
// changed behavior — that is the bug, not the test.
//
// Two source-truth notes (deliberate, verified against HEAD):
//   • Suite 1 asserts the JSON-SERIALIZED blob keys (91). partializeState()
//     returns `...rest`, which also carries every action FUNCTION; only JSON
//     serialization (what actually persists) drops them. Keying on the data-only
//     blob is faithful to "persisted blob shape" AND is the right instrument —
//     1c may reorganize the action surface without touching the blob.
//   • buildSettingsPayload returns 37 keys (not 36 — that count was off by one).
// ─────────────────────────────────────────────────────────────────────────────

// Mock localStorage BEFORE the store import (vi.hoisted runs first) — partializeState + the
// module-init GATE_*/WK_*/provenance seed IIFEs touch it. Empty shim ⇒ identity seeds resolve to
// deterministic fresh-install defaults (onboardingComplete false / nostrPubkey null / keyProvenance null).
// Mirrors backupGate.test.ts / simpleView.test.ts.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

// Suite 4 mocks publish.ts (the recordsPublishDebounce.test.ts idiom) to capture the records payload.
// File-scoped but harmless to Suites 1–3: the pure builders touch publish.ts only via erased type imports,
// and the store's own publish imports are all DYNAMIC (resolved to this mock at call time).
const { publishRecords, publishViewerSnapshot } = vi.hoisted(() => ({
  publishRecords:        vi.fn().mockResolvedValue(1234),
  publishViewerSnapshot: vi.fn().mockResolvedValue(1),
}));
vi.mock('../../lib/nostr/publish', () => ({ publishRecords, publishViewerSnapshot }));

// 1b/1c repoint these imports when symbols move; the assertions below are FROZEN.
import { useStore, partializeState } from '../useStore';
import { buildSettingsPayload, buildViewerSnapshotPayload } from '../payloads';        // 1b: builders moved here
import { publishRecordsNowImmediate } from '../../lib/nostr/syncEngine';               // 1b: publish fns moved here

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;   // advisorStartDate = todayLocalISO() — the ONLY non-deterministic seed field

// ── Suite 1 — persisted blob shape ───────────────────────────────────────────
describe('characterization · persisted blob (partializeState)', () => {
  it('blob key-set is exactly the 97 persisted data keys', () => {
    const blob = JSON.parse(JSON.stringify(partializeState(useStore.getState())));
    expect(Object.keys(blob).sort()).toEqual([
      'activeTier', 'advisorActualBlocBalance', 'advisorActualBlocBalanceAsOf', 'advisorActualBtcHeld',
      'advisorMonthStartBalance', 'advisorSkipBlocDraw', 'advisorSkipBtcBuying', 'advisorSkipCbPayment',
      'advisorStartDate', 'almanacLiveConsented', 'almanacLiveEnabled', 'annualBtcGrowth', 'annualDecline',
      'backupVerifiedAt', 'bearMarket', 'bearPeriodYears', 'blocApr', 'blocMinPaymentDueDay',
      'blocMinPaymentSource', 'blocStatementMinimum', 'btcBuyingUnit', 'btcHoldings', 'btcPrice',
      'btcPriceMode', 'btcPriceUpdatedAt', 'cbAprPct', 'cbCollateralBtc', 'cbEmergencyCeilingPct',
      'cbLiquidationPrice', 'cbLiquidationPriceAsOf', 'cbLoanBalance', 'cbLoanBalanceAsOf', 'cbLtvAction',
      'cbLtvTargetPct', 'cbLtvTriggerPct', 'cbMonthlyPayment', 'cbPaymentStrategy', 'cbRotateBackPct',
      'converterActiveField', 'converterRawValue', 'creditLine', 'dayLog', 'deletedDayEvents', 'deletedMonths',
      'devMode', 'expenseReanchorDismissedAt', 'expenses', 'hasCbLoan', 'hiddenTabs', 'income', 'inflationRate',
      'keyProvenance', 'lastPlanEventsSyncAt', 'lastPrefsSyncAt', 'lastRecordsSyncAt', 'lastSettingsSyncAt',
      'lastV1FallbackApplyAt',   // 4d fallback telemetry
      'ltvType', 'miningInputs',
      'monthBucketReconcileDone', 'monthlyLog', 'ndpLastPaidDate', 'nextViewerIndex', 'nostrAuthEnabled',
      'nostrBunkerUri', 'nostrLogin', 'nostrPubkey', 'nostrRelays', 'nostrSigningMethod', 'onboardingComplete',
      'pinnedScenario',   // Phase 3a: device-local pin
      'planDirty', 'planEvents', 'prefsDirty',   // Phase 4c: plan-events channel (device-local persisted)
      'previousTab', 'recordsDirty', 'scenario', 'scrubMonth', 'settingsDirty', 'showMiningInLog',
      'showPlanCbBar', 'showPlanIncomeBar', 'showPlanStrikeBar', 'simpleMode', 'simpleView',
      'strikeCollateralBtc', 'strikeLiquidationLtvPct', 'tabOrder', 'timeHorizonYears', 'toolTabs',
      'viewerDisplayName', 'viewerKeyWrapMeta', 'viewerKeyWrapped', 'viewerMode', 'viewerSecretKey',
      'viewerWriterPubkey', 'viewers',
    ]);
  });

  it('blob deep-equals the seed (advisorStartDate normalized)', () => {
    const blob = JSON.parse(JSON.stringify(partializeState(useStore.getState())));
    expect(blob.advisorStartDate).toMatch(ISO_DATE);
    delete blob.advisorStartDate;   // the sole non-deterministic persisted field on the seed store
    expect(blob).toEqual({
      income: 4000, expenses: 3500, btcPrice: 82000, btcPriceMode: 'live', btcPriceUpdatedAt: null,
      blocApr: 13, activeTier: 'rec', scenario: 'moderate', scrubMonth: 30, creditLine: 10000,
      btcHoldings: 0.7, annualBtcGrowth: 50, bearMarket: false, bearPeriodYears: 2, annualDecline: -50,
      inflationRate: 2, ltvType: 'target', timeHorizonYears: 1, hasCbLoan: false, cbLoanBalance: 60000,
      cbCollateralBtc: 1.48, strikeCollateralBtc: 0, cbAprPct: 4.77, cbMonthlyPayment: 0,
      cbLiquidationPrice: 0, cbPaymentStrategy: 'monthly', cbLtvTriggerPct: 75, cbLtvTargetPct: 65,
      cbRotateBackPct: 55, cbEmergencyCeilingPct: 30, cbLoanBalanceAsOf: null, cbLiquidationPriceAsOf: null,
      strikeLiquidationLtvPct: 85, blocMinPaymentSource: 'roll', blocStatementMinimum: null,
      blocMinPaymentDueDay: 15, simpleMode: false, onboardingComplete: false, btcBuyingUnit: 'btc',
      devMode: false, almanacLiveEnabled: false, almanacLiveConsented: false, expenseReanchorDismissedAt: 0,
      monthBucketReconcileDone: false, advisorActualBlocBalance: 0, advisorActualBlocBalanceAsOf: null,
      advisorMonthStartBalance: 0, advisorActualBtcHeld: 0, ndpLastPaidDate: null, advisorSkipBlocDraw: false,
      advisorSkipCbPayment: false, advisorSkipBtcBuying: false, monthlyLog: [], showMiningInLog: false,
      dayLog: [], cbLtvAction: 'paydown', showPlanIncomeBar: true, showPlanStrikeBar: true,
      showPlanCbBar: true, simpleView: 'dashboard', converterActiveField: 'sats', converterRawValue: '0',
      hiddenTabs: [], tabOrder: ['living', 'bloc', 'powerlaw', 'converter', 'mining', 'coinbase', 'advisor'],
      toolTabs: ['powerlaw', 'converter', 'mining', 'liqsim', 'almanac'], previousTab: 'living',
      miningInputs: {
        devices: [
          { name: 'Gamma 601', hashrateTH: 1.07, powerW: 22.3, efficiencyJTH: 20.23, enabled: true, soloMining: true, poolName: '', poolFee: 0.5 },
          { name: 'Gamma 602', hashrateTH: 1.2, powerW: 18, efficiencyJTH: 15, enabled: true, soloMining: false, poolName: '', poolFee: 2 },
        ],
        electricityRateCents: 12, btcPriceOverride: null, networkHashrateEH: 1000, selectedStrategy: 'split',
        currency: 'usd', projectionYears: 5, btcPriceScenarios: [76000, 150000, 300000, 1000000],
      },
      nostrAuthEnabled: false, nostrPubkey: null, nostrSigningMethod: null, nostrBunkerUri: null,
      nostrRelays: ['wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nos.lol'], nostrLogin: null,
      keyProvenance: null, backupVerifiedAt: null, viewers: [], nextViewerIndex: 0, viewerMode: false,
      viewerWriterPubkey: null, viewerSecretKey: null, viewerDisplayName: null, viewerKeyWrapped: null,
      viewerKeyWrapMeta: null, lastSettingsSyncAt: null, lastRecordsSyncAt: null, recordsDirty: false,
      settingsDirty: false, deletedMonths: {}, deletedDayEvents: {},
      planEvents: [], planDirty: false, lastPlanEventsSyncAt: null, prefsDirty: false, lastPrefsSyncAt: null,   // Phase 4c
      lastV1FallbackApplyAt: null,   // Phase 4d
      pinnedScenario: null,   // Phase 3a: device-local pin
    });
  });
});

// ── Suite 2 — settings payload (buildSettingsPayload) ────────────────────────
describe('characterization · settings payload (buildSettingsPayload)', () => {
  it('is exactly 37 keys', () => {
    const p = buildSettingsPayload(useStore.getState());
    expect(Object.keys(p).sort()).toEqual([
      'advisorActualBlocBalance', 'advisorActualBlocBalanceAsOf', 'advisorActualBtcHeld',
      'advisorMonthStartBalance', 'advisorSkipBlocDraw', 'advisorSkipBtcBuying', 'advisorSkipCbPayment',
      'advisorStartDate', 'backupVerifiedAt', 'blocApr', 'blocMinPaymentDueDay', 'blocMinPaymentSource',
      'blocStatementMinimum', 'btcBuyingUnit', 'cbAprPct', 'cbEmergencyCeilingPct', 'cbLiquidationPrice',
      'cbLiquidationPriceAsOf', 'cbLoanBalance', 'cbLoanBalanceAsOf', 'cbLtvTargetPct', 'cbLtvTriggerPct',
      'cbMonthlyPayment', 'cbPaymentStrategy', 'cbRotateBackPct', 'creditLine', 'expenses', 'hasCbLoan',
      'hiddenTabs', 'income', 'ndpLastPaidDate', 'nextViewerIndex', 'nostrRelays', 'simpleMode',
      'strikeLiquidationLtvPct', 'tabOrder', 'viewers',
    ]);
  });

  it('deep-equals the seed (advisorStartDate normalized → 36 entries)', () => {
    const p = buildSettingsPayload(useStore.getState()) as Record<string, unknown>;
    expect(p.advisorStartDate).toMatch(ISO_DATE);
    delete p.advisorStartDate;
    expect(p).toEqual({
      income: 4000, expenses: 3500, blocApr: 13, creditLine: 10000, advisorActualBlocBalance: 0,
      advisorActualBlocBalanceAsOf: null, advisorMonthStartBalance: 0, advisorActualBtcHeld: 0,
      cbLoanBalance: 60000, cbAprPct: 4.77, hasCbLoan: false, ndpLastPaidDate: null,
      tabOrder: ['living', 'bloc', 'powerlaw', 'converter', 'mining', 'coinbase', 'advisor'], hiddenTabs: [],
      simpleMode: false, btcBuyingUnit: 'btc', cbLiquidationPrice: 0, cbMonthlyPayment: 0,
      cbPaymentStrategy: 'monthly', cbLtvTriggerPct: 75, cbLtvTargetPct: 65, cbRotateBackPct: 55,
      cbEmergencyCeilingPct: 30, cbLoanBalanceAsOf: null, cbLiquidationPriceAsOf: null,
      strikeLiquidationLtvPct: 85, blocMinPaymentSource: 'roll', blocStatementMinimum: null,
      blocMinPaymentDueDay: 15, advisorSkipBlocDraw: false, advisorSkipCbPayment: false,
      advisorSkipBtcBuying: false, nostrRelays: ['wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nos.lol'],
      backupVerifiedAt: null, viewers: [], nextViewerIndex: 0,
    });
  });
});

// ── Suite 3 — viewer snapshot, BOTH tiers (Phase 4b shape-lock base) ──────────
// 4b SHAPE-LOCK — the viewer-blast-radius contract. FROZEN through the 4c–4e campaign: the plan-events
// migration touches the OWNER settings channel only; viewers receive an object over snapshot d-tags and
// must never learn the log exists. ANY diff to these literals means the campaign reached viewers (it must
// not) — treat a change here as a red flag to investigate, not a fixture to update.
describe('characterization · viewer snapshot (buildViewerSnapshotPayload)', () => {
  it('C-safe: full shape (asOf normalized)', () => {
    const safe = buildViewerSnapshotPayload(useStore.getState(), 'safe') as Record<string, unknown>;
    expect(typeof safe.asOf).toBe('number');
    expect(Number.isFinite(safe.asOf as number)).toBe(true);
    delete safe.asOf;
    expect(safe).toEqual({
      snapshotVersion: 2, privacyMode: 'safe', hasCbLoan: false, btcPriceAtSnapshot: 82000,
      thresholds: { strikeLiqLtv: 0.85, cbLtvTriggerPct: 75, cbLiqFrac: 0.86 },
      // The 9 safety values are COMPUTED from seeds by deriveSafetyView/buildSafeSafety — frozen from a
      // one-time run against the seed store (all zero/safe because the seed has no drawn debt).
      safety: {
        capacityUsed: 0, creditLevel: 'safe', strikeLtv: 0, strikeLevel: 'safe', crashLtv: 0,
        cbLtv: 0, cbLevel: 'safe', cbLiqFrac: 0.86, overall: 'safe',
      },
    });
  });

  it('C-trusted: full shape (asOf + settings.advisorStartDate normalized)', () => {
    const trusted = buildViewerSnapshotPayload(useStore.getState(), 'trusted') as Record<string, unknown>;
    expect(typeof trusted.asOf).toBe('number');
    delete trusted.asOf;
    const settings = trusted.settings as Record<string, unknown>;
    expect(settings.advisorStartDate).toMatch(ISO_DATE);
    delete settings.advisorStartDate;
    expect(trusted).toEqual({
      snapshotVersion: 2, privacyMode: 'trusted',
      // settings = the 37 minus the 4-key snapshot strip (viewers/nextViewerIndex/nostrRelays/backupVerifiedAt) → 33.
      settings: {
        income: 4000, expenses: 3500, blocApr: 13, creditLine: 10000, advisorActualBlocBalance: 0,
        advisorActualBlocBalanceAsOf: null, advisorMonthStartBalance: 0, advisorActualBtcHeld: 0,
        cbLoanBalance: 60000, cbAprPct: 4.77, hasCbLoan: false, ndpLastPaidDate: null,
        tabOrder: ['living', 'bloc', 'powerlaw', 'converter', 'mining', 'coinbase', 'advisor'], hiddenTabs: [],
        simpleMode: false, btcBuyingUnit: 'btc', cbLiquidationPrice: 0, cbMonthlyPayment: 0,
        cbPaymentStrategy: 'monthly', cbLtvTriggerPct: 75, cbLtvTargetPct: 65, cbRotateBackPct: 55,
        cbEmergencyCeilingPct: 30, cbLoanBalanceAsOf: null, cbLiquidationPriceAsOf: null,
        strikeLiquidationLtvPct: 85, blocMinPaymentSource: 'roll', blocStatementMinimum: null,
        blocMinPaymentDueDay: 15, advisorSkipBlocDraw: false, advisorSkipCbPayment: false,
        advisorSkipBtcBuying: false,
      },
      records: { entries: [], deletions: {} },
      strike: { usd: null, btcAvail: null, rate: null },
      cbCollateralBtc: 1.48, strikeCollateralBtc: 0,
    });
  });
});

// ── Suite 4 — records payload pass-through ───────────────────────────────────
describe('characterization · records payload (publishRecordsNowImmediate)', () => {
  afterEach(() => {
    publishRecords.mockClear();
    // Reset the fields this suite mutates (useStore is a shared singleton; Suites 1–3 ran first on the seed).
    useStore.setState({
      isAuthenticated: false, nostrSigner: null, nostrPubkey: '', viewerMode: false,
      monthlyLog: [], dayLog: [], deletedMonths: {}, deletedDayEvents: {},
    } as never);
  });

  it('maps store records → {entries, deletions, dayLog, dayLogDeletions} unchanged', async () => {
    const entry = { month: 1, income: 4000, btcBought: 0.01, strikeBal: 500, strikeLtv: 0.1, btcHeld: 0.7 };
    const dayEvent = { id: 'd1', kind: 'draw', date: '2026-01-01', ts: 1, amount: 100 };
    // Pass the gate: authed + signer + pubkey + !viewerMode + backup gate satisfied (seed keyProvenance null).
    useStore.setState({
      isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', viewerMode: false,
      nostrSigningMethod: 'local', nostrRelays: [],
      monthlyLog: [entry] as never, dayLog: [dayEvent] as never,
      deletedMonths: { 3: 123 } as never, deletedDayEvents: { 'evt-x': 456 } as never,
    } as never);

    const ok = await publishRecordsNowImmediate();
    expect(ok).toBe(true);
    expect(publishRecords).toHaveBeenCalledTimes(1);

    const payload = publishRecords.mock.calls[0][2] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['dayLog', 'dayLogDeletions', 'deletions', 'entries']);
    expect(payload.entries).toEqual([entry]);           // ← monthlyLog
    expect(payload.dayLog).toEqual([dayEvent]);          // ← dayLog
    expect(payload.deletions).toEqual({ 3: 123 });       // ← deletedMonths
    expect(payload.dayLogDeletions).toEqual({ 'evt-x': 456 });  // ← deletedDayEvents
  });
});
