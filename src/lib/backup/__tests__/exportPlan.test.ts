import { describe, it, expect } from 'vitest';
import { useStore } from '../../../store/useStore';
import { buildPlanBackup } from '../exportPlan';

// Plan Export / Backup Tool — EXPORT phase. buildPlanBackup is a pure read over the real store;
// no mocking needed (it never writes, never touches sync/auth).

describe('buildPlanBackup — plan-only scope', () => {
  it('excludes the sharing/transport config (viewerNpub/viewerPubkey/viewerLabel/nostrRelays)', () => {
    useStore.setState({
      viewerNpub: 'npub1test', viewerPubkey: 'abc123', viewerLabel: 'Dad', nostrRelays: ['wss://r.example'],
    } as never);

    const backup = buildPlanBackup(useStore.getState());

    expect('viewerNpub' in backup.plan.settings).toBe(false);
    expect('viewerPubkey' in backup.plan.settings).toBe(false);
    expect('viewerLabel' in backup.plan.settings).toBe(false);
    expect('nostrRelays' in backup.plan.settings).toBe(false);
  });

  it('includes a sampling of real plan settings', () => {
    useStore.setState({ income: 7777, creditLine: 22222, cbLtvTriggerPct: 80 } as never);

    const backup = buildPlanBackup(useStore.getState());

    expect(backup.plan.settings.income).toBe(7777);
    expect(backup.plan.settings.creditLine).toBe(22222);
    expect(backup.plan.settings.cbLtvTriggerPct).toBe(80);
  });

  it('includes the full records set (monthlyLog, deletedMonths, dayLog, deletedDayEvents)', () => {
    const entry = { month: 1, btcBought: 0.01, loggedAt: 1000, btcHeld: 0, expensesActual: 3500 } as never;
    const dayEvent = { id: 'd1', date: '2026-06-01', ts: 111, kind: 'draw', amount: 500 } as never;
    useStore.setState({
      monthlyLog: [entry],
      deletedMonths: { 2: 999 },
      dayLog: [dayEvent],
      deletedDayEvents: { d2: 888 },
    } as never);

    const backup = buildPlanBackup(useStore.getState());

    expect(backup.plan.records.monthlyLog).toEqual([entry]);
    expect(backup.plan.records.deletedMonths).toEqual({ 2: 999 });
    expect(backup.plan.records.dayLog).toEqual([dayEvent]);
    expect(backup.plan.records.deletedDayEvents).toEqual({ d2: 888 });
  });

  it('the wrapper has format/schemaVersion/storeVersion/exportedAt/plan', () => {
    const backup = buildPlanBackup(useStore.getState());

    expect(backup.format).toBe('personal-bloc-plan-backup');
    expect(typeof backup.schemaVersion).toBe('number');
    expect(typeof backup.storeVersion).toBe('number');
    expect(typeof backup.exportedAt).toBe('string');
    expect(backup.plan).toBeDefined();
    expect(backup.plan.settings).toBeDefined();
    expect(backup.plan.records).toBeDefined();
  });

  it('excludes device-local/session fields (naturally absent — not in buildSettingsPayload/the records set)', () => {
    useStore.setState({
      devMode: true, viewerMode: true, settingsDirty: true, initialSettingsPullDone: true, nostrPubkey: 'pk',
    } as never);

    const backup = buildPlanBackup(useStore.getState());

    expect('devMode' in backup.plan.settings).toBe(false);
    expect('viewerMode' in backup.plan.settings).toBe(false);
    expect('settingsDirty' in backup.plan.settings).toBe(false);
    expect('initialSettingsPullDone' in backup.plan.settings).toBe(false);
    expect('nostrPubkey' in backup.plan.settings).toBe(false);
  });
});
