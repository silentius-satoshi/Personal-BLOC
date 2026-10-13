import { describe, it, expect } from 'vitest';
import { strikeHoldFrom, strikeHoldAt, strikeDepositOf, STRIKE_HOLD_DAYS, type StrikeHold } from '../crashPlaybookView';
import { latestStrikeDepositISO } from '../../../simulation/logUtils';
import type { DayEvent } from '../../../simulation/types';

/**
 * Run 2 — invariant 8 (D9): Strike's 60-day hold is ONE rule, whether it reads the owner's journal or a trusted viewer's
 * copy of one date. The refactor split `strikeHoldFrom` into `latestStrikeDepositISO` + `strikeHoldAt`; this sweep holds
 * it to the rule as it stood before (3580f92), frozen below as the reference. ⚠ SYNTHETIC journals.
 */
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 3580f92's `strikeHoldFrom`, verbatim (the reference — never edit it to make a test pass). */
function referenceHold(dayLog: readonly DayEvent[], todayISO: string): StrikeHold {
  const free: StrikeHold = { inHold: false, depositISO: null, throughISO: null };
  if (!ISO_DATE.test(todayISO)) return free;
  const today = Date.parse(todayISO);
  if (!Number.isFinite(today)) return free;
  let latestISO: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const ev of dayLog) {
    if (ev.kind !== 'deposit' || ev.target !== 'strike' || !ISO_DATE.test(ev.date)) continue;
    const t = Date.parse(ev.date);
    if (!Number.isFinite(t) || (today - t) / DAY_MS > STRIKE_HOLD_DAYS) continue;
    if (t > latestMs) { latestMs = t; latestISO = ev.date; }
  }
  if (latestISO === null) return free;
  return { inHold: true, depositISO: latestISO, throughISO: new Date(latestMs + STRIKE_HOLD_DAYS * DAY_MS).toISOString().slice(0, 10) };
}

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const T = Date.UTC(2026, 9, 12);
/** A small deterministic generator — the same journals every run. */
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
}
const ev = (i: number, date: string, kind: string, target?: string): DayEvent =>
  ({ id: `e${i}`, date, ts: i, kind, target, amount: 0.1 }) as unknown as DayEvent;

describe('⭐ HOLD — invariant 8: one rule for the journal and the viewer\'s date', () => {
  it('⭐ HOLD — over 4,000 journals and 9 days, the split rule equals the reference exactly', () => {
    const rand = rng(7);
    let held = 0, free = 0;
    const todays = [-200, -61, -60, -59, 0, 1, 59, 60, 61].map((d) => iso(T + d * DAY_MS));
    for (let j = 0; j < 4_000; j++) {
      const n = Math.floor(rand() * 6);
      const log: DayEvent[] = [];
      for (let i = 0; i < n; i++) {
        const offset = Math.floor(rand() * 260) - 200;   // 200 days back to 60 ahead (a future-dated deposit counts)
        const kind = rand() < 0.75 ? 'deposit' : 'withdraw';
        const target = ['strike', 'strike', 'cb', 'cold'][Math.floor(rand() * 4)];
        const date = rand() < 0.05 ? '2026-9-30' : iso(T + offset * DAY_MS);   // junk dates never count
        log.push(ev(i, date, kind, target));
      }
      for (const today of todays) {
        const want = referenceHold(log, today);
        expect(strikeHoldFrom(log, today), `HOLD journal ${j} on ${today}`).toEqual(want);
        expect(strikeHoldAt(latestStrikeDepositISO(log), today), `HOLD viewer ${j} on ${today}`).toEqual(want);
        if (want.inHold) held += 1; else free += 1;
      }
    }
    expect([held > 2_000, free > 2_000], 'HOLD the sweep reaches both').toEqual([true, true]);
  }, 60_000);   // a sweep of 4,000 journals × 9 days: room for a loaded full suite
  it('⭐ HOLD — the fact on this device: the owner reads the journal; a trusted viewer reads the snapshot\'s copy, never a journal', () => {
    const log = [ev(1, '2026-09-01', 'deposit', 'strike'), ev(2, '2026-09-20', 'deposit', 'cb')];
    expect(strikeDepositOf({ viewerMode: false, viewerStrikeDepositISO: '2026-01-01', dayLog: log }), 'HOLD owner').toBe('2026-09-01');
    expect(strikeDepositOf({ viewerMode: true, viewerStrikeDepositISO: '2026-08-15', dayLog: log }), 'HOLD viewer').toBe('2026-08-15');
    expect(strikeDepositOf({ viewerMode: true, viewerStrikeDepositISO: null, dayLog: log }), 'HOLD viewer, no date').toBeNull();
    // The viewer's hold equals the owner's for the same journal: the owner publishes latestStrikeDepositISO (payloads).
    const today = iso(T);
    expect(strikeHoldAt(strikeDepositOf({ viewerMode: true, viewerStrikeDepositISO: latestStrikeDepositISO(log), dayLog: [] }), today))
      .toEqual(strikeHoldFrom(log, today));
  });
  it('⭐ HOLD — the edges: day 60 holds, day 61 frees, a future deposit holds, junk and null free', () => {
    const d = (k: number) => iso(T - k * DAY_MS);
    expect(strikeHoldAt(d(60), iso(T)).inHold, 'HOLD day 60').toBe(true);
    expect(strikeHoldAt(d(61), iso(T)).inHold, 'HOLD day 61').toBe(false);
    expect(strikeHoldAt(iso(T + 5 * DAY_MS), iso(T)), 'HOLD future').toEqual({
      inHold: true, depositISO: iso(T + 5 * DAY_MS), throughISO: iso(T + 65 * DAY_MS),
    });
    expect(strikeHoldAt('2026-9-30', iso(T)).inHold, 'HOLD junk').toBe(false);
    expect(strikeHoldAt(null, iso(T)).inHold, 'HOLD none').toBe(false);
  });
});
