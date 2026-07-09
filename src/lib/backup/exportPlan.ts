import { buildSettingsPayload, type StoreState } from '../../store/useStore';
import { todayLocalISO } from '../../utils/format';
import { downloadBlob } from './downloadFile';

/**
 * Plan Export / Backup Tool — EXPORT phase only (read-only; no import/restore, no store writes).
 * A local, in-hand copy of the owner's plan independent of the relay/sync path. PLAN-ONLY scope —
 * strips the sharing/transport config (the viewers roster + nextViewerIndex + nostrRelays), which is
 * re-establishable and relationship-specific, not irreplaceable. The nsec key-backup is a separate
 * artifact (Phase 1.5), not this tool.
 */
export interface PlanBackup {
  format: 'personal-bloc-plan-backup';
  schemaVersion: number;
  storeVersion: number;
  exportedAt: string;
  plan: {
    settings: Record<string, unknown>;
    records: {
      monthlyLog: unknown[];
      deletedMonths: Record<number, number>;
      dayLog: unknown[];
      deletedDayEvents: Record<string, number>;
    };
  };
}

export function buildPlanBackup(s: StoreState): PlanBackup {
  const full = buildSettingsPayload(s);
  const { viewers: _vs, nextViewerIndex: _ni, nostrRelays: _r, ...planSettings } = full;
  return {
    format: 'personal-bloc-plan-backup',
    schemaVersion: 1,
    storeVersion: 21,   // mirrors the store's persist `version` (useStore.ts) — keep in sync
    exportedAt: new Date().toISOString(),   // machine timestamp — UTC ISO is correct (not a user-facing "today")
    plan: {
      settings: planSettings,
      records: {
        monthlyLog: s.monthlyLog,
        deletedMonths: s.deletedMonths,
        dayLog: s.dayLog,
        deletedDayEvents: s.deletedDayEvents,
      },
    },
  };
}

export function downloadPlanBackup(s: StoreState): void {
  const backup = buildPlanBackup(s);
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, `personal-bloc-backup-${todayLocalISO()}.json`);   // the shared, iOS-verified save pattern
}
