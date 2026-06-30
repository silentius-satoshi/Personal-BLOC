import { describe, it, expect } from 'vitest';
import {
  epochFromHeight,
  epochProgress,
  dateAtBlock,
  blockAtDate,
  CYCLE_TURNS,
  CYCLE_ANCHOR,
  nextTurnAfter,
  H4,
} from '../cycleModel';

const DAY_MS = 86_400_000;

describe('epochFromHeight', () => {
  it('classifies a current epoch-5 height', () => {
    // WHY: locks the post-2024 era + the reward-halving formula (50 / 2**4 = 3.125).
    const e = epochFromHeight(955_710);
    expect(e.index).toBe(4);
    expect(e.era).toBe(5);
    expect(e.reward).toBe(3.125);
    expect(e.startBlock).toBe(840_000);
    expect(e.endBlock).toBe(1_050_000);
  });

  it('rolls over at the 2028 halving with no code change', () => {
    // WHY: the dial must survive future halvings purely by formula — Epoch 6 derives itself.
    const e = epochFromHeight(1_050_000);
    expect(e.index).toBe(5);
    expect(e.era).toBe(6);
    expect(e.reward).toBe(1.5625);
    expect(e.startBlock).toBe(1_050_000);
    expect(e.endBlock).toBe(1_260_000);
  });
});

describe('epochProgress', () => {
  it('fraction is the 0..1 single source for hand/arc/%', () => {
    // WHY: hand, arc, and "% through epoch" all read this one value.
    expect(epochProgress(840_000).fraction).toBe(0); // startBlock → 0
    expect(epochProgress(945_000).fraction).toBeCloseTo(0.5, 10); // midpoint → 0.5
    // half-open [0,1): the last block sits just shy of 1; exactly endBlock rolls to the next
    // epoch (fraction 0) — that snap IS the halving (see the rollover test above).
    expect(epochProgress(1_049_999).fraction).toBeGreaterThan(0.999);
    expect(epochProgress(1_049_999).fraction).toBeLessThan(1);
    expect(epochProgress(1_050_000).fraction).toBe(0);
  });

  it('blocksRemaining is the exact distance to the next halving', () => {
    // WHY: spec acceptance — blocksRemaining === 1,050,000 − tip exactly, for any epoch-5 height.
    for (const h of [840_000, 900_000, 955_710, 1_049_999]) {
      expect(epochProgress(h).blocksRemaining).toBe(1_050_000 - h);
    }
  });
});

describe('dateAtBlock / blockAtDate', () => {
  it('estimates one day per 144 blocks ahead of the tip', () => {
    // WHY: 10-min/block estimate — 144 blocks × 600s = 86,400s = 1 day.
    const tip = { height: 955_710, ts: H4.date };
    expect(dateAtBlock(tip.height + 144, tip)).toBe(tip.ts + DAY_MS);
  });

  it('is anchored so blockAtDate(H4.date) === H4.block', () => {
    // WHY: the date fallback must agree with the halving anchor identity.
    expect(blockAtDate(H4.date)).toBe(H4.block);
  });
});

describe('CYCLE_TURNS (the IMG_7080 premise)', () => {
  it('is 14 turns starting from the Oct-2025 high', () => {
    // WHY: matches IMG_7080 exactly — anchor is a HIGH at the 6 Oct 2025 ATH.
    expect(CYCLE_TURNS).toHaveLength(14);
    expect(CYCLE_TURNS[0]).toEqual({ date: CYCLE_ANCHOR, kind: 'high' });
  });

  it('places the first low on Mon 5 Oct 2026 (+364d)', () => {
    // WHY: the High→Low step is 364 days → Date.UTC(2026,9,5), the canonical first floor.
    expect(CYCLE_TURNS[1].kind).toBe('low');
    expect(CYCLE_TURNS[1].date).toBe(CYCLE_ANCHOR + 364 * DAY_MS);
    expect(CYCLE_TURNS[1].date).toBe(Date.UTC(2026, 9, 5));
  });

  it('lands every turn on a Monday and keeps dates strictly increasing', () => {
    // WHY: 364 (=52×7) and 1064 (=152×7) are multiples of 7 — that is WHY every turn is a Monday.
    for (let i = 0; i < CYCLE_TURNS.length; i++) {
      expect(new Date(CYCLE_TURNS[i].date).getUTCDay()).toBe(1); // 1 = Monday
      if (i > 0) expect(CYCLE_TURNS[i].date).toBeGreaterThan(CYCLE_TURNS[i - 1].date);
    }
  });

  it('alternates high/low across the whole projection', () => {
    // WHY: the projection is a strict peak/floor alternation off the anchor high.
    CYCLE_TURNS.forEach((t, i) => expect(t.kind).toBe(i % 2 === 0 ? 'high' : 'low'));
  });
});

describe('nextTurnAfter', () => {
  it('returns the later turn between two turns, with its kind', () => {
    // WHY: marker selection — the dial picks the upcoming turn after "now".
    const mid = CYCLE_TURNS[1].date - DAY_MS; // a day before the first low
    expect(nextTurnAfter(mid)).toEqual(CYCLE_TURNS[1]);
    expect(nextTurnAfter(mid)?.kind).toBe('low');
  });

  it('returns null past the end of the projection', () => {
    // WHY: bounded cadence — nothing projected beyond the last turn.
    expect(nextTurnAfter(CYCLE_TURNS[CYCLE_TURNS.length - 1].date)).toBeNull();
  });
});
