import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useStore } from '../useStore';
import { buildViewerSnapshotPayload } from '../payloads';
import { SETTINGS_FIELDS } from '../settingsFields';
import { todayLocalISO, toLocalISO } from '../../utils/format';
import type { DayEvent, MonthlyLogEntry } from '../../simulation/types';

// Real store. isAuthenticated:false → every publish path early-returns (no async / timers).
// ⚠ SYNTHETIC round figures — this repo is public; never a real position.
const TODAY = todayLocalISO();
let seq = 0;
const coldMove = (kind: 'deposit' | 'withdraw', amount: number, ts: number): DayEvent =>
  ({ id: `c${++seq}`, date: toLocalISO(new Date(ts)), ts, kind, amount, target: 'cold' });

beforeEach(() => {
  useStore.setState({
    monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {}, planEvents: [],
    recordsDirty: false, planDirty: false, advisorStartDate: TODAY, hasCbLoan: false,
    coldStorageBtc: 0, coldStorageBtcAsOf: null,
  } as never);
});

describe('setColdStorageBtc — the paired anchor', () => {
  it('⭐ emits coldStorageBtc and coldStorageBtcAsOf with ONE shared ts (they cannot tear)', () => {
    useStore.getState().setColdStorageBtc(0.5);
    const ev = useStore.getState().planEvents;
    const value = ev.filter((e) => e.field === 'coldStorageBtc');
    const asOf = ev.filter((e) => e.field === 'coldStorageBtcAsOf');
    expect(value).toHaveLength(1);
    expect(asOf).toHaveLength(1);
    expect(value[0].ts).toBe(asOf[0].ts);   // two emitPlanSets calls would get two (monotonic) timestamps
    expect(useStore.getState().coldStorageBtc).toBe(0.5);
    expect(typeof useStore.getState().coldStorageBtcAsOf).toBe('number');
  });

  it('⭐ re-entering the LIVE total is lossless — an unchanged Settings blur cannot erase cold history', () => {
    const T0 = Date.now() - 10_000;
    useStore.setState({ coldStorageBtc: 1, coldStorageBtcAsOf: T0 } as never);
    useStore.getState().addDayEvent(coldMove('deposit', 0.25, T0 + 1_000));
    expect(useStore.getState().getCurrentColdBtc()).toBeCloseTo(1.25, 12);
    // What the Settings field does on blur: commit the value it displays (the live total).
    useStore.getState().setColdStorageBtc(useStore.getState().getCurrentColdBtc());
    expect(useStore.getState().getCurrentColdBtc()).toBeCloseTo(1.25, 12);
  });
});

describe('⭐ a cold move is journal-only for the monthly rollup (the BUG1 class)', () => {
  it('a cold-only month creates no monthly entry', () => {
    useStore.getState().addDayEvent(coldMove('deposit', 0.1, Date.now()));
    expect(useStore.getState().monthlyLog).toEqual([]);
  });

  it('a manual month stays manual, and a confirmed month stays confirmed', () => {
    const entry = {
      month: 1, date: TODAY, btcBought: 0, income: 0, paydown: 0, strikeBal: 0, strikeLtv: 0,
      loggedAt: 1, btcHeld: 0, expensesActual: 0, source: 'manual', confirmed: true,
    } as MonthlyLogEntry;
    useStore.setState({ monthlyLog: [entry] } as never);
    useStore.getState().addDayEvent(coldMove('deposit', 0.1, Date.now()));
    const m1 = useStore.getState().monthlyLog.find((e) => e.month === 1)!;
    expect(m1.source).toBe('manual');
    expect(m1.confirmed).toBe(true);
  });
});

describe('the viewer receives cold PRE-DERIVED (its dayLog is [])', () => {
  it('⭐ the trusted snapshot carries the derived live total, not the anchor; the safe one carries none', () => {
    const T0 = Date.now() - 10_000;
    useStore.setState({ coldStorageBtc: 1, coldStorageBtcAsOf: T0, dayLog: [coldMove('deposit', 0.25, T0 + 1_000)] } as never);
    const trusted = buildViewerSnapshotPayload(useStore.getState(), 'trusted');
    expect(trusted.coldStorageBtc).toBeCloseTo(1.25, 12);
    // The anchor still rides settings; the top-level scalar overrides it viewer-side. Its stamp is a conscious strip.
    expect((trusted.settings as Record<string, unknown>).coldStorageBtc).toBe(1);
    expect('coldStorageBtcAsOf' in (trusted.settings as Record<string, unknown>)).toBe(false);
    const safe = buildViewerSnapshotPayload(useStore.getState(), 'safe');
    expect('coldStorageBtc' in safe).toBe(false);
  });
});

describe('tripwires', () => {
  it('SETTINGS_FIELDS still contains coldStorageBtc', () => {
    // Removing it fails EVERY existing backup: VALIDATE_WHITELIST rejects any backup settings key outside this set.
    expect(SETTINGS_FIELDS).toContain('coldStorageBtc');
  });

  it('⭐ no component reads the raw cold anchor — every live reader goes through getCurrentColdBtc', () => {
    // Covers the Settings field (bound to the anchor, a mere focus-and-leave would re-stamp it and drop every cold
    // move since) and the Dashboard / Daily re-sources. `setColdStorageBtc` and `coldStorageBtcAsOf` don't match.
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
      return /\.tsx?$/.test(e.name) ? [p] : [];
    });
    const dir = fileURLToPath(new URL('../../components', import.meta.url));
    const offenders = walk(dir).filter((f) => /\b(s|st|state)\.coldStorageBtc\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
