import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 5e (F1) with 5c — ⭐ F1 5c FRESH: on a fresh sign-in, no plan-dependent write lands before the plan loads, whether the
 * loading screen is up or has gone, and a signed month never changes. The store, syncNow and the publish engine are real
 * (a planless device's publishes are HELD); only the relays are mocked — `fetchAndSync` brings what a fresh sign-in's
 * first pull can: the key's journal (signed months 1–3) without a plan it could apply ('absent'), or nothing at all
 * ('none', 'unreachable'). The device keeps the seed plan meanwhile (its start date is today): the incident's state,
 * where an unguarded reconcile deletes months 2–4 (5b's spec §16). Round synthetic figures; dates from today.
 */

const h = vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem:    (k: string) => mem.get(k) ?? null,
    setItem:    (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
  return { arrive: null as null | (() => void), release: null as null | ((v: { ok: boolean; planFound: boolean }) => void) };
});

// The relays: the pull is held open until the test releases it; `arrive` lands what this pull brings, first.
vi.mock('../sync', () => ({
  fetchAndSync: vi.fn(() => new Promise((resolve) => { h.release = (v) => { h.arrive?.(); resolve(v); }; })),
}));

import { useStore } from '../../../store/useStore';
import { syncNow } from '../syncNow';
import { getPlanScreen, resetFirstPull } from '../firstPull';
import { recordPlanPull, resetPlanPull, getPlanPull } from '../planLoad';
import { todayLocalISO } from '../../../utils/format';
import { rollupMonth, priorStocksForMonth } from '../../../simulation/logUtils';
import type { DayEvent, MonthlyLogEntry } from '../../../simulation/types';

// ── The key's journal: month 1 starts three months before this one; months 1–3 signed, month 4 in progress ──
const now = new Date(todayLocalISO());
const isoUtc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const START = isoUtc(now.getUTCFullYear(), now.getUTCMonth() - 3, 1);
const inMonth = (n: number, day: number) => isoUtc(now.getUTCFullYear(), now.getUTCMonth() - 4 + n, day);
let seq = 0;
const ts = () => 1_700_000_000_000 + ++seq;
const draw = (amount: number, date: string): DayEvent => ({ id: `d${++seq}`, date, ts: ts(), kind: 'draw', amount });
const reading = (strikeBal: number, date: string): DayEvent => ({ id: `r${++seq}`, date, ts: ts(), kind: 'balanceReading', reading: { strikeBal, strikeLtv: 0.1 } });
const DAY_LOG: DayEvent[] = [
  draw(1000, inMonth(1, 10)), reading(5000, inMonth(1, 25)),
  draw(2000, inMonth(2, 10)), reading(6000, inMonth(2, 25)),
  draw(3000, inMonth(3, 10)), reading(7000, inMonth(3, 25)),
  draw(4000, inMonth(4, 1)),  reading(8000, inMonth(4, 1)),
];
const entry = (m: number, confirmed: boolean): MonthlyLogEntry => ({
  month: m, date: inMonth(m, 1), btcBought: 0, income: 0, paydown: 0, strikeBal: 0, strikeLtv: 0, loggedAt: 1, updatedAt: 1, expensesActual: 0,
  ...rollupMonth(DAY_LOG, m, START, priorStocksForMonth(DAY_LOG, START, m)).entry, source: 'daily', confirmed,
});
const JOURNAL = () => [entry(1, true), entry(2, true), entry(3, true), entry(4, false)];

/** A fresh sign-in on a new browser: no journal, the seed plan (start date today), the reconcile settled at hydration. */
const freshSignIn = () => useStore.setState({
  nostrAuthEnabled: true, viewerMode: false, planLoaded: false, keyProvenance: 'external', backupVerifiedAt: null,
  isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', nostrSigningMethod: 'nip07', nostrRelays: ['wss://a'],
  recordsDirty: false, planDirty: false, prefsDirty: false, nostrReconnectNeeded: false, pendingViewerRevocations: [],
  dayLog: [], monthlyLog: [], deletedMonths: {}, deletedDayEvents: {}, planEvents: [], viewers: [],
  advisorStartDate: todayLocalISO(), monthBucketReconcileDone: true, initialSettingsPullDone: false,
} as never);

/** Everything a device without its plan might try on its own or on a tap — each must be refused. */
const tryEveryWrite = () => {
  const s = useStore.getState();
  s.addDayEvent({ id: 'w1', date: inMonth(2, 12), ts: ts(), kind: 'draw', amount: 999 });   // a day event in a signed month
  s.confirmMonth(4, { expensesActual: 7 });                                                   // a sign-off
  s.unconfirmMonth(2);                                                                        // a reopen
  s.upsertLogEntry({ ...entry(3, true), expensesActual: 1 });                                // a manual log
  s.reconcileMonthBuckets();                                                                  // the one-shot reconcile, against the seed plan
  s.setIncome(4321);                                                                          // a plan edit
};
const signed = () => useStore.getState().monthlyLog.filter((e) => e.confirmed === true);
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

beforeEach(() => { resetFirstPull(); resetPlanPull(); h.arrive = null; h.release = null; freshSignIn(); });
// A test that fails before it releases its pull would leave syncNow's shared run in flight for the next one: release it.
afterEach(async () => { h.release?.({ ok: true, planFound: false }); await new Promise((r) => setTimeout(r, 0)); });

describe('⭐ F1 5c FRESH — a fresh sign-in writes nothing that depends on the plan, before the screen goes or after', () => {
  for (const [label, arrival] of [
    ['the journal, and no plan it could apply (\'absent\')', () => {
      useStore.getState().setDayLog(DAY_LOG);
      useStore.getState().setMonthlyLog(JOURNAL());
      recordPlanPull({ status: 'unreadable', at: 1, reason: 'absent' });
    }],
    ['nothing (\'none\')', () => recordPlanPull({ status: 'none', at: 1 })],
    ['no relay at all (\'unreachable\')', () => recordPlanPull({ status: 'unreachable', at: 1 })],
  ] as const) {
    it(`⭐ F1 5c FRESH — the first pull brings ${label}: refused through the screen and after it; the signed months unchanged`, async () => {
      h.arrive = arrival;
      const run = syncNow({} as never);
      expect(getPlanScreen().up, 'FRESH PREMISE: the screen is up').toBe(true);
      await settle();
      tryEveryWrite();                                                   // while the screen is up
      expect(useStore.getState().dayLog, 'FRESH no day event while it loads').toEqual([]);
      h.release!({ ok: true, planFound: label.startsWith('the journal') });
      await run;
      expect(getPlanScreen().up, 'FRESH PREMISE: the screen has gone').toBe(false);
      const pulled = useStore.getState().monthlyLog;
      tryEveryWrite();                                                   // after it, the plan still not loaded
      const after = useStore.getState();
      expect(after.planLoaded, 'FRESH a pull that found no plan never sets planLoaded').toBe(false);
      expect(after.monthlyLog, 'FRESH the monthly log is exactly what was pulled — not even a new array').toBe(pulled);
      expect(signed().map((e) => e.month), 'FRESH every signed month still signed').toEqual(label.startsWith('the journal') ? [1, 2, 3] : []);
      expect(after.dayLog.some((e) => e.id === 'w1'), 'FRESH no day event').toBe(false);
      expect(after.deletedMonths, 'FRESH no month deleted').toEqual({});
      expect(after.planEvents, 'FRESH no plan event').toEqual([]);
      expect(after.income, 'FRESH no plan edit').not.toBe(4321);
      expect(getPlanPull().status, 'FRESH the pull said why').not.toBe('pending');
    });
  }

  it('non-vacuity: once a pull applies the plan, the same writes land', async () => {
    h.arrive = () => {
      useStore.setState({ advisorStartDate: START, planLoaded: true } as never);   // the plan applies (sync.ts L99)
      recordPlanPull({ status: 'applied', at: 1, plainBytes: 1 });
      useStore.getState().setDayLog(DAY_LOG);
      useStore.getState().setMonthlyLog(JOURNAL());
    };
    const run = syncNow({} as never);
    await settle();
    h.release!({ ok: true, planFound: true });
    await run;
    useStore.getState().unconfirmMonth(2);
    useStore.getState().addDayEvent({ id: 'w2', date: inMonth(4, 2), ts: ts(), kind: 'draw', amount: 50 });
    expect(useStore.getState().monthlyLog.find((e) => e.month === 2)?.confirmed, 'non-vacuity a reopen lands').toBe(false);
    expect(useStore.getState().dayLog.some((e) => e.id === 'w2'), 'non-vacuity a day event lands').toBe(true);
  });

  it('5c stays exactly as it was: no F1 file names planLoaded\'s setter or a store write', () => {
    for (const rel of ['lib/nostr/firstPull.ts', 'hooks/usePlanLoading.ts', 'components/Auth/PlanLoadingGate.tsx']) {
      expect(readFileSync(join(process.cwd(), 'src', rel), 'utf8'), rel).not.toMatch(/setPlanLoaded|useStore/);
    }
  });
});
