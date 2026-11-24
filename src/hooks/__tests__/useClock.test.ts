import { describe, it, expect } from 'vitest';
import { msToNextLocalDay } from '../useClock';

/**
 * BL64 v1.1 — the frame's day clock wakes a second after the next local midnight: msToNextLocalDay, pure (the hooks
 * themselves are pinned in liveWiring's CLOCKS and driven in e2e/livePrice.spec.ts's DAY and CONSOLE CLOCK). Synthetic
 * dates, in the machine's own time zone.
 */
describe('useClock — msToNextLocalDay', () => {
  it('⭐ MIDNIGHT — from any moment of a day, it lands on the next local midnight', () => {
    // mutations: a fixed 24 h → red; today's midnight (already past) → red
    expect(msToNextLocalDay(new Date(2026, 9, 12, 23, 59, 30).getTime()), 'MIDNIGHT half a minute').toBe(30_000);
    expect(msToNextLocalDay(new Date(2026, 9, 12, 23, 59, 59, 999).getTime()), 'MIDNIGHT a millisecond').toBe(1);
    for (const at of [
      new Date(2026, 9, 12, 0, 0, 0), new Date(2026, 9, 12, 12, 34, 56, 789), new Date(2026, 0, 31, 18, 0), new Date(2026, 11, 31, 23, 0),
    ]) {
      const ms = msToNextLocalDay(at.getTime());
      const next = new Date(at.getTime() + ms);
      expect(ms, `MIDNIGHT ahead, from ${at.toString()}`).toBeGreaterThan(0);
      expect([next.getHours(), next.getMinutes(), next.getSeconds(), next.getMilliseconds()], `MIDNIGHT on the hour, from ${at.toString()}`)
        .toEqual([0, 0, 0, 0]);
      expect(next.getTime(), `MIDNIGHT the next day, from ${at.toString()}`)
        .toBe(new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1).getTime());
    }
  });
});
