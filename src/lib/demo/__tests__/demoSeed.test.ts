import { describe, it, expect } from 'vitest';
import { buildDemoSeedState, DEMO_SEED_STORE_VERSION } from '../demoSeed';
import { bucketEventToMonth } from '../../../simulation/logUtils';
import { toLocalISO } from '../../../utils/format';
import type { MonthlyLogEntry, DayEvent } from '../../../simulation/types';

// C0 — the demo showcase seed. Pure; the side-effect block (localStorage writes) is not exercised here.
const TODAY = new Date(2026, 6, 11); // 2026-07-11, LOCAL (matches toLocalISO's local accessors)

describe('buildDemoSeedState', () => {
  const s = buildDemoSeedState(TODAY);

  it('advisorStartDate is 7 calendar months back → strategy Month 8', () => {
    expect(s.advisorStartDate).toBe('2025-12-11');
    expect(bucketEventToMonth(toLocalISO(TODAY), s.advisorStartDate as string)).toBe(8);
  });

  it('has exactly 7 monthlyLog entries, all confirmed and NONE source:daily', () => {
    const log = s.monthlyLog as MonthlyLogEntry[];
    expect(log).toHaveLength(7);
    expect(log.every((e) => e.confirmed === true)).toBe(true);
    // ⚠ NOT 'daily' — a daily-source month with no dayLog events would be deleted by reconcileMonthBuckets.
    expect(log.every((e) => e.source !== 'daily')).toBe(true);
    expect(log.map((e) => e.month)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('at least one historical month has a paydown (playbook two-tone scrubber renders)', () => {
    const log = s.monthlyLog as MonthlyLogEntry[];
    expect(log.some((e) => e.paydown > 0)).toBe(true);
  });

  it('seeds monthBucketReconcileDone:true (the one-shot reconcile never runs against synthetic state)', () => {
    expect(s.monthBucketReconcileDone).toBe(true);
  });

  it('advisorMonthStartBalance === the month-7 ending strikeBal', () => {
    const log = s.monthlyLog as MonthlyLogEntry[];
    const month7 = log.find((e) => e.month === 7)!;
    expect(s.advisorMonthStartBalance).toBe(month7.strikeBal);
  });

  it('carries NO identity or viewer keys (identity-less shell)', () => {
    for (const k of ['nostrPubkey', 'nostrSigningMethod', 'nostrAuthEnabled', 'keyProvenance', 'backupVerifiedAt',
                     'writerKeyWrapped', 'writerKeyWrapMeta', 'viewerMode', 'viewerWriterPubkey', 'viewerSecretKey']) {
      expect(k in s).toBe(false);
    }
  });

  it('the dayLog has a balanceReading whose reading.strikeCollateral is a number (anchors getCurrentBtcHeld)', () => {
    const dayLog = s.dayLog as DayEvent[];
    const reading = dayLog.find((e): e is Extract<DayEvent, { kind: 'balanceReading' }> => e.kind === 'balanceReading');
    expect(reading).toBeDefined();
    expect(typeof reading!.reading.strikeCollateral).toBe('number');
  });

  it('the seed store-version constant equals 21 (must match useStore persist version)', () => {
    expect(DEMO_SEED_STORE_VERSION).toBe(21);
  });

  it('dates are dynamic — a different `today` shifts advisorStartDate', () => {
    const other = buildDemoSeedState(new Date(2027, 0, 20)); // 2027-01-20
    expect(other.advisorStartDate).toBe('2026-06-20');
    expect(bucketEventToMonth(toLocalISO(new Date(2027, 0, 20)), other.advisorStartDate as string)).toBe(8);
  });
});
