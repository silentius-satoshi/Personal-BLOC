// Plan Import/Restore — the PURE validator. Runs FULLY before any store read/write; node-testable. Imports only
// zero-import / type-only leaves (CURRENT_STORE_VERSION, VALIDATE_WHITELIST, and TYPE-only PlanBackup) so it never
// drags in useStore.
import { CURRENT_STORE_VERSION } from '../storeVersion';
import { VALIDATE_WHITELIST } from '../../store/settingsFields';
import type { PlanBackup } from './exportPlan';

// Mirrors DayEventKind (src/simulation/types.ts) — kept as a local runtime set (validation is a runtime concern).
const DAY_EVENT_KINDS = new Set([
  'draw', 'buy', 'paydown', 'minPayment', 'deposit', 'withdraw', 'balanceReading', 'cbCollateralReading',
]);

const MAX_EVENTS = 100_000;   // a corrupt/hostile file must not OOM the tab

export interface ImportSummary {
  exportedAt: string;
  months: number;
  dayEvents: number;
  deletions: number;   // deletedMonths + deletedDayEvents tombstones
  settingsPreview: {
    income?: number;
    expenses?: number;
    advisorActualBlocBalance?: number;
    advisorActualBlocBalanceAsOf?: string | null;
    cbLoanBalance?: number;
    cbLoanBalanceAsOf?: string | null;
  };
}

export type ImportRejection =
  | { code: 'not-a-backup'; message: string }
  | { code: 'version-mismatch'; message: string }
  | { code: 'bad-settings'; message: string }
  | { code: 'bad-records'; message: string }
  | { code: 'too-large'; message: string };

export type ValidateResult =
  | { ok: true; backup: PlanBackup; summary: ImportSummary }
  | { ok: false; reason: ImportRejection };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStringNumberMap = (v: unknown): v is Record<string, number> =>
  isObject(v) && Object.values(v).every((n) => typeof n === 'number' && Number.isFinite(n));
// ⚠ keys NOT typeof-checked: JSON stringifies deletedMonths' numeric keys → string keys at runtime (mergeRecords
// coerces with Number(k)). Rejecting on key typeof would reject every real backup.

function validateDayEvent(e: unknown): boolean {
  if (!isObject(e)) return false;
  if (typeof e.id !== 'string' || typeof e.date !== 'string' || typeof e.ts !== 'number') return false;
  if (typeof e.kind !== 'string' || !DAY_EVENT_KINDS.has(e.kind)) return false;
  return true;
}

function validateMonthEntry(m: unknown): boolean {
  if (!isObject(m)) return false;
  if (typeof m.month !== 'number' || m.month < 1 || m.month > 12) return false;
  if (typeof m.date !== 'string') return false;
  if (typeof m.loggedAt !== 'number') return false;
  // required numerics on a real entry
  for (const k of ['btcBought', 'income', 'paydown', 'strikeBal', 'strikeLtv', 'btcHeld', 'expensesActual']) {
    if (typeof (m as Record<string, unknown>)[k] !== 'number') return false;
  }
  return true;
}

export function validatePlanBackup(raw: unknown): ValidateResult {
  const reject = (code: ImportRejection['code'], message: string): ValidateResult => ({ ok: false, reason: { code, message } });

  // 1 — shape + format
  if (!isObject(raw) || raw.format !== 'personal-bloc-plan-backup') {
    return reject('not-a-backup', 'This isn’t a Personal ₿LOC backup file.');
  }
  // 2 — version gate (lean-reject on mismatch)
  if (raw.schemaVersion !== 1 || raw.storeVersion !== CURRENT_STORE_VERSION) {
    const n = typeof raw.storeVersion === 'number' ? raw.storeVersion : '?';
    return reject('version-mismatch',
      `This backup is from a different app version (backup v${n}, app v${CURRENT_STORE_VERSION}). Restore isn’t supported across versions yet.`);
  }
  if (typeof raw.exportedAt !== 'string' || Number.isNaN(Date.parse(raw.exportedAt))) {
    return reject('not-a-backup', 'This backup is missing its export date.');
  }
  const plan = raw.plan;
  if (!isObject(plan)) return reject('not-a-backup', 'This backup is missing its plan data.');

  // 3 — settings: object; every present key ∈ VALIDATE_WHITELIST (unknown/transport key → tamper tripwire)
  const settings = plan.settings;
  if (!isObject(settings)) return reject('bad-settings', 'This backup’s settings are unreadable.');
  for (const key of Object.keys(settings)) {
    if (!VALIDATE_WHITELIST.has(key)) {
      return reject('bad-settings', `This backup contains an unexpected field ("${key}") and may be tampered with or from another app.`);
    }
  }

  // 4 — records: four collections present + shape-checked; counts capped
  const records = plan.records;
  if (!isObject(records)) return reject('bad-records', 'This backup’s records are unreadable.');
  const { monthlyLog, deletedMonths, dayLog, deletedDayEvents } = records;
  if (!Array.isArray(monthlyLog) || !Array.isArray(dayLog)) {
    return reject('bad-records', 'This backup’s records are unreadable.');
  }
  if (!isStringNumberMap(deletedMonths) || !isStringNumberMap(deletedDayEvents)) {
    return reject('bad-records', 'This backup’s deletion records are unreadable.');
  }
  if (dayLog.length > MAX_EVENTS || monthlyLog.length > MAX_EVENTS) {
    return reject('too-large', 'This backup is too large to restore safely.');
  }
  if (!dayLog.every(validateDayEvent)) return reject('bad-records', 'This backup contains a malformed day event.');
  if (!monthlyLog.every(validateMonthEntry)) return reject('bad-records', 'This backup contains a malformed month entry.');

  // 5 — summary
  const s = settings as Record<string, unknown>;
  const num = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : undefined);
  const str = (k: string) => (typeof s[k] === 'string' || s[k] === null ? (s[k] as string | null) : undefined);
  const summary: ImportSummary = {
    exportedAt: raw.exportedAt,
    months: monthlyLog.length,
    dayEvents: dayLog.length,
    deletions: Object.keys(deletedMonths).length + Object.keys(deletedDayEvents).length,
    settingsPreview: {
      income: num('income'),
      expenses: num('expenses'),
      advisorActualBlocBalance: num('advisorActualBlocBalance'),
      advisorActualBlocBalanceAsOf: str('advisorActualBlocBalanceAsOf'),
      cbLoanBalance: num('cbLoanBalance'),
      cbLoanBalanceAsOf: str('cbLoanBalanceAsOf'),
    },
  };

  return { ok: true, backup: raw as unknown as PlanBackup, summary };
}
