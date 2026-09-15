import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { rollupMonth, priorStocksForMonth } from '../logUtils';
import type { DayEvent } from '../types';

// ⚠ SYNTHETIC round figures — this repo is public; never a real position.
//
// MonthlyLogEntry.btcHeld ("Strike col") is RECORDED from the month's own balance reading, exactly like strikeBal —
// stamped once by rollupMonth, never recomputed, and ABSENT when the reading doesn't state it (0 is a real position,
// never a placeholder). strike-collateral-recorded-spec-v3.

const START = '2026-01-01';
const M1 = '2026-01-10';
const M2 = '2026-02-10';
let seq = 0;
const reading = (r: { strikeBal: number; strikeLtv: number; strikeCollateral?: number }, date: string): DayEvent =>
  ({ id: `r${++seq}`, date, ts: ++seq, kind: 'balanceReading', reading: r });
const draw = (amount: number, date: string): DayEvent => ({ id: `d${++seq}`, date, ts: ++seq, kind: 'draw', amount });
const buy = (amount: number, date: string): DayEvent => ({ id: `b${++seq}`, date, ts: ++seq, kind: 'buy', amount });
const coldDeposit = (amount: number, date: string): DayEvent =>
  ({ id: `c${++seq}`, date, ts: ++seq, kind: 'deposit', amount, target: 'cold' });

describe('rollupMonth — btcHeld is RECORDED from the month\'s reading', () => {
  it('⭐ each month records its OWN reading\'s strikeCollateral', () => {
    // Mutation: drop the stamp → both undefined → red.
    const log = [
      reading({ strikeBal: 1000, strikeLtv: 0.02, strikeCollateral: 0.50 }, M1),
      reading({ strikeBal: 2000, strikeLtv: 0.03, strikeCollateral: 0.62 }, M2),
    ];
    expect(rollupMonth(log, 1, START).entry.btcHeld).toBe(0.50);
    expect(rollupMonth(log, 2, START).entry.btcHeld).toBe(0.62);
  });

  it('⭐ a reading WITHOUT strikeCollateral leaves btcHeld ABSENT — and the reroll bridge keeps the stored value', () => {
    // The "never fix the data" rule. Mutation: `entry.btcHeld = latest.reading.strikeCollateral ?? 0` → 0 → red.
    const { entry } = rollupMonth([reading({ strikeBal: 1000, strikeLtv: 0.02 }, M1)], 1, START);
    expect('btcHeld' in entry).toBe(false);
    const stored = { btcHeld: 0.70 };
    expect({ ...stored, ...entry }.btcHeld).toBe(0.70);   // rerollMonth's { ...base, ...rollupEntry } bridge
  });

  it('zero collateral records 0, not "unset"', () => {
    // Mutation: guard on truthiness instead of `!== undefined` → absent → red.
    const { entry } = rollupMonth([reading({ strikeBal: 0, strikeLtv: 0, strikeCollateral: 0 }, M1)], 1, START);
    expect('btcHeld' in entry).toBe(true);
    expect(entry.btcHeld).toBe(0);
  });

  it('carry-forward: a month with flows and no reading takes the prior month\'s strikeCollateral, provisional', () => {
    const log = [
      reading({ strikeBal: 1000, strikeLtv: 0.02, strikeCollateral: 0.55 }, M1),
      draw(500, M2),
    ];
    const prior = priorStocksForMonth(log, START, 2);
    expect(prior?.strikeCollateral).toBe(0.55);
    const { entry } = rollupMonth(log, 2, START, prior);
    expect(entry.btcHeld).toBe(0.55);
    expect(entry.strikeBal).toBe(1000);   // exactly as strikeBal carries
    expect(entry.provisional).toBe(true);
  });

  it('a prior reading without strikeCollateral carries nothing forward (never a 0)', () => {
    const log = [reading({ strikeBal: 1000, strikeLtv: 0.02 }, M1), draw(500, M2)];
    const { entry } = rollupMonth(log, 2, START, priorStocksForMonth(log, START, 2));
    expect('btcHeld' in entry).toBe(false);
    expect(entry.provisional).toBe(true);
  });

  it('⭐ a cold-destined buy does not move btcHeld — acquired is not pledged', () => {
    // The defect this spec removes: the old chain added every buy to Strike collateral regardless of venue.
    const log = [
      reading({ strikeBal: 1000, strikeLtv: 0.02, strikeCollateral: 0.50 }, M1),
      buy(0.05, M1),
      coldDeposit(0.05, M1),
    ];
    const { entry } = rollupMonth(log, 1, START);
    expect(entry.btcBought).toBe(0.05);   // acquired — recorded
    expect(entry.btcHeld).toBe(0.50);     // pledged — the reading, NOT 0.50 + 0.05
  });
});

// ── Structural guards (the resetMirror.test.ts idiom) ───────────────────────────────────────────────────────────────

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe('structural guards', () => {
  it('recomputeBtcHeld is GONE from src/ (a revert cannot sneak the chain back in)', () => {
    const files = sourceFiles(join(process.cwd(), 'src'));
    expect(files.length).toBeGreaterThan(100);   // non-vacuous: the walker actually found the source tree
    expect(files.filter((f) => readFileSync(f, 'utf8').includes('recomputeBtcHeld'))).toEqual([]);
  });

  it('onboarding records collateral via emitBalanceReading AFTER setAdvisorStartDate, and keeps the baseline write', () => {
    // ORDER: addDayEvent buckets the reading by advisorStartDate — emitted before the start date is set, it lands in
    // the wrong strategy month. setAdvisorActualBtcHeld stays: Fix D's seed sentinel (syncEngine) reads it.
    const src = readFileSync(join(process.cwd(), 'src/components/Onboarding/OnboardingModal.tsx'), 'utf8');
    const body = src.slice(src.indexOf('const handleDone'));
    const start = body.indexOf('setAdvisorStartDate(draft.startDate)');
    const emit = body.indexOf('emitBalanceReading({ strikeCollateral: draft.collateralBtc })');
    expect(start).toBeGreaterThan(0);
    expect(emit).toBeGreaterThan(start);
    expect(body.indexOf('setAdvisorActualBtcHeld(draft.collateralBtc)')).toBeGreaterThan(0);
  });
});
