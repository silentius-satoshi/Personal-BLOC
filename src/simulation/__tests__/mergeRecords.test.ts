import { describe, it, expect } from 'vitest';
import { mergeRecords, type RecordsState } from '../mergeRecords';
import type { MonthlyLogEntry } from '../types';

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function makeEntry(month: number, overrides: Partial<MonthlyLogEntry> = {}): MonthlyLogEntry {
  return {
    month,
    date:           `2026-0${month}-01`,
    btcBought:      0.01,
    income:         500,
    paydown:        0,
    strikeBal:      month * 1000,
    strikeLtv:      0.10,
    loggedAt:       NOW - 10 * DAY,
    btcHeld:        0,
    expensesActual: 3500,
    ...overrides,
  };
}

const state = (entries: MonthlyLogEntry[], deletions: Record<number, number> = {}): RecordsState =>
  ({ entries, deletions });

describe('mergeRecords', () => {
  it('remote-only month unions in alongside local months', () => {
    const out = mergeRecords(state([makeEntry(1)]), state([makeEntry(2)]), { preferLocalOnTie: false });
    expect(out.entries.map((e) => e.month)).toEqual([1, 2]);
  });

  it('local-only month survives a remote payload that lacks it', () => {
    const out = mergeRecords(state([makeEntry(1), makeEntry(3)]), state([makeEntry(1)]), { preferLocalOnTie: false });
    expect(out.entries.map((e) => e.month)).toEqual([1, 3]);
  });

  it('newer updatedAt wins — remote newer', () => {
    const local  = makeEntry(1, { updatedAt: 1000, btcBought: 0.01 });
    const remote = makeEntry(1, { updatedAt: 2000, btcBought: 0.99 });
    const out = mergeRecords(state([local]), state([remote]), { preferLocalOnTie: true });
    expect(out.entries[0].btcBought).toBe(0.99);
  });

  it('newer updatedAt wins — local newer', () => {
    const local  = makeEntry(1, { updatedAt: 3000, btcBought: 0.01 });
    const remote = makeEntry(1, { updatedAt: 2000, btcBought: 0.99 });
    const out = mergeRecords(state([local]), state([remote]), { preferLocalOnTie: false });
    expect(out.entries[0].btcBought).toBe(0.01);
  });

  it('legacy fallback: entries without updatedAt compare by loggedAt', () => {
    const local  = makeEntry(1, { loggedAt: 1000, btcBought: 0.01 });   // makeEntry sets no updatedAt
    const remote = makeEntry(1, { loggedAt: 5000, btcBought: 0.99 });
    const out = mergeRecords(state([local]), state([remote]), { preferLocalOnTie: true });
    expect(out.entries[0].btcBought).toBe(0.99);
  });

  it('exact tie honors preferLocalOnTie both ways', () => {
    const local  = makeEntry(1, { updatedAt: 2000, btcBought: 0.01 });
    const remote = makeEntry(1, { updatedAt: 2000, btcBought: 0.99 });
    expect(mergeRecords(state([local]), state([remote]), { preferLocalOnTie: true }).entries[0].btcBought).toBe(0.01);
    expect(mergeRecords(state([local]), state([remote]), { preferLocalOnTie: false }).entries[0].btcBought).toBe(0.99);
  });

  it('tombstone newer than entry → month deleted, tombstone kept', () => {
    const entry = makeEntry(5, { updatedAt: NOW - 2 * DAY });
    const out = mergeRecords(state([entry]), state([], { 5: NOW - DAY }), { preferLocalOnTie: true });
    expect(out.entries).toHaveLength(0);
    expect(out.deletions[5]).toBe(NOW - DAY);
  });

  it('entry newer than tombstone → entry survives, tombstone dropped', () => {
    const entry = makeEntry(5, { updatedAt: NOW });
    const out = mergeRecords(state([entry]), state([], { 5: NOW - DAY }), { preferLocalOnTie: true });
    expect(out.entries.map((e) => e.month)).toEqual([5]);
    expect(out.deletions[5]).toBeUndefined();
  });

  it('tombstone older than 90 days is GC’d from output', () => {
    const out = mergeRecords(state([], { 4: NOW - 91 * DAY }), state([]), { preferLocalOnTie: true });
    expect(out.deletions[4]).toBeUndefined();
  });

  it('output entries sorted ascending by month', () => {
    const out = mergeRecords(state([makeEntry(7), makeEntry(2)]), state([makeEntry(5)]), { preferLocalOnTie: false });
    expect(out.entries.map((e) => e.month)).toEqual([2, 5, 7]);
  });

  it('string-keyed tombstone (as from JSON.parse) still deletes its month', () => {
    const remote: RecordsState = { entries: [], deletions: JSON.parse(`{"5": ${NOW - DAY}}`) };
    const local = state([makeEntry(5, { updatedAt: NOW - 2 * DAY })]);
    const out = mergeRecords(local, remote, { preferLocalOnTie: true });
    expect(out.entries).toHaveLength(0);
    expect(out.deletions[5]).toBe(NOW - DAY);
  });
});
