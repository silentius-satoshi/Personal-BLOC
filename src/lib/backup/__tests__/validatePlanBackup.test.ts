import { describe, it, expect, vi } from 'vitest';

// Mock localStorage BEFORE the store import (buildPlanBackup pulls useStore, whose module-init seeds touch it).
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});

import { validatePlanBackup } from '../validatePlanBackup';
import { buildPlanBackup } from '../exportPlan';
import { CURRENT_STORE_VERSION } from '../../storeVersion';
import { VALIDATE_WHITELIST, APPLY_FIELDS, TRANSPORT_FIELDS } from '../../../store/settingsFields';
import { useStore } from '../../../store/useStore';
import { buildSettingsPayload } from '../../../store/payloads';

// A real export of the seed store → the canonical valid file. JSON round-trip mirrors what a real file goes through
// (numeric deletedMonths keys → strings, etc.).
const realBackup = () => JSON.parse(JSON.stringify(buildPlanBackup(useStore.getState())));

describe('validatePlanBackup — happy path', () => {
  it('accepts a real buildPlanBackup output (round-tripped through JSON)', () => {
    const r = validatePlanBackup(realBackup());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary.exportedAt).toBeTruthy();
      expect(typeof r.summary.months).toBe('number');
      expect(r.summary.settingsPreview.income).toBe(useStore.getState().income);
    }
  });

  it('accepts an empty-but-valid plan (no records, minimal settings)', () => {
    const b = realBackup();
    b.plan.records = { monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {} };
    expect(validatePlanBackup(b).ok).toBe(true);
  });

  it('accepts string-keyed deletedMonths (JSON coercion of numeric keys)', () => {
    const b = realBackup();
    b.plan.records.deletedMonths = { '3': 1_700_000_000_000, '7': 1_700_000_100_000 };
    expect(validatePlanBackup(b).ok).toBe(true);
  });
});

describe('validatePlanBackup — rejections', () => {
  it('rejects a non-backup object', () => {
    const r = validatePlanBackup({ hello: 'world' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe('not-a-backup');
  });

  it('rejects a wrong storeVersion with a version-honest message', () => {
    const b = realBackup();
    b.storeVersion = CURRENT_STORE_VERSION - 1;
    const r = validatePlanBackup(b);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.code).toBe('version-mismatch');
      expect(r.reason.message).toContain(String(CURRENT_STORE_VERSION - 1));
      expect(r.reason.message).toContain(String(CURRENT_STORE_VERSION));
    }
  });

  it('rejects an unknown settings key (tamper tripwire)', () => {
    const b = realBackup();
    b.plan.settings.totallyMadeUpField = 42;
    const r = validatePlanBackup(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe('bad-settings');
  });

  it('rejects a transport field present in settings (viewers)', () => {
    const b = realBackup();
    b.plan.settings.viewers = [];
    const r = validatePlanBackup(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe('bad-settings');
  });

  it('rejects a malformed day event (missing ts / bad kind)', () => {
    const b = realBackup();
    b.plan.records.dayLog = [{ id: 'x', date: '2026-01-01', kind: 'not-a-real-kind' }];
    const r = validatePlanBackup(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe('bad-records');
  });

  it('rejects an oversize dayLog', () => {
    const b = realBackup();
    b.plan.records.dayLog = { length: 100_001 };   // Array.isArray → false, so this actually trips bad-records
    expect(validatePlanBackup(b).ok).toBe(false);
  });
});

describe('the gate split — backupVerifiedAt validated but never applied', () => {
  it('validates a backup carrying backupVerifiedAt (it is in the validate whitelist)', () => {
    const b = realBackup();
    b.plan.settings.backupVerifiedAt = 1_700_000_000_000;
    expect(VALIDATE_WHITELIST.has('backupVerifiedAt')).toBe(true);
    expect(validatePlanBackup(b).ok).toBe(true);
  });

  it('APPLY_FIELDS excludes backupVerifiedAt AND the transport fields', () => {
    expect(APPLY_FIELDS.has('backupVerifiedAt')).toBe(false);
    for (const f of TRANSPORT_FIELDS) expect(APPLY_FIELDS.has(f)).toBe(false);
  });
});

describe('field-list drift guard (pins the subsets against the real payload)', () => {
  it('VALIDATE_WHITELIST = buildSettingsPayload keys − transport; APPLY_FIELDS = that − backupVerifiedAt', () => {
    const payloadKeys = Object.keys(buildSettingsPayload(useStore.getState()));
    const transport = new Set<string>(TRANSPORT_FIELDS);
    const expectedValidate = payloadKeys.filter((k) => !transport.has(k)).sort();
    expect([...VALIDATE_WHITELIST].sort()).toEqual(expectedValidate);
    const expectedApply = expectedValidate.filter((k) => k !== 'backupVerifiedAt');
    expect([...APPLY_FIELDS].sort()).toEqual(expectedApply);
  });
});
